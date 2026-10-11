import { basename, extname } from 'node:path'
import { PUBLISHED_KIND, type Artifact, type Commit, type PullRequest } from '../shared/api'

export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
export type LastEvent = 'interrupt' | 'apiError' | 'normal'

export interface Agg {
  id: string
  customTitle: string | null
  firstPrompt: string | null
  prompts: string[]
  cwd: string | null
  branch: string | null
  entrypoint: string | null
  start: string | null
  end: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  pr: PullRequest | null
  prs: PullRequest[]
  forkedFrom: string | null
  awaySummary: string | null
  files: Record<string, { added: number; removed: number }>
  commits: Commit[]
  artifacts: Record<string, Artifact>
  lastEvent: LastEvent
  sum: Tokens
  lastMsgId: string | null
  lastMsgUsage: Tokens
  context: number
  compactions: number
  costState: { cost: number; durationMs: number; linesAdded: number; linesRemoved: number; tokens: Tokens } | null
}

export interface Facts {
  id: string
  title: string
  named: boolean
  cwd: string
  branch: string | null
  hidden: boolean
  start: string
  end: string
  model: string | null
  effort: string | null
  permissionMode: string | null
  pr: PullRequest | null
  prs: PullRequest[]
  forkedFrom: string | null
  prompts: string[]
  summary: { did: string; next: string[] } | null
  files: { path: string; added: number; removed: number }[]
  commits: Commit[]
  artifacts: Artifact[]
  lastEvent: LastEvent
  tokens: Tokens
  context: number
  compactions: number
  cost: number | null
  durationMs: number
  linesAdded: number
  linesRemoved: number
}

// Caps keep the IPC payload small: every listSessions() ships all sessions.
const MAX_PROMPTS = 30
const PROMPT_CHARS = 300
const TITLE_CHARS = 80
const PREVIEW_LINES = 40
const PREVIEW_CHARS = 4096
const ARTIFACT_KINDS: Record<string, string> = {
  md: 'markdown', markdown: 'markdown', json: 'json', html: 'html', csv: 'csv',
  yaml: 'yaml', yml: 'yaml', txt: 'text', svg: 'svg',
}
// These records start with their type and carry nothing we read, so skip them before JSON.parse.
const SKIP_HEAD = /"type":"(?:file-history-snapshot|file-history-delta|queue-operation|atis-latch)"/
const COMMIT_RE = /^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm
const PUBLISHED_URL_RE = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+$/

export type Rec = Record<string, any>

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const lineCount = (s: unknown): number => (typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0)
export const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

export function emptyAgg(id: string): Agg {
  return {
    id, customTitle: null, firstPrompt: null, prompts: [], cwd: null, branch: null, entrypoint: null,
    start: null, end: null, model: null, effort: null, permissionMode: null, pr: null, prs: [], forkedFrom: null,
    awaySummary: null, files: {}, commits: [], artifacts: {}, lastEvent: 'normal', sum: zero(),
    lastMsgId: null, lastMsgUsage: zero(), context: 0, compactions: 0, costState: null,
  }
}

export function parseRecord(line: string): Rec | null {
  if (!line || SKIP_HEAD.test(line.slice(0, 120))) return null
  if (line.includes('"type":"attachment"') && !line.includes('"forkedFrom"')) return null
  let rec: unknown
  try {
    rec = JSON.parse(line)
  } catch {
    return null
  }
  return rec && typeof rec === 'object' && !Array.isArray(rec) ? (rec as Rec) : null
}

export function reduceLine(agg: Agg, line: string): void {
  const rec = parseRecord(line)
  if (rec) reduceRecord(agg, rec)
}

function reduceRecord(agg: Agg, r: Rec): void {
  const ts = str(r.timestamp)
  if (ts) {
    agg.start ??= ts
    agg.end = ts
  }
  agg.cwd = str(r.cwd) ?? agg.cwd
  agg.branch = str(r.gitBranch) ?? agg.branch
  agg.entrypoint ??= str(r.entrypoint)
  agg.forkedFrom ??= str(r.forkedFrom?.sessionId)

  switch (r.type) {
    case 'custom-title': {
      const t = str(r.customTitle)?.trim()
      if (t) agg.customTitle = t
      break
    }
    case 'permission-mode':
      agg.permissionMode = str(r.permissionMode) ?? agg.permissionMode
      break
    case 'pr-link': {
      const n = num(r.prNumber)
      const url = str(r.prUrl)
      if (n > 0 && url) {
        agg.pr = { repo: str(r.prRepository) ?? '', number: n, url }
        if (!agg.prs.some((p) => p.url === url)) agg.prs.push(agg.pr)
      }
      break
    }
    case 'cost-state':
      agg.costState = readCostState(r)
      break
    case 'system':
      if (r.subtype === 'away_summary' && str(r.content)) agg.awaySummary = r.content
      if (r.subtype === 'compact_boundary') agg.compactions++
      break
    case 'user':
      reduceUser(agg, r)
      break
    case 'assistant':
      reduceAssistant(agg, r)
      break
  }
}

function readCostState(r: Rec): NonNullable<Agg['costState']> {
  const tokens = zero()
  const usage = r.modelUsage && typeof r.modelUsage === 'object' ? Object.values(r.modelUsage as Rec) : []
  for (const m of usage) {
    tokens.input += num(m?.inputTokens)
    tokens.output += num(m?.outputTokens)
    tokens.cacheRead += num(m?.cacheReadInputTokens)
    tokens.cacheWrite += num(m?.cacheCreationInputTokens)
  }
  return {
    cost: num(r.totalCostUSD),
    durationMs: num(r.totalDuration),
    linesAdded: num(r.totalLinesAdded),
    linesRemoved: num(r.totalLinesRemoved),
    tokens,
  }
}

function reduceUser(agg: Agg, r: Rec): void {
  if (r.isSidechain) return
  const content = r.message?.content
  if (typeof content === 'string') {
    if (!r.isMeta) userText(agg, content)
    return
  }
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      if (!r.isMeta) userText(agg, block.text)
    } else if (block?.type === 'tool_result') {
      toolResult(agg, block, str(r.timestamp) ?? '')
    }
  }
  published(agg, r.toolUseResult)
}

// An Artifact publish leaves { url, artifact_id, title } here; reads and lists leave other shapes.
function published(agg: Agg, res: unknown): void {
  if (!res || typeof res !== 'object') return
  const { url, artifact_id, title } = res as Rec
  if (typeof url !== 'string' || !PUBLISHED_URL_RE.test(url) || !str(artifact_id)) return
  agg.artifacts[url] = { name: str(title) ?? url, kind: PUBLISHED_KIND, path: url, bytes: 0, preview: '' }
}

function userText(agg: Agg, text: string): void {
  if (text.trimStart().startsWith('[Request interrupted')) {
    agg.lastEvent = 'interrupt'
    return
  }
  agg.lastEvent = 'normal'
  const prompt = promptText(text)
  if (!prompt) return
  const capped = prompt.slice(0, PROMPT_CHARS)
  agg.firstPrompt ??= capped
  if (agg.prompts.length < MAX_PROMPTS) agg.prompts.push(capped)
}

// Slash commands arrive wrapped in tags; keep "/name args" when there are args, drop everything else tagged.
export function promptText(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (!t.startsWith('<')) return t
  const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]?.trim()
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim()
  return name && args ? `${name} ${args}` : null
}

function toolResult(agg: Agg, block: Rec, at: string): void {
  const c = block.content
  const text =
    typeof c === 'string' ? c
    : Array.isArray(c) ? c.map((x: Rec) => (typeof x?.text === 'string' ? x.text : '')).join('\n')
    : ''
  if (!text.includes('] ')) return
  for (const m of text.matchAll(COMMIT_RE)) {
    if (!agg.commits.some((x) => x.sha === m[2])) agg.commits.push({ sha: m[2], msg: m[3].trim(), at })
  }
}

function reduceAssistant(agg: Agg, r: Rec): void {
  if (r.isSidechain) return
  const m = r.message
  if (!m || typeof m !== 'object') return
  if (typeof m.model === 'string' && m.model !== '<synthetic>') agg.model = m.model
  agg.effort = str(r.effort) ?? agg.effort
  agg.lastEvent = r.isApiErrorMessage ? 'apiError' : 'normal'

  const u = m.usage
  if (u && typeof u === 'object') {
    const t: Tokens = {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
    }
    const msgId = str(m.id)
    // Streamed chunks of one message repeat its usage; replace the earlier chunk's share instead of adding again.
    if (msgId && msgId === agg.lastMsgId) addTokens(agg.sum, agg.lastMsgUsage, -1)
    addTokens(agg.sum, t, 1)
    agg.lastMsgId = msgId
    agg.lastMsgUsage = t
    const ctx = t.input + t.cacheRead + t.cacheWrite
    if (ctx > 0) agg.context = ctx
  }
  if (Array.isArray(m.content)) for (const block of m.content) if (block?.type === 'tool_use') toolUse(agg, block)
}

function addTokens(into: Tokens, t: Tokens, sign: 1 | -1): void {
  into.input += sign * t.input
  into.output += sign * t.output
  into.cacheRead += sign * t.cacheRead
  into.cacheWrite += sign * t.cacheWrite
}

function toolUse(agg: Agg, block: Rec): void {
  const input = block.input
  const path = str(input?.file_path)
  if (!path) return
  if (block.name === 'Edit') {
    bump(agg, path, lineCount(input.new_string), lineCount(input.old_string))
  } else if (block.name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits) bump(agg, path, lineCount(e?.new_string), lineCount(e?.old_string))
  } else if (block.name === 'Write' && typeof input.content === 'string') {
    bump(agg, path, lineCount(input.content), 0)
    const kind = ARTIFACT_KINDS[extname(path).slice(1).toLowerCase()]
    if (kind) {
      agg.artifacts[path] = {
        name: basename(path),
        kind,
        path,
        bytes: Buffer.byteLength(input.content),
        preview: input.content.split('\n').slice(0, PREVIEW_LINES).join('\n').slice(0, PREVIEW_CHARS),
      }
    }
  }
}

function bump(agg: Agg, path: string, added: number, removed: number): void {
  const f = (agg.files[path] ??= { added: 0, removed: 0 })
  f.added += added
  f.removed += removed
}

export const stripRecapSuffix = (text: string): string => text.replace(/\s*\(disable recaps in \/config\)\s*$/, '').trim()

export function splitSummary(text: string): { did: string; next: string[] } {
  const clean = stripRecapSuffix(text)
  const m = /\bNext[:,]\s*/.exec(clean)
  if (!m) return { did: clean, next: [] }
  const did = clean.slice(0, m.index).trim()
  const rest = clean.slice(m.index + m[0].length).trim()
  return { did, next: rest ? [rest[0].toUpperCase() + rest.slice(1)] : [] }
}

function titleFrom(prompt: string | null): string {
  const line = prompt?.split('\n').find((l) => l.trim())?.trim()
  if (!line) return 'Untitled session'
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line
}

export function finalize(agg: Agg): Facts | null {
  if (!agg.start || !agg.end || !agg.cwd) return null
  const cs = agg.costState
  const csTotal = cs ? cs.tokens.input + cs.tokens.output + cs.tokens.cacheRead + cs.tokens.cacheWrite : 0
  const files = Object.entries(agg.files).map(([path, f]) => ({ path, added: f.added, removed: f.removed }))
  return {
    id: agg.id,
    title: agg.customTitle ?? titleFrom(agg.firstPrompt),
    named: agg.customTitle !== null,
    cwd: agg.cwd,
    branch: agg.branch,
    hidden: agg.entrypoint?.startsWith('sdk') ?? false,
    start: agg.start,
    end: agg.end,
    model: agg.model,
    effort: agg.effort,
    permissionMode: agg.permissionMode,
    pr: agg.pr,
    prs: agg.prs,
    forkedFrom: agg.forkedFrom,
    prompts: agg.prompts,
    summary: agg.awaySummary ? splitSummary(agg.awaySummary) : null,
    files,
    commits: agg.commits,
    artifacts: Object.values(agg.artifacts),
    lastEvent: agg.lastEvent,
    tokens: cs && csTotal > 0 ? cs.tokens : agg.sum,
    context: agg.context,
    compactions: agg.compactions,
    cost: cs ? cs.cost : null,
    durationMs: cs?.durationMs || Math.max(0, Date.parse(agg.end) - Date.parse(agg.start)),
    linesAdded: cs ? cs.linesAdded : files.reduce((n, f) => n + f.added, 0),
    linesRemoved: cs ? cs.linesRemoved : files.reduce((n, f) => n + f.removed, 0),
  }
}

export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length >= 1 && t.length <= 120 && !/[\x00-\x1f\x7f]/.test(t) ? t : null
}

// The same record Claude Code's /rename appends; the last one in the file wins.
export const customTitleLine = (id: string, title: string): string =>
  `${JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: id })}\n`

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const base = { sessionId: id, cwd: '/Users/me/code/app', gitBranch: 'main', entrypoint: 'cli' }
  const user = (content: unknown, extra: object = {}) => ({
    type: 'user', timestamp: '2026-10-06T09:12:00.000Z', ...base, message: { role: 'user', content }, ...extra,
  })
  const assistant = (content: unknown[], extra: object = {}, msg: object = {}) => ({
    type: 'assistant', timestamp: '2026-10-06T09:40:00.000Z', ...base,
    message: { id: 'msg_1', model: 'claude-opus-5-5', content, ...msg }, ...extra,
  })
  const run = (...recs: unknown[]) => {
    const agg = emptyAgg(id)
    for (const r of recs) reduceLine(agg, typeof r === 'string' ? r : JSON.stringify(r))
    return finalize(agg)
  }

  it('takes the title from the last custom-title record and marks the session named', () => {
    const f = run(user('Fix the build'), { type: 'custom-title', customTitle: 'first', sessionId: id },
      { type: 'custom-title', customTitle: 'live-meeting', sessionId: id })
    expect(f?.title).toBe('live-meeting')
    expect(f?.named).toBe(true)
  })

  it('falls back to the first real prompt, skipping meta, bare commands and interrupts', () => {
    const f = run(
      user('<local-command-stdout>ok</local-command-stdout>'),
      user('Caveat: injected context', { isMeta: true }),
      user('<command-message>clear</command-message>\n<command-name>/clear</command-name>\n<command-args></command-args>'),
      user('[Request interrupted by user]'),
      user('<command-message>team8:plan</command-message>\n<command-name>/team8:plan</command-name>\n<command-args>build a session manager</command-args>'),
      user('second prompt'),
    )
    expect(f?.title).toBe('/team8:plan build a session manager')
    expect(f?.named).toBe(false)
    expect(f?.prompts).toEqual(['/team8:plan build a session manager', 'second prompt'])
  })

  it('cuts a long first-prompt title to 80 characters with an ellipsis', () => {
    const f = run(user('x'.repeat(200)))
    expect(f?.title).toBe(`${'x'.repeat(79)}…`)
  })

  it('stores at most 300 characters of the first prompt in the aggregate', () => {
    const agg = emptyAgg(id)
    reduceLine(agg, JSON.stringify(user('y'.repeat(100_000))))
    expect(agg.firstPrompt).toHaveLength(300)
  })

  it('keeps the latest cwd, branch, model, effort and permission mode, and the first and last timestamps', () => {
    const f = run(
      user('go'),
      { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: id },
      assistant([{ type: 'text', text: 'ok' }], { effort: 'xhigh', gitBranch: 'live-meeting' }),
    )
    expect(f).toMatchObject({
      cwd: '/Users/me/code/app', branch: 'live-meeting', model: 'claude-opus-5-5', effort: 'xhigh',
      permissionMode: 'bypassPermissions', start: '2026-10-06T09:12:00.000Z', end: '2026-10-06T09:40:00.000Z',
    })
  })

  it('marks sessions started from the SDK as hidden', () => {
    expect(run(user('go', { entrypoint: 'sdk-cli' }))?.hidden).toBe(true)
    expect(run(user('go'))?.hidden).toBe(false)
  })

  it('counts changed lines per file and records doc-like writes as artifacts', () => {
    const f = run(user('go'), assistant([
      { type: 'tool_use', name: 'Edit', input: { file_path: '/Users/me/code/app/a.ts', old_string: 'a\nb', new_string: 'a\nb\nc' } },
      { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/Users/me/code/app/a.ts', edits: [{ old_string: 'x', new_string: 'y\nz' }] } },
      { type: 'tool_use', name: 'Write', input: { file_path: '/Users/me/code/app/docs/plan.md', content: '# Plan\n\nStep one' } },
      { type: 'tool_use', name: 'Write', input: { file_path: '/Users/me/code/app/b.ts', content: 'export {}' } },
    ]))
    expect(f?.files).toEqual([
      { path: '/Users/me/code/app/a.ts', added: 5, removed: 3 },
      { path: '/Users/me/code/app/docs/plan.md', added: 3, removed: 0 },
      { path: '/Users/me/code/app/b.ts', added: 1, removed: 0 },
    ])
    expect(f?.artifacts).toEqual([
      { name: 'plan.md', kind: 'markdown', path: '/Users/me/code/app/docs/plan.md', bytes: 16, preview: '# Plan\n\nStep one' },
    ])
  })

  it('records the claude.ai artifacts a session published, once per link, and not the ones it read or listed', () => {
    const url = 'https://claude.ai/artifact/Zq7Fake9ArtifactId00'
    const publish = (title: string, version: number) =>
      user([{ type: 'tool_result', content: `Published /tmp/arch.html at ${url} (Version ${version})` }],
        { toolUseResult: { url, path: '/tmp/arch.html', artifact_id: 'f00d', title, version } })
    const f = run(
      user('draw the architecture'),
      publish('Architecture', 1),
      publish('Meetnotes architecture', 2),
      user([{ type: 'tool_result', content: 'read' }], { toolUseResult: { read: { url: 'https://claude.ai/artifact/Other1' }, artifactRead: {} } }),
      user([{ type: 'tool_result', content: 'types' }], { toolUseResult: { artifact_types: [{ url: 'https://claude.ai/artifact/Type1' }] } }),
    )
    expect(f?.artifacts).toEqual([{ name: 'Meetnotes architecture', kind: 'claude.ai', path: url, bytes: 0, preview: '' }])
  })

  it('reads commits from git commit output in tool results, once per sha', () => {
    const out = '[main 67e6e2c] Add the warp shortcut\n 1 file changed, 45 insertions(+)'
    const f = run(
      user([{ type: 'tool_result', content: out }]),
      user([{ type: 'tool_result', content: [{ type: 'text', text: out }] }]),
      user([{ type: 'tool_result', content: '[feat/x (root-commit) 1a2b3c4] Initial commit' }]),
    )
    expect(f?.commits).toEqual([
      { sha: '67e6e2c', msg: 'Add the warp shortcut', at: '2026-10-06T09:12:00.000Z' },
      { sha: '1a2b3c4', msg: 'Initial commit', at: '2026-10-06T09:12:00.000Z' },
    ])
  })

  it('counts a streamed assistant message once when consecutive records share its id', () => {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 }
    const f = run(user('go'),
      assistant([{ type: 'text', text: 'a' }], {}, { id: 'msg_1', usage }),
      assistant([{ type: 'text', text: 'b' }], {}, { id: 'msg_1', usage: { ...usage, output_tokens: 7 } }),
      assistant([{ type: 'text', text: 'c' }], {}, { id: 'msg_2', usage }),
    )
    expect(f?.tokens).toEqual({ input: 20, output: 12, cacheRead: 2000, cacheWrite: 200 })
    expect(f?.context).toBe(1110)
    expect(f?.cost).toBeNull()
  })

  it('prefers the last cost-state over summed usage for totals, cost, duration and lines', () => {
    const cs = (cost: number) => ({
      type: 'cost-state', sessionId: id, totalCostUSD: cost, totalDuration: 2_400_000, totalLinesAdded: 524, totalLinesRemoved: 131,
      modelUsage: { 'claude-opus-5-5': { inputTokens: 150, outputTokens: 190_900, cacheReadInputTokens: 260_800, cacheCreationInputTokens: 2200 } },
    })
    const f = run(user('go'), cs(1), cs(5.08))
    expect(f).toMatchObject({ cost: 5.08, durationMs: 2_400_000, linesAdded: 524, linesRemoved: 131 })
    expect(f?.tokens).toEqual({ input: 150, output: 190_900, cacheRead: 260_800, cacheWrite: 2200 })
  })

  it('remembers whether the last turn was interrupted or failed', () => {
    expect(run(user('go'), assistant([]), user('[Request interrupted by user]'))?.lastEvent).toBe('interrupt')
    expect(run(user('go'), assistant([], { isApiErrorMessage: true }))?.lastEvent).toBe('apiError')
    expect(run(user('go'), assistant([], { isApiErrorMessage: true }), user('retry'))?.lastEvent).toBe('normal')
  })

  it('splits the last away summary into what was done and what is next', () => {
    const f = run(user('go'),
      { type: 'system', subtype: 'away_summary', content: 'old', timestamp: '2026-10-06T09:20:00.000Z', ...base },
      { type: 'system', subtype: 'away_summary', content: 'Built the import. Next: review PR #28. (disable recaps in /config)', timestamp: '2026-10-06T09:30:00.000Z', ...base })
    expect(f?.summary).toEqual({ did: 'Built the import.', next: ['Review PR #28.'] })
    expect(splitSummary('Nothing left to do.')).toEqual({ did: 'Nothing left to do.', next: [] })
    expect(splitSummary('Fixed it. Next, once the run ends, I tune.')).toEqual({ did: 'Fixed it.', next: ['Once the run ends, I tune.'] })
  })

  it('keeps every distinct PR the session linked, the latest as its PR, plus the fork parent and compactions', () => {
    const f = run(
      { type: 'attachment', forkedFrom: { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', messageUuid: 'x' }, ...base, timestamp: '2026-10-06T09:00:00.000Z' },
      user('go'),
      { type: 'pr-link', sessionId: id, prNumber: '28', prUrl: 'https://github.com/alan-oliv/meetnotes/pull/28', prRepository: 'alan-oliv/meetnotes' },
      { type: 'pr-link', sessionId: id, prNumber: '29', prUrl: 'https://github.com/alan-oliv/meetnotes/pull/29', prRepository: 'alan-oliv/meetnotes' },
      { type: 'pr-link', sessionId: id, prNumber: '28', prUrl: 'https://github.com/alan-oliv/meetnotes/pull/28', prRepository: 'alan-oliv/meetnotes' },
      { type: 'system', subtype: 'compact_boundary', ...base, timestamp: '2026-10-06T09:50:00.000Z' },
    )
    expect(f?.forkedFrom).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(f?.pr).toEqual({ repo: 'alan-oliv/meetnotes', number: 28, url: 'https://github.com/alan-oliv/meetnotes/pull/28' })
    expect(f?.prs.map((x) => x.number)).toEqual([28, 29])
    expect(f?.compactions).toBe(1)
  })

  it('skips malformed lines and snapshot records without throwing', () => {
    const f = run('{not json', '{"type":"file-history-snapshot","messageId":"m","snapshot":{}}', '', user('go'))
    expect(f?.title).toBe('go')
  })

  it('returns null for a transcript with no timestamped records', () => {
    expect(run({ type: 'custom-title', customTitle: 'x', sessionId: id })).toBeNull()
  })

  it('accepts a trimmed title of 1 to 120 characters without line breaks or control characters', () => {
    expect(cleanTitle('  live-meeting  ')).toBe('live-meeting')
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('a\nb')).toBeNull()
    expect(cleanTitle('red \x1b[31mtitle')).toBeNull()
    expect(cleanTitle('tab\there')).toBeNull()
    expect(cleanTitle('del\x7f')).toBeNull()
    expect(cleanTitle('x'.repeat(121))).toBeNull()
    expect(cleanTitle(7)).toBeNull()
  })

  it('writes a custom-title record that the reducer reads back as the name', () => {
    const agg = emptyAgg(id)
    reduceLine(agg, JSON.stringify(user('go')))
    reduceLine(agg, customTitleLine(id, 'audio-upload').trimEnd())
    expect(customTitleLine(id, 'x').endsWith('\n')).toBe(true)
    expect(finalize(agg)).toMatchObject({ title: 'audio-upload', named: true })
  })
  it('parses a record line and returns null for skipped types, attachments and bad JSON', () => {
    expect(parseRecord('{"type":"custom-title","customTitle":"x"}')).toEqual({ type: 'custom-title', customTitle: 'x' })
    expect(parseRecord('{"type":"file-history-snapshot","snapshot":{}}')).toBeNull()
    expect(parseRecord('{"type":"attachment","attachment":{}}')).toBeNull()
    expect(parseRecord('[1,2]')).toBeNull()
    expect(parseRecord('{nope')).toBeNull()
  })
  it('keeps slash commands with arguments as prompts and drops other tagged text', () => {
    expect(promptText('<command-message>plan</command-message>\n<command-name>/team8:plan</command-name>\n<command-args>build it</command-args>')).toBe('/team8:plan build it')
    expect(promptText('<local-command-stdout>ok</local-command-stdout>')).toBeNull()
    expect(promptText('  plain  ')).toBe('plain')
    expect(stripRecapSuffix('Did it. (disable recaps in /config)')).toBe('Did it.')
  })
}

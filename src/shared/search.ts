import { PUBLISHED_KIND, prCommand, resumeCommand, SETTINGS_DEFAULTS, TERMINALS, type Artifact, type IconName, type Session, type Settings, type Terminal } from './api'
import { makeSession } from './fixtures'
import { agoShort, attention, daysAgo, fileSize, plural, tildify } from './format'
import { visible } from './tree'
import { byRecent } from './views'

export type KindId = 'sessions' | 'ask' | 'files' | 'artifacts' | 'prs' | 'in' | 'is' | 'when' | 'actions' | 'terminal' | 'rename'
export interface Kind { id: KindId; prefix: string; label: string; icon: IconName; desc: string; examples: string[] }
export type ActionId =
  | 'resume' | 'copy' | 'fork' | 'openFolder' | 'openPr' | 'copyPr' | 'showRepo'
  | 'rename' | 'archive' | 'unarchive' | 'changeTerminal' | 'teeOn' | 'teeOff'

interface Row { key: string; icon: IconName; iconColor: string; title: string; sub: string; mono: boolean; right: string; keycap: string }
export type Result =
  | (Row & { type: 'kind'; kind: Kind })
  | (Row & { type: 'session'; session: Session; reason: string | null; artifact: Artifact | null })
  | (Row & { type: 'option'; fill: { kind: KindId; query: string } })
  | (Row & { type: 'action'; action: ActionId; session: Session; detail: string })
  | (Row & { type: 'terminal'; terminal: Terminal })
export interface ResultGroup { label: string; results: Result[] }
export interface SearchContext { now: Date; selected: Session | null; settings: Settings }
type SessionResult = Extract<Result, { type: 'session' }>

export const KINDS: Kind[] = [
  { id: 'sessions', prefix: '', label: 'Sessions', icon: 'Search1', desc: 'Match words in titles, prompts, summaries and paths. This is what you get when you just type.', examples: ['transcript', 'board performance', 'marketplaces'] },
  { id: 'ask', prefix: '?', label: 'Ask', icon: 'Bolt', desc: 'Describe the session in your own words. Results are ranked by meaning and say why they matched.', examples: ['? where did I fix the failed transcript', '? the one that made team8 faster', '? telling speakers apart'] },
  { id: 'files', prefix: 'file:', label: 'Files', icon: 'Document', desc: 'Find sessions by a file they changed. Partial names and paths work.', examples: ['file:diarize', 'file:useVirtualRows', 'file:.claude/commands'] },
  { id: 'artifacts', prefix: 'art:', label: 'Artifacts', icon: 'Attachment2', desc: 'Find what a session produced: plans, reports and docs it wrote, and the Claude artifacts it published, even when the session name says nothing about them.', examples: ['art:report', 'art:.md', 'art:profile'] },
  { id: 'prs', prefix: 'pr:', label: 'PRs and commits', icon: 'Branch', desc: 'Look up a PR number or repository, a commit hash or a commit message.', examples: ['pr:27', 'pr:audio-sync', 'pr:virtualize'] },
  { id: 'in', prefix: 'in:', label: 'Repository', icon: 'Box', desc: 'Limit to one repository or folder, then keep typing to search inside it.', examples: ['in:team8', 'in:meetnotes live', 'in:~/code'] },
  { id: 'is', prefix: 'is:', label: 'Status', icon: 'Loader', desc: 'Running, waiting, interrupted, failed or completed sessions, plus hidden and archived ones.', examples: ['is:running', 'is:interrupted', 'is:hidden'] },
  { id: 'when', prefix: 'when:', label: 'Time', icon: 'ClockOutline', desc: 'Today, yesterday or this week.', examples: ['when:today', 'when:yesterday', 'when:week'] },
  { id: 'actions', prefix: '>', label: 'Actions', icon: 'Code', desc: 'Run an action on the selected session without leaving the keyboard.', examples: ['> resume', '> copy', '> open pr'] },
]
const INTERNAL_KINDS: Kind[] = [
  { id: 'terminal', prefix: '', label: 'Resume in', icon: 'Code', desc: 'Pick the terminal that resumes and forks sessions. Change it later with > Change terminal.', examples: [] },
  { id: 'rename', prefix: '', label: 'Rename', icon: 'Edit', desc: 'Type a new title and press Enter. Named sessions resume by name from any folder.', examples: [] },
]
export const kindById = (id: KindId): Kind => [...KINDS, ...INTERNAL_KINDS].find((k) => k.id === id) ?? KINDS[0]

const SECONDARY = 'var(--app-text-2)'
const TERTIARY = 'var(--app-text-3)'

export function detectKind(input: string): { kind: KindId; rest: string } | null {
  // A pasted file:// link is a path to search for, not the file: prefix.
  if (/^\s*file:\/\//i.test(input)) return { kind: 'sessions', rest: fileUrlPath(input.trim()) }
  const lower = input.toLowerCase()
  const k = KINDS.filter((x) => x.prefix && lower.startsWith(x.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return k ? { kind: k.id, rest: input.slice(k.prefix.length).replace(/^\s+/, '') } : null
}

function fileUrlPath(url: string): string {
  const path = new URL(url).pathname
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function haystack(s: Session): string {
  return [
    s.title, s.repo?.name ?? '', s.cwd, tildify(s.cwd), s.branch ?? '', s.prompts.join(' '),
    s.summary ? `${s.summary.did} ${s.summary.next.join(' ')}` : '',
    s.files.map((f) => `${f.path} ${tildify(f.path)}`).join(' '),
    s.prs.map((p) => `${p.repo}#${p.number} #${p.number} ${p.url}`).join(' '),
    s.commits.map((c) => `${c.sha} ${c.msg}`).join(' '),
    s.artifacts.map((a) => `${a.name} ${a.path} ${tildify(a.path)}`).join(' '),
  ].join(' ').toLowerCase()
}

const PR_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i

// A pasted PR link: the whole query must be the URL, so prose that merely mentions one stays a text search.
export function parsePrUrl(q: string): { repo: string; number: number } | null {
  const m = PR_URL.exec(q.trim())
  return m ? { repo: m[1], number: Number(m[2]) } : null
}

export function matches(s: Session, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = haystack(s)
  return words.every((w) => hay.includes(w))
}

const STOP = new Set(
  'the a an one session sessions where when which that i we me my claude did do was is to of for in on with and or about it this from made make work worked fix fixed find found'.split(' '),
)

// ponytail: lexical stand-in for embeddings, ported verbatim from the prototype's sem(); swap the body, keep the signature.
export function ask(s: Session, q: string): { score: number; pct: number; reason: string } | null {
  const toks = q.toLowerCase().replace(/[^a-z0-9#./_\-\s]/g, ' ').split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ing|ed|er|es|s)$/, '') : t))
  if (!toks.length) return null
  const first = s.prompts[0] ?? ''
  const fields: [string, string][] = [
    ...s.files.map((f): [string, string] => [`Changed ${f.path}`, f.path]),
    ...s.artifacts.map((a): [string, string] => [`Created ${a.name}`, `${a.name} ${a.kind} ${a.preview}`]),
    ...s.prs.map((p): [string, string] => [`PR ${p.repo}#${p.number}`, `${p.repo}#${p.number}`]),
    ...(first ? [[`Prompt: “${first.length > 80 ? `${first.slice(0, 79)}…` : first}”`, s.prompts.join(' ')] as [string, string]] : []),
    ...(s.summary ? [[`Summary: ${s.summary.did}`, `${s.summary.did} ${s.summary.next.join(' ')}`] as [string, string]] : []),
    [`Title: ${s.title}`, `${s.title} ${s.repo?.name ?? ''}`],
  ]
  let hit = 0
  let reason = ''
  for (const t of toks) {
    const f = fields.find(([, hay]) => hay.toLowerCase().includes(t))
    if (f) {
      hit++
      reason ||= f[0]
    }
  }
  const score = hit / toks.length
  return score >= 0.5 ? { score, pct: Math.round(58 + score * 36), reason } : null
}

function sessionRow(s: Session, now: Date, over: Partial<Omit<SessionResult, 'type' | 'session'>> = {}): Result {
  const dot = attention(s.status)
  return {
    type: 'session', session: s, reason: null, artifact: null, key: s.id,
    icon: dot ? 'Loader' : 'Document', iconColor: dot ? dot.color : TERTIARY,
    title: s.title, sub: `${s.repo ? `${s.repo.name} · ` : ''}${agoShort(s.end, now)}`,
    mono: false, right: '', keycap: '', ...over,
  }
}

const kindRow = (k: Kind): Result => ({
  type: 'kind', kind: k, key: `k:${k.id}`, icon: k.icon, iconColor: SECONDARY, title: k.label,
  sub: k.examples[0] ?? '', mono: true, right: '', keycap: k.prefix,
})

const optionRow = (title: string, sub: string, icon: IconName, fill: { kind: KindId; query: string }): Result => ({
  type: 'option', fill, key: `o:${fill.kind}:${fill.query}`, icon, iconColor: SECONDARY, title, sub, mono: false, right: '', keycap: '',
})

const baseName = (p: string) => p.split('/').pop() ?? p
const dirName = (p: string) => p.split('/').slice(0, -1).join('/')

function actionsFor(s: Session, settings: Settings): Result[] {
  const a = (action: ActionId, title: string, icon: IconName, detail: string): Result => ({
    type: 'action', action, session: s, detail, key: `a:${action}`, icon, iconColor: SECONDARY, title, sub: '', mono: false, right: '', keycap: '',
  })
  const list: Result[] = [
    a('resume', 'Resume', 'ArrowRight', resumeCommand(s.id, false)),
    a('copy', 'Copy resume command', 'Clipboard', resumeCommand(s.id, false)),
    a('fork', 'Fork into a new session', 'Layers', resumeCommand(s.id, true)),
  ]
  if (s.cwdExists) list.push(a('openFolder', 'Open folder', 'Storage', tildify(s.cwd)))
  if (s.pr) {
    list.push(
      a('openPr', `Open PR ${s.pr.repo}#${s.pr.number}`, 'Link', s.pr.url),
      a('copyPr', `All sessions for PR #${s.pr.number}`, 'Branch', prCommand(s.pr.number)),
    )
  }
  if (s.repo) list.push(a('showRepo', `Show ${s.repo.name} in the tree`, 'Box', tildify(s.repo.root)))
  list.push(
    a('rename', 'Rename session', 'Edit', 'Appends a custom-title record to the transcript, as /rename does.'),
    s.archived
      ? a('unarchive', 'Restore from archive', 'Archive', 'Moves it back to All sessions.')
      : a('archive', 'Archive session', 'Archive', 'Hides it from All sessions. Nothing is deleted.'),
    a('changeTerminal', 'Change terminal', 'Code', `Current: ${TERMINALS.find((t) => t.id === settings.terminal)?.label ?? 'default'}`),
    settings.statusTee
      ? a('teeOff', 'Hide plan usage', 'Loader', 'Restores your original status line in ~/.claude/settings.json.')
      : a('teeOn', 'Show plan usage', 'Loader', 'Wraps your status line so Session Deck can read plan usage. Your status line keeps rendering.'),
  )
  return list
}

function places(shown: Session[]): { id: string; count: number; test: (s: Session) => boolean }[] {
  const out = new Map<string, { id: string; count: number; test: (s: Session) => boolean }>()
  for (const s of shown) {
    const id = s.repo ? s.repo.name : tildify(s.cwd)
    const p = out.get(id) ?? {
      id, count: 0,
      test: s.repo ? (x: Session) => x.repo?.name === id : (x: Session) => !x.repo && tildify(x.cwd) === id,
    }
    p.count++
    out.set(id, p)
  }
  return [...out.values()]
}

export function search(all: Session[], kind: KindId, query: string, ctx: SearchContext): ResultGroup[] {
  const q = query.trim()
  const ql = q.toLowerCase()
  const shown = byRecent(visible(all))
  const groups: ResultGroup[] = []
  const add = (label: string, results: Result[]) => {
    if (results.length) groups.push({ label, results })
  }
  const row = (s: Session, over?: Partial<Omit<SessionResult, 'type' | 'session'>>) => sessionRow(s, ctx.now, over)

  switch (kind) {
    case 'sessions':
      if (q === '' || q === '/') {
        add('Search kinds', KINDS.filter((k) => k.id !== 'sessions').map(kindRow))
        if (q === '') add('Recent', shown.slice(0, 3).map((s) => row(s)))
      } else {
        add('Sessions', shown.filter((s) => matches(s, q)).map((s) => row(s)))
        add('Search kinds', KINDS.filter((k) => k.id !== 'sessions' && (k.label.toLowerCase().includes(ql) || k.prefix.startsWith(ql))).map(kindRow))
      }
      break
    case 'ask':
      if (!q) add('Examples', kindById('ask').examples.map((e) => optionRow(e.slice(2), 'Ask', 'Bolt', { kind: 'ask', query: e.slice(2) })))
      else {
        const scored = shown.map((s) => ({ s, m: ask(s, q) })).filter((x) => x.m !== null)
        scored.sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
        add('Best matches', scored.map(({ s, m }) => row(s, { right: `${m?.pct}%`, reason: m?.reason ?? null })))
      }
      break
    case 'files': {
      const rows: Result[] = []
      for (const s of shown) {
        for (const f of s.files) {
          if (q && !f.path.toLowerCase().includes(ql)) continue
          rows.push(row(s, {
            key: `${s.id}:f:${f.path}`, icon: 'Document', iconColor: TERTIARY, title: baseName(f.path),
            sub: `${dirName(f.path)} · ${s.title}`, mono: true, right: `+${f.added}`, reason: `Changed ${f.path}`,
          }))
        }
      }
      add(q ? 'Files' : 'Recently changed files', rows.slice(0, 40))
      break
    }
    case 'artifacts': {
      const rows: Result[] = []
      for (const s of shown) {
        for (const a of s.artifacts) {
          if (q && !`${a.name} ${a.kind} ${a.path} ${tildify(a.path)} ${a.preview}`.toLowerCase().includes(ql)) continue
          const published = a.kind === PUBLISHED_KIND
          rows.push(row(s, {
            key: `${s.id}:a:${a.path}`, icon: 'Attachment2', iconColor: SECONDARY, title: a.name,
            sub: published ? `${a.kind} · ${s.title}` : `${a.kind} · ${fileSize(a.bytes)} · ${s.title}`,
            right: agoShort(s.end, ctx.now), reason: `${published ? 'Published' : 'Created'} ${tildify(a.path)}`, artifact: a,
          }))
        }
      }
      add(q ? 'Artifacts' : 'All artifacts', rows)
      break
    }
    case 'prs': {
      const rows: Result[] = []
      const qn = ql.replace(/^#/, '')
      const link = parsePrUrl(q)
      for (const s of shown) {
        for (const pr of s.prs) {
          const label = `${pr.repo}#${pr.number}`
          const hit = link
            ? pr.number === link.number && pr.repo.toLowerCase() === link.repo.toLowerCase()
            : !q || label.toLowerCase().includes(qn)
          if (hit) {
            rows.push(row(s, { key: `${s.id}:pr:${label}`, icon: 'Branch', iconColor: 'var(--app-green)', title: label, sub: s.title, right: `#${pr.number}`, reason: `Opened ${label}` }))
          }
        }
        if (!q || link) continue
        for (const c of s.commits) {
          if (!`${c.sha} ${c.msg}`.toLowerCase().includes(ql)) continue
          rows.push(row(s, { key: `${s.id}:c:${c.sha}`, icon: 'Code2', iconColor: TERTIARY, title: c.msg, sub: `${c.sha} · ${s.title}`, mono: true, reason: `Commit ${c.sha} ${c.msg}` }))
        }
      }
      add(q ? 'Matches' : 'Pull requests', rows)
      break
    }
    case 'in': {
      const ps = places(shown)
      const [first = '', ...rest] = q.split(/\s+/)
      const place = ps.find((p) => p.id.toLowerCase() === first.toLowerCase())
      if (place) add(`In ${place.id}`, shown.filter((s) => place.test(s) && matches(s, rest.join(' '))).map((s) => row(s)))
      else add('Repositories and folders', ps.filter((p) => !q || p.id.toLowerCase().includes(ql)).map((p) => optionRow(p.id, plural(p.count, 'session'), 'Box', { kind: 'in', query: `${p.id} ` })))
      break
    }
    case 'is':
    case 'when': {
      const opts: [string, Session[]][] =
        kind === 'is'
          ? [
              ...(['running', 'waiting', 'interrupted', 'failed', 'completed'] as const).map((st): [string, Session[]] => [st, shown.filter((s) => s.status === st)]),
              ['hidden', byRecent(all.filter((s) => s.hidden && !s.archived))],
              ['archived', byRecent(all.filter((s) => s.archived))],
            ]
          : [
              ['today', shown.filter((s) => daysAgo(s.end, ctx.now) === 0)],
              ['yesterday', shown.filter((s) => daysAgo(s.end, ctx.now) === 1)],
              ['week', shown.filter((s) => daysAgo(s.end, ctx.now) <= 7)],
            ]
      const label = kindById(kind).label
      const exact = opts.find(([name]) => name === ql)
      if (exact) add(`${label}: ${exact[0]}`, exact[1].map((s) => row(s)))
      else add(label, opts.filter(([name]) => !q || name.startsWith(ql)).map(([name, xs]) => optionRow(name, plural(xs.length, 'session'), kindById(kind).icon, { kind, query: name })))
      break
    }
    case 'actions':
      if (ctx.selected) add(`Actions on “${ctx.selected.title}”`, actionsFor(ctx.selected, ctx.settings).filter((r) => !q || r.title.toLowerCase().includes(ql)))
      break
    case 'terminal':
      add('Resume in', TERMINALS.filter((t) => !q || t.label.toLowerCase().includes(ql)).map((t): Result => ({
        type: 'terminal', terminal: t.id, key: `t:${t.id}`, icon: 'Code', iconColor: SECONDARY, title: t.label,
        sub: ctx.settings.terminal === t.id ? 'Current' : '', mono: false, right: '', keycap: '',
      })))
      break
    case 'rename':
      break
  }
  return groups
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = { ...SETTINGS_DEFAULTS, terminal: 'iterm' }
  const at = (d: number) => new Date(2026, 9, d, 9).toISOString()
  const live = makeSession({
    title: 'live-meeting', end: at(6), status: 'running', branch: 'live-meeting',
    prompts: ['Add a live meeting mode that shows the transcript while the meeting runs'],
    summary: { did: 'Streamed partial transcripts to the live view.', next: ['Finish speaker chips'] },
    files: [{ path: 'src/transcribe/diarize.ts', added: 141, removed: 52 }],
    commits: [{ sha: '4e9c1b7', msg: 'Stream partial transcripts to the live view', at: at(6) }],
    pr: { repo: 'alan-oliv/meetnotes', number: 27, url: 'https://github.com/alan-oliv/meetnotes/pull/27' },
    prs: [
      { repo: 'alan-oliv/meetnotes', number: 26, url: 'https://github.com/alan-oliv/meetnotes/pull/26' },
      { repo: 'alan-oliv/meetnotes', number: 27, url: 'https://github.com/alan-oliv/meetnotes/pull/27' },
    ],
    artifacts: [{ name: 'veracity-report.md', kind: 'markdown', path: '/Users/me/code/app/.claude/veracity-report.md', bytes: 9000, preview: '# Veracity report' }],
  })
  const team8 = makeSession({ title: 'perf pass', end: at(5), repo: { name: 'team8', root: '/Users/me/code/team8' }, cwd: '/Users/me/code/team8' })
  const folder = makeSession({ title: 'disk cleanup', end: at(1), repo: null, cwd: '/Users/me/code', status: 'interrupted' })
  const hidden = makeSession({ title: 'sdk run', hidden: true, end: at(6) })
  const archived = makeSession({ title: 'old thing', archived: true, end: at(6) })
  const all = [folder, team8, live, hidden, archived]
  const ctx = { now, selected: live, settings }
  const titles = (gs: ResultGroup[]) => gs.flatMap((g) => g.results.map((r) => r.title))

  it('turns a typed prefix into its kind, longest prefix first, ignoring case', () => {
    expect(detectKind('file:diarize')).toEqual({ kind: 'files', rest: 'diarize' })
    expect(detectKind('? where did I fix it')).toEqual({ kind: 'ask', rest: 'where did I fix it' })
    expect(detectKind('IS:running')).toEqual({ kind: 'is', rest: 'running' })
    expect(detectKind('>resume')).toEqual({ kind: 'actions', rest: 'resume' })
    expect(detectKind('transcript')).toBeNull()
  })
  it('shows the search kinds and the three newest sessions on empty input, and only kinds after a slash', () => {
    const empty = search(all, 'sessions', '', ctx)
    expect(empty.map((g) => g.label)).toEqual(['Search kinds', 'Recent'])
    expect(empty[0].results.map((r) => r.keycap)).toEqual(['?', 'file:', 'art:', 'pr:', 'in:', 'is:', 'when:', '>'])
    expect(empty[1].results.map((r) => r.title)).toEqual(['live-meeting', 'perf pass', 'disk cleanup'])
    expect(search(all, 'sessions', '/', ctx).map((g) => g.label)).toEqual(['Search kinds'])
  })
  it('matches every word across title, prompts, summary, paths, PR and commits, never hidden or archived', () => {
    expect(titles(search(all, 'sessions', 'speaker diarize', ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'sessions', 'meetnotes#27 4e9c1b7', ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'sessions', 'run', ctx))).not.toContain('sdk run')
    expect(titles(search(all, 'sessions', 'old thing', ctx))).toEqual([])
  })
  it('scores Ask queries by the share of meaningful words found and says why', () => {
    const r = ask(live, 'where did I fix the diarize transcript')
    expect(r).toEqual({ score: 1, pct: 94, reason: 'Changed src/transcribe/diarize.ts' })
    expect(ask(live, 'the a session')).toBeNull()
    expect(ask(live, 'kubernetes billing transcript')).toBeNull()
    const best = search(all, 'ask', 'live transcript', ctx)[0]
    expect(best.label).toBe('Best matches')
    expect(best.results[0]).toMatchObject({ title: 'live-meeting', right: '94%' })
  })
  it('lists one row per changed file with its folder, session and additions', () => {
    const [g] = search(all, 'files', 'diarize', ctx)
    expect(g.label).toBe('Files')
    expect(g.results[0]).toMatchObject({ type: 'session', title: 'diarize.ts', sub: 'src/transcribe · live-meeting', right: '+141', mono: true, reason: 'Changed src/transcribe/diarize.ts' })
  })
  it('finds artifacts by name, kind, path or content and carries them to the preview', () => {
    const [g] = search(all, 'artifacts', 'veracity', ctx)
    expect(g.results[0]).toMatchObject({ title: 'veracity-report.md', sub: 'markdown · 9KB · live-meeting' })
    expect(g.results[0].type === 'session' && g.results[0].artifact?.name).toBe('veracity-report.md')
  })
  it('finds PRs by number with or without # and commits by sha or message', () => {
    expect(titles(search(all, 'prs', '#27', ctx))).toEqual(['alan-oliv/meetnotes#27'])
    expect(titles(search(all, 'prs', '4e9c', ctx))).toEqual(['Stream partial transcripts to the live view'])
    expect(search(all, 'prs', '', ctx)[0].label).toBe('Pull requests')
  })
  it('finds the session behind a pasted GitHub PR link, including an earlier PR it opened', () => {
    expect(titles(search(all, 'prs', 'https://github.com/alan-oliv/meetnotes/pull/26', ctx))).toEqual(['alan-oliv/meetnotes#26'])
    expect(titles(search(all, 'prs', 'github.com/Alan-Oliv/meetnotes/pull/27/files?w=1', ctx))).toEqual(['alan-oliv/meetnotes#27'])
    expect(titles(search(all, 'prs', 'https://github.com/alan-oliv/other/pull/27', ctx))).toEqual([])
    expect(search(all, 'prs', 'https://github.com/alan-oliv/meetnotes/pull/26', ctx)[0].results[0]).toMatchObject({ type: 'session', session: { id: live.id } })
    expect(titles(search(all, 'sessions', 'https://github.com/alan-oliv/meetnotes/pull/26', ctx))).toEqual(['live-meeting'])
    expect(parsePrUrl('see https://github.com/a/b/pull/31')).toBeNull()
    expect(parsePrUrl('  https://github.com/a/b/pull/31#discussion  ')).toEqual({ repo: 'a/b', number: 31 })
  })
  it('finds the session behind a pasted claude.ai artifact link, in plain search and art:', () => {
    const url = 'https://claude.ai/artifact/Zq7Fake9ArtifactId00'
    const pub = makeSession({ title: 'architecture diagram', end: at(4), artifacts: [{ name: 'Meetnotes architecture', kind: 'claude.ai', path: url, bytes: 0, preview: '' }] })
    const xs = [...all, pub]
    expect(titles(search(xs, 'sessions', url, ctx))).toEqual(['architecture diagram'])
    expect(search(xs, 'artifacts', url, ctx)[0].results[0]).toMatchObject({
      title: 'Meetnotes architecture', sub: 'claude.ai · architecture diagram', reason: `Published ${url}`,
    })
  })
  it('finds the session behind a pasted ~/ path or file:// link to a file it wrote', () => {
    const tilde = '~/code/app/.claude/veracity-report.md'
    expect(titles(search(all, 'sessions', tilde, ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'artifacts', tilde, ctx))).toEqual(['veracity-report.md'])
    expect(detectKind('file:///Users/me/code/app/.claude/veracity%20report.md')).toEqual({ kind: 'sessions', rest: '/Users/me/code/app/.claude/veracity report.md' })
    expect(detectKind('file:diarize')).toEqual({ kind: 'files', rest: 'diarize' })
  })
  it('suggests places until the first word names one, then searches inside it', () => {
    expect(titles(search(all, 'in', '', ctx))).toEqual(['app', 'team8', '~/code'])
    const inside = search(all, 'in', 'team8 perf', ctx)
    expect(inside[0].label).toBe('In team8')
    expect(titles(inside)).toEqual(['perf pass'])
    expect(search(all, 'in', 'te', ctx)[0].results[0]).toMatchObject({ type: 'option', fill: { kind: 'in', query: 'team8 ' } })
  })
  it('offers statuses with counts and reaches hidden and archived sessions only through is:', () => {
    const opts = search(all, 'is', '', ctx)[0].results
    expect(opts.map((r) => `${r.title} ${r.sub}`)).toEqual([
      'running 1 session', 'waiting 0 sessions', 'interrupted 1 session', 'failed 0 sessions',
      'completed 1 session', 'hidden 1 session', 'archived 1 session',
    ])
    expect(titles(search(all, 'is', 'hidden', ctx))).toEqual(['sdk run'])
    expect(titles(search(all, 'is', 'archived', ctx))).toEqual(['old thing'])
  })
  it('filters by today, yesterday and the last week', () => {
    expect(titles(search(all, 'when', 'today', ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'when', 'yesterday', ctx))).toEqual(['perf pass'])
    expect(titles(search(all, 'when', 'week', ctx))).toEqual(['live-meeting', 'perf pass', 'disk cleanup'])
  })
  it('lists actions for the selected session, with PR actions only when it has a PR', () => {
    const acts = search(all, 'actions', '', ctx)[0]
    expect(acts.label).toBe('Actions on “live-meeting”')
    expect(acts.results.map((r) => r.title)).toEqual([
      'Resume', 'Copy resume command', 'Fork into a new session', 'Open folder', 'Open PR alan-oliv/meetnotes#27',
      'All sessions for PR #27', 'Show app in the tree', 'Rename session', 'Archive session', 'Change terminal', 'Show plan usage',
    ])
    expect(acts.results[2]).toMatchObject({ type: 'action', action: 'fork', detail: `claude --resume ${live.id} --fork-session` })
    expect(titles(search(all, 'actions', 'open', { ...ctx, selected: folder }))).toEqual(['Open folder'])
    expect(search(all, 'actions', '', { ...ctx, selected: null })).toEqual([])
  })
  it('offers every terminal and marks the current one', () => {
    const rows = search(all, 'terminal', '', ctx)[0].results
    expect(rows.map((r) => [r.title, r.sub])).toEqual([['Terminal', ''], ['iTerm2', 'Current'], ['Ghostty', ''], ['Warp', ''], ['WezTerm', ''], ['VS Code', '']])
  })
}

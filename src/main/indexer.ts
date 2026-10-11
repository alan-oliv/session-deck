import {
  appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  statSync, watch, writeFileSync, type FSWatcher,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { SETTINGS_DEFAULTS, type Session, type Settings, type Status } from '../shared/api'
import { resolveGit, type GitInfo } from './git'
import { tailLines } from './lines'
import { readLive, readTee, type LiveInfo, type TeeInfo } from './live'
import { PATHS } from './paths'
import { writeJsonAtomic } from './settings'
import { emptyAgg, finalize, reduceLine, type Agg, type Facts } from './transcript'

// Bump whenever transcript.ts changes what it extracts, so every file is reparsed.
export const CACHE_VERSION = 5
const DAY_MS = 86_400_000
const DEBOUNCE_MS = 300
// The cache can be tens of MB; write it at most this often, and on stop().
const SAVE_EVERY_MS = 15_000

interface FileEntry { size: number; mtimeMs: number; offset: number; agg: Agg; agents: number }
interface Cache { version: number; files: Record<string, FileEntry>; git: Record<string, GitInfo> }

export interface IndexerOptions {
  projectsDir: string
  sessionsDir: string
  teeDir: string
  cachePath: string
  claudeSettingsPath: string
  getSettings(): Settings
  onChange(): void
}

export interface Indexer {
  start(): Promise<void>
  refresh(): Promise<void>
  list(): Session[]
  get(id: string): Session | undefined
  transcriptPath(id: string): string | undefined
  notify(): void
  stop(): void
}

export interface SessionContext {
  git: GitInfo | undefined
  live: LiveInfo | undefined
  tee: TeeInfo | undefined
  archived: boolean
  forks: number
  sizeBytes: number
  agents: number
  cleanupDays: number
}

export function contextMaxFor(model: string | null, used: number, teeMax: number | null): number {
  if (teeMax && teeMax > 0) return teeMax
  // ponytail: model-name heuristic; the tee's context_window_size replaces it for live sessions.
  const big = !!model && (/^claude-(opus|sonnet|fable)-5/.test(model) || model.includes('[1m]'))
  const max = big ? 1_000_000 : 200_000
  return used > max ? 1_000_000 : max
}

export function readCleanupDays(path: string): number {
  try {
    const n = Number(JSON.parse(readFileSync(path, 'utf8')).cleanupPeriodDays)
    return Number.isFinite(n) && n > 0 ? n : 30
  } catch {
    return 30
  }
}

function statusOf(f: Facts, live: LiveInfo | undefined): Status {
  // Claude Code reports busy, waiting (blocked on a prompt or permission) or idle; idle is just an open terminal.
  if (live?.status === 'busy') return 'running'
  if (live?.status === 'waiting') return 'waiting'
  if (f.lastEvent === 'interrupt') return 'interrupted'
  if (f.lastEvent === 'apiError') return 'failed'
  return 'completed'
}

export function toSession(f: Facts, x: SessionContext): Session {
  const root = x.git?.repoRoot ?? null
  const bases = [x.git?.worktree?.path, root, f.cwd].filter((b): b is string => !!b)
  const rel = (p: string) => {
    const base = bases.find((b) => p.startsWith(`${b}/`))
    return base ? p.slice(base.length + 1) : p
  }
  const t = f.tokens
  const contextUsed = (x.live && x.tee?.contextUsed) || f.context
  const hitBase = t.input + t.cacheRead + t.cacheWrite
  return {
    id: f.id,
    title: f.title,
    named: f.named,
    cwd: f.cwd,
    cwdExists: !x.git?.removedSeen,
    hidden: f.hidden,
    archived: x.archived,
    repo: root ? { name: basename(root), root, remote: x.git?.remote ?? null } : null,
    branch: f.branch,
    worktree: x.git?.worktree ? { ...x.git.worktree, removedSeen: x.git.removedSeen } : null,
    start: f.start,
    end: f.end,
    sizeBytes: x.sizeBytes,
    keptUntil: new Date(Date.parse(f.end) + x.cleanupDays * DAY_MS).toISOString(),
    model: f.model,
    effort: f.effort,
    permissionMode: f.permissionMode,
    status: statusOf(f, x.live),
    live: !!x.live,
    pr: f.pr,
    prs: f.prs,
    forkedFrom: f.forkedFrom,
    forks: x.forks,
    prompts: f.prompts,
    summary: f.summary,
    files: f.files.map((c) => ({ ...c, path: rel(c.path) })),
    commits: f.commits,
    // Absolute on purpose: the command bar's artifact preview shows the full path.
    artifacts: f.artifacts,
    usage: {
      contextUsed,
      contextMax: contextMaxFor(f.model, contextUsed, x.tee?.contextMax ?? null),
      input: t.input,
      output: t.output,
      total: t.input + t.output + t.cacheRead + t.cacheWrite,
      cacheRead: t.cacheRead,
      cacheWrite: t.cacheWrite,
      cacheHitPct: hitBase > 0 ? Math.round((t.cacheRead / hitBase) * 1000) / 10 : 0,
      cost: f.cost,
      durationMs: f.durationMs,
      linesAdded: f.linesAdded,
      linesRemoved: f.linesRemoved,
      compactions: f.compactions,
      agents: x.agents,
      outputStyle: x.tee?.outputStyle ?? null,
      plan: x.live ? (x.tee?.plan ?? null) : null,
    },
  }
}

function loadCache(path: string): Cache {
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'))
    if (c?.version === CACHE_VERSION && c.files && c.git) return c as Cache
  } catch {
    // Missing or corrupt cache: rebuild from scratch.
  }
  return { version: CACHE_VERSION, files: {}, git: {} }
}

function listTranscripts(projectsDir: string): string[] {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  return dirs.flatMap((d) => {
    try {
      return readdirSync(join(projectsDir, d)).filter((n) => n.endsWith('.jsonl')).map((n) => join(projectsDir, d, n))
    } catch {
      return []
    }
  })
}

function countAgents(transcript: string): number {
  try {
    return readdirSync(join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents')).filter((n) => n.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}

export function createIndexer(o: IndexerOptions): Indexer {
  const cache = loadCache(o.cachePath)
  const watchers: FSWatcher[] = []
  let scanning: Promise<void> | null = null
  let dirty = false
  let scanTimer: NodeJS.Timeout | null = null
  let notifyTimer: NodeJS.Timeout | null = null
  let saveTimer: NodeJS.Timeout | null = null
  let byId = new Map<string, Session>()
  let pathById = new Map<string, string>()

  const save = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    try {
      writeJsonAtomic(o.cachePath, cache)
    } catch (e) {
      console.warn('[indexer] could not save cache', e)
    }
  }
  const scheduleSave = () => {
    saveTimer ??= setTimeout(save, SAVE_EVERY_MS)
  }

  function rebuild(): Session[] {
    const live = readLive(o.sessionsDir)
    const tee = readTee(o.teeDir)
    const archived = new Set(o.getSettings().archived)
    const cleanupDays = readCleanupDays(o.claudeSettingsPath)
    const rows: { f: Facts; path: string; entry: FileEntry }[] = []
    for (const [path, entry] of Object.entries(cache.files)) {
      const f = finalize(entry.agg)
      if (f) rows.push({ f, path, entry })
    }
    const forks = new Map<string, number>()
    for (const { f } of rows) if (f.forkedFrom) forks.set(f.forkedFrom, (forks.get(f.forkedFrom) ?? 0) + 1)
    const sessions = rows.map(({ f, entry }) =>
      toSession(f, {
        git: cache.git[f.cwd], live: live.get(f.id), tee: tee.get(f.id), archived: archived.has(f.id),
        forks: forks.get(f.id) ?? 0, sizeBytes: entry.size, agents: entry.agents, cleanupDays,
      }),
    )
    byId = new Map(sessions.map((s) => [s.id, s]))
    pathById = new Map(rows.map(({ f, path }) => [f.id, path]))
    return sessions
  }

  async function scanOnce(): Promise<void> {
    const files = listTranscripts(o.projectsDir)
    const present = new Set(files)
    for (const p of Object.keys(cache.files)) if (!present.has(p)) delete cache.files[p]
    let parsed = 0
    for (const path of files) {
      const st = statSync(path, { throwIfNoEntry: false })
      if (!st) continue
      let entry = cache.files[path]
      if (entry && entry.size === st.size && entry.mtimeMs === st.mtimeMs) continue
      // ponytail: assumes append-only; a same-size-or-larger rewrite would be misread until CACHE_VERSION bumps.
      if (!entry || st.size < entry.offset) {
        entry = { size: 0, mtimeMs: 0, offset: 0, agg: emptyAgg(basename(path, '.jsonl')), agents: 0 }
        cache.files[path] = entry
      }
      try {
        await tailLines(path, entry.offset, (line, next) => {
          reduceLine(entry.agg, line)
          entry.offset = next
        })
      } catch (e) {
        console.warn('[indexer] skipped unreadable transcript', path, e)
        continue
      }
      entry.size = st.size
      entry.mtimeMs = st.mtimeMs
      entry.agents = countAgents(path)
      if (++parsed % 50 === 0) o.onChange()
    }
    const now = new Date().toISOString()
    const cwds = new Set(Object.values(cache.files).map((e) => e.agg.cwd).filter((c): c is string => !!c))
    for (const cwd of cwds) {
      try {
        cache.git[cwd] = resolveGit(cwd, cache.git[cwd], now)
      } catch (e) {
        console.warn('[indexer] could not resolve git for', cwd, e)
      }
    }
    scheduleSave()
    o.onChange()
  }

  function refresh(): Promise<void> {
    if (scanning) {
      dirty = true
      return scanning
    }
    scanning = (async () => {
      do {
        dirty = false
        await scanOnce()
      } while (dirty)
    })().finally(() => {
      scanning = null
    })
    return scanning
  }

  const scheduleScan = () => {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => {
      scanTimer = null
      void refresh()
    }, DEBOUNCE_MS)
  }
  const notify = () => {
    if (notifyTimer) clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      o.onChange()
    }, DEBOUNCE_MS)
  }
  const watchDir = (dir: string, onFile: (file: string) => void) => {
    if (!existsSync(dir)) return
    try {
      watchers.push(watch(dir, { recursive: true }, (_event, file) => onFile(String(file ?? ''))))
    } catch (e) {
      console.warn('[indexer] cannot watch', dir, e)
    }
  }

  return {
    async start() {
      mkdirSync(o.teeDir, { recursive: true })
      // Only top-level <project>/<id>.jsonl; subagent transcripts live one level deeper.
      watchDir(o.projectsDir, (file) => {
        if (file.endsWith('.jsonl') && file.split('/').length === 2) scheduleScan()
      })
      watchDir(o.sessionsDir, (file) => {
        if (file.endsWith('.json')) notify()
      })
      watchDir(o.teeDir, (file) => {
        if (file.endsWith('.json')) notify()
      })
      await refresh()
    },
    refresh,
    list: () => rebuild(),
    get(id) {
      rebuild()
      return byId.get(id)
    },
    transcriptPath(id) {
      if (!pathById.has(id)) rebuild()
      return pathById.get(id)
    },
    notify,
    stop() {
      for (const w of watchers) w.close()
      watchers.length = 0
      for (const t of [scanTimer, notifyTimer]) if (t) clearTimeout(t)
      save()
    },
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const child = '711a48a0-fc93-44b8-b71c-1c6e5b645970'
  const facts = (over: Partial<Facts> = {}): Facts => ({
    id, title: 't', named: false, cwd: '/r/app/src', branch: 'main', hidden: false,
    start: '2026-10-06T09:00:00.000Z', end: '2026-10-06T10:00:00.000Z', model: 'claude-opus-5-5', effort: 'high',
    permissionMode: 'default', pr: null, prs: [], forkedFrom: null, prompts: [], summary: null,
    files: [{ path: '/r/app/src/a.ts', added: 1, removed: 0 }, { path: '/tmp/x.md', added: 2, removed: 0 }],
    commits: [], artifacts: [], lastEvent: 'normal',
    tokens: { input: 10, output: 5, cacheRead: 980, cacheWrite: 10 }, context: 1000, compactions: 0,
    cost: 1.5, durationMs: 60_000, linesAdded: 3, linesRemoved: 0, ...over,
  })
  const ctx = (over: Partial<SessionContext> = {}): SessionContext => ({
    git: { repoRoot: '/r/app', worktree: null, remote: null, removedSeen: null }, live: undefined, tee: undefined,
    archived: false, forks: 0, sizeBytes: 6_100_000, agents: 3, cleanupDays: 30, ...over,
  })

  it('derives the session status from live state first, then from the last turn', () => {
    expect(toSession(facts(), ctx({ live: { status: 'busy' } })).status).toBe('running')
    expect(toSession(facts(), ctx({ live: { status: 'waiting' } })).status).toBe('waiting')
    expect(toSession(facts(), ctx({ live: { status: 'idle' } })).status).toBe('completed')
    expect(toSession(facts({ lastEvent: 'interrupt' }), ctx({ live: { status: 'idle' } })).status).toBe('interrupted')
    expect(toSession(facts({ lastEvent: 'interrupt' }), ctx()).status).toBe('interrupted')
    expect(toSession(facts({ lastEvent: 'apiError' }), ctx()).status).toBe('failed')
    expect(toSession(facts(), ctx()).status).toBe('completed')
  })
  it('names the repo after its root and shows changed files relative to it', () => {
    const s = toSession(facts(), ctx())
    expect(s.repo).toEqual({ name: 'app', root: '/r/app', remote: null })
    expect(s.files.map((f) => f.path)).toEqual(['src/a.ts', '/tmp/x.md'])
  })
  it('marks a removed cwd and carries the removal stamp onto the worktree', () => {
    const s = toSession(facts(), ctx({ git: { repoRoot: '/r/app', worktree: { name: 'feat', path: '/r/app/.worktrees/feat' }, remote: null, removedSeen: '2026-10-02T00:00:00.000Z' } }))
    expect(s.cwdExists).toBe(false)
    expect(s.worktree).toEqual({ name: 'feat', path: '/r/app/.worktrees/feat', removedSeen: '2026-10-02T00:00:00.000Z' })
  })
  it('keeps a session until the cleanup period after its last activity', () => {
    expect(toSession(facts(), ctx({ cleanupDays: 30 })).keptUntil).toBe('2026-11-05T10:00:00.000Z')
  })
  it('shows plan usage only while the session is live', () => {
    const tee = { contextUsed: 263_000, contextMax: 1_000_000, outputStyle: 'architecture', plan: { usedPct: 32.9, resetsAt: '2026-10-06T14:00:00.000Z' } }
    expect(toSession(facts(), ctx({ tee })).usage.plan).toBeNull()
    const live = toSession(facts(), ctx({ tee, live: { status: 'busy' } })).usage
    expect(live).toMatchObject({ plan: tee.plan, contextUsed: 263_000, contextMax: 1_000_000, outputStyle: 'architecture' })
  })
  it('computes totals and the cache hit share from tokens', () => {
    const u = toSession(facts(), ctx()).usage
    expect(u).toMatchObject({ total: 1005, cacheHitPct: 98, contextUsed: 1000, agents: 3, cost: 1.5 })
  })
  it('picks the context window from the tee, then the model, then the usage', () => {
    expect(contextMaxFor('claude-sonnet-4-5', 10, 400_000)).toBe(400_000)
    expect(contextMaxFor('claude-opus-5-5', 10, null)).toBe(1_000_000)
    expect(contextMaxFor('claude-haiku-4-5-20251001', 10, null)).toBe(200_000)
    expect(contextMaxFor('claude-haiku-4-5-20251001', 300_000, null)).toBe(1_000_000)
  })
  it('reads the cleanup period from Claude settings, defaulting to 30 days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-cleanup-'))
    writeFileSync(join(dir, 's.json'), JSON.stringify({ cleanupPeriodDays: 14 }))
    expect(readCleanupDays(join(dir, 's.json'))).toBe(14)
    expect(readCleanupDays(join(dir, 'missing.json'))).toBe(30)
  })

  const line = (o: object) => `${JSON.stringify({ sessionId: id, cwd: '/r/app', entrypoint: 'cli', ...o })}\n`
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-index-'))
    const projects = join(dir, 'projects')
    mkdirSync(join(projects, '-r-app', id, 'subagents'), { recursive: true })
    writeFileSync(join(projects, '-r-app', id, 'subagents', 'agent-1.jsonl'), '')
    const file = join(projects, '-r-app', `${id}.jsonl`)
    writeFileSync(file, line({ type: 'user', timestamp: '2026-10-06T09:00:00.000Z', message: { content: 'first prompt' } }))
    writeFileSync(join(projects, '-r-app', `${child}.jsonl`),
      line({ type: 'attachment', sessionId: child, forkedFrom: { sessionId: id }, timestamp: '2026-10-06T11:00:00.000Z' }) +
      line({ type: 'user', sessionId: child, timestamp: '2026-10-06T11:00:00.000Z', message: { content: 'forked' } }))
    const opts = {
      projectsDir: projects, sessionsDir: join(dir, 'sessions'), teeDir: join(dir, 'tee'), cachePath: join(dir, 'index.json'),
      claudeSettingsPath: join(dir, 'settings.json'), getSettings: () => ({ ...SETTINGS_DEFAULTS, archived: [child] }),
      onChange: () => {},
    }
    return { file, opts }
  }

  it('indexes transcripts, counts forks and subagents, and marks archived sessions', async () => {
    const { opts } = fixture()
    const idx = createIndexer(opts)
    await idx.refresh()
    const s = idx.get(id)
    expect(s).toMatchObject({ title: 'first prompt', forks: 1, archived: false })
    expect(s?.usage.agents).toBe(1)
    expect(idx.get(child)?.archived).toBe(true)
    idx.stop()
  })
  it('parses only appended lines, and starts over when a transcript shrinks', async () => {
    const { file, opts } = fixture()
    const idx = createIndexer(opts)
    await idx.refresh()
    appendFileSync(file, line({ type: 'custom-title', customTitle: 'renamed' }))
    await idx.refresh()
    expect(idx.get(id)?.title).toBe('renamed')
    writeFileSync(file, line({ type: 'user', timestamp: '2026-10-06T09:00:00.000Z', message: { content: 'fresh' } }))
    await idx.refresh()
    expect(idx.get(id)?.title).toBe('fresh')
    idx.stop()
  })
  it('reloads the saved cache without reparsing unchanged files', async () => {
    const { opts } = fixture()
    const a = createIndexer(opts)
    await a.refresh()
    a.stop()
    const b = createIndexer(opts)
    expect(b.get(id)?.title).toBe('first prompt')
    b.stop()
  })
  it('keeps indexing when a folder cannot be read for git info', async () => {
    const { opts } = fixture()
    const locked = join(dirname(opts.projectsDir), 'locked')
    mkdirSync(locked)
    writeFileSync(join(locked, '.git'), 'gitdir: /nowhere\n')
    chmodSync(join(locked, '.git'), 0o000)
    const other = '00000000-0000-4000-8000-000000000000'
    writeFileSync(join(opts.projectsDir, '-r-app', `${other}.jsonl`),
      line({ type: 'user', sessionId: other, cwd: locked, timestamp: '2026-10-06T12:00:00.000Z', message: { content: 'locked' } }))
    const idx = createIndexer(opts)
    await idx.refresh()
    expect(idx.get(other)).toMatchObject({ title: 'locked', repo: null })
    expect(idx.get(id)?.title).toBe('first prompt')
    idx.stop()
  })
  it.skipIf(!process.env.SESSION_DECK_SMOKE)('indexes the real ~/.claude/projects twice, the second time from cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-smoke-'))
    const opts = {
      projectsDir: PATHS.projects, sessionsDir: PATHS.sessions, teeDir: join(dir, 'tee'), cachePath: join(dir, 'index.json'),
      claudeSettingsPath: PATHS.claudeSettings, getSettings: () => SETTINGS_DEFAULTS, onChange: () => {},
    }
    let t = Date.now()
    const first = createIndexer(opts)
    await first.refresh()
    const list = first.list()
    const coldMs = Date.now() - t
    first.stop()
    t = Date.now()
    const second = createIndexer(opts)
    await second.refresh()
    const warmMs = Date.now() - t
    const repos = new Set(list.map((s) => s.repo?.name).filter(Boolean))
    console.log(`sessions=${list.length} hidden=${list.filter((s) => s.hidden).length} repos=${repos.size} named=${list.filter((s) => s.named).length} withPr=${list.filter((s) => s.pr).length} withSummary=${list.filter((s) => s.summary).length} cold=${coldMs}ms warm=${warmMs}ms`)
    expect(list.length).toBeGreaterThan(0)
    expect(second.list().length).toBe(list.length)
    second.stop()
  }, 300_000)
}

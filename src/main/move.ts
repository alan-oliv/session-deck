import { spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { canMove, MOVE_BLOCKED, SETTINGS_DEFAULTS, type Session } from '../shared/api'
import { createIndexer } from './indexer'
import { PATHS } from './paths'

// Claude Code 2.1 appends a hash we can't reproduce to slugs past this length, so those folders are refused.
const MAX_SLUG = 200
export const TOO_LONG = "This folder's path is too long to move sessions into"

export function projectSlug(path: string): string | null {
  const slug = path.replace(/[^a-zA-Z0-9]/g, '-')
  return slug.length <= MAX_SLUG ? slug : null
}

// `/resume` checks the recorded cwd, so every line gets the new one. A cwd nested in tool input is history and stays.
export function retargetLine(line: string, cwd: string): string {
  let r: unknown
  try {
    r = JSON.parse(line)
  } catch {
    return line
  }
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof (r as { cwd?: unknown }).cwd !== 'string') return line
  return JSON.stringify({ ...r, cwd })
}

export function moveTranscript(projectsDir: string, from: string, id: string, cwd: string): void {
  const slug = projectSlug(cwd)
  if (!slug) throw new Error(TOO_LONG)
  const dir = join(projectsDir, slug)
  const dest = join(dir, `${id}.jsonl`)
  const sidecar = join(dirname(from), id)
  // Two paths can share a slug; then the file stays where it is and only its cwd changes.
  const inPlace = dest === from
  if (!inPlace && (existsSync(dest) || existsSync(join(dir, id)))) throw new Error(`This session is already in ${cwd}`)
  mkdirSync(dir, { recursive: true })
  const text = readFileSync(from, 'utf8')
  writeFileSync(`${dest}.tmp`, text.split('\n').map((l) => retargetLine(l, cwd)).join('\n'), { mode: statSync(from).mode & 0o777 })
  renameSync(`${dest}.tmp`, dest)
  if (inPlace) return
  try {
    if (existsSync(sidecar)) renameSync(sidecar, join(dir, id))
  } catch (e) {
    unlinkSync(dest)
    throw e
  }
  unlinkSync(from)
}

// Any existing folder, not only sidebar projects: Undo sends sessions back to a worktree or a subfolder.
export function checkMoveTarget(raw: unknown): string {
  if (typeof raw !== 'string' || !isAbsolute(raw) || /[\x00-\x1f\x7f]/.test(raw)) throw new Error('Invalid folder')
  const cwd = resolve(raw)
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error('This folder no longer exists')
  if (!projectSlug(cwd)) throw new Error(TOO_LONG)
  return cwd
}

export function moveSessionsTo(projectsDir: string, sessions: Pick<Session, 'id' | 'cwd' | 'live'>[], cwd: string, pathOf: (id: string) => string | undefined): void {
  if (!sessions.every(canMove)) throw new Error(MOVE_BLOCKED)
  const todo = sessions.filter((s) => s.cwd !== cwd)
  todo.forEach((s, i) => {
    try {
      const from = pathOf(s.id)
      if (!from) throw new Error('Unknown session')
      moveTranscript(projectsDir, from, s.id, cwd)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      throw new Error(i ? `Moved ${i} of ${todo.length} sessions. ${why}` : why)
    }
  })
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const line = (o: object) => JSON.stringify({ sessionId: id, cwd: '/r/old', entrypoint: 'cli', ...o })
  const fixture = (slug = '-r-old') => {
    const root = mkdtempSync(join(tmpdir(), 'deck-move-'))
    const projects = join(root, 'projects')
    mkdirSync(join(projects, slug, id, 'subagents'), { recursive: true })
    writeFileSync(join(projects, slug, id, 'subagents', 'agent-1.jsonl'), '')
    const from = join(projects, slug, `${id}.jsonl`)
    writeFileSync(from, `${line({ type: 'user', timestamp: '2026-10-06T09:00:00.000Z', message: { content: 'first prompt' } })}\n${line({ type: 'assistant', timestamp: '2026-10-06T09:01:00.000Z' })}\n`, { mode: 0o600 })
    return { root, projects, from }
  }
  const cwds = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).cwd)

  it("builds Claude Code's project slug and refuses paths it would hash", () => {
    expect(projectSlug('/Users/me/code/app')).toBe('-Users-me-code-app')
    expect(projectSlug('/Users/me/.play-by-eye/my_app v2')).toBe('-Users-me--play-by-eye-my-app-v2')
    expect(projectSlug(`/${'a'.repeat(199)}`)).toHaveLength(200)
    expect(projectSlug(`/${'a'.repeat(200)}`)).toBeNull()
  })
  it('rewrites only the top-level cwd, keeping key order and nested cwds', () => {
    const before = JSON.stringify({ type: 'user', cwd: '/r/old', message: { content: 'x' }, toolUseResult: { cwd: '/r/old' } })
    const after = JSON.parse(retargetLine(before, '/r/new'))
    expect(after).toEqual({ type: 'user', cwd: '/r/new', message: { content: 'x' }, toolUseResult: { cwd: '/r/old' } })
    expect(Object.keys(after)).toEqual(['type', 'cwd', 'message', 'toolUseResult'])
  })
  it('leaves blank, cut-off, non-object and cwd-less lines exactly as they were', () => {
    for (const l of ['', '{"type":"user","cwd":"/r/ol', '[1,2]', 'null', '{"type":"summary"}', '{"cwd":42}']) expect(retargetLine(l, '/r/new')).toBe(l)
  })
  it('moves the transcript and its sidecar folder, rewriting every cwd, and deletes the original', () => {
    const { projects, from } = fixture()
    moveTranscript(projects, from, id, '/r/new')
    const dest = join(projects, '-r-new', `${id}.jsonl`)
    expect(cwds(dest)).toEqual(['/r/new', '/r/new'])
    expect(readFileSync(dest, 'utf8').endsWith('\n')).toBe(true)
    expect(statSync(dest).mode & 0o777).toBe(0o600)
    expect(existsSync(join(projects, '-r-new', id, 'subagents', 'agent-1.jsonl'))).toBe(true)
    expect(readdirSync(join(projects, '-r-new')).sort()).toEqual([id, `${id}.jsonl`].sort())
    expect(existsSync(from)).toBe(false)
    expect(existsSync(join(projects, '-r-old', id))).toBe(false)
  })
  it('refuses a folder that already holds the session and leaves the original alone', () => {
    const { projects, from } = fixture()
    mkdirSync(join(projects, '-r-new'))
    writeFileSync(join(projects, '-r-new', `${id}.jsonl`), '')
    expect(() => moveTranscript(projects, from, id, '/r/new')).toThrow(/already/)
    expect(cwds(from)).toEqual(['/r/old', '/r/old'])
  })
  it('refuses a folder whose slug Claude Code would hash', () => {
    const { projects, from } = fixture()
    expect(() => moveTranscript(projects, from, id, `/${'a'.repeat(200)}`)).toThrow(TOO_LONG)
    expect(existsSync(from)).toBe(true)
  })
  it("rewrites in place when the new folder shares the old one's slug", () => {
    const { projects, from } = fixture('-r-my-app')
    moveTranscript(projects, from, id, '/r/my.app')
    expect(cwds(from)).toEqual(['/r/my.app', '/r/my.app'])
    expect(existsSync(join(projects, '-r-my-app', id, 'subagents'))).toBe(true)
    expect(readdirSync(join(projects, '-r-my-app')).sort()).toEqual([id, `${id}.jsonl`].sort())
  })
  it('removes the new copy and keeps the original when the sidecar cannot be moved', () => {
    const { projects, from } = fixture()
    chmodSync(dirname(from), 0o500)
    try {
      expect(() => moveTranscript(projects, from, id, '/r/new')).toThrow()
    } finally {
      chmodSync(dirname(from), 0o700)
    }
    expect(existsSync(join(projects, '-r-new', `${id}.jsonl`))).toBe(false)
    expect(cwds(from)).toEqual(['/r/old', '/r/old'])
  })
  it('shows the moved session under its new folder after an indexer refresh', async () => {
    const { root, projects, from } = fixture()
    const idx = createIndexer({
      projectsDir: projects, sessionsDir: join(root, 'sessions'), teeDir: join(root, 'tee'), cachePath: join(root, 'index.json'),
      claudeSettingsPath: join(root, 'settings.json'), getSettings: () => SETTINGS_DEFAULTS, onChange: () => {},
    })
    await idx.refresh()
    expect(idx.get(id)?.cwd).toBe('/r/old')
    moveTranscript(projects, from, id, '/r/new')
    await idx.refresh()
    expect(idx.get(id)).toMatchObject({ cwd: '/r/new', title: 'first prompt' })
    expect(idx.list()).toHaveLength(1)
    idx.stop()
  })

  const other = '711a48a0-fc93-44b8-b71c-1c6e5b645970'

  it('accepts an existing absolute folder and resolves it', () => {
    const { root } = fixture()
    expect(checkMoveTarget(`${root}/`)).toBe(root)
    expect(checkMoveTarget(`${root}/projects/..`)).toBe(root)
  })
  it('refuses relative paths, control characters, missing folders, files and paths Claude Code would hash', () => {
    const { root, from } = fixture()
    expect(() => checkMoveTarget('code/app')).toThrow('Invalid folder')
    expect(() => checkMoveTarget(42)).toThrow('Invalid folder')
    expect(() => checkMoveTarget(`${root}/x\x15y`)).toThrow('Invalid folder')
    expect(() => checkMoveTarget(join(root, 'gone'))).toThrow('This folder no longer exists')
    expect(() => checkMoveTarget(from)).toThrow('This folder no longer exists')
    const long = join(root, 'a'.repeat(200))
    mkdirSync(long)
    expect(() => checkMoveTarget(long)).toThrow(TOO_LONG)
  })
  it('moves nothing when any session in the batch is running', () => {
    const { projects, from } = fixture()
    const sessions = [{ id, cwd: '/r/old', live: false }, { id: other, cwd: '/r/old', live: true }]
    expect(() => moveSessionsTo(projects, sessions, '/r/new', () => from)).toThrow(MOVE_BLOCKED)
    expect(cwds(from)).toEqual(['/r/old', '/r/old'])
  })
  it('skips sessions already in the folder and moves the rest', () => {
    const { projects, from } = fixture()
    const seen: string[] = []
    moveSessionsTo(projects, [{ id: other, cwd: '/r/new', live: false }, { id, cwd: '/r/old', live: false }], '/r/new', (x) => {
      seen.push(x)
      return from
    })
    expect(seen).toEqual([id])
    expect(cwds(join(projects, '-r-new', `${id}.jsonl`))).toEqual(['/r/new', '/r/new'])
  })
  it('says how many sessions moved before one failed', () => {
    const { projects, from } = fixture()
    const sessions = [{ id, cwd: '/r/old', live: false }, { id: other, cwd: '/r/old', live: false }]
    expect(() => moveSessionsTo(projects, sessions, '/r/new', (x) => (x === id ? from : undefined))).toThrow('Moved 1 of 2 sessions. Unknown session')
    expect(existsSync(join(projects, '-r-new', `${id}.jsonl`))).toBe(true)
    expect(() => moveSessionsTo(projects, [{ id: other, cwd: '/r/old', live: false }], '/r/new', () => undefined)).toThrow(/^Unknown session$/)
  })
  it.skipIf(!process.env.SESSION_DECK_MOVE_SMOKE)('lets claude --resume find a moved session from its new folder', () => {
    const a = realpathSync(mkdtempSync(join(tmpdir(), 'deck-move-a-')))
    const b = realpathSync(mkdtempSync(join(tmpdir(), 'deck-move-b-')))
    // Claude Code refuses to start inside another Claude Code session while CLAUDECODE is set.
    const env = { ...process.env }
    delete env.CLAUDECODE
    const run = (cwd: string, args: string[]) =>
      spawnSync('claude', ['-p', '--model', 'haiku', ...args, 'Reply with the word ok.'], { cwd, env, encoding: 'utf8', timeout: 120_000 })
    const first = run(a, ['--output-format', 'json'])
    expect(first.status, first.stderr).toBe(0)
    const sid: string = JSON.parse(first.stdout).session_id
    const from = join(PATHS.projects, projectSlug(a)!, `${sid}.jsonl`)
    try {
      moveSessionsTo(PATHS.projects, [{ id: sid, cwd: a, live: false }], b, () => from)
      const resumed = run(b, ['--resume', sid])
      expect(resumed.status, resumed.stderr).toBe(0)
    } finally {
      rmSync(join(PATHS.projects, projectSlug(a)!), { recursive: true, force: true })
      rmSync(join(PATHS.projects, projectSlug(b)!), { recursive: true, force: true })
    }
  }, 300_000)
}

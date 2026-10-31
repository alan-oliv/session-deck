import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SETTINGS_DEFAULTS } from '../shared/api'
import { createIndexer } from './indexer'

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
}

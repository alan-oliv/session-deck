import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export interface GitInfo {
  repoRoot: string | null
  worktree: { name: string; path: string } | null
  removedSeen: string | null
}
type Location = Omit<GitInfo, 'removedSeen'>

function locate(start: string): Location {
  let dir = start
  for (;;) {
    const dotGit = join(dir, '.git')
    const st = statSync(dotGit, { throwIfNoEntry: false })
    if (st?.isDirectory()) return { repoRoot: dir, worktree: null }
    if (st?.isFile()) {
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
      const abs = gitdir ? resolve(dir, gitdir) : ''
      const i = abs.indexOf('/.git/worktrees/')
      if (i > 0) return { repoRoot: abs.slice(0, i), worktree: { name: basename(dir), path: dir } }
      return { repoRoot: dir, worktree: null }
    }
    const parent = dirname(dir)
    if (parent === dir) return { repoRoot: null, worktree: null }
    dir = parent
  }
}

function inferRemoved(cwd: string): Location {
  let dir = dirname(cwd)
  while (dir !== dirname(dir) && !existsSync(dir)) dir = dirname(dir)
  const near = locate(dir)
  if (!near.repoRoot || !cwd.startsWith(`${near.repoRoot}/`)) return near
  const rest = cwd.slice(near.repoRoot.length)
  const m = /\/\.?worktrees\/([^/]+)/.exec(rest)
  if (!m) return near
  return { repoRoot: near.repoRoot, worktree: { name: m[1], path: near.repoRoot + rest.slice(0, m.index + m[0].length) } }
}

export function resolveGit(cwd: string, prev: GitInfo | undefined, nowIso: string): GitInfo {
  if (existsSync(cwd)) return { ...locate(cwd), removedSeen: null }
  if (prev?.removedSeen) return prev
  const known = prev ? { repoRoot: prev.repoRoot, worktree: prev.worktree } : inferRemoved(cwd)
  return { ...known, removedSeen: nowIso }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  // realpath because macOS tmpdir is a /var → /private/var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-git-')))
  const repo = join(root, 'repo')
  const wt = join(repo, '.claude', 'worktrees', 'feat')
  mkdirSync(join(repo, '.git', 'worktrees', 'feat'), { recursive: true })
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(wt, { recursive: true })
  writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'feat')}\n`)
  mkdirSync(join(root, 'plain'), { recursive: true })

  it('finds the repo root from a subfolder', () => {
    expect(resolveGit(join(repo, 'src'), undefined, 'T')).toEqual({ repoRoot: repo, worktree: null, removedSeen: null })
  })
  it('resolves a worktree to its main repository', () => {
    expect(resolveGit(wt, undefined, 'T')).toEqual({ repoRoot: repo, worktree: { name: 'feat', path: wt }, removedSeen: null })
  })
  it('treats a folder outside any repository as a plain folder', () => {
    expect(resolveGit(join(root, 'plain'), undefined, 'T')).toEqual({ repoRoot: null, worktree: null, removedSeen: null })
  })
  it('keeps what it knew after the folder is deleted and stamps when it was first seen missing', () => {
    const before = resolveGit(wt, undefined, 'T0')
    rmSync(wt, { recursive: true })
    const first = resolveGit(wt, before, 'T1')
    expect(first).toEqual({ repoRoot: repo, worktree: { name: 'feat', path: wt }, removedSeen: 'T1' })
    expect(resolveGit(wt, first, 'T2').removedSeen).toBe('T1')
  })
  it('infers a removed worktree from a worktrees segment when it was never seen', () => {
    const gone = join(repo, '.worktrees', 'gone', 'sub')
    expect(resolveGit(gone, undefined, 'T')).toEqual({
      repoRoot: repo, worktree: { name: 'gone', path: join(repo, '.worktrees', 'gone') }, removedSeen: 'T',
    })
  })
  it('infers a removed folder inside a repo when the path has no worktrees segment', () => {
    expect(resolveGit(join(repo, 'scratch', 'old'), undefined, 'T')).toEqual({ repoRoot: repo, worktree: null, removedSeen: 'T' })
  })
  it('infers a removed plain folder outside any repository', () => {
    expect(resolveGit(join(root, 'plain', 'gone'), undefined, 'T')).toEqual({ repoRoot: null, worktree: null, removedSeen: 'T' })
  })
}

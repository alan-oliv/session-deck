import type { Session } from './api'
import { makeSession } from './fixtures'
import { tildify } from './format'

export type Scope =
  | { type: 'all' }
  | { type: 'repo'; repo: string }
  | { type: 'branch'; repo: string; branch: string }
  | { type: 'wt'; repo: string; path: string }
  | { type: 'folder'; path: string }

export interface TreeChild { kind: 'branch' | 'worktree'; label: string; count: number; removed: boolean; title: string; scope: Scope }
export interface TreeRepo { root: string; name: string; count: number; last: string; children: TreeChild[]; scope: Scope }
export interface TreeFolder { path: string; label: string; count: number; scope: Scope }
export interface Tree { all: number; repos: TreeRepo[]; folders: TreeFolder[] }

export const visible = (all: Session[]): Session[] => all.filter((s) => !s.hidden && !s.archived)

export function inScope(s: Session, scope: Scope): boolean {
  switch (scope.type) {
    case 'all':
      return true
    case 'repo':
      return s.repo?.root === scope.repo
    case 'branch':
      return s.repo?.root === scope.repo && !s.worktree && s.branch === scope.branch
    case 'wt':
      return s.worktree?.path === scope.path
    case 'folder':
      return !s.repo && s.cwd === scope.path
  }
}

// Scopes are small literals built in one place each, so key order is stable.
export const sameScope = (a: Scope, b: Scope): boolean => JSON.stringify(a) === JSON.stringify(b)

const latest = (xs: Session[]): string => xs.reduce((m, s) => (s.end > m ? s.end : m), '')
const byLatest = <T extends [string, Session[]]>(a: T, b: T) => latest(b[1]).localeCompare(latest(a[1]))

function groupBy(xs: Session[], key: (s: Session) => string | null): Map<string, Session[]> {
  const out = new Map<string, Session[]>()
  for (const s of xs) {
    const k = key(s)
    if (k === null) continue
    const list = out.get(k)
    if (list) list.push(s)
    else out.set(k, [s])
  }
  return out
}

export function buildTree(sessions: Session[]): Tree {
  const repos = groupBy(sessions, (s) => s.repo?.root ?? null)
  const folders = groupBy(sessions, (s) => (s.repo ? null : s.cwd))
  const repoNodes = [...repos].sort(byLatest).map(([root, xs]): TreeRepo => {
    const branches = groupBy(xs, (s) => (!s.worktree && s.branch && s.branch !== 'HEAD' ? s.branch : null))
    const worktrees = groupBy(xs, (s) => s.worktree?.path ?? null)
    const children: TreeChild[] = [
      ...[...branches].sort(byLatest).map(([branch, bs]): TreeChild => ({
        kind: 'branch', label: branch, count: bs.length, removed: false, title: `Branch ${branch}`,
        scope: { type: 'branch', repo: root, branch },
      })),
      ...[...worktrees].sort(byLatest).map(([path, ws]): TreeChild => {
        const removed = !!ws[0].worktree?.removedSeen
        return {
          kind: 'worktree', label: ws[0].worktree?.name ?? path, count: ws.length, removed,
          title: `${tildify(path)}${removed ? ' (removed)' : ''}`, scope: { type: 'wt', repo: root, path },
        }
      }),
    ]
    return { root, name: xs[0].repo?.name ?? root, count: xs.length, last: latest(xs), children, scope: { type: 'repo', repo: root } }
  })
  const folderNodes = [...folders].sort(byLatest).map(([path, xs]): TreeFolder => ({
    path, label: tildify(path), count: xs.length, scope: { type: 'folder', path },
  }))
  return { all: sessions.length, repos: repoNodes, folders: folderNodes }
}

export function scopeTitle(scope: Scope, tree: Tree): string {
  const repo = 'repo' in scope ? tree.repos.find((r) => r.root === scope.repo) : undefined
  const repoName = repo?.name ?? ('repo' in scope ? (scope.repo.split('/').pop() ?? scope.repo) : '')
  switch (scope.type) {
    case 'all':
      return 'All sessions'
    case 'repo':
      return repoName
    case 'branch':
      return `${repoName} / ${scope.branch}`
    case 'wt':
      return `${repo?.children.find((c) => c.kind === 'worktree' && 'path' in c.scope && c.scope.path === scope.path)?.label ?? scope.path.split('/').pop()} worktree`
    case 'folder':
      return tildify(scope.path)
  }
}

export const defaultExpanded = (tree: Tree): Record<string, boolean> =>
  Object.fromEntries(tree.repos.slice(0, 2).map((r) => [r.root, true]))

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const root = '/Users/me/code/app'
  const at = (d: number) => new Date(2026, 9, d, 9).toISOString()
  const main = makeSession({ branch: 'main', end: at(6) })
  const feat = makeSession({ branch: 'feat', end: at(5) })
  const head = makeSession({ branch: 'HEAD', end: at(4) })
  const wt = makeSession({ worktree: { name: 'transcriptions', path: `${root}/.worktrees/transcriptions`, removedSeen: null }, end: at(3) })
  const gone = makeSession({ worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: at(2) }, cwdExists: false, end: at(2) })
  const other = makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8' }, end: at(1) })
  const folder = makeSession({ repo: null, branch: null, cwd: '/Users/me/code', end: at(6) })
  const all = [main, feat, head, wt, gone, other, folder]
  const tree = buildTree(all)

  it('puts repo sessions under branches and worktrees, and plain cwds under folders', () => {
    expect(tree.all).toBe(7)
    expect(tree.repos.map((r) => [r.name, r.count])).toEqual([['app', 5], ['team8', 1]])
    expect(tree.repos[0].children.map((c) => [c.kind, c.label, c.count, c.removed])).toEqual([
      ['branch', 'main', 1, false], ['branch', 'feat', 1, false],
      ['worktree', 'transcriptions', 1, false], ['worktree', 'old', 1, true],
    ])
    expect(tree.repos[0].children[3].title).toBe('~/code/app/.worktrees/old (removed)')
    expect(tree.folders).toEqual([{ path: '/Users/me/code', label: '~/code', count: 1, scope: { type: 'folder', path: '/Users/me/code' } }])
  })
  it('filters sessions by each kind of scope', () => {
    const ids = (scope: Scope) => all.filter((s) => inScope(s, scope)).map((s) => s.id)
    expect(ids({ type: 'all' })).toHaveLength(7)
    expect(ids({ type: 'repo', repo: root })).toEqual([main.id, feat.id, head.id, wt.id, gone.id])
    expect(ids({ type: 'branch', repo: root, branch: 'main' })).toEqual([main.id])
    expect(ids({ type: 'wt', repo: root, path: `${root}/.worktrees/transcriptions` })).toEqual([wt.id])
    expect(ids({ type: 'folder', path: '/Users/me/code' })).toEqual([folder.id])
  })
  it('titles each scope the way the prototype does', () => {
    expect(scopeTitle({ type: 'all' }, tree)).toBe('All sessions')
    expect(scopeTitle({ type: 'repo', repo: root }, tree)).toBe('app')
    expect(scopeTitle({ type: 'branch', repo: root, branch: 'feat' }, tree)).toBe('app / feat')
    expect(scopeTitle({ type: 'wt', repo: root, path: `${root}/.worktrees/transcriptions` }, tree)).toBe('transcriptions worktree')
    expect(scopeTitle({ type: 'folder', path: '/Users/me/code' }, tree)).toBe('~/code')
  })
  it('expands the two most recently active repositories', () => {
    expect(defaultExpanded(tree)).toEqual({ [root]: true, '/Users/me/code/team8': true })
  })
  it('compares scopes by value', () => {
    expect(sameScope({ type: 'branch', repo: root, branch: 'main' }, { type: 'branch', repo: root, branch: 'main' })).toBe(true)
    expect(sameScope({ type: 'all' }, { type: 'repo', repo: root })).toBe(false)
  })
  it('leaves hidden and archived sessions out', () => {
    const xs = [makeSession(), makeSession({ hidden: true }), makeSession({ archived: true })]
    expect(visible(xs)).toEqual([xs[0]])
  })
}

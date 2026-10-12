import type { IconName, Session, Status } from './api'
import { makeSession } from './fixtures'
import { tildify } from './format'

export type Scope =
  | { type: 'all' }
  | { type: 'needs' }
  | { type: 'archived' }
  | { type: 'repo'; repo: string }
  | { type: 'branch'; repo: string; branch: string }
  | { type: 'wt'; repo: string; path: string }
  | { type: 'folder'; path: string }

export interface Project { kind: 'repo' | 'folder'; id: string; label: string; title: string; count: number; scope: Scope }
export interface Chip { label: string; count: number; icon: IconName | null; title: string; removed: boolean; scope: Scope }
export interface Tree { all: number; needs: number; archived: number; projects: Project[] }

// Interrupted sessions stay yellow in the list but don't nag: an Esc from a week ago isn't a request.
const NEEDS: Status[] = ['waiting', 'failed']
export const needsYou = (s: Session): boolean => NEEDS.includes(s.status)

export const visible = (all: Session[]): Session[] => all.filter((s) => !s.hidden && !s.archived)
export const archivedOf = (all: Session[]): Session[] => all.filter((s) => !s.hidden && s.archived)

export function inScope(s: Session, scope: Scope): boolean {
  switch (scope.type) {
    case 'all':
      return true
    case 'needs':
      return needsYou(s)
    case 'archived':
      return s.archived
    case 'repo':
      return s.repo?.root === scope.repo
    case 'branch':
      return s.repo?.root === scope.repo && s.branch === scope.branch
    case 'wt':
      return s.worktree?.path === scope.path
    case 'folder':
      return !s.repo && s.cwd === scope.path
  }
}

// Scopes are small literals built in one place each, so key order is stable.
export const sameScope = (a: Scope, b: Scope): boolean => JSON.stringify(a) === JSON.stringify(b)

// The repository a scope narrows; a repo row stays selected while one of its branches or worktrees is the filter.
export const scopeRepo = (scope: Scope): string | null => ('repo' in scope ? scope.repo : null)

// The sidebar row a session lives under: its repository, or its folder when it has none.
export const sessionProject = (s: Session): string => s.repo?.root ?? s.cwd

const latest = (xs: Session[]): string => xs.reduce((m, s) => (s.end > m ? s.end : m), '')

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

// `sessions` are the visible ones; the archived count comes from the rest.
export function buildTree(sessions: Session[], archived = 0): Tree {
  const repos = [...groupBy(sessions, (s) => s.repo?.root ?? null)].map(([root, xs]): Project & { last: string } => ({
    kind: 'repo', id: root, label: xs[0].repo?.name ?? root, title: tildify(root), count: xs.length, scope: { type: 'repo', repo: root }, last: latest(xs),
  }))
  const folders = [...groupBy(sessions, (s) => (s.repo ? null : s.cwd))].map(([path, xs]): Project & { last: string } => ({
    kind: 'folder', id: path, label: tildify(path), title: `${tildify(path)} (not a git repository)`, count: xs.length, scope: { type: 'folder', path }, last: latest(xs),
  }))
  const projects = [...repos, ...folders].sort((a, b) => b.last.localeCompare(a.last)).map(({ last: _, ...p }) => p)
  return { all: sessions.length, needs: sessions.filter(needsYou).length, archived, projects }
}

// Branch chips need two sessions to earn a place; the active branch is kept so a row-link filter stays visible.
export function buildChips(sessions: Session[], scope: Scope): Chip[] {
  const repo = scopeRepo(scope)
  if (!repo) return []
  const inRepo = sessions.filter((s) => s.repo?.root === repo)
  const branches = groupBy(inRepo, (s) => (s.branch && s.branch !== 'HEAD' ? s.branch : null))
  const shown = [...branches]
    .filter(([b, xs]) => xs.length >= 2 || (scope.type === 'branch' && scope.branch === b))
    .sort((a, b) => b[1].length - a[1].length)
  const worktrees = [...groupBy(inRepo, (s) => s.worktree?.path ?? null)]
  if (!shown.length && !worktrees.length) return []
  const rest = branches.size - shown.length
  return [
    { label: 'All', count: inRepo.length, icon: null, title: rest > 0 ? `Includes ${rest} ${rest === 1 ? 'branch' : 'branches'} with one session` : '', removed: false, scope: { type: 'repo', repo } },
    ...shown.map(([branch, xs]): Chip => ({
      label: branch, count: xs.length, icon: 'Branch', title: `Sessions that ended on ${branch}`, removed: false, scope: { type: 'branch', repo, branch },
    })),
    ...worktrees.map(([path, xs]): Chip => {
      const removed = !!xs[0].worktree?.removedSeen
      return {
        label: xs[0].worktree?.name ?? path, count: xs.length, icon: 'Layers', title: `${tildify(path)}${removed ? ' (removed)' : ''}`, removed,
        scope: { type: 'wt', repo, path },
      }
    }),
  ]
}

export function scopeTitle(scope: Scope, tree: Tree): string {
  const repo = scopeRepo(scope)
  if (repo) return tree.projects.find((p) => p.id === repo)?.label ?? (repo.split('/').pop() ?? repo)
  switch (scope.type) {
    case 'all':
      return 'All sessions'
    case 'needs':
      return 'Needs you'
    case 'archived':
      return 'Archived'
    case 'folder':
      return tildify(scope.path)
    default:
      return ''
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const root = '/Users/me/code/app'
  const at = (d: number) => new Date(2026, 9, d, 9).toISOString()
  const main = makeSession({ branch: 'main', end: at(6) })
  const main2 = makeSession({ branch: 'main', end: at(5), status: 'waiting' })
  const feat = makeSession({ branch: 'feat', end: at(5), status: 'interrupted' })
  const head = makeSession({ branch: 'HEAD', end: at(4) })
  const wt = makeSession({ branch: 'main', worktree: { name: 'transcriptions', path: `${root}/.worktrees/transcriptions`, removedSeen: null }, end: at(3) })
  const gone = makeSession({ branch: 'old', worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: at(2) }, cwdExists: false, end: at(2), status: 'failed' })
  const other = makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8', remote: 'alan-oliv/team8' }, end: at(1) })
  const folder = makeSession({ repo: null, branch: null, cwd: '/Users/me/code', end: at(6) })
  const all = [main, main2, feat, head, wt, gone, other, folder]
  const tree = buildTree(all)

  it('lists repositories and folders together, newest activity first, counting worktree sessions in their repo', () => {
    expect(tree.all).toBe(8)
    expect(tree.needs).toBe(2)
    expect(tree.archived).toBe(0)
    expect(buildTree(all, 3).archived).toBe(3)
    expect(tree.projects.map((p) => [p.kind, p.label, p.count])).toEqual([['repo', 'app', 6], ['folder', '~/code', 1], ['repo', 'team8', 1]])
    expect(tree.projects[0].title).toBe('~/code/app')
    expect(tree.projects[1].title).toBe('~/code (not a git repository)')
  })
  it('filters sessions by each kind of scope, branches spanning worktrees', () => {
    const ids = (scope: Scope) => all.filter((s) => inScope(s, scope)).map((s) => s.id)
    expect(ids({ type: 'all' })).toHaveLength(8)
    expect(ids({ type: 'needs' })).toEqual([main2.id, gone.id])
    expect(ids({ type: 'repo', repo: root })).toEqual([main.id, main2.id, feat.id, head.id, wt.id, gone.id])
    expect(ids({ type: 'branch', repo: root, branch: 'main' })).toEqual([main.id, main2.id, wt.id])
    expect(ids({ type: 'wt', repo: root, path: `${root}/.worktrees/transcriptions` })).toEqual([wt.id])
    expect(ids({ type: 'folder', path: '/Users/me/code' })).toEqual([folder.id])
  })
  it('builds All, branches with two or more sessions by count, then worktrees, striking removed ones', () => {
    const chips = buildChips(all, { type: 'repo', repo: root })
    expect(chips.map((c) => [c.label, c.count, c.icon, c.removed])).toEqual([
      ['All', 6, null, false], ['main', 3, 'Branch', false], ['transcriptions', 1, 'Layers', false], ['old', 1, 'Layers', true],
    ])
    expect(chips[0].title).toBe('Includes 2 branches with one session')
    expect(chips[1].title).toBe('Sessions that ended on main')
    expect(chips[3].title).toBe('~/code/app/.worktrees/old (removed)')
  })
  it('keeps a one-session branch as a chip while it is the filter', () => {
    const chips = buildChips(all, { type: 'branch', repo: root, branch: 'feat' })
    expect(chips.map((c) => c.label)).toEqual(['All', 'main', 'feat', 'transcriptions', 'old'])
    expect(chips[0].title).toBe('Includes 1 branch with one session')
  })
  it('shows no chips outside a repository or when All would be the only chip', () => {
    expect(buildChips(all, { type: 'all' })).toEqual([])
    expect(buildChips(all, { type: 'folder', path: '/Users/me/code' })).toEqual([])
    expect(buildChips(all, { type: 'repo', repo: '/Users/me/code/team8' })).toEqual([])
  })
  it('titles a project scope by the project even under a branch or worktree', () => {
    expect(scopeTitle({ type: 'all' }, tree)).toBe('All sessions')
    expect(scopeTitle({ type: 'needs' }, tree)).toBe('Needs you')
    expect(scopeTitle({ type: 'archived' }, tree)).toBe('Archived')
    expect(scopeTitle({ type: 'repo', repo: root }, tree)).toBe('app')
    expect(scopeTitle({ type: 'branch', repo: root, branch: 'feat' }, tree)).toBe('app')
    expect(scopeTitle({ type: 'wt', repo: root, path: `${root}/.worktrees/transcriptions` }, tree)).toBe('app')
    expect(scopeTitle({ type: 'folder', path: '/Users/me/code' }, tree)).toBe('~/code')
  })
  it('resolves the repository a branch or worktree scope belongs to', () => {
    expect(scopeRepo({ type: 'branch', repo: root, branch: 'main' })).toBe(root)
    expect(scopeRepo({ type: 'wt', repo: root, path: '/x' })).toBe(root)
    expect(scopeRepo({ type: 'folder', path: '/x' })).toBeNull()
    expect(scopeRepo({ type: 'needs' })).toBeNull()
  })
  it('compares scopes by value', () => {
    expect(sameScope({ type: 'branch', repo: root, branch: 'main' }, { type: 'branch', repo: root, branch: 'main' })).toBe(true)
    expect(sameScope({ type: 'all' }, { type: 'repo', repo: root })).toBe(false)
  })
  it('splits visible from archived sessions, leaving hidden ones out of both', () => {
    const xs = [makeSession(), makeSession({ hidden: true }), makeSession({ archived: true }), makeSession({ archived: true, hidden: true })]
    expect(visible(xs)).toEqual([xs[0]])
    expect(archivedOf(xs)).toEqual([xs[2]])
    expect(xs.filter((s) => inScope(s, { type: 'archived' }))).toEqual([xs[2], xs[3]])
  })
}

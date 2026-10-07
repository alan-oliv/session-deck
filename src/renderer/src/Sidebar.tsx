import { renderToStaticMarkup } from 'react-dom/server'
import { makeSession } from '../../shared/fixtures'
import { PANES } from '../../shared/panes'
import { buildTree, sameScope, scopeRepo, type Scope, type Tree } from '../../shared/tree'
import { Icon } from './icons'
import { ResizeHandle } from './Resize'
import './Sidebar.css'

export interface SidebarProps {
  tree: Tree
  scope: Scope
  width: number
  maxWidth: number
  onWidth(width: number): void
  onScope(scope: Scope): void
  settingsOpen: boolean
  onSettings(): void
}

const SECTIONS = [['repo', 'Repositories'], ['folder', 'Folders']] as const

export function Sidebar({ tree, scope, width, maxWidth, onWidth, onScope, settingsOpen, onSettings }: SidebarProps) {
  const cls = (on: boolean, base: string) => (on ? `${base} is-selected` : base)
  const repo = scopeRepo(scope)
  return (
    <nav className="sidebar" style={{ width }}>
      <ResizeHandle width={width} min={PANES.side.min} max={maxWidth} defaultWidth={PANES.side.default} label="Resize sidebar" onWidth={onWidth} />
      <div className="sidebar-lights" />
      <div className="sidebar-scroll">
        <div className="side-section">
          <div className={cls(scope.type === 'all', 'side-item')} onClick={() => onScope({ type: 'all' })}>
            <Icon name="AllItems" size={14} className="side-icon" />
            <span className="side-label">All sessions</span>
            <span className="side-count">{tree.all}</span>
          </div>
          <div className={cls(scope.type === 'archived', 'side-item')} onClick={() => onScope({ type: 'archived' })} title="Sessions you archived. Their files are kept.">
            <Icon name="Archive" size={14} className="side-icon" />
            <span className="side-label">Archived</span>
            <span className="side-count">{tree.archived}</span>
          </div>
          {(tree.needs > 0 || scope.type === 'needs') && (
            <div className={cls(scope.type === 'needs', 'side-item')} onClick={() => onScope({ type: 'needs' })} title="Waiting for you or failed">
              <span className="side-icon side-needs"><span className="dot" /></span>
              <span className="side-label">Needs you</span>
              <span className="side-count">{tree.needs}</span>
            </div>
          )}
        </div>
        {SECTIONS.map(([kind, header]) => {
          const items = tree.projects.filter((p) => p.kind === kind)
          return items.length > 0 && (
            <div key={kind} className="side-section">
              <div className="side-header">{header}</div>
              {items.map((p) => (
                <div
                  key={p.id}
                  className={cls(kind === 'repo' ? repo === p.id : sameScope(p.scope, scope), `side-item side-${kind}`)}
                  onClick={() => onScope(p.scope)}
                  title={p.title}
                >
                  <Icon name={kind === 'repo' ? 'Box' : 'Storage'} size={14} className="side-icon" />
                  <span className="side-label">{p.label}</span>
                  <span className="side-count">{p.count}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="sidebar-foot">
        <div className={cls(settingsOpen, 'side-item')} onClick={onSettings}>
          <Icon name="Settings" size={14} className="side-icon" />
          <span className="side-label">Settings</span>
          <span className="keycap">⌘,</span>
        </div>
      </div>
    </nav>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const root = '/Users/me/code/app'
  const sessions = [
    makeSession({ branch: 'main' }),
    makeSession({ worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: '2026-10-02T00:00:00.000Z' } }),
    makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8' } }),
    makeSession({ repo: null, cwd: '/Users/me/code' }),
  ]
  const render = (scope: Scope, all = sessions, width = PANES.side.default) =>
    renderToStaticMarkup(
      <Sidebar tree={buildTree(all, 2)} scope={scope} width={width} maxWidth={360} onWidth={() => {}} onScope={() => {}} settingsOpen={false} onSettings={() => {}} />,
    )

  it('renders at the given width with a focusable resize separator on its edge', () => {
    const html = render({ type: 'all' }, sessions, 250)
    expect(html).toContain('class="sidebar" style="width:250px"')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-valuenow="250"')
    expect(html).toContain('tabindex="0"')
  })
  it('lists all sessions, then flat Repositories and Folders sections with no children', () => {
    const html = render({ type: 'all' })
    expect(html).toContain('All sessions')
    expect(html).toMatch(/>Repositories<.*>Folders</)
    expect(html).not.toContain('>Projects<')
    expect(html).toContain('side-item side-repo" title="~/code/app"')
    expect(html).toContain('>team8<')
    expect(html).toContain('side-item side-folder" title="~/code (not a git repository)"')
    expect(html).toContain('>~/code<')
    expect(html).not.toContain('>main<')
    expect(html).not.toContain('>old<')
  })
  it('always shows Archived with its count right under All sessions', () => {
    const html = render({ type: 'all' })
    expect(html).toMatch(/>All sessions<.*?side-item" title="Sessions you archived\. Their files are kept\."[^>]*>.*?>Archived<\/span><span class="side-count">2</)
    expect(render({ type: 'archived' })).toContain('side-item is-selected" title="Sessions you archived')
  })
  it('shows Needs you only while something needs attention or it is the scope', () => {
    expect(render({ type: 'all' })).not.toContain('Needs you')
    expect(render({ type: 'needs' })).toContain('side-item is-selected" title="Waiting for you or failed"')
    const html = render({ type: 'all' }, [...sessions, makeSession({ status: 'waiting' })])
    expect(html).toContain('>Needs you</span><span class="side-count">1<')
  })
  it('pins the Settings entry with its shortcut under the sections', () => {
    expect(render({ type: 'all' })).toMatch(/sidebar-foot">.*>Settings<.*keycap">⌘,</)
  })
  it('keeps the repository selected while one of its branches or worktrees is the filter', () => {
    const html = render({ type: 'branch', repo: root, branch: 'main' })
    expect(html.match(/is-selected/g)).toHaveLength(1)
    expect(html).toMatch(/side-repo is-selected[^>]*>[\s\S]*?>app</)
    expect(render({ type: 'wt', repo: root, path: `${root}/.worktrees/old` })).toMatch(/side-repo is-selected[^>]*>[\s\S]*?>app</)
  })
}

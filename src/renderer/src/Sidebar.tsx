import { renderToStaticMarkup } from 'react-dom/server'
import { makeSession } from '../../shared/fixtures'
import { tildify } from '../../shared/format'
import { PANES } from '../../shared/panes'
import { buildTree, sameScope, type Scope, type Tree } from '../../shared/tree'
import { Icon } from './icons'
import { ResizeHandle } from './Resize'
import './Sidebar.css'

export interface SidebarProps {
  tree: Tree
  scope: Scope
  expanded: Record<string, boolean>
  width: number
  maxWidth: number
  onWidth(width: number): void
  onScope(scope: Scope): void
  onToggle(root: string): void
}

export function Sidebar({ tree, scope, expanded, width, maxWidth, onWidth, onScope, onToggle }: SidebarProps) {
  const cls = (s: Scope, base: string) => (sameScope(s, scope) ? `${base} is-selected` : base)
  return (
    <nav className="sidebar" style={{ width }}>
      <ResizeHandle width={width} min={PANES.side.min} max={maxWidth} defaultWidth={PANES.side.default} label="Resize sidebar" onWidth={onWidth} />
      <div className="sidebar-lights" />
      <div className="sidebar-scroll">
        <div className={cls({ type: 'all' }, 'side-item')} onClick={() => onScope({ type: 'all' })}>
          <Icon name="AllItems" size={14} className="side-icon" />
          <span className="side-label">All sessions</span>
          <span className="side-count">{tree.all}</span>
        </div>
        {tree.repos.length > 0 && (
          <div className="side-section">
            <div className="side-header">Repositories</div>
            {tree.repos.map((r) => {
              const isOpen = !!expanded[r.root]
              return (
                <div key={r.root} className="side-repo-block">
                  <div className={cls(r.scope, 'side-repo')} onClick={() => onScope(r.scope)} title={tildify(r.root)}>
                    <span
                      className="side-chevron"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(r.root)
                      }}
                    >
                      <span style={{ display: 'flex', transform: isOpen ? 'none' : 'rotate(-90deg)', opacity: r.children.length ? 1 : 0.3 }}>
                        <Icon name="ChevronDown2" size={10} />
                      </span>
                    </span>
                    <Icon name="Box" size={14} className="side-icon" />
                    <span className="side-label">{r.name}</span>
                    <span className="side-count">{r.count}</span>
                  </div>
                  {isOpen && r.children.length > 0 && (
                    <div className="side-children">
                      {r.children.map((c) => (
                        <div key={`${c.kind}:${c.label}`} className={cls(c.scope, 'side-child')} onClick={() => onScope(c.scope)} title={c.title}>
                          <Icon name={c.kind === 'branch' ? 'Branch' : 'Layers'} size={12} className="side-icon" />
                          <span className={c.removed ? 'side-label is-removed' : 'side-label'}>{c.label}</span>
                          <span className="side-count">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {tree.folders.length > 0 && (
          <div className="side-section">
            <div className="side-header">Folders</div>
            {tree.folders.map((f) => (
              <div key={f.path} className={cls(f.scope, 'side-folder')} onClick={() => onScope(f.scope)} title={f.label}>
                <Icon name="Storage" size={14} className="side-icon" />
                <span className="side-label">{f.label}</span>
                <span className="side-count">{f.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const root = '/Users/me/code/app'
  const tree = buildTree([
    makeSession({ branch: 'main' }),
    makeSession({ worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: '2026-10-02T00:00:00.000Z' } }),
    makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8' } }),
    makeSession({ repo: null, cwd: '/Users/me/code' }),
  ])
  const render = (scope: Scope, expanded: Record<string, boolean>, width = PANES.side.default) =>
    renderToStaticMarkup(
      <Sidebar tree={tree} scope={scope} expanded={expanded} width={width} maxWidth={360} onWidth={() => {}} onScope={() => {}} onToggle={() => {}} />,
    )

  it('renders at the given width with a focusable resize separator on its edge', () => {
    const html = render({ type: 'all' }, {}, 250)
    expect(html).toContain('class="sidebar" style="width:250px"')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-valuenow="250"')
    expect(html).toContain('tabindex="0"')
  })

  it('lists all sessions, repositories with counts, and folders', () => {
    const html = render({ type: 'all' }, {})
    expect(html).toContain('All sessions')
    expect(html).toContain('Repositories')
    expect(html).toContain('>team8<')
    expect(html).toContain('Folders')
    expect(html).toContain('>~/code<')
  })
  it('shows branches and worktrees only for expanded repositories, striking removed worktrees', () => {
    expect(render({ type: 'all' }, {})).not.toContain('>main<')
    const open = render({ type: 'all' }, { [root]: true })
    expect(open).toContain('>main<')
    expect(open).toContain('side-label is-removed">old<')
    expect(open).toContain('title="~/code/app/.worktrees/old (removed)"')
  })
  it('marks exactly the selected scope', () => {
    const html = render({ type: 'repo', repo: '/Users/me/code/team8' }, {})
    expect(html.match(/is-selected/g)).toHaveLength(1)
    expect(html).toMatch(/side-repo is-selected[^>]*>[\s\S]*?>team8</)
  })
}

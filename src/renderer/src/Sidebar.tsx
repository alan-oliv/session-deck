import { useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LabelStore } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { nextColor } from '../../shared/labels'
import { PANES } from '../../shared/panes'
import { buildTree, sameScope, scopeRepo, sessionProject, type Scope, type Tree, type TreeLabel } from '../../shared/tree'
import { Icon } from './icons'
import { ResizeHandle } from './Resize'
import './Sidebar.css'

export interface SidebarProps {
  tree: Tree
  scope: Scope
  current: string | null
  width: number
  maxWidth: number
  onWidth(width: number): void
  onScope(scope: Scope): void
  settingsOpen: boolean
  onSettings(): void
  onLabelCreate(name: string): void
  onLabelDelete(id: string): void
}

const SECTIONS = [['repo', 'Repositories'], ['folder', 'Folders']] as const

function NameInput({ color, initial = '', onDone }: { color: string; initial?: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial)
  // Enter fires onDone, and the unmount that follows blurs the input: only the first one counts.
  const finished = useRef(false)
  const finish = (name: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }
  return (
    <div className="side-item side-newlabel">
      <span className="label-slot"><span className="label-dot" style={{ background: color }} /></span>
      <input
        className="side-input"
        autoFocus
        value={value}
        placeholder="Label name"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(value.trim() || null)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(value.trim() || null)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(null)
          }
        }}
      />
    </div>
  )
}

function LabelRow({ label, selected, onSelect, onDelete }: { label: TreeLabel; selected: boolean; onSelect(): void; onDelete(): void }) {
  return (
    <div className={selected ? 'side-item side-label-row is-selected' : 'side-item side-label-row'} onClick={onSelect}>
      <span className="label-slot"><span className="label-dot" style={{ background: label.color }} /></span>
      <span className="side-label">{label.name}</span>
      <span className="side-count">{label.count}</span>
      <button
        type="button"
        className="side-trash"
        title="Delete label"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Icon name="Trash" size={12} />
      </button>
    </div>
  )
}

export function Sidebar({ tree, scope, current, width, maxWidth, onWidth, onScope, settingsOpen, onSettings, onLabelCreate, onLabelDelete }: SidebarProps) {
  const [creating, setCreating] = useState(false)
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
                  className={cls(kind === 'repo' ? repo === p.id : sameScope(p.scope, scope), p.id === current ? `side-item side-${kind} is-current` : `side-item side-${kind}`)}
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
        <div className="side-section">
          <div className="side-header side-header-row">
            <span>Labels</span>
            <button type="button" className="side-add" title="New label" onClick={() => setCreating(true)}>
              <Icon name="Plus" size={12} />
            </button>
          </div>
          {tree.labels.map((l) => (
            <LabelRow key={l.id} label={l} selected={scope.type === 'label' && scope.id === l.id} onSelect={() => onScope({ type: 'label', id: l.id })} onDelete={() => onLabelDelete(l.id)} />
          ))}
          {creating && (
            <NameInput
              color={nextColor(tree.labels)}
              onDone={(name) => {
                setCreating(false)
                if (name) onLabelCreate(name)
              }}
            />
          )}
        </div>
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
    makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8', remote: 'alan-oliv/team8' } }),
    makeSession({ repo: null, cwd: '/Users/me/code' }),
  ]
  const lstore: LabelStore = {
    list: [{ id: 'bug', name: 'Bug', color: '#eb5757' }, { id: 'ui', name: 'Interface polish', color: '#bb87fc' }],
    map: { [sessions[0].id]: ['bug'], [sessions[1].id]: ['bug', 'ui'] },
  }
  const render = (scope: Scope, all = sessions, width = PANES.side.default, current: string | null = null, store: LabelStore = lstore) =>
    renderToStaticMarkup(
      <Sidebar
        tree={buildTree(all, 2, store)} scope={scope} current={current} width={width} maxWidth={360} onWidth={() => {}} onScope={() => {}}
        settingsOpen={false} onSettings={() => {}} onLabelCreate={() => {}} onLabelDelete={() => {}}
      />,
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
  it('marks the row the selected session lives under without changing the scope', () => {
    const html = render({ type: 'all' }, sessions, PANES.side.default, sessionProject(sessions[3]))
    expect(html).toMatch(/side-folder is-current[^>]*>[\s\S]*?>~\/code</)
    expect(html.match(/is-selected/g)).toHaveLength(1)
    expect(render({ type: 'folder', path: '/Users/me/code' }, sessions, PANES.side.default, '/Users/me/code')).toMatch(/side-folder is-current is-selected[^>]*>/)
  })
  it('puts the Labels section after Folders with a colour dot, name and count per label', () => {
    const html = render({ type: 'all' })
    expect(html).toMatch(/>Folders<[\s\S]*>Labels<[\s\S]*side-label-row/)
    expect(html).toContain('label-dot" style="background:#eb5757"')
    expect(html).toMatch(/side-label">Bug<\/span><span class="side-count">2</)
    expect(html).toMatch(/side-label">Interface polish<\/span><span class="side-count">1</)
    expect(html).toContain('title="New label"')
    expect(html).toContain('title="Delete label"')
  })
  it('still shows the Labels header and its add button with no labels', () => {
    const html = render({ type: 'all' }, sessions, PANES.side.default, null, { list: [], map: {} })
    expect(html).toContain('>Labels<')
    expect(html).toContain('title="New label"')
    expect(html).not.toContain('side-label-row')
  })
  it('marks only the filtered label as selected', () => {
    const html = render({ type: 'label', id: 'ui' })
    expect(html).toMatch(/side-item side-label-row is-selected[^>]*>[\s\S]*?>Interface polish</)
    expect(html.match(/is-selected/g)).toHaveLength(1)
  })
}

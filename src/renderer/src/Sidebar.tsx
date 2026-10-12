import { useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LabelStore } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { dropTarget, LABEL_COLORS, nextColor } from '../../shared/labels'
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
  onLabelRename(id: string, name: string): void
  onLabelColor(id: string, color: string): void
  onLabelMove(id: string, beforeId: string | null): void
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

function ColorPopover({ current, onPick, onClose }: { current: string; onPick(color: string): void; onClose(): void }) {
  return (
    <>
      <div className="label-dismiss" onClick={(e) => { e.stopPropagation(); onClose() }} />
      <div className="label-colors" onClick={(e) => e.stopPropagation()}>
        {LABEL_COLORS.map((c) => (
          <button key={c} type="button" className={c === current ? 'label-swatch is-current' : 'label-swatch'} style={{ background: c }} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
    </>
  )
}

type Drag = { id: string; over: string | null; after: boolean }

interface LabelRowProps {
  label: TreeLabel
  selected: boolean
  drag: Drag | null
  onSelect(): void
  onDelete(): void
  onRename(name: string): void
  onColor(color: string): void
  onDrag(d: Drag | null): void
  onDrop(): void
}

function LabelRow({ label, selected, drag, onSelect, onDelete, onRename, onColor, onDrag, onDrop }: LabelRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [picking, setPicking] = useState(false)
  if (renaming) {
    return (
      <NameInput
        color={label.color}
        initial={label.name}
        onDone={(name) => {
          setRenaming(false)
          if (name && name !== label.name) onRename(name)
        }}
      />
    )
  }
  const dropping = drag && drag.over === label.id && drag.id !== label.id ? (drag.after ? ' is-drop-after' : ' is-drop-before') : ''
  return (
    <div
      className={`side-item side-label-row${selected ? ' is-selected' : ''}${dropping}`}
      draggable={!picking}
      onClick={onSelect}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', label.id)
        onDrag({ id: label.id, over: null, after: false })
      }}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        const after = e.clientY > r.top + r.height / 2
        if (drag.over !== label.id || drag.after !== after) onDrag({ ...drag, over: label.id, after })
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      onDragEnd={() => onDrag(null)}
    >
      <span
        className="label-slot label-slot-btn"
        title="Change colour"
        onClick={(e) => {
          e.stopPropagation()
          setPicking(!picking)
        }}
      >
        <span className="label-dot" style={{ background: label.color }} />
      </span>
      <span className="side-label" onDoubleClick={() => setRenaming(true)}>{label.name}</span>
      <span className="side-count">{label.count}</span>
      <button type="button" className="side-trash" title="Delete label" onClick={(e) => { e.stopPropagation(); onDelete() }}>
        <Icon name="Trash" size={12} />
      </button>
      {picking && <ColorPopover current={label.color} onPick={(c) => { setPicking(false); if (c !== label.color) onColor(c) }} onClose={() => setPicking(false)} />}
    </div>
  )
}

export function Sidebar({
  tree, scope, current, width, maxWidth, onWidth, onScope, settingsOpen, onSettings, onLabelCreate, onLabelDelete, onLabelRename, onLabelColor, onLabelMove,
}: SidebarProps) {
  const [creating, setCreating] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
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
          <div
            className={`side-item side-label-row side-label-builtin${scope.type === 'needs' ? ' is-selected' : ''}`}
            onClick={() => onScope({ type: 'needs' })}
            title="Waiting for you or failed"
          >
            <span className="label-slot"><span className="label-dot" style={{ background: 'var(--app-yellow)' }} /></span>
            <span className="side-label">Needs you</span>
            <span className="side-count">{tree.needs}</span>
          </div>
          {tree.labels.map((l) => (
            <LabelRow
              key={l.id}
              label={l}
              selected={scope.type === 'label' && scope.id === l.id}
              drag={drag}
              onSelect={() => onScope({ type: 'label', id: l.id })}
              onDelete={() => onLabelDelete(l.id)}
              onRename={(name) => onLabelRename(l.id, name)}
              onColor={(color) => onLabelColor(l.id, color)}
              onDrag={setDrag}
              onDrop={() => {
                if (drag?.over) onLabelMove(drag.id, dropTarget(tree.labels.map((x) => x.id), drag.over, drag.after))
                setDrag(null)
              }}
            />
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
        onLabelRename={() => {}} onLabelColor={() => {}} onLabelMove={() => {}}
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
  it('always shows Needs you as the first row of the Labels section, even with nothing waiting and no labels', () => {
    for (const store of [lstore, { list: [], map: {} }]) {
      const html = render({ type: 'all' }, sessions, PANES.side.default, null, store)
      expect(html).toMatch(/>Labels<[\s\S]*>Needs you<\/span><span class="side-count">0</)
      expect(html.indexOf('>Labels<')).toBeLessThan(html.indexOf('>Needs you<'))
      if (store.list.length) expect(html.indexOf('>Needs you<')).toBeLessThan(html.indexOf('>Bug<'))
    }
    const html = render({ type: 'all' })
    expect(html.indexOf('>Folders<')).toBeLessThan(html.indexOf('Needs you'))
  })
  it('shows the Needs you count when sessions are waiting or failed', () => {
    const html = render({ type: 'all' }, [...sessions, makeSession({ status: 'waiting' }), makeSession({ status: 'failed' })])
    expect(html).toContain('>Needs you</span><span class="side-count">2<')
  })
  it('selects Needs you alone under the needs scope', () => {
    const html = render({ type: 'needs' })
    expect(html).toContain('side-item side-label-row side-label-builtin is-selected" title="Waiting for you or failed"')
    expect(html.match(/is-selected/g)).toHaveLength(1)
  })
  it('keeps Needs you read-only: no trash, drag or colour button, unlike the other label rows', () => {
    const html = render({ type: 'all' })
    const row = html.match(/<div[^>]*side-label-builtin[\s\S]*?<\/div>/)![0]
    expect(row).not.toContain('side-trash')
    expect(row).not.toContain('draggable')
    expect(row).not.toContain('Change colour')
    expect(html.match(/title="Delete label"/g)).toHaveLength(2)
    expect(html.match(/title="Change colour"/g)).toHaveLength(2)
    expect(html.match(/draggable="true"/g)).toHaveLength(2)
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
    expect(html.match(/side-label-row/g)).toHaveLength(1)
  })
  it('marks only the filtered label as selected', () => {
    const html = render({ type: 'label', id: 'ui' })
    expect(html).toMatch(/side-item side-label-row is-selected[^>]*>[\s\S]*?>Interface polish</)
    expect(html.match(/is-selected/g)).toHaveLength(1)
  })
  it('makes label rows draggable and shows the colour swatch button on the dot', () => {
    const html = render({ type: 'all' })
    expect(html.match(/side-label-row[^>]*draggable="true"/g)).toHaveLength(2)
    expect(html).toContain('label-slot label-slot-btn" title="Change colour"')
    expect(html).not.toContain('label-colors')
  })
  it('offers the eight palette colours in the picker popover', () => {
    const html = renderToStaticMarkup(<ColorPopover current="#bb87fc" onPick={() => {}} onClose={() => {}} />)
    expect(html.match(/label-swatch/g)).toHaveLength(8)
    expect(html).toContain('label-swatch is-current" style="background:#bb87fc"')
  })
}

import { renderToStaticMarkup } from 'react-dom/server'
import type { IconName, Label, LabelStore, Session } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoShort, attention, clock, plural, tildify } from '../../shared/format'
import { labelsOf, NO_LABELS } from '../../shared/labels'
import { PANES } from '../../shared/panes'
import { dragIds, SESSION_DRAG } from '../../shared/selection'
import { buildChips, sameScope, type Chip, type Scope } from '../../shared/tree'
import { dayKey, groupSessions, listForView, type ViewMode, type YearMonth } from '../../shared/views'
import { Calendar } from './Calendar'
import { Icon } from './icons'
import { ResizeHandle } from './Resize'
import './SessionList.css'

const MODES: { id: ViewMode; label: string; icon: IconName }[] = [
  { id: 'list', label: 'List', icon: 'ViewList' },
  { id: 'timeline', label: 'Timeline', icon: 'Timeline' },
  { id: 'repo', label: 'Repository', icon: 'Box' },
  { id: 'worktree', label: 'Worktree', icon: 'Layers' },
  { id: 'calendar', label: 'Calendar', icon: 'CalendarEmpty' },
]

export interface SessionListProps {
  labels: LabelStore
  title: string
  width: number
  maxWidth: number
  onWidth(width: number): void
  sessions: Session[]
  chips: Chip[]
  scope: Scope
  onScope(scope: Scope): void
  showModes: boolean
  mode: ViewMode
  onMode(m: ViewMode): void
  selectedId: string | null
  picked: string[]
  onPick(id: string, mods: { shift: boolean; toggle: boolean }): void
  onContextMenu(id: string, x: number, y: number): void
  onArchive(s: Session): void
  onOpenBar(): void
  now: Date
  month: YearMonth
  day: string | null
  onMonth(ym: YearMonth): void
  onDay(key: string): void
}

interface RowProps {
  s: Session
  mode: ViewMode
  now: Date
  selected: boolean
  picked: boolean
  drag: string[]
  onPick: SessionListProps['onPick']
  onContextMenu: SessionListProps['onContextMenu']
  onScope(scope: Scope): void
  onArchive(s: Session): void
  labels: Label[]
}

// The browser snapshots the drag image as the drag starts, so the pill can go on the next tick.
function setDragPill(dt: DataTransfer, n: number): void {
  const pill = document.createElement('div')
  pill.className = 'drag-pill'
  pill.textContent = `${n} sessions`
  document.body.append(pill)
  dt.setDragImage(pill, 12, 12)
  setTimeout(() => pill.remove())
}

function Row({ s, mode, now, selected, picked, drag, onPick, onContextMenu, onScope, onArchive, labels }: RowProps) {
  const dot = attention(s.status)
  const timeline = mode === 'timeline'
  const where = `${mode !== 'repo' && s.repo ? `${s.repo.name} · ` : ''}${tildify(s.cwd)}${s.forks ? ` · ${plural(s.forks, 'fork')}` : ''}`
  const branch = s.repo && s.branch && s.branch !== 'HEAD' ? { repo: s.repo.root, branch: s.branch } : null
  return (
    <div
      className={selected ? 'row is-selected' : picked ? 'row is-picked' : 'row'}
      style={{ gridTemplateColumns: timeline ? '58px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(SESSION_DRAG, JSON.stringify(drag))
        if (drag.length > 1) setDragPill(e.dataTransfer, drag.length)
      }}
      onClick={(e) => onPick(s.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(s.id, e.clientX, e.clientY)
      }}
    >
      <button
        type="button"
        className="row-archive"
        title={s.archived ? 'Restore from archive' : 'Archive'}
        onClick={(e) => {
          e.stopPropagation()
          onArchive(s)
        }}
      >
        <Icon name="Archive" size={14} />
      </button>
      {timeline && <span className="row-time tnum">{clock(new Date(s.end)).replace(' ', ' ')}</span>}
      <div className="row-main">
        <div className="row-line">
          {dot && <span className="dot" title={dot.label} style={{ background: dot.color }} />}
          <span className="row-title">{s.title}</span>
          {labels.length > 0 && (
            <span className="row-labels" title={labels.map((l) => l.name).join(', ')}>
              {labels.map((l) => (
                <span key={l.id} className="row-label-dot" style={{ background: l.color }} />
              ))}
            </span>
          )}
          {!timeline && <span className="row-ago">{agoShort(s.end, now)}</span>}
        </div>
        <div className="row-where">
          <span className="row-loc">{where}</span>
          {branch && (
            <span
              className="row-branch"
              title={`Last branch in this session. Click to show every session that ended on ${branch.branch}.`}
              onClick={(e) => {
                e.stopPropagation()
                onScope({ type: 'branch', ...branch })
              }}
            >
              <Icon name="Branch" size={10} />
              <span className="row-branch-name">{branch.branch}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function SessionList(p: SessionListProps) {
  const shown = listForView(p.sessions, p.mode, p.day)
  const groups = groupSessions(shown, p.mode, p.now)
  return (
    <section className="list" style={{ width: p.width }}>
      <ResizeHandle width={p.width} min={PANES.list.min} max={p.maxWidth} defaultWidth={PANES.list.default} label="Resize session list" onWidth={p.onWidth} />
      <header className="list-header">
        <div className="list-title-row">
          <span className="list-title">{p.title}</span>
          <span className="list-count">{plural(p.sessions.length, 'session')}</span>
          <span className="keycap" title="Command bar" onClick={p.onOpenBar}>⌘⇧P</span>
        </div>
        {p.chips.length > 0 && (
          <div className="chips">
            {p.chips.map((c) => {
              const on = sameScope(c.scope, p.scope)
              return (
                <div
                  key={c.label + c.scope.type}
                  className={on ? 'chip is-selected' : 'chip'}
                  title={c.title || undefined}
                  onClick={() => p.onScope(on && c.scope.type !== 'repo' ? p.chips[0].scope : c.scope)}
                >
                  {c.icon && <Icon name={c.icon} size={10} className="chip-icon" />}
                  <span className={c.removed ? 'chip-label is-removed' : 'chip-label'}>{c.label}</span>
                  <span className="chip-count tnum">{c.count}</span>
                </div>
              )
            })}
          </div>
        )}
        {p.showModes && (
          <div className="modes">
            {MODES.map((m) => (
              <div key={m.id} className={m.id === p.mode ? 'mode is-current' : 'mode'} title={m.label} onClick={() => p.onMode(m.id)}>
                <Icon name={m.icon} size={14} />
                {m.id === p.mode && <span>{m.label}</span>}
              </div>
            ))}
          </div>
        )}
      </header>
      <div className="list-body">
        {p.mode === 'calendar' && (
          <Calendar sessions={p.sessions} month={p.month} day={p.day} now={p.now} onMonth={p.onMonth} onDay={p.onDay} />
        )}
        {groups.map((g) => (
          <div key={g.key} className="group">
            {g.label && (
              <div className="group-header">
                <span className="group-label">{g.label}</span>
                <span className="group-count">{g.sessions.length}</span>
                {g.note && <span className="group-note">{g.note}</span>}
              </div>
            )}
            {g.sessions.map((s) => (
              <Row key={s.id} s={s} mode={p.mode} now={p.now} selected={s.id === p.selectedId} picked={p.picked.includes(s.id)} drag={dragIds(p.picked, s.id)} onPick={p.onPick} onContextMenu={p.onContextMenu} onScope={p.onScope} onArchive={p.onArchive} labels={labelsOf(p.labels, s.id)} />
            ))}
          </div>
        ))}
        {shown.length === 0 && <div className="list-empty">No sessions here.</div>}
      </div>
    </section>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const base = {
    title: 'All sessions', width: 380, maxWidth: 600, onWidth: () => {}, chips: [], scope: { type: 'all' } as Scope, onScope: () => {}, showModes: true, mode: 'list' as ViewMode, onMode: () => {}, selectedId: null,
    picked: [] as string[], onPick: () => {}, onContextMenu: () => {}, onArchive: () => {}, onOpenBar: () => {}, now, month: { year: 2026, month: 9 }, day: null, onMonth: () => {}, onDay: () => {}, labels: NO_LABELS,
  }
  const live = makeSession({ title: 'live-meeting', status: 'running', forks: 1, end: new Date(2026, 9, 6, 9, 12).toISOString() })
  const old = makeSession({ title: 'old pass', end: new Date(2026, 9, 3, 9, 0).toISOString(), repo: null, cwd: '/Users/me/code' })
  const render = (over: Partial<SessionListProps> = {}) => renderToStaticMarkup(<SessionList {...base} sessions={[live, old]} {...over} />)

  it('shows the scope title, the count, the command bar key and rows with time and location', () => {
    const html = render()
    expect(html).toContain('>All sessions<')
    expect(html).toContain('class="list" style="width:380px"')
    expect(html).toContain('aria-label="Resize session list"')
    expect(html).toContain('>2 sessions<')
    expect(html).toContain('⌘⇧P')
    expect(html).toContain('>9:12 AM<')
    expect(html).toContain('>3d<')
    expect(html).toContain('app · ~/code/app · 1 fork')
    expect(html).toContain('title="Running"')
  })
  it('links the last branch on repository rows only, never for detached or folder sessions', () => {
    const html = render()
    expect(html).toContain('title="Last branch in this session. Click to show every session that ended on main."')
    expect(html).toContain('row-branch-name">main<')
    expect(html.match(/row-branch"/g)).toHaveLength(1)
    expect(render({ sessions: [makeSession({ branch: 'HEAD' })] })).not.toContain('row-branch')
  })
  it('shows the filter chips, marking the active one and striking removed worktrees', () => {
    const root = '/Users/me/code/app'
    const all = [live, makeSession(), makeSession({ branch: 'feat' }), makeSession({ worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: '2026-10-02T00:00:00.000Z' } })]
    const scope: Scope = { type: 'branch', repo: root, branch: 'main' }
    const html = render({ sessions: all, chips: buildChips(all, scope), scope })
    expect(html).toContain('chip" title="Includes 1 branch with one session"')
    expect(html).toMatch(/chip is-selected" title="Sessions that ended on main"[^>]*>.*?chip-label">main<.*?chip-count tnum">3</)
    expect(html).toContain('chip-label is-removed">old<')
    expect(render()).not.toContain('class="chips"')
  })
  it('shows the view switcher only when asked, labelling just the current view', () => {
    expect(render()).toContain('mode is-current')
    expect(render()).toContain('<span>List</span>')
    expect(render()).not.toContain('<span>Timeline</span>')
    expect(render({ showModes: false })).not.toContain('class="modes"')
  })
  it('puts start times in a column and groups by day in the timeline', () => {
    const html = render({ mode: 'timeline' })
    expect(html).toContain('row-time')
    expect(html).toContain('>Today<')
    expect(html).toContain('>Sat, Oct 3<')
  })
  it('lists only the selected day under the calendar', () => {
    const html = render({ mode: 'calendar', day: dayKey(new Date(2026, 9, 3)) })
    expect(html).toContain('October 2026')
    expect(html).toContain('old pass')
    expect(html).not.toContain('live-meeting')
  })
  it('gives every row an archive button that reads Restore for archived sessions', () => {
    expect(render().match(/row-archive" title="Archive"/g)).toHaveLength(2)
    expect(render({ sessions: [makeSession({ archived: true })] })).toContain('row-archive" title="Restore from archive"')
  })
  it('shows one dot per label after the title with the names as the tooltip, and none without labels', () => {
    const store: LabelStore = {
      list: [{ id: 'bug', name: 'Bug', color: '#eb5757' }, { id: 'inv', name: 'Investigation', color: '#4ea7fc' }],
      map: { [live.id]: ['bug', 'inv'] },
    }
    const html = render({ labels: store })
    expect(html).toContain('class="row-labels" title="Bug, Investigation"')
    expect(html).toContain('row-label-dot" style="background:#eb5757"')
    expect(html).toMatch(/row-title">live-meeting<\/span><span class="row-labels"[\s\S]*row-ago">/)
    expect(html.match(/class="row-labels"/g)).toHaveLength(1)
    expect(render()).not.toContain('row-labels')
  })
  it('makes every row draggable', () => {
    expect(render().match(/draggable="true"/g)).toHaveLength(2)
  })
  it('marks picked rows, leaving the selected one marked as selected', () => {
    const html = render({ picked: [old.id] })
    expect(html.match(/row is-picked"/g)).toHaveLength(1)
    expect(html).toMatch(/row is-picked"[\s\S]*old pass/)
    expect(render()).not.toContain('is-picked')
    const both = render({ picked: [live.id, old.id], selectedId: live.id })
    expect(both).toMatch(/row is-selected"[\s\S]*live-meeting/)
    expect(both.match(/row is-picked"/g)).toHaveLength(1)
  })
  it('says so when there is nothing to show', () => {
    expect(render({ sessions: [] })).toContain('No sessions here.')
  })
}

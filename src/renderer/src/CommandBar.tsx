import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PUBLISHED_KIND, SETTINGS_DEFAULTS, type IconName, type Session, type Settings, type Terminal } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoLong, fileSize, tildify } from '../../shared/format'
import { PANES } from '../../shared/panes'
import { detectKind, kindById, search, type Kind, type KindId, type Result } from '../../shared/search'
import { Icon } from './icons'
import { ResizeHandle } from './Resize'
import './CommandBar.css'

export interface BarOpen {
  kind: KindId
  query: string
}

export type BarAction =
  | { type: 'select'; id: string }
  | { type: 'resume'; id: string; fork: boolean }
  | { type: 'copy'; id: string; what: 'resume' | 'fork' | 'pr'; text: string }
  | { type: 'openFolder'; id: string }
  | { type: 'openPr'; id: string }
  | { type: 'showRepo'; id: string }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'rename'; id: string; title: string }
  | { type: 'terminal'; terminal: Terminal }
  | { type: 'tee'; enabled: boolean }

export interface CommandBarProps {
  open: BarOpen
  sessions: Session[]
  selected: Session | null
  settings: Settings
  now: Date
  note: string | null
  resultsWidth: number
  onResultsWidth(width: number): void
  onClose(): void
  onAction(a: BarAction): void
}

type Step = { type: 'kind'; kind: KindId; query: string } | { type: 'emit'; action: BarAction; copied?: true }

export function activate(r: Result): Step {
  switch (r.type) {
    case 'kind':
      return { type: 'kind', kind: r.kind.id, query: '' }
    case 'option':
      return { type: 'kind', kind: r.fill.kind, query: r.fill.query }
    case 'session':
      return { type: 'emit', action: { type: 'resume', id: r.session.id, fork: false } }
    case 'terminal':
      return { type: 'emit', action: { type: 'terminal', terminal: r.terminal } }
    case 'action': {
      const id = r.session.id
      switch (r.action) {
        case 'resume':
          return { type: 'emit', action: { type: 'resume', id, fork: false } }
        case 'fork':
          return { type: 'emit', action: { type: 'resume', id, fork: true } }
        case 'copy':
          return { type: 'emit', action: { type: 'copy', id, what: 'resume', text: r.detail }, copied: true }
        case 'copyPr':
          return { type: 'emit', action: { type: 'copy', id, what: 'pr', text: r.detail }, copied: true }
        case 'openFolder':
          return { type: 'emit', action: { type: 'openFolder', id } }
        case 'openPr':
          return { type: 'emit', action: { type: 'openPr', id } }
        case 'showRepo':
          return { type: 'emit', action: { type: 'showRepo', id } }
        case 'archive':
          return { type: 'emit', action: { type: 'archive', id, archived: true } }
        case 'unarchive':
          return { type: 'emit', action: { type: 'archive', id, archived: false } }
        case 'rename':
          return { type: 'kind', kind: 'rename', query: r.session.title }
        case 'changeTerminal':
          return { type: 'kind', kind: 'terminal', query: '' }
        case 'teeOn':
          return { type: 'emit', action: { type: 'tee', enabled: true } }
        case 'teeOff':
          return { type: 'emit', action: { type: 'tee', enabled: false } }
      }
    }
  }
}

const primaryVerb = (kind: KindId, cur: Result | undefined): string => {
  if (kind === 'rename') return 'Rename'
  if (!cur) return 'Resume'
  if (cur.type === 'session') return 'Resume'
  if (cur.type === 'action') return 'Run'
  return 'Choose'
}

function Preview({ cur, kind, now, onExample }: { cur: Result | undefined; kind: Kind; now: Date; onExample(e: string): void }) {
  if (cur?.type === 'session' && cur.artifact) {
    const a = cur.artifact
    return (
      <div className="pv">
        <div className="pv-head">
          <span className="pv-title">{a.name}</span>
          <span className="pv-when">{`${a.kind} · ${a.kind === PUBLISHED_KIND ? '' : `${fileSize(a.bytes)} · `}from “${cur.session.title}”`}</span>
        </div>
        <span className="pv-path">{tildify(a.path)}</span>
        {a.preview && <pre className="bar-pre">{a.preview}</pre>}
      </div>
    )
  }
  if (cur?.type === 'session') {
    const s = cur.session
    const rows: [string, string, boolean][] = [['Folder', tildify(s.cwd), true]]
    if (s.repo) rows.push(['Repo', `${s.repo.name}${s.branch && s.branch !== 'HEAD' ? ` · ${s.branch}` : ''}`, false])
    if (s.pr) rows.push(['PR', `${s.pr.repo}#${s.pr.number}`, false])
    return (
      <div className="pv">
        <div className="pv-head">
          <span className="pv-title">{s.title}</span>
          <span className="pv-when">{`${agoLong(s.end, now)} · ${fileSize(s.sizeBytes)}`}</span>
        </div>
        {cur.reason && (
          <div className="pv-reason">
            <span className="pv-reason-icon"><Icon name="Bolt" size={12} /></span>
            <span>{cur.reason}</span>
          </div>
        )}
        <div className="pv-facts">
          {rows.map(([k, v, mono]) => [
            <span key={`${k}-k`}>{k}</span>,
            <span key={`${k}-v`} className={mono ? 'mono' : undefined}>{v}</span>,
          ])}
        </div>
        {s.summary?.did && <p className="pv-prose">{s.summary.did}</p>}
      </div>
    )
  }
  if (cur?.type === 'action') {
    return (
      <div className="pv">
        <span className="pv-label">Runs on</span>
        <span className="pv-title">{cur.session.title}</span>
        <span className="pv-detail">{cur.detail}</span>
      </div>
    )
  }
  const k = cur?.type === 'kind' ? cur.kind : kind
  return (
    <div className="pv">
      <div className="pv-kind-head">
        <Icon name={k.icon} size={16} />
        <span className="pv-title">{k.label}</span>
      </div>
      <p className="pv-prose">{k.desc}</p>
      {k.examples.length > 0 && (
        <div className="pv-examples">
          <span className="pv-label">Try</span>
          {k.examples.map((e) => (
            <span
              key={e}
              className="pv-example"
              onClick={(ev) => {
                ev.stopPropagation()
                onExample(e)
              }}
            >
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommandBar(p: CommandBarProps) {
  const [kindId, setKindId] = useState<KindId>(p.open.kind)
  const [query, setQuery] = useState(p.open.query)
  const [idx, setIdx] = useState(0)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const kind = kindById(kindId)

  const groups = search(p.sessions, kindId, query, { now: p.now, selected: p.selected, settings: p.settings })
  const flat = groups.flatMap((g) => g.results)
  const cur = flat[Math.min(idx, Math.max(0, flat.length - 1))]
  const renameBlocked = kindId === 'rename' && !!p.selected?.live

  useEffect(() => {
    listRef.current?.querySelector('.bar-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const setKind = (id: KindId, q = '') => {
    setKindId(id)
    setQuery(q)
    setIdx(0)
    setCopied(false)
  }
  const run = (r: Result | undefined) => {
    if (!r) return
    const step = activate(r)
    if (step.type === 'kind') return setKind(step.kind, step.query)
    setCopied(!!step.copied)
    p.onAction(step.action)
  }
  const onEnter = () => {
    if (kindId === 'rename') {
      if (p.selected && !renameBlocked) p.onAction({ type: 'rename', id: p.selected.id, title: query })
      return
    }
    run(cur)
  }
  const onExample = (e: string) => {
    const d = detectKind(e)
    if (d) setKind(d.kind, d.rest)
    else setKind('sessions', e)
  }

  const footIcon: IconName = copied ? 'Check' : kind.icon
  const footLabel = p.note ?? (renameBlocked ? "Can't rename a running session" : copied ? 'Copied resume command' : kind.label)
  const emptyText =
    kindId === 'ask' ? 'Nothing close. Try different words or a file name.'
    : kindId === 'rename' ? (p.selected ? `Press ↵ to rename “${p.selected.title}”.` : 'Select a session first.')
    : 'No matches.'

  return (
    <div className="bar-scrim" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="bar">
        <div className="bar-input-row">
          {kindId === 'sessions' ? (
            <span className="bar-search"><Icon name="Search1" size={16} /></span>
          ) : (
            <span className="bar-chip" title="Remove search kind" onClick={() => setKind('sessions', query)}>
              <Icon name={kind.icon} size={12} />
              {kind.label}
            </span>
          )}
          <input
            className="bar-input"
            autoFocus
            value={query}
            placeholder={kindId === 'sessions' ? 'Search sessions, or type / for search kinds' : `${kind.desc.split('.')[0]}…`}
            onChange={(e) => {
              const v = e.target.value
              const d = kindId === 'sessions' ? detectKind(v) : null
              if (d) return setKind(d.kind, d.rest)
              setQuery(v)
              setIdx(0)
              setCopied(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(flat.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                onEnter()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                if (kindId !== 'sessions') setKind('sessions')
                else p.onClose()
              } else if (e.key === 'Backspace' && !query && kindId !== 'sessions') {
                e.preventDefault()
                setKind('sessions')
              }
            }}
          />
          <span className="keycap">esc</span>
        </div>
        <div className="bar-body">
          <div className="bar-results-col" style={{ width: p.resultsWidth }}>
            <ResizeHandle width={p.resultsWidth} min={PANES.pal.min} max={PANES.pal.max} defaultWidth={PANES.pal.default} label="Resize results" onWidth={p.onResultsWidth} />
            <div className="bar-results" ref={listRef}>
              {groups.map((g) => (
                <div key={g.label} className="bar-group">
                  <div className="bar-group-label">{g.label}</div>
                  {g.results.map((r) => {
                    const i = flat.indexOf(r)
                    return (
                      <div
                        key={r.key}
                        className={r === cur ? 'bar-row is-active' : 'bar-row'}
                        onMouseMove={() => {
                          if (i !== idx) setIdx(i)
                        }}
                        onClick={() => (r.type === 'session' ? p.onAction({ type: 'select', id: r.session.id }) : run(r))}
                      >
                        <span style={{ display: 'flex', color: r.iconColor }}><Icon name={r.icon} size={14} /></span>
                        <div className="bar-row-text">
                          <span className="bar-row-title">{r.title}</span>
                          {r.sub && <span className={r.mono ? 'bar-row-sub mono' : 'bar-row-sub'}>{r.sub}</span>}
                        </div>
                        {r.keycap && <span className="keycap">{r.keycap}</span>}
                        {r.right && <span className="bar-row-right">{r.right}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
              {flat.length === 0 && <div className="bar-empty">{emptyText}</div>}
            </div>
          </div>
          <div className="bar-preview">
            <Preview cur={cur} kind={kind} now={p.now} onExample={onExample} />
          </div>
        </div>
        <div className="bar-footer">
          <span className="bar-footer-item"><Icon name={footIcon} size={12} />{footLabel}</span>
          <span className="bar-footer-spacer" />
          <span className="bar-footer-item bar-footer-primary">{primaryVerb(kindId, cur)}<span className="keycap">↵</span></span>
          <span className="bar-footer-divider" />
          <span className="bar-footer-item">Search kinds<span className="keycap">/</span></span>
          <span className="bar-footer-item">Actions<span className="keycap">&gt;</span></span>
        </div>
      </div>
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = { ...SETTINGS_DEFAULTS, terminal: 'iterm' }
  const s = makeSession({
    title: 'live-meeting',
    artifacts: [{ name: 'veracity-report.md', kind: 'markdown', path: '/Users/me/code/app/r.md', bytes: 9000, preview: '# Veracity report' }],
  })
  const render = (open: BarOpen, over: Partial<CommandBarProps> = {}) =>
    renderToStaticMarkup(<CommandBar open={open} sessions={[s]} selected={s} settings={settings} now={now} note={null} resultsWidth={380} onResultsWidth={() => {}} onClose={() => {}} onAction={() => {}} {...over} />)

  it('opens on the search kinds and recent sessions with the plain search placeholder', () => {
    const html = render({ kind: 'sessions', query: '' })
    expect(html).toContain('Search sessions, or type / for search kinds')
    expect(html).toContain('>Search kinds<')
    expect(html).toContain('>Recent<')
    expect(html).toContain('>Choose<')
    expect(html).not.toContain('bar-chip')
    expect(html).toContain('class="bar-results-col" style="width:380px"')
    expect(html).toContain('aria-label="Resize results"')
  })
  it('shows the active kind as a chip with its own placeholder', () => {
    const html = render({ kind: 'files', query: '' })
    expect(html).toContain('bar-chip')
    expect(html).toContain('Find sessions by a file they changed…')
  })
  it('previews an action with the session it runs on and the exact command', () => {
    const html = render({ kind: 'actions', query: '' })
    expect(html).toContain('Actions on “live-meeting”')
    expect(html).toContain('>Runs on<')
    expect(html).toContain(`claude --resume ${s.id}`)
    expect(html).toContain('>Run<')
  })
  it('previews an artifact with its path and content', () => {
    const html = render({ kind: 'artifacts', query: 'veracity' })
    expect(html).toContain('~/code/app/r.md')
    expect(html).toContain('<pre class="bar-pre"># Veracity report</pre>')
  })
  it('previews a published claude.ai artifact with its link and no size', () => {
    const url = 'https://claude.ai/artifact/Zq7Fake9ArtifactId00'
    const pub = { ...s, artifacts: [{ name: 'Architecture', kind: 'claude.ai', path: url, bytes: 0, preview: '' }] }
    const html = render({ kind: 'artifacts', query: url }, { sessions: [pub], selected: pub })
    expect(html).toContain('claude.ai · from “live-meeting”')
    expect(html).toContain(`<span class="pv-path">${url}</span>`)
    expect(html).not.toContain('<pre')
  })
  it('says nothing is close when Ask finds no match', () => {
    expect(render({ kind: 'ask', query: 'kubernetes billing' })).toContain('Nothing close. Try different words or a file name.')
  })
  it('refuses to rename a running session and shows errors from the app in the footer', () => {
    expect(render({ kind: 'rename', query: 'x' }, { selected: { ...s, live: true } })).toContain("Can&#x27;t rename a running session")
    expect(render({ kind: 'sessions', query: '' }, { note: 'Unknown session' })).toContain('Unknown session')
  })
  it('maps each highlighted result to a kind switch or an app action', () => {
    const groups = search([s], 'actions', '', { now, selected: s, settings })
    const byAction = (id: string) => groups[0].results.find((r) => r.type === 'action' && r.action === id)!
    expect(activate(byAction('fork'))).toEqual({ type: 'emit', action: { type: 'resume', id: s.id, fork: true } })
    expect(activate(byAction('copy'))).toEqual({ type: 'emit', action: { type: 'copy', id: s.id, what: 'resume', text: `claude --resume ${s.id}` }, copied: true })
    expect(activate(byAction('rename'))).toEqual({ type: 'kind', kind: 'rename', query: 'live-meeting' })
    expect(activate(byAction('changeTerminal'))).toEqual({ type: 'kind', kind: 'terminal', query: '' })
    expect(activate(byAction('archive'))).toEqual({ type: 'emit', action: { type: 'archive', id: s.id, archived: true } })
    expect(activate(byAction('teeOn'))).toEqual({ type: 'emit', action: { type: 'tee', enabled: true } })
    const recent = search([s], 'sessions', '', { now, selected: s, settings })
    expect(activate(recent[0].results[0])).toEqual({ type: 'kind', kind: 'ask', query: '' })
    expect(activate(recent[1].results[0])).toEqual({ type: 'emit', action: { type: 'resume', id: s.id, fork: false } })
    const term = search([s], 'terminal', '', { now, selected: s, settings })[0].results[3]
    expect(activate(term)).toEqual({ type: 'emit', action: { type: 'terminal', terminal: 'warp' } })
  })
}

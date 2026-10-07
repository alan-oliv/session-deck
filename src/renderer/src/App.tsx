import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prCommand, resumeCommand, type Session, type Settings } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { clampPane, PANES_KEY, paneMax, readPaneWidths, type PaneKey, type PaneWidths } from '../../shared/panes'
import type { ResumeAction } from '../../shared/resume'
import { buildTree, defaultExpanded, inScope, scopeTitle, visible, type Scope } from '../../shared/tree'
import { byRecent, dayKey, latestDay, listForView, type ViewMode, type YearMonth } from '../../shared/views'
import { CommandBar, type BarAction, type BarOpen } from './CommandBar'
import { Detail, type CopiedKey, type DetailTab } from './Detail'
import { errorText, useNow, useSessions, useSettings } from './hooks'
import { SessionList } from './SessionList'
import { Sidebar } from './Sidebar'
import { Toast } from './Toast'
import './App.css'

const COPIED_MS = 1600
const TOAST_MS = 3000
// Static renders in tests have no window; the default window width stands in.
const windowWidth = () => (typeof window === 'undefined' ? 1360 : window.innerWidth)

function savedPanes(): PaneWidths {
  try {
    return readPaneWidths(localStorage.getItem(PANES_KEY), windowWidth())
  } catch {
    return readPaneWidths(null, windowWidth())
  }
}

type Pending = { id: string; fork: boolean; newWindow: boolean }

export function App() {
  const sessions = useSessions()
  const settings = useSettings()
  const now = useNow()
  return sessions && settings ? <Deck all={sessions} settings={settings} now={now} /> : <div className="app-loading" />
}

export function Deck({ all, settings, now }: { all: Session[]; settings: Settings; now: Date }) {
  const shown = useMemo(() => byRecent(visible(all)), [all])
  const tree = useMemo(() => buildTree(shown), [shown])
  const [scope, setScope] = useState<Scope>({ type: 'all' })
  const [expanded, setExpanded] = useState<Record<string, boolean> | null>(null)
  const [mode, setMode] = useState<ViewMode>('list')
  const [month, setMonth] = useState<YearMonth | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bar, setBar] = useState<{ open: BarOpen; seq: number; pending?: Pending } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState<CopiedKey | null>(null)
  const [panes, setPanes] = useState<PaneWidths>(savedPanes)
  const [winWidth, setWinWidth] = useState(windowWidth)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [focus, setFocus] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const barSeq = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const open = expanded ?? defaultExpanded(tree)
  const viewMode: ViewMode = scope.type === 'all' ? mode : 'list'
  const scoped = shown.filter((s) => inScope(s, scope))
  const latest = latestDay(scoped)
  const calMonth = month ?? (latest ? { year: latest.getFullYear(), month: latest.getMonth() } : { year: now.getFullYear(), month: now.getMonth() })
  const calDay = day ?? (latest ? dayKey(latest) : null)
  const listed = listForView(scoped, viewMode, calDay)
  const selected = all.find((s) => s.id === selectedId) ?? listed[0] ?? null
  // Exit focus lives in the detail pane, so with nothing selected the tree and list come back.
  if (focus && !selected) setFocus(false)
  // Membership, not order: live sessions reorder constantly and must not drop a selection made from the bar.
  const listKey = listed.map((s) => s.id).sort().join(',')

  useEffect(() => {
    if (selectedId && !listed.some((s) => s.id === selectedId)) setSelectedId(null)
  }, [listKey])

  useEffect(() => {
    // Re-clamp the stored widths too, or a narrowing window squeezes the detail pane under its floor.
    const onResize = () => {
      setWinWidth(window.innerWidth)
      setPanes((p) => readPaneWidths(JSON.stringify(p), window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(panes))
    } catch {
      // Storage unavailable: the widths just reset on the next launch.
    }
  }, [panes])

  const setPane = (k: PaneKey) => (w: number) =>
    setPanes((p) => ({ ...p, [k]: clampPane(k, w, k === 'side' ? p.list : k === 'list' ? p.side : 0, winWidth) }))

  // The pending resume lives in the bar so dismissing the "Resume in" picker discards it.
  const openBar = (o: BarOpen, pending?: Pending) => {
    const seq = ++barSeq.current
    setNote(null)
    setBar({ open: o, seq, pending })
  }
  const closeBar = () => setBar(null)
  // Async callers may run after closeBar() from a stale render, so never read `bar` here.
  const fail = (e: unknown) => {
    const seq = ++barSeq.current
    setBar((b) => b ?? { open: { kind: 'sessions', query: '' }, seq })
    setNote(errorText(e))
  }
  // Detail-pane actions report here; a toast needs no bar to be open.
  const showToast = (text: string) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }
  const report = (e: unknown) => showToast(errorText(e))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        const seq = ++barSeq.current
        setNote(null)
        setBar((b) => (b ? null : { open: { kind: 'sessions', query: '' }, seq }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const flash = (key: CopiedKey) => {
    setCopied(key)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), COPIED_MS)
  }
  const copy = (id: string, what: CopiedKey['what'], text: string) => {
    void navigator.clipboard.writeText(text).then(() => flash({ id, what }), report)
  }
  const resume = async (id: string, fork: boolean, newWindow: boolean) => {
    try {
      const r = await window.api.resumeSession(id, { fork, newWindow })
      if (r.ok) return
      if ('needsTerminal' in r) return openBar({ kind: 'terminal', query: '' }, { id, fork, newWindow })
      flash({ id, what: fork ? 'fork' : 'resume' })
      showToast(`Couldn't open the terminal, so the command was copied. ${r.error}`)
    } catch (e) {
      report(e)
    }
  }
  const call = async (fn: () => Promise<unknown>, after?: () => void) => {
    try {
      await fn()
      after?.()
    } catch (e) {
      fail(e)
    }
  }
  const startRename = (id: string) => {
    setSelectedId(id)
    setDetailTab('overview')
    setMenuOpenId(null)
    setRenamingId(id)
  }
  const rename = async (s: Session, title: string | null) => {
    setRenamingId(null)
    if (!title || title === s.title) return
    try {
      await window.api.renameSession(s.id, title)
      showToast(`Renamed. Resume with claude --resume "${title}"`)
    } catch (e) {
      report(e)
    }
  }
  const onResumeAction = (s: Session, a: ResumeAction) => {
    switch (a) {
      case 'resume':
        return void resume(s.id, false, false)
      case 'resumeWindow':
        return void resume(s.id, false, true)
      case 'fork':
        return void resume(s.id, true, false)
      case 'rename':
        return setRenamingId(s.id)
      case 'copy':
        return copy(s.id, 'resume', resumeCommand(s.id, false))
      case 'openFolder':
        return void window.api.openFolder(s.id).catch(report)
    }
  }

  const onAction = async (a: BarAction) => {
    setNote(null)
    switch (a.type) {
      case 'select':
        setSelectedId(a.id)
        return closeBar()
      case 'resume':
        setSelectedId(a.id)
        closeBar()
        return resume(a.id, a.fork, false)
      case 'copy':
        return copy(a.id, a.what, a.text)
      case 'openFolder':
        return call(() => window.api.openFolder(a.id), closeBar)
      case 'openPr':
        return call(() => window.api.openPr(a.id), closeBar)
      case 'showRepo': {
        const s = all.find((x) => x.id === a.id)
        if (s?.repo) {
          setScope({ type: 'repo', repo: s.repo.root })
          setExpanded({ ...open, [s.repo.root]: true })
        }
        return closeBar()
      }
      case 'archive':
        return call(() => window.api.setArchived(a.id, a.archived), closeBar)
      case 'startRename':
        closeBar()
        return startRename(a.id)
      case 'tee':
        return call(() => window.api.setStatusTee(a.enabled), closeBar)
      case 'terminal': {
        const p = bar?.pending
        return call(
          () => window.api.saveSettings({ terminal: a.terminal }),
          () => {
            closeBar()
            if (p) void resume(p.id, p.fork, p.newWindow)
          },
        )
      }
    }
  }

  return (
    <div className="app">
      {!selected && <div className="app-drag" style={{ left: panes.side + panes.list }} />}
      {!focus && (
        <Sidebar
          tree={tree}
          scope={scope}
          expanded={open}
          width={panes.side}
          maxWidth={paneMax('side', panes.list, winWidth)}
          onWidth={setPane('side')}
          onScope={setScope}
          onToggle={(root) => setExpanded({ ...open, [root]: !open[root] })}
        />
      )}
      {!focus && (
        <SessionList
          title={scopeTitle(scope, tree)}
          width={panes.list}
          maxWidth={paneMax('list', panes.side, winWidth)}
          onWidth={setPane('list')}
          sessions={scoped}
          showModes={scope.type === 'all'}
          mode={viewMode}
          onMode={setMode}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onOpenBar={() => openBar({ kind: 'sessions', query: '' })}
          now={now}
          month={calMonth}
          day={calDay}
          onMonth={setMonth}
          onDay={setDay}
        />
      )}
      {selected ? (
        <Detail
          session={selected}
          now={now}
          copied={copied}
          teeOn={settings.statusTee}
          tab={detailTab}
          focus={focus}
          onTab={setDetailTab}
          onFocus={() => setFocus(!focus)}
          menuOpen={menuOpenId === selected.id}
          onMenuToggle={() => setMenuOpenId(menuOpenId === selected.id ? null : selected.id)}
          onMenuClose={() => setMenuOpenId(null)}
          onResumeAction={(a) => onResumeAction(selected, a)}
          renaming={renamingId === selected.id}
          onStartRename={() => setRenamingId(selected.id)}
          onRename={(title) => void rename(selected, title)}
          onCopyPr={() => selected.pr && copy(selected.id, 'pr', prCommand(selected.pr.number))}
          onEnableTee={() => void call(() => window.api.setStatusTee(true))}
        />
      ) : (
        <main className="detail" />
      )}
      {bar && (
        <CommandBar
          key={bar.seq}
          open={bar.open}
          sessions={all}
          selected={selected}
          settings={settings}
          now={now}
          note={note}
          resultsWidth={panes.pal}
          onResultsWidth={setPane('pal')}
          onClose={closeBar}
          onAction={(a) => void onAction(a)}
        />
      )}
      {toast && <Toast text={toast} />}
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = { terminal: null, archived: [], statusTee: false }
  it('shows the tree, the list with its view switcher and the newest session in the detail pane', () => {
    const newest = makeSession({ title: 'live-meeting', end: new Date(2026, 9, 6, 9, 12).toISOString() })
    const older = makeSession({ title: 'perf pass', end: new Date(2026, 9, 5).toISOString() })
    const html = renderToStaticMarkup(<Deck all={[older, newest, makeSession({ title: 'sdk run', hidden: true })]} settings={settings} now={now} />)
    expect(html).toContain('All sessions')
    expect(html).toContain('class="modes"')
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('>2 sessions<')
    expect(html).not.toContain('sdk run')
  })
  it('shows the empty list, no detail, and the tree and list at their default widths with the drag strip after them', () => {
    const html = renderToStaticMarkup(<Deck all={[]} settings={settings} now={now} />)
    expect(html).toContain('No sessions here.')
    expect(html).not.toContain('<h2')
    expect(html).toContain('class="app-drag" style="left:600px"')
    expect(html).toContain('class="sidebar" style="width:220px"')
    expect(html).toContain('class="list" style="width:380px"')
  })
  it('renders the detail tab bar on Overview for the selected session', () => {
    const html = renderToStaticMarkup(<Deck all={[makeSession({ title: 'live-meeting' })]} settings={settings} now={now} />)
    expect(html).toContain('tab is-active">Overview<')
    expect(html).toContain('>Focus<')
    expect(html).not.toContain('app-drag')
    expect(html).toContain('title="More ways to resume"')
    expect(html).not.toContain('class="toast"')
  })
}

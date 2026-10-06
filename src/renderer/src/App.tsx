import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prCommand, resumeCommand, type Session, type Settings } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { buildTree, defaultExpanded, inScope, scopeTitle, visible, type Scope } from '../../shared/tree'
import { byRecent, dayKey, latestDay, listForView, type ViewMode, type YearMonth } from '../../shared/views'
import { CommandBar, type BarAction, type BarOpen } from './CommandBar'
import { Detail, type CopiedKey } from './Detail'
import { errorText, useNow, useSessions, useSettings } from './hooks'
import { SessionList } from './SessionList'
import { clampSidebarWidth, Sidebar, SIDEBAR_WIDTH } from './Sidebar'
import './App.css'

const COPIED_MS = 1600
// Must match .list's width in SessionList.css: the detail pane's drag strip starts where the list ends.
const LIST_WIDTH = 380
const SIDEBAR_KEY = 'sidebarWidth'

function savedSidebarWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_KEY))
    return n > 0 ? clampSidebarWidth(n) : SIDEBAR_WIDTH
  } catch {
    return SIDEBAR_WIDTH
  }
}

type Pending = { id: string; fork: boolean }

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
  const [sidebarWidth, setSidebarWidth] = useState(savedSidebarWidth)
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
  // Membership, not order: live sessions reorder constantly and must not drop a selection made from the bar.
  const listKey = listed.map((s) => s.id).sort().join(',')

  useEffect(() => {
    if (selectedId && !listed.some((s) => s.id === selectedId)) setSelectedId(null)
  }, [listKey])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth))
    } catch {
      // Storage unavailable: the width just resets on the next launch.
    }
  }, [sidebarWidth])

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
    void navigator.clipboard.writeText(text).then(() => flash({ id, what }), fail)
  }
  const resume = async (id: string, fork: boolean) => {
    try {
      const r = await window.api.resumeSession(id, { fork })
      if (r.ok) return
      if ('needsTerminal' in r) return openBar({ kind: 'terminal', query: '' }, { id, fork })
      flash({ id, what: fork ? 'fork' : 'resume' })
      fail(new Error(`Couldn't open the terminal, so the command was copied. ${r.error}`))
    } catch (e) {
      fail(e)
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

  const onAction = async (a: BarAction) => {
    setNote(null)
    switch (a.type) {
      case 'select':
        setSelectedId(a.id)
        return closeBar()
      case 'resume':
        setSelectedId(a.id)
        closeBar()
        return resume(a.id, a.fork)
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
      case 'rename':
        return call(() => window.api.renameSession(a.id, a.title), closeBar)
      case 'tee':
        return call(() => window.api.setStatusTee(a.enabled), closeBar)
      case 'terminal': {
        const p = bar?.pending
        return call(
          () => window.api.saveSettings({ terminal: a.terminal }),
          () => {
            closeBar()
            if (p) void resume(p.id, p.fork)
          },
        )
      }
    }
  }

  return (
    <div className="app">
      <div className="app-drag" style={{ left: sidebarWidth + LIST_WIDTH }} />
      <Sidebar
        tree={tree}
        scope={scope}
        expanded={open}
        width={sidebarWidth}
        onWidth={setSidebarWidth}
        onScope={setScope}
        onToggle={(root) => setExpanded({ ...open, [root]: !open[root] })}
      />
      <SessionList
        title={scopeTitle(scope, tree)}
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
      {selected ? (
        <Detail
          session={selected}
          now={now}
          copied={copied}
          teeOn={settings.statusTee}
          onResume={() => void resume(selected.id, false)}
          onCopy={() => copy(selected.id, 'resume', resumeCommand(selected.id, false))}
          onFork={() => void resume(selected.id, true)}
          onOpenFolder={() => void call(() => window.api.openFolder(selected.id))}
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
          onClose={closeBar}
          onAction={(a) => void onAction(a)}
        />
      )}
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
  it('shows the empty list and no detail when there are no sessions', () => {
    const html = renderToStaticMarkup(<Deck all={[]} settings={settings} now={now} />)
    expect(html).toContain('No sessions here.')
    expect(html).not.toContain('<h2')
  })
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prCommand, resumeCommand, SETTINGS_DEFAULTS, terminalLabel, type OpenIn, type Session, type LabelStore, type Settings, type SettingsPatch, type Terminal } from '../../shared/api'
import { appearanceVars } from '../../shared/appearance'
import { makeSession } from '../../shared/fixtures'
import { applyNewLabel, countByLabel, createLabel, deleteLabel, deleteToastText, moveLabel, NO_LABELS, recolorLabel, renameLabel, toggleLabel } from '../../shared/labels'
import { clampPane, PANES_KEY, paneMax, readPaneWidths, type PaneKey, type PaneWidths } from '../../shared/panes'
import { archivedOf, buildChips, buildTree, inScope, scopeTitle, sessionProject, visible, type Scope } from '../../shared/tree'
import { byRecent, dayKey, latestDay, listForView, type ViewMode, type YearMonth } from '../../shared/views'
import { CommandBar, type BarAction, type BarOpen } from './CommandBar'
import { Detail, type CopiedKey, type DetailTab } from './Detail'
import { errorText, useLabels, useNow, useSessions, useSettings, useUpdate } from './hooks'
import { SessionList } from './SessionList'
import { SettingsModal } from './Settings'
import { Sidebar } from './Sidebar'
import './App.css'

const COPIED_MS = 1600
const TOAST_MS = 2400
// Static renders in tests have no window; the default window width stands in.
const windowWidth = () => (typeof window === 'undefined' ? 1360 : window.innerWidth)

function savedPanes(): PaneWidths {
  try {
    return readPaneWidths(localStorage.getItem(PANES_KEY), windowWidth())
  } catch {
    return readPaneWidths(null, windowWidth())
  }
}

type Pending = { id: string; fork: boolean }
type Toast = { text: string; undo(): void }
const LABEL_TOAST_MS = 5000

export function App() {
  const sessions = useSessions()
  const settings = useSettings()
  const labels = useLabels()
  const update = useUpdate()
  const now = useNow()
  const [installed, setInstalled] = useState<Terminal[] | null>(null)
  useEffect(() => {
    window.api.listTerminals().then(setInstalled, (e) => console.error(e))
  }, [])
  useEffect(() => {
    if (!settings) return
    for (const [k, v] of Object.entries(appearanceVars(settings))) document.documentElement.style.setProperty(k, v)
  }, [settings?.accent, settings?.opacity])
  return sessions && settings && installed && labels ? <Deck all={sessions} settings={settings} installed={installed} now={now} labels={labels} update={update} /> : <div className="app-loading" />
}

export function Deck({ all, settings, installed, now, labels, update }: { all: Session[]; settings: Settings; installed: Terminal[]; now: Date; labels: LabelStore; update?: string | null }) {
  const shown = useMemo(() => byRecent(visible(all)), [all])
  const archived = useMemo(() => byRecent(archivedOf(all)), [all])
  const tree = useMemo(() => buildTree(shown, archived.length, labels), [shown, archived, labels])
  const [scope, setScope] = useState<Scope>({ type: 'all' })
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(!settings.onboarded)
  const [toast, setToast] = useState<Toast | null>(null)
  const barSeq = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Label edits build on the last store sent, not the prop: the prop only catches up after save, broadcast and
  // getLabels, so two quick edits would both start from the same old store and the second would drop the first.
  const latestLabels = useRef(labels)
  const savingLabels = useRef(0)
  useEffect(() => {
    if (!savingLabels.current) latestLabels.current = labels
  }, [labels])

  const viewMode: ViewMode = scope.type === 'all' ? mode : 'list'
  const scoped = scope.type === 'archived' ? archived : shown.filter((s) => inScope(s, scope, labels))
  const labelCounts = useMemo(() => countByLabel(labels, all.filter((s) => !s.hidden)), [labels, all])
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

  const toggleSettings = () => {
    setBar(null)
    setSettingsOpen((o) => !o)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (setupOpen) return
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        toggleSettings()
      } else if (e.key === 'Escape' && settingsOpen) {
        // Capture phase, so the command bar's own Esc never runs under the modal.
        e.preventDefault()
        e.stopPropagation()
        setSettingsOpen(false)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p' && !settingsOpen) {
        e.preventDefault()
        const seq = ++barSeq.current
        setNote(null)
        setBar((b) => (b ? null : { open: { kind: 'sessions', query: '' }, seq }))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [settingsOpen, setupOpen])

  const flash = (key: CopiedKey) => {
    setCopied(key)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), COPIED_MS)
  }
  const showToast = (t: Toast, ms: number) => {
    setToast(t)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }
  const copy = (id: string, what: CopiedKey['what'], text: string) => {
    void navigator.clipboard.writeText(text).then(() => flash({ id, what }), fail)
  }
  const resume = async (id: string, fork: boolean, open?: OpenIn) => {
    try {
      const r = await window.api.resumeSession(id, { fork, open })
      if (r.ok) return flash({ id, what: fork ? 'forked' : 'resumed' })
      flash({ id, what: fork ? 'fork' : 'resume' })
      fail(new Error(r.message))
    } catch (e) {
      fail(e)
    }
  }
  const archive = (s: Session, archived: boolean) =>
    void call(
      () => window.api.setArchived(s.id, archived),
      () =>
        showToast(
          {
            text: `${archived ? 'Archived' : 'Restored'} “${s.title}”`,
            undo: () =>
              void call(
                () => window.api.setArchived(s.id, !archived),
                () => {
                  clearTimeout(toastTimer.current)
                  setToast(null)
                  setSelectedId(s.id)
                },
              ),
          },
          TOAST_MS,
        ),
    )
  const saveSettings = (patch: SettingsPatch) => void call(() => window.api.saveSettings(patch))
  const terminal = settings.terminal && installed.includes(settings.terminal) ? settings.terminal : null
  const terminalName = terminal ? terminalLabel(terminal) : 'your terminal'
  const call = async (fn: () => Promise<unknown>, after?: () => void) => {
    try {
      await fn()
      after?.()
    } catch (e) {
      fail(e)
    }
  }
  const saveLabels = (edit: (store: LabelStore) => LabelStore | null, after?: () => void) => {
    const base = latestLabels.current
    const next = edit(base)
    if (!next) return
    latestLabels.current = next
    savingLabels.current++
    void call(async () => {
      try {
        const saved = await window.api.saveLabels(next)
        if (latestLabels.current === next) latestLabels.current = saved
      } catch (e) {
        if (latestLabels.current === next) latestLabels.current = base
        throw e
      } finally {
        savingLabels.current--
      }
    }, after)
  }
  const deleteLabelWithUndo = (id: string) => {
    const prev = latestLabels.current
    const gone = prev.list.find((l) => l.id === id)
    if (!gone) return
    const r = deleteLabel(prev, id)
    saveLabels(() => r.store, () => {
      if (scope.type === 'label' && scope.id === id) setScope({ type: 'all' })
      showToast({ text: deleteToastText(gone.name, r.sessions), undo: () => saveLabels(() => prev, () => setToast(null)) }, LABEL_TOAST_MS)
    })
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
        if (s?.repo) setScope({ type: 'repo', repo: s.repo.root })
        return closeBar()
      }
      case 'archive': {
        const s = all.find((x) => x.id === a.id)
        closeBar()
        return s && archive(s, a.archived)
      }
      case 'rename':
        return call(() => window.api.renameSession(a.id, a.title), closeBar)
      case 'tee':
        return call(() => window.api.setStatusTee(a.enabled), closeBar)
      case 'label':
        return saveLabels((l) => toggleLabel(l, a.id, a.labelId), closeBar)
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
      {!selected && <div className="app-drag" style={{ left: panes.side + panes.list }} />}
      {!focus && (
        <Sidebar
          tree={tree}
          scope={scope}
          current={selected ? sessionProject(selected) : null}
          width={panes.side}
          maxWidth={paneMax('side', panes.list, winWidth)}
          onWidth={setPane('side')}
          onScope={setScope}
          settingsOpen={settingsOpen}
          onSettings={toggleSettings}
          onLabelCreate={(name) => saveLabels((l) => createLabel(l, name)?.store ?? null)}
          onLabelDelete={deleteLabelWithUndo}
          onLabelRename={(id, name) => saveLabels((l) => renameLabel(l, id, name))}
          onLabelColor={(id, color) => saveLabels((l) => recolorLabel(l, id, color))}
          onLabelMove={(id, before) => saveLabels((l) => moveLabel(l, id, before))}
        />
      )}
      {!focus && (
        <SessionList
          title={scopeTitle(scope, tree)}
          width={panes.list}
          maxWidth={paneMax('list', panes.side, winWidth)}
          onWidth={setPane('list')}
          sessions={scoped}
          chips={buildChips(shown, scope)}
          scope={scope}
          onScope={setScope}
          showModes={scope.type === 'all'}
          mode={viewMode}
          onMode={setMode}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onArchive={(s) => archive(s, !s.archived)}
          onOpenBar={() => openBar({ kind: 'sessions', query: '' })}
          now={now}
          month={calMonth}
          day={calDay}
          onMonth={setMonth}
          onDay={setDay}
          labels={labels}
        />
      )}
      {selected ? (
        <Detail
          session={selected}
          now={now}
          copied={copied}
          teeOn={settings.statusTee}
          open={settings.open}
          skip={settings.skipPermissions}
          terminalName={terminalName}
          tab={detailTab}
          focus={focus}
          onTab={setDetailTab}
          onFocus={() => setFocus(!focus)}
          onResume={(open) => void resume(selected.id, false, open)}
          onCopy={() => copy(selected.id, 'resume', resumeCommand(selected.id, false, settings.skipPermissions))}
          onFork={() => void resume(selected.id, true)}
          onRename={(title) => void call(() => window.api.renameSession(selected.id, title))}
          onOpenFolder={() => void call(() => window.api.openFolder(selected.id))}
          onCopyPr={() => selected.pr && copy(selected.id, 'pr', prCommand(selected.pr.number))}
          onEnableTee={() => void call(() => window.api.setStatusTee(true))}
          onArchive={() => archive(selected, !selected.archived)}
          labels={labels}
          labelCounts={labelCounts}
          onToggleLabel={(labelId) => saveLabels((l) => toggleLabel(l, selected.id, labelId))}
          onCreateLabel={(name) => saveLabels((l) => applyNewLabel(l, selected.id, name))}
        />
      ) : (
        <main className="detail" />
      )}
      {bar && (
        <CommandBar
          key={bar.seq}
          open={bar.open}
          sessions={all}
          settings={settings}
          labels={labels}
          now={now}
          note={note}
          resultsWidth={panes.pal}
          onResultsWidth={setPane('pal')}
          onClose={closeBar}
          onAction={(a) => void onAction(a)}
        />
      )}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          <button type="button" className="toast-undo" onClick={toast.undo}>Undo</button>
        </div>
      )}
      {update && (
        <div className="toast update-toast">
          <span>{`Version ${update} is ready`}</span>
          <button type="button" className="toast-undo" onClick={() => void call(() => window.api.installUpdate())}>Restart to update</button>
        </div>
      )}
      {settingsOpen && <SettingsModal settings={settings} installed={installed} onChange={saveSettings} onRerunSetup={() => { setSettingsOpen(false); setSetupOpen(true) }} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = SETTINGS_DEFAULTS
  const installed: Terminal[] = ['terminal']
  it('offers a restart only when an update has been downloaded', () => {
    const deck = (update?: string | null) => renderToStaticMarkup(<Deck all={[makeSession({ title: 'perf pass' })]} settings={settings} installed={installed} now={now} labels={NO_LABELS} update={update} />)
    expect(deck('0.2.0')).toContain('Version 0.2.0 is ready')
    expect(deck('0.2.0')).toContain('Restart to update')
    expect(deck(null)).not.toContain('Restart to update')
    expect(deck()).not.toContain('Restart to update')
  })
  it('shows the sidebar, the list with its view switcher and the newest session in the detail pane', () => {
    const newest = makeSession({ title: 'live-meeting', end: new Date(2026, 9, 6, 9, 12).toISOString() })
    const older = makeSession({ title: 'perf pass', end: new Date(2026, 9, 5).toISOString() })
    const html = renderToStaticMarkup(<Deck all={[older, newest, makeSession({ title: 'sdk run', hidden: true })]} settings={settings} installed={installed} now={now} labels={NO_LABELS} />)
    expect(html).toContain('All sessions')
    expect(html).toContain('class="modes"')
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('>2 sessions<')
    expect(html).not.toContain('sdk run')
  })
  it('shows the empty list, no detail, and the sidebar and list at their default widths with the drag strip after them', () => {
    const html = renderToStaticMarkup(<Deck all={[]} settings={settings} installed={installed} now={now} labels={NO_LABELS} />)
    expect(html).toContain('No sessions here.')
    expect(html).not.toContain('<h2')
    expect(html).toContain('class="app-drag" style="left:600px"')
    expect(html).toContain('class="sidebar" style="width:220px"')
    expect(html).toContain('class="list" style="width:380px"')
  })
  it('lists archived sessions only under the Archived scope and keeps the count in the sidebar', () => {
    const kept = makeSession({ title: 'kept' })
    const gone = makeSession({ title: 'put away', archived: true })
    const html = renderToStaticMarkup(<Deck all={[kept, gone]} settings={settings} installed={installed} now={now} labels={NO_LABELS} />)
    expect(html).toContain('>Archived</span><span class="side-count">1<')
    expect(html).toContain('>1 session<')
    expect(html).not.toContain('put away')
  })
  it('renders the detail tab bar on Overview for the selected session', () => {
    const html = renderToStaticMarkup(<Deck all={[makeSession({ title: 'live-meeting' })]} settings={settings} installed={installed} now={now} labels={NO_LABELS} />)
    expect(html).toContain('tab is-active">Overview<')
    expect(html).toContain('>Focus<')
    expect(html).not.toContain('app-drag')
  })
  it('shows label dots on rows and the Labels row in the detail pane', () => {
    const s = makeSession({ title: 'tagged' })
    const labels: LabelStore = { list: [{ id: 'bug', name: 'Bug', color: '#eb5757' }], map: { [s.id]: ['bug'] } }
    const html = renderToStaticMarkup(<Deck all={[s]} settings={settings} installed={installed} now={now} labels={labels} />)
    expect(html).toContain('class="row-labels" title="Bug"')
    expect(html).toContain('lbl-chip" title="Change labels"')
    expect(html).toMatch(/side-label">Bug<\/span><span class="side-count">1</)
  })
  it('counts a label only over the sessions that carry it while the list keeps all sessions', () => {
    const a = makeSession({ title: 'with label' })
    const b = makeSession({ title: 'without' })
    const labels: LabelStore = { list: [{ id: 'bug', name: 'Bug', color: '#eb5757' }], map: { [a.id]: ['bug'] } }
    const html = renderToStaticMarkup(<Deck all={[a, b]} settings={settings} installed={installed} now={now} labels={labels} />)
    expect(html).toMatch(/side-label">Bug<\/span><span class="side-count">1</)
    expect(html).toContain('>2 sessions<')
  })
}

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OpenIn, Session, Status, Transcript as TranscriptData } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoLong, fileSize, modelLabel, monthDay, plural, tildify } from '../../shared/format'
import { errorText } from './hooks'
import { Icon } from './icons'
import { ResumeMenu } from './ResumeMenu'
import { Transcript } from './Transcript'
import { Usage, tiles } from './Usage'
import './Detail.css'

export interface CopiedKey {
  id: string
  what: 'resume' | 'fork' | 'pr' | 'resumed' | 'forked'
}

export type DetailTab = 'overview' | 'transcript'

export interface DetailProps {
  session: Session
  now: Date
  copied: CopiedKey | null
  teeOn: boolean
  open: OpenIn
  terminalName: string
  tab: DetailTab
  focus: boolean
  onTab(tab: DetailTab): void
  onFocus(): void
  onResume(open?: OpenIn): void
  onCopy(): void
  onFork(): void
  onRename(title: string): void
  onOpenFolder(): void
  onCopyPr(): void
  onEnableTee(): void
  onArchive(): void
}

const RENAME_HINT = 'Enter to save · Esc to cancel. A name lets you resume from any folder with claude --resume <name>.'

function RenameField({ title, onDone }: { title: string; onDone(title: string | null): void }) {
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  const commit = () => onDone(value.trim() && value.trim() !== title ? value.trim() : null)
  return (
    <div className="rename">
      <input
        ref={input}
        className="rename-input"
        value={value}
        placeholder="Session name"
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onDone(null)
          }
        }}
      />
      <span className="rename-hint">{RENAME_HINT}</span>
    </div>
  )
}

const DAY_MS = 86_400_000

// Why the row has a dot, and why Needs you lists it: waiting and failed need a hand, running and interrupted just explain the dot.
const STATUS_NOTE: Partial<Record<Status, string>> = {
  running: 'Running in an open terminal right now.',
  waiting: 'Waiting for you: Claude is blocked on a question or a permission prompt in an open terminal.',
  interrupted: 'You stopped the last reply with Esc. Resume to pick it up.',
  failed: 'The last reply ended in an API error, so Claude never finished. Resume to retry it.',
}

export function facts(s: Session): { k: string; v: string; mono: boolean }[] {
  const out = [{ k: 'Folder', v: `${tildify(s.cwd)}${!s.cwdExists && !s.worktree ? ' (removed)' : ''}`, mono: true }]
  const note = STATUS_NOTE[s.status]
  if (note) out.unshift({ k: 'Status', v: note, mono: false })
  if (s.repo) out.push({ k: 'Repository', v: `${s.repo.name}${s.branch && s.branch !== 'HEAD' ? ` · ${s.branch}` : ''}`, mono: false })
  if (s.worktree) {
    const gone = s.worktree.removedSeen ? ` (removed ${monthDay(new Date(s.worktree.removedSeen))})` : ''
    out.push({ k: 'Worktree', v: `${s.worktree.name}${gone}`, mono: false })
  }
  if (s.pr) out.push({ k: 'Pull request', v: `${s.pr.repo}#${s.pr.number}`, mono: false })
  out.push({
    k: 'Title',
    v: s.named ? 'Named. Resumes by name from any folder.' : 'Generated from the first prompt. Rename to resume it by name.',
    mono: false,
  })
  if (s.forks) out.push({ k: 'Forks', v: `${s.forks} ${s.forks === 1 ? 'branch' : 'branches'} of this conversation`, mono: false })
  if (s.usage.contextUsed > 100_000) {
    out.push({ k: 'Resuming', v: 'Over 100k tokens. After an hour idle, Claude offers to continue from a summary.', mono: false })
  }
  const days = Math.round((Date.parse(s.keptUntil) - Date.parse(s.end)) / DAY_MS)
  out.push({ k: 'Kept until', v: `${monthDay(new Date(s.keptUntil))}, then deleted by the ${days}-day cleanup`, mono: false })
  out.push({ k: 'Session ID', v: s.id, mono: true })
  return out
}

type Loaded = { id: string; transcript: TranscriptData | null; error: string | null }

// Loads once per session, and again on every change while it is live; main tails only the appended bytes.
function useTranscript(id: string, live: boolean): Loaded {
  const [state, setState] = useState<Loaded>({ id: '', transcript: null, error: null })
  useEffect(() => {
    let alive = true
    let seq = 0
    const load = () => {
      const n = ++seq
      window.api.getTranscript(id).then(
        (t) => alive && n === seq && setState({ id, transcript: t, error: null }),
        (e) => alive && n === seq && setState({ id, transcript: null, error: errorText(e) }),
      )
    }
    load()
    const off = live ? window.api.onSessionsChanged(load) : null
    return () => {
      alive = false
      off?.()
    }
  }, [id, live])
  return state.id === id ? state : { id, transcript: null, error: null }
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <span className="detail-label">{label}</span>
      {children}
    </div>
  )
}

export function Detail(p: DetailProps) {
  const s = p.session
  const copied = (what: CopiedKey['what']) => p.copied?.id === s.id && p.copied.what === what
  const { transcript, error } = useTranscript(s.id, s.live)
  const count = transcript ? transcript.turns.reduce((n, t) => n + t.items.length, 0) : null
  const tabClass = (t: DetailTab) => (p.tab === t ? 'tab is-active' : 'tab')
  const [renaming, setRenaming] = useState(false)
  const label = copied('resumed') || copied('forked') ? 'Opened' : copied('fork') ? 'Copied' : 'Resume'
  return (
    <main className="detail">
      <div className={p.focus ? 'detail-tabs is-focus' : 'detail-tabs'}>
        <span className={tabClass('overview')} onClick={() => p.onTab('overview')}>Overview</span>
        <span className={tabClass('transcript')} onClick={() => p.onTab('transcript')}>
          Transcript{count !== null && <span className="tab-count tnum">{count}</span>}
        </span>
        <span className="detail-tabs-spacer" />
        <span className="focus-btn" title={p.focus ? 'Show the tree and list again' : 'Hide the tree and list'} onClick={p.onFocus}>
          <Icon name="Expand" size={12} />
          {p.focus ? 'Exit focus' : 'Focus'}
        </span>
      </div>
      {p.tab === 'overview' ? (
        <div className="detail-body">
          <div className="detail-inner">
            <div className="detail-head">
              {renaming ? (
                <RenameField
                  key={s.id}
                  title={s.title}
                  onDone={(t) => {
                    setRenaming(false)
                    if (t) p.onRename(t)
                  }}
                />
              ) : (
                <h2 className="detail-title" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{s.title}</h2>
              )}
              <span className="detail-when">{`${agoLong(s.end, p.now)} · ${modelLabel(s.model)} · ${fileSize(s.sizeBytes)}`}</span>
            </div>
            <div className="detail-actions">
              <ResumeMenu
                session={s}
                label={label}
                open={p.open}
                terminalName={p.terminalName}
                onResume={p.onResume}
                onFork={p.onFork}
                onRename={() => setRenaming(true)}
                onCopy={p.onCopy}
                onOpenFolder={p.onOpenFolder}
                onArchive={p.onArchive}
              />
              {s.pr && (
                <span className="detail-pr" title="Copies claude --from-pr" onClick={p.onCopyPr}>
                  {copied('pr') ? 'Copied' : `All sessions for #${s.pr.number}`}
                </span>
              )}
            </div>
            <div className="facts">
              {facts(s).map((f) => (
                <Fragment key={f.k}>
                  <span className="fact-k">{f.k}</span>
                  <span className={f.mono ? 'fact-v mono' : 'fact-v'}>{f.v}</span>
                </Fragment>
              ))}
            </div>
            <Usage session={s} now={p.now} teeOn={p.teeOn} onEnableTee={p.onEnableTee} />
            {s.summary?.did && (
              <Section label="Where it stopped">
                <p className="prose">{s.summary.did}</p>
              </Section>
            )}
            {s.summary && s.summary.next.length > 0 && (
              <Section label="Next">
                {s.summary.next.map((n) => (
                  <span key={n} className="prose">{n}</span>
                ))}
              </Section>
            )}
            {s.files.length > 0 && (
              <Section label={`${plural(s.files.length, 'file')} changed`}>
                {s.files.map((f) => (
                  <div key={f.path} className="file">
                    <span className="file-path mono">{f.path}</span>
                    <span className="file-delta tnum">{`+${f.added} −${f.removed}`}</span>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </div>
      ) : (
        <Transcript
          key={s.id}
          session={s}
          transcript={transcript}
          error={error}
          now={p.now}
          onResume={() => p.onResume()}
          loadOutput={(turn, item) => window.api.getToolOutput(s.id, turn, item)}
        />
      )}
    </main>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const pr = { repo: 'alan-oliv/meetnotes', number: 27, url: 'https://github.com/alan-oliv/meetnotes/pull/27' }
  const noop = () => {}
  const handlers = { tab: 'overview' as DetailTab, focus: false, open: 'tab' as OpenIn, terminalName: 'Ghostty', onTab: noop, onFocus: noop, onResume: noop, onCopy: noop, onFork: noop, onRename: noop, onOpenFolder: noop, onCopyPr: noop, onEnableTee: noop, onArchive: noop }

  it('shows the tab bar with Focus, and swaps the overview for the transcript tab', () => {
    const s = makeSession({ title: 'live-meeting' })
    const over = renderToStaticMarkup(<Detail session={s} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(over).toContain('tab is-active">Overview<')
    expect(over).toContain('>Focus<')
    expect(over).toContain('title="Hide the tree and list"')
    expect(over).toContain('class="detail-body"')
    expect(over).toContain('class="facts"')
    const tx = renderToStaticMarkup(<Detail session={s} now={now} copied={null} teeOn={false} {...handlers} tab="transcript" focus />)
    expect(tx).toContain('tab is-active">Transcript<')
    expect(tx).toContain('>Exit focus<')
    expect(tx).toContain('title="Show the tree and list again"')
    expect(tx).toContain('detail-tabs is-focus')
    expect(tx).toContain('class="tx"')
    expect(tx).not.toContain('class="facts"')
  })

  it('lists facts in the handoff order, skipping rows without data', () => {
    const s = makeSession({
      branch: 'live-meeting', pr, forks: 1, named: true,
      worktree: { name: 'transcriptions', path: '/w', removedSeen: new Date(2026, 9, 2).toISOString() },
    })
    expect(facts(s)).toEqual([
      { k: 'Folder', v: '~/code/app', mono: true },
      { k: 'Repository', v: 'app · live-meeting', mono: false },
      { k: 'Worktree', v: 'transcriptions (removed Oct 2)', mono: false },
      { k: 'Pull request', v: 'alan-oliv/meetnotes#27', mono: false },
      { k: 'Title', v: 'Named. Resumes by name from any folder.', mono: false },
      { k: 'Forks', v: '1 branch of this conversation', mono: false },
      { k: 'Resuming', v: 'Over 100k tokens. After an hour idle, Claude offers to continue from a summary.', mono: false },
      { k: 'Kept until', v: 'Nov 5, then deleted by the 30-day cleanup', mono: false },
      { k: 'Session ID', v: s.id, mono: true },
    ])
    const plain = facts(makeSession({ repo: null, branch: null, usage: { ...makeSession().usage, contextUsed: 5000 } })).map((f) => f.k)
    expect(plain).toEqual(['Folder', 'Title', 'Kept until', 'Session ID'])
  })
  it('leads with a Status row that explains the dot, for every status but completed', () => {
    expect(facts(makeSession({ status: 'failed' }))[0]).toEqual({ k: 'Status', v: 'The last reply ended in an API error, so Claude never finished. Resume to retry it.', mono: false })
    expect(facts(makeSession({ status: 'waiting' }))[0].v).toContain('blocked on a question or a permission prompt')
    expect(facts(makeSession({ status: 'interrupted' }))[0].v).toContain('Esc')
    expect(facts(makeSession({ status: 'running' }))[0].k).toBe('Status')
    expect(facts(makeSession({ status: 'completed' }))[0].k).toBe('Folder')
  })
  it('fills the four tile rows the way the prototype does', () => {
    expect(tiles(makeSession()).map((r) => r.map((t) => `${t.k}=${t.v}${t.sub ? ` ${t.sub}` : ''}`))).toEqual([
      ['In=150', 'Out=190.9k', 'Total=14.2M'],
      ['Cache hit=99.2%', 'Cache read=260.8k 99.2%', 'Cache write=2.2k 0.8%'],
      ['Cost=$5.08', 'Duration=40m', 'Lines=+524 −131'],
      ['Mode=Bypass permissions', 'Compactions=0', 'Agents=3'],
    ])
    const styled = makeSession({ usage: { ...makeSession().usage, outputStyle: 'architecture' } })
    expect(tiles(styled)[3][2]).toEqual({ k: 'Output style', v: 'architecture', sub: '3 agents' })
  })
  it('renders the renamable title, the sub-line, the Resume split button and the PR link', () => {
    const html = renderToStaticMarkup(<Detail session={makeSession({ title: 'live-meeting', pr })} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(html).toContain('title="Double-click to rename">live-meeting</h2>')
    expect(html).toContain('Today, 9:12 AM · Opus 5.5 · 6.1MB')
    expect(html).toContain('rm-main" title="claude --resume ')
    expect(html).toContain('>Resume</button>')
    expect(html).toContain('>All sessions for #27<')
    expect(html).not.toContain('Copy command')
  })
  it('swaps labels after a copy or a launch', () => {
    const s = makeSession({ pr })
    const render = (what: CopiedKey['what']) => renderToStaticMarkup(<Detail session={s} now={now} copied={{ id: s.id, what }} teeOn={false} {...handlers} />)
    expect(render('pr')).toContain('>Copied<')
    expect(render('pr')).not.toContain('All sessions for #27')
    expect(render('forked')).toContain('>Opened</button>')
    expect(render('fork')).toContain('>Copied</button>')
  })
  it('shows where it stopped, what is next and the changed files', () => {
    const s = makeSession({
      summary: { did: 'Streamed partial transcripts.', next: ['Finish speaker chips'] },
      files: [{ path: 'src/live/LiveMeetingView.tsx', added: 212, removed: 18 }],
    })
    const html = renderToStaticMarkup(<Detail session={s} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(html).toContain('Where it stopped')
    expect(html).toContain('Finish speaker chips')
    expect(html).toContain('1 file changed')
    expect(html).toContain('+212 −18')
  })
  it('colours the context meter by how full it is and shows the plan line for live sessions', () => {
    const at = (used: number, extra: Partial<Session> = {}) =>
      renderToStaticMarkup(<Usage session={makeSession({ ...extra, usage: { ...makeSession().usage, contextUsed: used, ...(extra.usage ?? {}) } })} now={now} teeOn={false} onEnableTee={noop} />)
    expect(at(263_000)).toContain('var(--app-brand)')
    expect(at(650_000)).toContain('var(--app-yellow)')
    expect(at(850_000)).toContain('var(--app-orange)')
    expect(at(263_000)).toContain('263k / 1M')
    const plan = { usedPct: 32.9, resetsAt: new Date(2026, 9, 6, 15, 7).toISOString() }
    expect(at(263_000, { live: true, usage: { ...makeSession().usage, plan } })).toContain('32.9% of plan used · resets in 4h 7m')
    expect(at(263_000, { live: true })).toContain('Show plan usage')
    expect(at(263_000)).not.toContain('Show plan usage')
  })
}

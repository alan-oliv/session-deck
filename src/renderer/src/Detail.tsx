import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session, Transcript as TranscriptData } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoLong, fileSize, modelLabel, monthDay, plural, tildify } from '../../shared/format'
import { Button } from './Button'
import { errorText } from './hooks'
import { Icon } from './icons'
import { Transcript } from './Transcript'
import { Usage, tiles } from './Usage'
import './Detail.css'

export interface CopiedKey {
  id: string
  what: 'resume' | 'fork' | 'pr'
}

export type DetailTab = 'overview' | 'transcript'

export interface DetailProps {
  session: Session
  now: Date
  copied: CopiedKey | null
  teeOn: boolean
  tab: DetailTab
  focus: boolean
  onTab(tab: DetailTab): void
  onFocus(): void
  onResume(): void
  onCopy(): void
  onFork(): void
  onOpenFolder(): void
  onCopyPr(): void
  onEnableTee(): void
}

const DAY_MS = 86_400_000

export function facts(s: Session): { k: string; v: string; mono: boolean }[] {
  const out = [{ k: 'Folder', v: `${tildify(s.cwd)}${!s.cwdExists && !s.worktree ? ' (removed)' : ''}`, mono: true }]
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
              <h2 className="detail-title">{s.title}</h2>
              <span className="detail-when">{`${agoLong(s.end, p.now)} · ${modelLabel(s.model)} · ${fileSize(s.sizeBytes)}`}</span>
            </div>
            <div className="detail-actions">
              <Button kind="primary" onClick={p.onResume} title="Opens claude --resume in your terminal">Resume</Button>
              <Button kind="secondary" onClick={p.onCopy}>{copied('resume') ? 'Copied' : 'Copy command'}</Button>
              <Button kind="secondary" onClick={p.onFork} title="Opens claude --resume … --fork-session in your terminal">
                {copied('fork') ? 'Copied' : 'Fork'}
              </Button>
              {s.cwdExists && <Button kind="secondary" onClick={p.onOpenFolder}>Open folder</Button>}
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
          onResume={p.onResume}
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
  const handlers = { tab: 'overview' as DetailTab, focus: false, onTab: noop, onFocus: noop, onResume: noop, onCopy: noop, onFork: noop, onOpenFolder: noop, onCopyPr: noop, onEnableTee: noop }

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
  it('renders the title, the sub-line, the actions and the PR link', () => {
    const html = renderToStaticMarkup(<Detail session={makeSession({ title: 'live-meeting', pr })} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('Today, 9:12 AM · Opus 5.5 · 6.1MB')
    for (const label of ['Resume', 'Copy command', 'Fork', 'Open folder', 'All sessions for #27']) expect(html).toContain(`>${label}<`)
  })
  it('swaps a label to Copied for the copy that just happened', () => {
    const s = makeSession({ pr })
    const html = renderToStaticMarkup(<Detail session={s} now={now} copied={{ id: s.id, what: 'pr' }} teeOn={false} {...handlers} />)
    expect(html).toContain('>Copied<')
    expect(html).toContain('>Copy command<')
    expect(html).not.toContain('All sessions for #27')
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

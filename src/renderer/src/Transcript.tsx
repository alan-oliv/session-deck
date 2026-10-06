import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { IconName, Session, ToolItem, Transcript as TranscriptData } from '../../shared/api'
import { makeSession, makeTranscript } from '../../shared/fixtures'
import { agoLong, modelLabel, tildify } from '../../shared/format'
import { FILTERS, transcriptView, type Filter, type GroupRow, type ToolRow } from '../../shared/transcriptView'
import { Button } from './Button'
import { Icon } from './icons'
import './Transcript.css'

const TURNS_PAGE = 30
const PIN_PX = 64
const TOP_PX = 48
const ICONS: Record<string, IconName> = { Bash: 'Code', Grep: 'Search1', Glob: 'Search1', Read: 'Document', Edit: 'Edit', MultiEdit: 'Edit', Write: 'Edit2', Skill: 'Bolt' }

export const toolIcon = (tool: string): IconName => ICONS[tool] ?? 'Code'

export interface TranscriptProps {
  session: Session
  transcript: TranscriptData | null
  error: string | null
  now: Date
  onResume(): void
  loadOutput(turn: number, item: number): Promise<string[]>
}

function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          img: ({ alt }) => <span>{alt ?? ''}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

const moreNote = (n: number) => `${n} more lines in the session file`

export function DiffView({ item }: { item: ToolItem }) {
  return (
    <div className="tx-box tx-diff">
      {(item.diff ?? []).map(([n, sign, text], i) => (
        <div key={i} className={sign === '+' ? 'tx-diff-line is-add' : sign === '-' ? 'tx-diff-line is-del' : 'tx-diff-line'}>
          <span className="tx-diff-n tnum">{n}</span>
          <span className="tx-diff-sign">{sign === '+' ? '+' : sign === '-' ? '−' : ''}</span>
          <span className="tx-diff-text">{text}</span>
        </div>
      ))}
      {item.more ? <div className="tx-more tx-diff-more">{moreNote(item.more)}</div> : null}
    </div>
  )
}

function Output({ item, full }: { item: ToolItem; full: string[] | undefined }) {
  const lines = full ?? item.out ?? []
  return (
    <div className={item.err ? 'tx-box tx-out is-err' : 'tx-box tx-out'}>
      {lines.map((l, i) => <div key={i} className="tx-out-line">{l}</div>)}
      {!full && item.more ? <div className="tx-more">{moreNote(item.more)}</div> : null}
    </div>
  )
}

function ToolRowView({ row, full, onToggle }: { row: ToolRow; full: string[] | undefined; onToggle(row: ToolRow): void }) {
  const it = row.item
  const meta = it.a !== undefined ? '' : it.more ? `+${it.more} lines` : it.err ? 'failed' : ''
  return (
    <>
      <div className="tx-tool" title={it.arg} onClick={row.hasBody ? () => onToggle(row) : undefined}>
        <span className={it.err ? 'tx-tool-icon is-err' : 'tx-tool-icon'}><Icon name={toolIcon(it.tool)} size={14} /></span>
        <span className="tx-tool-name">{it.name}</span>
        <span className="tx-tool-arg mono">{it.arg}</span>
        {it.a !== undefined ? (
          <span className="tx-stat tnum"><span className="tx-add">{`+${it.a}`}</span><span className="tx-del">{`−${it.d ?? 0}`}</span></span>
        ) : meta ? (
          <span className="tx-meta">{meta}</span>
        ) : null}
        <span className="tx-chev" style={{ transform: row.open ? 'none' : 'rotate(-90deg)', opacity: row.hasBody ? 1 : 0 }}>
          <Icon name="ChevronDown2" size={10} />
        </span>
      </div>
      {row.open && row.hasBody && (
        <div className="tx-body">
          {it.diff ? <DiffView item={it} /> : it.out?.length ? <Output item={it} full={full} /> : null}
          {it.link && (
            <a className="tx-box tx-link" href={it.link} target="_blank" rel="noreferrer">
              <Icon name="Branch" size={14} />
              <span className="tx-link-url">{it.link}</span>
            </a>
          )}
        </div>
      )}
    </>
  )
}

function GroupView({ row, full, onToggle, onToggleGroup }: {
  row: GroupRow
  full: Record<string, string[]>
  onToggle(row: ToolRow): void
  onToggleGroup(row: GroupRow): void
}) {
  return (
    <>
      <div className="tx-group" onClick={() => onToggleGroup(row)}>
        <span className="tx-tool-icon"><Icon name="Layers" size={14} /></span>
        <span className="tx-tool-name">{row.label}</span>
        <span className="tx-group-sum">{row.summary}</span>
        {row.failed > 0 && <span className="tx-group-err">{`${row.failed} failed`}</span>}
        <span className="tx-chev" style={{ transform: row.open ? 'none' : 'rotate(-90deg)' }}><Icon name="ChevronDown2" size={10} /></span>
      </div>
      {row.open && (
        <div className="tx-members">
          {row.members.map((m) => <ToolRowView key={m.key} row={m} full={full[m.key]} onToggle={onToggle} />)}
        </div>
      )}
    </>
  )
}

export function Transcript(p: TranscriptProps) {
  const s = p.session
  const [filter, setFilter] = useState<Filter>('all')
  const [expandAll, setExpandAll] = useState(false)
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [full, setFull] = useState<Record<string, string[]>>({})
  const [shown, setShown] = useState(TURNS_PAGE)
  const scroll = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const grewFrom = useRef(0)
  const loading = useRef(new Set<string>())

  const view = useMemo(
    () => (p.transcript ? transcriptView(p.transcript, { filter, expandAll, openRows, openGroups }) : null),
    [p.transcript, filter, expandAll, openRows, openGroups],
  )
  const turns = view ? view.turns.slice(-shown) : []

  // Follow new items only when the reader was already at the bottom.
  useLayoutEffect(() => {
    const el = scroll.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [p.transcript])
  // Older turns were added above: keep the reader's distance from the bottom. Assigning it, not adding the
  // growth, stays right whether or not the browser's scroll anchoring already moved the view.
  useLayoutEffect(() => {
    const el = scroll.current
    if (el && grewFrom.current) {
      el.scrollTop = el.scrollHeight - grewFrom.current
      grewFrom.current = 0
    }
  }, [shown])

  const onScroll = () => {
    const el = scroll.current
    if (!el) return
    pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop <= PIN_PX
    if (el.scrollTop < TOP_PX && !grewFrom.current && view && shown < view.turns.length) {
      grewFrom.current = el.scrollHeight - el.scrollTop
      setShown((n) => n + TURNS_PAGE)
    }
  }
  const toggleRow = (row: ToolRow) => {
    setOpenRows((o) => ({ ...o, [row.key]: !row.open }))
    if (row.item.more && !row.item.diff && !full[row.key] && !loading.current.has(row.key)) {
      loading.current.add(row.key)
      p.loadOutput(row.turn, row.index)
        .then((lines) => setFull((f) => ({ ...f, [row.key]: lines })), () => {})
        .finally(() => loading.current.delete(row.key))
    }
  }
  const toggleGroup = (row: GroupRow) => setOpenGroups((o) => ({ ...o, [row.key]: !row.open }))
  const toggleAll = () => {
    setExpandAll(!expandAll)
    setOpenRows({})
    setOpenGroups({})
  }

  const meta = [p.transcript?.cli, modelLabel(s.model), s.effort && `${s.effort} effort`, tildify(s.cwd)].filter(Boolean).join(' · ')

  return (
    <div className="tx" ref={scroll} onScroll={onScroll}>
      <div className="tx-inner">
        <div className="tx-head">
          <h2 className="tx-title">{s.title}</h2>
          <span className="tx-meta-line">{meta}</span>
          {view && (
            <div className="tx-toolbar">
              <div className="seg">
                {FILTERS.map((f) => (
                  <span key={f.id} className={f.id === filter ? 'seg-item is-active' : 'seg-item'} onClick={() => setFilter(f.id)}>
                    {f.label}<span className="seg-count tnum">{view.counts[f.id]}</span>
                  </span>
                ))}
              </div>
              <span className="tx-spacer" />
              <span className="tx-text-btn" onClick={toggleAll}>{expandAll ? 'Collapse all' : 'Expand all'}</span>
            </div>
          )}
        </div>
        {p.error && <div className="tx-empty">Couldn't read the session file.</div>}
        {view?.empty && <div className="tx-empty">Nothing matches this filter.</div>}
        {turns.map((t) => (
          <div key={t.index} className="tx-turn">
            <div className="tx-divider">
              <span className="tx-divider-label">{t.label}</span>
              <span className="tx-divider-line" />
              <span className="tx-divider-meta">{t.meta}</span>
            </div>
            {t.prompt && <div className="tx-prompt">{t.prompt}</div>}
            <div className="tx-items">
              {t.rows.map((r) =>
                r.kind === 'text' ? (
                  <div key={r.key} className="tx-msg"><span className="tx-msg-dot" /><Md text={r.md} /></div>
                ) : r.kind === 'tool' ? (
                  <ToolRowView key={r.key} row={r} full={full[r.key]} onToggle={toggleRow} />
                ) : (
                  <GroupView key={r.key} row={r} full={full} onToggle={toggleRow} onToggleGroup={toggleGroup} />
                ),
              )}
            </div>
            {t.footer && <div className="tx-footer"><Icon name="ClockOutline" size={12} />{t.footer}</div>}
            {t.recap && (
              <div className="tx-box tx-recap">
                <span className="tx-recap-label">Recap</span>
                <Md text={t.recap} />
              </div>
            )}
          </div>
        ))}
        {view && (
          <div className="tx-end">
            <span className="dot" style={{ background: s.live ? 'var(--app-green)' : 'var(--app-text-3)' }} />
            <span className="tx-end-label">{s.live ? 'Waiting for your next message' : `Session ended ${agoLong(s.end, p.now)}`}</span>
            <span className="tx-spacer" />
            <Button kind="primary" onClick={p.onResume} title="Opens claude --resume in your terminal">Resume</Button>
          </div>
        )}
      </div>
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const noop = () => {}
  const load = () => Promise.resolve([] as string[])
  const session = makeSession({ title: 'live-meeting', cwd: '/Users/me/code/meetnotes' })
  const render = (over: Partial<TranscriptProps> = {}) =>
    renderToStaticMarkup(<Transcript session={session} transcript={makeTranscript()} error={null} now={now} onResume={noop} loadOutput={load} {...over} />)

  it('shows the header line, the filter counts and the turns with their rows', () => {
    const html = render()
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('Claude Code v2.1.283 · Opus 5.5 · xhigh effort · ~/code/meetnotes')
    expect(html).toContain('All<span class="seg-count tnum">8</span>')
    expect(html).toContain('Errors<span class="seg-count tnum">1</span>')
    expect(html).toContain('>Turn 1<')
    expect(html).toContain('>5 steps · 1 edit<')
    expect(html).toContain('>Bash</span>')
    expect(html).toContain('>+108 lines<')
    expect(html).toContain('>4 steps</span>')
    expect(html).toContain('Search · Bash ×2 · Update')
    expect(html).toContain('>failed<')
    expect(html).toContain('Worked for 30m 42s · done Monday 12:42 PM')
    expect(html).toContain('>Recap<')
    expect(html).toContain('<strong>PR #28</strong>')
    expect(html).toContain('>Expand all<')
  })
  it('renders assistant markdown with bullets, inline code and bold', () => {
    const html = render()
    expect(html).toContain('<code>splitForWhisper</code>')
    expect(html).toContain('<li>check the abort signal</li>')
    expect(html).toContain('<strong>Resume</strong>')
  })
  it('draws a diff as numbered lines with signs on tinted add and delete rows', () => {
    const html = renderToStaticMarkup(<DiffView item={makeTranscript().turns[0].items[4] as ToolItem} />)
    expect(html).toContain('tx-diff-line is-del')
    expect(html).toContain('tx-diff-line is-add')
    expect(html).toContain('<span class="tx-diff-n tnum">23</span><span class="tx-diff-sign">−</span>')
    expect(html).toContain('<span class="tx-diff-n tnum">23</span><span class="tx-diff-sign">+</span>')
    expect(html).toContain('signal?: AbortSignal')
  })
  it('says the session is waiting while live and when it ended otherwise, with a Resume button', () => {
    expect(render()).toContain('Session ended Today, 9:12 AM')
    expect(render({ session: makeSession({ live: true }) })).toContain('Waiting for your next message')
    expect(render()).toContain('>Resume</button>')
  })
  it('shows the read error and hides the toolbar and end bar until the transcript loads', () => {
    const html = render({ transcript: null, error: 'boom' })
    expect(html).toContain('read the session file.')
    expect(html).not.toContain('seg-count')
    expect(html).not.toContain('tx-end')
  })
  it('maps tools to their icons', () => {
    expect(['Bash', 'Grep', 'Glob', 'Read', 'Edit', 'MultiEdit', 'Write', 'Skill', 'Agent'].map(toolIcon)).toEqual([
      'Code', 'Search1', 'Search1', 'Document', 'Edit', 'Edit', 'Edit2', 'Bolt', 'Code',
    ])
  })
}

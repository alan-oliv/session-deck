import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Label, LabelStore } from '../../shared/api'
import { labelsOf, nextColor, pickerRows } from '../../shared/labels'
import { Icon } from './icons'
import './LabelPicker.css'

export interface LabelPickerProps {
  labels: Label[]
  applied: string[]
  counts: Record<string, number>
  query: string
  highlight: number
  onQuery(q: string): void
  onHighlight(i: number): void
  onToggle(id: string): void
  onCreate(name: string): void
  onClose(): void
}

export function LabelPicker(p: LabelPickerProps) {
  const { options, create } = pickerRows(p.labels, p.query)
  const total = options.length + (create ? 1 : 0)
  const hi = Math.min(p.highlight, Math.max(0, total - 1))
  const choose = (i: number) => {
    if (i < options.length) p.onToggle(options[i].id)
    else if (create) p.onCreate(create)
  }
  return (
    <>
      <div className="lp-dismiss" onClick={p.onClose} />
      <div className="lp">
        <input
          className="lp-input"
          autoFocus
          value={p.query}
          placeholder="Add or create a label…"
          onChange={(e) => {
            p.onQuery(e.target.value)
            p.onHighlight(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              p.onHighlight(Math.min(total - 1, hi + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              p.onHighlight(Math.max(0, hi - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (total) choose(hi)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              p.onClose()
            }
          }}
        />
        {options.map((l, i) => (
          <div key={l.id} className={i === hi ? 'lp-row is-hi' : 'lp-row'} onMouseMove={() => i !== hi && p.onHighlight(i)} onClick={() => choose(i)}>
            <span className="lp-check">{p.applied.includes(l.id) && <Icon name="Check" size={12} />}</span>
            <span className="lp-dot" style={{ background: l.color }} />
            <span className="lp-name">{l.name}</span>
            <span className="lp-count">{p.counts[l.id] ?? 0}</span>
          </div>
        ))}
        {create && (
          <div className={hi === options.length ? 'lp-row is-hi' : 'lp-row'} onMouseMove={() => hi !== options.length && p.onHighlight(options.length)} onClick={() => choose(options.length)}>
            <span className="lp-check lp-plus"><Icon name="Plus" size={12} /></span>
            <span className="lp-dot" style={{ background: nextColor(p.labels) }} />
            <span className="lp-name lp-create">Create “{create}”</span>
          </div>
        )}
        {total === 0 && <div className="lp-empty">Type a name to create one.</div>}
      </div>
    </>
  )
}

export function LabelsRow({ store, sessionId, counts, onToggle, onCreate }: {
  store: LabelStore
  sessionId: string
  counts: Record<string, number>
  onToggle(labelId: string): void
  onCreate(name: string): void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const applied = labelsOf(store, sessionId)
  const close = () => {
    setOpen(false)
    setQuery('')
    setHighlight(0)
  }
  return (
    <>
      <span className="fact-k lbl-k">Labels</span>
      <div className="lbl-v">
        {applied.map((l) => (
          <span key={l.id} className="lbl-chip" title="Change labels" onClick={() => setOpen(true)}>
            <span className="lbl-dot" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
        <span className={applied.length ? 'lbl-add is-icon' : 'lbl-add'} title="Add label" onClick={() => (open ? close() : setOpen(true))}>
          <Icon name="Plus" size={10} />
          {applied.length === 0 && <span>Add label</span>}
        </span>
        {open && (
          <LabelPicker
            labels={store.list}
            applied={applied.map((l) => l.id)}
            counts={counts}
            query={query}
            highlight={highlight}
            onQuery={setQuery}
            onHighlight={setHighlight}
            onToggle={onToggle}
            onCreate={(name) => {
              onCreate(name)
              setQuery('')
              setHighlight(0)
            }}
            onClose={close}
          />
        )}
      </div>
    </>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const list: Label[] = [
    { id: 'bug', name: 'Bug', color: '#eb5757' },
    { id: 'feat', name: 'Feature', color: '#bb87fc' },
  ]
  const store: LabelStore = { list, map: { s1: ['feat'] } }
  const picker = (over: Partial<Parameters<typeof LabelPicker>[0]> = {}) =>
    renderToStaticMarkup(
      <LabelPicker labels={list} applied={['feat']} counts={{ bug: 4, feat: 1 }} query="" highlight={0} onQuery={() => {}} onHighlight={() => {}} onToggle={() => {}} onCreate={() => {}} onClose={() => {}} {...over} />,
    )

  it('lists every label with its colour, session count and a check on the applied ones, keeping the check slot when hidden', () => {
    const html = picker()
    expect(html).toContain('placeholder="Add or create a label…"')
    expect(html).toMatch(/lp-row is-hi"[^>]*><span class="lp-check"><\/span><span class="lp-dot" style="background:#eb5757"><\/span><span class="lp-name">Bug<\/span><span class="lp-count">4</)
    expect(html).toMatch(/lp-row"[^>]*><span class="lp-check"><svg[\s\S]*lp-name">Feature<\/span><span class="lp-count">1</)
    expect(html).not.toContain('Create “')
  })
  it('filters by the query and offers Create for a name that is not taken, in the next free colour', () => {
    const html = picker({ query: 'ref' })
    expect(html).not.toContain('lp-name">Bug')
    expect(html).toContain('Create “ref”')
    expect(html).toContain(`background:${nextColor(list)}`)
    expect(picker({ query: 'bug' })).not.toContain('Create “')
  })
  it('says how to create a label when nothing matches and nothing can be created', () => {
    expect(picker({ labels: [], applied: [] })).toContain('Type a name to create one.')
  })
  it('highlights the create row when the highlight is past the options', () => {
    expect(picker({ query: 'ref', highlight: 5 })).toMatch(/lp-row is-hi"[^>]*>(?:(?!lp-row)[\s\S])*Create “ref”/)
  })
  it('shows chips and an Add label button, or an icon-only button once labels are applied', () => {
    const none = renderToStaticMarkup(<LabelsRow store={{ list, map: {} }} sessionId="s1" counts={{}} onToggle={() => {}} onCreate={() => {}} />)
    expect(none).toContain('fact-k lbl-k">Labels<')
    expect(none).toContain('lbl-add" title="Add label"')
    expect(none).toContain('Add label</span>')
    const some = renderToStaticMarkup(<LabelsRow store={store} sessionId="s1" counts={{}} onToggle={() => {}} onCreate={() => {}} />)
    expect(some).toContain('lbl-chip" title="Change labels"')
    expect(some).toContain('lbl-dot" style="background:#bb87fc"')
    expect(some).toContain('lbl-add is-icon"')
    expect(some).not.toContain('Add label</span>')
    expect(some).not.toContain('lp-row')
  })
}

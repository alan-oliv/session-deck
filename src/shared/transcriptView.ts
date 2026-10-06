import { plural } from './format'
import { makeTranscript } from './fixtures'
import type { Item, ToolItem, Transcript } from './api'

export type Filter = 'all' | 'msg' | 'tools' | 'edits' | 'errors'
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'msg', label: 'Messages' },
  { id: 'tools', label: 'Tools' },
  { id: 'edits', label: 'Edits' },
  { id: 'errors', label: 'Errors' },
]

export interface ViewState {
  filter: Filter
  expandAll: boolean
  openRows: Record<string, boolean>
  openGroups: Record<string, boolean>
}

export interface TextRow { kind: 'text'; key: string; md: string }
export interface ToolRow { kind: 'tool'; key: string; turn: number; index: number; item: ToolItem; open: boolean; hasBody: boolean; inGroup: boolean }
export interface GroupRow { kind: 'group'; key: string; label: string; summary: string; failed: number; open: boolean; members: ToolRow[] }
export type Row = TextRow | ToolRow | GroupRow

export interface TurnView {
  index: number
  label: string
  meta: string
  prompt: string | null
  rows: Row[]
  footer: string | null
  recap: string | null
}
export interface View { counts: Record<Filter, number>; turns: TurnView[]; empty: boolean }

const GROUP_MIN = 3

export const isEdit = (it: Item): boolean => it.k === 'tool' && (it.diff !== undefined || it.a !== undefined)
const isErr = (it: Item): boolean => it.k === 'tool' && !!it.err
export const hasBody = (it: ToolItem): boolean => !!(it.out?.length || it.diff || it.link)

const matches = (it: Item, f: Filter): boolean =>
  f === 'all' || (f === 'msg' && it.k === 'text') || (f === 'tools' && it.k === 'tool') || (f === 'edits' && isEdit(it)) || (f === 'errors' && isErr(it))

export function transcriptView(t: Transcript, s: ViewState): View {
  const flat = t.turns.flatMap((x) => x.items)
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, flat.filter((it) => matches(it, f.id)).length])) as Record<Filter, number>
  const showPrompt = s.filter === 'all' || s.filter === 'msg'
  let shown = 0
  const turns: TurnView[] = []

  t.turns.forEach((turn, ti) => {
    const kept = turn.items.map((item, index) => ({ item, index })).filter((x) => matches(x.item, s.filter))
    const toolRow = (x: { item: Item; index: number }, inGroup: boolean): ToolRow => {
      const key = `${ti}:${x.index}`
      const item = x.item as ToolItem
      return { kind: 'tool', key, turn: ti, index: x.index, item, open: s.expandAll || !!s.openRows[key], hasBody: hasBody(item), inGroup }
    }
    const rows: Row[] = []
    let i = 0
    while (i < kept.length) {
      const x = kept[i]
      if (x.item.k === 'text') {
        rows.push({ kind: 'text', key: `${ti}:${x.index}`, md: x.item.md })
        i++
        continue
      }
      let j = i
      while (j < kept.length && kept[j].item.k === 'tool') j++
      const run = kept.slice(i, j)
      if (s.filter === 'all' && run.length >= GROUP_MIN) {
        const key = `${ti}:g${x.index}`
        const byName = new Map<string, number>()
        for (const r of run) byName.set((r.item as ToolItem).name, (byName.get((r.item as ToolItem).name) ?? 0) + 1)
        rows.push({
          kind: 'group',
          key,
          label: `${run.length} steps`,
          summary: [...byName].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · '),
          failed: run.filter((r) => isErr(r.item)).length,
          open: s.openGroups[key] ?? s.expandAll,
          members: run.map((r) => toolRow(r, true)),
        })
      } else {
        for (const r of run) rows.push(toolRow(r, false))
      }
      i = j
    }
    shown += rows.length
    const tools = turn.items.filter((it) => it.k === 'tool').length
    const edits = turn.items.filter(isEdit).length
    const prompt = showPrompt && turn.prompt ? turn.prompt : null
    const footer = s.filter === 'all' && turn.footer ? turn.footer : null
    const recap = showPrompt && turn.recap ? turn.recap : null
    if (rows.length || prompt || footer || recap) {
      turns.push({ index: ti, label: `Turn ${ti + 1}`, meta: `${plural(tools, 'step')}${edits ? ` · ${plural(edits, 'edit')}` : ''}`, prompt, rows, footer, recap })
    }
  })

  return { counts, turns, empty: shown === 0 && !showPrompt }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const t = makeTranscript()
  const state = (over: Partial<ViewState> = {}): ViewState => ({ filter: 'all', expandAll: false, openRows: {}, openGroups: {}, ...over })
  const kinds = (rows: Row[]) => rows.map((r) => (r.kind === 'group' ? `group(${r.label})` : `${r.kind}:${r.key}`))

  it('counts items per filter', () => {
    expect(transcriptView(t, state()).counts).toEqual({ all: 8, msg: 2, tools: 6, edits: 1, errors: 1 })
  })
  it('folds three or more consecutive tool calls into a step group under All only', () => {
    const all = transcriptView(t, state())
    expect(kinds(all.turns[0].rows)).toEqual(['tool:0:0', 'text:0:1', 'group(4 steps)'])
    const g = all.turns[0].rows[2]
    expect(g.kind === 'group' && g.summary).toBe('Search · Bash ×2 · Update')
    expect(g.kind === 'group' && g.members.map((m) => m.key)).toEqual(['0:2', '0:3', '0:4', '0:5'])
    expect(kinds(transcriptView(t, state({ filter: 'tools' })).turns[0].rows)).toEqual(['tool:0:0', 'tool:0:2', 'tool:0:3', 'tool:0:4', 'tool:0:5'])
  })
  it('writes the turn label and meta line from every item, not just the shown ones', () => {
    const v = transcriptView(t, state({ filter: 'msg' }))
    expect(v.turns[0]).toMatchObject({ index: 0, label: 'Turn 1', meta: '5 steps · 1 edit' })
    expect(v.turns[1]).toMatchObject({ index: 1, label: 'Turn 2', meta: '1 step' })
  })
  it('shows prompts and recaps under All and Messages, footers under All only', () => {
    const all = transcriptView(t, state()).turns[0]
    expect(all).toMatchObject({ prompt: t.turns[0].prompt, footer: t.turns[0].footer, recap: t.turns[0].recap })
    const msg = transcriptView(t, state({ filter: 'msg' })).turns[0]
    expect(msg).toMatchObject({ prompt: t.turns[0].prompt, footer: null, recap: t.turns[0].recap })
    expect(kinds(msg.rows)).toEqual(['text:0:1'])
    const tools = transcriptView(t, state({ filter: 'tools' })).turns[0]
    expect(tools).toMatchObject({ prompt: null, footer: null, recap: null })
  })
  it('drops turns with nothing to show and flags an empty result for the narrow filters', () => {
    const edits = transcriptView(t, state({ filter: 'edits' }))
    expect(edits.turns.map((x) => x.index)).toEqual([0])
    expect(kinds(edits.turns[0].rows)).toEqual(['tool:0:4'])
    const errors = transcriptView(t, state({ filter: 'errors' }))
    expect(errors.turns.map((x) => x.index)).toEqual([1])
    expect(errors.empty).toBe(false)
    const clean: Transcript = { cli: 'x', turns: [{ prompt: 'p', items: [{ k: 'text', md: 'hi' }] }] }
    expect(transcriptView(clean, state({ filter: 'errors' })).empty).toBe(true)
    expect(transcriptView(clean, state({ filter: 'errors' })).turns).toEqual([])
    expect(transcriptView(clean, state({ filter: 'msg' })).empty).toBe(false)
  })
  it('keys open rows by their place in the original list so the state survives a filter change', () => {
    const open = { '0:3': true }
    const all = transcriptView(t, state({ openRows: open, openGroups: { '0:g2': true } }))
    const g = all.turns[0].rows[2]
    expect(g.kind === 'group' && g.open).toBe(true)
    expect(g.kind === 'group' && g.members.map((m) => m.open)).toEqual([false, true, false, false])
    const tools = transcriptView(t, state({ filter: 'tools', openRows: open })).turns[0].rows
    expect(tools.map((r) => r.kind === 'tool' && r.open)).toEqual([false, false, true, false, false])
  })
  it('lets expand-all open every row and group unless a group was closed by hand', () => {
    const v = transcriptView(t, state({ expandAll: true, openGroups: { '0:g2': false } }))
    const g = v.turns[0].rows[2]
    expect(g.kind === 'group' && g.open).toBe(false)
    expect(g.kind === 'group' && g.members.every((m) => m.open)).toBe(true)
    expect(v.turns[1].rows[0]).toMatchObject({ kind: 'tool', open: true })
  })
  it('knows which rows have a body and which items are edits', () => {
    const items = t.turns[0].items as ToolItem[]
    expect(hasBody(items[0])).toBe(true)
    expect(hasBody(items[2])).toBe(false)
    expect(hasBody(items[5])).toBe(true)
    expect(isEdit(items[4])).toBe(true)
    expect(isEdit(items[0])).toBe(false)
    expect(isEdit({ k: 'text', md: 'x' })).toBe(false)
    expect(FILTERS.map((f) => f.label)).toEqual(['All', 'Messages', 'Tools', 'Edits', 'Errors'])
  })
}

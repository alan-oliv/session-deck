import type { Label, LabelStore, Session } from './api'
import { makeSession } from './fixtures'

export const LABEL_COLORS = ['#eb5757', '#bb87fc', '#4ea7fc', '#f2c94c', '#f2994a', '#4cb782', '#26b5ce', '#6c79ff']

export const NO_LABELS: LabelStore = { list: [], map: {} }

export const DEFAULT_LABELS: LabelStore = {
  list: [
    { id: 'bug', name: 'Bug', color: '#eb5757' },
    { id: 'feature', name: 'Feature', color: '#bb87fc' },
    { id: 'investigation', name: 'Investigation', color: '#4ea7fc' },
    { id: 'refactor', name: 'Refactor', color: '#f2c94c' },
    { id: 'performance', name: 'Performance', color: '#f2994a' },
    { id: 'docs', name: 'Docs', color: '#4cb782' },
  ],
  map: {},
}

export const nextColor = (list: { color: string }[]): string =>
  LABEL_COLORS.find((c) => !list.some((l) => l.color === c)) ?? LABEL_COLORS[list.length % LABEL_COLORS.length]

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
export const findByName = (list: Label[], name: string): Label | undefined => list.find((l) => sameName(l.name, name))

// Ids of deleted labels stay in `map` so Undo is a plain restore; they are filtered out here.
export const labelIdsOf = (store: LabelStore, sessionId: string): string[] =>
  (store.map[sessionId] ?? []).filter((id) => store.list.some((l) => l.id === id))
export const labelsOf = (store: LabelStore, sessionId: string): Label[] =>
  labelIdsOf(store, sessionId).flatMap((id) => store.list.filter((l) => l.id === id))

export function toggleLabel(store: LabelStore, sessionId: string, labelId: string): LabelStore {
  const ids = store.map[sessionId] ?? []
  const next = ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId]
  return { ...store, map: { ...store.map, [sessionId]: next } }
}

export function createLabel(store: LabelStore, name: string, id: string = crypto.randomUUID()): { store: LabelStore; label: Label } | null {
  const clean = name.trim()
  if (!clean) return null
  const existing = findByName(store.list, clean)
  if (existing) return { store, label: existing }
  const label: Label = { id, name: clean, color: nextColor(store.list) }
  return { store: { ...store, list: [...store.list, label] }, label }
}

export function applyNewLabel(store: LabelStore, sessionId: string, name: string, id?: string): LabelStore | null {
  const made = createLabel(store, name, id)
  if (!made) return null
  return labelIdsOf(made.store, sessionId).includes(made.label.id) ? made.store : toggleLabel(made.store, sessionId, made.label.id)
}

export function toggleLabelMany(store: LabelStore, sessionIds: string[], labelId: string): LabelStore {
  const lacking = sessionIds.filter((sid) => !labelIdsOf(store, sid).includes(labelId))
  return (lacking.length ? lacking : sessionIds).reduce((s, sid) => toggleLabel(s, sid, labelId), store)
}

export function applyNewLabelMany(store: LabelStore, sessionIds: string[], name: string, id?: string): LabelStore | null {
  const made = createLabel(store, name, id)
  if (!made) return null
  const lacking = sessionIds.filter((sid) => !labelIdsOf(made.store, sid).includes(made.label.id))
  return lacking.reduce((s, sid) => toggleLabel(s, sid, made.label.id), made.store)
}

export function deleteLabel(store: LabelStore, id: string): { store: LabelStore; sessions: number } {
  return {
    store: { ...store, list: store.list.filter((l) => l.id !== id) },
    sessions: Object.values(store.map).filter((ids) => ids.includes(id)).length,
  }
}

export function renameLabel(store: LabelStore, id: string, name: string): LabelStore | null {
  const clean = name.trim()
  if (!clean || store.list.some((l) => l.id !== id && sameName(l.name, clean))) return null
  return { ...store, list: store.list.map((l) => (l.id === id ? { ...l, name: clean } : l)) }
}

export const recolorLabel = (store: LabelStore, id: string, color: string): LabelStore => ({
  ...store,
  list: store.list.map((l) => (l.id === id ? { ...l, color } : l)),
})

export function moveLabel(store: LabelStore, id: string, beforeId: string | null): LabelStore {
  const moving = store.list.find((l) => l.id === id)
  if (!moving || beforeId === id) return store
  const rest = store.list.filter((l) => l.id !== id)
  const at = beforeId === null ? rest.length : rest.findIndex((l) => l.id === beforeId)
  if (at < 0) return store
  return { ...store, list: [...rest.slice(0, at), moving, ...rest.slice(at)] }
}

export const dropTarget = (ids: string[], overId: string, after: boolean): string | null =>
  after ? (ids[ids.indexOf(overId) + 1] ?? null) : overId

export function countByLabel(store: LabelStore, sessions: Session[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(store.list.map((l) => [l.id, 0]))
  for (const s of sessions) for (const id of labelIdsOf(store, s.id)) out[id]++
  return out
}

export function pickerRows(list: Label[], query: string): { options: Label[]; create: string | null } {
  const q = query.trim()
  const ql = q.toLowerCase()
  return { options: list.filter((l) => l.name.toLowerCase().includes(ql)), create: q && !findByName(list, q) ? q : null }
}

export const deleteToastText = (name: string, sessions: number): string =>
  `Deleted label “${name}”${sessions ? ` from ${sessions} ${sessions === 1 ? 'session' : 'sessions'}` : ''}`

export const forgetSessions = (store: LabelStore, ids: string[]): LabelStore => ({
  ...store,
  map: Object.fromEntries(Object.entries(store.map).filter(([sid]) => !ids.includes(sid))),
})

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const store = (list: Label[], map: LabelStore['map'] = {}): LabelStore => ({ list, map })
  const L = (id: string, name: string, color = '#eb5757'): Label => ({ id, name, color })
  const abc = store([L('a', 'Alpha'), L('b', 'Beta', '#bb87fc'), L('c', 'Gamma', '#4ea7fc')], { s1: ['b', 'gone', 'a'] })

  it('gives a new label the first palette colour not in use, then repeats by count', () => {
    expect(nextColor([])).toBe('#eb5757')
    expect(nextColor([{ color: '#eb5757' }, { color: '#4ea7fc' }])).toBe('#bb87fc')
    const all = LABEL_COLORS.map((color) => ({ color }))
    expect(nextColor(all)).toBe(LABEL_COLORS[0])
    expect(nextColor([...all, { color: LABEL_COLORS[0] }])).toBe(LABEL_COLORS[1])
  })
  it('reads a session’s labels in applied order and drops ids of deleted labels', () => {
    expect(labelIdsOf(abc, 's1')).toEqual(['b', 'a'])
    expect(labelsOf(abc, 's1').map((l) => l.name)).toEqual(['Beta', 'Alpha'])
    expect(labelIdsOf(abc, 'nobody')).toEqual([])
  })
  it('toggles a label on and off a session without touching others', () => {
    const on = toggleLabel(abc, 's2', 'c')
    expect(on.map.s2).toEqual(['c'])
    expect(toggleLabel(on, 's2', 'c').map.s2).toEqual([])
    expect(on.map.s1).toEqual(abc.map.s1)
  })
  it('creates a trimmed label with the next colour, and reuses an existing name ignoring case', () => {
    const made = createLabel(abc, '  Delta ', 'd')!
    expect(made.label).toEqual({ id: 'd', name: 'Delta', color: '#f2c94c' })
    expect(made.store.list).toHaveLength(4)
    expect(createLabel(abc, 'alpha')!.label.id).toBe('a')
    expect(createLabel(abc, 'alpha')!.store).toBe(abc)
    expect(createLabel(abc, '   ')).toBeNull()
  })
  it('applies a new or existing label to a session without removing it when already applied', () => {
    expect(applyNewLabel(abc, 's2', 'Delta', 'd')!.map.s2).toEqual(['d'])
    expect(applyNewLabel(abc, 's1', 'alpha')!.map.s1).toEqual(['b', 'gone', 'a'])
    expect(applyNewLabel(abc, 's2', '')).toBeNull()
  })
  it('adds a label to the sessions lacking it, and removes it from all only when every session has it', () => {
    const mixed = store(abc.list, { s1: ['a'], s2: [] })
    const added = toggleLabelMany(mixed, ['s1', 's2'], 'a')
    expect(added.map).toEqual({ s1: ['a'], s2: ['a'] })
    expect(toggleLabelMany(added, ['s1', 's2'], 'a').map).toEqual({ s1: [], s2: [] })
  })
  it('creates or reuses a label and puts it on every session, null for an empty name', () => {
    const r = applyNewLabelMany(store(abc.list, { s1: ['a'] }), ['s1', 's2'], 'alpha')!
    expect(r.list).toHaveLength(3)
    expect(r.map).toEqual({ s1: ['a'], s2: ['a'] })
    expect(applyNewLabelMany(abc, ['s1', 's2'], 'Delta', 'd')!.map.s2).toEqual(['d'])
    expect(applyNewLabelMany(abc, ['s1'], ' ')).toBeNull()
  })
  it('deletes a label from the list, keeps the map for Undo, and counts the sessions that had it', () => {
    const r = deleteLabel(store(abc.list, { s1: ['a'], s2: ['a', 'b'], s3: ['c'] }), 'a')
    expect(r.store.list.map((l) => l.id)).toEqual(['b', 'c'])
    expect(r.sessions).toBe(2)
    expect(r.store.map.s1).toEqual(['a'])
  })
  it('renames a label, rejecting empty names and names another label uses', () => {
    expect(renameLabel(abc, 'a', ' Alef ')!.list[0].name).toBe('Alef')
    expect(renameLabel(abc, 'a', 'ALPHA')!.list[0].name).toBe('ALPHA')
    expect(renameLabel(abc, 'a', 'beta')).toBeNull()
    expect(renameLabel(abc, 'a', '  ')).toBeNull()
  })
  it('recolours one label', () => {
    expect(recolorLabel(abc, 'b', '#26b5ce').list.map((l) => l.color)).toEqual(['#eb5757', '#26b5ce', '#4ea7fc'])
  })
  it('moves a label before another, to the end, or nowhere', () => {
    const ids = (s: LabelStore) => s.list.map((l) => l.id).join('')
    expect(ids(moveLabel(abc, 'a', 'c'))).toBe('bac')
    expect(ids(moveLabel(abc, 'a', null))).toBe('bca')
    expect(ids(moveLabel(abc, 'c', 'a'))).toBe('cab')
    expect(moveLabel(abc, 'b', 'b')).toBe(abc)
    expect(moveLabel(abc, 'zzz', 'a')).toBe(abc)
  })
  it('turns a drop on the top or bottom half of a row into the id to insert before', () => {
    expect(dropTarget(['a', 'b', 'c'], 'b', false)).toBe('b')
    expect(dropTarget(['a', 'b', 'c'], 'b', true)).toBe('c')
    expect(dropTarget(['a', 'b', 'c'], 'c', true)).toBeNull()
  })
  it('counts sessions per label, including labels nobody uses', () => {
    const a = makeSession()
    const b = makeSession({ archived: true })
    const s = store(abc.list, { [a.id]: ['a', 'b'], [b.id]: ['a'] })
    expect(countByLabel(s, [a, b] as Session[])).toEqual({ a: 2, b: 1, c: 0 })
  })
  it('lists matching options and offers Create only for a name that is not taken', () => {
    expect(pickerRows(abc.list, '').options).toHaveLength(3)
    expect(pickerRows(abc.list, 'ta').options.map((l) => l.id)).toEqual(['b'])
    expect(pickerRows(abc.list, 'ta').create).toBe('ta')
    expect(pickerRows(abc.list, ' ALPHA ').create).toBeNull()
    expect(pickerRows(abc.list, '').create).toBeNull()
  })
  it('words the delete toast by how many sessions had the label', () => {
    expect(deleteToastText('Bug', 3)).toBe('Deleted label “Bug” from 3 sessions')
    expect(deleteToastText('Bug', 1)).toBe('Deleted label “Bug” from 1 session')
    expect(deleteToastText('Bug', 0)).toBe('Deleted label “Bug”')
  })
  it('forgets the given sessions and keeps every label', () => {
    const s = store(abc.list, { s1: ['a'], s2: ['b'], s3: ['a', 'c'] })
    expect(forgetSessions(s, ['s1', 's3', 'nope'])).toEqual(store(abc.list, { s2: ['b'] }))
  })
}

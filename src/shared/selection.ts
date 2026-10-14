export type Picks = { picked: string[]; anchor: string | null }

export function rangeIds(order: string[], anchor: string | null, to: string): string[] {
  const a = anchor === null ? -1 : order.indexOf(anchor)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

// `selected` is the row the detail pane shows: a first Cmd/Shift-click extends from it, not from nothing.
export function nextPicks(state: Picks, order: string[], id: string, mods: { shift: boolean; toggle: boolean }, selected: string | null = null): Picks {
  if (mods.shift) {
    const anchor = state.anchor ?? selected ?? id
    return { picked: rangeIds(order, anchor, id), anchor }
  }
  if (mods.toggle) {
    const base = state.picked.length || !selected ? state.picked : [selected]
    const picked = base.includes(id) ? base.filter((p) => p !== id) : [...base, id]
    return { picked, anchor: id }
  }
  return { picked: [], anchor: id }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const order = ['a', 'b', 'c', 'd', 'e']
  const none = { shift: false, toggle: false }

  it('lists ids from the anchor to the target in list order, whichever comes first', () => {
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(order, 'c', 'c')).toEqual(['c'])
  })
  it('falls back to just the target when there is no usable anchor', () => {
    expect(rangeIds(order, null, 'c')).toEqual(['c'])
    expect(rangeIds(order, 'gone', 'c')).toEqual(['c'])
    expect(rangeIds(order, 'a', 'gone')).toEqual(['gone'])
  })
  it('selects a range on shift-click and keeps the anchor', () => {
    expect(nextPicks({ picked: [], anchor: 'b' }, order, 'd', { ...none, shift: true })).toEqual({ picked: ['b', 'c', 'd'], anchor: 'b' })
    expect(nextPicks({ picked: [], anchor: null }, order, 'd', { ...none, shift: true })).toEqual({ picked: ['d'], anchor: 'd' })
  })
  it('adds and removes one id on toggle-click and moves the anchor to it', () => {
    const on = nextPicks({ picked: ['a'], anchor: 'a' }, order, 'c', { ...none, toggle: true })
    expect(on).toEqual({ picked: ['a', 'c'], anchor: 'c' })
    expect(nextPicks(on, order, 'a', { ...none, toggle: true })).toEqual({ picked: ['c'], anchor: 'a' })
  })
  it('extends from the selected row on the first shift-click or toggle-click', () => {
    const fresh = { picked: [], anchor: null }
    expect(nextPicks(fresh, order, 'd', { ...none, shift: true }, 'b')).toEqual({ picked: ['b', 'c', 'd'], anchor: 'b' })
    expect(nextPicks(fresh, order, 'c', { ...none, toggle: true }, 'a')).toEqual({ picked: ['a', 'c'], anchor: 'c' })
    expect(nextPicks(fresh, order, 'a', { ...none, toggle: true }, 'a')).toEqual({ picked: [], anchor: 'a' })
  })
  it('clears the picks on a plain click and anchors on the clicked id', () => {
    expect(nextPicks({ picked: ['a', 'b'], anchor: 'a' }, order, 'e', none)).toEqual({ picked: [], anchor: 'e' })
  })
}

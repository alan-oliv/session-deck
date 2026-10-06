export type PaneKey = 'side' | 'list' | 'pal'
export interface PaneWidths { side: number; list: number; pal: number }

export const PANES: Record<PaneKey, { default: number; min: number; max: number }> = {
  side: { default: 220, min: 160, max: 360 },
  list: { default: 380, min: 280, max: 600 },
  pal: { default: 380, min: 260, max: 520 },
}
export const DETAIL_MIN = 360
export const PANES_KEY = 'paneWidths'

// The tree and the list share the window with a detail pane that never drops below DETAIL_MIN;
// `other` is the width of the one that is not being resized. The command bar column has no neighbour.
export function paneMax(key: PaneKey, other: number, windowWidth: number): number {
  const p = PANES[key]
  if (key === 'pal') return p.max
  return Math.max(p.min, Math.min(p.max, windowWidth - DETAIL_MIN - other))
}

export const clampPane = (key: PaneKey, w: number, other: number, windowWidth: number): number =>
  Math.min(paneMax(key, other, windowWidth), Math.max(PANES[key].min, Math.round(w)))

export function readPaneWidths(raw: string | null, windowWidth: number): PaneWidths {
  let j: Record<string, unknown> = {}
  try {
    const v = JSON.parse(raw ?? 'null')
    if (v && typeof v === 'object') j = v
  } catch {
    // A bad stored value just means defaults.
  }
  const n = (k: PaneKey) => (typeof j[k] === 'number' && Number.isFinite(j[k]) ? (j[k] as number) : PANES[k].default)
  const side = clampPane('side', n('side'), clampPane('list', n('list'), PANES.side.min, windowWidth), windowWidth)
  const list = clampPane('list', n('list'), side, windowWidth)
  return { side, list, pal: clampPane('pal', n('pal'), 0, windowWidth) }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('keeps each pane between its minimum and maximum, in whole pixels', () => {
    expect(clampPane('side', 100, 380, 1360)).toBe(160)
    expect(clampPane('side', 1000, 380, 1360)).toBe(360)
    expect(clampPane('side', 250.4, 380, 1360)).toBe(250)
    expect(clampPane('list', 100, 220, 1360)).toBe(280)
    expect(clampPane('list', 900, 220, 1360)).toBe(600)
    expect(clampPane('pal', 100, 0, 1360)).toBe(260)
    expect(clampPane('pal', 900, 0, 1360)).toBe(520)
  })
  it('leaves the detail pane at least 360 pixels', () => {
    expect(paneMax('side', 380, 1000)).toBe(260)
    expect(paneMax('list', 220, 1000)).toBe(420)
    expect(clampPane('list', 600, 220, 1000)).toBe(420)
    expect(paneMax('side', 600, 1000)).toBe(160)
    expect(paneMax('pal', 999, 1000)).toBe(520)
  })
  it('reads stored widths, clamping each and falling back to defaults for bad values', () => {
    expect(readPaneWidths(null, 1360)).toEqual({ side: 220, list: 380, pal: 380 })
    expect(readPaneWidths('{nope', 1360)).toEqual({ side: 220, list: 380, pal: 380 })
    expect(readPaneWidths('{"side":300,"list":"x","pal":9999}', 1360)).toEqual({ side: 300, list: 380, pal: 520 })
    expect(readPaneWidths('{"side":360,"list":600}', 1000)).toEqual({ side: 160, list: 480, pal: 380 })
  })
}

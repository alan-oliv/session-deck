import { ACCENTS, type Settings } from './api'

const mix = (hex: string, pct: number): string => (pct >= 100 ? hex : `color-mix(in srgb, ${hex} ${pct}%, transparent)`)

// CSS variables the renderer sets on the window root; tokens.css derives the hover and focus colours from --app-brand.
export function appearanceVars(s: Pick<Settings, 'accent' | 'opacity'>): Record<string, string> {
  const accent = ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0]
  return {
    '--app-brand': accent.fill,
    '--app-bg': mix('#181921', s.opacity),
    '--app-sidebar': mix('#191a23', Math.min(100, s.opacity + 2)),
  }
}

// The desktop is blurred by the window server (native/blur), so the renderer only tints; a solid window needs none.
export const blurRadius = (s: Pick<Settings, 'opacity' | 'blur'>): number => (s.opacity < 100 ? s.blur : 0)

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('tints the window and sidebar by opacity and keeps both solid at 100%', () => {
    expect(appearanceVars({ accent: 'teal', opacity: 88 })).toEqual({
      '--app-brand': '#26b5ce',
      '--app-bg': 'color-mix(in srgb, #181921 88%, transparent)',
      '--app-sidebar': 'color-mix(in srgb, #191a23 90%, transparent)',
    })
    expect(appearanceVars({ accent: 'brand', opacity: 100 })).toEqual({ '--app-brand': '#575bc7', '--app-bg': '#181921', '--app-sidebar': '#191a23' })
    expect(appearanceVars({ accent: 'brand', opacity: 99 })['--app-sidebar']).toBe('#191a23')
  })
  it('blurs only when the desktop can show through', () => {
    expect(blurRadius({ opacity: 88, blur: 24 })).toBe(24)
    expect(blurRadius({ opacity: 100, blur: 24 })).toBe(0)
    expect(blurRadius({ opacity: 88, blur: 0 })).toBe(0)
  })
}

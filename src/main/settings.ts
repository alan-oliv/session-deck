import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ACCENTS, isSessionId, SETTINGS_DEFAULTS, TERMINALS, type Accent, type Settings, type Terminal } from '../shared/api'

export const isTerminal = (v: unknown): v is Terminal => TERMINALS.some((t) => t.id === v)
const isAccent = (v: unknown): v is Accent => ACCENTS.some((a) => a.id === v)
const clamp = (v: unknown, min: number, max: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

const PATCH_KEYS = ['terminal', 'open', 'accent', 'opacity', 'blur', 'appIcon', 'skipPermissions', 'onboarded'] as const

export const applyPatch = (prev: Settings, p: Record<string, unknown>): Settings =>
  normalizeSettings({ ...prev, ...Object.fromEntries(PATCH_KEYS.filter((k) => k in p).map((k) => [k, p[k]])) })

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = SETTINGS_DEFAULTS
  return {
    terminal: isTerminal(r.terminal) ? r.terminal : null,
    open: r.open === 'window' ? 'window' : 'tab',
    accent: isAccent(r.accent) ? r.accent : d.accent,
    opacity: clamp(r.opacity, 50, 100, d.opacity),
    blur: clamp(r.blur, 0, 40, d.blur),
    appIcon: r.appIcon === 'purple' ? 'purple' : 'dark',
    archived: Array.isArray(r.archived) ? [...new Set(r.archived.filter(isSessionId))] : [],
    statusTee: r.statusTee === true,
    skipPermissions: r.skipPermissions === true,
    onboarded: r.onboarded === true,
  }
}

export interface SettingsStore {
  get(): Settings
  save(patch: Partial<Settings>): Settings
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2))
  renameSync(`${path}.tmp`, path)
}

// No `onboarded` key means the file predates onboarding, so the user is not new. A fresh install has neither file.
export function initialSettings(raw: unknown, hasIndex: boolean): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const existing = 'onboarded' in r ? r.onboarded === true : raw !== null || hasIndex
  return normalizeSettings({ ...r, onboarded: existing })
}

export function createSettingsStore(path: string, hasIndex = false): SettingsStore {
  const raw = readJson(path)
  let current = initialSettings(raw, hasIndex)
  if (!(raw && typeof raw === 'object' && 'onboarded' in raw)) writeJsonAtomic(path, current)
  return {
    get: () => current,
    save(patch) {
      current = normalizeSettings({ ...current, ...patch })
      writeJsonAtomic(path, current)
      return current
    },
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  it('drops unknown terminals, non-session ids and duplicates', () => {
    expect(normalizeSettings({ terminal: 'kitty', archived: [id, id, '../x'], statusTee: 'yes' }))
      .toEqual({ ...SETTINGS_DEFAULTS, archived: [id] })
    expect(normalizeSettings(null)).toEqual(SETTINGS_DEFAULTS)
  })
  it('saves skipPermissions from a patch and ignores fields outside the patch keys', () => {
    expect(applyPatch(SETTINGS_DEFAULTS, { skipPermissions: true }).skipPermissions).toBe(true)
    expect(applyPatch({ ...SETTINGS_DEFAULTS, skipPermissions: true }, { open: 'window' }).skipPermissions).toBe(true)
    expect(applyPatch(SETTINGS_DEFAULTS, { statusTee: true }).statusTee).toBe(false)
  })
  it('keeps skipPermissions only when it is exactly true', () => {
    expect(normalizeSettings({ skipPermissions: true }).skipPermissions).toBe(true)
    expect(normalizeSettings({ skipPermissions: 'true' }).skipPermissions).toBe(false)
  })
  it('clamps the appearance numbers and falls back on unknown choices', () => {
    expect(normalizeSettings({ open: 'window', accent: 'teal', opacity: 12, blur: 99.6, appIcon: 'purple' }))
      .toEqual({ ...SETTINGS_DEFAULTS, open: 'window', accent: 'teal', opacity: 50, blur: 40, appIcon: 'purple' })
    expect(normalizeSettings({ open: 'popup', accent: 'pink', opacity: '70', blur: NaN, appIcon: 'gold' })).toEqual(SETTINGS_DEFAULTS)
  })
  it('persists saved settings and reads them back', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'deck-settings-')), 'nested', 'settings.json')
    createSettingsStore(path).save({ terminal: 'iterm', archived: [id] })
    expect(createSettingsStore(path).get()).toEqual({ ...SETTINGS_DEFAULTS, terminal: 'iterm', archived: [id] })
  })
  it('treats a missing settings file with no session cache as a fresh install', () => {
    expect(initialSettings(null, false).onboarded).toBe(false)
  })
  it('treats an old settings file without the flag, or a session cache alone, as an existing install', () => {
    expect(initialSettings({ open: 'window' }, false).onboarded).toBe(true)
    expect(initialSettings(null, true).onboarded).toBe(true)
  })
  it('keeps an explicit onboarded value, so quitting mid-setup shows setup again', () => {
    expect(initialSettings({ onboarded: false }, true).onboarded).toBe(false)
    expect(initialSettings({ onboarded: true }, false).onboarded).toBe(true)
  })
  it('writes the decision on first read so it survives a relaunch', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'deck-settings-')), 'settings.json')
    expect(createSettingsStore(path).get().onboarded).toBe(false)
    expect(readJson(path)).toMatchObject({ onboarded: false })
    expect(createSettingsStore(path, true).get().onboarded).toBe(false)
  })
  it('accepts onboarded in a patch and keeps it only when exactly true', () => {
    expect(applyPatch(SETTINGS_DEFAULTS, { onboarded: true }).onboarded).toBe(true)
    expect(normalizeSettings({ onboarded: 'yes' }).onboarded).toBe(false)
  })
}

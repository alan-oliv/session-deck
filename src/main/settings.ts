import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ACCENTS, isSessionId, SETTINGS_DEFAULTS, TERMINALS, type Accent, type Settings, type Terminal } from '../shared/api'

export const isTerminal = (v: unknown): v is Terminal => TERMINALS.some((t) => t.id === v)
const isAccent = (v: unknown): v is Accent => ACCENTS.some((a) => a.id === v)
const clamp = (v: unknown, min: number, max: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

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
  }
}

export interface SettingsStore {
  get(): Settings
  save(patch: Partial<Settings>): Settings
}

function readJson(path: string): unknown {
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

export function createSettingsStore(path: string): SettingsStore {
  let current = normalizeSettings(readJson(path))
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
}

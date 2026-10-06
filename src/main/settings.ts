import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isSessionId, type Settings, type Terminal } from '../shared/api'

const TERMINALS: readonly Terminal[] = ['iterm', 'warp', 'terminal']
export const isTerminal = (v: unknown): v is Terminal => TERMINALS.includes(v as Terminal)

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    terminal: isTerminal(r.terminal) ? r.terminal : null,
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
      .toEqual({ terminal: null, archived: [id], statusTee: false })
    expect(normalizeSettings(null)).toEqual({ terminal: null, archived: [], statusTee: false })
  })
  it('persists saved settings and reads them back', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'deck-settings-')), 'nested', 'settings.json')
    createSettingsStore(path).save({ terminal: 'iterm', archived: [id] })
    expect(createSettingsStore(path).get()).toEqual({ terminal: 'iterm', archived: [id], statusTee: false })
  })
}

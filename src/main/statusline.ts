import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from './paths'
import { writeJsonAtomic } from './settings'
import { shellQuote } from './terminal'

type Cfg = Record<string, unknown>
export type TeePaths = Pick<typeof PATHS, 'claudeSettings' | 'deck' | 'tee' | 'teeScript' | 'teeOriginal'>

export const teeCommand = (scriptPath: string): string => `sh ${shellQuote(scriptPath)}`

export function teeScript(original: string | null, teeDir: string): string {
  return [
    '#!/bin/sh',
    '# Written by Session Deck: saves the status-line input for the app, then runs your original status line.',
    'input=$(cat)',
    `sid=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([0-9a-fA-F-]*\\)".*/\\1/p' | head -n 1)`,
    'if [ -n "$sid" ]; then',
    `  dir=${shellQuote(teeDir)}`,
    '  mkdir -p "$dir"',
    `  printf '%s' "$input" > "$dir/$sid.json.tmp" && mv "$dir/$sid.json.tmp" "$dir/$sid.json"`,
    'fi',
    ...(original ? [`printf '%s' "$input" | ${original}`] : []),
    '',
  ].join('\n')
}

export function withTee(cfg: Cfg, command: string): Cfg {
  const prev = cfg.statusLine && typeof cfg.statusLine === 'object' ? (cfg.statusLine as Cfg) : {}
  return { ...cfg, statusLine: { ...prev, type: 'command', command } }
}

export function withoutTee(cfg: Cfg, original: unknown, command: string): Cfg {
  const current = cfg.statusLine as Cfg | undefined
  if (current?.command !== command) return cfg
  const { statusLine: _ours, ...rest } = cfg
  return original && typeof original === 'object' ? { ...rest, statusLine: original } : rest
}

function readClaudeSettings(path: string): Cfg {
  if (!existsSync(path)) return {}
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('~/.claude/settings.json is not a JSON object')
  return parsed as Cfg
}

export function installTee(p: TeePaths = PATHS): void {
  const cfg = readClaudeSettings(p.claudeSettings)
  const command = teeCommand(p.teeScript)
  const current = cfg.statusLine && typeof cfg.statusLine === 'object' ? (cfg.statusLine as Cfg) : null
  if (current?.command === command) return
  mkdirSync(p.tee, { recursive: true })
  if (existsSync(p.claudeSettings)) copyFileSync(p.claudeSettings, join(p.deck, 'claude-settings.backup.json'))
  writeFileSync(p.teeScript, teeScript(typeof current?.command === 'string' ? current.command : null, p.tee), { mode: 0o755 })
  writeJsonAtomic(p.teeOriginal, current)
  writeJsonAtomic(p.claudeSettings, withTee(cfg, command))
}

export function removeTee(p: TeePaths = PATHS): void {
  const cfg = readClaudeSettings(p.claudeSettings)
  let original: unknown = null
  try {
    original = JSON.parse(readFileSync(p.teeOriginal, 'utf8'))
  } catch {
    // No saved original: removing the tee leaves no status line, as before install.
  }
  const next = withoutTee(cfg, original, teeCommand(p.teeScript))
  if (next !== cfg) writeJsonAtomic(p.claudeSettings, next)
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const temp = (): TeePaths => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-tee-'))
    const deck = join(dir, 'session-deck')
    return {
      claudeSettings: join(dir, 'settings.json'), deck, tee: join(deck, 'status'),
      teeScript: join(deck, 'statusline-tee.sh'), teeOriginal: join(deck, 'statusline-original.json'),
    }
  }

  it('saves the status-line input per session and still renders the original status line', () => {
    const p = temp()
    mkdirSync(p.deck, { recursive: true })
    writeFileSync(p.teeScript, teeScript('wc -c', p.tee))
    const input = JSON.stringify({ session_id: id, model: { id: 'claude-opus-5-5' } })
    const out = execFileSync('sh', [p.teeScript], { input }).toString().trim()
    expect(out).toBe(String(input.length))
    expect(readFileSync(join(p.tee, `${id}.json`), 'utf8')).toBe(input)
  })
  it('prints nothing when there was no original status line', () => {
    expect(teeScript(null, '/t').trimEnd().endsWith('fi')).toBe(true)
  })
  it('swaps in the tee command and keeps every other setting', () => {
    const cfg = { model: 'opus', statusLine: { type: 'command', command: 'ccstatusline', padding: 0, refreshInterval: 10 } }
    expect(withTee(cfg, 'sh tee')).toEqual({ model: 'opus', statusLine: { type: 'command', command: 'sh tee', padding: 0, refreshInterval: 10 } })
  })
  it('restores the original only while the tee is still the configured command', () => {
    const original = { type: 'command', command: 'ccstatusline', padding: 0 }
    expect(withoutTee({ a: 1, statusLine: { command: 'sh tee' } }, original, 'sh tee')).toEqual({ a: 1, statusLine: original })
    expect(withoutTee({ a: 1, statusLine: { command: 'sh tee' } }, null, 'sh tee')).toEqual({ a: 1 })
    const changed = { a: 1, statusLine: { command: 'mine' } }
    expect(withoutTee(changed, original, 'sh tee')).toBe(changed)
  })
  it('installs and removes the tee round trip, with a backup of the user settings', () => {
    const p = temp()
    const before = { model: 'opus', statusLine: { type: 'command', command: 'ccstatusline', padding: 0 } }
    writeFileSync(p.claudeSettings, JSON.stringify(before))
    installTee(p)
    const during = JSON.parse(readFileSync(p.claudeSettings, 'utf8'))
    expect(during.statusLine.command).toBe(teeCommand(p.teeScript))
    expect(during.model).toBe('opus')
    expect(JSON.parse(readFileSync(join(p.deck, 'claude-settings.backup.json'), 'utf8'))).toEqual(before)
    removeTee(p)
    expect(JSON.parse(readFileSync(p.claudeSettings, 'utf8'))).toEqual(before)
  })
  it('refuses to touch a settings file it cannot parse', () => {
    const p = temp()
    writeFileSync(p.claudeSettings, '{ broken')
    expect(() => installTee(p)).toThrow()
    expect(readFileSync(p.claudeSettings, 'utf8')).toBe('{ broken')
  })
}

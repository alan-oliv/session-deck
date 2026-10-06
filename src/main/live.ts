import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface LiveInfo { status: string }
export interface TeeInfo {
  contextUsed: number | null
  contextMax: number | null
  outputStyle: string | null
  plan: { usedPct: number; resetsAt: string } | null
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function jsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// Stale <pid>.json files survive crashes, so liveness is the process, not the file.
export function readLive(dir: string, alive: (pid: number) => boolean = isAlive): Map<string, LiveInfo> {
  const out = new Map<string, LiveInfo>()
  for (const name of jsonFiles(dir)) {
    const j = readJson(join(dir, name)) as Record<string, unknown> | null
    const pid = Number(j?.pid)
    if (typeof j?.sessionId === 'string' && Number.isInteger(pid) && pid > 0 && alive(pid)) {
      out.set(j.sessionId, { status: typeof j.status === 'string' ? j.status : 'idle' })
    }
  }
  return out
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseTee(json: unknown): TeeInfo {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, any>
  const five = j.rate_limits?.five_hour
  const usedPct = finite(five?.used_percentage)
  const resets = finite(five?.resets_at)
  const style = j.output_style?.name
  return {
    contextUsed: finite(j.context_window?.total_input_tokens),
    contextMax: finite(j.context_window?.context_window_size),
    outputStyle: typeof style === 'string' && style !== 'default' ? style : null,
    plan: usedPct !== null && resets !== null ? { usedPct, resetsAt: new Date(resets * 1000).toISOString() } : null,
  }
}

export function readTee(dir: string): Map<string, TeeInfo> {
  const out = new Map<string, TeeInfo>()
  for (const name of jsonFiles(dir)) {
    const j = readJson(join(dir, name))
    if (j) out.set(name.slice(0, -'.json'.length), parseTee(j))
  }
  return out
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const a = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const b = '711a48a0-fc93-44b8-b71c-1c6e5b645970'

  it('lists only sessions whose process is still alive, ignoring key files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-live-'))
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: a, status: 'busy' }))
    writeFileSync(join(dir, '2.json'), JSON.stringify({ pid: 2, sessionId: b, status: 'idle' }))
    writeFileSync(join(dir, '1.abc.key'), 'secret')
    const live = readLive(dir, (pid) => pid === 1)
    expect([...live]).toEqual([[a, { status: 'busy' }]])
  })
  it('returns no live sessions when the folder is missing', () => {
    expect(readLive('/nonexistent/deck').size).toBe(0)
  })
  it('reads context, output style and the five-hour plan window from status-line input', () => {
    const t = parseTee({
      session_id: a, output_style: { name: 'architecture' },
      context_window: { total_input_tokens: 263000, context_window_size: 1000000 },
      rate_limits: { five_hour: { used_percentage: 32.9, resets_at: 1738425600 } },
    })
    expect(t).toEqual({
      contextUsed: 263000, contextMax: 1000000, outputStyle: 'architecture',
      plan: { usedPct: 32.9, resetsAt: new Date(1738425600 * 1000).toISOString() },
    })
  })
  it('treats the default output style and missing fields as unknown', () => {
    expect(parseTee({ output_style: { name: 'default' } })).toEqual({ contextUsed: null, contextMax: null, outputStyle: null, plan: null })
    expect(parseTee('nope')).toEqual({ contextUsed: null, contextMax: null, outputStyle: null, plan: null })
  })
  it('reads tee files keyed by session id and skips partial writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-tee-'))
    writeFileSync(join(dir, `${a}.json`), JSON.stringify({ output_style: { name: 'explain' } }))
    writeFileSync(join(dir, `${b}.json.tmp`), '{')
    expect([...readTee(dir).keys()]).toEqual([a])
    expect(readTee(dir).get(a)?.outputStyle).toBe('explain')
  })
}

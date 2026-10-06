import type { Status } from './api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// Calendar days, not 24-hour spans: 11pm yesterday is "1d" at 9am today.
export const daysAgo = (iso: string, now: Date): number => Math.round((midnight(now) - midnight(new Date(iso))) / DAY_MS)

export function clock(d: Date): string {
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export function agoShort(iso: string, now: Date): string {
  const n = daysAgo(iso, now)
  return n <= 0 ? clock(new Date(iso)) : `${n}d`
}

export function agoLong(iso: string, now: Date): string {
  const n = daysAgo(iso, now)
  if (n <= 0) return `Today, ${clock(new Date(iso))}`
  if (n === 1) return 'Yesterday'
  return `${n} days ago`
}

export const shortDay = (d: Date): string => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
export const monthDay = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getDate()}`

export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

export function fileSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}KB`
  return `${bytes}B`
}

export function durationLabel(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export const costLabel = (n: number | null): string => (n === null ? '—' : `$${n.toFixed(2)}`)

export function modelLabel(id: string | null): string {
  if (!id) return 'Unknown model'
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id.replace(/\[1m\]$/, ''))
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

const MODES: Record<string, string> = {
  bypassPermissions: 'Bypass permissions',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  default: 'Default',
  auto: 'Auto',
  dontAsk: "Don't ask",
}

export function modeLabel(m: string | null): string {
  if (!m) return 'Default'
  if (MODES[m]) return MODES[m]
  const words = m.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words[0].toUpperCase() + words.slice(1)
}

export const tildify = (p: string): string => p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')

export function resetsIn(iso: string, now: Date): string {
  const m = Math.max(0, Math.round((Date.parse(iso) - now.getTime()) / 60_000))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function attention(s: Status): { color: string; label: string } | null {
  switch (s) {
    case 'running':
      return { color: 'var(--app-green)', label: 'Running' }
    case 'waiting':
      return { color: 'var(--app-yellow)', label: 'Waiting for you' }
    case 'interrupted':
      return { color: 'var(--app-yellow)', label: 'Interrupted' }
    case 'failed':
      return { color: 'var(--app-red)', label: 'Failed' }
    default:
      return null
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const at = (d: number, h = 9, m = 12) => new Date(2026, 9, d, h, m).toISOString()

  it('formats clock times in 12-hour form', () => {
    expect(clock(new Date(2026, 9, 6, 9, 12))).toBe('9:12 AM')
    expect(clock(new Date(2026, 9, 6, 0, 5))).toBe('12:05 AM')
    expect(clock(new Date(2026, 9, 6, 13, 0))).toBe('1:00 PM')
  })
  it('shows the time for today and whole days for older sessions', () => {
    expect(agoShort(at(6), now)).toBe('9:12 AM')
    expect(agoShort(at(5, 23, 59), now)).toBe('1d')
    expect(agoShort(at(3), now)).toBe('3d')
    expect(agoLong(at(6), now)).toBe('Today, 9:12 AM')
    expect(agoLong(at(5), now)).toBe('Yesterday')
    expect(agoLong(at(1), now)).toBe('5 days ago')
  })
  it('names days and dates the way the prototype does', () => {
    expect(shortDay(new Date(2026, 9, 6))).toBe('Tue, Oct 6')
    expect(monthDay(new Date(2026, 10, 5))).toBe('Nov 5')
  })
  it('compacts token counts to k and M with one decimal', () => {
    expect(compact(150)).toBe('150')
    expect(compact(263_000)).toBe('263k')
    expect(compact(190_900)).toBe('190.9k')
    expect(compact(1_000_000)).toBe('1M')
    expect(compact(14_200_000)).toBe('14.2M')
  })
  it('formats sizes, durations and costs', () => {
    expect(fileSize(6_100_000)).toBe('6.1MB')
    expect(fileSize(48_200)).toBe('48KB')
    expect(fileSize(512)).toBe('512B')
    expect(durationLabel(2_400_000)).toBe('40m')
    expect(durationLabel(4_080_000)).toBe('1h 8m')
    expect(costLabel(5.08)).toBe('$5.08')
    expect(costLabel(null)).toBe('—')
  })
  it('names models and permission modes for people', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
    expect(modelLabel(null)).toBe('Unknown model')
    expect(modeLabel('bypassPermissions')).toBe('Bypass permissions')
    expect(modeLabel('someNewMode')).toBe('Some new mode')
    expect(modeLabel(null)).toBe('Default')
  })
  it('shortens home paths and counts down to a plan reset', () => {
    expect(tildify('/Users/me/code/app')).toBe('~/code/app')
    expect(tildify('/Users/me')).toBe('~')
    expect(tildify('/tmp/x')).toBe('/tmp/x')
    expect(resetsIn(new Date(2026, 9, 6, 15, 7).toISOString(), now)).toBe('4h 7m')
    expect(resetsIn(new Date(2026, 9, 6, 11, 30).toISOString(), now)).toBe('30m')
  })
  it('pluralizes counts', () => {
    expect(plural(1, 'session')).toBe('1 session')
    expect(plural(12, 'session')).toBe('12 sessions')
  })
  it('gives a dot only to sessions that need attention', () => {
    expect(attention('running')).toEqual({ color: 'var(--app-green)', label: 'Running' })
    expect(attention('waiting')).toEqual({ color: 'var(--app-yellow)', label: 'Waiting for you' })
    expect(attention('interrupted')).toEqual({ color: 'var(--app-yellow)', label: 'Interrupted' })
    expect(attention('failed')).toEqual({ color: 'var(--app-red)', label: 'Failed' })
    expect(attention('completed')).toBeNull()
  })
}

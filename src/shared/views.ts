import type { Session, Status } from './api'
import { makeSession } from './fixtures'
import { attention, daysAgo, shortDay, tildify } from './format'

export type ViewMode = 'list' | 'timeline' | 'repo' | 'worktree' | 'calendar'
export interface Group { key: string; label: string; note: string | null; sessions: Session[] }
export interface YearMonth { year: number; month: number }
export interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  selected: boolean
  hasSessions: boolean
  dots: (Status | null)[]
}

export const byRecent = (xs: Session[]): Session[] => [...xs].sort((a, b) => b.end.localeCompare(a.end))

export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
}

export function groupSessions(sessions: Session[], mode: ViewMode, now: Date): Group[] {
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  const push = (key: string, label: string, note: string | null, s: Session) => {
    let g = byKey.get(key)
    if (!g) {
      g = { key, label, note, sessions: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.sessions.push(s)
  }
  for (const s of sessions) {
    if (mode === 'list') push('all', '', null, s)
    else if (mode === 'timeline') {
      const n = daysAgo(s.end, now)
      push(dayKey(s.end), n === 0 ? 'Today' : n === 1 ? 'Yesterday' : shortDay(new Date(s.end)), null, s)
    } else if (mode === 'repo') {
      if (s.repo) push(`r:${s.repo.root}`, s.repo.name, null, s)
      else push(`f:${s.cwd}`, `${tildify(s.cwd)} (not a repository)`, null, s)
    } else if (mode === 'worktree') {
      if (s.worktree) push(`w:${s.worktree.path}`, `${s.worktree.name} worktree`, s.worktree.removedSeen ? 'removed' : null, s)
      else push(`m:${s.repo?.root ?? s.cwd}`, s.repo ? `${s.repo.name} · main checkout` : tildify(s.cwd), null, s)
    } else push('day', shortDay(new Date(s.end)), null, s)
  }
  return groups
}

export const listForView = (sessions: Session[], mode: ViewMode, day: string | null): Session[] =>
  mode === 'calendar' && day ? sessions.filter((s) => dayKey(s.end) === day) : sessions

const ym = (iso: string): YearMonth => {
  const d = new Date(iso)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function monthRange(sessions: Session[]): { first: YearMonth; last: YearMonth } | null {
  if (!sessions.length) return null
  const sorted = byRecent(sessions)
  return { first: ym(sorted[sorted.length - 1].end), last: ym(sorted[0].end) }
}

export const latestDay = (sessions: Session[]): Date | null => (sessions.length ? new Date(byRecent(sessions)[0].end) : null)

export function calendarCells(sessions: Session[], month: YearMonth, selected: string | null, today: Date): CalendarCell[] {
  const first = new Date(month.year, month.month, 1)
  const daysIn = new Date(month.year, month.month + 1, 0).getDate()
  const total = Math.ceil((first.getDay() + daysIn) / 7) * 7
  const byDay = new Map<string, Session[]>()
  for (const s of sessions) {
    const k = dayKey(s.end)
    const list = byDay.get(k)
    if (list) list.push(s)
    else byDay.set(k, [s])
  }
  const todayKey = dayKey(today)
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(month.year, month.month, 1 - first.getDay() + i)
    const key = dayKey(d)
    const on = byDay.get(key) ?? []
    return {
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === month.month,
      isToday: key === todayKey,
      selected: key === selected,
      hasSessions: on.length > 0,
      dots: on.slice(0, 3).map((s) => (attention(s.status) ? s.status : null)),
    }
  })
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const at = (m: number, d: number, h = 9) => new Date(2026, m, d, h).toISOString()

  it('groups the timeline by day with Today and Yesterday labels', () => {
    const xs = [makeSession({ end: at(9, 6) }), makeSession({ end: at(9, 5) }), makeSession({ end: at(9, 2) })]
    expect(groupSessions(xs, 'timeline', now).map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Fri, Oct 2'])
  })
  it('shows the list view as one group without a header', () => {
    expect(groupSessions([makeSession(), makeSession()], 'list', now)).toMatchObject([{ label: '', sessions: [{}, {}] }])
  })
  it('groups by repository, then by folder for sessions outside a repository', () => {
    const xs = [makeSession(), makeSession({ repo: null, cwd: '/Users/me/code' })]
    expect(groupSessions(xs, 'repo', now).map((g) => g.label)).toEqual(['app', '~/code (not a repository)'])
  })
  it('groups by worktree, notes removed ones, and labels the main checkout', () => {
    const xs = [
      makeSession(),
      makeSession({ worktree: { name: 'transcriptions', path: '/w/t', removedSeen: at(9, 2) } }),
      makeSession({ repo: null, cwd: '/Users/me/code' }),
    ]
    expect(groupSessions(xs, 'worktree', now).map((g) => [g.label, g.note])).toEqual([
      ['app · main checkout', null], ['transcriptions worktree', 'removed'], ['~/code', null],
    ])
  })
  it('builds a Sunday-first month grid with up to three status dots per day', () => {
    const xs = [
      makeSession({ end: at(9, 6), status: 'running' }), makeSession({ end: at(9, 6) }),
      makeSession({ end: at(9, 6), status: 'failed' }), makeSession({ end: at(9, 6) }),
    ]
    const cells = calendarCells(xs, { year: 2026, month: 9 }, dayKey(new Date(2026, 9, 6)), now)
    expect(cells).toHaveLength(35)
    expect(cells[0]).toMatchObject({ day: 27, inMonth: false })
    const oct6 = cells.find((c) => c.inMonth && c.day === 6)
    expect(oct6).toMatchObject({ isToday: true, selected: true, hasSessions: true, dots: ['running', null, 'failed'] })
  })
  it('filters the calendar list to the selected day and leaves other views alone', () => {
    const a = makeSession({ end: at(9, 6) })
    const b = makeSession({ end: at(9, 5) })
    expect(listForView([a, b], 'calendar', dayKey(new Date(2026, 9, 5)))).toEqual([b])
    expect(listForView([a, b], 'list', dayKey(new Date(2026, 9, 5)))).toEqual([a, b])
  })
  it('finds the first and last months with sessions, and the latest day', () => {
    const xs = [makeSession({ end: at(8, 20) }), makeSession({ end: at(9, 6) })]
    expect(monthRange(xs)).toEqual({ first: { year: 2026, month: 8 }, last: { year: 2026, month: 9 } })
    expect(monthRange([])).toBeNull()
    expect(latestDay(xs)?.getDate()).toBe(6)
  })
  it('orders sessions by most recent activity', () => {
    const old = makeSession({ end: at(9, 1) })
    const recent = makeSession({ end: at(9, 6) })
    expect(byRecent([old, recent])).toEqual([recent, old])
  })
}

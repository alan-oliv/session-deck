import type { Session } from '../../shared/api'
import { attention } from '../../shared/format'
import { calendarCells, monthRange, type YearMonth } from '../../shared/views'
import { Icon } from './icons'
import './Calendar.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const index = (m: YearMonth) => m.year * 12 + m.month

export interface CalendarProps {
  sessions: Session[]
  month: YearMonth
  day: string | null
  now: Date
  onMonth(ym: YearMonth): void
  onDay(key: string): void
}

export function Calendar({ sessions, month, day, now, onMonth, onDay }: CalendarProps) {
  const cells = calendarCells(sessions, month, day, now)
  const range = monthRange(sessions)
  // Navigation stays within the first and last months that have sessions.
  const step = (delta: number) => {
    const n = index(month) + delta
    if (range && (n < index(range.first) || n > index(range.last))) return
    onMonth({ year: Math.floor(n / 12), month: n % 12 })
  }
  return (
    <div className="cal">
      <div className="cal-head">
        <span className="cal-title">{`${MONTHS[month.month]} ${month.year}`}</span>
        <span className="cal-nav" title="Previous month" onClick={() => step(-1)}>
          <span style={{ display: 'flex', transform: 'rotate(180deg)' }}>
            <Icon name="ArrowRight" size={12} />
          </span>
        </span>
        <span className="cal-nav" title="Next month" onClick={() => step(1)}>
          <Icon name="ArrowRight" size={12} />
        </span>
      </div>
      <div className="cal-grid">
        {DOW.map((d, i) => (
          <span key={i} className="cal-dow">{d}</span>
        ))}
        {cells.map((c) => (
          <div
            key={c.key}
            className={`cal-day${c.selected ? ' is-selected' : ''}${c.isToday && !c.selected ? ' is-today' : ''}`}
            onClick={() => onDay(c.key)}
          >
            <span
              className="cal-num tnum"
              style={{ color: c.selected ? 'var(--app-text)' : !c.inMonth ? 'var(--app-text-disabled)' : c.hasSessions ? 'var(--app-text-2)' : 'var(--app-text-3)' }}
            >
              {c.day}
            </span>
            <span className="cal-dots">
              {c.dots.map((st, i) => (
                <span key={i} className="cal-dot" style={{ background: (st && attention(st)?.color) || 'var(--app-text-3)' }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

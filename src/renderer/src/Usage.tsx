import type { Session } from '../../shared/api'
import { compact, costLabel, durationLabel, modeLabel, modelLabel, resetsIn } from '../../shared/format'
import './Usage.css'

type Tile = { k: string; v: string; sub: string | null }

export function tiles(s: Session): Tile[][] {
  const u = s.usage
  const cache = u.cacheRead + u.cacheWrite
  const share = (n: number) => `${cache ? Math.round((n / cache) * 1000) / 10 : 0}%`
  const last: Tile = u.outputStyle
    ? { k: 'Output style', v: u.outputStyle, sub: u.agents ? `${u.agents} agents` : null }
    : { k: 'Agents', v: String(u.agents), sub: null }
  return [
    [{ k: 'In', v: compact(u.input), sub: null }, { k: 'Out', v: compact(u.output), sub: null }, { k: 'Total', v: compact(u.total), sub: null }],
    [
      { k: 'Cache hit', v: `${u.cacheHitPct}%`, sub: null },
      { k: 'Cache read', v: compact(u.cacheRead), sub: share(u.cacheRead) },
      { k: 'Cache write', v: compact(u.cacheWrite), sub: share(u.cacheWrite) },
    ],
    [
      { k: 'Cost', v: costLabel(u.cost), sub: null },
      { k: 'Duration', v: durationLabel(u.durationMs), sub: null },
      { k: 'Lines', v: `+${u.linesAdded} −${u.linesRemoved}`, sub: null },
    ],
    [{ k: 'Mode', v: modeLabel(s.permissionMode), sub: null }, { k: 'Compactions', v: String(u.compactions), sub: null }, last],
  ]
}

export function Usage({ session: s, now, teeOn, onEnableTee }: { session: Session; now: Date; teeOn: boolean; onEnableTee(): void }) {
  const u = s.usage
  const pct = u.contextMax ? Math.round((u.contextUsed / u.contextMax) * 100) : 0
  const fill = pct >= 80 ? 'var(--app-orange)' : pct >= 60 ? 'var(--app-yellow)' : 'var(--app-brand)'
  return (
    <div className="usage">
      <div className="usage-head">
        <span className="usage-label">Usage</span>
        <span className="usage-spacer" />
        <span className="usage-model">{modelLabel(s.model)}</span>
        {s.effort && <span className="usage-chip">{s.effort}</span>}
      </div>
      <div className="meter-block">
        <div className="meter-text">
          <span className="meter-name">Context</span>
          <span className="usage-spacer" />
          <span className="meter-value tnum">{`${compact(u.contextUsed)} / ${compact(u.contextMax)}`}</span>
          <span className="meter-pct tnum">{`${pct}%`}</span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: fill }} />
        </div>
        {u.plan && <span className="meter-note">{`${Math.round(u.plan.usedPct * 10) / 10}% of plan used · resets in ${resetsIn(u.plan.resetsAt, now)}`}</span>}
        {!u.plan && s.live && !teeOn && (
          <span className="meter-note meter-link" onClick={onEnableTee}>Show plan usage</span>
        )}
      </div>
      <div className="tiles">
        {tiles(s).map((row, i) => (
          <div key={i} className="tile-row">
            {row.map((t) => (
              <div key={t.k} className="tile">
                <span className="tile-k">{t.k}</span>
                <div className="tile-vrow">
                  <span className="tile-v tnum">{t.v}</span>
                  {t.sub && <span className="tile-sub">{t.sub}</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

import { formatKwh, formatKw, formatTempC } from '@/domain/calc'
import type { MpptLive } from '@/domain/types'
import './MpptRow.css'

interface MpptRowProps {
  mppts: MpptLive[] | null
  dayKwhById?: Record<string, number | null>
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function mpptDayKwhMap(
  fromProduction: { id: string; kwh: number; fault: string | null }[] | undefined,
  fromPeriod: { id: string; kwh: number; fault: string | null }[] | undefined,
  kind: string,
  date: Date,
  now = new Date(),
): Record<string, number | null> {
  const map: Record<string, number | null> = {}
  const apply = (list?: { id: string; kwh: number; fault: string | null }[]) => {
    for (const m of list ?? []) {
      if (map[m.id] != null) continue
      if (m.fault && !(m.kwh > 0)) continue
      if (!Number.isFinite(m.kwh)) continue
      map[m.id] = m.kwh
    }
  }
  apply(fromProduction)
  if (kind === 'day' && sameCalendarDay(date, now)) apply(fromPeriod)
  return map
}

export function MpptRow({ mppts, dayKwhById }: MpptRowProps) {
  if (!mppts || mppts.length === 0) {
    return (
      <section className="mppt-row" aria-hidden>
        <div className="skeleton mppt-row__skel" />
        <div className="skeleton mppt-row__skel" />
      </section>
    )
  }

  const globalMax = Math.max(...mppts.map((m) => (m.fault ? 0 : Math.abs(m.powerW))), 1)

  return (
    <section className="mppt-row" aria-label="PV-Felder">
      {mppts.map((m) => {
        const peak = m.peakW && m.peakW > 0 ? m.peakW : null
        const denom = peak ?? globalMax
        const fill = m.fault ? 0 : Math.round((Math.abs(m.powerW) / denom) * 100)
        const dayKwh = dayKwhById?.[m.id]
        const kwhText = dayKwh != null && Number.isFinite(dayKwh) ? formatKwh(dayKwh) : null
        const tempText = m.tempC != null ? formatTempC(m.tempC) : null
        const meta = [kwhText, tempText].filter(Boolean).join(' · ')
        return (
          <div key={m.id} className={`mppt-pill${m.fault ? ' is-fault' : ''}`}>
            <div className="mppt-pill__fill" style={{ width: `${Math.min(100, fill)}%` }} />
            <div className="mppt-pill__content">
              <span className="mppt-pill__name">{m.name}</span>
              <span className="mppt-pill__watts">{m.fault ?? formatKw(m.powerW)}</span>
              <span className="mppt-pill__meta">{meta || ' '}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

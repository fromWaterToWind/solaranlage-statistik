import { formatEur, formatPercent } from '@/domain/calc'
import type { EnergyTotals } from '@/domain/types'
import './KpiStrip.css'

interface KpiStripProps {
  totals: EnergyTotals | null
  loading: boolean
}

export function KpiStrip({ totals, loading }: KpiStripProps) {
  if (loading || !totals) {
    return (
      <section className="kpi-strip" aria-hidden>
        <div className="skeleton kpi-strip__hero-skel" />
        <div className="kpi-strip__row">
          <div className="skeleton kpi-strip__mini-skel" />
          <div className="skeleton kpi-strip__mini-skel" />
        </div>
      </section>
    )
  }

  return (
    <section className="kpi-strip" aria-label="Kennzahlen">
      <div className="kpi-strip__hero card">
        <span className="kpi-strip__label">Ersparnis</span>
        <span className="kpi-strip__value kpi-strip__value--hero">
          {formatEur(totals.savedEur)}
        </span>
      </div>
      <div className="kpi-strip__row">
        <div className="kpi-strip__mini card">
          <span className="kpi-strip__label">Autarkie</span>
          <span className="kpi-strip__value">
            {formatPercent(totals.autarkyPercent)}
          </span>
        </div>
        <div className="kpi-strip__mini card">
          <span className="kpi-strip__label">Eigenverbrauch</span>
          <span className="kpi-strip__value">
            {formatPercent(totals.selfConsumptionPercent)}
          </span>
        </div>
      </div>
    </section>
  )
}

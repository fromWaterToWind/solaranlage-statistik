import { formatEur, formatKwh, formatPercent } from '@/domain/calc'
import type { EnergyTotals } from '@/domain/types'
import './KpiStrip.css'

interface KpiStripProps {
  totals: EnergyTotals | null
  loading: boolean
}

function Tile({
  label,
  value,
  accent,
  fault,
}: {
  label: string
  value: string
  accent?: boolean
  fault?: boolean
}) {
  return (
    <article className="kpi-strip__tile card">
      <span className="kpi-strip__label">{label}</span>
      <span className={`kpi-strip__value${accent ? ' is-accent' : ''}${fault ? ' is-fault' : ''}`}>
        {value}
      </span>
    </article>
  )
}

export function KpiStrip({ totals, loading }: KpiStripProps) {
  if (loading || !totals) {
    return (
      <section className="kpi-strip" aria-hidden>
        <div className="skeleton kpi-strip__mini-skel" />
        <div className="skeleton kpi-strip__mini-skel" />
        <div className="skeleton kpi-strip__mini-skel" />
        <div className="skeleton kpi-strip__mini-skel" />
      </section>
    )
  }

  const lossFault = Boolean(totals.lossFault)
  const lossShare =
    !lossFault && totals.productionKwh > 0.05
      ? ` · ${formatPercent((totals.lossKwh / totals.productionKwh) * 100)}`
      : ''

  return (
    <section className="kpi-strip" aria-label="Kennzahlen">
      <Tile label="Ersparnis" value={formatEur(totals.savedEur)} accent />
      <Tile label="Autarkiegrad" value={formatPercent(totals.autarkyPercent)} />
      <Tile label="Eigenverbrauchsquote" value={formatPercent(totals.selfConsumptionPercent)} />
      <Tile
        label="Speicherverlust"
        value={lossFault ? totals.lossFault ?? '—' : `${formatKwh(totals.lossKwh)}${lossShare}`}
        fault={lossFault}
      />
    </section>
  )
}

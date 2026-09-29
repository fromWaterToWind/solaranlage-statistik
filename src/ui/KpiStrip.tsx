import { formatEur, formatKwh, formatPercent } from '@/domain/calc'
import type { EnergyTotals, PeriodKind } from '@/domain/types'
import './KpiStrip.css'

interface KpiStripProps {
  totals: EnergyTotals | null
  loading: boolean
  kind?: PeriodKind
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

export function KpiStrip({ totals, loading, kind }: KpiStripProps) {
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
  const outputMissing = totals.productionKwh > 5 && totals.homeKwh < 0.5 && totals.outputKwh < 0.5
  const hideLoss = kind === 'day'
  const hasStorageDelta = totals.storageStartKwh != null && totals.storageEndKwh != null
  const lossLabel = hasStorageDelta ? 'Speicherverlust' : 'DC minus AC'
  const lossShare =
    !lossFault && !outputMissing && totals.productionKwh > 0.05
      ? ` · ${formatPercent((totals.lossKwh / totals.productionKwh) * 100)}`
      : ''

  return (
    <section className="kpi-strip" aria-label="Kennzahlen">
      <Tile label="Ersparnis" value={formatEur(totals.savedEur)} accent />
      <Tile label="Autarkiegrad" value={formatPercent(totals.autarkyPercent)} />
      <Tile label="Eigenverbrauchsquote" value={formatPercent(totals.selfConsumptionPercent)} />
      {hideLoss ? null : (
        <Tile
          label={lossLabel}
          value={
            outputMissing
              ? 'WR AC fehlt'
              : lossFault
                ? totals.lossFault ?? '—'
                : `${formatKwh(totals.lossKwh)}${lossShare}`
          }
          fault={lossFault || outputMissing}
        />
      )}
    </section>
  )
}

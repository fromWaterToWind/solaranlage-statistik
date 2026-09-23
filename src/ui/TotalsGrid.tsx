import { formatKwh, formatKwhOrFault } from '@/domain/calc'
import type { EnergyTotals } from '@/domain/types'
import './TotalsGrid.css'

interface TotalsGridProps {
  totals: EnergyTotals | null
  loading: boolean
}

interface Row {
  label: string
  value: string
  color: string
  fault?: boolean
}

export function TotalsGrid({ totals, loading }: TotalsGridProps) {
  if (loading || !totals) {
    return (
      <section className="card totals-grid" aria-hidden>
        <div className="skeleton totals-grid__skel" />
      </section>
    )
  }

  const mpptRows: Row[] = totals.mppts.map((m) => ({
    label: m.name,
    value: formatKwhOrFault(m.kwh, m.fault),
    color: 'var(--pv)',
    fault: Boolean(m.fault),
  }))

  const battFault = totals.batteryEnergyFault

  const rows: Row[] = [
    { label: 'Erzeugung', value: formatKwh(totals.productionKwh), color: 'var(--pv)' },
    { label: 'Verbrauch', value: formatKwh(totals.homeKwh), color: 'var(--home)' },
    ...mpptRows,
    { label: 'Eingespeist', value: formatKwh(totals.gridExportKwh), color: 'var(--grid-export)' },
    { label: 'Aus Netz', value: formatKwh(totals.gridImportKwh), color: 'var(--grid-import)' },
    {
      label: 'Batterie laden',
      value: formatKwhOrFault(totals.batteryChargeKwh, battFault),
      color: 'var(--battery)',
      fault: Boolean(battFault),
    },
    {
      label: 'Batterie entladen',
      value: formatKwhOrFault(totals.batteryDischargeKwh, battFault),
      color: 'var(--battery)',
      fault: Boolean(battFault),
    },
    {
      label: 'Eigenverbrauch',
      value: formatKwh(totals.selfConsumedKwh),
      color: 'var(--pv)',
    },
  ]

  return (
    <section className="card totals-grid" aria-label="Summen">
      <p className="section-label">Summen</p>
      <ul className="totals-grid__list">
        {rows.map((r) => (
          <li key={r.label} className="totals-grid__item">
            <span className="totals-grid__tick" style={{ background: r.color }} />
            <span className="totals-grid__label">{r.label}</span>
            <span className={`totals-grid__value${r.fault ? ' is-fault' : ''}`}>{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

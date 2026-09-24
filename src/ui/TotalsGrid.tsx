import { formatKwh } from '@/domain/calc'
import type { EnergyTotals } from '@/domain/types'
import './TotalsGrid.css'

interface TotalsGridProps {
  totals: EnergyTotals | null
  loading: boolean
  capacityKwh?: number | null
}

interface Tile {
  label: string
  value: string
  color: string
  fault?: boolean
}

function Metric({ tile }: { tile: Tile }) {
  return (
    <article className="totals-grid__tile card">
      <span className="totals-grid__tick" style={{ background: tile.color }} />
      <span className="totals-grid__label">{tile.label}</span>
      <span className={`totals-grid__value${tile.fault ? ' is-fault' : ''}`}>{tile.value}</span>
    </article>
  )
}

function storageLabel(totals: EnergyTotals, capacityKwh?: number | null): Tile {
  const start = totals.storageStartKwh
  const end = totals.storageEndKwh
  if (start == null && end == null) {
    return {
      label: 'Speicher',
      value: capacityKwh && capacityKwh > 0 ? 'kein Stand' : 'Kapazität fehlt',
      color: 'var(--battery)',
      fault: true,
    }
  }
  const from = start == null ? '—' : formatKwh(start).replace(' kWh', '')
  const to = end == null ? '—' : formatKwh(end).replace(' kWh', '')
  const cap = capacityKwh && capacityKwh > 0 ? ` / ${formatKwh(capacityKwh).replace(' kWh', '')}` : ''
  return {
    label: 'Speicher',
    value: `${from} → ${to}${cap} kWh`,
    color: 'var(--battery)',
    fault: start == null || end == null,
  }
}

export function TotalsGrid({ totals, loading, capacityKwh }: TotalsGridProps) {
  if (loading || !totals) {
    return (
      <section className="totals-grid" aria-hidden>
        <div className="skeleton totals-grid__skel" />
        <div className="skeleton totals-grid__skel" />
      </section>
    )
  }

  const tiles: Tile[] = [storageLabel(totals, capacityKwh)]

  return (
    <section className="totals-grid" aria-label="Speicher">
      <p className="section-label">Speicher</p>
      <div className="totals-grid__tiles">
        {tiles.map((tile) => (
          <Metric key={tile.label} tile={tile} />
        ))}
      </div>
    </section>
  )
}

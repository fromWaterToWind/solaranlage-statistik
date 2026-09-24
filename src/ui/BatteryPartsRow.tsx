import { formatPercent, formatTempC } from '@/domain/calc'
import type { BatteryPartLive } from '@/domain/types'
import './MpptRow.css'

interface BatteryPartsRowProps {
  parts: BatteryPartLive[] | null
  selectedId?: string | null
  onSelect?: (id: string) => void
}

export function BatteryPartsRow({ parts, selectedId, onSelect }: BatteryPartsRowProps) {
  if (!parts || parts.length === 0) return null

  return (
    <section className="mppt-row" aria-label="Batterie-Teile">
      {parts.map((p) => {
        const fill = p.socFault ? 0 : Math.round(p.socPercent)
        const temp = p.tempC != null ? formatTempC(p.tempC) : null
        const selected = selectedId === p.id
        return (
          <button
            key={p.id}
            type="button"
            className={`mppt-pill mppt-pill--batt${p.socFault ? ' is-fault' : ''}${selectedId && !selected ? ' is-off' : ''}`}
            aria-pressed={selected}
            onClick={() => onSelect?.(p.id)}
          >
            <div className="mppt-pill__fill mppt-pill__fill--batt" style={{ width: `${Math.min(100, fill)}%` }} />
            <div className="mppt-pill__content">
              <span className="mppt-pill__name">{p.name}</span>
              <span className="mppt-pill__watts">{p.socFault ?? formatPercent(p.socPercent)}</span>
              <span className="mppt-pill__meta">{temp ?? ' '}</span>
            </div>
          </button>
        )
      })}
    </section>
  )
}

import type { PeriodKind } from '@/domain/types'
import './PeriodBar.css'

interface PeriodBarProps {
  kind: PeriodKind
  label: string
  nextDisabled: boolean
  onKind: (kind: PeriodKind) => void
  onPrev: () => void
  onNext: () => void
}

const KINDS: { id: PeriodKind; label: string }[] = [
  { id: 'day', label: 'Tag' },
  { id: 'month', label: 'Monat' },
  { id: 'year', label: 'Jahr' },
]

export function PeriodBar({
  kind,
  label,
  nextDisabled,
  onKind,
  onPrev,
  onNext,
}: PeriodBarProps) {
  return (
    <div className="period-bar">
      <div className="period-bar__segments" role="tablist" aria-label="Zeitraum">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            className={`period-bar__chip${kind === k.id ? ' is-active' : ''}`}
            onClick={() => onKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="period-bar__nav">
        <button
          type="button"
          className="period-bar__chev"
          aria-label="Vorheriger Zeitraum"
          onClick={onPrev}
        >
          ‹
        </button>
        <span className="period-bar__label">{label}</span>
        <button
          type="button"
          className="period-bar__chev"
          aria-label="Nächster Zeitraum"
          onClick={onNext}
          disabled={nextDisabled}
        >
          ›
        </button>
      </div>
    </div>
  )
}

import { formatKwh, formatPercent } from '@/domain/calc'
import type { ProductionCompare } from '@/domain/productionCompare'
import './ProductionHero.css'

function Cell({
  label,
  kwh,
  delta,
  versus,
  hero,
}: {
  label: string
  kwh: number
  delta: number | null
  versus: string
  hero?: boolean
}) {
  return (
    <article className={`production-hero__cell card${hero ? ' is-hero' : ''}`}>
      <span className="production-hero__label">{label}</span>
      <span className="production-hero__value">{formatKwh(kwh)}</span>
      <Delta value={delta} versus={versus} />
    </article>
  )
}

function Delta({ value, versus }: { value: number | null; versus: string }) {
  if (value == null) return <span className="production-hero__delta is-flat">kein Vergleich</span>
  const abs = formatPercent(Math.abs(value))
  if (value > 0.5) return <span className="production-hero__delta is-up">+{abs} vs. {versus}</span>
  if (value < -0.5) return <span className="production-hero__delta is-down">−{abs} vs. {versus}</span>
  return <span className="production-hero__delta is-flat">±0 vs. {versus}</span>
}

export function ProductionHero({
  compare,
  loading,
}: {
  compare: ProductionCompare | null
  loading: boolean
}) {
  if (loading) {
    return (
      <section className="production-hero" aria-hidden>
        <div className="skeleton production-hero__skel production-hero__skel--hero" />
        <div className="skeleton production-hero__skel" />
        <div className="skeleton production-hero__skel" />
      </section>
    )
  }

  if (!compare) return null

  return (
    <section className="production-hero" aria-label="Erzeugung">
      <Cell
        hero
        label="Heute"
        kwh={compare.today.kwh}
        delta={compare.today.deltaPercent}
        versus="gestern"
      />
      <Cell
        label="7 Tage"
        kwh={compare.week.kwh}
        delta={compare.week.deltaPercent}
        versus="davor"
      />
      <Cell
        label="Monat"
        kwh={compare.month.kwh}
        delta={compare.month.deltaPercent}
        versus="Vormonat"
      />
    </section>
  )
}

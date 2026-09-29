import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatEur, formatKwh, formatPercent } from '@/domain/calc'
import {
  PART_CATALOG,
  investedEur,
  newBoughtPart,
  paybackForecast,
  type BoughtPart,
} from '@/domain/investment'
import { formatDeInput, parseDeNumber } from '@/domain/manualMonth'
import './ReturnCalc.css'


interface ReturnCalcProps {
  parts: BoughtPart[]
  onChange: (parts: BoughtPart[]) => void
  savedEur: number
  producedKwh: number
  monthlySavedEur: number
}

export function ReturnCalc({
  parts,
  onChange,
  savedEur,
  producedKwh,
  monthlySavedEur,
}: ReturnCalcProps) {
  const [catalogOpen, setCatalogOpen] = useState(false)
  const forecast = useMemo(
    () => paybackForecast({ parts, savedEur, producedKwh, monthlySavedEur }),
    [parts, savedEur, producedKwh, monthlySavedEur],
  )
  const invested = investedEur(parts)

  const patch = (id: string, next: Partial<BoughtPart>) => {
    onChange(parts.map((p) => (p.id === id ? { ...p, ...next } : p)))
  }

  const breakEvenLabel = forecast.breakEven
    ? new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(forecast.breakEven)
    : monthlySavedEur < 0.5
      ? 'Tarif und Erzeugung fehlen noch'
      : '—'

  const monthsLeftLabel =
    forecast.monthsLeft == null
      ? '—'
      : forecast.monthsLeft <= 0
        ? 'erreicht'
        : `${Math.ceil(forecast.monthsLeft)} Monate`

  return (
    <section className="return-calc" aria-label="Renditerechner">
      <article className="card return-calc__hero">
        <p className="return-calc__stage">{forecast.stageLabel}</p>
        <p className="return-calc__big">{formatPercent(forecast.progressPct)}</p>
        <p className="return-calc__sub">
          {formatEur(forecast.savedEur)} von {formatEur(invested)} wieder drin
        </p>
        <div className="return-calc__bar" role="progressbar" aria-valuenow={Math.round(forecast.progressPct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${forecast.progressPct}%` }} />
        </div>
        <dl className="return-calc__stats">
          <div>
            <dt>Break-even</dt>
            <dd>{breakEvenLabel}</dd>
          </div>
          <div>
            <dt>Noch</dt>
            <dd>{monthsLeftLabel}</dd>
          </div>
          <div>
            <dt>Bisher erzeugt</dt>
            <dd>{formatKwh(producedKwh)}</dd>
          </div>
        </dl>
      </article>

      <article className="card return-calc__chart-card">
        <p className="section-label">Forecast · kumulierte Ersparnis</p>
        {invested > 0 ? (
          <div className="return-calc__chart">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={forecast.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#2a302b" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#8b958d', fontSize: 11 }} interval={3} />
                <YAxis
                  tick={{ fill: '#8b958d', fontSize: 11 }}
                  width={42}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#121512',
                    border: '1px solid #2a302b',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  formatter={(value, name) => [
                    formatEur(Number(value ?? 0)),
                    name === 'saved' ? 'Ersparnis' : 'Invest',
                  ]}
                />
                <Line type="monotone" dataKey="invested" stroke="#8b958d" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="saved" stroke="#e8b84a" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="return-calc__hint">Erst Teile eintragen — dann läuft die Kurve.</p>
        )}
        <p className="return-calc__hint">
          Forecast mit {formatEur(monthlySavedEur)} / Monat aus den letzten Nachträgen plus laufendem
          Monat. Kein Börsenkurs, nur eure kWh × Tarif.
        </p>
      </article>

      <div>
        <p className="section-label">Gekaufte Teile</p>
        <ul className="return-calc__parts">
          {parts.map((p) => (
            <li key={p.id} className="card return-calc__part">
              <div className="return-calc__part-head">
                <strong>{p.name}</strong>
                <span>{formatEur(p.qty * p.unitPriceEur)}</span>
              </div>
              <div className="return-calc__part-fields">
                <NumberField
                  id={`${p.id}-qty`}
                  label="Stück"
                  value={p.qty}
                  onChange={(n) => patch(p.id, { qty: Math.max(0, n ?? 0) })}
                />
                <NumberField
                  id={`${p.id}-price`}
                  label="€ / Stück"
                  value={p.unitPriceEur}
                  onChange={(n) => patch(p.id, { unitPriceEur: Math.max(0, n ?? 0) })}
                />
              </div>
              <button
                type="button"
                className="return-calc__remove"
                onClick={() => onChange(parts.filter((x) => x.id !== p.id))}
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
        {catalogOpen ? (
          <ul className="return-calc__catalog">
            {PART_CATALOG.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="return-calc__catalog-item"
                  onClick={() => {
                    onChange([...parts, newBoughtPart(c)])
                    setCatalogOpen(false)
                  }}
                >
                  <span>
                    {c.name}
                    <small>
                      {c.kind} · {c.hint}
                    </small>
                  </span>
                  <span>{c.priceEur ? formatEur(c.priceEur) : 'frei'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button type="button" className="return-calc__add" onClick={() => setCatalogOpen(true)}>
            + Teil aus Vorschlägen
          </button>
        )}
      </div>
    </section>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (n: number | null) => void
}) {
  const [text, setText] = useState(() => formatDeInput(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatDeInput(value))
  }, [value, focused])
  return (
    <label className="return-calc__field" htmlFor={id}>
      {label}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseDeNumber(e.target.value))
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setText(formatDeInput(value))
        }}
      />
    </label>
  )
}

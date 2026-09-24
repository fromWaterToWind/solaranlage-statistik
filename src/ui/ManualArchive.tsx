import { useEffect, useMemo, useState } from 'react'
import { formatKwh } from '@/domain/calc'
import {
  deriveBlankFields,
  emptyManualMonth,
  formatDeInput,
  groupByYear,
  hasAnyValue,
  MANUAL_FIELDS,
  monthKey,
  parseDeNumber,
  sumManualField,
  type ManualFieldKey,
  type ManualMonth,
} from '@/domain/manualMonth'
import './ManualArchive.css'

interface ManualArchiveProps {
  rows: ManualMonth[]
  onChange: (rows: ManualMonth[]) => void
  embedded?: boolean
}

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

function monthTitle(row: ManualMonth): string {
  return `${MONTH_NAMES[row.month - 1]} ${row.year}`
}

function dash(n: number | null): string {
  return n == null ? '—' : formatKwh(n).replace(' kWh', '')
}

function monthSummary(row: ManualMonth): string {
  if (!hasAnyValue(row)) return 'leer'
  const bits: string[] = []
  if (row.productionKwh != null) bits.push(`PV ${dash(row.productionKwh)}`)
  if (row.totalUseKwh != null) bits.push(`Haus ${dash(row.totalUseKwh)}`)
  else if (row.houseInflowKwh != null) bits.push(`Zufluss ${dash(row.houseInflowKwh)}`)
  return `${bits.join(' · ')} kWh`
}

function KwhField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: number | null
  onChange: (n: number | null) => void
}) {
  const [text, setText] = useState(() => formatDeInput(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatDeInput(value))
  }, [value, focused])

  return (
    <label className="manual-archive__field" htmlFor={id}>
      {label}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="—"
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
      {hint ? <span className="manual-archive__field-hint">{hint}</span> : null}
    </label>
  )
}

export function ManualArchive({ rows, onChange, embedded = false }: ManualArchiveProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const now = new Date()
  const [newYear, setNewYear] = useState(now.getFullYear())
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1)

  const years = useMemo(() => groupByYear(rows), [rows])
  const existing = useMemo(
    () => new Set(rows.map((r) => monthKey(r.year, r.month))),
    [rows],
  )

  const patch = (year: number, month: number, key: ManualFieldKey, value: number | null) => {
    onChange(
      rows.map((r) =>
        r.year === year && r.month === month ? { ...r, [key]: value } : r,
      ),
    )
  }

  const addMonth = () => {
    if (existing.has(monthKey(newYear, newMonth))) {
      setOpenKey(monthKey(newYear, newMonth))
      setAdding(false)
      return
    }
    const row = emptyManualMonth(newYear, newMonth)
    onChange([...rows, row])
    setOpenKey(monthKey(newYear, newMonth))
    setAdding(false)
  }

  return (
    <section
      className={`manual-archive${embedded ? ' is-embedded' : ' card'}`}
      aria-label="Nachträge"
    >
      {embedded ? null : <p className="section-label">Nachträge · kWh</p>}
      <p className="manual-archive__hint">
        Alte Monatswerte ohne Tracker. Speicher Anfang/Ende in kWh, damit der Verlust
        Produktion − Zufluss − (Ende − Anfang) stimmt. Leere Zellen bleiben leer.
      </p>

      {years.map(({ year, months }) => (
        <div key={year} className="manual-archive__year">
          <div className="manual-archive__year-head">
            <span>{year}</span>
            <span>
              {dash(sumManualField(months, 'productionKwh'))}
              {' / '}
              {dash(
                sumManualField(months, 'totalUseKwh') ??
                  sumManualField(months, 'houseInflowKwh'),
              )}{' '}
              kWh
            </span>
          </div>
          <ul className="manual-archive__list">
            {months.map((row) => {
              const key = monthKey(row.year, row.month)
              const open = openKey === key
              return (
                <li key={key} className="manual-archive__item">
                  <button
                    type="button"
                    className="manual-archive__row"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    <span className="manual-archive__row-title">{monthTitle(row)}</span>
                    <span className="manual-archive__row-sum">{monthSummary(row)}</span>
                  </button>
                  {open ? (
                    <div className="manual-archive__edit">
                      <div className="manual-archive__fields">
                        {MANUAL_FIELDS.map((f) => (
                          <KwhField
                            key={f.key}
                            id={`${key}-${f.key}`}
                            label={f.label}
                            hint={f.hint}
                            value={row[f.key]}
                            onChange={(n) => patch(row.year, row.month, f.key, n)}
                          />
                        ))}
                      </div>
                      <div className="manual-archive__actions">
                        <button
                          type="button"
                          className="manual-archive__ghost"
                          onClick={() =>
                            onChange(
                              rows.map((r) =>
                                r.year === row.year && r.month === row.month
                                  ? deriveBlankFields(r)
                                  : r,
                              ),
                            )
                          }
                        >
                          Leere Felder ableiten
                        </button>
                        <button
                          type="button"
                          className="manual-archive__ghost is-danger"
                          onClick={() => {
                            onChange(
                              rows.filter(
                                (r) => !(r.year === row.year && r.month === row.month),
                              ),
                            )
                            setOpenKey(null)
                          }}
                        >
                          Monat löschen
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {adding ? (
        <div className="manual-archive__add">
          <label>
            Jahr
            <input
              type="number"
              min={2000}
              max={2100}
              value={newYear}
              onChange={(e) => setNewYear(Number(e.target.value) || now.getFullYear())}
            />
          </label>
          <label>
            Monat
            <select
              value={newMonth}
              onChange={(e) => setNewMonth(Number(e.target.value))}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="manual-archive__solid" onClick={addMonth}>
            Anlegen
          </button>
          <button type="button" className="manual-archive__ghost" onClick={() => setAdding(false)}>
            Abbrechen
          </button>
        </div>
      ) : (
        <button type="button" className="manual-archive__solid" onClick={() => setAdding(true)}>
          + Monat
        </button>
      )}
    </section>
  )
}

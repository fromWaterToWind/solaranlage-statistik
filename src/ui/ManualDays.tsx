import { useEffect, useState } from 'react'
import {
  emptyManualDay,
  hasDayValue,
  MANUAL_DAY_FIELDS,
  type ManualDay,
  type ManualDayFieldKey,
} from '@/domain/manualDay'
import { formatDeInput, parseDeNumber } from '@/domain/manualMonth'
import './ManualArchive.css'

interface ManualDaysProps {
  rows: ManualDay[]
  onChange: (rows: ManualDay[]) => void
}

function formatDayTitle(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(y, m - 1, d))
}

export function ManualDays({ rows, onChange }: ManualDaysProps) {
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const today = new Date()
  const [newDate, setNewDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  )

  const patch = (date: string, key: ManualDayFieldKey, value: number | null) => {
    onChange(rows.map((r) => (r.date === date ? { ...r, [key]: value } : r)))
  }

  const add = () => {
    if (rows.some((r) => r.date === newDate)) {
      setOpen(newDate)
      setAdding(false)
      return
    }
    onChange([emptyManualDay(newDate), ...rows])
    setOpen(newDate)
    setAdding(false)
  }

  return (
    <section className="manual-archive is-embedded" aria-label="Tages-Nachträge">
      <p className="manual-archive__hint">
        Einzelne Tage, z. B. Eigenverbrauch bevor der Shelly da war. Der Tag im Verlauf wird
        überschrieben, der Rest kommt weiter vom Tracker.
      </p>
      <ul className="manual-archive__list">
        {rows.map((row) => {
          const isOpen = open === row.date
          return (
            <li key={row.date} className="manual-archive__item">
              <button
                type="button"
                className="manual-archive__row"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : row.date)}
              >
                <span className="manual-archive__row-title">{formatDayTitle(row.date)}</span>
                <span className="manual-archive__row-sum">
                  {hasDayValue(row)
                    ? [
                        row.houseInflowKwh != null ? `WR ${formatDeInput(row.houseInflowKwh, 2)}` : null,
                        `EV ${row.selfUseKwh ?? '—'}`,
                        `V ${row.homeKwh ?? '—'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'leer'}
                </span>
              </button>
              {isOpen ? (
                <div className="manual-archive__edit">
                  <div className="manual-archive__fields">
                    {MANUAL_DAY_FIELDS.map((f) => (
                      <DayField
                        key={f.key}
                        id={`${row.date}-${f.key}`}
                        label={f.label}
                        hint={f.hint}
                        value={row[f.key]}
                        onChange={(n) => patch(row.date, f.key, n)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="manual-archive__ghost is-danger"
                    onClick={() => {
                      onChange(rows.filter((r) => r.date !== row.date))
                      setOpen(null)
                    }}
                  >
                    Tag löschen
                  </button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {adding ? (
        <div className="manual-archive__add">
          <label>
            Tag
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
          <button type="button" className="manual-archive__solid" onClick={add}>
            Anlegen
          </button>
          <button type="button" className="manual-archive__ghost" onClick={() => setAdding(false)}>
            Abbrechen
          </button>
        </div>
      ) : (
        <button type="button" className="manual-archive__solid" onClick={() => setAdding(true)}>
          + Tag
        </button>
      )}
    </section>
  )
}

function DayField({
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
  const [text, setText] = useState(() => formatDeInput(value, 2))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatDeInput(value, 2))
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
          setText(formatDeInput(value, 2))
        }}
      />
      {hint ? <span className="manual-archive__field-hint">{hint}</span> : null}
    </label>
  )
}

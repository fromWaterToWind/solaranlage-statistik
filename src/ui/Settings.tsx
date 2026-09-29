import { useEffect, useRef, useState } from 'react'
import type { AppConfig, EntityMap } from '@/config/appConfig'
import { canUseParentHass } from '@/data/haConn'
import {
  fetchHaEntityIds,
  HA_ENTITY_DATALIST_ID,
  isHaReachableForPicker,
} from '@/data/haEntityPicker'
import { pingGrowatt } from '@/data/growatt'
import { GrowattSync } from '@/ui/GrowattSync'
import { formatDeInput, parseDeNumber } from '@/domain/manualMonth'
import type { ManualMonth } from '@/domain/manualMonth'
import type { ManualDay } from '@/domain/manualDay'
import {
  formatCtInput,
  formatDeDate,
  newTariffPeriod,
  parseDeDate,
  windowBuyCt,
} from '@/domain/tariff'
import type { TariffPeriod } from '@/domain/types'
import { ManualArchive } from '@/ui/ManualArchive'
import { ManualDays } from '@/ui/ManualDays'
import {
  GRID_METER_ECOTRACKER_FIELDS,
  GRID_METER_SHELLY_FIELDS,
  inferGridMeterKind,
  type GridMeterKind,
} from '@/domain/gridMeter'
import { EntityIdInput, syncLegacyPv } from '@/ui/PlantModelEditors'
import './Settings.css'

interface SettingsProps {
  config: AppConfig
  onSave: (config: AppConfig) => void
  onApply?: (config: AppConfig) => void
  onClose: () => void
  manualMonths: ManualMonth[]
  onManualChange: (rows: ManualMonth[]) => void
  manualDays: ManualDay[]
  onManualDaysChange: (rows: ManualDay[]) => void
}

const ENTITY_FIELDS: { key: keyof EntityMap; label: string }[] = [
  { key: 'solarPower', label: 'PV gesamt (Verlauf, W)' },
  { key: 'generationToday', label: 'Erzeugung heute' },
  { key: 'soc', label: 'Batterie SOC' },
  { key: 'batteryPower', label: 'Batterie Leistung gesamt (+ Entladen)' },
  { key: 'garagePower', label: 'Shelly Garage Leistung (W) · WR AC' },
  { key: 'gridPower', label: 'Netz Leistung (EcoTracker)' },
  { key: 'homeToday', label: 'Shelly Garage täglich (kWh) · WR AC' },
  { key: 'exportToday', label: 'Einspeisung heute' },
  { key: 'importToday', label: 'Netzbezug heute' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function splitTime(value: string): { h: string; m: string } {
  const [h = '00', m = '00'] = value.split(':')
  return { h: h.padStart(2, '0'), m: (m || '00').padStart(2, '0') }
}

function TimeSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { h, m } = splitTime(value)
  return (
    <div className="settings__time">
      <select
        aria-label="Stunde"
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m}`)}
      >
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </select>
      <span>:</span>
      <select
        aria-label="Minute"
        value={m}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
      >
        {MINUTES.map((min) => (
          <option key={min} value={min}>
            {min}
          </option>
        ))}
      </select>
    </div>
  )
}

function CtField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (ct: number) => void
}) {
  const [text, setText] = useState(() => formatCtInput(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatCtInput(value))
  }, [value, focused])

  return (
    <label className="settings__full" htmlFor={id}>
      {label}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseDeNumber(e.target.value)
          if (n != null) onChange(n)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setText(formatCtInput(value))
        }}
      />
    </label>
  )
}

function DateField({
  id,
  label,
  value,
  placeholder,
  allowEmpty,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  placeholder?: string
  allowEmpty?: boolean
  onChange: (iso: string | null) => void
}) {
  const [text, setText] = useState(() => formatDeDate(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatDeDate(value))
  }, [value, focused])

  const commit = (raw: string) => {
    const parsed = parseDeDate(raw)
    if (parsed) {
      onChange(parsed)
      setText(formatDeDate(parsed))
      return
    }
    if (allowEmpty && raw.trim() === '') {
      onChange(null)
      setText('')
      return
    }
    setText(formatDeDate(value))
  }

  return (
    <label className="settings__full" htmlFor={id}>
      {label}
      <input
        id={id}
        autoComplete="off"
        placeholder={placeholder ?? 'TT.MM.JJJJ'}
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          const parsed = parseDeDate(next)
          if (parsed) onChange(parsed)
          else if (allowEmpty && next.trim() === '') onChange(null)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          commit(text)
        }}
      />
    </label>
  )
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Settings({
  config,
  onSave,
  onApply,
  manualMonths,
  onManualChange,
  manualDays,
  onManualDaysChange,
}: SettingsProps) {
  const [draft, setDraft] = useState<AppConfig>(config)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [advanced, setAdvanced] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [openWindows, setOpenWindows] = useState<Record<string, boolean>>({})
  const [growattMsg, setGrowattMsg] = useState<string | null>(null)
  const [growattBusy, setGrowattBusy] = useState(false)
  const [meterKind, setMeterKind] = useState<GridMeterKind>(() => inferGridMeterKind(config.entities))
  const [entityPickerIds, setEntityPickerIds] = useState<string[] | null>(null)
  const insideHa = canUseParentHass()
  const pickerReady = Boolean(entityPickerIds?.length)
  const periods = draft.tariff.periods ?? []

  useEffect(() => {
    if (!isHaReachableForPicker(config.haUrl, config.haToken)) return
    let cancelled = false
    void fetchHaEntityIds(config.haUrl, config.haToken).then((ids) => {
      if (!cancelled && ids.length > 0) setEntityPickerIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [config.haUrl, config.haToken])

  const syncedDraft = (): AppConfig => {
    const current = draftRef.current
    return {
      ...current,
      entities: syncLegacyPv(current.entities, current.pvFields ?? []),
    }
  }

  const save = () => {
    onSave(syncedDraft())
  }

  const applySetup = () => {
    const next = syncedDraft()
    setDraft(next)
    onApply?.(next)
    onSave(next)
  }

  const pingGrowattConnection = () => {
    setGrowattBusy(true)
    setGrowattMsg(null)
    const current = draftRef.current
    void pingGrowatt(current.growatt ?? { token: '', deviceSn: '', plantId: '' }).then((r) => {
      setGrowattMsg(r.message)
      setGrowattBusy(false)
      if (r.ok) {
        const extra = current.growatt?.extraDeviceSn?.trim() || r.extraSns?.[0] || ''
        const next = {
          ...current,
          growatt: {
            ...(current.growatt ?? { token: '', deviceSn: '', plantId: '' }),
            deviceType: 'noah',
            extraDeviceSn: extra,
            nexaFrom: current.growatt?.nexaFrom || '2026-09-02',
          },
          entities: syncLegacyPv(current.entities, current.pvFields ?? []),
        }
        setDraft(next)
        onApply?.(next)
      }
    })
  }

  const meterFields =
    meterKind === 'ecotracker'
      ? GRID_METER_ECOTRACKER_FIELDS
      : meterKind === 'shelly'
        ? GRID_METER_SHELLY_FIELDS
        : []

  const setPeriods = (next: TariffPeriod[]) => {
    setDraft((prev) => ({ ...prev, tariff: { periods: next } }))
  }

  const patchPeriod = (id: string, patch: Partial<TariffPeriod>) => {
    setDraft((prev) => {
      const list = prev.tariff.periods ?? []
      return {
        ...prev,
        tariff: {
          periods: list.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        },
      }
    })
  }

  return (
    <div className="settings" role="dialog" aria-label="Einstellungen">
      <header className="settings__head">
        <h2 className="settings__title">Einstellungen</h2>
        <button type="button" className="settings__close" onClick={save} aria-label="Schließen">
          ×
        </button>
      </header>

      {pickerReady ? (
        <datalist id={HA_ENTITY_DATALIST_ID}>
          {entityPickerIds!.map((eid) => (
            <option key={eid} value={eid} />
          ))}
        </datalist>
      ) : null}

      <section className="card settings__block">
        <p className="section-label">Anlage einrichten</p>
        <p className="settings__hint">
          Topologie A: Speicher und Wechselrichter in einem Gerät (Growatt Nexa, Marstek o. ä.) — plus ein
          Zähler am Netzanschluss.
        </p>
        {insideHa ? (
          <p className="settings__hint">Sidebar ist verbunden.</p>
        ) : (
          <p className="settings__hint">
            Growatt Open API für Live und Verlauf; Zähler-Entities aus Home Assistant.
          </p>
        )}

        <p className="section-label">Growatt</p>
        <p className="settings__hint">
          Token aus dem Shine-Portal (Open API v4). Seriennummer der Nexa auf dem Typenschild.
        </p>
        <label className="settings__full">
          Token
          <input
            type="password"
            autoComplete="off"
            value={draft.growatt?.token ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                growatt: {
                  ...(draft.growatt ?? { token: '', deviceSn: '0HVRD0ZR247T000V', plantId: '' }),
                  token: e.target.value,
                },
              })
            }
          />
        </label>
        <label className="settings__full">
          Nexa SN
          <input
            spellCheck={false}
            placeholder="0HVRD0ZR247T000V"
            value={draft.growatt?.deviceSn ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                growatt: {
                  ...(draft.growatt ?? { token: '', deviceSn: '', plantId: '' }),
                  deviceSn: e.target.value,
                },
              })
            }
          />
        </label>
        <button
          type="button"
          className="settings__add"
          disabled={growattBusy}
          onClick={pingGrowattConnection}
        >
          {growattBusy ? 'Prüfe …' : 'Verbindung prüfen'}
        </button>
        {growattMsg ? <p className="settings__hint">{growattMsg}</p> : null}

        <fieldset className="settings__meter-choice">
          <legend className="section-label">Netz-Zähler</legend>
          <p className="settings__hint">Ein Zähler reicht für Bezug und Einspeisung — EcoTracker oder Shelly.</p>
          <label className="settings__meter-option">
            <input
              type="radio"
              name="grid-meter"
              checked={meterKind === 'ecotracker'}
              onChange={() => setMeterKind('ecotracker')}
            />
            EcoTracker (HA Entity)
          </label>
          <label className="settings__meter-option">
            <input
              type="radio"
              name="grid-meter"
              checked={meterKind === 'shelly'}
              onChange={() => setMeterKind('shelly')}
            />
            Shelly (HA Entity)
          </label>
          <label className="settings__meter-option">
            <input
              type="radio"
              name="grid-meter"
              checked={meterKind === 'none'}
              onChange={() => setMeterKind('none')}
            />
            Keiner
          </label>
        </fieldset>

        {meterFields.map((f) => (
          <label key={f.key} className="settings__full">
            {f.label}
            <EntityIdInput
              pickerReady={pickerReady}
              value={draft.entities[f.key]}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  entities: { ...draft.entities, [f.key]: value },
                })
              }
            />
          </label>
        ))}

        <button type="button" className="settings__save settings__apply" onClick={applySetup}>
          Übernehmen
        </button>
      </section>

      <section className="card settings__block">
        <p className="section-label">Stromtarif · ct/kWh</p>
        <p className="settings__hint">
          Preise in Cent, zwei Nachkommastellen (z. B. 32,15). Datum als TT.MM.JJJJ. Mehrere Verträge
          hintereinander: alter Preis bis zum letzten Tag, neuer Preis ab dem Folgetag.
        </p>
        {periods.map((period, index) => {
          const windows = period.windows ?? []
          const showTimes = openWindows[period.id] || windows.length > 0
          return (
            <div key={period.id} className="settings__period">
              <p className="settings__period-title">Vertrag {index + 1}</p>
              <div className="settings__period-dates">
                <DateField
                  id={`${period.id}-from`}
                  label="Gültig ab"
                  value={period.validFrom}
                  onChange={(iso) => {
                    if (iso) patchPeriod(period.id, { validFrom: iso })
                  }}
                />
                <DateField
                  id={`${period.id}-to`}
                  label="Bis einschließlich"
                  value={period.validTo}
                  placeholder="offen"
                  allowEmpty
                  onChange={(iso) => patchPeriod(period.id, { validTo: iso })}
                />
              </div>
              <p className="settings__hint">
                {period.validTo ? null : 'Ohne Enddatum gilt der Vertrag weiter.'}
              </p>
              <div className="settings__period-prices">
                <CtField
                  id={`${period.id}-buy`}
                  label="Bezug ct/kWh"
                  value={period.buyCtPerKwh}
                  onChange={(buyCtPerKwh) => patchPeriod(period.id, { buyCtPerKwh })}
                />
                <CtField
                  id={`${period.id}-sell`}
                  label="Einspeisung ct/kWh"
                  value={period.sellCtPerKwh}
                  onChange={(sellCtPerKwh) => patchPeriod(period.id, { sellCtPerKwh })}
                />
              </div>
              {showTimes ? (
                <>
                  <p className="settings__hint">HT/NT in diesem Vertrag, Uhrzeiten 00–23.</p>
                  {windows.map((w, i) => (
                    <div key={`${period.id}-w-${i}`} className="settings__window">
                      <label>
                        Von
                        <TimeSelect
                          value={w.from}
                          onChange={(from) => {
                            const next = [...windows]
                            next[i] = { ...next[i], from }
                            patchPeriod(period.id, { windows: next })
                          }}
                        />
                      </label>
                      <label>
                        Bis
                        <TimeSelect
                          value={w.to}
                          onChange={(to) => {
                            const next = [...windows]
                            next[i] = { ...next[i], to }
                            patchPeriod(period.id, { windows: next })
                          }}
                        />
                      </label>
                      <CtField
                        id={`${period.id}-w-${i}`}
                        label="Bezug ct/kWh"
                        value={windowBuyCt(w, period.buyCtPerKwh)}
                        onChange={(buyCtPerKwh) => {
                          const next = [...windows]
                          next[i] = { ...next[i], buyCtPerKwh }
                          patchPeriod(period.id, { windows: next })
                        }}
                      />
                      <button
                        type="button"
                        className="settings__remove"
                        aria-label="Zeitfenster entfernen"
                        onClick={() =>
                          patchPeriod(period.id, {
                            windows: windows.filter((_, j) => j !== i),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="settings__add"
                    onClick={() =>
                      patchPeriod(period.id, {
                        windows: [
                          ...windows,
                          { from: '06:00', to: '22:00', buyCtPerKwh: period.buyCtPerKwh },
                        ],
                      })
                    }
                  >
                    + Zeitfenster
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="settings__add"
                  onClick={() => setOpenWindows((s) => ({ ...s, [period.id]: true }))}
                >
                  HT/NT Zeitfenster
                </button>
              )}
              {periods.length > 1 ? (
                <button
                  type="button"
                  className="settings__add is-danger"
                  onClick={() => setPeriods(periods.filter((p) => p.id !== period.id))}
                >
                  Vertrag löschen
                </button>
              ) : null}
            </div>
          )
        })}
        <button
          type="button"
          className="settings__add"
          onClick={() => {
            const last = periods[periods.length - 1]
            setPeriods([...periods, newTariffPeriod(last, todayIso())])
          }}
        >
          + Vertrag
        </button>
      </section>

      <section className="card settings__block">
        <button
          type="button"
          className="settings__add"
          onClick={() => setShowArchive((v) => !v)}
        >
          {showArchive ? 'Nachträge ausblenden' : 'Nachträge (Monate und Tage)'}
        </button>
        {showArchive ? (
          <>
            <p className="settings__hint">Monate ohne Tracker, oder um einen Tracker-Monat zu ersetzen.</p>
            <ManualArchive embedded rows={manualMonths} onChange={onManualChange} />
            <p className="section-label">Tage</p>
            <ManualDays rows={manualDays} onChange={onManualDaysChange} />
          </>
        ) : (
          <p className="settings__hint">
            Monatswerte ohne Tracker — und einzelne Tage, etwa Eigenverbrauch bevor der Shelly da war.
          </p>
        )}
      </section>

      <section className="card settings__block">
        <p className="section-label">Anlage · Modell</p>
        <p className="settings__hint">
          PV-Geometrie, Verlust-Schätzung, Standort für die Prognose und Batterie-Kapazität liegen im
          Tab <strong>Anlage</strong> in der unteren Navigation.
        </p>
      </section>

      <section className="card settings__block">
        <p className="section-label">Home Assistant</p>
        {insideHa ? (
          <p className="settings__hint">Verbunden über die Companion-App. Kein Token nötig.</p>
        ) : (
          <>
            <p className="settings__hint">
              In der Companion-App als Sidebar nutzen — oder URL + Long-Lived Token (nur im Heimnetz).
            </p>
            <label className="settings__full">
              URL
              <input
                type="url"
                placeholder="http://homeassistant.local:8123"
                value={draft.haUrl}
                onChange={(e) => setDraft({ ...draft, haUrl: e.target.value })}
              />
            </label>
            <label className="settings__full">
              Token
              <input
                type="password"
                autoComplete="off"
                value={draft.haToken}
                onChange={(e) => setDraft({ ...draft, haToken: e.target.value })}
              />
            </label>
          </>
        )}
      </section>

      <section className="card settings__block">
        <p className="section-label">Growatt Verlauf</p>
        <p className="settings__hint">
          Historie über Open API (`queryHistoricalData`). Token und Nexa-SN stehen oben unter Anlage
          einrichten. Höchstens eine Anfrage pro Minute.
        </p>
        <label className="settings__full">
          Noah SN (zweites Gerät)
          <input
            spellCheck={false}
            placeholder="Alte Noah, vor der Nexa"
            value={draft.growatt?.extraDeviceSn ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                growatt: {
                  ...(draft.growatt ?? { token: '', deviceSn: '', plantId: '' }),
                  extraDeviceSn: e.target.value,
                },
              })
            }
          />
        </label>
        <p className="settings__hint">
          Ab 02.09.2026 kommt der Verlauf von der Nexa. Davor holt der Knopf den alten Noah — Live
          bleibt die Nexa.
        </p>
        <GrowattSync config={draft.growatt ?? { token: '', deviceSn: '', plantId: '' }} />
      </section>

      <section className="card settings__block">
        <button
          type="button"
          className="settings__add"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? 'Sensoren ausblenden' : 'Sensoren (Entity IDs)'}
        </button>
        {advanced
          ? ENTITY_FIELDS.map((f) => (
              <label key={f.key} className="settings__full">
                {f.label}
                <EntityIdInput
                  pickerReady={pickerReady}
                  value={draft.entities[f.key]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      entities: { ...draft.entities, [f.key]: value },
                    })
                  }
                />
              </label>
            ))
          : null}
      </section>

      <button type="button" className="settings__save" onClick={save}>
        Speichern
      </button>
    </div>
  )
}

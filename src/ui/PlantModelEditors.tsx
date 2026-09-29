import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, EntityMap, NamedBatteryPart, NamedPowerSensor } from '@/config/appConfig'
import { newBatteryPart, newNamedSensor } from '@/config/appConfig'
import { HA_ENTITY_DATALIST_ID, entityPickerPlaceholder } from '@/data/haEntityPicker'
import { formatDeInput, parseDeNumber } from '@/domain/manualMonth'
import {
  angleLossFraction,
  cableLossFraction,
  temperatureLossFraction,
} from '@/domain/losses'

function parseOptionalDeNumber(text: string): number | undefined {
  const raw = text.trim()
  if (!raw) return undefined
  const n = parseDeNumber(raw)
  return n != null && Number.isFinite(n) ? n : undefined
}

function formatLossPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1).replace('.', ',')} %`
}

export function syncLegacyPv(entities: EntityMap, pvFields: NamedPowerSensor[]): EntityMap {
  const next = { ...entities }
  for (const f of pvFields) {
    if (f.id === 'pv1') next.pv1Power = f.entityId
    if (f.id === 'pv2') next.pv2Power = f.entityId
    if (f.id === 'pv3') next.pv3Power = f.entityId
  }
  return next
}

export function EntityIdInput({
  id,
  value,
  onChange,
  placeholder,
  pickerReady,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  pickerReady: boolean
}) {
  return (
    <input
      id={id}
      type="text"
      spellCheck={false}
      list={pickerReady ? HA_ENTITY_DATALIST_ID : undefined}
      placeholder={entityPickerPlaceholder(placeholder ?? 'sensor.…', pickerReady)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function NamedFieldsEditor({
  title,
  hint,
  fields,
  addLabel,
  onChange,
  pickerReady,
}: {
  title: string
  hint: string
  fields: NamedPowerSensor[]
  addLabel: string
  onChange: (next: NamedPowerSensor[]) => void
  pickerReady: boolean
}) {
  return (
    <section className="card settings__block">
      <p className="section-label">{title}</p>
      <p className="settings__hint">{hint}</p>
      {fields.map((field) => (
        <div key={field.id} className="settings__named settings__named--pv">
          <label className="settings__full">
            Name
            <input
              value={field.name}
              onChange={(e) =>
                onChange(fields.map((f) => (f.id === field.id ? { ...f, name: e.target.value } : f)))
              }
            />
          </label>
          <label className="settings__full">
            Leistung
            <EntityIdInput
              pickerReady={pickerReady}
              value={field.entityId}
              onChange={(entityId) =>
                onChange(
                  fields.map((f) => (f.id === field.id ? { ...f, entityId } : f)),
                )
              }
            />
          </label>
          <label className="settings__full">
            Temperatur
            <EntityIdInput
              pickerReady={pickerReady}
              placeholder="sensor.…_temp"
              value={field.tempEntityId ?? ''}
              onChange={(tempEntityId) =>
                onChange(
                  fields.map((f) => (f.id === field.id ? { ...f, tempEntityId } : f)),
                )
              }
            />
          </label>
          <label className="settings__full">
            Max. Watt
            <input
              inputMode="numeric"
              placeholder="z. B. 430"
              value={field.peakW ? String(field.peakW) : ''}
              onChange={(e) => {
                const n = parseDeNumber(e.target.value)
                onChange(
                  fields.map((f) =>
                    f.id === field.id ? { ...f, peakW: n && n > 0 ? n : undefined } : f,
                  ),
                )
              }}
            />
          </label>
          <div className="settings__pv-geo settings__full">
            <label>
              Azimut °
              <input
                inputMode="numeric"
                placeholder="180"
                value={field.azimuthDeg !== null ? String(field.azimuthDeg) : ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const azimuthDeg = raw === '' ? null : parseDeNumber(raw)
                  onChange(
                    fields.map((f) => (f.id === field.id ? { ...f, azimuthDeg } : f)),
                  )
                }}
              />
            </label>
            <label>
              Neigung °
              <input
                inputMode="numeric"
                placeholder="30"
                value={field.tiltDeg !== null ? String(field.tiltDeg) : ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const tiltDeg = raw === '' ? null : parseDeNumber(raw)
                  onChange(
                    fields.map((f) => (f.id === field.id ? { ...f, tiltDeg } : f)),
                  )
                }}
              />
            </label>
            <label>
              kWp
              <input
                inputMode="decimal"
                placeholder="z. B. 4,3"
                value={field.kWp !== null ? formatDeInput(field.kWp) : ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const kWp = raw === '' ? null : parseDeNumber(raw)
                  const validKwp = kWp !== null && kWp > 0 ? kWp : null
                  onChange(
                    fields.map((f) => {
                      if (f.id !== field.id) return f
                      const peakW =
                        f.peakW && f.peakW > 0
                          ? f.peakW
                          : validKwp
                            ? validKwp * 1000
                            : undefined
                      return { ...f, kWp: validKwp, peakW }
                    }),
                  )
                }}
              />
            </label>
            <label>
              Verschattung
              <select
                value={field.shading ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  const shading = v === '' ? null : (v as NamedPowerSensor['shading'])
                  onChange(
                    fields.map((f) => (f.id === field.id ? { ...f, shading } : f)),
                  )
                }}
              >
                <option value="">—</option>
                <option value="none">Keine</option>
                <option value="light">Leicht</option>
                <option value="medium">Mittel</option>
                <option value="strong">Stark</option>
              </select>
            </label>
            <label className="settings__pv-geo-when">
              Wann (optional)
              <input
                placeholder="z. B. Vormittag, Winter"
                value={field.shadingWhen ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  const shadingWhen = raw.trim() ? raw : null
                  onChange(
                    fields.map((f) => (f.id === field.id ? { ...f, shadingWhen } : f)),
                  )
                }}
              />
            </label>
          </div>
          <button
            type="button"
            className="settings__remove"
            aria-label={`${field.name} entfernen`}
            onClick={() => onChange(fields.filter((f) => f.id !== field.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="settings__add"
        onClick={() => onChange([...fields, newNamedSensor(`${addLabel} ${fields.length + 1}`)])}
      >
        {addLabel} hinzufügen
      </button>
    </section>
  )
}

export function LossesEstimate({
  pvFields,
  plantLatitude,
}: {
  pvFields: NamedPowerSensor[]
  plantLatitude: number | null
}) {
  const [lengthM, setLengthM] = useState('')
  const [sectionMm2, setSectionMm2] = useState('')
  const [currentA, setCurrentA] = useState('')
  const [parallel, setParallel] = useState('')
  const [cellTempC, setCellTempC] = useState('')

  const cable = useMemo(
    () =>
      cableLossFraction({
        lengthM: parseOptionalDeNumber(lengthM),
        sectionMm2: parseOptionalDeNumber(sectionMm2),
        currentA: parseOptionalDeNumber(currentA),
        parallelStrings: parallel.trim() ? parseOptionalDeNumber(parallel) : 1,
      }),
    [lengthM, sectionMm2, currentA, parallel],
  )

  const pv0 = pvFields[0]
  const angleAt = useMemo(() => new Date(), [])
  const angle = useMemo(() => {
    const azimuthDeg = pv0?.azimuthDeg ?? undefined
    const tiltDeg = pv0?.tiltDeg ?? undefined
    const latitudeDeg = plantLatitude ?? undefined
    return angleLossFraction({ azimuthDeg, tiltDeg, latitudeDeg, at: angleAt })
  }, [pv0?.azimuthDeg, pv0?.tiltDeg, plantLatitude, angleAt])

  const temp = useMemo(
    () => temperatureLossFraction({ cellTempC: parseOptionalDeNumber(cellTempC) }),
    [cellTempC],
  )

  return (
    <section className="card settings__block">
      <p className="section-label">Verluste (Schätzung)</p>
      <p className="settings__hint">
        Modellrechnung — fließt nicht in Charts oder Monatswerte.
      </p>

      <p className="settings__hint">DC-Kabel</p>
      <div className="settings__window">
        <label>
          Kabellänge m
          <input
            inputMode="decimal"
            placeholder="z. B. 10"
            value={lengthM}
            onChange={(e) => setLengthM(e.target.value)}
          />
        </label>
        <label>
          mm²
          <input
            inputMode="decimal"
            placeholder="4"
            value={sectionMm2}
            onChange={(e) => setSectionMm2(e.target.value)}
          />
        </label>
        <label>
          Strom A
          <input
            inputMode="decimal"
            placeholder="16"
            value={currentA}
            onChange={(e) => setCurrentA(e.target.value)}
          />
        </label>
        <label>
          Parallel
          <input
            inputMode="numeric"
            placeholder="1"
            value={parallel}
            onChange={(e) => setParallel(e.target.value)}
          />
        </label>
      </div>
      {cable.fault ? (
        <p className="settings__hint">{cable.fault}</p>
      ) : (
        <p className="settings__hint">
          Kabel · Schätzung: {formatLossPercent(cable.lossFraction)} ·{' '}
          {Math.round(cable.lossW)} W
        </p>
      )}

      <p className="settings__hint">
        Ausrichtung · Schätzung (erstes PV-Feld, Breitengrad, jetzt)
      </p>
      {angle.fault ? (
        <p className="settings__hint">{angle.fault}</p>
      ) : (
        <p className="settings__hint">Winkel · Schätzung: {formatLossPercent(angle.lossFraction)}</p>
      )}

      <label className="settings__full">
        Zelltemperatur °C (optional)
        <input
          inputMode="decimal"
          placeholder="z. B. 45"
          value={cellTempC}
          onChange={(e) => setCellTempC(e.target.value)}
        />
      </label>
      {cellTempC.trim() ? (
        temp.fault ? (
          <p className="settings__hint">{temp.fault}</p>
        ) : (
          <p className="settings__hint">
            Temperatur · Schätzung: {formatLossPercent(temp.lossFraction)}
          </p>
        )
      ) : null}
    </section>
  )
}

export function PlantLocationEditor({
  plantLatitude,
  plantLongitude,
  onChange,
}: {
  plantLatitude: number | null
  plantLongitude: number | null
  onChange: (patch: Pick<AppConfig, 'plantLatitude' | 'plantLongitude'>) => void
}) {
  return (
    <section className="card settings__block">
      <p className="section-label">Standort (optional, nur Prognose)</p>
      <p className="settings__hint">
        Breite/Länge für die Wetter-Prognose im Tageschart. Ohne Standort keine Prognose — kWp,
        Ausrichtung und Neigung pro PV-Feld weiter oben.
      </p>
      <label className="settings__full">
        Breitengrad
        <input
          type="text"
          inputMode="decimal"
          placeholder="z. B. 52.52"
          value={plantLatitude ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim()
            const n = raw ? Number(raw.replace(',', '.')) : null
            onChange({
              plantLatitude: n != null && Number.isFinite(n) ? n : null,
              plantLongitude,
            })
          }}
        />
      </label>
      <label className="settings__full">
        Längengrad
        <input
          type="text"
          inputMode="decimal"
          placeholder="z. B. 13.41"
          value={plantLongitude ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim()
            const n = raw ? Number(raw.replace(',', '.')) : null
            onChange({
              plantLatitude,
              plantLongitude: n != null && Number.isFinite(n) ? n : null,
            })
          }}
        />
      </label>
    </section>
  )
}

export function BatteryPartsEditor({
  fields,
  capacityKwh,
  onChange,
  onCapacityChange,
  pickerReady,
}: {
  fields: NamedBatteryPart[]
  capacityKwh: number | null
  onChange: (next: NamedBatteryPart[]) => void
  onCapacityChange: (next: number | null) => void
  pickerReady: boolean
}) {
  const [capText, setCapText] = useState(() => formatDeInput(capacityKwh))
  const [capFocused, setCapFocused] = useState(false)
  useEffect(() => {
    if (!capFocused) setCapText(formatDeInput(capacityKwh))
  }, [capacityKwh, capFocused])

  return (
    <section className="card settings__block">
      <p className="section-label">Batterie-Teile</p>
      <p className="settings__hint">
        Nutzbare Kapazität aller Packs in kWh — damit SOC in kWh umgerechnet werden kann. SOC und
        Temperatur je Modul.
      </p>
      <label className="settings__full">
        Speicherkapazität (kWh)
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder="z. B. 6"
          value={capText}
          onChange={(e) => {
            setCapText(e.target.value)
            const n = parseDeNumber(e.target.value)
            onCapacityChange(n != null && n > 0 ? n : null)
          }}
          onFocus={() => setCapFocused(true)}
          onBlur={() => {
            setCapFocused(false)
            setCapText(formatDeInput(capacityKwh))
          }}
        />
      </label>
      {fields.map((field) => (
        <div key={field.id} className="settings__named settings__named--pv">
          <label className="settings__full">
            Name
            <input
              value={field.name}
              onChange={(e) =>
                onChange(fields.map((f) => (f.id === field.id ? { ...f, name: e.target.value } : f)))
              }
            />
          </label>
          <label className="settings__full">
            SOC
            <EntityIdInput
              pickerReady={pickerReady}
              placeholder="sensor.…_battery1_soc"
              value={field.socEntityId}
              onChange={(socEntityId) =>
                onChange(
                  fields.map((f) => (f.id === field.id ? { ...f, socEntityId } : f)),
                )
              }
            />
          </label>
          <label className="settings__full">
            Temperatur
            <EntityIdInput
              pickerReady={pickerReady}
              placeholder="sensor.…_battery1_temp"
              value={field.tempEntityId}
              onChange={(tempEntityId) =>
                onChange(
                  fields.map((f) => (f.id === field.id ? { ...f, tempEntityId } : f)),
                )
              }
            />
          </label>
          <button
            type="button"
            className="settings__remove"
            aria-label={`${field.name} entfernen`}
            onClick={() => onChange(fields.filter((f) => f.id !== field.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="settings__add"
        onClick={() => onChange([...fields, newBatteryPart(`Batterie ${fields.length + 1}`)])}
      >
        Batterie-Teil hinzufügen
      </button>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { AppConfig } from '@/config/appConfig'
import {
  fetchHaEntityIds,
  HA_ENTITY_DATALIST_ID,
  isHaReachableForPicker,
} from '@/data/haEntityPicker'
import {
  BatteryPartsEditor,
  LossesEstimate,
  NamedFieldsEditor,
  PlantLocationEditor,
  syncLegacyPv,
} from '@/ui/PlantModelEditors'
import './Settings.css'

interface PlantPageProps {
  config: AppConfig
  onApply: (config: AppConfig) => void
}

export function PlantPage({ config, onApply }: PlantPageProps) {
  const [draft, setDraft] = useState<AppConfig>(config)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [entityPickerIds, setEntityPickerIds] = useState<string[] | null>(null)
  const pickerReady = Boolean(entityPickerIds?.length)

  useEffect(() => {
    setDraft(config)
  }, [config])

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
    const next = syncedDraft()
    setDraft(next)
    onApply(next)
  }

  return (
    <div className="settings plant-page" aria-label="Anlage">
      {pickerReady ? (
        <datalist id={HA_ENTITY_DATALIST_ID}>
          {entityPickerIds!.map((eid) => (
            <option key={eid} value={eid} />
          ))}
        </datalist>
      ) : null}

      <section className="card settings__block">
        <p className="section-label">Anlage · Modell</p>
        <p className="settings__hint">
          Hier beschreibst du Geometrie, Verluste und Speicher — alles als Schätzung oder Konfiguration
          für Live und Prognose, nicht als gemessene Ist-kWh in den Charts.
        </p>
      </section>

      <NamedFieldsEditor
        title="PV-Felder"
        hint="Name, Leistung, Temperatur (pv1_temp) und die maximale Wattzahl der Module. Live zeigt dann Prozent vom Maximum."
        fields={draft.pvFields ?? []}
        addLabel="PV-Feld"
        pickerReady={pickerReady}
        onChange={(pvFields) => setDraft({ ...draft, pvFields })}
      />

      <LossesEstimate pvFields={draft.pvFields ?? []} plantLatitude={draft.plantLatitude} />

      <PlantLocationEditor
        plantLatitude={draft.plantLatitude}
        plantLongitude={draft.plantLongitude}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
      />

      <BatteryPartsEditor
        fields={draft.batteryParts ?? []}
        capacityKwh={draft.batteryCapacityKwh ?? null}
        pickerReady={pickerReady}
        onChange={(batteryParts) => setDraft({ ...draft, batteryParts })}
        onCapacityChange={(batteryCapacityKwh) => setDraft({ ...draft, batteryCapacityKwh })}
      />

      <button type="button" className="settings__save" onClick={save}>
        Speichern
      </button>
    </div>
  )
}

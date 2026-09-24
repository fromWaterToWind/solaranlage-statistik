import { useState } from 'react'
import type { AppConfig, EntityMap } from '@/config/appConfig'
import { DEFAULT_TARIFF } from '@/config/appConfig'
import { canUseParentHass } from '@/data/haConn'
import type { TariffWindow } from '@/domain/types'
import './Settings.css'

interface SettingsProps {
  config: AppConfig
  onSave: (config: AppConfig) => void
  onClose: () => void
}

const ENTITY_FIELDS: { key: keyof EntityMap; label: string; hint?: string }[] = [
  { key: 'pv1Power', label: 'PV1 Leistung' },
  { key: 'pv2Power', label: 'PV2 Leistung' },
  { key: 'pv3Power', label: 'PV3 / anderer Speicher' },
  { key: 'solarPower', label: 'PV gesamt (Verlauf, W)' },
  { key: 'generationToday', label: 'Erzeugung heute' },
  { key: 'soc', label: 'Batterie SOC' },
  { key: 'batteryPower', label: 'Batterie Leistung (+ Entladen)' },
  { key: 'garagePower', label: 'Shelly Garage Leistung (W)' },
  { key: 'gridPower', label: 'Netz Leistung (EcoTracker)' },
  { key: 'homeToday', label: 'Shelly Garage täglich (kWh)' },
  { key: 'exportToday', label: 'Einspeisung heute' },
  { key: 'importToday', label: 'Netzbezug heute' },
]

export function Settings({ config, onSave, onClose }: SettingsProps) {
  const [draft, setDraft] = useState<AppConfig>(config)
  const [advanced, setAdvanced] = useState(false)
  const insideHa = canUseParentHass()

  const setWindow = (i: number, patch: Partial<TariffWindow>) => {
    const windows = [...(draft.tariff.windows ?? [])]
    windows[i] = { ...windows[i], ...patch }
    setDraft({ ...draft, tariff: { ...draft.tariff, windows } })
  }

  return (
    <div className="settings" role="dialog" aria-label="Einstellungen">
      <header className="settings__head">
        <h2 className="settings__title">Einstellungen</h2>
        <button type="button" className="settings__close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
      </header>

      <section className="card settings__block">
        <p className="section-label">Stromtarif · €/kWh</p>
        <p className="settings__hint">Von–bis, Uhrzeiten lokal. Fenster über Mitternacht sind ok (z. B. 22:00–06:00).</p>
        {(draft.tariff.windows ?? []).map((w, i) => (
          <div key={i} className="settings__window">
            <label>
              Von
              <input
                type="time"
                value={w.from}
                onChange={(e) => setWindow(i, { from: e.target.value })}
              />
            </label>
            <label>
              Bis
              <input
                type="time"
                value={w.to}
                onChange={(e) => setWindow(i, { to: e.target.value })}
              />
            </label>
            <label>
              Bezug
              <input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={w.buyEurPerKwh}
                onChange={(e) =>
                  setWindow(i, { buyEurPerKwh: Number(e.target.value) || 0 })
                }
              />
            </label>
            <button
              type="button"
              className="settings__remove"
              aria-label="Fenster entfernen"
              onClick={() => {
                const windows = (draft.tariff.windows ?? []).filter((_, j) => j !== i)
                setDraft({ ...draft, tariff: { ...draft.tariff, windows } })
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="settings__add"
          onClick={() => {
            const windows = [
              ...(draft.tariff.windows ?? []),
              { from: '00:00', to: '06:00', buyEurPerKwh: draft.tariff.buyEurPerKwh },
            ]
            setDraft({ ...draft, tariff: { ...draft.tariff, windows } })
          }}
        >
          + Zeitfenster
        </button>
        <label className="settings__full">
          Einspeisevergütung
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            value={draft.tariff.sellEurPerKwh}
            onChange={(e) =>
              setDraft({
                ...draft,
                tariff: {
                  ...draft.tariff,
                  sellEurPerKwh: Number(e.target.value) || 0,
                },
              })
            }
          />
        </label>
        <button
          type="button"
          className="settings__add"
          onClick={() =>
            setDraft({
              ...draft,
              tariff: {
                buyEurPerKwh: DEFAULT_TARIFF.buyEurPerKwh,
                sellEurPerKwh: DEFAULT_TARIFF.sellEurPerKwh,
                windows: DEFAULT_TARIFF.windows?.map((w) => ({ ...w })),
              },
            })
          }
        >
          HT/NT zurücksetzen
        </button>
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
                <input
                  type="text"
                  spellCheck={false}
                  placeholder={
                    f.key === 'garagePower'
                      ? 'sensor.shelly_i_garage_power'
                      : undefined
                  }
                  value={draft.entities[f.key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      entities: { ...draft.entities, [f.key]: e.target.value },
                    })
                  }
                />
              </label>
            ))
          : null}
      </section>

      <button
        type="button"
        className="settings__save"
        onClick={() => onSave(draft)}
      >
        Speichern
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { GrowattConfig } from '@/config/appConfig'
import {
  getGrowattSync,
  pauseGrowattSync,
  startGrowattSync,
  subscribeGrowattSync,
} from '@/data/growattSync'
import { defaultSyncFrom, defaultSyncTo } from '@/data/growattStore'
import { formatDeDate, parseDeDate } from '@/domain/tariff'

export function GrowattSync({ config }: { config: GrowattConfig }) {
  const [snap, setSnap] = useState(getGrowattSync)
  const [fromText, setFromText] = useState(() => formatDeDate(snap.from || defaultSyncFrom()))
  const [toText, setToText] = useState(() => formatDeDate(snap.to || defaultSyncTo()))

  useEffect(() => subscribeGrowattSync(() => setSnap(getGrowattSync())), [])

  const fromIso = parseDeDate(fromText) ?? snap.from
  const toIso = parseDeDate(toText) ?? snap.to
  const left = Math.max(0, snap.total - snap.done)
  const etaMin = snap.running ? Math.ceil((left * Math.max(snap.waitSec, 60)) / 60) : left
  const canStart = Boolean(config.token?.trim() && fromIso && toIso && !snap.running)

  return (
    <div className="settings__sync">
      <p className="section-label">Historie-Sync</p>
      <p className="settings__hint">
        Holt jeden Tag einmal von Growatt (max. 1×/Minute) und legt ihn lokal im Browser ab. Tab offen
        lassen. Die Open API gibt Kurven nur für die letzten 3 Monate — alles Ältere bleibt bei den
        Nachträgen. Schon gespeicherte Tage werden übersprungen.
      </p>
      <div className="settings__period-dates">
        <label className="settings__full">
          Von
          <input
            autoComplete="off"
            placeholder="TT.MM.JJJJ"
            value={fromText}
            disabled={snap.running}
            onChange={(e) => setFromText(e.target.value)}
          />
        </label>
        <label className="settings__full">
          Bis
          <input
            autoComplete="off"
            placeholder="TT.MM.JJJJ"
            value={toText}
            disabled={snap.running}
            onChange={(e) => setToText(e.target.value)}
          />
        </label>
      </div>
      <p className="settings__hint">
        {snap.stored} Tage lokal
        {snap.total
          ? ` · ${snap.done}/${snap.total} geprüft · ${snap.fetched} neu · ${snap.skipped} übersprungen · ${snap.empty} leer · ${snap.failed} Fehler`
          : null}
        {snap.running && snap.current ? ` · gerade ${snap.current}` : null}
        {snap.running && snap.waitSec > 0 ? ` · nächste Anfrage in ${snap.waitSec}s` : null}
        {snap.running && left > 0 ? ` · ca. ${etaMin} min` : null}
      </p>
      {snap.lastError ? <p className="settings__hint">{snap.lastError}</p> : null}
      {snap.running ? (
        <button type="button" className="settings__add" onClick={() => pauseGrowattSync()}>
          Pause
        </button>
      ) : (
        <button
          type="button"
          className="settings__add"
          disabled={!canStart}
          onClick={() => startGrowattSync(config, fromIso, toIso)}
        >
          {snap.done > 0 && snap.done < snap.total ? 'Fortsetzen' : 'Sync starten'}
        </button>
      )}
    </div>
  )
}

import { useState } from 'react'
import { loadConfig, saveConfig, type AppConfig } from '@/config/appConfig'
import { isHaConfigured } from '@/data/source'
import { EnergyChart } from '@/ui/EnergyChart'
import { KpiStrip } from '@/ui/KpiStrip'
import { MpptRow } from '@/ui/MpptRow'
import { PeriodBar } from '@/ui/PeriodBar'
import { PowerFlow } from '@/ui/PowerFlow'
import { Settings } from '@/ui/Settings'
import { TotalsGrid } from '@/ui/TotalsGrid'
import { useEnergy } from '@/ui/useEnergy'

export default function App() {
  const [config, setConfig] = useState<AppConfig>(loadConfig)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    live,
    period,
    kind,
    loadingPeriod,
    error,
    setKind,
    goPrev,
    goNext,
    nextDisabled,
    periodLabel,
  } = useEnergy(config)

  const ha = isHaConfigured(config)

  const persist = (next: AppConfig) => {
    saveConfig(next)
    setConfig(next)
    setSettingsOpen(false)
  }

  if (settingsOpen) {
    return (
      <Settings
        config={config}
        onSave={persist}
        onClose={() => setSettingsOpen(false)}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-header__title">Solar</h1>
        <div className="app-header__right">
          <span className={`app-header__live${ha ? '' : ' is-demo'}`}>
            {ha ? 'Jetzt' : 'Demo'}
          </span>
          <button
            type="button"
            className="app-header__gear"
            aria-label="Einstellungen"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        </div>
      </header>

      {error && !period ? (
        <p className="app-error">
          {error}{' '}
          <button type="button" className="app-error__link" onClick={() => setSettingsOpen(true)}>
            Einstellungen
          </button>
        </p>
      ) : (
        <>
          <PowerFlow live={live} />
          <MpptRow mppts={live?.mppts ?? null} />

          <PeriodBar
            kind={kind}
            label={periodLabel}
            nextDisabled={nextDisabled}
            onKind={setKind}
            onPrev={goPrev}
            onNext={goNext}
          />

          <KpiStrip totals={period?.totals ?? null} loading={loadingPeriod} />
          <EnergyChart
            kind={kind}
            series={period?.series ?? null}
            powerSeries={period?.powerSeries ?? null}
            loading={loadingPeriod}
          />
          <TotalsGrid totals={period?.totals ?? null} loading={loadingPeriod} />
        </>
      )}

      {error && period ? <p className="app-error">{error}</p> : null}
    </main>
  )
}

import { useMemo, useState } from 'react'
import { loadConfig, saveConfig, type AppConfig } from '@/config/appConfig'
import { loadManualMonths, saveManualMonths } from '@/data/manualMonths'
import { isBeforeNexa } from '@/data/growatt'
import { isHaConfigured } from '@/data/source'
import type { ManualMonth } from '@/domain/manualMonth'
import type { ChartSeriesDef } from '@/ui/EnergyChart'
import { EnergyChart } from '@/ui/EnergyChart'
import { KpiStrip } from '@/ui/KpiStrip'
import { MpptRow, mpptDayKwhMap } from '@/ui/MpptRow'
import { PeriodBar } from '@/ui/PeriodBar'
import { PowerFlow } from '@/ui/PowerFlow'
import { ProductionHero } from '@/ui/ProductionHero'
import { Settings } from '@/ui/Settings'
import { TotalsGrid } from '@/ui/TotalsGrid'
import { useEnergy } from '@/ui/useEnergy'

const HOUSE_POWER: ChartSeriesDef[] = [
  { key: 'pvW', name: 'Erzeugung', color: '#E8B84A', unit: 'W' },
  { key: 'homeW', name: 'Verbrauch', color: '#E7EEE8', unit: 'W' },
]

const GRID_POWER: ChartSeriesDef[] = [
  { key: 'importW', name: 'Netzbezug', color: '#7AA2FF', unit: 'W' },
  { key: 'exportW', name: 'Einspeisung', color: '#F0A36B', unit: 'W' },
]

const BATT_POWER: ChartSeriesDef[] = [
  { key: 'dischargeW', name: 'Entladen', color: '#3DDC97', unit: 'W' },
  { key: 'chargeW', name: 'Laden', color: '#7AA2FF', unit: 'W' },
]

const HOUSE_ENERGY: ChartSeriesDef[] = [
  { key: 'homeKwh', name: 'Verbrauch', color: '#E7EEE8', unit: 'kWh' },
  { key: 'selfKwh', name: 'Eigenverbrauch', color: '#3DDC97', unit: 'kWh' },
]

const GRID_ENERGY: ChartSeriesDef[] = [
  { key: 'importKwh', name: 'Netzbezug', color: '#7AA2FF', unit: 'kWh', stackId: 'netz' },
  { key: 'exportKwh', name: 'Einspeisung', color: '#F0A36B', unit: 'kWh', stackId: 'netz' },
]

const BATT_COLORS = ['#3DDC97', '#7AA2FF', '#E07A5F']

export default function App() {
  const [config, setConfig] = useState<AppConfig>(loadConfig)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manualMonths, setManualMonths] = useState<ManualMonth[]>(loadManualMonths)
  const {
    live,
    period,
    kind,
    date,
    loadingPeriod,
    error,
    setKind,
    goPrev,
    goNext,
    nextDisabled,
    periodLabel,
    growattBusy,
    loadGrowatt,
    production,
    loadingProduction,
  } = useEnergy(config, manualMonths)

  const ha = isHaConfigured(config)

  const applyConfig = (next: AppConfig) => {
    saveConfig(next)
    setConfig(next)
  }

  const persist = (next: AppConfig) => {
    applyConfig(next)
    setSettingsOpen(false)
  }

  const persistMonths = (next: ManualMonth[]) => {
    saveManualMonths(next)
    setManualMonths(next)
  }

  const dayKwhById = useMemo(
    () => mpptDayKwhMap(production?.mppts, period?.totals.mppts, kind, date),
    [production, period, kind, date],
  )

  const liveMppts = useMemo(() => {
    if (!live) return null
    const peaks = new Map((config.pvFields ?? []).map((f) => [f.id, f.peakW]))
    return live.mppts.map((m) => ({ ...m, peakW: m.peakW ?? peaks.get(m.id) ?? null }))
  }, [live, config.pvFields])

  const socDefs: ChartSeriesDef[] = useMemo(() => {
    const parts = config.batteryParts ?? []
    return [
      { key: 'soc', name: 'Gesamt', color: '#E7EEE8', unit: '%' },
      ...parts.map((p, i) => ({
        key: `soc:${p.id}`,
        name: p.name,
        color: BATT_COLORS[i % BATT_COLORS.length],
        unit: '%' as const,
      })),
    ]
  }, [config.batteryParts])

  const socChipTotals = useMemo(() => {
    const out: Record<string, number> = {}
    const today = new Date()
    const viewingToday =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()

    if (viewingToday && live) {
      if (!live.battery.socFault) out.soc = live.battery.socPercent
      for (const part of live.battery.parts) {
        if (!part.socFault) out[`soc:${part.id}`] = part.socPercent
      }
      return out
    }

    const series = period?.powerSeries
    if (!series?.length) return out
    for (let i = series.length - 1; i >= 0; i--) {
      const p = series[i]
      if (out.soc == null && p.socPercent != null) out.soc = p.socPercent
      if (p.socById) {
        for (const [id, value] of Object.entries(p.socById)) {
          const key = `soc:${id}`
          if (out[key] == null && value != null) out[key] = value
        }
      }
    }
    return out
  }, [live, period?.powerSeries, date])

  if (settingsOpen) {
    return (
      <Settings
        config={config}
        onSave={persist}
        onApply={applyConfig}
        onClose={() => setSettingsOpen(false)}
        manualMonths={manualMonths}
        onManualChange={persistMonths}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-header__title">Solar</h1>
        <div className="app-header__right">
          <span className={`app-header__live${ha ? '' : ' is-demo'}`}>
            {ha ? 'Live' : 'Demo'}
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
          <ProductionHero compare={production} loading={loadingProduction} />
          <PowerFlow live={live} />
          <MpptRow mppts={liveMppts} dayKwhById={dayKwhById} />

          <PeriodBar
            kind={kind}
            label={periodLabel}
            nextDisabled={nextDisabled}
            onKind={setKind}
            onPrev={goPrev}
            onNext={goNext}
          />

          {period?.source === 'manual' ? (
            <p className="app-manual-note">Monat manuell nachgetragen — kein Tracker.</p>
          ) : period?.source === 'mixed' ? (
            <p className="app-manual-note">Jahr gemischt: Tracker plus Nachträge.</p>
          ) : null}

          {kind === 'day' && config.growatt?.token?.trim() ? (
            <button
              type="button"
              className="growatt-fill"
              disabled={growattBusy || loadingPeriod}
              onClick={loadGrowatt}
            >
              {growattBusy
                ? 'Growatt lädt …'
                : isBeforeNexa(config.growatt, date)
                  ? 'Diesen Tag vom Noah holen'
                  : 'Diesen Tag von Growatt holen'}
            </button>
          ) : null}
          {period?.growattNote ? <p className="app-manual-note">{period.growattNote}</p> : null}

          <KpiStrip totals={period?.totals ?? null} loading={loadingPeriod} />
          {kind === 'day' ? (
            <>
              <EnergyChart
                kind="day"
                title="Haus · W"
                series={null}
                powerSeries={period?.powerSeries ?? null}
                loading={loadingPeriod}
                seriesDefs={HOUSE_POWER}
                visibleKeys={['pvW', 'homeW']}
                chipTotals={{
                  pvW: period?.totals.productionKwh ?? 0,
                  homeW: period?.totals.homeKwh ?? 0,
                }}
                height={200}
              />
              <EnergyChart
                kind="day"
                title="Netz · W"
                series={null}
                powerSeries={period?.powerSeries ?? null}
                loading={loadingPeriod}
                seriesDefs={GRID_POWER}
                visibleKeys={['importW', 'exportW']}
                chipTotals={{
                  importW: period?.totals.gridImportKwh ?? 0,
                  exportW: period?.totals.gridExportKwh ?? 0,
                }}
                height={180}
              />
              <EnergyChart
                kind="day"
                title="Speicher · W"
                series={null}
                powerSeries={period?.powerSeries ?? null}
                loading={loadingPeriod}
                seriesDefs={BATT_POWER}
                visibleKeys={['dischargeW', 'chargeW']}
                chipTotals={
                  period?.totals.batteryEnergyFault
                    ? undefined
                    : {
                        dischargeW: period?.totals.batteryDischargeKwh ?? 0,
                        chargeW: period?.totals.batteryChargeKwh ?? 0,
                      }
                }
                height={180}
              />
              <EnergyChart
                kind="day"
                title="Speicher · %"
                series={null}
                powerSeries={period?.powerSeries ?? null}
                loading={loadingPeriod}
                seriesDefs={socDefs}
                visibleKeys={socDefs.map((d) => d.key)}
                chipTotals={socChipTotals}
                height={180}
              />
            </>
          ) : (
            <>
              <EnergyChart
                kind={kind}
                title="Verbrauch · kWh"
                series={period?.series ?? null}
                loading={loadingPeriod}
                source={period?.source}
                seriesDefs={HOUSE_ENERGY}
                visibleKeys={['homeKwh', 'selfKwh']}
                chipTotals={{
                  homeKwh: period?.totals.homeKwh ?? 0,
                  selfKwh: period?.totals.selfConsumedKwh ?? 0,
                }}
                height={200}
              />
              <EnergyChart
                kind={kind}
                title="Netz · kWh"
                series={period?.series ?? null}
                loading={loadingPeriod}
                source={period?.source}
                seriesDefs={GRID_ENERGY}
                visibleKeys={['importKwh', 'exportKwh']}
                chipTotals={{
                  importKwh: period?.totals.gridImportKwh ?? 0,
                  exportKwh: period?.totals.gridExportKwh ?? 0,
                }}
                height={180}
              />
            </>
          )}
          <TotalsGrid
            totals={period?.totals ?? null}
            loading={loadingPeriod}
            capacityKwh={config.batteryCapacityKwh}
          />
        </>
      )}

      {error && period ? <p className="app-error">{error}</p> : null}
    </main>
  )
}

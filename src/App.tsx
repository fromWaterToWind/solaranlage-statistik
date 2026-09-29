import { useEffect, useMemo, useState } from 'react'
import { getGrowattToken, isNativePlatform } from '@/data/secureToken'
import { loadConfig, saveConfig, type AppConfig } from '@/config/appConfig'
import { loadFriends, saveFriends } from '@/data/friends'
import { loadBoughtParts, saveBoughtParts } from '@/data/investment'
import { loadManualDays, saveManualDays } from '@/data/manualDays'
import { loadManualMonths, saveManualMonths } from '@/data/manualMonths'
import { isBeforeNexa } from '@/data/growatt'
import { isHaConfigured } from '@/data/source'
import { buildShareDays, type FriendMonth, type FriendShare } from '@/domain/friends'
import { hasAnyValue, totalsFromManualMonth, type ManualMonth } from '@/domain/manualMonth'
import type { ManualDay } from '@/domain/manualDay'
import { lifetimeEconomics, type BoughtPart } from '@/domain/investment'
import { reconcileHomeAndSelf } from '@/domain/calc'
import type { ChartSeriesDef } from '@/ui/EnergyChart'
import { EnergyChart } from '@/ui/EnergyChart'
import { Friends } from '@/ui/Friends'
import { KpiStrip } from '@/ui/KpiStrip'
import { MpptRow, mpptDayKwhMap } from '@/ui/MpptRow'
import { PeriodBar } from '@/ui/PeriodBar'
import { PowerFlow } from '@/ui/PowerFlow'
import { ProductionHero } from '@/ui/ProductionHero'
import { ReturnCalc } from '@/ui/ReturnCalc'
import { PlantPage } from '@/ui/PlantPage'
import { Settings } from '@/ui/Settings'
import { TotalsGrid } from '@/ui/TotalsGrid'
import { useEnergy } from '@/ui/useEnergy'

type AppView = 'live' | 'rendite' | 'freunde' | 'anlage'

const HOUSE_POWER: ChartSeriesDef[] = [
  { key: 'pvW', name: 'Erzeugung', color: '#E8B84A', unit: 'W' },
  { key: 'homeW', name: 'Verbrauch', color: '#E7EEE8', unit: 'W' },
]

const PV_FORECAST: ChartSeriesDef = {
  key: 'pvForecastW',
  name: 'Prognose',
  color: '#9B8EC4',
  unit: 'W',
  dashed: true,
}

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
  { key: 'selfKwh', name: 'Eigenverbrauch', color: '#C4A56A', unit: 'kWh', hatch: true, overlayOn: 'homeKwh' },
]

const PV_ENERGY: ChartSeriesDef[] = [
  { key: 'pvKwh', name: 'Erzeugung', color: '#E8B84A', unit: 'kWh' },
]

const OUTPUT_ENERGY: ChartSeriesDef[] = [
  { key: 'outputKwh', name: 'WR AC-Ausgabe', color: '#7EB8B0', unit: 'kWh' },
]

const GRID_ENERGY: ChartSeriesDef[] = [
  { key: 'importKwh', name: 'Netzbezug', color: '#7AA2FF', unit: 'kWh', stackId: 'netz' },
  { key: 'exportKwh', name: 'Einspeisung', color: '#F0A36B', unit: 'kWh', stackId: 'netz' },
]

const BATT_COLORS = ['#3DDC97', '#7AA2FF', '#E07A5F']

export default function App() {
  const [config, setConfig] = useState<AppConfig>(loadConfig)

  useEffect(() => {
    if (!isNativePlatform()) return
    void getGrowattToken().then((token) => {
      setConfig((c) =>
        c.growatt.token === token ? c : { ...c, growatt: { ...c.growatt, token } },
      )
    })
  }, [])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<AppView>('live')
  const [manualMonths, setManualMonths] = useState<ManualMonth[]>(loadManualMonths)
  const [manualDays, setManualDays] = useState<ManualDay[]>(loadManualDays)
  const [parts, setParts] = useState<BoughtPart[]>(loadBoughtParts)
  const [friends, setFriends] = useState<FriendShare[]>(loadFriends)
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
  } = useEnergy(config, manualMonths, manualDays)

  const haConfigured = isHaConfigured(config)
  const growattConfigured = Boolean(config.growatt.token.trim())
  const demoQuery =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demo') === '1'
  const headerLive = demoQuery ? false : haConfigured || growattConfigured

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

  const persistDays = (next: ManualDay[]) => {
    saveManualDays(next)
    setManualDays(next)
  }

  const persistParts = (next: BoughtPart[]) => {
    saveBoughtParts(next)
    setParts(next)
  }

  const persistFriends = (next: FriendShare[]) => {
    saveFriends(next)
    setFriends(next)
  }

  const now = new Date()
  const economics = useMemo(() => {
    const monthRows = manualMonths.filter(hasAnyValue).map((r) => {
      const t = totalsFromManualMonth(r, config.tariff)
      return {
        year: r.year,
        month: r.month,
        savedEur: t.savedEur,
        productionKwh: t.productionKwh,
      }
    })
    const first = monthRows.find((r) => r.productionKwh > 1)
    const rate = first ? first.savedEur / first.productionKwh : 0.25
    const extra = production
      ? {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          productionKwh: production.month.kwh,
          savedEur:
            kind === 'month' &&
            date.getFullYear() === now.getFullYear() &&
            date.getMonth() === now.getMonth() &&
            period
              ? period.totals.savedEur
              : production.month.kwh * rate,
        }
      : null
    return lifetimeEconomics(monthRows, extra, now)
  }, [manualMonths, config.tariff, production, kind, date, period])

  const myShareMonths: FriendMonth[] = useMemo(() => {
    const map = new Map<string, FriendMonth>()
    for (const r of manualMonths) {
      if (r.productionKwh != null) {
        map.set(`${r.year}-${r.month}`, {
          year: r.year,
          month: r.month,
          productionKwh: r.productionKwh,
        })
      }
    }
    if (production) {
      map.set(`${now.getFullYear()}-${now.getMonth() + 1}`, {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        productionKwh: production.month.kwh,
      })
    }
    return [...map.values()]
  }, [manualMonths, production])

  const myShareDays = useMemo(
    () =>
      buildShareDays({
        manualDays,
        periodKind: kind,
        periodSeries: period?.series,
        todayProductionKwh: production?.today.kwh ?? period?.totals.productionKwh,
      }),
    [manualDays, kind, period?.series, period?.totals.productionKwh, production?.today.kwh],
  )

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

  const homeSplit = useMemo(
    () =>
      reconcileHomeAndSelf(period?.totals.homeKwh ?? 0, period?.totals.selfConsumedKwh ?? 0),
    [period],
  )

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

  const housePowerHasForecast = useMemo(
    () => period?.powerSeries?.some((p) => (p.pvForecastW ?? 0) > 0) ?? false,
    [period?.powerSeries],
  )

  const housePowerDefs = useMemo(
    () => (housePowerHasForecast ? [...HOUSE_POWER, PV_FORECAST] : HOUSE_POWER),
    [housePowerHasForecast],
  )

  const housePowerVisibleKeys = useMemo(
    () =>
      housePowerHasForecast ? ['pvW', 'pvForecastW', 'homeW'] : ['pvW', 'homeW'],
    [housePowerHasForecast],
  )

  if (settingsOpen) {
    return (
      <Settings
        config={config}
        onSave={persist}
        onApply={applyConfig}
        onClose={() => setSettingsOpen(false)}
        manualMonths={manualMonths}
        onManualChange={persistMonths}
        manualDays={manualDays}
        onManualDaysChange={persistDays}
      />
    )
  }

  return (
    <main className="app-shell has-nav">
      <header className="app-header">
        <h1 className="app-header__title">
          {view === 'rendite'
            ? 'Rendite'
            : view === 'freunde'
              ? 'Freunde'
              : view === 'anlage'
                ? 'Anlage'
                : 'Solar'}
        </h1>
        <div className="app-header__right">
          <span className={`app-header__live${headerLive ? '' : ' is-demo'}`}>
            {headerLive ? 'Live' : 'Demo'}
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

      {view === 'rendite' ? (
        <ReturnCalc
          parts={parts}
          onChange={persistParts}
          savedEur={economics.savedEur}
          producedKwh={economics.producedKwh}
          monthlySavedEur={economics.monthlySavedEur}
        />
      ) : view === 'freunde' ? (
        <Friends
          friends={friends}
          onChange={persistFriends}
          myMonths={myShareMonths}
          myDays={myShareDays}
          myThisMonthKwh={production?.month.kwh ?? 0}
        />
      ) : view === 'anlage' ? (
        <PlantPage config={config} onApply={applyConfig} />
      ) : error && !period ? (
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

          <KpiStrip totals={period?.totals ?? null} loading={loadingPeriod} kind={kind} />
          {kind === 'day' ? (
            <>
              <EnergyChart
                kind="day"
                title="Haus · W"
                series={null}
                powerSeries={period?.powerSeries ?? null}
                loading={loadingPeriod}
                seriesDefs={housePowerDefs}
                visibleKeys={housePowerVisibleKeys}
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
                title="Erzeugung · kWh"
                series={period?.series ?? null}
                loading={loadingPeriod}
                source={period?.source}
                seriesDefs={PV_ENERGY}
                visibleKeys={['pvKwh']}
                chipTotals={{
                  pvKwh: period?.totals.productionKwh ?? 0,
                }}
                height={200}
              />
              <EnergyChart
                kind={kind}
                title="WR AC-Ausgabe · kWh"
                series={period?.series ?? null}
                loading={loadingPeriod}
                source={period?.source}
                seriesDefs={OUTPUT_ENERGY}
                visibleKeys={['outputKwh']}
                chipTotals={{
                  outputKwh: period?.totals.outputKwh ?? 0,
                }}
                height={180}
              />
              <EnergyChart
                kind={kind}
                title="Verbrauch · kWh"
                series={period?.series ?? null}
                loading={loadingPeriod}
                source={period?.source}
                seriesDefs={HOUSE_ENERGY}
                visibleKeys={['homeKwh', 'selfKwh']}
                chipTotals={{
                  homeKwh: homeSplit.homeKwh,
                  selfKwh: homeSplit.selfKwh,
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

      {error && period && view === 'live' ? <p className="app-error">{error}</p> : null}

      <nav className="app-nav" aria-label="Bereiche">
        <button
          type="button"
          className={view === 'live' ? 'is-on' : undefined}
          onClick={() => setView('live')}
        >
          Live
        </button>
        <button
          type="button"
          className={view === 'rendite' ? 'is-on' : undefined}
          onClick={() => setView('rendite')}
        >
          Rendite
        </button>
        <button
          type="button"
          className={view === 'freunde' ? 'is-on' : undefined}
          onClick={() => setView('freunde')}
        >
          Freunde
        </button>
        <button
          type="button"
          className={view === 'anlage' ? 'is-on' : undefined}
          onClick={() => setView('anlage')}
        >
          Anlage
        </button>
      </nav>
    </main>
  )
}

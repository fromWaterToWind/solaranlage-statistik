import type { AppConfig } from '@/config/appConfig'
import { totalsFromFlows } from '@/domain/calc'
import { plantFromConfig } from '@/domain/plant'
import { stubPeriodStats } from '@/domain/productionCompare'
import type { LiveSnapshot, MpptTotal, PeriodKind, PeriodStats, SeriesPoint } from '@/domain/types'
import {
  applyGrowattDay,
  fetchGrowattDay,
  growattCooldownMs,
  integrateGrowattDayPoints,
  type GrowattDayPoint,
} from './growatt'
import { formatDay, getGrowattDay, listGrowattDays, parseDay } from './growattStore'
import { GRID_METER_MISSING, liveSnapshotFromGrowattPoint, newestGrowattPoint } from './growattLive'
import { HomeAssistantEnergySource } from './ha'
import { mergeLiveWithGrowatt, plantForNoHaMerge } from './liveMerge'
import { isHaConfigured, type EnergySource, type PeriodFetchOpts } from './source'

function emptyLiveBase(): LiveSnapshot {
  return {
    at: new Date().toISOString(),
    mppts: [],
    pvW: 0,
    pvFault: 'Keine PV-Leistung',
    homeW: 0,
    homeFault: 'Keine Hauslast',
    outputW: 0,
    battery: {
      socPercent: 0,
      socFault: 'Kein SOC',
      chargeW: 0,
      dischargeW: 0,
      fault: 'Keine Batterieleistung',
      parts: [],
    },
    grid: { importW: 0, exportW: 0, fault: GRID_METER_MISSING },
  }
}

function periodNeedsGrowattFill(stats: PeriodStats): boolean {
  return stats.totals.productionKwh === 0 && (stats.totals.outputKwh ?? 0) === 0
}

function dayInRange(day: string, start: Date, endExclusive: Date): boolean {
  const d = parseDay(day)
  if (!d) return false
  return d.getTime() >= start.getTime() && d.getTime() < endExclusive.getTime()
}

function mpptTotalsFromIntegrals(mpptKwh: Record<string, number>): MpptTotal[] {
  return Object.entries(mpptKwh)
    .filter(([, kwh]) => kwh > 0)
    .map(([id, kwh]) => ({ id, name: id.toUpperCase(), kwh, fault: null }))
}

function growattPeriodTotals(
  config: AppConfig,
  integrals: ReturnType<typeof integrateGrowattDayPoints>,
  date: Date,
) {
  return totalsFromFlows(
    {
      productionKwh: integrals.productionKwh,
      homeKwh: integrals.homeKwh,
      batteryChargeKwh: integrals.batteryChargeKwh,
      batteryDischargeKwh: integrals.batteryDischargeKwh,
      gridImportKwh: integrals.gridImportKwh,
      gridExportKwh: integrals.gridExportKwh,
      mppts: mpptTotalsFromIntegrals(integrals.mpptKwh),
      outputKwh: integrals.outputKwh,
    },
    config.tariff,
    date,
  )
}

export class CompositeEnergySource implements EnergySource {
  private readonly plant: ReturnType<typeof plantFromConfig>
  private readonly ha: HomeAssistantEnergySource | null

  constructor(private readonly config: AppConfig) {
    this.plant = plantFromConfig(config)
    this.ha = isHaConfigured(config) ? new HomeAssistantEnergySource(config) : null
  }

  private async haLive(): Promise<LiveSnapshot> {
    if (!this.ha) return emptyLiveBase()
    try {
      return await this.ha.getLive()
    } catch {
      return emptyLiveBase()
    }
  }

  private async growattPointsForToday(): Promise<GrowattDayPoint[]> {
    const token = this.config.growatt.token.trim()
    if (!token) return []
    const today = new Date()
    try {
      return await fetchGrowattDay(this.config.growatt, today)
    } catch {
      const stored = await getGrowattDay(formatDay(today))
      return stored?.points ?? []
    }
  }

  private async mergedLive(): Promise<LiveSnapshot> {
    const base = await this.haLive()
    const points = await this.growattPointsForToday()
    const newest = newestGrowattPoint(points)
    if (!newest) return base
    const growattToken = Boolean(this.config.growatt.token.trim())
    const plant = plantForNoHaMerge(this.plant, growattToken && !this.ha)
    const haGrid =
      this.ha && this.plant.grid.via === 'haEntity' ? { grid: base.grid } : undefined
    const fromGrowatt = liveSnapshotFromGrowattPoint(newest, haGrid)
    return mergeLiveWithGrowatt(base, fromGrowatt, plant)
  }

  async getLive(): Promise<LiveSnapshot> {
    return this.mergedLive()
  }

  subscribeLive(cb: (s: LiveSnapshot) => void): () => void {
    let cancelled = false
    let growattTimeout: ReturnType<typeof setTimeout> | undefined

    const push = () => {
      void this.mergedLive().then((s) => {
        if (!cancelled) cb(s)
      })
    }

    const scheduleGrowattPoll = () => {
      if (growattTimeout != null) clearTimeout(growattTimeout)
      const wait = Math.max(growattCooldownMs(), 60_000)
      growattTimeout = setTimeout(() => {
        growattTimeout = undefined
        push()
        if (!cancelled) scheduleGrowattPoll()
      }, wait)
    }

    const unsubHa = this.ha?.subscribeLive(() => push()) ?? (() => {})
    push()
    scheduleGrowattPoll()

    return () => {
      cancelled = true
      unsubHa()
      if (growattTimeout != null) clearTimeout(growattTimeout)
    }
  }

  private async growattDayPoints(date: Date, fetchIfEmpty: boolean): Promise<GrowattDayPoint[]> {
    const stored = await getGrowattDay(formatDay(date))
    if (stored?.points.length) return stored.points
    if (!fetchIfEmpty) return []
    try {
      return await fetchGrowattDay(this.config.growatt, date)
    } catch {
      return []
    }
  }

  private async enrichDayWithGrowatt(stats: PeriodStats, date: Date): Promise<PeriodStats> {
    const fetchIfEmpty = periodNeedsGrowattFill(stats)
    const points = await this.growattDayPoints(date, fetchIfEmpty)
    if (!points.length) return stats
    const powerSeries = applyGrowattDay(stats.powerSeries, points, date)
    return {
      ...stats,
      powerSeries,
      growattNote: stats.growattNote ?? `Growatt · ${points.length} Messpunkte`,
    }
  }

  private async periodFromGrowattOnly(kind: PeriodKind, date: Date): Promise<PeriodStats> {
    const stub = stubPeriodStats(kind, date)
    const token = this.config.growatt.token.trim()
    if (!token) return stub

    if (kind === 'day') {
      const points = await this.growattDayPoints(date, true)
      const powerSeries = applyGrowattDay(undefined, points, date)
      const integrals = integrateGrowattDayPoints(points, new Date())
      return {
        ...stub,
        totals: growattPeriodTotals(this.config, integrals, date),
        powerSeries,
        growattNote: points.length ? `Growatt · ${points.length} Messpunkte` : null,
      }
    }

    const start =
      kind === 'month'
        ? new Date(date.getFullYear(), date.getMonth(), 1)
        : new Date(date.getFullYear(), 0, 1)
    const endExclusive =
      kind === 'month'
        ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
        : new Date(date.getFullYear() + 1, 0, 1)

    const cachedDays = (await listGrowattDays()).filter((day) => dayInRange(day, start, endExclusive))
    const series: SeriesPoint[] = []
    const monthIntegrals = {
      productionKwh: 0,
      outputKwh: 0,
      homeKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      mpptKwh: {} as Record<string, number>,
    }

    for (const day of cachedDays) {
      const stored = await getGrowattDay(day)
      if (!stored?.points.length) continue
      const d = parseDay(day)
      const integrals = integrateGrowattDayPoints(stored.points, d ?? new Date())
      monthIntegrals.productionKwh += integrals.productionKwh
      monthIntegrals.outputKwh += integrals.outputKwh
      monthIntegrals.homeKwh += integrals.homeKwh
      monthIntegrals.gridImportKwh += integrals.gridImportKwh
      monthIntegrals.gridExportKwh += integrals.gridExportKwh
      monthIntegrals.batteryChargeKwh += integrals.batteryChargeKwh
      monthIntegrals.batteryDischargeKwh += integrals.batteryDischargeKwh
      for (const [id, kwh] of Object.entries(integrals.mpptKwh)) {
        monthIntegrals.mpptKwh[id] = (monthIntegrals.mpptKwh[id] ?? 0) + kwh
      }
      if (d) {
        series.push({
          t: new Date(d.getTime() + 12 * 60 * 60 * 1000).toISOString(),
          pvKwh: integrals.productionKwh,
          homeKwh: integrals.homeKwh,
          batteryChargeKwh: integrals.batteryChargeKwh,
          batteryDischargeKwh: integrals.batteryDischargeKwh,
          gridImportKwh: integrals.gridImportKwh,
          gridExportKwh: integrals.gridExportKwh,
          outputKwh: 0,
        })
      }
    }

    series.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())

    return {
      ...stub,
      totals: growattPeriodTotals(this.config, monthIntegrals, date),
      series,
      growattNote: cachedDays.length ? `${cachedDays.length} Tage aus Growatt-Cache` : null,
    }
  }

  async getPeriod(kind: PeriodKind, date: Date, opts?: PeriodFetchOpts): Promise<PeriodStats> {
    if (this.ha) {
      let stats: PeriodStats
      try {
        stats = await this.ha.getPeriod(kind, date, opts)
      } catch {
        stats = stubPeriodStats(kind, date)
      }

      if (kind !== 'day' || !this.config.growatt.token.trim()) return stats
      return this.enrichDayWithGrowatt(stats, date)
    }

    return this.periodFromGrowattOnly(kind, date)
  }
}

import { totalsFromFlows } from '@/domain/calc'
import { savingsFromSeries } from '@/domain/tariff'
import type { AppConfig, EntityMap } from '@/config/appConfig'
import { normalizeEntityId } from '@/config/appConfig'
import type {
  EnergyTotals,
  Kwh,
  LiveSnapshot,
  MpptLive,
  MpptTotal,
  PeriodKind,
  PeriodStats,
  PowerPoint,
  SeriesPoint,
} from '@/domain/types'
import type { EnergySource } from './source'
import {
  createHaClient,
  type HaClient,
  type HaPeriod,
  type HaStatRow,
  type HaStatistics,
} from './haConn'
import {
  homeFromBatteryAndGrid,
  isUnavailable,
  parseEnergyKwh,
  parseMeasuredPower,
  parseSocPercent,
  type HaState,
} from './haParse'
import { bucket15Min, integratePowerKwh } from './powerStats'

const MPPT: { key: keyof EntityMap; id: string; name: string }[] = [
  { key: 'pv1Power', id: 'pv1', name: 'PV1' },
  { key: 'pv2Power', id: 'pv2', name: 'PV2' },
  { key: 'pv3Power', id: 'pv3', name: 'PV3' },
]

const NO_STATS = 'keine Statistik'

function eid(id: string): string {
  return normalizeEntityId(id)
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function bucketByMonth(daily: SeriesPoint[]): SeriesPoint[] {
  const months = new Map<number, SeriesPoint>()
  for (const p of daily) {
    const d = new Date(p.t)
    const key = d.getFullYear() * 12 + d.getMonth()
    const cur = months.get(key) ?? {
      t: new Date(d.getFullYear(), d.getMonth(), 1).toISOString(),
      pvKwh: 0,
      homeKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
    }
    cur.pvKwh += p.pvKwh
    cur.homeKwh += p.homeKwh
    cur.batteryChargeKwh += p.batteryChargeKwh
    cur.batteryDischargeKwh += p.batteryDischargeKwh
    cur.gridImportKwh += p.gridImportKwh
    cur.gridExportKwh += p.gridExportKwh
    months.set(key, cur)
  }
  return [...months.values()]
    .map((p) => ({
      ...p,
      pvKwh: round3(p.pvKwh),
      homeKwh: round3(p.homeKwh),
      batteryChargeKwh: round3(p.batteryChargeKwh),
      batteryDischargeKwh: round3(p.batteryDischargeKwh),
      gridImportKwh: round3(p.gridImportKwh),
      gridExportKwh: round3(p.gridExportKwh),
    }))
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function statStart(row: HaStatRow): Date {
  if (typeof row.start === 'number') return new Date(row.start)
  return new Date(row.start)
}

/** Daily-reset energy sensors (`_heute`): ignore the midnight drop. */
function energyKwhFromRow(row: HaStatRow, bucket: HaPeriod): Kwh {
  if (bucket === 'hour') {
    const change = row.change
    if (typeof change === 'number' && Number.isFinite(change)) {
      return change < -0.02 ? 0 : Math.max(0, change)
    }
  }
  const max = row.max
  if (typeof max === 'number' && Number.isFinite(max) && max >= 0) return max
  const state = row.state
  if (typeof state === 'number' && Number.isFinite(state) && state >= 0) return state
  const change = row.change
  if (typeof change === 'number' && Number.isFinite(change) && change > 0) return change
  return 0
}

function seriesFromEnergyStats(
  keys: { pv: string; home: string; exp: string; imp: string },
  stats: HaStatistics,
  bucket: HaPeriod,
): SeriesPoint[] {
  const byStart = new Map<number, SeriesPoint>()
  const ensure = (row: HaStatRow): SeriesPoint => {
    const t = statStart(row)
    const k = t.getTime()
    let p = byStart.get(k)
    if (!p) {
      p = {
        t: t.toISOString(),
        pvKwh: 0,
        homeKwh: 0,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 0,
        gridImportKwh: 0,
        gridExportKwh: 0,
      }
      byStart.set(k, p)
    }
    return p
  }

  for (const row of stats[keys.pv] ?? []) ensure(row).pvKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of stats[keys.home] ?? []) ensure(row).homeKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of stats[keys.exp] ?? []) ensure(row).gridExportKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of stats[keys.imp] ?? []) ensure(row).gridImportKwh = round3(energyKwhFromRow(row, bucket))

  return [...byStart.values()].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  )
}

function sumSeries(series: SeriesPoint[]) {
  return series.reduce(
    (acc, p) => ({
      productionKwh: acc.productionKwh + p.pvKwh,
      homeKwh: acc.homeKwh + p.homeKwh,
      gridImportKwh: acc.gridImportKwh + p.gridImportKwh,
      gridExportKwh: acc.gridExportKwh + p.gridExportKwh,
    }),
    { productionKwh: 0, homeKwh: 0, gridImportKwh: 0, gridExportKwh: 0 },
  )
}

function lookup(states: Record<string, HaState>, id: string): HaState | undefined {
  const full = eid(id)
  if (!full) return undefined
  if (states[full]) return states[full]
  const tail = full.includes('.') ? full.slice(full.indexOf('.') + 1) : full
  if (!tail) return undefined
  for (const [key, val] of Object.entries(states)) {
    if (key.endsWith(`.${tail}`)) return val
  }
  return undefined
}

function kwhIfPresent(state: HaState | undefined): number | null {
  if (!state || isUnavailable(state.state)) return null
  return parseEnergyKwh(state)
}

export function liveFromStates(states: Record<string, HaState>, entities: EntityMap): LiveSnapshot {
  const mppts: MpptLive[] = MPPT.map((m) => {
    const parsed = parseMeasuredPower(lookup(states, entities[m.key]))
    return { id: m.id, name: m.name, powerW: parsed.watts, fault: parsed.fault }
  })

  const pv = parseMeasuredPower(lookup(states, entities.solarPower))
  const batt = parseMeasuredPower(lookup(states, entities.batteryPower))
  const grid = parseMeasuredPower(lookup(states, entities.gridPower))
  const soc = parseSocPercent(lookup(states, entities.soc))

  const chargeW = batt.fault ? 0 : batt.watts < 0 ? -batt.watts : 0
  const dischargeW = batt.fault ? 0 : batt.watts > 0 ? batt.watts : 0
  const importW = grid.fault ? 0 : grid.watts > 0 ? grid.watts : 0
  const exportW = grid.fault ? 0 : grid.watts < 0 ? -grid.watts : 0

  const homeEntity = entities.homePower.trim()
  let homeW = 0
  let homeFault: string | null = null
  if (homeEntity) {
    const home = parseMeasuredPower(lookup(states, homeEntity))
    homeW = home.watts < 0 ? 0 : home.watts
    homeFault = home.fault
  } else if (batt.fault || grid.fault) {
    homeFault = batt.fault ?? grid.fault
  } else {
    homeW = homeFromBatteryAndGrid(batt.watts, grid.watts)
  }

  return {
    at: new Date().toISOString(),
    mppts,
    pvW: pv.watts,
    pvFault: pv.fault,
    homeW,
    homeFault,
    battery: {
      socPercent: soc.percent,
      socFault: soc.fault,
      chargeW,
      dischargeW,
      fault: batt.fault,
    },
    grid: { importW, exportW, fault: grid.fault },
  }
}

function mpptTotals(stats: HaStatistics, ids: string[], period: HaPeriod): MpptTotal[] {
  return ids.map((id, i) => {
    const integ = integratePowerKwh(stats[id] ?? [], period)
    return {
      id: MPPT[i]?.id ?? id,
      name: MPPT[i]?.name ?? `PV${i + 1}`,
      kwh: integ.absKwh,
      fault: integ.samples === 0 ? NO_STATS : null,
    }
  })
}

export class HomeAssistantEnergySource implements EnergySource {
  private client: HaClient | null = null
  private clientError: Error | null = null

  constructor(private readonly config: AppConfig) {
    try {
      this.client = createHaClient(config.haUrl, config.haToken)
    } catch (e) {
      this.clientError = e instanceof Error ? e : new Error(String(e))
    }
  }

  private requireClient(): HaClient {
    if (this.clientError) throw this.clientError
    if (!this.client) throw new Error('Home Assistant ist nicht verbunden.')
    return this.client
  }

  async getLive(): Promise<LiveSnapshot> {
    const states = await this.requireClient().getStates()
    return liveFromStates(states, this.config.entities)
  }

  subscribeLive(cb: (s: LiveSnapshot) => void): () => void {
    if (!this.client) return () => {}
    let cancelled = false
    const client = this.client
    const push = () => {
      void client.getStates().then((states) => {
        if (!cancelled) cb(liveFromStates(states, this.config.entities))
      })
    }
    const unsub = client.subscribe(push)
    push()
    return () => {
      cancelled = true
      unsub()
    }
  }

  async getPeriod(kind: PeriodKind, date: Date): Promise<PeriodStats> {
    const client = this.requireClient()
    const { entities, tariff } = this.config
    const e = {
      pv: eid(entities.generationToday),
      home: eid(entities.homeToday),
      exp: eid(entities.exportToday),
      imp: eid(entities.importToday),
    }
    const mpptIds = MPPT.map((m) => eid(entities[m.key])).filter(Boolean)
    const energyIds = [e.pv, e.home, e.exp, e.imp].filter(Boolean)

    let start: Date
    let end: Date
    let energyPeriod: HaPeriod = 'day'

    if (kind === 'day') {
      start = startOfDay(date)
      end = addDays(start, 1)
      energyPeriod = 'hour'
    } else if (kind === 'month') {
      start = new Date(date.getFullYear(), date.getMonth(), 1)
      end = new Date(date.getFullYear(), date.getMonth() + 1, 1)
    } else {
      start = new Date(date.getFullYear(), 0, 1)
      end = new Date(date.getFullYear() + 1, 0, 1)
    }

    let energyStats: HaStatistics = {}
    try {
      energyStats = await client.statistics(energyIds, start, end, energyPeriod)
    } catch {
      energyStats = {}
    }

    let series = seriesFromEnergyStats(e, energyStats, energyPeriod)
    if (kind === 'year') {
      series = bucketByMonth(series)
    }
    const summed = sumSeries(series)

    const powerPeriod: HaPeriod = kind === 'year' ? 'hour' : '5minute'
    const solarId = eid(entities.solarPower)
    const battId = eid(entities.batteryPower)
    const gridId = eid(entities.gridPower)
    const powerIds = [solarId, battId, gridId, ...mpptIds].filter(Boolean)

    let powerStats: HaStatistics = {}
    try {
      powerStats = await client.statistics(powerIds, start, end, powerPeriod)
    } catch {
      powerStats = {}
    }

    let powerSeries: PowerPoint[] | undefined
    if (kind === 'day') {
      const chartEnd = isSameDay(date, new Date()) ? new Date() : end
      powerSeries = bucket15Min(
        powerStats[solarId] ?? [],
        powerStats[gridId] ?? [],
        powerStats[battId] ?? [],
        start,
        chartEnd,
      )
    }

    const battInteg = integratePowerKwh(powerStats[battId] ?? [], powerPeriod)
    const mppts = mpptTotals(powerStats, mpptIds, powerPeriod)

    const finish = (totals: EnergyTotals): PeriodStats => ({
      kind,
      start: start.toISOString(),
      end: new Date(end.getTime() - 1).toISOString(),
      totals,
      series,
      powerSeries,
    })

    const batteryChargeKwh = battInteg.chargeKwh
    const batteryDischargeKwh = battInteg.dischargeKwh
    const batteryEnergyFault = battInteg.samples === 0 ? NO_STATS : null

    if (kind === 'day' && isSameDay(date, new Date())) {
      const states = await client.getStates()
      const productionKwh =
        kwhIfPresent(lookup(states, entities.generationToday)) ?? summed.productionKwh
      const homeKwh = kwhIfPresent(lookup(states, entities.homeToday)) ?? summed.homeKwh
      const gridExportKwh =
        kwhIfPresent(lookup(states, entities.exportToday)) ?? summed.gridExportKwh
      const gridImportKwh =
        kwhIfPresent(lookup(states, entities.importToday)) ?? summed.gridImportKwh
      return finish(
        totalsFromFlows(
          {
            productionKwh,
            homeKwh,
            batteryChargeKwh,
            batteryDischargeKwh,
            batteryEnergyFault,
            gridImportKwh,
            gridExportKwh,
            mppts,
          },
          tariff,
        ),
      )
    }

    const totals = totalsFromFlows(
      {
        productionKwh: round3(summed.productionKwh),
        homeKwh: round3(summed.homeKwh),
        batteryChargeKwh,
        batteryDischargeKwh,
        batteryEnergyFault,
        gridImportKwh: round3(summed.gridImportKwh),
        gridExportKwh: round3(summed.gridExportKwh),
        mppts,
      },
      tariff,
    )
    if (kind === 'day' && series.length > 1) {
      totals.savedEur = savingsFromSeries(series, tariff)
    }

    return finish(totals)
  }
}

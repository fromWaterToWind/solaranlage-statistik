import { kwhFromSoc, totalsFromFlows } from '@/domain/calc'
import { savingsFromSeries } from '@/domain/tariff'
import type { AppConfig, EntityMap, NamedBatteryPart, NamedPowerSensor } from '@/config/appConfig'
import {
  DEFAULT_BATTERY_PARTS,
  DEFAULT_PV_FIELDS,
  entityList,
  inferredPvTempEntity,
  inferredPvTodayEnergyIds,
  normalizeEntityId,
} from '@/config/appConfig'
import type {
  BatteryPartLive,
  EnergyTotals,
  LiveSnapshot,
  MpptLive,
  MpptTotal,
  PeriodKind,
  PeriodStats,
  PowerPoint,
  SeriesPoint,
} from '@/domain/types'
import type { EnergySource, PeriodFetchOpts } from './source'
import {
  createHaClient,
  type HaClient,
  type HaPeriod,
  type HaStatRow,
  type HaStatistics,
} from './haConn'
import {
  homeFromShellyAndGrid,
  homeKwhFromShellyAndGrid,
  inverterOutputW,
  isUnavailable,
  lookupState,
  parseEnergyKwh,
  parseGridPower,
  parseMeasuredPower,
  parseSocPercent,
  parseTempC,
  type HaState,
} from './haParse'
import { bucket15Min, integratePowerKwh, mergeBatteryKwhIntoSeries, recorderPowerPlan } from './powerStats'
import { energyKwhFromRow, lastCumulativeKwh } from './energyStats'

const FALLBACK_PV: NamedPowerSensor[] = DEFAULT_PV_FIELDS
const FALLBACK_BATT: NamedBatteryPart[] = DEFAULT_BATTERY_PARTS

function namedPv(
  states: Record<string, HaState>,
  fields: NamedPowerSensor[],
): MpptLive[] {
  return fields.map((f) => {
    const parsed = parseMeasuredPower(lookupState(states, f.entityId))
    const tempId = (f.tempEntityId ?? '').trim() || inferredPvTempEntity(f.entityId)
    const tempState = tempId ? lookupState(states, tempId) : undefined
    const temp = tempState ? parseTempC(tempState) : { tempC: null, fault: null }
    return {
      id: f.id,
      name: f.name,
      powerW: parsed.watts,
      fault: parsed.fault,
      tempC: temp.fault ? null : temp.tempC,
      tempFault: tempState ? temp.fault : null,
      peakW: f.peakW ?? null,
    }
  })
}

function liveMpptTodayKwh(
  states: Record<string, HaState>,
  fields: NamedPowerSensor[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of fields) {
    for (const cand of inferredPvTodayEnergyIds(f.entityId)) {
      const kwh = kwhIfPresent(lookupState(states, cand))
      if (kwh == null) continue
      out[f.id] = kwh
      break
    }
  }
  return out
}

function mergeMpptTodayKwh(
  fields: NamedPowerSensor[],
  fromPower: MpptTotal[],
  fromLive: Record<string, number>,
  fromEnergy: Record<string, number>,
): MpptTotal[] {
  return fields.map((f) => {
    const liveKwh = fromLive[f.id]
    if (liveKwh != null && Number.isFinite(liveKwh)) {
      return { id: f.id, name: f.name, kwh: liveKwh, fault: null }
    }
    const energyKwh = fromEnergy[f.id]
    if (energyKwh != null && Number.isFinite(energyKwh)) {
      return { id: f.id, name: f.name, kwh: energyKwh, fault: null }
    }
    return (
      fromPower.find((m) => m.id === f.id) ?? {
        id: f.id,
        name: f.name,
        kwh: 0,
        fault: NO_STATS,
      }
    )
  })
}

function namedBatteryParts(
  states: Record<string, HaState>,
  fields: NamedBatteryPart[],
): BatteryPartLive[] {
  return fields.map((f) => {
    const soc = parseSocPercent(lookupState(states, f.socEntityId))
    const tempState = f.tempEntityId.trim() ? lookupState(states, f.tempEntityId) : undefined
    const temp = tempState ? parseTempC(tempState) : { tempC: null, fault: null }
    return {
      id: f.id,
      name: f.name,
      socPercent: soc.percent,
      socFault: soc.fault,
      tempC: temp.fault ? null : temp.tempC,
      tempFault: tempState ? temp.fault : null,
    }
  })
}

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

function firstLastSocFromRows(rows: HaStatRow[]): { start: number | null; end: number | null } {
  let start: number | null = null
  let end: number | null = null
  for (const row of rows) {
    const raw =
      typeof row.mean === 'number' && Number.isFinite(row.mean)
        ? row.mean
        : typeof row.state === 'number' && Number.isFinite(row.state)
          ? row.state
          : null
    if (raw == null) continue
    const pct = raw >= 0 && raw <= 1.5 ? raw * 100 : raw
    if (pct < 0 || pct > 100) continue
    if (start == null) start = pct
    end = pct
  }
  return { start, end }
}

function firstLastSocFromPower(series: PowerPoint[] | undefined): {
  start: number | null
  end: number | null
} {
  if (!series?.length) return { start: null, end: null }
  let start: number | null = null
  let end: number | null = null
  for (const p of series) {
    if (p.socPercent == null || !Number.isFinite(p.socPercent)) continue
    if (start == null) start = p.socPercent
    end = p.socPercent
  }
  return { start, end }
}

function kwhIfPresent(state: HaState | undefined): number | null {
  if (!state || isUnavailable(state.state)) return null
  return parseEnergyKwh(state)
}

export function liveFromStates(
  states: Record<string, HaState>,
  entities: EntityMap,
  pvFields: NamedPowerSensor[] = FALLBACK_PV,
  batteryParts: NamedBatteryPart[] = FALLBACK_BATT,
): LiveSnapshot {
  const mppts = namedPv(states, pvFields.length ? pvFields : FALLBACK_PV)
  const parts = namedBatteryParts(states, batteryParts.length ? batteryParts : FALLBACK_BATT)

  const pv = parseMeasuredPower(lookupState(states, entities.solarPower))
  const batt = parseMeasuredPower(lookupState(states, entities.batteryPower))
  const grid = parseGridPower(lookupState(states, entities.gridPower))
  const shelly = parseMeasuredPower(lookupState(states, entities.garagePower))
  const soc = parseSocPercent(lookupState(states, entities.soc))

  const chargeW = batt.fault ? 0 : batt.watts < 0 ? -batt.watts : 0
  const dischargeW = batt.fault ? 0 : batt.watts > 0 ? batt.watts : 0
  const importW = grid.fault ? 0 : grid.watts > 0 ? grid.watts : 0
  const exportW = grid.fault ? 0 : grid.watts < 0 ? -grid.watts : 0

  const homeFault = shelly.fault ?? grid.fault
  const homeW = homeFault
    ? 0
    : homeFromShellyAndGrid(shelly.watts, grid.watts)
  const outputW = shelly.fault ? 0 : inverterOutputW(shelly.watts)

  return {
    at: new Date().toISOString(),
    mppts,
    pvW: pv.watts,
    pvFault: pv.fault,
    homeW,
    homeFault,
    outputW,
    battery: {
      socPercent: soc.percent,
      socFault: soc.fault,
      chargeW,
      dischargeW,
      fault: batt.fault,
      parts,
    },
    grid: { importW, exportW, fault: grid.fault },
  }
}

function mpptTotals(stats: HaStatistics, fields: NamedPowerSensor[], period: HaPeriod): MpptTotal[] {
  return fields.map((f) => {
    const id = eid(f.entityId)
    const integ = integratePowerKwh(stats[id] ?? [], period)
    return {
      id: f.id,
      name: f.name,
      kwh: integ.absKwh,
      fault: integ.samples === 0 ? NO_STATS : null,
    }
  })
}

function watchedEntityIds(config: AppConfig): string[] {
  const extra = (config.pvFields ?? []).flatMap((f) => [
    inferredPvTempEntity(f.entityId),
    ...inferredPvTodayEnergyIds(f.entityId),
  ])
  return [...new Set([...entityList(config), ...extra].map(normalizeEntityId).filter(Boolean))]
}

function periodCacheKey(kind: PeriodKind, date: Date): string {
  if (kind === 'day') return `d-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  if (kind === 'month') return `m-${date.getFullYear()}-${date.getMonth()}`
  return `y-${date.getFullYear()}`
}

const EMPTY_POWER_INTEG = { chargeKwh: 0, dischargeKwh: 0, absKwh: 0, samples: 0 }

export class HomeAssistantEnergySource implements EnergySource {
  private client: HaClient | null = null
  private clientError: Error | null = null
  private inflight = new Map<string, Promise<PeriodStats>>()

  constructor(private readonly config: AppConfig) {
    try {
      this.client = createHaClient(config.haUrl, config.haToken, watchedEntityIds(config))
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
    return liveFromStates(
      states,
      this.config.entities,
      this.config.pvFields,
      this.config.batteryParts,
    )
  }

  subscribeLive(cb: (s: LiveSnapshot) => void): () => void {
    if (!this.client) return () => {}
    let cancelled = false
    let trailing: ReturnType<typeof setTimeout> | undefined
    const client = this.client
    const push = () => {
      void client.getStates().then((states) => {
        if (!cancelled) {
          cb(
            liveFromStates(
              states,
              this.config.entities,
              this.config.pvFields,
              this.config.batteryParts,
            ),
          )
        }
      })
    }
    const onChange = () => {
      if (trailing != null) return
      trailing = setTimeout(() => {
        trailing = undefined
        push()
      }, 400)
    }
    const unsub = client.subscribe(onChange)
    push()
    return () => {
      cancelled = true
      if (trailing != null) clearTimeout(trailing)
      unsub()
    }
  }

  async getPeriod(kind: PeriodKind, date: Date, opts?: PeriodFetchOpts): Promise<PeriodStats> {
    const includePower = opts?.includePower !== false
    const key = `${periodCacheKey(kind, date)}|${includePower}`
    const hit = this.inflight.get(key)
    if (hit) return hit
    const p = this.fetchPeriod(kind, date, includePower).finally(() => {
      setTimeout(() => this.inflight.delete(key), 1500)
    })
    this.inflight.set(key, p)
    return p
  }

  private async fetchPeriod(
    kind: PeriodKind,
    date: Date,
    includePower: boolean,
  ): Promise<PeriodStats> {
    const client = this.requireClient()
    const { entities, tariff, pvFields, batteryParts, batteryCapacityKwh } = this.config
    const e = {
      pv: eid(entities.generationToday),
      home: eid(entities.homeToday),
      exp: eid(entities.exportToday),
      imp: eid(entities.importToday),
    }
    const pvList = pvFields?.length ? pvFields : FALLBACK_PV
    const battList = batteryParts?.length ? batteryParts : FALLBACK_BATT
    const mpptEnergyIds =
      kind === 'day'
        ? pvList.flatMap((f) => inferredPvTodayEnergyIds(f.entityId).map(eid))
        : []
    const energyIds = [...new Set([e.pv, e.home, e.exp, e.imp, ...mpptEnergyIds].filter(Boolean))]

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
      energyStats = await client.statistics(energyIds, start, end, energyPeriod, [
        'change',
        'state',
        'max',
      ])
    } catch {
      energyStats = {}
    }

    let series = seriesFromEnergyStats(e, energyStats, energyPeriod)
    series = series.map((p) => ({
      ...p,
      homeKwh: homeKwhFromShellyAndGrid(p.homeKwh, p.gridImportKwh, p.gridExportKwh),
    }))
    if (kind === 'year') {
      series = bucketByMonth(series)
    }
    const summed = sumSeries(series)
    if (kind === 'day') {
      if (summed.productionKwh === 0) {
        summed.productionKwh = lastCumulativeKwh(energyStats[e.pv] ?? [])
      }
      if (summed.gridImportKwh === 0) {
        summed.gridImportKwh = lastCumulativeKwh(energyStats[e.imp] ?? [])
      }
      if (summed.gridExportKwh === 0) {
        summed.gridExportKwh = lastCumulativeKwh(energyStats[e.exp] ?? [])
      }
      const shellyDay = lastCumulativeKwh(energyStats[e.home] ?? [])
      if (summed.homeKwh === 0 && (shellyDay > 0 || summed.gridImportKwh > 0)) {
        summed.homeKwh = homeKwhFromShellyAndGrid(
          shellyDay,
          summed.gridImportKwh,
          summed.gridExportKwh,
        )
      }
    }

    const plan = recorderPowerPlan(kind, includePower)
    const solarId = eid(entities.solarPower)
    const battId = eid(entities.batteryPower)
    const gridId = eid(entities.gridPower)
    const garageId = eid(entities.garagePower)
    const socId = eid(entities.soc)
    const extraPvIds = plan?.extras ? pvList.map((f) => eid(f.entityId)).filter(Boolean) : []
    const battSocIds = plan?.extras ? battList.map((f) => eid(f.socEntityId)).filter(Boolean) : []
    const powerIds = (
      plan?.extras
        ? [solarId, battId, gridId, garageId, socId, ...extraPvIds, ...battSocIds]
        : [battId, socId]
    ).filter(Boolean)

    let powerStats: HaStatistics = {}
    if (plan && powerIds.length) {
      try {
        powerStats = await client.statistics(powerIds, start, end, plan.period, ['mean'])
      } catch {
        powerStats = {}
      }
    }

    let powerSeries: PowerPoint[] | undefined
    let growattNote: string | null = null
    if (kind === 'day' && plan) {
      const chartEnd = isSameDay(date, new Date()) ? new Date() : end
      powerSeries = bucket15Min(
        powerStats[solarId] ?? [],
        powerStats[gridId] ?? [],
        powerStats[battId] ?? [],
        powerStats[garageId] ?? [],
        start,
        chartEnd,
        pvList.map((f) => ({
          id: f.id,
          rows: powerStats[eid(f.entityId)] ?? [],
          into: 'mppt' as const,
        })),
        powerStats[socId] ?? [],
        battList.map((f) => ({
          id: f.id,
          rows: powerStats[eid(f.socEntityId)] ?? [],
        })),
      )
    }

    if ((kind === 'month' || kind === 'year') && plan) {
      series = mergeBatteryKwhIntoSeries(series, powerStats[battId] ?? [], plan.period, kind)
    }

    const battInteg = plan
      ? integratePowerKwh(powerStats[battId] ?? [], plan.period)
      : EMPTY_POWER_INTEG
    const mpptsFromPower =
      plan && plan.extras
        ? mpptTotals(powerStats, pvList, plan.period)
        : pvList.map((f) => ({ id: f.id, name: f.name, kwh: 0, fault: NO_STATS }))
    const mpptsFromEnergy: Record<string, number> = {}
    if (kind === 'day') {
      for (const f of pvList) {
        for (const cand of inferredPvTodayEnergyIds(f.entityId)) {
          const kwh = lastCumulativeKwh(energyStats[eid(cand)] ?? [])
          if (kwh > 0) {
            mpptsFromEnergy[f.id] = kwh
            break
          }
        }
      }
    }
    let mppts = mpptsFromPower
    if (kind === 'day' && Object.keys(mpptsFromEnergy).length) {
      mppts = mergeMpptTodayKwh(pvList, mpptsFromPower, {}, mpptsFromEnergy)
    }

    const finish = (totals: EnergyTotals): PeriodStats => ({
      kind,
      start: start.toISOString(),
      end: new Date(end.getTime() - 1).toISOString(),
      totals,
      series,
      powerSeries,
      growattNote,
    })

    const batteryChargeKwh = battInteg.chargeKwh
    const batteryDischargeKwh = battInteg.dischargeKwh
    const batteryEnergyFault = battInteg.samples === 0 ? NO_STATS : null
    const socFromPower = firstLastSocFromPower(powerSeries)
    const socFromRows = firstLastSocFromRows(powerStats[socId] ?? [])
    const storageStartKwh = kwhFromSoc(socFromPower.start ?? socFromRows.start, batteryCapacityKwh)
    const storageEndKwh = kwhFromSoc(socFromPower.end ?? socFromRows.end, batteryCapacityKwh)

    if (kind === 'day' && isSameDay(date, new Date())) {
      const states = await client.getStates()
      const productionKwh =
        kwhIfPresent(lookupState(states, entities.generationToday)) ?? summed.productionKwh
      const shellyKwh =
        kwhIfPresent(lookupState(states, entities.homeToday)) ??
        lastCumulativeKwh(energyStats[e.home] ?? [])
      const gridExportKwh =
        kwhIfPresent(lookupState(states, entities.exportToday)) ?? summed.gridExportKwh
      const gridImportKwh =
        kwhIfPresent(lookupState(states, entities.importToday)) ?? summed.gridImportKwh
      const homeKwh = homeKwhFromShellyAndGrid(shellyKwh, gridImportKwh, gridExportKwh)
      mppts = mergeMpptTodayKwh(
        pvList,
        mpptsFromPower,
        liveMpptTodayKwh(states, pvList),
        mpptsFromEnergy,
      )
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
            outputKwh: shellyKwh,
            storageStartKwh,
            storageEndKwh,
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
        storageStartKwh,
        storageEndKwh,
      },
      tariff,
    )
    if (kind === 'day' && series.length > 1) {
      totals.savedEur = savingsFromSeries(series, tariff)
    }

    return finish(totals)
  }
}

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
  Watts,
} from '@/domain/types'
import type { EnergySource } from './source'
import {
  createHaClient,
  type HaClient,
  type HaPeriod,
  type HaStatRow,
  type HaStatistics,
} from './haConn'
import { parseEnergyKwh, parsePowerW, parseSocPercent, isUnavailable, type HaState } from './haParse'

const MPPT: { key: keyof EntityMap; id: string; name: string }[] = [
  { key: 'pv1Power', id: 'pv1', name: 'PV1' },
  { key: 'pv2Power', id: 'pv2', name: 'PV2' },
  { key: 'pv3Power', id: 'pv3', name: 'PV3' },
]

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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function statStart(row: HaStatRow): Date {
  if (typeof row.start === 'number') return new Date(row.start)
  return new Date(row.start)
}

function rowHours(row: HaStatRow): number {
  const start = statStart(row)
  const end = row.end
    ? typeof row.end === 'number'
      ? new Date(row.end)
      : new Date(row.end)
    : new Date(start.getTime() + 3600_000)
  const h = (end.getTime() - start.getTime()) / 3_600_000
  return h > 0 ? h : 1
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

function powerMeanToKwh(row: HaStatRow): Kwh {
  const mean = row.mean
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return 0
  // HA power stats are in W after units, or native unit. Treat large values as W.
  const watts = Math.abs(mean) <= 50 ? mean * 1000 : mean
  return (watts * rowHours(row)) / 1000
}

function seriesFromStats(
  keys: { pv: string; home: string; exp: string; imp: string; batt: string },
  stats: HaStatistics,
  mpptIds: string[],
  bucket: HaPeriod,
): { series: SeriesPoint[]; mppts: MpptTotal[] } {
  const pvRows = stats[keys.pv] ?? []
  const homeRows = stats[keys.home] ?? []
  const expRows = stats[keys.exp] ?? []
  const impRows = stats[keys.imp] ?? []
  const battRows = stats[keys.batt] ?? []

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

  for (const row of pvRows) ensure(row).pvKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of homeRows) ensure(row).homeKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of expRows) ensure(row).gridExportKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of impRows) ensure(row).gridImportKwh = round3(energyKwhFromRow(row, bucket))
  for (const row of battRows) {
    const p = ensure(row)
    const kwh = powerMeanToKwh(row)
    const mean = row.mean ?? 0
    if (mean >= 0) p.batteryDischargeKwh = round3(Math.abs(kwh))
    else p.batteryChargeKwh = round3(Math.abs(kwh))
  }

  const series = [...byStart.values()].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  )

  const mppts: MpptTotal[] = mpptIds.map((id, i) => {
    const rows = stats[id] ?? []
    const kwh = round3(rows.reduce((s, r) => s + Math.abs(powerMeanToKwh(r)), 0))
    return { id: MPPT[i]?.id ?? id, name: MPPT[i]?.name ?? `PV${i + 1}`, kwh }
  })

  return { series, mppts }
}

function sumSeries(series: SeriesPoint[]) {
  return series.reduce(
    (acc, p) => ({
      productionKwh: acc.productionKwh + p.pvKwh,
      homeKwh: acc.homeKwh + p.homeKwh,
      batteryChargeKwh: acc.batteryChargeKwh + p.batteryChargeKwh,
      batteryDischargeKwh: acc.batteryDischargeKwh + p.batteryDischargeKwh,
      gridImportKwh: acc.gridImportKwh + p.gridImportKwh,
      gridExportKwh: acc.gridExportKwh + p.gridExportKwh,
    }),
    {
      productionKwh: 0,
      homeKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
    },
  )
}

function lookup(states: Record<string, HaState>, id: string): HaState | undefined {
  const full = eid(id)
  if (states[full]) return states[full]
  const tail = full.includes('.') ? full.slice(full.indexOf('.') + 1) : full
  for (const [key, val] of Object.entries(states)) {
    if (key.endsWith(`.${tail}`) || key.endsWith(tail)) return val
  }
  return undefined
}

function present(state: HaState | undefined): boolean {
  return Boolean(state && !isUnavailable(state.state))
}

function meanToW(row: HaStatRow): Watts {
  if (typeof row.mean !== 'number' || !Number.isFinite(row.mean)) return 0
  return Math.abs(row.mean) < 1 ? 0 : row.mean
}

function bucket15Min(
  pv: HaStatRow[],
  home: HaStatRow[],
  batt: HaStatRow[],
): PowerPoint[] {
  const acc = new Map<
    number,
    { nPv: number; pv: number; nHome: number; home: number; nBatt: number; batt: number }
  >()

  const add = (row: HaStatRow, field: 'pv' | 'home' | 'batt', watts: Watts) => {
    const d = statStart(row)
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
    d.setSeconds(0, 0)
    const k = d.getTime()
    const cur = acc.get(k) ?? { nPv: 0, pv: 0, nHome: 0, home: 0, nBatt: 0, batt: 0 }
    if (field === 'pv') {
      cur.pv += watts
      cur.nPv += 1
    } else if (field === 'home') {
      cur.home += watts
      cur.nHome += 1
    } else {
      cur.batt += watts
      cur.nBatt += 1
    }
    acc.set(k, cur)
  }

  for (const row of pv) add(row, 'pv', meanToW(row))
  for (const row of home) add(row, 'home', meanToW(row))
  for (const row of batt) add(row, 'batt', meanToW(row))

  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => ({
      t: new Date(k).toISOString(),
      pvW: v.nPv ? v.pv / v.nPv : 0,
      homeW: v.nHome ? v.home / v.nHome : 0,
      batteryW: v.nBatt ? v.batt / v.nBatt : 0,
    }))
}

function kwhIfPresent(state: HaState | undefined): number | null {
  if (!state || isUnavailable(state.state)) return null
  return parseEnergyKwh(state)
}

function liveFromStates(states: Record<string, HaState>, entities: EntityMap): LiveSnapshot {
  const mppts: MpptLive[] = MPPT.map((m) => ({
    id: m.id,
    name: m.name,
    powerW: parsePowerW(lookup(states, entities[m.key])),
  }))
  const solarState = lookup(states, entities.solarPower)
  const solarW = parsePowerW(solarState)
  const pvW: Watts = solarW > 0 ? solarW : mppts.reduce((s, m) => s + m.powerW, 0)

  const homeState = lookup(states, entities.homePower)
  const battState = lookup(states, entities.batteryPower)
  const homeW = parsePowerW(homeState)
  const battSigned = parsePowerW(battState)
  const chargeW = battSigned < 0 ? -battSigned : 0
  const dischargeW = battSigned > 0 ? battSigned : 0

  let importW = 0
  let exportW = 0
  // Only derive grid when house + battery are actually present — otherwise house load
  // was wrongly shown as grid import.
  if (present(homeState) && present(battState)) {
    const gridNet = homeW - pvW - battSigned
    if (gridNet > 1) importW = gridNet
    else if (gridNet < -1) exportW = -gridNet
  }

  return {
    at: new Date().toISOString(),
    mppts,
    pvW,
    homeW,
    battery: {
      socPercent: parseSocPercent(lookup(states, entities.soc)),
      chargeW,
      dischargeW,
    },
    grid: { importW, exportW },
  }
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
      batt: eid(entities.batteryPower),
    }
    const mpptIds = MPPT.map((m) => eid(entities[m.key]))
    const ids = [e.pv, e.home, e.exp, e.imp, e.batt, ...mpptIds]

    let start: Date
    let end: Date
    let haPeriod: HaPeriod = 'day'

    if (kind === 'day') {
      start = startOfDay(date)
      end = addDays(start, 1)
      haPeriod = 'hour'
    } else if (kind === 'month') {
      start = new Date(date.getFullYear(), date.getMonth(), 1)
      end = new Date(date.getFullYear(), date.getMonth() + 1, 1)
    } else {
      start = new Date(date.getFullYear(), 0, 1)
      end = new Date(date.getFullYear() + 1, 0, 1)
    }

    let stats: HaStatistics = {}
    try {
      stats = await client.statistics(ids, start, end, haPeriod)
    } catch {
      stats = {}
    }

    let { series, mppts } = seriesFromStats(e, stats, mpptIds, haPeriod)
    if (kind === 'year') {
      series = bucketByMonth(series)
    }
    const summed = sumSeries(series)

    let powerSeries: PowerPoint[] | undefined
    if (kind === 'day') {
      const powerIds = [
        eid(entities.solarPower),
        eid(entities.homePower),
        eid(entities.batteryPower),
      ]
      try {
        const powerStats = await client.statistics(powerIds, start, end, '5minute')
        powerSeries = bucket15Min(
          powerStats[powerIds[0]] ?? [],
          powerStats[powerIds[1]] ?? [],
          powerStats[powerIds[2]] ?? [],
        )
      } catch {
        powerSeries = []
      }
    }

    const finish = (totals: EnergyTotals): PeriodStats => ({
      kind,
      start: start.toISOString(),
      end: new Date(end.getTime() - 1).toISOString(),
      totals,
      series,
      powerSeries,
    })

    // Today: prefer live *_heute counters (more accurate than incomplete hours).
    if (kind === 'day' && isSameDay(date, new Date())) {
      const states = await client.getStates()
      const productionKwh =
        kwhIfPresent(lookup(states, entities.generationToday)) ?? summed.productionKwh
      const homeKwh = kwhIfPresent(lookup(states, entities.homeToday)) ?? summed.homeKwh
      const gridExportKwh =
        kwhIfPresent(lookup(states, entities.exportToday)) ?? summed.gridExportKwh
      const gridImportKwh =
        kwhIfPresent(lookup(states, entities.importToday)) ?? summed.gridImportKwh
      const totals = totalsFromFlows(
        {
          productionKwh,
          homeKwh,
          batteryChargeKwh: summed.batteryChargeKwh,
          batteryDischargeKwh: summed.batteryDischargeKwh,
          gridImportKwh,
          gridExportKwh,
          mppts,
        },
        tariff,
      )
      return finish(totals)
    }

    const totals: EnergyTotals = totalsFromFlows(
      {
        productionKwh: round3(summed.productionKwh),
        homeKwh: round3(summed.homeKwh),
        batteryChargeKwh: round3(summed.batteryChargeKwh),
        batteryDischargeKwh: round3(summed.batteryDischargeKwh),
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
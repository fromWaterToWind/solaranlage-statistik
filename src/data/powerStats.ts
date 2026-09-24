import type { PeriodKind, PowerPoint, SeriesPoint, Watts } from '@/domain/types'
import { homeFromShellyAndGrid, floorSubWatt } from './haParse'
import type { HaPeriod, HaStatRow } from './haConn'

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function fallbackHours(period: HaPeriod): number {
  if (period === '5minute') return 5 / 60
  if (period === 'hour') return 1
  if (period === 'day') return 24
  if (period === 'month') return 24 * 30
  return 1
}

export function rowDurationHours(row: HaStatRow, period: HaPeriod): number {
  const start = typeof row.start === 'number' ? new Date(row.start) : new Date(row.start)
  if (row.end == null) return fallbackHours(period)
  const end = typeof row.end === 'number' ? new Date(row.end) : new Date(row.end)
  const h = (end.getTime() - start.getTime()) / 3_600_000
  return h > 0 ? h : fallbackHours(period)
}

/** Statistics were requested as power:W — mean is Watts. |W|<1 → 0. */
export function meanWatts(row: HaStatRow): Watts | null {
  if (typeof row.mean !== 'number' || !Number.isFinite(row.mean)) return null
  return floorSubWatt(row.mean)
}

export interface PowerKwhSplit {
  chargeKwh: number
  dischargeKwh: number
  absKwh: number
  samples: number
}

export function integratePowerKwh(rows: HaStatRow[], period: HaPeriod): PowerKwhSplit {
  let charge = 0
  let discharge = 0
  let abs = 0
  let samples = 0
  for (const row of rows) {
    const w = meanWatts(row)
    if (w === null) continue
    samples += 1
    const kwh = (Math.abs(w) * rowDurationHours(row, period)) / 1000
    abs += kwh
    if (w > 0) discharge += kwh
    else if (w < 0) charge += kwh
  }
  return {
    chargeKwh: round3(charge),
    dischargeKwh: round3(discharge),
    absKwh: round3(abs),
    samples,
  }
}

function seriesBucketKey(d: Date, kind: PeriodKind): string {
  if (kind === 'year') return `${d.getFullYear()}-${d.getMonth()}`
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** 5-minute stats only for a single day. Month/year use hour, or skip power entirely. */
export function recorderPowerPlan(
  kind: PeriodKind,
  includePower = true,
): { period: HaPeriod; extras: boolean } | null {
  if (!includePower) return null
  if (kind === 'day') return { period: '5minute', extras: true }
  return { period: 'hour', extras: false }
}

/** Fold battery power statistics into daily or monthly energy bars. */
export function mergeBatteryKwhIntoSeries(
  series: SeriesPoint[],
  rows: HaStatRow[],
  period: HaPeriod,
  kind: PeriodKind,
): SeriesPoint[] {
  if (!series.length || !rows.length) return series
  const extra = new Map<string, { charge: number; discharge: number }>()
  for (const row of rows) {
    const w = meanWatts(row)
    if (w === null) continue
    const t = typeof row.start === 'number' ? new Date(row.start) : new Date(row.start)
    const key = seriesBucketKey(t, kind)
    const slot = extra.get(key) ?? { charge: 0, discharge: 0 }
    const kwh = (Math.abs(w) * rowDurationHours(row, period)) / 1000
    if (w > 0) slot.discharge += kwh
    else if (w < 0) slot.charge += kwh
    extra.set(key, slot)
  }
  return series.map((p) => {
    const add = extra.get(seriesBucketKey(new Date(p.t), kind))
    if (!add) return p
    return {
      ...p,
      batteryChargeKwh: round3(p.batteryChargeKwh + add.charge),
      batteryDischargeKwh: round3(p.batteryDischargeKwh + add.discharge),
    }
  })
}

function bucketStart(row: HaStatRow): number {
  const d = typeof row.start === 'number' ? new Date(row.start) : new Date(row.start)
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
  d.setSeconds(0, 0)
  return d.getTime()
}

export type ExtraPowerSeries = {
  id: string
  rows: HaStatRow[]
  into: 'mppt' | 'batt'
}

export type ExtraSocSeries = {
  id: string
  rows: HaStatRow[]
}

export function bucket15Min(
  pv: HaStatRow[],
  grid: HaStatRow[],
  batt: HaStatRow[],
  shelly: HaStatRow[],
  rangeStart: Date,
  rangeEnd: Date,
  extras: ExtraPowerSeries[] = [],
  socRows: HaStatRow[] = [],
  socExtras: ExtraSocSeries[] = [],
): PowerPoint[] {
  type ExtraAcc = { sum: number; n: number }
  const acc = new Map<
    number,
    {
      nPv: number
      pv: number
      nGrid: number
      grid: number
      nBatt: number
      batt: number
      nShelly: number
      shelly: number
      extra: Record<string, ExtraAcc>
      nSoc: number
      soc: number
      socExtra: Record<string, ExtraAcc>
    }
  >()

  const empty = () => ({
    nPv: 0,
    pv: 0,
    nGrid: 0,
    grid: 0,
    nBatt: 0,
    batt: 0,
    nShelly: 0,
    shelly: 0,
    extra: {} as Record<string, ExtraAcc>,
    nSoc: 0,
    soc: 0,
    socExtra: {} as Record<string, ExtraAcc>,
  })

  const bucket = (row: HaStatRow) => {
    const k = bucketStart(row)
    const cur = acc.get(k) ?? empty()
    acc.set(k, cur)
    return cur
  }

  const add = (row: HaStatRow, field: 'pv' | 'grid' | 'batt' | 'shelly', watts: Watts) => {
    const cur = bucket(row)
    if (field === 'pv') {
      cur.pv += watts
      cur.nPv += 1
    } else if (field === 'grid') {
      cur.grid += watts
      cur.nGrid += 1
    } else if (field === 'shelly') {
      cur.shelly += watts
      cur.nShelly += 1
    } else {
      cur.batt += watts
      cur.nBatt += 1
    }
  }

  for (const row of pv) {
    const w = meanWatts(row)
    if (w !== null) add(row, 'pv', w)
  }
  for (const row of grid) {
    const w = meanWatts(row)
    if (w !== null) add(row, 'grid', w)
  }
  for (const row of batt) {
    const w = meanWatts(row)
    if (w !== null) add(row, 'batt', w)
  }
  for (const row of shelly) {
    const w = meanWatts(row)
    if (w !== null) add(row, 'shelly', w)
  }
  for (const extra of extras) {
    for (const row of extra.rows) {
      const w = meanWatts(row)
      if (w === null) continue
      const cur = bucket(row)
      const slot = cur.extra[extra.id] ?? { sum: 0, n: 0 }
      slot.sum += w
      slot.n += 1
      cur.extra[extra.id] = slot
    }
  }
  for (const row of socRows) {
    if (typeof row.mean !== 'number' || !Number.isFinite(row.mean)) continue
    const cur = bucket(row)
    cur.soc += row.mean
    cur.nSoc += 1
  }

  for (const extra of socExtras) {
    for (const row of extra.rows) {
      if (typeof row.mean !== 'number' || !Number.isFinite(row.mean)) continue
      const cur = bucket(row)
      const slot = cur.socExtra[extra.id] ?? { sum: 0, n: 0 }
      slot.sum += row.mean
      slot.n += 1
      cur.socExtra[extra.id] = slot
    }
  }

  const extraMeta = extras.map((e) => ({ id: e.id, into: e.into }))
  const out: PowerPoint[] = []
  const endMs = rangeEnd.getTime()
  for (let t = rangeStart.getTime(); t < endMs; t += 15 * 60_000) {
    const v = acc.get(t)
    const pvW = v?.nPv ? v.pv / v.nPv : 0
    const gridW = v?.nGrid ? v.grid / v.nGrid : 0
    const batteryW = v?.nBatt ? v.batt / v.nBatt : 0
    const shellyW = v?.nShelly ? v.shelly / v.nShelly : 0
    const mpptW: Record<string, Watts> = {}
    const battPartW: Record<string, Watts> = {}
    for (const extra of extraMeta) {
      const slot = v?.extra[extra.id]
      const mean = slot?.n ? slot.sum / slot.n : 0
      if (extra.into === 'mppt') mpptW[extra.id] = mean
      else battPartW[extra.id] = mean
    }
    const socById: Record<string, number | null> = {}
    for (const extra of socExtras) {
      const slot = v?.socExtra[extra.id]
      socById[extra.id] = slot?.n ? slot.sum / slot.n : null
    }
    out.push({
      t: new Date(t).toISOString(),
      pvW,
      homeW: homeFromShellyAndGrid(shellyW, gridW),
      batteryW,
      gridW,
      mpptW,
      battPartW,
      socPercent: v?.nSoc ? v.soc / v.nSoc : null,
      socById,
    })
  }
  return out
}

import type { PowerPoint, Watts } from '@/domain/types'
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

function bucketStart(row: HaStatRow): number {
  const d = typeof row.start === 'number' ? new Date(row.start) : new Date(row.start)
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
  d.setSeconds(0, 0)
  return d.getTime()
}

export function bucket15Min(
  pv: HaStatRow[],
  grid: HaStatRow[],
  batt: HaStatRow[],
  shelly: HaStatRow[],
  rangeStart: Date,
  rangeEnd: Date,
): PowerPoint[] {
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
    }
  >()

  const add = (row: HaStatRow, field: 'pv' | 'grid' | 'batt' | 'shelly', watts: Watts) => {
    const k = bucketStart(row)
    const cur = acc.get(k) ?? {
      nPv: 0,
      pv: 0,
      nGrid: 0,
      grid: 0,
      nBatt: 0,
      batt: 0,
      nShelly: 0,
      shelly: 0,
    }
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
    acc.set(k, cur)
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

  const out: PowerPoint[] = []
  const endMs = rangeEnd.getTime()
  for (let t = rangeStart.getTime(); t < endMs; t += 15 * 60_000) {
    const v = acc.get(t)
    const pvW = v?.nPv ? v.pv / v.nPv : 0
    const gridW = v?.nGrid ? v.grid / v.nGrid : 0
    const batteryW = v?.nBatt ? v.batt / v.nBatt : 0
    const shellyW = v?.nShelly ? v.shelly / v.nShelly : 0
    out.push({
      t: new Date(t).toISOString(),
      pvW,
      homeW: homeFromShellyAndGrid(shellyW, gridW),
      batteryW,
      gridW,
    })
  }
  return out
}

import type { Kwh } from '@/domain/types'
import type { HaPeriod, HaStatRow } from './haConn'

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Daily-reset counters (`*_heute`): hourly buckets must use `change`.
 * Using `max` sums the running total and explodes kWh.
 */
export function energyKwhFromRow(row: HaStatRow, bucket: HaPeriod): Kwh {
  if (bucket === 'hour') {
    const change = row.change
    if (typeof change === 'number' && Number.isFinite(change)) {
      return change < -0.02 ? 0 : Math.max(0, change)
    }
    return 0
  }
  const max = row.max
  if (typeof max === 'number' && Number.isFinite(max) && max >= 0) return max
  const state = row.state
  if (typeof state === 'number' && Number.isFinite(state) && state >= 0) return state
  const change = row.change
  if (typeof change === 'number' && Number.isFinite(change) && change > 0) return change
  return 0
}

/** Last reading of a cumulative / daily-reset energy sensor. */
export function lastCumulativeKwh(rows: HaStatRow[]): Kwh {
  let last = 0
  for (const row of rows) {
    const v = typeof row.state === 'number' ? row.state : row.max
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) last = v
  }
  return round3(last)
}

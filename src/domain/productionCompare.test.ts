import { describe, expect, it } from 'vitest'
import { buildProductionCompare, deltaPercent } from './productionCompare'
import type { EnergyTotals, PeriodStats, SeriesPoint } from './types'

function emptyTotals(productionKwh: number): EnergyTotals {
  return {
    productionKwh,
    mppts: [{ id: 'pv1', name: 'PV NEU', kwh: 4.2, fault: null }],
    homeKwh: 0,
    batteryChargeKwh: 0,
    batteryDischargeKwh: 0,
    batteryEnergyFault: null,
    gridImportKwh: 0,
    gridExportKwh: 0,
    selfConsumedKwh: 0,
    autarkyPercent: 0,
    selfConsumptionPercent: 0,
    savedEur: 0,
    outputKwh: 0,
    storageStartKwh: null,
    storageEndKwh: null,
    lossKwh: 0,
    lossFault: null,
  }
}

function point(year: number, monthIndex: number, day: number, pvKwh: number): SeriesPoint {
  return {
    t: new Date(year, monthIndex, day).toISOString(),
    pvKwh,
    homeKwh: 0,
    batteryChargeKwh: 0,
    batteryDischargeKwh: 0,
    gridImportKwh: 0,
    gridExportKwh: 0,
  }
}

function stats(kind: PeriodStats['kind'], productionKwh: number, series: SeriesPoint[]): PeriodStats {
  return {
    kind,
    start: series[0]?.t ?? '2026-09-01T00:00:00.000Z',
    end: '2026-09-24T23:59:59.000Z',
    totals: emptyTotals(productionKwh),
    series,
  }
}

describe('deltaPercent', () => {
  it('returns null when the previous window has no production', () => {
    expect(deltaPercent(10, 0)).toBeNull()
    expect(deltaPercent(10, 0.01)).toBeNull()
  })

  it('computes the change against the previous window', () => {
    expect(deltaPercent(12, 10)).toBeCloseTo(20, 5)
    expect(deltaPercent(8, 10)).toBeCloseTo(-20, 5)
  })
})

describe('buildProductionCompare', () => {
  it('uses live today and rolling week / month-to-date against the previous window', () => {
    const now = new Date(2026, 8, 24)
    const september: SeriesPoint[] = []
    for (let d = 1; d <= 24; d++) {
      september.push(point(2026, 8, d, 10))
    }
    const august: SeriesPoint[] = []
    for (let d = 1; d <= 31; d++) {
      august.push(point(2026, 7, d, 8))
    }

    const compare = buildProductionCompare(
      stats('day', 12, [point(2026, 8, 24, 10)]),
      stats('month', 240, september),
      stats('month', 248, august),
      now,
    )

    expect(compare.today.kwh).toBe(12)
    expect(compare.today.prevKwh).toBe(10)
    expect(compare.today.deltaPercent).toBeCloseTo(20, 5)

    expect(compare.week.kwh).toBe(72)
    expect(compare.week.prevKwh).toBe(70)

    expect(compare.month.kwh).toBe(242)
    expect(compare.month.prevKwh).toBe(192)
    expect(compare.mppts[0]?.name).toBe('PV NEU')
    expect(compare.mppts[0]?.kwh).toBe(4.2)
  })
})

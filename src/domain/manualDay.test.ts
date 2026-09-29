import { describe, expect, it } from 'vitest'
import { applyManualDays, emptyManualDay } from './manualDay'
import type { EnergyTotals, PeriodStats } from './types'

function totals(partial: Partial<EnergyTotals>): EnergyTotals {
  return {
    productionKwh: 0,
    mppts: [],
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
    ...partial,
  }
}

const tariff = { buyCtPerKwh: 32, sellCtPerKwh: 8, windows: [] }

describe('applyManualDays', () => {
  it('overwrites a single day total', () => {
    const stats: PeriodStats = {
      kind: 'day',
      start: '2026-06-10T12:00:00',
      end: '2026-06-11T12:00:00',
      totals: totals({ productionKwh: 8, homeKwh: 1, gridImportKwh: 1 }),
      series: [],
    }
    const row = {
      ...emptyManualDay('2026-06-10'),
      homeKwh: 12,
      selfUseKwh: 9,
      importKwh: 3,
    }
    const next = applyManualDays(stats, [row], tariff)
    expect(next.totals.homeKwh).toBe(12)
    expect(next.totals.selfConsumedKwh).toBe(9)
    expect(next.totals.autarkyPercent).toBeCloseTo(75, 5)
    expect(next.totals.selfConsumedKwh).toBeLessThanOrEqual(next.totals.homeKwh)
  })

  it('raises Verbrauch when typed Eigenverbrauch is larger', () => {
    const stats: PeriodStats = {
      kind: 'day',
      start: '2026-06-10T12:00:00',
      end: '2026-06-11T12:00:00',
      totals: totals({ productionKwh: 8, homeKwh: 1.2, gridImportKwh: 0 }),
      series: [],
    }
    const row = {
      ...emptyManualDay('2026-06-10'),
      selfUseKwh: 2.1,
    }
    const next = applyManualDays(stats, [row], tariff)
    expect(next.totals.homeKwh).toBe(2.1)
    expect(next.totals.selfConsumedKwh).toBe(2.1)
  })

  it('uses WR AC-Ausgabe as daily output', () => {
    const stats: PeriodStats = {
      kind: 'day',
      start: '2026-09-02T12:00:00',
      end: '2026-09-03T12:00:00',
      totals: totals({ productionKwh: 8, homeKwh: 6, outputKwh: 1 }),
      series: [],
    }
    const row = { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 }
    const next = applyManualDays(stats, [row], tariff)
    expect(next.totals.outputKwh).toBe(4.32)
    expect(next.totals.homeKwh).toBe(4.32)
    expect(next.totals.selfConsumedKwh).toBe(4.32)
  })

  it('derives Verbrauch from WR AC like Shelly: AC + Bezug − Einspeisung', () => {
    const stats: PeriodStats = {
      kind: 'day',
      start: '2026-09-04T12:00:00',
      end: '2026-09-05T12:00:00',
      totals: totals({ productionKwh: 8, homeKwh: 2, gridImportKwh: 2, gridExportKwh: 0.4, outputKwh: 0 }),
      series: [],
    }
    const row = { ...emptyManualDay('2026-09-04'), houseInflowKwh: 1.34 }
    const next = applyManualDays(stats, [row], tariff)
    expect(next.totals.outputKwh).toBe(1.34)
    expect(next.totals.homeKwh).toBe(2.94)
    expect(next.totals.selfConsumedKwh).toBeCloseTo(0.94, 5)
  })

  it('folds daily WR AC-Ausgabe into month output', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: '2026-09-01T00:00:00',
      end: '2026-09-30T23:59:59',
      totals: totals({ productionKwh: 20, homeKwh: 10, outputKwh: 9 }),
      series: [
        {
          t: '2026-09-02T00:00:00',
          pvKwh: 5,
          homeKwh: 4,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 1,
          gridExportKwh: 0,
          outputKwh: 0,
        },
        {
          t: '2026-09-03T00:00:00',
          pvKwh: 5,
          homeKwh: 4,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 1,
          gridExportKwh: 0,
          outputKwh: 3.1,
        },
      ],
    }
    const row = { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 }
    const next = applyManualDays(stats, [row], tariff)
    const day2 = next.series.find((p) => p.t.startsWith('2026-09-02'))
    const day3 = next.series.find((p) => p.t.startsWith('2026-09-03'))
    expect(next.series).toHaveLength(30)
    expect(next.totals.outputKwh).toBeCloseTo(7.42, 5)
    expect(day2?.outputKwh).toBe(4.32)
    expect(day2?.selfKwh).toBe(4.32)
    expect(day2?.homeKwh).toBe(5.32)
    expect(day3?.outputKwh).toBe(3.1)
  })

  it('inserts early-month WR AC days when the tracker has no row', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: '2026-09-01T00:00:00',
      end: '2026-09-30T23:59:59',
      totals: totals({ productionKwh: 0, homeKwh: 0, outputKwh: 0 }),
      series: [],
    }
    const row = { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 }
    const next = applyManualDays(stats, [row], tariff)
    const day2 = next.series.find((p) => new Date(p.t).getDate() === 2)
    expect(day2?.outputKwh).toBe(4.32)
    expect(day2?.selfKwh).toBe(4.32)
    expect(day2?.homeKwh).toBe(4.32)
    expect(next.totals.selfConsumedKwh).toBe(4.32)
  })

  it('keeps Eigenverbrauch from WR AC even if tracker Einspeisung is larger', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: '2026-09-01T00:00:00',
      end: '2026-09-30T23:59:59',
      totals: totals({}),
      series: [
        {
          t: '2026-09-07T00:00:00',
          pvKwh: 6,
          homeKwh: 0,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 0,
          gridExportKwh: 12,
          outputKwh: 0,
        },
      ],
    }
    const row = { ...emptyManualDay('2026-09-07'), houseInflowKwh: 5.58 }
    const next = applyManualDays(stats, [row], tariff)
    const day7 = next.series.find((p) => new Date(p.t).getDate() === 7)
    expect(day7?.selfKwh).toBe(5.58)
    expect(day7?.homeKwh).toBe(5.58)
  })

  it('does not wipe a full manual month that has no daily Nachträge', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: '2026-08-01T00:00:00',
      end: '2026-08-31T23:59:59',
      totals: totals({
        productionKwh: 202.5,
        homeKwh: 215.9,
        gridImportKwh: 104,
        gridExportKwh: 42.3,
        selfConsumedKwh: 111.9,
        savedEur: 48.2,
      }),
      series: [],
      source: 'manual',
    }
    const row = { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 }
    const next = applyManualDays(stats, [row], tariff)
    expect(next.totals.savedEur).toBe(48.2)
    expect(next.totals.homeKwh).toBe(215.9)
    expect(next.series).toEqual([])
  })

  it('folds daily WR AC-Ausgabe into the year month bar', () => {
    const stats: PeriodStats = {
      kind: 'year',
      start: '2026-01-01T00:00:00',
      end: '2026-12-31T23:59:59',
      totals: totals({ productionKwh: 100, homeKwh: 80, outputKwh: 9 }),
      series: [
        {
          t: '2026-08-01T00:00:00',
          pvKwh: 202.5,
          homeKwh: 215.9,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 104,
          gridExportKwh: 42.3,
          outputKwh: 154.2,
        },
        {
          t: '2026-09-01T00:00:00',
          pvKwh: 20,
          homeKwh: 18,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 10,
          gridExportKwh: 2,
          outputKwh: 9,
        },
      ],
    }
    const row = { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 }
    const next = applyManualDays(stats, [row], tariff)
    const aug = next.series.find((p) => new Date(p.t).getMonth() === 7)
    const sep = next.series.find((p) => new Date(p.t).getMonth() === 8)
    expect(aug?.outputKwh).toBe(154.2)
    expect(sep?.outputKwh).toBeCloseTo(13.32, 5)
    expect(next.totals.outputKwh).toBeCloseTo(167.52, 5)
  })

  it('patches daily year points then keeps the Nachtrag in September', () => {
    const stats: PeriodStats = {
      kind: 'year',
      start: '2026-01-01T00:00:00',
      end: '2026-12-31T23:59:59',
      totals: totals({}),
      series: [
        {
          t: '2026-09-11T00:00:00',
          pvKwh: 6,
          homeKwh: 5,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 2,
          gridExportKwh: 0.5,
          outputKwh: 3.1,
        },
      ],
    }
    const row = { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 }
    const next = applyManualDays(stats, [row], tariff)
    const day2 = next.series.find((p) => new Date(p.t).getDate() === 2)
    const day11 = next.series.find((p) => new Date(p.t).getDate() === 11)
    expect(day2?.outputKwh).toBe(4.32)
    expect(day11?.outputKwh).toBe(3.1)
    expect(next.totals.outputKwh).toBeCloseTo(7.42, 5)
  })
})

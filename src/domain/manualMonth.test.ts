import { describe, expect, it } from 'vitest'
import {
  deriveBlankFields,
  emptyManualMonth,
  formatDeInput,
  haTotalsEmpty,
  mergeManualPeriod,
  parseDeNumber,
  totalsFromManualMonth,
} from './manualMonth'
import type { EnergyTotals, PeriodStats, Tariff } from './types'

const tariff: Tariff = { buyEurPerKwh: 0.32, sellEurPerKwh: 0.08 }

function emptyTotals(): EnergyTotals {
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
  }
}

describe('parseDeNumber', () => {
  it('reads comma decimals and blanks', () => {
    expect(parseDeNumber('81,5')).toBe(81.5)
    expect(parseDeNumber('248')).toBe(248)
    expect(parseDeNumber('')).toBeNull()
    expect(parseDeNumber('  ')).toBeNull()
  })
})

describe('formatDeInput', () => {
  it('uses German grouping', () => {
    expect(formatDeInput(81.5)).toBe('81,5')
    expect(formatDeInput(null)).toBe('')
  })
})

describe('deriveBlankFields', () => {
  it('fills only empty derived cells from the spreadsheet identities', () => {
    const row = {
      ...emptyManualMonth(2026, 3),
      productionKwh: 160.3,
      houseInflowKwh: 111.5,
      exportKwh: 34.7,
      importKwh: 96.9,
    }
    const derived = deriveBlankFields(row)
    expect(derived.conversionLossKwh).toBe(48.8)
    expect(derived.selfUseKwh).toBe(76.8)
    expect(derived.totalUseKwh).toBe(173.7)
  })

  it('subtracts storage delta when deriving loss', () => {
    const row = {
      ...emptyManualMonth(2026, 3),
      productionKwh: 160.3,
      houseInflowKwh: 111.5,
      storageStartKwh: 2,
      storageEndKwh: 4,
    }
    expect(deriveBlankFields(row).conversionLossKwh).toBe(46.8)
  })

  it('does not overwrite numbers already set', () => {
    const row = {
      ...emptyManualMonth(2026, 3),
      productionKwh: 160.3,
      houseInflowKwh: 111.5,
      conversionLossKwh: 40,
    }
    expect(deriveBlankFields(row).conversionLossKwh).toBe(40)
  })
})

describe('totalsFromManualMonth', () => {
  it('keeps spreadsheet Eigenverbrauch instead of PV minus Einspeisung', () => {
    const row = {
      ...emptyManualMonth(2026, 3),
      productionKwh: 160.3,
      houseInflowKwh: 111.5,
      conversionLossKwh: 48.8,
      exportKwh: 34.7,
      importKwh: 96.9,
      selfUseKwh: 76.8,
      totalUseKwh: 173.7,
    }
    const totals = totalsFromManualMonth(row, tariff)
    expect(totals.selfConsumedKwh).toBe(76.8)
    expect(totals.homeKwh).toBe(173.7)
    expect(totals.productionKwh).toBe(160.3)
    expect(totals.lossKwh).toBe(48.8)
    expect(totals.selfConsumptionPercent).toBeCloseTo((76.8 / 160.3) * 100, 5)
    expect(totals.autarkyPercent).toBeCloseTo((76.8 / 173.7) * 100, 5)
  })
})

describe('mergeManualPeriod', () => {
  const manual = [
    {
      ...emptyManualMonth(2025, 10),
      productionKwh: 56.7,
      houseInflowKwh: 40,
    },
  ]

  it('fills an empty month from Nachtrag', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: new Date(2025, 9, 1).toISOString(),
      end: new Date(2025, 9, 31, 23, 59).toISOString(),
      totals: emptyTotals(),
      series: [],
    }
    const merged = mergeManualPeriod(stats, manual, tariff)
    expect(merged.source).toBe('manual')
    expect(merged.totals.productionKwh).toBe(56.7)
  })

  it('lets a manual month replace tracker data completely', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: new Date(2026, 7, 1).toISOString(),
      end: new Date(2026, 7, 31, 23, 59).toISOString(),
      totals: { ...emptyTotals(), productionKwh: 402, homeKwh: 111 },
      series: [
        {
          t: new Date(2026, 7, 1).toISOString(),
          pvKwh: 402,
          homeKwh: 111,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 50,
          gridExportKwh: 20,
        },
      ],
    }
    const august = [
      {
        ...emptyManualMonth(2026, 8),
        productionKwh: 202.5,
        totalUseKwh: 215.9,
      },
    ]
    const merged = mergeManualPeriod(stats, august, tariff, new Date(2026, 7, 1))
    expect(merged.source).toBe('manual')
    expect(merged.totals.productionKwh).toBe(202.5)
    expect(merged.totals.homeKwh).toBe(215.9)
    expect(merged.series).toEqual([])
  })

  it('matches the viewed month even if ISO start is the previous UTC day', () => {
    const stats: PeriodStats = {
      kind: 'month',
      start: '2026-07-31T22:00:00.000Z',
      end: '2026-08-31T21:59:59.000Z',
      totals: { ...emptyTotals(), productionKwh: 1039, homeKwh: 578 },
      series: [],
    }
    const august = [
      {
        ...emptyManualMonth(2026, 8),
        productionKwh: 202.5,
        totalUseKwh: 215.9,
      },
    ]
    const merged = mergeManualPeriod(stats, august, tariff, new Date(2026, 7, 24))
    expect(merged.source).toBe('manual')
    expect(merged.totals.productionKwh).toBe(202.5)
    expect(merged.totals.homeKwh).toBe(215.9)
  })

  it('leaves day view alone', () => {
    const stats: PeriodStats = {
      kind: 'day',
      start: new Date(2025, 9, 3).toISOString(),
      end: new Date(2025, 9, 3, 23, 59).toISOString(),
      totals: emptyTotals(),
      series: [],
    }
    expect(mergeManualPeriod(stats, manual, tariff).source).toBe('ha')
  })

  it('fills empty months in a year and keeps tracker months', () => {
    const stats: PeriodStats = {
      kind: 'year',
      start: new Date(2025, 0, 1).toISOString(),
      end: new Date(2025, 11, 31, 23, 59).toISOString(),
      totals: { ...emptyTotals(), productionKwh: 10 },
      series: [
        {
          t: new Date(2025, 10, 1).toISOString(),
          pvKwh: 10,
          homeKwh: 8,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 3,
          gridExportKwh: 1,
        },
      ],
    }
    const merged = mergeManualPeriod(stats, manual, tariff)
    expect(merged.source).toBe('mixed')
    const oct = merged.series.find((p) => new Date(p.t).getMonth() === 9)
    const nov = merged.series.find((p) => new Date(p.t).getMonth() === 10)
    expect(oct?.pvKwh).toBe(56.7)
    expect(nov?.pvKwh).toBe(10)
  })

  it('year prefers a manual August over tracker kWh', () => {
    const stats: PeriodStats = {
      kind: 'year',
      start: new Date(2026, 0, 1).toISOString(),
      end: new Date(2026, 11, 31, 23, 59).toISOString(),
      totals: { ...emptyTotals(), productionKwh: 402, homeKwh: 111 },
      series: [
        {
          t: new Date(2026, 7, 1).toISOString(),
          pvKwh: 402,
          homeKwh: 111,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 40,
          gridExportKwh: 10,
        },
      ],
    }
    const august = [
      {
        ...emptyManualMonth(2026, 8),
        productionKwh: 202.5,
        totalUseKwh: 215.9,
      },
    ]
    const merged = mergeManualPeriod(stats, august, tariff)
    const aug = merged.series.find((p) => new Date(p.t).getMonth() === 7)
    expect(aug?.pvKwh).toBe(202.5)
    expect(aug?.homeKwh).toBe(215.9)
    expect(merged.source).toBe('manual')
  })
})

describe('haTotalsEmpty', () => {
  it('treats near-zero as empty', () => {
    expect(haTotalsEmpty(emptyTotals())).toBe(true)
    expect(haTotalsEmpty({ ...emptyTotals(), productionKwh: 2 })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { buyPriceAt, formatDeDate, parseDeDate, savingsFromSeries, sellPriceAt, weightedBuyPrice } from './tariff'
import type { Tariff } from './types'

const tariff: Tariff = {
  buyEurPerKwh: 0.4,
  sellEurPerKwh: 0.08,
  windows: [
    { from: '06:00', to: '22:00', buyEurPerKwh: 0.32 },
    { from: '22:00', to: '06:00', buyEurPerKwh: 0.2 },
  ],
}

describe('buyPriceAt', () => {
  it('uses HT during the day and NT wrapping midnight', () => {
    expect(buyPriceAt(new Date(2026, 8, 23, 12, 0), tariff)).toBe(0.32)
    expect(buyPriceAt(new Date(2026, 8, 23, 22, 0), tariff)).toBe(0.2)
    expect(buyPriceAt(new Date(2026, 8, 23, 3, 0), tariff)).toBe(0.2)
    expect(buyPriceAt(new Date(2026, 8, 23, 5, 59), tariff)).toBe(0.2)
    expect(buyPriceAt(new Date(2026, 8, 23, 6, 0), tariff)).toBe(0.32)
  })

  it('falls back to flat price without windows', () => {
    expect(
      buyPriceAt(new Date(2026, 8, 23, 12, 0), {
        buyEurPerKwh: 0.31,
        sellEurPerKwh: 0.08,
      }),
    ).toBe(0.31)
  })

  it('switches contract on the validFrom date', () => {
    const dated: Tariff = {
      periods: [
        {
          id: 'a',
          validFrom: '2025-01-01',
          validTo: '2026-10-31',
          buyCtPerKwh: 32,
          sellCtPerKwh: 8,
        },
        {
          id: 'b',
          validFrom: '2026-11-01',
          validTo: null,
          buyCtPerKwh: 28.15,
          sellCtPerKwh: 7.5,
        },
      ],
    }
    expect(buyPriceAt(new Date(2026, 9, 31, 12, 0), dated)).toBeCloseTo(0.32, 5)
    expect(buyPriceAt(new Date(2026, 10, 1, 0, 0), dated)).toBeCloseTo(0.2815, 5)
    expect(sellPriceAt(new Date(2026, 10, 1), dated)).toBeCloseTo(0.075, 5)
  })
})

describe('weightedBuyPrice', () => {
  it('weights HT 16h and NT 8h', () => {
    // 16/24 * 0.32 + 8/24 * 0.2 = 0.2133... + 0.0666... = 0.28
    expect(weightedBuyPrice(tariff)).toBeCloseTo(0.28, 5)
  })
})

describe('savingsFromSeries', () => {
  it('applies the window that contains each hour', () => {
    const saved = savingsFromSeries(
      [
        {
          t: new Date(2026, 8, 23, 12, 0).toISOString(),
          pvKwh: 2,
          homeKwh: 1,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 0,
          gridExportKwh: 1,
        },
        {
          t: new Date(2026, 8, 23, 23, 0).toISOString(),
          pvKwh: 0,
          homeKwh: 1,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
          gridImportKwh: 0.2,
          gridExportKwh: 0,
        },
      ],
      tariff,
    )
    // noon: avoided 1 * 0.32 + export 1 * 0.08 = 0.40
    // night: avoided 0.8 * 0.20 + 0 = 0.16
    expect(saved).toBeCloseTo(0.56, 5)
  })
})

describe('German dates', () => {
  it('formats and parses TT.MM.JJJJ', () => {
    expect(formatDeDate('2026-11-01')).toBe('01.11.2026')
    expect(parseDeDate('1.11.2026')).toBe('2026-11-01')
    expect(parseDeDate('01.11.2026')).toBe('2026-11-01')
    expect(parseDeDate('24.9.25')).toBe('2025-09-24')
    expect(parseDeDate('')).toBeNull()
    expect(parseDeDate('31.02.2026')).toBeNull()
    expect(parseDeDate('2026-11-01')).toBe('2026-11-01')
  })
})

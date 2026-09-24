import { describe, expect, it } from 'vitest'
import {
  formatEur,
  formatFlowW,
  formatKw,
  formatKwh,
  formatPercent,
  sumMpptW,
  totalsFromFlows,
} from './calc'
import type { Tariff } from './types'

const tariff: Tariff = { buyEurPerKwh: 0.32, sellEurPerKwh: 0.08 }

describe('sumMpptW', () => {
  it('sums MPPT power', () => {
    expect(
      sumMpptW([
        { id: 'ost', name: 'Ost Dach', powerW: 1200, fault: null },
        { id: 'west', name: 'West Dach', powerW: 800, fault: null },
      ]),
    ).toBe(2000)
  })
})

describe('totalsFromFlows', () => {
  it('computes autarky, self-consumption and savings', () => {
    const totals = totalsFromFlows(
      {
        productionKwh: 25,
        homeKwh: 12,
        batteryChargeKwh: 6,
        batteryDischargeKwh: 4,
        gridImportKwh: 2,
        gridExportKwh: 8,
        mppts: [
          { id: 'ost', name: 'Ost Dach', kwh: 13, fault: null },
          { id: 'west', name: 'West Dach', kwh: 12, fault: null },
        ],
      },
      tariff,
    )

    // selfConsumed = max(0, 25 - 8) = 17
    expect(totals.selfConsumedKwh).toBe(17)
    // autarky = ((12 - 2) / 12) * 100 ≈ 83.33
    expect(totals.autarkyPercent).toBeCloseTo((10 / 12) * 100, 5)
    // selfConsumption = (17 / 25) * 100 = 68
    expect(totals.selfConsumptionPercent).toBeCloseTo(68, 5)
    // saved = (12 - 2) * 0.32 + 8 * 0.08 = 3.2 + 0.64 = 3.84
    expect(totals.savedEur).toBeCloseTo(3.84, 5)
  })

  it('clamps autarky and self-consumption to 0–100', () => {
    const high = totalsFromFlows(
      {
        productionKwh: 10,
        homeKwh: 5,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 0,
        gridImportKwh: -1, // rounding artifact → would exceed 100
        gridExportKwh: 0,
        mppts: [],
      },
      tariff,
    )
    expect(high.autarkyPercent).toBe(100)

    const low = totalsFromFlows(
      {
        productionKwh: 5,
        homeKwh: 10,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 0,
        gridImportKwh: 15, // import > home → negative autarky before clamp
        gridExportKwh: 0,
        mppts: [],
      },
      tariff,
    )
    expect(low.autarkyPercent).toBe(0)
  })

  it('clamps avoided-import savings term at 0', () => {
    const totals = totalsFromFlows(
      {
        productionKwh: 1,
        homeKwh: 5,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 0,
        gridImportKwh: 5.1, // slight overshoot from rounding
        gridExportKwh: 2,
        mppts: [],
      },
      tariff,
    )
    // avoided import clamped to 0; only export savings remain
    expect(totals.savedEur).toBeCloseTo(2 * 0.08, 5)
  })

  it('returns 0 self-consumption when production is zero', () => {
    const totals = totalsFromFlows(
      {
        productionKwh: 0,
        homeKwh: 10,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 3,
        gridImportKwh: 7,
        gridExportKwh: 0,
        mppts: [],
      },
      tariff,
    )
    expect(totals.selfConsumedKwh).toBe(0)
    expect(totals.selfConsumptionPercent).toBe(0)
    expect(totals.autarkyPercent).toBeCloseTo(30, 5)
  })

  it('returns 0 autarky when home is zero', () => {
    const totals = totalsFromFlows(
      {
        productionKwh: 5,
        homeKwh: 0,
        batteryChargeKwh: 3,
        batteryDischargeKwh: 0,
        gridImportKwh: 0,
        gridExportKwh: 2,
        mppts: [],
      },
      tariff,
    )
    expect(totals.autarkyPercent).toBe(0)
  })
})

describe('formatters', () => {
  it('formats watts and kilowatts', () => {
    expect(formatKw(350)).toBe('350 W')
    expect(formatKw(1200)).toBe('1,2 kW')
  })

  it('formats live flow watts in one register', () => {
    expect(formatFlowW(154.9)).toBe('155 W')
    expect(formatFlowW(815.9)).toBe('816 W')
    expect(formatFlowW(1300)).toBe('1,3 kW')
  })

  it('formats kWh, EUR and percent', () => {
    expect(formatKwh(12.4)).toBe('12,4 kWh')
    expect(formatEur(12.45)).toBe('12,45\u00A0€')
    expect(formatPercent(87)).toBe('87 %')
  })
})

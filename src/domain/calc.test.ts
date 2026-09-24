import { describe, expect, it } from 'vitest'
import {
  acOutputKwh,
  formatEur,
  formatFlowW,
  formatKw,
  formatKwh,
  formatPercent,
  formatWattAxis,
  kwhFromSoc,
  storageLossFromBalance,
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

    expect(totals.selfConsumedKwh).toBe(10)
    // Autarkiegrad = Eigenverbrauch / Verbrauch = 10/12
    expect(totals.autarkyPercent).toBeCloseTo((10 / 12) * 100, 5)
    // Eigenverbrauchsquote = Eigenverbrauch / Erzeugung = 10/25
    expect(totals.selfConsumptionPercent).toBeCloseTo(40, 5)
    // saved = (12 - 2) * 0.32 + 8 * 0.08 = 3.2 + 0.64 = 3.84
    expect(totals.savedEur).toBeCloseTo(3.84, 5)
    // Zufluss = 12 − 2 + 8 = 18; ohne Speicherstand: 25 − 18 = 7
    expect(totals.outputKwh).toBe(18)
    expect(totals.lossKwh).toBeCloseTo(7, 5)
    expect(totals.lossFault).toBeNull()
    expect(totals.storageStartKwh).toBeNull()
    expect(totals.storageEndKwh).toBeNull()
  })

  it('subtracts the storage delta from conversion loss', () => {
    const totals = totalsFromFlows(
      {
        productionKwh: 160.3,
        homeKwh: 173.7,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 0,
        gridImportKwh: 96.9,
        gridExportKwh: 34.7,
        mppts: [],
        outputKwh: 111.5,
        storageStartKwh: 2,
        storageEndKwh: 4,
      },
      tariff,
    )
    // 160.3 − 111.5 − (4 − 2) = 46.8
    expect(totals.lossKwh).toBeCloseTo(46.8, 5)
    expect(totals.storageStartKwh).toBe(2)
    expect(totals.storageEndKwh).toBe(4)
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
    expect(totals.selfConsumedKwh).toBe(3)
    expect(totals.selfConsumptionPercent).toBe(0)
    expect(totals.autarkyPercent).toBeCloseTo(30, 5)
  })

  it('never reports house self-use above house consumption', () => {
    const totals = totalsFromFlows(
      {
        productionKwh: 5,
        homeKwh: 1.2,
        batteryChargeKwh: 0.9,
        batteryDischargeKwh: 0,
        gridImportKwh: 0,
        gridExportKwh: 2.9,
        mppts: [],
      },
      tariff,
    )
    expect(totals.selfConsumedKwh).toBe(1.2)
    expect(totals.selfConsumedKwh).toBeLessThanOrEqual(totals.homeKwh)
    expect(totals.selfConsumptionPercent).toBeCloseTo((1.2 / 5) * 100, 5)
    expect(totals.autarkyPercent).toBe(100)
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
  it('formats watts and never switches to kW', () => {
    expect(formatKw(350)).toBe('350 W')
    expect(formatKw(1200)).toBe('1.200 W')
    expect(formatKw(1400)).toBe('1.400 W')
  })

  it('formats live flow watts in one register', () => {
    expect(formatFlowW(154.9)).toBe('155 W')
    expect(formatFlowW(815.9)).toBe('816 W')
    expect(formatFlowW(1300)).toBe('1.300 W')
    expect(formatWattAxis(1400)).toBe('1.400')
    expect(formatWattAxis(350)).toBe('350')
  })

  it('formats kWh, EUR and percent', () => {
    expect(formatKwh(12.4)).toBe('12,4 kWh')
    expect(formatEur(12.45)).toBe('12,45\u00A0€')
    expect(formatPercent(87)).toBe('87 %')
  })
})

describe('storageLossFromBalance', () => {
  it('is production minus output minus storage delta', () => {
    expect(
      storageLossFromBalance({
        productionKwh: 100,
        outputKwh: 90,
        storageStartKwh: 1,
        storageEndKwh: 3,
      }).lossKwh,
    ).toBeCloseTo(8, 5)
    expect(
      storageLossFromBalance({
        productionKwh: 100,
        outputKwh: 95,
        storageStartKwh: 4,
        storageEndKwh: 2,
      }).lossKwh,
    ).toBeCloseTo(7, 5)
  })

  it('treats missing start and end as zero delta', () => {
    expect(
      storageLossFromBalance({
        productionKwh: 56.7,
        outputKwh: 40,
        storageStartKwh: null,
        storageEndKwh: null,
      }).lossKwh,
    ).toBeCloseTo(16.7, 5)
  })
})

describe('kwhFromSoc', () => {
  it('converts percent against usable capacity', () => {
    expect(kwhFromSoc(50, 6)).toBe(3)
    expect(kwhFromSoc(null, 6)).toBeNull()
    expect(kwhFromSoc(40, 0)).toBeNull()
  })
})

describe('acOutputKwh', () => {
  it('matches Zufluss = Verbrauch − Bezug + Einspeisung', () => {
    expect(acOutputKwh(173.7, 96.9, 34.7)).toBeCloseTo(111.5, 5)
  })
})

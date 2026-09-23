import { weightedBuyPrice } from './tariff'
import type {
  EnergyTotals,
  Euros,
  Kwh,
  MpptLive,
  MpptTotal,
  Percent,
  Tariff,
  Watts,
} from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sumMpptW(mppts: MpptLive[]): Watts {
  return mppts.reduce((sum, m) => sum + m.powerW, 0)
}

export function totalsFromFlows(
  flows: {
    productionKwh: Kwh
    homeKwh: Kwh
    batteryChargeKwh: Kwh
    batteryDischargeKwh: Kwh
    gridImportKwh: Kwh
    gridExportKwh: Kwh
    mppts: MpptTotal[]
  },
  tariff: Tariff,
): EnergyTotals {
  const selfConsumedKwh = Math.max(0, flows.productionKwh - flows.gridExportKwh)

  const autarkyPercent: Percent =
    flows.homeKwh <= 0
      ? 0
      : clamp(((flows.homeKwh - flows.gridImportKwh) / flows.homeKwh) * 100, 0, 100)

  const selfConsumptionPercent: Percent =
    flows.productionKwh <= 0
      ? 0
      : clamp((selfConsumedKwh / flows.productionKwh) * 100, 0, 100)

  const avoidedImportKwh = Math.max(0, flows.homeKwh - flows.gridImportKwh)
  const buy = weightedBuyPrice(tariff)
  const savedEur: Euros =
    avoidedImportKwh * buy + flows.gridExportKwh * tariff.sellEurPerKwh

  return {
    productionKwh: flows.productionKwh,
    mppts: flows.mppts,
    homeKwh: flows.homeKwh,
    batteryChargeKwh: flows.batteryChargeKwh,
    batteryDischargeKwh: flows.batteryDischargeKwh,
    gridImportKwh: flows.gridImportKwh,
    gridExportKwh: flows.gridExportKwh,
    selfConsumedKwh,
    autarkyPercent,
    selfConsumptionPercent,
    savedEur,
  }
}

const de = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const deKwh = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

const deEur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

const dePercent = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 0,
})

export function formatKw(watts: Watts): string {
  if (watts < 1000) {
    return `${de.format(watts)} W`
  }
  return `${de.format(watts / 1000)} kW`
}

export function formatKwh(kwh: Kwh): string {
  return `${deKwh.format(kwh)} kWh`
}

export function formatEur(euros: Euros): string {
  return deEur.format(euros)
}

export function formatPercent(p: Percent): string {
  return `${dePercent.format(p)} %`
}

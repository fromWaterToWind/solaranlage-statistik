import { sellPriceAt, weightedBuyPrice } from './tariff'
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
    batteryEnergyFault?: string | null
    outputKwh?: Kwh | null
    storageStartKwh?: Kwh | null
    storageEndKwh?: Kwh | null
  },
  tariff: Tariff,
  at: Date = new Date(),
): EnergyTotals {
  /** Eigenverbrauch = Gesamtstromverbrauch − Netzbezug, nie größer als Verbrauch. */
  const selfConsumedKwh = clamp(flows.homeKwh - flows.gridImportKwh, 0, Math.max(0, flows.homeKwh))

  const autarkyPercent: Percent =
    flows.homeKwh <= 0 ? 0 : clamp((selfConsumedKwh / flows.homeKwh) * 100, 0, 100)

  const selfConsumptionPercent: Percent =
    flows.productionKwh <= 0
      ? 0
      : clamp((selfConsumedKwh / flows.productionKwh) * 100, 0, 100)

  const avoidedImportKwh = Math.max(0, flows.homeKwh - flows.gridImportKwh)
  const buy = weightedBuyPrice(tariff, at)
  const savedEur: Euros =
    avoidedImportKwh * buy + flows.gridExportKwh * sellPriceAt(at, tariff)

  const outputKwh =
    flows.outputKwh != null && Number.isFinite(flows.outputKwh)
      ? flows.outputKwh
      : acOutputKwh(flows.homeKwh, flows.gridImportKwh, flows.gridExportKwh)
  const storageStartKwh =
    flows.storageStartKwh != null && Number.isFinite(flows.storageStartKwh)
      ? flows.storageStartKwh
      : null
  const storageEndKwh =
    flows.storageEndKwh != null && Number.isFinite(flows.storageEndKwh)
      ? flows.storageEndKwh
      : null
  const loss = storageLossFromBalance({
    productionKwh: flows.productionKwh,
    outputKwh,
    storageStartKwh,
    storageEndKwh,
  })

  return {
    productionKwh: flows.productionKwh,
    mppts: flows.mppts.map((m) => ({ ...m, fault: m.fault ?? null })),
    homeKwh: flows.homeKwh,
    batteryChargeKwh: flows.batteryChargeKwh,
    batteryDischargeKwh: flows.batteryDischargeKwh,
    batteryEnergyFault: flows.batteryEnergyFault ?? null,
    gridImportKwh: flows.gridImportKwh,
    gridExportKwh: flows.gridExportKwh,
    selfConsumedKwh,
    autarkyPercent,
    selfConsumptionPercent,
    savedEur,
    outputKwh,
    storageStartKwh,
    storageEndKwh,
    lossKwh: loss.lossKwh,
    lossFault: loss.lossFault,
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** AC after the inverter: Verbrauch − Netzbezug + Einspeisung. */
export function acOutputKwh(homeKwh: Kwh, gridImportKwh: Kwh, gridExportKwh: Kwh): Kwh {
  return homeKwh - gridImportKwh + gridExportKwh
}

export function kwhFromSoc(
  percent: number | null | undefined,
  capacityKwh: number | null | undefined,
): Kwh | null {
  if (percent == null || !Number.isFinite(percent)) return null
  if (capacityKwh == null || !Number.isFinite(capacityKwh) || capacityKwh <= 0) return null
  const pct = clamp(percent, 0, 100)
  return round3((capacityKwh * pct) / 100)
}

export function selfKwhFromPoint(homeKwh: Kwh, gridImportKwh: Kwh, explicit?: Kwh | null): Kwh {
  if (explicit != null && Number.isFinite(explicit)) return Math.max(0, explicit)
  return clamp(homeKwh - gridImportKwh, 0, Math.max(0, homeKwh))
}

/**
 * Speicherverlust = Produktion − Zufluss − (Ende − Anfang).
 * Missing start/end → ΔSpeicher = 0 (same as the old spreadsheet identity).
 */
export function storageLossFromBalance(args: {
  productionKwh: Kwh
  outputKwh: Kwh
  storageStartKwh: Kwh | null
  storageEndKwh: Kwh | null
}): { lossKwh: Kwh; lossFault: string | null } {
  if (!Number.isFinite(args.productionKwh) || !Number.isFinite(args.outputKwh)) {
    return { lossKwh: 0, lossFault: 'Zufluss fehlt' }
  }
  const start = args.storageStartKwh
  const end = args.storageEndKwh
  const hasDelta =
    start != null && end != null && Number.isFinite(start) && Number.isFinite(end)
  if ((start == null) !== (end == null)) {
    return { lossKwh: 0, lossFault: 'Speicherstand unvollständig' }
  }
  const delta = hasDelta ? end! - start! : 0
  return { lossKwh: round3(Math.max(0, args.productionKwh - args.outputKwh - delta)), lossFault: null }
}

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

const deInt = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 0,
})

export function formatKw(watts: Watts): string {
  return `${deInt.format(Math.round(Math.abs(watts)))} W`
}

/** Live values stay in whole watts, never kW. */
export function formatFlowW(watts: Watts): string {
  return `${deInt.format(Math.round(Math.abs(watts)))} W`
}

/** Chart axis: 1400 → "1.400", never "1,4 kW" / "1,4k". */
export function formatWattAxis(value: number): string {
  return deInt.format(Math.round(value))
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

export function formatTempC(tempC: number): string {
  return `${deInt.format(Math.round(tempC))} °C`
}

export function formatMeasuredW(watts: Watts, fault: string | null): string {
  if (fault) return fault
  return formatFlowW(watts)
}

export function formatKwhOrFault(kwh: Kwh, fault: string | null): string {
  if (fault) return fault
  return formatKwh(kwh)
}

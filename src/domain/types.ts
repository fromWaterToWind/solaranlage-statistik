export type Watts = number
export type Kwh = number
export type Percent = number // 0–100
export type Euros = number
export type PeriodKind = 'day' | 'month' | 'year'

export interface TariffWindow {
  /** Local time `HH:mm` inclusive. */
  from: string
  /** Local time `HH:mm` exclusive; may wrap past midnight. */
  to: string
  buyEurPerKwh: Euros
}

export interface Tariff {
  /** Fallback / gap-filler if no window matches. */
  buyEurPerKwh: Euros
  sellEurPerKwh: Euros
  /** Peak / off-peak (HT/NT) windows. Empty = flat buy price. */
  windows?: TariffWindow[]
}

export interface MpptLive {
  id: string
  name: string
  powerW: Watts
  fault: string | null
}

export interface LiveSnapshot {
  at: string // ISO
  mppts: MpptLive[]
  pvW: Watts
  pvFault: string | null
  homeW: Watts
  homeFault: string | null
  /** Shelly garage AC output (negative sensor → feeding house + grid). */
  outputW: Watts
  battery: {
    socPercent: Percent
    socFault: string | null
    chargeW: Watts
    dischargeW: Watts
    fault: string | null
  }
  grid: {
    importW: Watts
    exportW: Watts
    fault: string | null
  }
}

export interface MpptTotal {
  id: string
  name: string
  kwh: Kwh
  fault: string | null
}

export interface EnergyTotals {
  productionKwh: Kwh
  mppts: MpptTotal[]
  homeKwh: Kwh
  batteryChargeKwh: Kwh
  batteryDischargeKwh: Kwh
  batteryEnergyFault: string | null
  gridImportKwh: Kwh
  gridExportKwh: Kwh
  selfConsumedKwh: Kwh
  autarkyPercent: Percent
  selfConsumptionPercent: Percent
  savedEur: Euros
}

export interface SeriesPoint {
  t: string // ISO
  pvKwh: Kwh
  homeKwh: Kwh
  batteryChargeKwh: Kwh
  batteryDischargeKwh: Kwh
  gridImportKwh: Kwh
  gridExportKwh: Kwh
}

/** 15-minute power samples for the day chart (Watt, not kWh). */
export interface PowerPoint {
  t: string
  pvW: Watts
  homeW: Watts
  batteryW: Watts
  gridW: Watts
}

export interface PeriodStats {
  kind: PeriodKind
  start: string
  end: string
  totals: EnergyTotals
  series: SeriesPoint[]
  powerSeries?: PowerPoint[]
}

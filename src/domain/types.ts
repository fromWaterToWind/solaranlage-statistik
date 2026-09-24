export type Watts = number
export type Kwh = number
export type Percent = number // 0–100
export type Euros = number
export type PeriodKind = 'day' | 'month' | 'year'

export interface TariffWindow {
  /** Local time `HH:mm` inclusive, 24-hour. */
  from: string
  /** Local time `HH:mm` exclusive; may wrap past midnight. */
  to: string
  /** Buy price in ct/kWh, two decimals (32,15). */
  buyCtPerKwh?: number
  /** @deprecated Use buyCtPerKwh. */
  buyEurPerKwh?: Euros
}

export interface TariffPeriod {
  id: string
  /** Inclusive `YYYY-MM-DD`. */
  validFrom: string
  /** Inclusive last day `YYYY-MM-DD`, or null if still running. */
  validTo: string | null
  buyCtPerKwh: number
  sellCtPerKwh: number
  /** Optional HT/NT inside this contract. Empty = flat price. */
  windows?: TariffWindow[]
}

export interface Tariff {
  periods?: TariffPeriod[]
  /** @deprecated Migrated into periods. */
  buyEurPerKwh?: Euros
  /** @deprecated Migrated into periods. */
  sellEurPerKwh?: Euros
  /** @deprecated Migrated into the first period. */
  windows?: TariffWindow[]
}

export interface MpptLive {
  id: string
  name: string
  powerW: Watts
  fault: string | null
  tempC?: number | null
  tempFault?: string | null
  peakW?: number | null
}

export interface BatteryPartLive {
  id: string
  name: string
  socPercent: Percent
  socFault: string | null
  tempC: number | null
  tempFault: string | null
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
    parts: BatteryPartLive[]
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
  /** AC after the inverter (Zufluss Hausnetz). */
  outputKwh: Kwh
  storageStartKwh: Kwh | null
  storageEndKwh: Kwh | null
  /** Produktion − Zufluss − (Speicher Ende − Anfang). */
  lossKwh: Kwh
  lossFault: string | null
}

export interface SeriesPoint {
  t: string // ISO
  pvKwh: Kwh
  homeKwh: Kwh
  batteryChargeKwh: Kwh
  batteryDischargeKwh: Kwh
  gridImportKwh: Kwh
  gridExportKwh: Kwh
  /** Optional explicit Eigenverbrauch; else home − import. */
  selfKwh?: Kwh
}

/** 15-minute power samples for the day chart (Watt, not kWh). */
export interface PowerPoint {
  t: string
  pvW: Watts
  homeW: Watts
  batteryW: Watts
  gridW: Watts
  mpptW?: Record<string, Watts>
  battPartW?: Record<string, Watts>
  socPercent?: number | null
  socById?: Record<string, number | null>
}

export type PeriodSource = 'ha' | 'manual' | 'mixed'

export interface PeriodStats {
  kind: PeriodKind
  start: string
  end: string
  totals: EnergyTotals
  series: SeriesPoint[]
  powerSeries?: PowerPoint[]
  /** ha = tracker only, manual = Nachtrag, mixed = year with both. */
  source?: PeriodSource
  /** Optional note when Growatt filled or failed the day curve. */
  growattNote?: string | null
}

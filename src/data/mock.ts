import { kwhFromSoc, sumMpptW, totalsFromFlows } from '@/domain/calc'
import type {
  BatteryPartLive,
  EnergyTotals,
  Kwh,
  LiveSnapshot,
  MpptLive,
  MpptTotal,
  PeriodKind,
  PeriodStats,
  PowerPoint,
  SeriesPoint,
  Tariff,
  Watts,
} from '@/domain/types'
import type { EnergySource } from './source'

const MPPT_OST = { id: 'pv1', name: 'Ost Dach' } as const
const MPPT_WEST = { id: 'pv2', name: 'West Dach' } as const

const BATTERY_USABLE_KWH = 10
const LIVE_TICK_MS = 2000

function readTariff(): Tariff {
  const buy = Number(import.meta.env.VITE_BUY_PRICE_EUR_KWH ?? '0.32')
  const sell = Number(import.meta.env.VITE_SELL_PRICE_EUR_KWH ?? '0.08')
  return {
    buyEurPerKwh: Number.isFinite(buy) ? buy : 0.32,
    sellEurPerKwh: Number.isFinite(sell) ? sell : 0.08,
  }
}

/** Deterministic PRNG from integer seed (mulberry32). */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function hashDate(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Seasonal PV scale: summer ~1, winter ~0.2 (Germany-ish). */
function seasonalPvFactor(monthIndex: number): number {
  // monthIndex 0=Jan … 8=Sep
  const curve = [0.22, 0.3, 0.5, 0.75, 0.95, 1.0, 1.0, 0.9, 0.7, 0.45, 0.28, 0.2]
  return curve[monthIndex] ?? 0.5
}

/** Bell curve peaking at `peakHour` (local decimal hours). */
function bell(hour: number, peakHour: number, width: number): number {
  const x = (hour - peakHour) / width
  return Math.exp(-0.5 * x * x)
}

function mpptPowerW(hour: number, season: number, rand: number): {
  ost: Watts
  west: Watts
} {
  // Ost peaks ~10:00, West ~14:30; night ≈ 0
  const daylight =
    hour >= 5.5 && hour <= 20.5 ? 1 : hour > 5 && hour < 5.5 ? (hour - 5) * 2 : 0
  const ostPeak = 4200 * season * (0.92 + rand * 0.16)
  const westPeak = 3800 * season * (0.92 + rand * 0.16)
  const ost = ostPeak * bell(hour, 10.0, 2.4) * daylight
  const west = westPeak * bell(hour, 14.5, 2.6) * daylight
  return { ost: Math.round(ost), west: Math.round(west) }
}

function homePowerW(hour: number, rand: number): Watts {
  // Morning bump, low midday, evening peak ~18:00 → ~10–14 kWh/day
  const base = 280 + rand * 60
  const morning = 900 * bell(hour, 7.5, 1.2)
  const midday = 200 * bell(hour, 12.5, 2.0)
  const evening = 1600 * bell(hour, 18.0, 1.8)
  const night = hour < 5 || hour > 23 ? 150 : 0
  return Math.round(base + morning + midday + evening + night)
}

interface FlowState {
  socPercent: number
}

function resolveFlows(
  pvW: Watts,
  homeW: Watts,
  state: FlowState,
): {
  chargeW: Watts
  dischargeW: Watts
  importW: Watts
  exportW: Watts
  socPercent: number
} {
  const surplus = pvW - homeW
  let chargeW = 0
  let dischargeW = 0
  let importW = 0
  let exportW = 0
  let soc = state.socPercent

  const maxChargeW = 3500
  const maxDischargeW = 3500

  if (surplus > 20 && soc < 95) {
    // Charge from surplus; leftover may export
    const roomKwh = ((95 - soc) / 100) * BATTERY_USABLE_KWH
    const roomW = roomKwh * 1000 // rough instantaneous headroom
    chargeW = Math.min(surplus, maxChargeW, Math.max(roomW, 50))
    const leftover = surplus - chargeW
    exportW = leftover > 20 ? leftover : 0
    // SOC drift for live ticks (~2s): small step
    soc = clamp(soc + (chargeW / (BATTERY_USABLE_KWH * 1000)) * 100 * (LIVE_TICK_MS / 3600000) * 1800, 15, 95)
  } else if (surplus < -20 && soc > 15) {
    // Deficit: discharge then import
    const need = -surplus
    const availableKwh = ((soc - 15) / 100) * BATTERY_USABLE_KWH
    const availableW = availableKwh * 1000
    dischargeW = Math.min(need, maxDischargeW, Math.max(availableW, 50))
    const stillNeed = need - dischargeW
    importW = stillNeed > 20 ? stillNeed : 0
    soc = clamp(soc - (dischargeW / (BATTERY_USABLE_KWH * 1000)) * 100 * (LIVE_TICK_MS / 3600000) * 1800, 15, 95)
  } else if (surplus < -20) {
    importW = -surplus
  } else if (surplus > 20) {
    exportW = surplus
  }

  return {
    chargeW: Math.round(chargeW),
    dischargeW: Math.round(dischargeW),
    importW: Math.round(importW),
    exportW: Math.round(exportW),
    socPercent: Math.round(soc * 10) / 10,
  }
}

function buildLiveAt(now: Date, socPercent: number): LiveSnapshot {
  const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const season = seasonalPvFactor(now.getMonth())
  const dayRand = mulberry32(hashDate(now))()
  const { ost, west } = mpptPowerW(hour, season, dayRand)
  const mppts: MpptLive[] = [
    {
      id: MPPT_OST.id,
      name: MPPT_OST.name,
      powerW: ost,
      fault: null,
      tempC: ost > 1 ? Math.round(16 + (ost / 4500) * 22) : 14,
      tempFault: null,
      peakW: 4500,
    },
    {
      id: MPPT_WEST.id,
      name: MPPT_WEST.name,
      powerW: west,
      fault: null,
      tempC: west > 1 ? Math.round(16 + (west / 4000) * 22) : 14,
      tempFault: null,
      peakW: 4000,
    },
  ]
  const pvW = sumMpptW(mppts)
  const homeW = homePowerW(hour, dayRand)
  const flows = resolveFlows(pvW, homeW, { socPercent })

  return {
    at: now.toISOString(),
    mppts,
    pvW,
    pvFault: null,
    homeW,
    homeFault: null,
    outputW: Math.max(0, homeW - flows.importW),
    battery: {
      socPercent: flows.socPercent,
      socFault: null,
      chargeW: flows.chargeW,
      dischargeW: flows.dischargeW,
      fault: null,
      parts: [
        {
          id: 'b1',
          name: 'Batterie 1',
          socPercent: clamp(flows.socPercent - 2, 0, 100),
          socFault: null,
          tempC: 21,
          tempFault: null,
        },
        {
          id: 'b2',
          name: 'Batterie 2',
          socPercent: flows.socPercent,
          socFault: null,
          tempC: 22,
          tempFault: null,
        },
        {
          id: 'b3',
          name: 'Batterie 3',
          socPercent: clamp(flows.socPercent + 1, 0, 100),
          socFault: null,
          tempC: 23,
          tempFault: null,
        },
      ] as BatteryPartLive[],
    },
    grid: {
      importW: flows.importW,
      exportW: flows.exportW,
      fault: null,
    },
  }
}

/** Simulate one hour of energy (kWh) from average power, with battery state. */
function simulateHour(
  date: Date,
  hour: number,
  soc: number,
  rand: () => number,
): { point: SeriesPoint; ostKwh: Kwh; westKwh: Kwh; soc: number } {
  const season = seasonalPvFactor(date.getMonth())
  const r = rand()
  const midHour = hour + 0.5
  const { ost, west } = mpptPowerW(midHour, season, r)
  const homeW = homePowerW(midHour, r)

  // Hourly energy ≈ power_kW * 1h
  const ostKwh = ost / 1000
  const westKwh = west / 1000
  const pvKwh = ostKwh + westKwh
  const homeKwh = homeW / 1000

  let batteryChargeKwh = 0
  let batteryDischargeKwh = 0
  let gridImportKwh = 0
  let gridExportKwh = 0
  let nextSoc = soc

  const surplus = pvKwh - homeKwh
  if (surplus > 0.02 && nextSoc < 95) {
    const room = ((95 - nextSoc) / 100) * BATTERY_USABLE_KWH
    batteryChargeKwh = Math.min(surplus, room, 3.5)
    gridExportKwh = Math.max(0, surplus - batteryChargeKwh)
    nextSoc = clamp(nextSoc + (batteryChargeKwh / BATTERY_USABLE_KWH) * 100, 15, 95)
  } else if (surplus < -0.02 && nextSoc > 15) {
    const need = -surplus
    const available = ((nextSoc - 15) / 100) * BATTERY_USABLE_KWH
    batteryDischargeKwh = Math.min(need, available, 3.5)
    gridImportKwh = Math.max(0, need - batteryDischargeKwh)
    nextSoc = clamp(nextSoc - (batteryDischargeKwh / BATTERY_USABLE_KWH) * 100, 15, 95)
  } else if (surplus < -0.02) {
    gridImportKwh = -surplus
  } else if (surplus > 0.02) {
    gridExportKwh = surplus
  }

  const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0)

  return {
    point: {
      t: t.toISOString(),
      pvKwh: round3(pvKwh),
      homeKwh: round3(homeKwh),
      batteryChargeKwh: round3(batteryChargeKwh),
      batteryDischargeKwh: round3(batteryDischargeKwh),
      gridImportKwh: round3(gridImportKwh),
      gridExportKwh: round3(gridExportKwh),
    },
    ostKwh: round3(ostKwh),
    westKwh: round3(westKwh),
    soc: nextSoc,
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function sumSeries(series: SeriesPoint[]): {
  productionKwh: Kwh
  homeKwh: Kwh
  batteryChargeKwh: Kwh
  batteryDischargeKwh: Kwh
  gridImportKwh: Kwh
  gridExportKwh: Kwh
} {
  return series.reduce(
    (acc, p) => ({
      productionKwh: acc.productionKwh + p.pvKwh,
      homeKwh: acc.homeKwh + p.homeKwh,
      batteryChargeKwh: acc.batteryChargeKwh + p.batteryChargeKwh,
      batteryDischargeKwh: acc.batteryDischargeKwh + p.batteryDischargeKwh,
      gridImportKwh: acc.gridImportKwh + p.gridImportKwh,
      gridExportKwh: acc.gridExportKwh + p.gridExportKwh,
    }),
    {
      productionKwh: 0,
      homeKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
    },
  )
}

function daySeries(date: Date): {
  series: SeriesPoint[]
  ostKwh: Kwh
  westKwh: Kwh
} {
  const rand = mulberry32(hashDate(date) ^ 0x9e3779b9)
  let soc = 40 + rand() * 30
  const series: SeriesPoint[] = []
  let ostKwh = 0
  let westKwh = 0
  for (let h = 0; h < 24; h++) {
    const { point, ostKwh: o, westKwh: w, soc: next } = simulateHour(date, h, soc, rand)
    series.push(point)
    ostKwh += o
    westKwh += w
    soc = next
  }
  return { series, ostKwh: round3(ostKwh), westKwh: round3(westKwh) }
}

function buildTotals(
  series: SeriesPoint[],
  ostKwh: Kwh,
  westKwh: Kwh,
  tariff: Tariff,
  storage?: { startPercent: number | null; endPercent: number | null },
): EnergyTotals {
  const sums = sumSeries(series)
  const mppts: MpptTotal[] = [
    { id: MPPT_OST.id, name: MPPT_OST.name, kwh: round3(ostKwh), fault: null },
    { id: MPPT_WEST.id, name: MPPT_WEST.name, kwh: round3(westKwh), fault: null },
  ]
  return totalsFromFlows(
    {
      productionKwh: round3(sums.productionKwh),
      homeKwh: round3(sums.homeKwh),
      batteryChargeKwh: round3(sums.batteryChargeKwh),
      batteryDischargeKwh: round3(sums.batteryDischargeKwh),
      gridImportKwh: round3(sums.gridImportKwh),
      gridExportKwh: round3(sums.gridExportKwh),
      mppts,
      storageStartKwh: kwhFromSoc(storage?.startPercent, BATTERY_USABLE_KWH),
      storageEndKwh: kwhFromSoc(storage?.endPercent, BATTERY_USABLE_KWH),
    },
    tariff,
  )
}

function socEnds(power: PowerPoint[]): { startPercent: number | null; endPercent: number | null } {
  let startPercent: number | null = null
  let endPercent: number | null = null
  for (const p of power) {
    if (p.socPercent == null || !Number.isFinite(p.socPercent)) continue
    if (startPercent == null) startPercent = p.socPercent
    endPercent = p.socPercent
  }
  return { startPercent, endPercent }
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayPowerSeries(date: Date): PowerPoint[] {
  const now = new Date()
  const start = startOfDay(date)
  const end = isSameDay(date, now) ? now : new Date(start.getTime() + 24 * 60 * 60_000)
  const season = seasonalPvFactor(date.getMonth())
  const rand = mulberry32(hashDate(date) ^ 0x51ed)
  let soc = 40 + rand() * 30
  const out: PowerPoint[] = []
  for (let t = start.getTime(); t < end.getTime(); t += 15 * 60_000) {
    const d = new Date(t)
    const hour = d.getHours() + d.getMinutes() / 60
    const r = rand()
    const { ost, west } = mpptPowerW(hour, season, r)
    const pvW = ost + west
    const homeW = homePowerW(hour, r)
    const surplus = pvW - homeW
    let chargeW = 0
    let dischargeW = 0
    let importW = 0
    let exportW = 0
    const stepH = 0.25
    if (surplus > 20 && soc < 95) {
      chargeW = Math.min(surplus, 3500)
      exportW = Math.max(0, surplus - chargeW)
      soc = clamp(soc + (chargeW / 1000 / BATTERY_USABLE_KWH) * 100 * stepH, 15, 95)
    } else if (surplus < -20 && soc > 15) {
      dischargeW = Math.min(-surplus, 3500)
      importW = Math.max(0, -surplus - dischargeW)
      soc = clamp(soc - (dischargeW / 1000 / BATTERY_USABLE_KWH) * 100 * stepH, 15, 95)
    } else if (surplus < -20) {
      importW = -surplus
    } else if (surplus > 20) {
      exportW = surplus
    }
    const batteryW = dischargeW - chargeW
    out.push({
      t: d.toISOString(),
      pvW,
      homeW,
      batteryW,
      gridW: importW - exportW,
      mpptW: { pv1: ost, pv2: west },
      battPartW: {},
      socPercent: Math.round(soc * 10) / 10,
      socById: {
        b1: clamp(soc - 2, 0, 100),
        b2: soc,
        b3: clamp(soc + 1, 0, 100),
      },
    })
  }
  return out
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export class MockEnergySource implements EnergySource {
  private socPercent = 55
  private readonly tariff = readTariff()

  async getLive(): Promise<LiveSnapshot> {
    const snap = buildLiveAt(new Date(), this.socPercent)
    this.socPercent = snap.battery.socPercent
    return snap
  }

  subscribeLive(cb: (s: LiveSnapshot) => void): () => void {
    const tick = () => {
      void this.getLive().then(cb)
    }
    tick()
    const id = setInterval(tick, LIVE_TICK_MS)
    return () => clearInterval(id)
  }

  async getPeriod(kind: PeriodKind, date: Date): Promise<PeriodStats> {
    if (kind === 'day') {
      return this.periodDay(date)
    }
    if (kind === 'month') {
      return this.periodMonth(date)
    }
    return this.periodYear(date)
  }

  private periodDay(date: Date): PeriodStats {
    const day = startOfDay(date)
    const { series, ostKwh, westKwh } = daySeries(day)
    const powerSeries = dayPowerSeries(day)
    return {
      kind: 'day',
      start: day.toISOString(),
      end: endOfDay(day).toISOString(),
      totals: buildTotals(series, ostKwh, westKwh, this.tariff, socEnds(powerSeries)),
      series,
      powerSeries,
    }
  }

  private periodMonth(date: Date): PeriodStats {
    const year = date.getFullYear()
    const month = date.getMonth()
    const n = daysInMonth(year, month)
    const series: SeriesPoint[] = []
    let ostKwh = 0
    let westKwh = 0

    for (let day = 1; day <= n; day++) {
      const d = new Date(year, month, day)
      const { series: hours, ostKwh: o, westKwh: w } = daySeries(d)
      const sums = sumSeries(hours)
      series.push({
        t: startOfDay(d).toISOString(),
        pvKwh: round3(sums.productionKwh),
        homeKwh: round3(sums.homeKwh),
        batteryChargeKwh: round3(sums.batteryChargeKwh),
        batteryDischargeKwh: round3(sums.batteryDischargeKwh),
        gridImportKwh: round3(sums.gridImportKwh),
        gridExportKwh: round3(sums.gridExportKwh),
      })
      ostKwh += o
      westKwh += w
    }

    const start = new Date(year, month, 1)
    const end = endOfDay(new Date(year, month, n))
    return {
      kind: 'month',
      start: start.toISOString(),
      end: end.toISOString(),
      totals: buildTotals(series, ostKwh, westKwh, this.tariff),
      series,
    }
  }

  private periodYear(date: Date): PeriodStats {
    const year = date.getFullYear()
    const series: SeriesPoint[] = []
    let ostKwh = 0
    let westKwh = 0

    for (let month = 0; month < 12; month++) {
      const monthStats = this.periodMonth(new Date(year, month, 15))
      const sums = sumSeries(monthStats.series)
      series.push({
        t: new Date(year, month, 1).toISOString(),
        pvKwh: round3(sums.productionKwh),
        homeKwh: round3(sums.homeKwh),
        batteryChargeKwh: round3(sums.batteryChargeKwh),
        batteryDischargeKwh: round3(sums.batteryDischargeKwh),
        gridImportKwh: round3(sums.gridImportKwh),
        gridExportKwh: round3(sums.gridExportKwh),
      })
      for (const m of monthStats.totals.mppts) {
        if (m.id === 'pv1') ostKwh += m.kwh
        if (m.id === 'pv2') westKwh += m.kwh
      }
    }

    return {
      kind: 'year',
      start: new Date(year, 0, 1).toISOString(),
      end: endOfDay(new Date(year, 11, 31)).toISOString(),
      totals: buildTotals(series, ostKwh, westKwh, this.tariff),
      series,
    }
  }
}

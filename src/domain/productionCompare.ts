import type { MpptTotal, PeriodKind, PeriodStats } from './types'

export interface ProductionWindow {
  kwh: number
  prevKwh: number
  deltaPercent: number | null
}

export interface ProductionCompare {
  today: ProductionWindow
  week: ProductionWindow
  month: ProductionWindow
  mppts: MpptTotal[]
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pvByDay(series: { t: string; pvKwh: number }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const p of series) {
    const d = new Date(p.t)
    const key = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
    map.set(key, (map.get(key) ?? 0) + p.pvKwh)
  }
  return map
}

function shiftDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta)
}

function sumRolling(map: Map<string, number>, end: Date, days: number): number {
  let sum = 0
  for (let i = 0; i < days; i++) {
    sum += map.get(dayKey(shiftDays(end, -i))) ?? 0
  }
  return sum
}

function monthToDate(map: Map<string, number>, year: number, month: number, throughDay: number): number {
  const last = new Date(year, month + 1, 0).getDate()
  const until = Math.min(throughDay, last)
  let sum = 0
  for (let day = 1; day <= until; day++) {
    sum += map.get(dayKey(new Date(year, month, day))) ?? 0
  }
  return sum
}

export function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0.05) return null
  return ((current - previous) / previous) * 100
}

export function buildProductionCompare(
  todayStats: PeriodStats,
  thisMonth: PeriodStats,
  lastMonth: PeriodStats,
  now = new Date(),
): ProductionCompare {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = shiftDays(today, -1)
  const map = pvByDay([...(lastMonth.series ?? []), ...(thisMonth.series ?? [])])

  const todayKwh = Math.max(0, todayStats.totals.productionKwh)
  const yesterdayKwh = map.get(dayKey(yesterday)) ?? 0

  const weekKwh = sumRolling(map, yesterday, 6) + todayKwh
  const prevWeekEnd = shiftDays(today, -7)
  const prevWeekKwh = sumRolling(map, prevWeekEnd, 7)

  const throughDay = today.getDate()
  const monthBeforeToday = monthToDate(map, today.getFullYear(), today.getMonth(), throughDay - 1)
  const monthKwh = monthBeforeToday + todayKwh
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevMonthKwh = monthToDate(map, prev.getFullYear(), prev.getMonth(), throughDay)

  return {
    today: {
      kwh: todayKwh,
      prevKwh: yesterdayKwh,
      deltaPercent: deltaPercent(todayKwh, yesterdayKwh),
    },
    week: {
      kwh: weekKwh,
      prevKwh: prevWeekKwh,
      deltaPercent: deltaPercent(weekKwh, prevWeekKwh),
    },
    month: {
      kwh: monthKwh,
      prevKwh: prevMonthKwh,
      deltaPercent: deltaPercent(monthKwh, prevMonthKwh),
    },
    mppts: todayStats.totals.mppts ?? [],
  }
}

export function stubPeriodStats(kind: PeriodKind, date: Date): PeriodStats {
  const start =
    kind === 'month'
      ? new Date(date.getFullYear(), date.getMonth(), 1)
      : kind === 'year'
        ? new Date(date.getFullYear(), 0, 1)
        : new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end =
    kind === 'month'
      ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
      : kind === 'year'
        ? new Date(date.getFullYear() + 1, 0, 1)
        : new Date(start.getTime() + 86_400_000)
  return {
    kind,
    start: start.toISOString(),
    end: new Date(end.getTime() - 1).toISOString(),
    totals: {
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
    },
    series: [],
  }
}

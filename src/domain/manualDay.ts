import {
  applyExplicitSelfUse,
  eigenverbrauchKwh,
  homeKwhFromWrAc,
  reconcileHomeAndSelf,
  selfKwhFromWrAc,
  totalsFromFlows,
} from './calc'
import type { PeriodStats, SeriesPoint, Tariff } from './types'

export interface ManualDay {
  /** YYYY-MM-DD local. */
  date: string
  productionKwh: number | null
  homeKwh: number | null
  selfUseKwh: number | null
  importKwh: number | null
  exportKwh: number | null
  /** Inverter AC output into the house grid (Growatt pac integral). */
  houseInflowKwh: number | null
}

export const MANUAL_DAY_FIELDS = [
  { key: 'productionKwh', label: 'Produktion', hint: 'falls der Tracker fehlt' },
  {
    key: 'houseInflowKwh',
    label: 'WR AC-Ausgabe',
    hint: 'wie Shelly. Eigenverbrauch = WR AC − Einspeisung',
  },
  { key: 'homeKwh', label: 'Verbrauch', hint: 'Eigenverbrauch + Netzbezug' },
  { key: 'selfUseKwh', label: 'Eigenverbrauch', hint: 'WR AC − Einspeisung' },
  { key: 'importKwh', label: 'Netzbezug', hint: '' },
  { key: 'exportKwh', label: 'Einspeisung', hint: '' },
] as const

export type ManualDayFieldKey = (typeof MANUAL_DAY_FIELDS)[number]['key']

export function emptyManualDay(date: string): ManualDay {
  return {
    date,
    productionKwh: null,
    houseInflowKwh: null,
    homeKwh: null,
    selfUseKwh: null,
    importKwh: null,
    exportKwh: null,
  }
}

export function hasDayValue(row: ManualDay): boolean {
  return MANUAL_DAY_FIELDS.some((f) => {
    const v = row[f.key]
    return v != null && Number.isFinite(v)
  })
}

export function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function findDay(rows: ManualDay[], date: string): ManualDay | undefined {
  return rows.find((r) => r.date === date)
}

function localDayKey(iso: string): string {
  const d = new Date(iso)
  return isoDateLocal(d)
}

function emptyPoint(date: Date): SeriesPoint {
  return {
    t: new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString(),
    pvKwh: 0,
    homeKwh: 0,
    batteryChargeKwh: 0,
    batteryDischargeKwh: 0,
    gridImportKwh: 0,
    gridExportKwh: 0,
    outputKwh: 0,
  }
}

/** Every calendar day in the month, so Nachträge show even when the tracker has no row. */
function fillMonthDays(series: SeriesPoint[], year: number, month: number): SeriesPoint[] {
  const byDay = new Map(series.map((p) => [localDayKey(p.t), p]))
  const last = new Date(year, month, 0).getDate()
  const out: SeriesPoint[] = []
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, month - 1, d)
    out.push(byDay.get(isoDateLocal(dt)) ?? emptyPoint(dt))
  }
  return out
}

function looksLikeDailySeries(series: SeriesPoint[]): boolean {
  const seen = new Set<string>()
  for (const p of series) {
    const d = new Date(p.t)
    if (d.getDate() !== 1) return true
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/** Roll daily points into one bar per month (year chart / year merge). */
export function bucketSeriesByMonth(daily: SeriesPoint[]): SeriesPoint[] {
  if (!daily.length) return []
  const months = new Map<number, SeriesPoint>()
  for (const p of daily) {
    const d = new Date(p.t)
    const key = d.getFullYear() * 12 + d.getMonth()
    const cur = months.get(key) ?? emptyPoint(new Date(d.getFullYear(), d.getMonth(), 1))
    cur.pvKwh += p.pvKwh
    cur.homeKwh += p.homeKwh
    cur.batteryChargeKwh += p.batteryChargeKwh
    cur.batteryDischargeKwh += p.batteryDischargeKwh
    cur.gridImportKwh += p.gridImportKwh
    cur.gridExportKwh += p.gridExportKwh
    cur.outputKwh = (cur.outputKwh ?? 0) + (p.outputKwh ?? 0)
    cur.selfKwh = (cur.selfKwh ?? 0) + (p.selfKwh ?? 0)
    months.set(key, cur)
  }
  return [...months.values()]
    .map((p) => {
      const selfKwh = eigenverbrauchKwh({
        homeKwh: p.homeKwh,
        importKwh: p.gridImportKwh,
        exportKwh: p.gridExportKwh,
        outputKwh: p.outputKwh,
        selfKwh: p.selfKwh,
      })
      const rec = reconcileHomeAndSelf(p.homeKwh, selfKwh)
      return { ...p, homeKwh: rec.homeKwh, selfKwh: rec.selfKwh }
    })
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

function overlayTotals(
  stats: PeriodStats,
  series: SeriesPoint[],
  tariff: Tariff,
): PeriodStats {
  const homeKwh = series.reduce((s, p) => s + p.homeKwh, 0)
  const productionKwh = series.reduce((s, p) => s + p.pvKwh, 0)
  const gridImportKwh = series.reduce((s, p) => s + p.gridImportKwh, 0)
  const gridExportKwh = series.reduce((s, p) => s + p.gridExportKwh, 0)
  const selfKwh = series.reduce(
    (s, p) =>
      s +
      eigenverbrauchKwh({
        homeKwh: p.homeKwh,
        importKwh: p.gridImportKwh,
        exportKwh: p.gridExportKwh,
        outputKwh: p.outputKwh,
        selfKwh: p.selfKwh,
      }),
    0,
  )
  const outputKwh = series.reduce((s, p) => s + (p.outputKwh ?? 0), 0)
  const totals = totalsFromFlows(
    {
      productionKwh,
      homeKwh,
      batteryChargeKwh: stats.totals.batteryChargeKwh,
      batteryDischargeKwh: stats.totals.batteryDischargeKwh,
      batteryEnergyFault: stats.totals.batteryEnergyFault,
      gridImportKwh,
      gridExportKwh,
      mppts: stats.totals.mppts,
      outputKwh,
      storageStartKwh: stats.totals.storageStartKwh,
      storageEndKwh: stats.totals.storageEndKwh,
    },
    tariff,
    new Date(stats.start),
  )
  totals.selfConsumedKwh = Math.min(selfKwh, homeKwh)
  return { ...stats, series, totals, source: 'mixed' }
}

function foldDaysIntoMonthPoint(base: SeriesPoint, days: ManualDay[]): SeriesPoint {
  let pvKwh = base.pvKwh
  let homeKwh = base.homeKwh
  let gridImportKwh = base.gridImportKwh
  let gridExportKwh = base.gridExportKwh
  let outputKwh = base.outputKwh ?? 0
  let selfKwh = base.selfKwh ?? 0
  for (const row of days) {
    const patched = patchPoint(emptyPoint(new Date(`${row.date}T12:00:00`)), row)
    if (row.productionKwh != null) pvKwh += patched.pvKwh
    if (row.houseInflowKwh != null) outputKwh += patched.outputKwh ?? 0
    if (row.importKwh != null) gridImportKwh += patched.gridImportKwh
    if (row.exportKwh != null) gridExportKwh += patched.gridExportKwh
    if (row.homeKwh != null) homeKwh += patched.homeKwh
    if (row.selfUseKwh != null || row.houseInflowKwh != null) {
      selfKwh += patched.selfKwh ?? 0
    }
  }
  const rec = reconcileHomeAndSelf(
    homeKwh,
    eigenverbrauchKwh({
      homeKwh,
      importKwh: gridImportKwh,
      exportKwh: gridExportKwh,
      outputKwh,
      selfKwh,
    }),
  )
  return {
    ...base,
    pvKwh,
    homeKwh: rec.homeKwh,
    gridImportKwh,
    gridExportKwh,
    outputKwh,
    selfKwh: rec.selfKwh,
  }
}

function exportForWrAc(p: SeriesPoint, row: ManualDay | undefined, outputKwh: number): number {
  if (row?.exportKwh != null) return row.exportKwh
  const ha = p.gridExportKwh
  if (outputKwh > 0 && ha > outputKwh) return 0
  return ha
}

function patchPoint(p: SeriesPoint, row?: ManualDay): SeriesPoint {
  const measuredWr =
    row?.houseInflowKwh != null && row.houseInflowKwh > 0
      ? row.houseInflowKwh
      : p.outputKwh != null && p.outputKwh > 0
        ? p.outputKwh
        : null
  const gridImportKwh = row?.importKwh ?? p.gridImportKwh
  const gridExportKwh = exportForWrAc(p, row, measuredWr ?? 0)
  const selfFromWr = measuredWr != null ? selfKwhFromWrAc(measuredWr, gridExportKwh) : null
  const homeRaw =
    row?.homeKwh ??
    (measuredWr != null ? homeKwhFromWrAc(measuredWr, gridImportKwh, gridExportKwh) : p.homeKwh)
  const rawSelf = eigenverbrauchKwh({
    homeKwh: homeRaw,
    importKwh: gridImportKwh,
    exportKwh: gridExportKwh,
    outputKwh: measuredWr,
    selfKwh: row?.selfUseKwh ?? selfFromWr ?? p.selfKwh,
  })
  const { homeKwh, selfKwh } = reconcileHomeAndSelf(homeRaw, rawSelf)
  return {
    ...p,
    pvKwh: row?.productionKwh ?? p.pvKwh,
    homeKwh,
    gridImportKwh,
    gridExportKwh: row?.exportKwh ?? p.gridExportKwh,
    outputKwh: measuredWr ?? p.outputKwh,
    selfKwh,
  }
}

/** Overlay typed-in days onto HA series / today's totals. */
export function applyManualDays(
  stats: PeriodStats,
  days: ManualDay[],
  tariff: Tariff,
): PeriodStats {
  const filled = days.filter(hasDayValue)
  if (!filled.length) return stats

  if (stats.kind === 'day') {
    const key = isoDateLocal(new Date(stats.start))
    const row = findDay(filled, key)
    if (!row) return stats
    const productionKwh = row.productionKwh ?? stats.totals.productionKwh
    const gridImportKwh = row.importKwh ?? stats.totals.gridImportKwh
    const gridExportKwh = row.exportKwh ?? stats.totals.gridExportKwh
    const outputKwh = row.houseInflowKwh ?? stats.totals.outputKwh
    const exportKwh =
      row.exportKwh ??
      (row.houseInflowKwh != null &&
      row.houseInflowKwh > 0 &&
      stats.totals.gridExportKwh > row.houseInflowKwh
        ? 0
        : gridExportKwh)
    const selfFromWr =
      row.selfUseKwh ??
      (row.houseInflowKwh != null ? selfKwhFromWrAc(row.houseInflowKwh, exportKwh) : null)
    const homeKwh =
      row.homeKwh ??
      (selfFromWr != null
        ? homeKwhFromWrAc(outputKwh, gridImportKwh, exportKwh)
        : stats.totals.homeKwh)
    const totals = totalsFromFlows(
      {
        productionKwh,
        homeKwh,
        batteryChargeKwh: stats.totals.batteryChargeKwh,
        batteryDischargeKwh: stats.totals.batteryDischargeKwh,
        batteryEnergyFault: stats.totals.batteryEnergyFault,
        gridImportKwh,
        gridExportKwh,
        mppts: stats.totals.mppts,
        outputKwh,
        storageStartKwh: stats.totals.storageStartKwh,
        storageEndKwh: stats.totals.storageEndKwh,
      },
      tariff,
      new Date(stats.start),
    )
    if (selfFromWr != null) {
      Object.assign(totals, applyExplicitSelfUse(totals, selfFromWr, productionKwh))
    }
    return { ...stats, totals, source: stats.source === 'ha' ? 'mixed' : stats.source }
  }

  if (stats.kind === 'month') {
    const start = new Date(stats.start)
    const year = start.getFullYear()
    const month = start.getMonth() + 1
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`
    const monthDays = filled.filter((d) => d.date.startsWith(monthPrefix))
    if (!monthDays.length) return stats
    const byDate = new Map(monthDays.map((d) => [d.date, d]))
    const series = fillMonthDays(stats.series, year, month).map((p) =>
      patchPoint(p, byDate.get(localDayKey(p.t))),
    )
    return overlayTotals(stats, series, tariff)
  }

  if (stats.kind === 'year') {
    const year = new Date(stats.start).getFullYear()
    const yearDays = filled.filter((d) => d.date.startsWith(`${year}-`))
    if (!yearDays.length) return stats

    if (looksLikeDailySeries(stats.series) || stats.series.length === 0) {
      const ptsByMonth = new Map<number, SeriesPoint[]>()
      for (const p of stats.series) {
        const m = new Date(p.t).getMonth() + 1
        const list = ptsByMonth.get(m) ?? []
        list.push(p)
        ptsByMonth.set(m, list)
      }
      const daysByMonth = new Map<number, ManualDay[]>()
      for (const d of yearDays) {
        const m = Number(d.date.slice(5, 7))
        const list = daysByMonth.get(m) ?? []
        list.push(d)
        daysByMonth.set(m, list)
      }
      const daily: SeriesPoint[] = []
      for (let month = 1; month <= 12; month++) {
        const pts = ptsByMonth.get(month) ?? []
        const monthDays = daysByMonth.get(month) ?? []
        if (!monthDays.length) {
          daily.push(...pts)
          continue
        }
        const byDate = new Map(monthDays.map((row) => [row.date, row]))
        daily.push(
          ...fillMonthDays(pts, year, month).map((p) => patchPoint(p, byDate.get(localDayKey(p.t)))),
        )
      }
      return overlayTotals(stats, daily, tariff)
    }

    const byMonth = new Map<number, SeriesPoint>()
    for (const p of stats.series) {
      byMonth.set(new Date(p.t).getMonth() + 1, p)
    }
    const daysByMonth = new Map<number, ManualDay[]>()
    for (const d of yearDays) {
      const m = Number(d.date.slice(5, 7))
      const list = daysByMonth.get(m) ?? []
      list.push(d)
      daysByMonth.set(m, list)
    }
    const series: SeriesPoint[] = []
    for (let month = 1; month <= 12; month++) {
      const existing = byMonth.get(month)
      const monthDays = daysByMonth.get(month) ?? []
      if (!monthDays.length) {
        if (existing) series.push(existing)
        continue
      }
      const base = existing ?? emptyPoint(new Date(year, month - 1, 1))
      series.push(foldDaysIntoMonthPoint(base, monthDays))
    }
    return overlayTotals(stats, series, tariff)
  }

  return stats
}

export function sortManualDays(rows: ManualDay[]): ManualDay[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date))
}

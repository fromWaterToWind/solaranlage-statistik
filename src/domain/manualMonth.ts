import { acOutputKwh, storageLossFromBalance, totalsFromFlows } from './calc'
import type { EnergyTotals, PeriodStats, SeriesPoint, Tariff } from './types'

export interface ManualMonth {
  year: number
  /** Calendar month, 1–12. */
  month: number
  productionKwh: number | null
  houseInflowKwh: number | null
  storageStartKwh: number | null
  storageEndKwh: number | null
  conversionLossKwh: number | null
  exportKwh: number | null
  importKwh: number | null
  selfUseKwh: number | null
  totalUseKwh: number | null
}

export const MANUAL_FIELDS = [
  { key: 'productionKwh', label: 'Produktion', hint: 'PV-Erzeugung' },
  { key: 'houseInflowKwh', label: 'Zufluss Hausnetz', hint: 'AC nach dem Wechselrichter' },
  { key: 'storageStartKwh', label: 'Speicher Anfang', hint: 'kWh am 1. des Monats' },
  { key: 'storageEndKwh', label: 'Speicher Ende', hint: 'kWh am letzten Tag' },
  {
    key: 'conversionLossKwh',
    label: 'Speicherverlust',
    hint: 'Produktion − Zufluss − (Ende − Anfang)',
  },
  { key: 'exportKwh', label: 'Einspeisung', hint: '' },
  { key: 'importKwh', label: 'Zukauf', hint: 'Netzbezug' },
  { key: 'selfUseKwh', label: 'Eigenverbrauch', hint: 'Zufluss − Einspeisung' },
  { key: 'totalUseKwh', label: 'Gesamtverbrauch', hint: 'Eigenverbrauch + Zukauf' },
] as const

export type ManualFieldKey = (typeof MANUAL_FIELDS)[number]['key']

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function parseDeNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '')
  if (!t) return null
  const normalized =
    t.includes(',') && t.includes('.')
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function formatDeInput(n: number | null): string {
  if (n === null) return ''
  return new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(n)
}

export function emptyManualMonth(year: number, month: number): ManualMonth {
  return {
    year,
    month,
    productionKwh: null,
    houseInflowKwh: null,
    storageStartKwh: null,
    storageEndKwh: null,
    conversionLossKwh: null,
    exportKwh: null,
    importKwh: null,
    selfUseKwh: null,
    totalUseKwh: null,
  }
}

export function hasAnyValue(row: ManualMonth): boolean {
  return MANUAL_FIELDS.some((f) => {
    const v = row[f.key]
    return v != null && Number.isFinite(v)
  })
}

export function findMonth(
  rows: ManualMonth[],
  year: number,
  month: number,
): ManualMonth | undefined {
  return rows.find((r) => r.year === year && r.month === month)
}

/** Fill blank derived cells only. Never overwrites a number the user already set. */
export function deriveBlankFields(row: ManualMonth): ManualMonth {
  const next = { ...row }
  if (
    next.conversionLossKwh == null &&
    next.productionKwh != null &&
    next.houseInflowKwh != null
  ) {
    const derived = storageLossFromBalance({
      productionKwh: next.productionKwh,
      outputKwh: next.houseInflowKwh,
      storageStartKwh: next.storageStartKwh,
      storageEndKwh: next.storageEndKwh,
    })
    if (derived.lossFault == null) next.conversionLossKwh = round1(derived.lossKwh)
  }
  if (next.selfUseKwh == null && next.houseInflowKwh != null && next.exportKwh != null) {
    next.selfUseKwh = round1(Math.max(0, next.houseInflowKwh - next.exportKwh))
  }
  if (next.totalUseKwh == null && next.selfUseKwh != null && next.importKwh != null) {
    next.totalUseKwh = round1(next.selfUseKwh + next.importKwh)
  }
  return next
}

export function sumManualField(rows: ManualMonth[], key: ManualFieldKey): number | null {
  let sum = 0
  let any = false
  for (const row of rows) {
    const v = row[key]
    if (v != null && Number.isFinite(v)) {
      sum += v
      any = true
    }
  }
  return any ? round1(sum) : null
}

export function sortManualMonths(rows: ManualMonth[]): ManualMonth[] {
  return [...rows].sort((a, b) => a.year - b.year || a.month - b.month)
}

export function groupByYear(rows: ManualMonth[]): { year: number; months: ManualMonth[] }[] {
  const map = new Map<number, ManualMonth[]>()
  for (const row of sortManualMonths(rows)) {
    const list = map.get(row.year) ?? []
    list.push(row)
    map.set(row.year, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({ year, months }))
}

const HA_EMPTY = 0.05

export function haTotalsEmpty(totals: EnergyTotals): boolean {
  return (
    totals.productionKwh < HA_EMPTY &&
    totals.homeKwh < HA_EMPTY &&
    totals.gridImportKwh < HA_EMPTY &&
    totals.gridExportKwh < HA_EMPTY
  )
}

function seriesPointEmpty(p: SeriesPoint): boolean {
  return p.pvKwh < HA_EMPTY && p.homeKwh < HA_EMPTY && p.gridImportKwh < HA_EMPTY && p.gridExportKwh < HA_EMPTY
}

export function totalsFromManualMonth(row: ManualMonth, tariff: Tariff): EnergyTotals {
  const productionKwh = row.productionKwh ?? 0
  const homeKwh = row.totalUseKwh ?? 0
  const gridImportKwh = row.importKwh ?? 0
  const gridExportKwh = row.exportKwh ?? 0
  const at = new Date(row.year, row.month - 1, 1)
  const outputKwh =
    row.houseInflowKwh ?? acOutputKwh(homeKwh, gridImportKwh, gridExportKwh)
  const totals = totalsFromFlows(
    {
      productionKwh,
      homeKwh,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      batteryEnergyFault: 'nicht erfasst',
      gridImportKwh,
      gridExportKwh,
      mppts: [],
      outputKwh,
      storageStartKwh: row.storageStartKwh,
      storageEndKwh: row.storageEndKwh,
    },
    tariff,
    at,
  )
  if (row.selfUseKwh != null) {
    totals.selfConsumedKwh = row.selfUseKwh
    totals.selfConsumptionPercent =
      productionKwh <= 0 ? 0 : Math.min(100, Math.max(0, (row.selfUseKwh / productionKwh) * 100))
    totals.autarkyPercent =
      homeKwh <= 0 ? 0 : Math.min(100, Math.max(0, (row.selfUseKwh / homeKwh) * 100))
  }
  if (row.storageStartKwh == null || row.storageEndKwh == null) {
    if (row.conversionLossKwh != null) {
      totals.lossKwh = row.conversionLossKwh
      totals.lossFault = null
    }
  }
  return totals
}

function seriesPointFromManual(year: number, month: number, row: ManualMonth): SeriesPoint {
  const homeKwh = row.totalUseKwh ?? 0
  const gridImportKwh = row.importKwh ?? 0
  return {
    t: new Date(year, month - 1, 1).toISOString(),
    pvKwh: row.productionKwh ?? 0,
    homeKwh,
    batteryChargeKwh: 0,
    batteryDischargeKwh: 0,
    gridImportKwh,
    gridExportKwh: row.exportKwh ?? 0,
    selfKwh: row.selfUseKwh ?? Math.max(0, homeKwh - gridImportKwh),
  }
}

function sumPoints(series: SeriesPoint[]): Omit<SeriesPoint, 't'> {
  return series.reduce(
    (acc, p) => ({
      pvKwh: acc.pvKwh + p.pvKwh,
      homeKwh: acc.homeKwh + p.homeKwh,
      batteryChargeKwh: acc.batteryChargeKwh + p.batteryChargeKwh,
      batteryDischargeKwh: acc.batteryDischargeKwh + p.batteryDischargeKwh,
      gridImportKwh: acc.gridImportKwh + p.gridImportKwh,
      gridExportKwh: acc.gridExportKwh + p.gridExportKwh,
    }),
    {
      pvKwh: 0,
      homeKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
    },
  )
}

/** Manual month wins in full. Tracker is only used when that month has no Nachtrag. */
export function mergeManualPeriod(
  stats: PeriodStats,
  rows: ManualMonth[],
  tariff: Tariff,
  viewDate: Date = new Date(stats.start),
): PeriodStats {
  if (stats.kind === 'day') return { ...stats, source: stats.source ?? 'ha' }

  if (stats.kind === 'month') {
    const row = findMonth(rows, viewDate.getFullYear(), viewDate.getMonth() + 1)
    if (row && hasAnyValue(row)) {
      return {
        ...stats,
        totals: totalsFromManualMonth(row, tariff),
        series: [],
        source: 'manual',
      }
    }
    return { ...stats, source: stats.source ?? 'ha' }
  }

  const year = viewDate.getFullYear()
  const byMonth = new Map<number, SeriesPoint>()
  for (const p of stats.series) {
    byMonth.set(new Date(p.t).getMonth() + 1, p)
  }

  let usedManual = false
  let usedHa = false
  const series: SeriesPoint[] = []
  for (let month = 1; month <= 12; month++) {
    const ha = byMonth.get(month)
    const manual = findMonth(rows, year, month)
    if (manual && hasAnyValue(manual)) {
      usedManual = true
      series.push(seriesPointFromManual(year, month, manual))
    } else if (ha && !seriesPointEmpty(ha)) {
      usedHa = true
      series.push(ha)
    } else if (ha) {
      series.push(ha)
    }
  }

  if (!usedManual) return { ...stats, source: stats.source ?? 'ha' }

  const summed = sumPoints(series)
  const totals = totalsFromFlows(
    {
      productionKwh: round1(summed.pvKwh),
      homeKwh: round1(summed.homeKwh),
      batteryChargeKwh: usedHa ? stats.totals.batteryChargeKwh : 0,
      batteryDischargeKwh: usedHa ? stats.totals.batteryDischargeKwh : 0,
      batteryEnergyFault: usedHa ? stats.totals.batteryEnergyFault : 'nicht erfasst',
      gridImportKwh: round1(summed.gridImportKwh),
      gridExportKwh: round1(summed.gridExportKwh),
      mppts: usedHa ? stats.totals.mppts : [],
    },
    tariff,
    new Date(year, 0, 1),
  )

  let lossSum = 0
  let anyLoss = false
  let firstStart: number | null = null
  let lastEnd: number | null = null
  for (let month = 1; month <= 12; month++) {
    const manual = findMonth(rows, year, month)
    if (!manual || !hasAnyValue(manual)) continue
    const monthTotals = totalsFromManualMonth(manual, tariff)
    if (monthTotals.lossFault == null) {
      lossSum += monthTotals.lossKwh
      anyLoss = true
    }
    if (firstStart == null && monthTotals.storageStartKwh != null) {
      firstStart = monthTotals.storageStartKwh
    }
    if (monthTotals.storageEndKwh != null) lastEnd = monthTotals.storageEndKwh
  }
  if (anyLoss) {
    totals.lossKwh = round1(lossSum)
    totals.lossFault = null
  }
  totals.storageStartKwh = firstStart
  totals.storageEndKwh = lastEnd

  return {
    ...stats,
    series,
    totals,
    source: usedHa ? 'mixed' : 'manual',
  }
}

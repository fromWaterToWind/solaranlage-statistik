import {
  emptyManualMonth,
  type ManualMonth,
  sortManualMonths,
} from '@/domain/manualMonth'

const STORAGE_KEY = 'solar-statistik-manual-months-v1'

/** Spreadsheet history. Januar sat between Dez 2025 and Feb 2026 → 2026-01. */
export const SEEDED_MANUAL_MONTHS: ManualMonth[] = [
  { ...emptyManualMonth(2025, 8), houseInflowKwh: 81.5 },
  { ...emptyManualMonth(2025, 9), houseInflowKwh: 97.3 },
  { ...emptyManualMonth(2025, 10), productionKwh: 56.7, houseInflowKwh: 40 },
  { ...emptyManualMonth(2025, 11), productionKwh: 36.4, houseInflowKwh: 22.7 },
  { ...emptyManualMonth(2025, 12), productionKwh: 27, houseInflowKwh: 14.9 },
  {
    ...emptyManualMonth(2026, 1),
    productionKwh: 31.7,
    houseInflowKwh: 17.2,
    conversionLossKwh: 14.5,
  },
  {
    ...emptyManualMonth(2026, 2),
    productionKwh: 89.2,
    houseInflowKwh: 34.9,
    conversionLossKwh: 54.3,
  },
  {
    ...emptyManualMonth(2026, 3),
    productionKwh: 160.3,
    houseInflowKwh: 111.5,
    conversionLossKwh: 48.8,
    exportKwh: 34.7,
    importKwh: 96.9,
    selfUseKwh: 76.8,
    totalUseKwh: 173.7,
  },
  {
    ...emptyManualMonth(2026, 4),
    productionKwh: 237.5,
    houseInflowKwh: 180.8,
    conversionLossKwh: 56.7,
    exportKwh: 69.5,
    importKwh: 96.2,
    selfUseKwh: 111.3,
    totalUseKwh: 207.5,
  },
  {
    ...emptyManualMonth(2026, 5),
    productionKwh: 236.4,
    houseInflowKwh: 182.5,
    conversionLossKwh: 53.9,
    exportKwh: 80,
    importKwh: 126.5,
    selfUseKwh: 102.5,
    totalUseKwh: 229,
  },
  {
    ...emptyManualMonth(2026, 6),
    productionKwh: 248,
    houseInflowKwh: 193.6,
    conversionLossKwh: 54.4,
    exportKwh: 104.4,
    importKwh: 89.3,
    selfUseKwh: 89.2,
    totalUseKwh: 178.5,
  },
  {
    ...emptyManualMonth(2026, 7),
    productionKwh: 232.5,
    houseInflowKwh: 178.2,
    conversionLossKwh: 54.3,
    exportKwh: 73.7,
    importKwh: 88.8,
    selfUseKwh: 104.5,
    totalUseKwh: 193.3,
  },
  {
    ...emptyManualMonth(2026, 8),
    productionKwh: 202.5,
    houseInflowKwh: 154.2,
    conversionLossKwh: 48.3,
    exportKwh: 42.3,
    importKwh: 104,
    selfUseKwh: 111.9,
    totalUseKwh: 215.9,
  },
]

function asNullable(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function parseRow(raw: unknown): ManualMonth | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const year = Number(o.year)
  const month = Number(o.month)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  return {
    year,
    month,
    productionKwh: asNullable(o.productionKwh),
    houseInflowKwh: asNullable(o.houseInflowKwh),
    storageStartKwh: asNullable(o.storageStartKwh),
    storageEndKwh: asNullable(o.storageEndKwh),
    conversionLossKwh: asNullable(o.conversionLossKwh),
    exportKwh: asNullable(o.exportKwh),
    importKwh: asNullable(o.importKwh),
    selfUseKwh: asNullable(o.selfUseKwh),
    totalUseKwh: asNullable(o.totalUseKwh),
  }
}

export function loadManualMonths(): ManualMonth[] {
  if (typeof localStorage === 'undefined') return sortManualMonths(SEEDED_MANUAL_MONTHS)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return sortManualMonths(SEEDED_MANUAL_MONTHS)
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return sortManualMonths(SEEDED_MANUAL_MONTHS)
    const rows = parsed.map(parseRow).filter((r): r is ManualMonth => r != null)
    return sortManualMonths(rows)
  } catch {
    return sortManualMonths(SEEDED_MANUAL_MONTHS)
  }
}

export function saveManualMonths(rows: ManualMonth[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortManualMonths(rows)))
}

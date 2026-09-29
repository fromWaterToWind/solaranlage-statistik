import { emptyManualDay, hasDayValue, sortManualDays, type ManualDay } from '@/domain/manualDay'

const STORAGE_KEY = 'solar-statistik-manual-days-v1'

/** Nexa pac-Integral 02.–10.09.2026, nur WR AC-Ausgabe. */
export const SEEDED_MANUAL_DAYS: ManualDay[] = [
  { ...emptyManualDay('2026-09-02'), houseInflowKwh: 4.32 },
  { ...emptyManualDay('2026-09-03'), houseInflowKwh: 2.99 },
  { ...emptyManualDay('2026-09-04'), houseInflowKwh: 1.34 },
  { ...emptyManualDay('2026-09-05'), houseInflowKwh: 4.73 },
  { ...emptyManualDay('2026-09-06'), houseInflowKwh: 5.18 },
  { ...emptyManualDay('2026-09-07'), houseInflowKwh: 5.58 },
  { ...emptyManualDay('2026-09-08'), houseInflowKwh: 4.52 },
  { ...emptyManualDay('2026-09-09'), houseInflowKwh: 3.6 },
  { ...emptyManualDay('2026-09-10'), houseInflowKwh: 5.12 },
]

function asNullable(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function parseRow(raw: unknown): ManualDay | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const date = typeof o.date === 'string' ? o.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return {
    ...emptyManualDay(date),
    productionKwh: asNullable(o.productionKwh),
    houseInflowKwh: asNullable(o.houseInflowKwh),
    homeKwh: asNullable(o.homeKwh),
    selfUseKwh: asNullable(o.selfUseKwh),
    importKwh: asNullable(o.importKwh),
    exportKwh: asNullable(o.exportKwh),
  }
}

function mergeDay(seed: ManualDay | undefined, stored: ManualDay | undefined): ManualDay | null {
  if (!seed && !stored) return null
  const date = stored?.date ?? seed?.date
  if (!date) return null
  return {
    ...emptyManualDay(date),
    productionKwh: stored?.productionKwh ?? seed?.productionKwh ?? null,
    houseInflowKwh: stored?.houseInflowKwh ?? seed?.houseInflowKwh ?? null,
    homeKwh: stored?.homeKwh ?? seed?.homeKwh ?? null,
    selfUseKwh: stored?.selfUseKwh ?? seed?.selfUseKwh ?? null,
    importKwh: stored?.importKwh ?? seed?.importKwh ?? null,
    exportKwh: stored?.exportKwh ?? seed?.exportKwh ?? null,
  }
}

export function mergeManualDayRows(stored: ManualDay[]): ManualDay[] {
  const dates = new Set([
    ...SEEDED_MANUAL_DAYS.map((d) => d.date),
    ...stored.map((d) => d.date),
  ])
  const seedBy = new Map(SEEDED_MANUAL_DAYS.map((d) => [d.date, d]))
  const storedBy = new Map(stored.map((d) => [d.date, d]))
  const out: ManualDay[] = []
  for (const date of dates) {
    const row = mergeDay(seedBy.get(date), storedBy.get(date))
    if (row && (hasDayValue(row) || storedBy.has(date))) out.push(row)
  }
  return sortManualDays(out)
}

export function loadManualDays(): ManualDay[] {
  if (typeof localStorage === 'undefined') return sortManualDays(SEEDED_MANUAL_DAYS)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return sortManualDays(SEEDED_MANUAL_DAYS)
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return sortManualDays(SEEDED_MANUAL_DAYS)
    const stored = parsed.map(parseRow).filter((r): r is ManualDay => r != null)
    return mergeManualDayRows(stored)
  } catch {
    return sortManualDays(SEEDED_MANUAL_DAYS)
  }
}

export function saveManualDays(rows: ManualDay[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortManualDays(rows)))
}

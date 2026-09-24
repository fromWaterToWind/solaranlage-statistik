import type { GrowattDayPoint } from './growatt'

const DB_NAME = 'solar-statistik'
const STORE = 'growatt-days'
const DB_VERSION = 1

export interface StoredGrowattDay {
  day: string
  sn: string
  points: GrowattDayPoint[]
  fetchedAt: string
}

const memory = new Map<string, StoredGrowattDay>()

function canUseIdb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'day' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB'))
  })
}

function idbOp<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = run(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB'))
      }),
  )
}

export async function getGrowattDay(day: string): Promise<StoredGrowattDay | null> {
  const mem = memory.get(day)
  if (mem) return mem
  if (!canUseIdb()) return null
  try {
    const row = await idbOp('readonly', (s) => s.get(day))
    if (row) memory.set(day, row as StoredGrowattDay)
    return (row as StoredGrowattDay | undefined) ?? null
  } catch {
    return null
  }
}

export async function putGrowattDay(row: StoredGrowattDay): Promise<void> {
  memory.set(row.day, row)
  if (!canUseIdb()) return
  try {
    await idbOp('readwrite', (s) => s.put(row))
  } catch {
    /* memory still holds it */
  }
}

export async function listGrowattDays(): Promise<string[]> {
  if (!canUseIdb()) return [...memory.keys()].sort()
  try {
    const keys = await idbOp('readonly', (s) => s.getAllKeys())
    return (keys as string[]).slice().sort()
  } catch {
    return [...memory.keys()].sort()
  }
}

export async function countGrowattDays(): Promise<number> {
  if (!canUseIdb()) return memory.size
  try {
    return await idbOp('readonly', (s) => s.count())
  } catch {
    return memory.size
  }
}

export function daysInRange(fromIso: string, toIso: string): string[] {
  const from = parseDay(fromIso)
  const to = parseDay(toIso)
  if (!from || !to || from.getTime() > to.getTime()) return []
  const out: string[] = []
  const cur = new Date(from)
  while (cur.getTime() <= to.getTime()) {
    out.push(formatDay(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function parseDay(iso: string): Date | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function formatDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function growattApiWindowStart(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setMonth(d.getMonth() - 3)
  return d
}

/** Open API queryHistoricalData: DATE_WITHIN_3_MONTHS. */
export function isOutsideGrowattWindow(day: Date, now = new Date()): boolean {
  return day.getTime() < growattApiWindowStart(now).getTime()
}

export function defaultSyncFrom(now = new Date()): string {
  return formatDay(growattApiWindowStart(now))
}

export function defaultSyncTo(now = new Date()): string {
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  y.setDate(y.getDate() - 1)
  return formatDay(y)
}

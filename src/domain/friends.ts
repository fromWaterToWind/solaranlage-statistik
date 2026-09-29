export interface FriendMonth {
  year: number
  month: number
  productionKwh: number
}

export interface FriendDay {
  date: string
  productionKwh: number
}

export interface FriendShare {
  id: string
  name: string
  months: FriendMonth[]
  days?: FriendDay[]
  updatedAt: string
}

const DAY_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SHARE_DAYS = 14

function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function seriesLooksDaily(series: { t: string }[]): boolean {
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

export function buildShareDays(input: {
  manualDays: { date: string; productionKwh: number | null }[]
  periodKind: 'day' | 'month' | 'year'
  periodSeries?: { t: string; pvKwh: number }[]
  todayProductionKwh?: number
}): FriendDay[] | undefined {
  const map = new Map<string, number>()

  for (const row of input.manualDays) {
    if (row.productionKwh != null && Number.isFinite(row.productionKwh) && row.productionKwh > 0) {
      map.set(row.date, row.productionKwh)
    }
  }

  const series = input.periodSeries ?? []
  if (series.length && (input.periodKind === 'month' || input.periodKind === 'year')) {
    if (input.periodKind === 'month' || seriesLooksDaily(series)) {
      for (const p of series.slice(-MAX_SHARE_DAYS)) {
        if (p.pvKwh > 0) {
          map.set(isoDateLocal(new Date(p.t)), p.pvKwh)
        }
      }
    }
  }

  if (input.periodKind === 'day') {
    const today = isoDateLocal(new Date())
    const kwh = input.todayProductionKwh
    if (kwh != null && Number.isFinite(kwh) && kwh > 0) {
      map.set(today, kwh)
    }
  }

  if (map.size === 0) return undefined
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-MAX_SHARE_DAYS)
    .map(([date, productionKwh]) => ({ date, productionKwh }))
}

function parseDays(raw: unknown): FriendDay[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const days = raw
    .filter(
      (d): d is FriendDay =>
        !!d &&
        typeof d === 'object' &&
        typeof (d as FriendDay).date === 'string' &&
        DAY_DATE.test((d as FriendDay).date) &&
        typeof (d as FriendDay).productionKwh === 'number',
    )
    .slice(0, MAX_SHARE_DAYS)
  return days.length ? days : undefined
}

export function encodeShare(share: Omit<FriendShare, 'id'>): string {
  const days = share.days?.length ? share.days.slice(0, MAX_SHARE_DAYS) : undefined
  const json = JSON.stringify(
    days?.length
      ? {
          v: 2,
          name: share.name,
          months: share.months,
          days,
          updatedAt: share.updatedAt,
        }
      : {
          v: 1,
          name: share.name,
          months: share.months,
          updatedAt: share.updatedAt,
        },
  )
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `SOLAR1.${b64}`
}

export function decodeShare(raw: string): Omit<FriendShare, 'id'> | null {
  const t = raw.trim()
  const body = t.startsWith('SOLAR1.') ? t.slice(7) : t
  try {
    const pad = body + '==='.slice((body.length + 3) % 4)
    const json = decodeURIComponent(escape(atob(pad.replace(/-/g, '+').replace(/_/g, '/'))))
    const o = JSON.parse(json) as {
      v?: number
      name?: string
      months?: FriendMonth[]
      days?: unknown
      updatedAt?: string
    }
    if (!o.name || !Array.isArray(o.months)) return null
    const months = o.months.filter(
      (m) =>
        Number.isInteger(m.year) &&
        Number.isInteger(m.month) &&
        typeof m.productionKwh === 'number',
    )
    const days = o.v === 2 || o.days != null ? parseDays(o.days) : undefined
    return {
      name: o.name.trim(),
      months,
      days,
      updatedAt: o.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function mergeFriendShare(
  friends: FriendShare[],
  incoming: Omit<FriendShare, 'id'>,
): FriendShare[] {
  const idx = friends.findIndex((f) => f.name === incoming.name)
  if (idx === -1) {
    return [{ id: `f-${Date.now().toString(36)}`, ...incoming }, ...friends]
  }
  const existing = friends[idx]
  const incomingTs = Date.parse(incoming.updatedAt)
  const existingTs = Date.parse(existing.updatedAt)
  const replace =
    !Number.isNaN(incomingTs) && (Number.isNaN(existingTs) || incomingTs > existingTs)
  const next: FriendShare = replace
    ? {
        ...existing,
        months: incoming.months,
        days: incoming.days,
        updatedAt: incoming.updatedAt,
      }
    : existing
  return [next, ...friends.filter((_, i) => i !== idx)]
}

export function thisMonthKwh(share: FriendShare, now = new Date()): number {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  return share.months.find((row) => row.year === y && row.month === m)?.productionKwh ?? 0
}

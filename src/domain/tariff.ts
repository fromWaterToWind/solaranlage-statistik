import type { Euros, SeriesPoint, Tariff, TariffPeriod, TariffWindow } from './types'

const MINUTES_PER_DAY = 24 * 60

export function eurosToCt(eur: number): number {
  return Math.round(eur * 10000) / 100
}

export function ctToEuros(ct: number): Euros {
  return ct / 100
}

export function windowBuyCt(window: TariffWindow, fallbackCt: number): number {
  if (typeof window.buyCtPerKwh === 'number' && Number.isFinite(window.buyCtPerKwh)) {
    return window.buyCtPerKwh
  }
  if (typeof window.buyEurPerKwh === 'number' && Number.isFinite(window.buyEurPerKwh)) {
    return eurosToCt(window.buyEurPerKwh)
  }
  return fallbackCt
}

function dayStamp(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return 0
  return new Date(y, m - 1, d).getTime()
}

export function periodCovers(period: TariffPeriod, date: Date): boolean {
  const t = dayStamp(date)
  if (t < parseDay(period.validFrom)) return false
  if (period.validTo && t > parseDay(period.validTo)) return false
  return true
}

export function resolvePeriods(tariff: Tariff): TariffPeriod[] {
  if (tariff.periods?.length) return tariff.periods
  const buyCt = eurosToCt(tariff.buyEurPerKwh ?? 0.32)
  const sellCt = eurosToCt(tariff.sellEurPerKwh ?? 0.08)
  const windows = (tariff.windows ?? []).map((w) => ({
    from: w.from,
    to: w.to,
    buyCtPerKwh: windowBuyCt(w, buyCt),
  }))
  return [
    {
      id: 'legacy',
      validFrom: '2000-01-01',
      validTo: null,
      buyCtPerKwh: buyCt,
      sellCtPerKwh: sellCt,
      windows: windows.length ? windows : undefined,
    },
  ]
}

export function periodAt(date: Date, tariff: Tariff): TariffPeriod {
  const periods = resolvePeriods(tariff)
  const hits = periods.filter((p) => periodCovers(p, date))
  hits.sort((a, b) => parseDay(b.validFrom) - parseDay(a.validFrom))
  return (
    hits[0] ??
    periods[periods.length - 1] ?? {
      id: 'fallback',
      validFrom: '2000-01-01',
      validTo: null,
      buyCtPerKwh: 32,
      sellCtPerKwh: 8,
    }
  )
}

export function minutesFromMidnight(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw ?? 0)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return ((Math.trunc(h) * 60 + Math.trunc(m)) % MINUTES_PER_DAY + MINUTES_PER_DAY) %
    MINUTES_PER_DAY
}

export function windowContains(mins: number, window: TariffWindow): boolean {
  const from = minutesFromMidnight(window.from)
  const to = minutesFromMidnight(window.to)
  if (from === to) return false
  if (from < to) return mins >= from && mins < to
  return mins >= from || mins < to
}

export function buyPriceAt(date: Date, tariff: Tariff): Euros {
  const period = periodAt(date, tariff)
  const windows = period.windows ?? []
  if (windows.length === 0) return ctToEuros(period.buyCtPerKwh)
  const mins = date.getHours() * 60 + date.getMinutes()
  for (const w of windows) {
    if (windowContains(mins, w)) return ctToEuros(windowBuyCt(w, period.buyCtPerKwh))
  }
  return ctToEuros(period.buyCtPerKwh)
}

export function sellPriceAt(date: Date, tariff: Tariff): Euros {
  return ctToEuros(periodAt(date, tariff).sellCtPerKwh)
}

/** Time-weighted average buy price over 24h for the contract covering `at`. */
export function weightedBuyPrice(tariff: Tariff, at: Date = new Date()): Euros {
  const period = periodAt(at, tariff)
  const windows = period.windows ?? []
  if (windows.length === 0) return ctToEuros(period.buyCtPerKwh)

  const used = new Array<boolean>(MINUTES_PER_DAY).fill(false)
  let priced = 0
  let minutes = 0

  for (const w of windows) {
    const price = ctToEuros(windowBuyCt(w, period.buyCtPerKwh))
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      if (used[m] || !windowContains(m, w)) continue
      used[m] = true
      priced += price
      minutes += 1
    }
  }

  const leftover = MINUTES_PER_DAY - minutes
  if (leftover > 0) {
    priced += leftover * ctToEuros(period.buyCtPerKwh)
    minutes += leftover
  }
  return minutes === 0 ? ctToEuros(period.buyCtPerKwh) : priced / minutes
}

export function savingsFromSeries(series: SeriesPoint[], tariff: Tariff): Euros {
  return series.reduce((sum, p) => {
    const at = new Date(p.t)
    const buy = buyPriceAt(at, tariff)
    const sell = sellPriceAt(at, tariff)
    const avoided = Math.max(0, p.homeKwh - p.gridImportKwh)
    return sum + avoided * buy + p.gridExportKwh * sell
  }, 0)
}

export function newTariffPeriod(from: TariffPeriod | undefined, validFrom: string): TariffPeriod {
  return {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    validFrom,
    validTo: null,
    buyCtPerKwh: from?.buyCtPerKwh ?? 32,
    sellCtPerKwh: from?.sellCtPerKwh ?? 8,
    windows: from?.windows?.map((w) => ({
      from: w.from,
      to: w.to,
      buyCtPerKwh: windowBuyCt(w, from.buyCtPerKwh),
    })),
  }
}

export function formatCtInput(ct: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ct)
}

/** ISO `YYYY-MM-DD` → `TT.MM.JJJJ`. Empty in, empty out. */
export function formatDeDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${m[3]}.${m[2]}.${m[1]}`
}

/** `TT.MM.JJJJ`, `T.M.JJ`, or ISO → ISO `YYYY-MM-DD`. Blank → null. */
export function parseDeDate(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return isRealIsoDate(t) ? t : null
  }
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (!m) return null
  let year = Number(m[3])
  if (year < 100) year += 2000
  const month = Number(m[2])
  const day = Number(m[1])
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isRealIsoDate(iso) ? iso : null
}

function isRealIsoDate(iso: string): boolean {
  const [y, mo, d] = iso.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

import type { Euros, SeriesPoint, Tariff, TariffWindow } from './types'

const MINUTES_PER_DAY = 24 * 60

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
  const windows = tariff.windows ?? []
  if (windows.length === 0) return tariff.buyEurPerKwh
  const mins = date.getHours() * 60 + date.getMinutes()
  for (const w of windows) {
    if (windowContains(mins, w)) return w.buyEurPerKwh
  }
  return tariff.buyEurPerKwh
}

/** Time-weighted average buy price over 24h (for daily/monthly totals). */
export function weightedBuyPrice(tariff: Tariff): Euros {
  const windows = tariff.windows ?? []
  if (windows.length === 0) return tariff.buyEurPerKwh

  const used = new Array<boolean>(MINUTES_PER_DAY).fill(false)
  let priced = 0
  let minutes = 0

  for (const w of windows) {
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      if (used[m] || !windowContains(m, w)) continue
      used[m] = true
      priced += w.buyEurPerKwh
      minutes += 1
    }
  }

  const leftover = MINUTES_PER_DAY - minutes
  if (leftover > 0) {
    priced += leftover * tariff.buyEurPerKwh
    minutes += leftover
  }
  return minutes === 0 ? tariff.buyEurPerKwh : priced / minutes
}

export function savingsFromSeries(series: SeriesPoint[], tariff: Tariff): Euros {
  return series.reduce((sum, p) => {
    const buy = buyPriceAt(new Date(p.t), tariff)
    const avoided = Math.max(0, p.homeKwh - p.gridImportKwh)
    return sum + avoided * buy + p.gridExportKwh * tariff.sellEurPerKwh
  }, 0)
}

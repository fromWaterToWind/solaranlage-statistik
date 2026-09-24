import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppConfig } from '@/config/appConfig'
import { applyGrowattDay, fetchGrowattDay, isBeforeNexa } from '@/data/growatt'
import { formatDay, getGrowattDay } from '@/data/growattStore'
import { createEnergySource } from '@/data/source'
import { mergeManualPeriod, type ManualMonth } from '@/domain/manualMonth'
import {
  buildProductionCompare,
  stubPeriodStats,
  type ProductionCompare,
} from '@/domain/productionCompare'
import type { LiveSnapshot, PeriodKind, PeriodStats } from '@/domain/types'

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function shiftPeriod(kind: PeriodKind, date: Date, delta: number): Date {
  const next = new Date(date)
  if (kind === 'day') {
    next.setDate(next.getDate() + delta)
  } else if (kind === 'month') {
    next.setMonth(next.getMonth() + delta)
  } else {
    next.setFullYear(next.getFullYear() + delta)
  }
  return next
}

/** True if navigating forward would land in a future period. */
export function isNextDisabled(kind: PeriodKind, date: Date, now = new Date()): boolean {
  const next = shiftPeriod(kind, date, 1)
  if (kind === 'day') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate())
    return nextDay.getTime() > today.getTime()
  }
  if (kind === 'month') {
    const cur = now.getFullYear() * 12 + now.getMonth()
    const nxt = next.getFullYear() * 12 + next.getMonth()
    return nxt > cur
  }
  return next.getFullYear() > now.getFullYear()
}

export function formatPeriodLabel(kind: PeriodKind, date: Date, now = new Date()): string {
  if (kind === 'day') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    if (day.getTime() === today.getTime()) return 'Heute'
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(day)
  }
  if (kind === 'month') {
    return new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric',
    }).format(date)
  }
  return String(date.getFullYear())
}

export interface EnergyState {
  live: LiveSnapshot | null
  period: PeriodStats | null
  kind: PeriodKind
  date: Date
  loadingPeriod: boolean
  error: string | null
  setKind: (kind: PeriodKind) => void
  goPrev: () => void
  goNext: () => void
  nextDisabled: boolean
  periodLabel: string
  growattBusy: boolean
  loadGrowatt: () => void
  production: ProductionCompare | null
  loadingProduction: boolean
}

export function useEnergy(config: AppConfig, manualMonths: ManualMonth[] = []): EnergyState {
  const source = useMemo(() => createEnergySource(config), [config])
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [haPeriod, setHaPeriod] = useState<PeriodStats | null>(null)
  const [kind, setKindState] = useState<PeriodKind>('day')
  const [date, setDate] = useState<Date>(startOfToday)
  const [loadingPeriod, setLoadingPeriod] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [growattBusy, setGrowattBusy] = useState(false)
  const [production, setProduction] = useState<ProductionCompare | null>(null)
  const [loadingProduction, setLoadingProduction] = useState(true)

  useEffect(() => {
    return source.subscribeLive(setLive)
  }, [source])

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15)
    setLoadingProduction(true)
    void Promise.allSettled([
      source.getPeriod('day', now),
      source.getPeriod('month', now, { includePower: false }),
      source.getPeriod('month', lastMonth, { includePower: false }),
    ]).then(([todayRes, thisMonthRes, prevMonthRes]) => {
      if (cancelled) return
      if (todayRes.status !== 'fulfilled') {
        setProduction(null)
        setLoadingProduction(false)
        return
      }
      const todayMerged = mergeManualPeriod(todayRes.value, manualMonths, config.tariff, now)
      const thisMonth =
        thisMonthRes.status === 'fulfilled'
          ? thisMonthRes.value
          : stubPeriodStats('month', now)
      const prevMonth =
        prevMonthRes.status === 'fulfilled'
          ? prevMonthRes.value
          : stubPeriodStats('month', lastMonth)
      setProduction(buildProductionCompare(todayMerged, thisMonth, prevMonth, now))
      setLoadingProduction(false)
    })
    return () => {
      cancelled = true
    }
  }, [source, manualMonths, config.tariff])

  useEffect(() => {
    let cancelled = false
    setLoadingPeriod(true)
    setError(null)
    void source
      .getPeriod(kind, date)
      .then(async (stats) => {
        if (cancelled) return
        if (kind === 'day') {
          const stored = await getGrowattDay(formatDay(date))
          if (stored?.points.length) {
            stats = {
              ...stats,
              powerSeries: applyGrowattDay(stats.powerSeries, stored.points, date),
              growattNote: stats.growattNote ?? `Lokal · ${stored.points.length} Growatt-Punkte`,
            }
          }
        }
        if (!cancelled) {
          setHaPeriod(stats)
          setLoadingPeriod(false)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Daten konnten nicht geladen werden.')
          setLoadingPeriod(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [kind, date, source])

  const period = useMemo(
    () => (haPeriod ? mergeManualPeriod(haPeriod, manualMonths, config.tariff, date) : null),
    [haPeriod, manualMonths, config.tariff, date],
  )

  const setKind = useCallback((next: PeriodKind) => {
    setKindState(next)
    setDate(startOfToday())
  }, [])

  const goPrev = useCallback(() => {
    setDate((d) => shiftPeriod(kind, d, -1))
  }, [kind])

  const goNext = useCallback(() => {
    setDate((d) => {
      if (isNextDisabled(kind, d)) return d
      return shiftPeriod(kind, d, 1)
    })
  }, [kind])

  const loadGrowatt = useCallback(() => {
    if (kind !== 'day' || growattBusy) return
    const growatt = config.growatt
    if (!growatt?.token?.trim()) {
      setHaPeriod((prev) => (prev ? { ...prev, growattNote: 'Growatt: kein Token' } : prev))
      return
    }
    if (isBeforeNexa(growatt, date) && !growatt.extraDeviceSn?.trim()) {
      setHaPeriod((prev) =>
        prev
          ? {
              ...prev,
              growattNote: 'Tage vor 02.09.2026: Noah-SN unter Einstellungen eintragen.',
            }
          : prev,
      )
      return
    }
    setGrowattBusy(true)
    void fetchGrowattDay(growatt, date)
      .then((g) => {
        setHaPeriod((prev) => {
          if (!prev) return prev
          if (!g.length) return { ...prev, growattNote: 'Growatt: keine Kurve für diesen Tag' }
          return {
            ...prev,
            powerSeries: applyGrowattDay(prev.powerSeries, g, date),
            growattNote: `Growatt · ${g.length} Messpunkte`,
          }
        })
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Growatt nicht erreichbar'
        setHaPeriod((prev) => (prev ? { ...prev, growattNote: msg } : prev))
      })
      .finally(() => setGrowattBusy(false))
  }, [kind, date, config.growatt, growattBusy])

  return {
    live,
    period,
    kind,
    date,
    loadingPeriod,
    error,
    setKind,
    goPrev,
    goNext,
    nextDisabled: isNextDisabled(kind, date),
    periodLabel: formatPeriodLabel(kind, date),
    growattBusy,
    loadGrowatt,
    production,
    loadingProduction,
  }
}

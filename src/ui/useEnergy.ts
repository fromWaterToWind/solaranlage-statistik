import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppConfig } from '@/config/appConfig'
import { createEnergySource } from '@/data/source'
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
}

export function useEnergy(config: AppConfig): EnergyState {
  const source = useMemo(() => createEnergySource(config), [config])
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [period, setPeriod] = useState<PeriodStats | null>(null)
  const [kind, setKindState] = useState<PeriodKind>('day')
  const [date, setDate] = useState<Date>(startOfToday)
  const [loadingPeriod, setLoadingPeriod] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return source.subscribeLive(setLive)
  }, [source])

  useEffect(() => {
    let cancelled = false
    setLoadingPeriod(true)
    setError(null)
    void source
      .getPeriod(kind, date)
      .then((stats) => {
        if (!cancelled) {
          setPeriod(stats)
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
  }
}

import type { GrowattConfig } from '@/config/appConfig'
import { fetchGrowattDay, growattCooldownMs, growattSnForDate, isBeforeNexa } from './growatt'
import {
  countGrowattDays,
  daysInRange,
  defaultSyncFrom,
  defaultSyncTo,
  getGrowattDay,
  isOutsideGrowattWindow,
  parseDay,
  putGrowattDay,
} from './growattStore'

export interface GrowattSyncState {
  running: boolean
  from: string
  to: string
  total: number
  done: number
  fetched: number
  skipped: number
  empty: number
  failed: number
  current: string | null
  waitSec: number
  lastError: string | null
  stored: number
}

const PROGRESS_KEY = 'solar-statistik-growatt-sync-v1'

const idle = (): GrowattSyncState => ({
  running: false,
  from: defaultSyncFrom(),
  to: defaultSyncTo(),
  total: 0,
  done: 0,
  fetched: 0,
  skipped: 0,
  empty: 0,
  failed: 0,
  current: null,
  waitSec: 0,
  lastError: null,
  stored: 0,
})

let state: GrowattSyncState = loadPersisted()
let stopWanted = false
let loop: Promise<void> | null = null
const listeners = new Set<() => void>()

function loadPersisted(): GrowattSyncState {
  const base = idle()
  if (typeof localStorage === 'undefined') return base
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return base
    const o = JSON.parse(raw) as Partial<GrowattSyncState>
    return {
      ...base,
      from: typeof o.from === 'string' ? o.from : base.from,
      to: typeof o.to === 'string' ? o.to : base.to,
      total: Number(o.total) || 0,
      done: Number(o.done) || 0,
      fetched: Number(o.fetched) || 0,
      skipped: Number(o.skipped) || 0,
      empty: Number(o.empty) || 0,
      failed: Number(o.failed) || 0,
      lastError: typeof o.lastError === 'string' ? o.lastError : null,
      stored: Number(o.stored) || 0,
      running: false,
    }
  } catch {
    return base
  }
}

function persist() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        from: state.from,
        to: state.to,
        total: state.total,
        done: state.done,
        fetched: state.fetched,
        skipped: state.skipped,
        empty: state.empty,
        failed: state.failed,
        lastError: state.lastError,
        stored: state.stored,
      }),
    )
  } catch {
    /* ignore */
  }
}

function emit() {
  persist()
  for (const cb of listeners) cb()
}

function patch(p: Partial<GrowattSyncState>) {
  state = { ...state, ...p }
  emit()
}

export function getGrowattSync(): GrowattSyncState {
  return state
}

export function subscribeGrowattSync(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitSlot() {
  while (!stopWanted) {
    const left = growattCooldownMs()
    if (left <= 0) {
      if (state.waitSec !== 0) patch({ waitSec: 0 })
      return
    }
    const sec = Math.ceil(left / 1000)
    if (sec !== state.waitSec) patch({ waitSec: sec })
    await sleep(Math.min(500, left))
  }
}

async function runLoop(config: GrowattConfig) {
  const days = daysInRange(state.from, state.to)
  patch({ total: days.length, stored: await countGrowattDays() })
  for (let i = state.done; i < days.length; i++) {
    if (stopWanted) break
    const day = days[i]
    patch({ current: day, waitSec: 0 })
    const have = await getGrowattDay(day)
    if (have) {
      patch({ done: i + 1, skipped: state.skipped + 1, stored: await countGrowattDays() })
      continue
    }
    const when = parseDay(day)
    if (!when) {
      patch({ done: i + 1, failed: state.failed + 1 })
      continue
    }
    if (isOutsideGrowattWindow(when)) {
      patch({
        done: i + 1,
        skipped: state.skipped + 1,
        lastError: 'Growatt liefert Tageskurven nur 3 Monate zurück. Ältere Tage ohne Anfrage übersprungen.',
      })
      continue
    }
    if (isBeforeNexa(config, when) && !config.extraDeviceSn?.trim()) {
      patch({
        done: i + 1,
        failed: state.failed + 1,
        lastError: 'Noah-SN fehlt für Tage vor der Nexa',
      })
      continue
    }
    await waitSlot()
    if (stopWanted) break
    try {
      const points = await fetchGrowattDay(config, when)
      if (!points.length) {
        await putGrowattDay({
          day,
          sn: growattSnForDate(config, when),
          points: [],
          fetchedAt: new Date().toISOString(),
        })
        patch({
          done: i + 1,
          empty: state.empty + 1,
          stored: await countGrowattDays(),
        })
      } else {
        patch({
          done: i + 1,
          fetched: state.fetched + 1,
          lastError: null,
          stored: await countGrowattDays(),
        })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Growatt-Fehler'
      if (/nächste Anfrage|rate limit|frequently/i.test(msg)) {
        await sleep(65_000)
        i -= 1
        continue
      }
      if (/DATE_WITHIN_3_MONTHS|code=20/i.test(msg)) {
        patch({
          done: i + 1,
          skipped: state.skipped + 1,
          lastError: 'Growatt liefert Tageskurven nur 3 Monate zurück. Ältere Tage ohne Anfrage übersprungen.',
        })
        continue
      }
      patch({
        done: i + 1,
        failed: state.failed + 1,
        lastError: `${day}: ${msg}`,
        stored: await countGrowattDays(),
      })
    }
  }
  patch({
    running: false,
    current: null,
    waitSec: 0,
    stored: await countGrowattDays(),
  })
}

export function startGrowattSync(config: GrowattConfig, from: string, to: string) {
  if (state.running || loop) return
  stopWanted = false
  const prev = state
  const resume = prev.from === from && prev.to === to && prev.done > 0 && prev.done < prev.total
  state = {
    ...idle(),
    running: true,
    from,
    to,
    total: daysInRange(from, to).length,
    done: resume ? prev.done : 0,
    fetched: resume ? prev.fetched : 0,
    skipped: resume ? prev.skipped : 0,
    empty: resume ? prev.empty : 0,
    failed: resume ? prev.failed : 0,
    stored: prev.stored,
    lastError: null,
  }
  emit()
  loop = runLoop(config).finally(() => {
    loop = null
  })
}

export function pauseGrowattSync() {
  stopWanted = true
  if (!state.running) return
  patch({ running: false, waitSec: 0, current: null })
}

void countGrowattDays().then((n) => {
  if (n !== state.stored) patch({ stored: n })
})

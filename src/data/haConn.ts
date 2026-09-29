import { indexStates, type HaState } from './haParse'

export type HaPeriod = '5minute' | 'hour' | 'day' | 'month'

export interface HaStatRow {
  start: string | number
  end?: string | number
  change?: number | null
  state?: number | null
  mean?: number | null
  max?: number | null
  min?: number | null
  sum?: number | null
}

export const FAST_LIVE_MS = 1_000
export const SLOW_LIVE_MS = 30_000

export type HaStatistics = Record<string, HaStatRow[]>

interface HassLike {
  states: Record<string, HaState>
  callWS: <T>(msg: Record<string, unknown>) => Promise<T>
  connection?: {
    subscribeEvents: (
      callback: (event: unknown) => void,
      eventType?: string,
    ) => Promise<() => void>
  }
}

export interface HaClient {
  getStates(): Promise<Record<string, HaState>>
  subscribe(onChange: () => void): () => void
  statistics(
    ids: string[],
    start: Date,
    end: Date,
    period: HaPeriod,
    types?: string[],
  ): Promise<HaStatistics>
}

function tryGetHass(): HassLike | null {
  if (typeof window === 'undefined') return null
  let current: Window | null = window
  for (let i = 0; i < 5 && current; i++) {
    try {
      const el = current.document.querySelector('home-assistant') as {
        hass?: HassLike
      } | null
      if (el?.hass?.states && typeof el.hass.callWS === 'function') {
        return el.hass
      }
    } catch {
      // Cross-origin frame.
    }
    try {
      const parentWin: Window | null =
        current.parent !== current ? current.parent : null
      current = parentWin
    } catch {
      current = null
    }
  }
  return null
}

function toWsUrl(httpUrl: string): string {
  const u = new URL(httpUrl)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/api/websocket'
  u.search = ''
  u.hash = ''
  return u.toString()
}

class HassParentClient implements HaClient {
  private cached: Record<string, HaState> = {}
  private readonly watch: Set<string>
  private readonly fast: Set<string>

  constructor(
    private readonly hass: HassLike,
    watchedIds: string[] = [],
    fastIds: string[] = [],
  ) {
    this.watch = new Set(watchedIds.filter(Boolean))
    this.fast = new Set(fastIds.filter(Boolean))
  }

  async getStates(): Promise<Record<string, HaState>> {
    const picked = pickWatched(this.hass.states, this.watch)
    if (Object.keys(picked).length > 0) {
      this.cached = { ...this.cached, ...picked }
      return this.cached
    }
    if (Object.keys(this.cached).length > 0) return this.cached
    const fromHass = indexStates(this.hass.states)
    if (Object.keys(fromHass).length > 0) {
      this.cached = this.watch.size ? pickWatched(fromHass, this.watch) : fromHass
      return this.cached
    }
    return this.cached
  }

  subscribe(onChange: () => void): () => void {
    let unsub: (() => void) | undefined
    let fastTimer: number | undefined
    const notifyFast = () => {
      if (fastTimer != null) return
      fastTimer = window.setTimeout(() => {
        fastTimer = undefined
        onChange()
      }, FAST_LIVE_MS)
    }
    void this.getStates().then(() => onChange())
    const conn = this.hass.connection
    if (conn?.subscribeEvents) {
      void conn
        .subscribeEvents((event: unknown) => {
          const ns = (event as { data?: { new_state?: HaState } })?.data?.new_state
          if (!ns?.entity_id) return
          if (this.watch.size && !this.watch.has(ns.entity_id)) return
          this.cached[ns.entity_id] = ns
          if (this.fast.has(ns.entity_id)) notifyFast()
        }, 'state_changed')
        .then((fn) => {
          unsub = fn
        })
        .catch(() => {
          /* slow poll below still refreshes solar */
        })
    }
    const slowPoll = window.setInterval(() => {
      void this.getStates().then(() => onChange())
    }, SLOW_LIVE_MS)
    return () => {
      if (fastTimer != null) window.clearTimeout(fastTimer)
      window.clearInterval(slowPoll)
      unsub?.()
    }
  }

  statistics(
    ids: string[],
    start: Date,
    end: Date,
    period: HaPeriod,
    types: string[] = ['change', 'state', 'mean', 'max'],
  ): Promise<HaStatistics> {
    return this.hass.callWS<HaStatistics>({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types,
      units: { energy: 'kWh', power: 'W' },
    })
  }
}

class TokenWsClient implements HaClient {
  private ws: WebSocket | null = null
  private id = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private states: Record<string, HaState> = {}
  private listeners = new Set<() => void>()
  private ready: Promise<void>
  private readonly watch: Set<string>
  private readonly fast: Set<string>
  private readonly slow: string[]
  private emitTimer: ReturnType<typeof setTimeout> | undefined
  private slowTimer: ReturnType<typeof setInterval> | undefined
  private primed = false
  private slowSubscribed = false

  constructor(
    private readonly url: string,
    private readonly token: string,
    watchedIds: string[] = [],
    fastIds: string[] = [],
  ) {
    this.watch = new Set(watchedIds.filter(Boolean))
    this.fast = new Set(fastIds.filter(Boolean))
    this.slow = [...this.watch].filter((id) => !this.fast.has(id))
    this.ready = this.connect()
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(toWsUrl(this.url))
      this.ws = ws

      const fail = (msg: string) => {
        reject(new Error(msg))
        this.flush(new Error(msg))
      }

      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(String(ev.data)) as {
          type: string
          id?: number
          success?: boolean
          result?: unknown
          error?: { message?: string }
          event?: unknown
        }

        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: this.token }))
          return
        }
        if (msg.type === 'auth_ok') {
          resolve()
          const fastIds = [...this.fast]
          if (fastIds.length) {
            void this.send('subscribe_entities', { entity_ids: fastIds }).catch(() => {})
          }
          void this.refreshSlow()
          this.slowTimer = setInterval(() => {
            void this.refreshSlow()
          }, SLOW_LIVE_MS)
          return
        }
        if (msg.type === 'auth_invalid') {
          fail('Home Assistant: Token ungültig.')
          return
        }
        if (msg.type === 'event') {
          const ids = entityIdsInEvent(msg.event)
          this.states = applyEntityUpdates(this.states, msg.event, this.watch)
          if (!this.primed || isEntitySnapshot(msg.event)) {
            this.primed = true
            this.emitNow()
            return
          }
          if (ids.some((id) => this.fast.has(id))) this.emitFast()
          return
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.success === false) {
            p.reject(new Error(msg.error?.message ?? 'Home Assistant Anfrage fehlgeschlagen.'))
          } else {
            p.resolve(msg.result)
          }
        }
      })

      ws.addEventListener('error', () => fail('Keine Verbindung zu Home Assistant.'))
      ws.addEventListener('close', () => this.flush(new Error('WebSocket geschlossen.')))
    })
  }

  private flush(err: Error) {
    if (this.slowTimer != null) clearInterval(this.slowTimer)
    if (this.emitTimer != null) clearTimeout(this.emitTimer)
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private emitNow() {
    for (const l of this.listeners) l()
  }

  private emitFast() {
    if (this.emitTimer != null) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.emitNow()
    }, FAST_LIVE_MS)
  }

  private async refreshSlow() {
    if (!this.slow.length) {
      this.emitNow()
      return
    }
    try {
      const got = await fetchEntityStates(this.url, this.token, this.slow)
      if (Object.keys(got).length > 0) {
        this.states = { ...this.states, ...got }
        this.primed = true
        this.emitNow()
        return
      }
    } catch {
      /* CORS — fall back to a slow entity subscription */
    }
    if (!this.slowSubscribed) {
      this.slowSubscribed = true
      void this.send('subscribe_entities', { entity_ids: this.slow }).catch(() => {})
    } else {
      this.emitNow()
    }
  }

  private async send(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    await this.ready
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Keine Verbindung zu Home Assistant.')
    }
    const id = this.id++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, type, ...extra }))
    })
  }

  async getStates(): Promise<Record<string, HaState>> {
    await this.ready
    return this.states
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange)
    void this.ready.then(onChange).catch(() => onChange())
    return () => {
      this.listeners.delete(onChange)
    }
  }

  async statistics(
    ids: string[],
    start: Date,
    end: Date,
    period: HaPeriod,
    types: string[] = ['change', 'state', 'mean', 'max'],
  ): Promise<HaStatistics> {
    const result = await this.send('recorder/statistics_during_period', {
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types,
      units: { energy: 'kWh', power: 'W' },
    })
    return (result as HaStatistics) ?? {}
  }
}

export function createHaClient(
  haUrl: string,
  haToken: string,
  watchedIds: string[] = [],
  fastIds: string[] = [],
): HaClient {
  const hass = tryGetHass()
  if (hass) return new HassParentClient(hass, watchedIds, fastIds)

  const url = haUrl.trim() || (import.meta.env.VITE_HA_URL ?? '')
  const token = haToken.trim() || (import.meta.env.VITE_HA_TOKEN ?? '')
  if (!url || !token) {
    throw new Error(
      'Home Assistant: In der Companion-App als Sidebar öffnen, oder URL und Token in den Einstellungen eintragen.',
    )
  }
  return new TokenWsClient(url, token, watchedIds, fastIds)
}

export function canUseParentHass(): boolean {
  return tryGetHass() !== null
}

export function entityIdsInEvent(event: unknown): string[] {
  if (!event || typeof event !== 'object') return []
  const ev = event as {
    data?: { new_state?: { entity_id?: string } }
    a?: Record<string, unknown>
    c?: Record<string, unknown>
    r?: string[]
  }
  const ids: string[] = []
  if (ev.data?.new_state?.entity_id) ids.push(ev.data.new_state.entity_id)
  if (ev.a) ids.push(...Object.keys(ev.a))
  if (ev.c) ids.push(...Object.keys(ev.c))
  if (ev.r) ids.push(...ev.r)
  return ids
}

export function isEntitySnapshot(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const a = (event as { a?: unknown }).a
  return Boolean(a && typeof a === 'object' && Object.keys(a as object).length > 0)
}

async function fetchEntityStates(
  haUrl: string,
  token: string,
  ids: string[],
): Promise<Record<string, HaState>> {
  const base = haUrl.replace(/\/$/, '')
  const out: Record<string, HaState> = {}
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`${base}/api/states/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        })
        if (!r.ok) return
        const s = (await r.json()) as HaState
        if (s?.state !== undefined) out[s.entity_id || id] = s
      } catch {
        /* CORS or missing entity */
      }
    }),
  )
  return out
}

function pickWatched(
  raw: unknown,
  watch: Set<string>,
): Record<string, HaState> {
  if (!raw || typeof raw !== 'object') return {}
  const src = raw as Record<string, HaState>
  if (!watch.size) return indexStates(raw)
  const map: Record<string, HaState> = {}
  for (const id of watch) {
    const direct = src[id]
    if (direct && direct.state !== undefined) {
      map[id] = direct
      continue
    }
  }
  return map
}

interface CompactEntity {
  s?: string
  a?: HaState['attributes']
}

export function applyEntityUpdates(
  states: Record<string, HaState>,
  event: unknown,
  watch: Set<string> = new Set(),
): Record<string, HaState> {
  if (!event || typeof event !== 'object') return states
  const ev = event as {
    data?: { new_state?: HaState }
    a?: Record<string, CompactEntity>
    c?: Record<string, { '+'?: CompactEntity; '-'?: { a?: string[] } }>
    r?: string[]
  }

  const allowed = (id: string) => !watch.size || watch.has(id)
  let next = states

  const legacy = ev.data?.new_state
  if (legacy?.entity_id && allowed(legacy.entity_id)) {
    next = { ...next, [legacy.entity_id]: legacy }
  }

  if (ev.a) {
    next = { ...next }
    for (const [id, compact] of Object.entries(ev.a)) {
      if (!allowed(id) || !compact) continue
      next[id] = {
        entity_id: id,
        state: compact.s ?? 'unknown',
        attributes: compact.a ?? {},
      }
    }
  }

  if (ev.r?.length) {
    next = { ...next }
    for (const id of ev.r) delete next[id]
  }

  if (ev.c) {
    next = { ...next }
    for (const [id, diff] of Object.entries(ev.c)) {
      if (!allowed(id)) continue
      const prev = next[id]
      if (!prev) continue
      const add = diff['+']
      const attrs: HaState['attributes'] = { ...prev.attributes, ...(add?.a ?? {}) }
      if (diff['-']?.a) {
        for (const key of diff['-'].a) {
          delete (attrs as Record<string, unknown>)[key]
        }
      }
      next[id] = {
        entity_id: id,
        state: add?.s ?? prev.state,
        attributes: attrs,
      }
    }
  }

  return next
}

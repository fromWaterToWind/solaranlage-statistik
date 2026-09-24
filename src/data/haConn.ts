import { indexStates, stateMap, type HaState } from './haParse'

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

  constructor(
    private readonly hass: HassLike,
    watchedIds: string[] = [],
  ) {
    this.watch = new Set(watchedIds.filter(Boolean))
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
    try {
      const list = await this.hass.callWS<HaState[]>({ type: 'get_states' })
      const all = indexStates(list)
      this.cached = this.watch.size ? pickWatched(all, this.watch) : all
    } catch {
      this.cached = {}
    }
    return this.cached
  }

  subscribe(onChange: () => void): () => void {
    let unsub: (() => void) | undefined
    let poll: number | undefined
    let trailing: number | undefined
    let eventsOk = false
    const notify = () => {
      if (trailing != null) return
      trailing = window.setTimeout(() => {
        trailing = undefined
        onChange()
      }, 400)
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
          eventsOk = true
          notify()
        }, 'state_changed')
        .then((fn) => {
          unsub = fn
        })
        .catch(() => {
          /* polling fallback below */
        })
    }
    const watchdog = window.setTimeout(() => {
      if (eventsOk) return
      poll = window.setInterval(() => {
        void this.getStates().then(() => onChange())
      }, 15_000)
    }, 4_000)
    return () => {
      window.clearTimeout(watchdog)
      if (trailing != null) window.clearTimeout(trailing)
      if (poll != null) window.clearInterval(poll)
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
  private emitTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly url: string,
    private readonly token: string,
    watchedIds: string[] = [],
  ) {
    this.watch = new Set(watchedIds.filter(Boolean))
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
          event?: { data?: { new_state?: HaState } }
        }

        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: this.token }))
          return
        }
        if (msg.type === 'auth_ok') {
          resolve()
          void this.send('get_states').then((list) => {
            const all = stateMap(list as HaState[])
            this.states = this.watch.size ? pickWatched(all, this.watch) : all
            this.emit()
          })
          void this.send('subscribe_events', { event_type: 'state_changed' })
          return
        }
        if (msg.type === 'auth_invalid') {
          fail('Home Assistant: Token ungültig.')
          return
        }
        if (msg.type === 'event') {
          const next = msg.event?.data?.new_state
          if (next?.entity_id) {
            if (!this.watch.size || this.watch.has(next.entity_id)) {
              this.states[next.entity_id] = next
              this.emit()
            }
          }
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
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private emit() {
    if (this.emitTimer != null) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      for (const l of this.listeners) l()
    }, 400)
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
): HaClient {
  const hass = tryGetHass()
  if (hass) return new HassParentClient(hass, watchedIds)

  const url = haUrl.trim() || (import.meta.env.VITE_HA_URL ?? '')
  const token = haToken.trim() || (import.meta.env.VITE_HA_TOKEN ?? '')
  if (!url || !token) {
    throw new Error(
      'Home Assistant: In der Companion-App als Sidebar öffnen, oder URL und Token in den Einstellungen eintragen.',
    )
  }
  return new TokenWsClient(url, token, watchedIds)
}

export function canUseParentHass(): boolean {
  return tryGetHass() !== null
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

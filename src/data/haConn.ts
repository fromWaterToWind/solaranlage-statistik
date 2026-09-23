import type { HaState } from './haParse'
import { stateMap } from './haParse'

export type HaPeriod = 'hour' | 'day' | 'month'

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
  constructor(private readonly hass: HassLike) {}

  async getStates(): Promise<Record<string, HaState>> {
    return this.hass.states
  }

  subscribe(onChange: () => void): () => void {
    let unsub: (() => void) | undefined
    const conn = this.hass.connection
    if (conn?.subscribeEvents) {
      void conn
        .subscribeEvents(() => onChange(), 'state_changed')
        .then((fn) => {
          unsub = fn
        })
        .catch(() => {
          /* polling fallback below */
        })
    }
    const poll = window.setInterval(onChange, 2000)
    return () => {
      window.clearInterval(poll)
      unsub?.()
    }
  }

  statistics(
    ids: string[],
    start: Date,
    end: Date,
    period: HaPeriod,
  ): Promise<HaStatistics> {
    return this.hass.callWS<HaStatistics>({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types: ['change', 'state', 'mean', 'max'],
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

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {
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
            this.states = stateMap(list as HaState[])
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
            this.states[next.entity_id] = next
            this.emit()
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
    for (const l of this.listeners) l()
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
  ): Promise<HaStatistics> {
    const result = await this.send('recorder/statistics_during_period', {
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types: ['change', 'state', 'mean', 'max'],
    })
    return (result as HaStatistics) ?? {}
  }
}

export function createHaClient(haUrl: string, haToken: string): HaClient {
  const hass = tryGetHass()
  if (hass) return new HassParentClient(hass)

  const url = haUrl.trim() || (import.meta.env.VITE_HA_URL ?? '')
  const token = haToken.trim() || (import.meta.env.VITE_HA_TOKEN ?? '')
  if (!url || !token) {
    throw new Error(
      'Home Assistant: In der Companion-App als Sidebar öffnen, oder URL und Token in den Einstellungen eintragen.',
    )
  }
  return new TokenWsClient(url, token)
}

export function canUseParentHass(): boolean {
  return tryGetHass() !== null
}

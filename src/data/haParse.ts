export interface HaState {
  entity_id: string
  state: string
  attributes: {
    unit_of_measurement?: string
    friendly_name?: string
  }
}

export interface MeasuredW {
  watts: number
  fault: string | null
}

export function isUnavailable(state: string | undefined): boolean {
  return !state || state === 'unavailable' || state === 'unknown' || state === 'none'
}

export function parseNumber(state: string | undefined): number | null {
  if (isUnavailable(state)) return null
  const n = Number(state)
  return Number.isFinite(n) ? n : null
}

export function unitOf(state: HaState | undefined): string {
  return (state?.attributes.unit_of_measurement ?? '').toLowerCase().replace(/\s/g, '')
}

/** Convert a numeric reading to Watts using the entity unit. 0.4 kW → 400. */
export function toWatts(value: number, unit: string): number {
  const u = unit.toLowerCase().replace(/\s/g, '')
  if (u === 'kw') {
    // House ESS never reports 50+ kW; that is W with a wrong unit (186 kW → 186 W).
    if (Math.abs(value) >= 50) return value
    return value * 1000
  }
  if (u === 'mw') return value * 1_000_000
  return value
}

/** The only power rounding: |W| < 1 → 0. Never treat kW as W. */
export function floorSubWatt(watts: number): number {
  return Math.abs(watts) < 1 ? 0 : watts
}

export function parseMeasuredPower(state: HaState | undefined): MeasuredW {
  if (!state) return { watts: 0, fault: 'fehlt' }
  const raw = state.state
  if (isUnavailable(raw)) return { watts: 0, fault: raw }
  const n = parseNumber(raw)
  if (n === null) return { watts: 0, fault: raw }
  return { watts: floorSubWatt(toWatts(n, unitOf(state))), fault: null }
}

export function parseEnergyKwh(state: HaState | undefined): number {
  const n = parseNumber(state?.state)
  if (n === null) return 0
  const u = unitOf(state)
  if (u === 'wh') return n / 1000
  if (u === 'mwh') return n * 1000
  return n
}

export function parseSocPercent(state: HaState | undefined): { percent: number; fault: string | null } {
  if (!state) return { percent: 0, fault: 'fehlt' }
  if (isUnavailable(state.state)) return { percent: 0, fault: state.state }
  const n = parseNumber(state.state)
  if (n === null) return { percent: 0, fault: state.state }
  if (n >= 0 && n <= 1.5) return { percent: n * 100, fault: null }
  return { percent: Math.min(100, Math.max(0, n)), fault: null }
}

export function stateMap(states: HaState[]): Record<string, HaState> {
  return indexStates(states)
}

/** Flatten HA state dicts, arrays, and non-enumerable iframe proxies into a plain map. */
export function indexStates(raw: unknown): Record<string, HaState> {
  const map: Record<string, HaState> = {}
  const add = (s: unknown, key?: string) => {
    if (!s || typeof s !== 'object') return
    const rec = s as HaState
    if (rec.state === undefined) return
    const id = rec.entity_id || key
    if (!id) return
    map[id] = rec
  }
  if (Array.isArray(raw)) {
    for (const s of raw) add(s)
    return map
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) add(v, k)
  }
  return map
}

export function lookupState(states: Record<string, HaState>, id: string): HaState | undefined {
  const t = id.trim()
  if (!t) return undefined
  const full = t.includes('.') ? t : `sensor.${t}`
  if (states[full]) return states[full]
  const lower = full.toLowerCase()
  const tail = (full.includes('.') ? full.slice(full.indexOf('.') + 1) : full).toLowerCase()
  for (const [key, val] of Object.entries(states)) {
    const k = key.toLowerCase()
    const vid = (val.entity_id ?? '').toLowerCase()
    if (k === lower || vid === lower) return val
    if (tail && (k.endsWith(`.${tail}`) || k.endsWith(tail) || vid.endsWith(`.${tail}`))) {
      return val
    }
  }
  return undefined
}

/** House load = battery output (±charge) ± grid import/export. PV is not a house meter. */
export function homeFromBatteryAndGrid(battSignedW: number, gridSignedW: number): number {
  return floorSubWatt(Math.max(0, battSignedW + gridSignedW))
}

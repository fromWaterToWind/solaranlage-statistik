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
  if (u === 'kw') return value * 1000
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
  const map: Record<string, HaState> = {}
  for (const s of states) map[s.entity_id] = s
  return map
}

/** House load = battery output (±charge) ± grid import/export. PV is not a house meter. */
export function homeFromBatteryAndGrid(battSignedW: number, gridSignedW: number): number {
  return floorSubWatt(Math.max(0, battSignedW + gridSignedW))
}

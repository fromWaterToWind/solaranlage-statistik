export interface HaState {
  entity_id: string
  state: string
  attributes: {
    unit_of_measurement?: string
    friendly_name?: string
  }
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

export function parsePowerW(state: HaState | undefined): number {
  const n = parseNumber(state?.state)
  if (n === null) return 0
  const u = unitOf(state)
  let watts = n
  if (u === 'kw') watts = n * 1000
  if (u === 'mw') watts = n * 1_000_000
  return Math.abs(watts) < 1 ? 0 : watts
}

export function parseEnergyKwh(state: HaState | undefined): number {
  const n = parseNumber(state?.state)
  if (n === null) return 0
  const u = unitOf(state)
  if (u === 'wh') return n / 1000
  if (u === 'mwh') return n * 1000
  return n
}

export function parseSocPercent(state: HaState | undefined): number {
  const n = parseNumber(state?.state)
  if (n === null) return 0
  if (n >= 0 && n <= 1.5) return n * 100
  return Math.min(100, Math.max(0, n))
}

export function stateMap(states: HaState[]): Record<string, HaState> {
  const map: Record<string, HaState> = {}
  for (const s of states) map[s.entity_id] = s
  return map
}

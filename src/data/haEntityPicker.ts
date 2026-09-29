import { indexStates } from './haParse'

function tryGetHassStates(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  let current: Window | null = window
  for (let i = 0; i < 5 && current; i++) {
    try {
      const el = current.document.querySelector('home-assistant') as {
        hass?: { states?: Record<string, unknown> }
      } | null
      if (el?.hass?.states) return el.hass.states
    } catch {
      /* cross-origin */
    }
    try {
      current = current.parent !== current ? current.parent : null
    } catch {
      current = null
    }
  }
  return null
}

/** Prefer sensor.* entities; fall back to all IDs when none match. */
export function entityIdsForPicker(allIds: string[]): string[] {
  const unique = [...new Set(allIds.filter(Boolean))]
  const sensors = unique.filter((id) => id.startsWith('sensor.'))
  const list = sensors.length > 0 ? sensors : unique
  return list.sort((a, b) => a.localeCompare(b, 'de'))
}

export function isHaReachableForPicker(haUrl: string, haToken: string): boolean {
  if (tryGetHassStates()) return true
  const url = haUrl.trim() || (import.meta.env.VITE_HA_URL ?? '')
  const token = haToken.trim() || (import.meta.env.VITE_HA_TOKEN ?? '')
  return Boolean(url && token)
}

/** Load entity IDs once (parent hass or REST). Returns [] when offline or on error. */
export async function fetchHaEntityIds(haUrl: string, haToken: string): Promise<string[]> {
  const parent = tryGetHassStates()
  if (parent) {
    return entityIdsForPicker(Object.keys(indexStates(parent)))
  }

  const url = haUrl.trim() || (import.meta.env.VITE_HA_URL ?? '')
  const token = haToken.trim() || (import.meta.env.VITE_HA_TOKEN ?? '')
  if (!url || !token) return []

  try {
    const base = url.replace(/\/$/, '')
    const r = await fetch(`${base}/api/states`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!r.ok) return []
    const rows = (await r.json()) as { entity_id?: string }[]
    if (!Array.isArray(rows)) return []
    return entityIdsForPicker(rows.map((s) => s.entity_id ?? '').filter(Boolean))
  } catch {
    return []
  }
}

export const HA_ENTITY_DATALIST_ID = 'ha-entity-picker-list'

export function entityPickerPlaceholder(fallback: string, pickerReady: boolean): string {
  return pickerReady ? 'Entity wählen oder tippen' : fallback
}

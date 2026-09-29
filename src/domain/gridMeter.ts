import type { EntityMap } from '@/config/appConfig'

export type GridMeterKind = 'ecotracker' | 'shelly' | 'none'

function trimmed(s: string): string {
  return s.trim()
}

function hasText(s: string): boolean {
  return trimmed(s).length > 0
}

function entityHints(id: string, fragment: string): boolean {
  return hasText(id) && id.toLowerCase().includes(fragment.toLowerCase())
}

/** Which Netz-Zähler slot the onboarding UI should highlight (entity values unchanged). */
export function inferGridMeterKind(entities: EntityMap): GridMeterKind {
  const { gridPower, importToday, exportToday, garagePower, homeToday } = entities
  const eco =
    entityHints(gridPower, 'ecotracker') ||
    entityHints(importToday, 'ecotracker') ||
    entityHints(exportToday, 'ecotracker')
  if (eco) return 'ecotracker'

  if (entityHints(garagePower, 'shelly') || entityHints(homeToday, 'shelly')) {
    return 'shelly'
  }

  if (hasText(gridPower) || hasText(importToday) || hasText(exportToday)) {
    return 'ecotracker'
  }
  if (hasText(garagePower) || hasText(homeToday)) {
    return 'shelly'
  }
  return 'none'
}

export const GRID_METER_ECOTRACKER_FIELDS: { key: keyof EntityMap; label: string }[] = [
  { key: 'gridPower', label: 'Netz Leistung (W)' },
  { key: 'importToday', label: 'Netzbezug heute' },
  { key: 'exportToday', label: 'Einspeisung heute' },
]

export const GRID_METER_SHELLY_FIELDS: { key: keyof EntityMap; label: string }[] = [
  { key: 'garagePower', label: 'Shelly Leistung (W) · WR AC' },
  { key: 'homeToday', label: 'Shelly täglich (kWh) · WR AC' },
]

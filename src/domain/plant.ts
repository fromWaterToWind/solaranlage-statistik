import type { AppConfig } from '@/config/appConfig'

/** A = PV→storage+inverter (Nexa/Marstek). B = separate storage. C = no storage. */
export type PlantTopology = 'A' | 'B' | 'C'

export type SourceAdapterKind =
  | 'growatt'
  | 'marstek'
  | 'shelly'
  | 'ecotracker'
  | 'homeAssistant'

/** How the adapter is reached today; live drivers come in later slices. */
export type SourceBinding = 'haEntity' | 'growattApi' | 'unbound'

export type PlantSlotId = 'pv' | 'storage' | 'inverterAc' | 'grid'

export interface SourceSlot {
  adapter: SourceAdapterKind
  via: SourceBinding
}

export interface PlantProfile {
  topology: PlantTopology
  pv: SourceSlot
  /** Null on topology C (no storage). */
  storage: SourceSlot | null
  /** WR AC into the house grid (Shelly garage today). */
  inverterAc: SourceSlot
  /** Smart meter import/export; dedicated meter wins over inverter-reported grid. */
  grid: SourceSlot
}

function trimmed(s: string): string {
  return s.trim()
}

function hasText(s: string): boolean {
  return trimmed(s).length > 0
}

/** Entity id contains fragment, case-insensitive. */
function entityHints(id: string, fragment: string): boolean {
  return hasText(id) && id.toLowerCase().includes(fragment.toLowerCase())
}

/** Growatt integration entities often use `gc_<sn>` or `nexa_<sn>`. */
function entityHintsGrowattHa(id: string): boolean {
  const t = id.toLowerCase()
  return entityHints(id, 'gc_') || entityHints(id, 'nexa') || t.includes('growatt')
}

function entityHintsShelly(id: string): boolean {
  return entityHints(id, 'shelly')
}

function entityHintsEcotracker(id: string): boolean {
  return entityHints(id, 'ecotracker')
}

function growattCredentialsPresent(config: AppConfig): boolean {
  return hasText(config.growatt.deviceSn) || hasText(config.growatt.token)
}

function hasPvHaEntities(config: AppConfig): boolean {
  const { entities, pvFields } = config
  if (hasText(entities.solarPower) || hasText(entities.generationToday)) return true
  return pvFields.some((f) => hasText(f.entityId))
}

function hasStorageHaEntities(config: AppConfig): boolean {
  const { entities, batteryParts } = config
  if (hasText(entities.soc) || hasText(entities.batteryPower)) return true
  return batteryParts.some((p) => hasText(p.socEntityId))
}

function hasAnyStorageSignal(config: AppConfig): boolean {
  if (config.batteryCapacityKwh != null && config.batteryCapacityKwh > 0) return true
  if (growattCredentialsPresent(config)) return true
  return hasStorageHaEntities(config)
}

/**
 * Topology A: DC-coupled all-in-one (storage is the inverter).
 * Heuristic: capacity, Growatt SN, or SOC/battery entities that look like Growatt/Nexa HA sensors.
 */
function looksLikeStorageInverter(config: AppConfig): boolean {
  if (config.batteryCapacityKwh != null && config.batteryCapacityKwh > 0) return true
  if (hasText(config.growatt.deviceSn)) return true
  const { soc, batteryPower } = config.entities
  if (entityHintsGrowattHa(soc) || entityHintsGrowattHa(batteryPower)) return true
  return config.batteryParts.some((p) => entityHintsGrowattHa(p.socEntityId))
}

function inferTopology(config: AppConfig): PlantTopology {
  if (!hasAnyStorageSignal(config)) return 'C'
  if (looksLikeStorageInverter(config)) return 'A'
  return 'B'
}

function growattBinding(config: AppConfig, haEntitiesPresent: boolean): SourceBinding {
  if (hasText(config.growatt.token)) return 'growattApi'
  if (haEntitiesPresent || hasText(config.growatt.deviceSn)) return 'haEntity'
  return 'unbound'
}

function pvSlot(config: AppConfig): SourceSlot {
  if (growattCredentialsPresent(config)) {
    const ha =
      hasPvHaEntities(config) ||
      entityHintsGrowattHa(config.entities.solarPower) ||
      entityHintsGrowattHa(config.entities.generationToday) ||
      config.pvFields.some((f) => entityHintsGrowattHa(f.entityId))
    return {
      adapter: 'growatt',
      via: growattBinding(config, ha),
    }
  }
  if (hasPvHaEntities(config)) {
    return { adapter: 'homeAssistant', via: 'haEntity' }
  }
  return { adapter: 'homeAssistant', via: 'unbound' }
}

function storageGrowattEntitySignals(config: AppConfig): boolean {
  const { soc, batteryPower } = config.entities
  return (
    entityHintsGrowattHa(soc) ||
    entityHintsGrowattHa(batteryPower) ||
    config.batteryParts.some((p) => entityHintsGrowattHa(p.socEntityId))
  )
}

function storageSlot(config: AppConfig, topology: PlantTopology): SourceSlot | null {
  if (topology === 'C') return null

  const growattEntities = storageGrowattEntitySignals(config)

  if (growattCredentialsPresent(config) || growattEntities) {
    return {
      adapter: 'growatt',
      via: growattBinding(
        config,
        growattEntities || hasStorageHaEntities(config),
      ),
    }
  }
  if (hasStorageHaEntities(config)) {
    return { adapter: 'homeAssistant', via: 'haEntity' }
  }
  return { adapter: 'homeAssistant', via: 'unbound' }
}

function inverterAcSlot(config: AppConfig): SourceSlot {
  const { garagePower, homeToday } = config.entities
  if (entityHintsShelly(garagePower) || entityHintsShelly(homeToday)) {
    return { adapter: 'shelly', via: hasText(garagePower) || hasText(homeToday) ? 'haEntity' : 'unbound' }
  }
  if (hasText(garagePower) || hasText(homeToday)) {
    return { adapter: 'homeAssistant', via: 'haEntity' }
  }
  if (growattCredentialsPresent(config)) {
    return { adapter: 'growatt', via: growattBinding(config, false) }
  }
  return { adapter: 'homeAssistant', via: 'unbound' }
}

function gridSlot(config: AppConfig): SourceSlot {
  const { gridPower, importToday, exportToday } = config.entities
  const ecotracker =
    entityHintsEcotracker(gridPower) ||
    entityHintsEcotracker(importToday) ||
    entityHintsEcotracker(exportToday)
  if (ecotracker) {
    const bound = hasText(gridPower) || hasText(importToday) || hasText(exportToday)
    return { adapter: 'ecotracker', via: bound ? 'haEntity' : 'unbound' }
  }
  if (hasText(gridPower) || hasText(importToday) || hasText(exportToday)) {
    return { adapter: 'homeAssistant', via: 'haEntity' }
  }
  return { adapter: 'homeAssistant', via: 'unbound' }
}

/** Infer plant topology and source slots from legacy AppConfig (entity IDs + Growatt block). */
export function plantFromConfig(config: AppConfig): PlantProfile {
  const topology = inferTopology(config)
  return {
    topology,
    pv: pvSlot(config),
    storage: storageSlot(config, topology),
    inverterAc: inverterAcSlot(config),
    grid: gridSlot(config),
  }
}

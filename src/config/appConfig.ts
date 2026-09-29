import type { Tariff, TariffPeriod } from '@/domain/types'
import { eurosToCt, resolvePeriods, windowBuyCt } from '@/domain/tariff'
import { isNativePlatform, setGrowattToken } from '@/data/secureToken'

export type PvShading = 'none' | 'light' | 'medium' | 'strong'

const PV_SHADING_VALUES: PvShading[] = ['none', 'light', 'medium', 'strong']

export interface NamedPowerSensor {
  id: string
  name: string
  entityId: string
  tempEntityId?: string
  /** Rated peak watts for this field; used for % of capacity. */
  peakW?: number
  /** 0=N, 90=E, 180=S, 270=W — typical DE south = 180. */
  azimuthDeg: number | null
  /** 0=flat, 90=wall. */
  tiltDeg: number | null
  /** Module STC kW peak; may coexist with peakW. */
  kWp: number | null
  shading: PvShading | null
  /** Free text, e.g. morning shade in winter. */
  shadingWhen?: string | null
}

export interface NamedBatteryPart {
  id: string
  name: string
  socEntityId: string
  tempEntityId: string
}

export interface GrowattConfig {
  token: string
  deviceSn: string
  plantId: string
  /** Growatt Open-API type from queryDeviceList, e.g. sph-s / min / noah. */
  deviceType?: string
  /** Older Noah SN. Used for days before `nexaFrom`. */
  extraDeviceSn?: string
  /** First day the Nexa is the source (YYYY-MM-DD). Default 2026-09-02. */
  nexaFrom?: string
}

export interface EntityMap {
  pv1Power: string
  pv2Power: string
  pv3Power: string
  solarPower: string
  generationToday: string
  soc: string
  /** Positive = discharge to house, negative = charge. */
  batteryPower: string
  /** Shelly garage / inverter AC power. Negative = feeding the house+grid. */
  garagePower: string
  /** EcoTracker grid power. Positive = import, negative = export. */
  gridPower: string
  /** Shelly garage daily kWh. Verbrauch kWh = this + Bezug − Einspeisung. */
  homeToday: string
  exportToday: string
  importToday: string
}

export interface AppConfig {
  haUrl: string
  haToken: string
  entities: EntityMap
  tariff: Tariff
  pvFields: NamedPowerSensor[]
  batteryParts: NamedBatteryPart[]
  /** Usable storage capacity in kWh (all packs). */
  batteryCapacityKwh: number | null
  growatt: GrowattConfig
  /** Plant location for PV forecast only; null disables forecast. */
  plantLatitude: number | null
  plantLongitude: number | null
}

export const DEFAULT_ENTITIES: EntityMap = {
  pv1Power: 'sensor.gc_0hvrd0zr247t000v_pv1_power',
  pv2Power: 'sensor.gc_0hvrd0zr247t000v_pv2_power',
  pv3Power: 'sensor.gc_0hvrd0zr247t000v_solar_power_other_storage',
  solarPower: 'sensor.gc_0hvrd0zr247t000v_solar_power',
  generationToday: 'sensor.gc_0hvrd0zr247t000v_generation_today',
  soc: 'sensor.gc_0hvrd0zr247t000v_soc',
  batteryPower: 'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert',
  garagePower: 'sensor.shelly_i_garage_power',
  gridPower: 'sensor.ecotracker_power',
  homeToday: 'sensor.shelly_i_garage_shelly_garage_daily',
  exportToday: 'sensor.ecotracker_einspeisung_heute',
  importToday: 'sensor.ecotracker_netzbezug_heute',
}

const SN = 'gc_0hvrd0zr247t000v'

/** PV-string temp next to `pvN_power`. Empty for other_storage / unknown. Never invent a reading. */
export function inferredPvTempEntity(entityId: string): string {
  const m = entityId.trim().match(/^(sensor\.[a-z0-9_]+_pv)(\d)_power$/i)
  return m ? `${m[1]}${m[2]}_temp` : ''
}

/** Daily kWh sensors Growatt-style integrations expose next to `pvN_power`. */
export function inferredPvTodayEnergyIds(entityId: string): string[] {
  const m = entityId.trim().match(/^(sensor\.[a-z0-9_]+_pv)(\d)_power$/i)
  if (!m) return []
  return [`${m[1]}${m[2]}_energy_today`, `${m[1]}${m[2]}_generation_today`]
}

const PV_GEOMETRY_NULL = {
  azimuthDeg: null,
  tiltDeg: null,
  kWp: null,
  shading: null,
  shadingWhen: null,
} as const

export const DEFAULT_PV_FIELDS: NamedPowerSensor[] = [
  {
    id: 'pv1',
    name: 'PV1',
    entityId: DEFAULT_ENTITIES.pv1Power,
    tempEntityId: inferredPvTempEntity(DEFAULT_ENTITIES.pv1Power),
    ...PV_GEOMETRY_NULL,
  },
  {
    id: 'pv2',
    name: 'PV2',
    entityId: DEFAULT_ENTITIES.pv2Power,
    tempEntityId: inferredPvTempEntity(DEFAULT_ENTITIES.pv2Power),
    ...PV_GEOMETRY_NULL,
  },
  {
    id: 'pv3',
    name: 'PV3',
    entityId: DEFAULT_ENTITIES.pv3Power,
    tempEntityId: '',
    ...PV_GEOMETRY_NULL,
  },
]

export const DEFAULT_BATTERY_PARTS: NamedBatteryPart[] = [
  {
    id: 'b1',
    name: 'Batterie 1',
    socEntityId: `sensor.${SN}_battery1_soc`,
    tempEntityId: `sensor.${SN}_battery1_temp`,
  },
  {
    id: 'b2',
    name: 'Batterie 2',
    socEntityId: `sensor.${SN}_battery2_soc`,
    tempEntityId: `sensor.${SN}_battery2_temp`,
  },
  {
    id: 'b3',
    name: 'Batterie 3',
    socEntityId: `sensor.${SN}_battery3_soc`,
    tempEntityId: `sensor.${SN}_battery3_temp`,
  },
]

export const DEFAULT_GROWATT: GrowattConfig = {
  token: '',
  deviceSn: '0HVRD0ZR247T000V',
  plantId: '',
  deviceType: '',
  extraDeviceSn: '',
  nexaFrom: '2026-09-02',
}

export function newNamedSensor(name: string, entityId = ''): NamedPowerSensor {
  return {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    entityId,
    tempEntityId: '',
    azimuthDeg: null,
    tiltDeg: null,
    kWp: null,
    shading: null,
    shadingWhen: null,
  }
}

export function newBatteryPart(name: string): NamedBatteryPart {
  return {
    id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    socEntityId: '',
    tempEntityId: '',
  }
}

function parseNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parsePositiveKwp(raw: unknown): number | null {
  const n = parseNullableNumber(raw)
  return n !== null && n > 0 ? n : null
}

function parsePvShading(raw: unknown): PvShading | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' && PV_SHADING_VALUES.includes(raw as PvShading)) {
    return raw as PvShading
  }
  return null
}

function parseNullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t ? t : null
  }
  return null
}

function parseNamedList(raw: unknown, fallback: NamedPowerSensor[]): NamedPowerSensor[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback.map((f) => ({ ...f }))
  const out: NamedPowerSensor[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id ? o.id : newNamedSensor('x').id
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Feld'
    const entityId = typeof o.entityId === 'string' ? o.entityId : ''
    const tempEntityId =
      (typeof o.tempEntityId === 'string' ? o.tempEntityId.trim() : '') ||
      inferredPvTempEntity(entityId)
    const peakRaw = o.peakW
    let peakW =
      typeof peakRaw === 'number' && Number.isFinite(peakRaw) && peakRaw > 0
        ? peakRaw
        : typeof peakRaw === 'string'
          ? Number(peakRaw) || undefined
          : undefined
    const kWp = parsePositiveKwp(o.kWp)
    if ((!peakW || peakW <= 0) && kWp !== null) {
      peakW = kWp * 1000
    }
    out.push({
      id,
      name,
      entityId,
      tempEntityId,
      peakW: peakW && peakW > 0 ? peakW : undefined,
      azimuthDeg: parseNullableNumber(o.azimuthDeg),
      tiltDeg: parseNullableNumber(o.tiltDeg),
      kWp,
      shading: parsePvShading(o.shading),
      shadingWhen: parseNullableString(o.shadingWhen),
    })
  }
  return out.length ? out : fallback.map((f) => ({ ...f }))
}

function pvFieldsFromLegacy(entities: EntityMap): NamedPowerSensor[] {
  return DEFAULT_PV_FIELDS.map((f) => ({
    ...f,
    entityId:
      f.id === 'pv1'
        ? entities.pv1Power || f.entityId
        : f.id === 'pv2'
          ? entities.pv2Power || f.entityId
          : f.id === 'pv3'
            ? entities.pv3Power || f.entityId
            : f.entityId,
  }))
}

function parseBatteryParts(raw: unknown, fallback: NamedBatteryPart[]): NamedBatteryPart[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback.map((f) => ({ ...f }))
  const first = raw[0]
  if (!first || typeof first !== 'object') return fallback.map((f) => ({ ...f }))
  const probe = first as Record<string, unknown>
  if (typeof probe.socEntityId !== 'string') return fallback.map((f) => ({ ...f }))
  const out: NamedBatteryPart[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id ? o.id : `b-${out.length + 1}`
    const name =
      typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Batterie ${out.length + 1}`
    const socEntityId = typeof o.socEntityId === 'string' ? o.socEntityId : ''
    const tempEntityId = typeof o.tempEntityId === 'string' ? o.tempEntityId : ''
    out.push({ id, name, socEntityId, tempEntityId })
  }
  return out.length ? out : fallback.map((f) => ({ ...f }))
}

function parseGrowatt(raw: unknown, fallback: GrowattConfig): GrowattConfig {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const o = raw as Record<string, unknown>
  return {
    token: typeof o.token === 'string' ? o.token : fallback.token,
    deviceSn:
      typeof o.deviceSn === 'string' && o.deviceSn.trim() ? o.deviceSn.trim() : fallback.deviceSn,
    plantId: typeof o.plantId === 'string' ? o.plantId : fallback.plantId,
    deviceType: typeof o.deviceType === 'string' ? o.deviceType.trim() : fallback.deviceType,
    extraDeviceSn:
      typeof o.extraDeviceSn === 'string' ? o.extraDeviceSn.trim() : (fallback.extraDeviceSn ?? ''),
    nexaFrom:
      typeof o.nexaFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.nexaFrom.trim())
        ? o.nexaFrom.trim()
        : (fallback.nexaFrom ?? '2026-09-02'),
  }
}

export const DEFAULT_TARIFF: Tariff = {
  periods: [
    {
      id: 'default',
      validFrom: '2020-01-01',
      validTo: null,
      buyCtPerKwh: 32,
      sellCtPerKwh: 8,
    },
  ],
}

function migrateTariff(raw: Tariff | undefined, fallback: Tariff): Tariff {
  if (!raw) return { periods: resolvePeriods(fallback).map(clonePeriod) }
  if (raw.periods?.length) {
    return { periods: raw.periods.map(clonePeriod) }
  }
  const buyCt = eurosToCt(raw.buyEurPerKwh ?? 0.32)
  const sellCt = eurosToCt(raw.sellEurPerKwh ?? 0.08)
  const windows = (raw.windows ?? []).map((w) => ({
    from: w.from,
    to: w.to,
    buyCtPerKwh: windowBuyCt(w, buyCt),
  }))
  return {
    periods: [
      {
        id: 'migrated',
        validFrom: '2020-01-01',
        validTo: null,
        buyCtPerKwh: buyCt,
        sellCtPerKwh: sellCt,
        windows: windows.length ? windows : undefined,
      },
    ],
  }
}

function clonePeriod(p: TariffPeriod): TariffPeriod {
  return {
    ...p,
    windows: p.windows?.map((w) => ({ ...w })),
  }
}

const STORAGE_KEY = 'solar-statistik-config-v1'
const GHOST_HOME_TODAY = new Set([
  'sensor.hausverbrauch_strom_heute',
  'hausverbrauch_strom_heute',
  'sensor.hausverbrauch',
  'hausverbrauch',
])

export function normalizeEntityId(id: string): string {
  const t = id.trim()
  if (!t) return t
  if (t.includes('.')) return t
  return `sensor.${t}`
}

function migrateEntities(entities: EntityMap): EntityMap {
  const next: EntityMap = { ...DEFAULT_ENTITIES, ...entities }
  if (GHOST_HOME_TODAY.has(normalizeEntityId(next.homeToday))) {
    next.homeToday = DEFAULT_ENTITIES.homeToday
  }
  if (!next.garagePower?.trim()) {
    next.garagePower = DEFAULT_ENTITIES.garagePower
  }
  if (!next.gridPower.trim()) {
    next.gridPower = DEFAULT_ENTITIES.gridPower
  }
  return next
}

function parseLatitude(raw: unknown): number | null {
  const n = parseNullableNumber(raw)
  if (n === null || n < -90 || n > 90) return null
  return n
}

function parseLongitude(raw: unknown): number | null {
  const n = parseNullableNumber(raw)
  if (n === null || n < -180 || n > 180) return null
  return n
}

export function defaultConfig(): AppConfig {
  return {
    haUrl: import.meta.env.VITE_HA_URL ?? '',
    haToken: import.meta.env.VITE_HA_TOKEN ?? '',
    entities: { ...DEFAULT_ENTITIES },
    tariff: {
      periods: resolvePeriods(DEFAULT_TARIFF).map(clonePeriod),
    },
    pvFields: DEFAULT_PV_FIELDS.map((f) => ({ ...f })),
    batteryParts: DEFAULT_BATTERY_PARTS.map((f) => ({ ...f })),
    batteryCapacityKwh: null,
    growatt: { ...DEFAULT_GROWATT },
    plantLatitude: null,
    plantLongitude: null,
  }
}

function parseCapacityKwh(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string') {
    const n = Number(raw.replace(',', '.'))
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

export function loadConfig(): AppConfig {
  const base = defaultConfig()
  if (typeof localStorage === 'undefined') return base
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    const entities = migrateEntities({ ...base.entities, ...parsed.entities })
    return {
      haUrl: typeof parsed.haUrl === 'string' ? parsed.haUrl : base.haUrl,
      haToken: typeof parsed.haToken === 'string' ? parsed.haToken : base.haToken,
      entities,
      tariff: migrateTariff(parsed.tariff, base.tariff),
      pvFields: parseNamedList(parsed.pvFields, pvFieldsFromLegacy(entities)),
      batteryParts: parseBatteryParts(parsed.batteryParts, DEFAULT_BATTERY_PARTS),
      batteryCapacityKwh: parseCapacityKwh(parsed.batteryCapacityKwh),
      growatt: (() => {
        const g = parseGrowatt(parsed.growatt, DEFAULT_GROWATT)
        if (isNativePlatform()) {
          return { ...g, token: '' }
        }
        return g
      })(),
      plantLatitude: parseLatitude(parsed.plantLatitude),
      plantLongitude: parseLongitude(parsed.plantLongitude),
    }
  } catch {
    return base
  }
}

export function saveConfig(config: AppConfig): void {
  if (isNativePlatform()) {
    void setGrowattToken(config.growatt.token)
    const toStore: AppConfig = {
      ...config,
      growatt: { ...config.growatt, token: '' },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function entityList(config: AppConfig): string[] {
  const fromMap = Object.values(config.entities)
  const fromPv = config.pvFields.flatMap((f) => [f.entityId, f.tempEntityId ?? ''])
  const fromBatt = config.batteryParts.flatMap((f) => [f.socEntityId, f.tempEntityId])
  return [...fromMap, ...fromPv, ...fromBatt].map(normalizeEntityId).filter(Boolean)
}

/** Shelly + EcoTracker — they update faster than Growatt. */
export function fastLiveEntityIds(config: { entities: Pick<EntityMap, 'garagePower' | 'gridPower'> }): string[] {
  return [config.entities.garagePower, config.entities.gridPower]
    .map(normalizeEntityId)
    .filter(Boolean)
}

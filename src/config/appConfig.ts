import type { Tariff } from '@/domain/types'

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

export const DEFAULT_TARIFF: Tariff = {
  buyEurPerKwh: 0.32,
  sellEurPerKwh: 0.08,
  windows: [
    { from: '06:00', to: '22:00', buyEurPerKwh: 0.32 },
    { from: '22:00', to: '06:00', buyEurPerKwh: 0.28 },
  ],
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

export function defaultConfig(): AppConfig {
  return {
    haUrl: import.meta.env.VITE_HA_URL ?? '',
    haToken: import.meta.env.VITE_HA_TOKEN ?? '',
    entities: { ...DEFAULT_ENTITIES },
    tariff: {
      buyEurPerKwh: DEFAULT_TARIFF.buyEurPerKwh,
      sellEurPerKwh: DEFAULT_TARIFF.sellEurPerKwh,
      windows: DEFAULT_TARIFF.windows?.map((w) => ({ ...w })),
    },
  }
}

export function loadConfig(): AppConfig {
  const base = defaultConfig()
  if (typeof localStorage === 'undefined') return base
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      haUrl: typeof parsed.haUrl === 'string' ? parsed.haUrl : base.haUrl,
      haToken: typeof parsed.haToken === 'string' ? parsed.haToken : base.haToken,
      entities: migrateEntities({ ...base.entities, ...parsed.entities }),
      tariff: {
        buyEurPerKwh: parsed.tariff?.buyEurPerKwh ?? base.tariff.buyEurPerKwh,
        sellEurPerKwh: parsed.tariff?.sellEurPerKwh ?? base.tariff.sellEurPerKwh,
        windows: parsed.tariff?.windows?.length
          ? parsed.tariff.windows
          : base.tariff.windows,
      },
    }
  } catch {
    return base
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function entityList(entities: EntityMap): string[] {
  return Object.values(entities).map(normalizeEntityId).filter(Boolean)
}

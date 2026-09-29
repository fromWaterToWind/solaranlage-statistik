import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConfig,
  fastLiveEntityIds,
  inferredPvTempEntity,
  inferredPvTodayEnergyIds,
  loadConfig,
  saveConfig,
  type NamedPowerSensor,
} from './appConfig'

const STORAGE_KEY = 'solar-statistik-config-v1'

function mockLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    get length() {
      return store.size
    },
    key: (_i: number) => null,
  })
  return store
}

describe('inferred PV helpers', () => {
  it('maps pvN_power to pvN_temp', () => {
    expect(inferredPvTempEntity('sensor.gc_0hvrd0zr247t000v_pv1_power')).toBe(
      'sensor.gc_0hvrd0zr247t000v_pv1_temp',
    )
    expect(inferredPvTempEntity('sensor.gc_0hvrd0zr247t000v_pv2_power')).toBe(
      'sensor.gc_0hvrd0zr247t000v_pv2_temp',
    )
  })

  it('does not invent a temp entity for other storage', () => {
    expect(inferredPvTempEntity('sensor.gc_0hvrd0zr247t000v_solar_power_other_storage')).toBe('')
  })

  it('maps pvN_power to daily energy sensors', () => {
    expect(inferredPvTodayEnergyIds('sensor.gc_0hvrd0zr247t000v_pv1_power')).toEqual([
      'sensor.gc_0hvrd0zr247t000v_pv1_energy_today',
      'sensor.gc_0hvrd0zr247t000v_pv1_generation_today',
    ])
    expect(inferredPvTodayEnergyIds('sensor.gc_0hvrd0zr247t000v_solar_power_other_storage')).toEqual(
      [],
    )
  })
})

describe('fastLiveEntityIds', () => {
  it('only treats Shelly and EcoTracker as fast live sensors', () => {
    const config = {
      entities: {
        garagePower: 'sensor.shelly_i_garage_power',
        gridPower: 'sensor.ecotracker_power',
      },
    }
    expect(fastLiveEntityIds(config)).toEqual([
      'sensor.shelly_i_garage_power',
      'sensor.ecotracker_power',
    ])
  })
})

describe('PV field geometry (S4)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mockLocalStorage()
  })

  it('round-trips geometry fields through localStorage JSON', () => {
    const cfg = defaultConfig()
    const field: NamedPowerSensor = {
      id: 'pv-south',
      name: 'Süd',
      entityId: 'sensor.test_pv1_power',
      tempEntityId: 'sensor.test_pv1_temp',
      peakW: 5000,
      azimuthDeg: 180,
      tiltDeg: 30,
      kWp: 5,
      shading: 'light',
      shadingWhen: 'Vormittag, Winter',
    }
    cfg.pvFields = [field]
    saveConfig(cfg)

    const loaded = loadConfig()
    expect(loaded.pvFields[0]).toMatchObject({
      id: 'pv-south',
      peakW: 5000,
      azimuthDeg: 180,
      tiltDeg: 30,
      kWp: 5,
      shading: 'light',
      shadingWhen: 'Vormittag, Winter',
    })

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { pvFields: NamedPowerSensor[] }
    expect(parsed.pvFields[0].azimuthDeg).toBe(180)
    expect(parsed.pvFields[0].shading).toBe('light')
  })

  it('loads stored pvFields without geometry keys as null', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pvFields: [
          {
            id: 'legacy',
            name: 'Alt',
            entityId: 'sensor.legacy_pv1_power',
            peakW: 430,
          },
        ],
      }),
    )
    const loaded = loadConfig()
    expect(loaded.pvFields[0].peakW).toBe(430)
    expect(loaded.pvFields[0].azimuthDeg).toBeNull()
    expect(loaded.pvFields[0].tiltDeg).toBeNull()
    expect(loaded.pvFields[0].kWp).toBeNull()
    expect(loaded.pvFields[0].shading).toBeNull()
    expect(loaded.pvFields[0].shadingWhen).toBeNull()
  })

  it('derives peakW from kWp when peakW is missing', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pvFields: [
          {
            id: 'kwp-only',
            name: 'Modul',
            entityId: 'sensor.mod_pv1_power',
            kWp: 4.2,
          },
        ],
      }),
    )
    const loaded = loadConfig()
    expect(loaded.pvFields[0].kWp).toBe(4.2)
    expect(loaded.pvFields[0].peakW).toBe(4200)
  })

  it('defaults plant location to null', () => {
    const cfg = defaultConfig()
    expect(cfg.plantLatitude).toBeNull()
    expect(cfg.plantLongitude).toBeNull()
  })

  it('round-trips plant location for forecast', () => {
    const cfg = defaultConfig()
    cfg.plantLatitude = 52.52
    cfg.plantLongitude = 13.405
    saveConfig(cfg)
    const loaded = loadConfig()
    expect(loaded.plantLatitude).toBe(52.52)
    expect(loaded.plantLongitude).toBe(13.405)
  })

  it('keeps explicit peakW when kWp is also set', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pvFields: [
          {
            id: 'both',
            name: 'Mix',
            entityId: 'sensor.mix_pv1_power',
            peakW: 430,
            kWp: 5,
          },
        ],
      }),
    )
    const loaded = loadConfig()
    expect(loaded.pvFields[0].peakW).toBe(430)
    expect(loaded.pvFields[0].kWp).toBe(5)
  })
})

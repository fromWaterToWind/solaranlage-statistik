import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/config/appConfig'
import { plantFromConfig } from '@/domain/plant'
import type { LiveSnapshot } from '@/domain/types'
import { GRID_METER_MISSING } from './growattLive'
import { mergeLiveWithGrowatt, plantForNoHaMerge } from './liveMerge'

function baseLive(): LiveSnapshot {
  return {
    at: '2026-09-09T10:00:00.000Z',
    mppts: [{ id: 'pv1', name: 'HA', powerW: 50, fault: 'offline' }],
    pvW: 50,
    pvFault: 'offline',
    homeW: 200,
    homeFault: null,
    outputW: 180,
    battery: {
      socPercent: 40,
      socFault: null,
      chargeW: 0,
      dischargeW: 100,
      fault: null,
      parts: [],
    },
    grid: { importW: 30, exportW: 0, fault: null },
  }
}

function growattLive(): LiveSnapshot {
  return {
    at: '2026-09-09T10:03:00.000Z',
    mppts: [{ id: 'pv1', name: 'PV1', powerW: 900, fault: null }],
    pvW: 900,
    pvFault: null,
    homeW: 600,
    homeFault: null,
    outputW: 815,
    battery: {
      socPercent: 55,
      socFault: null,
      chargeW: 200,
      dischargeW: 0,
      fault: null,
      parts: [],
    },
    grid: { importW: 0, exportW: 0, fault: GRID_METER_MISSING },
  }
}

describe('mergeLiveWithGrowatt', () => {
  it('overwrites pv, storage and output from Growatt but keeps HA grid', () => {
    const config = defaultConfig()
    config.growatt.token = 'tok'
    const plant = plantFromConfig(config)
    const merged = mergeLiveWithGrowatt(baseLive(), growattLive(), plant)
    expect(merged.pvW).toBe(900)
    expect(merged.pvFault).toBeNull()
    expect(merged.outputW).toBe(180)
    expect(merged.battery.socPercent).toBe(55)
    expect(merged.grid.importW).toBe(30)
    expect(merged.grid.fault).toBeNull()
  })

  it('plantForNoHaMerge forces Growatt WR-AC despite default Shelly entities', () => {
    const config = defaultConfig()
    config.growatt.token = 'tok'
    const plant = plantForNoHaMerge(plantFromConfig(config), true)
    expect(plant.inverterAc).toEqual({ adapter: 'growatt', via: 'growattApi' })
    expect(plant.grid).toEqual({ adapter: 'growatt', via: 'growattApi' })
    const merged = mergeLiveWithGrowatt(
      {
        ...baseLive(),
        homeFault: 'Keine Hauslast',
        outputW: 0,
        grid: { importW: 0, exportW: 0, fault: GRID_METER_MISSING },
      },
      growattLive(),
      plant,
    )
    expect(merged.outputW).toBe(815)
    expect(merged.pvW).toBe(900)
    expect(merged.grid.fault).toBe(GRID_METER_MISSING)
  })

  it('uses Growatt WR-AC when no Shelly HA entity is configured', () => {
    const config = defaultConfig()
    config.growatt.token = 'tok'
    config.entities.garagePower = ''
    config.entities.homeToday = ''
    const plant = plantFromConfig(config)
    expect(plant.inverterAc).toEqual({ adapter: 'growatt', via: 'growattApi' })
    const merged = mergeLiveWithGrowatt(baseLive(), growattLive(), plant)
    expect(merged.outputW).toBe(815)
  })
})

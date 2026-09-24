import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITIES, DEFAULT_PV_FIELDS } from '@/config/appConfig'
import { liveFromStates } from './ha'
import type { HaState } from './haParse'

function st(id: string, state: string, unit = 'W'): HaState {
  return { entity_id: id, state, attributes: { unit_of_measurement: unit } }
}

const ids = DEFAULT_ENTITIES

describe('liveFromStates', () => {
  it('Verbrauch W is EcoTracker − Shelly (−815 and −720 → 95)', () => {
    const live = liveFromStates(
      {
        [ids.garagePower]: st(ids.garagePower, '-815'),
        [ids.gridPower]: st(ids.gridPower, '-720'),
        [ids.solarPower]: st(ids.solarPower, '2000'),
        [ids.batteryPower]: st(ids.batteryPower, '-1000'),
      },
      ids,
    )
    expect(live.homeW).toBe(95)
    expect(live.outputW).toBe(815)
    expect(live.grid.exportW).toBe(720)
    expect(live.homeFault).toBeNull()
  })

  it('does not use PV or battery for house watts', () => {
    const live = liveFromStates(
      {
        [ids.garagePower]: st(ids.garagePower, '-815'),
        [ids.gridPower]: st(ids.gridPower, '-720'),
        [ids.solarPower]: st(ids.solarPower, '800'),
        [ids.batteryPower]: st(ids.batteryPower, '167'),
      },
      ids,
    )
    expect(live.homeW).toBe(95)
    expect(live.pvW).toBe(800)
    expect(live.battery.dischargeW).toBe(167)
  })

  it('shows shelly unavailable on house', () => {
    const live = liveFromStates(
      {
        [ids.garagePower]: st(ids.garagePower, 'unavailable'),
        [ids.gridPower]: st(ids.gridPower, '-720'),
      },
      ids,
    )
    expect(live.homeFault).toBe('unavailable')
    expect(live.homeW).toBe(0)
  })

  it('treats EcoTracker unknown as 0 W grid, not a fault', () => {
    const live = liveFromStates(
      {
        [ids.garagePower]: st(ids.garagePower, '-815'),
        [ids.gridPower]: st(ids.gridPower, 'unknown'),
      },
      ids,
    )
    expect(live.grid.fault).toBeNull()
    expect(live.grid.importW).toBe(0)
    expect(live.grid.exportW).toBe(0)
    expect(live.homeFault).toBeNull()
    expect(live.homeW).toBe(815)
  })

  it('reads PV temperature from the matching sensor and never invents one', () => {
    const live = liveFromStates(
      {
        [ids.pv1Power]: st(ids.pv1Power, '400'),
        [ids.pv2Power]: st(ids.pv2Power, '200'),
        [ids.pv3Power]: st(ids.pv3Power, '50'),
        'sensor.gc_0hvrd0zr247t000v_pv1_temp': st(
          'sensor.gc_0hvrd0zr247t000v_pv1_temp',
          '31.4',
          '°C',
        ),
        'sensor.gc_0hvrd0zr247t000v_battery1_temp': st(
          'sensor.gc_0hvrd0zr247t000v_battery1_temp',
          '40',
          '°C',
        ),
      },
      ids,
      DEFAULT_PV_FIELDS,
    )
    expect(live.mppts.find((m) => m.id === 'pv1')?.tempC).toBe(31.4)
    expect(live.mppts.find((m) => m.id === 'pv2')?.tempC).toBeNull()
    expect(live.mppts.find((m) => m.id === 'pv3')?.tempC).toBeNull()
  })
})

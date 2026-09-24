import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITIES } from '@/config/appConfig'
import { liveFromStates } from './ha'
import type { HaState } from './haParse'

function st(id: string, state: string, unit = 'W'): HaState {
  return { entity_id: id, state, attributes: { unit_of_measurement: unit } }
}

describe('liveFromStates', () => {
  it('uses ecotracker_power as grid and house = battery ± grid', () => {
    const states: Record<string, HaState> = {
      'sensor.gc_0hvrd0zr247t000v_solar_power': st(
        'sensor.gc_0hvrd0zr247t000v_solar_power',
        '800',
      ),
      'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert': st(
        'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert',
        '167',
      ),
      'sensor.ecotracker_power': st('sensor.ecotracker_power', '0.4'),
      'sensor.gc_0hvrd0zr247t000v_soc': st('sensor.gc_0hvrd0zr247t000v_soc', '55', '%'),
    }

    const live = liveFromStates(states, { ...DEFAULT_ENTITIES, homePower: '' })

    expect(live.grid.importW).toBe(0)
    expect(live.grid.exportW).toBe(0)
    expect(live.grid.fault).toBeNull()
    expect(live.battery.dischargeW).toBe(167)
    expect(live.homeW).toBe(167)
    expect(live.homeFault).toBeNull()
    expect(live.pvW).toBe(800)
  })

  it('puts battery discharge on house, not on grid export', () => {
    const live = liveFromStates(
      {
        'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert': st(
          'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert',
          '186',
        ),
        'sensor.ecotracker_power': st('sensor.ecotracker_power', '3'),
        'sensor.gc_0hvrd0zr247t000v_solar_power': st(
          'sensor.gc_0hvrd0zr247t000v_solar_power',
          '0.4',
        ),
      },
      { ...DEFAULT_ENTITIES, homePower: '' },
    )
    expect(live.pvW).toBe(0)
    expect(live.battery.dischargeW).toBe(186)
    expect(live.grid.importW).toBe(3)
    expect(live.grid.exportW).toBe(0)
    expect(live.homeW).toBe(189)
  })


  it('shows ecotracker unavailable instead of 0', () => {
    const live = liveFromStates(
      {
        'sensor.ecotracker_power': st('sensor.ecotracker_power', 'unavailable'),
        'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert': st(
          'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert',
          '167',
        ),
        'sensor.gc_0hvrd0zr247t000v_solar_power': st(
          'sensor.gc_0hvrd0zr247t000v_solar_power',
          '0',
        ),
      },
      { ...DEFAULT_ENTITIES, homePower: '' },
    )
    expect(live.grid.fault).toBe('unavailable')
    expect(live.homeFault).toBeNull()
    expect(live.homeW).toBe(167)
  })

  it('shows house from battery when grid sensor is missing', () => {
    const live = liveFromStates(
      {
        'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert': st(
          'sensor.nexa_0hvrd0zr247t000v_nexa_batterie_leistung_kombiniert',
          '186',
        ),
        'sensor.gc_0hvrd0zr247t000v_solar_power': st(
          'sensor.gc_0hvrd0zr247t000v_solar_power',
          '0',
        ),
      },
      { ...DEFAULT_ENTITIES, homePower: '' },
    )
    expect(live.grid.fault).toBe('fehlt')
    expect(live.homeFault).toBeNull()
    expect(live.homeW).toBe(186)
  })
})

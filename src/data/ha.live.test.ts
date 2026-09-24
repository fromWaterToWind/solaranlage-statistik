import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITIES } from '@/config/appConfig'
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
})

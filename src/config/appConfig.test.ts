import { describe, expect, it } from 'vitest'
import { inferredPvTempEntity, inferredPvTodayEnergyIds } from './appConfig'

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

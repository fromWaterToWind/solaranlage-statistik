import { describe, expect, it } from 'vitest'
import {
  homeFromShellyAndGrid,
  homeKwhFromShellyAndGrid,
  inverterOutputW,
  lookupState,
  parseGridPower,
  parseMeasuredPower,
  toWatts,
  floorSubWatt,
  type HaState,
} from './haParse'

function st(state: string, unit?: string): HaState {
  return {
    entity_id: 'sensor.x',
    state,
    attributes: unit ? { unit_of_measurement: unit } : {},
  }
}

describe('toWatts', () => {
  it('keeps Watts as Watts', () => {
    expect(toWatts(167, 'W')).toBe(167)
    expect(toWatts(167, 'w')).toBe(167)
  })

  it('converts 0.4 kW to 400 W but not 186 kW-labelled Watts', () => {
    expect(toWatts(0.4, 'kW')).toBeCloseTo(400)
    expect(toWatts(5, 'kW')).toBeCloseTo(5000)
    expect(toWatts(186, 'kW')).toBe(186)
  })
})

describe('floorSubWatt', () => {
  it('zeros sub-watt noise only', () => {
    expect(floorSubWatt(0.4)).toBe(0)
    expect(floorSubWatt(-0.7)).toBe(0)
    expect(floorSubWatt(1)).toBe(1)
    expect(floorSubWatt(400)).toBe(400)
  })
})

describe('parseMeasuredPower', () => {
  it('shows HA fault states instead of 0', () => {
    expect(parseMeasuredPower(undefined)).toEqual({ watts: 0, fault: 'fehlt' })
    expect(parseMeasuredPower(st('unavailable', 'W'))).toEqual({
      watts: 0,
      fault: 'unavailable',
    })
    expect(parseMeasuredPower(st('unknown'))).toEqual({ watts: 0, fault: 'unknown' })
    expect(parseMeasuredPower(st('banana', 'W'))).toEqual({ watts: 0, fault: 'banana' })
  })

  it('converts kW then applies the 1 W floor', () => {
    expect(parseMeasuredPower(st('0.4', 'kW'))).toEqual({ watts: 400, fault: null })
    expect(parseMeasuredPower(st('0.0004', 'kW'))).toEqual({ watts: 0, fault: null })
    expect(parseMeasuredPower(st('167', 'W'))).toEqual({ watts: 167, fault: null })
    expect(parseMeasuredPower(st('186', 'kW'))).toEqual({ watts: 186, fault: null })
  })
})

describe('parseGridPower', () => {
  it('treats unknown as 0 W, not a fault', () => {
    expect(parseGridPower(st('unknown', 'W'))).toEqual({ watts: 0, fault: null })
    expect(parseGridPower(st('Unknown', 'W'))).toEqual({ watts: 0, fault: null })
  })

  it('still shows unavailable and missing as faults', () => {
    expect(parseGridPower(st('unavailable', 'W'))).toEqual({ watts: 0, fault: 'unavailable' })
    expect(parseGridPower(undefined)).toEqual({ watts: 0, fault: 'fehlt' })
  })
})

describe('homeFromShellyAndGrid', () => {
  it('Shelly −815 and EcoTracker −720 is 95 W house load', () => {
    expect(homeFromShellyAndGrid(-815, -720)).toBe(95)
    expect(inverterOutputW(-815)).toBe(815)
  })

  it('grid import with idle inverter is the house load', () => {
    expect(homeFromShellyAndGrid(0, 400)).toBe(400)
    expect(inverterOutputW(0)).toBe(0)
  })
})

describe('homeKwhFromShellyAndGrid', () => {
  it('is Shelly daily + Bezug − Einspeisung', () => {
    expect(homeKwhFromShellyAndGrid(10, 1, 3)).toBe(8)
  })
})

describe('lookupState', () => {
  it('finds sensors by entity_id on the value when dict keys are unusable', () => {
    const states = {
      '0': st('12', 'kWh'),
    }
    states['0'].entity_id = 'sensor.hausverbrauch_strom_heute'
    expect(lookupState(states, 'hausverbrauch_strom_heute')?.state).toBe('12')
  })

  it('does not borrow another temperature sensor when the entity is missing', () => {
    const states = {
      'sensor.gc_0hvrd0zr247t000v_battery1_temp': {
        entity_id: 'sensor.gc_0hvrd0zr247t000v_battery1_temp',
        state: '34',
        attributes: { unit_of_measurement: '°C' },
      },
    }
    expect(lookupState(states, 'sensor.gc_0hvrd0zr247t000v_pv3_temp')).toBeUndefined()
  })
})

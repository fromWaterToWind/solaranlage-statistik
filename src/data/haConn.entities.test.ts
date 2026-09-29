import { describe, expect, it } from 'vitest'
import { applyEntityUpdates, entityIdsInEvent, isEntitySnapshot } from './haConn'

describe('applyEntityUpdates', () => {
  it('inflates subscribe_entities add/change payloads', () => {
    const watch = new Set(['sensor.pv1_power', 'sensor.grid'])
    let states = applyEntityUpdates(
      {},
      {
        a: {
          'sensor.pv1_power': { s: '400', a: { unit_of_measurement: 'W' } },
          'sensor.other': { s: '1', a: {} },
        },
      },
      watch,
    )
    expect(states['sensor.pv1_power']?.state).toBe('400')
    expect(states['sensor.other']).toBeUndefined()

    states = applyEntityUpdates(
      states,
      { c: { 'sensor.pv1_power': { '+': { s: '410' } } } },
      watch,
    )
    expect(states['sensor.pv1_power']?.state).toBe('410')
    expect(states['sensor.pv1_power']?.attributes.unit_of_measurement).toBe('W')
  })

  it('ignores broadcast state_changed for entities we do not watch', () => {
    const watch = new Set(['sensor.pv1_power'])
    const states = applyEntityUpdates(
      {},
      { data: { new_state: { entity_id: 'light.kitchen', state: 'on', attributes: {} } } },
      watch,
    )
    expect(states['light.kitchen']).toBeUndefined()
  })
})

describe('entity event helpers', () => {
  it('detects a subscribe_entities snapshot vs a later change', () => {
    expect(isEntitySnapshot({ a: { 'sensor.ecotracker_power': { s: '12' } } })).toBe(true)
    expect(isEntitySnapshot({ c: { 'sensor.ecotracker_power': { '+': { s: '13' } } } })).toBe(false)
    expect(entityIdsInEvent({ a: { 'sensor.ecotracker_power': { s: '12' } } })).toEqual([
      'sensor.ecotracker_power',
    ])
  })
})

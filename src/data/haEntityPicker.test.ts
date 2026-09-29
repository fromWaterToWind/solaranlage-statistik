import { describe, expect, it } from 'vitest'
import { entityIdsForPicker } from './haEntityPicker'

describe('entityIdsForPicker', () => {
  it('keeps only sensor.* when present', () => {
    expect(
      entityIdsForPicker(['light.kitchen', 'sensor.pv1_power', 'sensor.grid', 'binary_sensor.door']),
    ).toEqual(['sensor.grid', 'sensor.pv1_power'])
  })

  it('falls back to all ids when no sensor domain', () => {
    expect(entityIdsForPicker(['light.a', 'switch.b'])).toEqual(['light.a', 'switch.b'])
  })

  it('deduplicates and sorts', () => {
    expect(entityIdsForPicker(['sensor.b', 'sensor.a', 'sensor.b'])).toEqual(['sensor.a', 'sensor.b'])
  })
})

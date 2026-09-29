import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITIES, defaultConfig } from '@/config/appConfig'
import { inferGridMeterKind } from './gridMeter'

describe('inferGridMeterKind', () => {
  it('prefers EcoTracker when default entities include both EcoTracker and Shelly', () => {
    expect(inferGridMeterKind(DEFAULT_ENTITIES)).toBe('ecotracker')
  })

  it('detects Shelly-as-meter when no EcoTracker grid fields', () => {
    const c = defaultConfig()
    c.entities.gridPower = ''
    c.entities.importToday = ''
    c.entities.exportToday = ''
    expect(inferGridMeterKind(c.entities)).toBe('shelly')
  })

  it('is none when grid-related entities are empty', () => {
    expect(
      inferGridMeterKind({
        ...DEFAULT_ENTITIES,
        gridPower: '',
        importToday: '',
        exportToday: '',
        garagePower: '',
        homeToday: '',
      }),
    ).toBe('none')
  })
})

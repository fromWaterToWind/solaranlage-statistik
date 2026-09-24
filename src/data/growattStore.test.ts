import { describe, expect, it } from 'vitest'
import { daysInRange, defaultSyncFrom, defaultSyncTo, formatDay, parseDay } from './growattStore'

describe('daysInRange', () => {
  it('lists inclusive calendar days', () => {
    expect(daysInRange('2026-09-01', '2026-09-02')).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('returns empty when from is after to', () => {
    expect(daysInRange('2026-09-03', '2026-09-01')).toEqual([])
  })
})

describe('defaultSyncFrom', () => {
  it('starts 3 months back (Growatt DATE_WITHIN_3_MONTHS)', () => {
    const now = new Date(2026, 8, 24)
    expect(defaultSyncFrom(now)).toBe('2026-06-24')
  })
})

describe('defaultSyncTo', () => {
  it('is yesterday', () => {
    const now = new Date(2026, 8, 24, 21, 0, 0)
    expect(defaultSyncTo(now)).toBe('2026-09-23')
    expect(formatDay(parseDay('2026-09-23') as Date)).toBe('2026-09-23')
  })
})

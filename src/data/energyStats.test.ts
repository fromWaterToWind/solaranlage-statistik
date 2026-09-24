import { describe, expect, it } from 'vitest'
import { energyKwhFromRow, lastCumulativeKwh } from './energyStats'

describe('energyKwhFromRow', () => {
  it('does not treat hourly max of a daily counter as that hour’s kWh', () => {
    expect(
      energyKwhFromRow({ start: '2026-09-24T12:00:00', max: 8.5, state: 8.5 }, 'hour'),
    ).toBe(0)
    expect(
      energyKwhFromRow({ start: '2026-09-24T12:00:00', change: 0.4, max: 8.5 }, 'hour'),
    ).toBe(0.4)
  })

  it('uses max for a whole day bucket', () => {
    expect(
      energyKwhFromRow({ start: '2026-09-24T00:00:00', max: 8.5 }, 'day'),
    ).toBe(8.5)
  })
})

describe('lastCumulativeKwh', () => {
  it('returns the last daily-counter reading, not the sum of maxes', () => {
    expect(
      lastCumulativeKwh([
        { start: 'a', max: 1.2 },
        { start: 'b', max: 4.0 },
        { start: 'c', state: 8.5, max: 8.5 },
      ]),
    ).toBe(8.5)
  })
})

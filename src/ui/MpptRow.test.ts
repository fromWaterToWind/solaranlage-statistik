import { describe, expect, it } from 'vitest'
import { mpptDayKwhMap } from './MpptRow'

const today = new Date(2026, 8, 24, 12)

describe('mpptDayKwhMap', () => {
  it('keeps today kWh even if the production hero is still loading', () => {
    const map = mpptDayKwhMap(
      undefined,
      [{ id: 'pv1', kwh: 12.4, fault: null }],
      'day',
      today,
      today,
    )
    expect(map.pv1).toBe(12.4)
  })

  it('does not use month totals on the PV tiles', () => {
    const map = mpptDayKwhMap(
      [{ id: 'pv1', kwh: 4.1, fault: null }],
      [{ id: 'pv1', kwh: 400, fault: null }],
      'month',
      today,
      today,
    )
    expect(map.pv1).toBe(4.1)
  })

  it('still shows kWh when statistics marked a fault but a value exists', () => {
    const map = mpptDayKwhMap(
      [{ id: 'pv1', kwh: 8.2, fault: 'keine Statistik' }],
      undefined,
      'day',
      today,
      today,
    )
    expect(map.pv1).toBe(8.2)
  })
})

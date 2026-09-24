import { describe, expect, it } from 'vitest'
import { integratePowerKwh, meanWatts, recorderPowerPlan, rowDurationHours } from './powerStats'
import type { HaStatRow } from './haConn'

function row(start: string, end: string, mean: number): HaStatRow {
  return { start, end, mean }
}

describe('meanWatts', () => {
  it('does not treat 40 W as 40 kW', () => {
    expect(meanWatts({ start: 'x', mean: 40 })).toBe(40)
    expect(meanWatts({ start: 'x', mean: 0.4 })).toBe(0)
    expect(meanWatts({ start: 'x', mean: 400 })).toBe(400)
  })
})

describe('rowDurationHours', () => {
  it('uses 5 minutes when end is missing on 5minute stats', () => {
    expect(rowDurationHours({ start: '2026-09-24T00:00:00' }, '5minute')).toBeCloseTo(5 / 60)
  })

  it('does not default 5-minute rows to a full hour', () => {
    const h = rowDurationHours(
      { start: '2026-09-24T00:00:00', end: '2026-09-24T00:05:00', mean: 167 },
      '5minute',
    )
    expect(h).toBeCloseTo(5 / 60)
  })
})

describe('integratePowerKwh', () => {
  it('splits signed battery power into charge and discharge', () => {
    const rows: HaStatRow[] = [
      row('2026-09-24T00:00:00', '2026-09-24T00:05:00', 167),
      row('2026-09-24T00:05:00', '2026-09-24T00:10:00', -2000),
      row('2026-09-24T00:10:00', '2026-09-24T00:15:00', 0.4),
    ]
    const k = integratePowerKwh(rows, '5minute')
    expect(k.samples).toBe(3)
    expect(k.dischargeKwh).toBeCloseTo(0.014, 3)
    expect(k.chargeKwh).toBeCloseTo(0.167, 3)
  })

  it('integrates PV tracker power to kWh', () => {
    const rows: HaStatRow[] = [
      row('2026-09-24T12:00:00', '2026-09-24T13:00:00', 800),
      row('2026-09-24T13:00:00', '2026-09-24T14:00:00', 1200),
    ]
    const k = integratePowerKwh(rows, 'hour')
    expect(k.absKwh).toBeCloseTo(2.0, 5)
  })
})

describe('recorderPowerPlan', () => {
  it('uses 5-minute power only for a single day', () => {
    expect(recorderPowerPlan('day')).toEqual({ period: '5minute', extras: true })
  })

  it('uses hour power for month and year, without PV extras', () => {
    expect(recorderPowerPlan('month')).toEqual({ period: 'hour', extras: false })
    expect(recorderPowerPlan('year')).toEqual({ period: 'hour', extras: false })
  })

  it('skips power statistics when includePower is false', () => {
    expect(recorderPowerPlan('month', false)).toBeNull()
    expect(recorderPowerPlan('day', false)).toBeNull()
  })
})

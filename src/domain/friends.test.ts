import { describe, expect, it } from 'vitest'
import {
  buildShareDays,
  decodeShare,
  encodeShare,
  mergeFriendShare,
  thisMonthKwh,
  type FriendShare,
} from './friends'

describe('friend share codes', () => {
  it('round-trips unicode names (v1)', () => {
    const payload = {
      name: 'Jörg',
      months: [{ year: 2026, month: 9, productionKwh: 212.4 }],
      updatedAt: '2026-09-24T12:00:00.000Z',
    }
    const code = encodeShare(payload)
    expect(code.startsWith('SOLAR1.')).toBe(true)
    const decoded = decodeShare(code)
    expect(decoded?.name).toBe('Jörg')
    expect(decoded?.months[0]?.productionKwh).toBeCloseTo(212.4, 5)
    expect(decoded?.days).toBeUndefined()
  })

  it('round-trips v2 with days', () => {
    const payload = {
      name: 'Anna',
      months: [{ year: 2026, month: 9, productionKwh: 100 }],
      days: [
        { date: '2026-09-24', productionKwh: 12.5 },
        { date: '2026-09-25', productionKwh: 8 },
      ],
      updatedAt: '2026-09-26T10:00:00.000Z',
    }
    const decoded = decodeShare(encodeShare(payload))
    expect(decoded?.days).toEqual(payload.days)
  })

  it('decodes legacy v1 payload without v field', () => {
    const legacy = encodeShare({
      name: 'Alt',
      months: [{ year: 2025, month: 12, productionKwh: 1 }],
      updatedAt: '2025-12-01T00:00:00.000Z',
    })
    expect(decodeShare(legacy)?.name).toBe('Alt')
  })

  it('rejects garbage', () => {
    expect(decodeShare('not-a-code')).toBeNull()
    expect(decodeShare('SOLAR1.!!!')).toBeNull()
  })
})

describe('mergeFriendShare', () => {
  const base: FriendShare = {
    id: 'f-1',
    name: 'Kai',
    updatedAt: '2026-09-20T00:00:00.000Z',
    months: [{ year: 2026, month: 9, productionKwh: 50 }],
    days: [{ date: '2026-09-19', productionKwh: 5 }],
  }

  it('replaces months and days when incoming is newer', () => {
    const incoming = {
      name: 'Kai',
      updatedAt: '2026-09-25T00:00:00.000Z',
      months: [{ year: 2026, month: 9, productionKwh: 80 }],
      days: [{ date: '2026-09-24', productionKwh: 10 }],
    }
    const [row] = mergeFriendShare([base], incoming)
    expect(row?.id).toBe('f-1')
    expect(row?.months[0]?.productionKwh).toBe(80)
    expect(row?.days).toEqual(incoming.days)
  })

  it('keeps existing when incoming is older', () => {
    const incoming = {
      name: 'Kai',
      updatedAt: '2026-09-01T00:00:00.000Z',
      months: [{ year: 2026, month: 9, productionKwh: 1 }],
    }
    const [row] = mergeFriendShare([base], incoming)
    expect(row?.months[0]?.productionKwh).toBe(50)
    expect(row?.days).toEqual(base.days)
  })

  it('adds a new friend by name', () => {
    const rows = mergeFriendShare([base], {
      name: 'Neu',
      updatedAt: '2026-09-26T00:00:00.000Z',
      months: [],
    })
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.name === 'Neu')).toBe(true)
  })
})

describe('buildShareDays', () => {
  it('emits v2 days from month series and manual rows', () => {
    const days = buildShareDays({
      manualDays: [{ date: '2026-09-01', productionKwh: 3, homeKwh: null, selfUseKwh: null, importKwh: null, exportKwh: null, houseInflowKwh: null }],
      periodKind: 'month',
      periodSeries: [
        { t: '2026-09-24T00:00:00.000Z', pvKwh: 12 },
        { t: '2026-09-25T00:00:00.000Z', pvKwh: 8 },
      ],
    })
    expect(days).toEqual([
      { date: '2026-09-01', productionKwh: 3 },
      { date: '2026-09-24', productionKwh: 12 },
      { date: '2026-09-25', productionKwh: 8 },
    ])
    const code = encodeShare({
      name: 'X',
      months: [],
      days,
      updatedAt: '2026-09-26T00:00:00.000Z',
    })
    expect(decodeShare(code)?.days).toEqual(days)
  })

  it('adds today on day view', () => {
    const days = buildShareDays({
      manualDays: [],
      periodKind: 'day',
      todayProductionKwh: 5.5,
    })
    expect(days?.length).toBe(1)
    expect(days?.[0]?.productionKwh).toBe(5.5)
  })
})

describe('thisMonthKwh', () => {
  it('picks the current calendar month', () => {
    const kwh = thisMonthKwh(
      {
        id: '1',
        name: 'A',
        updatedAt: '',
        months: [
          { year: 2026, month: 8, productionKwh: 10 },
          { year: 2026, month: 9, productionKwh: 40 },
        ],
      },
      new Date(2026, 8, 24),
    )
    expect(kwh).toBe(40)
  })
})

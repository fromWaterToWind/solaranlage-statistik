import { describe, expect, it } from 'vitest'
import {
  investedEur,
  lifetimeEconomics,
  newBoughtPart,
  PART_CATALOG,
  paybackForecast,
} from './investment'

describe('investedEur', () => {
  it('sums qty times unit price', () => {
    const nexa = PART_CATALOG.find((p) => p.id === 'nexa-2000')!
    const pv = PART_CATALOG.find((p) => p.id === 'pv-430')!
    const parts = [newBoughtPart(nexa, 1), newBoughtPart(pv, 4)]
    expect(investedEur(parts)).toBeCloseTo(nexa.priceEur + 4 * pv.priceEur, 5)
  })
})

describe('paybackForecast', () => {
  it('reaches rendite when saved covers invest', () => {
    const nexa = PART_CATALOG.find((p) => p.id === 'nexa-2000')!
    const parts = [newBoughtPart(nexa, 1)]
    const f = paybackForecast({
      parts,
      savedEur: nexa.priceEur + 10,
      producedKwh: 4000,
      monthlySavedEur: 40,
    })
    expect(f.stage).toBe('rendite')
    expect(f.progressPct).toBe(100)
    expect(f.monthsLeft).toBe(0)
  })

  it('estimates months left from monthly savings', () => {
    const nexa = PART_CATALOG.find((p) => p.id === 'nexa-2000')!
    const parts = [newBoughtPart(nexa, 1)]
    const f = paybackForecast({
      parts,
      savedEur: 99,
      producedKwh: 400,
      monthlySavedEur: 80,
      now: new Date(2026, 8, 24),
    })
    expect(f.stage).toBe('am-netz')
    expect(f.monthsLeft).toBeCloseTo((nexa.priceEur - 99) / 80, 5)
    expect(f.breakEven?.getFullYear()).toBe(2027)
  })
})

describe('lifetimeEconomics', () => {
  it('does not double-count the live month when it is already in Nachträge', () => {
    const rows = [{ year: 2026, month: 9, savedEur: 40, productionKwh: 200 }]
    const extra = { year: 2026, month: 9, savedEur: 12, productionKwh: 80 }
    const out = lifetimeEconomics(rows, extra, new Date(2026, 8, 24))
    expect(out.savedEur).toBe(40)
    expect(out.producedKwh).toBe(200)
  })
})

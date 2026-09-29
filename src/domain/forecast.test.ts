import { describe, expect, it } from 'vitest'
import {
  buildPvForecastSeries,
  fieldPowerW,
  mergeForecastIntoPowerSeries,
  poaFactorFromGhi,
  totalForecastKwp,
} from './forecast'
import type { NamedPowerSensor } from '@/config/appConfig'

function field(partial: Partial<NamedPowerSensor> & Pick<NamedPowerSensor, 'id'>): NamedPowerSensor {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    entityId: partial.entityId ?? '',
    azimuthDeg: partial.azimuthDeg ?? null,
    tiltDeg: partial.tiltDeg ?? null,
    kWp: partial.kWp ?? null,
    shading: null,
    shadingWhen: null,
  }
}

describe('buildPvForecastSeries', () => {
  it('returns empty when latitude missing', () => {
    expect(
      buildPvForecastSeries(Number.NaN, [field({ id: 'a', kWp: 5, azimuthDeg: 180, tiltDeg: 30 })], [
        { t: '2026-06-01T12:00:00', irradianceWm2: 800 },
      ]),
    ).toEqual([])
  })

  it('skips fields without kWp', () => {
    const noon = new Date(2026, 5, 1, 12, 0, 0)
    const samples = [{ t: noon.toISOString(), irradianceWm2: 1000 }]
    const withKwp = buildPvForecastSeries(
      52,
      [field({ id: 'a', kWp: 10, azimuthDeg: 180, tiltDeg: 30 })],
      samples,
    )
    const without = buildPvForecastSeries(
      52,
      [field({ id: 'a', kWp: null, azimuthDeg: 180, tiltDeg: 30 })],
      samples,
    )
    expect(without).toEqual([])
    expect(withKwp[0].pvWForecast).toBeGreaterThan(5000)
  })

  it('scales roughly linearly with kWp', () => {
    const noon = new Date(2026, 5, 1, 12, 0, 0)
    const samples = [{ t: noon.toISOString(), irradianceWm2: 900 }]
    const five = buildPvForecastSeries(
      50,
      [field({ id: 'a', kWp: 5, azimuthDeg: 180, tiltDeg: 30 })],
      samples,
    )
    const ten = buildPvForecastSeries(
      50,
      [field({ id: 'a', kWp: 10, azimuthDeg: 180, tiltDeg: 30 })],
      samples,
    )
    expect(ten[0].pvWForecast).toBeCloseTo(five[0].pvWForecast * 2, -1)
  })

  it('sums multiple oriented fields', () => {
    const noon = new Date(2026, 5, 1, 12, 0, 0)
    const samples = [{ t: noon.toISOString(), irradianceWm2: 800 }]
    const one = buildPvForecastSeries(
      50,
      [field({ id: 'a', kWp: 4, azimuthDeg: 180, tiltDeg: 30 })],
      samples,
    )
    const two = buildPvForecastSeries(
      50,
      [
        field({ id: 'a', kWp: 4, azimuthDeg: 180, tiltDeg: 30 }),
        field({ id: 'b', kWp: 4, azimuthDeg: 180, tiltDeg: 30 }),
      ],
      samples,
    )
    expect(two[0].pvWForecast).toBeCloseTo(one[0].pvWForecast * 2, -1)
  })
})

describe('fieldPowerW', () => {
  it('returns zero at night factor', () => {
    expect(fieldPowerW(10, 800, 0)).toBe(0)
  })
})

describe('poaFactorFromGhi', () => {
  it('is zero when sun below horizon', () => {
    const night = new Date(2026, 5, 1, 2, 0, 0)
    expect(poaFactorFromGhi(52, night, 180, 30)).toBe(0)
  })
})

describe('mergeForecastIntoPowerSeries', () => {
  it('does not change measured pvW', () => {
    const merged = mergeForecastIntoPowerSeries(
      [{ t: '2026-06-01T10:00:00.000Z', pvW: 1200 }],
      [{ t: '2026-06-01T10:05:00.000Z', pvWForecast: 900 }],
    )
    expect(merged[0].pvW).toBe(1200)
    expect(merged[0].pvForecastW).toBe(900)
  })
})

describe('totalForecastKwp', () => {
  it('ignores null kWp', () => {
    expect(
      totalForecastKwp([
        field({ id: 'a', kWp: 3, azimuthDeg: 180, tiltDeg: 30 }),
        field({ id: 'b', kWp: null, azimuthDeg: 90, tiltDeg: 20 }),
      ]),
    ).toBe(3)
  })
})

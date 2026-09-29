import { describe, expect, it } from 'vitest'
import {
  REFERENCE_DC_VOLTAGE_V,
  angleLossFraction,
  cableLossFraction,
  temperatureLossFraction,
} from './losses'

describe('cableLossFraction', () => {
  it('faults on missing inputs', () => {
    expect(cableLossFraction({ lengthM: 10, sectionMm2: 4 }).fault).toBe('Eingaben fehlen')
    expect(cableLossFraction({}).fault).toBe('Eingaben fehlen')
    expect(cableLossFraction({ lengthM: 0, sectionMm2: 4, currentA: 16, parallelStrings: 1 }).fault).toBe(
      'Eingaben fehlen',
    )
  })

  it('4 mm², 10 m, 16 A, two parallel strings (I²R, round trip)', () => {
    const rString = (2 * 0.0178 * 10) / 4
    const expectedLossW = (16 * 16 * rString) / 2
    const out = cableLossFraction({
      lengthM: 10,
      sectionMm2: 4,
      currentA: 16,
      parallelStrings: 2,
    })
    expect(out.fault).toBeNull()
    expect(out.lossW).toBeCloseTo(expectedLossW, 8)
    expect(out.lossFraction).toBeCloseTo(expectedLossW / (16 * REFERENCE_DC_VOLTAGE_V), 8)
    expect(Number.isFinite(out.lossW)).toBe(true)
    expect(Number.isNaN(out.lossFraction)).toBe(false)
  })
})

describe('temperatureLossFraction', () => {
  it('faults when cell temperature missing', () => {
    expect(temperatureLossFraction({}).fault).toBe('Eingaben fehlen')
  })

  it('uses default gamma −0.37 %/K at 45 °C', () => {
    const out = temperatureLossFraction({ cellTempC: 45 })
    expect(out.fault).toBeNull()
    expect(out.lossFraction).toBeCloseTo(0.37 * 20 / 100, 8)
  })

  it('returns zero loss at or below 25 °C (no negative gain)', () => {
    expect(temperatureLossFraction({ cellTempC: 25 }).lossFraction).toBe(0)
    expect(temperatureLossFraction({ cellTempC: 10 }).lossFraction).toBe(0)
  })
})

describe('angleLossFraction', () => {
  const latitudeDeg = 50
  const tiltDeg = 30
  const at = new Date(2026, 5, 21, 12, 0, 0)

  it('faults on missing inputs', () => {
    expect(angleLossFraction({ azimuthDeg: 180, tiltDeg: 30, latitudeDeg: 50 }).fault).toBe(
      'Eingaben fehlen',
    )
  })

  it('south azimuth beats north at noon (lower loss vs south reference)', () => {
    const south = angleLossFraction({ azimuthDeg: 180, tiltDeg, latitudeDeg, at })
    const north = angleLossFraction({ azimuthDeg: 0, tiltDeg, latitudeDeg, at })
    expect(south.fault).toBeNull()
    expect(north.fault).toBeNull()
    expect(south.lossFraction).toBeLessThan(north.lossFraction)
    expect(north.lossFraction).toBeGreaterThan(0.1)
    expect(Number.isFinite(south.lossFraction)).toBe(true)
    expect(Number.isFinite(north.lossFraction)).toBe(true)
  })
})

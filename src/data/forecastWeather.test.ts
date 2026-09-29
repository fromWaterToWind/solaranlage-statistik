import { describe, expect, it, vi } from 'vitest'
import { fetchDayRadiation, OPEN_METEO_FORECAST_URL } from './forecastWeather'

describe('fetchDayRadiation', () => {
  it('returns empty samples and fault on HTTP error', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const day = new Date(2026, 8, 26)
    const result = await fetchDayRadiation(52.5, 13.4, day, fetchFn)
    expect(result.samples).toEqual([])
    expect(result.fault).toMatch(/503/)
    expect(result.url).toContain(OPEN_METEO_FORECAST_URL)
  })

  it('parses minutely_15 shortwave for today', async () => {
    const day = new Date(2026, 8, 26)
    const prefix = '2026-09-26'
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        minutely_15: {
          time: [`${prefix}T10:00`, `${prefix}T10:15`],
          shortwave_radiation: [400, 500],
        },
      }),
    })
    const result = await fetchDayRadiation(52.5, 13.4, day, fetchFn)
    expect(result.fault).toBeNull()
    expect(result.samples).toHaveLength(2)
    expect(result.samples[0].irradianceWm2).toBe(400)
  })
})

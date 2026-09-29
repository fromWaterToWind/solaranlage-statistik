import type { RadiationSample } from '@/domain/forecast'

/** Open-Meteo forecast API — 15-min shortwave (global horizontal). */
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

/** Open-Meteo archive for past days. */
export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

export interface RadiationFetchResult {
  samples: RadiationSample[]
  fault: string | null
  url: string
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isTodayOrFuture(day: Date, now = new Date()): boolean {
  const a = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return a.getTime() >= b.getTime()
}

function parseMinutely15(payload: unknown, day: Date): RadiationSample[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const minutely = root.minutely_15 as Record<string, unknown> | undefined
  if (!minutely) return []
  const times = minutely.time
  const values = minutely.shortwave_radiation
  if (!Array.isArray(times) || !Array.isArray(values)) return []
  const dayPrefix = ymdLocal(day)
  const out: RadiationSample[] = []
  for (let i = 0; i < times.length; i++) {
    const tRaw = times[i]
    const v = values[i]
    if (typeof tRaw !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) continue
    if (!tRaw.startsWith(dayPrefix)) continue
    out.push({ t: new Date(tRaw).toISOString(), irradianceWm2: Math.max(0, v) })
  }
  return out
}

function parseHourly(payload: unknown, day: Date): RadiationSample[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const hourly = root.hourly as Record<string, unknown> | undefined
  if (!hourly) return []
  const times = hourly.time
  const values = hourly.shortwave_radiation
  if (!Array.isArray(times) || !Array.isArray(values)) return []
  const dayPrefix = ymdLocal(day)
  const out: RadiationSample[] = []
  for (let i = 0; i < times.length; i++) {
    const tRaw = times[i]
    const v = values[i]
    if (typeof tRaw !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) continue
    if (!tRaw.startsWith(dayPrefix)) continue
    out.push({ t: new Date(tRaw).toISOString(), irradianceWm2: Math.max(0, v) })
  }
  return out
}

function buildForecastUrl(lat: number, lon: number, day: Date): string {
  const date = ymdLocal(day)
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'auto',
    start_date: date,
    end_date: date,
    minutely_15: 'shortwave_radiation',
  })
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`
}

function buildArchiveUrl(lat: number, lon: number, day: Date): string {
  const date = ymdLocal(day)
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'auto',
    start_date: date,
    end_date: date,
    hourly: 'shortwave_radiation',
  })
  return `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`
}

export async function fetchDayRadiation(
  lat: number,
  lon: number,
  day: Date,
  fetchFn: typeof fetch = fetch,
): Promise<RadiationFetchResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { samples: [], fault: 'Kein Standort', url: '' }
  }

  const useForecast = isTodayOrFuture(day)
  const url = useForecast ? buildForecastUrl(lat, lon, day) : buildArchiveUrl(lat, lon, day)

  try {
    const res = await fetchFn(url)
    if (!res.ok) {
      return { samples: [], fault: `Wetter: HTTP ${res.status}`, url }
    }
    const json: unknown = await res.json()
    let samples = useForecast ? parseMinutely15(json, day) : parseHourly(json, day)
    if (!samples.length && useForecast) {
      samples = parseHourly(json, day)
    }
    if (!samples.length) {
      return { samples: [], fault: 'Wetter: keine Strahlungswerte', url }
    }
    return { samples, fault: null, url }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Wetter nicht erreichbar'
    return { samples: [], fault: msg, url }
  }
}

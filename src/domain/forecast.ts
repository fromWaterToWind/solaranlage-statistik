import type { NamedPowerSensor } from '@/config/appConfig'

const DEG = Math.PI / 180

export interface RadiationSample {
  /** ISO instant */
  t: string
  /** Global horizontal irradiance W/m² (shortwave / GHI). */
  irradianceWm2: number
}

export interface ForecastPoint {
  t: string
  pvWForecast: number
}

export interface PvForecastField {
  azimuthDeg: number
  tiltDeg: number
  kWp: number
}

function parseFields(pvFields: NamedPowerSensor[]): PvForecastField[] {
  const out: PvForecastField[] = []
  for (const f of pvFields) {
    if (f.kWp == null || f.kWp <= 0) continue
    if (f.azimuthDeg == null || f.tiltDeg == null) continue
    out.push({ azimuthDeg: f.azimuthDeg, tiltDeg: f.tiltDeg, kWp: f.kWp })
  }
  return out
}

/** Solar elevation (deg) and azimuth from north clockwise (deg). Local civil time. */
export function solarPosition(latDeg: number, when: Date): { elevationDeg: number; azimuthDeg: number } {
  const lat = latDeg * DEG
  const n = dayOfYear(when)
  const decl = 23.45 * DEG * Math.sin(((360 / 365) * (284 + n)) * DEG)
  const minutes = when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60
  const ha = ((minutes / 60 - 12) * 15) * DEG

  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, sinEl))) / DEG
  const cosEl = Math.cos(Math.asin(Math.max(-1, Math.min(1, sinEl))))
  const cosAz =
    cosEl > 1e-6
      ? (Math.sin(decl) - Math.sin(lat) * sinEl) / (Math.cos(lat) * cosEl)
      : 0
  let azimuthDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG
  if (Math.sin(ha) > 0) azimuthDeg = 360 - azimuthDeg
  return { elevationDeg, azimuthDeg }
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86_400_000)
}

/**
 * Ratio POA / GHI for a tilted fixed array using horizontal irradiance only.
 */
export function poaFactorFromGhi(
  latDeg: number,
  when: Date,
  azimuthDeg: number,
  tiltDeg: number,
): number {
  const { elevationDeg, azimuthDeg: sunAz } = solarPosition(latDeg, when)
  if (elevationDeg <= 0) return 0
  const el = elevationDeg * DEG
  const sa = sunAz * DEG
  const pa = azimuthDeg * DEG
  const bt = tiltDeg * DEG
  const cosInc =
    Math.sin(el) * Math.cos(bt) + Math.cos(el) * Math.sin(bt) * Math.cos(sa - pa)
  if (cosInc <= 0) return 0
  const sinEl = Math.sin(el)
  if (sinEl < 0.05) return 0
  const beamRatio = Math.min(cosInc / sinEl, 2.5)
  const diffuseOnTilt = (1 + Math.cos(bt)) / 2
  const beamWeight = 0.65
  return beamWeight * beamRatio + (1 - beamWeight) * diffuseOnTilt
}

export function fieldPowerW(
  kWp: number,
  irradianceWm2: number,
  poaFactor: number,
): number {
  if (irradianceWm2 <= 0 || poaFactor <= 0) return 0
  const poa = irradianceWm2 * poaFactor
  return Math.round(kWp * 1000 * (poa / 1000))
}

export function buildPvForecastSeries(
  latitudeDeg: number,
  fields: NamedPowerSensor[],
  radiation: RadiationSample[],
): ForecastPoint[] {
  const parsed = parseFields(fields)
  if (!Number.isFinite(latitudeDeg) || !parsed.length || !radiation.length) return []

  return radiation.map((sample) => {
    const when = new Date(sample.t)
    let pvWForecast = 0
    for (const f of parsed) {
      const factor = poaFactorFromGhi(latitudeDeg, when, f.azimuthDeg, f.tiltDeg)
      pvWForecast += fieldPowerW(f.kWp, sample.irradianceWm2, factor)
    }
    return { t: sample.t, pvWForecast }
  })
}

const BUCKET_MS = 15 * 60_000

function bucketKey(iso: string): number {
  const t = new Date(iso).getTime()
  return Math.floor(t / BUCKET_MS) * BUCKET_MS
}

/** Attach forecast watts to measured 15-min power points (never replaces pvW). */
export function mergeForecastIntoPowerSeries<T extends { t: string; pvW: number }>(
  powerSeries: T[] | undefined,
  forecast: ForecastPoint[],
): T[] {
  if (!powerSeries?.length) return powerSeries ?? []
  if (!forecast.length) return powerSeries

  const byBucket = new Map<number, number>()
  for (const p of forecast) {
    const k = bucketKey(p.t)
    const cur = byBucket.get(k) ?? 0
    byBucket.set(k, Math.max(cur, p.pvWForecast))
  }

  return powerSeries.map((p) => {
    const k = bucketKey(p.t)
    const pvForecastW = byBucket.get(k)
    if (pvForecastW == null || pvForecastW <= 0) return p
    return { ...p, pvForecastW }
  })
}

export function forecastHasSignal(forecast: ForecastPoint[] | undefined): boolean {
  return Boolean(forecast?.some((p) => p.pvWForecast > 0))
}

export function totalForecastKwp(pvFields: NamedPowerSensor[]): number {
  return parseFields(pvFields).reduce((s, f) => s + f.kWp, 0)
}

/** Schätz-Modelle für Kabel / Winkel / Temperatur — nie in EnergyTotals mischen. */

/** Nur für lossFraction = lossW / (I · V); lossW kommt aus I²R. */
export const REFERENCE_DC_VOLTAGE_V = 120

const COPPER_RHO_OHM_MM2_M = 0.0178
const DEFAULT_GAMMA_PCT_PER_K = -0.37
const CELL_TEMP_REF_C = 25
/** Diffus-Anteil in der vereinfachten POA (Klein-ähnlich, isotrop). */
const DIFFUSE_POA_WEIGHT = 0.4

export interface CableLossInput {
  lengthM?: number
  sectionMm2?: number
  currentA?: number
  parallelStrings?: number
}

export interface CableLossResult {
  lossW: number
  lossFraction: number
  fault: string | null
}

export interface AngleLossInput {
  azimuthDeg?: number
  tiltDeg?: number
  latitudeDeg?: number
  at?: Date
}

export interface AngleLossResult {
  lossFraction: number
  fault: string | null
}

export interface TemperatureLossInput {
  cellTempC?: number
  gammaPctPerK?: number
}

export interface TemperatureLossResult {
  lossFraction: number
  fault: string | null
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function cableFault(): CableLossResult {
  return { lossW: 0, lossFraction: 0, fault: 'Eingaben fehlen' }
}

function angleFault(msg: string): AngleLossResult {
  return { lossFraction: 0, fault: msg }
}

function temperatureFault(): TemperatureLossResult {
  return { lossFraction: 0, fault: 'Eingaben fehlen' }
}

/** DC-Rundweg (+/−): R_string = 2ρL/A; Parallelschaltung teilt den Strom. */
export function cableLossFraction(input: CableLossInput): CableLossResult {
  const { lengthM, sectionMm2, currentA, parallelStrings = 1 } = input
  if (
    !isFiniteNumber(lengthM) ||
    !isFiniteNumber(sectionMm2) ||
    !isFiniteNumber(currentA) ||
    !isFiniteNumber(parallelStrings)
  ) {
    return cableFault()
  }
  if (lengthM <= 0 || sectionMm2 <= 0 || currentA <= 0 || parallelStrings < 1) {
    return cableFault()
  }

  const rString = (2 * COPPER_RHO_OHM_MM2_M * lengthM) / sectionMm2
  const lossW = (currentA * currentA * rString) / parallelStrings
  const denom = currentA * REFERENCE_DC_VOLTAGE_V
  const lossFraction = denom > 0 ? lossW / denom : 0

  if (!Number.isFinite(lossW) || !Number.isFinite(lossFraction)) {
    return cableFault()
  }

  return { lossW, lossFraction, fault: null }
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 0)
  const now = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((now - start) / 86_400_000)
}

/** Sonnenstand (Nord=0°, Ost=90°, Süd=180°), Höhe und Azimut in Grad. */
function sunPosition(latitudeDeg: number, at: Date): { altitudeDeg: number; azimuthDeg: number } {
  const lat = (latitudeDeg * Math.PI) / 180
  const n = dayOfYear(at)
  const decl =
    ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365)
  const hour = at.getHours() + at.getMinutes() / 60 + at.getSeconds() / 3600
  const hourAngle = ((hour - 12) * 15 * Math.PI) / 180

  const sinAlt =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const altitudeDeg = (Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180) / Math.PI

  const cosAlt = Math.cos((altitudeDeg * Math.PI) / 180)
  let azimuthDeg = 180
  if (cosAlt > 1e-6) {
    const cosAz =
      (Math.sin(decl) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * cosAlt)
    const az = (Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180) / Math.PI
    azimuthDeg = hourAngle > 0 ? 360 - az : az
  }

  return { altitudeDeg, azimuthDeg }
}

function incidenceCos(
  sunAltDeg: number,
  sunAzDeg: number,
  tiltDeg: number,
  panelAzDeg: number,
): number {
  const alt = (sunAltDeg * Math.PI) / 180
  const tilt = (tiltDeg * Math.PI) / 180
  const azDiff = ((sunAzDeg - panelAzDeg) * Math.PI) / 180
  return (
    Math.sin(alt) * Math.cos(tilt) + Math.cos(alt) * Math.sin(tilt) * Math.cos(azDiff)
  )
}

/**
 * Vereinfachte POA vs. Referenz (Süd 180°, Neigung ≈ Breite):
 * Strahl cos(θi) plus isotrope Diffus (1+cos β)/2 — Verhältnis POA/POA_ref, kein STC.
 */
function poaProxy(
  sunAltDeg: number,
  sunAzDeg: number,
  tiltDeg: number,
  panelAzDeg: number,
): number {
  const cosI = incidenceCos(sunAltDeg, sunAzDeg, tiltDeg, panelAzDeg)
  const beam = Math.max(0, cosI)
  const diffuse = ((1 + Math.cos((tiltDeg * Math.PI) / 180)) / 2) * DIFFUSE_POA_WEIGHT
  return beam + diffuse
}

export function angleLossFraction(input: AngleLossInput): AngleLossResult {
  const { azimuthDeg, tiltDeg, latitudeDeg, at } = input
  if (
    !isFiniteNumber(azimuthDeg) ||
    !isFiniteNumber(tiltDeg) ||
    !isFiniteNumber(latitudeDeg) ||
    !(at instanceof Date) ||
    Number.isNaN(at.getTime())
  ) {
    return angleFault('Eingaben fehlen')
  }
  if (tiltDeg < 0 || tiltDeg > 90) {
    return angleFault('Eingaben fehlen')
  }

  const sun = sunPosition(latitudeDeg, at)
  if (sun.altitudeDeg <= 0) {
    return angleFault('Keine Einstrahlung')
  }

  const refTilt = latitudeDeg
  const refAz = 180
  const poaRef = poaProxy(sun.altitudeDeg, sun.azimuthDeg, refTilt, refAz)
  const poaAct = poaProxy(sun.altitudeDeg, sun.azimuthDeg, tiltDeg, azimuthDeg)

  if (!Number.isFinite(poaRef) || !Number.isFinite(poaAct) || poaRef <= 1e-9) {
    return angleFault('Keine Einstrahlung')
  }

  const lossFraction = Math.max(0, 1 - poaAct / poaRef)
  if (!Number.isFinite(lossFraction)) {
    return angleFault('Eingaben fehlen')
  }

  return { lossFraction, fault: null }
}

/**
 * Leistungsverlust vs. 25 °C; unter Referenztemperatur kein „Gewinn“ (lossFraction = 0).
 */
export function temperatureLossFraction(input: TemperatureLossInput): TemperatureLossResult {
  const { cellTempC, gammaPctPerK = DEFAULT_GAMMA_PCT_PER_K } = input
  if (!isFiniteNumber(cellTempC)) {
    return temperatureFault()
  }
  if (!isFiniteNumber(gammaPctPerK)) {
    return temperatureFault()
  }

  if (cellTempC <= CELL_TEMP_REF_C) {
    return { lossFraction: 0, fault: null }
  }

  const lossFraction = Math.max(0, (-gammaPctPerK * (cellTempC - CELL_TEMP_REF_C)) / 100)
  if (!Number.isFinite(lossFraction)) {
    return temperatureFault()
  }

  return { lossFraction, fault: null }
}

import type { GrowattDayPoint } from './growatt'
import type { BatteryPartLive, LiveSnapshot, MpptLive } from '@/domain/types'

export const GRID_METER_MISSING = 'Zähler fehlt'

export function newestGrowattPoint(points: GrowattDayPoint[]): GrowattDayPoint | null {
  if (!points.length) return null
  return points.reduce((latest, p) =>
    new Date(p.t).getTime() >= new Date(latest.t).getTime() ? p : latest,
  )
}

function mpptsFromGrowattPoint(point: GrowattDayPoint): MpptLive[] {
  const ids = new Set([...Object.keys(point.mpptW), ...Object.keys(point.mpptTempC ?? {})])
  return [...ids].map((id) => ({
    id,
    name: id.toUpperCase(),
    powerW: point.mpptW[id] ?? 0,
    fault: null,
    tempC: point.mpptTempC?.[id] ?? null,
    tempFault: point.mpptTempC?.[id] != null ? null : null,
  }))
}

function growattHasCtMeter(point: GrowattDayPoint): boolean {
  if (point.ctFlag === 1) return true
  if (point.ctFlag === 0) return false
  return point.gridW != null
}

function gridFromGrowattPoint(point: GrowattDayPoint): LiveSnapshot['grid'] {
  if (!growattHasCtMeter(point)) {
    return { importW: 0, exportW: 0, fault: GRID_METER_MISSING }
  }
  const gridW = point.gridW ?? 0
  return {
    importW: Math.max(0, gridW),
    exportW: Math.max(0, -gridW),
    fault: null,
  }
}

export function liveSnapshotFromGrowattPoint(
  point: GrowattDayPoint,
  opts?: { grid?: LiveSnapshot['grid']; at?: string },
): LiveSnapshot {
  const mppts = mpptsFromGrowattPoint(point)

  const outputW = point.outputW ?? 0

  let chargeW = 0
  let dischargeW = 0
  let battFault: string | null = point.fault ?? null
  if (point.batteryW != null) {
    if (point.batteryW < 0) chargeW = -point.batteryW
    else if (point.batteryW > 0) dischargeW = point.batteryW
  } else if (!battFault) {
    battFault = 'Keine Batterieleistung'
  }

  let socPercent = 0
  let socFault: string | null = null
  if (point.socPercent != null && Number.isFinite(point.socPercent)) {
    socPercent = point.socPercent
  } else {
    socFault = 'Kein SOC'
  }

  const parts: BatteryPartLive[] = Object.entries(point.socById ?? {}).map(([id, s]) => {
    const tempC = point.tempByPack?.[id] ?? null
    return {
      id,
      name: id,
      socPercent: s ?? 0,
      socFault: s == null ? 'Kein SOC' : null,
      tempC,
      tempFault: tempC == null ? 'Keine Temperatur' : null,
    }
  })

  let homeW = 0
  let homeFault: string | null = null
  if (point.homeW != null) {
    homeW = point.homeW
  } else {
    homeFault = 'Keine Hauslast'
  }

  const grid = opts?.grid ?? gridFromGrowattPoint(point)

  return {
    at: opts?.at ?? point.t,
    mppts,
    pvW: point.pvW,
    pvFault: null,
    homeW,
    homeFault,
    outputW,
    battery: {
      socPercent,
      socFault,
      chargeW,
      dischargeW,
      fault: battFault,
      parts,
    },
    grid,
  }
}

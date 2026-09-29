import { describe, expect, it } from 'vitest'
import {
  GRID_METER_MISSING,
  liveSnapshotFromGrowattPoint,
  newestGrowattPoint,
} from './growattLive'
import { parseGrowattHistory } from './growatt'

describe('newestGrowattPoint', () => {
  it('picks the latest sample by timestamp', () => {
    const points = parseGrowattHistory({
      code: 0,
      data: {
        datas: [
          { time: '2026-08-01 10:00:00', ppv: 100 },
          { time: '2026-08-01 12:00:00', ppv: 500 },
        ],
      },
    })
    expect(newestGrowattPoint(points)?.pvW).toBe(500)
  })
})

describe('liveSnapshotFromGrowattPoint', () => {
  it('maps Nexa history row to live watts and faults without grid meter', () => {
    const [point] = parseGrowattHistory({
      code: 0,
      data: {
        datas: [
          {
            timeStr: '2026-09-09 12:00:00',
            ppv: 800,
            ppv1: 500,
            ppv2: 300,
            pac: -815,
            totalBatteryPackChargingPower: 200,
            totalBatteryPackSoc: 55,
            totalHouseholdLoad: 600,
          },
        ],
      },
    })
    const live = liveSnapshotFromGrowattPoint(point)
    expect(live.pvW).toBe(800)
    expect(live.outputW).toBe(815)
    expect(live.homeW).toBe(600)
    expect(live.battery.chargeW).toBe(200)
    expect(live.battery.dischargeW).toBe(0)
    expect(live.battery.socPercent).toBe(55)
    expect(live.grid.fault).toBe(GRID_METER_MISSING)
    expect(live.grid.importW).toBe(0)
  })

  it('uses HA grid when passed in opts', () => {
    const live = liveSnapshotFromGrowattPoint(
      { t: new Date().toISOString(), pvW: 0, mpptW: {} },
      { grid: { importW: 120, exportW: 0, fault: null } },
    )
    expect(live.grid.importW).toBe(120)
    expect(live.grid.fault).toBeNull()
  })

  it('maps Nexa fixture to export/import from ctSelfPower when ctFlag is 1', () => {
    const [point] = parseGrowattHistory({
      code: 0,
      data: {
        datas: [
          {
            timeStr: '2026-09-09 05:10:24',
            ppv: 0,
            pac: -49,
            totalBatteryPackChargingPower: -49,
            totalBatteryPackSoc: 17,
            totalHouseholdLoad: 18,
            ctSelfPower: -31,
            ctFlag: 1,
            battery1SerialNum: 'X',
            battery1Soc: 10,
            battery1Temp: 32,
          },
        ],
      },
    })
    const live = liveSnapshotFromGrowattPoint(point)
    expect(live.grid.exportW).toBe(31)
    expect(live.grid.importW).toBe(0)
    expect(live.grid.fault).toBeNull()
    expect(live.battery.dischargeW).toBe(49)
    expect(live.battery.parts[0]?.tempC).toBe(32)
  })

  it('infers CT from gridW when ctFlag is missing (legacy cache)', () => {
    const live = liveSnapshotFromGrowattPoint({
      t: new Date().toISOString(),
      pvW: 0,
      mpptW: {},
      gridW: -31,
    })
    expect(live.grid.exportW).toBe(31)
    expect(live.grid.importW).toBe(0)
    expect(live.grid.fault).toBeNull()
  })

  it('reports missing grid meter when ctFlag is 0', () => {
    const live = liveSnapshotFromGrowattPoint({
      t: new Date().toISOString(),
      pvW: 0,
      mpptW: {},
      ctFlag: 0,
      gridW: -31,
    })
    expect(live.grid.fault).toBe(GRID_METER_MISSING)
  })
})

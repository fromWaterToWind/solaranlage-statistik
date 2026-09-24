import { describe, expect, it } from 'vitest'
import {
  applyGrowattDay,
  explainGrowattPayload,
  growattHistoryForm,
  growattSnForDate,
  matchDeviceType,
  mergeGrowattPv,
  otherGrowattSns,
  parseDeviceList,
  parseGrowattChart,
  parseGrowattHistory,
} from './growatt'
import type { PowerPoint } from '@/domain/types'

describe('parseGrowattHistory', () => {
  it('reads 3-minute datas rows in watts', () => {
    const points = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [
          { time: '2026-08-01 12:00:00', ppv: '1400', ppv1: '800', ppv2: '600' },
          { time: '2026-08-01 12:03:00', ppv: '1500', ppv1: '900', ppv2: '600' },
        ],
      },
    })
    expect(points).toHaveLength(2)
    expect(points[0].pvW).toBe(1400)
    expect(points[0].mpptW.pv1).toBe(800)
    expect(points[1].pvW).toBe(1500)
  })

  it('reads Noah watts and PV strings as I×V', () => {
    const points = parseGrowattHistory({
      code: 0,
      data: {
        datas: [
          {
            time: '2026-08-01 12:00:00',
            ppv: 246,
            pv1Current: 8,
            pv1Voltage: 30,
            pv2Current: 2,
            pv2Voltage: 50,
          },
        ],
      },
    })
    expect(points).toHaveLength(1)
    expect(points[0].pvW).toBe(246)
    expect(points[0].mpptW.pv1).toBe(240)
    expect(points[0].mpptW.pv2).toBe(100)
  })

  it('maps Nexa history fields without treating pac as PV', () => {
    const points = parseGrowattHistory({
      code: 0,
      data: {
        datas: [
          {
            deviceSn: '0HVRD0ZR247T000V',
            time: 1788969549000,
            pac: -120.0,
            ppv: 0.0,
            totalBatteryPackChargingPower: -120,
            totalBatteryPackSoc: 44,
            battery1SerialNum: '0HVRD0ZR247T000V',
            battery1Soc: 41,
            battery2SerialNum: '0PVP00ED26UT01XH',
            battery2Soc: 50,
            battery3SerialNum: '0PVP00ED26UT03E9',
            battery3Soc: 41,
            battery4SerialNum: '',
            battery4Soc: 0,
            totalHouseholdLoad: 83.0,
            ctSelfPower: -37.0,
            pv1Voltage: 7.04,
            pv1Current: 0.0,
            pv2Voltage: 7.06,
            pv2Current: 0.1,
            pv3Voltage: 7.07,
            pv3Current: 0.0,
            timeStr: '2026-09-09 23:59:09',
          },
        ],
      },
    })
    expect(points).toHaveLength(1)
    expect(points[0].pvW).toBe(0)
    expect(points[0].homeW).toBe(83)
    expect(points[0].batteryW).toBe(120)
    expect(points[0].gridW).toBe(-37)
    expect(points[0].socPercent).toBe(44)
    expect(points[0].socById).toEqual({ b1: 41, b2: 50, b3: 41 })
    expect(points[0].mpptW).toEqual({})
    const when = new Date(points[0].t)
    expect(when.getHours()).toBe(23)
    expect(when.getMinutes()).toBe(59)
    expect(when.getDate()).toBe(9)
  })

  it('reads new-api envelope with code 0', () => {
    const points = parseGrowattHistory({
      code: 0,
      message: 'SUCCESSFUL_OPERATION',
      data: {
        datas: [{ time: '2026-08-01 12:00:00', ppv: 1400, ppv1: 800, ppv2: 600 }],
      },
    })
    expect(points).toHaveLength(1)
    expect(points[0].pvW).toBe(1400)
  })

  it('reads history keyed by device serial', () => {
    const points = parseGrowattHistory({
      code: 0,
      data: {
        '0hvrd0zr247t000v': [{ time: '2026-08-01 12:00:00', ppv: 900, ppv1: 500, ppv2: 400 }],
      },
    })
    expect(points).toHaveLength(1)
    expect(points[0].pvW).toBe(900)
  })

  it('reads unix timestamps without inventing a date', () => {
    const points = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [{ time: 1754049600000, ppv: 800 }],
      },
    })
    expect(points).toHaveLength(1)
    expect(points[0].pvW).toBe(800)
    expect(Number.isNaN(new Date(points[0].t).getTime())).toBe(false)
  })

  it('rejects new-api error payloads instead of inventing watts', () => {
    expect(parseGrowattHistory({ code: 2, message: 'Invalid Secret Token', data: null })).toEqual([])
  })

  it('reads getNoahHistory obj.datas', () => {
    const points = parseGrowattHistory({
      result: 1,
      obj: {
        datas: [{ time: '2026-08-01 12:00:00', ppv: 246, pv1Current: 8, pv1Voltage: 30 }],
      },
    })
    expect(points).toHaveLength(1)
    expect(points[0].pvW).toBe(246)
    expect(points[0].mpptW.pv1).toBe(240)
  })
})

describe('parseDeviceList', () => {
  it('reads camelCase v4 list and matches SN case-insensitively', () => {
    const devices = parseDeviceList({
      code: 0,
      data: {
        data: [
          { deviceSn: '0HVRD0ZR247T000V', deviceType: 'sph-s' },
          { deviceSn: 'OTHER', deviceType: 'min' },
        ],
      },
    })
    expect(devices).toHaveLength(2)
    expect(matchDeviceType(devices, '0hvrd0zr247t000v')?.type).toBe('sph-s')
  })

  it('maps numeric SPH type 17', () => {
    const devices = parseDeviceList({
      data: { devices: [{ device_sn: '0hvrd0zr247t000v', type: 17 }] },
    })
    expect(matchDeviceType(devices, '0hvrd0zr247t000v')?.type).toBe('sph')
  })
})

describe('parseGrowattChart', () => {
  it('reads Nexa APP obj keyed by clock time as watts', () => {
    const points = parseGrowattChart(
      {
        result: 1,
        obj: {
          '12:00': { ppv: 1400, pac: 0 },
          '12:05': { ppv: 191 },
        },
      },
      '2026-08-01',
    )
    expect(points).toHaveLength(2)
    expect(points[0].pvW).toBe(1400)
    expect(points[1].pvW).toBe(191)
    expect(new Date(points[0].t).getHours() + new Date(points[0].t).getMinutes()).toBeGreaterThanOrEqual(0)
  })
})

describe('explainGrowattPayload', () => {
  it('does not render Growatt: with a blank message', () => {
    expect(explainGrowattPayload({ result: 0, msg: '' })).toMatch(/result=0/)
    expect(explainGrowattPayload({ result: 0, msg: '' })).toMatch(/keine Meldung/)
    expect(explainGrowattPayload({ result: 0, msg: '' })).not.toBe('')
  })
})

describe('mergeGrowattPv', () => {
  it('fills empty HA buckets and keeps existing watts', () => {
    const ha: PowerPoint[] = [
      { t: '2026-08-01T10:00:00.000Z', pvW: 0, homeW: 200, batteryW: 0, gridW: 0, mpptW: { pv1: 0 } },
      { t: '2026-08-01T10:15:00.000Z', pvW: 900, homeW: 200, batteryW: 0, gridW: 0, mpptW: { pv1: 900 } },
    ]
    const g = parseGrowattHistory({
      data: {
        datas: [
          { time: '2026-08-01T10:00:00.000Z', ppv: 400, ppv1: 400 },
          { time: '2026-08-01T10:03:00.000Z', ppv: 500, ppv1: 500 },
          { time: '2026-08-01T10:15:00.000Z', ppv: 50, ppv1: 50 },
        ],
      },
    })
    const merged = mergeGrowattPv(ha, g)
    expect(merged[0].pvW).toBe(450)
    expect(merged[1].pvW).toBe(900)
  })

  it('fills empty home and SOC and keeps HA values', () => {
    const ha: PowerPoint[] = [
      {
        t: '2026-09-09T21:45:00.000Z',
        pvW: 0,
        homeW: 0,
        batteryW: 0,
        gridW: 0,
        socPercent: null,
        socById: { b1: null },
      },
      {
        t: '2026-09-09T22:00:00.000Z',
        pvW: 0,
        homeW: 200,
        batteryW: 50,
        gridW: -10,
        socPercent: 80,
        socById: { b1: 79 },
      },
    ]
    const g = parseGrowattHistory({
      code: 0,
      data: {
        datas: [
          {
            time: '2026-09-09T21:50:00.000Z',
            ppv: 0,
            totalHouseholdLoad: 83,
            totalBatteryPackChargingPower: -120,
            ctSelfPower: -37,
            totalBatteryPackSoc: 44,
            battery1SerialNum: 'X',
            battery1Soc: 41,
          },
        ],
      },
    })
    const merged = mergeGrowattPv(ha, g)
    expect(merged[0].homeW).toBe(83)
    expect(merged[0].batteryW).toBe(120)
    expect(merged[0].gridW).toBe(-37)
    expect(merged[0].socPercent).toBe(44)
    expect(merged[0].socById?.b1).toBe(41)
    expect(merged[1].homeW).toBe(200)
    expect(merged[1].batteryW).toBe(50)
    expect(merged[1].socPercent).toBe(80)
  })
})

describe('growattHistoryForm', () => {
  it('sends Postman fields and ignores ping type sph-s', () => {
    expect(
      growattHistoryForm(
        { token: 'x', deviceSn: '0HVRD0ZR247T000V', plantId: '', deviceType: 'sph-s' },
        new Date(2026, 8, 9),
      ),
    ).toEqual({
      deviceSn: '0HVRD0ZR247T000V',
      deviceType: 'noah',
      date: '2026-09-09',
    })
  })

  it('uses the Noah SN before 02.09.2026 and the Nexa from that day', () => {
    const cfg = {
      token: 'x',
      deviceSn: '0HVRD0ZR247T000V',
      plantId: '',
      extraDeviceSn: 'OLDNOAH123',
      nexaFrom: '2026-09-02',
    }
    expect(growattSnForDate(cfg, new Date(2026, 8, 1))).toBe('OLDNOAH123')
    expect(growattHistoryForm(cfg, new Date(2026, 8, 1)).deviceSn).toBe('OLDNOAH123')
    expect(growattSnForDate(cfg, new Date(2026, 8, 2))).toBe('0HVRD0ZR247T000V')
    expect(growattHistoryForm(cfg, new Date(2026, 8, 9)).deviceSn).toBe('0HVRD0ZR247T000V')
  })
})

describe('otherGrowattSns', () => {
  it('picks the other noah, not the Nexa', () => {
    expect(
      otherGrowattSns(
        [
          { sn: '0HVRD0ZR247T000V', type: 'noah' },
          { sn: 'OLDNOAH123', type: 'noah' },
        ],
        '0HVRD0ZR247T000V',
      ),
    ).toEqual(['OLDNOAH123'])
  })
})

describe('applyGrowattDay', () => {
  it('builds a day curve when HA has no power series', () => {
    const g = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [{ time: '2026-08-01 12:00:00', ppv: 400, ppv1: 400 }],
      },
    })
    const series = applyGrowattDay(undefined, g, new Date(2026, 7, 1))
    expect(series.length).toBeGreaterThan(0)
    const noon = series.find((p) => new Date(p.t).getHours() === 12 && new Date(p.t).getMinutes() === 0)
    expect(noon?.pvW).toBe(400)
  })
})

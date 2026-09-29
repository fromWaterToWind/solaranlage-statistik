import { describe, expect, it, vi, beforeEach } from 'vitest'
import { defaultConfig } from '@/config/appConfig'
import { CompositeEnergySource } from './compositeSource'
import { GRID_METER_MISSING } from './growattLive'
import { parseGrowattHistory, type GrowattDayPoint } from './growatt'
import * as growattStore from './growattStore'
import * as growatt from './growatt'

vi.mock('./haConn', () => ({
  canUseParentHass: () => false,
}))

function slot(iso: string, pvW: number): GrowattDayPoint {
  return { t: iso, pvW, mpptW: {} }
}

describe('CompositeEnergySource without HA', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('getLive ohne Growatt-Punkte zeigt Faults statt gesunder Nullen', async () => {
    vi.spyOn(growatt, 'fetchGrowattDay').mockResolvedValue([])
    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    const src = new CompositeEnergySource(config)
    const live = await src.getLive()
    expect(live.grid.fault).toBe(GRID_METER_MISSING)
    expect(live.pvFault).toBe('Keine PV-Leistung')
    expect(live.homeFault).toBe('Keine Hauslast')
  })

  it('getLive mit defaultConfig übernimmt PV, WR-AC und Speicher aus Growatt', async () => {
    const points = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [
          {
            time: '2026-08-01 12:00:00',
            ppv: 500,
            ppv1: 500,
            pac: -320,
            totalBatteryPackChargingPower: -80,
            totalBatteryPackSoc: 62,
          },
        ],
      },
    })
    vi.spyOn(growatt, 'fetchGrowattDay').mockResolvedValue(points)
    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    config.growatt.deviceSn = 'SN1'
    const src = new CompositeEnergySource(config)
    const live = await src.getLive()
    expect(live.pvW).toBe(500)
    expect(live.pvFault).toBeNull()
    expect(live.outputW).toBe(320)
    expect(live.battery.socPercent).toBe(62)
    expect(live.battery.dischargeW).toBe(80)
    expect(live.grid.fault).toBe(GRID_METER_MISSING)
  })

  it('getLive with CT history shows grid export without GRID_METER_MISSING', async () => {
    const points = parseGrowattHistory({
      error_code: 0,
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
          },
        ],
      },
    })
    vi.spyOn(growatt, 'fetchGrowattDay').mockResolvedValue(points)
    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    const live = await new CompositeEnergySource(config).getLive()
    expect(live.grid.exportW).toBe(31)
    expect(live.grid.importW).toBe(0)
    expect(live.grid.fault).toBeNull()
    expect(live.homeW).toBe(18)
  })

  it('day totals from Growatt Δt (400 W × 1 h = 0.4 kWh)', async () => {
    const date = new Date(2026, 5, 15)
    const day = '2026-06-15'
    const points = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [
          { time: '2026-06-15 10:00:00', ppv: 400 },
          { time: '2026-06-15 11:00:00', ppv: 400 },
        ],
      },
    })
    vi.spyOn(growattStore, 'getGrowattDay').mockResolvedValue({ day, sn: 'sn', points, fetchedAt: '' })
    vi.spyOn(growatt, 'fetchGrowattDay').mockResolvedValue(points)

    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    config.growatt.deviceSn = 'SN1'
    const src = new CompositeEnergySource(config)
    const stats = await src.getPeriod('day', date)
    expect(stats.totals.productionKwh).toBeCloseTo(0.4, 3)
    expect(stats.powerSeries?.some((p) => p.pvW > 0)).toBe(true)
  })

  it('day totals integrate home load over time', async () => {
    const date = new Date(2026, 8, 9)
    const points = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [
          {
            timeStr: '2026-09-09 05:10:24',
            ppv: 0,
            totalHouseholdLoad: 18,
            ctFlag: 1,
            ctSelfPower: -31,
          },
          {
            timeStr: '2026-09-09 05:13:24',
            ppv: 0,
            totalHouseholdLoad: 18,
            ctFlag: 1,
            ctSelfPower: -31,
          },
        ],
      },
    })
    vi.spyOn(growattStore, 'getGrowattDay').mockResolvedValue({
      day: '2026-09-09',
      sn: 'sn',
      points,
      fetchedAt: '',
    })
    vi.spyOn(growatt, 'fetchGrowattDay').mockResolvedValue(points)
    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    const stats = await new CompositeEnergySource(config).getPeriod('day', date)
    expect(stats.totals.homeKwh).toBeGreaterThan(0)
  })

  it('month sums only cached Growatt days', async () => {
    const date = new Date(2026, 5, 1)
    vi.spyOn(growattStore, 'listGrowattDays').mockResolvedValue(['2026-06-10', '2026-06-12', '2026-07-01'])
    vi.spyOn(growattStore, 'getGrowattDay').mockImplementation(async (day) => {
      if (day === '2026-06-10') {
        return {
          day,
          sn: 'sn',
          fetchedAt: '',
          points: [
            slot('2026-06-10T10:00:00.000Z', 1000),
            slot('2026-06-10T10:03:00.000Z', 1000),
          ],
        }
      }
      if (day === '2026-06-12') {
        return {
          day,
          sn: 'sn',
          fetchedAt: '',
          points: [
            slot('2026-06-12T10:00:00.000Z', 2000),
            slot('2026-06-12T10:03:00.000Z', 2000),
          ],
        }
      }
      return null
    })

    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    const src = new CompositeEnergySource(config)
    const stats = await src.getPeriod('month', date)
    expect(stats.series).toHaveLength(2)
    expect(stats.totals.productionKwh).toBeGreaterThan(0)
    expect(stats.growattNote).toMatch(/2 Tage/)
  })

  it('month series omits outputKwh (totals may still sum WR-AC)', async () => {
    const date = new Date(2026, 5, 1)
    const withPac = parseGrowattHistory({
      error_code: 0,
      data: {
        datas: [
          { time: '2026-06-10 12:00:00', ppv: 4000, pac: -2000 },
          { time: '2026-06-10 12:03:00', ppv: 4000, pac: -2000 },
        ],
      },
    })
    vi.spyOn(growattStore, 'listGrowattDays').mockResolvedValue(['2026-06-10'])
    vi.spyOn(growattStore, 'getGrowattDay').mockResolvedValue({
      day: '2026-06-10',
      sn: 'sn',
      fetchedAt: '',
      points: withPac,
    })
    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    config.growatt.token = 'tok'
    const stats = await new CompositeEnergySource(config).getPeriod('month', date)
    expect(stats.series).toHaveLength(1)
    expect(stats.series[0].outputKwh ?? 0).toBe(0)
    expect(stats.totals.outputKwh).toBeGreaterThan(0)
  })
})

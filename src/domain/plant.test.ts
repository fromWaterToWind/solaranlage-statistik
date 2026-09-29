import { describe, expect, it } from 'vitest'
import { defaultConfig, type AppConfig } from '@/config/appConfig'
import { plantFromConfig } from './plant'

function withConfig(patch: (c: AppConfig) => void): AppConfig {
  const c = defaultConfig()
  patch(c)
  return c
}

describe('plantFromConfig — default Nexa setup', () => {
  it('maps defaultConfig to topology A with four bound slots', () => {
    const plant = plantFromConfig(defaultConfig())
    expect(plant.topology).toBe('A')
    expect(plant.pv).toEqual({ adapter: 'growatt', via: 'haEntity' })
    expect(plant.storage).toEqual({ adapter: 'growatt', via: 'haEntity' })
    expect(plant.inverterAc).toEqual({ adapter: 'shelly', via: 'haEntity' })
    expect(plant.grid).toEqual({ adapter: 'ecotracker', via: 'haEntity' })
  })

  it('uses growattApi for pv and storage when token is set', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.growatt.token = 'secret-token'
      }),
    )
    expect(plant.pv).toEqual({ adapter: 'growatt', via: 'growattApi' })
    expect(plant.storage).toEqual({ adapter: 'growatt', via: 'growattApi' })
  })

  it('uses growattApi for inverter AC when token is set and no Shelly entities', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.growatt.token = 'secret-token'
        c.entities.garagePower = ''
        c.entities.homeToday = ''
      }),
    )
    expect(plant.inverterAc).toEqual({ adapter: 'growatt', via: 'growattApi' })
  })
})

describe('plantFromConfig — topology', () => {
  it('is C when no storage signals remain', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.batteryCapacityKwh = null
        c.growatt = { token: '', deviceSn: '', plantId: '', deviceType: '', extraDeviceSn: '' }
        c.entities.soc = ''
        c.entities.batteryPower = ''
        c.batteryParts = []
      }),
    )
    expect(plant.topology).toBe('C')
    expect(plant.storage).toBeNull()
  })

  it('is B when storage HA entities exist but not as Growatt all-in-one', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.batteryCapacityKwh = null
        c.growatt = { token: '', deviceSn: '', plantId: '', deviceType: '', extraDeviceSn: '' }
        c.entities.soc = 'sensor.generic_battery_soc'
        c.entities.batteryPower = 'sensor.generic_battery_power'
        c.batteryParts = []
      }),
    )
    expect(plant.topology).toBe('B')
    expect(plant.storage).toEqual({ adapter: 'homeAssistant', via: 'haEntity' })
  })

  it('is A when only batteryCapacityKwh is set', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.batteryCapacityKwh = 10.5
        c.growatt.deviceSn = ''
        c.entities.soc = ''
        c.entities.batteryPower = ''
        c.batteryParts = []
      }),
    )
    expect(plant.topology).toBe('A')
  })
})

describe('plantFromConfig — slot heuristics', () => {
  it('pv falls back to homeAssistant when Growatt block is empty but solar entities exist', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.growatt = { token: '', deviceSn: '', plantId: '', deviceType: '', extraDeviceSn: '' }
        c.entities.solarPower = 'sensor.other_inverter_solar'
        c.entities.generationToday = ''
        c.entities.soc = 'sensor.other_battery_soc'
        c.entities.batteryPower = 'sensor.other_battery_power'
      }),
    )
    expect(plant.pv).toEqual({ adapter: 'homeAssistant', via: 'haEntity' })
  })

  it('inverterAc uses homeAssistant for non-Shelly garage entities', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.entities.garagePower = 'sensor.inverter_ac_power'
        c.entities.homeToday = 'sensor.inverter_ac_today'
      }),
    )
    expect(plant.inverterAc).toEqual({ adapter: 'homeAssistant', via: 'haEntity' })
  })

  it('grid uses homeAssistant when meter entities are not EcoTracker', () => {
    const plant = plantFromConfig(
      withConfig((c) => {
        c.entities.gridPower = 'sensor.smart_meter_power'
        c.entities.importToday = 'sensor.smart_meter_import'
        c.entities.exportToday = 'sensor.smart_meter_export'
      }),
    )
    expect(plant.grid).toEqual({ adapter: 'homeAssistant', via: 'haEntity' })
  })
})

import { describe, expect, it, vi, afterEach } from 'vitest'
import { defaultConfig } from '@/config/appConfig'
import { CompositeEnergySource } from './compositeSource'
import { HomeAssistantEnergySource } from './ha'
import { MockEnergySource } from './mock'
import { createEnergySource, isHaConfigured } from './source'

vi.mock('./haConn', () => ({
  canUseParentHass: () => false,
}))

describe('isHaConfigured', () => {
  it('is false without HA URL and token', () => {
    const config = defaultConfig()
    config.haUrl = ''
    config.haToken = ''
    expect(isHaConfigured(config)).toBe(false)
  })

  it('is false with only URL or only token', () => {
    const config = defaultConfig()
    config.haUrl = 'http://ha.local'
    config.haToken = ''
    expect(isHaConfigured(config)).toBe(false)
    config.haToken = 'token'
    config.haUrl = ''
    expect(isHaConfigured(config)).toBe(false)
  })

  it('is true when haUrl and haToken are set', () => {
    const config = defaultConfig()
    config.haUrl = 'http://ha.local'
    config.haToken = 'secret'
    expect(isHaConfigured(config)).toBe(true)
  })
})

describe('createEnergySource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns MockEnergySource when demo=1 in dev', () => {
    vi.stubGlobal('window', {
      location: { search: '?demo=1' },
    })
    const src = createEnergySource(defaultConfig())
    expect(src).toBeInstanceOf(MockEnergySource)
  })

  it('returns CompositeEnergySource when Growatt token is set', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const config = defaultConfig()
    config.growatt.token = 'secret'
    const src = createEnergySource(config)
    expect(src).toBeInstanceOf(CompositeEnergySource)
  })

  it('returns CompositeEnergySource without Growatt token and without HA', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const config = defaultConfig()
    config.growatt.token = ''
    config.haUrl = ''
    config.haToken = ''
    const src = createEnergySource(config)
    expect(src).toBeInstanceOf(CompositeEnergySource)
  })

  it('returns HomeAssistantEnergySource when HA is configured without Growatt', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const config = defaultConfig()
    config.growatt.token = ''
    config.haUrl = 'http://ha.local'
    config.haToken = 'token'
    const src = createEnergySource(config)
    expect(src).toBeInstanceOf(HomeAssistantEnergySource)
  })
})

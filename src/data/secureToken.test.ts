import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGrowattTokenInConfigBlob } from './secureToken'

const CONFIG_STORAGE_KEY = 'solar-statistik-config-v1'

function mockLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    get length() {
      return store.size
    },
    key: (_i: number) => null,
  })
  return store
}

describe('secureToken (web)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    mockLocalStorage()
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => false },
    }))
  })

  it('reads growatt token from config blob when not native', async () => {
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({ growatt: { token: 'web-secret', deviceSn: 'X' } }),
    )
    const { getGrowattToken: get } = await import('./secureToken')
    await expect(get()).resolves.toBe('web-secret')
  })

  it('clearGrowattTokenInConfigBlob strips token only', () => {
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({
        haUrl: 'https://ha.local',
        growatt: { token: 'migrate-me', deviceSn: 'SN' },
      }),
    )
    clearGrowattTokenInConfigBlob()
    const parsed = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY)!) as {
      haUrl: string
      growatt: { token: string; deviceSn: string }
    }
    expect(parsed.haUrl).toBe('https://ha.local')
    expect(parsed.growatt.deviceSn).toBe('SN')
    expect(parsed.growatt.token).toBe('')
  })
})

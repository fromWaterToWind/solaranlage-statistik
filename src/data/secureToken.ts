import { Capacitor } from '@capacitor/core'

/** Must match `STORAGE_KEY` in appConfig — avoid importing appConfig (cycle). */
const CONFIG_STORAGE_KEY = 'solar-statistik-config-v1'

const GROWATT_TOKEN_KEY = 'growatt.api.token'

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

function readTokenFromConfigBlob(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { growatt?: { token?: unknown } }
    return typeof parsed.growatt?.token === 'string' ? parsed.growatt.token : ''
  } catch {
    return ''
  }
}

/** Clears growatt.token in the localStorage config blob (native migration / save). */
export function clearGrowattTokenInConfigBlob(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const growatt = parsed.growatt
    if (!growatt || typeof growatt !== 'object') return
    const g = { ...(growatt as Record<string, unknown>), token: '' }
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ ...parsed, growatt: g }))
  } catch {
    /* ignore */
  }
}

async function readNativeToken(): Promise<string> {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
  const value = await SecureStorage.getItem(GROWATT_TOKEN_KEY)
  return value ?? ''
}

async function writeNativeToken(token: string): Promise<void> {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
  if (token.trim()) {
    await SecureStorage.setItem(GROWATT_TOKEN_KEY, token)
  } else {
    await SecureStorage.removeItem(GROWATT_TOKEN_KEY)
  }
}

/**
 * Growatt API token: iOS Keychain on native; config JSON in localStorage on web (HACS panel).
 */
export async function getGrowattToken(): Promise<string> {
  if (!isNativePlatform()) {
    return readTokenFromConfigBlob()
  }

  const fromKeychain = await readNativeToken()
  if (fromKeychain.trim()) return fromKeychain

  const legacy = readTokenFromConfigBlob()
  if (!legacy.trim()) return ''

  await writeNativeToken(legacy)
  clearGrowattTokenInConfigBlob()
  return legacy
}

export async function setGrowattToken(token: string): Promise<void> {
  if (!isNativePlatform()) return
  await writeNativeToken(token)
}

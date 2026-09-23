import { HomeAssistantEnergySource } from './ha'
import { canUseParentHass } from './haConn'
import { MockEnergySource } from './mock'
import type { AppConfig } from '@/config/appConfig'
import { loadConfig } from '@/config/appConfig'
import type { LiveSnapshot, PeriodKind, PeriodStats } from '@/domain/types'

export interface EnergySource {
  getLive(): Promise<LiveSnapshot>
  subscribeLive(cb: (s: LiveSnapshot) => void): () => void
  getPeriod(kind: PeriodKind, date: Date): Promise<PeriodStats>
}

export function isHaConfigured(config: AppConfig): boolean {
  return canUseParentHass() || Boolean(config.haToken.trim())
}

export function createEnergySource(config: AppConfig = loadConfig()): EnergySource {
  if (isHaConfigured(config) || (import.meta.env.VITE_ENERGY_SOURCE ?? '').toLowerCase() === 'ha') {
    return new HomeAssistantEnergySource(config)
  }
  return new MockEnergySource()
}

import { CompositeEnergySource } from './compositeSource'
import { HomeAssistantEnergySource } from './ha'
import { canUseParentHass } from './haConn'
import { MockEnergySource } from './mock'
import type { AppConfig } from '@/config/appConfig'
import { loadConfig } from '@/config/appConfig'
import type { LiveSnapshot, PeriodKind, PeriodStats } from '@/domain/types'

export type PeriodFetchOpts = {
  /** Month/year hero compare skips power stats so the recorder is not loaded with 5-minute rows. */
  includePower?: boolean
}

export interface EnergySource {
  getLive(): Promise<LiveSnapshot>
  subscribeLive(cb: (s: LiveSnapshot) => void): () => void
  getPeriod(kind: PeriodKind, date: Date, opts?: PeriodFetchOpts): Promise<PeriodStats>
}

export function isHaConfigured(config: AppConfig): boolean {
  if (canUseParentHass()) return true
  return Boolean(config.haUrl.trim() && config.haToken.trim())
}

export function createEnergySource(config: AppConfig = loadConfig()): EnergySource {
  const demo =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demo') === '1'
  if (demo) return new MockEnergySource()
  if (config.growatt.token.trim()) return new CompositeEnergySource(config)
  if (isHaConfigured(config)) return new HomeAssistantEnergySource(config)
  return new CompositeEnergySource(config)
}

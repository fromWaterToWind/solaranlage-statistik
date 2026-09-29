import type { BoughtPart } from '@/domain/investment'

const STORAGE_KEY = 'solar-statistik-investment-v1'

export function loadBoughtParts(): BoughtPart[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPart)
  } catch {
    return []
  }
}

function isPart(v: unknown): v is BoughtPart {
  if (!v || typeof v !== 'object') return false
  const o = v as BoughtPart
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.unitPriceEur === 'number'
}

export function saveBoughtParts(parts: BoughtPart[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parts))
}

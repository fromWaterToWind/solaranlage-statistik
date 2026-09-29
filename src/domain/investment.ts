import type { Euros, Kwh } from './types'

export type PartKind = 'Speicher' | 'Module' | 'Messung' | 'Montage' | 'Arbeit' | 'Sonstiges'

export interface CatalogPart {
  id: string
  name: string
  kind: PartKind
  priceEur: number
  hint: string
}

export interface BoughtPart {
  id: string
  catalogId: string
  name: string
  kind: PartKind
  qty: number
  unitPriceEur: number
  boughtOn: string
}

/** Street prices 2025/26, as starting points — user can overwrite. */
export const PART_CATALOG: CatalogPart[] = [
  { id: 'nexa-2000', name: 'Growatt Nexa 2000', kind: 'Speicher', priceEur: 899, hint: 'Basisgerät' },
  { id: 'noah-2000', name: 'Growatt Noah 2000', kind: 'Speicher', priceEur: 749, hint: 'Vorgänger' },
  { id: 'nexa-batt', name: 'Nexa Batteriemodul', kind: 'Speicher', priceEur: 599, hint: 'Zusatzakku' },
  { id: 'pv-430', name: 'PV-Modul 430 W', kind: 'Module', priceEur: 79, hint: 'pro Stück' },
  { id: 'pv-455', name: 'PV-Modul 455 W', kind: 'Module', priceEur: 89, hint: 'pro Stück' },
  { id: 'mount-set', name: 'Unterkonstruktion Satz', kind: 'Montage', priceEur: 380, hint: 'Dach/Balkon' },
  { id: 'mc4', name: 'DC-Kabel / MC4', kind: 'Montage', priceEur: 45, hint: 'Material' },
  { id: 'shelly', name: 'Shelly Pro (Garage)', kind: 'Messung', priceEur: 69, hint: 'Hausverbrauch' },
  { id: 'ecotracker', name: 'EcoTracker', kind: 'Messung', priceEur: 129, hint: 'Netz' },
  { id: 'install', name: 'Installation Pauschale', kind: 'Arbeit', priceEur: 900, hint: 'optional' },
  { id: 'custom', name: 'Sonstiges', kind: 'Sonstiges', priceEur: 0, hint: 'frei' },
]

export function newBoughtPart(part: CatalogPart, qty = 1, boughtOn = isoToday()): BoughtPart {
  return {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    catalogId: part.id,
    name: part.name,
    kind: part.kind,
    qty,
    unitPriceEur: part.priceEur,
    boughtOn,
  }
}

export function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function investedEur(parts: BoughtPart[]): Euros {
  return Math.round(parts.reduce((s, p) => s + p.qty * p.unitPriceEur, 0) * 100) / 100
}

export type PaybackStage = 'planung' | 'am-netz' | 'halbzeit' | 'break-even' | 'rendite'

export interface PaybackForecast {
  investedEur: Euros
  savedEur: Euros
  remainingEur: Euros
  progressPct: number
  monthlySavedEur: Euros
  monthsLeft: number | null
  breakEven: Date | null
  stage: PaybackStage
  stageLabel: string
  producedKwh: Kwh
  points: { month: string; saved: number; invested: number }[]
}

const STAGE_LABEL: Record<PaybackStage, string> = {
  planung: 'Noch in der Planung',
  'am-netz': 'Am Netz — Zähler läuft',
  halbzeit: 'Halbzeit',
  'break-even': 'Break-even',
  rendite: 'Ab jetzt Rendite',
}

export function paybackForecast(args: {
  parts: BoughtPart[]
  savedEur: Euros
  producedKwh: Kwh
  monthlySavedEur: Euros
  now?: Date
}): PaybackForecast {
  const invested = investedEur(args.parts)
  const saved = Math.max(0, args.savedEur)
  const remaining = Math.max(0, invested - saved)
  const progressPct = invested <= 0 ? 0 : Math.min(100, (saved / invested) * 100)
  const monthly = Math.max(0, args.monthlySavedEur)
  const monthsLeft =
    invested <= 0
      ? null
      : monthly > 0.5 && remaining > 0
        ? remaining / monthly
        : remaining <= 0
          ? 0
          : null
  const now = args.now ?? new Date()
  let breakEven: Date | null = null
  if (remaining <= 0 && invested > 0) breakEven = now
  else if (monthsLeft != null && monthsLeft > 0) {
    breakEven = new Date(now.getFullYear(), now.getMonth() + Math.ceil(monthsLeft), 1)
  }

  let stage: PaybackStage = 'planung'
  if (invested <= 0) stage = 'planung'
  else if (progressPct >= 100) stage = 'rendite'
  else if (progressPct >= 98) stage = 'break-even'
  else if (progressPct >= 50) stage = 'halbzeit'
  else if (saved > 1 || args.producedKwh > 1) stage = 'am-netz'

  const points: PaybackForecast['points'] = []
  let run = saved
  for (let i = 0; i <= 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const label = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' }).format(d)
    if (i > 0) run += monthly
    points.push({
      month: label,
      saved: Math.round(run * 10) / 10,
      invested,
    })
  }

  return {
    investedEur: invested,
    savedEur: saved,
    remainingEur: remaining,
    progressPct,
    monthlySavedEur: monthly,
    monthsLeft,
    breakEven,
    stage,
    stageLabel: STAGE_LABEL[stage],
    producedKwh: args.producedKwh,
    points,
  }
}

export function lifetimeEconomics(
  months: { year: number; month: number; savedEur: number; productionKwh: number }[],
  extra: { year: number; month: number; savedEur: number; productionKwh: number } | null,
  now = new Date(),
): { savedEur: Euros; producedKwh: Kwh; monthlySavedEur: Euros } {
  const rows = [...months]
  if (
    extra &&
    extra.productionKwh + extra.savedEur > 0 &&
    !rows.some((r) => r.year === extra.year && r.month === extra.month)
  ) {
    rows.push(extra)
  }
  const savedEur = rows.reduce((s, r) => s + r.savedEur, 0)
  const producedKwh = rows.reduce((s, r) => s + r.productionKwh, 0)
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const recent = rows
    .filter((r) => r.year * 12 + r.month >= y * 12 + m - 3 && r.savedEur > 0.5)
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
  const monthlySavedEur =
    recent.length > 0 ? recent.reduce((s, r) => s + r.savedEur, 0) / recent.length : 0
  return { savedEur, producedKwh, monthlySavedEur }
}

import type { GrowattConfig } from '@/config/appConfig'
import { floorSubWatt } from './haParse'
import { getGrowattDay, putGrowattDay } from './growattStore'
import type { PowerPoint, Watts } from '@/domain/types'

export interface GrowattDayPoint {
  t: string
  pvW: Watts
  mpptW: Record<string, Watts>
  homeW?: Watts
  batteryW?: Watts
  gridW?: Watts
  socPercent?: number | null
  socById?: Record<string, number | null>
}

const MIN_INTERVAL_MS = 60_000
let lastRequestAt = 0
const dayCache = new Map<string, GrowattDayPoint[]>()

export function formatGrowattDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ymd = formatGrowattDay

export function growattApiBase(): string {
  if (import.meta.env.DEV) return '/growatt'
  return '/api/solar_statistik/growatt'
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function pickW(row: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const n = num(row[k])
    if (n != null) return floorSubWatt(n)
  }
  return 0
}

function stringW(row: Record<string, unknown>, n: number): number {
  const direct = pickW(row, [`ppv${n}`, `pPv${n}`, `ppv${n}W`])
  if (direct) return direct
  const i = num(row[`pv${n}Current`] ?? row[`pv${n}_current`])
  const v = num(row[`pv${n}Voltage`] ?? row[`pv${n}_voltage`])
  if (i == null || v == null) return 0
  return floorSubWatt(i * v)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseWallClock(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null
  if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? 0),
    )
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

function parseUnix(v: number): Date | null {
  const ms = v > 0 && v < 1e12 ? v * 1000 : v
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

/** timeStr is plant local wall clock. Unix `time` is a different TZ — do not prefer it. */
function parseRowTime(row: Record<string, unknown>): Date | null {
  for (const key of ['timeStr', 'time_str'] as const) {
    if (typeof row[key] === 'string') {
      const d = parseWallClock(row[key])
      if (d) return d
    }
  }
  const v = row.time ?? row.calendar ?? row.ts ?? row.date
  if (typeof v === 'string' && v.trim() && !/^\d+(\.\d+)?$/.test(v.trim())) {
    const d = parseWallClock(v)
    if (d) return d
  }
  if (typeof v === 'number' && Number.isFinite(v)) return parseUnix(v)
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return parseUnix(Number(v.trim()))
  return null
}

function historyRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const data = asRecord(root.data) ?? root
  const obj = asRecord(root.obj) ?? asRecord(data.obj)
  const out: Record<string, unknown>[] = []
  const pushArr = (v: unknown) => {
    if (!Array.isArray(v)) return
    for (const item of v) {
      const row = asRecord(item)
      if (row) out.push(row)
    }
  }
  pushArr(data.datas)
  pushArr(data.data)
  pushArr(data.history)
  pushArr(data.timeValue)
  pushArr(obj?.datas)
  if (!out.length) {
    for (const [key, v] of Object.entries(data)) {
      if (key === 'chartData' || key === 'ppv' || key === 'obj') continue
      pushArr(v)
    }
  }
  return out
}

export function parseGrowattHistory(payload: unknown): GrowattDayPoint[] {
  const root = asRecord(payload)
  if (!root) return []
  const code = num(root.error_code ?? root.errorCode ?? root.code)
  if (code != null && code !== 0) return []
  const rows = historyRows(payload)
  const out: GrowattDayPoint[] = []

  for (const row of rows) {
    const when = parseRowTime(row)
    if (!when) continue
    const pvW = pickW(row, ['ppv', 'pPv'])
    const mpptW: Record<string, Watts> = {}
    for (let i = 1; i <= 4; i++) {
      const w = stringW(row, i)
      if (w) mpptW[`pv${i}`] = w
    }
    const homeN = num(row.totalHouseholdLoad)
    const chargeN = num(row.totalBatteryPackChargingPower)
    const gridN = num(row.ctSelfPower)
    const socN = num(row.totalBatteryPackSoc)
    const socById: Record<string, number | null> = {}
    for (let i = 1; i <= 4; i++) {
      const serial = String(row[`battery${i}SerialNum`] ?? '').trim()
      if (!serial) continue
      const s = num(row[`battery${i}Soc`])
      if (s != null) socById[`b${i}`] = s
    }
    out.push({
      t: when.toISOString(),
      pvW,
      mpptW,
      homeW: homeN != null ? floorSubWatt(homeN) : undefined,
      // HA: +Discharge. Growatt chargingPower: +Laden / −Entladen.
      batteryW: chargeN != null ? floorSubWatt(-chargeN) : undefined,
      gridW: gridN != null ? floorSubWatt(gridN) : undefined,
      socPercent: socN,
      socById: Object.keys(socById).length ? socById : undefined,
    })
  }
  if (out.length) return out.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())

  const data = asRecord(root.data) ?? root
  const chart = asRecord(data.chartData) ?? asRecord(data.ppv)
  if (chart) {
    for (const [time, value] of Object.entries(chart)) {
      const nested = asRecord(value)
      const pvW = nested ? pickW(nested, ['ppv', 'pac']) : floorSubWatt(num(value) ?? 0)
      const when = parseRowTime({ time })
      if (!when) continue
      out.push({ t: when.toISOString(), pvW, mpptW: {} })
    }
  }
  return out.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

function clockTime(t: string): string {
  if (/^\d{1,2}:\d{2}$/.test(t.trim())) return `${t.trim()}:00`
  return t.trim()
}

/** APP Nexa/Noah chart: `{ result: 1, obj: { "12:00": { ppv } } }`. */
export function parseGrowattChart(payload: unknown, day: string): GrowattDayPoint[] {
  const root = asRecord(payload)
  if (!root) return []
  const result = num(root.result)
  if (result != null && result !== 1) return []
  const obj = asRecord(root.obj) ?? asRecord(asRecord(root.data)?.obj)
  if (!obj) return []
  const out: GrowattDayPoint[] = []
  for (const [time, value] of Object.entries(obj)) {
    const nested = asRecord(value) ?? { ppv: value }
    const when = parseRowTime({ time: `${day} ${clockTime(time)}` })
    if (!when) continue
    out.push({
      t: when.toISOString(),
      pvW: pickW(nested, ['ppv', 'pPv']),
      mpptW: {},
    })
  }
  return out.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

function bucket15(iso: string): number {
  const d = new Date(iso)
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
  d.setSeconds(0, 0)
  return d.getTime()
}

type GrowattBucket = {
  pv: number
  n: number
  mppt: Record<string, { s: number; n: number }>
  home: number
  nHome: number
  batt: number
  nBatt: number
  grid: number
  nGrid: number
  soc: number
  nSoc: number
  socById: Record<string, { s: number; n: number }>
}

function emptyGrowattBucket(): GrowattBucket {
  return {
    pv: 0,
    n: 0,
    mppt: {},
    home: 0,
    nHome: 0,
    batt: 0,
    nBatt: 0,
    grid: 0,
    nGrid: 0,
    soc: 0,
    nSoc: 0,
    socById: {},
  }
}

/** Fill empty HA 15-min buckets from Growatt samples. Never overwrite a live HA watt or SOC. */
export function mergeGrowattPv(series: PowerPoint[], growatt: GrowattDayPoint[]): PowerPoint[] {
  if (!growatt.length) return series
  const acc = new Map<number, GrowattBucket>()
  for (const p of growatt) {
    const k = bucket15(p.t)
    if (!Number.isFinite(k)) continue
    const cur = acc.get(k) ?? emptyGrowattBucket()
    cur.pv += p.pvW
    cur.n += 1
    for (const [id, w] of Object.entries(p.mpptW)) {
      const slot = cur.mppt[id] ?? { s: 0, n: 0 }
      slot.s += w
      slot.n += 1
      cur.mppt[id] = slot
    }
    if (p.homeW != null) {
      cur.home += p.homeW
      cur.nHome += 1
    }
    if (p.batteryW != null) {
      cur.batt += p.batteryW
      cur.nBatt += 1
    }
    if (p.gridW != null) {
      cur.grid += p.gridW
      cur.nGrid += 1
    }
    if (p.socPercent != null) {
      cur.soc += p.socPercent
      cur.nSoc += 1
    }
    for (const [id, s] of Object.entries(p.socById ?? {})) {
      if (s == null) continue
      const slot = cur.socById[id] ?? { s: 0, n: 0 }
      slot.s += s
      slot.n += 1
      cur.socById[id] = slot
    }
    acc.set(k, cur)
  }
  return series.map((p) => {
    const g = acc.get(bucket15(p.t))
    if (!g) return p
    const pvW = p.pvW > 0 ? p.pvW : g.n ? g.pv / g.n : 0
    const mpptW = { ...(p.mpptW ?? {}) }
    for (const [id, slot] of Object.entries(g.mppt)) {
      if (!(mpptW[id] > 0) && slot.n) mpptW[id] = slot.s / slot.n
    }
    const homeW = p.homeW > 0 ? p.homeW : g.nHome ? g.home / g.nHome : p.homeW
    const batteryW = p.batteryW !== 0 ? p.batteryW : g.nBatt ? g.batt / g.nBatt : p.batteryW
    const gridW = p.gridW !== 0 ? p.gridW : g.nGrid ? g.grid / g.nGrid : p.gridW
    const socPercent =
      p.socPercent != null ? p.socPercent : g.nSoc ? g.soc / g.nSoc : p.socPercent
    const socById = { ...(p.socById ?? {}) }
    for (const [id, slot] of Object.entries(g.socById)) {
      if (socById[id] == null && slot.n) socById[id] = slot.s / slot.n
    }
    return { ...p, pvW, mpptW, homeW, batteryW, gridW, socPercent, socById }
  })
}

function emptyDaySeries(date: Date): PowerPoint[] {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const now = new Date()
  const sameDay =
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate()
  const end = sameDay ? now : new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const out: PowerPoint[] = []
  for (let t = start.getTime(); t < end.getTime(); t += 15 * 60 * 1000) {
    out.push({
      t: new Date(t).toISOString(),
      pvW: 0,
      homeW: 0,
      batteryW: 0,
      gridW: 0,
      mpptW: {},
    })
  }
  return out
}

/** Fill HA 15-min slots from Growatt. If HA has no curve, build the day from Growatt. */
export function applyGrowattDay(
  series: PowerPoint[] | undefined,
  growatt: GrowattDayPoint[],
  date: Date,
): PowerPoint[] {
  const base = series?.length ? series : emptyDaySeries(date)
  return mergeGrowattPv(base, growatt)
}

function cooldownSecs(): number {
  return Math.max(0, Math.ceil(growattCooldownMs() / 1000))
}

export function growattCooldownMs(): number {
  return Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt))
}

function rateLimitError(): Error {
  return new Error(`Growatt: nächste Anfrage in ${cooldownSecs()}s (max. 1×/Minute)`)
}

function isRateLimited(payload: unknown, msg?: string): boolean {
  const blob = `${msg ?? ''} ${String(asRecord(payload)?.error_msg ?? '')} ${String(asRecord(payload)?.message ?? '')}`
  if (/frequently_access|rate limit|too frequent/i.test(blob)) return true
  const code = num(asRecord(payload)?.error_code ?? asRecord(payload)?.errorCode ?? asRecord(payload)?.code)
  return code === 10012 || code === 100 || code === 102
}

function firstText(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function explainGrowattPayload(payload: unknown, raw?: string): string {
  const root = asRecord(payload)
  if (!root) {
    const t = (raw ?? '').replace(/\s+/g, ' ').trim()
    if (/<html|login to the system|id="login"/i.test(t)) return 'Login-Seite statt JSON'
    if (t) return t.slice(0, 160)
    return 'leere Antwort'
  }
  const bits: string[] = []
  const result = num(root.result)
  const code = num(root.error_code ?? root.errorCode ?? root.code)
  if (result != null) bits.push(`result=${result}`)
  if (code != null) bits.push(`code=${code}`)
  const msg = firstText(root.msg, root.error_msg, root.message, root.error)
  if (msg) bits.push(msg)
  else bits.push('keine Meldung')
  const keys = Object.keys(root).join(',')
  if (keys) bits.push(`keys=${keys}`)
  return bits.join(' · ')
}

function growattError(payload: unknown, raw?: string): string | null {
  const root = asRecord(payload)
  if (!root) return raw ? `Growatt: ${explainGrowattPayload(null, raw)}` : 'Growatt: leere Antwort'
  const code = num(root.error_code ?? root.errorCode ?? root.code)
  const result = num(root.result)
  if ((code != null && code !== 0) || (result != null && result !== 1)) {
    return `Growatt: ${explainGrowattPayload(payload, raw)}`
  }
  return null
}

async function growattPost(token: string, path: string, params: Record<string, string>): Promise<unknown> {
  if (cooldownSecs() > 0) throw rateLimitError()
  lastRequestAt = Date.now()
  const body = new URLSearchParams(params).toString()
  const res = await fetch(`${growattApiBase()}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      token,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') ?? ''
    throw new Error(`Growatt HTTP ${res.status} → ${loc || 'ohne Location'} (kein v4-JSON)`)
  }
  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text) as unknown
    } catch {
      json = null
    }
  }
  if (isRateLimited(json, text)) throw rateLimitError()
  if (!json) {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 80)
    const ctype = res.headers.get('content-type') ?? '?'
    if (/<html/i.test(text)) {
      const where = /solaranlage|vite/i.test(text)
        ? 'App-HTML (Proxy nicht getroffen)'
        : 'Growatt-Login-HTML (kein v4)'
      throw new Error(`Growatt HTTP ${res.status} · ${where} · ${ctype}`)
    }
    if (snippet) throw new Error(`Growatt HTTP ${res.status} · kein JSON · ${snippet}`)
  }
  if (!res.ok) {
    const apiErr = json ? growattError(json, text) : null
    if (apiErr) throw new Error(apiErr)
    throw new Error(`Growatt HTTP ${res.status} · ${explainGrowattPayload(json, text)}`)
  }
  return json ?? {}
}

const TYPE_KEY = 'solar-statistik-growatt-type-v1'

const TYPE_FROM_INT: Record<number, string> = {
  16: 'inv',
  17: 'sph',
  18: 'max',
  19: 'spa',
  22: 'min',
  96: 'storage',
  218: 'wit',
  260: 'sph-s',
  1000: 'noah',
}

export interface GrowattDevice {
  sn: string
  type: string
}

function normSn(sn: string): string {
  return sn.trim().toLowerCase()
}

function typeFromUnknown(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return TYPE_FROM_INT[v] ?? String(v)
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim()
    const n = Number(s)
    if (/^\d+$/.test(s) && TYPE_FROM_INT[n]) return TYPE_FROM_INT[n]
    return s.toLowerCase()
  }
  return ''
}

function deviceRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const data = asRecord(root.data) ?? root
  const out: Record<string, unknown>[] = []
  const push = (v: unknown) => {
    if (!Array.isArray(v)) return
    for (const item of v) {
      const row = asRecord(item)
      if (row) out.push(row)
    }
  }
  push(data.data)
  push(data.datas)
  push(data.devices)
  return out
}

export function parseDeviceList(payload: unknown): GrowattDevice[] {
  const out: GrowattDevice[] = []
  for (const row of deviceRows(payload)) {
    const sn = String(row.deviceSn ?? row.device_sn ?? row.sn ?? '').trim()
    const type = typeFromUnknown(row.deviceType ?? row.device_type ?? row.type)
    if (sn && type) out.push({ sn, type })
  }
  return out
}

export function matchDeviceType(devices: GrowattDevice[], sn: string): GrowattDevice | null {
  const want = normSn(sn)
  return devices.find((d) => normSn(d.sn) === want) ?? null
}

function writeStoredType(sn: string, type: string) {
  try {
    localStorage.setItem(TYPE_KEY, JSON.stringify({ sn, type }))
  } catch {
    /* ignore */
  }
}

export const NEXA_FROM_DEFAULT = '2026-09-02'

export function parseIsoDay(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function isBeforeNexa(config: GrowattConfig, date: Date): boolean {
  const cut = parseIsoDay(config.nexaFrom?.trim() || NEXA_FROM_DEFAULT)
  if (!cut) return false
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return day.getTime() < cut.getTime()
}

/** Nexa SN from 02.09.2026; older Noah SN before that, if set. */
export function growattSnForDate(config: GrowattConfig, date: Date): string {
  const extra = config.extraDeviceSn?.trim() ?? ''
  if (extra && isBeforeNexa(config, date)) return extra
  return config.deviceSn.trim()
}

export function otherGrowattSns(devices: GrowattDevice[], primarySn: string): string[] {
  const want = normSn(primarySn)
  const noah = devices.filter((d) => d.type === 'noah' && normSn(d.sn) !== want).map((d) => d.sn)
  if (noah.length) return noah
  return devices.filter((d) => normSn(d.sn) !== want).map((d) => d.sn)
}

/** Nexa/Noah history — same three form fields as Postman. Ping-Typ (z. B. sph-s) nicht verwenden. */
export function growattHistoryForm(config: GrowattConfig, date: Date): Record<string, string> {
  return {
    deviceSn: growattSnForDate(config, date),
    deviceType: 'noah',
    date: ymd(date),
  }
}

function listSummary(devices: GrowattDevice[]): string {
  if (!devices.length) return 'keine Geräte'
  return devices.map((d) => `${d.sn} (${d.type})`).join(', ')
}

export async function pingGrowatt(
  config: GrowattConfig,
): Promise<{ ok: boolean; message: string; deviceType?: string; extraSns?: string[] }> {
  const token = config.token.trim()
  if (!token) return { ok: false, message: 'Kein Token' }
  const sn = config.deviceSn.trim()
  if (!sn) return { ok: false, message: 'Keine Geräte-SN' }
  if (cooldownSecs() > 0) return { ok: false, message: rateLimitError().message }
  try {
    const json = await growattPost(token, '/v4/new-api/queryDeviceList', { page: '1' })
    const err = growattError(json)
    if (err) return { ok: false, message: isRateLimited(json, err) ? rateLimitError().message : err }
    const devices = parseDeviceList(json)
    const hit = matchDeviceType(devices, sn)
    if (!hit) {
      return {
        ok: false,
        message: `Growatt: SN ${sn} nicht in der Liste (${listSummary(devices)})`,
      }
    }
    writeStoredType(sn, hit.type)
    const extraSns = otherGrowattSns(devices, sn)
    const extraNote = extraSns.length ? ` · Noah ${extraSns[0]}` : ''
    return {
      ok: true,
      deviceType: hit.type,
      extraSns,
      message: `Verbunden · Typ ${hit.type}${extraNote} · max. 1×/Minute`,
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Growatt nicht erreichbar' }
  }
}

export async function fetchGrowattDay(config: GrowattConfig, date: Date): Promise<GrowattDayPoint[]> {
  const token = config.token.trim()
  if (!token) return []
  if (isBeforeNexa(config, date) && !config.extraDeviceSn?.trim()) {
    throw new Error('Growatt: Noah-SN für Tage vor der Nexa fehlt')
  }
  const day = ymd(date)
  const sn = growattSnForDate(config, date)
  if (!sn) {
    if (isBeforeNexa(config, date)) throw new Error('Growatt: Noah-SN für Tage vor der Nexa fehlt')
    throw new Error('Growatt: keine Geräte-SN')
  }
  const cacheKey = `wall:${normSn(sn)}:${day}`
  const mem = dayCache.get(cacheKey)
  if (mem) return mem
  const stored = await getGrowattDay(day)
  if (stored && stored.sn.toLowerCase() === sn.toLowerCase()) {
    dayCache.set(cacheKey, stored.points)
    return stored.points
  }
  if (cooldownSecs() > 0) throw rateLimitError()

  const json = await growattPost(token, '/v4/new-api/queryHistoricalData', growattHistoryForm(config, date))
  const err = growattError(json)
  if (err) throw new Error(isRateLimited(json, err) ? rateLimitError().message : err)
  const points = parseGrowattHistory(json)
  const chart = points.length ? points : parseGrowattChart(json, day)
  dayCache.set(cacheKey, chart)
  await putGrowattDay({
    day,
    sn,
    points: chart,
    fetchedAt: new Date().toISOString(),
  })
  if (!chart.length) return []
  return chart
}

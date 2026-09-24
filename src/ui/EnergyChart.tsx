import { useId, useState, type CSSProperties } from 'react'
import {
  Area,
  Bar,
  ComposedChart,
  Customized,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatKw, formatPercent, formatWattAxis, selfKwhFromPoint } from '@/domain/calc'
import type { PeriodKind, PeriodSource, PowerPoint, SeriesPoint } from '@/domain/types'
import './EnergyChart.css'

export interface ChartSeriesDef {
  key: string
  name: string
  color: string
  unit: 'W' | '%' | 'kWh'
  /** Same id → one column (positive up, negative down). */
  stackId?: string
}

interface EnergyChartProps {
  kind: PeriodKind
  series: SeriesPoint[] | null
  powerSeries?: PowerPoint[] | null
  loading: boolean
  source?: PeriodSource
  seriesDefs?: ChartSeriesDef[]
  visibleKeys?: string[]
  title?: string
  height?: number
  /** Period totals shown on the legend chips (kWh). */
  chipTotals?: Record<string, number>
}

const deKwh = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const deAxisKwh = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const DEFAULT_POWER: ChartSeriesDef[] = [
  { key: 'pvW', name: 'Erzeugung', color: '#E8B84A', unit: 'W' },
  { key: 'homeW', name: 'Verbrauch', color: '#E7EEE8', unit: 'W' },
]

const DEFAULT_ENERGY: ChartSeriesDef[] = [
  { key: 'pvKwh', name: 'Erzeugung', color: '#E8B84A', unit: 'kWh' },
  { key: 'homeKwh', name: 'Verbrauch', color: '#E7EEE8', unit: 'kWh' },
]

interface TipEntry {
  name?: string
  value?: number
  color?: string
  dataKey?: string | number
}

interface TipProps {
  active?: boolean
  payload?: TipEntry[]
  label?: string
  unit: 'W' | 'kWh'
  defs?: ChartSeriesDef[]
  hidden?: Record<string, boolean>
}

function formatSignedW(watts: number): string {
  const n = Math.round(watts)
  if (n < 0) return `−${formatKw(n)}`
  return formatKw(n)
}

function ChartTooltip({ active, payload, label, unit, defs, hidden }: TipProps) {
  if (!active || !payload?.length) return null
  const collapsed: TipEntry[] = []
  let battSeen = false
  for (const entry of payload) {
    if (String(entry.dataKey) === 'battW') {
      if (battSeen) continue
      battSeen = true
      const raw = entry.value ?? 0
      const side = raw < 0 ? 'chargeW' : 'dischargeW'
      if (hidden?.[side]) continue
      const def = defs?.find((d) => d.key === side)
      collapsed.push({
        ...entry,
        name: def?.name ?? (raw < 0 ? 'Laden' : 'Entladen'),
        color: def?.color ?? entry.color,
        dataKey: side,
      })
    } else {
      collapsed.push(entry)
    }
  }
  const rows = collapsed.filter((entry) => {
    const raw = entry.value ?? 0
    const def = defs?.find((d) => d.key === String(entry.dataKey))
    if (def?.unit === '%') return true
    if (unit === 'W') return Math.abs(raw) >= 1
    return Math.abs(raw) >= 0.05
  })
  if (!rows.length) return null
  return (
    <div className="energy-chart__tip">
      <div className="energy-chart__tip-label">{label}</div>
      {rows.map((entry) => {
        const def = defs?.find((d) => d.key === String(entry.dataKey))
        const raw = entry.value ?? 0
        let text: string
        if (def?.unit === '%') text = formatPercent(raw)
        else if (def?.key === 'chargeW' || def?.key === 'dischargeW') {
          text = raw < 0 ? `Laden ${formatSignedW(raw)}` : `Entladen ${formatKw(raw)}`
        } else if (def?.key === 'exportW') text = formatSignedW(raw)
        else if (unit === 'W') text = formatKw(raw)
        else if (raw < 0) text = `−${deKwh.format(Math.abs(raw))} kWh`
        else text = `${deKwh.format(raw)} kWh`
        return (
          <div key={String(entry.dataKey)} className="energy-chart__tip-row">
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span>{text}</span>
          </div>
        )
      })}
    </div>
  )
}

interface ChartClipProps {
  yAxisMap?: Record<string, { scale?: (n: number) => number }>
  offset?: { top: number; left: number; width: number; height: number }
}

function BattSignedGradient({
  yAxisMap,
  offset,
  id,
  posColor,
  negColor,
  showPos,
  showNeg,
}: ChartClipProps & {
  id: string
  posColor: string
  negColor: string
  showPos: boolean
  showNeg: boolean
}) {
  const scale = yAxisMap?.w?.scale
  if (!scale || !offset) return null
  const zeroY = scale(0)
  if (!Number.isFinite(zeroY)) return null
  const top = offset.top
  const bottom = offset.top + offset.height
  const span = bottom - top
  if (span <= 0) return null
  const zeroOff = Math.min(1, Math.max(0, (zeroY - top) / span))
  const above = showPos ? posColor : 'transparent'
  const below = showNeg ? negColor : 'transparent'
  return (
    <defs>
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={top}
        x2={0}
        y2={bottom}
      >
        <stop offset={0} stopColor={above} />
        <stop offset={zeroOff} stopColor={above} />
        <stop offset={zeroOff} stopColor={below} />
        <stop offset={1} stopColor={below} />
      </linearGradient>
    </defs>
  )
}

function powerRows(series: PowerPoint[]) {
  return series.map((p) => {
    const d = new Date(p.t)
    const row: Record<string, string | number | null> = {
      key: p.t,
      label: new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d),
      hour: d.getHours(),
      minute: d.getMinutes(),
      pvW: p.pvW,
      homeW: p.homeW,
      battW: p.batteryW,
      chargeW: p.batteryW < 0 ? p.batteryW : 0,
      dischargeW: Math.max(0, p.batteryW),
      importW: Math.max(0, p.gridW),
      exportW: p.gridW < 0 ? p.gridW : 0,
      soc: p.socPercent ?? null,
    }
    if (p.mpptW) {
      for (const [id, w] of Object.entries(p.mpptW)) {
        row[`mppt:${id}`] = w
      }
    }
    if (p.socById) {
      for (const [id, s] of Object.entries(p.socById)) {
        row[`soc:${id}`] = s
      }
    }
    return row
  })
}

function energyRows(kind: PeriodKind, series: SeriesPoint[]) {
  return series.map((p) => {
    const d = new Date(p.t)
    let label: string
    if (kind === 'month') {
      label = String(d.getDate())
    } else {
      label = new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(d)
    }
    return {
      key: p.t,
      label,
      pvKwh: p.pvKwh,
      homeKwh: p.homeKwh,
      selfKwh: selfKwhFromPoint(p.homeKwh, p.gridImportKwh, p.selfKwh),
      importKwh: p.gridImportKwh,
      exportKwh: p.gridExportKwh > 0 ? -p.gridExportKwh : 0,
      dischargeKwh: p.batteryDischargeKwh,
      chargeKwh: p.batteryChargeKwh > 0 ? -p.batteryChargeKwh : 0,
    }
  })
}

function Legend({
  defs,
  hidden,
  onToggle,
  totals,
}: {
  defs: ChartSeriesDef[]
  hidden: Record<string, boolean>
  onToggle: (key: string) => void
  totals?: Record<string, number>
}) {
  if (defs.length < 2 && !totals) return null
  return (
    <div className="energy-chart__legend">
      {defs.map((d) => (
        <button
          key={d.key}
          type="button"
          className={`energy-chart__chip${hidden[d.key] ? ' is-off' : ''}`}
          style={{ '--chip': d.color } as CSSProperties}
          aria-pressed={!hidden[d.key]}
          onClick={() => onToggle(d.key)}
        >
          {d.name}
          {totals?.[d.key] != null ? (
            <span className="energy-chart__chip-kwh">
              {d.unit === '%'
                ? formatPercent(totals[d.key])
                : `${deKwh.format(totals[d.key])} kWh`}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function DayChart({
  powerSeries,
  seriesDefs,
  visibleKeys,
  title,
  height,
  chipTotals,
}: {
  powerSeries: PowerPoint[]
  seriesDefs?: ChartSeriesDef[]
  visibleKeys?: string[]
  title?: string
  height: number
  chipTotals?: Record<string, number>
}) {
  const defs = seriesDefs?.length ? seriesDefs : DEFAULT_POWER
  const available = visibleKeys?.length ? defs.filter((d) => visibleKeys.includes(d.key)) : defs
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const shown = available.filter((d) => !hidden[d.key])
  const wattSeries = shown.filter((d) => d.unit === 'W')
  const socSeries = shown.filter((d) => d.unit === '%')
  const battDischarge = shown.find((d) => d.key === 'dischargeW')
  const battCharge = shown.find((d) => d.key === 'chargeW')
  const dischargeDef = available.find((d) => d.key === 'dischargeW')
  const chargeDef = available.find((d) => d.key === 'chargeW')
  const otherWatts = wattSeries.filter((d) => d.key !== 'dischargeW' && d.key !== 'chargeW')
  const battGradientId = `batt-${useId().replace(/:/g, '')}`
  const rows = powerRows(powerSeries)
  const hourTicks = rows
    .filter((r) => Number(r.minute) === 0 && Number(r.hour) % 3 === 0)
    .map((r) => String(r.label))
  const label =
    title ?? (socSeries.length && !wattSeries.length ? 'Speicher · %' : 'Leistung · W · 15 min')

  const toggle = (key: string) => {
    setHidden((cur) => {
      const next = { ...cur, [key]: !cur[key] }
      const remaining = available.filter((d) => !next[d.key])
      return remaining.length === 0 ? cur : next
    })
  }

  if (rows.length === 0) {
    return (
      <section className="card energy-chart">
        <p className="section-label">{label}</p>
        <Legend
          defs={available}
          hidden={hidden}
          onToggle={toggle}
          totals={chipTotals}
        />
        <p className="energy-chart__empty">Keine Leistungsdaten für diesen Tag.</p>
      </section>
    )
  }

  return (
    <section className="card energy-chart" aria-label={label}>
      <p className="section-label">{label}</p>
      <Legend defs={available} hidden={hidden} onToggle={toggle} totals={chipTotals} />
      <div className="energy-chart__frame">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              ticks={hourTicks}
              interval={0}
              tick={{ fill: '#8B958D', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId={wattSeries.length ? 'w' : 'soc'}
              tick={{ fill: '#8B958D', fontSize: 11 }}
              tickFormatter={wattSeries.length ? formatWattAxis : (v) => `${Math.round(Number(v))}`}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={wattSeries.length ? undefined : [0, 100]}
            />
            {wattSeries.length > 0 && socSeries.length > 0 ? (
              <YAxis
                yAxisId="soc"
                orientation="right"
                domain={[0, 100]}
                tick={{ fill: '#8B958D', fontSize: 11 }}
                tickFormatter={(v) => `${Math.round(Number(v))}`}
                axisLine={false}
                tickLine={false}
                width={28}
              />
            ) : null}
            <Tooltip
              content={<ChartTooltip unit="W" defs={available} hidden={hidden} />}
              cursor={{ stroke: '#2A302B' }}
            />
            {wattSeries.length > 0 ? (
              <ReferenceLine yAxisId="w" y={0} stroke="var(--border)" strokeWidth={1} />
            ) : null}
            {battDischarge || battCharge ? (
              <Customized
                component={(props: ChartClipProps) => (
                  <BattSignedGradient
                    {...props}
                    id={battGradientId}
                    posColor={dischargeDef?.color ?? '#3DDC97'}
                    negColor={chargeDef?.color ?? '#7AA2FF'}
                    showPos={Boolean(battDischarge)}
                    showNeg={Boolean(battCharge)}
                  />
                )}
              />
            ) : null}
            {battDischarge || battCharge ? (
              <Line
                yAxisId="w"
                type="linear"
                dataKey="battW"
                name="Speicher"
                stroke={`url(#${battGradientId})`}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            {otherWatts.map((d) =>
              d.key === 'pvW' || d.key.startsWith('mppt:') ? (
                <Area
                  key={d.key}
                  yAxisId="w"
                  type="monotone"
                  dataKey={d.key}
                  name={d.name}
                  stroke={d.color}
                  fill={d.color}
                  fillOpacity={d.key === 'pvW' ? 0.18 : 0.08}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={d.key}
                  yAxisId="w"
                  type="monotone"
                  dataKey={d.key}
                  name={d.name}
                  stroke={d.color}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              ),
            )}
            {socSeries.map((d) => (
              <Line
                key={d.key}
                yAxisId="soc"
                type="monotone"
                dataKey={d.key}
                name={d.name}
                stroke={d.color}
                strokeWidth={d.key === 'soc' ? 1.8 : 1.3}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function EnergyBarChart({
  kind,
  series,
  seriesDefs,
  visibleKeys,
  title,
  height,
  chipTotals,
}: {
  kind: PeriodKind
  series: SeriesPoint[]
  seriesDefs?: ChartSeriesDef[]
  visibleKeys?: string[]
  title?: string
  height: number
  chipTotals?: Record<string, number>
}) {
  const defs = seriesDefs?.length ? seriesDefs : DEFAULT_ENERGY
  const available = visibleKeys?.length ? defs.filter((d) => visibleKeys.includes(d.key)) : defs
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const shown = available.filter((d) => !hidden[d.key])
  const rows = energyRows(kind, series)
  const label = title ?? 'Verlauf · kWh'
  const monthTicks =
    kind === 'month'
      ? rows
          .filter((r) => {
            const day = Number(r.label)
            return day === 1 || day % 7 === 1
          })
          .map((r) => r.label)
      : undefined
  const barSize = kind === 'month' ? 7 : 16
  const stacked = shown.some((d) => d.stackId)

  const toggle = (key: string) => {
    setHidden((cur) => {
      const next = { ...cur, [key]: !cur[key] }
      const remaining = available.filter((d) => !next[d.key])
      return remaining.length === 0 ? cur : next
    })
  }

  return (
    <section className="card energy-chart" aria-label={label}>
      <p className="section-label">{label}</p>
      <Legend defs={available} hidden={hidden} onToggle={toggle} totals={chipTotals} />
      <div className="energy-chart__frame">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap={kind === 'month' ? '18%' : '22%'}
            stackOffset={stacked ? 'sign' : undefined}
          >
            <XAxis
              dataKey="label"
              ticks={monthTicks}
              interval={kind === 'year' ? 0 : undefined}
              tick={{ fill: '#8B958D', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#8B958D', fontSize: 11 }}
              tickFormatter={(v) => deAxisKwh.format(Number(v))}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
            <Tooltip
              content={<ChartTooltip unit="kWh" defs={available} />}
              cursor={{ fill: 'rgba(42,48,43,0.35)' }}
            />
            {shown.map((d) => (
              <Bar
                key={d.key}
                dataKey={d.key}
                name={d.name}
                fill={d.color}
                stackId={d.stackId}
                radius={d.key === 'exportKwh' ? [0, 0, 2, 2] : [2, 2, 0, 0]}
                maxBarSize={barSize}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export function EnergyChart({
  kind,
  series,
  powerSeries,
  loading,
  source,
  seriesDefs,
  visibleKeys,
  title,
  height = 220,
  chipTotals,
}: EnergyChartProps) {
  if (loading) {
    return (
      <section className="card energy-chart" aria-hidden>
        <div className="skeleton energy-chart__skel" />
      </section>
    )
  }

  if (kind === 'day') {
    return (
      <DayChart
        powerSeries={powerSeries ?? []}
        seriesDefs={seriesDefs}
        visibleKeys={visibleKeys}
        title={title}
        height={height}
        chipTotals={chipTotals}
      />
    )
  }

  if (!series || series.length === 0) {
    const defs = seriesDefs?.length ? seriesDefs : DEFAULT_ENERGY
    const available = visibleKeys?.length ? defs.filter((d) => visibleKeys.includes(d.key)) : defs
    return (
      <section className="card energy-chart">
        <p className="section-label">{title ?? 'Verlauf · kWh'}</p>
        {chipTotals ? (
          <Legend defs={available} hidden={{}} onToggle={() => undefined} totals={chipTotals} />
        ) : null}
        <p className="energy-chart__empty">
          {source === 'manual'
            ? 'Kein Tagesverlauf — Werte manuell nachgetragen.'
            : 'Keine Energiedaten.'}
        </p>
      </section>
    )
  }

  return (
    <EnergyBarChart
      kind={kind}
      series={series}
      seriesDefs={seriesDefs}
      visibleKeys={visibleKeys}
      title={title}
      height={height}
      chipTotals={chipTotals}
    />
  )
}

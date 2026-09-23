import {
  Area,
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatKw } from '@/domain/calc'
import type { PeriodKind, PowerPoint, SeriesPoint } from '@/domain/types'
import './EnergyChart.css'

interface EnergyChartProps {
  kind: PeriodKind
  series: SeriesPoint[] | null
  powerSeries?: PowerPoint[] | null
  loading: boolean
}

const deKwh = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const deAxis = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

function formatAxis(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${deAxis.format(value / 1000)}k`
  }
  return deAxis.format(value)
}

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
}

function ChartTooltip({ active, payload, label, unit }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="energy-chart__tip">
      <div className="energy-chart__tip-label">{label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="energy-chart__tip-row">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span>
            {unit === 'W'
              ? formatKw(Math.max(0, entry.value ?? 0))
              : `${deKwh.format(entry.value ?? 0)} kWh`}
          </span>
        </div>
      ))}
    </div>
  )
}

function powerRows(series: PowerPoint[]) {
  return series.map((p) => {
    const d = new Date(p.t)
    return {
      key: p.t,
      label: new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(d),
      hour: d.getHours(),
      minute: d.getMinutes(),
      pvW: p.pvW,
      homeW: p.homeW,
      battDischargeW: p.batteryW > 0 ? p.batteryW : 0,
    }
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
    }
  })
}

export function EnergyChart({ kind, series, powerSeries, loading }: EnergyChartProps) {
  if (loading) {
    return (
      <section className="card energy-chart" aria-hidden>
        <div className="skeleton energy-chart__skel" />
      </section>
    )
  }

  if (kind === 'day') {
    const rows = powerRows(powerSeries ?? [])
    if (rows.length === 0) {
      return (
        <section className="card energy-chart">
          <p className="section-label">Verlauf · W · 15 min</p>
          <p className="energy-chart__empty">Keine Leistungsdaten für diesen Tag.</p>
        </section>
      )
    }
    const hourTicks = rows
      .filter((r) => r.minute === 0 && r.hour % 3 === 0)
      .map((r) => r.label)
    return (
      <section className="card energy-chart" aria-label="Leistungsverlauf">
        <p className="section-label">Verlauf · W · 15 min</p>
        <div className="energy-chart__frame">
          <ResponsiveContainer width="100%" height={200}>
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
                tick={{ fill: '#8B958D', fontSize: 11 }}
                tickFormatter={formatAxis}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                content={<ChartTooltip unit="W" />}
                cursor={{ stroke: '#2A302B' }}
              />
              <Area
                type="monotone"
                dataKey="pvW"
                name="Erzeugung"
                stroke="#E8B84A"
                fill="#E8B84A"
                fillOpacity={0.22}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="homeW"
                name="Verbrauch"
                stroke="#E7EEE8"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="battDischargeW"
                name="Batterie"
                stroke="#3DDC97"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
    )
  }

  if (!series || series.length === 0) {
    return (
      <section className="card energy-chart">
        <p className="section-label">Verlauf · kWh</p>
        <p className="energy-chart__empty">Keine Energiedaten.</p>
      </section>
    )
  }

  const rows = energyRows(kind, series)
  const useBars = kind === 'year'
  const monthTicks =
    kind === 'month'
      ? rows.filter((r) => {
          const day = Number(r.label)
          return day === 1 || day % 7 === 1
        }).map((r) => r.label)
      : undefined

  return (
    <section className="card energy-chart" aria-label="Energieverlauf">
      <p className="section-label">Verlauf · kWh</p>
      <div className="energy-chart__frame">
        <ResponsiveContainer width="100%" height={200}>
          {useBars ? (
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: '#8B958D', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fill: '#8B958D', fontSize: 11 }}
                tickFormatter={formatAxis}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                content={<ChartTooltip unit="kWh" />}
                cursor={{ fill: 'rgba(42,48,43,0.35)' }}
              />
              <Bar
                dataKey="pvKwh"
                name="Erzeugung"
                fill="#E8B84A"
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
              <Bar
                dataKey="homeKwh"
                name="Verbrauch"
                fill="#E7EEE8"
                fillOpacity={0.55}
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            </ComposedChart>
          ) : (
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                ticks={monthTicks}
                interval={0}
                tick={{ fill: '#8B958D', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8B958D', fontSize: 11 }}
                tickFormatter={formatAxis}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip content={<ChartTooltip unit="kWh" />} cursor={{ stroke: '#2A302B' }} />
              <Area
                type="monotone"
                dataKey="pvKwh"
                name="Erzeugung"
                stroke="#E8B84A"
                fill="#E8B84A"
                fillOpacity={0.22}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="homeKwh"
                name="Verbrauch"
                stroke="#E7EEE8"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  )
}

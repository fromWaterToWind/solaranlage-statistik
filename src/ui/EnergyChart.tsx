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
import type { PeriodKind, SeriesPoint } from '@/domain/types'
import './EnergyChart.css'

interface EnergyChartProps {
  kind: PeriodKind
  series: SeriesPoint[] | null
  loading: boolean
}

interface ChartRow {
  key: string
  label: string
  pvKwh: number
  homeKwh: number
  gridExportKwh: number
  gridImportKwh: number
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

function toRows(kind: PeriodKind, series: SeriesPoint[]): ChartRow[] {
  return series.map((p) => {
    const d = new Date(p.t)
    let label: string
    if (kind === 'day') {
      label = new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(d)
    } else if (kind === 'month') {
      label = String(d.getDate())
    } else {
      label = new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(d)
    }
    return {
      key: p.t,
      label,
      pvKwh: p.pvKwh,
      homeKwh: p.homeKwh,
      gridExportKwh: p.gridExportKwh,
      gridImportKwh: p.gridImportKwh,
    }
  })
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
}

function ChartTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="energy-chart__tip">
      <div className="energy-chart__tip-label">{label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="energy-chart__tip-row">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span>{deKwh.format(entry.value ?? 0)} kWh</span>
        </div>
      ))}
    </div>
  )
}

export function EnergyChart({ kind, series, loading }: EnergyChartProps) {
  if (loading || !series) {
    return (
      <section className="card energy-chart" aria-hidden>
        <div className="skeleton energy-chart__skel" />
      </section>
    )
  }

  const rows = toRows(kind, series)
  const tickEvery = kind === 'day' ? 4 : kind === 'month' ? 5 : 1
  const useBars = kind === 'year'

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
                content={<ChartTooltip />}
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
                tick={{ fill: '#8B958D', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={0}
                tickFormatter={(v: string, i: number) => (i % tickEvery === 0 ? v : '')}
              />
              <YAxis
                tick={{ fill: '#8B958D', fontSize: 11 }}
                tickFormatter={formatAxis}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#2A302B' }} />
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
              {kind === 'day' ? (
                <Area
                  type="monotone"
                  dataKey="gridImportKwh"
                  name="Aus Netz"
                  stroke="#7AA2FF"
                  fill="#7AA2FF"
                  fillOpacity={0.12}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  )
}

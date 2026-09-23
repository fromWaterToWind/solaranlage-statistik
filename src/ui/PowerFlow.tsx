import { formatKw, formatPercent } from '@/domain/calc'
import type { LiveSnapshot } from '@/domain/types'
import './PowerFlow.css'

interface PowerFlowProps {
  live: LiveSnapshot | null
}

const FLOW_MIN_W = 30
const STROKE_MIN = 1.2
const STROKE_MAX = 8

function strokeFor(watts: number, maxW: number): number {
  if (watts < FLOW_MIN_W) return 0
  const t = Math.min(1, watts / Math.max(maxW, 1))
  return STROKE_MIN + t * (STROKE_MAX - STROKE_MIN)
}

function FlowEdge({
  d,
  color,
  watts,
  maxW,
  reverse,
}: {
  d: string
  color: string
  watts: number
  maxW: number
  reverse?: boolean
}) {
  const width = strokeFor(watts, maxW)
  if (width <= 0) {
    return (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.12}
        strokeLinecap="round"
      />
    )
  }

  return (
    <path
      className="power-flow__edge"
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray="6 10"
      style={{
        animationDirection: reverse ? 'reverse' : 'normal',
        animationDuration: `${Math.max(0.6, 2.2 - width * 0.18)}s`,
      }}
    />
  )
}

export function PowerFlow({ live }: PowerFlowProps) {
  if (!live) {
    return (
      <section className="card power-flow power-flow--skeleton" aria-hidden>
        <div className="skeleton power-flow__skel" />
      </section>
    )
  }

  const { pvW, homeW, battery, grid } = live
  const chargeW = battery.chargeW
  const dischargeW = battery.dischargeW
  const importW = grid.importW
  const exportW = grid.exportW

  const maxW = Math.max(pvW, homeW, chargeW, dischargeW, importW, exportW, 1)

  const pvToHome = Math.max(0, Math.min(pvW, homeW) - dischargeW * 0.15)
  const isExport = exportW >= importW && exportW > FLOW_MIN_W
  const isCharge = chargeW >= dischargeW && chargeW > FLOW_MIN_W

  const batteryWatts = isCharge ? chargeW : dischargeW
  const batterySub = isCharge ? 'Laden' : dischargeW > FLOW_MIN_W ? 'Entladen' : 'Bereit'
  const batteryDetail =
    batteryWatts > FLOW_MIN_W ? `${batterySub} · ${formatKw(batteryWatts)}` : batterySub

  const gridLabel = isExport
    ? formatKw(exportW)
    : importW > FLOW_MIN_W
      ? formatKw(importW)
      : '—'
  const gridSub = isExport ? 'Einspeisung' : importW > FLOW_MIN_W ? 'Bezug' : 'Netz'

  const soc = Math.max(0, Math.min(100, battery.socPercent))
  const fillH = (soc / 100) * 28

  return (
    <section className="card power-flow" aria-label="Live Leistungsfluss">
      <svg
        className="power-flow__svg"
        viewBox="0 0 360 280"
        role="img"
        aria-label={`PV ${formatKw(pvW)}, Haus ${formatKw(homeW)}`}
      >
        {/* Edges */}
        <FlowEdge
          d="M180 78 C180 110, 180 120, 180 148"
          color="var(--pv)"
          watts={pvToHome}
          maxW={maxW}
        />
        <FlowEdge
          d="M148 70 C110 90, 90 120, 88 150"
          color="var(--battery)"
          watts={chargeW}
          maxW={maxW}
        />
        <FlowEdge
          d="M88 178 C100 210, 140 220, 160 200"
          color="var(--battery)"
          watts={dischargeW}
          maxW={maxW}
          reverse
        />
        <FlowEdge
          d="M212 70 C250 90, 270 120, 272 150"
          color="var(--grid-export)"
          watts={exportW}
          maxW={maxW}
        />
        <FlowEdge
          d="M272 178 C260 210, 220 220, 200 200"
          color="var(--grid-import)"
          watts={importW}
          maxW={maxW}
          reverse
        />

        {/* PV node */}
        <g className="power-flow__node" transform="translate(180 48)">
          <circle r="34" fill="#1c211c" stroke="var(--pv)" strokeWidth="1.5" />
          <circle r="8" fill="var(--pv)" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg * Math.PI) / 180
            const x1 = Math.cos(rad) * 14
            const y1 = Math.sin(rad) * 14
            const x2 = Math.cos(rad) * 22
            const y2 = Math.sin(rad) * 22
            return (
              <line
                key={deg}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--pv)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )
          })}
          <text y="52" textAnchor="middle" className="power-flow__label">
            Erzeugung
          </text>
          <text y="72" textAnchor="middle" className="power-flow__value power-flow__value--hero">
            {formatKw(pvW)}
          </text>
        </g>

        {/* Battery node */}
        <g className="power-flow__node" transform="translate(72 168)">
          <rect
            x="-28"
            y="-36"
            width="56"
            height="56"
            rx="14"
            fill="#1c211c"
            stroke="var(--battery)"
            strokeWidth="1.5"
          />
          {/* Cell outline */}
          <rect x="-12" y="-18" width="24" height="32" rx="3" fill="none" stroke="var(--battery)" strokeWidth="1.5" />
          <rect x="-5" y="-22" width="10" height="4" rx="1" fill="var(--battery)" />
          <rect
            x="-10"
            y={12 - fillH}
            width="20"
            height={fillH}
            rx="2"
            fill="var(--battery)"
            opacity={0.85}
          />
          <text y="38" textAnchor="middle" className="power-flow__label">
            Batterie
          </text>
          <text y="56" textAnchor="middle" className="power-flow__value">
            {formatPercent(soc)}
          </text>
          <text y="72" textAnchor="middle" className="power-flow__sub">
            {batteryDetail}
          </text>
        </g>

        {/* Home node */}
        <g className="power-flow__node" transform="translate(180 198)">
          <circle r="36" fill="#1c211c" stroke="var(--home)" strokeWidth="1.5" />
          <path
            d="M-12 4 L0 -10 L12 4 V14 H4 V6 H-4 V14 H-12 Z"
            fill="none"
            stroke="var(--home)"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <text y="54" textAnchor="middle" className="power-flow__label">
            Verbrauch
          </text>
          <text y="74" textAnchor="middle" className="power-flow__value power-flow__value--hero">
            {formatKw(homeW)}
          </text>
        </g>

        {/* Grid node */}
        <g className="power-flow__node" transform="translate(288 168)">
          <rect
            x="-28"
            y="-36"
            width="56"
            height="56"
            rx="14"
            fill="#1c211c"
            stroke={isExport ? 'var(--grid-export)' : 'var(--grid-import)'}
            strokeWidth="1.5"
          />
          <path
            d="M-10 -8 H10 M-6 -8 V12 M6 -8 V12 M-10 4 H10"
            fill="none"
            stroke={isExport ? 'var(--grid-export)' : 'var(--grid-import)'}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <text y="38" textAnchor="middle" className="power-flow__label">
            Netz
          </text>
          <text y="56" textAnchor="middle" className="power-flow__value">
            {gridLabel}
          </text>
          <text y="72" textAnchor="middle" className="power-flow__sub">
            {gridSub}
          </text>
        </g>
      </svg>
    </section>
  )
}

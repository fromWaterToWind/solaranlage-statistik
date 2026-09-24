import type { ReactNode } from 'react'
import { formatFlowW, formatPercent } from '@/domain/calc'
import type { LiveSnapshot } from '@/domain/types'
import './PowerFlow.css'

interface PowerFlowProps {
  live: LiveSnapshot | null
}

const FLOW_MIN_W = 1
const STROKE_MIN = 1.6
const STROKE_MAX = 5.5

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
}: {
  d: string
  color: string
  watts: number
  maxW: number
}) {
  const width = strokeFor(watts, maxW)
  if (width <= 0) return null
  return (
    <path
      className="power-flow__edge"
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray="5 8"
      style={{ animationDuration: `${Math.max(0.7, 2 - width * 0.16)}s` }}
    />
  )
}

function FlowLabel({
  x,
  y,
  watts,
  color,
}: {
  x: number
  y: number
  watts: number
  color: string
}) {
  if (watts < FLOW_MIN_W) return null
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-22" y="-8" width="44" height="16" rx="8" fill="#121512" stroke={color} strokeWidth="0.8" />
      <text y="4" textAnchor="middle" className="power-flow__chip" fill={color}>
        {formatFlowW(watts)}
      </text>
    </g>
  )
}

function TileIcon({
  x,
  y,
  stroke,
  children,
}: {
  x: number
  y: number
  stroke: string
  children: ReactNode
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="48" height="48" rx="14" fill="#1c211c" stroke={stroke} strokeWidth="1.4" />
      <g transform="translate(24 24)">{children}</g>
    </g>
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

  const { pvW, pvFault, homeW, homeFault, outputW, battery, grid } = live
  const chargeW = battery.fault ? 0 : battery.chargeW
  const dischargeW = battery.fault ? 0 : battery.dischargeW
  const importW = grid.fault ? 0 : grid.importW
  const exportW = grid.fault ? 0 : grid.exportW
  const pvToBattW = pvFault || chargeW < FLOW_MIN_W ? 0 : Math.min(pvW, chargeW)
  const pvToHomeW = pvFault ? 0 : Math.max(0, pvW - chargeW)
  const gridToBattW = Math.max(0, chargeW - (pvFault ? 0 : pvW))

  const maxW = Math.max(pvW, homeW, outputW, dischargeW, importW, exportW, pvToBattW, pvToHomeW, 1)
  const isExport = exportW > FLOW_MIN_W
  const gridStroke = isExport ? 'var(--grid-export)' : 'var(--grid-import)'
  const soc = Math.max(0, Math.min(100, battery.socPercent))
  const fillH = (soc / 100) * 18

  const battHint = battery.fault
    ? battery.fault
    : chargeW > FLOW_MIN_W
      ? `Laden ${formatFlowW(chargeW)}`
      : dischargeW > FLOW_MIN_W
        ? `Entladen ${formatFlowW(dischargeW)}`
        : 'Bereit'
  const gridHint = grid.fault
    ? grid.fault
    : isExport
      ? 'Einspeisung'
      : importW > FLOW_MIN_W
        ? 'Bezug'
        : 'Netz'
  const gridValue = grid.fault
    ? grid.fault
    : isExport
      ? formatFlowW(exportW)
      : importW > FLOW_MIN_W
        ? formatFlowW(importW)
        : '—'

  return (
    <section className="card power-flow" aria-label="Live Leistungsfluss">
      <svg
        className="power-flow__svg"
        viewBox="0 0 320 258"
        role="img"
        aria-label={`Solar ${formatFlowW(pvW)}, Verbrauch ${formatFlowW(homeW)}`}
      >
        <FlowEdge d="M136 52 Q 88 72, 64 100" color="var(--pv)" watts={pvToBattW} maxW={maxW} />
        <FlowEdge d="M160 56 L160 168" color="var(--pv)" watts={pvToHomeW} maxW={maxW} />
        <FlowEdge d="M64 148 Q 90 168, 136 176" color="var(--battery)" watts={dischargeW} maxW={maxW} />
        <FlowEdge d="M256 124 L64 124" color="var(--grid-import)" watts={gridToBattW} maxW={maxW} />
        <FlowEdge d="M256 148 Q 230 168, 184 176" color="var(--grid-import)" watts={importW} maxW={maxW} />
        <FlowEdge d="M184 180 Q 230 168, 256 148" color="var(--grid-export)" watts={exportW} maxW={maxW} />

        <FlowLabel x={92} y={78} watts={pvToBattW} color="var(--pv)" />
        <FlowLabel x={186} y={118} watts={pvToHomeW} color="var(--pv)" />

        {/* Solar */}
        <TileIcon x={136} y={8} stroke="var(--pv)">
          <circle r="5" fill="var(--pv)" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg * Math.PI) / 180
            return (
              <line
                key={deg}
                x1={Math.cos(rad) * 8}
                y1={Math.sin(rad) * 8}
                x2={Math.cos(rad) * 14}
                y2={Math.sin(rad) * 14}
                stroke="var(--pv)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )
          })}
        </TileIcon>
        <text x={160} y={72} textAnchor="middle" className="power-flow__name">
          Solar
        </text>
        <text
          x={160}
          y={88}
          textAnchor="middle"
          className={`power-flow__num${pvFault ? ' is-fault' : ''}`}
        >
          {pvFault ?? formatFlowW(pvW)}
        </text>

        {/* Battery */}
        <TileIcon x={16} y={100} stroke="var(--battery)">
          <rect x="-8" y="-10" width="16" height="22" rx="2.5" fill="none" stroke="var(--battery)" strokeWidth="1.5" />
          <rect x="-3.5" y="-13" width="7" height="3" rx="1" fill="var(--battery)" />
          {!battery.socFault ? (
            <rect x="-6" y={10 - fillH} width="12" height={fillH} rx="1.5" fill="var(--battery)" opacity="0.9" />
          ) : null}
        </TileIcon>
        <text x={40} y={164} textAnchor="middle" className="power-flow__name">
          Batterie
        </text>
        <text
          x={40}
          y={180}
          textAnchor="middle"
          className={`power-flow__num${battery.socFault ? ' is-fault' : ''}`}
        >
          {battery.socFault ?? formatPercent(soc)}
        </text>
        <text x={40} y={194} textAnchor="middle" className="power-flow__hint">
          {battHint}
        </text>

        {/* Grid */}
        <TileIcon x={256} y={100} stroke={gridStroke}>
          <path
            d="M-8 -6 H8 M-5 -6 V10 M5 -6 V10 M-8 4 H8"
            fill="none"
            stroke={gridStroke}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </TileIcon>
        <text x={280} y={164} textAnchor="middle" className="power-flow__name">
          Netz
        </text>
        <text x={280} y={180} textAnchor="middle" className={`power-flow__num${grid.fault ? ' is-fault' : ''}`}>
          {gridValue}
        </text>
        <text x={280} y={194} textAnchor="middle" className="power-flow__hint">
          {gridHint}
        </text>

        {/* House */}
        <TileIcon x={136} y={168} stroke="var(--home)">
          <path
            d="M-10 4 L0 -8 L10 4 V12 H3 V6 H-3 V12 H-10 Z"
            fill="none"
            stroke="var(--home)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </TileIcon>
        <text x={160} y={232} textAnchor="middle" className="power-flow__name">
          Verbrauch
        </text>
        <text
          x={160}
          y={248}
          textAnchor="middle"
          className={`power-flow__num${homeFault ? ' is-fault' : ''}`}
        >
          {homeFault ?? formatFlowW(homeW)}
        </text>
      </svg>
      <p className="power-flow__output">
        <span>Output</span>
        <span>{formatFlowW(outputW)}</span>
      </p>
    </section>
  )
}

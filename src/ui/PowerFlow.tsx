import { formatKw, formatMeasuredW, formatPercent } from '@/domain/calc'
import type { LiveSnapshot } from '@/domain/types'
import './PowerFlow.css'

interface PowerFlowProps {
  live: LiveSnapshot | null
}

const FLOW_MIN_W = 1
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
      strokeDasharray="6 10"
      style={{
        animationDuration: `${Math.max(0.6, 2.2 - width * 0.18)}s`,
      }}
    />
  )
}

function NodeValue({
  text,
  hero,
  fault,
}: {
  text: string
  hero?: boolean
  fault: string | null
}) {
  return (
    <text
      y={hero ? 72 : 56}
      textAnchor="middle"
      className={`power-flow__value${hero ? ' power-flow__value--hero' : ''}${fault ? ' power-flow__value--fault' : ''}`}
    >
      {text}
    </text>
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

  const { pvW, pvFault, homeW, homeFault, battery, grid } = live
  const chargeW = battery.fault ? 0 : battery.chargeW
  const dischargeW = battery.fault ? 0 : battery.dischargeW
  const importW = grid.fault ? 0 : grid.importW
  const exportW = grid.fault ? 0 : grid.exportW

  const maxW = Math.max(pvW, homeW, chargeW, dischargeW, importW, exportW, 1)

  const isExport = exportW >= importW && exportW > FLOW_MIN_W
  const isCharge = chargeW >= dischargeW && chargeW > FLOW_MIN_W

  const batteryWatts = isCharge ? chargeW : dischargeW
  const batterySub = battery.fault
    ? battery.fault
    : isCharge
      ? 'Laden'
      : dischargeW > FLOW_MIN_W
        ? 'Entladen'
        : 'Bereit'
  const batteryDetail = battery.fault
    ? battery.fault
    : batteryWatts > FLOW_MIN_W
      ? `${batterySub} · ${formatKw(batteryWatts)}`
      : batterySub

  const gridLabel = grid.fault
    ? grid.fault
    : isExport
      ? formatKw(exportW)
      : importW > FLOW_MIN_W
        ? formatKw(importW)
        : '—'
  const gridSub = grid.fault ? 'Fehler' : isExport ? 'Einspeisung' : importW > FLOW_MIN_W ? 'Bezug' : 'Netz'

  const soc = Math.max(0, Math.min(100, battery.socPercent))
  const fillH = (soc / 100) * 28

  return (
    <section className="card power-flow" aria-label="Live Leistungsfluss">
      <svg
        className="power-flow__svg"
        viewBox="0 0 360 280"
        role="img"
        aria-label={`PV ${formatMeasuredW(pvW, pvFault)}, Haus ${formatMeasuredW(homeW, homeFault)}`}
      >
        <FlowEdge
          d="M180 82 L180 162"
          color="var(--pv)"
          watts={pvFault ? 0 : pvW}
          maxW={maxW}
        />
        <FlowEdge
          d="M160 200 C120 210, 100 200, 96 176"
          color="var(--battery)"
          watts={chargeW}
          maxW={maxW}
        />
        <FlowEdge
          d="M96 176 C100 210, 140 220, 160 200"
          color="var(--battery)"
          watts={dischargeW}
          maxW={maxW}
        />
        <FlowEdge
          d="M200 200 C240 210, 260 200, 264 176"
          color="var(--grid-export)"
          watts={exportW}
          maxW={maxW}
        />
        <FlowEdge
          d="M264 176 C260 210, 220 220, 200 200"
          color="var(--grid-import)"
          watts={importW}
          maxW={maxW}
        />

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
          <NodeValue text={formatMeasuredW(pvW, pvFault)} hero fault={pvFault} />
        </g>

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
          <rect x="-12" y="-18" width="24" height="32" rx="3" fill="none" stroke="var(--battery)" strokeWidth="1.5" />
          <rect x="-5" y="-22" width="10" height="4" rx="1" fill="var(--battery)" />
          {!battery.socFault ? (
            <rect
              x="-10"
              y={12 - fillH}
              width="20"
              height={fillH}
              rx="2"
              fill="var(--battery)"
              opacity={0.85}
            />
          ) : null}
          <text y="38" textAnchor="middle" className="power-flow__label">
            Batterie
          </text>
          <text
            y="56"
            textAnchor="middle"
            className={`power-flow__value${battery.socFault ? ' power-flow__value--fault' : ''}`}
          >
            {battery.socFault ?? formatPercent(soc)}
          </text>
          <text y="72" textAnchor="middle" className="power-flow__sub">
            {batteryDetail}
          </text>
        </g>

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
          <NodeValue text={formatMeasuredW(homeW, homeFault)} hero fault={homeFault} />
        </g>

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
          <text
            y="56"
            textAnchor="middle"
            className={`power-flow__value${grid.fault ? ' power-flow__value--fault' : ''}`}
          >
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

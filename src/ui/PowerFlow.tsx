import { formatKw, formatMeasuredW, formatPercent } from '@/domain/calc'
import type { LiveSnapshot } from '@/domain/types'
import './PowerFlow.css'

interface PowerFlowProps {
  live: LiveSnapshot | null
}

const FLOW_MIN_W = 1
const STROKE_MIN = 1.4
const STROKE_MAX = 7

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
  const pvToBattW =
    pvFault || chargeW < FLOW_MIN_W ? 0 : Math.min(pvW, chargeW)
  const gridToBattW = Math.max(0, chargeW - (pvFault ? 0 : pvW))

  const maxW = Math.max(pvW, homeW, outputW, dischargeW, importW, exportW, pvToBattW, 1)

  const isExport = exportW > FLOW_MIN_W
  const isCharge = chargeW > FLOW_MIN_W

  const batterySub = battery.fault
    ? battery.fault
    : isCharge
      ? `Laden · ${formatKw(chargeW)}`
      : dischargeW > FLOW_MIN_W
        ? `Entladen · ${formatKw(dischargeW)}`
        : 'Bereit'

  const gridLabel = grid.fault
    ? grid.fault
    : isExport
      ? formatKw(exportW)
      : importW > FLOW_MIN_W
        ? formatKw(importW)
        : '—'
  const gridSub = grid.fault
    ? 'Fehler'
    : isExport
      ? 'Einspeisung'
      : importW > FLOW_MIN_W
        ? 'Bezug'
        : 'Netz'

  const soc = Math.max(0, Math.min(100, battery.socPercent))
  const fillH = (soc / 100) * 26

  return (
    <section className="card power-flow" aria-label="Live Leistungsfluss">
      <svg
        className="power-flow__svg"
        viewBox="0 0 360 330"
        role="img"
        aria-label={`PV ${formatMeasuredW(pvW, pvFault)}, Output ${formatKw(outputW)}, Haus ${formatMeasuredW(homeW, homeFault)}`}
      >
        <FlowEdge
          d="M158 78 Q 100 100, 78 128"
          color="var(--pv)"
          watts={pvToBattW}
          maxW={maxW}
        />
        <FlowEdge
          d="M78 176 Q 110 228, 148 242"
          color="var(--battery)"
          watts={dischargeW}
          maxW={maxW}
        />
        <FlowEdge
          d="M282 148 Q 180 132, 90 148"
          color="var(--grid-import)"
          watts={gridToBattW}
          maxW={maxW}
        />
        <FlowEdge
          d="M282 176 Q 250 228, 212 242"
          color="var(--grid-import)"
          watts={importW}
          maxW={maxW}
        />
        <FlowEdge
          d="M212 248 Q 250 228, 282 176"
          color="var(--grid-export)"
          watts={exportW}
          maxW={maxW}
        />

        {/* PV */}
        <g className="power-flow__node" transform="translate(180 50)">
          <circle r="32" fill="#1c211c" stroke="var(--pv)" strokeWidth="1.5" />
          <circle r="7" fill="var(--pv)" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg * Math.PI) / 180
            return (
              <line
                key={deg}
                x1={Math.cos(rad) * 12}
                y1={Math.sin(rad) * 12}
                x2={Math.cos(rad) * 20}
                y2={Math.sin(rad) * 20}
                stroke="var(--pv)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )
          })}
          <text y="46" textAnchor="middle" className="power-flow__label">
            Solar
          </text>
          <text y="64" textAnchor="middle" className={`power-flow__value${pvFault ? ' power-flow__value--fault' : ''}`}>
            {formatMeasuredW(pvW, pvFault)}
          </text>
        </g>

        {/* Battery */}
        <g className="power-flow__node" transform="translate(64 148)">
          <rect x="-30" y="-34" width="60" height="54" rx="14" fill="#1c211c" stroke="var(--battery)" strokeWidth="1.5" />
          <rect x="-11" y="-16" width="22" height="30" rx="3" fill="none" stroke="var(--battery)" strokeWidth="1.5" />
          <rect x="-5" y="-20" width="10" height="4" rx="1" fill="var(--battery)" />
          {!battery.socFault ? (
            <rect
              x="-9"
              y={12 - fillH}
              width="18"
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
            y="54"
            textAnchor="middle"
            className={`power-flow__value${battery.socFault ? ' power-flow__value--fault' : ''}`}
          >
            {battery.socFault ?? formatPercent(soc)}
          </text>
          <text y="70" textAnchor="middle" className="power-flow__sub">
            {batterySub}
          </text>
        </g>

        {/* Grid */}
        <g className="power-flow__node" transform="translate(296 148)">
          <rect
            x="-30"
            y="-34"
            width="60"
            height="54"
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
            y="54"
            textAnchor="middle"
            className={`power-flow__value${grid.fault ? ' power-flow__value--fault' : ''}`}
          >
            {gridLabel}
          </text>
          <text y="70" textAnchor="middle" className="power-flow__sub">
            {gridSub}
          </text>
        </g>

        {/* House — hero */}
        <g className="power-flow__node" transform="translate(180 248)">
          <rect
            x="-78"
            y="-38"
            width="156"
            height="76"
            rx="18"
            fill="#1c211c"
            stroke="var(--home)"
            strokeWidth="1.6"
          />
          <path
            d="M-14 -8 L0 -22 L14 -8 V8 H4 V0 H-4 V8 H-14 Z"
            fill="none"
            stroke="var(--home)"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <text y="24" textAnchor="middle" className="power-flow__label">
            Verbrauch
          </text>
          <text
            y="46"
            textAnchor="middle"
            className={`power-flow__value power-flow__value--hero${homeFault ? ' power-flow__value--fault' : ''}`}
          >
            {formatMeasuredW(homeW, homeFault)}
          </text>
        </g>
      </svg>
      <p className="power-flow__output">
        <span className="power-flow__output-label">Output (Shelly)</span>
        <span className="power-flow__output-value">{formatKw(outputW)}</span>
      </p>
    </section>
  )
}

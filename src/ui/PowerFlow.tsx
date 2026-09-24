import type { ReactNode } from 'react'
import { formatFlowW, formatPercent } from '@/domain/calc'
import type { LiveSnapshot } from '@/domain/types'
import './PowerFlow.css'

const MIN = 1

function FlowEdge({
  d,
  color,
  watts,
}: {
  d: string
  color: string
  watts: number
}) {
  const active = watts >= MIN
  return (
    <g>
      <path d={d} fill="none" stroke="var(--border)" strokeWidth="1.15" strokeLinecap="round" />
      {active ? (
        <>
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.42"
          />
          <path
            className="power-flow__flow"
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray="0 17"
          />
        </>
      ) : null}
    </g>
  )
}

function FlowNode({
  x,
  y,
  name,
  value,
  hint,
  fault,
  children,
}: {
  x: number
  y: number
  name: string
  value: string
  hint?: string
  fault: boolean
  children: ReactNode
}) {
  const h = 56
  return (
    <g className="power-flow__node" transform={`translate(${x} ${y})`}>
      <rect
        x="-58"
        y={-h / 2}
        width="116"
        height={h}
        rx="10"
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      <g transform="translate(-42 0)" aria-hidden>
        {children}
      </g>
      <text className="power-flow__name" x="-24" y={hint ? -10 : -6}>
        {name}
      </text>
      <text className={`power-flow__num${fault ? ' is-fault' : ''}`} x="-24" y={hint ? 7 : 12}>
        {value}
      </text>
      {hint ? (
        <text className="power-flow__hint" x="-24" y="21">
          {hint}
        </text>
      ) : null}
    </g>
  )
}

export function PowerFlow({ live }: { live: LiveSnapshot | null }) {
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
  const pvToBattW = pvFault || chargeW < MIN ? 0 : Math.min(pvW, chargeW)
  const pvToHomeW = pvFault ? 0 : Math.max(0, pvW - chargeW)
  const gridToBattW = Math.max(0, chargeW - (pvFault ? 0 : pvW))
  const isExport = exportW > MIN
  const gridAccent = isExport ? 'var(--grid-export)' : 'var(--grid-import)'
  const soc = Math.max(0, Math.min(100, battery.socPercent))
  const fillH = (soc / 100) * 11

  const battHint = battery.fault
    ? battery.fault
    : chargeW > MIN
      ? `Laden ${formatFlowW(chargeW)}`
      : dischargeW > MIN
        ? `Entladen ${formatFlowW(dischargeW)}`
        : undefined
  const gridHint = grid.fault
    ? grid.fault
    : isExport
      ? 'Einspeisung'
      : importW > MIN
        ? 'Bezug'
        : undefined
  const gridValue = grid.fault
    ? grid.fault
    : isExport
      ? formatFlowW(exportW)
      : importW > MIN
        ? formatFlowW(importW)
        : '0 W'

  return (
    <section className="card power-flow" aria-label="Live Leistungsfluss">
      <svg className="power-flow__svg" viewBox="0 0 360 292" role="img">
        <title>Leistungsfluss Solar, Speicher, Netz, Haus</title>
        <FlowEdge d="M180 61 L180 146 L121 146" color="var(--pv)" watts={pvToBattW} />
        <FlowEdge d="M180 61 L180 225" color="var(--pv)" watts={pvToHomeW} />
        <FlowEdge d="M121 146 L180 146 L180 225" color="var(--battery)" watts={dischargeW} />
        <FlowEdge d="M239 146 L121 146" color="var(--grid-import)" watts={gridToBattW} />
        <FlowEdge d="M239 146 L180 146 L180 225" color="var(--grid-import)" watts={importW} />
        <FlowEdge d="M180 61 L180 146 L239 146" color="var(--grid-export)" watts={exportW} />

        <circle cx="180" cy="146" r="3.2" fill="var(--bg)" stroke="var(--border)" strokeWidth="1.15" />

        <FlowNode
          x={180}
          y={36}
          name="Solar"
          value={pvFault ?? formatFlowW(pvW)}
          fault={Boolean(pvFault)}
        >
          <g fill="none" stroke="var(--pv)" strokeWidth="1.25" strokeLinejoin="round">
            <rect x="-8" y="-6.5" width="16" height="13" rx="1.2" />
            <path d="M-8 0 H8 M-2.7 -6.5 V6.5 M2.7 -6.5 V6.5" />
          </g>
        </FlowNode>

        <FlowNode
          x={62}
          y={146}
          name="Speicher"
          value={battery.socFault ?? formatPercent(soc)}
          hint={battHint}
          fault={Boolean(battery.socFault)}
        >
          <g fill="none" stroke="var(--battery)" strokeWidth="1.25">
            <rect x="-6.5" y="-8" width="13" height="16" rx="1.6" />
            <rect x="-3" y="-10" width="6" height="2.2" rx="0.6" fill="var(--battery)" stroke="none" />
            {!battery.socFault ? (
              <rect
                x="-4.6"
                y={6.2 - fillH}
                width="9.2"
                height={fillH}
                rx="0.7"
                fill="var(--battery)"
                stroke="none"
                opacity="0.85"
              />
            ) : null}
          </g>
        </FlowNode>

        <FlowNode
          x={298}
          y={146}
          name="Netz"
          value={gridValue}
          hint={gridHint}
          fault={Boolean(grid.fault)}
        >
          <g fill="none" stroke={gridAccent} strokeWidth="1.25" strokeLinecap="round">
            <path d="M0 -8 L-5 0 H5 Z" />
            <path d="M0 0 V8 M-6 8 H6" />
          </g>
        </FlowNode>

        <FlowNode
          x={180}
          y={250}
          name="Haus"
          value={homeFault ?? formatFlowW(homeW)}
          fault={Boolean(homeFault)}
        >
          <g fill="none" stroke="var(--home)" strokeWidth="1.25" strokeLinejoin="round">
            <path d="M-8 1 L0 -7 L8 1 V8 H3 V3 H-3 V8 H-8 Z" />
          </g>
        </FlowNode>
      </svg>
    </section>
  )
}

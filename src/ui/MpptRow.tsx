import { formatKw } from '@/domain/calc'
import type { MpptLive } from '@/domain/types'
import './MpptRow.css'

interface MpptRowProps {
  mppts: MpptLive[] | null
}

export function MpptRow({ mppts }: MpptRowProps) {
  if (!mppts || mppts.length === 0) {
    return (
      <section className="mppt-row" aria-hidden>
        <div className="skeleton mppt-row__skel" />
        <div className="skeleton mppt-row__skel" />
      </section>
    )
  }

  const maxW = Math.max(...mppts.map((m) => (m.fault ? 0 : m.powerW)), 1)

  return (
    <section className="mppt-row" aria-label="MPPT Tracker">
      {mppts.map((m) => {
        const fill = m.fault ? 0 : Math.round((m.powerW / maxW) * 100)
        return (
          <div key={m.id} className={`mppt-pill${m.fault ? ' is-fault' : ''}`}>
            <div className="mppt-pill__fill" style={{ width: `${fill}%` }} />
            <div className="mppt-pill__content">
              <span className="mppt-pill__name">{m.name}</span>
              <span className="mppt-pill__watts">
                {m.fault ?? formatKw(m.powerW)}
              </span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatKwh } from '@/domain/calc'
import {
  decodeShare,
  encodeShare,
  mergeFriendShare,
  thisMonthKwh,
  type FriendDay,
  type FriendMonth,
  type FriendShare,
} from '@/domain/friends'
import './Friends.css'

interface FriendsProps {
  friends: FriendShare[]
  onChange: (rows: FriendShare[]) => void
  myName?: string
  myMonths: FriendMonth[]
  myDays?: FriendDay[]
  myThisMonthKwh: number
}

export function Friends({
  friends,
  onChange,
  myName = 'Ich',
  myMonths,
  myDays,
  myThisMonthKwh,
}: FriendsProps) {
  const [paste, setPaste] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const friendsRef = useRef(friends)
  friendsRef.current = friends

  const myCode = useMemo(
    () =>
      encodeShare({
        name: myName,
        months: myMonths,
        days: myDays,
        updatedAt: new Date().toISOString(),
      }),
    [myName, myMonths, myDays],
  )

  const ranking = useMemo(() => {
    const rows = [
      { id: 'me', name: myName, kwh: myThisMonthKwh, mine: true },
      ...friends.map((f) => ({
        id: f.id,
        name: f.name,
        kwh: thisMonthKwh(f),
        mine: false,
      })),
    ]
    return [...rows].sort((a, b) => b.kwh - a.kwh)
  }, [friends, myName, myThisMonthKwh])

  const applyShare = useCallback(
    (decoded: Omit<FriendShare, 'id'>) => {
      setError(null)
      onChange(mergeFriendShare(friends, decoded))
    },
    [friends, onChange],
  )

  const pullFromClipboard = useCallback(
    async (showErrors: boolean) => {
      try {
        const text = await navigator.clipboard.readText()
        if (!text.trim().startsWith('SOLAR1.')) return
        const decoded = decodeShare(text)
        if (!decoded) {
          if (showErrors) setError('Kein gültiger Share-Code.')
          return
        }
        applyShare(decoded)
      } catch {
        if (showErrors) setError('Zwischenablage nicht erlaubt.')
      }
    },
    [applyShare],
  )

  useEffect(() => {
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (!text.trim().startsWith('SOLAR1.')) return
        const decoded = decodeShare(text)
        if (!decoded) return
        setError(null)
        onChange(mergeFriendShare(friendsRef.current, decoded))
      } catch {
        /* clipboard denied — stay silent */
      }
    })()
  }, [onChange])

  const addPaste = () => {
    const decoded = decodeShare(paste)
    if (!decoded) {
      setError('Kein gültiger Share-Code.')
      return
    }
    applyShare(decoded)
    setPaste('')
  }

  const copyMine = async () => {
    try {
      await navigator.clipboard.writeText(myCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Zwischenablage nicht erlaubt — Code unten markieren.')
    }
  }

  return (
    <section className="friends" aria-label="Freunde">
      <article className="card friends__sync">
        <p className="section-label">Sync — ehrlich</p>
        <p className="friends__copy">
          Kein Server, keine Accounts — alles bleibt lokal in eurem Browser. Zum Testen: zwei
          Fenster auf einem Mac (oder zwei Geräte): in einem „Code kopieren“, in der anderen App
          Freunde öffnen — beim Öffnen wird die Zwischenablage automatisch gelesen, oder ihr tippt
          „Zwischenablage holen“. Alternativ den Code unten einfügen.
        </p>
      </article>

      <article className="card">
        <p className="section-label">Dieser Monat</p>
        {ranking.length <= 1 && friends.length === 0 ? (
          <p className="friends__copy">Noch niemand drin. Code teilen, Antwort einfügen.</p>
        ) : (
          <ol className="friends__rank">
            {ranking.map((row, i) => (
              <li key={row.id} className={row.mine ? 'is-me' : undefined}>
                <span>
                  {i + 1}. {row.name}
                </span>
                <span>{formatKwh(row.kwh)}</span>
              </li>
            ))}
          </ol>
        )}
      </article>

      <div>
        <p className="section-label">Mein Code</p>
        <button type="button" className="friends__cta" onClick={() => void copyMine()}>
          {copied ? 'Kopiert' : 'Code kopieren'}
        </button>
        <textarea className="friends__code" readOnly rows={3} value={myCode} />
      </div>

      <div>
        <p className="section-label">Freund hinzufügen</p>
        <button
          type="button"
          className="friends__cta"
          onClick={() => void pullFromClipboard(true)}
        >
          Zwischenablage holen
        </button>
        <textarea
          className="friends__code"
          rows={3}
          placeholder="SOLAR1.…"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        {error ? <p className="friends__err">{error}</p> : null}
        <button type="button" className="friends__cta" onClick={addPaste}>
          Einfügen
        </button>
      </div>

      {friends.length ? (
        <ul className="friends__list">
          {friends.map((f) => (
            <li key={f.id} className="card friends__row">
              <div>
                <strong>{f.name}</strong>
                <span>
                  {f.months.length} Monate
                  {f.days?.length ? ` · ${f.days.length} Tage` : ''} · Stand{' '}
                  {new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(
                    new Date(f.updatedAt),
                  )}
                </span>
              </div>
              <button
                type="button"
                className="friends__remove"
                onClick={() => onChange(friends.filter((x) => x.id !== f.id))}
              >
                Weg
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

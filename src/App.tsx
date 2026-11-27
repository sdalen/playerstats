import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from 'react'

// Årgangsliste: kun lokalt (npm run dev). Gjør ett API-kall per spiller, så den er ikke med i produksjonsbygget.
const LastGoalList = import.meta.env.DEV ? lazy(() => import('./LastGoalList')) : null
import {
  addSummary,
  daysSince,
  emptySummary,
  fetchPlayer,
  formatDate,
  formatIceTime,
  formatTime,
  isTracked,
  latestMatches,
  matchUrl,
  parsePlayerInput,
  playerUrl,
  plusMinus,
  seasonLabel,
  seasonOf,
  type Match,
  type PlayerData,
  type Summary,
  type TournamentStats,
} from './hockey'

type Col = { key: keyof Summary; label: string; title: string; fmt?: (v: number) => string }

/** Summerer turneringer; +/−, skudd og istid telles bare fra turneringer der de registreres. */
function sumStats(ts: TournamentStats[]) {
  const sum = emptySummary()
  const has = {} as Record<keyof Summary, boolean>
  for (const t of ts) {
    const part = { ...t.summary }
    for (const k of Object.keys(part) as (keyof Summary)[]) {
      if (isTracked(k, t.tracked)) has[k] = true
      else part[k] = 0
    }
    Object.assign(sum, addSummary(sum, part))
  }
  return { sum, has }
}

/** Istid vises som min:sek (summert i totaler, per kamp i kamplisten). */
const show = (c: Col, v: number, tracked: boolean) => {
  if (!tracked) return '–'
  if (c.key === 'totalSecondsPlayed') return formatIceTime(v)
  return (c.fmt ?? String)(v)
}

const COLS: Col[] = [
  { key: 'gamesPlayed', label: 'K', title: 'Kamper' },
  { key: 'goalsScored', label: 'M', title: 'Mål' },
  { key: 'assists', label: 'A', title: 'Assist' },
  { key: 'pts', label: 'P', title: 'Poeng' },
  { key: 'points', label: '+/−', title: 'Pluss/minus', fmt: plusMinus },
  { key: 'pim', label: 'UM', title: 'Utvisningsminutter' },
  { key: 'shots', label: 'S', title: 'Skudd' },
  { key: 'totalSecondsPlayed', label: 'Istid', title: 'Total istid (min:sek)' },
]

function readUrlInput() {
  const p = new URLSearchParams(window.location.search)
  return p.get('playerId') ?? ''
}

export default function App() {
  const [input, setInput] = useState(readUrlInput)
  const [data, setData] = useState<PlayerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromSeason, setFromSeason] = useState<number | 'all'>('all')

  async function load(raw: string) {
    const { playerId, orgId } = parsePlayerInput(raw)
    if (!playerId) {
      setError('Fant ingen playerId. Lim inn et tall eller en live.hockey.no-lenke.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const d = await fetchPlayer(playerId, orgId)
      setData(d)
      setFromSeason('all')
      const url = new URL(window.location.href)
      url.searchParams.set('playerId', playerId)
      window.history.replaceState(null, '', url)
      if (d.tournaments.length === 0) setError('Fant ingen kamper for denne spilleren.')
    } catch (e) {
      setData(null)
      setError(`Kunne ikke hente data: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (input) void load(input)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void load(input)
  }

  const seasons = useMemo(
    () => [...new Set(data?.tournaments.map((t) => t.season) ?? [])].sort((a, b) => b - a),
    [data],
  )
  const visible = useMemo(
    () => data?.tournaments.filter((t) => fromSeason === 'all' || t.season === fromSeason) ?? [],
    [data, fromSeason],
  )
  const { sum: total, has: totalHas } = sumStats(visible)
  const matches = latestMatches(visible)
  const lastGoal = matches.find((m) => m.goalsScored > 0)
  const lastPoint = matches.find((m) => m.pts > 0)

  const bySeason = useMemo(() => {
    const map = new Map<number, typeof visible>()
    for (const t of visible) map.set(t.season, [...(map.get(t.season) ?? []), t])
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [visible])

  const name = [data?.info.firstName, data?.info.lastName].filter(Boolean).join(' ')

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ul className="mb-4 list-disc space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 pl-7 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <li>
            En kamp telles som spilt når spilleren står oppført i kamptroppen. Utenom turneringer med Wisehockey-sporing
            sier dataene ingenting om spilletid (istid).
          </li>
          <li>Skudd registreres bare fra U16 og eldre.</li>
          <li>
            Istid og +/− registreres bare i turneringer med Wisehockey-sporing (typisk EHL, U20 Elite og U18 Elite). I
            andre turneringer er +/− ikke pålitelig, og begge vises ikke.
          </li>
          <li>
            «–» betyr at tallet ikke registreres i turneringen. Totalene for skudd, +/− og istid tar bare med
            turneringene der de finnes. Istid vises som minutter:sekunder, summert i totaler og per turnering.
          </li>
        </ul>
        <h1 className="text-2xl font-bold">Spillerstatistikk ishockey</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Lim inn en playerId eller en spillerlenke fra live.hockey.no.
        </p>
        <details className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          <summary className="cursor-pointer text-sky-700 hover:underline dark:text-sky-400">
            Slik finner du lenken
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Gå til{' '}
              <a href="https://live.hockey.no" target="_blank" rel="noreferrer" className="text-sky-700 underline dark:text-sky-400">
                live.hockey.no
              </a>{' '}
              og velg turneringen spilleren spiller i (f.eks. U18 1.div).
            </li>
            <li>Åpne en kamp spilleren har spilt, eller statistikken for turneringen.</li>
            <li>Klikk på spillerens navn for å åpne spillersiden.</li>
            <li>
              Kopier adressen fra adressefeltet i nettleseren. Den ser omtrent slik ut:
              <code className="mt-1 block break-all rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                https://live.hockey.no/player/?seasonId=…&tournamentId=…&playerId=1234567&orgId=…
              </code>
            </li>
            <li>
              Lim den inn i feltet under og trykk «Hent». Du kan også lime inn bare tallet etter{' '}
              <code>playerId=</code>.
            </li>
          </ol>
        </details>

        <form onSubmit={onSubmit} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="1234567 eller https://live.hockey.no/player/?…&playerId=…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {loading ? 'Henter…' : 'Hent'}
          </button>
        </form>

        {LastGoalList && (
          <Suspense fallback={null}>
            <LastGoalList
              onSelectPlayer={(id) => {
                setInput(id)
                void load(id)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          </Suspense>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {data && data.failed.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            NIF svarte ikke for {data.failed.length === 1 ? 'denne turneringen' : 'disse turneringene'}, så tallene kan
            mangle kamper: {data.failed.map((t) => `${t.tournamentName} (${seasonLabel(seasonOf(t.startDate))})`).join(', ')}.{' '}
            <button onClick={() => void load(data.playerId)} className="font-medium underline">
              Prøv igjen
            </button>
          </div>
        )}

        {data && data.tournaments.length > 0 && (
          <>
            <header className="mt-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">
                  {name || `Spiller ${data.playerId}`}
                  {data.info.number && <span className="ml-2 text-slate-400">#{data.info.number}</span>}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {[
                    data.info.position,
                    data.info.birthDate && `født ${formatDate(data.info.birthDate)}`,
                    matches[0]?.teamName,
                    `playerId ${data.playerId}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <label className="text-sm">
                Sesong{' '}
                <select
                  value={fromSeason}
                  onChange={(e) => setFromSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="all">Alle</option>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
            </header>

            <section className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-8">
              {COLS.map((c) => (
                <div key={c.key} className="rounded-xl bg-white p-3 text-center shadow-sm dark:bg-slate-900">
                  <div className="text-2xl font-bold tabular-nums">{show(c, total[c.key], !!totalHas[c.key])}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{c.title}</div>
                </div>
              ))}
            </section>

            <section className="mt-4 grid gap-3 sm:grid-cols-3">
              <LastEvent label="Siste mål" match={lastGoal} />
              <LastEvent label="Siste poeng" match={lastPoint} />
              <LastEvent label="Siste kamp" match={matches[0]} />
            </section>

            <section className="mt-8">
              <h3 className="mb-2 text-lg font-semibold">Per sesong og turnering</h3>
              <div className="overflow-x-auto rounded-xl bg-white shadow-sm dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">Turnering</th>
                      {COLS.map((c) => (
                        <th key={c.key} title={c.title} className="px-2 py-2 text-right font-medium">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bySeason.map(([season, ts]) => {
                      const { sum, has } = sumStats(ts)
                      return [
                        <tr key={`s${season}`} className="bg-slate-100 font-semibold dark:bg-slate-800">
                          <td className="px-3 py-1.5">{seasonLabel(season)}</td>
                          {COLS.map((c) => (
                            <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                              {show(c, sum[c.key], !!has[c.key])}
                            </td>
                          ))}
                        </tr>,
                        ...ts.map((t) => {
                          const m = t.matches[0]
                          return (
                            <tr key={t.tournament.tournamentId} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-1.5">
                                {m ? (
                                  <a
                                    href={playerUrl(data.playerId, m)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-700 hover:underline dark:text-sky-400"
                                  >
                                    {t.tournament.tournamentName}
                                  </a>
                                ) : (
                                  t.tournament.tournamentName
                                )}
                              </td>
                              {COLS.map((c) => (
                                <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                                  {show(c, t.summary[c.key], isTracked(c.key, t.tracked))}
                                </td>
                              ))}
                            </tr>
                          )
                        }),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-8">
              <h3 className="mb-2 text-lg font-semibold">Kamper ({matches.length})</h3>
              <div className="overflow-x-auto rounded-xl bg-white shadow-sm dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">Dato</th>
                      <th className="px-3 py-2 font-medium">Kamp</th>
                      <th className="px-3 py-2 font-medium">Turnering</th>
                      {COLS.slice(1).map((c) => (
                        <th key={c.key} title={c.title} className="px-2 py-2 text-right font-medium">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={`${m.tournamentId}-${m.matchId}`} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                          {formatDate(m.matchDate)} <span className="text-slate-400">{formatTime(m.matchStartTime)}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <a href={matchUrl(m)} target="_blank" rel="noreferrer" className="hover:underline">
                            {m.homeTeamName?.trim()} – {m.awayTeamName?.trim()}
                          </a>
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{m.tournamentName}</td>
                        {COLS.slice(1).map((c) => {
                          const v = m[c.key as keyof Match] as number
                          const tracked = isTracked(c.key, m.tracked)
                          return (
                            <td
                              key={c.key}
                              className={`px-2 py-1.5 text-right tabular-nums ${tracked && v ? 'font-semibold' : 'text-slate-400'}`}
                            >
                              {show(c, v, tracked)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="mt-6 text-xs text-slate-400">
              Kilde: live.hockey.no (NIF). Uoffisielt API – tall kan avvike.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function LastEvent({ label, match }: { label: string; match?: Match }) {
  if (!match) {
    return (
      <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-1 font-medium">Ingen i valgt periode</div>
      </div>
    )
  }
  const days = daysSince(match.matchDate)
  return (
    <a
      href={matchUrl(match)}
      target="_blank"
      rel="noreferrer"
      className="block rounded-xl bg-white p-4 shadow-sm hover:ring-2 hover:ring-sky-500/40 dark:bg-slate-900"
    >
      <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {formatDate(match.matchDate)}{' '}
        <span className="text-base font-normal text-slate-500 dark:text-slate-400">
          ({days === 0 ? 'i dag' : days === 1 ? 'i går' : `${days} dager siden`})
        </span>
      </div>
      <div className="text-sm">
        {match.homeTeamName?.trim()} – {match.awayTeamName?.trim()}
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400">
        {match.tournamentName} · {match.goalsScored} mål, {match.assists} assist
      </div>
    </a>
  )
}

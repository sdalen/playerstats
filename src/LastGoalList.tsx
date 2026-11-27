// Lokalt verktøy: alle spillere i en turnering, sortert på lengst siden siste mål.
// Vises bare i dev (npm run dev) og tas ikke med i produksjonsbygget.
import { useMemo, useState, type FormEvent } from 'react'
import {
  daysSince,
  fetchPlayerMatches,
  fetchTournamentPlayers,
  formatDate,
  parseTournamentInput,
  type Match,
  type TournamentPlayer,
} from './hockey'

interface Row {
  player: TournamentPlayer
  lastGoal?: Match
  matchesSince: number
  /** Totaler på tvers av alle turneringer frem til i dag */
  totals: { gp: number; goals: number; assists: number; pts: number; pim: number }
  lastMatch?: Match
  active: boolean
  error?: boolean
}

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Inneværende sesong starter 1. mai. */
const seasonStart = () => {
  const d = new Date()
  return `${d.getMonth() >= 4 ? d.getFullYear() : d.getFullYear() - 1}-05-01`
}

type SortKey =
  | 'active'
  | 'name'
  | 'team'
  | 'gp'
  | 'goals'
  | 'assists'
  | 'pts'
  | 'pim'
  | 'lastGoal'
  | 'days'
  | 'since'
  | 'lastMatch'

const EMPTY_TOTALS = { gp: 0, goals: 0, assists: 0, pts: 0, pim: 0 }
const teamOf = (r: Row) => r.lastMatch?.teamName ?? r.player.teamName ?? ''

/** Kolonner med sorteringsverdi. «Aldri scoret» regnes som lengst siden (Infinity). */
const COLUMNS: {
  key: SortKey
  label: string
  title?: string
  align?: 'right' | 'center'
  descFirst: boolean
  value: (r: Row) => number | string | null
}[] = [
  { key: 'active', label: 'Aktiv', align: 'center', descFirst: true, value: (r) => (r.active ? 1 : 0) },
  { key: 'name', label: 'Spiller', descFirst: false, value: (r) => `${r.player.firstName} ${r.player.lastName}` },
  { key: 'team', label: 'Lag', title: 'Lag i siste kamp', descFirst: false, value: (r) => teamOf(r) },
  { key: 'gp', label: 'K', title: 'Kamper totalt frem til i dag', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.totals.gp) },
  { key: 'goals', label: 'M', title: 'Mål totalt', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.totals.goals) },
  { key: 'assists', label: 'A', title: 'Assist totalt', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.totals.assists) },
  { key: 'pts', label: 'P', title: 'Poeng totalt', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.totals.pts) },
  { key: 'pim', label: 'UM', title: 'Utvisningsminutter totalt', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.totals.pim) },
  { key: 'lastGoal', label: 'Siste mål', title: 'Siste mål i alle turneringer', descFirst: false, value: (r) => (r.error ? null : r.lastGoal?.matchDate ?? '') },
  { key: 'days', label: 'Dager', title: 'Dager siden siste mål', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.lastGoal ? daysSince(r.lastGoal.matchDate) : Infinity) },
  { key: 'since', label: 'K siden', title: 'Kamper spilt etter siste mål (alle turneringer)', align: 'right', descFirst: true, value: (r) => (r.error ? null : r.matchesSince) },
  { key: 'lastMatch', label: 'Siste kamp', title: 'Siste kamp i alle turneringer', descFirst: true, value: (r) => r.lastMatch?.matchDate ?? null },
]

export default function LastGoalList({ onSelectPlayer }: { onSelectPlayer: (playerId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)

  async function run(e: FormEvent) {
    e.preventDefault()
    const tid = parseTournamentInput(input)
    if (!tid) {
      setError('Fant ingen tournamentId. Lim inn et tall eller en live.hockey.no-lenke.')
      return
    }
    setError(null)
    setRows([])
    try {
      const players = await fetchTournamentPlayers(tid)
      const today = todayIso()
      const start = seasonStart()
      const result: Row[] = []
      setProgress({ done: 0, total: players.length })
      let i = 0
      const worker = async () => {
        while (i < players.length) {
          const player = players[i++]
          try {
            const ms = (await fetchPlayerMatches(player.personId)).filter((m) => m.matchDate.slice(0, 10) <= today)
            const gi = ms.findIndex((m) => m.goalsScored > 0)
            result.push({
              player,
              lastGoal: gi >= 0 ? ms[gi] : undefined,
              matchesSince: gi >= 0 ? gi : ms.length,
              totals: ms.reduce(
                (t, m) => ({
                  gp: t.gp + 1,
                  goals: t.goals + (m.goalsScored ?? 0),
                  assists: t.assists + (m.assists ?? 0),
                  pts: t.pts + (m.pts ?? 0),
                  pim: t.pim + (m.pim ?? 0),
                }),
                EMPTY_TOTALS,
              ),
              lastMatch: ms[0],
              active: !!ms[0] && ms[0].matchDate.slice(0, 10) >= start,
            })
          } catch {
            result.push({ player, matchesSince: 0, totals: EMPTY_TOTALS, active: false, error: true })
          }
          setProgress({ done: result.length, total: players.length })
        }
      }
      await Promise.all(Array.from({ length: 6 }, worker))
      setRows(result)
    } catch (err) {
      setError(`Kunne ikke hente spillere: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
    }
  }

  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'days', desc: true })

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key)!
    const list = rows.filter((r) => !onlyActive || r.active)
    return list.sort((a, b) => {
      const va = col.value(a)
      const vb = col.value(b)
      // Manglende verdier alltid nederst
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string, 'nb') : va - (vb as number)
      // Likt: flest kamper siden siste mål først
      return (sort.desc ? -cmp : cmp) || b.matchesSince - a.matchesSince
    })
  }, [rows, onlyActive, sort])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: COLUMNS.find((c) => c.key === key)!.descFirst }))

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 rounded-lg border border-dashed border-slate-400 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        Lengst siden mål i turnering (lokal)
      </button>
    )
  }

  return (
    <section className="relative left-1/2 mt-4 w-[calc(100vw-2rem)] max-w-[1400px] -translate-x-1/2 rounded-xl border border-dashed border-slate-400 p-4 dark:border-slate-600">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Lengst siden siste mål – alle spillere i en turnering</h2>
        <button onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:underline">
          Lukk
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Lim inn en statistikklenke fra live.hockey.no, f.eks.
        https://live.hockey.no/statistics/players?seasonId=201059&amp;tournamentId=441144, eller bare tournamentId. Siste
        mål og siste kamp regnes på tvers av alle spillerens turneringer frem til i dag (data fra august 2023). Aktiv =
        spilt kamp siden {formatDate(seasonStart())}. Turneringen brukes bare til å finne årgangen; K, M, A, P og UM er totaler for alle turneringer frem til i dag. Klikk på en
        kolonneoverskrift for å sortere. Hold musen over en dato for å se turneringen.
      </p>
      <form onSubmit={run} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="441144 eller https://live.hockey.no/statistics/players?…&tournamentId=…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!!progress || !input.trim()}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {progress ? `Henter ${progress.done}/${progress.total}…` : 'Hent'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rows.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              {rows.length} spillere · {rows.filter((r) => r.active).length} aktive ·{' '}
              {rows.filter((r) => !r.lastGoal && !r.error).length} uten mål
              {rows.some((r) => r.error) && ` · ${rows.filter((r) => r.error).length} feilet`}
            </span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              Kun aktive
            </label>
          </div>
          <div className="mt-2 overflow-x-auto rounded-xl bg-white shadow-sm dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-2 py-2 text-right font-medium">#</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      title={c.title}
                      className={`whitespace-nowrap px-2 py-2 font-medium ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}
                    >
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={`hover:text-slate-900 dark:hover:text-white ${sort.key === c.key ? 'text-slate-900 dark:text-white' : ''}`}
                      >
                        {c.label}
                        {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, k) => (
                  <tr key={r.player.personId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{k + 1}</td>
                    <td className="px-2 py-1.5 text-center text-emerald-600">{r.active ? '✓' : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <button
                        onClick={() => onSelectPlayer(String(r.player.personId))}
                        className="text-left text-sky-700 hover:underline dark:text-sky-400"
                      >
                        {r.player.firstName} {r.player.lastName}
                      </button>
                    </td>
                    <td className="max-w-48 px-2 py-1.5 text-slate-500 dark:text-slate-400">{teamOf(r)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? "" : r.totals.gp}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? "" : r.totals.goals}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? "" : r.totals.assists}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? "" : r.totals.pts}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? "" : r.totals.pim}</td>
                    <td className="whitespace-nowrap px-2 py-1.5" title={r.lastGoal?.tournamentName}>
                      {r.error ? <span className="text-red-500">feil</span> : r.lastGoal ? formatDate(r.lastGoal.matchDate) : 'aldri'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.lastGoal ? daysSince(r.lastGoal.matchDate) : '–'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? '' : r.matchesSince}</td>
                    <td className="whitespace-nowrap px-2 py-1.5" title={r.lastMatch?.tournamentName}>
                      {r.lastMatch && formatDate(r.lastMatch.matchDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

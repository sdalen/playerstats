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
              lastMatch: ms[0],
              active: !!ms[0] && ms[0].matchDate.slice(0, 10) >= start,
            })
          } catch {
            result.push({ player, matchesSince: 0, active: false, error: true })
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

  const sorted = useMemo(() => {
    const list = rows.filter((r) => !onlyActive || r.active)
    // Uten mål øverst (flest kamper først), deretter eldste siste mål
    return list.sort((a, b) => {
      if (!a.lastGoal && !b.lastGoal) return b.matchesSince - a.matchesSince
      if (!a.lastGoal) return -1
      if (!b.lastGoal) return 1
      return a.lastGoal.matchDate.localeCompare(b.lastGoal.matchDate)
    })
  }, [rows, onlyActive])

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
    <section className="mt-4 rounded-xl border border-dashed border-slate-400 p-4 dark:border-slate-600">
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
        spilt kamp siden {formatDate(seasonStart())}.
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
                  <th className="px-2 py-2 text-center font-medium">Aktiv</th>
                  <th className="px-2 py-2 font-medium">Spiller</th>
                  <th className="px-2 py-2 font-medium">Lag</th>
                  <th className="px-2 py-2 font-medium">Siste mål</th>
                  <th className="px-2 py-2 text-right font-medium">Dager</th>
                  <th className="px-2 py-2 text-right font-medium" title="Kamper spilt etter siste mål">
                    Kamper siden
                  </th>
                  <th className="px-2 py-2 font-medium">Siste kamp</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, k) => (
                  <tr key={r.player.personId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{k + 1}</td>
                    <td className="px-2 py-1.5 text-center text-emerald-600">{r.active ? '✓' : ''}</td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => onSelectPlayer(String(r.player.personId))}
                        className="text-left text-sky-700 hover:underline dark:text-sky-400"
                      >
                        {r.player.firstName} {r.player.lastName}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400">{r.player.teamName}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {r.error ? (
                        <span className="text-red-500">feil</span>
                      ) : r.lastGoal ? (
                        <>
                          {formatDate(r.lastGoal.matchDate)}{' '}
                          <span className="text-slate-400">{r.lastGoal.tournamentName}</span>
                        </>
                      ) : (
                        'aldri'
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.lastGoal ? daysSince(r.lastGoal.matchDate) : '–'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.error ? '' : r.matchesSince}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {r.lastMatch && (
                        <>
                          {formatDate(r.lastMatch.matchDate)}{' '}
                          <span className="text-slate-400">{r.lastMatch.tournamentName}</span>
                        </>
                      )}
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

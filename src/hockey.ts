// Klient for det uoffisielle NIF/live.hockey.no-API-et (via /api-proxy i Vite).

export interface Tournament {
  tournamentId: number
  tournamentName: string
  startDate: string
  endDate?: string
}

export interface Summary {
  gamesPlayed: number
  goalsScored: number
  assists: number
  pts: number // poeng (mål + assist)
  points: number // PLUSS/MINUS
  pim: number // utvisningsminutter
  shots: number
  totalSecondsPlayed: number // istid i sekunder (kun med Wisehockey-sporing)
}

export interface Match {
  matchId: number
  matchDate: string
  matchStartTime?: number
  homeTeamName?: string
  awayTeamName?: string
  tournamentId: number
  tournamentName?: string
  seasonId?: number
  orgId?: number
  teamName?: string
  firstName?: string
  lastName?: string
  position?: string
  goalsScored: number
  assists: number
  pts: number
  points: number
  pim: number
  shots: number
  totalSecondsPlayed: number
  tracked: Tracked
}

/** Hvilke tall som faktisk registreres i turneringen. */
export interface Tracked {
  plusMinus: boolean // kun med Wisehockey-sporing (typisk EHL, U20/U18 Elite)
  shots: boolean // fra U16 og eldre
  iceTime: boolean // kun med Wisehockey-sporing
}

export interface TournamentStats {
  tournament: Tournament
  season: number // startår, f.eks. 2026 → «2026/27»
  summary: Summary
  matches: Match[]
  tracked: Tracked
}

/** U-alder fra turneringsnavn («U14 avd A» → 14). Ingen U-alder (EHL, senior) → null. */
export const ageClass = (name: string) => {
  const m = name.match(/\bU\s?(\d{1,2})\b/i)
  return m ? Number(m[1]) : null
}

/** Om et felt er registrert i turneringen; ellers vises «–». */
export function isTracked(key: keyof Summary, tracked: Tracked) {
  if (key === 'points') return tracked.plusMinus
  if (key === 'shots') return tracked.shots
  if (key === 'totalSecondsPlayed') return tracked.iceTime
  return true
}

export interface PlayerInfo {
  firstName?: string
  lastName?: string
  number?: string
  birthDate?: string
  position?: string
}

export interface PlayerData {
  playerId: string
  info: PlayerInfo
  orgId?: number
  tournaments: TournamentStats[]
}

// I dev går kall via Vite-proxyen (/api). I produksjon settes VITE_API_BASE til Cloudflare Worker-URL-en.
const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

const cache = new Map<string, Promise<unknown>>()

function get<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined
  if (!p) {
    p = fetch(`${API_BASE}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} (${path})`)
      return r.json() as Promise<T>
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const emptySummary = (): Summary => ({
  gamesPlayed: 0,
  goalsScored: 0,
  assists: 0,
  pts: 0,
  points: 0,
  pim: 0,
  shots: 0,
  totalSecondsPlayed: 0,
})

function toSummary(raw: Partial<Summary> | undefined): Summary {
  return {
    gamesPlayed: n(raw?.gamesPlayed),
    goalsScored: n(raw?.goalsScored),
    assists: n(raw?.assists),
    pts: n(raw?.pts),
    points: n(raw?.points),
    pim: n(raw?.pim),
    shots: n(raw?.shots),
    totalSecondsPlayed: n(raw?.totalSecondsPlayed),
  }
}

export function addSummary(a: Summary, b: Summary): Summary {
  return {
    gamesPlayed: a.gamesPlayed + b.gamesPlayed,
    goalsScored: a.goalsScored + b.goalsScored,
    assists: a.assists + b.assists,
    pts: a.pts + b.pts,
    points: a.points + b.points,
    pim: a.pim + b.pim,
    shots: a.shots + b.shots,
    totalSecondsPlayed: a.totalSecondsPlayed + b.totalSecondsPlayed,
  }
}

/** Godtar ren playerId eller en live.hockey.no-lenke. */
export function parsePlayerInput(input: string): { playerId?: string; orgId?: string } {
  const s = input.trim()
  if (/^\d+$/.test(s)) return { playerId: s }
  try {
    const url = new URL(s)
    const playerId = url.searchParams.get('playerId') ?? undefined
    const orgId = url.searchParams.get('orgId') ?? undefined
    return { playerId: playerId && /^\d+$/.test(playerId) ? playerId : undefined, orgId }
  } catch {
    const m = s.match(/playerId=(\d+)/)
    return { playerId: m?.[1] }
  }
}

export const seasonOf = (startDate: string) => Number(startDate.slice(0, 4))
export const seasonLabel = (season: number) => `${season}/${String((season + 1) % 100).padStart(2, '0')}`

export async function fetchPlayer(playerId: string, orgIdHint?: string): Promise<PlayerData> {
  const all = await get<Tournament[]>(`ta/Tournament/AllForPerson?personId=${playerId}`)

  const results = await Promise.all(
    (all ?? []).map(async (t) => {
      try {
        const res = await get<{
          tournamentSummary?: Partial<Summary>
          matches?: Match[]
          totalMatchesWithWisehockeyData?: number
        }>(`wise/tournaments/${t.tournamentId}/players/${playerId}/matches/statistics`)
        const summary = toSummary(res?.tournamentSummary)
        if (summary.gamesPlayed === 0) return null
        const age = ageClass(t.tournamentName)
        const tracked: Tracked = {
          plusMinus: n(res?.totalMatchesWithWisehockeyData) > 0,
          shots: age === null || age >= 16,
          iceTime: n(res?.totalMatchesWithWisehockeyData) > 0,
        }
        const matches = (res?.matches ?? []).map((m) => ({
          ...m,
          tracked,
          goalsScored: n(m.goalsScored),
          assists: n(m.assists),
          pts: n(m.pts),
          points: n(m.points),
          pim: n(m.pim),
          shots: n(m.shots),
          totalSecondsPlayed: n(m.totalSecondsPlayed),
        }))
        return { tournament: t, season: seasonOf(t.startDate), summary, matches, tracked } satisfies TournamentStats
      } catch {
        return null
      }
    }),
  )
  const tournaments = results
    .filter((r): r is TournamentStats => r !== null)
    .sort((a, b) => b.season - a.season || a.tournament.tournamentName.localeCompare(b.tournament.tournamentName, 'nb'))

  const latest = latestMatches(tournaments)[0]
  const orgId = orgIdHint ? Number(orgIdHint) : latest?.orgId
  let info: PlayerInfo = { firstName: latest?.firstName, lastName: latest?.lastName, position: latest?.position }

  if (orgId) {
    try {
      const members = await get<(PlayerInfo & { personId?: number })[]>(`ta/TeamMembers/${orgId}?personId=${playerId}`)
      const m = members?.[0]
      if (m) info = { ...info, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v != null && v !== '')) }
    } catch {
      // valgfritt – navnet har vi allerede fra kampene
    }
  }

  return { playerId, info, orgId, tournaments }
}

const matchKey = (m: Match) => `${m.matchDate}|${String(m.matchStartTime ?? 0).padStart(4, '0')}`

export function latestMatches(ts: TournamentStats[]): Match[] {
  return ts.flatMap((t) => t.matches).sort((a, b) => matchKey(b).localeCompare(matchKey(a)))
}

export function daysSince(isoDate: string, today = new Date()): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  const then = Date.UTC(y, m - 1, d)
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((now - then) / 86_400_000)
}

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export const formatTime = (t?: number) =>
  t == null || t === 0 ? '' : `${String(Math.floor(t / 100)).padStart(2, '0')}:${String(t % 100).padStart(2, '0')}`

export const plusMinus = (v: number) => (v > 0 ? `+${v}` : String(v))

export const playerUrl = (playerId: string, m: { seasonId?: number; tournamentId: number; orgId?: number }) =>
  `https://live.hockey.no/player/?seasonId=${m.seasonId ?? ''}&tournamentId=${m.tournamentId}&playerId=${playerId}&orgId=${m.orgId ?? ''}`

export const matchUrl = (m: Match) =>
  `https://live.hockey.no/match?seasonId=${m.seasonId ?? ''}&tournamentId=${m.tournamentId}&matchId=${m.matchId}&matchDate=${encodeURIComponent(m.matchDate)}`

/** Sekunder → «m:ss». */
export const formatIceTime = (seconds: number) => {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// --- Lokale verktøy (kun brukt i dev) ---

export interface TournamentPlayer {
  personId: number
  firstName: string
  lastName: string
  teamName?: string
  gamesPlayed?: number
  goalsScored?: number
  assists?: number
  pts?: number // poeng
  pim?: number
}

/** Alle spillere i en turnering (statistikklisten på live.hockey.no). */
export const fetchTournamentPlayers = (tournamentId: string) =>
  get<TournamentPlayer[]>(`wise/tournaments/${tournamentId}/players/statistics`)

/** Alle kamper for en spiller på tvers av turneringer, nyeste først. */
export async function fetchPlayerMatches(playerId: number): Promise<Match[]> {
  const ms = await get<Match[]>(`icehockey/Player/${playerId}?numberMatches=1000`)
  return [...(ms ?? [])].sort((a, b) => b.matchDate.localeCompare(a.matchDate))
}

/** Godtar tournamentId eller en live.hockey.no-lenke med tournamentId=. */
export function parseTournamentInput(input: string): string | undefined {
  const s = input.trim()
  if (/^\d+$/.test(s)) return s
  return s.match(/tournamentId=(\d+)/)?.[1]
}

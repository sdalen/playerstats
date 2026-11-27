// Cloudflare Worker: CORS-proxy for live.hockey.no-API-et (NIF).
// API-et tillater kun CORS fra https://live.hockey.no, så nettleseren kaller denne workeren i stedet.
const UPSTREAM = 'https://sf34-terminlister-prod-app.azurewebsites.net/'
const ALLOWED_PATHS = /^\/(ta\/Tournament\/AllForPerson|ta\/TeamMembers\/\d+|wise\/tournaments\/\d+\/players\/\d+\/matches\/statistics)$/
const SHORT_CACHE = 300 // 5 min: inneværende sesong og lister som kan endre seg
const DAY_CACHE = 86_400 // 1 døgn: tomme svar
const OLD_SEASON_CACHE = 31_536_000 // 1 år: tidligere sesonger endrer seg ikke

/** Sesongen starter 1. mai. */
function currentSeasonStart(now = new Date()) {
  const y = now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return `${y}-05-01`
}

/** Hvor lenge et vellykket svar kan caches. Kampstatistikk fra tidligere sesonger caches i ett år. */
function cacheSeconds(pathname, body) {
  if (!/\/matches\/statistics$/.test(pathname)) return SHORT_CACHE
  try {
    const dates = (JSON.parse(body).matches ?? []).map((m) => String(m.matchDate ?? '').slice(0, 10)).filter(Boolean)
    if (dates.length === 0) return DAY_CACHE
    const latest = dates.sort().at(-1)
    return latest < currentSeasonStart() ? OLD_SEASON_CACHE : SHORT_CACHE
  } catch {
    return SHORT_CACHE
  }
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim())
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] ?? '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors })

    const url = new URL(request.url)
    if (!ALLOWED_PATHS.test(url.pathname)) return new Response('Not found', { status: 404, headers: cors })

    // «_» er en cache-buster fra klienten etter et feilsvar: hent på nytt fra API-et,
    // men lagre under den vanlige adressen slik at senere kall får riktige data.
    const forceRefresh = url.searchParams.has('_')
    const keyUrl = new URL(url)
    keyUrl.searchParams.delete('_')
    const cache = caches.default
    const cacheKey = new Request(keyUrl.toString(), { method: 'GET' })
    let res = forceRefresh ? undefined : await cache.match(cacheKey)
    if (!res) {
      const upstream = await fetch(UPSTREAM + url.pathname.slice(1) + url.search, {
        headers: { Accept: 'application/json' },
      })
      const body = await upstream.text()
      res = new Response(body, upstream)
      res.headers.delete('Access-Control-Allow-Origin')
      // API-et svarer 200 med tomme data + advarsel når NIF får timeout – slike svar skal ikke caches
      const upstreamError = /Unexpected error|timeout/i.test(body)
      if (upstream.ok && !upstreamError) {
        res.headers.set('Cache-Control', `public, max-age=${cacheSeconds(url.pathname, body)}`)
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
      } else {
        res.headers.set('Cache-Control', 'no-store')
      }
    }
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    return out
  },
}

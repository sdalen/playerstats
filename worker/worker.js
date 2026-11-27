// Cloudflare Worker: CORS-proxy for live.hockey.no-API-et (NIF).
// API-et tillater kun CORS fra https://live.hockey.no, så nettleseren kaller denne workeren i stedet.
const UPSTREAM = 'https://sf34-terminlister-prod-app.azurewebsites.net/'
const ALLOWED_PATHS = /^\/(ta\/Tournament\/AllForPerson|ta\/TeamMembers\/\d+|wise\/tournaments\/\d+\/players\/statistics|wise\/tournaments\/\d+\/players\/\d+\/matches\/statistics|icehockey\/Player\/\d+)$/
const CACHE_SECONDS = 300

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

    const cache = caches.default
    const cacheKey = new Request(url.toString(), { method: 'GET' })
    let res = await cache.match(cacheKey)
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
        res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
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

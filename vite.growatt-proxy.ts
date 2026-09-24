import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const GROWATT_HOST = 'openapi.growatt.com'
let cachedIp: string | null = null

function isDnsFail(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN'
}

async function resolveGrowattIp(): Promise<string | null> {
  if (cachedIp) return cachedIp
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${GROWATT_HOST}&type=A`, {
      headers: { Accept: 'application/dns-json' },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { Answer?: { type: number; data: string }[] }
    const ip = json.Answer?.find((row) => row.type === 1)?.data
    if (ip) cachedIp = ip
    return ip ?? null
  } catch {
    return null
  }
}

function collectBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
    req.on('error', reject)
  })
}

function growattRequest(
  pathWithQuery: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  hostname: string,
): Promise<{ status: number; contentType: string; location: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        servername: GROWATT_HOST,
        port: 443,
        path: pathWithQuery,
        method,
        headers: { ...headers, host: GROWATT_HOST },
      },
      (up) => {
        const chunks: Buffer[] = []
        up.on('data', (chunk: Buffer) => chunks.push(chunk))
        up.on('end', () =>
          resolve({
            status: up.statusCode ?? 502,
            contentType: String(up.headers['content-type'] ?? 'application/json'),
            location: String(up.headers.location ?? ''),
            body: Buffer.concat(chunks),
          }),
        )
        up.on('error', reject)
      },
    )
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('Growatt Timeout')))
    if (body) req.write(body)
    req.end()
  })
}

function jsonError(res: ServerResponse, status: number, msg: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error_code: -1, error_msg: msg }))
}

/** Dev-only proxy: /growatt → openapi.growatt.com, with DNS-over-HTTPS fallback. */
export function growattProxy(): Plugin {
  return {
    name: 'growatt-proxy',
    configureServer(server) {
      server.middlewares.use('/growatt', (req, res) => {
        void (async () => {
          try {
            const raw = req.url ?? '/'
            const pathWithQuery = raw.startsWith('/growatt') ? raw.slice('/growatt'.length) || '/' : raw
            const token = String(req.headers.token ?? req.headers['x-growatt-token'] ?? '')
            const headers: Record<string, string> = {
              accept: 'application/json',
              'user-agent': String(req.headers['user-agent'] ?? 'Mozilla/5.0'),
            }
            if (token) headers.token = token
            const type = req.headers['content-type']
            if (typeof type === 'string') headers['content-type'] = type
            const body = await collectBody(req)
            if (body) headers['content-length'] = String(body.length)

            let result: { status: number; contentType: string; location: string; body: Buffer }
            try {
              result = await growattRequest(pathWithQuery, req.method ?? 'GET', headers, body, GROWATT_HOST)
            } catch (err) {
              if (!isDnsFail(err)) throw err
              const ip = await resolveGrowattIp()
              if (!ip) throw err
              result = await growattRequest(pathWithQuery, req.method ?? 'GET', headers, body, ip)
            }

            if (result.status >= 300 && result.status < 400) {
              jsonError(
                res,
                502,
                `HTTP ${result.status} Umleitung nach ${result.location || '(ohne Location)'} — kein v4-JSON`,
              )
              return
            }

            res.statusCode = result.status
            res.setHeader('Content-Type', result.contentType)
            res.end(result.body)
          } catch (err) {
            const dns = isDnsFail(err)
            jsonError(res, 502, dns ? 'Growatt-Server nicht erreichbar (DNS)' : err instanceof Error ? err.message : 'Proxy-Fehler')
          }
        })()
      })
    },
  }
}

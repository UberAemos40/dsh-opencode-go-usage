/**
 * Host half of the OpenCode Go status bar.
 *
 * The browser cannot call `opencode.ai` directly (CORS) and must never hold the
 * account key, so this half owns both: it reads the key the Harness already
 * stores for the `opencode-go` provider and polls
 * `https://opencode.ai/inference/go/v1/usage`, caching the answer for the
 * client half's small polling loop.
 *
 * The key is resolved the same way the provider resolves it — the credential
 * store first (`OPENCODE_GO_API_KEY`), then the launching environment — so a
 * rotated key takes effect on the next refresh with no restart and no
 * configuration edit.
 */

/** Credential-store reference / environment variable the provider uses. */
const KEY_REF = 'OPENCODE_GO_API_KEY'
/** Documented usage endpoint of the Go API (<docs/console/api/inference>). */
const DEFAULT_USAGE_URL = 'https://opencode.ai/inference/go/v1/usage'
/** Route prefix this plugin owns; the client resolves it against the page. */
const ROUTE_PREFIX = '/opencode-go-usage/api'
const STATE_PATH = '/state'
const REFRESH_PATH = '/refresh'

/** Services required before mounting. `credentials` and `connection` are read
 *  optionally so the plugin still loads in a profile that ships neither. */
export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const usageUrl = text(config.usageUrl) ?? DEFAULT_USAGE_URL
  const refreshSeconds = integer(config.refreshSeconds, 60, 15, 3600)
  const timeoutMs = integer(config.timeoutSeconds, 15, 2, 60) * 1000
  const ttlMs = refreshSeconds * 1000
  /** A failed poll must not pin the bar for a whole refresh window. */
  const failedTtlMs = Math.min(ttlMs, 10000)

  /** Last settled answer, kept across requests so a poll is usually free. */
  let snapshot
  /** Single in-flight refresh shared by every concurrent caller. */
  let inflight

  const credentials = () => ctx.get('credentials')

  /** Resolve the account key: the store outranks the ambient environment. */
  const resolveKey = async () => {
    const store = credentials()
    if (store !== undefined && store !== null && typeof store.resolve === 'function') {
      try {
        const hit = await store.resolve(KEY_REF)
        if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value !== '') {
          return { key: hit.value, source: 'store' }
        }
      } catch {
        // A store that cannot be read must not shadow the environment.
      }
    }
    const ambient = process.env[KEY_REF]
    if (typeof ambient === 'string' && ambient !== '') return { key: ambient, source: 'env' }
    return undefined
  }

  /** One upstream read, normalized to the `usage` object or a coded failure.
   *  A timeout or transport failure is retried once: the first request after a
   *  cold connection is the one that stalls. */
  const requestUsage = async (key) => {
    const attempt = async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(usageUrl, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${key}`,
            accept: 'application/json',
            'user-agent': 'dsh-opencode-go-usage/1.0',
          },
          signal: controller.signal,
        })
        const raw = await response.text()
        let parsed
        try {
          parsed = raw === '' ? undefined : JSON.parse(raw)
        } catch {
          parsed = undefined
        }
        if (!response.ok) {
          const message =
            text(parsed?.error?.message) ??
            text(parsed?.message) ??
            text(parsed?.error) ??
            `HTTP ${response.status}`
          throw coded(
            response.status === 401 || response.status === 403 ? 'unauthorized' : `http-${response.status}`,
            message,
          )
        }
        const usage = parsed?.usage
        if (usage === undefined || usage === null || typeof usage !== 'object') {
          throw coded('bad-payload', 'The usage endpoint returned no usage object')
        }
        return { usage, extra: extraFields(parsed.usage) }
      } catch (error) {
        if (error?.name === 'AbortError') throw coded('timeout', `No answer within ${timeoutMs / 1000}s`)
        if (typeof error?.code === 'string') throw error
        throw coded('network', error instanceof Error ? error.message : String(error))
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      return await attempt()
    } catch (error) {
      if (error?.code === 'timeout' || error?.code === 'network') return attempt()
      throw error
    }
  }

  /** The client's whole state: configuration posture plus the cached usage. */
  const state = () => ({
    ...(snapshot ?? {}),
    ok: snapshot !== undefined && snapshot.error === undefined,
    refreshSeconds,
  })

  /** How long the settled answer stays fresh. A failure is retried sooner
   *  than a success is re-read, so one stalled poll cannot pin the bar. */
  const ttlOf = (current) => (current !== undefined && current.error !== undefined ? failedTtlMs : ttlMs)

  const refresh = (force) => {
    if (!force && snapshot !== undefined && Date.now() - snapshot.fetchedAt < ttlOf(snapshot)) {
      return Promise.resolve(state())
    }
    if (inflight !== undefined) return inflight
    inflight = (async () => {
      const attemptedAt = Date.now()
      /** Keep the last good reading: a status bar shows stale numbers rather
       *  than no numbers, and says how old they are. */
      const previous = snapshot?.usage === undefined ? undefined : snapshot
      const fail = (error) => {
        const message = error instanceof Error ? error.message : String(error?.message ?? error)
        const code = typeof error?.code === 'string' ? error.code : 'unexpected'
        snapshot =
          previous === undefined
            ? { fetchedAt: attemptedAt, attemptedAt, configured: code !== 'no-key', error: { code, message } }
            : { ...previous, attemptedAt, stale: true, error: { code, message } }
        return state()
      }
      try {
        const resolution = await resolveKey()
        if (resolution === undefined) {
          return fail(
            coded('no-key', `No ${KEY_REF} in the credential store or the environment`),
          )
        }
        const { usage, extra } = await requestUsage(resolution.key)
        snapshot = {
          fetchedAt: attemptedAt,
          attemptedAt,
          configured: true,
          source: resolution.source,
          usage,
          extra,
        }
        return state()
      } catch (error) {
        return fail(error)
      }
    })().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  /** Admission: a browser always stamps `Origin` on a cross-site read, so a
   *  foreign origin is refused while the page's own same-origin requests (and
   *  header-less local reads) pass. The payload is allowance percentages, not
   *  account data, so this is the proportionate check. */
  const foreignOrigin = (req) => {
    const origin = req.headers?.origin
    if (typeof origin !== 'string' || origin === '') return false
    try {
      return new URL(origin).host !== String(req.headers?.host ?? '')
    } catch {
      return true
    }
  }

  const send = (res, status, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const denial = foreignOrigin(req)
        if (denial) {
          send(res, 403, { ok: false, error: { code: 'forbidden', message: 'Request rejected' } })
          return
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const sub = pathname.startsWith(ROUTE_PREFIX) ? pathname.slice(ROUTE_PREFIX.length) || STATE_PATH : STATE_PATH
        const method = req.method ?? 'GET'
        try {
          if (method === 'GET' || method === 'HEAD') {
            if (sub !== STATE_PATH && sub !== '/') {
              send(res, 404, { ok: false, error: { code: 'not-found', message: 'Unknown method' } })
              return
            }
            send(res, 200, await refresh(false))
            return
          }
          if (method === 'POST') {
            if (sub === REFRESH_PATH) {
              send(res, 200, await refresh(true))
              return
            }
            send(res, 404, { ok: false, error: { code: 'not-found', message: 'Unknown method' } })
            return
          }
          send(res, 405, { ok: false, error: { code: 'method-error', message: 'Method not allowed' } })
        } catch (error) {
          send(res, 500, {
            ok: false,
            error: {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
            },
          })
        }
      },
    }),
  )
}

/** A plain failure carrying a machine-readable code. */
function coded(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Any field the endpoint reports beyond the three documented windows, so a
 *  richer answer than the schema describes still reaches the bar. */
function extraFields(usage) {
  const known = new Set(['rolling', 'weekly', 'monthly'])
  const extra = {}
  for (const [name, value] of Object.entries(usage)) {
    if (!known.has(name)) extra[name] = value
  }
  return Object.keys(extra).length > 0 ? extra : undefined
}

function text(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function integer(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

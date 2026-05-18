const STORAGE_KEY = 'prrAdminKey'

const prrApiDebug = import.meta.env.DEV || import.meta.env.VITE_DEBUG_API === 'true'

function prrLog(...args: unknown[]) {
  if (prrApiDebug) console.log('[PRR API]', ...args)
}

export function getAdminKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setAdminKey(key: string): void {
  if (key) localStorage.setItem(STORAGE_KEY, key)
  else localStorage.removeItem(STORAGE_KEY)
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const key = getAdminKey()
  const method = (init?.method ?? 'GET').toUpperCase()
  const started = performance.now()
  prrLog('→', method, path, {
    hasAdminKeyHeader: Boolean(key),
    hasBody: Boolean(init?.body),
  })
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { 'X-Admin-Key': key } : {}),
  }
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string>) },
    })
  } catch (err) {
    prrLog('✖ fetch failed', method, path, err)
    throw err
  }
  const ms = Math.round(performance.now() - started)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      try {
        msg = await res.text()
      } catch {
        /* ignore */
      }
    }
    prrLog('← error', method, path, res.status, `${ms}ms`, msg)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  prrLog('← ok', method, path, res.status, `${ms}ms`)
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type')
  if (ct?.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as T
}

import { createRequire } from 'node:module'
import { appendFileSync } from 'node:fs'

/** The one cookie fact this plugin needs from the owning Electron runtime. */
export interface RuntimeCookie {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | string
  expirationDate?: number
}
export interface RuntimeCookieJar {
  get(filter: Record<string, unknown>): Promise<RuntimeCookie[]>
  set(details: Record<string, unknown>): Promise<void>
  remove(url: string, name: string): Promise<void>
}
export interface RuntimeSession { cookies: RuntimeCookieJar }

const runtimeRequire = createRequire(import.meta.url)
/**
 * The DSH app's own main module resolves the built-in electron module; a
 * plugin's own createRequire cannot, because the plugin lives outside the app
 * tree. Prefer the app's require, then the plugin's own, then give up.
 */
function loadElectron(): { session?: { fromPartition(partition: string): RuntimeSession } } | null {
  const mainRequire = (process as unknown as { mainModule?: { require?: (id: string) => unknown } }).mainModule?.require
  if (typeof mainRequire === 'function') {
    try {
      const electron = mainRequire('electron') as { session?: { fromPartition(partition: string): RuntimeSession } }
      if (typeof electron?.session?.fromPartition === 'function') return electron
    } catch (error) { try { appendFileSync('/tmp/dsh-site-diag.log', new Date().toISOString() + ' mainRequire threw: ' + String(error).slice(0, 160) + '\n') } catch { /* diagnostic only */ } }
  } else {
  }
  try {
    const electron = runtimeRequire('electron') as { session?: { fromPartition(partition: string): RuntimeSession } }
    if (typeof electron?.session?.fromPartition === 'function') return electron
  } catch { /* no Electron runtime: features degrade */ }
  return null
}
let cached: ((partition: string) => RuntimeSession) | null | undefined
export function guestSession(partition: string): RuntimeSession | null {
  if (cached === undefined) {
    const electron = loadElectron()
    cached = electron === null ? null : (name: string) => electron.session!.fromPartition(name)
  }
  if (cached === null) return null
  try { return cached(partition) } catch { return null }
}

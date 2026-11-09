import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { PROFILE_CONTEXT_UNAVAILABLE, WEBSITE_PROFILE_PREFIX, type AuthorizationAuthority } from './authorization.js'
import { siteCookieSchema } from './protocol.js'
import type { SiteCookie, SiteSession } from './protocol.js'

export interface SiteSessionFence {
  accountId: string
  epoch: string
}

const grantSchema = z.strictObject({
  version: z.literal(1),
  origin: z.literal('dsh-deepseek-chat:site-session'),
  profileId: z.string().regex(/^chat-profile:[a-f0-9]{64}$/),
  site: z.string().min(1).max(64),
  cookies: z.array(siteCookieSchema).max(128),
})
type SiteCredentials = Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>
type SiteAuthority = Pick<AuthorizationAuthority, 'getSnapshot'>

/**
 * Remembers one registered site's login cookies in the profile-scoped vault.
 * The DSH guest session is non-persistent, so this is the only way a site
 * login survives an app restart. Mirrors WebsiteSessionStore's fencing and
 * serialization, keyed per site so each site's grant is independent.
 */
export class SiteSessionStore {
  private readonly profileId: string | null
  private readonly pending = new Map<string, Promise<void>>()

  constructor(
    private readonly credentials: SiteCredentials,
    private readonly authority: SiteAuthority,
    profileId: string | null,
  ) {
    this.profileId = profileId !== null && /^chat-profile:[a-f0-9]{64}$/.test(profileId) ? profileId : null
  }

  private key(site: string): ReturnType<typeof credentialKey> | null {
    if (this.profileId === null || !/^[a-z0-9-]{1,32}$/.test(site)) return null
    return credentialKey('dsh-deepseek-chat', 'site-' + site + '-' + this.profileId.slice(WEBSITE_PROFILE_PREFIX.length))
  }

  private current(fence: SiteSessionFence, signal: AbortSignal): boolean {
    const state = this.authority.getSnapshot()
    return !signal.aborted && state.status === 'authorized'
      && state.error === (this.profileId === null ? PROFILE_CONTEXT_UNAVAILABLE : null)
      && (this.profileId === null || fence.accountId === this.profileId)
      && state.accountId === fence.accountId && state.epoch === fence.epoch
  }

  private async exclusive<T>(site: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(site) ?? Promise.resolve()
    let release!: () => void
    this.pending.set(site, new Promise<void>(resolve => { release = resolve }))
    await previous
    try { return await operation() }
    finally { release() }
  }

  private sessionFromRecord(payload: unknown, site: string): SiteSession | null {
    const grant = grantSchema.safeParse(payload)
    if (!grant.success || grant.data.site !== site || grant.data.profileId !== this.profileId) return null
    return { site: grant.data.site, cookies: grant.data.cookies }
  }

  async load(fence: SiteSessionFence, signal: AbortSignal, site: string): Promise<SiteSession | null> {
    const key = this.key(site)
    if (key === null) return null
    try {
      return await this.exclusive(site, async () => {
        if (!this.current(fence, signal)) return null
        const record = await this.credentials.readRecord(key)
        if (!this.current(fence, signal)) return null
        return record !== undefined && record.kind === 'grant' ? this.sessionFromRecord(record.payload, site) : null
      })
    } catch { throw new Error('无法读取网站登录记忆。') }
  }

  async save(fence: SiteSessionFence, signal: AbortSignal, session: SiteSession): Promise<boolean> {
    const site = session.site
    const key = this.key(site)
    if (key === null || session.cookies.length === 0) return false
    try {
      return await this.exclusive(site, async () => {
        if (!this.current(fence, signal)) return false
        let accepted = false
        await this.credentials.modifyRecord(key, async () => {
          if (!this.current(fence, signal)) return undefined
          accepted = true
          return { kind: 'grant' as const, payload: {
            version: 1 as const, origin: 'dsh-deepseek-chat:site-session' as const,
            profileId: this.profileId, site, cookies: session.cookies,
          } }
        })
        return accepted && this.current(fence, signal)
      })
    } catch { throw new Error('无法保存网站登录记忆。') }
  }

  async clear(fence: SiteSessionFence, signal: AbortSignal, site: string): Promise<boolean> {
    const key = this.key(site)
    // Without a trusted profile there is no persistent grant to clear; the
    // caller still clears the guest's own cookies.
    if (key === null) return this.current(fence, signal)
    try {
      return await this.exclusive(site, async () => {
        if (!this.current(fence, signal)) return false
        let cleared = false
        await this.credentials.modifyRecord(key, async () => {
          if (!this.current(fence, signal)) return undefined
          cleared = true
          // A durable empty grant prevents an older grant being restored again.
          return { kind: 'grant' as const, payload: {
            version: 1 as const, origin: 'dsh-deepseek-chat:site-session' as const,
            profileId: this.profileId, site, cookies: [] as SiteCookie[],
          } }
        })
        return cleared && this.current(fence, signal)
      })
    } catch { throw new Error('无法清除网站登录记忆。') }
  }
}

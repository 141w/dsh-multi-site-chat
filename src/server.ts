import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-typert-registry'
import {
  AuthorizationAuthority, PROFILE_CONTEXT_UNAVAILABLE, WEBSITE_PROFILE_PREFIX, type AccountReader,
} from './authorization.js'
import {
  DSH_CHAT_HOST_CONTRIBUTION, authorizationEpochSchema, clientMetadataSchema, websiteSessionSchema,
} from './protocol.js'
import type { AuthorizationState, DshChatClientMetadata, WebsiteSession } from './protocol.js'
import { WebsiteSessionStore, type WebsiteSessionFence } from './website-session-store.js'
import { SiteSessionStore, type SiteSessionFence } from './site-session-store.js'
import { siteById } from './sites.js'
import type { SiteCookie, SiteSession } from './protocol.js'

/** Independent CHAT website session service scoped to the current DSH profile. */
export class DshChatController extends TypertRemoteService {
  static inject = ['credentials', 'typert']
  readonly authority: AuthorizationAuthority
  private readonly websiteSessions: WebsiteSessionStore
  private readonly siteSessions: SiteSessionStore
  private legacyAccount: AccountReader | undefined
  constructor(ctx: Context) {
    super(ctx, 'dshDeepseekChat')
    // Public launcher-owned metadata, never a Client-selected path or an account login.
    const profile: unknown = ctx.get('profileContext')
    const dir = profile !== null && typeof profile === 'object' && 'dir' in profile
      ? profile.dir : undefined
    const profileId = typeof dir === 'string' && dir.length <= 16_384 && isAbsolute(dir)
      && !dir.includes('\0')
      ? `${WEBSITE_PROFILE_PREFIX}${createHash('sha256').update(resolve(dir), 'utf8').digest('hex')}`
      : null
    this.authority = new AuthorizationAuthority(profileId)
    this.websiteSessions = new WebsiteSessionStore(ctx.credentials, this.authority, profileId,
      (metadata, signal) => this.legacyAccountId(metadata, signal))
    this.siteSessions = new SiteSessionStore(ctx.credentials, this.authority, profileId)
    ctx.typert.register(DSH_CHAT_HOST_CONTRIBUTION)
    // An optional public identity can locate this plugin's one old account-keyed grant.
    // Neither DSH sign-out nor an expired DSH grant changes CHAT availability.
    ctx.inject(['deepseekAccount'], child => {
      const account = child.deepseekAccount
      this.legacyAccount = account
      child.effect(() => () => { if (this.legacyAccount === account) this.legacyAccount = undefined })
    })
    ctx.effect(() => () => { this.authority.dispose() }, 'dsh-deepseek-chat profile session lifetime')
  }

  private async legacyAccountId(metadata: DshChatClientMetadata, signal: AbortSignal): Promise<string | null> {
    const account = this.legacyAccount
    if (!account || signal.aborted) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled: (() => void) | undefined
    try {
      return await Promise.race([
        (async () => {
          if ((await account.getState()).status !== 'credential-stored' || signal.aborted) return null
          const profile = await account.getProfile(metadata)
          return !signal.aborted && profile?.status === 'ready' ? profile.value.id : null
        })(),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1_500) }),
        new Promise<null>(resolve => {
          cancelled = () => resolve(null)
          signal.addEventListener('abort', cancelled, { once: true })
          if (signal.aborted) cancelled()
        }),
      ])
    } catch { return null }
    finally {
      clearTimeout(timer)
      if (cancelled) signal.removeEventListener('abort', cancelled)
    }
  }
  @Remote
  async authorization(metadata: DshChatClientMetadata, signal: AbortSignal): Promise<AuthorizationState> {
    try {
      signal.throwIfAborted()
      const state = await this.authority.refresh(clientMetadataSchema.parse(metadata))
      signal.throwIfAborted()
      return state
    } catch {
      throw new RemoteError('gateway/internal', '无法连接 CHAT 登录保存服务，请检查 DSH 服务。', {})
    }
  }
  @Remote({ mode: 'stream' })
  async *watchAuthorization(metadata: DshChatClientMetadata, signal: AbortSignal): AsyncIterable<AuthorizationState> {
    try { yield* this.authority.watch(clientMetadataSchema.parse(metadata), signal) }
    catch { throw new RemoteError('gateway/internal', '无法连接 CHAT 登录保存服务，请检查 DSH 服务。', {}) }
  }

  private async websiteFence(metadata: DshChatClientMetadata, epoch: string, signal: AbortSignal): Promise<WebsiteSessionFence | null> {
    signal.throwIfAborted()
    const expectedEpoch = authorizationEpochSchema.parse(epoch)
    const state = await this.authority.refresh(clientMetadataSchema.parse(metadata))
    signal.throwIfAborted()
    const current = this.authority.getSnapshot()
    if (state.status !== 'authorized'
      || (state.error !== null && state.error !== PROFILE_CONTEXT_UNAVAILABLE) || !state.accountId
      || state.accountId.length > 512 || state.epoch !== expectedEpoch
      || current.status !== 'authorized' || current.error !== state.error
      || current.accountId !== state.accountId || current.epoch !== expectedEpoch) return null
    return { accountId: state.accountId, epoch: expectedEpoch }
  }

  @Remote
  async loadWebsiteSession(metadata: DshChatClientMetadata, epoch: string, signal: AbortSignal): Promise<WebsiteSession | null> {
    try {
      const revision = this.websiteSessions.captureRevision()
      const fence = await this.websiteFence(metadata, epoch, signal)
      return fence ? await this.websiteSessions.load(fence, signal, metadata, revision) : null
    } catch { throw new RemoteError('gateway/internal', '无法恢复 CHAT 登录，请重试。', {}) }
  }

  @Remote
  async saveWebsiteSession(metadata: DshChatClientMetadata, epoch: string, session: WebsiteSession, signal: AbortSignal): Promise<boolean> {
    try {
      const revision = this.websiteSessions.captureRevision()
      const parsed = websiteSessionSchema.parse(session)
      const fence = await this.websiteFence(metadata, epoch, signal)
      return fence ? await this.websiteSessions.save(fence, parsed, signal, revision) : false
    } catch { throw new RemoteError('gateway/internal', '无法保存 CHAT 登录，请重试。', {}) }
  }

  @Remote
  async clearWebsiteSession(metadata: DshChatClientMetadata, epoch: string, signal: AbortSignal): Promise<boolean> {
    try {
      const fence = await this.websiteFence(metadata, epoch, signal)
      return fence ? await this.websiteSessions.clear(fence, signal) : false
    } catch { throw new RemoteError('gateway/internal', '无法清除 CHAT 登录，请重试。', {}) }
  }

  private async siteFence(metadata: DshChatClientMetadata, epoch: string, signal: AbortSignal): Promise<SiteSessionFence | null> {
    const state = this.authority.getSnapshot()
    if (state.status !== 'authorized' || !state.accountId || state.accountId.length > 512
      || state.epoch !== epoch || signal.aborted) return null
    return { accountId: state.accountId, epoch }
  }
  /**
   * Stores a site's login cookies in the profile-scoped vault. The guest's own
   * cookie jar is unreachable from a plugin (no Electron, no cookie API), so the
   * user imports the cookie set once, exactly like gemini-web2api does; writing
   * them back into the guest is plain document.cookie and needs no privilege.
   */
  @Remote
  async saveSiteSession(
    metadata: DshChatClientMetadata, epoch: string, site: string, cookies: readonly SiteCookie[], signal: AbortSignal,
  ): Promise<boolean> {
    const fence = await this.siteFence(metadata, epoch, signal)
    if (fence === null || siteById(site).id !== site || cookies.length === 0) return false
    try {
      return await this.siteSessions.save(fence, signal, { site, cookies })
    } catch { throw new RemoteError('gateway/internal', '无法保存网站登录，请重试。', {}) }
  }

  @Remote
  async loadSiteSession(metadata: DshChatClientMetadata, epoch: string, site: string, signal: AbortSignal): Promise<SiteSession | null> {
    const fence = await this.siteFence(metadata, epoch, signal)
    if (fence === null || siteById(site).id !== site) return null
    try {
      return await this.siteSessions.load(fence, signal, site)
    } catch { throw new RemoteError('gateway/internal', '无法读取网站登录，请重试。', {}) }
  }

  @Remote
  async clearSiteSession(metadata: DshChatClientMetadata, epoch: string, site: string, signal: AbortSignal): Promise<boolean> {
    const fence = await this.siteFence(metadata, epoch, signal)
    if (fence === null || siteById(site).id !== site) return false
    try {
      return await this.siteSessions.clear(fence, signal, site)
    } catch { throw new RemoteError('gateway/internal', '无法清除网站登录，请重试。', {}) }
  }

}

declare module '@deepseek-ai/cordis' { interface Context { dshDeepseekChat: DshChatController } }
import { z } from 'zod'
import type {
  InvocationDescriptor, RemoteResult, RemoteStreamHandle, TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'

/** Credential-free identity of the UI using the plugin's own Host bridge. */
export interface DshChatClientMetadata {
  version: string
  locale: string
  timezoneOffsetSeconds: number
}

/** Host lifetime and profile scope; website login is observed separately in our guest. */
export interface AuthorizationState {
  status: 'pending' | 'authorized' | 'unauthorized' | 'unavailable'
  accountId: string | null
  /** Host-issued generation fence; it is an identifier, never an account credential. */
  epoch: string
  error: string | null
}

/** The website's own login result, transported only by the internal CHAT Client bridge. */
export interface WebsiteSession {
  token: string
  userId: string
  deviceId: string
}

export const WEBSITE_SESSION_ORIGIN = 'https://chat.deepseek.com' as const
const identifier = z.string().min(1).max(512)
export const authorizationEpochSchema = identifier
export const clientMetadataSchema = z.strictObject({
  version: z.string().min(1).max(100), locale: z.string().min(1).max(100),
  timezoneOffsetSeconds: z.number().int().min(-86_400).max(86_400),
}) satisfies z.ZodType<DshChatClientMetadata>
export const authorizationSchema = z.strictObject({
  status: z.enum(['pending', 'authorized', 'unauthorized', 'unavailable']),
  accountId: identifier.nullable(), epoch: authorizationEpochSchema, error: z.string().max(100).nullable(),
}) satisfies z.ZodType<AuthorizationState>
export const websiteSessionSchema = z.strictObject({
  token: z.string().min(1).max(16_384),
  userId: identifier,
  deviceId: z.string().uuid(),
}) satisfies z.ZodType<WebsiteSession>

/**
 * One captured cookie of a registered site. It travels only inside the plugin's
 * own Host bridge and rests only in the profile-scoped credential vault.
 */
export interface SiteCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'strict' | 'lax' | 'none' | 'unspecified'
  /** Epoch seconds; null is a session cookie. */
  expires: number | null
}

export const siteCookieSchema = z.strictObject({
  name: z.string().min(1).max(256),
  value: z.string().min(0).max(16_384),
  domain: z.string().min(1).max(256),
  path: z.string().min(1).max(256),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.enum(['strict', 'lax', 'none', 'unspecified']),
  expires: z.number().int().min(0).nullable(),
}) satisfies z.ZodType<SiteCookie>

/** A site's remembered login: the minimal sufficient cookie set, nothing else. */
export interface SiteSession {
  site: string
  cookies: readonly SiteCookie[]
}

export const siteSessionSchema = z.strictObject({
  site: z.string().min(1).max(64),
  cookies: z.array(siteCookieSchema).max(128),
}) satisfies z.ZodType<SiteSession>

const strict = (name: string, schema: z.ZodType) => ({
  mode: 'strict' as const, typeSymbol: `dsh-deepseek-chat#${name}`, create: () => schema,
})
const metadataParameter = {
  name: 'metadata', wire: 'metadata', source: 'json' as const,
  codec: strict('DshChatClientMetadata', clientMetadataSchema),
}
const epochParameter = {
  name: 'epoch', wire: 'epoch', source: 'json' as const,
  codec: strict('AuthorizationEpoch', authorizationEpochSchema),
}
const descriptor = (method: string, stream = false): InvocationDescriptor => ({
  id: `dsh-deepseek-chat#dshDeepseekChat/${method}`, service: 'dshDeepseekChat', namespace: 'dshDeepseekChat', method,
  invocation: { kind: 'direct' }, parameters: [metadataParameter],
  cancellation: { parameter: 'signal' }, result: strict('AuthorizationState', authorizationSchema),
  ...(stream ? { mode: 'stream' as const } : {}),
})
const websiteDescriptor = (method: string, save = false): InvocationDescriptor => ({
  id: `dsh-deepseek-chat#dshDeepseekChat/${method}`, service: 'dshDeepseekChat', namespace: 'dshDeepseekChat', method,
  invocation: { kind: 'direct' },
  parameters: [metadataParameter, epochParameter, ...(save ? [{
    name: 'session', wire: 'session', source: 'json' as const,
    codec: strict('WebsiteSession', websiteSessionSchema),
  }] : [])],
  cancellation: { parameter: 'signal' },
  result: method === 'loadWebsiteSession'
    ? strict('OptionalWebsiteSession', websiteSessionSchema.nullable())
    : strict('WebsiteSessionOperationResult', z.boolean()),
})

const siteParameter = {
  name: 'site', wire: 'site', source: 'json' as const,
  codec: strict('ChatSiteId', z.string().min(1).max(64)),
}
const siteCookiesParameter = {
  name: 'cookies', wire: 'cookies', source: 'json' as const,
  codec: strict('SiteCookieList', z.array(siteCookieSchema).max(128)),
}
const siteDescriptor = (method: string, save = false): InvocationDescriptor => ({
  id: `dsh-deepseek-chat#dshDeepseekChat/${method}`, service: 'dshDeepseekChat', namespace: 'dshDeepseekChat', method,
  invocation: { kind: 'direct' },
  parameters: [metadataParameter, epochParameter, siteParameter, ...(save ? [siteCookiesParameter] : [])],
  cancellation: { parameter: 'signal' },
  result: method === 'loadSiteSession'
    ? strict('OptionalSiteSession', siteSessionSchema.nullable())
    : strict('SiteSessionOperationResult', z.boolean()),
})

/** Explicit strict descriptors use the public registry; no source-mode method discovery. */
export const DSH_CHAT_DESCRIPTORS: readonly InvocationDescriptor[] = [
  descriptor('authorization'), descriptor('watchAuthorization', true),
  websiteDescriptor('loadWebsiteSession'), websiteDescriptor('saveWebsiteSession', true),
  websiteDescriptor('clearWebsiteSession'),
  siteDescriptor('saveSiteSession', true), siteDescriptor('loadSiteSession'),
  siteDescriptor('clearSiteSession'),
]
export const DSH_CHAT_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-deepseek-chat', descriptors: DSH_CHAT_DESCRIPTORS,
}
export const DSH_CHAT_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-deepseek-chat', face: 'host', schemas: [],
  // Website credentials are never model-callable services or objects.
  model: { services: [], events: [], objects: [] }, invocations: DSH_CHAT_DESCRIPTORS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'dshDeepseekChat/authorization': (metadata: DshChatClientMetadata, signal?: AbortSignal) => Promise<RemoteResult<AuthorizationState>>
    'dshDeepseekChat/watchAuthorization': (metadata: DshChatClientMetadata, signal?: AbortSignal) => RemoteStreamHandle<AuthorizationState, never>
    'dshDeepseekChat/loadWebsiteSession': (metadata: DshChatClientMetadata, epoch: string, signal?: AbortSignal) => Promise<RemoteResult<WebsiteSession | null>>
    'dshDeepseekChat/saveWebsiteSession': (metadata: DshChatClientMetadata, epoch: string, session: WebsiteSession, signal?: AbortSignal) => Promise<RemoteResult<boolean>>
    'dshDeepseekChat/clearWebsiteSession': (metadata: DshChatClientMetadata, epoch: string, signal?: AbortSignal) => Promise<RemoteResult<boolean>>
    'dshDeepseekChat/saveSiteSession': (metadata: DshChatClientMetadata, epoch: string, site: string, cookies: readonly SiteCookie[], signal?: AbortSignal) => Promise<RemoteResult<boolean>>
    'dshDeepseekChat/loadSiteSession': (metadata: DshChatClientMetadata, epoch: string, site: string, signal?: AbortSignal) => Promise<RemoteResult<SiteSession | null>>
    'dshDeepseekChat/clearSiteSession': (metadata: DshChatClientMetadata, epoch: string, site: string, signal?: AbortSignal) => Promise<RemoteResult<boolean>>
  }
  interface TypertRemoteNamespaceMap {
    dshDeepseekChat: import('@deepseek-ai/dsh-typert-protocol').TypertRemoteNamespace<'dshDeepseekChat'>
  }
}
import { z } from 'zod';
import type { InvocationDescriptor, RemoteResult, RemoteStreamHandle, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
/** Credential-free identity of the UI using the plugin's own Host bridge. */
export interface DshChatClientMetadata {
    version: string;
    locale: string;
    timezoneOffsetSeconds: number;
}
/** Host lifetime and profile scope; website login is observed separately in our guest. */
export interface AuthorizationState {
    status: 'pending' | 'authorized' | 'unauthorized' | 'unavailable';
    accountId: string | null;
    /** Host-issued generation fence; it is an identifier, never an account credential. */
    epoch: string;
    error: string | null;
}
/** The website's own login result, transported only by the internal CHAT Client bridge. */
export interface WebsiteSession {
    token: string;
    userId: string;
    deviceId: string;
}
export declare const WEBSITE_SESSION_ORIGIN: "https://chat.deepseek.com";
export declare const authorizationEpochSchema: z.ZodString;
export declare const clientMetadataSchema: z.ZodObject<{
    version: z.ZodString;
    locale: z.ZodString;
    timezoneOffsetSeconds: z.ZodNumber;
}, z.core.$strict>;
export declare const authorizationSchema: z.ZodObject<{
    status: z.ZodEnum<{
        pending: "pending";
        authorized: "authorized";
        unauthorized: "unauthorized";
        unavailable: "unavailable";
    }>;
    accountId: z.ZodNullable<z.ZodString>;
    epoch: z.ZodString;
    error: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const websiteSessionSchema: z.ZodObject<{
    token: z.ZodString;
    userId: z.ZodString;
    deviceId: z.ZodString;
}, z.core.$strict>;
/**
 * One captured cookie of a registered site. It travels only inside the plugin's
 * own Host bridge and rests only in the profile-scoped credential vault.
 */
export interface SiteCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none' | 'unspecified';
    /** Epoch seconds; null is a session cookie. */
    expires: number | null;
}
export declare const siteCookieSchema: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodString;
    domain: z.ZodString;
    path: z.ZodString;
    secure: z.ZodBoolean;
    httpOnly: z.ZodBoolean;
    sameSite: z.ZodEnum<{
        strict: "strict";
        lax: "lax";
        none: "none";
        unspecified: "unspecified";
    }>;
    expires: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
/** A site's remembered login: the minimal sufficient cookie set, nothing else. */
export interface SiteSession {
    site: string;
    cookies: readonly SiteCookie[];
}
export declare const siteSessionSchema: z.ZodObject<{
    site: z.ZodString;
    cookies: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        value: z.ZodString;
        domain: z.ZodString;
        path: z.ZodString;
        secure: z.ZodBoolean;
        httpOnly: z.ZodBoolean;
        sameSite: z.ZodEnum<{
            strict: "strict";
            lax: "lax";
            none: "none";
            unspecified: "unspecified";
        }>;
        expires: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Explicit strict descriptors use the public registry; no source-mode method discovery. */
export declare const DSH_CHAT_DESCRIPTORS: readonly InvocationDescriptor[];
export declare const DSH_CHAT_REMOTE_CONTRIBUTION: TypertRemoteContribution;
export declare const DSH_CHAT_HOST_CONTRIBUTION: TypertContribution;
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteMap {
        'dshDeepseekChat/authorization': (metadata: DshChatClientMetadata, signal?: AbortSignal) => Promise<RemoteResult<AuthorizationState>>;
        'dshDeepseekChat/watchAuthorization': (metadata: DshChatClientMetadata, signal?: AbortSignal) => RemoteStreamHandle<AuthorizationState, never>;
        'dshDeepseekChat/loadWebsiteSession': (metadata: DshChatClientMetadata, epoch: string, signal?: AbortSignal) => Promise<RemoteResult<WebsiteSession | null>>;
        'dshDeepseekChat/saveWebsiteSession': (metadata: DshChatClientMetadata, epoch: string, session: WebsiteSession, signal?: AbortSignal) => Promise<RemoteResult<boolean>>;
        'dshDeepseekChat/clearWebsiteSession': (metadata: DshChatClientMetadata, epoch: string, signal?: AbortSignal) => Promise<RemoteResult<boolean>>;
        'dshDeepseekChat/saveSiteSession': (metadata: DshChatClientMetadata, epoch: string, site: string, cookies: readonly SiteCookie[], signal?: AbortSignal) => Promise<RemoteResult<boolean>>;
        'dshDeepseekChat/loadSiteSession': (metadata: DshChatClientMetadata, epoch: string, site: string, signal?: AbortSignal) => Promise<RemoteResult<SiteSession | null>>;
        'dshDeepseekChat/clearSiteSession': (metadata: DshChatClientMetadata, epoch: string, site: string, signal?: AbortSignal) => Promise<RemoteResult<boolean>>;
    }
    interface TypertRemoteNamespaceMap {
        dshDeepseekChat: import('@deepseek-ai/dsh-typert-protocol').TypertRemoteNamespace<'dshDeepseekChat'>;
    }
}

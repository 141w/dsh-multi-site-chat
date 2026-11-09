import { type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { type AuthorizationAuthority } from './authorization.js';
import type { SiteSession } from './protocol.js';
export interface SiteSessionFence {
    accountId: string;
    epoch: string;
}
type SiteCredentials = Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>;
type SiteAuthority = Pick<AuthorizationAuthority, 'getSnapshot'>;
/**
 * Remembers one registered site's login cookies in the profile-scoped vault.
 * The DSH guest session is non-persistent, so this is the only way a site
 * login survives an app restart. Mirrors WebsiteSessionStore's fencing and
 * serialization, keyed per site so each site's grant is independent.
 */
export declare class SiteSessionStore {
    private readonly credentials;
    private readonly authority;
    private readonly profileId;
    private readonly pending;
    constructor(credentials: SiteCredentials, authority: SiteAuthority, profileId: string | null);
    private key;
    private current;
    private exclusive;
    private sessionFromRecord;
    load(fence: SiteSessionFence, signal: AbortSignal, site: string): Promise<SiteSession | null>;
    save(fence: SiteSessionFence, signal: AbortSignal, session: SiteSession): Promise<boolean>;
    clear(fence: SiteSessionFence, signal: AbortSignal, site: string): Promise<boolean>;
}
export {};

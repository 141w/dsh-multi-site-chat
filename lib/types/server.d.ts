import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { AuthorizationAuthority } from './authorization.js';
import type { AuthorizationState, DshChatClientMetadata, WebsiteSession } from './protocol.js';
import type { SiteCookie, SiteSession } from './protocol.js';
/** Independent CHAT website session service scoped to the current DSH profile. */
export declare class DshChatController extends TypertRemoteService {
    static inject: string[];
    readonly authority: AuthorizationAuthority;
    private readonly websiteSessions;
    private readonly siteSessions;
    private legacyAccount;
    constructor(ctx: Context);
    private legacyAccountId;
    authorization(metadata: DshChatClientMetadata, signal: AbortSignal): Promise<AuthorizationState>;
    watchAuthorization(metadata: DshChatClientMetadata, signal: AbortSignal): AsyncIterable<AuthorizationState>;
    private websiteFence;
    loadWebsiteSession(metadata: DshChatClientMetadata, epoch: string, signal: AbortSignal): Promise<WebsiteSession | null>;
    saveWebsiteSession(metadata: DshChatClientMetadata, epoch: string, session: WebsiteSession, signal: AbortSignal): Promise<boolean>;
    clearWebsiteSession(metadata: DshChatClientMetadata, epoch: string, signal: AbortSignal): Promise<boolean>;
    private siteFence;
    /**
     * Stores a site's login cookies in the profile-scoped vault. The guest's own
     * cookie jar is unreachable from a plugin (no Electron, no cookie API), so the
     * user imports the cookie set once, exactly like gemini-web2api does; writing
     * them back into the guest is plain document.cookie and needs no privilege.
     */
    saveSiteSession(metadata: DshChatClientMetadata, epoch: string, site: string, cookies: readonly SiteCookie[], signal: AbortSignal): Promise<boolean>;
    loadSiteSession(metadata: DshChatClientMetadata, epoch: string, site: string, signal: AbortSignal): Promise<SiteSession | null>;
    clearSiteSession(metadata: DshChatClientMetadata, epoch: string, site: string, signal: AbortSignal): Promise<boolean>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        dshDeepseekChat: DshChatController;
    }
}

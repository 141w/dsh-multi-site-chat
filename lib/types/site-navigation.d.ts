import type { WebsiteNavigation } from './website-navigation.js';
import { type ChatSite } from './sites.js';
import type { SiteCookie } from './protocol.js';
/**
 * Reads one registered site's own conversation list from its sidebar. It is
 * serialized into the guest, so it stays self-contained: no module import and
 * no guessed selector. An unknown structure degrades to 'unsupported', which
 * the sidebar already renders as its fallback message.
 */
export declare function adaptSiteNavigation(doc: Document, page: Pick<Location, 'pathname'>, site: string): WebsiteNavigation;
export declare function siteNavigationScript(site: string): string;
/** Serializes a click on the site's own conversation link, keeping its SPA state. */
export declare function siteOpenScript(site: string, href: string): string;
/** Whether this site's conversation list has a confirmed selector. */
export declare function siteHasConversationList(site: string): boolean;
/**
 * Writes a stored cookie set into the guest with plain document.cookie. The
 * server accepts a script-set cookie exactly like an httpOnly one; only this
 * page (not the server) is barred from reading it back. Self-contained for
 * serialization into the guest.
 */
export declare function siteCookieWriteScript(cookies: readonly {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    sameSite: string;
    expires: number | null;
}[]): string;
/** Reports which of a site's login cookies the guest currently holds. */
export declare function siteCookieProbeScript(names: readonly string[]): string;
export declare function parseSiteCookies(site: string, text: string, custom?: readonly ChatSite[]): SiteCookie[];

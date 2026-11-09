/**
 * Registry of websites the CHAT guest can host. Adding a site is a one-line
 * change here plus its label in locale; every other module reads this table.
 *
 * Only DeepSeek has plugin-owned adapters (conversation list, account proof,
 * conversation actions, login memory). Other sites run as native web pages
 * inside the same retained guest: their own cookies keep them signed in, and
 * the plugin never claims capabilities it has not verified for them.
 */
export interface ChatSite {
    /** Stable preference value; never shown to users. */
    readonly id: string;
    /** Hosts the guest may load and the new-window gate may open for this site. */
    readonly hosts: readonly string[];
    /** Landing URL loaded when the site is selected. */
    readonly url: string;
    /** Cookie domains this site's login lives on; the guest stores it per site. */
    readonly cookieDomains: readonly string[];
    /**
     * Minimal sufficient login-cookie set, confirmed per site (see
     * docs/site-session-research.md). Prefixes end with '*'. Only these are ever
     * captured or restored; anything else stays with the guest alone.
     */
    readonly sessionCookies: readonly string[];
    /**
     * The login token itself, and only that. Cloudflare cookies such as
     * cf_clearance are set on every page of every site, signed in or not, so
     * they must never answer "is this site signed in?".
     */
    readonly authCookies: readonly string[];
    /**
     * Without these the login cannot work at all, so an import missing one is
     * refused. The remaining authCookies are imported when present and only
     * warned about when absent.
     */
    readonly requiredAuthCookies: readonly string[];
    /**
     * A user-added site has no confirmed cookie list, so an import keeps every
     * cookie the user pastes instead of filtering by name.
     */
    readonly acceptAllCookies?: boolean;
    /** User-chosen name for an added site; built-ins use siteLabel instead. */
    readonly label?: string;
    /**
     * Glyph id for an added site ('auto' or absent draws a letter tile whose hue
     * is derived from the id, so a site keeps the same colour everywhere).
     */
    readonly icon?: string;
}
export declare const CHAT_SITES: readonly ChatSite[];
export declare const DEFAULT_SITE_ID: string;
/** Brand names are never translated. */
export declare function siteLabel(id: string): string;
/** Built-in sites plus the user's own; built-ins win on an id clash. */
export declare function allSites(custom?: readonly ChatSite[]): readonly ChatSite[];
export declare function siteById(id: unknown, custom?: readonly ChatSite[]): ChatSite;
/**
   * Builds the registry entry for a user-added website. The label defaults to
   * the host, the id is derived from the URL so re-adding the same site is
   * idempotent, and every pasted cookie is kept because nothing is confirmed
   * about a site the plugin has never inspected.
   */
export declare function customSiteFrom(label: string, url: string, icon?: string): ChatSite | null;
/**
   * The letter a site's tile shows. www.example.com reads as E, not W: the
   * subdomain says nothing about the site. Falls back to W for an empty id.
   */
export declare function siteInitialLetter(id: string): string;
/** True when the URL is an https URL on one of the site's hosts; used by every origin gate. */
export declare function urlBelongsToSite(url: string, site: ChatSite): boolean;
/** Every host the guest may navigate to, across all registered sites. */
export declare function allSiteHosts(custom?: readonly ChatSite[]): readonly string[];

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
  readonly id: string
  /** Hosts the guest may load and the new-window gate may open for this site. */
  readonly hosts: readonly string[]
  /** Landing URL loaded when the site is selected. */
  readonly url: string
  /** Cookie domains this site's login lives on; the guest stores it per site. */
  readonly cookieDomains: readonly string[]
  /**
   * Minimal sufficient login-cookie set, confirmed per site (see
   * docs/site-session-research.md). Prefixes end with '*'. Only these are ever
   * captured or restored; anything else stays with the guest alone.
   */
  readonly sessionCookies: readonly string[]
  /**
   * The login token itself, and only that. Cloudflare cookies such as
   * cf_clearance are set on every page of every site, signed in or not, so
   * they must never answer "is this site signed in?".
   */
  readonly authCookies: readonly string[]
  /**
   * Without these the login cannot work at all, so an import missing one is
   * refused. The remaining authCookies are imported when present and only
   * warned about when absent.
   */
  readonly requiredAuthCookies: readonly string[]
  /**
   * A user-added site has no confirmed cookie list, so an import keeps every
   * cookie the user pastes instead of filtering by name.
   */
  readonly acceptAllCookies?: boolean
  /** User-chosen name for an added site; built-ins use siteLabel instead. */
  readonly label?: string
  /**
   * Glyph id for an added site ('auto' or absent draws a letter tile whose hue
   * is derived from the id, so a site keeps the same colour everywhere).
   */
  readonly icon?: string
}

const DEEPSEEK_HOST = 'chat.deepseek.com'

export const CHAT_SITES: readonly ChatSite[] = Object.freeze([
  Object.freeze({ id: 'deepseek', hosts: Object.freeze([DEEPSEEK_HOST]), url: 'https://chat.deepseek.com/', cookieDomains: Object.freeze([DEEPSEEK_HOST]), sessionCookies: Object.freeze([]), authCookies: Object.freeze([]), requiredAuthCookies: Object.freeze([]) }),
  Object.freeze({ id: 'chatgpt', hosts: Object.freeze(['chatgpt.com', 'chat.openai.com']), url: 'https://chatgpt.com/',
    cookieDomains: Object.freeze(['chatgpt.com', '.chatgpt.com']),
    sessionCookies: Object.freeze(['__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1', '__Host-next-auth.csrf-token', '__Secure-next-auth.callback-url', '_account', '_account_is_fedramp', 'oai-client-session-epoch', 'oai-gn', 'oai-sc', 'oai-hlib', 'oai_pl_permission_state', 'oai-mweb-auth-pending', 'oai_consent_*', 'cf_clearance', '__cf_bm', '__cflb', '__oailb', '_cfuvid']),
    authCookies: Object.freeze(['__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1']),
    requiredAuthCookies: Object.freeze(['__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1']) }),
  Object.freeze({ id: 'claude', hosts: Object.freeze(['claude.ai']), url: 'https://claude.ai/',
    cookieDomains: Object.freeze(['claude.ai', '.claude.ai']),
    sessionCookies: Object.freeze(['sessionKey', 'sessionKeyLC', 'lastActiveOrg', 'anthropic-device-id', 'routingHint', 'cf_clearance', '__cf_bm', '_cfuvid']),
    authCookies: Object.freeze(['sessionKey', 'sessionKeyLC']),
    requiredAuthCookies: Object.freeze(['sessionKey']) }),
  Object.freeze({ id: 'gemini', hosts: Object.freeze(['gemini.google.com']), url: 'https://gemini.google.com/',
    cookieDomains: Object.freeze(['gemini.google.com', '.google.com', 'accounts.google.com']),
    sessionCookies: Object.freeze(['SID', 'HSID', 'SSID', 'LSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSIDCC', '__Secure-1PAPISID', '__Secure-3PAPISID', '__Host-1PLSID', '__Host-3PLSID', '__Host-GAPS', 'ACCOUNT_CHOOSER', 'OTZ', 'NID', 'COMPASS', 'cf_clearance', '__cf_bm']),
    authCookies: Object.freeze(['SID', 'HSID', 'SSID', 'LSID', '__Secure-1PSID', '__Secure-3PSID', 'APISID', 'SAPISID']),
    requiredAuthCookies: Object.freeze(['__Secure-1PSID']) }),
])

export const DEFAULT_SITE_ID = CHAT_SITES[0].id

/** Brand names are never translated. */
export function siteLabel(id: string): string {
  return { deepseek: 'DeepSeek', chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' }[id] ?? id
}

/** Built-in sites plus the user's own; built-ins win on an id clash. */
export function allSites(custom: readonly ChatSite[] = []): readonly ChatSite[] {
  return [...CHAT_SITES, ...custom.filter(site => !CHAT_SITES.some(builtin => builtin.id === site.id))]
}

export function siteById(id: unknown, custom: readonly ChatSite[] = []): ChatSite {
  if (typeof id !== 'string') return CHAT_SITES[0]
  return CHAT_SITES.find(site => site.id === id) ?? custom.find(site => site.id === id) ?? CHAT_SITES[0]
}

/**
   * Builds the registry entry for a user-added website. The label defaults to
   * the host, the id is derived from the URL so re-adding the same site is
   * idempotent, and every pasted cookie is kept because nothing is confirmed
   * about a site the plugin has never inspected.
   */
export function customSiteFrom(label: string, url: string, icon = 'auto'): ChatSite | null {
  let parsed: URL
  try { parsed = new URL(url.trim()) } catch { return null }
  if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) return null
  const host = parsed.hostname
  const parent = '.' + host.split('.').slice(-2).join('.')
  const name = label.trim().length > 0 ? label.trim().slice(0, 40) : host
  return Object.freeze({
    id: 'custom-' + host.replace(/[^a-z0-9]+/g, '-'),
    hosts: Object.freeze([host]),
    url: parsed.origin + parsed.pathname.replace(/\/$/, '') + '/',
    cookieDomains: Object.freeze([host, parent]),
    sessionCookies: Object.freeze([]),
    authCookies: Object.freeze([]),
    requiredAuthCookies: Object.freeze([]),
    acceptAllCookies: true,
    label: name,
    icon,
  })
}

/**
   * The letter a site's tile shows. www.example.com reads as E, not W: the
   * subdomain says nothing about the site. Falls back to W for an empty id.
   */
export function siteInitialLetter(id: string): string {
  const host = id.replace(/^custom-/, '').replace(/-/g, '.').replace(/^www\./, '')
  return (/[a-z]/i.exec(host) || ['W'])[0].toUpperCase()
}
/** True when the URL is an https URL on one of the site's hosts; used by every origin gate. */
export function urlBelongsToSite(url: string, site: ChatSite): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && site.hosts.includes(parsed.hostname)
  } catch { return false }
}

/** Every host the guest may navigate to, across all registered sites. */
export function allSiteHosts(custom: readonly ChatSite[] = []): readonly string[] {
  return [...new Set(allSites(custom).flatMap(site => site.hosts))]
}
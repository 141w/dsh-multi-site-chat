import type { WebsiteNavigation } from './website-navigation.js'
import { siteById, type ChatSite } from './sites.js'
import type { SiteCookie } from './protocol.js'

/** Conversation-link prefixes per registered site, confirmed in the guest. */
const SITE_LINK_PREFIX: Readonly<Record<string, string>> = {
  chatgpt: '/c/', claude: '/chat/', gemini: '/app/',
}

/**
 * Reads one registered site's own conversation list from its sidebar. It is
 * serialized into the guest, so it stays self-contained: no module import and
 * no guessed selector. An unknown structure degrades to 'unsupported', which
 * the sidebar already renders as its fallback message.
 */
export function adaptSiteNavigation(doc: Document, page: Pick<Location, 'pathname'>, site: string): WebsiteNavigation {
  // Self-contained: this function is serialized into the guest, so every binding
  // it uses must live inside it.
  const patterns: Readonly<Record<string, string>> = {
    chatgpt: '^\\/c\\/[^\\/?#]+',
    claude: '^\\/chat\\/[^\\/?#]+',
    // Gemini keeps the account index in the path (/u/1/app/<id>).
    gemini: '^\\/(u\\/\\d+\\/)?app\\/[^\\/?#]+',
  }
  const pattern = patterns[site]
  const empty = (status: 'loading' | 'unsupported'): WebsiteNavigation => ({
    status, authenticated: false, conversations: [], selectedHref: null, canCreate: false, error: null,
  })
  if (pattern === undefined) return empty('unsupported')
  const test = new RegExp(pattern)
  // Read the attribute and the property alike: Angular apps such as Gemini can
  // leave the attribute empty while the href property holds the resolved URL,
  // and the links may be absolute rather than site-root relative.
  const candidates = [...doc.querySelectorAll('a[href], a')].slice(0, 400) as HTMLAnchorElement[]
  const conversations: WebsiteNavigation['conversations'][number][] = []
  const seen = new Set<string>()
  for (const link of candidates) {
    const raw = (link.getAttribute('href') || link.href || '').trim()
    if (raw.length === 0) continue
    let path = raw
    if (/^https?:\//.test(raw)) {
      try { path = new URL(raw).pathname } catch { continue }
    }
    if (!test.test(path) || seen.has(path)) continue
    const title = (link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (title.length === 0) continue
    seen.add(path)
    conversations.push({ href: path, title, group: '对话' })
  }
  if (conversations.length === 0) return empty('unsupported')
  const selectedHref = conversations.find(item => item.href === page.pathname)?.href ?? null
  return { status: 'ready', authenticated: true, conversations, selectedHref, canCreate: true, error: null }
}
export function siteNavigationScript(site: string): string {
  return '(() => (' + adaptSiteNavigation.toString() + ')(document,location,' + JSON.stringify(site) + '))()'
}

/** Serializes a click on the site's own conversation link, keeping its SPA state. */
export function siteOpenScript(site: string, href: string): string {
  const prefixes: Readonly<Record<string, string>> = { chatgpt: '/c/', claude: '/chat/', gemini: '/app/' }
  const prefix = prefixes[site]
  if (prefix === undefined) return 'false'
  return '(() => { const target = ' + JSON.stringify(href) + '; const link = [...document.querySelectorAll("a[href^=\"' + prefix + '\"]")].find(item => item.getAttribute("href") === target); if (!link) return false; link.click(); return true })()'
}

/** Whether this site's conversation list has a confirmed selector. */
export function siteHasConversationList(site: string): boolean {
  return SITE_LINK_PREFIX[site] !== undefined
}

/**
 * Writes a stored cookie set into the guest with plain document.cookie. The
 * server accepts a script-set cookie exactly like an httpOnly one; only this
 * page (not the server) is barred from reading it back. Self-contained for
 * serialization into the guest.
 */
export function siteCookieWriteScript(cookies: readonly { name: string; value: string; domain: string; path: string; secure: boolean; sameSite: string; expires: number | null }[]): string {
  return '(() => { const cookies = ' + JSON.stringify(cookies) + '; for (const c of cookies) {'
    + " const parts = [c.name + '=' + c.value, 'path=' + (c.path || '/')];"
    + ' if (c.domain) parts.push("domain=" + c.domain);'
    + ' if (c.secure) parts.push("secure");'
    + " if (c.sameSite && c.sameSite !== 'unspecified') parts.push('sameSite=' + c.sameSite);"
    + " if (c.expires) parts.push('max-age=' + Math.max(1, c.expires - Math.floor(Date.now() / 1000)));"
    + " document.cookie = parts.join('; ');"
    + ' } return true })()'
}

/** Reports which of a site's login cookies the guest currently holds. */
export function siteCookieProbeScript(names: readonly string[]): string {
  return '(() => { const have = new Set(document.cookie.split("; ").map(part => part.split("=")[0])); return '
    + JSON.stringify([...names]) + '.filter(name => have.has(name)) })()'
}

export function parseSiteCookies(site: string, text: string, custom: readonly ChatSite[] = []): SiteCookie[] {
  const entry = siteById(site, custom)
  if (entry.id !== site) return []
  // A user-added site has no confirmed cookie list, so everything pasted is kept.
  const wanted = entry.acceptAllCookies === true ? null : entry.sessionCookies
  const matches = (name: string) => wanted === null || wanted.some(w => w.endsWith("*") ? name.startsWith(w.slice(0, -1)) : name === w)
  const host = entry.hosts[0]
  const parentDomain = "." + host.split(".").slice(-2).join(".")
  const cookies: SiteCookie[] = []
  const push = (name: string, value: string, domain: string, sameSite = 'lax') => {
    if (name.length === 0 || value.length === 0 || !matches(name)) return
    if (cookies.some(cookie => cookie.name === name)) return
    cookies.push({
      name, value,
      domain: domain.length > 0 ? domain : name.startsWith("__Host-") ? host : parentDomain,
      path: "/", secure: true, httpOnly: false, sameSite: sameSite === "none" || sameSite === "strict" ? sameSite : "lax", expires: null,
    })
  }
  // Chrome DevTools copies its cookie table as TSV (with a header row);
  // cookie-export extensions produce the classic name=value; name2=value2 line.
  if (text.includes("\t")) {
    const rows = text.split(/\r?\n/).filter(line => line.trim().length > 0)
    // Chrome copies its cookie table as name, value, domain, path, ...; a header
    // row is optional in what users paste.
    let nameIdx = 0, valueIdx = 1, domainIdx = 2, sameSiteIdx = -1
    if (rows.length > 0 && /name/i.test(rows[0]) && /value/i.test(rows[0])) {
      const columns = rows[0].split("\t").map(column => column.trim().toLowerCase())
      nameIdx = Math.max(0, columns.indexOf("name"))
      valueIdx = Math.max(1, columns.indexOf("value"))
      domainIdx = columns.indexOf("domain")
      sameSiteIdx = columns.indexOf("samesite")
      rows.shift()
    }
    for (const row of rows) {
      const columns = row.split("\t")
      const sameSite = sameSiteIdx >= 0 ? (columns[sameSiteIdx] ?? "").trim() : ""
      push((columns[nameIdx] ?? "").trim(), (columns[valueIdx] ?? "").trim(), domainIdx >= 0 ? (columns[domainIdx] ?? "").trim() : "", sameSite)
    }
    return cookies
  }
  for (const part of text.split(";")) {
    const eq = part.trim().indexOf("=")
    if (eq <= 0) continue
    push(part.trim().slice(0, eq), part.trim().slice(eq + 1), "")
  }
  return cookies
}

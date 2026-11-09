/**
 * User-added websites. They live in localStorage beside the site preference:
 * the plugin never needs the Host for them, and a corrupt value degrades to
 * "no custom sites" instead of breaking CHAT.
 */
import { customSiteFrom, siteById, type ChatSite } from './sites.js'

export const CUSTOM_SITES_KEY = 'dsh-deepseek-chat.custom-sites'

interface StoredSite { id: string; label: string; url: string; icon?: string }

export function loadCustomSites(): ChatSite[] {
  let raw: string | null = null
  try { raw = localStorage.getItem(CUSTOM_SITES_KEY) } catch { return [] }
  if (raw === null) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const sites: ChatSite[] = []
  const seen = new Set<string>()
  for (const entry of parsed.slice(0, 24)) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Partial<StoredSite>
    if (typeof candidate.url !== 'string') continue
    const site = customSiteFrom(typeof candidate.label === 'string' ? candidate.label : '', candidate.url, typeof candidate.icon === 'string' ? candidate.icon : 'auto')
    if (site === null || seen.has(site.id)) continue
    seen.add(site.id)
    sites.push(site)
  }
  return sites
}

export function persistCustomSites(sites: readonly ChatSite[]): void {
  const payload = sites.map(site => ({ id: site.id, label: site.label ?? site.hosts[0], url: site.url, icon: site.icon ?? 'auto' }))
  try { localStorage.setItem(CUSTOM_SITES_KEY, JSON.stringify(payload)) } catch { /* storage unavailable: keep the in-memory list */ }
}

/** Adds a site, returning the stored list; null when the URL is unusable or taken. */
export function addCustomSite(current: readonly ChatSite[], label: string, url: string, icon: string): ChatSite[] | null {
  const site = customSiteFrom(label, url, icon)
  if (site === null) return null
  if (current.some(existing => existing.id === site.id)) return null
  const next = [...current, site]
  persistCustomSites(next)
  return next
}

export function removeCustomSite(current: readonly ChatSite[], id: string): ChatSite[] {
  const next = current.filter(site => site.id !== id && siteById(id, current).id !== id)
  persistCustomSites(next)
  return next
}

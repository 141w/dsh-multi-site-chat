import { CHAT_SITES, DEFAULT_SITE_ID, siteById, type ChatSite } from './sites.js'

/**
 * The selected website is plugin-owned presentation state, not a Host
 * preference: keeping it out of the official settings Config avoids
 * re-activating the whole plugin whenever the choice changes. It persists
 * in the client's own origin storage, like any other local UI state.
 */
const STORAGE_KEY = 'dsh-deepseek-chat.site'

export function readStoredSite(): ChatSite {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw !== null && raw !== undefined && CHAT_SITES.some(site => site.id === raw)) return siteById(raw)
  } catch { /* storage unavailable; the default site applies */ }
  return siteById(DEFAULT_SITE_ID)
}

export function writeStoredSite(id: string): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, id) } catch { /* the choice stays for this session only */ }
}

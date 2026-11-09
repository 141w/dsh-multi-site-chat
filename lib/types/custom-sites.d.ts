/**
 * User-added websites. They live in localStorage beside the site preference:
 * the plugin never needs the Host for them, and a corrupt value degrades to
 * "no custom sites" instead of breaking CHAT.
 */
import { type ChatSite } from './sites.js';
export declare const CUSTOM_SITES_KEY = "dsh-deepseek-chat.custom-sites";
export declare function loadCustomSites(): ChatSite[];
export declare function persistCustomSites(sites: readonly ChatSite[]): void;
/** Adds a site, returning the stored list; null when the URL is unusable or taken. */
export declare function addCustomSite(current: readonly ChatSite[], label: string, url: string, icon: string): ChatSite[] | null;
export declare function removeCustomSite(current: readonly ChatSite[], id: string): ChatSite[];

/** The one cookie fact this plugin needs from the owning Electron runtime. */
export interface RuntimeCookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | string;
    expirationDate?: number;
}
export interface RuntimeCookieJar {
    get(filter: Record<string, unknown>): Promise<RuntimeCookie[]>;
    set(details: Record<string, unknown>): Promise<void>;
    remove(url: string, name: string): Promise<void>;
}
export interface RuntimeSession {
    cookies: RuntimeCookieJar;
}
export declare function guestSession(partition: string): RuntimeSession | null;

import test from 'node:test'
import assert from 'node:assert/strict'
import { readStoredSite, writeStoredSite } from '../src/site-preference.js'
import { CHAT_SITES, DEFAULT_SITE_ID } from '../src/sites.js'

function withStorage(run: () => void): void {
  const store = new Map<string, string>()
  const previous = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
  ;(globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  } as unknown as Storage
  try { run() } finally {
    if (previous === undefined) delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
    else (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = previous
  }
}

test('an empty or invalid stored value falls back to the default site', () => {
  withStorage(() => {
    assert.equal(readStoredSite().id, DEFAULT_SITE_ID)
    writeStoredSite('not-a-site')
    assert.equal(readStoredSite().id, DEFAULT_SITE_ID)
  })
})

test('a stored site survives a round trip and is re-read after a change', () => {
  withStorage(() => {
    writeStoredSite('claude')
    assert.equal(readStoredSite().id, 'claude')
    writeStoredSite('gemini')
    assert.equal(readStoredSite().id, 'gemini')
    writeStoredSite('deepseek')
    assert.equal(readStoredSite().id, 'deepseek')
    assert.equal(readStoredSite(), CHAT_SITES[0])
  })
})

test('unavailable storage degrades to the default site instead of throwing', () => {
  const previous = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
  ;(globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') },
  } as unknown as Storage
  try {
    assert.equal(readStoredSite().id, DEFAULT_SITE_ID)
    assert.doesNotThrow(() => { writeStoredSite('claude') })
  } finally {
    if (previous === undefined) delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
    else (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = previous
  }
})

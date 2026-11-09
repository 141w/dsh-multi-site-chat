import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_SITES, DEFAULT_SITE_ID, allSiteHosts, siteById, urlBelongsToSite } from '../src/sites.js'

test('the registry keeps unique https sites whose hosts match their landing URLs', () => {
  const ids = CHAT_SITES.map(site => site.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(ids, ['deepseek', 'chatgpt', 'claude', 'gemini'])
  assert.equal(DEFAULT_SITE_ID, 'deepseek')
  for (const site of CHAT_SITES) {
    const url = new URL(site.url)
    assert.equal(url.protocol, 'https:')
    assert.equal(site.hosts.includes(url.hostname), true, site.id)
    for (const host of site.hosts) assert.equal(allSiteHosts().includes(host), true, host)
  }
})

test('siteById falls back to the default site for unknown or non-string values', () => {
  assert.equal(siteById('claude').id, 'claude')
  assert.equal(siteById('unknown-site').id, DEFAULT_SITE_ID)
  assert.equal(siteById(undefined).id, DEFAULT_SITE_ID)
  assert.equal(siteById(42).id, DEFAULT_SITE_ID)
})

test('the sign-in probe never answers from a cookie every site sets', () => {
  // cf_clearance, __cf_bm and _cfuvid are Cloudflare cookies present on every
  // page of every site, signed in or not; using them as the sign-in proof
  // made all three sites report signed in at once.
  for (const site of CHAT_SITES) {
    for (const name of ['cf_clearance', '__cf_bm', '_cfuvid', '__cflb', '__oailb', 'g_state', '_ga']) {
      assert.ok(!site.authCookies.includes(name), site.id + ' must not probe ' + name)
    }
    assert.ok(site.authCookies.every(name => site.sessionCookies.includes(name)),
      site.id + ' auth cookies must be a subset of its captured cookies')
  }
  assert.deepEqual([...CHAT_SITES.find(site => site.id === 'chatgpt')!.authCookies],
    ['__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1'])
  assert.deepEqual([...CHAT_SITES.find(site => site.id === 'claude')!.authCookies], ['sessionKey', 'sessionKeyLC'])
  assert.ok(CHAT_SITES.find(site => site.id === 'gemini')!.authCookies.includes('__Secure-1PSID'))
})
test('urlBelongsToSite accepts exact registered hosts only', () => {
  const deepseek = siteById('deepseek')
  assert.equal(urlBelongsToSite('https://chat.deepseek.com/a/chat/s/x', deepseek), true)
  assert.equal(urlBelongsToSite('https://chat.deepseek.com', deepseek), true)
  assert.equal(urlBelongsToSite('https://evil-chat.deepseek.com.attacker.net/', deepseek), false)
  assert.equal(urlBelongsToSite('https://chatgpt.com/', deepseek), false)
  assert.equal(urlBelongsToSite('http://chat.deepseek.com/', deepseek), false)
  assert.equal(urlBelongsToSite('not a url', deepseek), false)
  const chatgpt = siteById('chatgpt')
  assert.equal(urlBelongsToSite('https://chat.openai.com/c/abc', chatgpt), true)
  assert.equal(urlBelongsToSite('https://chatgpt.com/', chatgpt), true)
})

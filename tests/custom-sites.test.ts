import test from 'node:test'
import assert from 'node:assert/strict'
import { allSiteHosts, allSites, customSiteFrom, siteById, siteInitialLetter, urlBelongsToSite } from '../src/sites.js'
import { parseSiteCookies } from '../src/site-navigation.js'

test('a custom site is derived from its URL and keeps every pasted cookie', () => {
  const site = customSiteFrom('我的站点', 'https://example.com/path/')
  assert.ok(site !== null)
  assert.equal(site!.id, 'custom-example-com')
  assert.equal(site!.label, '我的站点')
  assert.equal(site!.url, 'https://example.com/path/')
  assert.deepEqual([...site!.hosts], ['example.com'])
  assert.equal(site!.acceptAllCookies, true)
  assert.ok(urlBelongsToSite('https://example.com/path/page', site!))
  assert.ok(!urlBelongsToSite('https://other.com/', site!))
  // No confirmed cookie list exists, so nothing is filtered out.
  const cookies = parseSiteCookies(site!.id, 'anything=1; whatever=2', [site!])
  assert.deepEqual(cookies.map(cookie => cookie.name), ['anything', 'whatever'])
  assert.equal(cookies[0].domain, '.example.com')
})

test('a chosen icon travels with the site and defaults to the letter tile', () => {
  const auto = customSiteFrom('Kimi', 'https://kimi.com/')!
  assert.equal(auto.icon, 'auto')
  const starred = customSiteFrom('Kimi', 'https://kimi.com/', 'star')!
  assert.equal(starred.icon, 'star')
  assert.equal(starred.id, auto.id)
  // The glyph id is a plain string, so an unknown one degrades to the globe.
  assert.equal(customSiteFrom('Kimi', 'https://kimi.com/', 'nonsense')!.icon, 'nonsense')
})
test('the letter tile ignores a leading www.', () => {
  assert.equal(siteInitialLetter('custom-www-kimi-com'), 'K')
  assert.equal(siteInitialLetter('custom-kimi-com'), 'K')
  assert.equal(siteInitialLetter('custom-www-example-com'), 'E')
  // A host that starts with a digit or symbol falls back to W rather than crashing.
  assert.equal(siteInitialLetter('custom-'), 'W')
})
test('a URL that is not https is refused', () => {
  assert.equal(customSiteFrom('x', 'http://example.com/'), null)
  assert.equal(customSiteFrom('x', 'not a url'), null)
  assert.equal(customSiteFrom('', ''), null)
})

test('a custom site joins the registry and the host gates', () => {
  const custom = [customSiteFrom('', 'https://example.org/')!]
  assert.deepEqual(allSites(custom).map(site => site.id), ['deepseek', 'chatgpt', 'claude', 'gemini', 'custom-example-org'])
  assert.equal(siteById('custom-example-org', custom).id, 'custom-example-org')
  // An unknown id still falls back to the default site.
  assert.equal(siteById('custom-nope', custom).id, 'deepseek')
  assert.equal(siteById('deepseek', custom).id, 'deepseek')
  assert.ok(allSiteHosts(custom).includes('example.org'))
  assert.ok(allSiteHosts(custom).includes('chatgpt.com'))
  // Re-adding the same site is idempotent.
  assert.equal(customSiteFrom('other', 'https://example.org/x')!.id, 'custom-example-org')
})

test('a custom site reports no conversation list and stays a native page', async () => {
  const { adaptSiteNavigation } = await import('../src/site-navigation.js')
  const doc = { querySelectorAll: () => [] } as unknown as Document
  assert.equal(adaptSiteNavigation(doc, { pathname: '/' }, 'custom-example-org').status, 'unsupported')
})

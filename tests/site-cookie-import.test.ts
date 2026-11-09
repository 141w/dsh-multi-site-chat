import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSiteCookies, siteCookieWriteScript, siteCookieProbeScript } from '../src/site-navigation.js'

test('a pasted cookie line keeps only the site\u2019s confirmed login cookies', () => {
  const line = '__Secure-next-auth.session-token.0=fictional-a; __Secure-next-auth.session-token.1=fictional-b; oai_consent_marketing=1; cf_clearance=fictional-c; _ga=unrelated; empty=; =novalue'
  const cookies = parseSiteCookies('chatgpt', line)
  assert.deepEqual(cookies.map(cookie => cookie.name), [
    '__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1', 'oai_consent_marketing', 'cf_clearance',
  ])
  assert.equal(cookies[0].value, 'fictional-a')
})

test('a line without any recognised login cookie yields nothing', () => {
  assert.deepEqual(parseSiteCookies('claude', '_ga=1; _gid=2'), [])
  assert.deepEqual(parseSiteCookies('claude', ''), [])
})

test('Chrome DevTools\u2019 TSV copy is accepted with its header row and domains', () => {
  const tsv = [
    'Name\tValue\tDomain\tPath\tExpires / Max-Age\tSize\tHttpOnly\tSecure\tSameSite\tPriority',
    '__Secure-next-auth.session-token.0\tfictional-a\t.chatgpt.com\t/\t2027-01-01T00:00:00.000Z\t120\t\u2713\t\u2713\tNone\tMedium',
    '__Secure-next-auth.session-token.1\tfictional-b\t.chatgpt.com\t/\t2027-01-01T00:00:00.000Z\t900\t\u2713\t\u2713\tNone\tMedium',
    '_ga\tunrelated\t.chatgpt.com\t/\t2027-01-01T00:00:00.000Z\t40\t\t\tLax\tMedium',
  ].join('\n')
  const cookies = parseSiteCookies('chatgpt', tsv)
  assert.deepEqual(cookies.map(cookie => cookie.name), [
    '__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1',
  ])
  assert.equal(cookies[0].domain, '.chatgpt.com')
  assert.equal(cookies[1].value, 'fictional-b')
})

test('a headerless DevTools TSV copy still reads its domain column',
  () => {
    // The shape a user gets from Ctrl+A/Ctrl+C in the DevTools cookie table
    // when the header row is not part of the selection. Values are fictional.
    const tsv = [
      '__cf_bm	fictional-cf	.chatgpt.com	/	2026-11-08T06:20:26.300Z	206	✓	✓	None	https://chatgpt.com		Medium	',
      '__cflb	fictional-cflb	chatgpt.com	/	2026-11-08T06:34:02.936Z	49	✓	✓	None			Medium	',
      '__Host-next-auth.csrf-token	fictional-csrf	chatgpt.com	/	会话	158	✓	✓	Lax			Medium	',
      '__Secure-next-auth.session-token.0	fictional-token-a	.chatgpt.com	/	2027-02-06T05:34:16.853Z	3967	✓	✓	Lax			Medium	',
      '__Secure-next-auth.session-token.1	fictional-token-b	.chatgpt.com	/	2027-02-06T05:34:16.853Z	112	✓	✓	Lax			Medium	',
      '_account	fictional-account	chatgpt.com	/	2027-01-12T09:39:53.885Z	44			Lax			Medium	',
      'cf_clearance	fictional-clear	.chatgpt.com	/	2027-11-08T05:34:17.332Z	387	✓	✓	None	https://chatgpt.com		Medium	',
      '__obi	tracking	.chatgpt.com	/	2027-08-09T13:17:46.718Z	27		✓	None			Medium	',
      '_dd_s_v2	analytics	chatgpt.com	/	2027-11-08T05:51:39.438Z	135		✓	Strict			Medium	',
    ].join('\n')
    const cookies = parseSiteCookies('chatgpt', tsv)
    assert.deepEqual(cookies.map(cookie => cookie.name), [
      '__cf_bm', '__cflb', '__Host-next-auth.csrf-token',
      '__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1',
      '_account', 'cf_clearance',
    ])
    // The host-only __Host- cookie keeps the host; the rest read the domain column.
    assert.equal(cookies[2].domain, 'chatgpt.com')
    assert.equal(cookies[0].domain, '.chatgpt.com')
  })
test('Claude and Gemini accept their own confirmed cookie names', () => {
  const claude = 'sessionKey=fictional-key; lastActiveOrg=fictional-org; sessionKeyLC=fictional-lc; other=junk'
  assert.deepEqual(parseSiteCookies('claude', claude).map(cookie => cookie.name), ['sessionKey', 'lastActiveOrg', 'sessionKeyLC'])
  const gemini = '__Secure-1PSID=fictional-1; __Secure-3PSID=fictional-3; SID=fictional-sid; _ga=unrelated'
  assert.deepEqual(parseSiteCookies('gemini', gemini).map(cookie => cookie.name), ['__Secure-1PSID', '__Secure-3PSID', 'SID'])
})

test('the generated guest scripts are valid JavaScript', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chat-scripts-'))
  const write = siteCookieWriteScript([{ name: 'sessionKey', value: 'fictional', domain: '.claude.ai', path: '/', secure: true, sameSite: 'lax', expires: null }])
  const probe = siteCookieProbeScript(['sessionKey', 'cf_clearance'])
  await writeFileSync(join(dir, 'write.mjs'), write)
  await writeFileSync(join(dir, 'probe.mjs'), probe)
  execFileSync(process.execPath, ['--check', join(dir, 'write.mjs')])
  execFileSync(process.execPath, ['--check', join(dir, 'probe.mjs')])
  assert.match(write, /document\.cookie/)
  assert.match(probe, /document\.cookie/)
})

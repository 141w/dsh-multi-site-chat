import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthorizationAuthority, PROFILE_CONTEXT_UNAVAILABLE, WEBSITE_PROFILE_PREFIX } from '../src/authorization.js'
import type { AuthorizationState } from '../src/protocol.js'
import { DSH_CHAT_DESCRIPTORS, authorizationSchema, clientMetadataSchema, websiteSessionSchema } from '../src/protocol.js'

// The Host authority is profile-scoped and account-free since the 2026-10-11
// product decision: DSH sign-out never disables CHAT, and the website login is
// a separate Client state. These tests pin that contract.
const metadata = { version: '0.2.0-rc.2', locale: 'zh-CN', timezoneOffsetSeconds: 28_800 }

test('a trusted profile scope authorizes immediately with its derived account and no error', () => {
  let epoch = 0
  const auth = new AuthorizationAuthority(`${WEBSITE_PROFILE_PREFIX}scope-a`, () => `epoch-${++epoch}`)
  const snapshot = auth.getSnapshot()
  assert.equal(snapshot.status, 'authorized')
  assert.equal(snapshot.accountId, `${WEBSITE_PROFILE_PREFIX}scope-a`)
  assert.equal(snapshot.epoch, 'epoch-1')
  assert.equal(snapshot.error, null)
})

test('a missing profile context stays authorized on a volatile account and reports the limitation', () => {
  let epoch = 0
  const auth = new AuthorizationAuthority(null, () => `epoch-${++epoch}`)
  const snapshot = auth.getSnapshot()
  assert.equal(snapshot.status, 'authorized')
  assert.ok(snapshot.accountId?.startsWith('chat-volatile:'))
  assert.equal(snapshot.error, PROFILE_CONTEXT_UNAVAILABLE)
  const other = new AuthorizationAuthority(null, () => 'epoch-x')
  assert.notEqual(other.getSnapshot().accountId, snapshot.accountId)
  assert.notEqual(other.getSnapshot().epoch, snapshot.epoch)
})

test('refresh resolves a detached snapshot copy and keeps serving until disposal', async () => {
  const auth = new AuthorizationAuthority(`${WEBSITE_PROFILE_PREFIX}scope-a`, () => 'epoch-1')
  const first = await auth.refresh(metadata)
  assert.deepEqual(first, auth.getSnapshot())
  assert.notStrictEqual(first, auth.getSnapshot())
  auth.dispose()
  await assert.rejects(() => auth.refresh(metadata), /disposed/)
})

test('the stream yields the current state and ends when the authority is disposed or aborted', async () => {
  const auth = new AuthorizationAuthority(`${WEBSITE_PROFILE_PREFIX}scope-a`, () => 'epoch-1')
  const controller = new AbortController()
  const iterator = auth.watch(metadata, controller.signal)[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.done, false)
  assert.equal(first.value?.status, 'authorized')
  auth.dispose()
  assert.equal((await iterator.next()).done, true)
  const aborted = new AuthorizationAuthority(`${WEBSITE_PROFILE_PREFIX}scope-b`, () => 'epoch-1')
  const stop = new AbortController()
  const live = aborted.watch(metadata, stop.signal)[Symbol.asyncIterator]()
  assert.equal((await live.next()).value?.status, 'authorized')
  stop.abort()
  assert.equal((await live.next()).done, true)
})

test('disposal publishes unauthorized with a fresh epoch, clears listeners, and is idempotent', () => {
  let epoch = 0
  const auth = new AuthorizationAuthority(`${WEBSITE_PROFILE_PREFIX}scope-a`, () => `epoch-${++epoch}`)
  const seen: AuthorizationState[] = []
  const unsubscribe = auth.subscribe(() => { seen.push(auth.getSnapshot()) })
  auth.dispose()
  assert.deepEqual(seen.map(item => item.status), ['unauthorized'])
  assert.equal(seen[0].epoch, 'epoch-2')
  assert.equal(seen[0].accountId, null)
  assert.equal(seen[0].error, null)
  assert.equal(auth.getSnapshot().status, 'unauthorized')
  unsubscribe()
  auth.dispose()
  assert.equal(seen.length, 1)
})

test('public descriptors keep authorization credential-free and strictly declare the separate website session seam', () => {
  assert.deepEqual(DSH_CHAT_DESCRIPTORS.map(item => item.method), [
    'authorization', 'watchAuthorization', 'loadWebsiteSession', 'saveWebsiteSession', 'clearWebsiteSession',
    'saveSiteSession', 'loadSiteSession', 'clearSiteSession',
  ])
  for (const descriptor of DSH_CHAT_DESCRIPTORS) {
    assert.ok(descriptor.parameters.every(parameter => parameter.codec.mode === 'strict'))
    assert.equal(descriptor.result?.mode, 'strict')
    assert.deepEqual(descriptor.cancellation, { parameter: 'signal' })
    const expected = descriptor.method === 'saveWebsiteSession' ? ['metadata', 'epoch', 'session']
      : descriptor.method.endsWith('WebsiteSession') ? ['metadata', 'epoch']
      : descriptor.method === 'saveSiteSession' ? ['metadata', 'epoch', 'site', 'cookies']
      : descriptor.method.endsWith('SiteSession') ? ['metadata', 'epoch', 'site'] : ['metadata']
    assert.deepEqual(descriptor.parameters.map(parameter => parameter.name), expected)
  }
  assert.throws(() => clientMetadataSchema.parse({ ...metadata, token: 'fixture-only' }))
  assert.throws(() => authorizationSchema.parse({
    status: 'authorized', accountId: 'account-a', epoch: 'epoch-1', error: null, cookie: 'fixture-only',
  }))
})

test('website session payload permits exactly the three fictional website values', () => {
  const session = {
    token: 'fictional-website-token', userId: 'fictional-website-user',
    deviceId: '00000000-0000-4000-8000-000000000001',
  }
  assert.deepEqual(websiteSessionSchema.parse(session), session)
  for (const extra of ['cookie', 'password', 'origin', 'accountId', 'credentialKey']) {
    assert.throws(() => websiteSessionSchema.parse({ ...session, [extra]: 'fixture-only' }))
  }
  for (const key of ['token', 'userId', 'deviceId'] as const) {
    const missing = { ...session }
    delete (missing as Partial<typeof session>)[key]
    assert.throws(() => websiteSessionSchema.parse(missing))
    assert.throws(() => websiteSessionSchema.parse({ ...session, [key]: '' }))
  }
  assert.throws(() => websiteSessionSchema.parse({ ...session, deviceId: 'not-a-uuid' }))
})
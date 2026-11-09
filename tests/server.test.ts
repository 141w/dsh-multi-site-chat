import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DshChatUIBridge } from '../src/ui.js'
import { WEBSITE_PROFILE_PREFIX } from '../src/authorization.js'
import { WEBSITE_SESSION_ORIGIN } from '../src/protocol.js'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

// Compile only our Service; load the real packages from the project so Cordis,
// its registry, and the Gateway keep their published runtime identities.
const require = createRequire(path.join(process.cwd(), 'package.json'))
const { build } = require('esbuild')
const { Context, Service } = require('@deepseek-ai/cordis')
const { default: TypertRegistry } = require('@deepseek-ai/dsh-typert-registry')
const { default: TypertGateway } = require('@deepseek-ai/dsh-api-gateway')
const metadata = { version: '0.2.0-rc.2', locale: 'zh-CN', timezoneOffsetSeconds: 28_800 }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const fictionalSession = {
  token: 'fictional-website-token', userId: 'fictional-website-user',
  deviceId: '00000000-0000-4000-8000-000000000001',
}


test('published Cordis and Typert Host/Client bind strict methods and withdraw them on disposal', async t => {
  const cache = path.join(process.cwd(), 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  const output = await mkdtemp(path.join(cache, 'dsh-chat-service-test-'))
  const artifact = path.join(output, 'server.mjs')
  t.after(async () => { await rm(output, { recursive: true, force: true }) })
  await build({
    absWorkingDir: process.cwd(), entryPoints: ['src/server.ts'], outfile: artifact,
    bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'es2022',
  })
  const { DshChatController } = await import(pathToFileURL(artifact).href)
  const protocolArtifact = path.join(output, 'protocol.mjs')
  await build({
    absWorkingDir: process.cwd(), entryPoints: ['src/protocol.ts'], outfile: protocolArtifact,
    bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'es2022',
  })
  const { DSH_CHAT_REMOTE_CONTRIBUTION } = await import(pathToFileURL(protocolArtifact).href)
  // Published Client artifacts use DSH's lazyCJS loader. Run the actual
  // published factory with the same shared Cordis module supplied above.
  let ClientGateway: object | undefined
  // The 0.2.2 SDK publishes an ESM node artifact and a lazy-CJS browser artifact.
  // DSH web loads the browser one through __ModuleLoader__; load exactly that.
  const gatewayDir = path.dirname(require.resolve('@deepseek-ai/dsh-api-gateway/package.json'))
  const gatewayExports = require('@deepseek-ai/dsh-api-gateway/package.json').exports as Record<string, { browser?: string; default?: string }>
  const clientEntry = gatewayExports['./client'].browser ?? gatewayExports['./client'].default
  const clientArtifact = await readFile(path.join(gatewayDir, clientEntry), 'utf8')
  new Function('window', clientArtifact)({
    __ModuleLoader__: { load: (contribution: { factory: (load: typeof require) => object }) => {
      ClientGateway = contribution.factory(require)
    } },
  })
  assert.ok(ClientGateway)
  let accountStatus = 'credential-stored'
  let accountId = 'fixture-account'
  const account = {
    getState: async () => ({ status: accountStatus }),
    getProfile: async () => ({ status: 'ready', value: { id: accountId } }),
    async *watch(signal: AbortSignal) {
      yield { status: accountStatus }
      if (!signal.aborted) await new Promise<void>(resolve => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
  }
  const ctx = new Context()
  // Host services the 0.2.2 Gateway declares; the fixture only exercises direct invocation.
  ctx.provide('remoteAccess', { decide: () => ({ kind: 'allow' }) })
  ctx.provide('connection', { rpc: { intercept: () => () => {} } })
  // A trusted launcher profile scopes the plugin's own vault records.
  const profileDir = await mkdtemp(path.join(tmpdir(), 'dsh-chat-profile-'))
  t.after(async () => { await rm(profileDir, { recursive: true, force: true }) })
  ctx.provide('profileContext', { dir: profileDir })
  ctx.provide('deepseekAccount', account)
  // Isolated in-memory records only; this never instantiates a real vault provider.
  type Record = { kind: 'grant'; payload: unknown }
  const officialKey = 'deepseek-account-platform/default'
  const officialRecord: Record = { kind: 'grant', payload: { marker: 'fictional-official-grant' } }
  const records = new Map<string, Record>([[officialKey, officialRecord]])
  const credentialCalls: { method: 'read' | 'modify' | 'delete'; key: string }[] = []
  let failWrite = false
  let failDelete = false
  let modifyGate: { entered: () => void; wait: Promise<void> } | undefined
  ctx.provide('credentials', {
    readRecord: async (key: string) => {
      credentialCalls.push({ method: 'read', key })
      return records.get(key)
    },
    modifyRecord: async (key: string, mutate: (current: Record | undefined) => Promise<Record | undefined>) => {
      credentialCalls.push({ method: 'modify', key })
      const gate = modifyGate; modifyGate = undefined
      if (gate) { gate.entered(); await gate.wait }
      if (failWrite) throw new Error('fictional-vault-write-detail')
      const replacement = await mutate(records.get(key))
      // Match the official seam: undefined is a declined mutation, not deletion.
      if (replacement !== undefined) records.set(key, replacement)
      return records.get(key)
    },
    deleteRecord: async (key: string) => {
      credentialCalls.push({ method: 'delete', key })
      if (failDelete) throw new Error('fictional-vault-delete-detail')
      records.delete(key)
    },
  })
  const registry = ctx.plugin(TypertRegistry)
  await registry
  const gateway = ctx.plugin(TypertGateway)
  await gateway
  // The 0.2.2 Gateway requires every direct caller to name its Peer explicitly.
  const peerController = new AbortController()
  const ownerPeer = {
    id: 'fixture-owner-peer', ctx, principal: { kind: 'owner' } as const,
    signal: peerController.signal, interactions: 'none' as const, dispose: async () => {},
  }
  t.after(() => peerController.abort())
  const controller = ctx.plugin(DshChatController)
  await controller
  let disposed = false
  t.after(async () => {
    if (!disposed) await controller.dispose()
    await gateway.dispose()
    await registry.dispose()
  })
  assert.equal(ctx.typert.local.get('dshDeepseekChat/authorization').parameters[0].codec.mode, 'strict')
  const profileId = `${WEBSITE_PROFILE_PREFIX}${createHash('sha256').update(resolve(profileDir), 'utf8').digest('hex')}`
  const authorized = await ctx.typertGateway.invoke({ namespace: 'dshDeepseekChat', method: 'authorization', args: { metadata }, peer: ownerPeer })
  assert.equal(authorized.status, 'authorized')
  // Since the 2026-10-11 decision the Host gate is profile-scoped and
  // account-free: the DSH account never authorizes, gates or re-epochs CHAT.
  assert.equal(authorized.accountId, profileId)
  assert.ok(authorized.epoch)
  assert.equal('token' in authorized, false)
  ctx.emit('credentials/record-updated', 'fixture-unrelated/default')
  assert.equal(ctx.dshDeepseekChat.authority.getSnapshot().epoch, authorized.epoch)
  ctx.emit('credentials/record-updated', 'deepseek-account-platform/default')
  const replacing = ctx.dshDeepseekChat.authority.getSnapshot()
  assert.equal(replacing.status, 'authorized')
  assert.equal(replacing.accountId, profileId)
  assert.equal(replacing.epoch, authorized.epoch)
  const reauthorized = await ctx.typertGateway.invoke({ namespace: 'dshDeepseekChat', method: 'authorization', args: { metadata }, peer: ownerPeer })
  assert.deepEqual(reauthorized, authorized)

  await assert.rejects(ctx.typertGateway.invoke({
    namespace: 'dshDeepseekChat', method: 'authorization', args: { metadata: { ...metadata, cookie: 'fixture-only' } }, peer: ownerPeer,
  }), (error: { code?: string }) => error.code === 'gateway/input-invalid')
  await assert.rejects(ctx.typertGateway.invoke({
    namespace: 'dshDeepseekChat', method: 'authorization', args: { metadata }, signal: AbortSignal.abort(), peer: ownerPeer,
  }), (error: { code?: string }) => error.code === 'gateway/cancelled')

  const invokeSession = (method: string, epoch: string, session?: object) => ctx.typertGateway.invoke({
    namespace: 'dshDeepseekChat', method, args: { metadata, epoch, ...(session ? { session } : {}) }, peer: ownerPeer,
  })
  // The v2 grant is keyed by the trusted profile scope, never by a DSH account.
  const keyA = credentialKey('dsh-deepseek-chat', `website-${profileId.slice(WEBSITE_PROFILE_PREFIX.length)}`)
  let sessionAuthorization = reauthorized

  await t.test('website grants use only their own account key, strict three-value payload, and official origin', async () => {
    assert.equal(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), null)
    assert.equal(await invokeSession('saveWebsiteSession', sessionAuthorization.epoch, fictionalSession), true)
    const expectedRecord = { kind: 'grant', payload: {
      version: 2, origin: WEBSITE_SESSION_ORIGIN, profileId, websiteAccountId: fictionalSession.userId, session: fictionalSession,
    } }
    assert.deepEqual(records.get(keyA), expectedRecord)
    assert.deepEqual(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), fictionalSession)
    assert.deepEqual(records.get(officialKey), officialRecord)
    for (const extra of ['cookie', 'password', 'origin', 'accountId', 'credentialKey']) {
      await assert.rejects(invokeSession('saveWebsiteSession', sessionAuthorization.epoch, {
        ...fictionalSession, [extra]: 'fixture-only',
      }), (error: { code?: string }) => error.code === 'gateway/input-invalid')
    }
    await assert.rejects(ctx.typertGateway.invoke({ namespace: 'dshDeepseekChat', method: 'clearWebsiteSession', args: {
      metadata, epoch: sessionAuthorization.epoch, accountId: 'fixture-other-account', credentialKey: officialKey,
    }, peer: ownerPeer }), (error: { code?: string }) => error.code === 'gateway/arguments-invalid')
    for (const payload of [
      { ...expectedRecord.payload, origin: 'https://example.invalid' },
      { ...expectedRecord.payload, profileId: `${WEBSITE_PROFILE_PREFIX}${'f'.repeat(64)}` },
      { ...expectedRecord.payload, websiteAccountId: 'fixture-other-website-user' },
      { ...expectedRecord.payload, cookie: 'fixture-only' },
    ]) {
      records.set(keyA, { kind: 'grant', payload })
      assert.equal(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), null)
    }
    records.set(keyA, expectedRecord as Record)
    assert.equal(credentialCalls.every(call => /^dsh-(?:chat|deepseek-chat)\/website-[a-f0-9]{64}$/.test(call.key)), true)
  })

  await t.test('a foreign epoch cannot load, overwrite, or clear the profile-scoped grant', async () => {
    const foreignCalls = credentialCalls.length
    const foreignEpoch = 'fixture-foreign-epoch'
    assert.equal(await invokeSession('loadWebsiteSession', foreignEpoch), null)
    assert.equal(await invokeSession('saveWebsiteSession', foreignEpoch, fictionalSession), false)
    assert.equal(await invokeSession('clearWebsiteSession', foreignEpoch), false)
    assert.equal(credentialCalls.length, foreignCalls)
    const recordA = records.get(keyA)
    assert.deepEqual(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), fictionalSession)
    assert.equal(await invokeSession('clearWebsiteSession', sessionAuthorization.epoch), true)
    // Clearing leaves a durable empty grant so an old account-keyed grant cannot be restored.
    assert.deepEqual(records.get(keyA), { kind: 'grant', payload: {
      version: 2, origin: WEBSITE_SESSION_ORIGIN, profileId, websiteAccountId: null, session: null,
    } })
    assert.deepEqual(records.get(officialKey), officialRecord)
    assert.deepEqual(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), null)
    records.set(keyA, recordA as Record)
  })

  await t.test('a clear fences a write still waiting for the credential lock before its mutation callback', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    modifyGate = { entered: () => entered.resolve(), wait: release.promise }
    const recordBefore = records.get(keyA)
    const epochBefore = sessionAuthorization.epoch
    const saving = invokeSession('saveWebsiteSession', epochBefore, { ...fictionalSession, token: 'fictional-stale-write-token' })
    await entered.promise
    // Clearing closes the Host write barrier; the queued save must observe the
    // new revision inside its mutation callback and decline. The barrier is
    // armed after the clear's own fence resolves, so yield one macrotask first.
    const clearing = invokeSession('clearWebsiteSession', epochBefore)
    await new Promise(resolve => { setTimeout(resolve, 10) })
    release.resolve()
    assert.equal(await saving, false)
    assert.equal(await clearing, true)
    assert.deepEqual(records.get(keyA), { kind: 'grant', payload: {
      version: 2, origin: WEBSITE_SESSION_ORIGIN, profileId, websiteAccountId: null, session: null,
    } })
    assert.deepEqual(recordBefore, { kind: 'grant', payload: {
      version: 2, origin: WEBSITE_SESSION_ORIGIN, profileId, websiteAccountId: fictionalSession.userId, session: fictionalSession,
    } })
    assert.deepEqual(records.get(officialKey), officialRecord)
    assert.deepEqual(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), null)
  })

  await t.test('provider write and clear failures keep the grant and expose only fixed gateway errors', async () => {
    // Clearing writes a durable empty grant through the same modify seam as saving.
    assert.equal(await invokeSession('saveWebsiteSession', sessionAuthorization.epoch, fictionalSession), true)
    const retained = records.get(keyA)
    failWrite = true
    await assert.rejects(invokeSession('saveWebsiteSession', sessionAuthorization.epoch, {
      ...fictionalSession, token: 'fictional-rejected-write-token',
    }), (error: { code?: string; message?: string }) => error.code === 'gateway/internal'
      && !String(error.message).includes('fictional-vault-write-detail'))
    assert.deepEqual(records.get(keyA), retained)
    await assert.rejects(invokeSession('clearWebsiteSession', sessionAuthorization.epoch),
      (error: { code?: string; message?: string }) => error.code === 'gateway/internal'
        && !String(error.message).includes('fictional-vault-write-detail'))
    failWrite = false
    assert.deepEqual(records.get(keyA), retained)
    assert.deepEqual(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), fictionalSession)
    assert.equal(await invokeSession('clearWebsiteSession', sessionAuthorization.epoch), true)
    assert.equal(await invokeSession('loadWebsiteSession', sessionAuthorization.epoch), null)
    assert.deepEqual(records.get(officialKey), officialRecord)
    assert.equal(credentialCalls.every(call => /^dsh-(?:chat|deepseek-chat)\/website-[a-f0-9]{64}$/.test(call.key)), true)
  })

  // Only the Connection carrier is a local fixture: the Client Remote, its
  // registry, namespace mounting, cancellation, and Host dispatch are real.
  const clientCtx = new Context()
  let carrierStopped = false
  let carrierCalls = 0
  clientCtx.provide('connection', {
    start: () => ({ stop: () => { carrierStopped = true } }),
    registerGenerationSource: () => () => {},
    rpc: {
      call: async (_path: string, endpoint: string, payload: { args: object }, signal: AbortSignal) => {
        carrierCalls++
        const [namespace, method] = endpoint.split('/')
        const value = await ctx.typertGateway.invoke({ namespace, method, args: payload.args, signal, peer: ownerPeer })
        return { ok: true, value }
      },
      async *open(_path: string, endpoint: string, payload: { args: object }, signal: AbortSignal) {
        const [namespace, method] = endpoint.split('/')
        yield* await ctx.typertGateway.stream({ namespace, method, args: payload.args, signal, peer: ownerPeer })
      },
    },
  })
  const clientRegistry = clientCtx.plugin(TypertRegistry)
  await clientRegistry
  const clientGateway = clientCtx.plugin(ClientGateway)
  await clientGateway
  t.after(async () => { await clientGateway.dispose(); await clientRegistry.dispose() })
  const unmountClient = await clientCtx.remote.$mount(DSH_CHAT_REMOTE_CONTRIBUTION)
  t.after(unmountClient)
  const clientAuthorization = await clientCtx.remote.dshDeepseekChat.authorization(metadata)
  assert.equal(clientAuthorization.ok, true)
  assert.equal(clientAuthorization.value.accountId, authorized.accountId)
  assert.deepEqual(await clientCtx.remote.dshDeepseekChat.loadWebsiteSession(metadata, clientAuthorization.value.epoch), { ok: true, value: null })
  assert.deepEqual(await clientCtx.remote.dshDeepseekChat.saveWebsiteSession(metadata, clientAuthorization.value.epoch, fictionalSession), { ok: true, value: true })
  assert.deepEqual(await clientCtx.remote.dshDeepseekChat.clearWebsiteSession(metadata, clientAuthorization.value.epoch), { ok: true, value: true })
  const capturedSessionMethod = clientCtx.remote.dshDeepseekChat.loadWebsiteSession
  // A root Context bypasses plugin dependency enforcement. Keep the failing
  // shape covered explicitly so the integration cannot accidentally miss it.
  const missingDependency = clientCtx.plugin({
    name: 'fixture-missing-namespace-dependency', inject: ['remote'],
    apply: (child: typeof clientCtx) => child.remote.dshDeepseekChat.authorization(metadata),
  })
  await assert.rejects(Promise.resolve(missingDependency), /remote\.dshDeepseekChat.*without inject/)
  await missingDependency.dispose()
  const capturedMethod = clientCtx.remote.dshDeepseekChat.authorization
  const clientStream = clientCtx.remote.dshDeepseekChat.watchAuthorization(metadata)
  const clientIterator = clientStream[Symbol.asyncIterator]()
  assert.equal((await clientIterator.next()).value.status, 'authorized')

  const abort = new AbortController()
  const stream = await ctx.typertGateway.stream({
    namespace: 'dshDeepseekChat', method: 'watchAuthorization', args: { metadata }, signal: abort.signal, peer: ownerPeer,
  })
  const iterator = stream[Symbol.asyncIterator]()
  const opening = await iterator.next()
  assert.equal(opening.value.status, 'authorized')
  // The 2026-10-11 decision: DSH sign-out never gates CHAT, so neither stream
  // publishes a new state and the Host gate keeps its profile scope and epoch.
  accountStatus = 'signed-out'
  ctx.emit('deepseek-account/signed-out')
  const afterSignOut = ctx.dshDeepseekChat.authority.getSnapshot()
  assert.equal(afterSignOut.status, 'authorized')
  assert.equal(afterSignOut.accountId, profileId)
  assert.equal(afterSignOut.epoch, authorized.epoch)
  clientStream.dispose()
  await clientIterator.return?.()
  abort.abort()
  await iterator.return?.()

  await unmountClient()
  assert.equal(clientCtx.get('remote.dshDeepseekChat'), undefined)
  const callsBeforeWithdrawal = carrierCalls
  assert.equal((await capturedMethod(metadata)).ok, false)
  assert.equal((await capturedSessionMethod(metadata, clientAuthorization.value.epoch)).ok, false)
  assert.equal(carrierCalls, callsBeforeWithdrawal)

  // Exercise the production Client as an actual plugin, including dynamic
  // namespace injection. Only Slot presentation/layout and the carrier are fixtures.
  const productionArtifact = path.join(output, 'client.mjs')
  await build({
    absWorkingDir: process.cwd(), entryPoints: ['src/client.ts'], outfile: productionArtifact,
    bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'es2022',
    plugins: [{ name: 'presentation-fixtures', setup(plugin: any) {
      plugin.onResolve({ filter: /^\.\/(?:ui|web-surface)\.js$/ }, (args: { importer: string; path: string }) => {
        if (path.resolve(args.importer) === path.join(process.cwd(), 'src/client.ts')) return { path: args.path, namespace: 'fixture' }
      })
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args: { path: string }) => ({
        contents: args.path === './ui.js'
          ? 'export const DshChatBrandName=()=>null, DshChatBrandControl=()=>null, DshChatChatNavigation=()=>null, DshChatChatPanel=()=>null, DshChatSettingsIcon=()=>null, DshChatLeadingControls=()=>null, DshChatChatSettings=()=>null, guardHarnessSearchReplay=()=>null;'
          : 'export const DshChatWebSurface=()=>null;', loader: 'js',
      }))
      // The 0.2.2 SDK expects host-provided modules (clsx, shiki, ...); keep the
      // visual primitives inert like every other fixture in this repository.
      plugin.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'sdk-inert' }))
      plugin.onLoad({ filter: /.*/, namespace: 'sdk-inert' }, () => ({
        contents: 'export const Button=()=>null, Input=()=>null, Menu=()=>null, Modal=()=>null, Tooltip=()=>null, BrandWordmark=()=>null,' +
          'IconSearchOutlineRegular=()=>null, IconCloseFillRegular=()=>null, IconNewChatOutlineRegular=()=>null, IconPanelLeftOutlineRegular=()=>null,' +
          'IconRefreshOutlineRegular=()=>null, IconLoadingOutlineRegular=()=>null, IconEllipsisOutlineRegular=()=>null, IconEditOutlineRegular=()=>null,' +
          'IconPinOutlineRegular=()=>null, IconShareOutlineRegular=()=>null, IconTrashOutlineRegular=()=>null, IconChevronDownOutlineRegular=()=>null;', loader: 'js',
      }))
    } }],
  })
  const clientPlugin = await import(pathToFileURL(productionArtifact).href)
  const product = globalThis as typeof globalThis & { dshDesktop?: unknown }
  const priorDesktop = product.dshDesktop
  const priorAdd = globalThis.addEventListener
  const priorRemove = globalThis.removeEventListener
  product.dshDesktop = { protocolVersion: 1, browser: { acquire: () => {}, release: () => {}, onOpenRequested: () => {} } }
  globalThis.addEventListener = () => {}
  globalThis.removeEventListener = () => {}
  t.after(() => {
    if (priorDesktop === undefined) delete product.dshDesktop
    else product.dshDesktop = priorDesktop
    globalThis.addEventListener = priorAdd
    globalThis.removeEventListener = priorRemove
  })
  let bridge!: DshChatUIBridge
  let panel: string | null = 'plugins'
  const panelListeners = new Set<() => void>()
  const slotKeys = new Set<string>()
  const slotListeners = new Map<string, Set<() => void>>()
  const notifySlots = (name: string) => { for (const listener of slotListeners.get(name) ?? []) listener() }
  class FixtureSlots extends Service {
    constructor(context: typeof clientCtx) { super(context, 'slots') }
    inject(_name: string, callback: () => unknown) { return this.ctx.effect(callback) }
    register(options: { name: string; key?: string; id?: string; inject: () => { bridge: DshChatUIBridge } }) {
      const key = `${options.name}:${options.key ?? options.id ?? ''}`
      slotKeys.add(key)
      if (options.name === 'main') bridge = options.inject().bridge
      notifySlots(options.name)
      return this.ctx.effect(() => () => { slotKeys.delete(key); notifySlots(options.name) })
    }
    entries(name: string) {
      return [...slotKeys].filter(key => key.startsWith(`${name}:`)).map(key => ({ name, key }))
    }
    subscribe(name: string, listener: () => void) {
      const listeners = slotListeners.get(name) ?? new Set<() => void>()
      slotListeners.set(name, listeners); listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
  const fixtureSlots = clientCtx.plugin(FixtureSlots)
  await fixtureSlots
  t.after(() => fixtureSlots.dispose())
  clientCtx.provide('layout', {
    panelInfo: { getSnapshot: () => ({ activePanelId: panel }), subscribe: (listener: () => void) => {
      panelListeners.add(listener); return () => { panelListeners.delete(listener) }
    } },
    selectPanel: (next: string | null) => { panel = next; for (const listener of panelListeners) listener() },
    toggleSidebar: () => {},
  })
  const production = clientCtx.plugin(clientPlugin)
  t.after(() => production.dispose())
  await production
  const until = async (predicate: () => boolean) => {
    for (let index = 0; index < 100; index++) {
      if (predicate()) return
      await new Promise<void>(resolve => { setImmediate(resolve) })
    }
    assert.fail('production Client state did not settle')
  }
  // The Host gate is profile-scoped since the 2026-10-11 decision: the DSH
  // account never authorizes or disables CHAT, so the production Client settles
  // authorized with the desktop capability as its only entry condition.
  await until(() => bridge.getSnapshot().authorizationStatus === 'authorized')
  assert.equal(bridge.getSnapshot().modeEnabled, true)
  assert.equal(bridge.getSnapshot().mode, 'harness')
  assert.equal(bridge.getSnapshot().error, null)
  bridge.selectMode('chat')
  await until(() => bridge.getSnapshot().mode === 'chat')
  accountStatus = 'signed-out'
  ctx.emit('deepseek-account/signed-out')
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.equal(bridge.getSnapshot().authorizationStatus, 'authorized')
  assert.equal(bridge.getSnapshot().modeEnabled, true)
  assert.equal(bridge.getSnapshot().mode, 'chat')
  assert.equal(panel, 'dsh-deepseek-chat.chat')
  await production.dispose()
  assert.equal(slotKeys.size, 0)
  assert.equal(clientCtx.get('remote.dshDeepseekChat'), undefined)
  await clientGateway.dispose()
  assert.equal(carrierStopped, true)

  // Site login memory: its methods are reachable through the gateway. Placed
  // after the nested grant tests so this read cannot disturb their records.
  for (const method of ['loadSiteSession']) {
    const result = await ctx.typertGateway.invoke({
      namespace: 'dshDeepseekChat', method,
      args: { metadata, epoch: authorized.epoch, site: 'chatgpt' }, peer: ownerPeer,
    })
    // The gateway unwraps a fulfilled RemoteResult to its value; with no
    // stored grant a load answers null.
    assert.equal(result, null, method + ' must be callable and answer null')
  }

  await controller.dispose()
  disposed = true
  for (const method of ['authorization', 'watchAuthorization', 'loadWebsiteSession', 'saveWebsiteSession', 'clearWebsiteSession']) {
    assert.equal(ctx.typert.local.get(`dshDeepseekChat/${method}`), undefined)
  }
  await assert.rejects(ctx.typertGateway.invoke({
    namespace: 'dshDeepseekChat', method: 'authorization', args: { metadata }, peer: ownerPeer,
  }), (error: { code?: string }) => error.code === 'gateway/definition-unavailable')
})

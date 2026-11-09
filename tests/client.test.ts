
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client.js'
import type { DshChatUIBridge } from '../src/ui.js'
import type { AuthorizationState, WebsiteSession } from '../src/protocol.js'
import { CHAT_PANEL } from '../src/core/mode.js'

const authorized = (id = 'A', epoch = 'grant-a'): AuthorizationState => ({ status: 'authorized', accountId: id, epoch, error: null })
const signedOut = (): AuthorizationState => ({ status: 'unauthorized', accountId: null, epoch: 'closed', error: null })
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
type SessionResult<T> = { ok: true; value: T } | { ok: false; error: { code: string } }
const fictionalSession: WebsiteSession = {
  token: 'fictional-website-token', userId: 'fictional-website-user',
  deviceId: '00000000-0000-4000-8000-000000000001',
}
const readyNavigation = { status: 'ready' as const, authenticated: true, accountName: 'Fictional fixture', conversations: [], selectedHref: null, canCreate: true, error: null }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

/** Cordis nested-effect and declared-Slot fixtures; no native guest or webpage runs. */
function harness(originalPanel: string | null = 'plugins', failMount = false, saved?: Record<string, string>) {
  type Dispose = () => void | Promise<void>
  const rootEffects: Dispose[] = []
  let collector = rootEffects
  const setup: Promise<unknown>[] = []
  const order: string[] = []
  const registrations = new Map<string, { name: string; inject: () => { bridge: DshChatUIBridge } }>()
  const slotListeners = new Map<string, Set<() => void>>()
  const panelListeners = new Set<() => void>()
  let panel = originalPanel
  const requests: ReturnType<typeof deferred<{ ok: true; value: AuthorizationState }>>[] = []
  const sessionCalls: { method: 'load' | 'save' | 'clear'; epoch: string; signal: AbortSignal; session?: WebsiteSession }[] = []
  const sessionReplies: {
    load: (signal: AbortSignal) => Promise<SessionResult<WebsiteSession | null>>
    save: (signal: AbortSignal) => Promise<SessionResult<boolean>>
    clear: (signal: AbortSignal) => Promise<SessionResult<boolean>>
  } = {
    load: async () => ({ ok: true, value: null }),
    save: async () => ({ ok: true, value: true }),
    clear: async () => ({ ok: true, value: true }),
  }
  type Item = { value: AuthorizationState; signal: AbortSignal; accept: () => void }
  const queue: Item[] = []
  let waiting: ((result: IteratorResult<Item>) => void) | undefined
  let ended = false
  const stream = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Item>> {
          if (queue.length) return Promise.resolve({ done: false, value: queue.shift()! })
          if (ended) return Promise.resolve({ done: true, value: undefined })
          return new Promise(resolve => { waiting = resolve })
        },
      }
    },
    async dispose() {
      ended = true
      waiting?.({ done: true, value: undefined }); waiting = undefined
      order.push('stream:dispose')
    },
  }
  const effect = (callback: () => unknown): Dispose => {
    const parent = collector
    const children: Dispose[] = []
    collector = children
    let result: unknown
    try { result = callback() } finally { collector = parent }
    const collect = (value: unknown) => {
      if (typeof value === 'function') children.push(value as Dispose)
      else if (value && typeof value === 'object' && Symbol.iterator in value) {
        children.push(...value as Iterable<Dispose>)
      }
    }
    if (result && typeof result === 'object' && 'then' in result) {
      const task = Promise.resolve(result).then(collect)
      setup.push(task)
      void task.catch(() => {}) // Cordis also observes failed effect setup before callers retry.
    }
    else collect(result)
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      for (const cleanup of [...children].reverse()) await cleanup()
    }
    parent.push(dispose)
    return Object.assign(dispose, {
      then: (fulfilled: (cleanup: Dispose) => unknown, rejected: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(() => fulfilled(() => dispose()), rejected),
    })
  }
  const prefListeners=new Set<()=>void>();const writes: [string,string][]=[]
  let formStatus:'ready'|'unavailable'='ready'
  const form={getSnapshot:()=>({status:formStatus,writable:formStatus==='ready',value:saved}),subscribe:(fn:()=>void)=>{prefListeners.add(fn);return()=>prefListeners.delete(fn)},set:async(key:string,value:string)=>{writes.push([key,value]);saved={...saved!,[key]:value};for(const fn of prefListeners)fn();return true}}
  const ctx = {
    configForms:{get:(ns:string)=>{assert.equal(ns,'deepseek-chat');return form}},
    effect,
    // The upstream download feature injects the public file-actions service; the
    // stub reports that saving is unavailable so no export path is exercised.
    fileActions: { canSaveAs: false, save: async () => ({ status: 'rejected' }) },
    inject: (dependencies: string[], callback: (ctx: unknown) => unknown) => {
      assert.deepEqual(dependencies, dependencies[0]==='configForms' ? ['configForms']
        : dependencies[0]==='fileActions' ? ['fileActions'] : ['remote', 'remote.dshDeepseekChat'])
      if(dependencies[0]==='configForms' && !saved) return {dispose:async()=>{},then:(fulfilled:()=>unknown)=>Promise.resolve().then(fulfilled)}
      const dispose = effect(() => callback(ctx))
      return { dispose, then: (fulfilled: () => unknown) => Promise.resolve().then(fulfilled) }
    },
    slots: {
      inject: (_name: string, callback: () => unknown) => effect(callback),
      register: (options: { name: string; key?: string; id?: string; inject: () => { bridge: DshChatUIBridge } }) => {
        const key = `${options.name}:${options.key ?? options.id ?? ''}`
        registrations.set(key, options)
        for (const listener of slotListeners.get(options.name) ?? []) listener()
        return effect(() => () => {
          registrations.delete(key); order.push(`unregister:${key}`)
          for (const listener of slotListeners.get(options.name) ?? []) listener()
        })
      },
      entries: (name: string) => [...registrations.values()].filter(entry => entry.name === name),
      subscribe: (name: string, listener: () => void) => {
        const listeners = slotListeners.get(name) ?? new Set<() => void>()
        slotListeners.set(name, listeners); listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId: panel }),
        subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener) } },
      },
      selectPanel: (next: string | null) => { panel = next; order.push(`panel:${next}`); for (const listener of panelListeners) listener() },
      toggleSidebar: () => {},
    },
    remote: {
      $mount: async () => {
        order.push('remote:mount')
        if (failMount) { failMount = false; throw new Error('fixture mount failure') }
        return () => { order.push('remote:unmount') }
      },
      $stream: () => stream,
      dshDeepseekChat: {
        authorization: () => { const value = deferred<{ ok: true; value: AuthorizationState }>(); requests.push(value); return value.promise },
        loadWebsiteSession: (metadata: object, epoch: string, signal: AbortSignal) => {
          assert.deepEqual(metadata, { version: '0.2.0-rc.2', locale: globalThis.navigator?.language ?? 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 })
          sessionCalls.push({ method: 'load', epoch, signal }); order.push('session:load')
          return sessionReplies.load(signal)
        },
        saveWebsiteSession: (_metadata: object, epoch: string, session: WebsiteSession, signal: AbortSignal) => {
          sessionCalls.push({ method: 'save', epoch, session, signal }); order.push('session:save')
          return sessionReplies.save(signal)
        },
        clearWebsiteSession: (_metadata: object, epoch: string, signal: AbortSignal) => {
          sessionCalls.push({ method: 'clear', epoch, signal }); order.push('session:clear')
          return sessionReplies.clear(signal)
        },
      },
    },
  }
  const storedSites: string[] = []
  const siteStorage = {
    getItem: (key: string) => (key === 'dsh-deepseek-chat.site' && storedSites.length ? storedSites[storedSites.length - 1] : null),
    setItem: (_key: string, value: string) => { storedSites.push(value) },
  }
  const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage
  ;(globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = siteStorage
  const product = globalThis as typeof globalThis & { dshDesktop?: unknown }
  const previousDesktop = product.dshDesktop
  const previousAdd = globalThis.addEventListener
  const previousRemove = globalThis.removeEventListener
  product.dshDesktop = { protocolVersion: 1, browser: { acquire: async () => ({ lease: 'unused', partition: 'unused' }), release: async () => {}, onOpenRequested: () => () => {} } }
  globalThis.addEventListener = () => {}
  globalThis.removeEventListener = () => {}
  apply(ctx as unknown as Context)
  const bridge = registrations.get(`main:${CHAT_PANEL}`)!.inject().bridge
  let cleaned = false
  return {
    bridge, order, requests, writes, sessionCalls, sessionReplies, panel: () => panel, registrations: () => [...registrations.keys()], storedSites,
    formUnavailable: () => { formStatus = 'unavailable'; for (const fn of prefListeners) fn() },
    async ready() { await flush(); await Promise.all(setup); await flush() },
    emit(value: AuthorizationState, aborted = false) {
      const controller = new AbortController()
      if (aborted) controller.abort()
      const item = { value, signal: controller.signal, accept: () => { order.push('stream:accept') } }
      if (waiting) { const consume = waiting; waiting = undefined; consume({ done: false, value: item }) }
      else queue.push(item)
    },
    navigate: (next: string | null) => ctx.layout.selectPanel(next),
    async dispose() {
      if (cleaned) return
      cleaned = true
      try { for (const cleanup of [...rootEffects].reverse()) await cleanup() }
      finally {
        if (previousDesktop === undefined) delete product.dshDesktop
        else product.dshDesktop = previousDesktop
        globalThis.addEventListener = previousAdd
        globalThis.removeEventListener = previousRemove
        if (previousLocalStorage === undefined) delete (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage
        else (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage
      }
    },
  }
}

test('Chat swaps navigation and collapsed chrome, then restores both native seats', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ok:true,value:authorized()}); await flush()
    h.bridge.selectMode('chat'); await flush()
    assert(h.registrations().includes('sidebar.workspaces:'))
    assert(!h.registrations().includes('sidebar:'))
    assert(h.registrations().includes('shell.leading:'))
    assert(!h.registrations().includes('sidebar.settings:'))
    h.bridge.selectMode('harness'); await flush()
    assert(!h.registrations().includes('sidebar.workspaces:'))
    assert(!h.registrations().includes('shell.leading:'))
    assert(h.registrations().includes('sidebar.brand.name:'))
    assert.equal(h.panel(),'plugins')
  } finally { await h.dispose() }
})

test('adding a website publishes it so the switcher and settings can see it', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    h.bridge.selectMode('chat'); await flush()
    // The storage stub starts empty, so nothing is published yet.
    assert.deepEqual(h.bridge.getSnapshot().customSites, [])
    assert.equal(h.bridge.addCustomSite('Kimi', 'https://kimi.com/'), true)
    const published = h.bridge.getSnapshot().customSites ?? []
    assert.equal(published.length, 1)
    assert.equal(published[0].id, 'custom-kimi-com')
    assert.equal(published[0].label, 'Kimi')
    assert.equal(published[0].url, 'https://kimi.com/')
    // A duplicate or a non-https URL is refused and changes nothing.
    assert.equal(h.bridge.addCustomSite('Kimi again', 'https://kimi.com/'), false)
    assert.equal(h.bridge.addCustomSite('bad', 'http://kimi.com/'), false)
    assert.equal((h.bridge.getSnapshot().customSites ?? []).length, 1)
    h.bridge.removeCustomSite('custom-kimi-com')
    assert.equal((h.bridge.getSnapshot().customSites ?? []).length, 0)
  } finally { await h.dispose() }
})
test('a transient empty report keeps the last known conversation list', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    h.bridge.selectMode('chat'); await flush()
    const generation = h.bridge.getSnapshot().authorizationGeneration
    const href = '/c/fixture-conversation'
      h.bridge.reportWebsiteNavigation(generation, { status: 'ready', authenticated: true, conversations: [{ href, title: 'Fixture A', group: '对话' }], selectedHref: href, canCreate: true, error: null })
      // The site's own sidebar was collapsed: its links leave the document.
      h.bridge.reportWebsiteNavigation(generation, { status: 'unsupported', conversations: [], selectedHref: null, canCreate: false, error: null })
      const kept = h.bridge.getSnapshot().websiteNavigation
      assert.equal(kept.status, 'ready')
      assert.deepEqual(kept.conversations.map(item => item.href), [href])
      // The reload that follows a conversation click is a fresh document:
      // within the same site the list still survives it.
      h.bridge.reportWebsiteNavigation(generation, { status: 'unsupported', conversations: [], selectedHref: null, canCreate: false, error: null }, true)
      assert.equal(h.bridge.getSnapshot().websiteNavigation.status, 'ready')
      assert.deepEqual(h.bridge.getSnapshot().websiteNavigation.conversations.map(item => item.href), [href])
      // A sign-in report still clears it.
      h.bridge.reportWebsiteNavigation(generation, { status: 'sign-in', conversations: [], selectedHref: null, canCreate: false, error: null })
      assert.equal(h.bridge.getSnapshot().websiteNavigation.conversations.length, 0)
    } finally { await h.dispose() }
})

test('website list and action binding are invalidated at account change and late guest replies are ignored', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ok:true,value:authorized()}); await flush()
    h.bridge.selectMode('chat'); await flush()
    const generation = h.bridge.getSnapshot().authorizationGeneration
    const href = 'https://chat.deepseek.com/a/chat/s/fixture-a'
    h.bridge.reportWebsiteNavigation(generation, {status:'ready',authenticated:true,accountName:'Fictional fixture',conversations:[{href,title:'Fixture A',group:'置顶'}],selectedHref:href,canCreate:true,error:null})
    let called = 0
    h.bridge.bindWebsiteNavigation(generation, async () => { called++ })
    h.bridge.commandWebsite({type:'open',href:'https://example.com/'}); await flush()
    assert.equal(called,0)
    h.bridge.commandWebsite({type:'open',href}); await flush()
    assert.equal(called,1)
    h.bridge.toggleWebsiteNavigation()
    assert.equal(h.bridge.getSnapshot().showWebsiteNavigation,true)
    h.emit(authorized('B','grant-b')); await flush()
    assert.equal(h.bridge.getSnapshot().websiteNavigation.conversations.length,0)
    h.bridge.reportWebsiteNavigation(generation,{status:'ready',authenticated:true,accountName:'Fictional fixture',conversations:[{href,title:'stale',group:'置顶'}]})
    h.bridge.commandWebsite({type:'new'}); await flush()
    // The stale generation cannot open conversations or create a new one.
    assert.equal(called,1)
    assert.equal(h.bridge.getSnapshot().websiteNavigation.conversations.length,0)
  } finally { await h.dispose() }
})

test('a late valid HTTP snapshot cannot re-authorize after a stream sign-out', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    h.bridge.refreshAuthorization(); await flush()
    const stale = h.requests[1]
    h.emit(signedOut()); await flush()
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'unauthorized')
    stale.resolve({ ok: true, value: authorized() }); await flush()
    // The late reply belongs to a replaced generation and must not re-authorize.
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'unauthorized')
    assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    assert.equal(h.bridge.getSnapshot().mode, 'harness')
    assert.equal(h.panel(), 'plugins')
  } finally { await h.dispose() }
})

test('direct main entry enters CHAT under the compatibility-only gate; aborted stream items are ignored', async () => {
  const h = harness('settings')
  try {
    await h.ready()
    h.navigate(CHAT_PANEL)
    assert.equal(h.panel(), CHAT_PANEL)
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
    h.emit(authorized(), true); await flush()
    assert.equal(h.order.includes('stream:accept'), false)
  } finally { await h.dispose() }
})

test('Client unload restores Harness before removing its main key and disposes remote observation', async () => {
  const h = harness('plugins')
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    h.bridge.selectMode('chat'); await flush()
    assert.equal(h.panel(), CHAT_PANEL)
    h.emit(authorized()); await flush()
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
    await h.dispose()
    assert.equal(h.panel(), 'plugins')
    const restore = h.order.lastIndexOf('panel:plugins')
    const removeMain = h.order.indexOf(`unregister:main:${CHAT_PANEL}`)
    assert(restore >= 0 && restore < removeMain)
    assert(h.order.includes('stream:dispose'))
    assert(h.order.includes('remote:unmount'))
  } finally { await h.dispose() }
})

test('an account change while in Chat keeps the mode and only retires the predecessor work', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    h.bridge.selectMode('chat'); await flush()
    h.emit(authorized('B', 'grant-b')); await flush()
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
    assert.equal(h.bridge.getSnapshot().accountStorageKey, 'dsh-deepseek-chat:website:B')
    assert.equal(h.panel(), CHAT_PANEL)
  } finally { await h.dispose() }
})

test('initial remote failure stays visible, keeps Harness, and can be retried', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].reject(new Error('fixture connection failure')); await flush()
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'unavailable')
    assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    assert.match(h.bridge.getSnapshot().error!, /无法连接/)
    h.bridge.refreshAuthorization(); await flush()
    h.requests[1].resolve({ ok: true, value: authorized() }); await flush()
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'authorized')
    assert.equal(h.bridge.getSnapshot().mode, 'harness')
    assert.equal(h.bridge.getSnapshot().error, null)
  } finally { await h.dispose() }
})

test('failed namespace setup is visible and retry mounts a working consumer', async () => {
  const h = harness('plugins', true)
  try {
    // Failed async setup is already handled by the Client's refresh routine.
    await flush()
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'unavailable')
    assert.equal(h.requests.length, 0)
    h.bridge.refreshAuthorization(); await flush()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    assert.equal(h.order.filter(value => value === 'remote:mount').length, 2)
  } finally { await h.dispose() }
})

test('a stalled initial check times out and its late result cannot reopen the gate', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  try {
    await h.ready()
    t.mock.timers.tick(35_000); await flush()
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'unavailable')
    assert.match(h.bridge.getSnapshot().error!, /超时/)
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    h.bridge.refreshAuthorization(); await flush()
    h.requests[1].resolve({ ok: true, value: authorized() }); await flush()
    assert.equal(h.bridge.getSnapshot().authorizationStatus, 'authorized')
  } finally { await h.dispose(); t.mock.timers.reset() }
})

test('a transport failure preserves a confirmed account and the selected Chat mode', async () => {
  const h = harness()
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    h.bridge.selectMode('chat'); await flush()
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
    h.bridge.refreshAuthorization(); await flush()
    h.requests[1].reject(new Error('fixture offline')); await flush()
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
    assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    assert.match(h.bridge.getSnapshot().error!, /无法连接/)
  } finally { await h.dispose() }
})

 test('switch preferences restore from the Host form and persist confirmed edits',async()=>{
  const h=harness('plugins',false,{switchStyle:'text',chatLabel:'CHAT',harnessLabel:'CODE'})
  try {
    await h.ready()
    assert.equal(h.bridge.getSnapshot().switchPreferencesStatus,'ready')
    assert.deepEqual(h.bridge.getSnapshot().switchPreferences,{switchStyle:'text',chatLabel:'CHAT',harnessLabel:'CODE'})
    assert.deepEqual(h.writes,[])
    assert.equal(await h.bridge.setSwitchPreference!('harnessLabel','工作区'),true)
    assert.deepEqual(h.writes,[['harnessLabel','工作区']])
    assert.deepEqual(h.bridge.getSnapshot().switchPreferences,{switchStyle:'text',chatLabel:'CHAT',harnessLabel:'工作区'})
    assert.equal(h.bridge.getSnapshot().switchPreferencesError,null)
    assert.equal(h.bridge.getSnapshot().switchPreferencesPending,false)
    // A withdrawn settings service surfaces a retryable error instead of a silent drop.
    h.formUnavailable!()
    assert.equal(h.bridge.getSnapshot().switchPreferencesStatus,'unavailable')
    assert.equal(await h.bridge.setSwitchPreference!('chatLabel','CHAT'),false)
    assert.deepEqual(h.writes,[['harnessLabel','工作区']])
  }finally{await h.dispose()}
 })
 test('explicit current website logout clears the vault first and keeps Chat available',async()=>{
  const h=harness()
  try {
    await h.ready();h.requests[0].resolve({ok:true,value:authorized()});await flush()
    h.bridge.selectMode('chat'); await flush()
    const generation=h.bridge.getSnapshot().authorizationGeneration;const commands:unknown[]=[]
    h.bridge.bindWebsiteNavigation(generation,async c=>{commands.push(c);h.order.push(`website:${c.type}`)})
    h.bridge.reportWebsiteNavigation(generation,readyNavigation)
    console.error('DBG after report', JSON.stringify({auth:h.bridge.getSnapshot().websiteAuthenticationStatus,nav:h.bridge.getSnapshot().websiteNavigation.status,navAuth:h.bridge.getSnapshot().websiteNavigation.authenticated,gen:h.bridge.getSnapshot().authorizationGeneration,captured:generation}))
    h.bridge.logoutWebsite();await flush();console.error('DBG logout state', JSON.stringify({status:h.bridge.getSnapshot().websiteSessionStatus,error:h.bridge.getSnapshot().websiteSessionError,auth:h.bridge.getSnapshot().websiteAuthenticationStatus,commands,sessionCalls:h.sessionCalls.map(c=>c.method)}))
    assert.deepEqual(h.sessionCalls.map(call=>({method:call.method,epoch:call.epoch})),[{method:'clear',epoch:'grant-a'}])
    assert(h.order.indexOf('session:clear')<h.order.indexOf('website:logout'))
    h.bridge.reportWebsiteNavigation(generation,{status:'sign-in',conversations:[],selectedHref:null,canCreate:false,error:null})
    assert.equal(h.bridge.getSnapshot().mode,'chat');assert.equal(h.bridge.getSnapshot().modeEnabled,true)
    h.bridge.selectMode('chat');await flush();assert.equal(h.bridge.getSnapshot().mode,'chat')
    h.bridge.reportWebsiteNavigation(generation,{status:'ready',conversations:[],selectedHref:null,canCreate:true,error:null})
    assert.equal(h.bridge.getSnapshot().modeEnabled,true)
  }finally{await h.dispose()}
 })

 test('an observed website sign-out after ready keeps the selected mode across an intervening load',async()=>{
  const h=harness()
  try{
    await h.ready();h.requests[0].resolve({ok:true,value:authorized()});await flush()
    h.bridge.selectMode('chat'); await flush()
    const generation=h.bridge.getSnapshot().authorizationGeneration
    for(const status of ['ready','loading','sign-in'] as const) h.bridge.reportWebsiteNavigation(generation,{status,conversations:[],selectedHref:null,canCreate:status==='ready',error:null})
    assert.equal(h.bridge.getSnapshot().mode,'chat');assert.equal(h.bridge.getSnapshot().modeEnabled,true)
  }finally{await h.dispose()}
 })


async function enterChat(h: ReturnType<typeof harness>) {
  await h.ready()
  h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
  h.bridge.selectMode('chat'); await flush()
  const generation = h.bridge.getSnapshot().authorizationGeneration
  h.bridge.reportWebsiteNavigation(generation, readyNavigation)
  return generation
}

test('website save success stays internal while rejected writes never report saved', async () => {
  const h = harness()
  try {
    const generation = await enterChat(h)
    assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), true)
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'saved')
    h.sessionReplies.load = async () => ({ ok: true, value: fictionalSession })
    assert.deepEqual(await h.bridge.loadWebsiteSession(generation), fictionalSession)
    const serialized = JSON.stringify(h.bridge.getSnapshot())
    for (const value of Object.values(fictionalSession)) assert.equal(serialized.includes(value), false)
    h.sessionReplies.save = async () => { throw new Error(`fictional provider detail ${fictionalSession.token}`) }
    assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), false)
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'error')
    assert.equal(JSON.stringify(h.bridge.getSnapshot()).includes(fictionalSession.token), false)
    h.sessionReplies.save = async () => ({ ok: true, value: false })
    assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), false)
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'error')
    assert.equal(h.sessionCalls.every(call => call.epoch === 'grant-a'), true)
  } finally { await h.dispose() }
})

test('explicit logout waits for an in-flight save, blocks recovery, then clears before website logout', async () => {
  const h = harness()
  try {
    const generation = await enterChat(h)
    const saving = deferred<SessionResult<boolean>>()
    h.sessionReplies.save = () => saving.promise
    const saved = h.bridge.saveWebsiteSession(generation, fictionalSession)
    await flush()
    const commands: unknown[] = []
    h.bridge.bindWebsiteNavigation(generation, async command => { commands.push(command); h.order.push(`website:${command.type}`) })
    h.bridge.logoutWebsite(); await flush()
    assert.deepEqual(h.sessionCalls.map(call => call.method), ['save'])
    assert.equal(await h.bridge.loadWebsiteSession(generation), null)
    assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), false)
    assert.equal(commands.length, 0)
    saving.resolve({ ok: true, value: true })
    assert.equal(await saved, false)
    await flush(); await flush()
    assert.deepEqual(h.sessionCalls.map(call => call.method), ['save', 'clear'])
    assert.deepEqual(commands, [{ type: 'logout' }])
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'idle')
    assert(h.order.indexOf('session:clear') < h.order.indexOf('website:logout'))
    h.bridge.reportWebsiteNavigation(generation, { ...readyNavigation, status: 'sign-in', canCreate: false })
    assert.equal(await h.bridge.loadWebsiteSession(generation), null)
    assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), false)
    // Website sign-out keeps the selected mode; only the session is gone.
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
  } finally { await h.dispose() }
})

for (const failure of ['refused', 'rejected'] as const) {
  test(`website logout does not proceed when clearing saved login is ${failure}, and can retry`, async () => {
    const h = harness()
    try {
      const generation = await enterChat(h)
      assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), true)
      const commands: unknown[] = []
      h.bridge.bindWebsiteNavigation(generation, async command => { commands.push(command) })
      h.sessionReplies.clear = failure === 'refused'
        ? async () => ({ ok: true, value: false })
        : async () => { throw new Error(`fictional delete failure ${fictionalSession.token}`) }
      h.bridge.logoutWebsite(); await flush(); await flush()
      assert.equal(commands.length, 0)
      assert.equal(h.bridge.getSnapshot().mode, 'chat')
      assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'error')
      assert.match(h.bridge.getSnapshot().websiteSessionError!, /无法清除/)
      assert.equal(JSON.stringify(h.bridge.getSnapshot()).includes(fictionalSession.token), false)
      const calls = h.sessionCalls.length
      assert.equal(await h.bridge.loadWebsiteSession(generation), null)
      assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), false)
      assert.equal(h.sessionCalls.length, calls)
      h.sessionReplies.clear = async () => ({ ok: true, value: true })
      h.bridge.logoutWebsite(); await flush(); await flush()
      assert.deepEqual(commands, [{ type: 'logout' }])
      h.bridge.reportWebsiteNavigation(generation, { ...readyNavigation, status: 'sign-in', canCreate: false })
      assert.equal(h.bridge.getSnapshot().modeEnabled, true)
    } finally { await h.dispose() }
  })
}

for (const replacement of [authorized('B', 'grant-b'), authorized('A', 'grant-a-renewed')]) {
  test(`late session load and save are fenced when authorization changes to ${replacement.accountId}/${replacement.epoch}`, async () => {
    const h = harness()
    try {
      const generation = await enterChat(h)
      const loading = deferred<SessionResult<WebsiteSession | null>>()
      const saving = deferred<SessionResult<boolean>>()
      h.sessionReplies.load = () => loading.promise
      h.sessionReplies.save = () => saving.promise
      const loaded = h.bridge.loadWebsiteSession(generation)
      const saved = h.bridge.saveWebsiteSession(generation, fictionalSession)
      await flush()
      h.emit(replacement); await flush()
      const currentGeneration = h.bridge.getSnapshot().authorizationGeneration
      assert.notEqual(currentGeneration, generation)
      loading.resolve({ ok: true, value: fictionalSession })
      saving.resolve({ ok: true, value: true })
      assert.equal(await loaded, null)
      assert.equal(await saved, false)
      assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'idle')
      h.bridge.reportWebsiteSessionError(generation, 'stale fixture error')
      assert.equal(h.bridge.getSnapshot().websiteSessionError, null)
      const calls = h.sessionCalls.length
      assert.equal(await h.bridge.loadWebsiteSession(generation), null)
      assert.equal(await h.bridge.saveWebsiteSession(generation, fictionalSession), false)
      assert.equal(await h.bridge.clearWebsiteSession(generation), false)
      assert.equal(h.sessionCalls.length, calls)
      h.sessionReplies.load = async () => ({ ok: true, value: null })
      assert.equal(await h.bridge.loadWebsiteSession(currentGeneration), null)
      assert.equal(h.sessionCalls.at(-1)?.epoch, replacement.epoch)
    } finally { await h.dispose() }
  })
}

test('a timed-out website save aborts its request and a late success never reports saved', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  try {
    const generation = await enterChat(h)
    const delayed = deferred<SessionResult<boolean>>()
    h.sessionReplies.save = () => delayed.promise
    const saved = h.bridge.saveWebsiteSession(generation, fictionalSession)
    await flush()
    const signal = h.sessionCalls.at(-1)!.signal
    assert.equal(signal.aborted, false)
    t.mock.timers.tick(12_000); await flush()
    assert.equal(await saved, false)
    assert.equal(signal.aborted, true)
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'error')
    delayed.resolve({ ok: true, value: true }); await flush()
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'error')
    assert.equal(JSON.stringify(h.bridge.getSnapshot()).includes(fictionalSession.token), false)
  } finally { await h.dispose(); t.mock.timers.reset() }
})

test('selecting another site resets per-site observation, persists the choice, and keeps Harness', async () => {
  const h = harness('plugins', false, {})
  try {
    await h.ready()
    h.requests[0].resolve({ ok: true, value: authorized() }); await flush()
    h.bridge.selectMode('chat'); await flush()
    const generation = h.bridge.getSnapshot().authorizationGeneration
    h.bridge.reportWebsiteNavigation(generation, readyNavigation)
    assert.equal(h.bridge.getSnapshot().site, 'deepseek')
    h.bridge.selectSite('claude'); await flush()
    assert.equal(h.bridge.getSnapshot().site, 'claude')
    assert.equal(h.storedSites.at(-1), 'claude')
    assert.deepEqual(h.writes, [])
    // Every DeepSeek-only observation is reset for the new document.
    assert.equal(h.bridge.getSnapshot().websiteNavigation.status, 'loading')
    assert.equal(h.bridge.getSnapshot().websiteNavigation.authenticated, false)
    assert.equal(h.bridge.getSnapshot().webLoading, true)
    assert.equal(h.bridge.getSnapshot().websiteSessionStatus, 'idle')
    assert.equal(h.bridge.getSnapshot().mode, 'chat')
    // The surface gates its own polls by the selected site, so the previous
    // document cannot republish; only a fresh document reports again.
    // Re-selecting the current site or an unknown id changes nothing.
    const writes = h.writes.length
    h.bridge.selectSite('claude')
    h.bridge.selectSite('not-a-site')
    assert.equal(h.writes.length, writes)
    assert.equal(h.bridge.getSnapshot().site, 'claude')
  } finally { await h.dispose() }
})
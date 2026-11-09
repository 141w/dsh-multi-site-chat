import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_PANEL, ModeController } from '../src/core/mode.js'
import type { ModeAuthorization } from '../src/core/mode.js'

const authorized = (id = 'A', epoch = 'grant-a'): ModeAuthorization => ({
  status: 'authorized', accountId: id, epoch, error: null,
})

function harness(original: string | null = 'plugins', compatible = true) {
  let panel = original
  let mounted = 0
  let controller: ModeController
  const order: string[] = []
  controller = new ModeController({
    readPanel: () => panel,
    selectPanel: next => { panel = next; order.push(`panel:${next}`); controller.observePanel(next) },
    mountChatNavigation: () => { mounted++; order.push('mount'); return () => { mounted--; order.push('unmount') } },
    cancelAccount: id => { order.push(`cancel:${id}`) },
  }, compatible)
  return { controller, order, panel: () => panel, mounted: () => mounted,
    navigate: (next: string | null) => { panel = next; controller.observePanel(next) } }
}

test('compatibility gate only: pending authorization never blocks CHAT, missing Desktop always does', () => {
  // The 2026-10-11 product decision decoupled CHAT from the DSH account gate:
  // only plugin compatibility (desktop browser capability) controls entry.
  const h = harness()
  assert.equal(h.controller.getSnapshot().authorization.status, 'pending')
  assert.equal(h.controller.select('chat'), true)
  assert.equal(h.mounted(), 1)
  assert.equal(h.panel(), CHAT_PANEL)
  h.navigate(CHAT_PANEL)
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  const web = harness(null, false)
  web.controller.updateAuthorization(authorized())
  assert.equal(web.controller.select('chat'), false)
  web.navigate(CHAT_PANEL)
  assert.equal(web.panel(), null)
  assert.equal(web.mounted(), 0)
})

test('valid refresh keeps chosen mode and one original panel; manual exit restores before unmount', () => {
  const h = harness('plugins')
  h.controller.updateAuthorization(authorized())
  assert.equal(h.controller.getSnapshot().mode, 'harness')
  assert.equal(h.controller.select('chat'), true)
  h.controller.updateAuthorization(authorized())
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  assert.equal(h.mounted(), 1)
  h.controller.select('harness')
  assert.equal(h.panel(), 'plugins')
  assert.deepEqual(h.order.slice(-2), ['panel:plugins', 'unmount'])
})

test('authorization transitions never gate or force the mode; only a replaced account cancels its predecessor', () => {
  // Website sign-out and grant replacement no longer disable the switcher or
  // force HARNESS; they only retire the previous account's in-flight work.
  const h = harness(null)
  h.controller.updateAuthorization(authorized())
  h.controller.select('chat')
  h.controller.updateAuthorization({ status: 'unauthorized', accountId: null, epoch: 'closed', error: null })
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  assert.equal(h.controller.canEnter(), true)
  assert.equal(h.mounted(), 1)
  assert.ok(h.order.includes('cancel:A'))
  h.controller.updateAuthorization(authorized('A', 'grant-new'))
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  h.controller.updateAuthorization(authorized('B', 'grant-b'))
  assert.ok(h.order.includes('cancel:A'))
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  h.controller.select('harness')
  assert.equal(h.panel(), null)
})

test('network refresh error preserves official valid identity; disposal restores null and blocks later entry', () => {
  const h = harness(null)
  h.controller.updateAuthorization(authorized())
  h.controller.select('chat')
  h.controller.updateAuthorization({ ...authorized(), error: 'network' })
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  h.controller.dispose()
  assert.equal(h.panel(), null)
  assert.equal(h.mounted(), 0)
  assert.equal(h.controller.select('chat'), false)
})

test('an authorized direct main navigation captures previous panel instead of restoring its own Chat key', () => {
  const h = harness('settings')
  h.controller.updateAuthorization(authorized())
  h.navigate(CHAT_PANEL)
  assert.equal(h.controller.getSnapshot().mode, 'chat')
  h.controller.select('harness')
  assert.equal(h.panel(), 'settings')
})

test('DSH navigation owns its new panel and removes Chat overrides without rewriting Session state', () => {
  const h = harness('plugins')
  h.controller.updateAuthorization(authorized())
  h.controller.select('chat')
  h.navigate(null)
  assert.equal(h.controller.getSnapshot().mode, 'harness')
  assert.equal(h.panel(), null)
  assert.equal(h.mounted(), 0)
})

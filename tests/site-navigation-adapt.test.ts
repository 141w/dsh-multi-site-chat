import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptSiteNavigation } from '../src/site-navigation.js'

/** A stand-in anchor: the attribute and the property can disagree. */
function anchor(attribute: string | null, property: string, text: string, label?: string) {
  return {
    getAttribute: (name: string) => (name === 'href' ? attribute : name === 'aria-label' ? (label ?? null) : null),
    href: property,
    textContent: text,
  }
}
const asDoc = (links: ReturnType<typeof anchor>[]) => ({ querySelectorAll: () => links }) as unknown as Document

test('Gemini links behind an account index are recognised', () => {
  const doc = asDoc([
    anchor('/u/1/app/abc123', 'https://gemini.google.com/u/1/app/abc123', '第一个对话'),
    anchor(null, 'https://gemini.google.com/u/1/app/def456', '第二个对话'),
    anchor('/images', 'https://gemini.google.com/images', '图片'),
  ])
  const navigation = adaptSiteNavigation(doc, { pathname: '/u/1/app/abc123' }, 'gemini')
  assert.equal(navigation.status, 'ready')
  assert.equal(navigation.authenticated, true)
  assert.deepEqual(navigation.conversations.map(item => item.href), ['/u/1/app/abc123', '/u/1/app/def456'])
  assert.deepEqual(navigation.conversations.map(item => item.title), ['第一个对话', '第二个对话'])
  assert.equal(navigation.selectedHref, '/u/1/app/abc123')
})

test('a page without conversation links reports unsupported', () => {
  const doc = asDoc([anchor('/images', 'https://gemini.google.com/images', '图片')])
  assert.equal(adaptSiteNavigation(doc, { pathname: '/app' }, 'gemini').status, 'unsupported')
  assert.equal(adaptSiteNavigation(asDoc([]), { pathname: '/app' }, 'gemini').status, 'unsupported')
})

test('ChatGPT and Claude keep their plain root-relative links', () => {
  const chatgpt = adaptSiteNavigation(asDoc([
    anchor('/c/6aabd35d-11fc', 'https://chatgpt.com/c/6aabd35d-11fc', '问候交流'),
    anchor('/c/6aabd35d-22fd', 'https://chatgpt.com/c/6aabd35d-22fd', '图片证据查找'),
  ]), { pathname: '/c/6aabd35d-11fc' }, 'chatgpt')
  assert.deepEqual(chatgpt.conversations.map(item => item.href), ['/c/6aabd35d-11fc', '/c/6aabd35d-22fd'])
  assert.equal(chatgpt.selectedHref, '/c/6aabd35d-11fc')
  const claude = adaptSiteNavigation(asDoc([
    anchor('/chat/2d759360-7e3e', 'https://claude.ai/chat/2d759360-7e3e', '浏览器 UI 重构'),
  ]), { pathname: '/new' }, 'claude')
  assert.deepEqual(claude.conversations.map(item => item.href), ['/chat/2d759360-7e3e'])
  assert.equal(claude.selectedHref, null)
})

test('an unknown site is unsupported', () => {
  assert.equal(adaptSiteNavigation(asDoc([]), { pathname: '/' }, 'unknown').status, 'unsupported')
})

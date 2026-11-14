/** User-approved rc.2 sidebar exception. No services, Session state or credentials. */
export interface SidebarAdapterState {
  readonly chat: boolean
  readonly canCreate: boolean
}

/** Client-owned lifetime survives the brand seat unmounting on sidebar collapse. */
export function createSidebarBinding(read: () => SidebarAdapterState, create: () => void, report: (ready: boolean) => void) {
  let adapter: ReturnType<typeof attachSidebarAdapter> = null
  let owner: HTMLElement | null = null
  return {
    attach(name: HTMLElement) {
      if (owner === name && adapter?.valid()) { adapter.sync(); return }
      adapter?.dispose()
      owner = name
      adapter = attachSidebarAdapter(name, read, create)
      report(adapter !== null)
    },
    sync() { adapter?.sync() },
    dispose() { adapter?.dispose(); adapter = null; owner = null },
  }
}

/** Start at our own brand seat and require the shipped, direct-child shell shape.
 * Unknown layouts are left alone; no global search or hashed CSS selectors. */
export function attachSidebarAdapter(
  name: HTMLElement,
  read: () => SidebarAdapterState,
  create: () => void,
): { sync(): void; valid(): boolean; dispose(): void } | null {
  // Walk up from our own brand seat to the addressable identity row. rc.1 kept
  // data-slot on the outlet; rc.2/rc.3 dropped it, so the stable markers are
  // the identity row (aria-hidden, exactly two children: mark plus our name)
  // and, above it, the draggable brand row.
  const outlet = name.parentElement as HTMLElement
  let identity: Element | null = null
  let node: Element | null = outlet
  for (let depth = 0; node !== null && depth < 4; depth++) {
    if (node.getAttribute('aria-hidden') === 'true' && node.children.length === 2) { identity = node; break }
    node = node.parentElement
  }
  const brand = identity?.parentElement ?? null
  const row = brand?.parentElement ?? null
  const root = row?.parentElement ?? null
  if (identity === null || brand === null || row === null || root === null
    || !row.hasAttribute('data-window-drag') || identity.children.length !== 2) return null
  // Our seat must stay inside that identity row, whatever wrappers sit between.
  const anchorValid = () => name.isConnected && outlet !== null
    && identity.contains(name) && identity.getAttribute("aria-hidden") === "true"
    && identity.children.length === 2 && row.hasAttribute("data-window-drag")
    && brand.parentElement === row && row.parentElement === root
  const controls = (): { button: HTMLButtonElement | null; navs: Element[] } | null => {
    if (!anchorValid()) return null
    const next = row.nextElementSibling, children = Array.from(root.children)
    const buttons = children.filter(element => element.tagName === 'BUTTON')
    const navs = children.filter(element => element.tagName === 'NAV')
    // rc.2/0.2.1 and permitted 0.2.2: one direct new-session control after the row.
    if (next?.tagName === 'BUTTON' && buttons.length === 1 && buttons[0] === next) return { button: next as HTMLButtonElement, navs }
    // 0.2.2 session/create denial removes that button AND makes the brand a SPAN.
    // Prove its labelled NAV and immediately following workspace region locally;
    // zero buttons alone is not evidence that an arbitrary shell is supported.
    // 0.2.2-rc.3: the new-session control moved one level deeper — the row's next
    // sibling is a plain DIV wrapping a data-slot=sidebar.session.action container
    // that holds the single button; the global panel NAV is its next sibling's
    // descendant. Prove both locally before touching anything.
    const actionHost = next?.tagName === 'DIV' ? next : null
    const actionSlot = actionHost?.querySelector('[data-slot="sidebar.session.action"]')
    const actionButton = actionSlot?.querySelector('button')
    const panelNav = actionHost?.nextElementSibling?.querySelector('nav[aria-label]')
    if (actionHost !== null && actionSlot !== null && actionSlot !== undefined
      && actionButton !== null && actionButton !== undefined
      && actionHost.tagName === 'DIV' && actionSlot.parentElement === actionHost
      && actionButton.parentElement === actionSlot
      && panelNav !== null && panelNav !== undefined
      && root.contains(panelNav) && navs.length === 0
      && (panelNav.getAttribute('aria-label') || '').trim().length > 0) {
      // rc.3 keeps the NAV below the root's direct children, so the panel to hide
      // is the one we proved, not the (empty) direct-child list.
      return { button: actionButton as HTMLButtonElement, navs: [panelNav] }
    }
    if (brand.tagName !== 'SPAN' || buttons.length !== 0 || next?.tagName !== 'NAV'
      || navs.length !== 1 || !next.getAttribute('aria-label')?.trim()) return null
    const regions = children.filter(element => Array.from(element.children).some(child => child.getAttribute('data-slot') === 'sidebar.workspaces'))
    const region = regions[0]
    if (regions.length !== 1 || region.tagName !== 'DIV' || region !== next.nextElementSibling
      || Array.from(region.children).filter(child => child.getAttribute('data-slot') === 'sidebar.workspaces').length !== 1) return null
    return { button: null, navs }
  }
  if (!controls()) return null

  const originalAttributes = new Map<Element, Map<string, string | null>>()
  const mark = (element: Element, key: string, value: string) => {
    let originals = originalAttributes.get(element)
    if (!originals) { originals = new Map(); originalAttributes.set(element, originals) }
    if (!originals.has(key)) originals.set(key, element.getAttribute(key))
    if (element.getAttribute(key) !== value) element.setAttribute(key, value)
  }
  const restore = (element: Element) => {
    for (const [key, value] of originalAttributes.get(element) ?? []) {
      if (value === null) element.removeAttribute(key)
      else element.setAttribute(key, value)
    }
    originalAttributes.delete(element)
  }
  const restoreAll = () => { for (const element of originalAttributes.keys()) restore(element) }
  let disposed = false, newButton: HTMLButtonElement | null = null, originallyDisabled = false
  let navigation = new Set<Element>()
  const bindButton = (next: HTMLButtonElement | null) => {
    if (newButton === next) return
    if (newButton) { newButton.disabled = originallyDisabled; restore(newButton) }
    newButton = next
    if (next) { originallyDisabled = next.disabled; mark(next, 'data-dsh-chat-new-session', 'true') }
  }
  const intercept = (event: Event) => {
    const state = read()
    if (disposed || !state.chat || !anchorValid() || !(event.target instanceof Node)) return
    const current = controls()
    const brandClick = brand.tagName === 'BUTTON' && brand.contains(event.target)
    const buttonClick = current?.button?.contains(event.target)
    if (!brandClick && !buttonClick) return
    // Delegate only inside our proven root so a freshly replaced button is safe
    // even before MutationObserver runs. Never redirect another shell control.
    event.preventDefault(); event.stopImmediatePropagation()
    if (current && state.canCreate) create()
  }
  root.addEventListener('click', intercept, true)
  const sync = () => {
    if (disposed) return
    const current = controls()
    if (!current) { bindButton(null); restoreAll(); navigation.clear(); return }
    const state = read()
    bindButton(current.button)
    mark(brand, 'data-dsh-chat-brand-fill', 'brand')
    mark(identity, 'data-dsh-chat-brand-fill', 'identity')
    mark(name.parentElement?.parentElement ?? name, 'data-dsh-chat-brand-fill', 'name')
    mark(root, 'data-dsh-chat-sidebar-mode', state.chat ? 'chat' : 'harness')
    if (newButton) newButton.disabled = state.chat ? !state.canCreate : originallyDisabled
    const nextNavigation = new Set(current.navs)
    for (const nav of navigation) if (!nextNavigation.has(nav)) restore(nav)
    for (const nav of nextNavigation) mark(nav, 'data-dsh-chat-panel-region', 'true')
    navigation = nextNavigation
  }
  const observer = new MutationObserver(sync)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'aria-label', 'data-window-drag', 'data-slot'] })
  sync()
  return {
    sync,
    valid: () => !disposed && controls() !== null,
    dispose() {
      if (disposed) return
      disposed = true; observer.disconnect(); root.removeEventListener('click', intercept, true)
      bindButton(null); restoreAll(); navigation.clear()
    },
  }
}

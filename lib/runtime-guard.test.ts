import { describe, expect, it, vi } from 'vitest'
import { hasBlockedBrowserCapability, hasStaticallyUnboundedLoop, instrumentJavaScript } from '@/lib/runtime-guard'

describe('preview runtime guard', () => {
  it.each([
    'while (true) {}',
    'while(1){work()}',
    'for (;;) {}',
  ])('recognizes statically unbounded loop: %s', (source) => {
    expect(hasStaticallyUnboundedLoop(source)).toBe(true)
  })

  it.each([
    'while (ready) {}',
    'for (let index = 0; index < 2; index += 1) {}',
    'const message = "while (truthy)"',
  ])('does not reject bounded or unrelated source: %s', (source) => {
    expect(hasStaticallyUnboundedLoop(source)).toBe(false)
  })

  it.each([
    'fetch("/secret")',
    'window.open("https://example.com")',
    'globalThis[method]("/secret")',
    'location.href = "/escape"',
    'window.location.assign("/escape")',
    'const { location } = window',
    'const { href } = location',
    'navigation.navigate("/escape")',
    'navigator.sendBeacon("/collect", "data")',
    'document.write("<p>unsafe</p>")',
    'node.innerHTML = userInput',
    'document.createElement("script")',
    'document.createElementNS("urn:test", `SCRIPT`)',
    'import("./dynamic.js")',
    'new Function("return 1")',
    'Reflect.construct(Function, ["return 1"])',
    'Object.defineProperty(window, "location", {})',
    'Reflect.get(window, "location")',
    'Object.getOwnPropertyDescriptor(window, "location")',
    'window.__lookupGetter__("location")',
    'const R = Reflect; R.get(window, "navigation")',
    'const w = window; w.fetch("/secret")',
    'function use(value) { return value } use(location)',
    'const { get } = Reflect; get(window, "location")',
    'const get = Reflect.get.bind(Reflect); get(window, "location")',
    'Reflect.get.call(Reflect, window, "location")',
    'Reflect.get.apply(Reflect, [window, "location"])',
    'Object.getOwnPropertyDescriptors(window)',
    'Object.prototype.__lookupGetter__.call(window, "location")',
    'const key = getKey(); Reflect[key](window, "location")',
    'const key = getKey(); window[key]',
    'const { navigation } = document',
    'const alias = globalThis.window; alias.location',
    'const proto = Object.getPrototypeOf(window); proto.location',
    'function inspect({ get }) { get(window, "location") } inspect(Reflect)',
    'const inspect = ({ location }) => location; inspect(window)',
    'element.insertAdjacentHTML("beforeend", markup)',
    'range.createContextualFragment(markup)',
    'document.writeln(markup)',
    'new XMLHttpRequest()',
    'new Worker("worker.js")',
    'new WebSocket("ws://example.com")',
  ])('blocks preview escape capability: %s', (source) => {
    expect(hasBlockedBrowserCapability(source)).toBe(true)
  })

  it.each([
    'const total = [1, 2, 3].reduce((sum, item) => sum + item, 0)',
    'document.createElement("section")',
    'element.textContent = "safe"',
    'const href = "https://example.com"',
    'const data = { location: "office" }',
    'Object.keys({ safe: true })',
    'function render(value) { return `<p>${value}</p>` }',
    'const broken = (',
    'document.createElement(tagName)',
  ])('allows inert application logic: %s', (source) => {
    expect(hasBlockedBrowserCapability(source)).toBe(false)
  })

  it('instruments every loop and function body shape with collision-resistant names', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((values) => {
      const output = values as Uint32Array
      output[0] = 1
      output[1] = 2
      return values
    })
    const source = [
      'function declared() { return 1 }',
      'const expression = function () { return 2 }',
      'const blockArrow = () => { return 3 }',
      'const conciseArrow = () => 4',
      'while (ready) tick()',
      'do tick(); while (ready)',
      'for (let i = 0; i < 1; i += 1) tick()',
      'for (const key in object) tick(key)',
      'for (const value of values) { tick(value) }',
    ].join('\n')

    const output = instrumentJavaScript(source)

    expect(output).toContain('/* lotus-runtime-guard */')
    expect(output).toContain('__lotusGuard_12')
    expect(output.match(/__lotusGuard_12\(\)/g)?.length).toBeGreaterThanOrEqual(10)
  })

  it('returns source unchanged when there is nothing to instrument', () => {
    const source = 'const answer = 42'
    expect(instrumentJavaScript(source)).toBe(source)
  })
})

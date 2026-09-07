import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const reactStub = `data:text/javascript,${encodeURIComponent(`
  export const updates = []
  export const useCallback = callback => callback
  export const useRef = current => ({ current })
  export const useState = initial => [initial, value => updates.push(value)]
`)}`
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react' && context.parentURL?.endsWith('/ui/panelDrag.ts')) {
      return { url: reactStub, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
let usePanelDrag
try {
  ;({ usePanelDrag } = await import('../src/ui/panelDrag.ts'))
} finally {
  hooks.deregister()
}
const { updates } = await import(reactStub)

for (const endEvent of ['pointerup', 'pointercancel']) {
  test(`${endEvent} ends panel dragging`, (t) => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const target = new EventTarget()
    globalThis.window = target
    updates.length = 0
    t.after(() => {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
    })

    const { headerProps } = usePanelDrag()
    headerProps.onPointerDown({
      target: { closest: () => null },
      button: 0, clientX: 10, clientY: 20, preventDefault() {},
    })
    const move = () => target.dispatchEvent(Object.assign(new Event('pointermove'), {
      clientX: 25, clientY: 45,
    }))
    move()
    assert.deepEqual(updates, [{ x: 15, y: 25 }])
    target.dispatchEvent(new Event(endEvent))
    move()
    assert.equal(updates.length, 1, 'movement after the drag ends must be ignored')
  })
}

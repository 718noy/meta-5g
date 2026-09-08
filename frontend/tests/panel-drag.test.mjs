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
      pointerId: 1, button: 0, clientX: 10, clientY: 20, preventDefault() {},
    })
    const move = () => target.dispatchEvent(Object.assign(new Event('pointermove'), {
      pointerId: 1, clientX: 25, clientY: 45,
    }))
    move()
    assert.deepEqual(updates, [{ x: 15, y: 25 }])
    target.dispatchEvent(Object.assign(new Event(endEvent), { pointerId: 1 }))
    move()
    assert.equal(updates.length, 1, 'movement after the drag ends must be ignored')
  })

  test(`another pointer cannot move or end the active drag via ${endEvent}`, (t) => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const target = new EventTarget()
    globalThis.window = target
    updates.length = 0
    t.after(() => {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
    })
    const { headerProps } = usePanelDrag()
    const down = (pointerId, clientX) => headerProps.onPointerDown({
      target: { closest: () => null },
      pointerId, button: 0, clientX, clientY: 20, preventDefault() {},
    })
    const dispatch = (type, pointerId) => target.dispatchEvent(Object.assign(new Event(type), {
      pointerId, clientX: 25, clientY: 45,
    }))
    down(1, 10)
    down(2, 100)
    dispatch('pointermove', 2)
    assert.deepEqual(updates, [], 'a second pointer must not take over the drag')
    dispatch(endEvent, 2)
    dispatch('pointermove', 1)
    assert.deepEqual(updates, [{ x: 15, y: 25 }], 'the original pointer must remain active')
    dispatch(endEvent, 1)
    dispatch('pointermove', 1)
    assert.equal(updates.length, 1, 'the original pointer must still end its own drag')
  })
}

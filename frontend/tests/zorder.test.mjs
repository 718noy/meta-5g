import assert from 'node:assert/strict'
import test from 'node:test'

const { frontRef } = await import('../src/ui/zorder.ts')

test('frontRef raises a panel without attaching duplicate handlers', () => {
  const listeners = []
  const panel = {
    style: {},
    addEventListener: (type, listener) => listeners.push({ type, listener }),
  }

  frontRef(panel)
  const mountedZIndex = Number(panel.style.zIndex)
  frontRef(panel)

  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].type, 'pointerdown')
  listeners[0].listener()
  assert.equal(Number(panel.style.zIndex), mountedZIndex + 1)
})

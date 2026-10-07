import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const navUrl = new URL('../src/scene/EditNav.tsx', import.meta.url).href
const stubUrl = `data:text/javascript,${encodeURIComponent(`
  let scene
  export let frame
  export const cleanups = []
  export const setScene = value => { scene = value }
  export const useThree = selector => selector(scene)
  export const useFrame = callback => { frame = callback }
  export const useEffect = effect => { cleanups.push(effect()) }
  export const useRef = current => ({ current })
  export const useStore = { getState: () => ({ mode: 'edit' }) }
`)}`
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === navUrl && ['react', '@react-three/fiber', '../store'].includes(specifier)) {
      return { url: stubUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === navUrl) {
      const { outputText } = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      return { format: 'module', source: outputText, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
let EditNav
try {
  ;({ EditNav } = await import(navUrl))
} finally {
  hooks.deregister()
}
const runtime = await import(stubUrl)

function createTestWindow(t) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const target = new EventTarget()
  globalThis.window = target
  t.after(() => {
    for (const cleanup of runtime.cleanups.splice(0)) cleanup?.()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  return target
}

test('losing focus stops keyboard camera movement until a new key press', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  const press = () => target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }))
  const initial = camera.position.toArray()
  press()
  runtime.frame({}, 1 / 60)
  const moved = camera.position.toArray()
  const movedTarget = controls.target.toArray()
  assert.notDeepEqual(moved, initial)
  target.dispatchEvent(new Event('blur'))
  runtime.frame({}, 1 / 60)
  assert.deepEqual(camera.position.toArray(), moved)
  assert.deepEqual(controls.target.toArray(), movedTarget)
  press()
  runtime.frame({}, 1 / 60)
  assert.notDeepEqual(camera.position.toArray(), moved)
  for (const cleanup of runtime.cleanups.splice(0)) cleanup?.()
  for (const type of ['keydown', 'keyup', 'blur', 'focusin']) {
    assert.equal(getEventListeners(target, type).length, 0)
  }
})

test('handled keys, IME composition, and modified shortcuts do not move the camera or orbit target', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  const initial = camera.position.toArray()
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'isComposing']) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyS' })
    if (modifier === 'defaultPrevented') event.preventDefault()
    else event[modifier] = true
    target.dispatchEvent(event)
    runtime.frame({}, 1 / 60)
    assert.deepEqual(camera.position.toArray(), initial, modifier)
    assert.deepEqual(controls.target.toArray(), [0, 0, 0], modifier)
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyS' }))
  }
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyS' }))
  runtime.frame({}, 1 / 60)
  assert.notDeepEqual(camera.position.toArray(), initial)
  const normalStep = camera.position.distanceTo(new THREE.Vector3(...initial))
  const beforeBoost = camera.position.clone()
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', shiftKey: true }))
  runtime.frame({}, 1 / 60)
  assert.ok(Math.abs(camera.position.distanceTo(beforeBoost) - normalStep * 2.5) < 1e-10)
})

test('camera boost remains active until both shift keys are released', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }))
  for (const [type, code, multiplier] of [
    ['keydown', 'ShiftLeft', 2.5],
    ['keydown', 'ShiftRight', 2.5],
    ['keyup', 'ShiftLeft', 2.5],
    ['keyup', 'ShiftRight', 1],
    ['keydown', 'ShiftRight', 2.5],
    ['keydown', 'ShiftLeft', 2.5],
    ['keyup', 'ShiftRight', 2.5],
    ['keyup', 'ShiftLeft', 1],
  ]) {
    target.dispatchEvent(Object.assign(new Event(type), { code }))
    const beforeCamera = camera.position.clone()
    const beforeTarget = controls.target.clone()
    runtime.frame({}, 1 / 60)
    const expectedDelta = new THREE.Vector3(0, 0, -8 / 60 * multiplier)
    assert.ok(camera.position.clone().sub(beforeCamera).distanceTo(expectedDelta) < 1e-10, `${type} ${code}`)
    assert.ok(controls.target.clone().sub(beforeTarget).distanceTo(expectedDelta) < 1e-10, `${type} ${code}`)
  }
})

test('typing in editable elements does not move the camera', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  const initial = camera.position.toArray()
  for (const element of [
    { tagName: 'INPUT' },
    { tagName: 'SELECT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'DIV', isContentEditable: true },
    { tagName: 'SPAN', isContentEditable: true },
  ]) {
    const event = Object.assign(new Event('keydown'), { code: 'KeyW' })
    Object.defineProperty(event, 'target', { value: element })
    target.dispatchEvent(event)
    runtime.frame({}, 1 / 60)
    assert.deepEqual(camera.position.toArray(), initial, element.tagName)
    assert.deepEqual(controls.target.toArray(), [0, 0, 0], element.tagName)
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }))
  }
  const event = Object.assign(new Event('keydown'), { code: 'KeyW' })
  Object.defineProperty(event, 'target', { value: { tagName: 'DIV', isContentEditable: false } })
  target.dispatchEvent(event)
  runtime.frame({}, 1 / 60)
  assert.notDeepEqual(camera.position.toArray(), initial)
})

test('diagonal movement preserves speed and the camera offset from the orbit target', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  const initial = camera.position.clone()
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }))
  runtime.frame({}, 1 / 60)
  const straightStep = camera.position.distanceTo(initial)
  assert.ok(straightStep > 0)
  const beforeDiagonal = camera.position.clone()
  const beforeTarget = controls.target.clone()
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyD' }))
  runtime.frame({}, 1 / 60)
  const cameraDelta = camera.position.clone().sub(beforeDiagonal)
  const targetDelta = controls.target.clone().sub(beforeTarget)
  assert.ok(cameraDelta.x > 0)
  assert.ok(cameraDelta.z < 0)
  assert.equal(cameraDelta.y, 0)
  assert.ok(Math.abs(cameraDelta.length() - straightStep) < 1e-10)
  assert.ok(cameraDelta.distanceTo(targetDelta) < 1e-10)
  assert.ok(camera.position.clone().sub(controls.target).distanceTo(initial) < 1e-10)
})

test('opposing movement keys cancel until one is released', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  const initial = new THREE.Vector3(0, 5, 10)
  camera.position.copy(initial)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  for (const [held, released, direction] of [
    ['KeyW', 'KeyS', [0, 0, -1]],
    ['KeyA', 'KeyD', [-1, 0, 0]],
    ['ArrowUp', 'ArrowDown', [0, 0, -1]],
    ['ArrowLeft', 'ArrowRight', [-1, 0, 0]],
  ]) {
    camera.position.copy(initial)
    controls.target.set(0, 0, 0)
    for (const code of [held, released]) {
      target.dispatchEvent(Object.assign(new Event('keydown'), { code }))
    }
    runtime.frame({}, 1 / 60)
    assert.deepEqual(camera.position.toArray(), initial.toArray(), held)
    assert.deepEqual(controls.target.toArray(), [0, 0, 0], held)
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: released }))
    runtime.frame({}, 1 / 60)
    const expectedDelta = new THREE.Vector3(...direction).multiplyScalar(8 / 60)
    assert.ok(camera.position.clone().sub(initial).distanceTo(expectedDelta) < 1e-10, held)
    assert.ok(controls.target.distanceTo(expectedDelta) < 1e-10, held)
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: held }))
    const stopped = camera.position.toArray()
    const stoppedTarget = controls.target.toArray()
    runtime.frame({}, 1 / 60)
    assert.deepEqual(camera.position.toArray(), stopped, held)
    assert.deepEqual(controls.target.toArray(), stoppedTarget, held)
  }
})

test('long frames cap keyboard camera movement without inflating shorter steps', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  const initial = new THREE.Vector3(0, 5, 10)
  camera.position.copy(initial)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }))
  for (const [dt, distance] of [[0, 0], [0.01, 0.08], [0.05, 0.4], [0.051, 0.4], [1, 0.4]]) {
    camera.position.copy(initial)
    controls.target.set(0, 0, 0)
    runtime.frame({}, dt)
    const expectedDelta = new THREE.Vector3(0, 0, -distance)
    const cameraDelta = camera.position.clone().sub(initial)
    assert.ok(cameraDelta.distanceTo(expectedDelta) < 1e-10, `camera dt=${dt}`)
    assert.ok(controls.target.distanceTo(expectedDelta) < 1e-10, `target dt=${dt}`)
  }
})

test('focusing an editable element stops held movement keys', (t) => {
  const target = createTestWindow(t)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  const press = () => target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }))
  const focus = element => {
    const event = new Event('focusin')
    Object.defineProperty(event, 'target', { value: element })
    target.dispatchEvent(event)
  }
  const initial = camera.position.toArray()
  press()
  focus({ tagName: 'BUTTON' })
  runtime.frame({}, 1 / 60)
  assert.notDeepEqual(camera.position.toArray(), initial)
  for (const element of [
    { tagName: 'INPUT' },
    { tagName: 'SELECT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SPAN', isContentEditable: true },
  ]) {
    const beforePress = camera.position.toArray()
    press()
    runtime.frame({}, 1 / 60)
    const moved = camera.position.toArray()
    const movedTarget = controls.target.toArray()
    assert.notDeepEqual(moved, beforePress)
    focus(element)
    runtime.frame({}, 1 / 60)
    assert.deepEqual(camera.position.toArray(), moved, element.tagName)
    assert.deepEqual(controls.target.toArray(), movedTarget, element.tagName)
  }
})

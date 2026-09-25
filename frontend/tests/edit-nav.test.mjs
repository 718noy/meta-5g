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

test('losing focus stops keyboard camera movement until a new key press', (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const target = new EventTarget()
  globalThis.window = target
  t.after(() => {
    for (const cleanup of runtime.cleanups.splice(0)) cleanup?.()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
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
  for (const type of ['keydown', 'keyup', 'blur']) {
    assert.equal(getEventListeners(target, type).length, 0)
  }
})

test('modified shortcuts do not move the camera or orbit target', (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const target = new EventTarget()
  globalThis.window = target
  t.after(() => {
    for (const cleanup of runtime.cleanups.splice(0)) cleanup?.()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)
  const controls = { target: new THREE.Vector3(), update() {} }
  runtime.setScene({ camera, controls })
  EditNav()
  const initial = camera.position.toArray()
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyS', [modifier]: true }))
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

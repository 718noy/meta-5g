import assert from 'node:assert/strict'
import test from 'node:test'

const { mapColor, STOPS } = await import('../src/colormap.ts')

test('mapColor clamps samples outside the declared color stops', () => {
  assert.deepEqual(mapColor(-1), STOPS[0].rgba)
  assert.deepEqual(mapColor(2), STOPS.at(-1).rgba)
})

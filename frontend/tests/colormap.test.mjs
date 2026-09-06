import assert from 'node:assert/strict'
import test from 'node:test'

const { cssGradient, mapColor, STOPS } = await import('../src/colormap.ts')

test('mapColor clamps samples outside the declared color stops', () => {
  assert.deepEqual(mapColor(-1), STOPS[0].rgba)
  assert.deepEqual(mapColor(2), STOPS.at(-1).rgba)
})

test('editing an endpoint sample preserves later colors and the legend', () => {
  const originalStops = structuredClone(STOPS)
  const originalGradient = cssGradient()
  try {
    for (const t of [-1, 0, 1, 2]) {
      const expected = [...mapColor(t)]
      const sample = mapColor(t)
      sample[3] = 0.5
      assert.deepEqual(mapColor(t), expected, `subsequent sample at ${t}`)
      assert.deepEqual(STOPS, originalStops, `color stops after sample at ${t}`)
      assert.equal(cssGradient(), originalGradient, `legend after sample at ${t}`)
    }
  } finally {
    STOPS.forEach((stop, i) => stop.rgba.splice(0, 4, ...originalStops[i].rgba))
  }
})

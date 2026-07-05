// 높이 슬라이스 히트맵 — 특정 높이 평면에서의 전파 세기를 정밀하게 본다.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import {
  GLSL_COLORMAP,
  RSRP_VIZ_MAX,
  RSRP_VIZ_MIN,
  SINR_VIZ_MAX,
  SINR_VIZ_MIN,
} from '../colormap'
import { useStore } from '../store'
import type { Zone } from '../types'
import { zoneOffset } from '../types'

const VERT = /* glsl */ `
out vec2 vUvP;
void main() {
  vUvP = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uData;
uniform float uSliceT; // 0..1 (높이 비율)
uniform float uVmin;
uniform float uVmax;
in vec2 vUvP;
out vec4 outColor;

${GLSL_COLORMAP}

void main() {
  float v = texture(uData, vec3(vUvP.x, uSliceT, vUvP.y)).r;
  float nv = clamp((v - uVmin) / (uVmax - uVmin), 0.0, 1.0);
  vec4 c = colormap(nv);
  outColor = vec4(c.rgb, max(c.a, 0.12) * 0.9);
}
`

export function SliceViz({ zone }: { zone: Zone }) {
  const sim = useStore((s) => s.sims[zone])
  const vizMode = useStore((s) => s.vizMode)
  const vizMetric = useStore((s) => s.vizMetric)
  const sliceY = useStore((s) => s.sliceY)
  const space = useStore((s) => s.space)

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uData: { value: null },
          uSliceT: { value: 0.5 },
          uVmin: { value: RSRP_VIZ_MIN },
          uVmax: { value: RSRP_VIZ_MAX },
        },
      }),
    [],
  )

  useEffect(() => {
    if (!sim) return
    // 단면은 항상 세기 히트맵 (cell 모드일 땐 RSRP로 표시)
    const useSinr = vizMetric === 'sinr'
    const data = useSinr ? sim.sinr : sim.rsrp
    const tex = new THREE.Data3DTexture(data, sim.nx, sim.ny, sim.nz)
    tex.format = THREE.RedFormat
    tex.type = THREE.FloatType
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    const old = material.uniforms.uData.value as THREE.Data3DTexture | null
    material.uniforms.uData.value = tex
    material.uniforms.uVmin.value = useSinr ? SINR_VIZ_MIN : RSRP_VIZ_MIN
    material.uniforms.uVmax.value = useSinr ? SINR_VIZ_MAX : RSRP_VIZ_MAX
    old?.dispose()
  }, [sim, vizMetric, material])

  useEffect(() => {
    material.uniforms.uSliceT.value = Math.min(Math.max(sliceY / space.height, 0.01), 0.99)
  }, [sliceY, space.height, material])

  useEffect(() => () => {
    ;(material.uniforms.uData.value as THREE.Data3DTexture | null)?.dispose()
    material.dispose()
  }, [material])

  if (vizMode !== 'slice' || !sim) return null

  return (
    <mesh
      position={[
        zoneOffset(zone, space.width, space.depth)[0] + space.width / 2,
        sliceY,
        zoneOffset(zone, space.width, space.depth)[1] + space.depth / 2,
      ]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
      renderOrder={10}
    >
      <planeGeometry args={[space.width, space.depth]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

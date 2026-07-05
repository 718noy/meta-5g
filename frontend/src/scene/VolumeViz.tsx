// 전파 볼륨 렌더링 (레이마칭 안개).
//  - rsrp/sinr 모드: 위치별 신호 세기를 컬러맵으로 (기존 기능 유지)
//  - cell 모드: 각 라디오(서빙셀)마다 고유 색의 희미한 오라 — "이 전파가 어느 RU 것인지" 표시
// 카메라가 볼륨 안(걷기)에 있어도 보이도록 BackSide 렌더.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  GLSL_CELL_COLORS,
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
out vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform sampler3D uData;    // 세기 (rsrp/sinr) — 알파 결정
uniform sampler3D uServing; // 서빙 셀 인덱스 (cell 모드 색)
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uVmin;
uniform float uVmax;
uniform float uDensity;
uniform int uMode;          // 0=scalar colormap, 1=cell aura
in vec3 vWorld;
out vec4 outColor;

${GLSL_COLORMAP}
${GLSL_CELL_COLORS}

vec2 boxIntersect(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv;
  vec3 t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - cameraPosition);
  vec2 hit = boxIntersect(ro, rd);
  float tEnter = max(hit.x, 0.0);
  float tExit = hit.y;
  if (tExit <= tEnter) discard;

  const int STEPS = 160;
  float dt = (tExit - tEnter) / float(STEPS);
  vec3 sizeInv = 1.0 / (uBoxMax - uBoxMin);

  vec4 accum = vec4(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = tEnter + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    vec3 uvw = (p - uBoxMin) * sizeInv;
    float v = texture(uData, uvw).r;
    float nv = clamp((v - uVmin) / (uVmax - uVmin), 0.0, 1.0);

    vec3 rgb;
    float baseA;
    if (uMode == 1) {
      // cell 오라: 서빙 셀 색, 세기에 따라 옅게 (희미한 안개)
      int idx = int(texture(uServing, uvw).r + 0.5);
      rgb = CELL_COLORS[idx % 16];
      baseA = pow(nv, 2.6) * 0.32;   // 세기 낮으면 거의 투명 → 라디오 주변만 은은하게
    } else {
      vec4 c = colormap(nv);
      rgb = c.rgb;
      baseA = pow(c.a, 2.0) * 0.55;
    }
    float a = clamp(baseA * uDensity * dt * 0.5, 0.0, 1.0);
    accum.rgb += (1.0 - accum.a) * a * rgb;
    accum.a += (1.0 - accum.a) * a;
    if (accum.a > 0.96) break;
  }
  if (accum.a < 0.01) discard;
  outColor = accum;
}
`

export function VolumeViz({ zone }: { zone: Zone }) {
  const sim = useStore((s) => s.sims[zone])
  const vizMode = useStore((s) => s.vizMode)
  const vizMetric = useStore((s) => s.vizMetric)
  const vizDensity = useStore((s) => s.vizDensity)
  const space = useStore((s) => s.space)
  const matRef = useRef<THREE.ShaderMaterial>(null)

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uData: { value: null },
        uServing: { value: null },
        uBoxMin: { value: new THREE.Vector3(0, 0, 0) },
        uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
        uVmin: { value: RSRP_VIZ_MIN },
        uVmax: { value: RSRP_VIZ_MAX },
        uDensity: { value: 0.55 },
        uMode: { value: 0 },
      },
    })
  }, [])

  // 시뮬 결과 → 3D 텍스처 업로드
  useEffect(() => {
    if (!sim) return
    const mk = (data: Float32Array) => {
      const tex = new THREE.Data3DTexture(data, sim.nx, sim.ny, sim.nz)
      tex.format = THREE.RedFormat
      tex.type = THREE.FloatType
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping
      tex.unpackAlignment = 1
      tex.needsUpdate = true
      return tex
    }

    // 세기 텍스처(항상 필요): cell 모드도 알파는 RSRP 사용
    const scalar = vizMetric === 'sinr' ? sim.sinr : sim.rsrp
    const dataTex = mk(scalar)
    const oldData = material.uniforms.uData.value as THREE.Data3DTexture | null
    material.uniforms.uData.value = dataTex
    oldData?.dispose()

    // 서빙 텍스처: cell 모드에서만 (서빙셀 최근접 색 → nearest filter)
    const oldServ = material.uniforms.uServing.value as THREE.Data3DTexture | null
    if (vizMetric === 'cell') {
      const st = mk(sim.serving)
      st.minFilter = st.magFilter = THREE.NearestFilter
      st.needsUpdate = true
      material.uniforms.uServing.value = st
    } else {
      material.uniforms.uServing.value = null
    }
    oldServ?.dispose()

    const [ox, oz] = zoneOffset(zone, space.width, space.depth)
    material.uniforms.uBoxMin.value.set(ox, 0, oz)
    material.uniforms.uBoxMax.value.set(ox + space.width, space.height, oz + space.depth)
    material.uniforms.uMode.value = vizMetric === 'cell' ? 1 : 0
    // cell 모드는 RSRP 범위로 알파 결정
    material.uniforms.uVmin.value = vizMetric === 'sinr' ? SINR_VIZ_MIN : RSRP_VIZ_MIN
    material.uniforms.uVmax.value = vizMetric === 'sinr' ? SINR_VIZ_MAX : RSRP_VIZ_MAX
  }, [sim, vizMetric, material, space, zone])

  useEffect(() => {
    material.uniforms.uDensity.value = vizDensity
  }, [vizDensity, material])

  useEffect(
    () => () => {
      ;(material.uniforms.uData.value as THREE.Data3DTexture | null)?.dispose()
      ;(material.uniforms.uServing.value as THREE.Data3DTexture | null)?.dispose()
      material.dispose()
    },
    [material],
  )

  useFrame(() => {
    if (matRef.current) matRef.current.uniformsNeedUpdate = true
  })

  if (vizMode !== 'volume' || !sim) return null

  const [ox2, oz2] = zoneOffset(zone, space.width, space.depth)
  return (
    <mesh
      position={[ox2 + space.width / 2, space.height / 2 + 0.05, oz2 + space.depth / 2]}
      raycast={() => null}
      renderOrder={10}
    >
      <boxGeometry args={[space.width, space.height, space.depth]} />
      <primitive object={material} ref={matRef} attach="material" />
    </mesh>
  )
}

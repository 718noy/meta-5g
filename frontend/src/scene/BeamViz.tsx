// 빔포밍 빔 시각화 — Massive MIMO gNB의 조향 빔을 반투명 원뿔로 표시.
// 편집 모드: 방위각/틸트 방향으로 고정. 걷기 모드(+UE 추적): UE(카메라)를 실시간 추적.
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import type { SceneObject } from '../types'
import { getRadiator, objZone, zoneOffset } from '../types'

const BEAM_LEN = 16

function BeamCone({ obj }: { obj: SceneObject }) {
  const ref = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const space = useStore((s) => s.space)
  const objects = useStore((s) => s.objects)
  const g = obj.gnb!
  const [ox, oz] = zoneOffset(objZone(obj), space.width, space.depth)
  const rad = getRadiator(obj, objects)

  const geometry = useMemo(() => {
    const radius = BEAM_LEN * Math.tan(((g.beamwidth_deg / 2) * Math.PI) / 180)
    const geo = new THREE.ConeGeometry(radius, BEAM_LEN, 28, 1, true)
    geo.rotateX(-Math.PI / 2) // 축을 +Z로
    geo.translate(0, 0, BEAM_LEN / 2) // 꼭짓점을 원점(안테나)으로
    return geo
  }, [g.beamwidth_deg])

  useFrame(() => {
    const grp = ref.current
    if (!grp) return
    const { mode, ueOn, ueZone } = useStore.getState()
    // UE 추적: 걷는 UE가 같은 존에 있을 때만
    if (!rad) return
    if (mode === 'walk' && g.beam_tracking && ueOn && ueZone === objZone(obj)) {
      grp.lookAt(camera.position)
    } else {
      const az = ((-rad.rotation_deg + g.azimuth_deg) * Math.PI) / 180
      const el = (-g.tilt_deg * Math.PI) / 180
      grp.lookAt(
        ox + rad.x + Math.cos(el) * Math.cos(az) * BEAM_LEN,
        rad.height + Math.sin(el) * BEAM_LEN,
        oz + rad.z + Math.cos(el) * Math.sin(az) * BEAM_LEN,
      )
    }
  })

  if (!rad) return null

  return (
    <group ref={ref} position={[ox + rad.x, rad.height, oz + rad.z]}>
      <mesh geometry={geometry} raycast={() => null} renderOrder={9}>
        <meshBasicMaterial
          color="#8fd8ff"
          transparent
          opacity={0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 빔 중심축 라인 */}
      <mesh
        position={[0, 0, BEAM_LEN / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        raycast={() => null}
        renderOrder={9}
      >
        <cylinderGeometry args={[0.015, 0.015, BEAM_LEN, 6]} />
        <meshBasicMaterial
          color="#bfe9ff"
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

export function BeamViz() {
  const objects = useStore((s) => s.objects)
  const beams = objects.filter(
    (o) => o.kind === 'gnb' && o.gnb?.antenna === 'beam' && o.gnb.enabled,
  )
  return (
    <group>
      {beams.map((o) => (
        <BeamCone key={o.id} obj={o} />
      ))}
    </group>
  )
}

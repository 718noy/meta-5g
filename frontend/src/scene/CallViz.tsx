// 통화 중인 두 측정요원 위에 펄스 링 + 둘을 잇는 미디어(RTP) 라인 표시.
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { objZone, zoneOffset } from '../types'

function worldPos(id: string, w: number, d: number): [number, number, number] | null {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!o) return null
  const [ox, oz] = zoneOffset(objZone(o), w, d)
  return [ox + o.position[0], 1.9, oz + o.position[2]]
}

export function CallViz() {
  const call = useStore((s) => s.call)
  const space = useStore((s) => s.space)
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const lineRef = useRef<THREE.Object3D>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const s = 1 + 0.25 * Math.sin(t * 4)
    if (ringA.current) ringA.current.scale.setScalar(s)
    if (ringB.current) ringB.current.scale.setScalar(s)
  })

  if (!call || call.phase === 'idle') return null
  const a = worldPos(call.fromId, space.width, space.depth)
  const b = worldPos(call.toId, space.width, space.depth)
  if (!a || !b) return null

  const active = call.phase === 'active'
  const ringing = call.phase === 'ringing' || call.phase === 'inviting'
  const color = call.phase === 'failed' ? '#ff5d5d' : active ? '#2bd680' : '#ffb43d'

  return (
    <group>
      {[a, b].map((p, i) => (
        <mesh
          key={i}
          ref={i === 0 ? ringA : ringB}
          position={[p[0], 2.4, p[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <ringGeometry args={[0.35, 0.5, 32]} />
          <meshBasicMaterial color={color} transparent opacity={ringing ? 0.9 : 0.7} />
        </mesh>
      ))}
      {/* 미디어(RTP) / 시그널링 라인 */}
      <Line
        points={[a, b]}
        color={color}
        lineWidth={active ? 3 : 1.8}
        dashed={!active}
        dashSize={0.6}
        gapSize={0.3}
        transparent
        opacity={0.85}
        ref={lineRef as never}
      />
      {/* 📞 아이콘 위치 마커 (headset 느낌의 작은 구) */}
      {[a, b].map((p, i) => (
        <mesh key={`m${i}`} position={[p[0], 2.9, p[2]]} raycast={() => null}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
        </mesh>
      ))}
    </group>
  )
}

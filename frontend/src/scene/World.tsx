// 두 개의 분리된 공간(PLMN-A / PLMN-B) — 멀리 떨어진 두 국가처럼 운영.
// 전파 시뮬레이션은 존별로 완전 독립. 바닥 클릭 = 해당 존에 배치.
import { Grid, Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { pick } from '../i18n'
import { useStore } from '../store'
import type { Zone } from '../types'
import { CATALOG, ZONES, zoneOffset } from '../types'

// 임포트한 도면 이미지를 바닥 평면에 텍스처로 표시
function FloorPlan({ W, D }: { W: number; D: number }) {
  const url = useStore((s) => s.floorPlan)
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) {
      setTex(null)
      return
    }
    const loader = new THREE.TextureLoader()
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      setTex(t)
    })
  }, [url])
  if (!tex) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[W / 2, 0.03, D / 2]} raycast={() => null}>
      <planeGeometry args={[W, D]} />
      <meshBasicMaterial map={tex} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  )
}

// 배치 미리보기 고스트 (R 키로 회전)
function Ghost() {
  const tool = useStore((s) => s.tool)
  const ghost = useStore((s) => s.ghost)
  const rot = useStore((s) => s.ghostRot)
  const space = useStore((s) => s.space)
  if (tool === 'select' || !ghost) return null
  const size = CATALOG[tool].size
  const [ox, oz] = zoneOffset(ghost.zone, space.width, space.depth)
  return (
    <group position={[ghost.x + ox, 0, ghost.z + oz]} rotation={[0, (rot * Math.PI) / 180, 0]}>
      <mesh position={[0, size[1] / 2, 0]} raycast={() => null}>
        <boxGeometry args={size} />
        <meshBasicMaterial color="#4da3ff" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, size[1] / 2, 0]} raycast={() => null}>
        <boxGeometry args={size} />
        <meshBasicMaterial color="#4da3ff" wireframe transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} raycast={() => null}>
        <ringGeometry args={[0.45, 0.55, 32]} />
        <meshBasicMaterial color="#4da3ff" transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

function ZoneSpace({ zone }: { zone: Zone }) {
  const space = useStore((s) => s.space)
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const addObject = useStore((s) => s.addObject)
  const select = useStore((s) => s.select)
  const setGhost = useStore((s) => s.setGhost)
  const lang = useStore((s) => s.lang)
  const homeZone = useStore((s) => s.homeZone)

  const { width: W, depth: D, height: H } = space
  const [ox, oz] = zoneOffset(zone, W, D)

  const clampX = (x: number) => Math.min(Math.max(x - ox, 0.5), W - 0.5)
  const clampZ = (z: number) => Math.min(Math.max(z - oz, 0.5), D - 0.5)

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'edit') return
    e.stopPropagation()
    if (tool === 'select') {
      select(null)
      return
    }
    addObject(tool, clampX(e.point.x), clampZ(e.point.z), useStore.getState().ghostRot, zone)
  }

  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'edit' || tool === 'select') return
    setGhost({ x: clampX(e.point.x), z: clampZ(e.point.z), zone })
  }

  const accent = zone === 'A' ? '#4da3ff' : zone === 'B' ? '#ffb43d' : '#2bd680'
  const wallMat = (
    <meshStandardMaterial color="#9aa6b8" transparent opacity={0.16} depthWrite={false} />
  )

  return (
    <group position={[ox, 0, oz]}>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[W / 2, 0, D / 2]}
        onClick={onFloorClick}
        onPointerMove={onFloorMove}
        onPointerOut={() => setGhost(null)}
      >
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial
          color="#39414e"
          roughness={0.85}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {/* 임포트한 도면(평면도) — 존 A 바닥에 표시 */}
      {zone === 'A' && <FloorPlan W={W} D={D} />}
      <Grid
        position={[W / 2, 0.04, D / 2]}
        args={[W, D]}
        cellSize={1}
        cellThickness={0.45}
        cellColor="#4a5464"
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor={zone === 'A' ? '#5d7aa0' : '#a08a5d'}
        fadeDistance={200}
        followCamera={false}
      />

      {/* 국가 라벨 (홈/방문은 homeZone 기준) */}
      <Html position={[W / 2, H + 1.5, 0]} center distanceFactor={60} zIndexRange={[0, 10]}>
        <div className={`zone-label zone-${zone}`}>
          PLMN-{zone}{' '}
          {zone === homeZone
            ? pick(lang, '(홈)', '(Home)', '(归属)')
            : pick(lang, '(방문)', '(Visited)', '(拜访)')}
        </div>
      </Html>

      {/* 외벽 */}
      <mesh position={[W / 2, H / 2, -0.05]} raycast={() => null}>
        <boxGeometry args={[W, H, 0.1]} />
        {wallMat}
      </mesh>
      <mesh position={[W / 2, H / 2, D + 0.05]} raycast={() => null}>
        <boxGeometry args={[W, H, 0.1]} />
        {wallMat}
      </mesh>
      <mesh position={[-0.05, H / 2, D / 2]} raycast={() => null}>
        <boxGeometry args={[0.1, H, D]} />
        {wallMat}
      </mesh>
      <mesh position={[W + 0.05, H / 2, D / 2]} raycast={() => null}>
        <boxGeometry args={[0.1, H, D]} />
        {wallMat}
      </mesh>

      {/* 존 테두리 액센트 */}
      <mesh position={[W / 2, 0.03, -0.1]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[W + 0.4, 0.25]} />
        <meshBasicMaterial color={accent} transparent opacity={0.7} />
      </mesh>
      <mesh position={[W / 2, 0.03, D + 0.1]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[W + 0.4, 0.25]} />
        <meshBasicMaterial color={accent} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

export function World() {
  const space = useStore((s) => s.space)
  const { width: W, depth: D, height: H } = space
  const span = (W + D) * 1.5 // 삼각 배치 전체를 덮는 대략 반경

  return (
    <group>
      {ZONES.map((z) => (
        <ZoneSpace key={z} zone={z} />
      ))}
      <Ghost />

      {/* 조명 — 세 존 전체 커버 */}
      <hemisphereLight args={['#dfe7f3', '#3a4250', 1.15]} />
      <directionalLight
        castShadow
        position={[span * 0.6, span * 0.6, span * 0.3]}
        intensity={2.0}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={span * 3}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[-15, 18, D]} intensity={0.7} />
      {ZONES.map((z) => {
        const [ox, oz] = zoneOffset(z, W, D)
        return (
          <pointLight
            key={z}
            position={[ox + W * 0.5, H - 0.5, oz + D * 0.5]}
            intensity={30}
            distance={Math.max(W, D) * 0.5}
            decay={2}
            color="#e8efff"
          />
        )
      })}
    </group>
  )
}

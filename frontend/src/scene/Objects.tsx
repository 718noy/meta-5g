// 배치된 오브젝트 렌더링 + 선택/이동·회전(TransformControls) + 키 조작
//   G = 이동 기즈모, R = 회전 기즈모, Delete = 삭제, ESC = 선택 해제/배치 종료
import { Edges, Html, TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { useStore } from '../store'
import type { SceneObject, Zone } from '../types'
import { CATALOG, ZONES, objZone, zoneOffset } from '../types'
import { ObjectModel } from './models'

// 사람이 올라설 수 있는 가구
const STANDABLE = new Set<SceneObject['kind']>(['desk', 'table', 'chair', 'cabinet', 'shelf', 'sofa', 'machine'])

// 해당 지역 (x,z) 지점에 있는 가구의 상단 높이 (없으면 0=바닥)
function standHeightAt(objects: SceneObject[], zone: Zone, x: number, z: number, excludeId: string): number {
  let top = 0
  for (const o of objects) {
    if (o.id === excludeId || (o.zone ?? 'A') !== zone || !STANDABLE.has(o.kind)) continue
    const size = o.size ?? CATALOG[o.kind].size
    const rad = Math.max(size[0], size[2]) / 2 + 0.15
    if (Math.abs(o.position[0] - x) <= rad && Math.abs(o.position[2] - z) <= rad) {
      top = Math.max(top, size[1])
    }
  }
  return top
}

// 선택 하이라이트용 근사 바운딩 박스 (종류별)
function selBox(obj: SceneObject): { size: [number, number, number]; y: number } {
  const h = obj.gnb?.height ?? 2.5
  switch (obj.kind) {
    case 'gnb': return { size: [0.9, h + 0.9, 0.9], y: (h + 0.9) / 2 }
    case 'antenna': return { size: [0.6, 1.3, 0.6], y: 0.65 }
    case 'person':
      return obj.ueShell === 'machine'
        ? { size: [1.0, 1.4, 0.8], y: 0.7 }
        : { size: [0.7, 1.85, 0.7], y: 0.92 }
    case 'wall':
    case 'glasswall': {
      const s = obj.size ?? [2, 3, 0.2]
      return { size: [s[0] + 0.2, s[1] + 0.2, s[2] + 0.2], y: s[1] / 2 }
    }
    case 'desk': return { size: [1.4, 0.9, 0.85], y: 0.45 }
    case 'chair': return { size: [0.6, 1.0, 0.6], y: 0.5 }
    case 'cabinet': return { size: [0.9, 1.9, 0.6], y: 0.95 }
    default: return { size: [1, 1, 1], y: 0.5 }
  }
}

// 측정요원 머리 위 이름표 (몇 번째 테스터인지 + 전원 상태)
function PersonTag({ obj }: { obj: SceneObject }) {
  const on = useStore((s) => s.personUeOn[obj.id] ?? false)
  const traffic = useStore((s) => s.personTraffic[obj.id] ?? false)
  const tagY = obj.ueShell === 'machine' ? 1.75 : 2.0
  return (
    <Html position={[0, tagY, 0]} center distanceFactor={14} zIndexRange={[10, 0]} pointerEvents="none">
      <div className={`tester-tag ${on ? 'on' : 'off'}`}>
        <span className="tester-dot" />
        {obj.name}
        {on && traffic && <span className="tester-traffic">▲</span>}
      </div>
    </Html>
  )
}

function Selectable({ obj }: { obj: SceneObject }) {
  const ref = useRef<Group>(null)
  const mode = useStore((s) => s.mode)
  const tool = useStore((s) => s.tool)
  const selectedId = useStore((s) => s.selectedId)
  const inMulti = useStore((s) => s.selectedIds.includes(obj.id))
  const multiCount = useStore((s) => s.selectedIds.length)
  const gizmoMode = useStore((s) => s.gizmoMode)
  const select = useStore((s) => s.select)
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const updateObject = useStore((s) => s.updateObject)
  const space = useStore((s) => s.space)

  const setDragging = useStore((s) => s.setDragging)
  const controls = useThree((s) => s.controls)
  const selected = selectedId === obj.id || inMulti
  // 단일 선택일 때만 이동 기즈모 표시
  const soleSelected = selectedId === obj.id && multiCount <= 1

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'edit' || tool !== 'select') return
    e.stopPropagation()
    // Ctrl/Shift 클릭 → 다중 선택 토글
    if (e.nativeEvent.ctrlKey || e.nativeEvent.shiftKey) {
      const ids = useStore.getState().selectedIds
      setSelectedIds(ids.includes(obj.id) ? ids.filter((i) => i !== obj.id) : [...ids, obj.id])
    } else {
      select(obj.id)
    }
  }

  // 클릭한 채 드래그로 위치 이동 시작
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'edit' || tool !== 'select') return
    if (e.nativeEvent.shiftKey) return // Shift+드래그는 박스 선택용
    e.stopPropagation()
    if (!inMulti) select(obj.id)
    setDragging({ id: obj.id, zone: objZone(obj) })
    // OrbitControls의 enabled prop 반영은 1프레임 늦으므로(마퀴 수정과 동일 이슈),
    // 드래그 시작 즉시 컨트롤 인스턴스를 동기적으로 잠가 카메라 회전을 원천 차단한다.
    const c = controls as { enabled?: boolean } | null
    if (c && typeof c.enabled === 'boolean') c.enabled = false
  }

  return (
    <>
      <group
        ref={ref}
        position={obj.position}
        rotation={[0, (obj.rotation_deg * Math.PI) / 180, 0]}
        onClick={onClick}
        onPointerDown={onPointerDown}
      >
        <ObjectModel obj={obj} />
        {obj.kind === 'person' && <PersonTag obj={obj} />}
        {selected && (() => {
          const b = selBox(obj)
          return (
            <>
              {/* 청록 외곽선 박스 — 선택됨을 명확히 */}
              <mesh position={[0, b.y, 0]} raycast={() => null}>
                <boxGeometry args={b.size} />
                <meshBasicMaterial visible={false} />
                <Edges threshold={12} color="#38e0ff" />
              </mesh>
              {/* 반투명 청록 하이라이트 (색이 변한 느낌) */}
              <mesh position={[0, b.y, 0]} raycast={() => null}>
                <boxGeometry args={b.size} />
                <meshBasicMaterial color="#38e0ff" transparent opacity={0.12} depthWrite={false} />
              </mesh>
              {/* 바닥 링 */}
              <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <ringGeometry args={[Math.max(b.size[0], b.size[2]) * 0.6, Math.max(b.size[0], b.size[2]) * 0.75, 40]} />
                <meshBasicMaterial color="#38e0ff" transparent opacity={0.9} />
              </mesh>
            </>
          )
        })()}
      </group>
      {soleSelected && mode === 'edit' && ref.current && !useStore.getState().dragging && (
        <TransformControls
          object={ref.current}
          mode={gizmoMode}
          showX={gizmoMode === 'translate'}
          showZ={gizmoMode === 'translate'}
          showY={gizmoMode === 'rotate'}
          size={0.8}
          onObjectChange={() => {
            const g = ref.current
            if (!g) return
            if (gizmoMode === 'translate') {
              g.position.y = 0
              g.position.x = Math.min(Math.max(g.position.x, 0.3), space.width - 0.3)
              g.position.z = Math.min(Math.max(g.position.z, 0.3), space.depth - 0.3)
              updateObject(obj.id, { position: [g.position.x, 0, g.position.z] })
            } else {
              const deg = Math.round((g.rotation.y * 180) / Math.PI / 5) * 5
              updateObject(obj.id, { rotation_deg: deg })
            }
          }}
        />
      )}
    </>
  )
}

export function Objects() {
  const objects = useStore((s) => s.objects)

  // 키보드: Delete 삭제, G/R 기즈모 전환, ESC 해제 (배치 중 R = 고스트 회전)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      if (st.mode !== 'edit') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (e.key === 'Escape') {
        // 어떤 상태든 선택/이동으로 복귀 + 선택 해제 + 배치 고스트 정리
        st.setTool('select')
        st.select(null)
        st.setDragging(null)
        return
      }
      if (st.tool !== 'select' && (e.key === 'r' || e.key === 'R')) {
        st.rotateGhost()
        return
      }
      if (!st.selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') st.removeObject(st.selectedId)
      else if (e.key === 'g' || e.key === 'G') st.setGizmoMode('translate')
      else if (e.key === 'r' || e.key === 'R') st.setGizmoMode('rotate')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const space = useStore((s) => s.space)
  const dragging = useStore((s) => s.dragging)
  const updateObject = useStore((s) => s.updateObject)
  const setDragging = useStore((s) => s.setDragging)

  return (
    <group>
      {/* 드래그 중: 씬 전체를 덮는 바닥 평면이 커서를 추적해 위치 갱신 */}
      {dragging && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerMove={(e) => {
            const d = useStore.getState().dragging
            if (!d) return
            const [ox, oz] = zoneOffset(d.zone, space.width, space.depth)
            // 여백 최소화 — 지역 가장자리까지 자유롭게 이동
            const x = Math.min(Math.max(e.point.x - ox, 0.05), space.width - 0.05)
            const z = Math.min(Math.max(e.point.z - oz, 0.05), space.depth - 0.05)
            const objs = useStore.getState().objects
            const cur = objs.find((o) => o.id === d.id)
            // 측정요원은 가구 위에 올라감 (그 지점 가구 상단 높이로)
            const y = cur?.kind === 'person'
              ? standHeightAt(objs, d.zone, x, z, d.id)
              : (cur?.position[1] ?? 0)
            updateObject(d.id, { position: [x, y, z] })
          }}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
        >
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {ZONES.map((zone) => {
        const [ox, oz] = zoneOffset(zone, space.width, space.depth)
        return (
          <group key={zone} position={[ox, 0, oz]}>
            {objects
              .filter((o) => objZone(o) === zone)
              .map((o) => (
                <Selectable key={o.id} obj={o} />
              ))}
          </group>
        )
      })}
    </group>
  )
}

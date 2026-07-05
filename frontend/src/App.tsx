import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import * as api from './api'
import { useCapacitySim } from './capacity'
import { useHistory } from './history'
import { LOGT } from './i18n'
import { useCallEngine } from './voice'
import { BeamViz } from './scene/BeamViz'
import { CallViz } from './scene/CallViz'
import { EditNav } from './scene/EditNav'
import { FirstPerson } from './scene/FirstPerson'
import { NetworkLinks } from './scene/NetworkLinks'
import { Objects } from './scene/Objects'
import { SliceViz } from './scene/SliceViz'
import { VolumeViz } from './scene/VolumeViz'
import { World } from './scene/World'
import { useStore } from './store'
import { ZONES, computeE2E, zoneOffset } from './types'
import { CallPanel } from './ui/CallPanel'
import { CorePanel } from './ui/CorePanel'
import { Legend } from './ui/Legend'
import { NmsPanel } from './ui/NmsPanel'
import { ProcedurePanel } from './ui/ProcedurePanel'
import { ScenarioPanel } from './ui/ScenarioPanel'
import { LogPanel } from './ui/LogPanel'
import { ParamsPanel } from './ui/ParamsPanel'
import { SignalHUD } from './ui/SignalHUD'
import { Toolbar } from './ui/Toolbar'
import { TopBar } from './ui/TopBar'
import { UeListPanel } from './ui/UeListPanel'
import { UeTracePanel } from './ui/UeTracePanel'
import { ZoneSwitch } from './ui/ZoneSwitch'

// 씬 변경 → 디바운스 → 존별(국가별) 독립 재시뮬레이션
function useAutoSimulate() {
  const objects = useStore((s) => s.objects)
  const space = useStore((s) => s.space)
  const engine = useStore((s) => s.engine)
  const ceiling = useStore((s) => s.ceiling)
  const seq = useRef(0)

  useEffect(() => {
    const mySeq = ++seq.current
    const timer = setTimeout(async () => {
      const { setSim, setSimStatus, addEvent } = useStore.getState()
      setSimStatus('running')
      const t0 = performance.now()
      try {
        const sims = await Promise.all(
          ZONES.map((z) => api.simulate(objects, space, z, engine, ceiling)),
        )
        if (seq.current === mySeq) {
          ZONES.forEach((z, i) => setSim(z, sims[i]))
          setSimStatus('idle')
          const gnbs = objects.filter((o) => o.kind === 'gnb').length
          const L = LOGT[useStore.getState().lang]
          addEvent(
            'SIM',
            'info',
            L.sim_done(
              engine === 'rt' ? 'RT' : 'FSPL',
              gnbs,
              objects.filter((o) => o.kind !== 'gnb' && o.kind !== 'person').length,
              Math.round(performance.now() - t0),
              Math.round(Math.min(...sims.map((s) => s.rsrpMin))),
              Math.round(Math.max(...sims.map((s) => s.rsrpMax))),
            ),
          )
        }
      } catch {
        if (seq.current === mySeq) {
          setSimStatus('error')
          addEvent('SIM', 'error', LOGT[useStore.getState().lang].backend_fail)
        }
      }
    }, engine === 'rt' ? 600 : 250)
    return () => clearTimeout(timer)
  }, [objects, space, engine, ceiling])
}

// 토폴로지 변화 → 존별 E2E 성립/붕괴 판정 로그 (구성이 있는 존만)
function useE2EWatcher() {
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const siteDown = useStore((s) => s.siteDown)
  const prev = useRef<Record<string, string>>({})

  useEffect(() => {
    const { addEvent, lang } = useStore.getState()
    for (const zone of ZONES) {
      const { ok, missing, empty } = computeE2E(objects, coreNfs, coreDn, zone, siteDown)
      if (empty) continue
      const sig = ok ? 'ok' : missing.join(',')
      const first = !(zone in prev.current)
      if (prev.current[zone] === sig) continue
      prev.current[zone] = sig
      if (ok) {
        addEvent('SIM', 'info', `[PLMN-${zone}] ${LOGT[lang].e2e_ok}`)
      } else if (!first) {
        addEvent('SIM', 'warn', `[PLMN-${zone}] ${LOGT[lang].e2e_bad(missing.join(', '))}`)
      }
    }
  }, [objects, coreNfs, coreDn, siteDown])
}

// Shift+드래그 박스(마퀴) 다중 선택 — 박스 안에 든 오브젝트를 모두 선택.
// 핵심 수정(item 13): OrbitControls가 같은 pointerdown을 먼저 잡아 카메라를 돌려버리면
//   마퀴 박스와 오브젝트가 어긋나 선택이 비게 된다. React 상태(marquee) 반영은 1프레임 늦으므로
//   shift+down 즉시 컨트롤 인스턴스의 .enabled 를 동기적으로 false 로 눌러 회전을 원천 차단한다.
function MarqueeSelect() {
  const { camera, gl, controls } = useThree()
  // 최신 controls 인스턴스를 항상 참조 (effect 재실행 없이 클로저에서 접근)
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  useEffect(() => {
    const el = gl.domElement
    const parent = el.parentElement
    let start: { x: number; y: number } | null = null
    let boxEl: HTMLDivElement | null = null
    let active = false
    const setControlsEnabled = (v: boolean) => {
      const c = controlsRef.current as { enabled?: boolean } | null
      if (c && typeof c.enabled === 'boolean') c.enabled = v
    }
    const onDown = (e: PointerEvent) => {
      const st = useStore.getState()
      if (st.mode !== 'edit' || st.tool !== 'select' || e.button !== 0 || !e.shiftKey) return
      start = { x: e.clientX, y: e.clientY }
      active = false
      // (1) 동기적으로 즉시 OrbitControls 잠금 — 이 프레임의 회전 시작을 막는다.
      setControlsEnabled(false)
      // (2) 렌더 기반 상태도 갱신 (enabled prop 일관성 유지)
      st.setMarquee(true)
      e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!active && Math.hypot(dx, dy) < 5) return
      active = true
      setControlsEnabled(false) // 드래그 내내 잠금 유지 (안전)
      if (!boxEl && parent) {
        boxEl = document.createElement('div')
        boxEl.className = 'marquee-box'
        parent.appendChild(boxEl)
      }
      const r = el.getBoundingClientRect()
      if (boxEl) {
        boxEl.style.left = `${Math.min(e.clientX, start.x) - r.left}px`
        boxEl.style.top = `${Math.min(e.clientY, start.y) - r.top}px`
        boxEl.style.width = `${Math.abs(dx)}px`
        boxEl.style.height = `${Math.abs(dy)}px`
      }
    }
    // Shift 를 누르는 즉시(포인터다운 전에) OrbitControls 를 꺼서 회전 레이스를 원천 차단.
    //   React enabled prop 은 한 프레임 늦으므로, 키다운에서 marquee=true 로 만들어 미리 비활성화한다.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || e.repeat) return
      const st = useStore.getState()
      if (st.mode === 'edit' && st.tool === 'select') {
        setControlsEnabled(false)
        if (!st.marquee) st.setMarquee(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      // 박스 드래그 진행 중이 아니면 컨트롤/마퀴 복원 (진행 중이면 onUp 이 마무리)
      if (!start) {
        setControlsEnabled(true)
        useStore.getState().setMarquee(false)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!start) return // 마퀴를 시작하지 않았으면 컨트롤/상태 손대지 않음
      const st = useStore.getState()
      if (active) {
        const r = el.getBoundingClientRect()
        const minX = Math.min(start.x, e.clientX) - r.left
        const maxX = Math.max(start.x, e.clientX) - r.left
        const minY = Math.min(start.y, e.clientY) - r.top
        const maxY = Math.max(start.y, e.clientY) - r.top
        const ids: string[] = []
        const v = new THREE.Vector3()
        for (const o of st.objects) {
          const [ox, oz] = zoneOffset(o.zone ?? 'A', st.space.width, st.space.depth)
          v.set(o.position[0] + ox, (o.position[1] || 0) + 0.5, o.position[2] + oz).project(camera)
          const sx = (v.x * 0.5 + 0.5) * r.width
          const sy = (-v.y * 0.5 + 0.5) * r.height
          if (v.z < 1 && sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(o.id)
        }
        st.setSelectedIds(ids)
      }
      if (boxEl) { boxEl.remove(); boxEl = null }
      start = null
      active = false
      // Shift 를 아직 누르고 있으면 박스모드 유지(컨트롤 계속 잠금); 놓았으면 복원.
      if (!e.shiftKey) {
        setControlsEnabled(true)
        st.setMarquee(false)
      }
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (boxEl) boxEl.remove()
    }
  }, [camera, gl])
  return null
}

// 실제 렌더 위치(존 오프셋 포함) 기준으로 측정요원(없으면 RU)을 근접 3인칭으로 프레이밍.
// viewNonce가 바뀌면(초기화 등) 다시 프레이밍. 걷기 모드에선 FirstPerson이 카메라를 잡으므로 관여 안 함.
function CameraRig() {
  const { camera, controls } = useThree()
  const viewNonce = useStore((s) => s.viewNonce)
  const mode = useStore((s) => s.mode)
  const gotoZoneReq = useStore((s) => s.gotoZoneReq)

  useEffect(() => {
    if (mode !== 'edit') return
    const st = useStore.getState()
    const { space } = st
    // 프레이밍 대상: 지역이동 요청이 있으면 그 존, 없으면 측정요원(없으면 RU)들의 중심
    const targetZone = gotoZoneReq?.zone
    const persons = st.objects.filter(
      (o) => o.kind === 'person' && (!targetZone || (o.zone ?? 'A') === targetZone),
    )
    const gnbs = st.objects.filter(
      (o) => o.kind === 'gnb' && (!targetZone || (o.zone ?? 'A') === targetZone),
    )
    const pool = persons.length ? persons : gnbs
    let fx: number
    let fz: number
    if (pool.length) {
      let sx = 0
      let sz = 0
      for (const o of pool) {
        const [ox, oz] = zoneOffset(o.zone ?? 'A', space.width, space.depth)
        sx += o.position[0] + ox
        sz += o.position[2] + oz
      }
      fx = sx / pool.length
      fz = sz / pool.length
    } else {
      const [ox, oz] = zoneOffset(targetZone ?? 'A', space.width, space.depth)
      fx = ox + space.width * 0.5
      fz = oz + space.depth * 0.5
    }
    // 대상 규모에 맞춰 거리 조정 (지역 전체를 볼 땐 더 멀리)
    const spread = targetZone ? Math.max(space.width, space.depth) * 0.5 : 16
    camera.position.set(fx - spread * 0.45, Math.max(spread * 0.6, 8), fz + spread)
    const c = controls as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null
    if (c?.target && c.update) {
      c.target.set(fx, 1.5, fz)
      c.update()
    } else {
      camera.lookAt(fx, 1.5, fz)
    }
  }, [viewNonce, mode, camera, controls, gotoZoneReq])

  return null
}

export default function App() {
  useAutoSimulate()
  useE2EWatcher()
  useCapacitySim()
  useCallEngine()
  useHistory()

  // ESC → 항상 선택/이동 복귀 (포커스 무관, 입력창도 blur). Delete → 선택 삭제.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      if (st.mode !== 'edit') return
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'Escape') {
        // 어떤 포커스 상태든 무조건 선택/이동 도구로 복귀
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        st.setTool('select')
        st.select(null)
        st.setDragging(null)
        e.preventDefault()
        e.stopPropagation()
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        (st.selectedIds.length > 0 || st.selectedId) &&
        tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA'
      ) {
        e.preventDefault()
        const ids = st.selectedIds.length > 0 ? [...st.selectedIds] : [st.selectedId!]
        ids.forEach((id) => st.removeObject(id))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const mode = useStore((s) => s.mode)
  const space = useStore((s) => s.space)
  const dragging = useStore((s) => s.dragging)
  const marquee = useStore((s) => s.marquee)
  // 패널 리마운트 키 — 여는 버튼 재클릭 시 nonce 증가 → key 변경 → 위치/크기 디폴트로 리셋
  const panelNonce = useStore((s) => s.panelNonce)
  const procedureNonce = useStore((s) => s.procedureNonce)
  const selectedId = useStore((s) => s.selectedId)

  return (
    <div className="app">
      <Canvas
        shadows
        gl={{ toneMappingExposure: 1.2 }}
        camera={{
          position: [space.width * 0.5, 20, space.depth * 1.4],
          fov: 55,
          near: 0.3,
          far: 6000,
        }}
      >
        <color attach="background" args={['#11151c']} />
        <fog attach="fog" args={['#11151c', (space.width + space.depth) * 1.5, (space.width + space.depth) * 4]} />
        <CameraRig />
        <MarqueeSelect />
        <World />
        <Objects />
        <NetworkLinks />
        <CallViz />
        <BeamViz />
        {ZONES.map((z) => (
          <VolumeViz key={`v${z}`} zone={z} />
        ))}
        {ZONES.map((z) => (
          <SliceViz key={`s${z}`} zone={z} />
        ))}
        {mode === 'edit' ? (
          <>
            <OrbitControls
              makeDefault
              enabled={dragging == null && !marquee}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={3}
              maxDistance={3000}
            />
            <EditNav />
          </>
        ) : (
          <FirstPerson />
        )}
      </Canvas>

      <TopBar />
      <Toolbar />
      <ParamsPanel key={`params-${selectedId ?? 'none'}`} />
      <CorePanel key={`core-${panelNonce.core ?? 0}`} />
      <NmsPanel key={`nms-${panelNonce.nms ?? 0}`} />
      <CallPanel key={`call-${panelNonce.call ?? 0}`} />
      <ProcedurePanel key={`proc-${procedureNonce}`} />
      <ScenarioPanel key={`scn-${panelNonce.scenarios ?? 0}`} />
      <Legend />
      <SignalHUD />
      <LogPanel key={`log-${panelNonce.log ?? 0}`} />
      <ZoneSwitch />
      <UeListPanel key={`uel-${panelNonce.uelist ?? 0}`} />
      <UeTracePanel key={`uet-${panelNonce.uetrace ?? 0}`} />
      {mode === 'walk' && <div className="crosshair">+</div>}
    </div>
  )
}

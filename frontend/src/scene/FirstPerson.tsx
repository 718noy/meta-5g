// 걷기 모드: 1인칭 WASD + 마우스 시점(PointerLock).
// 걸으면서 현재 위치의 신호를 주기적으로 백엔드에 측정 요청(폰처럼).
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import * as api from '../api'
import { buildAttachSteps, buildHandoverSteps, buildMroFailureSteps } from '../attach'
import { LOGT, pick } from '../i18n'
import { useStore } from '../store'
import type { SceneObject, Zone } from '../types'
import {
  UPF_CAPACITY_PER_POD_MBPS,
  ZONES,
  computeE2E,
  computeRoamingPath,
  defaultImsi,
  ranChainOk,
  ranChainText,
  suciOf,
  trafficInfo,
  zoneOffset,
  zoneOfPoint,
} from '../types'

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// 걷기 시작 위치/바라볼 지점 해석.
// 시점 중앙의 지면 지점이 실제 존 안이면 그대로, 우주공간이면 가장 가까운 존으로 스냅.
// 바라볼 지점(look)은 그 존의 가장 가까운 장비/사람(없으면 존 중심)으로 → 항상 무언가를 보게.
function resolveWalkStart(
  gx: number,
  gz: number,
  w: number,
  d: number,
  objects: SceneObject[],
): { pos: [number, number]; look: [number, number]; zone: Zone } {
  // 대상 존 결정 (지면점이 든 존, 없으면 가장 가까운 존)
  let zone: Zone | null = zoneOfPoint(gx, gz, w, d)
  let px = gx
  let pz = gz
  if (!zone) {
    let bestD = Infinity
    for (const zn of ZONES) {
      const [ox, oz] = zoneOffset(zn, w, d)
      const cx = clamp(gx, ox + 2, ox + w - 2)
      const cz = clamp(gz, oz + 2, oz + d - 2)
      const dd = (gx - cx) ** 2 + (gz - cz) ** 2
      if (dd < bestD) {
        bestD = dd
        zone = zn
        px = cx
        pz = cz
      }
    }
  } else {
    const [ox, oz] = zoneOffset(zone, w, d)
    px = clamp(gx, ox + 2, ox + w - 2)
    pz = clamp(gz, oz + 2, oz + d - 2)
  }
  const z = zone ?? 'A'
  const [ox, oz] = zoneOffset(z, w, d)
  // 바라볼 지점: 존 내 가장 가까운 RU(없으면 사람, 없으면 존 중심)
  const inZone = objects.filter((o) => (o.zone ?? 'A') === z)
  const gnbs = inZone.filter((o) => o.kind === 'gnb')
  const pool = gnbs.length ? gnbs : inZone.filter((o) => o.kind === 'person')
  let look: [number, number] = [ox + w / 2, oz + d / 2]
  if (pool.length) {
    let bestD = Infinity
    for (const o of pool) {
      const wx = o.position[0] + ox
      const wz = o.position[2] + oz
      const dd = (wx - px) ** 2 + (wz - pz) ** 2
      if (dd < bestD && dd > 0.5) {
        bestD = dd
        look = [wx, wz]
      }
    }
  }
  return { pos: [px, pz], look, zone: z }
}

// 존 중심에서 걷기 시작 (지역 이동 시)
function zoneCenterStart(zone: Zone, w: number, d: number, objects: SceneObject[]) {
  const [ox, oz] = zoneOffset(zone, w, d)
  return resolveWalkStart(ox + w / 2, oz + d / 2, w, d, objects)
}

const EYE_HEIGHT = 1.5
const SPEED = 4.0 // m/s
const RUN_MULT = 2.2
const JUMP_VEL = 4.2 // m/s
const GRAVITY = 9.8

export function FirstPerson() {
  const camera = useThree((s) => s.camera)
  const space = useStore((s) => s.space)
  const keys = useRef<Record<string, boolean>>({})
  const lastProbe = useRef(0)
  const probing = useRef(false)
  const wasWeak = useRef(false)
  const wasOverload = useRef(false)
  const wasAgc = useRef(false)
  const wasRach = useRef(false)
  const wasCallDrop = useRef(false)
  const wasRanFail = useRef(false) // 걷는 UE 서빙셀 RAN 경로 단절 상태 (전이 시에만 로깅)
  const wasCoreFail = useRef(false) // 걷는 UE 존 코어(E2E) 미도달 상태 (전이 시에만 로깅)
  const velY = useRef(0)
  const grounded = useRef(true)
  // A3/A2/RLF 이동성 상태
  const servingId = useRef<string | null>(null)
  const a3Since = useRef<number | null>(null)
  const wasA2 = useRef(false)
  const rlfSince = useRef<number | null>(null)
  const n310Count = useRef(0) // RLF: 연속 out-of-sync 지시 누적 (n310 도달 시에만 T310 무장, TS 38.331 §5.3.10.3)
  const n311Count = useRef(0) // RLF: 연속 in-sync 지시 누적 (n311 도달 시 out-of-sync/T310 리셋)
  const t304Since = useRef<number | null>(null) // 핸드오버 실행 타이머(T304): 타겟 동기 획득 창
  const t304Src = useRef<{ id: string; name: string } | null>(null) // T304 실패 시 재수립할 소스 셀
  // 신규 이동성/측정 파라미터 상태 (TS 38.331/38.300/38.322)
  const rsrpEma = useRef<Map<string, number>>(new Map()) // L3 필터 EMA F=(1−a)F_prev+a·M (§5.5.3.2)
  const a4Seen = useRef<Set<string>>(new Set()) // A4: 리포트 대상 진입 디듑(셀별) (§5.5.4.5)
  const a5Since = useRef<number | null>(null) // A5 TTT 타이머 (§5.5.4.6)
  const prevServing = useRef<string | null>(null) // 직전 서빙셀 (핑퐁 역방향 HO 차단, MRO §9.2.6)
  const lastHoAt = useRef(0) // 마지막 HO 시각 (MRO 최소 체류)
  const t311Since = useRef<number | null>(null) // RRC 재수립 타이머 T311 (§5.3.7)
  const rrcIdle = useRef(false) // T311 만료 → RRC_IDLE (연결 상실)
  const rlcRetxCount = useRef(0) // RLC AM 연속 재전송 초과 카운터 → RLF (TS 38.322 §5.3.2)
  // 신규 이동성 파라미터 상태 (Batch3): A1/CHO/셀재선택/측정갭/보고주기
  const wasA1 = useRef(false) // A1: 서빙>임계 진입 디듑 (TS 38.331 §5.5.4.4, A2의 보수)
  const choCandidate = useRef<{ id: string; name: string } | null>(null) // CHO 준비된 후보 (§5.3.5.13)
  const campedId = useRef<string | null>(null) // RRC_IDLE 중 카밍(camp)한 셀 (TS 38.304 §5.2.4)
  const reselSince = useRef<number | null>(null) // 셀 재선택 체류 타이머 Treselection 시작 시각
  const lastGapIdx = useRef(-1) // 측정 갭 윈도우 인덱스 (갭당 1회 로깅 디듑, TS 38.133)
  const lastReportAt = useRef(0) // 마지막 주기적 측정보고 로그 시각 (report_interval 스로틀, §5.5.5)
  const activeZone = useRef<Zone>('A') // 현재 걷고 있는 존 (이 존 경계 안으로 클램프)
  const gotoZoneReq = useStore((s) => s.gotoZoneReq)

  useEffect(() => {
    // 현재 보던 시점 중앙의 지면 지점에서 걷기 시작 (우주공간이면 가장 가까운 존으로 스냅)
    const camPos = camera.position.clone()
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    let gx = camPos.x
    let gz = camPos.z
    if (fwd.y < -0.05) {
      const t = (EYE_HEIGHT - camPos.y) / fwd.y
      gx = camPos.x + fwd.x * t
      gz = camPos.z + fwd.z * t
    }
    const { objects } = useStore.getState()
    const { pos, look, zone } = resolveWalkStart(gx, gz, space.width, space.depth, objects)
    activeZone.current = zone
    camera.position.set(pos[0], EYE_HEIGHT, pos[1])
    // 항상 가까운 장비/존 중심을 수평으로 바라보게 (검은 허공 방지)
    camera.lookAt(look[0], EYE_HEIGHT, look[1])

    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true
    }
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [camera, space])

  // 지역 이동 요청 → 해당 존 중심으로 순간 이동
  useEffect(() => {
    if (!gotoZoneReq) return
    const { objects } = useStore.getState()
    const { pos, look, zone } = zoneCenterStart(gotoZoneReq.zone, space.width, space.depth, objects)
    activeZone.current = zone
    camera.position.set(pos[0], EYE_HEIGHT, pos[1])
    camera.lookAt(look[0], EYE_HEIGHT, look[1])
  }, [gotoZoneReq, camera, space])

  useFrame((state, dt) => {
    const k = keys.current
    const dir = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0))

    if (k['KeyW'] || k['ArrowUp']) dir.add(fwd)
    if (k['KeyS'] || k['ArrowDown']) dir.sub(fwd)
    if (k['KeyD'] || k['ArrowRight']) dir.add(right)
    if (k['KeyA'] || k['ArrowLeft']) dir.sub(right)

    if (dir.lengthSq() > 0) {
      dir.normalize()
      const speed = SPEED * (k['ShiftLeft'] || k['ShiftRight'] ? RUN_MULT : 1)
      camera.position.addScaledVector(dir, speed * Math.min(dt, 0.05))
    }
    // 현재 존 경계 안으로 클램프 — 우주공간(존 밖)으로 못 나감. 이동은 지역이동 버튼으로.
    const [zox, zoz] = zoneOffset(activeZone.current, space.width, space.depth)
    camera.position.x = clamp(camera.position.x, zox + 0.5, zox + space.width - 0.5)
    camera.position.z = clamp(camera.position.z, zoz + 0.5, zoz + space.depth - 0.5)

    // 점프 (Space)
    const step = Math.min(dt, 0.05)
    if (k['Space'] && grounded.current) {
      velY.current = JUMP_VEL
      grounded.current = false
    }
    if (!grounded.current) {
      camera.position.y += velY.current * step
      velY.current -= GRAVITY * step
      if (camera.position.y <= EYE_HEIGHT) {
        camera.position.y = EYE_HEIGHT
        velY.current = 0
        grounded.current = true
      }
    } else {
      camera.position.y = EYE_HEIGHT
    }

    // 존 판정 + 로밍 이벤트 (홈은 store.homeZone 기준)
    const st0 = useStore.getState()
    const home = st0.homeZone
    const curZone = zoneOfPoint(camera.position.x, camera.position.z, space.width, space.depth)
    if (curZone !== st0.ueZone) {
      const L0 = LOGT[st0.lang]
      if (curZone === null) {
        st0.addEvent('UE', 'warn', L0.border)
        st0.setProbe(null)
      } else if (curZone !== home) {
        st0.addEvent('UE', 'info', L0.roam_in(curZone, home))
        st0.addEvent('UE', 'info', `Registration Request (VPLMN-${curZone}) → SUCI: ${suciOf(st0.ueSim)}`)
      } else if (st0.ueZone !== null) {
        st0.addEvent('UE', 'info', L0.roam_out(home))
      }
      // SECTION A: TAI(존) 변경 + 이미 등록된 UE → Mobility Registration Update (TS 24.501 §5.5.1.3).
      // active-flag/PDU-session-status로 사용자평면 재활성. (초기 등록/무서비스 진입 시엔 생략)
      if (curZone !== null && st0.ueZone !== null && st0.ueOn) {
        const z = curZone
        const nf = (t: string) =>
          st0.coreNfs.find((n) => n.zone === z && n.nf_type === t && n.enabled)?.name ?? null
        const ru0 = st0.objects.find(
          (o) => o.kind === 'gnb' && (o.zone ?? 'A') === z && o.gnb?.enabled !== false,
        )
        if (ru0 && nf('AMF')) {
          const steps = buildAttachSteps({
            ueName: 'UE', servingName: ru0.name, pci: ru0.gnb?.pci ?? null,
            plmn: `${st0.ueSim.mcc}/${st0.ueSim.mnc}`, tac: '1', ueIp: '10.45.0.2',
            amf: nf('AMF'), ausf: nf('AUSF'), udm: nf('UDM'), smf: nf('SMF'), upf: nf('UPF'),
            dn: st0.coreDn[z], zone: z, imsiRegistered: true, regType: 'mobility',
            requestedSst: [1], allowedSst: [1],
          })
          for (const s of steps) st0.addEvent(s.source, s.level, s.msg, s.node, s.dir, defaultImsi(st0.ueSim), s.from, s.to)
        }
      }
      st0.setUeZone(curZone)
      servingId.current = null // 국가 이동 → 셀 재선택
      a3Since.current = null
    }

    // 4Hz로 현재 위치 신호 측정 (전원 켜짐 + 존 내부일 때)
    const now = state.clock.elapsedTime
    if (
      now - lastProbe.current > 0.25 &&
      !probing.current &&
      useStore.getState().ueOn &&
      curZone !== null
    ) {
      const dtProbe = now - lastProbe.current
      lastProbe.current = now
      probing.current = true
      const stNow = useStore.getState()
      const { objects, space: sp } = stNow
      const [ox, oz] = zoneOffset(curZone, sp.width, sp.depth)
      // 현재 트래픽 5QI + 서빙셀 부하를 QoS 지표 산출에 전달
      const ti0 = trafficInfo(stNow.trafficType)
      const servLoad = stNow.probe?.serving
        ? (stNow.nfLoads[stNow.probe.serving]?.load ?? 0)
        : 0
      api
        .probe(
          objects, sp, curZone,
          [camera.position.x - ox, camera.position.y, camera.position.z - oz],
          stNow.ceiling,
          stNow.trafficActive ? ti0.fiveqi : 9,
          stNow.trafficActive ? servLoad : 0,
        )
        .then((p) => {
          const st = useStore.getState()
          const L = LOGT[st.lang]

          // A3 핸드오버 + CIO(셀별 오프셋) + A2 이벤트 + RLF(T310)
          const {
            a3_offset_db, hysteresis_db, ttt_ms, rlf_rsrp_dbm,
            q_hyst_db, t_reselection_s,
            // per-cell 오버라이드 대상은 전역값을 g_* 로 받아 아래에서 서빙셀 우선 해석.
            a2_threshold_dbm: g_a2_threshold_dbm, t310_ms: g_t310_ms,
            t311_ms: g_t311_ms, a4_threshold_dbm: g_a4_threshold_dbm,
            a5_thresh1_dbm: g_a5_thresh1_dbm, a5_thresh2_dbm: g_a5_thresh2_dbm,
            filter_coef_k: g_filter_coef_k, pingpong_min_stay_ms: g_pingpong_min_stay_ms,
            rlc_max_retx: g_rlc_max_retx, a1_threshold_dbm: g_a1_threshold_dbm,
            cho_exec_offset_db: g_cho_exec_offset_db,
            gap_period_ms: g_gap_period_ms, gap_length_ms: g_gap_length_ms,
            report_interval_ms: g_report_interval_ms,
          } = st.mobility
          // PART 15c: 서빙 gNB의 per-cell 이동성/측정 오버라이드를 틱당 1회 해석(미지정 → 전역 mobility 폴백).
          // (TS 38.331 measConfig/reportConfig) — a3(아래 ~599)와 동일 "servGnb?.x ?? 전역" 패턴을 나머지 필드로 확장.
          // 서빙셀(현재 UE가 카밍/접속한 셀, id===servingId)의 설정이 이겨야 셀별 튜닝이 실효화된다.
          const servGnb = st.objects.find((o) => o.kind === 'gnb' && o.id === servingId.current)?.gnb
          const a2_threshold_dbm = servGnb?.a2_threshold_dbm ?? g_a2_threshold_dbm
          const a1_threshold_dbm = servGnb?.a1_threshold_dbm ?? g_a1_threshold_dbm
          const a4_threshold_dbm = servGnb?.a4_threshold_dbm ?? g_a4_threshold_dbm
          const a5_thresh1_dbm = servGnb?.a5_thresh1_dbm ?? g_a5_thresh1_dbm
          const a5_thresh2_dbm = servGnb?.a5_thresh2_dbm ?? g_a5_thresh2_dbm
          const t310_ms = servGnb?.t310_ms ?? g_t310_ms
          const t311_ms = servGnb?.t311_ms ?? g_t311_ms
          const filter_coef_k = servGnb?.filter_coef_k ?? g_filter_coef_k
          const rlc_max_retx = servGnb?.rlc_max_retx ?? g_rlc_max_retx
          const cho_exec_offset_db = servGnb?.cho_exec_offset_db ?? g_cho_exec_offset_db
          const pingpong_min_stay_ms = servGnb?.pingpong_min_stay_ms ?? g_pingpong_min_stay_ms
          const gap_period_ms = servGnb?.gap_period_ms ?? g_gap_period_ms
          const gap_length_ms = servGnb?.gap_length_ms ?? g_gap_length_ms
          const report_interval_ms = servGnb?.report_interval_ms ?? g_report_interval_ms
          // 주기적 측정보고 로그 스로틀 (TS 38.331 §5.5.5): A-이벤트 리포트 로그를 report_interval_ms당 1회로.
          // 성공 시에만 마지막 보고 시각을 갱신 → 스로틀에 막힌 리포트는 다음 틱에 재시도.
          const canReport = () => {
            const nowMs = performance.now()
            if (nowMs - lastReportAt.current >= (report_interval_ms ?? 240)) {
              lastReportAt.current = nowMs
              return true
            }
            return false
          }
          // 측정 갭 (TS 38.133): gap_period_ms>0이면 주기적 갭 윈도우. 갭 구간(각 주기의 앞 gap_length_ms)에서는
          // DL/UL 중단(갭당 1회 디듑 로깅) + 이 틱의 서빙 데이터 스케줄링 스킵. 기본 0 = OFF(갭 없음 → 무차단).
          let inGap = false
          if ((gap_period_ms ?? 0) > 0 && (gap_length_ms ?? 0) > 0) {
            const nowMs = performance.now()
            if (nowMs % gap_period_ms < gap_length_ms) {
              inGap = true
              const gapIdx = Math.floor(nowMs / gap_period_ms)
              if (lastGapIdx.current !== gapIdx) {
                lastGapIdx.current = gapIdx
                st.addEvent('UE', 'info',
                  pick(st.lang,
                    `측정 갭 — DL/UL 중단 ${gap_length_ms}ms (주기 ${gap_period_ms}ms, inter-freq/inter-RAT 측정용)`,
                    `Measurement gap — DL/UL interrupted ${gap_length_ms}ms (period ${gap_period_ms}ms, for inter-freq/inter-RAT meas)`,
                    `测量间隙 — DL/UL 中断 ${gap_length_ms}ms(周期 ${gap_period_ms}ms,用于异频/异系统测量)`),
                  undefined, undefined, defaultImsi(st.ueSim))
              }
            }
          }
          // 셀별 CIO 반영된 유효 RSRP (셀 경계 조정)
          const cioOf = (id?: string) =>
            st.objects.find((o) => o.kind === 'gnb' && o.id === id)?.gnb?.cio_db ?? 0
          // L3 필터링 (TS 38.331 §5.5.3.2): 셀별 RSRP를 EMA로 평활 후 A2/A3/A4/A5 평가에 사용.
          // a = 1/2^(k/4). k↑ → 강한 평활(느린·늦은 HO), k↓ → 노이즈(핑퐁). 첫 샘플은 raw.
          const aCoef = 1 / Math.pow(2, (filter_coef_k ?? 4) / 4)
          const seenIds = new Set<string>()
          for (const c of p.cells) {
            seenIds.add(c.id)
            const prev = rsrpEma.current.get(c.id)
            rsrpEma.current.set(
              c.id,
              prev === undefined ? c.rsrp_dbm : (1 - aCoef) * prev + aCoef * c.rsrp_dbm,
            )
          }
          for (const id of [...rsrpEma.current.keys()]) if (!seenIds.has(id)) rsrpEma.current.delete(id)
          // 필터 RSRP (없으면 raw 폴백)
          const fr = (c?: { id: string; rsrp_dbm: number }) =>
            c ? (rsrpEma.current.get(c.id) ?? c.rsrp_dbm) : Number.NaN
          const cur = p.cells.find((c) => c.id === servingId.current)
          const best = p.cells.reduce(
            (a, b) =>
              fr(b) + cioOf(b.id) > (a ? fr(a) + cioOf(a.id) : -999) ? b : a,
            undefined as (typeof p.cells)[number] | undefined,
          )

          const koL = st.lang === 'ko'
          // A2: 서빙 RSRP가 임계 이하로 떨어지면 측정 시작 이벤트 (핸드오버 준비)
          if (cur) {
            const curF = Math.round(fr(cur))
            if (fr(cur) < a2_threshold_dbm && !wasA2.current) {
              wasA2.current = true
              st.addEvent('UE', 'info',
                koL
                  ? `A2 이벤트 — 서빙 ${cur.name} RSRP ${curF} < ${a2_threshold_dbm}dBm, 측정/HO 준비`
                  : `A2 event — serving ${cur.name} RSRP ${curF} < ${a2_threshold_dbm}dBm, start measurement/HO`)
            } else if (fr(cur) > a2_threshold_dbm + 3) {
              wasA2.current = false
            }
            // A1 이벤트 (TS 38.331 §5.5.4.4, A2의 보수): 서빙(필터) RSRP가 임계 초과로 회복 →
            // "서빙 양호 → inter-freq/inter-RAT 측정 중단" 측정제어 리포트(HO 아님). 진입 시 디듑,
            // report_interval 스로틀, 히스테리시스(임계-3dB)로 이탈 시 재무장.
            if (fr(cur) > a1_threshold_dbm) {
              if (!wasA1.current && canReport()) {
                wasA1.current = true
                st.addEvent('UE', 'info',
                  pick(st.lang,
                    `A1 이벤트 — 서빙 ${cur.name} RSRP ${curF} > ${a1_threshold_dbm}dBm, 서빙 양호 → inter-freq/inter-RAT 측정 중단(측정제어)`,
                    `A1 event — serving ${cur.name} RSRP ${curF} > ${a1_threshold_dbm}dBm, serving good → stop inter-freq/inter-RAT measurements (measurement control)`,
                    `A1 事件 — 服务 ${cur.name} RSRP ${curF} > ${a1_threshold_dbm}dBm,服务良好 → 停止异频/异系统测量(测量控制)`),
                  undefined, undefined, defaultImsi(st.ueSim))
              }
            } else if (fr(cur) < a1_threshold_dbm - 3) {
              wasA1.current = false
            }
          }

          // A4 이벤트 (TS 38.331 §5.5.4.5): 이웃(필터) RSRP > a4_threshold → 측정 리포트 트리거.
          // HO를 강제하진 않음(리포트 트리거). 조건 진입 시에만 로깅(디듑), 3dB 히스테리시스로 이탈 시 재무장.
          for (const c of p.cells) {
            if (c.id === servingId.current) continue
            if (fr(c) > a4_threshold_dbm) {
              if (!a4Seen.current.has(c.id) && canReport()) {
                a4Seen.current.add(c.id)
                st.addEvent('UE', 'info',
                  pick(st.lang,
                    `A4 이벤트 — 이웃 ${c.name} RSRP ${Math.round(fr(c))}dBm > ${a4_threshold_dbm}dBm, 측정 리포트(리포트 대상 진입)`,
                    `A4 event — neighbor ${c.name} RSRP ${Math.round(fr(c))}dBm > ${a4_threshold_dbm}dBm, measurement report (became report-worthy)`,
                    `A4 事件 — 邻区 ${c.name} RSRP ${Math.round(fr(c))}dBm > ${a4_threshold_dbm}dBm,测量报告(进入可报告)`),
                  undefined, undefined, defaultImsi(st.ueSim))
              }
            } else if (fr(c) < a4_threshold_dbm - 3) {
              a4Seen.current.delete(c.id)
            }
          }

          // T304: 핸드오버 실행 타이머 (TS 38.331 ReconfigurationWithSync / TS 38.300 §9.2.6).
          // HO 직후 t304_ms 창 안에서 타겟(신 서빙) RSRP가 rlf 임계 이하이면 = 죽어가는 셀로 HO / 타겟 RACH 실패
          // → Handover Failure → RRC 재수립(too-early, 소스로 복귀). 창을 정상적으로 넘기면 동기 성공으로 해제.
          // t304 너무 작으면 spurious HO 실패, 너무 크면 죽은 타겟에 계속 동기 시도.
          if (t304Since.current !== null) {
            const nowMs = performance.now()
            const t304Ms = servGnb?.t304_ms ?? st.mobility.t304_ms ?? 500
            const tgtCell = p.cells.find((c) => c.id === servingId.current)
            const src = t304Src.current
            if (tgtCell && tgtCell.rsrp_dbm < rlf_rsrp_dbm) {
              const amfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'AMF' && n.enabled)
              const failSteps = buildMroFailureSteps(
                { ueName: 'UE', sourceRu: src?.name ?? tgtCell.name, targetRu: tgtCell.name,
                  amf: amfNf?.name ?? null, t310Ms: t310_ms, t304Ms },
                'too-early',
              )
              const t304Imsi = defaultImsi(st.ueSim)
              for (const fs of failSteps) st.addEvent(fs.source, fs.level, fs.msg, fs.node, fs.dir, t304Imsi, fs.from, fs.to)
              st.addEvent('UE', 'error',
                pick(st.lang,
                  `T304 ${t304Ms}ms 내 HO 실패 — 타겟 ${tgtCell.name} 동기 실패(RSRP ${tgtCell.rsrp_dbm}dBm < ${rlf_rsrp_dbm}), RRC 재수립(소스 복귀)`,
                  `T304 ${t304Ms}ms HO failure — target ${tgtCell.name} sync failed (RSRP ${tgtCell.rsrp_dbm}dBm < ${rlf_rsrp_dbm}), RRC re-establishment (revert to source)`,
                  `T304 ${t304Ms}ms 切换失败 — 目标 ${tgtCell.name} 同步失败(RSRP ${tgtCell.rsrp_dbm}dBm < ${rlf_rsrp_dbm}),RRC 重建(回退源)`),
                undefined, undefined, t304Imsi)
              servingId.current = src?.id ?? servingId.current // 소스로 재수립
              t304Since.current = null
              t304Src.current = null
              a3Since.current = null
            } else if (nowMs - t304Since.current >= t304Ms) {
              // 창 경과 + 타겟 정상 → 동기 성공, 타이머 해제
              t304Since.current = null
              t304Src.current = null
            }
          }

          // RLF 선언 공통 경로 → T311(재수립 창) 시작. 물리계층(T310)·RLC(재전송 초과)가 공유.
          // 즉시 재선택하지 않고 T311 창에서 적합 셀 탐색; 미발견 시 RRC_IDLE. (TS 38.331 §5.3.7)
          const declareRlf = (msg: string) => {
            st.addEvent('UE', 'warn', msg)
            rlfSince.current = null
            n310Count.current = 0
            n311Count.current = 0
            rlcRetxCount.current = 0
            a3Since.current = null
            if (t311Since.current === null) t311Since.current = performance.now()
          }

          // RLF: 서빙 RSRP가 rlf_rsrp_dbm 이하로 n310회 연속(out-of-sync) → T310 무장,
          // T310 만료까지 지속되면 Radio Link Failure → RRC 재수립. n311회 연속 in-sync면 T310 정지.
          // (TS 38.331 §5.3.10.3) — n310↑ → RLF 느리게 선언(페이드 관용), 너무 낮으면 spurious RLF.
          const n310Max = servGnb?.n310 ?? st.mobility.n310
          const n311Max = servGnb?.n311 ?? st.mobility.n311 ?? 1
          // 이미 재수립(T311)/유휴 상태면 RLF 재판정 억제(재진입 방지)
          if (t311Since.current === null && !rrcIdle.current) {
            if (cur && cur.rsrp_dbm < rlf_rsrp_dbm) {
              n311Count.current = 0
              const nowMs = performance.now()
              if (rlfSince.current === null) {
                // 아직 T310 미무장 — out-of-sync 누적, n310 도달 시에만 무장
                n310Count.current += 1
                if (n310Count.current >= n310Max) rlfSince.current = nowMs
              } else if (nowMs - rlfSince.current >= t310_ms) {
                declareRlf(
                  koL
                    ? `RLF (N310 ${n310Max} out-of-sync → T310 ${t310_ms}ms 만료) — ${cur.name} 무선링크 실패, RRC 재수립(T311) 시도`
                    : `RLF (N310 ${n310Max} out-of-sync → T310 ${t310_ms}ms expired) — ${cur.name} radio link failure, RRC re-establishment (T311)`)
              }
            } else if (cur) {
              // in-sync 지시 누적 — n311회 연속이면 out-of-sync 카운트/T310 리셋(무장 해제)
              n311Count.current += 1
              if (n311Count.current >= n311Max) {
                n310Count.current = 0
                rlfSince.current = null
              }
            } else {
              n310Count.current = 0
              n311Count.current = 0
              rlfSince.current = null
            }
            // RLC AM 재전송 초과 병렬 RLF (TS 38.322 §5.3.2): 필터 서빙 RSRP가 rlf 임계보다 크게 낮은
            // 고손실 구간이 rlc_max_retx 틱 연속 지속 → maxRetxThreshold 도달 → RLF. DL Qout/T310과 독립.
            const rlcMax = rlc_max_retx ?? 8
            if (t311Since.current === null && cur && fr(cur) < rlf_rsrp_dbm - 6) {
              rlcRetxCount.current += 1
              if (rlcRetxCount.current >= rlcMax) {
                declareRlf(
                  koL
                    ? `RLF (RLC AM maxRetx ${rlcMax} 초과 — ${cur.name} 상향 재전송 실패 ${rlcRetxCount.current}틱 누적, 고손실 링크) → RRC 재수립(T311)`
                    : `RLF (RLC AM maxRetx ${rlcMax} exceeded — ${cur.name} sustained retransmission failures over ${rlcRetxCount.current} ticks) → RRC re-establishment (T311)`)
              }
            } else if (!cur || fr(cur) >= rlf_rsrp_dbm - 6) {
              rlcRetxCount.current = 0
            }
          }

          // T311 (TS 38.331 §5.3.7): RLF 후 재수립 창. 적합 셀(best 필터 RSRP ≥ rlf 임계) 발견 → 재수립,
          // t311_ms 내 미발견 → RRC_IDLE(연결 상실, 트래픽/통화 중단). t311↑ → 유휴 전이 느림.
          if (t311Since.current !== null) {
            const nowMs = performance.now()
            const suitable = best && fr(best) >= rlf_rsrp_dbm ? best : null
            if (suitable) {
              st.addEvent('UE', 'info',
                pick(st.lang,
                  `RRC 재수립 성공 — 적합 셀 ${suitable.name}(RSRP ${Math.round(fr(suitable))}dBm) 선택, 연결 복구`,
                  `RRC re-establishment success — suitable cell ${suitable.name} (RSRP ${Math.round(fr(suitable))}dBm), connection restored`,
                  `RRC 重建成功 — 合适小区 ${suitable.name}(RSRP ${Math.round(fr(suitable))}dBm),连接恢复`),
                undefined, undefined, defaultImsi(st.ueSim))
              servingId.current = suitable.id
              t311Since.current = null
              rrcIdle.current = false
              a3Since.current = null
            } else if (nowMs - t311Since.current >= (t311_ms ?? 1000)) {
              const idleImsi = defaultImsi(st.ueSim)
              if (st.call && st.call.phase === 'active') st.endCall()
              if (st.trafficActive) st.toggleTraffic()
              st.addEvent('UE', 'error',
                pick(st.lang,
                  `T311 ${t311_ms ?? 1000}ms 만료 → RRC_IDLE, 연결 상실 — 적합 셀 없음, 트래픽/통화 중단`,
                  `T311 ${t311_ms ?? 1000}ms expiry → RRC_IDLE, connection lost — no suitable cell, traffic/call stopped`,
                  `T311 ${t311_ms ?? 1000}ms 到期 → RRC_IDLE,连接丢失 — 无合适小区,流量/通话中断`),
                undefined, undefined, idleImsi)
              servingId.current = null
              t311Since.current = null
              rrcIdle.current = true
            }
          }

          // RRC_IDLE 셀 재선택 (TS 38.304 §5.2.4): 유휴 중 카밍 셀을 관리. 즉시 재카밍이 아니라
          // 이웃(필터) RSRP가 카밍셀 + q_hyst_db를 t_reselection_s 이상 지속 초과해야 재선택. 카밍셀이
          // 연결 임계(rlf) 이상으로 회복하면 RRC_IDLE 해제 후 재접속. (히스테리시스+체류로 핑퐁 억제)
          if (rrcIdle.current) {
            let camped = campedId.current ? p.cells.find((c) => c.id === campedId.current) : undefined
            if (!camped && best) {
              // 초기 카밍: 최강 셀에 카밍
              campedId.current = best.id
              reselSince.current = null
              camped = best
            } else if (camped) {
              // 재선택 평가: 카밍셀보다 q_hyst 이상 강한 최강 이웃을 Treselection 동안 유지
              const rn = p.cells.reduce(
                (a, b) => (b.id !== camped!.id && fr(b) > (a ? fr(a) : -999) ? b : a),
                undefined as (typeof p.cells)[number] | undefined,
              )
              if (rn && fr(rn) > fr(camped) + q_hyst_db) {
                const nowMs = performance.now()
                if (reselSince.current === null) reselSince.current = nowMs
                if (nowMs - reselSince.current >= (t_reselection_s ?? 1) * 1000) {
                  campedId.current = rn.id
                  reselSince.current = null
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `셀 재선택 — ${camped.name} → ${rn.name}(RSRP ${Math.round(fr(rn))} > ${Math.round(fr(camped))}+Qhyst ${q_hyst_db}dB, Treselection ${t_reselection_s ?? 1}s 지속)`,
                      `Cell reselection — ${camped.name} → ${rn.name} (RSRP ${Math.round(fr(rn))} > ${Math.round(fr(camped))}+Qhyst ${q_hyst_db}dB, sustained Treselection ${t_reselection_s ?? 1}s)`,
                      `小区重选 — ${camped.name} → ${rn.name}(RSRP ${Math.round(fr(rn))} > ${Math.round(fr(camped))}+Qhyst ${q_hyst_db}dB,持续 Treselection ${t_reselection_s ?? 1}s)`),
                    undefined, undefined, defaultImsi(st.ueSim))
                  camped = rn
                }
              } else {
                reselSince.current = null
              }
            }
            // 카밍 셀이 연결 임계 이상으로 회복 → RRC_IDLE 해제, 재접속(연결 재수립)
            if (camped && fr(camped) >= rlf_rsrp_dbm) {
              st.addEvent('UE', 'info',
                pick(st.lang,
                  `RRC_IDLE 해제 — 카밍 셀 ${camped.name}(RSRP ${Math.round(fr(camped))}dBm) 적합, 재접속`,
                  `RRC_IDLE cleared — camped cell ${camped.name} (RSRP ${Math.round(fr(camped))}dBm) suitable, reconnecting`,
                  `RRC_IDLE 解除 — 驻留小区 ${camped.name}(RSRP ${Math.round(fr(camped))}dBm) 合适,重新接入`),
                undefined, undefined, defaultImsi(st.ueSim))
              servingId.current = camped.id
              rrcIdle.current = false
              campedId.current = null
              reselSince.current = null
              a3Since.current = null
            }
          }

          // MRO 핑퐁 가드 (TS 38.300 §9.2.6): 역방향(직전 서빙셀로) HO가 최소 체류시간 내면 억제.
          let didHo = false
          const pingpongBlocked = (targetId: string, nowMs: number) =>
            targetId === prevServing.current && nowMs - lastHoAt.current < (pingpong_min_stay_ms ?? 1000)

          // RRC_IDLE 중에는 재선택/A3를 건너뜀(유휴 유지 — 위의 적합셀 재출현 로직으로만 복귀).
          if (rrcIdle.current) {
            // 유휴: 서빙 없음
          } else if (!cur || !servingId.current) {
            if (best) { servingId.current = best.id; a3Since.current = null }
          } else if (best && best.id !== cur.id) {
            const bEff = fr(best) + cioOf(best.id)
            const cEff = fr(cur) + cioOf(cur.id)
            // PART 15b: A3 파라미터를 서빙셀 자체 설정 우선(없으면 글로벌 폴백) — 셀별 튜닝 실효화.
            // (TS 38.331 measObject/reportConfig, cellIndividualOffset) — 오설정 이웃 CIO/offset → 오셀 HO.
            // servGnb는 틱 상단에서 servingId(===cur.id) 기준으로 이미 해석됨(재선언 불필요).
            const a3Off = servGnb?.a3_offset_db ?? a3_offset_db
            const a3Hys = servGnb?.hysteresis_db ?? hysteresis_db
            const a3Ttt = servGnb?.ttt_ms ?? ttt_ms
            if (bEff > cEff + a3Off + a3Hys) {
              const nowMs = performance.now()
              if (a3Since.current === null) a3Since.current = nowMs
              if (nowMs - a3Since.current >= a3Ttt) {
                if (pingpongBlocked(best.id, nowMs)) {
                  // MRO: 직전 서빙셀로의 역방향 A3 HO를 최소 체류시간 내 억제 → ping-pong 방지.
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `A3 HO 억제 — ${best.name}로 역방향 핸드오버, 최소 체류 ${pingpong_min_stay_ms ?? 1000}ms 미충족(ping-pong 방지)`,
                      `A3 HO suppressed — reverse handover to ${best.name} within min-stay ${pingpong_min_stay_ms ?? 1000}ms (ping-pong guard)`,
                      `A3 切换抑制 — 回退到 ${best.name} 未满足最小驻留 ${pingpong_min_stay_ms ?? 1000}ms(防乒乓)`),
                    undefined, undefined, defaultImsi(st.ueSim))
                  a3Since.current = null
                } else {
                  // PART 15: A3 조건이 TTT 동안 유지 → 실제 핸드오버 call flow 방출 후 셀 전환.
                  // 파라미터(a3_offset/hysteresis/TTT/CIO)가 발동 시점을 실제 결정한다.
                  const srcObj = st.objects.find((o) => o.kind === 'gnb' && o.id === cur.id)
                  const tgtObj = st.objects.find((o) => o.kind === 'gnb' && o.id === best.id)
                  const amfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'AMF' && n.enabled)
                  const upfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'UPF' && n.enabled)
                  st.addEvent('UE', 'info',
                    `${L.handover(cur.name, best.name, best.rsrp_dbm)} [A3 off=${a3Off} hys=${a3Hys} TTT=${a3Ttt}ms CIO=${cioOf(best.id)}dB]`)
                  const hoSteps = buildHandoverSteps({
                    ueName: 'UE',
                    sourceRu: cur.name, targetRu: best.name,
                    amf: amfNf?.name ?? null, upf: upfNf?.name ?? null,
                    sourcePci: srcObj?.gnb?.pci ?? null, targetPci: tgtObj?.gnb?.pci ?? null,
                    targetRsrp: best.rsrp_dbm, a3Offset: a3Off, hysteresis: a3Hys,
                    tttMs: a3Ttt, cioDb: cioOf(best.id),
                  })
                  const hoImsi = defaultImsi(st.ueSim)
                  for (const hs of hoSteps) st.addEvent(hs.source, hs.level, hs.msg, hs.node, hs.dir, hoImsi, hs.from, hs.to)
                  prevServing.current = cur.id // MRO: 역방향 HO 차단용 직전 서빙셀 기록
                  lastHoAt.current = nowMs
                  servingId.current = best.id
                  didHo = true
                  a3Since.current = null
                  // T304 실행 타이머 시작(ReconfigurationWithSync) — 다음 틱부터 타겟 동기 획득 감시.
                  t304Since.current = performance.now()
                  t304Src.current = { id: cur.id, name: cur.name }
                }
              }
            } else {
              a3Since.current = null
            }
          } else {
            a3Since.current = null
          }

          // A5 이벤트 (TS 38.331 §5.5.4.6): 서빙(필터) < thresh1 AND 이웃(필터) > thresh2 →
          // A3의 상대오프셋과 구별되는 절대임계 커버리지 트리거 HO. A3와 동일 buildHandoverSteps 경로,
          // A3처럼 TTT 가드 + 핑퐁 가드. 이번 틱에 A3 HO가 없었고 유휴가 아닐 때만 평가(이중 HO 방지).
          if (!rrcIdle.current && !didHo && cur && servingId.current) {
            const a5n = p.cells.reduce(
              (a, b) => (b.id !== cur.id && fr(b) > (a ? fr(a) : -999) ? b : a),
              undefined as (typeof p.cells)[number] | undefined,
            )
            // A5 진입조건 (TS 38.331 §5.5.4.6): 서빙 Mp+Hys<Thresh1 AND 이웃 Mn+Ocn−Hys>Thresh2.
            // A3와 동일하게 hysteresis + 이웃 CIO(Ocn) 적용 (servGnb 우선, 없으면 글로벌 폴백).
            const a5Hys = servGnb?.hysteresis_db ?? hysteresis_db
            if (a5n
              && fr(cur) + a5Hys < a5_thresh1_dbm
              && fr(a5n) + cioOf(a5n.id) - a5Hys > a5_thresh2_dbm) {
              const nowMs = performance.now()
              if (a5Since.current === null) a5Since.current = nowMs
              const a5Ttt = st.objects.find((o) => o.kind === 'gnb' && o.id === cur.id)?.gnb?.ttt_ms ?? ttt_ms
              if (nowMs - a5Since.current >= a5Ttt) {
                if (pingpongBlocked(a5n.id, nowMs)) {
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `A5 HO 억제 — ${a5n.name}로 역방향 핸드오버, 최소 체류 ${pingpong_min_stay_ms ?? 1000}ms 미충족(ping-pong 방지)`,
                      `A5 HO suppressed — reverse handover to ${a5n.name} within min-stay ${pingpong_min_stay_ms ?? 1000}ms (ping-pong guard)`,
                      `A5 切换抑制 — 回退到 ${a5n.name} 未满足最小驻留 ${pingpong_min_stay_ms ?? 1000}ms(防乒乓)`),
                    undefined, undefined, defaultImsi(st.ueSim))
                  a5Since.current = null
                } else {
                  const srcObj = st.objects.find((o) => o.kind === 'gnb' && o.id === cur.id)
                  const tgtObj = st.objects.find((o) => o.kind === 'gnb' && o.id === a5n.id)
                  const amfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'AMF' && n.enabled)
                  const upfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'UPF' && n.enabled)
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `A5 이벤트 — 서빙 ${cur.name} RSRP ${Math.round(fr(cur))} < thresh1 ${a5_thresh1_dbm}dBm & 이웃 ${a5n.name} ${Math.round(fr(a5n))} > thresh2 ${a5_thresh2_dbm}dBm → 커버리지 HO`,
                      `A5 event — serving ${cur.name} RSRP ${Math.round(fr(cur))} < thresh1 ${a5_thresh1_dbm}dBm & neighbor ${a5n.name} ${Math.round(fr(a5n))} > thresh2 ${a5_thresh2_dbm}dBm → coverage HO`,
                      `A5 事件 — 服务 ${cur.name} RSRP ${Math.round(fr(cur))} < thresh1 ${a5_thresh1_dbm}dBm 且邻区 ${a5n.name} ${Math.round(fr(a5n))} > thresh2 ${a5_thresh2_dbm}dBm → 覆盖切换`),
                    undefined, undefined, defaultImsi(st.ueSim))
                  const hoSteps = buildHandoverSteps({
                    ueName: 'UE',
                    sourceRu: cur.name, targetRu: a5n.name,
                    amf: amfNf?.name ?? null, upf: upfNf?.name ?? null,
                    sourcePci: srcObj?.gnb?.pci ?? null, targetPci: tgtObj?.gnb?.pci ?? null,
                    targetRsrp: a5n.rsrp_dbm, a3Offset: 0, hysteresis: 0,
                    tttMs: a5Ttt, cioDb: cioOf(a5n.id),
                  })
                  const a5Imsi = defaultImsi(st.ueSim)
                  for (const hs of hoSteps) st.addEvent(hs.source, hs.level, hs.msg, hs.node, hs.dir, a5Imsi, hs.from, hs.to)
                  prevServing.current = cur.id // MRO: 역방향 HO 차단용 직전 서빙셀 기록
                  lastHoAt.current = nowMs
                  servingId.current = a5n.id
                  didHo = true
                  a5Since.current = null
                  a3Since.current = null
                  // A5도 T304 실행 타이머 무장(ReconfigurationWithSync) — A3와 동일 실행 감시.
                  t304Since.current = performance.now()
                  t304Src.current = { id: cur.id, name: cur.name }
                }
              }
            } else {
              a5Since.current = null
            }
          }
          // CHO — 조건부 핸드오버 (TS 38.331 §5.3.5.13): 즉시 A3와 구별되는 2단계 HO.
          // ① 준비: 이웃이 CHO 후보 조건(bEff > cEff + a3_offset)에 들면 RRCReconfig(condReconfig)로 후보 준비(로깅).
          // ② 실행: 실행조건 fr(neighbor) > fr(serving) + cho_exec_offset_db가 성립하면 그때 실제 HO 실행
          //    (기존 buildHandoverSteps 경로). 오프셋↑ → 실행 지연. A3/A5 didHo 가드로 이중 HO 방지.
          if (!rrcIdle.current && !didHo && cur && servingId.current) {
            const choN = p.cells.reduce(
              (a, b) =>
                b.id !== cur.id && fr(b) + cioOf(b.id) > (a ? fr(a) + cioOf(a.id) : -999) ? b : a,
              undefined as (typeof p.cells)[number] | undefined,
            )
            const servGnbC = st.objects.find((o) => o.kind === 'gnb' && o.id === cur.id)?.gnb
            const a3OffC = servGnbC?.a3_offset_db ?? a3_offset_db
            if (choN) {
              const bEffC = fr(choN) + cioOf(choN.id)
              const cEffC = fr(cur) + cioOf(cur.id)
              // ① 준비 (새 후보 진입 시에만 디듑 로깅)
              if (bEffC > cEffC + a3OffC) {
                if (choCandidate.current?.id !== choN.id) {
                  choCandidate.current = { id: choN.id, name: choN.name }
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `CHO 후보 준비 — ${choN.name}(bEff ${Math.round(bEffC)} > cEff ${Math.round(cEffC)}+off ${a3OffC}dB), RRCReconfig(condReconfig) 수신, 실행조건 대기(+${cho_exec_offset_db}dB)`,
                      `CHO candidate prepared — ${choN.name} (bEff ${Math.round(bEffC)} > cEff ${Math.round(cEffC)}+off ${a3OffC}dB), RRCReconfig w/ condReconfig, awaiting exec cond (+${cho_exec_offset_db}dB)`,
                      `CHO 候选准备 — ${choN.name}(bEff ${Math.round(bEffC)} > cEff ${Math.round(cEffC)}+off ${a3OffC}dB),RRCReconfig(condReconfig),等待执行条件(+${cho_exec_offset_db}dB)`),
                    undefined, undefined, defaultImsi(st.ueSim))
                }
              } else if (choCandidate.current && choCandidate.current.id === choN.id) {
                choCandidate.current = null // 준비 조건 이탈 → 후보 취소(재무장)
              }
              // ② 실행: 준비된 후보에 대해 실행조건 성립 시 실제 HO
              if (
                choCandidate.current &&
                choCandidate.current.id === choN.id &&
                fr(choN) > fr(cur) + cho_exec_offset_db
              ) {
                const nowMs = performance.now()
                if (pingpongBlocked(choN.id, nowMs)) {
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `CHO 실행 억제 — ${choN.name}로 역방향 핸드오버, 최소 체류 ${pingpong_min_stay_ms ?? 1000}ms 미충족(ping-pong 방지)`,
                      `CHO execution suppressed — reverse handover to ${choN.name} within min-stay ${pingpong_min_stay_ms ?? 1000}ms (ping-pong guard)`,
                      `CHO 执行抑制 — 回退到 ${choN.name} 未满足最小驻留 ${pingpong_min_stay_ms ?? 1000}ms(防乒乓)`),
                    undefined, undefined, defaultImsi(st.ueSim))
                  choCandidate.current = null
                } else {
                  const srcObj = st.objects.find((o) => o.kind === 'gnb' && o.id === cur.id)
                  const tgtObj = st.objects.find((o) => o.kind === 'gnb' && o.id === choN.id)
                  const amfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'AMF' && n.enabled)
                  const upfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'UPF' && n.enabled)
                  st.addEvent('UE', 'info',
                    pick(st.lang,
                      `CHO 실행 — ${cur.name} → ${choN.name} 실행조건 성립(fr ${Math.round(fr(choN))} > 서빙 ${Math.round(fr(cur))}+${cho_exec_offset_db}dB), 조건부 재구성 적용`,
                      `CHO execution — ${cur.name} → ${choN.name} exec cond met (fr ${Math.round(fr(choN))} > serving ${Math.round(fr(cur))}+${cho_exec_offset_db}dB), applying condReconfig`,
                      `CHO 执行 — ${cur.name} → ${choN.name} 满足执行条件(fr ${Math.round(fr(choN))} > 服务 ${Math.round(fr(cur))}+${cho_exec_offset_db}dB),应用条件重配`),
                    undefined, undefined, defaultImsi(st.ueSim))
                  const hoSteps = buildHandoverSteps({
                    ueName: 'UE',
                    sourceRu: cur.name, targetRu: choN.name,
                    amf: amfNf?.name ?? null, upf: upfNf?.name ?? null,
                    sourcePci: srcObj?.gnb?.pci ?? null, targetPci: tgtObj?.gnb?.pci ?? null,
                    targetRsrp: choN.rsrp_dbm, a3Offset: a3OffC, hysteresis: 0,
                    tttMs: 0, cioDb: cioOf(choN.id),
                  })
                  const choImsi = defaultImsi(st.ueSim)
                  for (const hs of hoSteps) st.addEvent(hs.source, hs.level, hs.msg, hs.node, hs.dir, choImsi, hs.from, hs.to)
                  prevServing.current = cur.id // MRO: 역방향 HO 차단용 직전 서빙셀 기록
                  lastHoAt.current = nowMs
                  servingId.current = choN.id
                  didHo = true
                  choCandidate.current = null
                  a3Since.current = null
                  a5Since.current = null
                  // CHO도 T304 실행 타이머 무장(ReconfigurationWithSync) — A3/A5와 동일 실행 감시.
                  t304Since.current = performance.now()
                  t304Src.current = { id: cur.id, name: cur.name }
                }
              }
            } else {
              choCandidate.current = null // 이웃 없음 → 후보 해제
            }
          }
          // 서빙 표시를 A3 판정 결과로 덮어씀 (SINR/CQI는 최강셀 기준 근사 유지)
          const servingCell = p.cells.find((c) => c.id === servingId.current)
          st.setProbe(
            servingCell
              ? {
                  ...p,
                  serving: servingCell.id,
                  serving_name: servingCell.name,
                  rsrp_dbm: servingCell.rsrp_dbm,
                }
              : p,
          )
          // 걷는 UE 서빙셀의 RAN 경로(RU→프론트홀→DU→F1→CU→N2 AMF & N3 UPF) 상시 감시.
          // 사슬이 끊기면(장비 비활성/사이트다운 등) 활성 통화 드롭 + 트래픽 중단. 전이 시에만 로깅(4Hz 스팸 방지).
          const servRu = st.objects.find((o) => o.kind === 'gnb' && o.id === servingId.current)
          const ranChk = servRu
            ? ranChainOk(servRu, st.objects, st.ranUnits, st.coreNfs, st.siteDown)
            : null
          if (servRu && ranChk && !ranChk.ok) {
            if (!wasRanFail.current) {
              wasRanFail.current = true
              const imsi = defaultImsi(st.ueSim)
              if (st.call && st.call.phase === 'active') st.endCall()
              if (st.trafficActive) st.toggleTraffic()
              st.addEvent('RU', 'error',
                pick(st.lang,
                  `UE: 트래픽/통화 중단 — ${ranChainText(ranChk.reason, 'ko')}`,
                  `UE: traffic/call stopped — ${ranChainText(ranChk.reason, 'en')}`,
                  `UE: 流量/通话中断 — ${ranChainText(ranChk.reason, 'zh')}`),
                servRu.name, undefined, imsi)
            }
          } else if (servRu && ranChk && ranChk.ok) {
            wasRanFail.current = false
          }
          // 코어 E2E(등록 AMF/AUSF/UDM + 세션 SMF/UPF + DN) 상시 감시 — RAN 사슬이 검증 못하는
          // SMF/AUSF/UDM/DN 상실을 잡는다. 미도달이면 활성 통화 드롭 + 트래픽 중단. 전이 시에만 로깅.
          if (curZone !== null) {
            const e2e = computeE2E(st.objects, st.coreNfs, st.coreDn, curZone, st.siteDown, st.ranUnits)
            if (!e2e.ok) {
              if (!wasCoreFail.current) {
                wasCoreFail.current = true
                const imsi = defaultImsi(st.ueSim)
                if (st.call && st.call.phase === 'active') st.endCall()
                if (st.trafficActive) st.toggleTraffic()
                st.addEvent('NF', 'error',
                  pick(st.lang,
                    `UE: 트래픽/통화 중단 — 코어 미도달(${e2e.missing.join(', ')})`,
                    `UE: traffic/call stopped — core unreachable (${e2e.missing.join(', ')})`,
                    `UE: 流量/通话中断 — 核心不可达(${e2e.missing.join(', ')})`),
                  undefined, undefined, imsi)
              }
            } else {
              wasCoreFail.current = false
            }
          }
          // PRACH 접속 성공률 (UL 커버리지) — 실패 시 재시도/접속불가 로그
          if (p.rach_ok === false && !wasRach.current) {
            wasRach.current = true
            st.addEvent('UE', 'warn',
              st.lang === 'ko'
                ? `PRACH 접속 실패 — UL 링크버짓 부족(UL SINR ${p.ul_sinr_db}dB), preamble ${p.rach_attempts}회 재시도 후 포기. P0/alpha 상향 필요`
                : `PRACH access failed — UL link budget short (UL SINR ${p.ul_sinr_db}dB) after ${p.rach_attempts} tries`)
          } else if (p.rach_ok && wasRach.current) {
            wasRach.current = false
          }
          // AGC 오버로드 방지 (RSRP > -45 → UE 수신 감쇠)
          if (p.agc_active && !wasAgc.current) {
            wasAgc.current = true
            st.addEvent(
              'UE', 'warn',
              st.lang === 'ko'
                ? 'AGC 오버로드 방지 동작 — 과입력(RSRP > -45dBm) 감지, 수신 감쇠기로 -45dBm 제한'
                : 'AGC overload protection — high input (RSRP > -45dBm), attenuated to -45dBm',
            )
          } else if (!p.agc_active && wasAgc.current) {
            wasAgc.current = false
          }
          // 음영지역 진입/회복 (히스테리시스)
          if (p.rsrp_dbm != null) {
            if (p.rsrp_dbm < -105 && !wasWeak.current) {
              wasWeak.current = true
              st.addEvent('UE', 'warn', L.shadow(p.rsrp_dbm))
            } else if (p.rsrp_dbm > -100 && wasWeak.current) {
              wasWeak.current = false
              st.addEvent('UE', 'info', L.recover(p.rsrp_dbm))
            }
            // 통화 드롭: RSRP가 사용자 설정 임계 밑으로 → 활성 통화/세션 드롭 (Qout)
            const dropTh = st.mobility.call_drop_rsrp_dbm
            const koD = st.lang === 'ko'
            if (p.rsrp_dbm < dropTh) {
              if (st.call && st.call.phase === 'active') {
                st.endCall()
                st.addEvent('UE', 'error',
                  koD
                    ? `📵 통화 드롭 — RSRP ${p.rsrp_dbm}dBm < 임계 ${dropTh}dBm (무선링크 품질 저하, Qout)`
                    : `📵 Call dropped — RSRP ${p.rsrp_dbm}dBm < ${dropTh}dBm (radio link Qout)`)
              } else if (st.trafficActive && !wasCallDrop.current) {
                wasCallDrop.current = true
                st.toggleTraffic()
                st.addEvent('UE', 'error',
                  koD
                    ? `📵 세션 드롭 — RSRP ${p.rsrp_dbm}dBm < 임계 ${dropTh}dBm (무선링크 실패)`
                    : `📵 Session dropped — RSRP ${p.rsrp_dbm}dBm < ${dropTh}dBm (radio link failure)`)
              }
            } else if (p.rsrp_dbm > dropTh + 5) {
              wasCallDrop.current = false
            }
          }
          // 트래픽 시뮬레이션: 무선 품질 기준 처리량 + 셀 혼잡 + UPF 용량/HPA + 로밍 경로
          // 측정 갭 구간(inGap)에는 DL/UL 중단 → 이 틱의 서빙 데이터 스케줄링 스킵(TS 38.133).
          if (st.trafficActive && p.est_throughput_mbps != null && !inGap) {
            let mbps = p.est_throughput_mbps
            // 서빙 셀이 혼잡하면 걷는 UE도 PRB 공유로 처리량 하락 (배치 UE와 일관)
            // A3 판정된 실제 서빙 셀(servingId) 기준 — 없으면 probe 최강셀 폴백
            const servId = servingId.current ?? p.serving
            const cellLoad = servId ? (st.nfLoads[servId]?.load ?? 0) : 0
            if (cellLoad > 1) mbps = mbps / cellLoad
            // 로밍 중(HR)이면 방문국 UPF와 홈 UPF 모두 경유 → 병목 = min
            const zonesInPath: Zone[] =
              curZone === home ? [home] : curZone ? [curZone, home] : []
            if (curZone && curZone !== home) {
              const path = computeRoamingPath(st.objects, st.coreNfs, st.coreDn, curZone, home, st.siteDown)
              if (!path.ok) {
                mbps = 0
              }
            }
            for (const z of zonesInPath) {
              const upf = st.coreNfs.find(
                (n) => n.zone === z && n.nf_type === 'UPF' && n.enabled,
              )
              if (!upf) continue
              const capacity = upf.replicas * (upf.capacity_per_pod ?? UPF_CAPACITY_PER_POD_MBPS)
              if (mbps > capacity) {
                if (upf.auto_scale && upf.replicas < 16) {
                  st.updateCoreNf(upf.id, { replicas: upf.replicas + 1 })
                  st.addEvent(
                    'NF', 'info',
                    L.hpa(Math.round(mbps), capacity, upf.replicas, upf.replicas + 1),
                    upf.name,
                  )
                } else if (!wasOverload.current) {
                  wasOverload.current = true
                  st.addEvent('NF', 'warn', L.overload(capacity), upf.name)
                }
                mbps = Math.min(mbps, capacity)
              } else if (wasOverload.current && mbps < capacity * 0.9) {
                wasOverload.current = false
              }
            }
            st.setTrafficStats(mbps, (mbps * dtProbe) / 8)
          }
        })
        .catch(() => {})
        .finally(() => {
          probing.current = false
        })
    }
  })

  return <PointerLockControls makeDefault />
}

// 걷기 모드: 1인칭 WASD + 마우스 시점(PointerLock).
// 걸으면서 현재 위치의 신호를 주기적으로 백엔드에 측정 요청(폰처럼).
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import * as api from '../api'
import { buildAttachSteps, buildHandoverSteps } from '../attach'
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
          const { a3_offset_db, hysteresis_db, ttt_ms, a2_threshold_dbm, t310_ms, rlf_rsrp_dbm } =
            st.mobility
          // 셀별 CIO 반영된 유효 RSRP (셀 경계 조정)
          const cioOf = (id?: string) =>
            st.objects.find((o) => o.kind === 'gnb' && o.id === id)?.gnb?.cio_db ?? 0
          const cur = p.cells.find((c) => c.id === servingId.current)
          const best = p.cells.reduce(
            (a, b) =>
              b.rsrp_dbm + cioOf(b.id) > (a ? a.rsrp_dbm + cioOf(a.id) : -999) ? b : a,
            undefined as (typeof p.cells)[number] | undefined,
          )

          const koL = st.lang === 'ko'
          // A2: 서빙 RSRP가 임계 이하로 떨어지면 측정 시작 이벤트 (핸드오버 준비)
          if (cur) {
            if (cur.rsrp_dbm < a2_threshold_dbm && !wasA2.current) {
              wasA2.current = true
              st.addEvent('UE', 'info',
                koL
                  ? `A2 이벤트 — 서빙 ${cur.name} RSRP ${cur.rsrp_dbm} < ${a2_threshold_dbm}dBm, 측정/HO 준비`
                  : `A2 event — serving ${cur.name} RSRP ${cur.rsrp_dbm} < ${a2_threshold_dbm}dBm, start measurement/HO`)
            } else if (cur.rsrp_dbm > a2_threshold_dbm + 3) {
              wasA2.current = false
            }
          }

          // RLF: 서빙 RSRP가 매우 낮게(rlf_rsrp_dbm 이하) T310 동안 지속 → Radio Link Failure → 재접속
          if (cur && cur.rsrp_dbm < rlf_rsrp_dbm) {
            const nowMs = performance.now()
            if (rlfSince.current === null) rlfSince.current = nowMs
            else if (nowMs - rlfSince.current >= t310_ms) {
              st.addEvent('UE', 'warn',
                koL
                  ? `RLF (T310 ${t310_ms}ms 만료) — ${cur.name} 무선링크 실패, RRC 재수립 시도`
                  : `RLF (T310 ${t310_ms}ms expired) — ${cur.name} radio link failure, RRC re-establishment`)
              servingId.current = best?.id ?? null // 재접속(셀 재선택)
              rlfSince.current = null
              a3Since.current = null
            }
          } else {
            rlfSince.current = null
          }

          if (!cur || !servingId.current) {
            if (best) { servingId.current = best.id; a3Since.current = null }
          } else if (best && best.id !== cur.id) {
            const bEff = best.rsrp_dbm + cioOf(best.id)
            const cEff = cur.rsrp_dbm + cioOf(cur.id)
            if (bEff > cEff + a3_offset_db + hysteresis_db) {
              const nowMs = performance.now()
              if (a3Since.current === null) a3Since.current = nowMs
              if (nowMs - a3Since.current >= ttt_ms) {
                // PART 15: A3 조건이 TTT 동안 유지 → 실제 핸드오버 call flow 방출 후 셀 전환.
                // 파라미터(a3_offset/hysteresis/TTT/CIO)가 발동 시점을 실제 결정한다.
                const srcObj = st.objects.find((o) => o.kind === 'gnb' && o.id === cur.id)
                const tgtObj = st.objects.find((o) => o.kind === 'gnb' && o.id === best.id)
                const amfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'AMF' && n.enabled)
                const upfNf = st.coreNfs.find((n) => n.zone === curZone && n.nf_type === 'UPF' && n.enabled)
                st.addEvent('UE', 'info',
                  `${L.handover(cur.name, best.name, best.rsrp_dbm)} [A3 off=${a3_offset_db} hys=${hysteresis_db} TTT=${ttt_ms}ms CIO=${cioOf(best.id)}dB]`)
                const hoSteps = buildHandoverSteps({
                  ueName: 'UE',
                  sourceRu: cur.name, targetRu: best.name,
                  amf: amfNf?.name ?? null, upf: upfNf?.name ?? null,
                  sourcePci: srcObj?.gnb?.pci ?? null, targetPci: tgtObj?.gnb?.pci ?? null,
                  targetRsrp: best.rsrp_dbm, a3Offset: a3_offset_db, hysteresis: hysteresis_db,
                  tttMs: ttt_ms, cioDb: cioOf(best.id),
                })
                const hoImsi = defaultImsi(st.ueSim)
                for (const hs of hoSteps) st.addEvent(hs.source, hs.level, hs.msg, hs.node, hs.dir, hoImsi, hs.from, hs.to)
                servingId.current = best.id
                a3Since.current = null
              }
            } else {
              a3Since.current = null
            }
          } else {
            a3Since.current = null
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
          if (st.trafficActive && p.est_throughput_mbps != null) {
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

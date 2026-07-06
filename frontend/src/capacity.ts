// 용량/부하 시뮬레이션 (K8s 리소스 모델) — 1초 틱.
//   부하율 = 사용량 / (파드당 용량 × replicas)
//   >80%: HPA 스케일아웃(켜진 경우) / >100%: 신규 수용 거부 상태 / >95% 지속: 다운(OOMKilled)
// RU: 접속 UE 수 / max_ue. UE 수 = 존 내 측정요원 + 걷는 UE(해당 존).
import { useEffect, useRef } from 'react'
import { useStore } from './store'
import { pick } from './i18n'
import type { SceneObject, SimResult, Zone } from './types'
import {
  CRASH_SUSTAIN_TICKS,
  CRASH_THRESHOLD,
  DEFAULT_MAX_REPLICAS,
  HPA_THRESHOLD,
  NF_CAPACITY_PER_POD,
  ZONES,
  activeNf,
  computeE2E,
  defaultImsi,
  imsiRegistered,
  objZone,
  ranChainOk,
  ranChainText,
  trafficInfo,
} from './types'

// 시뮬 그리드에서 SINR 샘플 → 처리량(Mbps) 산출 (백엔드 probe 없이 클라이언트 계산)
function personThroughput(
  p: SceneObject,
  sim: SimResult | null,
  rus: SceneObject[],
): number {
  if (!sim || rus.length === 0) return 0
  const [cx, cy, cz] = sim.cell
  const ix = Math.min(Math.max(Math.floor(p.position[0] / cx), 0), sim.nx - 1)
  const iy = Math.min(Math.max(Math.floor(1.5 / cy), 0), sim.ny - 1)
  const iz = Math.min(Math.max(Math.floor(p.position[2] / cz), 0), sim.nz - 1)
  const sinr = sim.sinr[ix + iy * sim.nx + iz * sim.nx * sim.ny]
  if (!Number.isFinite(sinr) || sinr < -10) return 0
  // 서빙 셀 근사: 최근접 RU의 feature 반영 (백엔드 probe 공식과 동일)
  let ru = rus[0]
  let bd = Infinity
  for (const r of rus) {
    const d = (r.position[0] - p.position[0]) ** 2 + (r.position[2] - p.position[2]) ** 2
    if (d < bd) {
      bd = d
      ru = r
    }
  }
  const g = ru.gnb!
  const qamCap = g.qam256 ? 7.4 : 5.55
  const layers = g.mimo4x4 ? 4 : 2
  const bwEff = g.bandwidth_mhz * (g.ca_enabled ? 2 : 1)
  const dlRatio = g.tdd_dl_ratio ?? 0.75
  const se = Math.min(Math.log2(1 + Math.pow(10, sinr / 10)), qamCap)
  // 백엔드 physics.probe와 동일 계수 (se·BW·0.567·layers·dl_ratio)
  return se * bwEff * 0.567 * layers * dlRatio
}

// 시뮬 그리드에서 UE 위치의 SINR(dB) 샘플 — CE 사다리 입력용 (personThroughput와 동일 인덱싱)
function personSinr(p: SceneObject, sim: SimResult | null): number | null {
  if (!sim) return null
  const [cx, cy, cz] = sim.cell
  const ix = Math.min(Math.max(Math.floor(p.position[0] / cx), 0), sim.nx - 1)
  const iy = Math.min(Math.max(Math.floor(1.5 / cy), 0), sim.ny - 1)
  const iz = Math.min(Math.max(Math.floor(p.position[2] / cz), 0), sim.nz - 1)
  const s = sim.sinr[ix + iy * sim.nx + iz * sim.nx * sim.ny]
  return Number.isFinite(s) ? s : null
}

// 시뮬 그리드에서 UE 위치의 RSRP(dBm) 샘플 — probe가 없는 배치 UE의 커버리지 판정용 (personSinr와 동일 인덱싱)
function personRsrp(p: SceneObject, sim: SimResult | null): number | null {
  if (!sim) return null
  const [cx, cy, cz] = sim.cell
  const ix = Math.min(Math.max(Math.floor(p.position[0] / cx), 0), sim.nx - 1)
  const iy = Math.min(Math.max(Math.floor(1.5 / cy), 0), sim.ny - 1)
  const iz = Math.min(Math.max(Math.floor(p.position[2] / cz), 0), sim.nz - 1)
  const r = sim.rsrp[ix + iy * sim.nx + iz * sim.nx * sim.ny]
  return Number.isFinite(r) ? r : null
}

// NB-IoT/LTE-M 커버리지 확장(CE) 사다리 — 클라이언트 근사(백엔드 physics._ce_ladder와 동형).
// 수신 SNR이 CE0 동작점(-6dB) 아래로 떨어지면 반복(repetition)으로 링크를 확장.
// 반복은 부족분(deficit=CE0−SNR)만큼 필요하며 3dB/2배 결합이득 근사. 부족분이 최대이득(20dB)
// 초과(≈SNR<-26dB)거나 NPRACH 반복 상한(128)을 넘으면 CE로도 미달 → 접속 불가(inCoverage=false).
// SINR을 링크 마진 프록시로 사용(근사 모델 — 실제 ray-tracing/BLER 곡선 아님).
const NBIOT_LTEM_MAX_MBPS = 1.0 // 협대역/저Cat 단말 DL 처리량 상한 (LTE-M ~1Mbps)
const CE0_SNR_DB = -6.0
const CE_MAX_GAIN_DB = 20.0
const DELAY_CRITICAL_5QI = new Set([82, 83, 84, 85])
function ceLadderClient(
  sinr: number,
): { level: number; mode: string; reps: number; inCoverage: boolean } {
  const deficit = CE0_SNR_DB - sinr
  if (deficit <= 0) return { level: 0, mode: 'none', reps: 1, inCoverage: true }
  const reps = Math.min(2 ** Math.ceil(deficit / 3), 2048)
  const level = deficit <= 6 ? 0 : deficit <= 14 ? 1 : 2
  const mode = reps <= 32 ? 'A' : 'B'
  const inCoverage = deficit <= CE_MAX_GAIN_DB && reps <= 128
  return { level, mode, reps, inCoverage }
}

export function useCapacitySim() {
  const sustained = useRef<Record<string, number>>({})
  const warned = useRef<Record<string, boolean>>({})
  const activeRef = useRef<Record<string, string | null>>({}) // (zone:type) → 활성 인스턴스 id (failover 감지)
  const nwdafTick = useRef(0) // SECTION B: NWDAF 주기 분석 로그 스로틀 (매 틱=1s, N틱마다 방출)
  const droppedUes = useRef<Set<string>>(new Set()) // RSRP/RAN 경로 상실로 "드롭" 상태인 배치 UE id (전이 시에만 로깅)

  useEffect(() => {
    const timer = setInterval(() => {
      const st = useStore.getState()
      const loads: Record<string, { load: number; cpu: number }> = {}

      // 존별 UE/세션 수
      const ueCount: Record<Zone, number> = { A: 0, B: 0, C: 0 }
      for (const o of st.objects) if (o.kind === 'person') ueCount[objZone(o)]++
      if (st.mode === 'walk' && st.ueOn && st.ueZone) ueCount[st.ueZone]++
      const sessions: Record<Zone, number> = { ...ueCount } // v1: UE당 PDU 세션 1개

      // ---- RAN 혼잡 모델 (셀별 PRB 자원 공유 + 트래픽 우선순위) ----
      // 실제 시스템: 셀 용량은 유한(대역폭×효율). 사용자가 몰리면 PRB를 나눠 쓰므로
      // 1인당 스루풋이 감소. GBR(음성/실시간)은 우선 보장, 비GBR(동영상/웹/파일)이 먼저 조여짐.
      // 용량 자체가 GBR 수요도 못 받으면 GBR 세션 admission reject(통화 드롭/거부).
      const personMbps: Record<string, number> = {}
      const personTrafficByZone: Record<Zone, number> = { A: 0, B: 0, C: 0 }
      // 측정요원별 트래픽 종류(미지정 시 전역 기본)
      const tiOf = (id: string) => trafficInfo(st.personTrafficType[id] ?? st.trafficType)
      const sliceHas = (zone: Zone, sst: number) =>
        st.slices.some((s) => s.zone === zone && s.sst === sst)

      for (const zone of ZONES) {
        const rus = st.objects.filter(
          (o) => objZone(o) === zone && o.kind === 'gnb' && o.gnb?.enabled,
        )
        if (rus.length === 0) continue

        // 각 UE를 최근접 RU에 귀속
        const cellUEs: Record<string, string[]> = {}
        for (const p of st.objects) {
          if (p.kind !== 'person' || objZone(p) !== zone) continue
          let best = rus[0]
          let bd = Infinity
          for (const r of rus) {
            const d = (r.position[0] - p.position[0]) ** 2 + (r.position[2] - p.position[2]) ** 2
            if (d < bd) { bd = d; best = r }
          }
          ;(cellUEs[best.id] ??= []).push(p.id)
        }

        for (const r of rus) {
          const g = r.gnb!
          const attachedIds = cellUEs[r.id] ?? []
          // 걷는 UE는 실제 서빙 셀(probe.serving)에 귀속 — 없으면 첫 RU로 폴백
          const walkServ = st.probe?.serving ?? rus[0]?.id
          const nAttached = attachedIds.length +
            (st.mode === 'walk' && st.ueOn && st.ueZone === zone && walkServ === r.id ? 1 : 0)

          // 셀 피크 용량 (Mbps) — 대역폭 × 스펙트럼효율 × 레이어 × 실효율
          const qam = g.qam256 ? 7.4 : 5.55
          const layers = g.mimo4x4 ? 4 : 2
          const bwEff = g.bandwidth_mhz * (g.ca_enabled ? 2 : 1)
          const dlRatio = g.tdd_dl_ratio ?? 0.75
          // TDD DL 비율 반영(per-UE radioRate와 일관) + BW=0 시 NaN 방지 하한
          const cellPeak = Math.max(bwEff * qam * layers * 0.7 * dlRatio, 1e-9)

          // 트래픽 생성 중 + 전원 ON 인 UE만 수요 발생
          const activeIds = attachedIds.filter(
            (id) => st.personTraffic[id] && st.personUeOn[id],
          )
          // 미등록 IMSI UE는 등록 거부 → 트래픽 0 (슬라이스 검사 이전)
          const rejectImsi: string[] = []
          const registered: string[] = []
          for (const id of activeIds) {
            const im = st.personImsi[id]
            if (im && !imsiRegistered(im, st.ueSim, st.registeredImsis)) { rejectImsi.push(id); personMbps[id] = 0 }
            else registered.push(id)
          }
          if (rejectImsi.length > 0 && !warned.current[`imsi-${r.id}`]) {
            warned.current[`imsi-${r.id}`] = true
            st.addEvent('NF', 'warn',
              pick(st.lang,
                `[PLMN-${zone}] 미등록 IMSI ${rejectImsi.length}개 UE — 등록 거부(Registration Reject), 트래픽 차단`,
                `[PLMN-${zone}] ${rejectImsi.length} UE with unregistered IMSI — Registration Reject, traffic blocked`,
                `[PLMN-${zone}] ${rejectImsi.length} 个未注册IMSI UE — 注册拒绝，流量中断`),
              'UDM')
          } else if (rejectImsi.length === 0) warned.current[`imsi-${r.id}`] = false
          // 슬라이스 미프로비저닝 UE는 PDU 세션 거부(#91) → 트래픽 0
          const rejectSlice: string[] = []
          const grantIds: string[] = []
          for (const id of registered) {
            if (sliceHas(zone, tiOf(id).sst)) grantIds.push(id)
            else { rejectSlice.push(id); personMbps[id] = 0 }
          }
          if (rejectSlice.length > 0 && !warned.current[`slice-${r.id}`]) {
            warned.current[`slice-${r.id}`] = true
            const sst = tiOf(rejectSlice[0]).sst
            st.addEvent('NF', 'warn',
              pick(st.lang,
                `[PLMN-${zone}] 슬라이스 SST=${sst} 미프로비저닝 — ${rejectSlice.length}개 UE PDU Session Reject #91 (S-NSSAI not subscribed)`,
                `[PLMN-${zone}] Slice SST=${sst} not provisioned — ${rejectSlice.length} UE PDU Session Reject #91`,
                `[PLMN-${zone}] 切片 SST=${sst} 未开通 — ${rejectSlice.length} 个 UE PDU Session Reject #91`),
              'NSSF')
          } else if (rejectSlice.length === 0) warned.current[`slice-${r.id}`] = false

          // 각 UE의 무선품질 상한 (SINR 기반) + 요구 대역폭(종류별)
          const radioRate: Record<string, number> = {}
          const want: Record<string, number> = {}
          const ceInfo: Record<string, ReturnType<typeof ceLadderClient>> = {}
          for (const id of grantIds) {
            const obj = st.objects.find((o) => o.id === id)!
            const ti = tiOf(id)
            if (ti.ce) {
              // NB-IoT/LTE-M 커버리지 확장: 심층 커버리지에서 반복으로 링크 확장 →
              // rate는 반복수로 나뉘고(협대역 상한), CE 미달이면 NPRACH 실패로 접속 불가.
              const sinr = personSinr(obj, st.sims[zone]) ?? -20
              const ce = ceLadderClient(sinr)
              ceInfo[id] = ce
              radioRate[id] = ce.inCoverage
                ? Math.min(NBIOT_LTEM_MAX_MBPS / ce.reps, NBIOT_LTEM_MAX_MBPS)
                : 0
            } else {
              radioRate[id] = personThroughput(obj, st.sims[zone], rus)
            }
            want[id] = Math.min(ti.demandMbps, radioRate[id])
          }
          // GBR(음성/실시간) 먼저 admission, 잔여 용량을 비GBR이 비례 배분
          const gbrIds = grantIds.filter((id) => tiOf(id).gbr)
          const nonGbrIds = grantIds.filter((id) => !tiOf(id).gbr)
          const served: Record<string, number> = {}
          let used = 0
          let rejected = 0
          for (const id of gbrIds) {
            if (used + want[id] <= cellPeak) { served[id] = want[id]; used += want[id] }
            else { served[id] = 0; rejected++ }
          }
          if (rejected > 0 && !warned.current[`adm-${r.id}`]) {
            warned.current[`adm-${r.id}`] = true
            st.addEvent('RU', 'warn',
              pick(st.lang,
                `${r.name}: PRB 부족 — GBR 세션 ${rejected}건 admission reject`,
                `${r.name}: PRB shortage — ${rejected} GBR session(s) admission-rejected`,
                `${r.name}: PRB 不足 — GBR 会话 ${rejected} 个 admission reject`),
              r.name)
          } else if (rejected === 0) warned.current[`adm-${r.id}`] = false
          const remain = Math.max(cellPeak - used, 0)
          const wantNon = nonGbrIds.reduce((s, id) => s + want[id], 0)
          const factor = wantNon > remain ? remain / wantNon : 1
          for (const id of nonGbrIds) served[id] = want[id] * factor
          const totalWant = grantIds.reduce((s, id) => s + want[id], 0)
          for (const id of grantIds) {
            personMbps[id] = served[id] ?? 0
            personTrafficByZone[zone] += served[id] ?? 0
          }

          // 부하 지표: 접속 UE / max_ue 와 PRB 사용률 중 큰 값
          const rrcLoad = nAttached / Math.max(g.max_ue, 1)
          const prbUtil = Math.min(totalWant / cellPeak, 2)
          const load = Math.max(rrcLoad, prbUtil)
          loads[r.id] = { load, cpu: Math.min(15 + load * 80, 100) }

          // ---- PHY: NB-IoT/LTE-M 커버리지 확장(CE) 관측 로그 ----
          const ceFail = grantIds.filter((id) => ceInfo[id] && !ceInfo[id].inCoverage)
          const ceDeep = grantIds.filter((id) => ceInfo[id]?.inCoverage && ceInfo[id].reps > 1)
          if (ceFail.length > 0 && !warned.current[`ce-fail-${r.id}`]) {
            warned.current[`ce-fail-${r.id}`] = true
            st.addEvent('RU', 'warn',
              pick(st.lang,
                `${r.name}: NB-IoT/LTE-M ${ceFail.length}개 UE — CE 레벨 최대에서도 MCL 미달(NPRACH 반복 상한 초과) → RACH 실패, 트래픽 차단`,
                `${r.name}: ${ceFail.length} NB-IoT/LTE-M UE — beyond MCL even at max CE (NPRACH rep cap) → RACH failure, traffic blocked`,
                `${r.name}: ${ceFail.length} 个 NB-IoT/LTE-M UE — 最大CE仍超MCL(NPRACH 重复上限) → RACH 失败，流量中断`),
              r.name)
          } else if (ceFail.length === 0) warned.current[`ce-fail-${r.id}`] = false
          if (ceDeep.length > 0 && !warned.current[`ce-deep-${r.id}`]) {
            warned.current[`ce-deep-${r.id}`] = true
            const worst = ceDeep.reduce((a, id) => Math.max(a, ceInfo[id].reps), 1)
            const mode = ceInfo[ceDeep[0]].mode
            st.addEvent('RU', 'info',
              pick(st.lang,
                `${r.name}: CE Mode ${mode} — 심층 커버리지 ${ceDeep.length}개 UE, 최대 ${worst} 반복 → 셀 자원 ×${worst} 소모, 저속·고지연`,
                `${r.name}: CE Mode ${mode} — ${ceDeep.length} deep-coverage UE, up to ${worst} repetitions → ×${worst} cell resource, low rate/high latency`,
                `${r.name}: CE Mode ${mode} — ${ceDeep.length} 个深覆盖 UE，最多 ${worst} 次重复 → 小区资源 ×${worst}，低速·高时延`),
              r.name)
          } else if (ceDeep.length === 0) warned.current[`ce-deep-${r.id}`] = false

          // ---- PHY: delay-critical GBR(5QI 82/83/84/85) — 혼잡 시 PDB 초과 패킷 폐기 ----
          const dcIds = grantIds.filter((id) => DELAY_CRITICAL_5QI.has(tiOf(id).fiveqi))
          if (dcIds.length > 0 && prbUtil > 1 && !warned.current[`dc-${r.id}`]) {
            warned.current[`dc-${r.id}`] = true
            const fq = tiOf(dcIds[0]).fiveqi
            st.addEvent('RU', 'warn',
              pick(st.lang,
                `${r.name}: delay-critical 5QI${fq} — 셀 혼잡(${(prbUtil * 100).toFixed(0)}%)으로 큐잉 지연이 PDB 초과 → 패킷 폐기(PER↑), MDBV 초과분 드롭`,
                `${r.name}: delay-critical 5QI${fq} — congestion (${(prbUtil * 100).toFixed(0)}%) pushes queuing past PDB → packets dropped (PER↑), MDBV excess dropped`,
                `${r.name}: delay-critical 5QI${fq} — 拥塞(${(prbUtil * 100).toFixed(0)}%)使排队超 PDB → 丢包(PER↑)，MDBV 超出部分丢弃`),
              r.name)
          } else if (dcIds.length === 0 || prbUtil <= 0.9) warned.current[`dc-${r.id}`] = false

          // RRC 접속 한계 초과 → 신규 접속 거부
          if (rrcLoad > 1 && !warned.current[`rrc-${r.id}`]) {
            warned.current[`rrc-${r.id}`] = true
            st.addEvent('RU', 'warn',
              pick(st.lang,
                `${r.name}: RRC 접속 한계 초과 (${nAttached}/${g.max_ue}) — 신규 RRC Setup Reject`,
                `${r.name}: RRC connection limit (${nAttached}/${g.max_ue}) — new RRC Setup Reject`,
                `${r.name}: RRC 接入达到上限 (${nAttached}/${g.max_ue}) — 新 RRC Setup Reject`),
              r.name)
          } else if (rrcLoad <= 0.9) warned.current[`rrc-${r.id}`] = false

          // PRB 혼잡 (>90%) → 비GBR 스루풋 저하 / RAN Overload
          if (prbUtil > 0.9 && !warned.current[`prb-${r.id}`]) {
            warned.current[`prb-${r.id}`] = true
            const perUe = (cellPeak / Math.max(grantIds.length, 1)).toFixed(0)
            st.addEvent('RU', 'warn',
              pick(st.lang,
                `${r.name}: PRB 사용률 ${(prbUtil * 100).toFixed(0)}% 혼잡 — GBR 우선 보장, 비GBR은 1인당 ~${perUe}Mbps로 하락`,
                `${r.name}: PRB ${(prbUtil * 100).toFixed(0)}% congested — GBR protected, non-GBR ~${perUe}Mbps/UE`,
                `${r.name}: PRB 使用率 ${(prbUtil * 100).toFixed(0)}% 拥塞 — GBR 优先保障，非GBR 单用户 ~${perUe}Mbps`),
              r.name)
          } else if (prbUtil <= 0.8) warned.current[`prb-${r.id}`] = false
        }
      }
      // ---- 배치 UE 무선구간 강제(추가 플로어): RAN 경로(RU→DU→CU→AMF/UPF) 사슬 + RSRP 커버리지 ----
      // SINR≥-10 플로어·슬라이스·등록·admission 로직은 그대로 두고, 그 위에 얹는 추가 게이트.
      // 좋은 곳→기준 미달 지역으로 이동하면 활성 통화/트래픽이 끊기도록 한다(걷는 UE는 FirstPerson에서 처리).
      const dropThr = st.mobility.call_drop_rsrp_dbm
      // Fix 3: 이번 틱에서 활성 통화는 최대 1회만 endCall (양쪽 party가 동시에 나빠질 때
      //   두 번째 endCall이 Call Waiting으로 막 재개된 heldCall을 잘못 끊는 것을 방지).
      let callDropped = false
      // Fix 2: 통화 party로서 드롭된 UE는 personTraffic도 내려 "통화 없는데 트래픽 ON" stuck 방지.
      //   순수 데이터 드롭은 personTraffic=true 유지(신호/코어 복귀 시 자동 재개).
      const clearTraffic: string[] = []
      // 활성 통화를 안전하게 드롭: 재판독해 여전히 이 UE의 통화일 때만, 틱당 1회. 드롭된 통화의 양쪽 party id 반환.
      const dropActiveCall = (uid: string): string[] => {
        if (callDropped) return []
        const live = useStore.getState().call
        if (live && (live.fromId === uid || live.toId === uid)) {
          const parties = [live.fromId, live.toId]
          st.endCall()
          callDropped = true
          return parties
        }
        return []
      }
      for (const ue of st.objects) {
        if (ue.kind !== 'person') continue
        const id = ue.id
        const zone = objZone(ue)
        const imsi = st.personImsi[id] ?? defaultImsi(st.ueSim)
        // 서빙 RU: UE 존 내 켜진 최근접 gNB (셀 귀속 거리 로직과 동일)
        let servingRu: SceneObject | undefined
        let bd = Infinity
        for (const r of st.objects) {
          if (r.kind !== 'gnb' || objZone(r) !== zone || !r.gnb?.enabled) continue
          const d = (r.position[0] - ue.position[0]) ** 2 + (r.position[2] - ue.position[2]) ** 2
          if (d < bd) { bd = d; servingRu = r }
        }
        // RSRP: probe가 있으면 그 값, 없으면 존 sim RSRP 그리드에서 UE 위치 샘플
        const rsrp = st.personProbes[id]?.rsrp_dbm ?? personRsrp(ue, st.sims[zone])
        const chain = servingRu
          ? ranChainOk(servingRu, st.objects, st.ranUnits, st.coreNfs, st.siteDown)
          : { ok: false, reason: 'RU-off' as string }
        // Fix 1: 코어 E2E(RU 사슬 + 등록 AMF/AUSF/UDM + 세션 SMF/UPF + DN) — RAN 사슬이 검증 못하는
        //   SMF/AUSF/UDM/DN 상실을 잡는다. (레거시 존은 RU 통과 후 AMF/UPF 검사로 커버)
        const e2e = computeE2E(st.objects, st.coreNfs, st.coreDn, zone, st.siteDown, st.ranUnits)
        const inCall = st.call != null && (st.call.fromId === id || st.call.toId === id)
        const trafficOn = (st.personTraffic[id] ?? false) && (st.personUeOn[id] ?? false)
        // 트래픽도 없고 통화 party도 아니면 강제 대상 아님 — 드롭 상태만 정리(다음 활성 시 재로깅 허용)
        if (!trafficOn && !inCall) { droppedUes.current.delete(id); continue }
        const wasDropped = droppedUes.current.has(id)
        const ranBroken = !servingRu || !chain.ok
        const coreBroken = !e2e.ok
        const rsrpLow = rsrp != null && rsrp < dropThr

        if (ranBroken || coreBroken) {
          // RAN 사슬 단절 또는 코어 미도달 → 무조건 트래픽 0 + 통화 드롭
          personMbps[id] = 0
          if (inCall) clearTraffic.push(...dropActiveCall(id))
          if (!wasDropped) {
            droppedUes.current.add(id)
            st.addEvent(ranBroken ? 'RU' : 'NF', 'error',
              pick(st.lang,
                `${ue.name}: 트래픽 중단 — ${ranBroken ? ranChainText(chain.reason, 'ko') : `코어 미도달(${e2e.missing.join(', ')})`}`,
                `${ue.name}: traffic stopped — ${ranBroken ? ranChainText(chain.reason, 'en') : `core unreachable (${e2e.missing.join(', ')})`}`,
                `${ue.name}: 流量中断 — ${ranBroken ? ranChainText(chain.reason, 'zh') : `核心不可达(${e2e.missing.join(', ')})`}`),
              ue.name, undefined, imsi)
          }
        } else if (rsrpLow) {
          // 커버리지 이탈(RSRP < 기준) → 트래픽 0, 통화 드롭
          personMbps[id] = 0
          const r = Math.round(rsrp as number)
          if (inCall) {
            clearTraffic.push(...dropActiveCall(id))
            if (!wasDropped) {
              droppedUes.current.add(id)
              st.addEvent('RU', 'error',
                pick(st.lang,
                  `${ue.name}: 콜 드롭 — RSRP ${r} < 기준 ${dropThr} (커버리지 이탈)`,
                  `${ue.name}: call dropped — RSRP ${r} < threshold ${dropThr} (coverage loss)`,
                  `${ue.name}: 掉话 — RSRP ${r} < 阈值 ${dropThr} (脱离覆盖)`),
                ue.name, undefined, imsi)
            }
          } else if (trafficOn && !wasDropped) {
            droppedUes.current.add(id)
            st.addEvent('RU', 'error',
              pick(st.lang,
                `${ue.name}: 데이터 중단 — RSRP ${r} < 기준 ${dropThr}`,
                `${ue.name}: data stopped — RSRP ${r} < threshold ${dropThr}`,
                `${ue.name}: 数据中断 — RSRP ${r} < 阈值 ${dropThr}`),
              ue.name, undefined, imsi)
          }
        } else if (wasDropped) {
          // 회복: RAN 정상 + 코어 도달 + RSRP가 히스테리시스(기준+5dB) 이상으로 복귀 시 드롭 해제.
          //   (이 분기는 !ranBroken && !coreBroken && !rsrpLow일 때만 도달 → ran/코어 모두 정상 보장)
          if (rsrp == null || rsrp > dropThr + 5) droppedUes.current.delete(id)
        }
      }
      // Fix 2: 통화 드롭된 party들의 personTraffic 해제 (배치 갱신 — 순수 데이터 드롭은 건드리지 않음)
      if (clearTraffic.length > 0) {
        useStore.setState((s) => {
          const pt = { ...s.personTraffic }
          for (const cid of clearTraffic) pt[cid] = false
          return { personTraffic: pt }
        })
      }
      // 제거된 UE는 드롭 집합에서 정리 (메모리 누수 방지)
      for (const gone of [...droppedUes.current]) {
        if (!st.objects.some((o) => o.id === gone)) droppedUes.current.delete(gone)
      }
      st.setPersonMbps(personMbps)

      // ---- NRF 활성 인스턴스 선택 + geo-redundancy failover 감지/로깅 ----
      const sd = st.siteDown
      const seenTypes = new Set<string>()
      for (const nf of st.coreNfs) {
        const key = `${nf.zone}:${nf.nf_type}`
        if (seenTypes.has(key)) continue
        seenTypes.add(key)
        // 같은 (zone,type) 인스턴스가 2개 이상일 때만 failover 개념 의미
        const instances = st.coreNfs.filter((n) => n.zone === nf.zone && n.nf_type === nf.nf_type)
        const act = activeNf(st.coreNfs, nf.zone, nf.nf_type, sd)
        const actId = act?.id ?? null
        const prev = activeRef.current[key]
        if (prev !== undefined && prev !== actId && instances.length >= 2) {
          const prevNf = st.coreNfs.find((n) => n.id === prev)
          if (actId && act) {
            st.addEvent('NF', 'warn',
              pick(st.lang,
                `[PLMN-${nf.zone}] geo-redundancy 절체: ${nf.nf_type} ${prevNf?.name ?? '?'} 불가 → ${act.name}(site ${act.site}, priority ${act.priority}) NRF 재선택으로 인계`,
                `[PLMN-${nf.zone}] geo-redundancy failover: ${nf.nf_type} ${prevNf?.name ?? '?'} down → ${act.name} (site ${act.site}, prio ${act.priority}) took over via NRF`,
                `[PLMN-${nf.zone}] geo冗余切换: ${nf.nf_type} ${prevNf?.name ?? '?'} 不可用 → ${act.name}(站点 ${act.site}, 优先级 ${act.priority}) 经NRF接管`),
              act.name)
          } else if (!actId) {
            st.addEvent('NF', 'error',
              pick(st.lang,
                `[PLMN-${nf.zone}] ${nf.nf_type} 전 인스턴스 불가 — 서비스 중단 (모든 사이트 다운/비활성)`,
                `[PLMN-${nf.zone}] all ${nf.nf_type} instances unavailable — service outage`,
                `[PLMN-${nf.zone}] ${nf.nf_type} 全部实例不可用 — 服务中断`),
              nf.nf_type)
          }
        }
        activeRef.current[key] = actId
      }

      // ---- SECTION B: NWDAF 폐루프 — 존별 활성 NWDAF 유무. 있으면 부하분석·스케일 권고를
      //      기존 HPA/과부하 액추에이션에 붙여 "NWDAF 분석 → 권고 → PCF/AMF/HPA 실행"으로 라벨링.
      const nwdafZone = (z: Zone) => activeNf(st.coreNfs, z, 'NWDAF', sd) != null

      // ---- NF 부하 + HPA + 다운 (활성 인스턴스만 부하 처리, 대기/사이트다운은 유휴) ----
      for (const nf of st.coreNfs) {
        if (!nf.enabled) continue
        if (sd[nf.site]) { loads[nf.id] = { load: 0, cpu: 0 }; continue } // 사이트 장애 → 다운
        const activeInst = activeNf(st.coreNfs, nf.zone, nf.nf_type, sd)
        if (activeInst && activeInst.id !== nf.id) {
          loads[nf.id] = { load: 0, cpu: 6 } // warm-standby 유휴 (부하 없음)
          continue
        }
        const cap = NF_CAPACITY_PER_POD[nf.nf_type]
        let usage = 0
        if (nf.nf_type === 'AMF') usage = ueCount[nf.zone]
        else if (nf.nf_type === 'SMF') usage = sessions[nf.zone]
        else if (nf.nf_type === 'UPF') {
          // 걷는 UE(로밍 시 홈 UPF도 경유) + 해당 존 측정요원 트래픽 합
          // 로밍: UE가 방문존이면 방문 UPF + 홈(homeZone) UPF 둘 다 경유
          const roaming = st.ueZone != null && st.ueZone !== st.homeZone
          const walkingInPath =
            st.trafficActive &&
            (st.ueZone === nf.zone || (roaming && nf.zone === st.homeZone))
          usage = (walkingInPath ? st.trafficMbps : 0) + personTrafficByZone[nf.zone]
        } else {
          // 제어 NF: 존 UE 수에 비례하는 가벼운 부하만 표시
          loads[nf.id] = {
            load: Math.min(ueCount[nf.zone] / 500, 0.5),
            cpu: 8 + Math.min(ueCount[nf.zone] / 10, 40),
          }
          continue
        }
        const capacity = (nf.capacity_per_pod ?? cap?.value ?? 1000) * nf.replicas
        const ueLoad = usage / Math.max(capacity, 1)
        // 파드당 처리량(throughput_per_pod) 기준 부하 — UPF(사용자평면)만 user-plane Mbps로 스케일.
        // AMF/SMF(제어평면)는 user-plane 처리량을 나르지 않으므로 UE/세션 수 부하(ueLoad)만 사용.
        let zoneThroughput = 0
        let thrLoad = 0
        if (nf.nf_type === 'UPF') {
          const roamingT = st.ueZone != null && st.ueZone !== st.homeZone
          const walkThr =
            st.trafficActive && (st.ueZone === nf.zone || (roamingT && nf.zone === st.homeZone))
              ? st.trafficMbps : 0
          zoneThroughput = walkThr + personTrafficByZone[nf.zone]
          const thrCap = (nf.throughput_per_pod ?? 5000) * nf.replicas
          thrLoad = zoneThroughput / Math.max(thrCap, 1)
        }
        const load = Math.max(ueLoad, thrLoad)
        loads[nf.id] = { load, cpu: Math.min(10 + load * 85, 100) }

        const maxRep = nf.max_replicas ?? DEFAULT_MAX_REPLICAS
        // HPA (80%) — UE수 또는 처리량 초과 시 최대 replicas 상한까지 스케일아웃
        if (load > HPA_THRESHOLD && nf.auto_scale && nf.replicas < maxRep) {
          const driver = thrLoad >= ueLoad
            ? pick(st.lang, `처리량 ${zoneThroughput.toFixed(0)}Mbps`, `throughput ${zoneThroughput.toFixed(0)}Mbps`, `吞吐 ${zoneThroughput.toFixed(0)}Mbps`)
            : pick(st.lang, `${cap?.metric ?? 'UE'} ${usage.toFixed(0)}`, `${cap?.metric ?? 'UE'} ${usage.toFixed(0)}`, `${cap?.metric ?? 'UE'} ${usage.toFixed(0)}`)
          st.updateCoreNf(nf.id, { replicas: nf.replicas + 1 })
          // SECTION B: NWDAF-driven 폐루프 — NWDAF 분석(NF_LOAD)이 스케일아웃 권고를 내고
          // HPA가 실행하는 것으로 라벨링. NWDAF가 있으면 폐루프 로그를 함께 방출.
          if (nwdafZone(nf.zone)) {
            st.addEvent('NF', 'info',
              pick(st.lang,
                `NWDAF 폐루프: Nnwdaf_AnalyticsSubscription(NF_LOAD) ${nf.nf_type} ${(load * 100).toFixed(0)}% → 권고 SCALE-OUT → HPA 실행`,
                `NWDAF closed-loop: Nnwdaf_AnalyticsSubscription(NF_LOAD) ${nf.nf_type} ${(load * 100).toFixed(0)}% → recommend SCALE-OUT → HPA actuates`,
                `NWDAF 闭环: Nnwdaf_AnalyticsSubscription(NF_LOAD) ${nf.nf_type} ${(load * 100).toFixed(0)}% → 建议 SCALE-OUT → HPA 执行`),
              'NWDAF')
          }
          st.addEvent('NF', 'info',
            pick(st.lang,
              `HPA: ${nf.nf_type} 부하 ${(load * 100).toFixed(0)}% > 80% (${driver}) → 파드 ${nf.replicas}→${nf.replicas + 1}/${maxRep}`,
              `HPA: ${nf.nf_type} load ${(load * 100).toFixed(0)}% > 80% (${driver}) → pods ${nf.replicas}→${nf.replicas + 1}/${maxRep}`,
              `HPA: ${nf.nf_type} 负载 ${(load * 100).toFixed(0)}% > 80% (${driver}) → Pod ${nf.replicas}→${nf.replicas + 1}/${maxRep}`),
            nf.name)
          continue
        }
        // 수용 거부 (100%) — 실제 시스템의 NF별 과부하 반응
        if (load > 1 && !warned.current[nf.id]) {
          warned.current[nf.id] = true
          const react = pick(st.lang,
            (nf.nf_type === 'AMF' ? 'NGAP Overload Start → 신규 등록 거부, 백오프 T3346 부여'
              : nf.nf_type === 'SMF' ? '신규 PDU 세션 수립 거부 (자원 부족)'
              : nf.nf_type === 'UPF' ? '패킷 드롭/큐잉 지연 — 처리량 한계'
              : `신규 ${cap?.metric ?? ''} 수용 거부`),
            (nf.nf_type === 'AMF' ? 'NGAP Overload Start → new registrations rejected, T3346 backoff'
              : nf.nf_type === 'SMF' ? 'new PDU sessions rejected (no resources)'
              : nf.nf_type === 'UPF' ? 'packet drop / queuing delay — throughput limit'
              : `new ${cap?.metric ?? ''} rejected`),
            (nf.nf_type === 'AMF' ? 'NGAP Overload Start → 拒绝新注册，赋予 T3346 回退'
              : nf.nf_type === 'SMF' ? '拒绝新建 PDU 会话（资源不足）'
              : nf.nf_type === 'UPF' ? '丢包/排队时延 — 吞吐上限'
              : `拒绝新 ${cap?.metric ?? ''}`))
          st.addEvent('NF', 'warn',
            pick(st.lang,
              `${nf.name} 과부하 ${(load * 100).toFixed(0)}% — ${react}`,
              `${nf.name} overload ${(load * 100).toFixed(0)}% — ${react}`,
              `${nf.name} 过载 ${(load * 100).toFixed(0)}% — ${react}`),
            nf.name)
          // SECTION B: NWDAF 폐루프 — 과부하(HPA 상한/off)는 스케일이 아닌 admission/policy 액추에이션 권고.
          if (nwdafZone(nf.zone)) {
            st.addEvent('NF', 'info',
              pick(st.lang,
                `NWDAF 폐루프: ${nf.nf_type} 과부하 감지 → 권고 ${nf.nf_type === 'AMF' ? 'AMF admission control(NGAP Overload)' : nf.nf_type === 'UPF' ? 'PCF 정책 조정/트래픽 조절' : 'admission control'} (스케일 상한 도달)`,
                `NWDAF closed-loop: ${nf.nf_type} overload detected → recommend ${nf.nf_type === 'AMF' ? 'AMF admission control (NGAP Overload)' : nf.nf_type === 'UPF' ? 'PCF policy tune / traffic throttling' : 'admission control'} (scale ceiling reached)`,
                `NWDAF 闭环: ${nf.nf_type} 检测到过载 → 建议 ${nf.nf_type === 'AMF' ? 'AMF 接纳控制(NGAP Overload)' : nf.nf_type === 'UPF' ? 'PCF 策略调整/流量限速' : '接纳控制'} (已达扩容上限)`),
              'NWDAF')
          }
        } else if (load <= 0.9) warned.current[nf.id] = false

        // 지속 과부하 → 다운 (OOMKilled) — HPA가 꺼져 있거나 최대 파드일 때
        if (load > CRASH_THRESHOLD && (!nf.auto_scale || nf.replicas >= maxRep)) {
          sustained.current[nf.id] = (sustained.current[nf.id] ?? 0) + 1
          if (sustained.current[nf.id] >= CRASH_SUSTAIN_TICKS) {
            sustained.current[nf.id] = 0
            st.updateCoreNf(nf.id, { enabled: false })
            st.addEvent('NF', 'error',
              pick(st.lang,
                `💥 ${nf.name} 다운 — CPU/메모리 지속 피크 (OOMKilled). 재기동 필요`,
                `💥 ${nf.name} DOWN — sustained CPU/mem peak (OOMKilled). Restart required`,
                `💥 ${nf.name} 宕机 — CPU/内存持续峰值 (OOMKilled)。需重启`),
              nf.name)
          }
        } else {
          sustained.current[nf.id] = 0
        }
      }

      // ---- SECTION B: NWDAF 주기 부하분석(Nnwdaf_AnalyticsSubscription NF_LOAD/슬라이스) ----
      // 기존 loads/personTrafficByZone를 읽어 존별 최고부하 NF + 슬라이스(트래픽) 부하를 방출.
      // 폐루프 입력단(분석)을 가시화. 15틱(≈15s)마다, 활성 NWDAF가 있는 존만, 유의미한 부하일 때.
      nwdafTick.current++
      if (nwdafTick.current % 15 === 0) {
        for (const z of ZONES) {
          if (!nwdafZone(z)) continue
          // 이 존 NF 중 최고 부하 (활성 인스턴스 기준)
          let topType = ''
          let topLoad = 0
          for (const nf of st.coreNfs) {
            if (nf.zone !== z || !nf.enabled) continue
            const l = loads[nf.id]?.load ?? 0
            if (l > topLoad) { topLoad = l; topType = nf.nf_type }
          }
          const sliceMbps = personTrafficByZone[z] +
            (st.trafficActive && st.ueZone === z ? st.trafficMbps : 0)
          if (topLoad < 0.1 && sliceMbps < 1) continue // 유휴 존은 스킵
          st.addEvent('NF', 'info',
            pick(st.lang,
              `NWDAF analytics [PLMN-${z}]: 최고부하 ${topType || 'NF'} ${(topLoad * 100).toFixed(0)}%, slice(eMBB) 부하 ${sliceMbps.toFixed(0)}Mbps — ${topLoad > 0.8 ? '스케일 권고' : '정상 범위'}`,
              `NWDAF analytics [PLMN-${z}]: peak-load ${topType || 'NF'} ${(topLoad * 100).toFixed(0)}%, slice(eMBB) load ${sliceMbps.toFixed(0)}Mbps — ${topLoad > 0.8 ? 'scale recommended' : 'within normal'}`,
              `NWDAF analytics [PLMN-${z}]: 峰值负载 ${topType || 'NF'} ${(topLoad * 100).toFixed(0)}%, 切片(eMBB) 负载 ${sliceMbps.toFixed(0)}Mbps — ${topLoad > 0.8 ? '建议扩容' : '正常范围'}`),
            'NWDAF')
        }
      }

      st.setNfLoads(loads)
    }, 1000)
    return () => clearInterval(timer)
  }, [])
}

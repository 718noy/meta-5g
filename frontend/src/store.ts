import { create } from 'zustand'
import { buildAttachSteps, buildDeregisterSteps, buildGutiReallocSteps, buildMroFailureSteps, buildPagingSteps, buildPositioningSteps, buildRerouteSteps, buildRnauSteps, buildServiceRequestSteps, endpoints } from './attach'
import type { AttachStep, MroType, PosMethod } from './attach'
import { LOGT, pick } from './i18n'
import { SCENARIOS } from './scenarios'
import type {
  CoreNf,
  NfParams,
  NfType,
  ObjKind,
  ProbeResult,
  RanArch,
  RanUnit,
  RanUnitKind,
  SceneObject,
  SimResult,
  SpaceConfig,
  Tool,
  Zone,
} from './types'
import type { Slice, SuppServices, TrafficType, UeSim } from './types'
import {
  CATALOG,
  DEFAULT_GNB,
  DEFAULT_NF,
  DEFAULT_UE_SIM,
  activeNf,
  computeAllowedNssai,
  computeE2E,
  defaultImsi,
  objZone,
  imsiRegistered,
  imsiWithMsin,
  ranChainOk,
  ranChainText,
  suciOf,
  supiOf,
  trafficInfo,
} from './types'

export type Mode = 'edit' | 'walk'
export type VizMode = 'volume' | 'slice' | 'off'
export type VizMetric = 'rsrp' | 'sinr' | 'cell'
export type SimStatus = 'idle' | 'running' | 'error'

export type LogSource = 'SIM' | 'UE' | 'RU' | 'NF'
export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEvent {
  id: number
  time: string
  source: LogSource
  level: LogLevel
  msg: string
  node?: string // 발생 주체 (예: AMF-1, RU-2) — NF별 로그 분리용
  dir?: 'in' | 'out' // PART 12: 노드 기준 메시지 방향 (in=← 수신 / out=→ 송신)
  imsi?: string // PART 11: 이 로그가 어느 SIM/UE(IMSI)의 것인지
  // SECTION T: 콜플로우 추적 — 명시적 송신자/수신자 (who sends → who receives)
  from?: string
  to?: string
}

let eventCounter = 1
let idCounter = 1
const nextId = () => `obj-${idCounter++}`

// 단말별 attach 절차 취소 토큰 (전원 재토글 시 이전 시퀀스 무효화)
const attachTokens: Record<string, number> = {}

// UE(측정요원)마다 고유 IMSI를 부여하기 위한 전역 시퀀스 — 세션 내 절대 중복되지 않도록 계속 증가.
// n=0(=defaultImsi)은 시작 SIM/걷는 UE 몫으로 남겨두고, 배치되는 UE는 1부터 부여한다.
let personImsiSeq = 1
const nextPersonImsi = (sim: UeSim): string => imsiWithMsin(sim, personImsiSeq++)

// BUG2: 시나리오 → 전용 call-flow 빌더 매핑. 이 시나리오들은 (attach 후) 광고된 절차 로그를
// 실제로 스트리밍한다. (이전엔 빌더가 어디서도 호출되지 않아 평범한 attach만 흘렀다.)
const FLOW_BUILDER_SCENARIOS = new Set<string>([
  'mt-paging-ddn', 'reg-mico-unreachable', 'rnau-inactive', 'guti-reallocation',
  'reg-reroute-nas', 'mro-too-late', 'mro-too-early', 'mro-wrong-cell',
])

// SECTION A: 배치형 UE의 현재 서빙 RU/코어 NF를 해석해 call-flow 빌더용 FlowCtx 생성.
// togglePersonUe(attach)와 동일한 선택 로직(최근접 RU + NRF 기반 activeNf)을 재사용.
function flowCtxForPerson(s: State, obj: SceneObject) {
  const zone = (obj.zone ?? 'A') as Zone
  const nf = (type: NfType) => activeNf(s.coreNfs, zone, type, s.siteDown)?.name ?? null
  const rus = s.objects.filter(
    (o) => o.kind === 'gnb' && (o.zone ?? 'A') === zone && o.gnb?.enabled !== false,
  )
  let serving: string | null = null
  let servPci: number | null = null
  let bd = Infinity
  for (const r of rus) {
    const d = (r.position[0] - obj.position[0]) ** 2 + (r.position[2] - obj.position[2]) ** 2
    if (d < bd) { bd = d; serving = r.name; servPci = r.gnb?.pci ?? null }
  }
  const ueIp = `10.45.${zone === 'A' ? 0 : zone === 'B' ? 1 : 2}.${((obj.name.length * 7) % 250) + 2}`
  return { ueName: obj.name, servingName: serving, pci: servPci, amf: nf('AMF'), smf: nf('SMF'), upf: nf('UPF'), ueIp }
}

// UE의 서빙 RU = 같은 존에서 송출 중인 가장 가까운 RU(gnb). togglePersonUe/attach와 동일한 최근접 선택.
function servingRuFor(ue: SceneObject, objects: SceneObject[]): SceneObject | undefined {
  const zone = (ue.zone ?? 'A') as Zone
  const rus = objects.filter(
    (o) => o.kind === 'gnb' && (o.zone ?? 'A') === zone && o.gnb?.enabled !== false,
  )
  let best: SceneObject | undefined
  let bd = Infinity
  for (const r of rus) {
    const d = (r.position[0] - ue.position[0]) ** 2 + (r.position[2] - ue.position[2]) ** 2
    if (d < bd) { bd = d; best = r }
  }
  return best
}

export type CallPhase =
  | 'idle' | 'inviting' | 'ringing' | 'active' | 'ended' | 'failed'
export interface CallState {
  fromId: string
  toId: string
  fromName: string
  toName: string
  phase: CallPhase
  interPlmn: boolean
  startedSec: number | null // active 시작 시각(초)
  reason?: string
  held?: boolean // 통화 보류(Hold) 상태 — re-INVITE a=sendonly/inactive (TS 24.610)
  forwardedFrom?: string // 착신전환으로 재라우팅된 경우 원 착신자 이름 (표시용)
  waitingFrom?: string // Call Waiting으로 보류된 원 통화 상대 이름 (표시용)
}

interface State {
  lang: 'ko' | 'en' | 'zh'
  space: SpaceConfig // 존 하나의 크기 (두 존 동일)
  objects: SceneObject[]
  coreNfs: CoreNf[] // 논리 Core — 존(국가)별 소속
  coreDn: Record<Zone, boolean> // 존별 DN(외부망) 연결 여부
  homeZone: Zone // 걷는 UE의 홈 PLMN — 이 존이 홈, 나머지는 방문(로밍)
  ceiling: boolean // 천장 유무 (없으면 상방 개방, 천장 반사 없음)
  floorPlan: string | null // 바닥에 깔 도면 이미지 (dataURL) — 실내 평면도 참조
  slices: Slice[] // 네트워크 슬라이스 (존별 S-NSSAI)
  ranArch: Record<Zone, RanArch> // 존별 RAN 아키텍처 (일체형/CU-DU 분리) — 논리 구성
  ranUnits: RanUnit[] // RAN 논리 유닛 (CU/DU) — RU(gnb)는 gnb.du_id로 DU에 연결
  // 이동성 파라미터 — 사이트 최적화 엔지니어의 대표 튜닝 대상
  mobility: {
    a3_offset_db: number // A3: 이웃>서빙+offset 시 HO
    hysteresis_db: number
    ttt_ms: number // TimeToTrigger
    cio_db: number // Cell Individual Offset (셀 경계 조정)
    a2_threshold_dbm: number // A2: 서빙<임계 → 측정 시작/재선택 고려
    t310_ms: number // RLF: 물리계층 문제 지속 시 T310 만료→RLF
    n310: number // 연속 out-of-sync 지시 횟수
    call_drop_rsrp_dbm: number // 이 RSRP 밑으로 떨어지면 통화 드롭 (Qout 근사)
    rlf_rsrp_dbm: number // RLF 판정 RSRP 문턱 (Qout) — 이 밑이면 무선링크 실패
  }
  selectedId: string | null
  selectedIds: string[] // 다중 선택 (박스 선택). selectedId는 대표(첫 항목)
  marquee: boolean // 박스 선택 드래그 중 (OrbitControls 비활성화용)
  tool: Tool
  radioKind: 'active' | 'passive' | 'ceiling' | 'wall' // RU 배치 시 변형 선택
  mode: Mode
  vizMode: VizMode
  vizMetric: VizMetric
  vizDensity: number
  sliceY: number
  sims: Record<Zone, SimResult | null>
  simStatus: SimStatus
  probe: ProbeResult | null
  personProbes: Record<string, ProbeResult> // 배치형 UE(측정 요원) 측정값
  // 용량/부하 모델 — id(coreNf 또는 gnb) → 부하율(0~), CPU%
  nfLoads: Record<string, { load: number; cpu: number }>
  // 배치형 UE(측정요원) 트래픽 — id → 활성 여부 / 순간 Mbps (그리드 기반 산출)
  personTraffic: Record<string, boolean>
  personMbps: Record<string, number>
  personUeOn: Record<string, boolean> // 단말 전원 (기본 OFF). ON 시 3GPP attach 절차 수행
  personTrafficType: Record<string, TrafficType> // 측정요원별 트래픽 서비스 종류
  personImsi: Record<string, string> // 측정요원별 IMSI (미지정 시 전역 SIM). 미등록 시 트래픽 차단
  personCallee: Record<string, string> // 측정요원(UE) → 음성통화 대상 UE id
  personBarred: Record<string, boolean> // 접속 차단(Access barring, UAC) — 전원 ON/트래픽 시도 차단
  personSupp: Record<string, SuppServices> // UE별 MMTEL 부가서비스(TAS) 토글
  registeredImsis: string[] // PART 13: Core(UDM/UDR)에 프로비저닝된 IMSI 레지스트리
  trafficType: TrafficType // 전역 기본 트래픽 종류 (per-person 미지정 시)
  // VoNR 통화 (IMS SIP)
  call: CallState | null
  heldCall: CallState | null // Call Waiting: 2호 연결 시 보류된 기존 통화 (2호 종료 시 복원)
  events: LogEvent[]
  showLog: boolean
  showCore: boolean
  showNms: boolean
  showCall: boolean
  // 절차 상세(E2E call flow 다이어그램) — 대상 UE: 배치 UE의 id 또는 'walk'
  procedureUe: string | null
  procedureNonce: number // '절차상세' 버튼 클릭마다 증가 — 같은 UE 재클릭 시에도 최소화 복원 트리거
  panelNonce: Record<string, number> // 패널별 리마운트 nonce — 여는 버튼 재클릭 시 증가 → 위치/크기 디폴트로 리셋
  trafficHistory: number[] // 최근 처리량 샘플 (스파크라인용, 최대 120개)
  ghost: { x: number; z: number; zone: Zone } | null
  ghostRot: number
  gizmoMode: 'translate' | 'rotate'
  dragging: { id: string; zone: Zone } | null // 마우스 드래그 이동 중인 오브젝트
  engine: 'empirical' | 'rt'
  // 걷는 UE 상태 — 홈 PLMN은 A
  ueSim: UeSim
  ueOn: boolean
  ueZone: Zone | null // 현재 위치한 존 (간극 지역이면 null)
  trafficActive: boolean
  trafficMbps: number
  trafficMb: number

  setLang: (l: 'ko' | 'en' | 'zh') => void
  setSpace: (patch: Partial<SpaceConfig>) => void
  setTool: (t: Tool) => void
  setRadioKind: (k: 'active' | 'passive' | 'ceiling' | 'wall') => void
  setMode: (m: Mode) => void
  setVizMode: (v: VizMode) => void
  setVizMetric: (v: VizMetric) => void
  setVizDensity: (d: number) => void
  setSliceY: (y: number) => void
  select: (id: string | null) => void
  setSelectedIds: (ids: string[]) => void
  setMarquee: (v: boolean) => void
  setGhost: (g: { x: number; z: number; zone: Zone } | null) => void
  rotateGhost: () => void
  setGizmoMode: (m: 'translate' | 'rotate') => void
  setDragging: (d: { id: string; zone: Zone } | null) => void
  setEngine: (e: 'empirical' | 'rt') => void
  addObject: (kind: ObjKind, x: number, z: number, rot: number, zone: Zone) => void
  updateObject: (id: string, patch: Partial<SceneObject>) => void
  updateGnb: (id: string, patch: Partial<SceneObject['gnb'] & object>) => void
  removeObject: (id: string) => void
  addCoreNf: (zone: Zone, type: NfType) => void
  updateCoreNf: (id: string, patch: Partial<NfParams>) => void
  removeCoreNf: (id: string) => void
  setCoreDn: (zone: Zone, v: boolean) => void
  setRanArch: (zone: Zone, a: RanArch) => void
  // RAN 논리 유닛 (CU/DU) CRUD + 물리 라디오(RU) 추가
  addRanUnit: (kind: RanUnitKind, zone: Zone) => void
  removeRanUnit: (id: string) => void
  updateRanUnit: (id: string, patch: Partial<RanUnit>) => void
  toggleRanUnit: (id: string) => void
  addRadio: (tech: 'nr' | 'lte', zone: Zone) => void
  setHomeZone: (z: Zone) => void
  setCeiling: (v: boolean) => void
  setFloorPlan: (dataUrl: string | null) => void
  addSlice: (zone: Zone, sst: number, sd: string) => void
  removeSlice: (id: string) => void
  autoPlanPci: () => void
  applyLayoutPreset: (preset: 'spacious' | 'office' | 'factory' | 'warehouse' | 'hall' | 'cafe', zone?: Zone) => void
  autoOptimizeRan: () => Promise<void>
  optimizing: boolean
  viewNonce: number // 증가 시 카메라 초기 시점으로 리프레임 (초기화 등)
  gotoZoneReq: { zone: Zone; n: number } | null // 지역 이동 요청 (편집=카메라 이동, 걷기=UE 이동)
  goToZone: (zone: Zone) => void
  siteDown: { A: boolean; B: boolean } // 데이터센터 사이트 장애 (geo-redundancy 절체 시뮬)
  setSiteDown: (site: 'A' | 'B', down: boolean) => void
  setMobility: (patch: Partial<{ a3_offset_db: number; hysteresis_db: number; ttt_ms: number }>) => void
  bulkApplyMobility: () => void // PART 10: 전역 A3/CIO 값을 모든 RU(gnb)에 일괄 적용
  setSim: (zone: Zone, sim: SimResult | null) => void
  setSimStatus: (s: SimStatus) => void
  setProbe: (p: ProbeResult | null) => void
  setPersonProbe: (id: string, p: ProbeResult | null) => void
  setNfLoads: (loads: Record<string, { load: number; cpu: number }>) => void
  togglePersonTraffic: (id: string) => void
  togglePersonUe: (id: string) => void
  setAllPersonUe: (on: boolean) => void
  setPersonTrafficType: (id: string, t: TrafficType) => void
  setPersonCallee: (id: string, calleeId: string) => void
  setPersonImsi: (id: string, imsi: string) => void
  togglePersonBarred: (id: string) => void // 접속 차단(UAC) 토글
  setPersonSupp: (id: string, patch: Partial<SuppServices>) => void // MMTEL 부가서비스 설정
  addImsi: (imsi: string) => void
  removeImsi: (imsi: string) => void
  setAllPersonTraffic: (on: boolean) => void
  setPersonMbps: (m: Record<string, number>) => void
  setTrafficType: (t: TrafficType) => void
  startCall: (fromId: string, toId: string) => void
  setCallPhase: (phase: CallPhase, reason?: string) => void
  toggleHold: () => void // 통화 보류/재개 (re-INVITE sendonly↔sendrecv)
  endCall: () => void
  addEvent: (source: LogSource, level: LogLevel, msg: string, node?: string, dir?: 'in' | 'out', imsi?: string, from?: string, to?: string) => void
  clearEvents: () => void
  clearNodeEvents: (node: string) => void
  setShowLog: (v: boolean) => void
  setShowCore: (v: boolean) => void
  bumpPanel: (key: string) => void
  setShowNms: (v: boolean) => void
  setShowCall: (v: boolean) => void
  setProcedureUe: (id: string | null) => void
  // SECTION B: 측위(MT-LR) call-flow를 이 UE에 대해 스트리밍. LPP:1 capability의 실제 동작.
  runPositioning: (
    id: string,
    opts?: { method?: PosMethod; unreachable?: boolean; mico?: boolean; lcsClient?: string },
  ) => void
  applyScenario: (id: string) => void
  showScenarios: boolean
  setShowScenarios: (v: boolean) => void
  showUeList: boolean
  setShowUeList: (v: boolean) => void
  // SECTION T: UE 콜플로우 추적 패널 — traceUe(추적 대상 UE id) 이벤트를 시간순 래더로.
  showUeTrace: boolean
  traceUe: string | null
  setShowUeTrace: (v: boolean) => void
  setTraceUe: (id: string | null) => void
  exportConfig: () => string
  importConfig: (json: string) => boolean
  applySnapshot: (snap: {
    objects: SceneObject[]
    coreNfs: CoreNf[]
    coreDn: Record<Zone, boolean>
    slices: Slice[]
    space: SpaceConfig
    ranUnits?: RanUnit[] // RAN 논리 유닛 — coreNfs와 동일하게 undo 대상 (구 스냅샷 호환 위해 optional)
    // BUG6: UE 런타임 맵도 스냅샷에 포함 — UE 삭제 실행취소 시 IMSI/전원/차단/부가서비스 복원.
    personImsi?: Record<string, string>
    personUeOn?: Record<string, boolean>
    personTraffic?: Record<string, boolean>
    personTrafficType?: Record<string, TrafficType>
    personBarred?: Record<string, boolean>
    personSupp?: Record<string, SuppServices>
    registeredImsis?: string[]
  }) => void
  resetScene: () => void
  setUeZone: (z: Zone | null) => void
  setUeSim: (patch: Partial<UeSim>) => void
  toggleUe: () => void
  toggleTraffic: () => void
  setTrafficStats: (mbps: number, mbAdd: number) => void
}

const KIND_PREFIX: Record<ObjKind, string> = {
  gnb: 'RU',
  antenna: 'ANT',
  wall: 'Wall',
  glasswall: 'Glass',
  pillar: 'Pillar',
  door: 'Door',
  desk: 'Desk',
  table: 'Table',
  chair: 'Chair',
  cabinet: 'Cab',
  shelf: 'Shelf',
  sofa: 'Sofa',
  machine: 'Machine',
  plant: 'Plant',
  person: 'UE',
  antceiling: 'ANT',
  antwall: 'ANT',
  fixedue: 'UE',
}

function makeName(kind: ObjKind, objects: SceneObject[], zone: Zone): string {
  const count = objects.filter((o) => o.kind === kind && (o.zone ?? 'A') === zone).length + 1
  return `${KIND_PREFIX[kind]}-${zone}${count}`
}

const GNB_PARAM_LABEL: Record<string, string> = {
  freq_mhz: 'freq(MHz)',
  tx_power_dbm: 'txPower(dBm)',
  bandwidth_mhz: 'BW(MHz)',
  height: 'antHeight(m)',
  antenna: 'antenna',
  azimuth_deg: 'azimuth(°)',
  tilt_deg: 'tilt(°)',
  gain_dbi: 'gain(dBi)',
  enabled: 'tx',
  beamwidth_deg: 'HPBW(°)',
  beam_tracking: 'ueTracking',
  ca_enabled: 'CA',
  qam256: '256QAM',
  mimo4x4: '4x4MIMO',
  energy_saving: 'energySaving',
}

// 첫 실행 데모: PLMN-A에 RU+장애물, 논리 Core(A) 완비. PLMN-B는 빈 국가.
function demoScene(): SceneObject[] {
  return [
    // 시작: 사람 1명 + 근처 RU 1대 (넓은 공간 중앙 부근)
    {
      id: nextId(), kind: 'gnb', name: 'RU-A1',
      position: [78, 0, 52], rotation_deg: 0, zone: 'A',
      // RU→DU(프론트홀)→CU(F1)→AMF(N2)/UPF(N3) 사슬을 데모에서 바로 성립시키기 위해 DU에 연결.
      gnb: { ...DEFAULT_GNB, du_id: 'ran-A-du-1' },
    },
    { id: nextId(), kind: 'person', name: 'UE-A1', position: [72, 0, 60], rotation_deg: -45, zone: 'A' },
  ]
}

// 데모 RAN 논리 유닛: zone-A CU 1대 + DU 1대. CU는 demoCore의 AMF(N2)/UPF(N3)에 종단.
//   demoCore()가 만드는 id: AMF=nf-A-AMF-1, UPF=nf-A-UPF-1.
function demoRan(): RanUnit[] {
  return [
    { id: 'ran-A-cu-1', kind: 'cu', name: 'CU-A1', zone: 'A', enabled: true, amf_id: 'nf-A-AMF-1', upf_id: 'nf-A-UPF-1' },
    { id: 'ran-A-du-1', kind: 'du', name: 'DU-A1', zone: 'A', enabled: true, cu_id: 'ran-A-cu-1', f1_latency_ms: 2, max_cells: 4 },
  ]
}

function demoCore(): CoreNf[] {
  const mk = (zone: Zone, nf_type: NfType, i: number): CoreNf => ({
    id: `nf-${zone}-${nf_type}-${i}`,
    nf_type,
    name: `${nf_type}-${zone}${i}`,
    zone,
    ...DEFAULT_NF,
  })
  return [
    mk('A', 'AMF', 1), mk('A', 'SMF', 1), mk('A', 'UPF', 1),
    mk('A', 'AUSF', 1), mk('A', 'UDM', 1), mk('A', 'NRF', 1), mk('A', 'SEPP', 1),
    // IMS (VoNR) — 데모에서 통화가 바로 되도록
    mk('A', 'P-CSCF', 1), mk('A', 'I-CSCF', 1), mk('A', 'S-CSCF', 1),
    // SECTION B: 측위(LMF/GMLC) + 분석(NWDAF) — enum/NF_INFO에만 있던 것을 default core에 편입해
    // 1급 NF로 가시화 (측위 MT-LR call flow, NWDAF 폐루프 분석의 substrate).
    mk('A', 'LMF', 1), mk('A', 'GMLC', 1), mk('A', 'NWDAF', 1),
  ]
}

// v2: 기본 씬에 RAN(CU/DU)↔Core(AMF/UPF) 연결을 반영. 배선 전에 저장된 옛 씬(v1)이
// 로드되어 "CU/DU/RU/AMF 미연결"로 시작하던 문제를 막기 위해 키를 올려 옛 저장분은 무시한다.
const PERSIST_KEY = 'meta-5g-scene-v2'

// F5(새로고침)에도 구성이 유지되도록 localStorage에서 초기 상태 복원.
function loadPersisted(): Partial<State> | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d.objects || !d.space) return null
    // idCounter를 저장된 오브젝트 최대 번호 이후로 밀어 충돌 방지
    let maxId = 0
    for (const o of d.objects as { id?: string }[]) {
      const m = /obj-(\d+)/.exec(o.id ?? '')
      if (m) maxId = Math.max(maxId, parseInt(m[1]))
    }
    if (maxId >= idCounter) idCounter = maxId + 1
    let floorPlan = d.floorPlan ?? null
    try { floorPlan = localStorage.getItem(PERSIST_KEY + '-plan') ?? floorPlan } catch { /* ignore */ }
    return {
      space: d.space, objects: d.objects, coreNfs: d.coreNfs, coreDn: d.coreDn,
      ranArch: d.ranArch, ranUnits: d.ranUnits ?? [], homeZone: d.homeZone, ceiling: d.ceiling, slices: d.slices,
      mobility: d.mobility, ueSim: d.ueSim, floorPlan, lang: d.lang,
    }
  } catch {
    return null
  }
}

export const useStore = create<State>((set, get) => ({
  lang: 'en',
  // 시작 공간 — 가까이서 3인칭으로 보기 좋은 크기 (필요 시 툴바에서 확장 가능)
  space: { width: 160, depth: 120, height: 10 },
  objects: demoScene(),
  coreNfs: demoCore(),
  coreDn: { A: true, B: false, C: false },
  ranArch: { A: 'gnb', B: 'gnb', C: 'gnb' },
  ranUnits: demoRan(),
  homeZone: 'A',
  ceiling: true,
  floorPlan: null,
  optimizing: false,
  viewNonce: 0,
  gotoZoneReq: null,
  siteDown: { A: false, B: false },
  slices: [{ id: 'sl-A-1', sst: 1, sd: '000001', name: 'eMBB', zone: 'A' }],
  mobility: {
    a3_offset_db: 3, hysteresis_db: 1, ttt_ms: 320,
    cio_db: 0, a2_threshold_dbm: -110, t310_ms: 1000, n310: 10,
    call_drop_rsrp_dbm: -118, rlf_rsrp_dbm: -118,
  },
  selectedId: null,
  selectedIds: [],
  marquee: false,
  tool: 'select',
  radioKind: 'active',
  mode: 'edit',
  vizMode: 'off',
  vizMetric: 'rsrp',
  vizDensity: 0.1,
  sliceY: 1.5,
  sims: { A: null, B: null, C: null },
  simStatus: 'idle',
  probe: null,
  personProbes: {},
  nfLoads: {},
  personTraffic: {},
  personUeOn: {},
  personTrafficType: {},
  personImsi: {},
  personCallee: {},
  personBarred: {},
  personSupp: {},
  registeredImsis: [defaultImsi(DEFAULT_UE_SIM)],
  personMbps: {},
  trafficType: 'video',
  call: null,
  heldCall: null,
  events: [],
  showLog: false,
  showCore: false,
  showNms: false,
  showCall: false,
  procedureUe: null,
  procedureNonce: 0,
  panelNonce: {},
  showScenarios: false,
  showUeList: false,
  showUeTrace: false,
  traceUe: null,
  trafficHistory: [],
  ghost: null,
  ghostRot: 0,
  gizmoMode: 'translate',
  dragging: null,
  engine: 'empirical',
  ueSim: { ...DEFAULT_UE_SIM },
  ueOn: true,
  ueZone: 'A',
  trafficActive: false,
  trafficMbps: 0,
  trafficMb: 0,

  setLang: (lang) => set({ lang }),
  setSpace: (patch) =>
    set((s) => ({
      space: {
        width: Math.min(Math.max(patch.width ?? s.space.width, 10), 1000),
        depth: Math.min(Math.max(patch.depth ?? s.space.depth, 10), 1000),
        height: Math.min(Math.max(patch.height ?? s.space.height, 3), 50),
      },
    })),
  setTool: (tool) => set({ tool, selectedId: null, ghost: null }),
  setRadioKind: (radioKind) => set({ radioKind, tool: 'gnb', selectedId: null, ghost: null }),
  setGhost: (ghost) => set({ ghost }),
  rotateGhost: () => set((s) => ({ ghostRot: (s.ghostRot + 15) % 360 })),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setDragging: (dragging) => set({ dragging }),
  setEngine: (engine) => {
    set({ engine })
    const L = LOGT[get().lang]
    get().addEvent('SIM', 'info', engine === 'rt' ? L.engine_rt : L.engine_emp)
  },
  setMode: (mode) => set({ mode, selectedId: null, ghost: null }),
  setVizMode: (vizMode) => set({ vizMode }),
  setVizMetric: (vizMetric) => set({ vizMetric }),
  setVizDensity: (vizDensity) => set({ vizDensity }),
  setSliceY: (sliceY) => set({ sliceY }),
  select: (selectedId) => set({ selectedId, selectedIds: selectedId ? [selectedId] : [] }),
  setSelectedIds: (ids) => set({ selectedIds: ids, selectedId: ids[0] ?? null }),
  setMarquee: (marquee) => set({ marquee }),

  addObject: (kind, x, z, rot, zone) =>
    set((s) => {
      // 고정 UE(공장 기계형 단말)는 kind='person'으로 저장 + ueShell='machine' 표식.
      // → 모든 person(UE) 로직(용량/트래픽/attach/UE목록)에 그대로 포함됨.
      const isFixedUe = kind === 'fixedue'
      const realKind: ObjKind = isFixedUe ? 'person' : kind
      const isAntenna = realKind === 'antenna' || realKind === 'antceiling' || realKind === 'antwall'
      const gnbCount = s.objects.filter((o) => o.kind === 'gnb').length
      // RU 변형 프리셋 (배치 도구에서 선택한 종류)
      const rk = s.radioKind
      const radioPreset: Partial<import('./types').GnbParams> =
        rk === 'passive' ? { ru_type: 'passive', mount: 'pole' }
          : rk === 'ceiling' ? { ru_type: 'active', mount: 'ceiling', band_class: 'mid', height: Math.max(s.space.height - 0.3, 3) }
            : rk === 'wall' ? { ru_type: 'active', mount: 'wall', height: 3 }
              : { ru_type: 'active', mount: 'pole' }
      // 새 RU는 해당 존의 첫 번째 활성 DU에 자동 프론트홀 연결 (없으면 미연결 → 사슬 불성립, 의도된 동작)
      const autoDuId = realKind === 'gnb'
        ? s.ranUnits.find((u) => u.kind === 'du' && u.zone === zone && u.enabled)?.id
        : undefined
      const obj: SceneObject = {
        id: nextId(),
        kind: realKind,
        name: makeName(realKind, s.objects, zone),
        position: [x, 0, z],
        rotation_deg: rot,
        size: CATALOG[realKind].resizable ? [...CATALOG[realKind].size] : undefined,
        // PCI는 셀마다 자동 순차 할당 (mod3 충돌 회피용 간격 7) — 직접 수정 가능
        gnb: realKind === 'gnb' ? { ...DEFAULT_GNB, ...radioPreset, pci: (gnbCount * 7 + 1) % 1008, du_id: autoDuId } : undefined,
        ant_height: isAntenna ? (realKind === 'antwall' ? 3 : 4) : undefined,
        cable: isAntenna ? 'half' : undefined,
        ueShell: isFixedUe ? 'machine' : undefined,
        zone,
      }
      // 측정요원/고정 UE(person)마다 고유 IMSI를 부여 + UDM/UDR 레지스트리에 프로비저닝.
      // → 콜플로우 추적(UeTracePanel)이 UE별로 이벤트를 정확히 분리하고, 등록/트래픽도 유지된다.
      if (realKind === 'person') {
        const imsi = nextPersonImsi(s.ueSim)
        return {
          objects: [...s.objects, obj],
          personImsi: { ...s.personImsi, [obj.id]: imsi },
          registeredImsis: s.registeredImsis.includes(imsi)
            ? s.registeredImsis
            : [...s.registeredImsis, imsi],
        }
      }
      return { objects: [...s.objects, obj] }
    }),

  updateObject: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    })),

  updateGnb: (id, patch) => {
    const target = get().objects.find((o) => o.id === id)
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id && o.gnb ? { ...o, gnb: { ...o.gnb, ...patch } } : o,
      ),
    }))
    if (target) {
      const desc = Object.entries(patch)
        .map(([k, v]) => `${GNB_PARAM_LABEL[k] ?? k}=${v}`)
        .join(', ')
      get().addEvent(
        'RU', 'info',
        LOGT[get().lang].param_change(target.name, desc),
        target.name,
      )
    }
  },

  removeObject: (id) => {
    const obj = get().objects.find((o) => o.id === id)
    // 측정요원(UE) 삭제 → 망에 남은 해당 UE 정보 전부 제거 (등록/세션/트래픽/측정)
    if (obj?.kind === 'person') {
      attachTokens[id] = (attachTokens[id] ?? 0) + 1 // 진행 중 attach 취소
      if (get().personUeOn[id] || get().personProbes[id]) {
        get().addEvent('NF', 'info',
          pick(get().lang,
            `${obj.name}: 단말 삭제 — Deregistration (UE 컨텍스트/PDU 세션/GUTI 해제)`,
            `${obj.name}: UE removed — Deregistration (UE context / PDU session / GUTI released)`,
            `${obj.name}: 终端删除 — 去注册 (释放UE上下文/PDU会话/GUTI)`),
          obj.name)
      }
      if (get().procedureUe === id) set({ procedureUe: null })
    }
    set((s) => {
      const personProbes = { ...s.personProbes }
      const personTraffic = { ...s.personTraffic }
      const personMbps = { ...s.personMbps }
      const personUeOn = { ...s.personUeOn }
      const personTrafficType = { ...s.personTrafficType }
      const personImsi = { ...s.personImsi }
      const personBarred = { ...s.personBarred }
      const personSupp = { ...s.personSupp }
      delete personProbes[id]
      delete personTraffic[id]
      delete personMbps[id]
      delete personUeOn[id]
      delete personTrafficType[id]
      delete personImsi[id]
      delete personBarred[id]
      delete personSupp[id]
      return {
        objects: s.objects.filter((o) => o.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((i) => i !== id),
        personProbes, personTraffic, personMbps, personUeOn, personTrafficType, personImsi,
        personBarred, personSupp,
      }
    })
  },

  addCoreNf: (zone, type) =>
    set((s) => {
      const count = s.coreNfs.filter((n) => n.zone === zone && n.nf_type === type).length + 1
      // 2번째 이상 인스턴스는 NRF priority를 높게(=후순위) + 사이트 B(geo) → warm-standby
      const nf: CoreNf = {
        id: `nf-${zone}-${type}-${idCounter++}-${count}`,
        nf_type: type,
        name: `${type}-${zone}${count}`,
        zone,
        ...DEFAULT_NF,
        priority: count,
        site: count >= 2 ? 'B' : 'A',
        ha: count >= 2 ? 'geo-red' : DEFAULT_NF.ha,
      }
      return { coreNfs: [...s.coreNfs, nf] }
    }),

  updateCoreNf: (id, patch) => {
    const target = get().coreNfs.find((n) => n.id === id)
    set((s) => ({
      coreNfs: s.coreNfs.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }))
    if (target) {
      const desc = Object.entries(patch)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      get().addEvent('NF', 'info', LOGT[get().lang].nf_change(target.name, desc), target.name)
    }
  },

  removeCoreNf: (id) =>
    set((s) => ({
      coreNfs: s.coreNfs.filter((n) => n.id !== id),
      // 삭제되는 NF를 N2/N3 종단으로 참조하던 CU의 링크는 dangling 방지 위해 해제
      ranUnits: s.ranUnits.map((u) =>
        u.amf_id === id || u.upf_id === id
          ? { ...u, amf_id: u.amf_id === id ? undefined : u.amf_id, upf_id: u.upf_id === id ? undefined : u.upf_id }
          : u,
      ),
    })),

  setCoreDn: (zone, v) =>
    set((s) => ({ coreDn: { ...s.coreDn, [zone]: v } })),

  setMobility: (patch) => {
    set((s) => ({ mobility: { ...s.mobility, ...patch } }))
    const desc = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')
    get().addEvent('RU', 'info', `Mobility(A3) param: ${desc}`)
  },

  bulkApplyMobility: () => {
    const { mobility } = get()
    const patch = {
      a3_offset_db: mobility.a3_offset_db,
      hysteresis_db: mobility.hysteresis_db,
      ttt_ms: mobility.ttt_ms,
      cio_db: mobility.cio_db,
    }
    let n = 0
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.kind !== 'gnb' || !o.gnb) return o
        n++
        return { ...o, gnb: { ...o.gnb, ...patch } }
      }),
    }))
    get().addEvent('RU', 'info',
      pick(get().lang,
        `이동성 일괄 설정 적용 — ${n}개 RU에 A3 Offset ${patch.a3_offset_db}dB / Hys ${patch.hysteresis_db}dB / TTT ${patch.ttt_ms}ms / CIO ${patch.cio_db}dB 반영`,
        `Mobility bulk-applied — A3 Offset ${patch.a3_offset_db}dB / Hys ${patch.hysteresis_db}dB / TTT ${patch.ttt_ms}ms / CIO ${patch.cio_db}dB to ${n} RUs`,
        `移动性一键应用 — 已将 A3 Offset ${patch.a3_offset_db}dB / Hys ${patch.hysteresis_db}dB / TTT ${patch.ttt_ms}ms / CIO ${patch.cio_db}dB 应用到 ${n} 个 RU`))
  },

  setRanArch: (zone, a) => {
    set((s) => ({ ranArch: { ...s.ranArch, [zone]: a } }))
    get().addEvent(
      'SIM', 'info',
      `[PLMN-${zone}] RAN arch: ${a === 'gnb' ? 'monolithic gNB' : 'CU-DU split (F1)'}`,
    )
  },

  addRanUnit: (kind, zone) => {
    // 존/종류별 순번으로 자동 이름 (CU-A1, DU-A2 …). DU는 F1 지연/셀 상한 기본값 부여.
    const count = get().ranUnits.filter((u) => u.zone === zone && u.kind === kind).length + 1
    const label = kind === 'cu' ? 'CU' : 'DU'
    const unit: RanUnit = {
      id: `ran-${zone}-${kind}-${idCounter++}-${count}`,
      kind,
      name: `${label}-${zone}${count}`,
      zone,
      enabled: true,
      ...(kind === 'du' ? { f1_latency_ms: 2, max_cells: 4 } : {}),
    }
    set((s) => ({ ranUnits: [...s.ranUnits, unit] }))
    get().addEvent('NF', 'info',
      pick(get().lang,
        `[PLMN-${zone}] ${kind === 'cu' ? 'CU(RRC/PDCP)' : 'DU(RLC/MAC/PHY-High)'} ${unit.name} 추가`,
        `[PLMN-${zone}] ${kind === 'cu' ? 'CU (RRC/PDCP)' : 'DU (RLC/MAC/PHY-High)'} ${unit.name} added`,
        `[PLMN-${zone}] ${kind === 'cu' ? 'CU(RRC/PDCP)' : 'DU(RLC/MAC/PHY-High)'} ${unit.name} 已添加`),
      unit.name)
  },

  removeRanUnit: (id) => {
    const unit = get().ranUnits.find((u) => u.id === id)
    set((s) => ({
      // 삭제 대상을 참조하던 링크는 dangling 방지 위해 해제:
      //   DU.cu_id → undefined (이 CU에 소속됐던 DU) / RU.gnb.du_id → undefined (이 DU에 붙었던 RU)
      ranUnits: s.ranUnits
        .filter((u) => u.id !== id)
        .map((u) => (u.cu_id === id ? { ...u, cu_id: undefined } : u)),
      objects: s.objects.map((o) =>
        o.kind === 'gnb' && o.gnb?.du_id === id ? { ...o, gnb: { ...o.gnb, du_id: undefined } } : o,
      ),
    }))
    if (unit)
      get().addEvent('NF', 'info',
        pick(get().lang,
          `${unit.name} 삭제 — 소속 링크(F1/프론트홀) 해제`,
          `${unit.name} removed — F1/fronthaul links cleared`,
          `${unit.name} 已删除 — 解除 F1/前传链路`),
        unit.name)
  },

  updateRanUnit: (id, patch) =>
    set((s) => ({
      ranUnits: s.ranUnits.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    })),

  toggleRanUnit: (id) => {
    const unit = get().ranUnits.find((u) => u.id === id)
    if (!unit) return
    const enabled = !unit.enabled
    set((s) => ({ ranUnits: s.ranUnits.map((u) => (u.id === id ? { ...u, enabled } : u)) }))
    get().addEvent('NF', enabled ? 'info' : 'warn',
      pick(get().lang,
        `${unit.name} ${enabled ? '활성화' : '비활성화'}`,
        `${unit.name} ${enabled ? 'enabled' : 'disabled'}`,
        `${unit.name} ${enabled ? '已启用' : '已禁用'}`),
      unit.name)
  },

  addRadio: (tech, zone) => {
    // 물리 라디오(RU=gnb SceneObject) 추가 — 존 중앙(로컬 좌표)에 배치해 존 내부에 들어오도록.
    const s0 = get()
    const gnbCount = s0.objects.filter((o) => o.kind === 'gnb').length
    const x = s0.space.width / 2
    const z = s0.space.depth / 2
    // lte(eNB)는 ParamsPanel의 tech 전환과 동일하게 1800MHz/sector로 구성.
    const techPreset: Partial<import('./types').GnbParams> =
      tech === 'lte' ? { radio_tech: 'lte', freq_mhz: 1800, antenna: 'sector' } : { radio_tech: 'nr' }
    // 새 RU는 해당 존의 첫 번째 활성 DU에 자동 프론트홀 연결 (없으면 미연결 → 사슬 불성립, 의도된 동작)
    const autoDuId = s0.ranUnits.find((u) => u.kind === 'du' && u.zone === zone && u.enabled)?.id
    const obj: SceneObject = {
      id: nextId(),
      kind: 'gnb',
      name: makeName('gnb', s0.objects, zone),
      position: [x, 0, z],
      rotation_deg: 0,
      gnb: { ...DEFAULT_GNB, ...techPreset, pci: (gnbCount * 7 + 1) % 1008, du_id: autoDuId },
      zone,
    }
    // 새 RU를 선택 상태로 → 사용자가 바로 파라미터를 설정할 수 있게.
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }))
    get().addEvent('RU', 'info',
      pick(get().lang,
        `[PLMN-${zone}] ${tech === 'nr' ? 'gNB(5G NR)' : 'eNB(4G LTE)'} ${obj.name} 추가`,
        `[PLMN-${zone}] ${tech === 'nr' ? 'gNB (5G NR)' : 'eNB (4G LTE)'} ${obj.name} added`,
        `[PLMN-${zone}] ${tech === 'nr' ? 'gNB(5G NR)' : 'eNB(4G LTE)'} ${obj.name} 已添加`),
      obj.name)
  },

  setHomeZone: (homeZone) => {
    set({ homeZone })
    get().addEvent(
      'UE', 'info',
      pick(get().lang,
        `홈 PLMN 변경: PLMN-${homeZone} (나머지는 방문/로밍). Call flow 재구성됨`,
        `Home PLMN set to PLMN-${homeZone} (others = visited/roaming). Call flow reconfigured`,
        `归属 PLMN 变更: PLMN-${homeZone}（其余为访问/漫游）。Call flow 已重构`),
    )
  },

  // 자동 틸트/출력 최적화 (ACP) — 각 RU의 tilt/tx_power를 좌표하강식으로 반복 조정해
  // 목적함수(양호 커버리지% - 과커버리지 페널티)를 최대화. 백엔드 시뮬로 실제 평가.
  autoOptimizeRan: async () => {
    if (get().optimizing) return
    set({ optimizing: true })
    get().addEvent('RU', 'info', pick(get().lang, '자동 최적화(ACP) 시작 — 틸트/출력 조정', 'Auto-optimize (ACP) started', '自动优化(ACP)开始 — 下倾/功率调整'))
    const api = await import('./api')

    const score = async (): Promise<number> => {
      const st = get()
      let good = 0
      let over = 0
      let n = 0
      for (const zone of ['A', 'B', 'C'] as const) {
        const hasRu = st.objects.some((o) => o.kind === 'gnb' && (o.zone ?? 'A') === zone)
        if (!hasRu) continue
        const sim = await api.simulate(st.objects, st.space, zone, 'empirical', st.ceiling)
        for (let i = 0; i < sim.rsrp.length; i++) {
          n++
          if (sim.rsrp[i] >= -95) good++
          if (sim.rsrp[i] >= -55) over++ // 과커버리지(간섭 유발) 페널티
        }
      }
      if (n === 0) return 0
      return (good / n) * 100 - (over / n) * 40
    }

    const rus = get().objects.filter((o) => o.kind === 'gnb' && o.gnb?.enabled !== false)
    let best = await score()
    // 좌표하강: 각 RU의 tilt(±2°)·power(±2dB)를 순회하며 개선되면 채택
    for (let pass = 0; pass < 2; pass++) {
      for (const r of rus) {
        for (const [field, deltas, lo, hi] of [
          ['tilt_deg', [2, -2], -10, 30],
          ['tx_power_dbm', [2, -2], 0, 46],
        ] as const) {
          for (const d of deltas) {
            const cur = get().objects.find((o) => o.id === r.id)
            const val = (cur?.gnb as unknown as Record<string, number>)?.[field]
            if (val == null) continue
            const nv = Math.min(Math.max(val + d, lo), hi)
            if (nv === val) continue
            set((s) => ({
              objects: s.objects.map((o) =>
                o.id === r.id && o.gnb ? { ...o, gnb: { ...o.gnb, [field]: nv } } : o,
              ),
            }))
            const sc = await score()
            if (sc > best + 0.1) {
              best = sc // 개선 → 유지
            } else {
              set((s) => ({
                objects: s.objects.map((o) =>
                  o.id === r.id && o.gnb ? { ...o, gnb: { ...o.gnb, [field]: val } } : o,
                ),
              }))
            }
          }
        }
      }
    }
    set({ optimizing: false })
    get().addEvent('RU', 'info',
      pick(get().lang,
        `자동 최적화 완료 — 목적함수 ${best.toFixed(1)} (양호 커버리지↑, 과커버리지 억제)`,
        `Auto-optimize done — objective ${best.toFixed(1)}`,
        `自动优化完成 — 目标函数 ${best.toFixed(1)}（良好覆盖↑，抑制过覆盖）`))
  },

  setFloorPlan: (floorPlan) => {
    set({ floorPlan })
    get().addEvent('SIM', 'info',
      pick(get().lang,
        (floorPlan ? '도면 임포트 — 바닥에 표시' : '도면 제거'),
        (floorPlan ? 'Floor plan imported' : 'Floor plan removed'),
        (floorPlan ? '导入平面图 — 显示在地面' : '移除平面图')))
  },

  addSlice: (zone, sst, sd) => {
    const nm = { 1: 'eMBB', 2: 'URLLC', 3: 'MIoT' }[sst] ?? `SST${sst}`
    set((s) => ({
      slices: [
        ...s.slices,
        { id: `sl-${zone}-${sst}-${idCounter++}`, sst, sd, name: nm, zone },
      ],
    }))
    get().addEvent('NF', 'info',
      pick(get().lang,
        `슬라이스 추가: ${nm} (SST=${sst}, SD=${sd}) @ PLMN-${zone} — NSSF 등록`,
        `Slice added: ${nm} (SST=${sst}, SD=${sd}) @ PLMN-${zone}`,
        `新增切片: ${nm} (SST=${sst}, SD=${sd}) @ PLMN-${zone} — NSSF 注册`))
  },
  removeSlice: (id) => set((s) => ({ slices: s.slices.filter((x) => x.id !== id) })),

  // 자동 PCI 계획 (ACP) — 인접 셀 간 mod-3/mod-30 충돌 회피 그리디 배정.
  // Atoll/Ranplan의 Automatic Cell Planning 기법 참조.
  autoPlanPci: () => {
    const s = get()
    const rus = s.objects.filter((o) => o.kind === 'gnb')
    const assigned: Record<string, number> = {}
    const NEIGH_DIST2 = 80 * 80 // 이 거리 내 셀을 이웃으로 간주
    let changed = 0
    for (const zone of ['A', 'B', 'C'] as const) {
      const zru = rus.filter((r) => (r.zone ?? 'A') === zone)
      for (const r of zru) {
        // 이웃(같은 존, 근접)의 이미 배정된 PCI 수집
        const neighborPci = zru
          .filter((o) => o.id !== r.id && assigned[o.id] != null)
          .filter(
            (o) =>
              (o.position[0] - r.position[0]) ** 2 + (o.position[2] - r.position[2]) ** 2 <
              NEIGH_DIST2,
          )
          .map((o) => assigned[o.id])
        // mod-3, mod-30 충돌 없는 최소 PCI 선택
        let pci = 0
        for (; pci < 1008; pci++) {
          const clash = neighborPci.some(
            (n) => n % 3 === pci % 3 || n % 30 === pci % 30 || n === pci,
          )
          if (!clash) break
        }
        assigned[r.id] = pci % 1008
      }
    }
    set((st) => ({
      objects: st.objects.map((o) =>
        o.kind === 'gnb' && assigned[o.id] != null && o.gnb
          ? ((changed += o.gnb.pci !== assigned[o.id] ? 1 : 0),
            { ...o, gnb: { ...o.gnb, pci: assigned[o.id] } })
          : o,
      ),
    }))
    get().addEvent(
      'RU', 'info',
      pick(get().lang,
        `자동 PCI 계획(ACP) 완료 — ${rus.length}개 셀, ${changed}개 변경, mod-3/mod-30 충돌 회피`,
        `Auto PCI planning done — ${rus.length} cells, ${changed} changed, mod-3/mod-30 avoided`,
        `自动 PCI 规划(ACP)完成 — ${rus.length} 个小区，${changed} 个变更，规避 mod-3/mod-30 冲突`),
    )
  },

  setCeiling: (ceiling) => {
    set({ ceiling })
    get().addEvent(
      'SIM', 'info',
      ceiling
        ? pick(get().lang, '천장 있음 — 천장 반사 포함', 'Ceiling on — ceiling reflection included', '有天花板 — 含天花板反射')
        : pick(get().lang, '천장 제거 — 전파가 상방으로 개방 (천장 반사 없음)', 'Ceiling removed — RF open upward', '移除天花板 — 无线电向上开放（无天花板反射）'),
    )
  },

  setSim: (zone, sim) => set((s) => ({ sims: { ...s.sims, [zone]: sim } })),
  setSimStatus: (simStatus) => set({ simStatus }),
  setProbe: (probe) => set({ probe }),
  setNfLoads: (nfLoads) => set({ nfLoads }),

  togglePersonTraffic: (id) => {
    const on = !get().personTraffic[id]
    const target = get().objects.find((o) => o.id === id)
    // 전원 꺼진 단말은 트래픽 불가
    if (on && !get().personUeOn[id]) {
      get().addEvent('UE', 'warn',
        pick(get().lang, `${target?.name}: 단말 전원 OFF — 먼저 전원을 켜세요`, `${target?.name}: UE is powered off`, `${target?.name}: 终端已关机`),
        target?.name)
      return
    }
    // 접속 차단(UAC)된 단말은 등록 자체가 막혀 있으므로 트래픽(PDU 세션) 불가
    if (on && get().personBarred[id]) {
      get().addEvent('RU', 'error',
        pick(get().lang,
          `${target?.name}: 접속 차단(UAC) 상태 — 미등록이라 PDU 세션 시작 불가 (먼저 차단 해제)`,
          `${target?.name}: access barred (UAC) — not registered, cannot start PDU session (un-bar first)`,
          `${target?.name}: 接入禁止(UAC) — 未注册，无法启动 PDU 会话 (请先解除禁止)`),
        target?.name)
      return
    }
    // RAN 경로(RU→프론트홀→DU→F1→CU→N2→AMF & N3→UPF) + RSRP 게이트 — 트래픽/통화 시작 전 공통 가드.
    // 막히면 에러 로그를 남기고 true(차단) 반환. (전원/UAC/등록/착신자 체크 이후, 실제 활성화 직전)
    const ranBlocked = (): boolean => {
      if (!on) return false
      const s0 = get()
      const imsi = s0.personImsi[id] ?? defaultImsi(s0.ueSim)
      const servingRu = target ? servingRuFor(target, s0.objects) : undefined
      const chain = servingRu
        ? ranChainOk(servingRu, s0.objects, s0.ranUnits, s0.coreNfs, s0.siteDown)
        : { ok: false, reason: 'RU-off' as string }
      if (!servingRu || !chain.ok) {
        get().addEvent('RU', 'error',
          pick(s0.lang,
            `${target?.name}: 트래픽/통화 불가 — ${ranChainText(chain.reason, 'ko')}`,
            `${target?.name}: traffic/call blocked — ${ranChainText(chain.reason, 'en')}`,
            `${target?.name}: 流量/通话不可 — ${ranChainText(chain.reason, 'zh')}`),
          target?.name, undefined, imsi)
        return true
      }
      const rsrp = s0.personProbes[id]?.rsrp_dbm
      const thr = s0.mobility.call_drop_rsrp_dbm
      if (rsrp != null && rsrp < thr) {
        get().addEvent('RU', 'error',
          pick(s0.lang,
            `${target?.name}: RSRP ${rsrp.toFixed(1)} < 콜드롭 기준 ${thr} — 접속 불가 (커버리지 밖)`,
            `${target?.name}: RSRP ${rsrp.toFixed(1)} < call-drop threshold ${thr} — cannot connect (out of coverage)`,
            `${target?.name}: RSRP ${rsrp.toFixed(1)} < 掉话门限 ${thr} — 无法接入 (超出覆盖)`),
          target?.name, undefined, imsi)
        return true
      }
      // 코어 E2E(등록 AMF/AUSF/UDM + 세션 SMF/UPF + DN) 미도달 → 트래픽/통화 불가.
      // (RAN 사슬은 AMF/UPF까지만 검증하므로 SMF/AUSF/UDM/DN 상실을 여기서 잡는다.)
      const e2e = computeE2E(s0.objects, s0.coreNfs, s0.coreDn, objZone(target!), s0.siteDown, s0.ranUnits)
      if (!e2e.ok) {
        get().addEvent('NF', 'error',
          pick(s0.lang,
            `${target?.name}: 트래픽/통화 불가 — 코어 미도달(${e2e.missing.join(', ')})`,
            `${target?.name}: traffic/call blocked — core unreachable (${e2e.missing.join(', ')})`,
            `${target?.name}: 流量/通话不可 — 核心不可达(${e2e.missing.join(', ')})`),
          target?.name, undefined, imsi)
        return true
      }
      return false
    }

    // 서비스 종류 판정 (per-UE 미지정 시 전역 기본)
    const ttype = get().personTrafficType[id] ?? get().trafficType

    // ── 음성(voice): 일반 PDU 데이터가 아니라 실제 VoNR(IMS SIP) 통화로 라우팅 ──
    if (ttype === 'voice') {
      if (on) {
        const callee = get().personCallee[id]
        const calleeObj = callee ? get().objects.find((o) => o.id === callee) : undefined
        // 통화 대상 미선택/자기 자신/대상 부재 → 트래픽을 켜지 않고 대상 선택을 유도.
        if (!callee || callee === id || !calleeObj) {
          get().addEvent('UE', 'warn',
            pick(get().lang,
              '음성통화: 통화 대상을 먼저 선택하세요',
              'Voice call: select a callee first',
              '语音通话: 请先选择通话对象'),
            target?.name)
          return
        }
        // RAN 경로/RSRP 게이트 — 사슬이 끊겼거나 커버리지 밖이면 통화 발신 차단.
        if (ranBlocked()) return
        set((s) => ({ personTraffic: { ...s.personTraffic, [id]: true } }))
        if (target) {
          const imsi = get().personImsi[id] ?? defaultImsi(get().ueSim)
          // 음성도 CM-CONNECTED가 필요 → idle이었으면 Service Request 절차를 흘린다.
          if (get().personUeOn[id]) {
            const s0 = get()
            for (const st of buildServiceRequestSteps(flowCtxForPerson(s0, target)))
              get().addEvent(st.source, st.level, st.msg, st.node, st.dir, imsi, st.from, st.to)
          }
          // 실제 VoNR 통화 발신 (IMS SIP INVITE, 전용 GBR 5QI 1). 일반 PDU 로그는 남기지 않는다.
          get().startCall(id, callee)
          get().addEvent('UE', 'info',
            pick(get().lang,
              `${target.name}: 음성통화(VoNR) 발신 → ${calleeObj.name} — IMS SIP INVITE, 전용 GBR 베어러 5QI 1`,
              `${target.name}: Voice (VoNR) call → ${calleeObj.name} — IMS SIP INVITE, dedicated GBR bearer 5QI 1`,
              `${target.name}: 语音通话(VoNR) 呼出 → ${calleeObj.name} — IMS SIP INVITE, 专用 GBR 承载 5QI 1`),
            target.name, undefined, imsi)
        }
      } else {
        // 음성 OFF → 이 UE가 관여한 활성 통화가 있으면 종료(hang up) 후 트래픽 OFF.
        const call = get().call
        if (call && (call.fromId === id || call.toId === id)) get().endCall()
        set((s) => ({ personTraffic: { ...s.personTraffic, [id]: false } }))
      }
      return
    }

    // ── 데이터 서비스: 기존 Service Request + PDU 흐름 ──
    // RAN 경로/RSRP 게이트 — 사슬이 끊겼거나 커버리지 밖이면 트래픽 활성화 차단.
    if (ranBlocked()) return
    set((s) => ({ personTraffic: { ...s.personTraffic, [id]: on } }))
    if (target) {
      // SECTION A: 이미 RM-REGISTERED인 UE가 다시 데이터 시작 → full re-attach 대신
      // Service Request(CM-IDLE→CM-CONNECTED, DRB 재수립)로 사용자평면만 재활성.
      if (on && get().personUeOn[id]) {
        const s0 = get()
        const imsi = s0.personImsi[id] ?? defaultImsi(s0.ueSim)
        for (const st of buildServiceRequestSteps(flowCtxForPerson(s0, target)))
          get().addEvent(st.source, st.level, st.msg, st.node, st.dir, imsi, st.from, st.to)
      }
      // BUG11: imsi를 넘겨 UE 트레이스(IMSI별 필터)에 PDU 세션 시작/종료 이벤트가 남도록.
      // 서비스별로 5QI/이름을 로그에 포함해 서비스가 구분되도록 (모든 서비스가 동일 PDU 로그로 붕괴하지 않게).
      const pduImsi = get().personImsi[id] ?? defaultImsi(get().ueSim)
      const ti = trafficInfo(ttype)
      const serviceLabel = pick(get().lang, ti.ko, ti.en, ti.zh)
      get().addEvent('UE', 'info',
        on
          ? pick(get().lang,
              `${target.name}: PDU 세션 데이터 시작 — ${serviceLabel} (5QI ${ti.fiveqi})`,
              `${target.name}: PDU session data started — ${serviceLabel} (5QI ${ti.fiveqi})`,
              `${target.name}: PDU 会话数据开始 — ${serviceLabel} (5QI ${ti.fiveqi})`)
          : pick(get().lang, `${target.name}: 데이터 전송 종료`, `${target.name}: transfer ended`, `${target.name}: 数据传输结束`),
        target.name, undefined, pduImsi)
    }
  },

  setPersonTrafficType: (id, t) =>
    set((s) => ({ personTrafficType: { ...s.personTrafficType, [id]: t } })),

  setPersonCallee: (id, calleeId) =>
    set((s) => ({ personCallee: { ...s.personCallee, [id]: calleeId } })),

  addImsi: (imsi) => {
    if (!/^\d{14,15}$/.test(imsi)) {
      get().addEvent('NF', 'warn',
        pick(get().lang, `IMSI 형식 오류: ${imsi} (14~15자리 숫자)`, `Invalid IMSI format: ${imsi} (14-15 digits)`, `IMSI 格式错误: ${imsi} (14~15位数字)`), 'UDR')
      return
    }
    if (get().registeredImsis.includes(imsi)) return
    set((s) => ({ registeredImsis: [...s.registeredImsis, imsi] }))
    get().addEvent('NF', 'info',
      pick(get().lang,
        `IMSI 프로비저닝: ${imsi} → UDM/UDR 가입자 등록 (Nudr_DM_Create)`,
        `IMSI provisioned: ${imsi} → UDM/UDR subscriber created (Nudr_DM_Create)`,
        `IMSI 开通: ${imsi} → UDM/UDR 签约用户创建 (Nudr_DM_Create)`),
      'UDR', 'in', imsi, 'UDM', 'UDR')
  },
  removeImsi: (imsi) => {
    set((s) => ({ registeredImsis: s.registeredImsis.filter((i) => i !== imsi) }))
    get().addEvent('NF', 'info',
      pick(get().lang,
        `IMSI 삭제: ${imsi} → UDM/UDR 가입 해지 (Nudr_DM_Delete)`,
        `IMSI removed: ${imsi} → UDM/UDR subscription deleted (Nudr_DM_Delete)`,
        `IMSI 删除: ${imsi} → UDM/UDR 解约 (Nudr_DM_Delete)`),
      'UDR', 'in', imsi, 'UDM', 'UDR')
  },

  setPersonImsi: (id, imsi) => {
    const s = get()
    const obj = s.objects.find((o) => o.id === id)
    set((st) => ({ personImsi: { ...st.personImsi, [id]: imsi } }))
    const ok = imsiRegistered(imsi, s.ueSim, s.registeredImsis)
    if (!ok) {
      // 미등록 IMSI → 즉시 트래픽 차단 + 등록 거부 로그
      set((st) => ({ personTraffic: { ...st.personTraffic, [id]: false }, personMbps: { ...st.personMbps, [id]: 0 } }))
      get().addEvent('NF', 'error',
        pick(s.lang,
          `${obj?.name}: 미등록 IMSI ${imsi} — UDM/UDR에 가입자 없음 → Registration Reject (5GMM cause #3 Illegal UE). 트래픽 차단`,
          `${obj?.name}: unregistered IMSI ${imsi} — no subscriber in UDM/UDR → Registration Reject (5GMM #3 Illegal UE). Traffic dropped`,
          `${obj?.name}: 未注册IMSI ${imsi} — UDM/UDR无签约 → Registration Reject (5GMM #3). 流量中断`),
        obj?.name)
    } else {
      get().addEvent('UE', 'info',
        pick(s.lang, `${obj?.name}: IMSI 변경 ${imsi} (가입 확인됨)`, `${obj?.name}: IMSI set ${imsi} (provisioned)`, `${obj?.name}: IMSI 变更 ${imsi} (已签约)`),
        obj?.name)
    }
  },

  togglePersonBarred: (id) => {
    const barred = !get().personBarred[id]
    const obj = get().objects.find((o) => o.id === id)
    set((s) => ({ personBarred: { ...s.personBarred, [id]: barred } }))
    if (barred) {
      // 차단 세트 → 진행 중 트래픽 중지, 다음 접속 시도부터 UAC 차단
      set((s) => ({ personTraffic: { ...s.personTraffic, [id]: false }, personMbps: { ...s.personMbps, [id]: 0 } }))
      get().addEvent('RU', 'warn',
        pick(get().lang,
          `${obj?.name}: 접속 차단 설정(UAC/Access Class barring) — 다음 전원 ON/트래픽 시도가 차단됩니다`,
          `${obj?.name}: access barring enabled (UAC/Access Class) — next power-on/traffic attempt will be blocked`,
          `${obj?.name}: 已启用接入禁止(UAC/接入等级) — 下次开机/流量尝试将被阻断`),
        obj?.name)
    } else {
      get().addEvent('RU', 'info',
        pick(get().lang,
          `${obj?.name}: 접속 차단 해제 — 접속 허용(재접속 가능)`,
          `${obj?.name}: access barring cleared — access allowed (may re-attach)`,
          `${obj?.name}: 已解除接入禁止 — 允许接入(可重新附着)`),
        obj?.name)
    }
  },

  setPersonSupp: (id, patch) => {
    const obj = get().objects.find((o) => o.id === id)
    set((s) => ({ personSupp: { ...s.personSupp, [id]: { ...(s.personSupp[id] ?? {}), ...patch } } }))
    const desc = Object.entries(patch)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    get().addEvent('NF', 'info',
      pick(get().lang,
        `${obj?.name}: MMTEL 부가서비스 설정 (TAS/iFC): ${desc}`,
        `${obj?.name}: MMTEL supplementary service set (TAS/iFC): ${desc}`,
        `${obj?.name}: MMTEL 补充业务设置 (TAS/iFC): ${desc}`),
      'S-CSCF', 'in', get().personImsi[id] ?? defaultImsi(get().ueSim), obj?.name ?? 'UE', 'S-CSCF')
  },

  togglePersonUe: (id) => {
    const on = !get().personUeOn[id]
    const obj = get().objects.find((o) => o.id === id)
    if (!obj) return
    set((s) => ({ personUeOn: { ...s.personUeOn, [id]: on } }))
    // 진행 중 attach 취소용 토큰
    attachTokens[id] = (attachTokens[id] ?? 0) + 1

    if (!on) {
      // 전원 OFF → SECTION A: UE-initiated Deregistration (switch-off) call flow 방출 후 컨텍스트 해제.
      const s0 = get()
      const imsi = s0.personImsi[id] ?? defaultImsi(s0.ueSim)
      for (const st of buildDeregisterSteps(flowCtxForPerson(s0, obj)))
        get().addEvent(st.source, st.level, st.msg, st.node, st.dir, imsi, st.from, st.to)
      // 등록 해제, 트래픽 중지
      set((s) => {
        const personProbes = { ...s.personProbes }
        delete personProbes[id]
        return { personProbes, personTraffic: { ...s.personTraffic, [id]: false } }
      })
      get().addEvent('UE', 'info',
        pick(get().lang, `${obj.name}: 단말 전원 OFF`, `${obj.name}: UE powered OFF`, `${obj.name}: 终端关机`), obj.name)
      return
    }

    // 전원 ON → 3GPP attach 절차 로그 스트리밍
    get().addEvent('UE', 'info',
      pick(get().lang, `${obj.name}: 단말 전원 ON — 셀 탐색 시작`, `${obj.name}: UE powered ON — cell search`, `${obj.name}: 终端开机 — 开始搜网`), obj.name)

    // 접속 차단(UAC/Access Class Barring) — SIB1 uac-BarringInfo에 의해 이 UE의 접속 시도가 차단됨.
    // 셀 측정(캠핑)은 가능하나 RRC Setup/등록(attach)은 시도 자체가 막힌다 (TS 38.331 §5.3.14).
    if (get().personBarred[id]) {
      const imsiB = get().personImsi[id] ?? defaultImsi(get().ueSim)
      get().addEvent('RU', 'error',
        pick(get().lang,
          `${obj.name}: 접속 차단(UAC) — SIB1 uac-BarringInfo(Access Class) 적용 → RRC Setup/Registration 시도 차단 (barred)`,
          `${obj.name}: Access barred (UAC) — SIB1 uac-BarringInfo (Access Class) → RRC Setup/Registration attempt blocked (barred)`,
          `${obj.name}: 接入禁止(UAC) — SIB1 uac-BarringInfo(接入等级) → RRC Setup/注册尝试被阻断 (barred)`),
        obj.name, 'out', imsiB, 'RU', obj.name)
      return
    }

    const zone = (obj.zone ?? 'A') as Zone
    const s0 = get()
    // NRF 기반 선택: 가용(사이트 정상) 인스턴스 중 priority 최우선
    const nf = (type: NfType) => activeNf(s0.coreNfs, zone, type, s0.siteDown)?.name ?? null
    // 최근접 RU (송출 중)
    const rus = s0.objects.filter(
      (o) => o.kind === 'gnb' && (o.zone ?? 'A') === zone && o.gnb?.enabled !== false,
    )
    let serving: string | null = null
    let servPci: number | null = null
    let bd = Infinity
    for (const r of rus) {
      const d = (r.position[0] - obj.position[0]) ** 2 + (r.position[2] - obj.position[2]) ** 2
      if (d < bd) { bd = d; serving = r.name; servPci = r.gnb?.pci ?? null }
    }
    const ueIp = `10.45.${zone === 'A' ? 0 : zone === 'B' ? 1 : 2}.${((obj.name.length * 7) % 250) + 2}`
    const imsi = s0.personImsi[id] ?? defaultImsi(s0.ueSim)
    // PART 3: UE Requested NSSAI = 기본 SST1 + 트래픽 종류가 요구하는 SST.
    // NSSF+AMF가 zone에 프로비저닝된 슬라이스로 Allowed NSSAI를 산출.
    const ti = trafficInfo(s0.personTrafficType[id] ?? s0.trafficType)
    const requestedSst = [...new Set([1, ti.sst])]
    const { allowed } = computeAllowedNssai(s0.slices, zone, requestedSst)
    const steps = buildAttachSteps({
      ueName: obj.name, servingName: serving, pci: servPci,
      plmn: `${s0.ueSim.mcc}/${s0.ueSim.mnc}`, tac: '1', ueIp,
      amf: nf('AMF'), ausf: nf('AUSF'), udm: nf('UDM'), smf: nf('SMF'), upf: nf('UPF'),
      nrf: nf('NRF'), nssf: nf('NSSF'), pcf: nf('PCF'), udr: nf('UDR'), chf: nf('CHF'), bsf: nf('BSF'),
      dn: s0.coreDn[zone], zone, imsiRegistered: imsiRegistered(imsi, s0.ueSim, s0.registeredImsis),
      requestedSst, allowedSst: allowed, sliceSst: allowed.includes(ti.sst) ? ti.sst : allowed[0],
    })

    const token = attachTokens[id]
    let i = 0
    const runNext = () => {
      if (attachTokens[id] !== token) return // 취소됨 (전원 OFF/재토글)
      if (i >= steps.length) return
      const st = steps[i++]
      get().addEvent(st.source, st.level, st.msg, st.node, st.dir, imsi, st.from, st.to)
      setTimeout(runNext, 170)
    }
    runNext()
  },

  setAllPersonUe: (on) => {
    const persons = get().objects.filter((o) => o.kind === 'person')
    if (!on) {
      persons.forEach((p) => { attachTokens[p.id] = (attachTokens[p.id] ?? 0) + 1 })
      set((s) => {
        const probes = { ...s.personProbes }
        const traffic = { ...s.personTraffic }
        const ueOn = { ...s.personUeOn }
        persons.forEach((p) => { delete probes[p.id]; traffic[p.id] = false; ueOn[p.id] = false })
        return { personProbes: probes, personTraffic: traffic, personUeOn: ueOn }
      })
      get().addEvent('UE', 'info',
        pick(get().lang, `전체 단말 전원 OFF (${persons.length})`, `All UEs powered OFF (${persons.length})`, `全部终端关机 (${persons.length})`))
      return
    }
    // 전체 켜기 — 꺼진 단말만 attach 수행
    persons.forEach((p) => { if (!get().personUeOn[p.id]) get().togglePersonUe(p.id) })
  },

  setAllPersonTraffic: (on) => {
    const persons = get().objects.filter((o) => o.kind === 'person')
    // 트래픽 시작 시 꺼진 단말은 먼저 전원을 켠다 (전원 OFF면 트래픽이 안 흐름)
    if (on) persons.forEach((p) => { if (!get().personUeOn[p.id]) get().togglePersonUe(p.id) })
    // BUG5: 일괄 ON은 togglePersonTraffic과 동일한 per-UE 가드(전원 ON·미차단·등록)를 통과한 단말만
    // 트래픽 활성. (전원 OFF/UAC 차단/미등록 UE는 강제로 켜지 않는다.) 일괄 OFF는 무조건.
    const s = get()
    const next: Record<string, boolean> = { ...s.personTraffic }
    for (const p of persons) {
      if (!on) { next[p.id] = false; continue }
      const imsi = s.personImsi[p.id] ?? defaultImsi(s.ueSim)
      const eligible =
        s.personUeOn[p.id] &&
        !s.personBarred[p.id] &&
        imsiRegistered(imsi, s.ueSim, s.registeredImsis)
      next[p.id] = eligible
    }
    set({ personTraffic: next })
    get().addEvent('UE', 'info',
      on
        ? pick(get().lang, `전체 트래픽 시작 — 측정요원 ${persons.length}명 (전원 자동 ON)`, `All traffic started — ${persons.length} test UEs (auto power-on)`, `全部流量开始 — 测试人员 ${persons.length} 名 (自动开机)`)
        : pick(get().lang, '전체 트래픽 중지', 'All traffic stopped', '全部流量停止'))
  },

  setPersonMbps: (personMbps) => set({ personMbps }),
  setTrafficType: (trafficType) => {
    set({ trafficType })
    const ti = trafficInfo(trafficType)
    get().addEvent(
      'UE', 'info',
      pick(get().lang,
        `트래픽 종류: ${ti.ko} (5QI=${ti.fiveqi}${ti.gbr ? ', GBR' : ''})`,
        `Traffic type: ${ti.en} (5QI=${ti.fiveqi}${ti.gbr ? ', GBR' : ''})`,
        `流量类型: ${ti.zh} (5QI=${ti.fiveqi}${ti.gbr ? ', GBR' : ''})`),
    )
  },

  startCall: (fromId, toId) => {
    const st = get()
    const L = st.lang
    const from = st.objects.find((o) => o.id === fromId)
    if (!from) return
    const suppFrom = st.personSupp[fromId] ?? {}
    const origTo = st.objects.find((o) => o.id === toId)
    if (!origTo) return

    // ── RAN 경로(RU→프론트홀→DU→F1→CU→N2→AMF & N3→UPF) + RSRP 게이트 ──
    // 발신 단말의 무선구간 사슬이 끊겼거나 커버리지 밖이면 INVITE 진행 없이 통화 실패 처리.
    {
      const servingRu = servingRuFor(from, st.objects)
      const chain = servingRu
        ? ranChainOk(servingRu, st.objects, st.ranUnits, st.coreNfs, st.siteDown)
        : { ok: false, reason: 'RU-off' as string }
      const rsrp = st.personProbes[fromId]?.rsrp_dbm
      const lowRsrp = rsrp != null && rsrp < st.mobility.call_drop_rsrp_dbm
      const chainBroken = !servingRu || !chain.ok
      if (chainBroken || lowRsrp) {
        const reason = chainBroken ? ranChainText(chain.reason, L) : 'RSRP too low'
        const imsi = st.personImsi[fromId] ?? defaultImsi(st.ueSim)
        get().addEvent('RU', 'error',
          pick(L,
            `${from.name}: 통화 시작 불가 — ${chainBroken ? ranChainText(chain.reason, 'ko') : 'RSRP 부족(커버리지 밖)'}`,
            `${from.name}: cannot start call — ${chainBroken ? ranChainText(chain.reason, 'en') : 'RSRP too low (out of coverage)'}`,
            `${from.name}: 无法发起通话 — ${chainBroken ? ranChainText(chain.reason, 'zh') : 'RSRP 过低(超出覆盖)'}`),
          from.name, undefined, imsi)
        set({
          call: {
            fromId, toId, fromName: from.name, toName: origTo.name, phase: 'failed',
            interPlmn: (from.zone ?? 'A') !== (origTo.zone ?? 'A'), startedSec: null,
            reason,
          },
        })
        return
      }
    }

    // ── MMTEL 부가서비스(TAS/iFC) 발신측 처리 ──
    // 발신 통신 차단 (OCB / BAOC, TS 24.611) — 발신측 TAS가 발신을 즉시 차단.
    if (suppFrom.ocb) {
      get().addEvent('NF', 'error',
        pick(L,
          `SIP 403 Forbidden — 발신 차단(OCB/BAOC): ${from.name} 발신 금지 (TAS)`,
          `SIP 403 Forbidden — Outgoing barred (OCB/BAOC): ${from.name} not allowed to originate (TAS)`,
          `SIP 403 Forbidden — 呼出限制(OCB/BAOC): ${from.name} 禁止发起呼叫 (TAS)`),
        'S-CSCF', 'out', undefined, 'S-CSCF', from.name)
      set({
        call: {
          fromId, toId, fromName: from.name, toName: origTo.name, phase: 'failed',
          interPlmn: (from.zone ?? 'A') !== (origTo.zone ?? 'A'), startedSec: null,
          reason: '403 Outgoing barred (OCB)',
        },
      })
      return
    }

    // 무조건 착신전환 (CFU, TS 24.604) — 원 착신자의 TAS가 지정 대상으로 302 재라우팅.
    let effToId = toId
    let forwardedFrom: string | undefined
    const suppOrig = st.personSupp[toId] ?? {}
    if (suppOrig.cfu && suppOrig.cfTarget && suppOrig.cfTarget !== toId) {
      const tgt = st.objects.find((o) => o.id === suppOrig.cfTarget)
      if (tgt) {
        effToId = tgt.id
        forwardedFrom = origTo.name
        get().addEvent('NF', 'info',
          pick(L,
            `TAS CFU(무조건 착신전환): ${origTo.name} → ${tgt.name} (SIP 302 Moved Temporarily)`,
            `TAS CFU (unconditional forward): ${origTo.name} → ${tgt.name} (SIP 302 Moved Temporarily)`,
            `TAS CFU(无条件呼叫前转): ${origTo.name} → ${tgt.name} (SIP 302 Moved Temporarily)`),
          'S-CSCF', 'out', undefined, 'S-CSCF', from.name)
      }
    }

    const to = st.objects.find((o) => o.id === effToId)
    if (!to) return
    const suppTo = st.personSupp[effToId] ?? {}
    const fromZone = from.zone ?? 'A'
    const toZone = to.zone ?? 'A'

    // OIR/OIP (발신번호 표시제한/표시, TS 24.607) — 결과는 안 바꾸고 프라이버시 처리를 로그로.
    get().addEvent('NF', 'info',
      suppFrom.oir
        ? pick(L,
            `OIR(발신번호 표시제한, CLIR): Privacy:id 적용 → P-Asserted-Identity 은닉, ${to.name}에 발신번호 미표시`,
            `OIR (originating id restriction, CLIR): Privacy:id → P-Asserted-Identity withheld, hidden from ${to.name}`,
            `OIR(主叫号码限制显示, CLIR): Privacy:id → P-Asserted-Identity 隐藏，对 ${to.name} 不显示`)
        : pick(L,
            `OIP(발신번호 표시): ${from.name} 식별정보를 ${to.name}에 표시`,
            `OIP (originating id presentation): ${from.name} identity presented to ${to.name}`,
            `OIP(主叫号码显示): 向 ${to.name} 显示 ${from.name} 的标识`),
      'S-CSCF', 'out', undefined, 'S-CSCF', to.name)

    // 착신 통신 차단 (ICB / BAIC, TS 24.611) — 착신측 TAS가 착신을 거부.
    if (suppTo.icb) {
      get().addEvent('NF', 'error',
        pick(L,
          `SIP 403 Forbidden — 착신 차단(ICB/BAIC): ${to.name} 착신 거부 (TAS)`,
          `SIP 403 Forbidden — Incoming barred (ICB/BAIC): ${to.name} rejects incoming (TAS)`,
          `SIP 403 Forbidden — 呼入限制(ICB/BAIC): ${to.name} 拒绝来话 (TAS)`),
        'S-CSCF', 'out', undefined, 'S-CSCF', from.name)
      set({
        call: {
          fromId, toId: effToId, fromName: from.name, toName: to.name, phase: 'failed',
          interPlmn: fromZone !== toZone, startedSec: null,
          reason: '403 Incoming barred (ICB)', forwardedFrom,
        },
      })
      return
    }

    // ── 통화중(Busy) 판정 — 기존 통화에 상대/발신자가 묶여 있으면 실제 통화중 ──
    const cur = st.call
    if (cur && (cur.phase === 'inviting' || cur.phase === 'ringing' || cur.phase === 'active')) {
      const busyIds = [cur.fromId, cur.toId]
      const calleeBusy = busyIds.includes(effToId)
      const callerBusy = busyIds.includes(fromId)
      if (calleeBusy || callerBusy) {
        // 통화중 착신전환 (CFB, TS 24.604) — 착신자가 통화중이면 지정 대상으로 전환.
        if (calleeBusy && !callerBusy && suppTo.cfb && suppTo.cfTarget && suppTo.cfTarget !== effToId) {
          const tgt = st.objects.find((o) => o.id === suppTo.cfTarget)
          if (tgt && !busyIds.includes(tgt.id)) {
            get().addEvent('NF', 'info',
              pick(L,
                `TAS CFB(통화중 착신전환): ${to.name} 통화중 → ${tgt.name} 전환 (SIP 302), 기존 통화는 보류`,
                `TAS CFB (forward on busy): ${to.name} busy → forward to ${tgt.name} (SIP 302); existing call held`,
                `TAS CFB(遇忙前转): ${to.name} 通话中 → 前转至 ${tgt.name} (SIP 302)，原通话保留`),
              'S-CSCF', 'out', undefined, 'S-CSCF', from.name)
            // BUG8: 통화중 착신전환(CFB)은 착신자의 기존 통화를 건드리지 않는다 —
            // heldCall을 세팅하지 않아 종료 시 엉뚱한 "보류 통화 재개"가 발생하지 않게 한다.
            set({
              call: {
                fromId, toId: tgt.id, fromName: from.name, toName: tgt.name, phase: 'inviting',
                interPlmn: fromZone !== (tgt.zone ?? 'A'), startedSec: null, forwardedFrom: to.name,
              },
            })
            return
          }
        }
        // 통화 중 대기 (Call Waiting, TS 24.615) — 착신자가 CW 보유 시 2호 수신 허용, 기존 통화 보류.
        if (calleeBusy && !callerBusy && suppTo.cw) {
          const heldPartner = cur.fromId === effToId ? cur.toName : cur.fromName
          get().addEvent('NF', 'info',
            pick(L,
              `SIP 180 Ringing + Call Waiting 표시 — ${to.name}에 2호 대기 통지 (${heldPartner} 통화 보류)`,
              `SIP 180 Ringing + Call Waiting — 2nd call indicated to ${to.name} (call with ${heldPartner} held)`,
              `SIP 180 Ringing + 呼叫等待 — 向 ${to.name} 提示第二路来话 (与 ${heldPartner} 的通话保留)`),
            'S-CSCF', 'out', undefined, 'S-CSCF', to.name)
          get().addEvent('UE', 'info',
            pick(L,
              `기존 통화 보류(hold) — re-INVITE (a=sendonly)`,
              `existing call held — re-INVITE (a=sendonly)`,
              `原通话保留 — re-INVITE (a=sendonly)`),
            'P-CSCF', 'out', undefined, to.name, 'P-CSCF')
          // BUG8: 이미 보류된 통화가 있으면 덮어써서 잃지 않도록 기존 heldCall을 보존한다.
          set({
            heldCall: st.heldCall ?? { ...cur, held: true },
            call: {
              fromId, toId: effToId, fromName: from.name, toName: to.name, phase: 'inviting',
              interPlmn: fromZone !== toZone, startedSec: null, waitingFrom: heldPartner,
            },
          })
          return
        }
        // BUG7: 486 Busy Here는 착신자(callee)가 통화중일 때만. 발신자만 통화중이면
        // 착신자는 한가하므로 486(착신자 busy)은 틀린 응답 → 2호 발신(Request Pending)으로 처리.
        if (calleeBusy) {
          // 그 외 — 부가서비스 미적용 실제 착신자 통화중 → 486 Busy Here.
          get().addEvent('NF', 'error',
            pick(L,
              `SIP 486 Busy Here — ${to.name} 통화중 (NDUB, 부가서비스 미적용)`,
              `SIP 486 Busy Here — ${to.name} is busy (NDUB, no supplementary service)`,
              `SIP 486 Busy Here — ${to.name} 通话中 (NDUB)`),
            'S-CSCF', 'out', undefined, 'S-CSCF', from.name)
        } else {
          // 발신자가 이미 통화중인 상태에서의 2호 발신 → 착신자는 한가함. Request Pending.
          get().addEvent('NF', 'warn',
            pick(L,
              `SIP 491 Request Pending — ${from.name} 이미 통화중 (2호 발신 보류, 착신자 ${to.name}은 한가)`,
              `SIP 491 Request Pending — ${from.name} already in a call (second origination pending; callee ${to.name} is free)`,
              `SIP 491 Request Pending — ${from.name} 已在通话中 (第二路发起挂起，被叫 ${to.name} 空闲)`),
            'S-CSCF', 'out', undefined, 'S-CSCF', from.name)
        }
        return
      }
    }

    set({
      call: {
        fromId, toId: effToId,
        fromName: from.name, toName: to.name,
        phase: 'inviting',
        interPlmn: fromZone !== toZone,
        startedSec: null,
        forwardedFrom,
      },
    })
  },

  setCallPhase: (phase, reason) =>
    set((s) => (s.call ? { call: { ...s.call, phase, reason } } : {})),

  toggleHold: () => {
    const c = get().call
    if (!c || c.phase !== 'active') return
    const held = !c.held
    set({ call: { ...c, held } })
    get().addEvent('UE', 'info',
      held
        ? pick(get().lang,
            `통화 보류(Hold) — re-INVITE (a=sendonly → 상대 a=recvonly), 200 OK. 미디어 편도/보류음 (TS 24.610)`,
            `Call hold — re-INVITE (a=sendonly → remote a=recvonly), 200 OK. Media held (TS 24.610)`,
            `通话保留(Hold) — re-INVITE (a=sendonly → 对端 a=recvonly), 200 OK. 媒体保留 (TS 24.610)`)
        : pick(get().lang,
            `통화 재개(Resume) — re-INVITE (a=sendrecv), 200 OK. 양방향 미디어 복원 (TS 24.610)`,
            `Call resume — re-INVITE (a=sendrecv), 200 OK. Two-way media restored (TS 24.610)`,
            `通话恢复(Resume) — re-INVITE (a=sendrecv), 200 OK. 双向媒体恢复 (TS 24.610)`),
      'P-CSCF', 'out', undefined, c.fromName, 'P-CSCF')
  },

  endCall: () => {
    const held = get().heldCall
    if (held) {
      // Call Waiting/CFB로 보류돼 있던 통화를 종료 후 재개 (swap back).
      get().addEvent('NF', 'info',
        pick(get().lang,
          `보류 통화 재개 — ${held.fromName}→${held.toName} re-INVITE (a=sendrecv), 200 OK`,
          `Resume held call — ${held.fromName}→${held.toName} re-INVITE (a=sendrecv), 200 OK`,
          `恢复保留通话 — ${held.fromName}→${held.toName} re-INVITE (a=sendrecv), 200 OK`),
        'S-CSCF', 'out', undefined, 'S-CSCF', held.fromName)
      set({ call: { ...held, held: false, waitingFrom: undefined }, heldCall: null })
    } else {
      set({ call: null })
    }
  },
  setPersonProbe: (id, p) =>
    set((s) => {
      const next = { ...s.personProbes }
      if (p) next[id] = p
      else delete next[id]
      return { personProbes: next }
    }),

  addEvent: (source, level, msg, node, dir, imsi, from, to) =>
    set((s) => {
      // SECTION T: from/to 미지정 시 node·dir·msg로 송신자→수신자 도출 (모든 emit 지점 커버)
      const ft = from || to ? { from, to } : endpoints(node, dir, msg)
      return {
        events: [
          ...s.events.slice(-499),
          {
            id: eventCounter++,
            time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
            source,
            level,
            msg,
            node,
            dir,
            imsi,
            from: ft.from,
            to: ft.to,
          },
        ],
      }
    }),
  clearEvents: () => set({ events: [] }),
  clearNodeEvents: (node) => set((s) => ({ events: s.events.filter((e) => e.node !== node) })),
  goToZone: (zone) =>
    set((s) => ({ gotoZoneReq: { zone, n: (s.gotoZoneReq?.n ?? 0) + 1 } })),

  setSiteDown: (site, down) => {
    set((s) => ({ siteDown: { ...s.siteDown, [site]: down } }))
    get().addEvent('NF', down ? 'error' : 'info',
      pick(get().lang,
        down ? `⚠ 사이트 ${site} 장애 발생 — 해당 사이트 NF 전부 다운, geo-redundancy 절체 시작`
             : `사이트 ${site} 복구 — NF 재등록(NRF), 정상 우선순위 복귀`,
        down ? `⚠ Site ${site} FAILURE — all NFs at site down, geo-redundancy failover`
             : `Site ${site} restored — NF re-registration (NRF), priority restored`,
        down ? `⚠ 站点 ${site} 故障 — 该站点全部NF宕机，启动geo冗余切换`
             : `站点 ${site} 恢复 — NF重新注册(NRF)，优先级恢复`),
      `Site-${site}`)
  },
  // 중앙에 겹치는 큰 패널들은 배타적으로 — 하나 켜면 나머지는 닫힘
  setShowLog: (showLog) => set(showLog ? { showLog, showNms: false, showCore: false, showCall: false } : { showLog }),
  setShowCore: (showCore) => set(showCore ? { showCore, showLog: false, showNms: false, showCall: false } : { showCore }),
  bumpPanel: (key) => set((s) => ({ panelNonce: { ...s.panelNonce, [key]: (s.panelNonce[key] ?? 0) + 1 } })),
  setShowNms: (showNms) => set(showNms ? { showNms, showLog: false, showCore: false, showCall: false } : { showNms }),
  setShowCall: (showCall) => set(showCall ? { showCall, showLog: false, showNms: false, showCore: false, showScenarios: false } : { showCall }),
  setProcedureUe: (procedureUe) =>
    set((s) => ({ procedureUe, procedureNonce: s.procedureNonce + 1 })),
  setShowScenarios: (showScenarios) => set(showScenarios ? { showScenarios, showLog: false, showNms: false, showCore: false, showCall: false } : { showScenarios }),
  setShowUeList: (showUeList) => set({ showUeList }),
  setShowUeTrace: (showUeTrace) => set({ showUeTrace }),
  setTraceUe: (traceUe) => set({ traceUe, showUeTrace: true }),

  exportConfig: () => {
    const s = get()
    return JSON.stringify(
      {
        version: 1,
        space: s.space, objects: s.objects, coreNfs: s.coreNfs, coreDn: s.coreDn,
        ranArch: s.ranArch, ranUnits: s.ranUnits, homeZone: s.homeZone, ceiling: s.ceiling, slices: s.slices,
        mobility: s.mobility, ueSim: s.ueSim, floorPlan: s.floorPlan,
      },
      null, 2,
    )
  },

  applySnapshot: (snap) =>
    set((s) => ({
      objects: snap.objects, coreNfs: snap.coreNfs, coreDn: snap.coreDn,
      slices: snap.slices, space: snap.space, selectedId: null, dragging: null,
      // RAN 논리 유닛도 coreNfs와 동일하게 복원 (구 스냅샷 호환: 없으면 현재 값 유지).
      ranUnits: snap.ranUnits ?? s.ranUnits,
      // BUG6: 스냅샷에 담긴 UE 런타임 맵을 복원 (없으면 현재 값 유지 — 구 스냅샷 호환).
      personImsi: snap.personImsi ?? s.personImsi,
      personUeOn: snap.personUeOn ?? s.personUeOn,
      personTraffic: snap.personTraffic ?? s.personTraffic,
      personTrafficType: snap.personTrafficType ?? s.personTrafficType,
      personBarred: snap.personBarred ?? s.personBarred,
      personSupp: snap.personSupp ?? s.personSupp,
      registeredImsis: snap.registeredImsis ?? s.registeredImsis,
    })),

  applyLayoutPreset: (preset, zone = 'A') => {
    const mk = (kind: ObjKind, x: number, z: number, rot = 0, extra: Partial<SceneObject> = {}): SceneObject => ({
      id: `obj-${idCounter++}`, kind, name: `${KIND_PREFIX[kind]}-${idCounter}`,
      position: [x, 0, z], rotation_deg: rot,
      size: CATALOG[kind].resizable ? [...CATALOG[kind].size] : undefined,
      gnb: kind === 'gnb' ? { ...DEFAULT_GNB, ...(extra.gnb ?? {}) } : undefined,
      zone, ...extra,
    })
    const objs: SceneObject[] = []
    let space = { width: 100, depth: 80, height: 10 }
    const ru = (x: number, z: number, g: Partial<import('./types').GnbParams> = {}) =>
      objs.push(mk('gnb', x, z, 0, { gnb: g as SceneObject['gnb'] }))

    // 사방 외벽 헬퍼
    const walls = (w: number, d: number, hh = 3, th = 0.3) => {
      objs.push(mk('wall', w / 2, th / 2, 0, { size: [w, hh, th] }))
      objs.push(mk('wall', w / 2, d - th / 2, 0, { size: [w, hh, th] }))
      objs.push(mk('wall', th / 2, d / 2, 90, { size: [d, hh, th] }))
      objs.push(mk('wall', w - th / 2, d / 2, 90, { size: [d, hh, th] }))
    }

    if (preset === 'spacious') {
      // 광활한 개활지 — 넓은 공간에 매크로 RU 다수 + 사람들 흩뿌림
      space = { width: 240, depth: 170, height: 15 }
      const rp: [number, number][] = [[70, 55], [170, 55], [120, 125]]
      rp.forEach(([x, z]) => ru(x, z, { mount: 'pole', height: 12, tx_power_dbm: 33, max_ue: 200 }))
      for (let i = 0; i < 10; i++)
        objs.push(mk('person', 40 + (i % 5) * 35, 50 + Math.floor(i / 5) * 45))
    } else if (preset === 'office') {
      // 사무실 — 천장형 소형셀 다수(격자), 큐비클 농장으로 빽빽하게
      space = { width: 120, depth: 84, height: 3.4 }
      walls(120, 84, 3, 0.3)
      // 천장 소형셀 촘촘히 (5×3 = 15개)
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++)
        ru(15 + i * 23, 16 + j * 26, { mount: 'ceiling', height: 3.2, band_class: 'mid', tx_power_dbm: 12, max_ue: 48 })
      // 큐비클 농장 — 책상+의자 격자로 공간을 가득 채움 (파티션 포함)
      for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
        const x = 10 + c * 13, z = 10 + r * 13
        objs.push(mk('desk', x, z))
        objs.push(mk('chair', x, z + 1.4, 180))
        if (r < 4) objs.push(mk('glasswall', x, z + 6.5, 0, { size: [12, 1.4, 0.05] })) // 파티션
      }
      // 회의실 3개 (유리 파티션)
      for (let m = 0; m < 3; m++) {
        const x = 12 + m * 36
        objs.push(mk('glasswall', x + 8, 74, 0, { size: [16, 2.6, 0.06] }))
        objs.push(mk('glasswall', x, 78, 90, { size: [8, 2.6, 0.06] }))
        objs.push(mk('table', x + 6, 78))
        for (let k = 0; k < 4; k++) objs.push(mk('chair', x + 2 + k * 3, 78, 90))
      }
      // 벽면 캐비닛/선반 라인 + 라운지 + 화분
      for (let i = 0; i < 8; i++) objs.push(mk('cabinet', 114, 8 + i * 9))
      objs.push(mk('sofa', 108, 74), mk('sofa', 108, 68, 180), mk('table', 112, 71))
      for (let i = 0; i < 8; i++) objs.push(mk('plant', 6 + i * 15, 4))
      // 사람들 (책상마다 근처)
      for (let i = 0; i < 24; i++) objs.push(mk('person', 12 + (i % 8) * 13, 12 + Math.floor(i / 8) * 13))
    } else if (preset === 'factory') {
      // 공장 — 기둥 격자 + 창고랙 줄줄이 + 생산라인 여러 열 (빽빽)
      space = { width: 190, depth: 130, height: 11 }
      // 매크로(봉) + 천장 다수
      ru(35, 30, { mount: 'pole', height: 9, tx_power_dbm: 31, max_ue: 200 })
      ru(150, 30, { mount: 'pole', height: 9, tx_power_dbm: 31, max_ue: 200 })
      ru(35, 100, { mount: 'pole', height: 9, tx_power_dbm: 31, max_ue: 200 })
      ru(150, 100, { mount: 'pole', height: 9, tx_power_dbm: 31, max_ue: 200 })
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
        ru(55 + i * 40, 45 + j * 40, { mount: 'ceiling', height: 9, band_class: 'mid', tx_power_dbm: 20 })
      // 기둥 격자 (촘촘)
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++)
        objs.push(mk('pillar', 20 + c * 30, 18 + r * 32, 0, { size: [0.9, 11, 0.9] }))
      // 창고 랙 — 좌측 절반을 통로별로 가득
      for (let aisle = 0; aisle < 5; aisle++) {
        const z = 12 + aisle * 24
        for (let i = 0; i < 9; i++) objs.push(mk('shelf', 10 + i * 8, z, 0, { size: [6, 5, 1.2] }))
      }
      // 생산 라인 — 우측에 기계 여러 열
      for (let line = 0; line < 4; line++) {
        const z = 20 + line * 28
        for (let i = 0; i < 6; i++) objs.push(mk('machine', 100 + i * 14, z, 0, { size: [2.4, 2.2, 1.6] }))
      }
      for (let i = 0; i < 14; i++) objs.push(mk('person', 20 + (i % 7) * 22, 65 + Math.floor(i / 7) * 20))
    } else if (preset === 'warehouse') {
      // 물류창고 — 높은 랙이 줄줄이, 좁은 통로, 천장 RU
      space = { width: 200, depth: 130, height: 12 }
      walls(200, 130, 4, 0.3)
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
        ru(35 + i * 45, 45 + j * 45, { mount: 'ceiling', height: 11, band_class: 'mid', tx_power_dbm: 22, max_ue: 128 })
      // 초고밀도 랙 열 (통로 2m)
      for (let bay = 0; bay < 8; bay++) {
        const x0 = 12 + bay * 24
        for (let i = 0; i < 10; i++) {
          objs.push(mk('shelf', x0, 10 + i * 11, 0, { size: [8, 8, 1.2] }))
          objs.push(mk('shelf', x0 + 5, 10 + i * 11, 0, { size: [8, 8, 1.2] }))
        }
      }
      for (let i = 0; i < 8; i++) objs.push(mk('person', 20 + i * 22, 66))
    } else if (preset === 'hall') {
      // 대형 홀 / 아레나 — 고천장 개방, 빔포밍(하이밴드) RU, 대규모 군중
      space = { width: 160, depth: 130, height: 20 }
      walls(160, 130, 6, 0.4)
      // 하이밴드 빔포밍 RU (천장/기둥)
      const hp: [number, number][] = [[40, 35], [120, 35], [40, 95], [120, 95], [80, 65]]
      hp.forEach(([x, z]) => ru(x, z, { mount: 'ceiling', height: 16, band_class: 'high', antenna: 'beam', tx_power_dbm: 26, max_ue: 400 }))
      // 관중 (대규모)
      for (let i = 0; i < 40; i++)
        objs.push(mk('person', 20 + (i % 10) * 13, 25 + Math.floor(i / 10) * 22))
    } else {
      // 카페 / 상가 — 아늑, 테이블·소파 군집, 천장 소형셀
      space = { width: 60, depth: 44, height: 3.2 }
      walls(60, 44, 3, 0.25)
      ru(20, 15, { mount: 'ceiling', height: 3, band_class: 'mid', tx_power_dbm: 10 })
      ru(42, 30, { mount: 'ceiling', height: 3, band_class: 'mid', tx_power_dbm: 10 })
      // 카운터(캐비닛 열) + 진열
      for (let i = 0; i < 4; i++) objs.push(mk('cabinet', 6 + i * 3, 40))
      // 테이블+의자 군집
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const x = 10 + c * 12, z = 8 + r * 11
        objs.push(mk('table', x, z))
        objs.push(mk('chair', x - 1.5, z), mk('chair', x + 1.5, z, 180))
      }
      // 창가 소파 + 화분
      objs.push(mk('sofa', 54, 12), mk('sofa', 54, 20), mk('sofa', 54, 28))
      for (let i = 0; i < 5; i++) objs.push(mk('plant', 6 + i * 12, 4))
      for (let i = 0; i < 10; i++) objs.push(mk('person', 10 + (i % 5) * 11, 12 + Math.floor(i / 5) * 11))
    }
    // 대상 지역만 교체 — 다른 지역 구성은 유지
    const s0 = get()
    const keepObjs = s0.objects.filter((o) => (o.zone ?? 'A') !== zone)
    const keepNfs = s0.coreNfs.filter((n) => n.zone !== zone)
    // 대상 지역 기본 코어 생성 (등록/세션/통화 바로 되도록)
    const coreTypes: NfType[] = ['AMF', 'SMF', 'UPF', 'AUSF', 'UDM', 'NRF', 'SEPP', 'P-CSCF', 'I-CSCF', 'S-CSCF']
    const zoneCore: CoreNf[] = coreTypes.map((nf_type) => ({
      id: `nf-${zone}-${nf_type}-${idCounter++}`, nf_type, name: `${nf_type}-${zone}1`, zone, ...DEFAULT_NF,
    }))
    // 삭제되는 대상 지역 측정요원의 런타임 상태 정리
    const removed = new Set(s0.objects.filter((o) => (o.zone ?? 'A') === zone).map((o) => o.id))
    const clean = <T,>(rec: Record<string, T>) =>
      Object.fromEntries(Object.entries(rec).filter(([k]) => !removed.has(k)))
    if (zone === 'A') {
      try {
        localStorage.removeItem(PERSIST_KEY)
        localStorage.removeItem(PERSIST_KEY + '-plan')
      } catch { /* ignore */ }
    }
    // 프리셋으로 새로 배치되는 각 측정요원(person)에 고유 IMSI 부여 + 레지스트리 등록.
    const presetImsi: Record<string, string> = clean(s0.personImsi) as Record<string, string>
    const newPresetImsis: string[] = []
    for (const o of objs) {
      if (o.kind === 'person') {
        const imsi = nextPersonImsi(s0.ueSim)
        presetImsi[o.id] = imsi
        newPresetImsis.push(imsi)
      }
    }
    set({
      space,
      objects: [...keepObjs, ...objs],
      coreNfs: [...keepNfs, ...zoneCore],
      coreDn: { ...s0.coreDn, [zone]: true },
      slices: [
        ...s0.slices.filter((sl) => sl.zone !== zone),
        { id: `sl-${zone}-1`, sst: 1, sd: '000001', name: 'eMBB', zone },
      ],
      ceiling: true,
      selectedId: null, dragging: null, tool: 'select', mode: 'edit',
      personTraffic: clean(s0.personTraffic), personMbps: clean(s0.personMbps),
      personProbes: clean(s0.personProbes), personUeOn: clean(s0.personUeOn),
      personTrafficType: clean(s0.personTrafficType), personImsi: presetImsi,
      personBarred: clean(s0.personBarred), personSupp: clean(s0.personSupp),
      registeredImsis: [...new Set([...s0.registeredImsis, ...newPresetImsis])],
      gotoZoneReq: { zone, n: (s0.gotoZoneReq?.n ?? 0) + 1 },
    })
    const pn: Record<string, string> = {
      spacious: '광활한 공간', office: '사무실', factory: '공장',
      warehouse: '물류창고', hall: '대형 홀', cafe: '카페/상가',
    }
    get().addEvent('SIM', 'info',
      pick(get().lang,
        `배치 예시 적용: ${pn[preset]} (오브젝트 ${objs.length}개)`,
        `Layout preset applied: ${preset} (${objs.length} objects)`,
        `已应用布局示例: ${preset} (${objs.length})`))
  },

  resetScene: () => {
    try {
      localStorage.removeItem(PERSIST_KEY)
      localStorage.removeItem(PERSIST_KEY + '-plan')
    } catch { /* ignore */ }
    set({
      space: { width: 160, depth: 120, height: 10 },
      objects: demoScene(),
      coreNfs: demoCore(),
      coreDn: { A: true, B: false, C: false },
      ranArch: { A: 'gnb', B: 'gnb', C: 'gnb' },
      ranUnits: demoRan(),
      slices: [{ id: 'sl-A-1', sst: 1, sd: '000001', name: 'eMBB', zone: 'A' }],
      homeZone: 'A', ceiling: true, floorPlan: null,
      selectedId: null, dragging: null, tool: 'select', mode: 'edit',
      call: null, heldCall: null, personTraffic: {}, personMbps: {}, personProbes: {},
      personBarred: {}, personSupp: {},
      // BUG6: 누락돼 있던 런타임 UE 맵도 함께 초기화 (registeredImsis가 리셋마다 무한 증가하던 문제 포함).
      personUeOn: {}, personTrafficType: {}, personImsi: {}, personCallee: {},
      registeredImsis: [defaultImsi(get().ueSim)],
      viewNonce: get().viewNonce + 1, // 카메라 시점도 초기화
      gotoZoneReq: null,
    })
    get().addEvent('SIM', 'info', pick(get().lang, '초기화됨 — 기본 구성으로 리셋', 'Reset to default', '已初始化 — 重置为默认配置'))
  },

  importConfig: (json) => {
    try {
      const d = JSON.parse(json)
      if (!d.objects || !d.space) return false
      const sim = d.ueSim ?? get().ueSim
      // BUG6: 임포트된 각 측정요원(person)에 고유 IMSI를 부여하고 UDM/UDR 레지스트리에 등록.
      // (미지정 시 전원 ON UE가 defaultImsi로 폴백돼 서로 다른 UE의 트레이스가 합쳐지던 문제 방지.)
      const personImsi: Record<string, string> = {}
      const newImsis: string[] = []
      for (const o of (d.objects as SceneObject[])) {
        if (o.kind === 'person') {
          const im = nextPersonImsi(sim)
          personImsi[o.id] = im
          newImsis.push(im)
        }
      }
      set({
        space: d.space, objects: d.objects, coreNfs: d.coreNfs ?? [],
        coreDn: d.coreDn ?? { A: true, B: false, C: false },
        ranArch: d.ranArch ?? { A: 'gnb', B: 'gnb', C: 'gnb' },
        ranUnits: d.ranUnits ?? [],
        homeZone: d.homeZone ?? 'A', ceiling: d.ceiling ?? true,
        slices: d.slices ?? [], mobility: d.mobility ?? get().mobility,
        ueSim: sim, floorPlan: d.floorPlan ?? null, selectedId: null,
        // 임포트는 씬을 교체하므로 이전 씬의 런타임 UE 맵을 초기화하고 새 IMSI 맵을 심는다.
        personImsi,
        personUeOn: {}, personTraffic: {}, personMbps: {}, personProbes: {},
        personTrafficType: {}, personBarred: {}, personSupp: {}, personCallee: {},
        registeredImsis: [...new Set([defaultImsi(sim), ...newImsis])],
      })
      get().addEvent('SIM', 'info',
        pick(get().lang, '구성 불러오기 완료', 'Configuration loaded', '配置加载完成'))
      return true
    } catch {
      return false
    }
  },

  runPositioning: (id, opts) => {
    const s0 = get()
    const obj = s0.objects.find((o) => o.id === id)
    if (!obj) return
    const zone = (obj.zone ?? 'A') as Zone
    const ctx = flowCtxForPerson(s0, obj)
    const imsi = s0.personImsi[id] ?? defaultImsi(s0.ueSim)
    const nf = (type: NfType) => activeNf(s0.coreNfs, zone, type, s0.siteDown)?.name ?? null
    // 서빙 RU 지오메트리(E-CID coarse 위치 추정) + 존 TRP 수(DL-TDOA/Multi-RTT GDOP 판정).
    const rus = s0.objects.filter(
      (o) => o.kind === 'gnb' && (o.zone ?? 'A') === zone && o.gnb?.enabled !== false,
    )
    const servingRu = rus.find((r) => r.name === ctx.servingName) ?? null
    const rsrp = s0.personProbes[id]?.rsrp_dbm ?? s0.probe?.rsrp_dbm ?? null
    if (!nf('LMF') || !nf('GMLC')) {
      get().addEvent('NF', 'warn',
        pick(s0.lang,
          `${obj.name}: 측위 불가 — ${!nf('GMLC') ? 'GMLC' : 'LMF'} 없음 (LCS/MT-LR 종단 부재)`,
          `${obj.name}: positioning unavailable — no ${!nf('GMLC') ? 'GMLC' : 'LMF'} (LCS/MT-LR endpoint missing)`,
          `${obj.name}: 无法定位 — 缺少 ${!nf('GMLC') ? 'GMLC' : 'LMF'} (LCS/MT-LR 终结点缺失)`),
        !nf('GMLC') ? 'GMLC' : 'LMF', undefined, imsi, !nf('GMLC') ? 'GMLC' : 'LMF', obj.name)
      return
    }
    const steps = buildPositioningSteps(ctx, {
      gmlc: nf('GMLC'), lmf: nf('LMF'),
      method: opts?.method ?? 'E-CID',
      unreachable: opts?.unreachable, mico: opts?.mico, lcsClient: opts?.lcsClient,
      servingCell: servingRu ? { x: servingRu.position[0], z: servingRu.position[2] } : null,
      rsrp, trpCount: rus.length,
      // DL-TDOA/Multi-RTT PDOP 산출용 TRP 지오메트리 + UE 실제 위치
      trps: rus.map((r) => ({ x: r.position[0], z: r.position[2] })),
      truePos: { x: obj.position[0], z: obj.position[2] },
    })
    let i = 0
    const runNext = () => {
      if (i >= steps.length) return
      const st = steps[i++]
      get().addEvent(st.source, st.level, st.msg, st.node, st.dir, imsi, st.from, st.to)
      setTimeout(runNext, 170)
    }
    runNext()
  },

  applyScenario: (id) => {
    const sc = SCENARIOS.find((s) => s.id === id)
    if (!sc) return
    // 기존 구성을 전부 지우고 시나리오대로 새로 배치 (Core+RAN+측정요원 자동 구성)
    const objects: SceneObject[] = []
    let coreNfs: CoreNf[] = []
    const coreDn: Record<Zone, boolean> = { A: false, B: false, C: false }
    const slices: Slice[] = []
    const zonesUsed = new Set<Zone>()
    const createdPersons: string[] = []
    let personCounter = 0
    const sp = get().space
    set({
      personTraffic: {}, personMbps: {}, personProbes: {},
      personUeOn: {}, personTrafficType: {}, personImsi: {},
      personBarred: {}, personSupp: {},
      call: null, heldCall: null, selectedId: null, procedureUe: null,
    })

    const nfExists = (zone: Zone, type: NfType) =>
      coreNfs.some((n) => n.zone === zone && n.nf_type === type)
    const addSliceLocal = (zone: Zone, sst: number, sd: string) => {
      if (slices.some((s) => s.zone === zone && s.sst === sst)) return
      const nm = { 1: 'eMBB', 2: 'URLLC', 3: 'MIoT' }[sst] ?? `SST${sst}`
      slices.push({ id: `sl-${zone}-${sst}-${idCounter++}`, sst, sd, name: nm, zone })
    }

    for (const op of sc.setup) {
      if (op.op === 'ensureNf' && !nfExists(op.zone, op.type)) {
        zonesUsed.add(op.zone)
        const count = coreNfs.filter((n) => n.zone === op.zone && n.nf_type === op.type).length + 1
        coreNfs.push({
          id: `nf-${op.zone}-${op.type}-${idCounter++}`,
          nf_type: op.type, name: `${op.type}-${op.zone}${count}`, zone: op.zone, ...DEFAULT_NF,
        })
      } else if (op.op === 'ensureNf') {
        coreNfs = coreNfs.map((n) =>
          n.zone === op.zone && n.nf_type === op.type ? { ...n, enabled: true } : n,
        )
      } else if (op.op === 'removeNf') {
        coreNfs = coreNfs.filter((n) => !(n.zone === op.zone && n.nf_type === op.type))
      } else if (op.op === 'disableNf') {
        coreNfs = coreNfs.map((n) =>
          n.zone === op.zone && n.nf_type === op.type ? { ...n, enabled: false } : n,
        )
      } else if (op.op === 'setDn') {
        coreDn[op.zone] = op.on
      } else if (op.op === 'addSlice') {
        zonesUsed.add(op.zone)
        addSliceLocal(op.zone, op.sst, op.sd)
      } else if (op.op === 'ensureRU') {
        zonesUsed.add(op.zone)
        if (!objects.some((o) => o.kind === 'gnb' && (o.zone ?? 'A') === op.zone)) {
          const n = objects.filter((o) => o.kind === 'gnb' && (o.zone ?? 'A') === op.zone).length + 1
          objects.push({
            id: `obj-${idCounter++}`, kind: 'gnb', name: `RU-${op.zone}${n}`,
            position: [sp.width * 0.5, 0, sp.depth * 0.5], rotation_deg: 0,
            gnb: { ...DEFAULT_GNB }, zone: op.zone,
          })
        }
      } else if (op.op === 'ensurePerson') {
        zonesUsed.add(op.zone)
        if (!objects.some((o) => o.kind === 'person' && o.name === op.name)) {
          personCounter++
          const pid = `obj-${idCounter++}`
          objects.push({
            id: pid, kind: 'person', name: op.name,
            position: [
              sp.width * (0.4 + 0.1 * (personCounter % 3)),
              0,
              sp.depth * (0.4 + 0.08 * (personCounter % 4)),
            ],
            rotation_deg: 0, zone: op.zone,
          })
          createdPersons.push(pid)
        }
      }
    }
    // 코어를 둔 각 존에 기본 eMBB 슬라이스 프로비저닝 (미지정 시) — 등록/세션이 실제로 되도록
    for (const z of zonesUsed) addSliceLocal(z, 1, '000001')
    // 측정요원이 없으면, 코어/RAN이 구성된 첫 존에 측정요원 1명 자동 배치 (결과 관측용)
    if (createdPersons.length === 0) {
      const firstZone = [...zonesUsed].find((z) =>
        objects.some((o) => o.kind === 'gnb' && (o.zone ?? 'A') === z)) ?? [...zonesUsed][0]
      if (firstZone) {
        const pid = `obj-${idCounter++}`
        objects.push({
          id: pid, kind: 'person', name: `UE-${firstZone}1`,
          position: [sp.width * 0.45, 0, sp.depth * 0.45], rotation_deg: 0, zone: firstZone,
        })
        createdPersons.push(pid)
      }
    }
    // 시나리오로 배치된 각 측정요원(person)에 고유 IMSI 부여 + UDM/UDR 레지스트리 등록.
    const sim0 = get().ueSim
    const scenarioImsi: Record<string, string> = {}
    for (const pid of createdPersons) scenarioImsi[pid] = nextPersonImsi(sim0)
    set({
      objects, coreNfs, coreDn, slices, personUeOn: {},
      personImsi: scenarioImsi,
      registeredImsis: [defaultImsi(sim0), ...Object.values(scenarioImsi)],
    })
    get().addEvent(
      'SIM', 'info',
      pick(get().lang,
        `시나리오 적용: ${sc.ko}${sc.cause ? ` — 기대 결과: ${sc.cause}` : ''}`,
        `Scenario applied: ${sc.en}${sc.cause ? ` — expected: ${sc.cause}` : ''}`,
        `应用场景: ${sc.zh}${sc.cause ? ` — 预期: ${sc.cause}` : ''}`),
    )
    // BUG1c: 로밍 시나리오는 관측 UE를 자동 전원 ON/attach 하지 않는다. 방문존에는 AUSF/UDM이
    // 없어(홈 인증) buildAttachSteps가 auth-reject를 방출하며 "성공" 라벨과 모순되기 때문. 결과는
    // 시나리오 note + 로밍 경로 패널로 안내한다.
    if (sc.domain !== 'roaming') {
      // 시나리오 측정요원 전원 ON → 실제 attach 절차/거절 로그 스트리밍 (결과 관측)
      for (const pid of createdPersons) get().togglePersonUe(pid)
    }
    // note 안내가 있으면 로그에 병기 (수동 조작 필요 사항)
    for (const op of sc.setup) {
      if (op.op === 'note') get().addEvent('SIM', 'info', `↳ ${op.text}`)
    }
    // BUG2: 전용 call-flow 시나리오면 attach 로그가 흐른 뒤 해당 빌더의 절차(페이징/RNAU/GUTI 재배정/
    // MRO/Reroute NAS)를 실제로 스트리밍한다. buildServiceRequestSteps/buildDeregisterSteps과 동일하게
    // addEvent(source, level, msg, node, dir, imsi, from, to)로 방출한다.
    if (FLOW_BUILDER_SCENARIOS.has(sc.id) && createdPersons.length > 0) {
      const flowPid = createdPersons[0]
      setTimeout(() => {
        const s1 = get()
        const obj = s1.objects.find((o) => o.id === flowPid)
        if (!obj) return
        const imsi = s1.personImsi[flowPid] ?? defaultImsi(s1.ueSim)
        const fctx = flowCtxForPerson(s1, obj)
        const zoneR = (obj.zone ?? 'A') as Zone
        let steps: AttachStep[] = []
        switch (sc.id) {
          case 'mt-paging-ddn':
            steps = buildPagingSteps(fctx)
            break
          case 'reg-mico-unreachable':
            // MICO 협상 → CM-IDLE 중 MT 페이징 억제(도달불가).
            steps = buildPagingSteps(fctx, { mico: true })
            break
          case 'rnau-inactive':
            steps = buildRnauSteps(fctx)
            break
          case 'guti-reallocation':
            steps = buildGutiReallocSteps(fctx)
            break
          case 'reg-reroute-nas': {
            // 초기 AMF(amf1)가 Requested-NSSAI 미지원 → target AMF(amf2)로 Reroute NAS.
            const amfs = s1.coreNfs.filter(
              (n) => n.zone === zoneR && n.nf_type === 'AMF' && n.enabled,
            )
            const amf1 = amfs[0]?.name ?? fctx.amf ?? `AMF-${zoneR}1`
            const amf2 = amfs[1]?.name ?? `AMF-${zoneR}2`
            steps = buildRerouteSteps({
              ueName: obj.name, servingName: fctx.servingName, amf1, amf2, requestedSst: [2],
            })
            break
          }
          case 'mro-too-late':
          case 'mro-too-early':
          case 'mro-wrong-cell': {
            const rus = s1.objects.filter((o) => o.kind === 'gnb' && (o.zone ?? 'A') === zoneR)
            const src = fctx.servingName ?? rus[0]?.name ?? `RU-${zoneR}1`
            const tgt = rus.find((r) => r.name !== src)?.name ?? `RU-${zoneR}2`
            const third = rus.find((r) => r.name !== src && r.name !== tgt)?.name ?? `RU-${zoneR}3`
            const mro: MroType =
              sc.id === 'mro-too-late' ? 'too-late' : sc.id === 'mro-too-early' ? 'too-early' : 'wrong-cell'
            steps = buildMroFailureSteps(
              { ueName: obj.name, sourceRu: src, targetRu: tgt, thirdRu: third, amf: fctx.amf, t310Ms: s1.mobility.t310_ms, t304Ms: 500 },
              mro,
            )
            break
          }
        }
        for (const st of steps)
          get().addEvent(st.source, st.level, st.msg, st.node, st.dir, imsi, st.from, st.to)
      }, 3500)
    }
    // SECTION B: 측위 시나리오면 attach 완료 후 MT-LR call-flow를 스트리밍 (LPP:1 capability 실현).
    if (sc.domain === 'positioning' && createdPersons.length > 0) {
      const pid = createdPersons[0]
      const unreachable = sc.id === 'pos-fail-unreachable'
      // 성공 케이스는 attach 로그가 흐른 뒤 이어지도록 지연, 실패 케이스는 곧바로.
      setTimeout(() => get().runPositioning(pid, {
        method: unreachable ? 'DL-TDOA' : 'E-CID',
        unreachable, mico: unreachable,
      }), unreachable ? 600 : 3500)
    }
  },
  setUeZone: (ueZone) => set({ ueZone }),

  setUeSim: (patch) => {
    set((s) => ({ ueSim: { ...s.ueSim, ...patch } }))
    if (patch.scheme) {
      if (patch.scheme === 'null') {
        get().addEvent(
          'UE', 'warn',
          pick(get().lang,
            'SUPI 보호 해제 (null-scheme) — 등록 시 IMSI가 평문 노출됩니다',
            'SUPI protection off (null-scheme) — IMSI sent in cleartext',
            'SUPI 保护解除 (null-scheme) — 注册时 IMSI 以明文暴露'),
        )
      } else {
        get().addEvent(
          'UE', 'info',
          pick(get().lang,
            'SUCI 은닉 활성화 (ECIES Profile A) — 홈망 UDM만 SUPI 복원 가능',
            'SUCI concealment on (ECIES Profile A) — only home UDM can de-conceal',
            'SUCI 隐藏已启用 (ECIES Profile A) — 仅归属网 UDM 可还原 SUPI'),
        )
      }
    }
  },

  toggleUe: () => {
    const on = !get().ueOn
    const L = LOGT[get().lang]
    const sim = get().ueSim
    set({ ueOn: on, trafficActive: false, trafficMbps: 0, probe: on ? get().probe : null })
    get().addEvent('UE', 'info', on ? L.ue_on : L.ue_off)
    if (on) {
      // 등록 절차: UE는 SUPI가 아닌 SUCI를 전송 (TS 33.501)
      get().addEvent('UE', 'info', `Registration Request → SUCI: ${suciOf(sim)}`)
      get().addEvent(
        'UE',
        sim.scheme === 'null' ? 'warn' : 'info',
        sim.scheme === 'null'
          ? pick(get().lang, '⚠ null-scheme: MSIN 평문 전송됨', '⚠ null-scheme: MSIN in cleartext', '⚠ null-scheme: MSIN 明文发送')
          : pick(get().lang,
              `UDM에서 SUCI → SUPI(${supiOf(sim)}) 복원, AUSF 인증 진행`,
              `UDM de-conceals SUCI → SUPI(${supiOf(sim)}), AUSF auth follows`,
              `UDM 将 SUCI → SUPI(${supiOf(sim)}) 还原，进行 AUSF 认证`),
      )
    }
  },

  toggleTraffic: () => {
    const active = !get().trafficActive
    if (active) {
      // RAN 경로(RU→프론트홀→DU→F1→CU→N2→AMF & N3→UPF) + RSRP 게이트 —
      // 걷는 UE의 서빙 셀(probe.serving = RU id) 무선구간이 성립해야 트래픽 시작.
      const s0 = get()
      const probe = s0.probe
      const servingRu = probe?.serving ? s0.objects.find((o) => o.id === probe.serving) : undefined
      const chain = servingRu
        ? ranChainOk(servingRu, s0.objects, s0.ranUnits, s0.coreNfs, s0.siteDown)
        : { ok: false, reason: 'RU-off' as string }
      const rsrp = probe?.rsrp_dbm
      const thr = s0.mobility.call_drop_rsrp_dbm
      const lowRsrp = rsrp != null && rsrp < thr
      const chainBroken = !servingRu || !chain.ok
      if (chainBroken || lowRsrp) {
        get().addEvent('RU', 'error',
          pick(s0.lang,
            `트래픽 시작 불가 — ${chainBroken ? ranChainText(chain.reason, 'ko') : `RSRP ${rsrp!.toFixed(1)} < 콜드롭 기준 ${thr} (커버리지 밖)`}`,
            `Traffic blocked — ${chainBroken ? ranChainText(chain.reason, 'en') : `RSRP ${rsrp!.toFixed(1)} < call-drop threshold ${thr} (out of coverage)`}`,
            `流量不可 — ${chainBroken ? ranChainText(chain.reason, 'zh') : `RSRP ${rsrp!.toFixed(1)} < 掉话门限 ${thr} (超出覆盖)`}`),
          servingRu?.name)
        return
      }
      // 코어 E2E(등록 AMF/AUSF/UDM + 세션 SMF/UPF + DN) 미도달 → 트래픽 시작 불가.
      const zone = s0.ueZone
      if (zone) {
        const e2e = computeE2E(s0.objects, s0.coreNfs, s0.coreDn, zone, s0.siteDown, s0.ranUnits)
        if (!e2e.ok) {
          get().addEvent('NF', 'error',
            pick(s0.lang,
              `트래픽 시작 불가 — 코어 미도달(${e2e.missing.join(', ')})`,
              `Traffic blocked — core unreachable (${e2e.missing.join(', ')})`,
              `流量不可 — 核心不可达(${e2e.missing.join(', ')})`),
            servingRu?.name)
          return
        }
      }
      set({ trafficActive: true, trafficMb: 0, trafficMbps: 0 })
      get().addEvent('UE', 'info',
        pick(get().lang, 'PDU 세션 데이터 전송 시작', 'PDU session data transfer started', 'PDU 会话数据传输开始'))
    } else {
      const mb = get().trafficMb
      set({ trafficActive: false, trafficMbps: 0 })
      get().addEvent('UE', 'info',
        pick(get().lang, `데이터 전송 종료 — 총 ${mb.toFixed(1)} MB`, `Transfer ended — ${mb.toFixed(1)} MB total`, `数据传输结束 — 共 ${mb.toFixed(1)} MB`))
    }
  },

  setTrafficStats: (mbps, mbAdd) =>
    set((s) => ({
      trafficMbps: mbps,
      trafficMb: s.trafficMb + mbAdd,
      trafficHistory: [...s.trafficHistory.slice(-119), mbps],
    })),
}))

// ── 구성 자동 저장 (localStorage) — F5에도 유지 ──
{
  const persisted = loadPersisted()
  if (persisted) useStore.setState(persisted)

  let saveTimer: number | null = null
  useStore.subscribe((s, prev) => {
    // 구성에 영향 주는 필드가 바뀔 때만 저장 (측정/부하 등 런타임 값은 제외)
    if (
      s.objects === prev.objects && s.coreNfs === prev.coreNfs && s.coreDn === prev.coreDn &&
      s.ranArch === prev.ranArch && s.ranUnits === prev.ranUnits && s.homeZone === prev.homeZone &&
      s.ceiling === prev.ceiling &&
      s.slices === prev.slices && s.mobility === prev.mobility && s.ueSim === prev.ueSim &&
      s.space === prev.space && s.floorPlan === prev.floorPlan && s.lang === prev.lang
    )
      return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      const st = useStore.getState()
      // 도면(대용량 base64)은 별도 키로 저장 — 초과해도 핵심 구성 저장은 보호
      const core = {
        version: 1, space: st.space, objects: st.objects, coreNfs: st.coreNfs,
        coreDn: st.coreDn, ranArch: st.ranArch, ranUnits: st.ranUnits, homeZone: st.homeZone, ceiling: st.ceiling,
        slices: st.slices, mobility: st.mobility, ueSim: st.ueSim, lang: st.lang,
      }
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify(core))
      } catch {
        st.addEvent('SIM', 'warn',
          pick(st.lang, '⚠ 구성 자동저장 실패 (저장공간 초과)', '⚠ Auto-save failed (storage full)', '⚠ 配置自动保存失败（存储空间已满）'))
        return
      }
      try {
        if (st.floorPlan) localStorage.setItem(PERSIST_KEY + '-plan', st.floorPlan)
        else localStorage.removeItem(PERSIST_KEY + '-plan')
      } catch {
        st.addEvent('SIM', 'warn',
          pick(st.lang, '⚠ 도면은 저장공간 초과로 저장 안 됨 (구성은 저장됨)', '⚠ Floor plan too large to persist', '⚠ 平面图过大无法保存（配置已保存）'))
      }
    }, 500)
  })
}

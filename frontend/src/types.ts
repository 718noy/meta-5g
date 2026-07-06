export type MaterialKind = 'concrete' | 'glass' | 'wood' | 'metal'

// 3D 공간에 실물로 배치되는 것들 — 라디오(RU/DU/CU)와 구조물/가구.
// Core NF는 실물 없이 논리 구성(CoreNf, 존 선택)으로 관리한다.
export type ObjKind =
  | 'gnb' // RU (라디오 유닛) — active(안테나 일체형) / passive(안테나 외장형)
  | 'antenna' // 외장 안테나 (passive RU에 급전선으로 연결)
  | 'wall'
  | 'glasswall'
  | 'pillar' // 콘크리트 기둥
  | 'door' // 문 (목재)
  | 'desk'
  | 'table' // 테이블
  | 'chair'
  | 'cabinet'
  | 'shelf' // 금속 선반
  | 'sofa' // 소파 (라운지)
  | 'machine' // 생산 기계 / 랙 설비
  | 'plant' // 화분/식물 (약한 감쇠)
  | 'person' // UE를 든 측정 요원 — 수신 정보 조회 가능, 전파 계산엔 미포함
  | 'antceiling' // 천장형 외장 안테나 (passive RU 급전 연결)
  | 'antwall' // 벽면형 외장 안테나 (passive RU 급전 연결)
  | 'fixedue' // 고정 UE(공장 기계형 단말) — 배치 시 kind='person' + ueShell='machine'로 저장

export type Tool = 'select' | ObjKind

// 분리된 공간(국가/사업자) — PLMN-A/B/C. 전파는 서로 완전 격리.
// 삼각 배치: A는 위, B는 좌하, C는 우하.
export type Zone = 'A' | 'B' | 'C'
export const ZONE_GAP = 30 // 공간 사이 간격 (m)
export const ZONES: Zone[] = ['A', 'B', 'C']

// 존별 (x, z) 그리드 오프셋 배수 — 삼각형 꼭짓점
const ZONE_GRID: Record<Zone, { gx: number; gz: number }> = {
  A: { gx: 0.5, gz: 0 }, // 상단 중앙
  B: { gx: 0, gz: 1 }, // 좌하
  C: { gx: 1, gz: 1 }, // 우하
}

export function zoneOffset(zone: Zone, w: number, d: number): [number, number] {
  const g = ZONE_GRID[zone]
  return [g.gx * (w + ZONE_GAP), g.gz * (d + ZONE_GAP)]
}

// x축 오프셋만 필요한 기존 호출부 호환 (2D는 zoneOffset 사용 권장)
export function zoneOffsetX(zone: Zone, spaceWidth: number): number {
  return ZONE_GRID[zone].gx * (spaceWidth + ZONE_GAP)
}

export function zoneOffsetZ(zone: Zone, spaceDepth: number): number {
  return ZONE_GRID[zone].gz * (spaceDepth + ZONE_GAP)
}

// 월드 좌표 (x,z) → 존 판정 (어느 공간 내부인지, 밖이면 null)
export function zoneOfPoint(x: number, z: number, w: number, d: number): Zone | null {
  for (const zone of ZONES) {
    const [ox, oz] = zoneOffset(zone, w, d)
    if (x >= ox && x <= ox + w && z >= oz && z <= oz + d) return zone
  }
  return null
}

// 5GC Network Function 12종 (Phase 3에서 실제 Open5GS NF와 매핑 예정)
export type NfType =
  | 'AMF' | 'SMF' | 'UPF' | 'NRF' | 'AUSF' | 'UDM'
  | 'UDR' | 'PCF' | 'NSSF' | 'NEF' | 'SCP' | 'SMSF' | 'SEPP'
  // 추가 5GC NF — 분석·과금·바인딩·측위·비3GPP·능력·슬라이스인증
  | 'NWDAF' | 'CHF' | 'BSF' | '5G-EIR' | 'LMF' | 'GMLC'
  | 'N3IWF' | 'AF' | 'UDSF' | 'NSSAAF' | 'UCMF'
  // IMS (VoNR 음성) — P/I/S-CSCF + 미디어게이트웨이
  | 'P-CSCF' | 'I-CSCF' | 'S-CSCF' | 'IMS-AS' | 'MGW'
  // LTE/EPC (4G, 상호연동) — PCRF/HSS/MME/SGW/PGW
  | 'PCRF' | 'HSS' | 'MME' | 'SGW' | 'PGW'

export const NF_INFO: Record<NfType, { desc: string; color: string }> = {
  AMF: { desc: '접속·이동성 관리 (N1/N2 종단)', color: '#ff8a3d' },
  SMF: { desc: '세션 관리, UPF 제어 (N4)', color: '#ffd23d' },
  UPF: { desc: '사용자 데이터 전달 (N3/N6)', color: '#3dd68c' },
  NRF: { desc: 'NF 등록·발견 (SBA 레지스트리)', color: '#3da9ff' },
  AUSF: { desc: '인증 서버', color: '#b03dff' },
  UDM: { desc: '가입자 데이터 관리', color: '#ff3d8a' },
  UDR: { desc: '가입자 데이터 저장소', color: '#ff6b6b' },
  PCF: { desc: '정책 제어 (QoS·과금 정책)', color: '#3dffd2' },
  NSSF: { desc: '네트워크 슬라이스 선택', color: '#8aff3d' },
  NEF: { desc: '외부 노출 API 게이트웨이', color: '#d2a03d' },
  SCP: { desc: 'SBA 시그널링 프록시', color: '#a0a8ff' },
  SMSF: { desc: 'SMS 전달 기능', color: '#ffa0d2' },
  SEPP: { desc: '로밍 보안 프록시 (N32 종단)', color: '#ff4d4d' },
  'P-CSCF': { desc: 'Proxy-CSCF (IMS 진입점, SIP 프록시)', color: '#4dff9e' },
  'I-CSCF': { desc: 'Interrogating-CSCF (S-CSCF 조회/할당)', color: '#3dc9ff' },
  'S-CSCF': { desc: 'Serving-CSCF (SIP 등록·세션 제어)', color: '#9e6dff' },
  'IMS-AS': { desc: 'Telephony AS (VoNR 통화 서비스 로직)', color: '#ff6dc9' },
  MGW: { desc: 'Media Gateway (RTP 미디어 중계)', color: '#ffce4d' },
  PCRF: { desc: 'LTE 정책·과금 규칙 (EPC, Gx/Rx)', color: '#7ad6ff' },
  NWDAF: { desc: '네트워크 데이터 분석 (ML 기반)', color: '#6ee0ff' },
  CHF: { desc: '과금 기능 (Nchf, 온라인/오프라인)', color: '#ffb14d' },
  BSF: { desc: '바인딩 지원 (PCF 바인딩 조회)', color: '#9affce' },
  '5G-EIR': { desc: '장비 식별 등록 (PEI/IMEI 블랙리스트)', color: '#ff8f8f' },
  LMF: { desc: '측위 관리 (Location, NRPPa)', color: '#7affa0' },
  GMLC: { desc: '측위 게이트웨이 (외부 LCS)', color: '#7ac9ff' },
  N3IWF: { desc: '비3GPP 인터워킹 (Wi-Fi 액세스, N3)', color: '#c0a0ff' },
  AF: { desc: '애플리케이션 기능 (Naf, PCF 연동)', color: '#ffd28a' },
  UDSF: { desc: '비정형 데이터 저장 (Nudsf)', color: '#ffa0a0' },
  NSSAAF: { desc: '슬라이스별 인증·인가 (NSSAA)', color: '#a0ffb0' },
  UCMF: { desc: 'UE 무선능력 관리 (RACS)', color: '#b0b8ff' },
  HSS: { desc: '가입자 서버 (4G/IMS, S6a/Cx)', color: '#ff6b9e' },
  MME: { desc: '이동성 관리 (4G EPC, S1-MME)', color: '#ff9e5d' },
  SGW: { desc: '서빙 게이트웨이 (4G, S1-U/S5)', color: '#5dd6a0' },
  PGW: { desc: 'PDN 게이트웨이 (4G, S5/SGi)', color: '#3dc98c' },
}

export const NF_TYPES = Object.keys(NF_INFO) as NfType[]

// NF 운영 파라미터 — 통신사급 기능(이중화/스케일링)의 1차 모델링.
// Phase 3에서 실제 장애 절체/오토스케일 동작 시뮬레이션으로 확장.
export interface NfParams {
  enabled: boolean
  replicas: number // K8s 파드 레플리카 수
  ha: 'none' | 'active-standby' | 'geo-red'
  site: 'A' | 'B' // 배치 사이트 (A=주센터, B=재해복구/geo)
  priority: number // NRF NF-profile priority (낮을수록 우선 선택). warm-standby는 높은 값
  auto_scale: boolean // K8s HPA — 부하 초과 시 자동 스케일아웃
  max_replicas?: number // HPA 최대 레플리카 상한 (미지정 시 DEFAULT_MAX_REPLICAS)
  capacity_per_pod?: number // 파드당 UE/세션 용량 오버라이드 (미지정 시 NF_CAPACITY_PER_POD)
  throughput_per_pod?: number // 파드당 처리량 상한(Mbps, UL+DL 합) — 초과 시 HPA 스케일아웃
}

export const DEFAULT_MAX_REPLICAS = 16 // HPA 상한 기본값

export const DEFAULT_NF: NfParams = {
  enabled: true,
  replicas: 2,
  ha: 'active-standby',
  site: 'A',
  priority: 1,
  auto_scale: true,
  max_replicas: DEFAULT_MAX_REPLICAS,
  throughput_per_pod: 5000, // 파드당 5 Gbps (UL+DL) 기본
}

// 사이트(데이터센터) 장애 상태 — geo-redundancy 절체 시뮬레이션용
export type SiteDown = Record<'A' | 'B', boolean>
const NO_SITE_DOWN: SiteDown = { A: false, B: false }

// NF 인스턴스 가용 여부 = 활성(enabled) + 소속 사이트 정상
export function nfUp(n: CoreNf, siteDown: SiteDown = NO_SITE_DOWN): boolean {
  return n.enabled && !siteDown[n.site]
}

// NRF 기반 NF 선택: 같은 (zone, type) 인스턴스 중 가용한 것을 priority 오름차순
// (낮을수록 우선), 동률이면 replicas 큰 것. 활성 인스턴스가 없으면 null.
export function activeNf(
  coreNfs: CoreNf[],
  zone: Zone,
  type: NfType,
  siteDown: SiteDown = NO_SITE_DOWN,
): CoreNf | null {
  const cand = coreNfs.filter((n) => n.zone === zone && n.nf_type === type && nfUp(n, siteDown))
  if (cand.length === 0) return null
  return cand
    .slice()
    .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1) || b.replicas - a.replicas)[0]
}

// UPF 파드 1개당 처리 용량 (Mbps) — 소규모 상용 기준(8코어≈2Gbps)의 파드급 근사
export const UPF_CAPACITY_PER_POD_MBPS = 5000

// 네트워크 슬라이스 (S-NSSAI = SST + SD). 표준 SST: 1=eMBB, 2=URLLC, 3=MIoT.
export interface Slice {
  id: string
  sst: number // 1=eMBB, 2=URLLC, 3=MIoT
  sd: string // Slice Differentiator (6 hex)
  name: string
  zone: Zone
}
export const SST_NAMES: Record<number, { ko: string; en: string; zh: string }> = {
  1: { ko: 'eMBB (대용량 광대역)', en: 'eMBB (broadband)', zh: 'eMBB (大带宽)' },
  2: { ko: 'URLLC (초저지연·고신뢰)', en: 'URLLC (low-latency)', zh: 'URLLC (低时延·高可靠)' },
  3: { ko: 'MIoT (대규모 IoT)', en: 'MIoT (massive IoT)', zh: 'MIoT (海量物联网)' },
}

// 트래픽(서비스) 종류 — 3GPP 표준 5QI 기반. default는 동영상(스트리밍).
//   urllc: delay-critical GBR(5QI 82, PDB 10ms) — 혼잡/저SINR 시 패킷 폐기(PER↑).
//   iot:   NB-IoT/LTE-M 커버리지확장(CE) 프로파일(5QI 90 관례) — 심층 커버리지에서 반복↑·저속.
export type TrafficType = 'video' | 'voice' | 'realtime' | 'web' | 'file' | 'urllc' | 'iot'
export const TRAFFIC_TYPES: {
  key: TrafficType
  ko: string
  en: string
  zh: string
  fiveqi: number
  gbr: boolean
  demandMbps: number // 세션당 요구 대역폭 근사
  icon: string
  sst: number // 이 트래픽이 요구하는 슬라이스 SST
  ce?: boolean // NB-IoT/LTE-M 커버리지 확장(CE) 대상 — 심층 커버리지 반복 모델 적용
}[] = [
  { key: 'video', ko: '동영상 스트리밍', en: 'Video streaming', zh: '视频流', fiveqi: 8, gbr: false, demandMbps: 15, icon: '🎬', sst: 1 },
  { key: 'voice', ko: '음성 통화(VoNR)', en: 'Voice (VoNR)', zh: '语音通话(VoNR)', fiveqi: 1, gbr: true, demandMbps: 0.1, icon: '📞', sst: 1 },
  { key: 'realtime', ko: '실시간 서비스(게임/화상)', en: 'Real-time (game/AR)', zh: '实时业务(游戏/视频)', fiveqi: 3, gbr: true, demandMbps: 5, icon: '🎮', sst: 2 },
  { key: 'urllc', ko: 'URLLC(산업제어)', en: 'URLLC (industrial)', zh: 'URLLC(工业控制)', fiveqi: 82, gbr: true, demandMbps: 2, icon: '🤖', sst: 2 },
  { key: 'web', ko: '웹/브라우징', en: 'Web browsing', zh: '网页浏览', fiveqi: 9, gbr: false, demandMbps: 3, icon: '🌐', sst: 1 },
  { key: 'file', ko: '파일 다운로드', en: 'File download', zh: '文件下载', fiveqi: 9, gbr: false, demandMbps: 50, icon: '📥', sst: 1 },
  { key: 'iot', ko: 'NB-IoT/LTE-M(CE)', en: 'NB-IoT/LTE-M (CE)', zh: 'NB-IoT/LTE-M(CE)', fiveqi: 90, gbr: false, demandMbps: 0.05, icon: '📟', sst: 3, ce: true },
]
export function trafficInfo(t: TrafficType) {
  return TRAFFIC_TYPES.find((x) => x.key === t) ?? TRAFFIC_TYPES[0]
}

// NF 파드 1개당 용량 (K8s 리소스 모델) — 부하율 = 사용량 / (파드당 용량 × replicas)
// 부하 >80% HPA 스케일아웃, >100% 신규 수용 거부, >95% 지속 시 다운(OOMKilled)
// 기본값은 상용 스펙 참조(UPF 소규모 8코어=2Gbps~파드급 수Gbps, AMF 인스턴스 1천~100만 등록).
// NF별로 파드당 용량을 직접 수정 가능 (capacity_per_pod).
export const NF_CAPACITY_PER_POD: Partial<Record<NfType, { metric: string; value: number }>> = {
  AMF: { metric: 'UE', value: 10000 }, // 등록 UE/pod
  SMF: { metric: 'session', value: 10000 }, // PDU 세션/pod
  UPF: { metric: 'Mbps', value: UPF_CAPACITY_PER_POD_MBPS }, // 처리량/pod
}

export const HPA_THRESHOLD = 0.8
export const CRASH_THRESHOLD = 0.95
export const CRASH_SUSTAIN_TICKS = 10 // 1초 틱 기준 지속 시간

export interface GnbParams {
  radio_tech: 'lte' | 'nr' // 4G LTE(eNB) / 5G NR(gNB)
  band_class: 'low' | 'mid' | 'high' // NR 밴드: low(sub-1G)/mid(FR1)/high(FR2 mmWave·빔포밍)
  ru_type: 'active' | 'passive' // active=안테나 일체형 / passive=외장 안테나 필요
  mount: 'pole' | 'ceiling' | 'wall' // 설치: 봉거치 / 천장형(소형셀) / 벽면
  max_ue: number // 셀 최대 RRC 접속 UE 수 (용량 초과 시 신규 접속 거부)
  pci: number // Physical Cell ID (0~1007) — 단말 서비스모드/측정에 표시
  tac: number // Tracking Area Code
  scs_khz: ScsKhz // Subcarrier Spacing (FR1: 15/30/60, FR2: 60/120)
  cio_db: number // 이 셀의 Cell Individual Offset (핸드오버 판정에 가산)
  // 이동성(A3 이벤트) — RU별 개별 설정 (Core 패널 '이동성 일괄 설정'으로 일괄 적용 가능)
  a3_offset_db?: number // A3: 이웃>서빙+offset 시 HO
  hysteresis_db?: number // 히스테리시스
  ttt_ms?: number // TimeToTrigger
  tdd_dl_ratio: number // TDD DL 비율 0~1 (나머지 UL) — 처리량 방향 배분
  drx: boolean // DRX(단속수신) — 배터리 절약, 페이징 지연 트레이드오프
  // PRACH / UL 전력 제어 (접속 성공률·UL 커버리지)
  prach_power_dbm: number // preambleInitialReceivedTargetPower
  prach_ramp_step_db: number // powerRampingStep
  prach_max_tx: number // preambleTransMax (최대 재시도)
  p0_nominal_dbm: number // PUSCH P0-nominal
  alpha: number // 경로손실 보상 계수 (0~1)
  freq_mhz: number
  tx_power_dbm: number
  bandwidth_mhz: number
  height: number
  antenna: 'omni' | 'sector' | 'beam' // beam = Massive MIMO 빔포밍 (하이밴드 권장)
  azimuth_deg: number
  tilt_deg: number
  gain_dbi: number
  beamwidth_deg: number // 빔포밍 빔폭 (HPBW)
  beam_tracking: boolean // 걷기 모드에서 UE 추적 빔
  enabled: boolean
  // RAN Feature 토글 (통신사 상용 기능 모델링)
  ca_enabled: boolean // 캐리어 어그리게이션 — 유효 대역폭 2배
  qam256: boolean // 256QAM — 스펙트럼 효율 상한 5.55→7.4 bps/Hz
  mimo4x4: boolean // 4x4 MIMO — 공간 레이어 2→4
  energy_saving: boolean // 에너지 세이빙 — 송신출력 -6dB (저부하 절전)
  // PDCP 복제(PDCP duplication) / 이중연결 기반 중복 PDU 세션 — URLLC 신뢰성(다이버시티).
  // delay-critical/URLLC 트래픽의 패킷 손실을 약 절반으로 (독립 경로 다이버시티). TS 38.323/23.501.
  pdcp_duplication: boolean
  du_id?: string // 이 RU가 프론트홀로 연결된 DU (RanUnit.id)
}

// NR 주파수 레인지 (3GPP TS 38.104). FR1=sub-6GHz, FR2=mmWave.
export type Fr = 'FR1' | 'FR2'
export type ScsKhz = 15 | 30 | 60 | 120

// band_class → FR: low(sub-1G)/mid(FR1 3.5G)=FR1, high(mmWave)=FR2
export function frOfBandClass(bandClass: 'low' | 'mid' | 'high'): Fr {
  return bandClass === 'high' ? 'FR2' : 'FR1'
}

// 실제 NR 밴드 번호 → FR (n257~n262 = FR2 mmWave, 그 외 = FR1). 밴드 문자열/번호 모두 지원.
export function frOfBand(band: string | number): Fr {
  const n = typeof band === 'number' ? band : parseInt(String(band).replace(/^n/i, ''), 10)
  return n >= 257 && n <= 262 ? 'FR2' : 'FR1'
}

// 실제 캐리어 주파수(MHz) → FR. FR2(mmWave)는 24250 MHz(24.25GHz) 이상. FR/SCS 판정의 실질 기준.
export function frOfFreq(mhz: number): Fr {
  return mhz >= 24250 ? 'FR2' : 'FR1'
}

// 주파수(MHz) → band_class(low/mid/high) 동기화용.
export function bandClassOfFreq(mhz: number): 'low' | 'mid' | 'high' {
  if (mhz >= 24250) return 'high'
  if (mhz < 1000) return 'low'
  return 'mid'
}

// FR별 유효 SCS (3GPP): FR1 = 15/30/60 (SSB 15/30, 데이터 15/30/60),
// FR2 = 60/120 (SSB 120/240, 데이터 60/120). (FR2-2 480/960은 Rel-17 옵션이라 실사용 집합에서 제외.)
export const VALID_SCS: Record<Fr, ScsKhz[]> = {
  FR1: [15, 30, 60],
  FR2: [60, 120],
}
export function validScsForFr(fr: Fr): ScsKhz[] {
  return VALID_SCS[fr]
}

// FR별 기본 SCS — 밴드 변경으로 현재 SCS가 무효가 될 때 스냅할 대상 (FR1→30, FR2→120).
export const DEFAULT_SCS: Record<Fr, ScsKhz> = { FR1: 30, FR2: 120 }
export function defaultScsForFr(fr: Fr): ScsKhz {
  return DEFAULT_SCS[fr]
}

// 현재 SCS가 해당 FR에서 유효하면 그대로, 아니면 FR 기본값으로 스냅.
export function snapScsToFr(fr: Fr, scs: ScsKhz): ScsKhz {
  return VALID_SCS[fr].includes(scs) ? scs : DEFAULT_SCS[fr]
}

// MMTEL 부가서비스 (TS 24.6xx, IMS AS/TAS가 iFC로 트리거) — UE별 상호작용 토글.
//   ocb: 발신 통신 차단(BAOC/OCB)   icb: 착신 통신 차단(BAIC/ICB)
//   cw:  통화 중 대기(Call Waiting) icb 대신 2호 수신 허용
//   oir: 발신자 번호 표시 제한(OIR/CLIR, 프라이버시)
//   cfu/cfb/cfnr/cfnrc: 착신전환(무조건/통화중/무응답/도달불가) — cfTarget으로 재라우팅
export interface SuppServices {
  ocb?: boolean
  icb?: boolean
  cw?: boolean
  oir?: boolean
  cfu?: boolean
  cfb?: boolean
  cfnr?: boolean
  cfnrc?: boolean
  cfTarget?: string // 착신전환 대상 person id
}

export interface SceneObject {
  id: string
  kind: ObjKind
  name: string
  position: [number, number, number] // x, y(바닥=0), z — 미터
  rotation_deg: number
  size?: [number, number, number] // 벽/파티션 크기 오버라이드
  gnb?: GnbParams
  zone?: Zone // 미지정 시 'A'
  link_ru?: string // (antenna 전용) 연결된 passive RU의 id
  ant_height?: number // (antenna 전용) 설치 높이
  cable?: CableType // (antenna 전용) 급전선 종류
  ueShell?: 'agent' | 'machine' // (person 전용) UE 껍데기: 측정요원 사람 / 고정 UE 기계
}

// UE 가입자 식별자 (3GPP TS 23.003)
// SUPI = imsi-<MCC><MNC><MSIN>. 전송 시 SUCI로 은닉:
//   suci-0-<MCC>-<MNC>-<라우팅지시자>-<보호스킴>-<HN키ID>-<스킴출력>
//   null-scheme(0): MSIN 평문 / Profile A(1): ECIES 은닉 (Phase 3에서 실제 ECIES)
export interface UeSim {
  mcc: string
  mnc: string
  msin: string
  routing: string
  scheme: 'null' | 'profileA'
}

export const DEFAULT_UE_SIM: UeSim = {
  mcc: '999', // 3GPP 테스트 PLMN (실 오퍼레이터 아님)
  mnc: '70',
  msin: '0000000001',
  routing: '0000',
  scheme: 'profileA',
}

export function supiOf(sim: UeSim): string {
  return `imsi-${sim.mcc}${sim.mnc}${sim.msin}`
}

// 전역 SIM 기준 기본 IMSI (mcc+mnc+msin)
export function defaultImsi(sim: UeSim): string {
  return `${sim.mcc}${sim.mnc}${sim.msin}`
}

// SIM의 MSIN을 n만큼 증가시킨 IMSI — UE(측정요원)마다 고유 IMSI를 부여하기 위한 헬퍼.
// MSIN 자릿수를 유지(zero-pad, 오버플로 시 하위 자리만)해 defaultImsi와 동일 포맷을 보장.
// n=0 이면 defaultImsi(sim)와 동일하다.
export function imsiWithMsin(sim: UeSim, n: number): string {
  const len = sim.msin.length
  const base = Number.parseInt(sim.msin, 10)
  const val = (Number.isFinite(base) ? base : 0) + n
  // 자릿수 유지(zero-pad)하되 오버플로 시 상위 자리를 잘라내지 않는다 —
  // slice로 하위 자리만 남기면 base+n이 len 자릿수를 넘을 때 값이 겹쳐 IMSI 유일성이 깨진다.
  const msin = String(val).padStart(len, '0')
  return `${sim.mcc}${sim.mnc}${msin}`
}

// IMSI가 이 망에 프로비저닝(가입)된 가입자인지 (UDM/UDR 가입자 프로비저닝 조회).
// 기본 가입자 = 현재 SIM의 IMSI(defaultImsi)는 항상 등록됨.
// 추가로 Core 설정에서 임의 IMSI를 registry(registeredImsis)로 프로비저닝하면 그것도 등록됨.
// → registry에도 없고 defaultImsi도 아니면 unknown subscriber → Registration Reject (#3 Illegal UE).
export function imsiRegistered(imsi: string, sim: UeSim, registry?: string[]): boolean {
  if (!/^\d{14,15}$/.test(imsi)) return false
  if (imsi === defaultImsi(sim)) return true
  return registry ? registry.includes(imsi) : false
}

// Requested NSSAI(UE) vs 구성된 슬라이스(NSSF 판정) → Allowed / Rejected NSSAI.
// AMF는 UE의 Requested NSSAI를 NSSF에 질의, NSSF가 zone에 프로비저닝된 S-NSSAI만 허용한다.
export function computeAllowedNssai(
  slices: Slice[],
  zone: Zone,
  requestedSst: number[],
): { allowed: number[]; rejected: number[] } {
  const provisioned = new Set(slices.filter((s) => s.zone === zone).map((s) => s.sst))
  const allowed = requestedSst.filter((s) => provisioned.has(s))
  const rejected = requestedSst.filter((s) => !provisioned.has(s))
  return { allowed, rejected }
}

// Profile A 은닉 출력 시뮬레이션 — 실제 ECIES(X25519+AES)는 Phase 3 UERANSIM이 수행.
// 여기서는 결정적 의사-암호문으로 "평문이 보이지 않는다"는 성질만 재현한다.
function pseudoConceal(msin: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < msin.length; i++) {
    h ^= msin.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let out = ''
  for (let i = 0; i < msin.length; i++) {
    h = Math.imul(h ^ msin.charCodeAt(i), 0x01000193) >>> 0
    out += (h % 256).toString(16).padStart(2, '0')
  }
  return out
}

export function suciOf(sim: UeSim): string {
  if (sim.scheme === 'null') {
    return `suci-0-${sim.mcc}-${sim.mnc}-${sim.routing}-0-0-${sim.msin}`
  }
  return `suci-0-${sim.mcc}-${sim.mnc}-${sim.routing}-1-1-${pseudoConceal(sim.msin)}`
}

// passive RU에 연결된 외장 안테나 찾기 (같은 존)
export function findAntennaFor(
  ru: SceneObject,
  objects: SceneObject[],
): SceneObject | undefined {
  return objects.find(
    (o) =>
      (o.kind === 'antenna' || o.kind === 'antceiling' || o.kind === 'antwall') &&
      o.link_ru === ru.id &&
      objZone(o) === objZone(ru),
  )
}

// RU의 실제 방사점: active=RU 자신 / passive=연결 안테나 (없으면 null=무방사)
export function getRadiator(
  ru: SceneObject,
  objects: SceneObject[],
): {
  x: number
  z: number
  height: number
  rotation_deg: number
  feeder_len: number
  cable: CableType
} | null {
  const g = ru.gnb!
  if (g.ru_type !== 'passive') {
    return {
      x: ru.position[0], z: ru.position[2], height: g.height,
      rotation_deg: ru.rotation_deg, feeder_len: 0, cable: 'half',
    }
  }
  const ant = findAntennaFor(ru, objects)
  if (!ant) return null
  const ah = ant.ant_height ?? 4
  const dx = ant.position[0] - ru.position[0]
  const dz = ant.position[2] - ru.position[2]
  const dy = ah - 1.0 // RU 유닛 높이(~1m)에서 안테나까지
  const len = Math.sqrt(dx * dx + dz * dz + dy * dy) + 1.0 // 여유분
  return {
    x: ant.position[0], z: ant.position[2], height: ah,
    rotation_deg: ant.rotation_deg, feeder_len: len, cable: ant.cable ?? 'half',
  }
}

export function objZone(o: SceneObject): Zone {
  return o.zone ?? 'A'
}

// E2E 성립 판정 (존별): 실물 RU + 논리 Core(AMF/SMF/UPF 가동) + DN 연결
export function computeE2E(
  allObjects: SceneObject[],
  coreNfs: CoreNf[],
  coreDn: Record<Zone, boolean>,
  zone: Zone,
  siteDown: SiteDown = NO_SITE_DOWN,
  ranUnits: RanUnit[] = [],
): { ok: boolean; missing: string[]; empty: boolean } {
  const objects = allObjects.filter((o) => objZone(o) === zone)
  const nfs = coreNfs.filter((n) => n.zone === zone)
  const missing: string[] = []
  // RU: 송출 중 + (active 또는 안테나 연결된 passive) + RU→DU→CU→AMF/UPF 사슬 성립
  // (ranUnits가 [] 이거나 이 존에 RAN 유닛이 없으면 ranChainOk가 통과 → 레거시 동작 보존)
  if (
    !objects.some(
      (o) =>
        o.kind === 'gnb' &&
        o.gnb?.enabled !== false &&
        getRadiator(o, allObjects) !== null &&
        ranChainOk(o, allObjects, ranUnits, coreNfs, siteDown).ok,
    )
  )
    missing.push('RU')
  // 등록(AMF+인증 AUSF/UDM) + 세션(SMF/UPF) — 가용 인스턴스(사이트 정상) 기준 NRF 선택
  for (const t of ['AMF', 'AUSF', 'UDM', 'SMF', 'UPF'] as const) {
    if (!activeNf(coreNfs, zone, t, siteDown)) missing.push(t)
  }
  if (!coreDn[zone]) missing.push('DN')
  return {
    ok: missing.length === 0,
    missing,
    empty: objects.length === 0 && nfs.length === 0 && !coreDn[zone],
  }
}

// VoNR 판정: 데이터 세션(E2E) + IMS 코어(P/I/S-CSCF) 필요. IMS-AS/MGW는 부가.
export function computeIms(
  coreNfs: CoreNf[],
  zone: Zone,
  siteDown: SiteDown = NO_SITE_DOWN,
): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  for (const t of ['P-CSCF', 'I-CSCF', 'S-CSCF'] as const) {
    if (!activeNf(coreNfs, zone, t, siteDown)) missing.push(t)
  }
  return { ok: missing.length === 0, missing }
}

// 통화 성립 판정: 양쪽 UE가 각 존에서 데이터+IMS 등록 가능해야 하고,
// 국가 간이면 양쪽 IMS가 IPX(로밍 SIP 트렁크, SEPP로 근사) 연결되어야 함.
export function computeCall(
  allObjects: SceneObject[],
  coreNfs: CoreNf[],
  coreDn: Record<Zone, boolean>,
  fromZone: Zone,
  toZone: Zone,
  siteDown: SiteDown = NO_SITE_DOWN,
  ranUnits: RanUnit[] = [],
): { ok: boolean; missing: string[]; interPlmn: boolean } {
  const missing: string[] = []
  for (const z of new Set([fromZone, toZone])) {
    const e2e = computeE2E(allObjects, coreNfs, coreDn, z, siteDown, ranUnits)
    if (!e2e.ok) missing.push(...e2e.missing.map((m) => `${m}(${z})`))
    const ims = computeIms(coreNfs, z, siteDown)
    if (!ims.ok) missing.push(...ims.missing.map((m) => `${m}(${z})`))
  }
  const interPlmn = fromZone !== toZone
  if (interPlmn) {
    // 국가 간: 양쪽 SEPP(IPX 트렁크 근사)
    for (const z of [fromZone, toZone]) {
      if (!activeNf(coreNfs, z, 'SEPP', siteDown)) missing.push(`SEPP(${z})`)
    }
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)], interPlmn }
}

// 로밍 판정: VPLMN에서 트래픽을 쓰려면 양쪽 SEPP(N32) + HPLMN UPF/DN(홈 라우팅) 필요
export function computeRoamingPath(
  allObjects: SceneObject[],
  coreNfs: CoreNf[],
  coreDn: Record<Zone, boolean>,
  visited: Zone,
  home: Zone,
  siteDown: SiteDown = NO_SITE_DOWN,
): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (
    !allObjects.some(
      (o) => objZone(o) === visited && o.kind === 'gnb' && o.gnb?.enabled !== false,
    )
  )
    missing.push(`RU(${visited})`)
  for (const t of ['AMF', 'SMF', 'UPF', 'SEPP'] as const) {
    if (!activeNf(coreNfs, visited, t, siteDown)) missing.push(`${t}(${visited})`)
  }
  // 홈 라우팅(HR): 홈 SEPP + 홈 인증(AUSF/UDM) + 홈 세션제어(H-SMF, N16) + 홈 사용자평면(UPF/DN)
  // H-SMF가 없으면 V-SMF의 N16 Create가 실패 → HR PDU 수립 불가(5GSM #38 network failure).
  for (const t of ['SEPP', 'AUSF', 'UDM', 'SMF', 'UPF'] as const) {
    if (!activeNf(coreNfs, home, t, siteDown)) missing.push(`${t}(${home})`)
  }
  if (!coreDn[home]) missing.push(`DN(${home})`)
  return { ok: missing.length === 0, missing }
}

export interface SpaceConfig {
  width: number
  depth: number
  height: number
}

export interface SimResult {
  nx: number
  ny: number
  nz: number
  cell: [number, number, number]
  rsrp: Float32Array
  sinr: Float32Array
  serving: Float32Array // 복셀별 서빙 셀 인덱스 (셀별 오라 색용)
  gnbIds: string[] // 서빙 인덱스 → gNB id 매핑
  rsrpMin: number
  rsrpMax: number
}

// 존 내 활성 RU의 셀 인덱스(서빙 인덱스와 동일 순서) → 셀 색 매핑용
export function enabledGnbIndex(ru: SceneObject, objects: SceneObject[]): number {
  const zone = objZone(ru)
  const list = objects.filter(
    (o) => o.kind === 'gnb' && o.gnb?.enabled !== false && objZone(o) === zone,
  )
  return list.findIndex((o) => o.id === ru.id)
}

export interface ProbeCell {
  id: string
  name: string
  rsrp_dbm: number
  freq_mhz: number
}

export interface ProbeResult {
  cells: ProbeCell[]
  serving: string | null
  serving_name?: string
  rsrp_dbm?: number
  sinr_db?: number
  rsrq_db?: number
  cqi?: number
  est_throughput_mbps?: number
  nr_arfcn?: number
  band?: string
  bandwidth_mhz?: number
  // 서비스모드 확장 항목
  pci?: number
  tac?: number
  scs_khz?: number
  rssi_dbm?: number
  ri?: number
  ssb_idx?: number
  cell_id?: string
  agc_active?: boolean // UE AGC 오버로드 방지 동작 중 (RSRP > -45 → 감쇠)
  ul_sinr_db?: number
  rach_ok?: boolean // PRACH 접속 성공 여부
  rach_attempts?: number // 접속에 걸린 preamble 재시도(또는 CE 레벨 에스컬레이션) 횟수
  // PRACH 경합/충돌(CBRA) — 부하 기반 (physics.py _rach_contention)
  rach_contenders?: number // 동시 경합 UE 수(부하 환산)
  rach_collision_prob?: number // preamble 충돌확률
  rach_access_prob?: number // preambleTransMax 내 접속 성공확률
  rach_access_delay_ms?: number // 접속 지연(재시도·백오프 포함)
  two_step_rach?: boolean // 2-step CBRA(FR2) 사용
  msgA_fallback?: boolean // MsgA PUSCH 복조 실패 → 4-step 폴백
  ra_type?: string // '4-step' | '2-step' | '2-step→4-step'
  // NB-IoT/LTE-M 커버리지 확장(CE) 사다리 (physics.py _ce_ladder)
  coupling_loss_db?: number
  ce_level?: number // 0/1/2
  ce_mode?: string // 'none' | 'A' | 'B'
  ce_repetitions?: number // 데이터 반복수 (≤2048)
  ce_nprach_reps?: number // NPRACH 반복수 (≤128)
  ce_in_coverage?: boolean // CE 최대에서도 MCL 미달이면 false → RACH 실패
  mcl_db?: number // 최대 커플링 손실(현재 커플링 손실)
  // QoS 스케줄러 지표 (5QI + 혼잡 기반)
  latency_ms?: number
  packet_loss_pct?: number
  jitter_ms?: number
  pdb_ms?: number // Packet Delay Budget
  over_pdb?: boolean // 지연이 예산 초과 (품질 저하)
  delay_critical?: boolean // delay-critical GBR(5QI 82/83/84/85)
  mdbv_bytes?: number | null // Maximum Data Burst Volume
  mdbv_exceeded?: boolean // MDBV 초과분 폐기
  dropped_over_pdb?: boolean // PDB 초과로 패킷 폐기(재전송 여유 없음)
  pdcp_duplication?: boolean // PDCP 복제/중복 PDU 세션 활성 → 다이버시티로 손실 ~절반
}

export interface CatalogEntry {
  label: string
  size: [number, number, number]
  material?: MaterialKind
  resizable?: boolean
}

export const CATALOG: Record<ObjKind, CatalogEntry> = {
  gnb: { label: '기지국 (RU)', size: [0.3, 2.5, 0.3] },
  wall: { label: '콘크리트 벽', size: [4, 3, 0.2], material: 'concrete', resizable: true },
  glasswall: { label: '유리 파티션', size: [3, 2.2, 0.06], material: 'glass', resizable: true },
  pillar: { label: '콘크리트 기둥', size: [0.5, 3, 0.5], material: 'concrete', resizable: true },
  door: { label: '문 (목재)', size: [0.9, 2.1, 0.1], material: 'wood', resizable: true },
  desk: { label: '책상 (목재)', size: [1.4, 0.75, 0.7], material: 'wood' },
  table: { label: '테이블', size: [1.2, 0.75, 1.2], material: 'wood' },
  chair: { label: '의자', size: [0.5, 0.9, 0.5], material: 'wood' },
  cabinet: { label: '금속 캐비닛', size: [0.9, 1.8, 0.45], material: 'metal' },
  shelf: { label: '금속 선반', size: [1.0, 2.0, 0.4], material: 'metal', resizable: true },
  sofa: { label: '소파', size: [1.9, 0.8, 0.85], material: 'wood' },
  machine: { label: '생산 기계', size: [1.6, 1.7, 1.1], material: 'metal', resizable: true },
  plant: { label: '화분/식물', size: [0.5, 1.3, 0.5], material: 'wood' },
  person: { label: '측정 요원 (UE)', size: [0.5, 1.7, 0.4] },
  antenna: { label: '스탠드형 외장 안테나', size: [0.35, 0.8, 0.2] },
  antceiling: { label: '천장형 외장 안테나', size: [0.4, 0.5, 0.4] },
  antwall: { label: '벽면형 외장 안테나', size: [0.3, 0.7, 0.25] },
  fixedue: { label: '고정 UE (기계)', size: [1.0, 1.5, 0.8] },
}

// RAN 아키텍처 (존별 논리 구성) — DU/CU는 실물 배치 없이 구성만 선택
export type RanArch = 'gnb' | 'cu-du' // 일체형 gNB / CU-DU 분리(F1)

// RAN 논리 유닛 (CU/DU) — 실물 없이 논리 구성. RU(gnb SceneObject)는 프론트홀로 DU에 연결.
//   CU: RRC/PDCP 종단 (중앙집중). DU: RLC/MAC/PHY-High, F1(CU-DU) 인터페이스로 CU에 연결.
//   RU(gnb)는 gnb.du_id로 소속 DU를 참조 (프론트홀 eCPRI/F1 근사).
export type RanUnitKind = 'cu' | 'du'
export interface RanUnit {
  id: string
  kind: RanUnitKind
  name: string
  zone: Zone
  enabled: boolean
  cu_id?: string // (DU만) 소속 CU
  f1_latency_ms?: number // (DU) F1(CU-DU) 지연 ms
  max_cells?: number // (DU) 수용 셀(RU) 수 상한
  amf_id?: string // (CU만) N2/NGAP 종단 AMF (CoreNf.id) — CU-CP↔AMF
  upf_id?: string // (CU만) N3/GTP-U 종단 UPF (CoreNf.id) — CU-UP↔UPF
}

// RAN 경로 성립 판정: RU→(프론트홀)→DU→(F1)→CU→(N2)→AMF & CU→(N3)→UPF 사슬이 모두 가동해야 함.
// 존에 RAN 유닛이 하나도 없으면 레거시/단순 모드로 간주해 통과(ok)시킨다(하위호환).
export function ranChainOk(
  ru: SceneObject, objects: SceneObject[], ranUnits: RanUnit[],
  coreNfs: CoreNf[], siteDown: SiteDown = NO_SITE_DOWN,
): { ok: boolean; reason: string } {
  if (ru.kind !== 'gnb' || !ru.gnb) return { ok: false, reason: 'RU-off' }
  if (ru.gnb.enabled === false) return { ok: false, reason: 'RU-off' }
  if (!getRadiator(ru, objects)) return { ok: false, reason: 'no-antenna' }
  const zone = objZone(ru)
  const zoneRan = ranUnits.filter((u) => u.zone === zone)
  if (zoneRan.length === 0) return { ok: true, reason: '' } // 레거시/단순 모드: 이 존에 RAN 유닛 미정의 → 통과
  const du = ru.gnb.du_id ? ranUnits.find((u) => u.id === ru.gnb!.du_id && u.kind === 'du') : undefined
  if (!ru.gnb.du_id) return { ok: false, reason: 'no-DU' }
  if (!du) return { ok: false, reason: 'DU-missing' }
  if (!du.enabled) return { ok: false, reason: 'DU-down' }
  const cu = du.cu_id ? ranUnits.find((u) => u.id === du.cu_id && u.kind === 'cu') : undefined
  if (!du.cu_id) return { ok: false, reason: 'no-CU' }
  if (!cu) return { ok: false, reason: 'CU-missing' }
  if (!cu.enabled) return { ok: false, reason: 'CU-down' }
  const amf = cu.amf_id ? coreNfs.find((n) => n.id === cu.amf_id && n.nf_type === 'AMF' && nfUp(n, siteDown)) : undefined
  if (!cu.amf_id) return { ok: false, reason: 'no-AMF' }
  if (!amf) return { ok: false, reason: 'AMF-down' }
  const upf = cu.upf_id ? coreNfs.find((n) => n.id === cu.upf_id && n.nf_type === 'UPF' && nfUp(n, siteDown)) : undefined
  if (!cu.upf_id) return { ok: false, reason: 'no-UPF' }
  if (!upf) return { ok: false, reason: 'UPF-down' }
  return { ok: true, reason: '' }
}

// RAN 경로 실패 사유 → 3개국어 짧은 설명. reason 코드는 ranChainOk가 내보내는 것 전부 포함.
export function ranChainText(reason: string, lang: 'ko' | 'en' | 'zh'): string {
  const M: Record<string, [string, string, string]> = {
    'RU-off': ['RU 미방사/비활성', 'RU not radiating / disabled', 'RU 未辐射/已禁用'],
    'no-antenna': ['RU 미방사/비활성(안테나 없음)', 'RU not radiating (no antenna)', 'RU 未辐射(无天线)'],
    'no-DU': ['RU가 DU에 미연결(프론트홀 없음)', 'RU not linked to a DU (no fronthaul)', 'RU未连接DU(无前传)'],
    'DU-missing': ['소속 DU 없음(프론트홀 끊김)', 'Assigned DU missing (fronthaul broken)', '所属DU缺失(前传中断)'],
    'DU-down': ['DU 비활성', 'DU disabled', 'DU 已禁用'],
    'no-CU': ['DU가 CU에 미연결(F1 없음)', 'DU not linked to a CU (no F1)', 'DU未连接CU(无F1)'],
    'CU-missing': ['소속 CU 없음(F1 끊김)', 'Assigned CU missing (F1 broken)', '所属CU缺失(F1中断)'],
    'CU-down': ['CU 비활성', 'CU disabled', 'CU 已禁用'],
    'no-AMF': ['CU가 AMF에 미연결(N2 없음)', 'CU not linked to an AMF (no N2)', 'CU未连接AMF(无N2)'],
    'AMF-down': ['AMF 비활성/사이트다운', 'AMF disabled / site down', 'AMF 已禁用/站点故障'],
    'no-UPF': ['CU가 UPF에 미연결(N3 없음)', 'CU not linked to a UPF (no N3)', 'CU未连接UPF(无N3)'],
    'UPF-down': ['UPF 비활성/사이트다운', 'UPF disabled / site down', 'UPF 已禁用/站点故障'],
  }
  const e = M[reason] ?? ['RAN 경로 불량', 'RAN path broken', 'RAN 路径异常']
  return lang === 'ko' ? e[0] : lang === 'zh' ? e[2] : e[1]
}

// RF 급전선 케이블 — 감쇠는 √f 스케일링 (기준: dB/100m @1GHz, 실측 스펙 기반)
export const CABLE_TYPES = {
  jumper: { label: '점퍼 (LMR-400급)', db100m_1ghz: 12.8 },
  half: { label: '피더 1/2″ (LDF4급)', db100m_1ghz: 4.4 },
  seven8: { label: '피더 7/8″ (LDF5급)', db100m_1ghz: 2.4 },
} as const
export type CableType = keyof typeof CABLE_TYPES
const CONNECTOR_LOSS_DB = 0.5 // 커넥터 2개소

export function feederLossDb(lengthM: number, freqMhz: number, cable: CableType): number {
  const alpha = CABLE_TYPES[cable].db100m_1ghz * Math.sqrt(freqMhz / 1000)
  return (alpha * lengthM) / 100 + CONNECTOR_LOSS_DB
}

// 논리 Core NF — 실물 배치 없이 존(국가)만 선택
export interface CoreNf extends NfParams {
  id: string
  nf_type: NfType
  name: string
  zone: Zone
}

export const DEFAULT_GNB: GnbParams = {
  radio_tech: 'nr',
  band_class: 'mid',
  ru_type: 'active',
  mount: 'pole',
  max_ue: 128, // 실내 스몰셀 현실치 (매크로 셀은 ~1000-1200 RRC connected)
  pci: 1,
  tac: 1,
  scs_khz: 30,
  cio_db: 0,
  a3_offset_db: 3,
  hysteresis_db: 1,
  ttt_ms: 320,
  tdd_dl_ratio: 0.75,
  drx: false,
  prach_power_dbm: -104,
  prach_ramp_step_db: 2,
  prach_max_tx: 10,
  p0_nominal_dbm: -90,
  alpha: 0.8,
  freq_mhz: 3500,
  tx_power_dbm: 23, // 실내 스몰셀 전형값 — 넓은 공간에서 음영/경계가 보이도록
  bandwidth_mhz: 100,
  height: 4.0,
  antenna: 'sector', // 실제 RU는 지향성 — 바라보는 방향(회전)으로 방사
  azimuth_deg: 0, // RU가 향한 방향 기준 오프셋
  tilt_deg: 5,
  gain_dbi: 8,
  beamwidth_deg: 10,
  beam_tracking: true,
  enabled: true,
  ca_enabled: false,
  qam256: true,
  mimo4x4: false,
  energy_saving: false,
  pdcp_duplication: false,
}

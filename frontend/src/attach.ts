// 단말 전원 ON 시 3GPP attach 절차를 실제 순서대로 재현하는 로그 시퀀스 생성.
// MIB/SIB 수신 → RACH(Msg1~4) → RRC Setup → NAS Registration → NF Discovery(NRF) →
// 5G-AKA 인증(AUSF/UDM/UDR) → Slice 선택(NSSF) → 정책(PCF, URSP) → Security Mode →
// Registration Accept → PDU Session Establishment(NRF/SMF/PCF/CHF/UPF) → DRB 설정 → ATTACHED.
// 로그 문구는 실제 스택(UERANSIM/Open5GS)·pcap과 동일하게 영문 3GPP 용어를 사용한다.
import type { LogLevel, LogSource } from './store'

// dir: 이 로그가 붙은 노드(NF/UE) 기준 메시지 방향. 'in'=수신(←), 'out'=송신(→).
export interface AttachStep {
  source: LogSource
  level: LogLevel
  node: string // 이 로그가 찍힌 노드 이름 (절차상세 노드 라벨과 일치)
  msg: string
  dir?: 'in' | 'out' // PART 12: 절차상세-로그 화살표(← 수신 / → 송신)
  // SECTION T: 콜플로우 추적 — 명시적 송신자/수신자 (who sends → who receives).
  from?: string // 이 메시지를 보낸 액터 (UE/gNB/AMF/AUSF/...)
  to?: string // 이 메시지를 받는 액터
}

// ════════ SECTION T: sender→receiver 추론 (UE 콜플로우 추적) ════════
// 노드(node)·방향(dir)·메시지(msg)로부터 명시적 from/to를 도출한다.
//  dir 'out' → node가 송신자(from), 화살표(→/←) 뒤 토큰이 수신자(to).
//  dir 'in'  → node가 수신자(to), 화살표 뒤 토큰이 송신자(from).
//  NAS(UE↔AMF) 메시지는 화살표가 없어도 상대편을 UE로 본다.
const TRACE_ACTORS = new Set([
  'UE', 'gNB', 'RU', 'DU', 'CU', 'AMF', 'SEAF', 'AUSF', 'UDM', 'UDR', 'NSSF',
  'SMF', 'UPF', 'PCF', 'CHF', 'BSF', 'NRF', 'SCP', 'SEPP', 'DN', 'LMF', 'GMLC',
  'NWDAF', 'MME', 'HSS', 'P-CSCF', 'I-CSCF', 'S-CSCF', 'IMS-AS', 'MGW', 'USIM',
  'PCCH', 'IPX', 'AF', 'NEF',
])
const NAS_HINT =
  /Registration|Service Request|Authentication|Security Mode|Deregistration|Configuration Update|Paging|Paged|USIM|MICO|NAS Service/i

function traceBaseActor(t: string): string {
  // 인스턴스 접미(-A1/-B2)·복수형(s)·경로(/SEAF) 제거해 기본 액터명 추출
  return t.replace(/\(s\)$/, '').replace(/\/.*$/, '').replace(/-[A-C]\d+$/, '')
}
function traceIsActor(t: string | undefined): t is string {
  if (!t) return false
  return TRACE_ACTORS.has(t) || TRACE_ACTORS.has(traceBaseActor(t))
}
function traceArrowTokens(msg: string, sym: '→' | '←'): string[] {
  const out: string[] = []
  let i = msg.indexOf(sym)
  while (i >= 0) {
    const rest = msg.slice(i + 1).trimStart()
    const m = /^([A-Za-z][\w/-]*)/.exec(rest)
    if (m) out.push(m[1].replace(/[.,:;)]+$/, ''))
    i = msg.indexOf(sym, i + 1)
  }
  return out
}
function traceSameActor(a: string, b: string): boolean {
  return a === b || traceBaseActor(a) === traceBaseActor(b)
}

// ════════ endpoints(): SAFE 폴백 전용 ════════
// 모든 빌더/emit 지점은 이제 명시적 from/to를 넘긴다(그게 진실의 원천). 이 함수는 from/to가
// 누락된 로그에 대한 안전한 폴백일 뿐이다. 규칙:
//  · 상대(peer)는 메시지 텍스트에서 오직 '실제 액터'(TRACE_ACTORS)로 확인될 때만 취한다 →
//    'MIB'/'SIB' 같은 메시지명이 액터로 새는 일을 원천 차단.
//  · from/to는 절대 undefined/"."가 되지 않는다. 상대를 못 찾으면 node 자신(내부 이벤트)으로 둔다.
export function endpoints(
  node: string | undefined,
  dir: 'in' | 'out' | undefined,
  msg: string,
): { from: string; to: string } {
  const self = node && node.length ? node : 'UE'
  const outs = traceArrowTokens(msg, '→').filter((t) => traceIsActor(t) && !traceSameActor(t, self))
  const ins = traceArrowTokens(msg, '←').filter((t) => traceIsActor(t) && !traceSameActor(t, self))
  const nas = NAS_HINT.test(msg) ? 'UE' : undefined
  // 상대 후보: 화살표로 확인된 실제 액터 → NAS 힌트 → (없으면) self (내부 이벤트로 안전 처리)
  const peer = outs[0] ?? ins[0] ?? nas ?? self
  if (dir === 'in') return { from: peer, to: self }
  return { from: self, to: peer }
}

export interface AttachCtx {
  ueName: string
  servingName: string | null // 서빙 RU 이름 (없으면 셀 탐색 실패)
  pci: number | null
  plmn: string // "mcc/mnc"
  tac: string
  ueIp: string
  amf: string | null
  ausf: string | null
  udm: string | null
  smf: string | null
  upf: string | null
  // PART 1: 절차에 관여하는 부가 NF (있으면 discovery/policy/slice 단계 로그 표시)
  nrf?: string | null
  nssf?: string | null
  pcf?: string | null
  udr?: string | null
  chf?: string | null
  bsf?: string | null
  dn: boolean
  zone: string
  imsiRegistered: boolean // false면 인증 단계에서 unknown subscriber로 등록 거부
  // PART 3: 슬라이스(S-NSSAI)
  requestedSst?: number[] // UE Requested NSSAI (SST 목록)
  allowedSst?: number[] // NSSF+AMF가 산출한 Allowed NSSAI (SST 목록)
  sliceSst?: number // PDU 세션에 사용할 S-NSSAI SST
  dnn?: string // Data Network Name (기본 internet)
  // SECTION A: 등록 종류 — initial(최초)/periodic(T3512 주기갱신)/mobility(TAI 변경 이동성갱신).
  // periodic: 기존 5G 보안컨텍스트 재사용, PDU 재수립 없음, T3512만 재시작.
  // mobility: Uplink-data-status/PDU-session-status/active-flag 로 PDU 세션 재활성.
  regType?: 'initial' | 'periodic' | 'mobility'
  mico?: boolean // Registration Accept에서 MICO 모드 협상 (MT 도달불가 트레이드오프)
  guti?: string // 재등록(periodic/mobility) 시 UE가 제시하는 5G-GUTI 표기
  // ── 접속(admission) 게이트 — 각 파라미터를 표준 3GPP 실패 원인에 매핑 ──
  cellBarred?: boolean // SIB1 cellBarred=barred (TS 38.331/38.304) → 캠핑 불가
  rsrpDbm?: number | null // 서빙 셀에서 측정한 UE RSRP (S-criteria 판정용, Qrxlevmeas)
  qRxLevMinDbm?: number // SIB1 cellSelectionInfo Qrxlevmin (TS 38.304 §5.2.3.2)
  amfCongested?: boolean // AMF max_registered_ue 초과 → Registration Reject #22 Congestion
  t3346Min?: number // #22 Congestion back-off 타이머 T3346 (분)
  t3512Min?: number // AMF 주기적 등록 갱신 타이머 T3512 (분, Registration Accept)
}

function sstLabel(ssts: number[] | undefined): string {
  if (!ssts || ssts.length === 0) return '—'
  return ssts.map((s) => `SST=${s}`).join(', ')
}

export function buildAttachSteps(ctx: AttachCtx): AttachStep[] {
  const S: AttachStep[] = []
  const ue = ctx.ueName
  const ru = ctx.servingName
  const dnn = ctx.dnn ?? 'internet'
  const reqSst = ctx.requestedSst ?? [1]
  // SECTION T: from/to를 메시지 텍스트가 아니라 호출부에서 명시적으로 넘긴다 (3GPP 방향).
  const push = (
    source: LogSource,
    node: string,
    msg: string,
    from: string,
    to: string,
    level: LogLevel = 'info',
    dir?: 'in' | 'out',
  ) => S.push({ source, level, node, msg, dir, from, to })

  // ── 셀 탐색 / MIB·SIB ── (MIB/SIB1/SIB 브로드캐스트: from=RU(gNB) → to=UE)
  if (!ru) {
    push('UE', ue, 'Cell search: no suitable/acceptable cell found — out of service (RRC_IDLE)', ue, ue, 'warn', 'in')
    return S
  }
  push('UE', ue, `Cell search: PSS/SSS detected — PCI ${ctx.pci ?? '?'}`, ru, ue, 'info', 'in')
  push('UE', ue, 'PBCH decoded → MIB (SFN, subCarrierSpacingCommon, pdcch-ConfigSIB1)', ru, ue, 'info', 'in')
  push('RU', ru, 'Broadcast SIB1 (cellSelectionInfo, servingCellConfigCommon, ra-ConfigCommon)', ru, ue, 'info', 'out')
  // SIB1 cellBarred (TS 38.331/38.304): barred이면 이 셀에 캠핑 불가 → intra-freq reselection, 서비스 불가.
  const barred = ctx.cellBarred === true
  push('UE', ue, `SIB1 acquired → PLMN ${ctx.plmn}, TAC ${ctx.tac}, cellBarred=${barred ? 'barred' : 'notBarred'}`, ru, ue, barred ? 'warn' : 'info', 'in')
  if (barred) {
    push('UE', ue, 'cell barred (SIB1) — intra-freq reselection, no service (RRC_IDLE)', ru, ue, 'warn', 'in')
    return S
  }
  // S-criteria (TS 38.304 §5.2.3.2): Srxlev = Qrxlevmeas − Qrxlevmin. <0 이면 not suitable → 셀 선택 실패.
  if (ctx.rsrpDbm != null && ctx.qRxLevMinDbm != null) {
    const srxlev = ctx.rsrpDbm - ctx.qRxLevMinDbm
    if (srxlev < 0) {
      push('UE', ue, `S-criteria failed: Srxlev ${srxlev.toFixed(0)}dB (RSRP ${ctx.rsrpDbm.toFixed(0)}dBm − Qrxlevmin ${ctx.qRxLevMinDbm}dBm) < 0 — cell not suitable`, ru, ue, 'warn', 'in')
      push('UE', ue, 'Cell search: no suitable/acceptable cell found — out of service (RRC_IDLE)', ue, ue, 'warn', 'in')
      return S
    }
  }
  push('UE', ue, 'SIB2/SIB4 acquired (RACH-ConfigCommon, intra/inter-freq reselection)', ru, ue, 'info', 'in')

  // ── Random Access (Msg1~4) ── (Msg1/Msg3 UE→RU, Msg2/Msg4 RU→UE, Complete UE→RU)
  push('UE', ue, 'PRACH Msg1: preamble transmitted (RA-RNTI)', ue, ru, 'info', 'out')
  push('RU', ru, 'Msg2 RAR: Timing Advance + Temporary C-RNTI granted', ru, ue, 'info', 'out')
  push('UE', ue, 'Msg3: RRCSetupRequest (ue-Identity=random, establishmentCause=mo-Signalling)', ue, ru, 'info', 'out')
  push('RU', ru, 'Msg4: RRCSetup (SRB1, masterCellGroupConfig)', ru, ue, 'info', 'out')
  push('UE', ue, 'RRCSetupComplete (selectedPLMN, dedicatedNAS-Message: Registration Request)', ue, ru, 'info', 'out')

  // ── NGAP / NAS Registration ──
  if (!ctx.amf) {
    push('RU', ru, 'NGAP setup failed — no AMF reachable → RRC Release', ru, ue, 'error', 'in')
    return S
  }
  const amf = ctx.amf
  const regType = ctx.regType ?? 'initial'
  const guti = ctx.guti ?? '5G-GUTI'
  const t3512 = ctx.t3512Min ?? 54 // AMF 주기적 등록 갱신 타이머 (Registration Accept가 운반)
  // NGAP Initial UE Message: gNB→AMF. NAS Registration Request: UE→AMF (RRC로 gNB 경유).
  push('RU', ru, 'NGAP InitialUEMessage → AMF (RAN-UE-NGAP-ID, NAS-PDU)', ru, amf, 'info', 'out')
  // AMF admission (TS 24.501 §5.5.1 / §5.3.20, TS 23.501 §5.19.5): 등록 UE가 max_registered_ue 상한에
  // 도달하면 신규 등록을 혼잡으로 거부하고 back-off T3346을 부여 → UE는 T3346 만료까지 재시도 금지.
  if (ctx.amfCongested) {
    const t3346 = ctx.t3346Min ?? 12
    push('NF', amf, `Registration Reject (5GMM cause #22 congestion) — AMF at max_registered_ue; back-off timer T3346=${t3346} min → UE`, amf, ue, 'error', 'out')
    return S
  }
  if (regType === 'initial') {
    push('NF', amf, `Registration Request (SUCI, 5GS-registration-type=initial, Requested-NSSAI {${sstLabel(reqSst)}})`, ue, amf, 'info', 'in')
  } else if (regType === 'periodic') {
    // SECTION A: 주기 등록 갱신 — 기존 네이티브 5G 보안컨텍스트 재사용, PDU 재수립 없음.
    push('NF', amf, `Registration Request (${guti}, 5GS-registration-type=periodic-registration-updating)`, ue, amf, 'info', 'in')
    push('NF', amf, 'NAS integrity verified with existing native 5G security context (no re-authentication)', amf, amf, 'info', 'in')
    push('NF', amf, `Registration Accept (5G-GUTI retained, TAI-list, T3512=${t3512} min restarted) → UE`, amf, ue, 'info', 'out')
    push('UE', ue, 'Registration Complete — periodic update done (RM-REGISTERED, CM-IDLE, no PDU re-establishment)', ue, amf, 'info', 'out')
    return S
  } else {
    // SECTION A: 이동성 등록 갱신 — TAI 변경. PDU-session-status/active-flag 로 UP 재활성.
    push('NF', amf, `Registration Request (${guti}, 5GS-registration-type=mobility-registration-updating, Uplink-data-status, PDU-session-status, active-flag=1)`, ue, amf, 'info', 'in')
    push('NF', amf, 'NAS integrity verified with existing native 5G security context (no re-authentication)', amf, amf, 'info', 'in')
    if (ctx.smf) {
      push('NF', ctx.smf, 'Nsmf_PDUSession_UpdateSMContext ← AMF (active-flag → re-activate user plane)', amf, ctx.smf, 'info', 'in')
      if (ctx.upf) push('NF', ctx.upf, 'PFCP N4 Session Modification — FAR restored (forward), N3 DL tunnel re-armed', ctx.smf, ctx.upf, 'info', 'in')
    }
    push('RU', ru, 'NGAP InitialContextSetupRequest → gNB (re-establish DRB for PDU-session-status)', amf, ru, 'info', 'in')
    push('NF', amf, `Registration Accept (new TAI-list, Allowed-NSSAI {${sstLabel(ctx.allowedSst ?? reqSst)}}, PDU-session-reactivation-result) → UE`, amf, ue, 'info', 'out')
    push('UE', ue, 'Registration Complete — mobility update done (RM-REGISTERED, CM-CONNECTED, PDU sessions resumed)', ue, amf, 'info', 'out')
    return S
  }

  // ── NRF: AMF가 인증/데이터 NF 발견(NF discovery/selection) ── (요청 AMF→NRF, 응답 NRF→AMF)
  if (ctx.nrf) {
    push('NF', ctx.nrf, 'Nnrf_NFDiscovery Request ← AMF (target-nf-type=AUSF, requester=AMF)', amf, ctx.nrf, 'info', 'in')
    push('NF', ctx.nrf, 'Nnrf_NFDiscovery Response → AMF (AUSF/UDM NF-profile, priority, capacity)', ctx.nrf, amf, 'info', 'out')
  }

  // ── 5G-AKA 인증 (AUSF ↔ UDM ↔ UDR) ──
  if (!ctx.udm || !ctx.ausf) {
    push('NF', amf,
      `Authentication aborted — ${!ctx.udm ? 'UDM' : 'AUSF'} unavailable → Registration Reject (5GMM cause #22 congestion)`,
      amf, ue, 'error', 'out')
    return S
  }
  push('NF', ctx.ausf, 'Nausf_UEAuthentication_Authenticate ← AMF (SUCI, serving-network-name)', amf, ctx.ausf, 'info', 'in')
  push('NF', ctx.udm, 'Nudm_UEAuthentication_Get ← AUSF: SIDF de-conceals SUCI → SUPI', ctx.ausf, ctx.udm, 'info', 'in')
  if (ctx.udr) {
    push('NF', ctx.udr, 'Nudr_DM_Query ← UDM: authentication subscription (K, OPc, SQN, AMF)', ctx.udm, ctx.udr, 'info', 'in')
  }
  if (!ctx.imsiRegistered) {
    push('NF', ctx.udm,
      'subscriber not found (SUPI not provisioned in UDR) → Registration Reject (5GMM cause #3 Illegal UE)',
      ctx.udm, ctx.ausf, 'error', 'out')
    return S
  }
  push('NF', ctx.udm, 'UDM generated 5G HE AV (RAND, AUTN, XRES*, K_AUSF) → AUSF', ctx.udm, ctx.ausf, 'info', 'out')
  push('NF', ctx.ausf, 'AUSF stored HXRES*, derived K_SEAF; 5G SE AV (RAND, AUTN, HXRES*) → AMF/SEAF', ctx.ausf, amf, 'info', 'out')
  push('NF', amf, 'NAS Authentication Request (RAND, AUTN, ngKSI) → UE', amf, ue, 'info', 'out')
  push('UE', ue, 'USIM verified AUTN → computed RES* → NAS Authentication Response', ue, amf, 'info', 'out')
  // BUG2: 검증 주체 분리 — SEAF(AMF)는 HRES*==HXRES*, AUSF(홈)는 RES*==XRES*
  push('NF', amf, 'SEAF: HRES* (SHA-256(RAND‖RES*)) == HXRES* → forward RES* to AUSF', amf, ctx.ausf, 'info', 'out')
  push('NF', ctx.ausf, 'AUSF: RES* == XRES* → home confirmation OK; K_SEAF/K_AMF derived', ctx.ausf, amf, 'info', 'out')

  // ── Security Mode ── (SMC AMF→UE, Complete UE→AMF, AS SMC RU→UE)
  push('NF', amf, 'NAS Security Mode Command (5G-EA2/5G-IA2, ngKSI, UE-security-capabilities)', amf, ue, 'info', 'out')
  push('UE', ue, 'NAS Security Mode Complete (ciphered + integrity-protected, IMEISV)', ue, amf, 'info', 'out')
  push('RU', ru, 'AS SecurityModeCommand/Complete + RRCReconfiguration (SRB2, K_gNB)', ru, ue, 'info', 'out')

  // ── NSSF: 슬라이스 선택 (Requested NSSAI → Allowed NSSAI) ──
  const allowed = ctx.allowedSst ?? reqSst
  if (allowed.length === 0) {
    // Requested NSSAI 전부 미허용 → Allowed NSSAI 공집합
    if (ctx.nssf) {
      push('NF', ctx.nssf, `Nnssf_NSSelection ← AMF (Requested {${sstLabel(reqSst)}}) → no allowed S-NSSAI`, amf, ctx.nssf, 'warn', 'in')
    }
    push('NF', amf, 'Registration Reject (5GMM cause #62 No network slices available) → UE', amf, ue, 'error', 'out')
    return S
  }
  if (ctx.nssf) {
    push('NF', ctx.nssf, `Nnssf_NSSelection ← AMF: Requested {${sstLabel(reqSst)}}`, amf, ctx.nssf, 'info', 'in')
    push('NF', ctx.nssf, `NSSF → AMF: Allowed NSSAI {${sstLabel(allowed)}} (per zone provisioning)`, ctx.nssf, amf, 'info', 'out')
  }
  push('NF', amf, `AMF assigned Allowed NSSAI {${sstLabel(allowed)}} to ${ue}`, amf, ue, 'info', 'out')

  // ── PCF: AM Policy Association + UE Policy(URSP) ── (Create AMF→PCF, 응답 PCF→AMF)
  if (ctx.pcf) {
    push('NF', ctx.pcf, 'Npcf_AMPolicyControl_Create ← AMF (SUPI, Allowed NSSAI, location)', amf, ctx.pcf, 'info', 'in')
    push('NF', ctx.pcf, 'PCF → AMF: AM policy (RFSP, service-area-restriction) + UE Policy (URSP rules)', ctx.pcf, amf, 'info', 'out')
  }

  // ── Subscription / Context / Accept ──
  push('NF', ctx.udm, 'Nudm_SDM_Get ← AMF: subscription data (Access&Mobility, SMF-selection, UE-AMBR)', amf, ctx.udm, 'info', 'in')
  push('RU', ru, 'NGAP InitialContextSetupRequest → gNB (Allowed-NSSAI, UE-AMBR, K_gNB)', amf, ru, 'info', 'in')
  push('NF', amf, `Registration Accept (5G-GUTI, TAI-list, Allowed-NSSAI {${sstLabel(allowed)}}, T3512=${t3512} min${ctx.mico ? ', MICO-indication=raai (MICO mode)' : ''}) → UE`, amf, ue, 'info', 'out')
  if (ctx.mico) {
    push('UE', ue, 'MICO mode negotiated (T3324 active) — UE unreachable for MT while in CM-IDLE (no paging)', amf, ue, 'warn', 'in')
  }
  push('UE', ue, 'Registration Complete — RM-REGISTERED', ue, amf, 'info', 'out')

  // ── PDU Session Establishment ──
  const pduSst = ctx.sliceSst ?? allowed[0]
  push('UE', ue, `UL NAS: PDU Session Establishment Request (PSI=1, DNN=${dnn}, S-NSSAI SST=${pduSst}, IPv4)`, ue, amf, 'info', 'out')
  if (!ctx.smf) {
    push('NF', amf, 'Nsmf_PDUSession_CreateSMContext failed — no SMF → PDU Session Reject (#26/#31)', amf, ue, 'error', 'out')
    return S
  }
  // NRF: AMF가 S-NSSAI/DNN에 맞는 SMF 발견
  if (ctx.nrf) {
    push('NF', ctx.nrf, `Nnrf_NFDiscovery ← AMF (target=SMF, S-NSSAI SST=${pduSst}, DNN=${dnn})`, amf, ctx.nrf, 'info', 'in')
    push('NF', ctx.nrf, 'Nnrf_NFDiscovery Response → AMF (SMF NF-profile)', ctx.nrf, amf, 'info', 'out')
  }
  const smf = ctx.smf
  push('NF', smf, 'Nsmf_PDUSession_CreateSMContext ← AMF (SUPI, PSI=1, S-NSSAI, DNN)', amf, smf, 'info', 'in')
  // SMF: SM Policy Association (PCF) + 과금(CHF) + 바인딩(BSF)
  if (ctx.pcf) {
    push('NF', ctx.pcf, 'Npcf_SMPolicyControl_Create ← SMF (DNN, S-NSSAI, PDU type)', smf, ctx.pcf, 'info', 'in')
    push('NF', ctx.pcf, 'PCF → SMF: SM policy (Session-AMBR, PCC rules, default 5QI9 QoS)', ctx.pcf, smf, 'info', 'out')
    if (ctx.bsf) {
      push('NF', ctx.bsf, 'Nbsf_Management_Register ← PCF (SUPI, UE-IP → PCF binding)', ctx.pcf, ctx.bsf, 'info', 'in')
    }
  }
  if (ctx.chf) {
    push('NF', ctx.chf, 'Nchf_ConvergedCharging_Create ← SMF (online quota request, RG)', smf, ctx.chf, 'info', 'in')
    push('NF', ctx.chf, 'CHF → SMF: Granted-Unit (GSU) quota → charging started', ctx.chf, smf, 'info', 'out')
  }
  if (!ctx.upf) {
    push('NF', smf, 'UPF selection failed — no UPF → PDU Session Est. Reject (#26 insufficient resources)', smf, ue, 'error', 'out')
    return S
  }
  // NRF: SMF가 UPF 발견
  if (ctx.nrf) {
    push('NF', ctx.nrf, 'Nnrf_NFDiscovery ← SMF (target=UPF, DNN, S-NSSAI)', smf, ctx.nrf, 'info', 'in')
  }
  const upf = ctx.upf
  // PFCP N4 (SMF↔UPF): 수립 요청 SMF→UPF, 응답 UPF→SMF; PDU Accept SMF→UE; DRB RU→UE
  push('NF', smf, 'PFCP N4 Session Establishment Request → UPF (PDR/FAR/QER, UE-IP alloc)', smf, upf, 'info', 'out')
  push('NF', upf, `PFCP N4 Session Est Response — UE IP ${ctx.ueIp} assigned; N3 GTP-U tunnel armed`, upf, smf, 'info', 'out')
  push('NF', smf, `PDU Session Est Accept (authorized-QoS-rules, Session-AMBR, QFI=1/5QI9, S-NSSAI SST=${pduSst}) → UE`, smf, ue, 'info', 'out')
  push('RU', ru, 'RRCReconfiguration: DRB-1 setup (5QI9), N3 GTP-U TEID mapping', ru, ue, 'info', 'in')
  push('UE', ue, `RRCReconfigurationComplete — DRB up, PDU Session active, IP ${ctx.ueIp}`, ue, ru, 'info', 'out')
  if (!ctx.dn) {
    push('NF', upf, 'Warning: DN (N6) not connected — no external reachability', upf, 'DN', 'warn', 'out')
  }
  push('UE', ue, 'ATTACHED — RM-REGISTERED / CM-CONNECTED / RRC-CONNECTED', ru, ue, 'info', 'in')
  return S
}

// PART 15: 핸드오버 call flow (Xn 없는 NGAP/N2 기반 근사).
// Measurement Report(A3) → Handover Required → Handover Request/Ack → Handover Command →
// RRCReconfiguration(sync) → Handover Complete → Path Switch → End Marker.
// UERANSIM 실스택은 Xn/N2 핸드오버를 완전 지원하지 않으므로(v3.2.6 기준 제약), 시뮬레이터가
// 규격 call flow를 재현한다.
export interface HandoverCtx {
  ueName: string
  sourceRu: string
  targetRu: string
  amf: string | null
  upf: string | null
  sourcePci: number | null
  targetPci: number | null
  targetRsrp: number
  a3Offset: number
  hysteresis: number
  tttMs: number
  cioDb: number
  // SECTION A: Xn 핸드오버 변형. true면 소스↔타겟 gNB 간 Xn 직접(같은 AMF 가정) +
  // Path Switch로 코어 경로 갱신. false면 기존 NGAP/N2 (AMF 중계) 핸드오버.
  xn?: boolean
}

export function buildHandoverSteps(ctx: HandoverCtx): AttachStep[] {
  const S: AttachStep[] = []
  // SECTION T: from/to를 명시적으로 (핸드오버 3GPP 방향). SMF는 amf 컨텍스트에 별도 var 없으므로 'SMF'.
  const push = (source: LogSource, node: string, msg: string, from: string, to: string, dir?: 'in' | 'out', level: LogLevel = 'info') =>
    S.push({ source, level, node, msg, dir, from, to })
  const amf = ctx.amf ?? 'AMF'
  const src = ctx.sourceRu
  const tgt = ctx.targetRu
  const ue = ctx.ueName
  // Measurement Report(A3): UE → 소스 gNB
  push('UE', ue,
    `Measurement Report (event A3: ${tgt} PCI ${ctx.targetPci ?? '?'} RSRP ${ctx.targetRsrp}dBm > serving + off=${ctx.a3Offset}+hys=${ctx.hysteresis}, CIO=${ctx.cioDb}dB, TTT=${ctx.tttMs}ms)`,
    ue, src, 'out')
  if (ctx.xn) {
    // SECTION A: Xn 기반 핸드오버 (TS 38.423 §8.2 / TS 23.502 §4.9.1.2) — AMF 미개입 준비단계.
    push('RU', src, `Xn Handover Request → ${tgt} (target NCGI, UE context, PDU session resources, K_gNB*)`, src, tgt, 'out')
    push('RU', tgt, `Xn Handover Request Acknowledge → ${src} (admitted DRB, target RRC reconfiguration)`, tgt, src, 'out')
    push('RU', src, `Xn SN Status Transfer → ${tgt} (UL/DL PDCP SN, HFN per DRB)`, src, tgt, 'out')
    push('UE', ue, `RRCReconfiguration (reconfigurationWithSync → target PCI ${ctx.targetPci ?? '?'}, RACH to target)`, src, ue, 'in')
    push('UE', ue, `RRCReconfigurationComplete → ${tgt} (Xn handover complete)`, ue, tgt, 'out')
    push('RU', tgt, `NGAP Path Switch Request → AMF (new NG-RAN, N3 DL TNL info of ${tgt})`, tgt, amf, 'out')
    push('NF', amf, `Nsmf_PDUSession_UpdateSMContext (Path Switch) → SMF → UPF: N3 DL path switched to ${tgt}`, amf, 'SMF', 'out')
    if (ctx.upf) push('NF', ctx.upf, `GTP-U End Marker (type 254) → ${src}: in-order delivery, DL path → ${tgt}`, ctx.upf, src, 'out')
    push('NF', amf, `NGAP Path Switch Request Acknowledge → ${tgt} (new AN N3, security)`, amf, tgt, 'out')
    push('RU', tgt, `Xn UE Context Release → ${src} (source resources freed)`, tgt, src, 'out')
    return S
  }
  push('RU', src, `NGAP Handover Required → AMF (target gNB=${tgt}, cause=radio, sourceToTarget container)`, src, amf, 'out')
  push('NF', amf, `NGAP Handover Request → ${tgt} (UE context, PDU session, QoS, K_gNB*)`, amf, tgt, 'out')
  push('RU', tgt, 'NGAP Handover Request Acknowledge → AMF (admitted PDU sessions, target RRC container)', tgt, amf, 'out')
  push('NF', amf, `NGAP Handover Command → ${src} (target container, DL forwarding tunnel)`, amf, src, 'out')
  push('UE', ue, `RRCReconfiguration (reconfigurationWithSync → target PCI ${ctx.targetPci ?? '?'}, RACH to target)`, src, ue, 'in')
  push('UE', ue, `RRCReconfigurationComplete → ${tgt} (Handover Complete)`, ue, tgt, 'out')
  push('RU', tgt, 'NGAP Handover Notify → AMF (UE arrived at target)', tgt, amf, 'out')
  push('NF', amf, `Nsmf_PDUSession_UpdateSMContext (Path Switch) → SMF → UPF: N3 DL path switched to ${tgt}`, amf, 'SMF', 'out')
  if (ctx.upf) push('NF', ctx.upf, `GTP-U End Marker (type 254) → ${src}: in-order delivery, DL path → ${tgt}`, ctx.upf, src, 'out')
  push('NF', amf, `NGAP UEContextRelease → ${src} (source resources freed)`, amf, src, 'out')
  return S
}

// ════════ SECTION A: 등록/이동성/세션 부가 call-flow 빌더 ════════
// 공통 컨텍스트 — CM/RM 상태 전이·페이징·해제·RNAU·GUTI 재배정에 쓰이는 노드 이름 집합.
export interface FlowCtx {
  ueName: string
  servingName: string | null // 서빙 RU
  amf: string | null
  smf?: string | null
  upf?: string | null
  ueIp?: string
  pci?: number | null
}

function mkPush(S: AttachStep[]) {
  // SECTION T: from/to를 명시적으로 넘긴다 (메시지 텍스트 파싱 금지). from=송신 액터, to=수신 액터.
  return (
    source: LogSource,
    node: string,
    msg: string,
    from: string,
    to: string,
    dir?: 'in' | 'out',
    level: LogLevel = 'info',
  ) => S.push({ source, level, node, msg, dir, from, to })
}

// ── Service Request: CM-IDLE → CM-CONNECTED (UE-triggered, MO data/signalling) ──
// TS 23.502 §4.2.3.2. 트래픽이 다시 시작될 때(이미 RM-REGISTERED) full re-attach 대신 이걸 호출.
export function buildServiceRequestSteps(ctx: FlowCtx): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const ru = ctx.servingName
  const amf = ctx.amf
  if (!ru || !amf) {
    push('UE', ue, 'Service Request aborted — no serving cell / AMF (stay CM-IDLE)', ue, ue, 'in', 'warn')
    return S
  }
  push('UE', ue, 'CM-IDLE: uplink data pending → NAS Service Request (5G-S-TMSI, Uplink-data-status, PDU-session-status)', ue, amf, 'out')
  push('RU', ru, 'RRCSetupRequest / RRCSetup (establishmentCause=mo-Data) — SRB1 up', ru, ue, 'out')
  push('UE', ue, 'RRCSetupComplete (dedicatedNAS: Service Request)', ue, ru, 'out')
  push('RU', ru, 'NGAP InitialUEMessage → AMF (Service Request NAS-PDU)', ru, amf, 'out')
  push('NF', amf, 'Service Request accepted (integrity OK via 5G security context)', ue, amf, 'in')
  if (ctx.smf) {
    push('NF', ctx.smf, 'Nsmf_PDUSession_UpdateSMContext ← AMF (UP activation, N2 SM info request)', amf, ctx.smf, 'in')
    if (ctx.upf) push('NF', ctx.upf, 'PFCP N4 Session Modification — FAR restored (forward), N3 DL tunnel re-armed', ctx.smf, ctx.upf, 'in')
  }
  push('RU', ru, 'NGAP InitialContextSetupRequest → gNB (UE context, DRB to re-establish, K_gNB)', amf, ru, 'in')
  push('RU', ru, 'RRCReconfiguration — DRB-1 re-established (5QI9), N3 GTP-U TEID remapped', ru, ue, 'in')
  push('UE', ue, `RRCReconfigurationComplete — DRB up, CM-CONNECTED / RRC-CONNECTED${ctx.ueIp ? ` (IP ${ctx.ueIp})` : ''}`, ue, ru, 'out')
  push('NF', amf, 'NGAP InitialContextSetupResponse — user plane active, service accepted', ru, amf, 'in')
  return S
}

// ── Paging + DDN: MT (mobile-terminated) 데이터 도착 → 페이징 → UE MT Service Request ──
// TS 23.502 §4.2.3.3 (Network-triggered Service Request). opts.unreachable / opts.mico 로 실패 재현.
export function buildPagingSteps(
  ctx: FlowCtx,
  opts?: { unreachable?: boolean; mico?: boolean },
): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const ru = ctx.servingName
  const amf = ctx.amf ?? 'AMF'
  const smf = ctx.smf ?? 'SMF'
  const upf = ctx.upf ?? 'UPF'
  const rname = ru ?? 'gNB'
  push('NF', upf, 'DL data arrived for CM-IDLE UE → buffer; PFCP N4 Session Report (DLDR, Downlink-Data-Report) → SMF', upf, smf, 'out')
  push('NF', smf, 'Nsmf: DL data notification → Namf_Communication_N1N2MessageTransfer → AMF (N2 SM info, paging policy)', smf, amf, 'out')
  if (opts?.mico) {
    push('NF', amf, 'UE in MICO mode (unreachable for MT) — paging suppressed; DL data kept buffered until next UE-initiated contact', amf, amf, 'out', 'warn')
    push('NF', smf, 'N1N2MessageTransfer failure indication (UE unreachable) → DL buffer / extended buffering', amf, smf, 'out', 'warn')
    return S
  }
  push('NF', amf, 'NGAP Paging → gNB(s) in RAN paging area (5G-S-TMSI, paging-DRX, T3513 started)', amf, rname, 'out')
  if (ru) push('RU', ru, 'Paging (PCCH on paging occasion) — UE-Identity=5G-S-TMSI', ru, ue, 'out')
  if (opts?.unreachable || !ru) {
    push('NF', amf, 'T3513 expired — no page response (UE unreachable / out of coverage). MT delivery failed', amf, amf, 'out', 'warn')
    return S
  }
  push('UE', ue, 'Paged → NAS Service Request (MT, establishmentCause=mt-Access)', ue, amf, 'out')
  push('NF', amf, 'MT Service Request accepted → InitialContextSetup, user plane re-activated', ue, amf, 'in')
  if (ctx.upf) push('NF', upf, 'Buffered DL data flushed → N3 GTP-U → gNB → UE', upf, ue, 'out')
  return S
}

// ── Deregistration: UE-initiated (switch-off) 또는 NW-initiated (re-registration-required) ──
// TS 23.502 §4.2.2.3. 전원 OFF 분기(switch-off)에서 호출.
export function buildDeregisterSteps(
  ctx: FlowCtx,
  opts?: { nwInit?: boolean; reason?: string },
): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const ru = ctx.servingName
  const amf = ctx.amf
  if (!amf) {
    push('UE', ue, 'Local de-registration (no AMF context) — RM-DEREGISTERED', ue, ue, 'out', 'warn')
    return S
  }
  if (opts?.nwInit) {
    // 망 개시 재등록 요구
    push('NF', amf, `Deregistration Request → UE (de-registration type: re-registration-required${opts.reason ? `, ${opts.reason}` : ''})`, amf, ue, 'out')
    push('UE', ue, 'Deregistration Accept → AMF', ue, amf, 'out')
  } else {
    // 단말 개시 switch-off
    push('UE', ue, 'Deregistration Request → AMF (5G-GUTI, de-registration type: switch-off, access=3GPP)', ue, amf, 'out')
    push('NF', amf, 'switch-off → no Deregistration Accept returned (UE powers down)', ue, amf, 'in')
  }
  if (ctx.smf) {
    push('NF', ctx.smf, 'Nsmf_PDUSession_ReleaseSMContext ← AMF (release all PDU sessions)', amf, ctx.smf, 'in')
    if (ctx.upf) push('NF', ctx.upf, 'PFCP N4 Session Deletion — PDR/FAR/QER removed, UE-IP released', ctx.smf, ctx.upf, 'in')
  }
  if (ru) {
    push('RU', ru, 'NGAP UEContextReleaseCommand → gNB', amf, ru, 'out')
    push('RU', ru, 'NGAP UEContextReleaseComplete → AMF (RRC released, DRB/SRB torn down)', ru, amf, 'out')
  }
  push('UE', ue, 'RM-DEREGISTERED / CM-IDLE — 5G-GUTI/security-context released', ue, ue, 'in')
  return S
}

// ── RNAU / RRC_INACTIVE: RRCRelease(suspend) → RRC_INACTIVE → RRCResume 또는 주기적 RNAU ──
// TS 38.331 §5.3.13 (RRC connection resume) · §5.3.8.3 (suspend).
export function buildRnauSteps(
  ctx: FlowCtx,
  opts?: { resumeCause?: 'rna-Update' | 'mo-Data' | 'mo-Signalling'; xnRelocation?: boolean },
): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const ru = ctx.servingName ?? 'gNB'
  const amf = ctx.amf ?? 'AMF'
  const cause = opts?.resumeCause ?? 'rna-Update'
  push('RU', ru, 'RRCRelease with suspendConfig (I-RNTI, ran-PagingCycle, RAN-Notification-Area, NCC) → UE', ru, ue, 'out')
  push('UE', ue, 'Entered RRC_INACTIVE — AS context stored, CM-CONNECTED kept at 5GC (RRC-Inactive assistance)', ue, ue, 'in')
  push('UE', ue, `RRCResumeRequest (resumeIdentity=I-RNTI, resumeCause=${cause}, shortResumeMAC-I)`, ue, ru, 'out')
  if (opts?.xnRelocation) {
    push('RU', ru, 'Xn Retrieve UE Context Request/Response — anchor gNB returns stored UE context', ru, 'gNB', 'out')
    push('RU', ru, 'NGAP Path Switch Request → AMF (new serving gNB after RRC_INACTIVE relocation)', ru, amf, 'out')
  }
  if (cause === 'rna-Update') {
    push('RU', ru, 'RRCRelease with suspendConfig (periodic RNAU accepted — back to RRC_INACTIVE, T380 restarted)', ru, ue, 'out')
    push('UE', ue, 'RAN Notification Area Update done — RRC_INACTIVE', ue, ue, 'in')
  } else {
    push('RU', ru, 'RRCResume (masterCellGroup, DRB restore) → UE', ru, ue, 'out')
    push('UE', ue, 'RRCResumeComplete — RRC_CONNECTED, DRB resumed', ue, ru, 'out')
  }
  return S
}

// ── GUTI reallocation: Configuration Update Command (new 5G-GUTI) ──
// TS 24.501 §5.4.4 (Generic UE configuration update).
export function buildGutiReallocSteps(ctx: FlowCtx, newGuti?: string): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const amf = ctx.amf ?? 'AMF'
  push('NF', amf, `Configuration Update Command → UE (new 5G-GUTI${newGuti ? ` ${newGuti}` : ''}, TAI-list, acknowledgement-requested) [T3555]`, amf, ue, 'out')
  push('UE', ue, 'Configuration Update Complete → AMF (new 5G-GUTI adopted, old GUTI/5G-S-TMSI released)', ue, amf, 'out')
  return S
}

// ── MRO 핸드오버 실패 분리: too-late / too-early / wrong-cell (TS 38.300 §9.2.6, TS 37.340) ──
// A3/RLF/T310/T304 기계 재활용. 재수립 대상 셀 위치로 원인 구분.
export type MroType = 'too-late' | 'too-early' | 'wrong-cell'
export interface MroCtx {
  ueName: string
  sourceRu: string
  targetRu: string
  thirdRu?: string // wrong-cell: 재수립되는 제3의 셀
  amf: string | null
  t310Ms: number
  t304Ms: number
}
export function buildMroFailureSteps(ctx: MroCtx, mro: MroType): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const src = ctx.sourceRu
  const tgt = ctx.targetRu
  if (mro === 'too-late') {
    // HO 명령 이전에 RLF — 서빙 급락, HO가 너무 늦음. 다른(타겟) 셀에 재수립.
    push('UE', ue, `Serving ${src} degrading; A3 not yet triggered (HO too late)`, ue, src, 'out', 'warn')
    push('UE', ue, `N310 out-of-sync → T310 (${ctx.t310Ms}ms) started`, ue, ue, 'out', 'warn')
    push('UE', ue, `T310 expired → RLF (before any Handover Command)`, ue, ue, 'out', 'error')
    push('UE', ue, `RRCReestablishmentRequest → ${tgt} (reestablishmentCause=otherFailure) — different cell than source`, ue, tgt, 'out')
    push('RU', tgt, 'XnAP Retrieve UE Context → RRCReestablishment(NCC) → Complete (context found)', tgt, ue, 'out')
    push('RU', src, 'MRO: RLF report indicates handover-too-late → increase CIO / lower TTT to trigger A3 earlier', src, src, 'out', 'warn')
  } else if (mro === 'too-early') {
    // A3가 너무 일찍 발동 → HO 직후 target에서 RLF → source로 재수립.
    push('UE', ue, `Measurement Report A3 (${tgt}) — HO triggered too early`, ue, src, 'out')
    push('UE', ue, `RRCReconfigurationWithSync → ${tgt}; RACH...`, src, ue, 'in', 'warn')
    push('UE', ue, `RLF at ${tgt} shortly after handover (T304 window / poor target)`, ue, tgt, 'out', 'error')
    push('UE', ue, `RRCReestablishmentRequest → ${src} (re-establish back in SOURCE cell)`, ue, src, 'out')
    push('RU', src, 'XnAP Retrieve UE Context → RRCReestablishment — MRO: handover-too-early', src, ue, 'out')
    push('RU', tgt, 'MRO: RLF report → decrease CIO / raise TTT / raise A3 offset (avoid premature HO)', tgt, tgt, 'out', 'warn')
  } else {
    // wrong-cell: HO 후 target에서 RLF → 제3의 셀에 재수립 (타겟 선정 오류).
    const third = ctx.thirdRu ?? ctx.sourceRu
    push('UE', ue, `Measurement Report A3 (${tgt}) → handover executed to ${tgt}`, ue, src, 'out')
    push('UE', ue, `RLF at ${tgt} soon after handover`, ue, tgt, 'out', 'error')
    push('UE', ue, `RRCReestablishmentRequest → ${third} (a THIRD cell, neither source nor target)`, ue, third, 'out')
    push('RU', third, 'XnAP Retrieve UE Context → RRCReestablishment — MRO: handover-to-wrong-cell', third, ue, 'out')
    push('RU', tgt, 'MRO: wrong-cell → retune neighbor CIO so the correct target wins A3', tgt, tgt, 'out', 'warn')
  }
  return S
}

// ── Reroute NAS Message: 초기 AMF가 Requested-NSSAI 미지원 → target AMF-Set 재라우팅 ──
// TS 23.502 §4.2.2.2.3 (Registration with AMF re-allocation).
export interface RerouteCtx {
  ueName: string
  servingName: string | null
  amf1: string // 초기 접속 AMF (Requested-NSSAI 미지원)
  amf2: string // 재라우팅 대상 AMF
  requestedSst: number[]
}
export function buildRerouteSteps(ctx: RerouteCtx): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ru = ctx.servingName ?? 'gNB'
  const req = ctx.requestedSst.map((s) => `SST=${s}`).join(', ')
  push('RU', ru, `NGAP InitialUEMessage → ${ctx.amf1} (Registration Request, Requested-NSSAI {${req}})`, ru, ctx.amf1, 'out')
  push('NF', ctx.amf1, `Initial AMF cannot serve Requested-NSSAI {${req}} — query NSSF for target AMF-Set`, ctx.amf1, 'NSSF', 'in', 'warn')
  push('NF', ctx.amf1, `Nnssf_NSSelection → target AMF-Set; Namf_Communication or NGAP Reroute NAS Message → ${ctx.amf2}`, ctx.amf1, ctx.amf2, 'out')
  push('RU', ru, `NGAP Reroute NAS Request → target AMF ${ctx.amf2} (NAS-PDU, target AMF-Set-ID, allowed-NSSAI)`, ru, ctx.amf2, 'out')
  push('NF', ctx.amf2, 'Target AMF serves the slice → continues Registration (auth/security/accept)', ctx.amf2, ctx.amf2, 'in')
  push('NF', ctx.amf2, `Registration Accept (Allowed-NSSAI {${req}}, new 5G-GUTI) → UE`, ctx.amf2, 'UE', 'out')
  return S
}

// ════════ SECTION B: 측위 (LCS / MT-LR) call-flow — GMLC/AMF/LMF + LPP/NRPPa ════════
// TS 23.273 (5GC LCS) · TS 38.305 (NG-RAN positioning) · TS 37.355 (LPP) · TS 38.455 (NRPPa).
// MT-LR: 외부 LCS client → GMLC → (UDM 서빙 AMF 조회) → AMF(Namf_Location) → LMF(Nlmf_Location).
//   LMF↔UE = LPP (Request/Provide Capabilities, Request/Provide LocationInformation) via AMF N1.
//   LMF↔gNB = NRPPa (PositioningInformationRequest/Response, MeasurementRequest/Response) via AMF N2.
// 방식(method): DL-TDOA / Multi-RTT (다중 TRP 타이밍, ≥3 TRP 필요) / E-CID (서빙셀+RSRP/TA).
// E-CID는 sim이 이미 계산한 서빙 RU 위치·RSRP 지오메트리로 실제 coarse 위치를 산출한다.
// PHY 정확도(PRS 자원 설계, m급 TDOA/AoA/NLOS 완화)는 out-of-scope — call-flow와 실패원인만 표현.
export type PosMethod = 'DL-TDOA' | 'Multi-RTT' | 'E-CID'
export interface PositioningOpts {
  gmlc?: string | null
  lmf?: string | null
  method?: PosMethod
  lcsClient?: string // 외부 LCS client (AF/NEF/emergency) 표기
  unreachable?: boolean // UE가 MICO/CM-IDLE 도달불가 → LCS "UE unreachable"
  mico?: boolean // 도달불가 원인이 MICO 모드(페이징 억제)인지
  // E-CID coarse 위치 추정용 서빙셀 지오메트리 (sim이 계산한 RU 위치/RSRP)
  servingCell?: { x: number; z: number } | null
  rsrp?: number | null
  trpCount?: number // 존 내 측정 참여 가능한 gNB/TRP 수 (DL-TDOA/Multi-RTT의 GDOP 판정)
  // DL-TDOA/Multi-RTT 실제 위치추정용 — TRP 지오메트리 + UE 실제 위치(시뮬 트루스).
  trps?: { x: number; z: number }[] // 측정 참여 TRP(gNB) 좌표
  truePos?: { x: number; z: number } | null // UE 실제 위치 (추정 오차 모델의 기준점)
}

// 2×2 정규행렬(AᵀA) 역행렬의 대각합 제곱근 → PDOP(position dilution of precision) 근사.
// 행 A는 각 TRP→UE 단위 LOS 벡터. 공선(collinear)·근접 배치일수록 det→0 → PDOP 발산.
function pdopFromGeometry(unit: { x: number; z: number }[]): number {
  let a = 0
  let b = 0
  let c = 0 // AᵀA = [[a,b],[b,c]]
  for (const u of unit) {
    a += u.x * u.x
    b += u.x * u.z
    c += u.z * u.z
  }
  const det = a * c - b * b
  if (Math.abs(det) < 1e-6) return 50 // 거의 공선 → GDOP 발산 → 큰 값으로 클램프
  return Math.sqrt(Math.max((a + c) / det, 0)) // trace(inv(AᵀA)) = (a+c)/det
}

export function buildPositioningSteps(ctx: FlowCtx, opts?: PositioningOpts): AttachStep[] {
  const S: AttachStep[] = []
  const push = mkPush(S)
  const ue = ctx.ueName
  const ru = ctx.servingName
  const amf = ctx.amf ?? 'AMF'
  const gmlc = opts?.gmlc ?? 'GMLC'
  const lmf = opts?.lmf ?? 'LMF'
  const method = opts?.method ?? 'DL-TDOA'
  const client = opts?.lcsClient ?? 'external LCS client (AF/NEF)'
  const trps = opts?.trpCount ?? (ru ? 1 : 0)

  // 1) 외부 LCS client → GMLC (MT-LR 개시). GMLC는 UDM로 서빙 AMF를 조회.
  push('NF', gmlc, `Le: MT-LR request ← ${client} (target UE ${ue}, requested-QoS: accuracy/response-time, LCS-client-type)`, client, gmlc, 'in')
  push('NF', gmlc, `Nudm_UECM_Get → UDM: resolve serving AMF for ${ue} (SUPI/GPSI)`, gmlc, 'UDM', 'out')
  // 2) GMLC → AMF (Namf_Location_ProvidePositioningInfo)
  push('NF', amf, `Namf_Location_ProvidePositioningInfo ← ${gmlc} (LCS correlation-id, requested-QoS, target UE)`, gmlc, amf, 'in')

  if (opts?.unreachable) {
    // UE MICO/CM-IDLE → NAS 연결 수립 불가 → LCS "UE unreachable"
    push('NF', amf, opts?.mico
      ? 'target UE in MICO mode (CM-IDLE, paging suppressed) — cannot establish NAS connection for positioning'
      : 'target UE CM-IDLE → network-triggered Service Request paging: T3513 expired, no page response', amf, ue, 'out', 'warn')
    push('NF', amf, `Namf_Location_ProvidePositioningInfo response → ${gmlc}: error (UE unreachable)`, amf, gmlc, 'out', 'warn')
    push('NF', gmlc, `Le: MT-LR response → ${client}: location FAILED — cause "UE unreachable" (positioningDataError)`, gmlc, client, 'out', 'error')
    return S
  }

  // 3) AMF → LMF (Nlmf_Location_DetermineLocation)
  push('NF', lmf, `Nlmf_Location_DetermineLocation ← ${amf} (target UE, serving cell NCGI, requested-QoS)`, amf, lmf, 'in')
  push('NF', lmf, `positioning method selected: ${method}${method === 'E-CID' ? ' (serving-cell + RSRP/TA geometry)' : ' (multi-TRP timing multilateration)'}`, lmf, lmf, 'out')

  // 4) LMF ↔ UE : LPP (AMF N1 NAS transport 경유)
  push('NF', lmf, `LPP RequestCapabilities → ${ue} (via Namf_Communication_N1N2MessageTransfer → DL NAS)`, lmf, ue, 'out')
  push('UE', ue, 'LPP ProvideCapabilities → LMF (supported: DL-TDOA, Multi-RTT, E-CID; PRS processing capability)', ue, lmf, 'out')
  push('NF', lmf, `LPP RequestLocationInformation → ${ue} (${method}, assistanceData/PRS-config ref, response-time)`, lmf, ue, 'out')

  // 5) LMF ↔ gNB : NRPPa (AMF N2 경유)
  if (ru) {
    push('NF', lmf, `NRPPa PositioningInformationRequest → ${ru} (TRP info, PRS resource config request)`, lmf, ru, 'out')
    push('RU', ru, `NRPPa PositioningInformationResponse → ${lmf} (TRP PRS config, TRP/antenna geographic location)`, ru, lmf, 'out')
    push('NF', lmf, `NRPPa MeasurementRequest → ${ru}${trps > 1 ? ` (+${trps - 1} neighbour TRP)` : ''} (${method} measurement)`, lmf, ru, 'out')
    push('RU', ru, `NRPPa MeasurementResponse → ${lmf} (${method === 'Multi-RTT' ? 'gNB Rx-Tx time diff' : method === 'DL-TDOA' ? 'UL-RTOA per TRP' : 'AoA/RSRP'})`, ru, lmf, 'out')
  }
  push('UE', ue, `LPP ProvideLocationInformation → LMF (${method === 'E-CID' ? 'serving/neighbour RSRP + TA' : method === 'DL-TDOA' ? 'DL RSTD per TRP pair' : 'UE Rx-Tx time diff'})`, ue, lmf, 'out')

  // 6) 위치 산출 + 방식별 정확도 (근사 물리 모델 — 실제 PRS 레인징/NLOS 완화는 아님)
  if (method === 'E-CID' && opts?.servingCell) {
    // E-CID: 서빙셀 centroid를 추정 위치로, RSRP 기반 거리로 불확실도(반경) 역산.
    const { x, z } = opts.servingCell
    const rsrp = opts?.rsrp ?? -95
    // log-distance 근사: RSRP가 낮을수록 셀에서 멀다 → 불확실도(반경) 증가. 20~400m로 클램프.
    const unc = Math.min(Math.max(Math.round((-rsrp - 55) * 4), 20), 400)
    push('NF', lmf, `E-CID estimate: serving-cell centroid (x=${x.toFixed(1)}m, z=${z.toFixed(1)}m), RSRP ${rsrp.toFixed(0)}dBm → uncertainty radius ~${unc}m (67% conf, TA/AoA refined)`, lmf, lmf, 'out')
  } else if (
    (method === 'DL-TDOA' || method === 'Multi-RTT') &&
    opts?.trps &&
    opts?.truePos &&
    opts.trps.length >= 3
  ) {
    // DL-TDOA/Multi-RTT: TRP 지오메트리로 PDOP 산출 → 추정 위치 + 불확실도.
    //   각 TRP→UE 단위 LOS 벡터. DL-TDOA는 기준 TRP 대비 차분(쌍곡선), Multi-RTT는 절대 레인징.
    //   오차 ≈ PRS 레인징 1σ × PDOP. 근접·공선 배치일수록 PDOP↑ → 정확도 열화(수백 m).
    const { x: tx, z: tz } = opts.truePos
    const units = opts.trps.map((t) => {
      const dx = tx - t.x
      const dz = tz - t.z
      const d = Math.hypot(dx, dz) || 1
      return { x: dx / d, z: dz / d }
    })
    const geom =
      method === 'DL-TDOA'
        ? units.slice(1).map((u) => ({ x: u.x - units[0].x, z: u.z - units[0].z }))
        : units
    const pdop = pdopFromGeometry(geom)
    const baseSigma = method === 'Multi-RTT' ? 2.0 : 3.0 // PRS 레인징 1σ(m) 근사
    const err = Math.min(baseSigma * pdop, 500)
    // 결정적 의사난수 방위(재현성 위해 지오메트리로 시드) — 추정점을 실제 위치에서 err만큼 이격.
    const seed = Math.abs(Math.sin(tx * 12.9898 + tz * 78.233 + opts.trps.length))
    const bearing = seed * Math.PI * 2
    const ex = tx + Math.cos(bearing) * err
    const ez = tz + Math.sin(bearing) * err
    push('NF', lmf, `${method} multilateration over ${opts.trps.length} TRPs → PDOP ${pdop.toFixed(1)} → est (x=${ex.toFixed(1)}m, z=${ez.toFixed(1)}m), 1σ uncertainty ~${err.toFixed(0)}m (approx: PRS ranging σ≈${baseSigma}m × GDOP; not real ranging)`, lmf, lmf, 'out')
    if (pdop > 6) {
      push('NF', lmf, `poor geometry — near-collinear/close TRPs, high GDOP ${pdop.toFixed(1)} → accuracy degraded to ~${err.toFixed(0)}m (add spatially-separated TRPs to improve)`, lmf, lmf, 'out', 'warn')
    }
  } else if (trps < 3) {
    // DL-TDOA/Multi-RTT는 최소 3 TRP(triangulation) 필요 — 부족하면 fix 불가.
    push('NF', lmf, `${method} needs ≥3 TRPs for a fix — only ${trps} available → infeasible (fallback E-CID: serving-cell + RSRP)`, lmf, lmf, 'out', 'warn')
  } else {
    push('NF', lmf, `${method} multilateration over ${trps} TRPs → position fix (approx accuracy model; PRS design/NLOS mitigation out-of-scope)`, lmf, lmf, 'out')
  }
  push('NF', lmf, `Nlmf_Location_DetermineLocation response → ${amf} (geographic location + uncertainty ellipse + confidence)`, lmf, amf, 'out')
  push('NF', amf, `Namf_Location_ProvidePositioningInfo response → ${gmlc} (location estimate, age of location)`, amf, gmlc, 'out')
  push('NF', gmlc, `Le: MT-LR response → ${client}: SUCCESS — location delivered (${method})`, gmlc, client, 'out')
  return S
}

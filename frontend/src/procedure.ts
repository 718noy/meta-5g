// UE의 현재 Call Flow에 관여한 Function들을 좌→우 E2E 체인으로 조립하고,
// 각 노드가 "지금 보유한 정보"를 pcap 스타일 key/value로 만든다.
// 데이터 출처: 실제 측정(probe) + SIM + 서빙셀 파라미터 + 존 Core 구성.
import type { CoreNf, NfType, ProbeResult, SceneObject, SiteDown, UeSim, Zone } from './types'
import { NF_INFO, activeNf, suciOf, supiOf } from './types'

// 사이트 정상(장애 없음) 기본값 — ProcCtx에 siteDown이 없을 때 사용.
const NO_SITE_DOWN: SiteDown = { A: false, B: false }

export interface FlowField {
  k: string
  v: string
}
export interface FlowNode {
  id: string
  label: string
  role: string // ue/ru/amf/ausf/udm/smf/pcf/upf/dn
  color: string
  fields: FlowField[]
  // PART 1: 레이아웃 힌트. 'main'=좌→우 E2E 체인(UE..DN). 'cp'=제어평면 부가 NF(위/아래 층에 stacking).
  // attachTo = 이 CP NF가 통신하는 main 노드 id(들). 예: PCF는 amf,smf 둘 다.
  layer?: 'main' | 'cp'
  attachTo?: string[]
}
export interface FlowLink {
  iface: string
  up: string // 최근 상향(UE→네트워크 방향) 메시지
  down: string // 최근 하향(네트워크→UE 방향) 메시지
}
export interface Procedure {
  nodes: FlowNode[]
  links: FlowLink[] // links[i] = node[i] → node[i+1]
  ok: boolean
}

// IMSI 기반 결정적 hex — 암호 파라미터를 pcap처럼 그럴듯하게(안정적으로) 표시
function hex(seed: string, salt: string, len: number): string {
  let h = 0x811c9dc5
  const s = seed + salt
  const out: string[] = []
  for (let i = 0; i < len; i++) {
    h ^= s.charCodeAt(i % s.length) + i * 131
    h = Math.imul(h, 0x01000193) >>> 0
    out.push((h & 0xff).toString(16).padStart(2, '0'))
  }
  return out.join('').toUpperCase()
}

export interface ProcCtx {
  probe: ProbeResult | null
  ueSim: UeSim
  zone: Zone
  ueName: string
  ueIp: string
  objects: SceneObject[]
  coreNfs: CoreNf[]
  inCall: boolean
  mbps: number
  // BUG9: 사이트 장애(geo-red) 반영 — 없으면 무장애로 간주. activeNf가 siteDown+priority로 서빙 NF 선택.
  siteDown?: SiteDown
}

function nfName(coreNfs: CoreNf[], zone: Zone, type: string, siteDown: SiteDown = NO_SITE_DOWN): string | null {
  // BUG9: enabled-only 대신 activeNf로 siteDown(사이트 장애)·priority까지 반영해 실제 서빙 인스턴스 선택.
  return activeNf(coreNfs, zone, type as NfType, siteDown)?.name ?? null
}

export function buildProcedure(ctx: ProcCtx): Procedure {
  const { probe, ueSim, zone, ueName, ueIp, coreNfs, inCall, mbps } = ctx
  const siteDown = ctx.siteDown ?? NO_SITE_DOWN
  const supi = supiOf(ueSim)
  const imsi = `${ueSim.mcc}${ueSim.mnc}${ueSim.msin}`
  const guti = `${ueSim.mcc}-${ueSim.mnc}-02-01-${hex(imsi, 'tmsi', 4)}`
  const serving = probe?.serving_name ?? null
  const gnb = ctx.objects.find((o) => o.kind === 'gnb' && o.name === serving)
  const nodes: FlowNode[] = []
  const links: FlowLink[] = []
  const col = (t: string) => (NF_INFO as Record<string, { color: string }>)[t]?.color ?? '#8a94a6'

  // SECTION B: UE가 광고하는 LPP capability를 실제 측위 가용성과 결부.
  // LMF가 이 존에 있으면 LPP 기반 MT-LR 측위(buildPositioningSteps)가 실제로 가능 → LPP:1,
  // 없으면 광고해도 측위 종단이 없으므로 LPP:0. GMLC까지 있으면 외부 LCS(MT-LR) 완비.
  const lmfName = nfName(coreNfs, zone, 'LMF', siteDown)
  const gmlcName = nfName(coreNfs, zone, 'GMLC', siteDown)
  const lppSupported = !!lmfName

  // --- UE
  nodes.push({
    id: 'ue', label: ueName, role: 'ue', color: '#2bd680',
    fields: [
      { k: 'SUPI', v: supi },
      { k: 'SUCI (전송값)', v: suciOf(ueSim) },
      { k: '5G-GUTI', v: guti },
      { k: 'IMEI', v: '3569380356438' + hex(imsi, 'imei', 1).slice(0, 2) },
      { k: 'RM state', v: probe ? 'RM-REGISTERED' : 'RM-DEREGISTERED' },
      { k: 'CM state', v: inCall ? 'CM-CONNECTED' : probe ? 'CM-IDLE' : '-' },
      { k: 'RRC state', v: inCall ? 'RRC-CONNECTED' : 'RRC-IDLE' },
      { k: 'Serving PCI', v: probe?.pci != null ? String(probe.pci) : '-' },
      { k: 'NR-ARFCN', v: probe?.nr_arfcn != null ? String(probe.nr_arfcn) : '-' },
      { k: 'Band / BW', v: probe ? `${probe.band} / ${probe.bandwidth_mhz}MHz` : '-' },
      { k: 'RSRP', v: probe?.rsrp_dbm != null ? `${probe.rsrp_dbm} dBm` : '-' },
      { k: 'SINR / CQI', v: probe ? `${probe.sinr_db}dB / ${probe.cqi}` : '-' },
      { k: 'PDU Session', v: probe ? `#1 · ${ueIp}` : 'none' },
      { k: '5QI flows', v: inCall ? '9 (default) + 1 (voice/GBR)' : '9 (default)' },
      { k: '— NAS (5GMM) —', v: '' },
      { k: '5G-S-TMSI', v: hex(imsi, 'stmsi', 5) },
      { k: 'ngKSI', v: `{ TSC:native, ksi:${(imsi.charCodeAt(6) || 0) % 7} }` },
      { k: 'ABBA', v: '0x0000' },
      { k: '5GMM capability', v: `S1-mode:0, HO-attach:0, LPP:${lppSupported ? 1 : 0}, SGC:1` },
      { k: 'Positioning (LCS)', v: lppSupported ? (gmlcName ? 'LPP/NRPPa via LMF · MT-LR ready (GMLC)' : 'LPP via LMF (no GMLC → no MT-LR)') : 'no LMF (positioning unavailable)' },
      { k: 'UE security cap', v: '5G-EA0/EA1/EA2, 5G-IA1/IA2' },
      { k: 'Requested NSSAI', v: 'SST=1' + (inCall ? ' (+ IMS)' : '') },
      { k: 'Registration type', v: 'initial · follow-on:1' },
      { k: 'T3512 (periodic)', v: '54 min' },
      { k: 'T3502 / T3346', v: '12 min / —' },
      { k: '— RRC / PHY —', v: '' },
      { k: 'RRC est. cause', v: inCall ? 'mo-Data' : 'mo-Signalling' },
      { k: 'C-RNTI', v: '0x' + hex(imsi, 'crnti', 2).slice(0, 4) },
      { k: 'SCS / CP', v: `${probe?.scs_khz ?? 30} kHz / normal` },
      { k: 'DL/UL BWP', v: 'bwp-0 (initial)' },
      { k: 'DRX cycle', v: inCall ? 'on (40ms)' : 'idle-DRX 1.28s' },
      { k: 'Timing Advance', v: `${((probe?.pci ?? 0) % 30) + 1} (Ta units)` },
    ],
  })

  if (!probe) {
    // 미등록: UE만 + 실패 표시
    return { nodes, links, ok: false }
  }

  // --- RU (gNB)
  const ncgi = `${ueSim.mcc}-${ueSim.mnc}-${hex(serving ?? 'ru', 'ncgi', 5)}`
  nodes.push({
    id: 'ru', label: serving ?? 'RU', role: 'ru', color: '#4da3ff',
    fields: [
      { k: 'gNB ID', v: hex(serving ?? 'ru', 'gnb', 3) },
      { k: 'PCI', v: gnb?.gnb?.pci != null ? String(gnb.gnb.pci) : String(probe.pci ?? '-') },
      { k: 'TAC', v: gnb?.gnb?.tac != null ? String(gnb.gnb.tac) : String(probe.tac ?? '-') },
      { k: 'NCGI', v: ncgi },
      { k: 'PLMN', v: `${ueSim.mcc}/${ueSim.mnc}` },
      { k: 'RAN UE NGAP ID', v: String(1000 + (probe.pci ?? 0)) },
      { k: 'SSB beam idx', v: String(probe.ssb_idx ?? 0) },
      { k: 'DRB', v: inCall ? 'DRB-1 (5QI9), DRB-2 (5QI1)' : 'DRB-1 (5QI9)' },
      { k: 'N3 UL TEID', v: '0x' + hex(imsi, 'n3ul', 4) },
      { k: 'Tx power', v: gnb?.gnb ? `${gnb.gnb.tx_power_dbm} dBm` : '-' },
      { k: '— Cell / PHY (SIB) —', v: '' },
      { k: 'Duplex', v: gnb?.gnb && gnb.gnb.freq_mhz > 3000 ? 'TDD' : 'FDD' },
      { k: 'SCS common', v: `${gnb?.gnb?.scs_khz ?? 30} kHz` },
      { k: 'SSB periodicity', v: '20 ms' },
      { k: 'CORESET#0 / SS#0', v: 'idx 6 / idx 0' },
      { k: 'prach-ConfigIndex', v: '16 (format 0)' },
      { k: 'ssb-PBCH SNR', v: probe ? `${(probe.sinr_db ?? 0).toFixed(0)} dB` : '-' },
      { k: 'TDD UL/DL pattern', v: gnb?.gnb ? `DDDSU (DL ${Math.round((gnb.gnb.tdd_dl_ratio ?? 0.75) * 100)}%)` : '-' },
      { k: 'p-Max / ss-PBCH', v: '23 dBm / -6 dB' },
      { k: '— NGAP (N2) —', v: '' },
      { k: 'NGAP procedure', v: 'InitialContextSetup · UEContextRelease-ready' },
      { k: 'Served GUAMI', v: `${ueSim.mcc}-${ueSim.mnc}-02-01` },
      { k: 'RRC Inactive', v: 'suspendConfig: supported' },
    ],
  })
  links.push({
    iface: 'Uu (NR-Uu)',
    up: inCall ? 'UL RTP · PUSCH (5QI1)' : mbps > 0 ? 'UL PDU · PUSCH' : 'RRCReconfigurationComplete',
    down: inCall ? 'DL RTP · PDSCH (5QI1)' : mbps > 0 ? 'DL PDU · PDSCH' : 'RRCReconfiguration',
  })

  // --- AMF
  const amf = nfName(coreNfs, zone, 'AMF', siteDown)
  if (amf) {
    nodes.push({
      id: 'amf', label: amf, role: 'amf', color: col('AMF'),
      fields: [
        { k: 'AMF UE NGAP ID', v: String(500 + (probe.pci ?? 0)) },
        { k: 'GUAMI', v: `${ueSim.mcc}-${ueSim.mnc}-02-01` },
        { k: 'SUPI', v: supi },
        { k: '5G-GUTI', v: guti },
        { k: 'RM/CM', v: `REGISTERED / ${inCall ? 'CONNECTED' : 'IDLE'}` },
        { k: 'Allowed NSSAI', v: 'SST=1' },
        { k: 'K_AMF', v: hex(imsi, 'kamf', 16) + ' (256b)' },
        { k: 'NAS UL/DL count', v: `${inCall ? 7 : 3} / ${inCall ? 6 : 2}` },
        { k: 'NAS security', v: '5G-EA2 / 5G-IA2' },
        { k: '— N2 (NGAP) —', v: '' },
        { k: 'N2 SCTP', v: '127.0.0.5:38412 ↔ gNB' },
        { k: 'RAN UE NGAP ID', v: String(1000 + (probe.pci ?? 0)) },
        { k: 'AMF UE NGAP ID', v: String(500 + (probe.pci ?? 0)) },
        { k: 'PDU Session (N11→SMF)', v: 'PSI=1 → SMF' },
        { k: '— Registration context —', v: '' },
        { k: 'Registration Area (TAI)', v: `${ueSim.mcc}-${ueSim.mnc}-000001` },
        { k: 'Mobility restriction', v: 'none (all allowed)' },
        { k: 'ngKSI / ABBA', v: `ksi:${(imsi.charCodeAt(6) || 0) % 7} / 0x0000` },
        { k: 'K_SEAF', v: hex(imsi, 'kseaf', 16) + ' (256b)' },
        { k: 'K_gNB (N2)', v: hex(imsi, 'kgnb', 16) },
        { k: 'UE radio cap ID', v: hex(imsi, 'radcap', 3) },
        { k: 'T3550 / T3560', v: '6 s / 6 s' },
        { k: 'AMF pointer/set', v: 'set=001, ptr=01' },
        { k: 'NF services (SBI)', v: 'Namf_Communication, Namf_EventExposure' },
      ],
    })
    links.push({
      iface: 'N2 (NGAP) + N1 (NAS)',
      up: 'UL NAS Transport · InitialContextSetupResponse',
      down: 'InitialContextSetupRequest · DL NAS Transport',
    })
  }

  // PART 1: 등록/세션에 관여한 제어평면 NF를 CP 레이어 노드로 표시(절차상세에서 렌더).
  // 좌→우 일렬 불가한 NF(PCF는 AMF·SMF 둘 다와 통신)는 attachTo로 다중 연결을 표기 → UI가 층을 쌓아 배치.
  const cpNode = (
    type: string,
    role: string,
    attachTo: string[],
    fields: FlowField[],
  ) => {
    const nm = nfName(coreNfs, zone, type, siteDown)
    if (!nm) return
    nodes.push({ id: `cp-${role}`, label: nm, role, color: col(type), layer: 'cp', attachTo, fields })
  }
  if (amf) {
    cpNode('NRF', 'nrf', ['amf', 'smf'], [
      { k: 'NF service', v: 'Nnrf_NFManagement / Nnrf_NFDiscovery' },
      { k: 'Discovered', v: 'AUSF, UDM, SMF, PCF, NSSF' },
      { k: 'NF profile', v: 'priority, capacity, load' },
      { k: 'SBI', v: 'https · OAuth2 token (Nnrf_AccessToken)' },
    ])
    cpNode('NSSF', 'nssf', ['amf'], [
      { k: 'Service', v: 'Nnssf_NSSelection' },
      { k: 'Requested NSSAI', v: 'SST=1' + (inCall ? ' (+IMS)' : '') },
      { k: 'Allowed NSSAI', v: 'SST=1' },
      { k: 'NSI / AMF set', v: 'nsi-1 / set=001' },
    ])
    cpNode('AUSF', 'ausf', ['amf'], [
      { k: 'Service', v: 'Nausf_UEAuthentication' },
      { k: 'Method', v: '5G-AKA' },
      { k: 'K_AUSF / K_SEAF', v: hex(imsi, 'kausf', 8) + ' / ' + hex(imsi, 'kseaf', 8) },
      { k: 'SUPI (from UDM)', v: supi },
      { k: 'auth result', v: 'RES* == XRES* → confirmed' },
    ])
    cpNode('UDM', 'udm', ['amf', 'ausf', 'smf'], [
      { k: 'Service', v: 'Nudm_UEAuthentication / SDM / UECM' },
      { k: 'SIDF', v: 'SUCI → SUPI de-conceal (Profile A)' },
      { k: 'HE AV', v: 'RAND/AUTN/XRES*/K_AUSF' },
      { k: 'Subscription', v: 'AM data, SMF-selection, DNN=internet' },
      { k: 'SUPI', v: supi },
    ])
    cpNode('UDR', 'udr', ['cp-udm', 'cp-pcf'], [
      { k: 'Service', v: 'Nudr_DM_Query/Create' },
      { k: 'Data', v: 'Authentication subscription, Policy, SDM' },
      { k: 'K / OPc / SQN', v: hex(imsi, 'k', 8) + ' / ' + hex(imsi, 'opc', 4) },
    ])
    cpNode('PCF', 'pcf', ['amf', 'smf'], [
      { k: 'Service', v: 'Npcf_AMPolicyControl · Npcf_SMPolicyControl · Npcf_UEPolicyControl' },
      { k: 'AM policy', v: 'RFSP, service-area-restriction' },
      { k: 'UE policy (URSP)', v: 'traffic → S-NSSAI/DNN routing rules' },
      { k: 'SM policy', v: inCall ? 'PCC: QFI=2 5QI1 GBR (voice)' : 'PCC: default 5QI9' },
      { k: 'N5 (Npcf_PolicyAuthorization)', v: inCall ? 'AF/P-CSCF → dedicated QoS Flow' : '—' },
    ])
    cpNode('CHF', 'chf', ['smf'], [
      { k: 'Service', v: 'Nchf_ConvergedCharging (N40)' },
      { k: 'Mode', v: 'online (quota) + offline (CDR)' },
      { k: 'Granted units', v: mbps > 0 ? '512 MB GSU' : 'idle' },
      { k: 'Charging Id', v: hex(imsi, 'chg', 4) },
    ])
    cpNode('BSF', 'bsf', ['cp-pcf'], [
      { k: 'Service', v: 'Nbsf_Management (PCF binding)' },
      { k: 'Binding', v: `${ueIp} → PCF` },
    ])
    // SECTION B: 측위(LMF/GMLC) — LPP:1 capability에 대응하는 실제 측위 종단.
    // buildPositioningSteps(store.runPositioning)가 MT-LR call flow를 스트리밍한다.
    cpNode('LMF', 'lmf', ['amf'], [
      { k: 'Service', v: 'Nlmf_Location_DetermineLocation' },
      { k: 'UE protocol', v: `LPP (37.355) — ${lppSupported ? 'Request/Provide Capabilities·LocationInformation' : 'idle'}` },
      { k: 'RAN protocol', v: 'NRPPa (38.455) — PositioningInformation/Measurement' },
      { k: 'Methods', v: 'DL-TDOA · Multi-RTT (≥3 TRP) · E-CID (serving-cell+RSRP)' },
      { k: 'Accuracy note', v: 'PHY (PRS/NLOS) out-of-scope — call-flow only' },
    ])
    cpNode('GMLC', 'gmlc', ['amf'], [
      { k: 'Service', v: 'Ngmlc_Location · Le (external LCS client)' },
      { k: 'MT-LR', v: 'client → GMLC → AMF(Namf_Location) → LMF' },
      { k: 'UDM lookup', v: 'Nudm_UECM_Get (serving AMF)' },
    ])
    cpNode('NWDAF', 'nwdaf', ['amf', 'smf'], [
      { k: 'Service', v: 'Nnwdaf_AnalyticsSubscription / EventsSubscription' },
      { k: 'Analytics', v: 'NF_LOAD · slice load · abnormal behaviour' },
      { k: 'Closed loop', v: 'analytics → recommendation → PCF/AMF/HPA actuation' },
      { k: 'Data note', v: 'ML/data-collection plumbing out-of-scope' },
    ])
  }

  // 터널 엔드포인트 (Open5GS 기본 루프백 주소 관례로 표기)
  const gnbN3 = '127.0.0.1'
  const upfN3 = '127.0.0.7'
  const smfN4 = '127.0.0.4'
  const upfN4 = '127.0.0.7'
  const ulTeid = '0x' + hex(imsi, 'n3ul', 4)
  const dlTeid = '0x' + hex(imsi, 'n3dl', 4)
  const seidCp = '0x' + hex(imsi, 'seidcp', 8)
  const seidUp = '0x' + hex(imsi, 'seidup', 8)

  // RU 노드에 N3 사용자평면 터널 상세 추가
  const ruNode = nodes.find((n) => n.id === 'ru')
  if (ruNode) {
    ruNode.fields.push(
      { k: 'N3 GTP-U (UL)', v: `${gnbN3}:2152 → ${upfN3}:2152` },
      { k: 'N3 TEID (UL→UPF)', v: ulTeid },
      { k: 'N3 TEID (DL←UPF)', v: dlTeid },
      { k: 'N2 SCTP', v: `${gnbN3} ↔ 127.0.0.5:38412` },
    )
  }

  // --- SMF
  const smf = nfName(coreNfs, zone, 'SMF', siteDown)
  if (smf) {
    nodes.push({
      id: 'smf', label: smf, role: 'smf', color: col('SMF'),
      fields: [
        { k: 'PDU Session ID', v: '1' },
        { k: 'DNN', v: 'internet' },
        { k: 'S-NSSAI', v: 'SST=1, SD=—' },
        { k: 'PDU Session Type', v: 'IPv4' },
        { k: 'UE IP (할당)', v: ueIp },
        { k: 'SSC mode', v: '1' },
        { k: 'Session-AMBR', v: 'DL 1 Gbps / UL 500 Mbps' },
        { k: 'QoS Flows', v: inCall ? 'QFI=1 (5QI9) · QFI=2 (5QI1 GBR)' : 'QFI=1 (5QI9)' },
        { k: '— N4 (PFCP) —', v: '' },
        { k: 'PFCP CP F-SEID', v: `${seidCp} @ ${smfN4}` },
        { k: 'PFCP node', v: `${smfN4}:8805 ↔ ${upfN4}:8805` },
        { k: 'PDR / FAR / QER', v: inCall ? '4 / 4 / 2' : '2 / 2 / 1' },
        { k: '— N3 CN tunnel —', v: '' },
        { k: 'CN Tunnel Info', v: `${upfN3}:2152 · TEID ${ulTeid}` },
        { k: 'AN Tunnel Info', v: `${gnbN3}:2152 · TEID ${dlTeid}` },
        { k: 'Charging Id', v: hex(imsi, 'chg', 4) },
        { k: '— Policy / control —', v: '' },
        { k: 'PCF assoc (N7)', v: 'SM Policy Association #1' },
        { k: 'CHF (N40)', v: 'Nchf_ConvergedCharging (online)' },
        { k: 'Always-on PDU', v: 'not requested' },
        { k: 'UE IPv4 (pool)', v: `${ueIp} / 24 (pool: 10.45.0.0/16)` },
        { k: 'RQ timer / SSC', v: '— / mode 1' },
        { k: 'SM context ref', v: hex(imsi, 'smref', 4) },
      ],
    })
    links.push({
      iface: 'N11 (Nsmf_PDUSession)',
      up: 'UpdateSMContext (N2 SM info, UL)',
      down: 'N1N2MessageTransfer (PDU Session Accept)',
    })
  }

  // --- UPF
  const upf = nfName(coreNfs, zone, 'UPF', siteDown)
  if (upf) {
    const pkts = Math.round((mbps * 1e6) / 8 / 1200)
    nodes.push({
      id: 'upf', label: upf, role: 'upf', color: col('UPF'),
      fields: [
        { k: 'N4 UP F-SEID', v: `${seidUp} @ ${upfN4}` },
        { k: 'UE IP', v: ueIp },
        { k: 'DNN / APN', v: 'internet' },
        { k: '— N3 (GTP-U) —', v: '' },
        { k: 'Local N3 (UPF)', v: `${upfN3}:2152` },
        { k: 'Remote N3 (gNB)', v: `${gnbN3}:2152` },
        { k: 'UL TEID (rx from gNB)', v: ulTeid },
        { k: 'DL TEID (tx to gNB)', v: dlTeid },
        { k: '— PDR/FAR —', v: '' },
        { k: 'PDR (UL/DL)', v: inCall ? '2 / 2' : '1 / 1' },
        { k: 'FAR action', v: 'UL: FORW→N6 · DL: FORW→N3(encap)' },
        { k: 'QER (QFI)', v: inCall ? '1, 2 (MBR/GBR)' : '1' },
        { k: '— N6 —', v: '' },
        { k: 'N6 next-hop', v: '10.45.0.1 (ogstun) → DN' },
        { k: 'Throughput', v: `${mbps.toFixed(0)} Mbps` },
        { k: 'Pkts/s (approx)', v: mbps > 0 ? String(pkts) : '0' },
        { k: '— GTP-U / URR —', v: '' },
        { k: 'GTP-U echo', v: 'seq active (T3-RESPONSE 3s)' },
        { k: 'URR (usage report)', v: inCall ? '2 (vol+time)' : '1 (volume)' },
        { k: 'Buffering (DL)', v: mbps > 0 ? 'off (active)' : 'DDN → paging on DL' },
        { k: 'Outer IP/UDP', v: `${upfN3}↔${gnbN3} / UDP 2152` },
        { k: 'N4 assoc', v: `${smfN4} (heartbeat 60s)` },
        { k: 'Nat/Src (N6)', v: `${ueIp} → SNAT` },
      ],
    })
    links.push({
      iface: 'N4 (PFCP) · N3 (GTP-U)',
      up: 'N3 UL GTP-U (T-PDU) · PFCP Session Report',
      down: 'N3 DL GTP-U (T-PDU) · PFCP Session Modification',
    })
  }

  // --- 통화 중이면 IMS 경로 (UPF → IMS APN → P-CSCF → S-CSCF)
  if (inCall) {
    const pcscf = nfName(coreNfs, zone, 'P-CSCF', siteDown)
    const scscf = nfName(coreNfs, zone, 'S-CSCF', siteDown)
    if (pcscf) {
      nodes.push({
        id: 'pcscf', label: pcscf, role: 'pcscf', color: col('P-CSCF'),
        fields: [
          { k: 'IMPU', v: `sip:${supi}@ims.mnc0${ueSim.mnc}.mcc${ueSim.mcc}.3gppnetwork.org` },
          { k: 'IMPI', v: `${imsi}@ims.mnc0${ueSim.mnc}.mcc${ueSim.mcc}.3gppnetwork.org` },
          { k: 'P-CSCF addr', v: '10.45.0.10:5060 (SIP/UDP)' },
          { k: 'Signaling', v: 'SIP · N5(Npcf_PolicyAuthorization) 연동' },
          { k: 'Media (RTP)', v: 'AMR-WB · 5QI=1 (GBR)' },
          { k: 'SigComp', v: 'enabled' },
        ],
      })
      links.push({
        iface: 'IMS APN (via N6)',
        up: 'SIP INVITE / REGISTER → P-CSCF',
        down: 'SIP 200 OK / 183 Session Progress',
      })
    }
    if (scscf) {
      nodes.push({
        id: 'scscf', label: scscf, role: 'scscf', color: col('S-CSCF'),
        fields: [
          { k: 'Served IMPU', v: `sip:${supi}@ims…` },
          { k: 'S-CSCF addr', v: '10.45.0.12:5060' },
          { k: 'iFC', v: 'Telephony AS trigger' },
          { k: 'Session state', v: 'INVITE → 200 OK (active)' },
          { k: 'SDP codec', v: 'AMR-WB 12.65k' },
          { k: 'Charging (ICID)', v: hex(imsi, 'icid', 6) },
        ],
      })
      links.push({
        iface: 'Mw (SIP)',
        up: 'SIP INVITE (iFC eval) → AS',
        down: 'SIP 200 OK (Telephony AS)',
      })
    }
  }

  // --- DN (데이터 목적지) — 통화 전용이 아니면 항상 표시
  nodes.push({
    id: 'dn', label: `DN-${zone}`, role: 'dn', color: '#3da9ff',
    fields: [
      { k: 'DNN', v: 'internet' },
      { k: 'PDU Type', v: 'IPv4' },
      { k: 'UE IP (NAT src)', v: ueIp },
      { k: 'N6 Gateway', v: '10.45.0.1' },
      { k: 'Reachability', v: mbps > 0 ? 'ACTIVE (traffic)' : 'IDLE (bearer up)' },
      { k: 'DNS', v: '8.8.8.8, 1.1.1.1' },
      { k: 'MTU', v: '1400 (PDU session)' },
      { k: 'Default route', v: '0.0.0.0/0 → N6' },
      { k: 'RTT (approx)', v: mbps > 0 ? '~18 ms' : '-' },
    ],
  })
  links.push({
    iface: 'N6 (SGi)',
    up: mbps > 0 ? 'IP packet → Internet (uplink)' : 'idle (bearer up)',
    down: mbps > 0 ? 'IP packet ← Internet (downlink)' : 'idle (bearer up)',
  })

  return { nodes, links, ok: true }
}

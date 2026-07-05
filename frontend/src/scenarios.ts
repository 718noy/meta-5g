// 실제 5G use case(콜플로우/실패 사례) 프리셋 — 실무·3GPP TS 24.501 cause 기반.
// 각 시나리오는 씬/파라미터를 설정하고, 시뮬레이터가 재현하는 결과가 "기대 결과"와
// 맞는지 검증(pass/fail)한다. 성공 케이스와 실패 케이스를 모두 수집.
import type { CoreNf, NfType, SceneObject, Zone } from './types'
import { computeCall, computeE2E, computeIms, computeRoamingPath } from './types'

export interface ScenarioResult {
  ok: boolean
  detail: string
}

export interface Scenario {
  id: string
  ko: string
  en: string
  zh: string
  desc_ko: string
  desc_en: string
  desc_zh: string
  ref: string // 3GPP 근거 (검증됨)
  cause?: string // 3GPP cause code (예: '5GSM #27', '#3 Illegal UE', 'PFCP 72')
  domain?: string // 도메인 분류 (registration/auth/pdu/ran/vonr/roaming/scale/userplane/charging/iot/snpn/multirat)
  validated?: boolean // 실제 Open5GS/UERANSIM 스택으로 ground-truth 검증됨
  category: 'success' | 'failure'
  // 기대 결과 판정 (현재 씬 상태로부터)
  expect: (ctx: {
    objects: SceneObject[]
    coreNfs: CoreNf[]
    coreDn: Record<Zone, boolean>
    homeZone: Zone
  }) => { label_ko: string; label_en: string }
  // 이 시나리오를 재현하도록 씬을 구성 (반환 = 적용할 부분 상태)
  setup: SetupOp[]
}

// 씬 구성 조작 (선언적) — apply 함수가 해석
export type SetupOp =
  | { op: 'ensureNf'; zone: Zone; type: NfType }
  | { op: 'removeNf'; zone: Zone; type: NfType }
  | { op: 'disableNf'; zone: Zone; type: NfType }
  | { op: 'setDn'; zone: Zone; on: boolean }
  | { op: 'ensureRU'; zone: Zone }
  | { op: 'ensurePerson'; zone: Zone; name: string }
  | { op: 'addSlice'; zone: Zone; sst: number; sd: string } // PART 3: 슬라이스 프로비저닝
  | { op: 'note'; text: string }

// ── 시나리오 카탈로그 ──────────────────────────────────────────
export const SCENARIOS: Scenario[] = [
  {
    id: 'happy-reg',
    ko: '정상 등록 + 세션', en: 'Successful registration + session',
    zh: '正常注册 + 会话',
    desc_ko: 'RU + 완전한 5GC(AMF/AUSF/UDM/SMF/UPF) + DN → 등록·인증·PDU 세션 성립.',
    desc_en: 'RU + full 5GC + DN → registration, auth, PDU session succeed.',
    desc_zh: 'RU + 完整 5GC(AMF/AUSF/UDM/SMF/UPF) + DN → 注册、鉴权、PDU Session 成功建立。',
    ref: 'TS 23.502 §4.2.2.2 Registration · §4.3.2 PDU Session Est · TS 33.501 §6.1 5G-AKA',
    validated: true,
    category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensurePerson', zone: 'A', name: 'UE-A1' },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return e.ok
        ? { label_ko: '통신 가능 (등록/세션 성립)', label_en: 'Reachable (registered)' }
        : { label_ko: `실패: ${e.missing.join(', ')}`, label_en: `Fail: ${e.missing.join(', ')}` }
    },
  },
  {
    id: 'auth-fail-udm',
    ko: '인증 실패 (UDM 부재)', en: 'Auth failure (no UDM)',
    zh: '鉴权失败 (无 UDM)',
    desc_ko: 'UDM 없음 → AUSF가 Nudm_UEAuthentication_Get 실패 → 인증 절차 미완 → AMF가 Registration Reject.',
    desc_en: 'No UDM → AUSF Nudm_UEAuthentication_Get fails → auth incomplete → AMF Registration Reject.',
    desc_zh: '无 UDM → AUSF 的 Nudm_UEAuthentication_Get 失败 → 鉴权流程未完成 → AMF 发送 Registration Reject。',
    ref: 'TS 33.501 §6.1.3.1 (AUSF↔UDM auth vector) · TS 24.501 Registration Reject',
    validated: true,
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'removeNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('UDM')
        ? { label_ko: 'Registration Reject — 인증 불가(UDM 없음)', label_en: 'Registration Reject — no UDM' }
        : { label_ko: '예상과 다름', label_en: 'unexpected' }
    },
  },
  {
    id: 'no-suitable-cell',
    ko: 'No Suitable Cell (RU 없음)', en: 'No suitable cell (no RU)',
    zh: 'No Suitable Cell (无 RU)',
    desc_ko: 'RU 없음 → RRC 셀 선택 실패 (No suitable/acceptable cell) → UE 무서비스. (UERANSIM 실로그와 동일)',
    desc_en: 'No RU → RRC cell selection failure (no suitable/acceptable cell) → UE out of service.',
    desc_zh: '无 RU → RRC 小区选择失败 (No suitable/acceptable cell) → UE 无服务。(与 UERANSIM 实际日志一致)',
    ref: 'TS 38.304 §5.2.3 Cell selection (RRC/AS, NAS 이전 단계 — NAS cause 없음)',
    cause: 'RRC out-of-service (no suitable/acceptable cell)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '이 존의 RU를 모두 삭제하거나 송출을 끄세요 (순수 RRC/AS 무서비스 — NAS 5GMM cause 아님)' },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return e.missing.includes('RU')
        ? { label_ko: 'RRC 무서비스 — No suitable/acceptable cell (RU 없음, NAS 이전)', label_en: 'RRC out-of-service — no suitable cell' }
        : { label_ko: '예상과 다름 (RU 존재)', label_en: 'unexpected (RU present)' }
    },
  },
  {
    id: 'pdu-reject-dnn',
    ko: 'PDU 세션 거부 (SMF/UPF 부재)', en: 'PDU session reject (no SMF/UPF)',
    zh: 'PDU Session 拒绝 (无 SMF/UPF)',
    desc_ko: '등록은 되지만 SMF/UPF 없음 → AMF가 Nsmf_PDUSession_CreateSMContext 실패 → PDU Session Est. Reject (5GSM #26/#31 insufficient resources).',
    desc_en: 'Registered but no SMF/UPF → CreateSMContext fails → PDU Session Reject (#26/#31).',
    desc_zh: '注册成功但无 SMF/UPF → AMF 的 Nsmf_PDUSession_CreateSMContext 失败 → PDU Session Est. Reject (5GSM #26/#31 insufficient resources)。',
    ref: 'TS 24.501 §6.4.1 · 5GSM cause #26 insufficient resources',
    validated: true,
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'removeNf', zone: 'A', type: 'SMF' }, { op: 'removeNf', zone: 'A', type: 'UPF' },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && (e.missing.includes('SMF') || e.missing.includes('UPF'))
        ? { label_ko: 'PDU Session Reject — 세션 자원 없음', label_en: 'PDU Session Reject' }
        : { label_ko: '예상과 다름', label_en: 'unexpected' }
    },
  },
  {
    id: 'roaming-ok',
    ko: '국제 로밍 (홈 라우팅)', en: 'Roaming (home-routed)',
    zh: '国际漫游 (归属地路由)',
    desc_ko: '방문 PLMN RU/AMF/UPF + 양측 SEPP(N32) + 홈 AUSF/UDM/UPF/DN → 홈 라우팅 로밍 데이터 성립.',
    desc_en: 'Visited RU/AMF/UPF + both SEPP + home AUSF/UDM/UPF/DN → home-routed roaming OK.',
    desc_zh: '拜访 PLMN 的 RU/AMF/UPF + 双侧 SEPP(N32) + 归属 AUSF/UDM/UPF/DN → home-routed 漫游数据成功建立。',
    ref: 'TS 23.502 §4.2.2.2.2 roaming registration · TS 33.501 §13 SEPP/N32 · home-routed',
    category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'B' },
      { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '걷기 모드로 PLMN-B에 진입하면 로밍 등록됩니다 (홈=A)' },
    ],
    expect: (c) => {
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', c.homeZone === 'B' ? 'A' : c.homeZone)
      return p.ok
        ? { label_ko: 'B에서 로밍 데이터 가능 (홈 라우팅)', label_en: 'Roaming data OK in B' }
        : { label_ko: `로밍 불가: ${p.missing.join(', ')}`, label_en: `No roaming: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'roaming-fail-sepp',
    ko: '로밍 실패 (SEPP 부재)', en: 'Roaming fail (no SEPP)',
    zh: '漫游失败 (无 SEPP)',
    desc_ko: '방문/홈망에 SEPP 없음 → N32 인터커넥트/보안(PRINS) 불가 → 로밍 인증 실패. (필드: SEPP 인증서·NRF federation이 로밍 실패 1·2위)',
    desc_en: 'No SEPP → N32 interconnect/security fails → roaming auth fails.',
    desc_zh: '拜访/归属网络无 SEPP → N32 互联/安全(PRINS)不可用 → 漫游鉴权失败。(现网:SEPP 证书与 NRF federation 是漫游失败前两大原因)',
    ref: 'TS 33.501 §13 SEPP · N32 · IPX. Field: SEPP cert & NRF federation = top-2 roaming failures',
    cause: '5GSM #38 network failure', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' },
      { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' },
      { op: 'removeNf', zone: 'B', type: 'SEPP' }, { op: 'removeNf', zone: 'A', type: 'SEPP' },
    ],
    expect: (c) => {
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', c.homeZone === 'B' ? 'A' : c.homeZone)
      return !p.ok && p.missing.some((m) => m.includes('SEPP'))
        ? { label_ko: `로밍 실패 — SEPP/N32 없음 (${p.missing.join(', ')})`, label_en: `Roaming fail — no SEPP` }
        : { label_ko: p.ok ? '예상과 다름 (로밍 성립)' : `실패: ${p.missing.join(', ')}`, label_en: p.ok ? 'unexpected' : `fail: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'vonr-ok',
    ko: 'VoNR 통화 성립', en: 'VoNR call OK',
    zh: 'VoNR 通话建立',
    desc_ko: 'E2E 데이터 + IMS(P/I/S-CSCF) → SIP 등록·INVITE → VoNR 통화 (5QI=1 GBR, DNN=ims).',
    desc_en: 'E2E data + IMS → SIP register/INVITE → VoNR call (5QI=1 GBR).',
    desc_zh: 'E2E 数据 + IMS(P/I/S-CSCF) → SIP 注册·INVITE → VoNR 通话 (5QI=1 GBR, DNN=ims)。',
    ref: 'TS 23.228 IMS · TS 24.229 SIP · TS 23.501 5QI=1 GBR voice',
    category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' },
      { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'ensurePerson', zone: 'A', name: 'UE-A1' }, { op: 'ensurePerson', zone: 'A', name: 'UE-A2' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      const persons = c.objects.filter((o) => o.kind === 'person' && (o.zone ?? 'A') === 'A')
      if (persons.length >= 2) {
        const call = computeCall(c.objects, c.coreNfs, c.coreDn, 'A', 'A')
        return call.ok
          ? { label_ko: 'VoNR 통화 가능', label_en: 'VoNR call OK' }
          : { label_ko: `통화 불가: ${call.missing.join(', ')}`, label_en: `No call: ${call.missing.join(', ')}` }
      }
      return ims.ok
        ? { label_ko: 'IMS 준비됨 (측정요원 2명 필요)', label_en: 'IMS ready (need 2 UEs)' }
        : { label_ko: `IMS 부족: ${ims.missing.join(', ')}`, label_en: `IMS missing: ${ims.missing.join(', ')}` }
    },
  },
  {
    id: 'vonr-fail-ims',
    ko: 'VoNR 실패 (IMS 부재)', en: 'VoNR fail (no IMS)',
    zh: 'VoNR 失败 (无 IMS)',
    desc_ko: '데이터는 되지만 IMS(S-CSCF) 없음 → SIP REGISTER/INVITE 응답 없음 → 503 Service Unavailable/408 Timeout, 통화 불가.',
    desc_en: 'Data OK but no IMS(S-CSCF) → no SIP response → 503/408, no call.',
    desc_zh: '数据可用但无 IMS(S-CSCF) → SIP REGISTER/INVITE 无响应 → 503 Service Unavailable/408 Timeout,无法通话。',
    ref: 'TS 24.229 SIP · RFC 3261 (503 Service Unavailable / 408 Timeout)',
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'removeNf', zone: 'A', type: 'S-CSCF' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      return !ims.ok
        ? { label_ko: `통화 불가 — IMS 없음: ${ims.missing.join(', ')}`, label_en: `No call — IMS: ${ims.missing.join(', ')}` }
        : { label_ko: '예상과 다름', label_en: 'unexpected' }
    },
  },
  {
    id: 'congestion',
    ko: '혼잡 (대량 사용자)', en: 'Congestion (mass users)',
    zh: '拥塞 (海量用户)',
    desc_ko: 'RU max_ue를 낮추고 측정요원 다수 배치+트래픽 → RRC Setup Reject / PRB 혼잡(>80%) / 셀엣지 스루풋 하락. (필드: PRB<80% 권장, 100% 근접 시 붕괴)',
    desc_en: 'Lower max_ue, many UEs+traffic → RRC Setup Reject / PRB>80% / cell-edge throughput collapse.',
    desc_zh: '降低 RU 的 max_ue 并部署大量 UE + 流量 → RRC Setup Reject / PRB 拥塞(>80%) / 小区边缘吞吐量下降。(现网:PRB<80% 为目标,接近 100% 时崩溃)',
    ref: 'TS 38.331 RRC · admission control. Field: PRB<80% target, near-100% collapses',
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU max_ue를 4로 낮추고 측정요원을 6명 이상 배치 후 전체 트래픽 생성' },
    ],
    expect: () => ({ label_ko: 'PRB 혼잡/RRC Reject 로그 확인', label_en: 'Observe PRB congestion / RRC reject' }),
  },
  {
    id: 'pci-mod3',
    ko: 'PCI mod-3 간섭', en: 'PCI mod-3 interference',
    zh: 'PCI mod-3 干扰',
    desc_ko: '두 RU를 인접 배치하고 PCI를 같은 mod-3(예: 1,4,7)로 → 셀 경계에서 SINR 저하·처리량 하락. PCI를 mod-3 다르게(1,2) 바꾸면 개선. (필드: mod-3 충돌=call drop/HO 실패/스루풋↓)',
    desc_en: 'Two RUs with same PCI mod-3 (1,4,7) → cell-edge SINR drop. Change to different mod-3 to fix.',
    desc_zh: '两个 RU 相邻部署且 PCI 取相同 mod-3(如 1,4,7)→ 小区边缘 SINR 下降、吞吐量下降。将 PCI 改为不同 mod-3(1,2)即可改善。(现网:mod-3 冲突 = call drop/HO 失败/吞吐量↓)',
    ref: 'TS 38.211 PCI · mod-3=DMRS/scheduling collision. Field: mod-3 clash → SINR↓, BLER↑',
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'note', text: 'RU 2대를 인접 배치, 한쪽 PCI=1 다른쪽 PCI=4(mod3 동일) → 셀 경계 SINR 확인. PCI를 2로 바꾸면 개선' },
    ],
    expect: () => ({ label_ko: '경계 SINR 저하 (SINR 모드/HUD로 확인)', label_en: 'Cell-edge SINR drop' }),
  },
  {
    id: 'rach-storm',
    ko: 'RACH 폭주 (경기장)', en: 'RACH storm (stadium)',
    zh: 'RACH 风暴 (体育场)',
    desc_ko: '한 셀에 다수 UE 동시 접속(경기 종료 등) → preamble 충돌 → MSG2 실패·경합해소 지연·접속 실패 급증. UL 외곽 UE는 PRACH 실패.',
    desc_en: 'Many UEs access one cell at once → preamble collision → MSG2 fail, contention delay.',
    desc_zh: '大量 UE 同时接入同一小区(如比赛结束)→ preamble 冲突 → MSG2 失败、竞争解决延迟、接入失败激增。UL 边缘 UE 出现 PRACH 失败。',
    ref: 'TS 38.321 RACH · contention-based RA. Field: stadium goal/end → preamble collision',
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '측정요원을 셀 외곽에 다수 배치 후 전체 트래픽 생성 → PRACH 실패/경합 로그' },
    ],
    expect: () => ({ label_ko: 'PRACH 실패/경합 지연 로그', label_en: 'PRACH failure / contention delay' }),
  },
  {
    id: 'signaling-storm',
    ko: '시그널링 스톰 (AMF 과부하)', en: 'Signaling storm (AMF overload)',
    zh: '信令风暴 (AMF 过载)',
    desc_ko: '대량 UE 동시 재등록(라우팅 장애 복구 등) → AMF 등록 폭주 → NGAP Overload Start·T3346 백오프. (실사례: NZ 3일/노르웨이 18h/Verizon 2026)',
    desc_en: 'Mass simultaneous re-registration → AMF flood → NGAP Overload Start, T3346 backoff.',
    desc_zh: '海量 UE 同时重注册(如路由故障恢复)→ AMF 注册洪泛 → NGAP Overload Start、T3346 退避。(真实事件:新西兰 3 天/挪威 18h/Verizon 2026)',
    ref: 'TS 23.501 §5.19 overload control · T3346 backoff. Incidents: NZ 3d, Norway 18h, Verizon 2026',
    category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'AMF 레플리카=1, HPA 끄고 파드당 용량을 낮춘 뒤 측정요원 대량 배치 → NGAP Overload Start 로그' },
    ],
    expect: () => ({ label_ko: 'AMF 과부하 → NGAP Overload/T3346 로그', label_en: 'AMF overload → NGAP Overload/T3346' }),
  },

  // ════════ 측위 (LCS / MT-LR) + NWDAF 분석 폐루프 — TS 23.273 · TS 38.305 · TS 23.288 ════════
  {
    id: 'pos-mt-lr',
    ko: '측위 MT-LR (LMF/GMLC)', en: 'Positioning MT-LR (LMF/GMLC)', zh: '定位 MT-LR (LMF/GMLC)',
    desc_ko: '외부 LCS client → GMLC → AMF(Namf_Location) → LMF. LPP(Request/Provide Capabilities·LocationInformation) + NRPPa(PositioningInformation/Measurement). E-CID로 서빙셀+RSRP 지오메트리에서 coarse 위치 추정(실제 좌표+불확실도). DL-TDOA/Multi-RTT는 ≥3 TRP 필요(정확도는 PHY out-of-scope).',
    desc_en: 'External LCS client → GMLC → AMF(Namf_Location) → LMF. LPP + NRPPa. E-CID derives a coarse location from serving-cell + RSRP geometry (real coords + uncertainty). DL-TDOA/Multi-RTT need ≥3 TRPs (accuracy is PHY, out-of-scope).',
    desc_zh: '外部 LCS 客户端 → GMLC → AMF(Namf_Location) → LMF。LPP + NRPPa。E-CID 从服务小区+RSRP 几何推导粗略位置(真实坐标+不确定度)。DL-TDOA/Multi-RTT 需 ≥3 TRP(精度属 PHY,超范围)。',
    ref: 'TS 23.273 §6.1.1 MT-LR · TS 38.305 NG-RAN positioning · TS 37.355 LPP · TS 38.455 NRPPa',
    domain: 'positioning', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'GMLC' }, { op: 'ensureNf', zone: 'A', type: 'LMF' },
      { op: 'ensurePerson', zone: 'A', name: 'UE-A1' },
    ],
    expect: (c) => {
      const has = (t: NfType) => c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === t && n.enabled)
      const missing = (['GMLC', 'LMF', 'AMF'] as NfType[]).filter((t) => !has(t))
      return missing.length === 0
        ? { label_ko: 'MT-LR 성공 — 위치 추정 전달 (E-CID coarse fix)', label_en: 'MT-LR success — location delivered (E-CID)' }
        : { label_ko: `측위 불가: ${missing.join(', ')} 없음`, label_en: `No positioning: missing ${missing.join(', ')}` }
    },
  },
  {
    id: 'pos-fail-unreachable',
    ko: '측위 실패 (UE 도달불가)', en: 'Positioning fail (UE unreachable)', zh: '定位失败 (UE 不可达)',
    desc_ko: 'UE가 MICO/CM-IDLE → AMF가 페이징으로 NAS 연결 수립 불가 → LCS "UE unreachable" 반환. 추가로 존 TRP<3이면 DL-TDOA/Multi-RTT는 GDOP 불량으로 애초에 불가(E-CID만 가능).',
    desc_en: 'UE in MICO/CM-IDLE → AMF cannot establish NAS connection via paging → LCS returns "UE unreachable". Also, with <3 TRPs in the zone DL-TDOA/Multi-RTT is infeasible (bad GDOP; only E-CID).',
    desc_zh: 'UE 处于 MICO/CM-IDLE → AMF 无法经寻呼建立 NAS 连接 → LCS 返回 "UE unreachable"。此外区内 TRP<3 时 DL-TDOA/Multi-RTT 因 GDOP 差不可行(仅 E-CID)。',
    ref: 'TS 23.273 §6.1.1 (MT-LR, UE unreachable) · TS 23.501 MICO · TS 38.305 (GDOP/TRP geometry)',
    cause: 'LCS: UE unreachable (MICO/CM-IDLE)', domain: 'positioning', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'GMLC' }, { op: 'ensureNf', zone: 'A', type: 'LMF' },
      { op: 'ensurePerson', zone: 'A', name: 'UE-A1' },
      { op: 'note', text: '대상 UE는 MICO/CM-IDLE로 가정 — 페이징 억제로 MT 도달불가. TRP 3대 미만이면 DL-TDOA도 불가(E-CID만).' },
    ],
    expect: (c) => {
      // computeE2E가 NF를 세듯, 존 A의 송출 중 RU(TRP) 수를 센다 — <3이면 DL-TDOA/Multi-RTT 불가.
      const trps = c.objects.filter(
        (o) => o.kind === 'gnb' && (o.zone ?? 'A') === 'A' && o.gnb?.enabled !== false,
      ).length
      const geom = trps < 3
        ? { label_ko: `; TRP ${trps}<3 → DL-TDOA/Multi-RTT GDOP 불가(E-CID만)`, label_en: `; TRP ${trps}<3 → DL-TDOA/Multi-RTT infeasible (E-CID only)` }
        : { label_ko: `; TRP ${trps}≥3 → 다변측위 가능`, label_en: `; TRP ${trps}≥3 → multilateration possible` }
      return {
        label_ko: `MT-LR 실패 — UE unreachable (MICO/CM-IDLE)${geom.label_ko}`,
        label_en: `MT-LR fail — UE unreachable (MICO/CM-IDLE)${geom.label_en}`,
      }
    },
  },
  {
    id: 'nwdaf-load-closedloop',
    ko: 'NWDAF 부하분석 폐루프', en: 'NWDAF load analytics closed-loop', zh: 'NWDAF 负载分析闭环',
    desc_ko: 'NWDAF가 기존 nfLoads/존별 트래픽을 읽어 "NF X 부하 N%, slice 부하…" 분석을 방출 → 권고 → PCF/AMF/HPA 액추에이션(폐루프). 부하>80%면 HPA 스케일아웃이 NWDAF-driven 폐루프로 라벨링되어 발화.',
    desc_en: 'NWDAF reads existing nfLoads/per-zone traffic, emits "NF X load N%, slice load…" analytics → recommendation → PCF/AMF/HPA actuation (closed loop). Above 80% the HPA scale-out fires, labelled as the NWDAF-driven closed loop.',
    desc_zh: 'NWDAF 读取现有 nfLoads/分区流量,输出 "NF X 负载 N%、切片负载…" 分析 → 建议 → PCF/AMF/HPA 执行(闭环)。超过 80% 时 HPA 扩容触发,标注为 NWDAF 驱动的闭环。',
    ref: 'TS 23.288 §6.5 NF load analytics · TS 23.501 §5.19 (auto-scaling/overload) · Nnwdaf_AnalyticsSubscription (NF_LOAD)',
    domain: 'scale', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'NWDAF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' },
      { op: 'note', text: 'AMF/UPF 파드당 용량을 낮추고 측정요원 다수 배치 후 전체 트래픽 → NWDAF 부하분석 로그 + HPA 폐루프 스케일아웃 관측.' },
    ],
    expect: () => ({
      label_ko: 'NWDAF 부하분석 → 권고 → HPA 폐루프 스케일아웃 로그 확인',
      label_en: 'Observe NWDAF load analytics → recommendation → HPA closed-loop scale-out',
    }),
  },

  // ════════ 등록/이동성 (5GMM) — TS 24.501 §5.5.1 ════════
  {
    id: 'reg-fail-amf',
    ko: '등록 실패 (AMF 부재)', en: 'Registration fail (no AMF)', zh: '注册失败 (无 AMF)',
    desc_ko: 'AMF 없음 → N1/N2 종단 부재 → RRC는 붙지만 NGAP InitialUEMessage를 받을 NF가 없어 NAS 등록 불가.',
    desc_en: 'No AMF → no N1/N2 termination → RRC attaches but no NF to receive NGAP InitialUEMessage → NAS registration impossible.',
    desc_zh: '无 AMF → 无 N1/N2 终结点 → RRC 可接入但无 NF 接收 NGAP InitialUEMessage → NAS 注册不可能。',
    ref: 'TS 23.502 §4.2.2.2 · TS 38.413 NGAP', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'removeNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('AMF')
        ? { label_ko: '등록 불가 — AMF 없음(N1/N2 종단 부재)', label_en: 'No registration — no AMF' }
        : { label_ko: '예상과 다름 (AMF 존재)', label_en: 'unexpected (AMF present)' }
    },
  },
  {
    id: 'reg-illegal-ue',
    ko: '등록 거부 #3 (Illegal UE)', en: 'Registration reject #3 (Illegal UE)', zh: '注册拒绝 #3 (非法 UE)',
    desc_ko: 'IMSI가 UDM/UDR에 없는 unknown subscriber(오프로비저닝/인증실패) → Registration Reject 5GMM #3 → USIM의 5GS 무효(전원 off까지).',
    desc_en: 'IMSI unknown at UDM/UDR (unprovisioned/auth fail) → Registration Reject 5GMM #3 → USIM invalid for 5GS until power-off.',
    desc_zh: 'IMSI 在 UDM/UDR 中为未知签约用户(未开通/鉴权失败) → Registration Reject 5GMM #3 → USIM 的 5GS 失效(直到关机)。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #3 Illegal UE', cause: '5GMM #3 Illegal UE', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'SIM 설정에서 IMSI를 한 자리라도 바꿔 미프로비저닝 IMSI로 만들면 #3 Illegal UE' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #3 — Illegal UE (unknown subscriber)', label_en: 'Registration Reject #3 — Illegal UE' }),
  },
  {
    id: 'reg-illegal-me-eir',
    ko: '등록 거부 #6 (Illegal ME)', en: 'Registration reject #6 (Illegal ME)', zh: '注册拒绝 #6 (非法 ME)',
    desc_ko: '5G-EIR PEI(IMEI) 블랙리스트(도난/미인증 단말) → AMF가 Registration Reject 5GMM #6 Illegal ME.',
    desc_en: '5G-EIR PEI(IMEI) blacklisted (stolen/non-certified) → AMF Registration Reject 5GMM #6 Illegal ME.',
    desc_zh: '5G-EIR 的 PEI(IMEI) 在黑名单(被盗/未认证) → AMF 发送 Registration Reject 5GMM #6 非法 ME。',
    ref: 'TS 24.501 §5.5.1 · TS 23.502 §4.2.2 (5G-EIR N5g-eir) · 5GMM #6', cause: '5GMM #6 Illegal ME', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: '5G-EIR' },
      { op: 'note', text: '5G-EIR에 PEI를 blacklist로 등록 → ME check 실패 → #6 Illegal ME' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #6 — Illegal ME (EIR blacklist)', label_en: 'Registration Reject #6 — Illegal ME' }),
  },
  {
    id: 'reg-plmn-not-allowed',
    ko: '등록 거부 #11 (PLMN 불허)', en: 'Registration reject #11 (PLMN not allowed)', zh: '注册拒绝 #11 (PLMN 不允许)',
    desc_ko: '로밍 협정 없는 PLMN 선택 → Registration Reject 5GMM #11 → forbidden PLMN list에 추가(수동 선택 전까지 재시도 금지).',
    desc_en: 'Selected a PLMN with no roaming agreement → Registration Reject 5GMM #11 → added to forbidden PLMN list.',
    desc_zh: '选择了无漫游协议的 PLMN → Registration Reject 5GMM #11 → 加入 forbidden PLMN 列表(手动选择前禁止重试)。',
    ref: 'TS 24.501 §5.5.1 · 5GMM #11 PLMN not allowed', cause: '5GMM #11', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' },
      { op: 'note', text: 'VPLMN-B에 홈 협정/SEPP 없음 → #11 PLMN not allowed → forbidden list' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #11 — PLMN not allowed (forbidden PLMN)', label_en: 'Registration Reject #11 — PLMN not allowed' }),
  },
  {
    id: 'reg-ta-not-allowed',
    ko: '등록 거부 #12 (TA 불허)', en: 'Registration reject #12 (TA not allowed)', zh: '注册拒绝 #12 (TA 不允许)',
    desc_ko: '해당 Tracking Area가 가입자에 미허용 → Registration Reject 5GMM #12 → 이 TA에서만 서비스 제한.',
    desc_en: 'This Tracking Area not allowed for subscriber → Registration Reject 5GMM #12.',
    desc_zh: '该 Tracking Area 对签约用户不允许 → Registration Reject 5GMM #12。',
    ref: 'TS 24.501 §5.5.1 · 5GMM #12 TA not allowed', cause: '5GMM #12', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RU의 TAC를 미허용 TA로 설정 → #12 TA not allowed' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #12 — TA not allowed', label_en: 'Registration Reject #12 — TA not allowed' }),
  },
  {
    id: 'reg-roaming-not-allowed-ta',
    ko: '등록 거부 #13 (이 TA 로밍 불허)', en: 'Registration reject #13 (roaming not allowed in TA)', zh: '注册拒绝 #13 (该 TA 不允许漫游)',
    desc_ko: '로밍 가입자가 허용되지 않은 TA 진입 → Registration Reject 5GMM #13 → equivalent-PLMN list에서 삭제.',
    desc_en: 'Roamer enters TA where roaming not allowed → Registration Reject 5GMM #13 → removed from equivalent-PLMN list.',
    desc_zh: '漫游用户进入不允许漫游的 TA → Registration Reject 5GMM #13 → 从 equivalent-PLMN 列表删除。',
    ref: 'TS 24.501 §5.5.1 · 5GMM #13 Roaming not allowed in this TA', cause: '5GMM #13', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'note', text: 'VPLMN-B의 특정 TA만 로밍 제한 → #13 Roaming not allowed in this TA' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #13 — Roaming not allowed in this TA', label_en: 'Registration Reject #13 — Roaming not allowed in TA' }),
  },
  {
    id: 'reg-congestion-t3346',
    ko: '등록 거부 #22 (혼잡+T3346)', en: 'Registration reject #22 (congestion+T3346)', zh: '注册拒绝 #22 (拥塞+T3346)',
    desc_ko: 'AMF NAS 레벨 혼잡 제어 → Registration Reject 5GMM #22 + T3346 백오프(무보호시 random ≈15-30min). 긴급/고우선/MT만 허용.',
    desc_en: 'AMF NAS congestion control → Registration Reject 5GMM #22 + T3346 back-off (random if unprotected). Only emergency/high-prio/MT allowed.',
    desc_zh: 'AMF NAS 级拥塞控制 → Registration Reject 5GMM #22 + T3346 退避(未保护时随机)。仅紧急/高优先/MT 允许。',
    ref: 'TS 24.501 §5.3.20 · 5GMM #22 Congestion · T3346', cause: '5GMM #22 + T3346', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'AMF 레플리카=1·용량↓로 과부하 유발 후 대량 등록 → #22 + T3346' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #22 — Congestion (T3346 backoff)', label_en: 'Registration Reject #22 — Congestion (T3346)' }),
  },
  {
    id: 'reg-no-slices',
    ko: '등록 거부 #62 (슬라이스 없음)', en: 'Registration reject #62 (no slices)', zh: '注册拒绝 #62 (无切片)',
    desc_ko: 'Requested NSSAI 전부 미허용/미가입 → NSSF가 Allowed NSSAI 산출 실패 → Registration Reject 5GMM #62 No network slices available.',
    desc_en: 'All requested NSSAI rejected → NSSF cannot derive Allowed NSSAI → Registration Reject 5GMM #62 No network slices available.',
    desc_zh: '所有请求的 NSSAI 均不允许 → NSSF 无法生成 Allowed NSSAI → Registration Reject 5GMM #62 无可用网络切片。',
    ref: 'TS 24.501 §5.5.1 · TS 23.501 §5.15 · 5GMM #62', cause: '5GMM #62', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NSSF' },
      { op: 'note', text: 'UE가 미가입 S-NSSAI만 요청 → Allowed NSSAI 공집합 → #62' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #62 — No network slices available', label_en: 'Registration Reject #62 — No slices' }),
  },
  {
    id: 'reg-restricted-area',
    ko: '등록 수락+제한 #28', en: 'Registration accept+restricted #28', zh: '注册接受+受限 #28',
    desc_ko: 'Restricted service area → 등록은 수락되나 서비스 제한, 비허용 구역 이동 시 거부 5GMM #28.',
    desc_en: 'Restricted service area → registration accepted but service restricted; moving into non-allowed area → 5GMM #28.',
    desc_zh: 'Restricted service area → 注册接受但服务受限;移动到非允许区域 → 5GMM #28。',
    ref: 'TS 24.501 §5.5.1 · 5GMM #28 Restricted service area', cause: '5GMM #28', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'Non-allowed area TAI로 이동 → #28 Restricted service area' },
    ],
    expect: () => ({ label_ko: '#28 Restricted service area (수락+제한)', label_en: '#28 Restricted service area' }),
  },

  // ════════ 인증/보안 (5G-AKA/EAP-AKA') — TS 33.501 ════════
  {
    id: 'auth-fail-ausf',
    ko: '인증 실패 (AUSF 부재)', en: 'Auth fail (no AUSF)', zh: '鉴权失败 (无 AUSF)',
    desc_ko: 'AUSF 없음 → AMF/SEAF가 Nausf_UEAuthentication 시작 불가 → 5G-AKA 미완 → Registration Reject.',
    desc_en: 'No AUSF → SEAF cannot start Nausf_UEAuthentication → 5G-AKA incomplete → Registration Reject.',
    desc_zh: '无 AUSF → SEAF 无法发起 Nausf_UEAuthentication → 5G-AKA 未完成 → Registration Reject。',
    ref: 'TS 33.501 §6.1.2 (Nausf_UEAuthentication) · TS 24.501 Registration Reject', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'removeNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('AUSF')
        ? { label_ko: 'Registration Reject — 인증 불가(AUSF 없음)', label_en: 'Registration Reject — no AUSF' }
        : { label_ko: '예상과 다름 (AUSF 존재)', label_en: 'unexpected (AUSF present)' }
    },
  },
  {
    id: 'auth-mac-failure',
    ko: '인증 실패 #20 (MAC failure)', en: 'Auth failure #20 (MAC failure)', zh: '鉴权失败 #20 (MAC 失败)',
    desc_ko: 'K(root key) 불일치/미스프로비저닝 → USIM이 AUTN MAC 검증 실패 → AUTHENTICATION FAILURE 5GMM #20 MAC failure.',
    desc_en: 'K mismatch/misprovision → USIM AUTN MAC check fails → AUTHENTICATION FAILURE 5GMM #20 MAC failure.',
    desc_zh: 'K(根密钥) 不匹配/未开通 → USIM 的 AUTN MAC 校验失败 → AUTHENTICATION FAILURE 5GMM #20 MAC 失败。',
    ref: 'TS 33.501 §6.1.3.1 · TS 24.501 · 5GMM #20 MAC failure', cause: '5GMM #20 MAC failure', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UDM/USIM의 K를 불일치시키면 MAC 검증 실패 → #20' },
    ],
    expect: () => ({ label_ko: 'AUTHENTICATION FAILURE #20 — MAC failure', label_en: 'AUTH FAILURE #20 — MAC failure' }),
  },
  {
    id: 'auth-sync-failure',
    ko: '인증 재동기 #21 (Synch failure)', en: 'Auth resync #21 (Synch failure)', zh: '鉴权重同步 #21 (同步失败)',
    desc_ko: 'SQN 범위 벗어남 → USIM이 AUTS 포함 AUTHENTICATION FAILURE #21 → AUSF/UDM 재동기 → 재인증. 2연속 실패 시 reject.',
    desc_en: 'SQN out of range → USIM sends AUTHENTICATION FAILURE #21 with AUTS → AUSF/UDM resync → re-auth. Two in a row → reject.',
    desc_zh: 'SQN 超出范围 → USIM 发送含 AUTS 的 AUTHENTICATION FAILURE #21 → AUSF/UDM 重同步 → 重新鉴权。连续两次 → 拒绝。',
    ref: 'TS 33.501 §6.1.3.3 (AUTS resync) · 5GMM #21 Synch failure', cause: '5GMM #21 Synch failure', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'USIM SQN을 UDM보다 앞서거나 뒤처지게 하면 #21 Synch failure + AUTS 재동기' },
    ],
    expect: () => ({ label_ko: 'AUTH FAILURE #21 — Synch failure (AUTS 재동기)', label_en: 'AUTH FAILURE #21 — Synch failure (AUTS)' }),
  },
  {
    id: 'auth-eap-akaprime-fail',
    ko: 'EAP-AKA\' 인증 거부', en: 'EAP-AKA\' Authentication-Reject', zh: 'EAP-AKA\' 鉴权拒绝',
    desc_ko: 'EAP-AKA\'(AUSF=EAP 서버) 방식에서 AUTN 무효/AT_MAC 실패 → EAP-Request/AKA\'-Challenge 실패 → EAP-Failure/Authentication-Reject.',
    desc_en: 'EAP-AKA\' (AUSF=EAP server): invalid AUTN/AT_MAC fail → EAP-Failure/Authentication-Reject.',
    desc_zh: 'EAP-AKA\'(AUSF=EAP 服务器):AUTN 无效/AT_MAC 失败 → EAP-Failure/Authentication-Reject。',
    ref: 'TS 33.501 §6.1.3.1 · RFC 9048 EAP-AKA\'', cause: 'EAP Authentication-Reject', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '인증방식을 EAP-AKA\'로 두고 키/AUTN 불일치 → EAP-Failure' },
    ],
    expect: () => ({ label_ko: 'EAP-Failure — Authentication-Reject', label_en: 'EAP-Failure — Authentication-Reject' }),
  },
  {
    id: 'auth-suci-deconceal-fail',
    ko: 'SUCI de-concealment 실패', en: 'SUCI de-concealment failure', zh: 'SUCI 解隐藏失败',
    desc_ko: 'HN Public Key ID mismatch/키 rollover/프로파일 불일치 → UDM SIDF가 SUCI→SUPI 복원 실패 → Identity Request 반복/인증 불가.',
    desc_en: 'HN key ID mismatch/rollover/profile mismatch → UDM SIDF fails to de-conceal SUCI→SUPI → repeated Identity Request / auth fail.',
    desc_zh: 'HN 公钥 ID 不匹配/密钥轮换/方案不匹配 → UDM SIDF 无法将 SUCI 解隐藏为 SUPI → 反复 Identity Request / 鉴权失败。',
    ref: 'TS 33.501 §6.12 (SUCI/SIDF, Profile A/B) · Annex C', cause: 'SIDF de-conceal fail', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'SIM 보호스킴/HN 키를 UDM과 불일치 → SUCI de-conceal 실패' },
    ],
    expect: () => ({ label_ko: 'SUCI de-concealment 실패 → Identity Request/인증 불가', label_en: 'SUCI de-conceal fail → Identity Request' }),
  },
  {
    id: 'auth-pei-blacklist',
    ko: 'PEI 블랙리스트 #6 (Illegal ME)', en: 'PEI blacklist #6 (Illegal ME)', zh: 'PEI 黑名单 #6 (非法 ME)',
    desc_ko: '5G-EIR 조회에서 PEI(IMEI) blacklisted(도난 단말) → EIR 200 OK(status=BLACKLISTED) → TS 29.524 매핑 → AMF Registration Reject #6 Illegal ME.',
    desc_en: '5G-EIR: PEI(IMEI) blacklisted → N5g-eir 200 OK (status=BLACKLISTED) → TS 29.524 mapping → AMF Registration Reject #6 Illegal ME.',
    desc_zh: '5G-EIR 查询:PEI(IMEI) 在黑名单 → EIR 200 OK(status=BLACKLISTED) → TS 29.524 映射 → AMF Registration Reject #6 非法 ME。',
    ref: 'TS 29.511/29.524 (N5g-eir EquipmentStatus) · TS 24.501 · 5GMM #6', cause: '5GMM #6 Illegal ME', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: '5G-EIR' },
      { op: 'note', text: 'N5g-eir EquipmentStatus 200 OK (status=BLACKLISTED) → TS 29.524 매핑 → Registration Reject #6' },
    ],
    expect: () => ({ label_ko: '#6 Illegal ME (EIR status=BLACKLISTED)', label_en: '#6 Illegal ME (EIR blacklisted)' }),
  },
  {
    id: 'emergency-pei-reject',
    ko: '긴급등록 PEI 거절 #5', en: 'Emergency PEI reject #5', zh: '紧急注册 PEI 拒绝 #5',
    desc_ko: 'PEI(IMEI)를 신원으로 사용한 비인증 긴급 등록에서 EIR 정책상 거절 → 5GMM #5 PEI not accepted (블랙리스트 #6과 별개).',
    desc_en: 'Unauthenticated emergency registration using PEI as identity, rejected by EIR policy → 5GMM #5 PEI not accepted (distinct from blacklist #6).',
    desc_zh: '以 PEI(IMEI) 作为身份的未鉴权紧急注册,被 EIR 策略拒绝 → 5GMM #5 PEI not accepted(与黑名单 #6 区分)。',
    ref: 'TS 24.501 §5.5.1 · TS 23.167 emergency · 5GMM #5', cause: '5GMM #5 PEI not accepted', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: '5G-EIR' },
      { op: 'note', text: 'USIM 없이 PEI 신원으로 긴급 등록 시도 → 운용자 정책상 #5 PEI not accepted' },
    ],
    expect: () => ({ label_ko: '#5 PEI not accepted (긴급등록, PEI 신원)', label_en: '#5 PEI not accepted (emergency, PEI identity)' }),
  },

  // ════════ PDU 세션 (5GSM) — TS 24.501 §6.4.1 ════════
  {
    id: 'pdu-fail-smf',
    ko: 'PDU 거부 (SMF 부재)', en: 'PDU reject (no SMF)', zh: 'PDU 拒绝 (无 SMF)',
    desc_ko: '등록은 되나 SMF 없음 → AMF의 Nsmf_PDUSession_CreateSMContext 대상 없음 → 세션 미생성 → 5GSM #26/#38.',
    desc_en: 'Registered but no SMF → no target for CreateSMContext → no session → 5GSM #26/#38.',
    desc_zh: '注册成功但无 SMF → 无 CreateSMContext 目标 → 会话未创建 → 5GSM #26/#38。',
    ref: 'TS 23.502 §4.3.2 · 5GSM #26/#38', cause: '5GSM #26/#38', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'removeNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('SMF')
        ? { label_ko: 'PDU Session Reject — SMF 없음(#26/#38)', label_en: 'PDU Session Reject — no SMF' }
        : { label_ko: '예상과 다름 (SMF 존재)', label_en: 'unexpected (SMF present)' }
    },
  },
  {
    id: 'pdu-fail-upf-pfcp72',
    ko: 'PDU 거부 (UPF 부재, PFCP 72)', en: 'PDU reject (no UPF, PFCP 72)', zh: 'PDU 拒绝 (无 UPF, PFCP 72)',
    desc_ko: 'UPF 없음 → SMF의 N4 PFCP Session Est 대상/association 없음 → PFCP cause 72 No established PFCP Association → 5GSM #26.',
    desc_en: 'No UPF → no N4 PFCP association/target → PFCP cause 72 No established PFCP Association → 5GSM #26.',
    desc_zh: '无 UPF → 无 N4 PFCP association/目标 → PFCP cause 72 No established PFCP Association → 5GSM #26。',
    ref: 'TS 29.244 §8.2.1 PFCP cause 72 · 5GSM #26', cause: 'PFCP 72 → 5GSM #26', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'removeNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('UPF')
        ? { label_ko: 'PFCP cause 72 → PDU Reject #26 (UPF 없음)', label_en: 'PFCP 72 → PDU Reject #26' }
        : { label_ko: '예상과 다름 (UPF 존재)', label_en: 'unexpected (UPF present)' }
    },
  },
  {
    id: 'pdu-fail-dn-netfail',
    ko: 'PDU 실패 #38 (DN 차단)', en: 'PDU fail #38 (DN off)', zh: 'PDU 失败 #38 (DN 断开)',
    desc_ko: '코어는 완전하나 외부 DN(N6) 연결 차단 → 세션은 붙어도 데이터 미도달/타임아웃 → 5GSM #38 Network failure.',
    desc_en: 'Core complete but external DN(N6) down → session attaches but no data/timeout → 5GSM #38 Network failure.',
    desc_zh: '核心网完整但外部 DN(N6) 断开 → 会话可建立但无数据/超时 → 5GSM #38 Network failure。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #38 Network failure', cause: '5GSM #38', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: false },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('DN')
        ? { label_ko: 'PDU 데이터 불가 — #38 Network failure (DN 차단)', label_en: 'No data — #38 Network failure' }
        : { label_ko: '예상과 다름 (DN 정상)', label_en: 'unexpected (DN up)' }
    },
  },
  {
    id: 'pdu-unknown-dnn',
    ko: 'PDU 거부 #27 (미지 DNN)', en: 'PDU reject #27 (unknown DNN)', zh: 'PDU 拒绝 #27 (未知 DNN)',
    desc_ko: '요청 DNN이 가입/구성에 없음 → SMF가 PDU SESSION EST REJECT 5GSM #27 Missing or unknown DNN.',
    desc_en: 'Requested DNN not subscribed/configured → PDU SESSION EST REJECT 5GSM #27 Missing or unknown DNN.',
    desc_zh: '请求的 DNN 未签约/未配置 → PDU SESSION EST REJECT 5GSM #27 Missing or unknown DNN。',
    ref: 'TS 24.501 §6.4.1.4.1 · 5GSM #27', cause: '5GSM #27', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UE의 DNN을 가입 DNN과 다르게 → #27 Missing or unknown DNN' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #27 — Missing or unknown DNN', label_en: 'PDU Reject #27 — unknown DNN' }),
  },
  {
    id: 'pdu-dnn-in-slice',
    ko: 'PDU 거부 #70 (슬라이스 내 DNN 아님)', en: 'PDU reject #70 (DNN not in slice)', zh: 'PDU 拒绝 #70 (切片内无此 DNN)',
    desc_ko: 'DNN이 요청 S-NSSAI에 매핑 안 됨 → 5GSM #70 Missing or unknown DNN in a slice (#27과 구분, Rel-17 도입).',
    desc_en: 'DNN not mapped to requested S-NSSAI → 5GSM #70 Missing or unknown DNN in a slice (distinct from #27, added in Rel-17).',
    desc_zh: 'DNN 未映射到请求的 S-NSSAI → 5GSM #70 Missing or unknown DNN in a slice(与 #27 区分,Rel-17 引入)。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #70', cause: '5GSM #70', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'NSSF' },
      { op: 'note', text: 'DNN은 있으나 요청 슬라이스에 미매핑 → #70' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #70 — DNN not in slice', label_en: 'PDU Reject #70 — DNN not in slice' }),
  },
  {
    id: 'pdu-odb',
    ko: 'PDU 거부 #8 (ODB)', en: 'PDU reject #8 (ODB)', zh: 'PDU 拒绝 #8 (运营商禁止)',
    desc_ko: 'Operator Determined Barring(요금 미납/정책) → 5GSM #8 ODB(구현별 #33/#31 편차).',
    desc_en: 'Operator Determined Barring (unpaid/policy) → 5GSM #8 ODB (impl variance #33/#31).',
    desc_zh: 'Operator Determined Barring(欠费/策略) → 5GSM #8 ODB(实现差异 #33/#31)。',
    ref: 'TS 24.501 §6.4.1 · TS 23.015 ODB · 5GSM #8', cause: '5GSM #8 ODB', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UDM 구독에 ODB 플래그 → #8 Operator determined barring' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #8 — Operator determined barring', label_en: 'PDU Reject #8 — ODB' }),
  },
  {
    id: 'pdu-dnaaa-fail',
    ko: 'PDU 거부 #29 (2차 인증 실패)', en: 'PDU reject #29 (DN-AAA auth fail)', zh: 'PDU 拒绝 #29 (二次鉴权失败)',
    desc_ko: 'SMF의 EAP 2차 인증(DN-AAA) 실패 → PDU SESSION AUTHENTICATION 실패 → 5GSM #29 User authentication or authorization failed.',
    desc_en: 'SMF EAP secondary auth (DN-AAA) fails → 5GSM #29 User authentication or authorization failed.',
    desc_zh: 'SMF 的 EAP 二次鉴权(DN-AAA) 失败 → 5GSM #29 User authentication or authorization failed。',
    ref: 'TS 24.501 §6.4.1 · TS 33.501 §11.1 (DN-AAA) · 5GSM #29', cause: '5GSM #29', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'DNN에 DN-AAA 2차 인증 요구, 자격 불일치 → #29' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #29 — DN-AAA authentication failed', label_en: 'PDU Reject #29 — DN-AAA auth failed' }),
  },
  {
    id: 'pdu-ladn-out',
    ko: 'PDU 거부 #46 (LADN 영역 밖)', en: 'PDU reject #46 (out of LADN)', zh: 'PDU 拒绝 #46 (LADN 区外)',
    desc_ko: 'LADN DNN을 LADN 서비스 영역 밖에서 요청 → 5GSM #46 Out of LADN service area.',
    desc_en: 'LADN DNN requested outside LADN service area → 5GSM #46 Out of LADN service area.',
    desc_zh: '在 LADN 服务区外请求 LADN DNN → 5GSM #46 Out of LADN service area。',
    ref: 'TS 24.501 §6.4.1 · TS 23.501 §5.6.5 LADN · 5GSM #46', cause: '5GSM #46', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'LADN DNN을 LADN TAI 밖에서 요청 → #46' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #46 — Out of LADN service area', label_en: 'PDU Reject #46 — Out of LADN' }),
  },
  {
    id: 'pdu-ssc-not-supported',
    ko: 'PDU 거부 #68 (SSC 모드 미지원)', en: 'PDU reject #68 (SSC mode unsupported)', zh: 'PDU 拒绝 #68 (不支持 SSC 模式)',
    desc_ko: '요청 SSC 모드(1/2/3)가 해당 DNN/슬라이스에 미허용 → 5GSM #68 Not supported SSC mode.',
    desc_en: 'Requested SSC mode not allowed for DNN/slice → 5GSM #68 Not supported SSC mode.',
    desc_zh: '请求的 SSC 模式在该 DNN/切片不允许 → 5GSM #68 Not supported SSC mode。',
    ref: 'TS 24.501 §6.4.1 · TS 23.501 §5.6.9 SSC · 5GSM #68', cause: '5GSM #68', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '미허용 SSC mode 요청 → #68 Not supported SSC mode' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #68 — Not supported SSC mode', label_en: 'PDU Reject #68 — SSC mode unsupported' }),
  },
  {
    id: 'pdu-slice-dnn-resources',
    ko: 'PDU 거부 #67 (슬라이스+DNN 자원)', en: 'PDU reject #67 (slice+DNN resources)', zh: 'PDU 拒绝 #67 (切片+DNN 资源)',
    desc_ko: 'NSSF/NRF가 슬라이스+DNN 지원 SMF 못 찾음/자원 소진 → 5GSM #67 + T3584 back-off(만료 전 해당 S-NSSAI+DNN 조합 재시도 금지).',
    desc_en: 'No SMF for slice+DNN / resources exhausted → 5GSM #67 + T3584 back-off (no retry of that S-NSSAI+DNN until expiry).',
    desc_zh: '无支持切片+DNN 的 SMF / 资源耗尽 → 5GSM #67 + T3584 退避定时器(到期前禁止重试该 S-NSSAI+DNN)。',
    ref: 'TS 24.501 §6.4.1 · TS 23.501 §5.36 · 5GSM #67 · T3584', cause: '5GSM #67 + T3584', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'NSSF' },
      { op: 'note', text: '슬라이스+DNN 조합 SMF 없음/자원 소진 → #67' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #67 — slice+DNN resources (T3584 backoff)', label_en: 'PDU Reject #67 — slice+DNN resources (T3584)' }),
  },
  {
    id: 'pdu-slice-resources-nsac',
    ko: 'PDU 거부 #69 (NSAC 슬라이스 자원)', en: 'PDU reject #69 (NSAC slice resources)', zh: 'PDU 拒绝 #69 (NSAC 切片资源)',
    desc_ko: 'NSAC — 슬라이스당 최대 PDU 세션 초과 → SMF→NSACF 증가요청 거부 → 5GSM #69 + T3585 back-off.',
    desc_en: 'NSAC — max PDU sessions per slice exceeded → NSACF admission reject → 5GSM #69 + T3585 back-off.',
    desc_zh: 'NSAC — 每切片最大 PDU 会话数超限 → NSACF 准入拒绝 → 5GSM #69 + T3585 退避。',
    ref: 'TS 23.501 §5.36 NSAC · 5GSM #69 · T3585', cause: '5GSM #69 + T3585', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'NSSF' },
      { op: 'note', text: '슬라이스당 최대 PDU 초과(NSAC) → #69 + T3585' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #69 — slice resources (NSAC, T3585)', label_en: 'PDU Reject #69 — slice resources (NSAC)' }),
  },
  {
    id: 'pdu-5qi-unsupported',
    ko: 'QoS 거부 #59 (미지원 5QI)', en: 'QoS reject #59 (unsupported 5QI)', zh: 'QoS 拒绝 #59 (不支持的 5QI)',
    desc_ko: '요청 5QI를 네트워크가 미지원 → PDU MODIFICATION/EST에서 5GSM #59 Unsupported 5QI value(또는 #37 5GS QoS not accepted).',
    desc_en: 'Requested 5QI unsupported → 5GSM #59 Unsupported 5QI value (or #37 5GS QoS not accepted).',
    desc_zh: '请求的 5QI 不支持 → 5GSM #59 Unsupported 5QI value(或 #37 5GS QoS not accepted)。',
    ref: 'TS 24.501 §6.4.2 · 5GSM #59 / #37', cause: '5GSM #59', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' },
      { op: 'note', text: '미지원 5QI 요청 → #59 Unsupported 5QI value' },
    ],
    expect: () => ({ label_ko: 'QoS Reject #59 — Unsupported 5QI value', label_en: 'QoS Reject #59 — Unsupported 5QI' }),
  },

  // ════════ RAN/RRC/PHY — TS 38.331/321/304 ════════
  {
    id: 'ran-rrc-reject-t302',
    ko: 'RRCReject → T302 barring', en: 'RRCReject → T302 barring', zh: 'RRCReject → T302 禁止',
    desc_ko: 'gNB admission control 거부 → RRCReject(waitTime) → UE가 T302 동안 접속 시도 차단(AC0/2 제외). TS 38.331.',
    desc_en: 'gNB admission control reject → RRCReject(waitTime) → UE barred for T302 (except AC0/2).',
    desc_zh: 'gNB 准入控制拒绝 → RRCReject(waitTime) → UE 在 T302 期间被禁止接入(AC0/2 除外)。',
    ref: 'TS 38.331 §5.3.15 · T302 (RRCReject waitTime)', cause: 'RRCReject waitTime → T302', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU max_ue를 낮추고 대량 접속 → RRCReject waitTime → T302 barring' },
    ],
    expect: () => ({ label_ko: 'RRCReject(waitTime) → T302 barring', label_en: 'RRCReject(waitTime) → T302 barring' }),
  },
  {
    id: 'ran-cell-barred',
    ko: '셀 차단 (cellBarred)', en: 'Cell barred (cellBarred)', zh: '小区禁止 (cellBarred)',
    desc_ko: 'MIB/SIB1 cellBarred=barred → 300초간 이 셀 배제 + 재선택(intraFreqReselection에 따라 동주파 배제 여부). TS 38.304.',
    desc_en: 'MIB/SIB1 cellBarred=barred → cell excluded 300s + reselection. TS 38.304.',
    desc_zh: 'MIB/SIB1 cellBarred=barred → 该小区排除 300 秒 + 重选。TS 38.304。',
    ref: 'TS 38.304 §5.3.1 · TS 38.331 MIB cellBarred', cause: 'cellBarred (300s)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'note', text: 'RU를 cellBarred=barred로 두면 300s 배제·재선택' },
    ],
    expect: () => ({ label_ko: 'cellBarred — 300초 배제·재선택', label_en: 'cellBarred — excluded 300s, reselect' }),
  },
  {
    id: 'ran-t300-expiry',
    ko: 'RRC Setup 실패 (T300 만료)', en: 'RRC setup fail (T300 expiry)', zh: 'RRC 建立失败 (T300 超时)',
    desc_ko: 'RRCSetupRequest 후 응답 없음 → T300(≤2000ms) 만료 → MAC reset → RRC_IDLE 복귀(커버리지/혼잡).',
    desc_en: 'No response after RRCSetupRequest → T300(≤2000ms) expiry → MAC reset → back to RRC_IDLE.',
    desc_zh: 'RRCSetupRequest 后无响应 → T300(≤2000ms) 超时 → MAC reset → 回到 RRC_IDLE。',
    ref: 'TS 38.331 §5.3.3 · T300 (≤2000ms)', cause: 'T300 expiry → IDLE', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '셀엣지/혼잡으로 RRCSetup 무응답 → T300 만료 → IDLE' },
    ],
    expect: () => ({ label_ko: 'T300 만료 → MAC reset → RRC_IDLE', label_en: 'T300 expiry → RRC_IDLE' }),
  },
  {
    id: 'ran-rlf-reestablishment',
    ko: 'RLF → 재수립 (N310/T310/T311)', en: 'RLF → reestablishment (T310/T311)', zh: 'RLF → 重建 (T310/T311)',
    desc_ko: 'N310 연속 OOS → T310 시작 → 만료 시 RLF → T311 내 셀 선택 → RRCReestablishment. T311 만료/context 없으면 IDLE.',
    desc_en: 'N310 OOS → T310 → RLF → cell select within T311 → RRCReestablishment. If T311 expires/no context → IDLE.',
    desc_zh: 'N310 连续失步 → T310 → RLF → T311 内选小区 → RRCReestablishment。T311 超时/无上下文 → IDLE。',
    ref: 'TS 38.331 §5.3.10 RLF · N310/T310/T311', cause: 'RLF (T310) → Reestablishment', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '측정요원을 셀 경계로 이동시켜 OOS 유발 → T310 → RLF → 재수립' },
    ],
    expect: () => ({ label_ko: 'N310→T310→RLF→T311 재수립(실패시 IDLE)', label_en: 'RLF → reestablishment (else IDLE)' }),
  },
  {
    id: 'ran-ho-fail-t304',
    ko: '핸드오버 실패 (T304 만료)', en: 'Handover failure (T304 expiry)', zh: '切换失败 (T304 超时)',
    desc_ko: 'reconfigWithSync(A3 트리거) 후 target RACH 실패 → T304(50-2000ms) 만료 → HOF → source 복귀 또는 RLF.',
    desc_en: 'After reconfigWithSync(A3) target RACH fails → T304 expiry → HOF → return to source or RLF.',
    desc_zh: 'reconfigWithSync(A3) 后目标 RACH 失败 → T304 超时 → HOF → 返回源小区或 RLF。',
    ref: 'TS 38.331 §5.3.5 · T304 · MRO too-late/too-early/wrong-cell', cause: 'T304 expiry (HOF)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RU 2대(핸드오버 경계) 배치·CIO/TTT 부적절 → T304 HOF/ping-pong' },
    ],
    expect: () => ({ label_ko: 'T304 만료 → Handover Failure (source 복귀/RLF)', label_en: 'T304 expiry → HOF' }),
  },
  {
    id: 'ran-beam-failure',
    ko: '빔 실패 복구 실패 (BFR→RLF)', en: 'Beam failure (BFR→RLF)', zh: '波束失败 (BFR→RLF)',
    desc_ko: 'FR2 빔 blockage(손/몸/코너) → BFI 카운트 → 후보 빔 없음/타이머 만료 → BFR 실패 → RLF.',
    desc_en: 'FR2 beam blockage → BFI count → no candidate beam/timer → BFR fails → RLF.',
    desc_zh: 'FR2 波束遮挡 → BFI 计数 → 无候选波束/定时器 → BFR 失败 → RLF。',
    ref: 'TS 38.321 §5.17 BFR · TS 38.213 · FR2 blockage', cause: 'BFR fail → RLF', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RU를 하이밴드(FR2, beam)로 설정, 장애물로 빔 차단 → BFR 실패→RLF' },
    ],
    expect: () => ({ label_ko: 'Beam Failure Recovery 실패 → RLF (FR2 blockage)', label_en: 'BFR fail → RLF' }),
  },

  // ════════ VoNR/IMS — TS 23.228/24.229, IR.92 ════════
  {
    id: 'vonr-fail-pcscf',
    ko: 'VoNR 실패 (P-CSCF 부재)', en: 'VoNR fail (no P-CSCF)', zh: 'VoNR 失败 (无 P-CSCF)',
    desc_ko: '데이터는 되나 P-CSCF 없음 → PCO로 P-CSCF 주소 미획득 → SIP REGISTER 진입점 없음 → IMS 등록 실패.',
    desc_en: 'Data OK but no P-CSCF → no P-CSCF address via PCO → no SIP entry point → IMS registration fails.',
    desc_zh: '数据可用但无 P-CSCF → 无法通过 PCO 获取 P-CSCF 地址 → 无 SIP 入口 → IMS 注册失败。',
    ref: 'TS 23.228 · TS 24.229 · P-CSCF discovery (PCO)', cause: 'IMS reg fail (no P-CSCF)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'removeNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      return !ims.ok && ims.missing.includes('P-CSCF')
        ? { label_ko: 'IMS 등록 불가 — P-CSCF 없음(진입점 부재)', label_en: 'IMS reg fail — no P-CSCF' }
        : { label_ko: '예상과 다름 (P-CSCF 존재)', label_en: 'unexpected (P-CSCF present)' }
    },
  },
  {
    id: 'vonr-fail-icscf',
    ko: 'VoNR 실패 (I-CSCF 부재)', en: 'VoNR fail (no I-CSCF)', zh: 'VoNR 失败 (无 I-CSCF)',
    desc_ko: 'I-CSCF 없음 → S-CSCF 조회/할당(HSS Cx) 불가 → REGISTER 라우팅 실패 → IMS 등록/통화 불가.',
    desc_en: 'No I-CSCF → cannot query/assign S-CSCF (HSS Cx) → REGISTER routing fails → no IMS registration/call.',
    desc_zh: '无 I-CSCF → 无法查询/分配 S-CSCF(HSS Cx) → REGISTER 路由失败 → 无 IMS 注册/通话。',
    ref: 'TS 23.228 · TS 24.229 · Cx (I-CSCF↔HSS)', cause: 'IMS reg fail (no I-CSCF)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'removeNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      return !ims.ok && ims.missing.includes('I-CSCF')
        ? { label_ko: 'IMS 등록 불가 — I-CSCF 없음(S-CSCF 할당 불가)', label_en: 'IMS reg fail — no I-CSCF' }
        : { label_ko: '예상과 다름 (I-CSCF 존재)', label_en: 'unexpected (I-CSCF present)' }
    },
  },
  {
    id: 'vonr-488-codec',
    ko: 'VoNR 488 (코덱 불일치)', en: 'VoNR 488 (codec mismatch)', zh: 'VoNR 488 (编解码不匹配)',
    desc_ko: 'SDP 코덱 협상 실패(AMR 필수 미제공/EVS만) → 488 Not Acceptable Here. IR.92 AMR mandatory.',
    desc_en: 'SDP codec negotiation fails (no mandatory AMR) → 488 Not Acceptable Here. IR.92 AMR mandatory.',
    desc_zh: 'SDP 编解码协商失败(无强制 AMR) → 488 Not Acceptable Here。IR.92 AMR 强制。',
    ref: 'TS 24.229 · RFC 3261 488 · GSMA IR.92', cause: 'SIP 488 Not Acceptable Here', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: '양 UE 코덱 셋 불일치(AMR 미포함) → 488' },
    ],
    expect: () => ({ label_ko: 'SIP 488 — Not Acceptable Here (codec mismatch)', label_en: 'SIP 488 — codec mismatch' }),
  },
  {
    id: 'vonr-580-precondition',
    ko: 'VoNR 580 (Precondition 실패)', en: 'VoNR 580 (precondition failure)', zh: 'VoNR 580 (前置条件失败)',
    desc_ko: 'QoS 예약(precondition, RFC3312) 실패 → 5QI=1 GBR 베어러 미확보 → 580 Precondition Failure.',
    desc_en: 'QoS reservation (precondition) fails → 5QI=1 GBR bearer not secured → 580 Precondition Failure.',
    desc_zh: 'QoS 预留(前置条件) 失败 → 5QI=1 GBR 承载未建立 → 580 Precondition Failure。',
    ref: 'TS 24.229 · RFC 3312/3313 · SIP 580', cause: 'SIP 580 Precondition Failure', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' },
      { op: 'note', text: 'PCF N5 QoS 예약 실패(자원부족) → 580 Precondition Failure' },
    ],
    expect: () => ({ label_ko: 'SIP 580 — Precondition Failure (GBR 예약 실패)', label_en: 'SIP 580 — Precondition Failure' }),
  },
  {
    id: 'vonr-503-overload',
    ko: 'VoNR 503 (IMS 과부하)', en: 'VoNR 503 (IMS overload)', zh: 'VoNR 503 (IMS 过载)',
    desc_ko: 'S-CSCF/TAS 과부하 → SIP 503 Service Unavailable + Retry-After → UE 재시도. (mid-call이면 통화 중 끊김)',
    desc_en: 'S-CSCF/TAS overload → SIP 503 Service Unavailable + Retry-After → UE retries.',
    desc_zh: 'S-CSCF/TAS 过载 → SIP 503 Service Unavailable + Retry-After → UE 重试。',
    ref: 'TS 24.229 · RFC 3261 503', cause: 'SIP 503 Service Unavailable', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'S-CSCF 레플리카=1·용량↓ 후 대량 REGISTER/INVITE → 503 + Retry-After' },
    ],
    expect: () => ({ label_ko: 'SIP 503 — Service Unavailable (Retry-After)', label_en: 'SIP 503 — Service Unavailable' }),
  },
  {
    id: 'vonr-eps-fallback',
    ko: 'EPS Fallback (VoNR→4G)', en: 'EPS Fallback (VoNR→4G)', zh: 'EPS Fallback (VoNR→4G)',
    desc_ko: 'gNB가 5QI=1 GBR 자원 미제공 → INVITE 중 EPS Fallback(N26 HO 또는 RRCRelease+redirect) → LTE VoLTE로 통화(~0.8-3s 추가).',
    desc_en: 'gNB cannot provide 5QI=1 GBR → EPS Fallback during INVITE (N26 HO or RRCRelease+redirect) → call on LTE VoLTE.',
    desc_zh: 'gNB 无法提供 5QI=1 GBR → INVITE 期间 EPS Fallback(N26 HO 或 RRCRelease+redirect) → 在 LTE VoLTE 上通话。',
    ref: 'TS 23.502 §4.13.6.1 EPS fallback · TS 23.216', cause: 'EPS Fallback (N26/redirect)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'setDn', zone: 'A', on: true }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'gNB VoNR 미지원/GBR 미확보 → EPS Fallback → LTE에서 통화' },
    ],
    expect: () => ({ label_ko: 'EPS Fallback → LTE VoLTE 통화(N26/redirect)', label_en: 'EPS Fallback → LTE VoLTE call' }),
  },
  {
    id: 'inter-plmn-call-ok',
    ko: '국가 간 통화 성립 (IPX)', en: 'Inter-PLMN call OK (IPX)', zh: '跨 PLMN 通话建立 (IPX)',
    desc_ko: 'A·B 양측 완전 코어+IMS(P/I/S-CSCF)+SEPP(IPX SIP 트렁크) → 국가 간 VoNR 통화 성립.',
    desc_en: 'Both A/B full core+IMS+SEPP (IPX SIP trunk) → inter-PLMN VoNR call OK.',
    desc_zh: '双侧 A/B 完整核心网+IMS+SEPP(IPX SIP 干线) → 跨 PLMN VoNR 通话建立。',
    ref: 'TS 23.228 · GSMA IR.65/AA.80 (IPX) · SEPP N32', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'AUSF' }, { op: 'ensureNf', zone: 'B', type: 'UDM' },
      { op: 'ensureNf', zone: 'B', type: 'SMF' }, { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'setDn', zone: 'B', on: true },
      { op: 'ensureNf', zone: 'B', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'B', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'B', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensurePerson', zone: 'A', name: 'UE-A1' }, { op: 'ensurePerson', zone: 'B', name: 'UE-B1' },
    ],
    expect: (c) => {
      const call = computeCall(c.objects, c.coreNfs, c.coreDn, 'A', 'B')
      return call.ok
        ? { label_ko: '국가 간 통화 가능 (A↔B, IPX)', label_en: 'Inter-PLMN call OK (A↔B)' }
        : { label_ko: `통화 불가: ${call.missing.join(', ')}`, label_en: `No call: ${call.missing.join(', ')}` }
    },
  },
  {
    id: 'inter-plmn-call-fail-sepp',
    ko: '국가 간 통화 실패 (SEPP 부재)', en: 'Inter-PLMN call fail (no SEPP)', zh: '跨 PLMN 通话失败 (无 SEPP)',
    desc_ko: '양측 코어+IMS 완비하나 SEPP 없음 → IPX SIP 트렁크(N32 근사) 불가 → 국가 간 통화 라우팅 실패.',
    desc_en: 'Both cores+IMS ready but no SEPP → no IPX SIP trunk (N32 proxy) → inter-PLMN call routing fails.',
    desc_zh: '双侧核心网+IMS 就绪但无 SEPP → 无 IPX SIP 干线(N32 近似) → 跨 PLMN 通话路由失败。',
    ref: 'TS 33.501 §13 SEPP/N32 · GSMA IPX SIP trunk', cause: 'No IPX/SEPP trunk', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'removeNf', zone: 'A', type: 'SEPP' },
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'AUSF' }, { op: 'ensureNf', zone: 'B', type: 'UDM' },
      { op: 'ensureNf', zone: 'B', type: 'SMF' }, { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'setDn', zone: 'B', on: true },
      { op: 'ensureNf', zone: 'B', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'B', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'B', type: 'S-CSCF' }, { op: 'removeNf', zone: 'B', type: 'SEPP' },
    ],
    expect: (c) => {
      const call = computeCall(c.objects, c.coreNfs, c.coreDn, 'A', 'B')
      return !call.ok && call.missing.some((m) => m.includes('SEPP'))
        ? { label_ko: '국가 간 통화 실패 — SEPP/IPX 없음', label_en: 'Inter-PLMN call fail — no SEPP' }
        : { label_ko: call.ok ? '예상과 다름 (통화 성립)' : `실패: ${call.missing.join(', ')}`, label_en: call.ok ? 'unexpected' : `fail: ${call.missing.join(', ')}` }
    },
  },

  // ════════ 로밍/Inter-PLMN — TS 23.501/502, 33.501 §13 ════════
  {
    id: 'roaming-fail-home-udm',
    ko: '로밍 실패 (홈 UDM 부재)', en: 'Roaming fail (no home UDM)', zh: '漫游失败 (无归属 UDM)',
    desc_ko: 'VPLMN 접속·SEPP 있음이나 홈 UDM 없음 → SEPP 경유 홈 인증(AV) 조회 실패 → 로밍 등록/인증 실패.',
    desc_en: 'VPLMN + SEPP OK but no home UDM → home auth-vector fetch via SEPP fails → roaming registration/auth fails.',
    desc_zh: 'VPLMN + SEPP 就绪但无归属 UDM → 经 SEPP 的归属鉴权向量获取失败 → 漫游注册/鉴权失败。',
    ref: 'TS 23.502 §4.2.2.2.2 · TS 33.501 §13', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'removeNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const home = c.homeZone === 'B' ? 'A' : c.homeZone
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', home)
      return !p.ok && p.missing.some((m) => m.startsWith('UDM'))
        ? { label_ko: '로밍 실패 — 홈 UDM 없음(홈 인증 불가)', label_en: 'Roaming fail — no home UDM' }
        : { label_ko: p.ok ? '예상과 다름' : `실패: ${p.missing.join(', ')}`, label_en: p.ok ? 'unexpected' : `fail: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'roaming-fail-home-upf',
    ko: '로밍 실패 (홈 UPF 부재, HR)', en: 'Roaming fail (no home UPF, HR)', zh: '漫游失败 (无归属 UPF, HR)',
    desc_ko: '홈 라우팅(HR)인데 홈 UPF(H-UPF/PSA) 없음 → N9 앵커 부재 → 로밍 데이터 경로 미완.',
    desc_en: 'Home-routed but no home UPF (H-UPF/PSA) → no N9 anchor → roaming data path incomplete.',
    desc_zh: 'Home-routed 但无归属 UPF(H-UPF/PSA) → 无 N9 锚点 → 漫游数据路径不完整。',
    ref: 'TS 23.502 §4.3.2 HR roaming · N9 anchor', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'removeNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const home = c.homeZone === 'B' ? 'A' : c.homeZone
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', home)
      return !p.ok && p.missing.includes(`UPF(${home})`)
        ? { label_ko: '로밍 데이터 불가 — 홈 UPF 없음(HR 앵커)', label_en: 'No roaming data — no home UPF' }
        : { label_ko: p.ok ? '예상과 다름' : `실패: ${p.missing.join(', ')}`, label_en: p.ok ? 'unexpected' : `fail: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'roaming-fail-visited-amf',
    ko: '로밍 실패 (방문 AMF 부재)', en: 'Roaming fail (no visited AMF)', zh: '漫游失败 (无拜访 AMF)',
    desc_ko: 'VPLMN에 AMF 없음 → RRC는 붙어도 방문망 등록 진입 불가 → 로밍 등록 실패.',
    desc_en: 'No AMF in VPLMN → RRC attaches but no visited-network registration entry → roaming registration fails.',
    desc_zh: 'VPLMN 无 AMF → RRC 可接入但无拜访网注册入口 → 漫游注册失败。',
    ref: 'TS 23.502 §4.2.2.2.2 roaming registration', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'removeNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const home = c.homeZone === 'B' ? 'A' : c.homeZone
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', home)
      return !p.ok && p.missing.includes('AMF(B)')
        ? { label_ko: '로밍 등록 불가 — 방문 AMF 없음', label_en: 'No roaming reg — no visited AMF' }
        : { label_ko: p.ok ? '예상과 다름' : `실패: ${p.missing.join(', ')}`, label_en: p.ok ? 'unexpected' : `fail: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'roaming-sor-fail',
    ko: 'SoR 검증 실패', en: 'SoR verification failure', zh: 'SoR 校验失败',
    desc_ko: 'Steering of Roaming 정보를 VPLMN이 변조 → SoR-MAC-IAUSF 검증 실패 → UE가 SoR 무시(홈 지정 PLMN 미적용).',
    desc_en: 'VPLMN tampers SoR → SoR-MAC-IAUSF verification fails → UE discards SoR (home steering not applied).',
    desc_zh: 'VPLMN 篡改 SoR → SoR-MAC-IAUSF 校验失败 → UE 丢弃 SoR(归属引导未生效)。',
    ref: 'TS 33.501 §6.14 SoR · TS 23.122 · GSMA', cause: 'SoR-MAC verification fail', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'VPLMN이 SoR 리스트 변조 → SoR-MAC 검증 실패 → UE discard' },
    ],
    expect: () => ({ label_ko: 'SoR-MAC 검증 실패 → UE가 SoR 무시', label_en: 'SoR-MAC fail → UE discards SoR' }),
  },
  {
    id: 'roaming-sepp-cert-fail',
    ko: '로밍 outage (SEPP 인증서)', en: 'Roaming outage (SEPP cert)', zh: '漫游中断 (SEPP 证书)',
    desc_ko: 'N32-c mTLS 핸드셰이크에서 SEPP 인증서 만료/SAN 불일치/revoked → HTTP/2 종료 → 로밍 신호 전면 차단(필드 1위 원인).',
    desc_en: 'N32-c mTLS: SEPP cert expired/SAN mismatch/revoked → HTTP/2 teardown → all roaming signaling blocked (top field cause).',
    desc_zh: 'N32-c mTLS:SEPP 证书过期/SAN 不匹配/吊销 → HTTP/2 断开 → 漫游信令全面阻断(现网首要原因)。',
    ref: 'TS 33.501 §13 · TS 29.573 N32 · GSMA NG.113 PKI', cause: 'N32-c cert validation fail', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: 'SEPP 인증서 만료/SAN 불일치 → N32-c mTLS 실패 → 로밍 outage' },
    ],
    expect: () => ({ label_ko: 'N32-c mTLS 실패 (SEPP cert) → 로밍 전면 차단', label_en: 'N32-c mTLS fail → roaming outage' }),
  },

  // ════════ 스케일/과부하/NF 이중화 — TS 23.501 §5.19/5.21 ════════
  {
    id: 'amf-pod-down-no-standby',
    ko: 'AMF 파드 다운 (이중화 없음)', en: 'AMF pod down (no standby)', zh: 'AMF Pod 宕机 (无备用)',
    desc_ko: '단일 인스턴스 AMF pod 다운(레플리카=1) → NRF에 가용 AMF 없음 → failover 불가 → 등록 불가(warm/cold=재등록 스톰).',
    desc_en: 'Single AMF pod down (replica=1) → no available AMF at NRF → no failover → no registration.',
    desc_zh: '单实例 AMF pod 宕机(replica=1) → NRF 无可用 AMF → 无法 failover → 无法注册。',
    ref: 'TS 23.501 §5.21 NF resilience · TS 29.510 NRF', cause: 'No AMF failover', domain: 'scale', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'disableNf', zone: 'A', type: 'AMF' },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return !e.ok && e.missing.includes('AMF')
        ? { label_ko: 'AMF pod 다운 → failover 불가 → 등록 불가', label_en: 'AMF down → no failover → no reg' }
        : { label_ko: '예상과 다름 (AMF 가용)', label_en: 'unexpected (AMF up)' }
    },
  },
  {
    id: 'nrf-spof',
    ko: 'NRF 장애 (SPOF)', en: 'NRF outage (SPOF)', zh: 'NRF 故障 (单点)',
    desc_ko: 'NRF 다운 → NF discovery/registration 불가 → 신규 NF 선택·failover 마비(SCP와 함께 SBA SPOF). 기존 세션은 잔존.',
    desc_en: 'NRF down → NF discovery/registration fails → new NF selection/failover paralyzed (SBA SPOF with SCP).',
    desc_zh: 'NRF 宕机 → NF 发现/注册失败 → 新 NF 选择/failover 瘫痪(与 SCP 同为 SBA 单点)。',
    ref: 'TS 29.510 NRF · TS 23.501 §6.2.6 · SBA SPOF', cause: 'NRF SPOF (discovery fail)', domain: 'scale', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'removeNf', zone: 'A', type: 'NRF' },
      { op: 'note', text: 'NRF 없음 → 신규 NF discovery/failover 불가(SBA SPOF)' },
    ],
    expect: () => ({ label_ko: 'NRF SPOF — NF discovery/failover 불가', label_en: 'NRF SPOF — discovery/failover down' }),
  },
  {
    id: 'nf-oom-death-spiral',
    ko: 'NF 파드 OOMKilled (death-spiral)', en: 'NF pod OOMKilled (death-spiral)', zh: 'NF Pod OOMKilled (雪崩)',
    desc_ko: '부하 급증 → pod OOMKilled → HPA 스케일 지연 → 남은 pod로 부하 집중 → 연쇄 재시작(death-spiral). 선행지표 pre-scale 필요.',
    desc_en: 'Load surge → pod OOMKilled → HPA lag → load concentrates on survivors → cascading restarts (death-spiral).',
    desc_zh: '负载激增 → pod OOMKilled → HPA 扩容滞后 → 负载集中到存活 pod → 级联重启(雪崩)。',
    ref: 'TS 23.501 §5.19 overload · K8s HPA/OOM · cloud-native', cause: 'OOMKilled / HPA lag', domain: 'scale', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'HPA 끄고 capacity_per_pod↓ 후 부하 급증 → OOMKilled 연쇄' },
    ],
    expect: () => ({ label_ko: 'NF OOMKilled → HPA lag → death-spiral', label_en: 'NF OOMKilled → HPA lag → death-spiral' }),
  },

  // ════════ 사용자평면 PFCP/GTP-U — TS 29.244/29.281 ════════
  {
    id: 'up-pfcp-no-association',
    ko: 'PFCP 72 (association 없음)', en: 'PFCP 72 (no association)', zh: 'PFCP 72 (无关联)',
    desc_ko: 'SMF↔UPF PFCP association 미형성(설정/네트워크 문제) → Session Est 시 PFCP cause 72 No established PFCP Association → 세션 불가.',
    desc_en: 'No SMF↔UPF PFCP association → Session Est returns PFCP cause 72 No established PFCP Association.',
    desc_zh: 'SMF↔UPF 无 PFCP association → Session Est 返回 PFCP cause 72 No established PFCP Association。',
    ref: 'TS 29.244 §6.2.6 Association · §8.2.1 cause 72', cause: 'PFCP 72', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'N4 association 미형성(UPF apn/PFCP down) → cause 72' },
    ],
    expect: () => ({ label_ko: 'PFCP cause 72 — No established PFCP Association', label_en: 'PFCP 72 — no association' }),
  },
  {
    id: 'up-teid-mismatch-blackhole',
    ko: '단방향 (DL black-hole, TEID)', en: 'One-way (DL black-hole, TEID)', zh: '单向 (DL 黑洞, TEID)',
    desc_ko: 'DL F-TEID/PDR 미프로그램 or TEID 불일치 → UL은 나가는데 DL 응답 미도달("ping 나가는데 응답 없음"). GTP-U black-hole.',
    desc_en: 'DL F-TEID/PDR not programmed or TEID mismatch → UL goes out but DL never arrives ("ping out, no reply"). GTP-U black-hole.',
    desc_zh: 'DL F-TEID/PDR 未编程或 TEID 不匹配 → UL 发出但 DL 无回("ping 发出无响应")。GTP-U 黑洞。',
    ref: 'TS 29.281 GTP-U · TS 29.244 · DL F-TEID', cause: 'TEID mismatch → DL black-hole', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UPF 재시작 후 stale TEID → DL black-hole(UL만 성공)' },
    ],
    expect: () => ({ label_ko: 'DL black-hole (TEID 불일치) — UL만 성공', label_en: 'DL black-hole (TEID mismatch)' }),
  },
  {
    id: 'up-ip-pool-exhausted',
    ko: 'UE IP 소진 (PFCP 79)', en: 'UE IP exhausted (PFCP 79)', zh: 'UE IP 耗尽 (PFCP 79)',
    desc_ko: 'UPF UE IP 풀 소진 → PFCP cause 79 All dynamic addresses are occupied → 5GSM #26 Insufficient resources.',
    desc_en: 'UPF UE IP pool exhausted → PFCP cause 79 All dynamic addresses occupied → 5GSM #26.',
    desc_zh: 'UPF UE IP 池耗尽 → PFCP cause 79 All dynamic addresses occupied → 5GSM #26。',
    ref: 'TS 29.244 §8.2.1 cause 79 · 5GSM #26', cause: 'PFCP 79 → 5GSM #26', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UE IP 풀을 작게 두고 대량 세션 → cause 79 → #26' },
    ],
    expect: () => ({ label_ko: 'PFCP 79 (IP 소진) → PDU #26', label_en: 'PFCP 79 (IP exhausted) → #26' }),
  },
  {
    id: 'up-gtpu-error-indication',
    ko: 'GTP-U Error Indication', en: 'GTP-U Error Indication', zh: 'GTP-U Error Indication',
    desc_ko: 'gNB/UPF 재시작 후 unknown TEID로 GTP-U 패킷 수신 → Error Indication 반송 → 해당 세션 폐기. path switch 중 흔함.',
    desc_en: 'After gNB/UPF restart, GTP-U packet for unknown TEID → Error Indication returned → session dropped.',
    desc_zh: 'gNB/UPF 重启后收到 unknown TEID 的 GTP-U 包 → 返回 Error Indication → 会话丢弃。',
    ref: 'TS 29.281 §7.3.1 Error Indication', cause: 'GTP-U Error Indication', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'gNB/UPF 재시작으로 stale TEID → Error Indication → 세션 폐기' },
    ],
    expect: () => ({ label_ko: 'GTP-U Error Indication → 세션 폐기', label_en: 'GTP-U Error Indication → session drop' }),
  },
  {
    id: 'up-mtu-pmtud-blackhole',
    ko: 'MTU/PMTUD black-hole', en: 'MTU/PMTUD black-hole', zh: 'MTU/PMTUD 黑洞',
    desc_ko: 'GTP-U 오버헤드(~36B) 미고려 → Link MTU(~1358B, PCO 미설정) 초과 프레임 → fragment/DF drop → 큰 패킷만 실패(PMTUD black-hole).',
    desc_en: 'GTP-U overhead (~36B) unaccounted → frames exceed link MTU (~1358B, PCO unset) → drop → only large packets fail (PMTUD black-hole).',
    desc_zh: '未计 GTP-U 开销(~36B) → 超过链路 MTU(~1358B, PCO 未设) → 丢弃 → 仅大包失败(PMTUD 黑洞)。',
    ref: 'TS 23.501 §5.6.10 · TS 29.281 · Link MTU/PCO', cause: 'MTU/PMTUD black-hole', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'Link MTU/PCO 미설정 → 큰 패킷 drop(작은 ping은 성공)' },
    ],
    expect: () => ({ label_ko: 'MTU/PMTUD black-hole — 큰 패킷만 실패', label_en: 'MTU/PMTUD black-hole — large pkts fail' }),
  },

  // ════════ 과금(CHF)/정책(PCF) — TS 32.290/23.503 ════════
  {
    id: 'chf-out-of-credit',
    ko: '크레딧 소진 (FUI=TERMINATE)', en: 'Out of credit (FUI=TERMINATE)', zh: '信用耗尽 (FUI=TERMINATE)',
    desc_ko: 'CHF 온라인 과금 잔액 소진 → Final Unit Indication=TERMINATE → SMF가 PDU 세션 해제(데이터 중단).',
    desc_en: 'CHF online-charging balance depleted → Final Unit Indication=TERMINATE → SMF releases PDU session.',
    desc_zh: 'CHF 在线计费余额耗尽 → Final Unit Indication=TERMINATE → SMF 释放 PDU 会话。',
    ref: 'TS 32.290/291 Nchf · FUI=TERMINATE', cause: 'FUI=TERMINATE (out of credit)', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'CHF' },
      { op: 'note', text: 'CHF 잔액 0 → FUI=TERMINATE → 세션 해제' },
    ],
    expect: () => ({ label_ko: 'Out of credit → FUI=TERMINATE → 세션 해제', label_en: 'Out of credit → FUI=TERMINATE' }),
  },
  {
    id: 'chf-quota-drop',
    ko: '쿼터 소진 (URR→FAR DROP)', en: 'Quota exhausted (URR→FAR DROP)', zh: '配额耗尽 (URR→FAR DROP)',
    desc_ko: 'URR 사용량 임계/쿼터 소진 → CHF 재승인 실패 → FAR Apply Action=DROP("X MB 후 정지"). 데이터 캡 스로틀.',
    desc_en: 'URR usage threshold/quota exhausted → CHF re-auth fails → FAR Apply Action=DROP ("stop after X MB").',
    desc_zh: 'URR 用量阈值/配额耗尽 → CHF 重授权失败 → FAR Apply Action=DROP("X MB 后停止")。',
    ref: 'TS 29.244 URR/FAR · TS 32.255 · data-cap', cause: 'URR quota → FAR DROP', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'CHF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' },
      { op: 'note', text: '데이터 쿼터 소진 → URR 임계 → FAR DROP' },
    ],
    expect: () => ({ label_ko: '쿼터 소진 → FAR DROP (data-cap 정지)', label_en: 'Quota exhausted → FAR DROP' }),
  },
  {
    id: 'pcf-res-alloc-fail',
    ko: 'PCC 설치 실패 (RES_ALLO_FAIL)', en: 'PCC install fail (RES_ALLO_FAIL)', zh: 'PCC 安装失败 (RES_ALLO_FAIL)',
    desc_ko: 'dynamic PCC rule의 dedicated QoS flow가 gNB에서 설정 실패 → ruleReports INACTIVE + RES_ALLO_FAIL(open5gs/srsRAN invalid-qos-combination 실사례).',
    desc_en: 'Dynamic PCC rule dedicated QoS flow fails at gNB → ruleReports INACTIVE + RES_ALLO_FAIL (real open5gs/srsRAN invalid-qos-combination).',
    desc_zh: '动态 PCC 规则的 dedicated QoS flow 在 gNB 建立失败 → ruleReports INACTIVE + RES_ALLO_FAIL(open5gs/srsRAN invalid-qos-combination 实例)。',
    ref: 'TS 29.512 N7 · TS 23.503 · RES_ALLO_FAIL', cause: 'RES_ALLO_FAIL / invalid-qos', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'PCF' },
      { op: 'note', text: 'dedicated GBR flow 설정 실패 → RES_ALLO_FAIL, ruleReports INACTIVE' },
    ],
    expect: () => ({ label_ko: 'PCC 설치 실패 — RES_ALLO_FAIL (invalid-qos-combination)', label_en: 'PCC fail — RES_ALLO_FAIL' }),
  },
  {
    id: 'bsf-lookup-fail',
    ko: 'BSF 조회 실패 → VoNR QoS 실패', en: 'BSF lookup fail → VoNR QoS fail', zh: 'BSF 查询失败 → VoNR QoS 失败',
    desc_ko: 'AF(P-CSCF)의 UE-IP→PCF 바인딩 조회에서 BSF가 매칭 없음 → 204 No Content(404 아님) → 올바른 PCF 못 찾음 → N5 QoS 요청 실패 → VoNR GBR 미확보.',
    desc_en: 'AF(P-CSCF) UE-IP→PCF binding lookup: no match → BSF returns 204 No Content (not 404) → cannot find right PCF → N5 QoS request fails → VoNR GBR not secured.',
    desc_zh: 'AF(P-CSCF) 的 UE-IP→PCF 绑定查询无匹配 → BSF 返回 204 No Content(不是 404) → 找不到正确 PCF → N5 QoS 请求失败 → VoNR GBR 未建立。',
    ref: 'TS 29.521 Nbsf §5 (GET binding = 204 No Content on no match) · TS 23.503', cause: 'BSF 204 No Content (no binding)', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'removeNf', zone: 'A', type: 'BSF' },
      { op: 'note', text: 'BSF 없음 → AF의 PCF 바인딩 조회 실패 → VoNR QoS 실패' },
    ],
    expect: () => ({ label_ko: 'BSF 204 No Content → PCF 못 찾음 → VoNR QoS 실패', label_en: 'BSF 204 No Content → VoNR QoS fail' }),
  },

  // ════════ IoT/RedCap/URLLC — TS 38.300/23.501 ════════
  {
    id: 'redcap-barred',
    ko: 'RedCap 접속 불가 (SIB indicator)', en: 'RedCap access barred (SIB indicator)', zh: 'RedCap 接入受限 (SIB 指示)',
    desc_ko: 'SIB1에 RedCap indicator 없음/1-Rx barred → RedCap UE가 초기접속 admission 거부(Msg1/Msg3 조기식별).',
    desc_en: 'No RedCap indicator in SIB1 / 1-Rx barred → RedCap UE denied admission (Msg1/Msg3 early identification).',
    desc_zh: 'SIB1 无 RedCap indicator / 1-Rx barred → RedCap UE 被拒绝接入(Msg1/Msg3 早期识别)。',
    ref: 'TS 38.331 SIB1 RedCap-r17 · TS 38.300', cause: 'RedCap barred (SIB1)', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RU SIB1에 RedCap indicator 미방송/1-Rx barred → RedCap 접속 불가' },
    ],
    expect: () => ({ label_ko: 'RedCap 접속 불가 (SIB1 indicator 없음/1-Rx barred)', label_en: 'RedCap barred (SIB1)' }),
  },
  {
    id: 'iot-psm-mt-fail',
    ko: 'PSM MT 실패 (페이징 불가)', en: 'PSM MT fail (unpageable)', zh: 'PSM MT 失败 (无法寻呼)',
    desc_ko: 'IoT UE PSM active-time 만료로 딥슬립 → 페이징 도달 불가 → MT 데이터/SMS 실패 또는 다음 TAU까지 지연(HLcom 버퍼).',
    desc_en: 'IoT UE in PSM (active-time expired) → unreachable to paging → MT data/SMS fails or delayed until next TAU (HLcom buffer).',
    desc_zh: 'IoT UE 进入 PSM(active-time 到期) → 寻呼无法到达 → MT 数据/SMS 失败或延迟至下次 TAU(HLcom 缓冲)。',
    ref: 'TS 23.501 §5.4.1 PSM · TS 23.682 HLcom', cause: 'PSM unreachable (MT fail)', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'IoT UE를 PSM(긴 주기)으로 두고 MT 트래픽 → 페이징 실패/지연' },
    ],
    expect: () => ({ label_ko: 'PSM deep-sleep → MT 페이징 불가(지연/실패)', label_en: 'PSM → MT paging fail' }),
  },
  {
    id: 'urllc-survival-time',
    ko: 'URLLC survival time 위반', en: 'URLLC survival time violation', zh: 'URLLC 生存时间违规',
    desc_ko: 'delay-critical GBR(5QI 82/83/85) PDB 초과 연속 → survival time 위반 → 제어루프/앱 실패. PDCP duplication/redundant PDU로 완화.',
    desc_en: 'Delay-critical GBR (5QI 82/83/85) PDB exceeded in a row → survival time violated → control-loop/app failure.',
    desc_zh: 'delay-critical GBR(5QI 82/83/85) 连续超 PDB → 生存时间违规 → 控制回路/应用失败。',
    ref: 'TS 23.501 Table 5.7.4-1 · TS 22.261 survival time', cause: 'Survival time violation', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '실시간(URLLC) 트래픽+혼잡으로 PDB 연속 초과 → survival time 위반' },
    ],
    expect: () => ({ label_ko: 'PDB 연속 초과 → survival time 위반(앱 실패)', label_en: 'PDB exceeded → survival time violation' }),
  },

  // ════════ 사설망 SNPN/PNI-NPN — TS 23.501 §5.30 ════════
  {
    id: 'snpn-nid-not-allowed',
    ko: 'SNPN 거부 #74 (NID 임시 불허)', en: 'SNPN reject #74 (NID temp)', zh: 'SNPN 拒绝 #74 (NID 临时不允许)',
    desc_ko: 'SNPN NID 미허용/locally-managed 충돌 → Registration Reject 5GMM #74 (temporarily not authorized for this SNPN).',
    desc_en: 'SNPN NID not allowed / locally-managed collision → Registration Reject 5GMM #74 (temporarily not authorized).',
    desc_zh: 'SNPN NID 不允许 / locally-managed 冲突 → Registration Reject 5GMM #74(临时未授权)。',
    ref: 'TS 24.501 · TS 23.501 §5.30 SNPN · 5GMM #74', cause: '5GMM #74 (SNPN temp)', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'UDM' },
      { op: 'note', text: 'SNPN(존 C)에서 미허용 NID → #74 temporarily not authorized' },
    ],
    expect: () => ({ label_ko: 'SNPN Reject #74 — temporarily not authorized', label_en: 'SNPN Reject #74 — temp not authorized' }),
  },
  {
    id: 'cag-not-authorized',
    ko: 'CAG 거부 #76', en: 'CAG reject #76', zh: 'CAG 拒绝 #76',
    desc_ko: 'PNI-NPN CAG-only UE가 미허용 CAG-ID 셀 접속 → Registration Reject 5GMM #76 (LIMITED-SERVICE) → allowed CAG list 갱신 필요.',
    desc_en: 'PNI-NPN CAG-only UE on non-allowed CAG-ID cell → Registration Reject 5GMM #76 (LIMITED-SERVICE).',
    desc_zh: 'PNI-NPN 的 CAG-only UE 接入非允许 CAG-ID 小区 → Registration Reject 5GMM #76(LIMITED-SERVICE)。',
    ref: 'TS 24.501 · TS 23.501 §5.30 CAG · 5GMM #76', cause: '5GMM #76 (CAG)', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' },
      { op: 'note', text: 'CAG-only UE가 미허용 CAG-ID 셀 접속 → #76' },
    ],
    expect: () => ({ label_ko: 'CAG Reject #76 (allowed CAG list 갱신 필요)', label_en: 'CAG Reject #76' }),
  },

  // ════════ 멀티RAT/측위/희귀 — TS 23.501/23.273 ════════
  {
    id: 'nssaa-fail',
    ko: 'NSSAA 실패 → S-NSSAI 제거', en: 'NSSAA fail → S-NSSAI removed', zh: 'NSSAA 失败 → 移除 S-NSSAI',
    desc_ko: '슬라이스별 인증(NSSAA, NSSAAF→AAA-S) EAP 실패 → 해당 S-NSSAI가 Allowed NSSAI에서 제거(전부 실패 시 #62, N1 비활성).',
    desc_en: 'Slice-specific auth (NSSAA, NSSAAF→AAA-S) EAP fails → S-NSSAI removed from Allowed NSSAI (all fail → #62, N1 deactivated).',
    desc_zh: '切片专用鉴权(NSSAA, NSSAAF→AAA-S) EAP 失败 → 该 S-NSSAI 从 Allowed NSSAI 移除(全失败 → #62, N1 停用)。',
    ref: 'TS 23.502 §4.2.9 NSSAA · TS 24.501 · 5GMM #62', cause: 'NSSAA fail (→ #62)', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'NSSAAF' },
      { op: 'note', text: 'NSSAA 대상 슬라이스에서 DN-AAA 인증 실패 → S-NSSAI 제거' },
    ],
    expect: () => ({ label_ko: 'NSSAA 실패 → S-NSSAI 제거(전부 실패 시 #62)', label_en: 'NSSAA fail → S-NSSAI removed' }),
  },
  {
    id: 'n3iwf-wifi-reg',
    ko: '비3GPP Wi-Fi 등록 (N3IWF)', en: 'Non-3GPP Wi-Fi reg (N3IWF)', zh: '非 3GPP Wi-Fi 注册 (N3IWF)',
    desc_ko: 'untrusted Wi-Fi → N3IWF 경유 EAP-5G over IKEv2 → 같은 AMF에 3GPP+non-3GPP 동시등록. PDU는 QoS flow별 IPsec Child SA.',
    desc_en: 'Untrusted Wi-Fi → EAP-5G over IKEv2 via N3IWF → dual 3GPP+non-3GPP registration on same AMF.',
    desc_zh: '非可信 Wi-Fi → 经 N3IWF 的 EAP-5G over IKEv2 → 同一 AMF 上 3GPP+non-3GPP 双注册。',
    ref: 'TS 24.502 · TS 23.502 §4.12 · N3IWF', cause: 'N3IWF (non-3GPP access)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true }, { op: 'ensureNf', zone: 'A', type: 'N3IWF' },
      { op: 'note', text: 'RU 없이 N3IWF(Wi-Fi) 경유 EAP-5G 등록 → non-3GPP access' },
    ],
    expect: () => ({ label_ko: 'N3IWF 경유 non-3GPP 등록 (EAP-5G/IKEv2)', label_en: 'N3IWF non-3GPP registration' }),
  },

  // ════════ 추가: PDU 세션 절차 (5GSM) — TS 24.501 §6.3/6.4 ════════
  {
    id: 'pdu-modification-ok',
    ko: 'PDU 세션 수정 성공 (QoS 추가)', en: 'PDU Session Modification OK (QoS added)', zh: 'PDU 会话修改成功 (新增 QoS)',
    desc_ko: 'UE 주도 PDU Session Modification → SMF가 PCF SM Policy 갱신·PFCP Session Modification → MODIFICATION COMMAND/COMPLETE로 신규 QoS rule(QFI 추가) 반영.',
    desc_en: 'UE-initiated PDU Session Modification → SMF updates PCF SM policy + PFCP Session Modification → MODIFICATION COMMAND/COMPLETE adds new QoS rule (extra QFI).',
    desc_zh: 'UE 主导的 PDU 会话修改 → SMF 更新 PCF SM 策略 + PFCP 会话修改 → MODIFICATION COMMAND/COMPLETE 添加新 QoS 规则(新增 QFI)。',
    ref: 'TS 24.501 §6.3.2 · TS 23.502 §4.3.3', cause: '5GSM (regular modification)', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'PDU Session Modification 성공 (QoS rule 추가)', label_en: 'PDU Session Modification OK (QoS rule added)' }),
  },
  {
    id: 'pdu-ue-release',
    ko: 'PDU 세션 해제 성공 #36', en: 'PDU Session Release OK #36', zh: 'PDU 会话释放成功 #36',
    desc_ko: 'UE 주도 PDU Session Release Request → SMF: RELEASE COMMAND (5GSM #36 regular deactivation) → PFCP N4 Delete → RELEASE COMPLETE.',
    desc_en: 'UE-initiated PDU Session Release Request → SMF RELEASE COMMAND (5GSM #36 regular deactivation) → PFCP N4 Delete → RELEASE COMPLETE.',
    desc_zh: 'UE 主导的 PDU 会话释放请求 → SMF: RELEASE COMMAND (5GSM #36 常规去激活) → PFCP N4 Delete → RELEASE COMPLETE。',
    ref: 'TS 24.501 §6.3.3 · 5GSM #36', cause: '5GSM #36 regular deactivation', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'PDU Session Release 성공 (#36 regular deactivation)', label_en: 'PDU Session Release OK (#36)' }),
  },
  {
    id: 'pdu-ssc2-relocation',
    ko: 'SSC mode 2 앵커 재배치 #39', en: 'SSC mode 2 anchor relocation #39', zh: 'SSC mode 2 锚点重定位 #39',
    desc_ko: 'SSC mode 2: SMF가 기존 UPF 앵커 해제(RELEASE COMMAND 5GSM #39 reactivation requested, address lifetime 없음) → UE가 신규 UPF로 즉시 재수립 (break-before-make).',
    desc_en: 'SSC mode 2: SMF releases old UPF anchor (RELEASE COMMAND 5GSM #39 reactivation requested, no address lifetime) → UE re-establishes to a new UPF (break-before-make).',
    desc_zh: 'SSC mode 2:SMF 释放旧 UPF 锚点(RELEASE COMMAND 5GSM #39 reactivation requested,无地址生存期)→ UE 立即向新 UPF 重建(break-before-make)。',
    ref: 'TS 23.501 §5.6.9.2 (SSC mode 2) · 5GSM #39', cause: '5GSM #39 reactivation requested', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UPF 인스턴스를 2개(사이트 A/B) 배치 후 앵커 재배치 → #39' },
    ],
    expect: () => ({ label_ko: 'SSC2 앵커 재배치 (#39, 신규 UPF 재수립)', label_en: 'SSC2 anchor relocation (#39, new UPF)' }),
  },
  {
    id: 'pdu-ladn-in',
    ko: 'LADN 세션 수립 성공 (지역 내)', en: 'LADN session OK (in service area)', zh: 'LADN 会话建立成功 (区域内)',
    desc_ko: 'UE 서빙 셀 TAC가 LADN 서비스 지역(TAI 목록) 내 → LADN DNN PDU 세션 수립 성공. Registration Accept의 LADN Information IE로 서비스 지역 전달됨.',
    desc_en: 'UE serving-cell TAC within the LADN service area (TAI list) → LADN DNN PDU session established. LADN Information IE in Registration Accept conveys the area.',
    desc_zh: 'UE 服务小区 TAC 在 LADN 服务区(TAI 列表)内 → LADN DNN PDU 会话建立成功。Registration Accept 的 LADN Information IE 传递服务区。',
    ref: 'TS 23.501 §5.6.5 LADN · TS 24.501', cause: 'LADN (in service area)', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'LADN PDU 세션 수립 성공 (지역 내)', label_en: 'LADN PDU session OK (in area)' }),
  },
  {
    id: 'pdu-unknown-type',
    ko: 'PDU 거부 #28 (알 수 없는 PDU 타입)', en: 'PDU reject #28 (unknown PDU type)', zh: 'PDU 拒绝 #28 (未知 PDU 类型)',
    desc_ko: 'UE가 Ethernet/Unstructured PDU 타입 요청하나 DNN은 IPv4만 구성 → 5GSM #28 Unknown PDU session type.',
    desc_en: 'UE requests Ethernet/Unstructured PDU type but DNN only supports IPv4 → 5GSM #28 Unknown PDU session type.',
    desc_zh: 'UE 请求 Ethernet/Unstructured PDU 类型但 DNN 仅配置 IPv4 → 5GSM #28 Unknown PDU session type。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #28', cause: '5GSM #28', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UE PDU 타입을 Ethernet으로, DNN은 IPv4만 → #28' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #28 — Unknown PDU session type', label_en: 'PDU Reject #28 — unknown PDU type' }),
  },
  {
    id: 'pdu-service-option-not-supported',
    ko: 'PDU 거부 #32 (서비스옵션 미지원)', en: 'PDU reject #32 (service option not supported)', zh: 'PDU 拒绝 #32 (服务选项不支持)',
    desc_ko: '망이 미지원하는 서비스 옵션(예: 로밍 UE의 LBO 미지원 DNN) 요청 → 5GSM #32 Service option not supported.',
    desc_en: 'Requested service option not supported by network (e.g. LBO-unsupported DNN for a roamer) → 5GSM #32 Service option not supported.',
    desc_zh: '请求网络不支持的服务选项(如漫游 UE 的 LBO 不支持 DNN)→ 5GSM #32 Service option not supported。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #32', cause: '5GSM #32', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '미지원 서비스 옵션 DNN 요청 → #32' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #32 — Service option not supported', label_en: 'PDU Reject #32 — service option not supported' }),
  },
  {
    id: 'pdu-not-subscribed',
    ko: 'PDU 거부 #33 (미가입 서비스옵션)', en: 'PDU reject #33 (option not subscribed)', zh: 'PDU 拒绝 #33 (未签约服务选项)',
    desc_ko: 'UDM SDM 가입 데이터에 없는 DNN/S-NSSAI 조합 요청 → 5GSM #33 Requested service option not subscribed.',
    desc_en: 'Requested DNN/S-NSSAI combo absent from UDM SDM subscription → 5GSM #33 Requested service option not subscribed.',
    desc_zh: '请求 UDM SDM 签约数据中不存在的 DNN/S-NSSAI 组合 → 5GSM #33 Requested service option not subscribed。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #33', cause: '5GSM #33', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '가입에 없는 DNN/S-NSSAI 요청 → #33' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #33 — Requested service option not subscribed', label_en: 'PDU Reject #33 — not subscribed' }),
  },
  {
    id: 'pdu-session-not-exist',
    ko: 'PDU 5GSM STATUS #54 (세션 없음)', en: '5GSM STATUS #54 (PDU session does not exist)', zh: '5GSM STATUS #54 (会话不存在)',
    desc_ko: 'SMF 재시작으로 SM 컨텍스트 소실 후 UE가 기존 PSI로 Modification 송신 → 망이 5GSM STATUS #54 회신 → UE 로컬 해제 후 재수립.',
    desc_en: 'After SMF restart loses SM context, UE sends Modification with old PSI → network replies 5GSM STATUS #54 → UE local release then re-establish.',
    desc_zh: 'SMF 重启丢失 SM 上下文后,UE 用旧 PSI 发送 Modification → 网络回复 5GSM STATUS #54 → UE 本地释放后重建。',
    ref: 'TS 24.501 §6.3.x (5GSM STATUS) · 5GSM #54', cause: '5GSM #54 PDU session does not exist', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'SMF를 disable→enable(재시작)해 SM 컨텍스트 소실 → 기존 PSI Modification → #54' },
    ],
    expect: () => ({ label_ko: '5GSM STATUS #54 — PDU session does not exist', label_en: '5GSM STATUS #54 — session does not exist' }),
  },
  {
    id: 'pdu-max-sessions',
    ko: '5GMM #65 (UE당 최대 세션 초과)', en: '5GMM #65 (max PDU sessions reached)', zh: '5GMM #65 (超出最大会话数)',
    desc_ko: '기존 세션 최대치에서 추가 수립 요청 → AMF가 SMF에 미전달, DL NAS TRANSPORT로 5GMM #65 Maximum number of PDU sessions reached 회신(SMF 미관여가 핵심).',
    desc_en: 'At max PDU sessions, extra request → AMF does not forward to SMF, replies DL NAS TRANSPORT with 5GMM #65 (key: SMF not involved).',
    desc_zh: '达到最大会话数时再建立 → AMF 不转发 SMF,以 DL NAS TRANSPORT 回复 5GMM #65(关键:SMF 不参与)。',
    ref: 'TS 24.501 §5.4.5 · 5GMM #65', cause: '5GMM #65 max PDU sessions', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '최대 세션 수 도달 후 추가 요청 → DL NAS TRANSPORT #65' },
    ],
    expect: () => ({ label_ko: 'DL NAS TRANSPORT — 5GMM #65 max PDU sessions', label_en: '5GMM #65 — max PDU sessions reached' }),
  },
  {
    id: 'pdu-dnaaa-ok',
    ko: 'PDU 2차 인증 성공 (DN-AAA)', en: 'PDU secondary auth OK (DN-AAA)', zh: 'PDU 二次鉴权成功 (DN-AAA)',
    desc_ko: 'SMF의 EAP 2차 인증(DN-AAA) 성공 → PDU SESSION AUTHENTICATION COMMAND(EAP-Request) → COMPLETE(EAP-Success) → 세션 수립.',
    desc_en: 'SMF EAP secondary auth (DN-AAA) succeeds → PDU SESSION AUTHENTICATION COMMAND (EAP-Request) → COMPLETE (EAP-Success) → session established.',
    desc_zh: 'SMF 的 EAP 二次鉴权(DN-AAA)成功 → PDU SESSION AUTHENTICATION COMMAND(EAP-Request) → COMPLETE(EAP-Success) → 会话建立。',
    ref: 'TS 24.501 §6.4.1 · TS 33.501 §11.1 (DN-AAA)', cause: 'DN-AAA EAP-Success', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'DN-AAA 2차 인증 성공 → PDU 세션 수립', label_en: 'DN-AAA secondary auth OK → session established' }),
  },
  {
    id: 'pdu-ipv4-only-50',
    ko: 'PDU 타입 강등 #50 (IPv4 only)', en: 'PDU type downgrade #50 (IPv4 only)', zh: 'PDU 类型降级 #50 (仅 IPv4)',
    desc_ko: 'UE IPv4v6 요청 → ESTABLISHMENT ACCEPT 내 PDU type=IPv4 + 5GSM cause #50 PDU session type IPv4 only allowed → UE는 별도 IPv6 세션 시도 안 함.',
    desc_en: 'UE requests IPv4v6 → ACCEPT with PDU type=IPv4 + 5GSM cause #50 (IPv4 only allowed) → UE does not attempt a separate IPv6 session.',
    desc_zh: 'UE 请求 IPv4v6 → ACCEPT 内 PDU type=IPv4 + 5GSM cause #50(仅允许 IPv4)→ UE 不再尝试单独 IPv6 会话。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #50', cause: '5GSM #50 (in ACCEPT)', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'PDU 세션 수립 (IPv4, ACCEPT 내 #50)', label_en: 'PDU established (IPv4, #50 in ACCEPT)' }),
  },
  {
    id: 'slice-not-allowed',
    ko: '슬라이스 미허용 세션 요청', en: 'Session on non-allowed S-NSSAI', zh: '非允许 S-NSSAI 会话请求',
    desc_ko: '요청 S-NSSAI가 Allowed NSSAI(zone 프로비저닝 슬라이스) 밖 → AMF 단계에서 거절(DL NAS TRANSPORT 5GMM cause, SMF 미전달). Core패널에서 해당 SST 슬라이스 제거로 재현.',
    desc_en: 'Requested S-NSSAI outside Allowed NSSAI (zone-provisioned slices) → rejected at AMF (DL NAS TRANSPORT 5GMM cause, not forwarded to SMF). Reproduce by removing that SST slice in the Core panel.',
    desc_zh: '请求的 S-NSSAI 不在 Allowed NSSAI(区域已开通切片)内 → AMF 阶段拒绝(DL NAS TRANSPORT 5GMM cause,不转发 SMF)。在 Core 面板移除该 SST 切片可复现。',
    ref: 'TS 23.501 §5.15 · TS 24.501 §5.4.5', cause: 'S-NSSAI not in Allowed NSSAI', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NSSF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'addSlice', zone: 'A', sst: 1, sd: '000001' },
      { op: 'note', text: 'UE 트래픽 종류를 URLLC(SST2)/MIoT(SST3)로 두면 SST1만 허용된 존에서 슬라이스 거절 재현' },
    ],
    expect: () => ({ label_ko: '미허용 S-NSSAI 요청 → 슬라이스 거절', label_en: 'Non-allowed S-NSSAI → slice reject' }),
  },

  // ════════ 추가: 인증/보안 (TS 33.501) ════════
  {
    id: 'auth-seaf-hres-fail',
    ko: 'SEAF HRES* 검증 실패', en: 'SEAF HRES* verification fail', zh: 'SEAF HRES* 校验失败',
    desc_ko: 'SEAF(AMF)가 HRES*=SHA-256(RAND‖RES*)를 HXRES*와 비교했으나 불일치 → Authentication Reject → 등록 실패(방문망 단계 확인).',
    desc_en: 'SEAF(AMF) compares HRES*=SHA-256(RAND‖RES*) with HXRES* and mismatches → Authentication Reject → registration fails (visited-side check).',
    desc_zh: 'SEAF(AMF) 将 HRES*=SHA-256(RAND‖RES*) 与 HXRES* 比较,不匹配 → Authentication Reject → 注册失败(拜访侧校验)。',
    ref: 'TS 33.501 §6.1.3.2 · SEAF HRES* check', cause: 'SEAF HRES* != HXRES*', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'RES* 손상/재생 공격 시 SEAF HRES* 불일치 → Authentication Reject' },
    ],
    expect: () => ({ label_ko: 'SEAF HRES* 불일치 → Authentication Reject', label_en: 'SEAF HRES* mismatch → Authentication Reject' }),
  },
  {
    id: 'auth-ausf-res-fail',
    ko: 'AUSF RES*≠XRES* (홈 확인 실패)', en: 'AUSF RES* != XRES* (home confirm fail)', zh: 'AUSF RES* != XRES* (归属确认失败)',
    desc_ko: '방문망 HRES*는 통과했으나 홈 AUSF의 RES*==XRES* 비교 실패 → Nausf_UEAuthentication AUTHENTICATION_FAILURE → Registration Reject.',
    desc_en: 'HRES* passes at visited side but home AUSF RES*==XRES* fails → Nausf_UEAuthentication AUTHENTICATION_FAILURE → Registration Reject.',
    desc_zh: '拜访侧 HRES* 通过但归属 AUSF 的 RES*==XRES* 失败 → Nausf_UEAuthentication AUTHENTICATION_FAILURE → Registration Reject。',
    ref: 'TS 33.501 §6.1.3.2 · AUSF RES* check', cause: 'AUSF RES* != XRES*', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '홈 AUSF의 XRES* 불일치 → AUTHENTICATION_FAILURE' },
    ],
    expect: () => ({ label_ko: 'AUSF RES*≠XRES* → 홈 확인 실패', label_en: 'AUSF RES* != XRES* → home confirm fail' }),
  },
  {
    id: 'auth-ngksi-in-use',
    ko: '인증 실패 #71 (ngKSI 사용중)', en: 'Auth failure #71 (ngKSI already in use)', zh: '鉴权失败 #71 (ngKSI 已使用)',
    desc_ko: 'AMF가 기존 보안컨텍스트와 같은 ngKSI로 Auth Request → UE가 5GMM #71 ngKSI already in use 회신 → AMF가 새 ngKSI로 재시도.',
    desc_en: 'AMF sends Auth Request with an ngKSI already tied to a security context → UE replies 5GMM #71 → AMF retries with a fresh ngKSI.',
    desc_zh: 'AMF 使用已绑定安全上下文的 ngKSI 发送 Auth Request → UE 回复 5GMM #71 → AMF 用新 ngKSI 重试。',
    ref: 'TS 24.501 §5.4.1 · 5GMM #71', cause: '5GMM #71 ngKSI already in use', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '동일 ngKSI 재사용 → #71 → 재시도' },
    ],
    expect: () => ({ label_ko: '#71 ngKSI already in use → 재시도', label_en: '#71 ngKSI already in use → retry' }),
  },
  {
    id: 'smc-reject-23',
    ko: 'Security Mode Reject #23', en: 'Security Mode Reject #23', zh: 'Security Mode Reject #23',
    desc_ko: 'AMF가 NAS SMC에서 replay한 UE security capabilities가 UE 실제값과 불일치 → UE가 Security Mode Reject 5GMM #23 UE security capabilities mismatch.',
    desc_en: 'UE security capabilities replayed in NAS SMC mismatch the UE’s actual set → UE sends Security Mode Reject 5GMM #23.',
    desc_zh: 'AMF 在 NAS SMC 中回放的 UE 安全能力与 UE 实际值不符 → UE 发送 Security Mode Reject 5GMM #23。',
    ref: 'TS 24.501 §5.4.2 · 5GMM #23', cause: '5GMM #23 UE security cap mismatch', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'SMC replay 불일치(비트다운그레이드 공격) → #23' },
    ],
    expect: () => ({ label_ko: 'Security Mode Reject #23', label_en: 'Security Mode Reject #23' }),
  },

  // ════════ 추가: 로밍/Inter-PLMN ════════
  {
    id: 'roaming-fail-home-smf',
    ko: 'HR 로밍 실패 #38 (H-SMF 무응답)', en: 'HR roaming fail #38 (no H-SMF)', zh: 'HR 漫游失败 #38 (H-SMF 无响应)',
    desc_ko: '홈 SMF(H-SMF) 부재 → V-SMF의 N16 Nsmf_PDUSession_Create 오류 → HR PDU 세션 수립 실패 5GSM #38 network failure.',
    desc_en: 'No home SMF (H-SMF) → V-SMF N16 Nsmf_PDUSession_Create error → HR PDU session fails with 5GSM #38 network failure.',
    desc_zh: '无归属 SMF(H-SMF) → V-SMF 的 N16 Nsmf_PDUSession_Create 出错 → HR PDU 会话失败 5GSM #38 network failure。',
    ref: 'TS 23.502 §4.3.2.2.2 (HR, N16) · 5GSM #38', cause: '5GSM #38 network failure', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'removeNf', zone: 'A', type: 'SMF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', c.homeZone === 'B' ? 'A' : c.homeZone)
      return !p.ok && p.missing.some((m) => m.includes('SMF'))
        ? { label_ko: `HR 실패 — H-SMF 없음 (5GSM #38)`, label_en: `HR fail — no H-SMF (5GSM #38)` }
        : { label_ko: p.ok ? '예상과 다름 (성립)' : `실패: ${p.missing.join(', ')}`, label_en: p.ok ? 'unexpected' : `fail: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'roaming-hr-dnn-reject',
    ko: 'HR 거부 #27 (HPLMN 미가입 DNN)', en: 'HR reject #27 (DNN not subscribed in HPLMN)', zh: 'HR 拒绝 #27 (归属未签约 DNN)',
    desc_ko: '방문망 경유 홈 SMF(N16)에서 HPLMN 미가입 DNN 요청 → 5GSM #27 Missing or unknown DNN (H-SMF 판정).',
    desc_en: 'Via visited network to home SMF (N16), a DNN not subscribed in HPLMN is requested → 5GSM #27 (H-SMF decision).',
    desc_zh: '经拜访网到归属 SMF(N16)请求归属未签约的 DNN → 5GSM #27 Missing or unknown DNN(H-SMF 判定)。',
    ref: 'TS 23.502 §4.3.2 (HR) · 5GSM #27', cause: '5GSM #27 (H-SMF via N16)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '홈 미가입 DNN 요청 → H-SMF #27' },
    ],
    expect: () => ({ label_ko: 'HR PDU 거부 #27 (H-SMF, 미가입 DNN)', label_en: 'HR PDU reject #27 (unknown DNN)' }),
  },
  {
    id: 'roaming-sor-ok',
    ko: 'SoR 정상 (스티어링 리스트)', en: 'SoR OK (steering list)', zh: 'SoR 正常 (引导列表)',
    desc_ko: '로밍 등록 시 Registration Accept에 SoR transparent container(선호 PLMN 리스트, SoR-MAC-IAUSF) 전달 → UE 검증·ACK.',
    desc_en: 'On roaming registration, Registration Accept carries the SoR transparent container (preferred PLMN list, SoR-MAC-IAUSF) → UE verifies and ACKs.',
    desc_zh: '漫游注册时 Registration Accept 携带 SoR 透明容器(优选 PLMN 列表, SoR-MAC-IAUSF)→ UE 校验并 ACK。',
    ref: 'TS 23.122 §C · TS 33.501 (SoR-MAC-IAUSF)', cause: 'SoR (Steering of Roaming)', domain: 'roaming', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' }, { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'SoR 컨테이너 수신·검증 성공', label_en: 'SoR container received & verified' }),
  },
  {
    id: 'roaming-mint-reject',
    ko: '재난 로밍 거절 #80 (MINT)', en: 'Disaster roaming reject #80 (MINT)', zh: '灾难漫游拒绝 #80 (MINT)',
    desc_ko: '홈 PLMN 재난 시 협정 없는 VPLMN에 disaster roaming 등록 시도하나 미허용 → 5GMM #80 disaster roaming not allowed.',
    desc_en: 'During home-PLMN disaster, a disaster-roaming registration to a no-agreement VPLMN is not allowed → 5GMM #80.',
    desc_zh: '归属 PLMN 灾难时向无协议 VPLMN 尝试灾难漫游注册但不允许 → 5GMM #80。',
    ref: 'TS 24.501 §5.5.1 · MINT · 5GMM #80', cause: '5GMM #80 disaster roaming not allowed', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' },
      { op: 'note', text: '재난 조건 + 협정 부재 VPLMN → #80' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #80 — disaster roaming not allowed', label_en: 'Reject #80 — disaster roaming not allowed' }),
  },

  // ════════ 추가: RAN/핸드오버 (TS 38.300/23.502) ════════
  {
    id: 'ho-ngap-n2',
    ko: 'N2(NGAP) inter-gNB 핸드오버 성공', en: 'N2 (NGAP) inter-gNB handover OK', zh: 'N2(NGAP) 基站间切换成功',
    desc_ko: 'Xn 미구성(양측 xn 없음) → NGAP 경로 핸드오버: Handover Required → AMF → Handover Request/Ack → Handover Command → Handover Notify(간접 포워딩).',
    desc_en: 'No Xn between gNBs → NGAP-based handover: Handover Required → AMF → Handover Request/Ack → Handover Command → Handover Notify (indirect forwarding).',
    desc_zh: '基站间无 Xn → 基于 NGAP 的切换:Handover Required → AMF → Handover Request/Ack → Handover Command → Handover Notify(间接转发)。',
    ref: 'TS 23.502 §4.9.1.3 (N2 handover)', cause: 'N2 handover (no Xn)', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 2대 배치, 걷기 모드로 셀 경계 이동 → NGAP 핸드오버 call flow 로그' },
    ],
    expect: () => ({ label_ko: 'N2(NGAP) 핸드오버 성공 (Xn 없음)', label_en: 'N2 (NGAP) handover OK (no Xn)' }),
  },
  {
    id: 'cho-execution',
    ko: '조건부 핸드오버(CHO) 실행', en: 'Conditional handover (CHO) execution', zh: '条件切换(CHO) 执行',
    desc_ko: 'Rel-16 CHO: condReconfigToAddModList로 최적 이웃을 A3-offset−N dB에서 사전 준비 → 조건 TTT 유지 시 UE가 자율적으로 reconfigurationWithSync 실행.',
    desc_en: 'Rel-16 CHO: best neighbor pre-armed via condReconfigToAddModList at A3-offset−N dB → UE autonomously executes reconfigurationWithSync when the condition holds for TTT.',
    desc_zh: 'Rel-16 CHO:通过 condReconfigToAddModList 在 A3-offset−N dB 预配置最优邻区 → 条件维持 TTT 时 UE 自主执行 reconfigurationWithSync。',
    ref: 'TS 38.331 §5.3.5.13 (CHO)', cause: 'CHO (condEventA3)', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 2대 + 이동성 파라미터로 CHO 조건 만족 시 자율 실행' },
    ],
    expect: () => ({ label_ko: 'CHO 자율 실행 성공', label_en: 'CHO autonomous execution OK' }),
  },
  {
    id: 'reest-success',
    ko: 'RRC 재수립 성공 (컨텍스트 존재)', en: 'RRC Reestablishment OK (context found)', zh: 'RRC 重建成功 (上下文存在)',
    desc_ko: 'RLF 후 같은 존 셀로 RRCReestablishmentRequest(shortMAC-I) → XnAP Retrieve UE Context → RRCReestablishment(NCC) → Complete로 세션 유지.',
    desc_en: 'After RLF, RRCReestablishmentRequest(shortMAC-I) to a same-zone cell → XnAP Retrieve UE Context → RRCReestablishment(NCC) → Complete, session preserved.',
    desc_zh: 'RLF 后向同区小区发 RRCReestablishmentRequest(shortMAC-I) → XnAP Retrieve UE Context → RRCReestablishment(NCC) → Complete,会话保持。',
    ref: 'TS 38.331 §5.3.7 · TS 38.423 §8.2.4', cause: 'RRC Reestablishment (context found)', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 2대 배치, RLF 유발(RSRP 급락) → 인접 셀 재수립' },
    ],
    expect: () => ({ label_ko: 'RRC 재수립 성공 (컨텍스트 검색됨)', label_en: 'RRC Reestablishment OK (context retrieved)' }),
  },

  // ════════ 추가: 사용자평면 (PFCP/GTP-U) ════════
  {
    id: 'up-pfcp-assoc-ok',
    ko: 'PFCP Association 성립 (Cause 1)', en: 'PFCP Association setup OK (Cause 1)', zh: 'PFCP 关联建立成功 (Cause 1)',
    desc_ko: 'SMF↔UPF PFCP Association Setup Request/Response — Cause 1 Request accepted, Recovery Time Stamp 교환 → N4 세션 준비.',
    desc_en: 'SMF↔UPF PFCP Association Setup Request/Response — Cause 1 Request accepted, Recovery Time Stamp exchanged → N4 sessions ready.',
    desc_zh: 'SMF↔UPF PFCP Association Setup Request/Response — Cause 1 Request accepted,交换 Recovery Time Stamp → N4 会话就绪。',
    ref: 'TS 29.244 §6.2.6 · PFCP Cause 1', cause: 'PFCP Cause 1 (accepted)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'PFCP Association 성립 (Cause 1)', label_en: 'PFCP Association OK (Cause 1)' }),
  },
  {
    id: 'up-pfcp-heartbeat-timeout',
    ko: 'PFCP Heartbeat 타임아웃 → 경로 장애', en: 'PFCP Heartbeat timeout → path failure', zh: 'PFCP 心跳超时 → 路径故障',
    desc_ko: 'UPF PFCP Heartbeat 무응답(N1 재시도 소진) → path failure → 해당 N4 세션 전부 삭제 → UE 세션 드롭.',
    desc_en: 'UPF PFCP Heartbeat unanswered (N1 retries exhausted) → path failure → all N4 sessions deleted → UE sessions dropped.',
    desc_zh: 'UPF PFCP 心跳无响应(N1 重试耗尽)→ 路径故障 → 该 N4 会话全部删除 → UE 会话中断。',
    ref: 'TS 29.244 §6.2.2 (Heartbeat) · TS 23.527', cause: 'PFCP Heartbeat timeout', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UPF를 disable → Heartbeat timeout → N4 세션 삭제' },
    ],
    expect: () => ({ label_ko: 'PFCP Heartbeat timeout → N4 세션 삭제', label_en: 'PFCP Heartbeat timeout → N4 sessions deleted' }),
  },
  {
    id: 'up-gtpu-echo-timeout',
    ko: 'GTP-U Echo 타임아웃 → 베어러 해제', en: 'GTP-U Echo timeout → bearer release', zh: 'GTP-U Echo 超时 → 承载释放',
    desc_ko: 'N3 GTP-U Echo 무응답 → path failure → PDU 세션 해제. gNB↔UPF 경로 단절 시 재현.',
    desc_en: 'N3 GTP-U Echo unanswered → path failure → PDU sessions released. Reproduce by cutting the gNB↔UPF path.',
    desc_zh: 'N3 GTP-U Echo 无响应 → 路径故障 → PDU 会话释放。切断 gNB↔UPF 路径可复现。',
    ref: 'TS 29.281 (GTP-U Echo) · TS 23.527', cause: 'GTP-U Echo timeout (N3 path)', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '존의 RU 전멸 또는 UPF 불가 → N3 Echo timeout → 세션 해제' },
    ],
    expect: () => ({ label_ko: 'GTP-U Echo timeout → PDU 세션 해제', label_en: 'GTP-U Echo timeout → PDU sessions released' }),
  },

  // ════════ 추가: VoNR/IMS · SMS · Multi-RAT ════════
  {
    id: 'ims-reg-ok',
    ko: 'IMS 등록 성공 (AKA 401)', en: 'IMS registration OK (AKA 401)', zh: 'IMS 注册成功 (AKA 401)',
    desc_ko: 'ATTACHED 이후 REGISTER(IMPI/IMPU) → 401(RAND/AUTN) → IPsec SA → protected REGISTER → 200 OK(Service-Route, expires) → IMS 등록 완료.',
    desc_en: 'After ATTACHED: REGISTER(IMPI/IMPU) → 401(RAND/AUTN) → IPsec SA → protected REGISTER → 200 OK(Service-Route, expires) → IMS registered.',
    desc_zh: 'ATTACHED 后:REGISTER(IMPI/IMPU) → 401(RAND/AUTN) → IPsec SA → protected REGISTER → 200 OK(Service-Route, expires) → IMS 注册完成。',
    ref: 'TS 24.229 · TS 33.203 (IMS AKA)', cause: 'IMS AKA 200 OK', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      return ims.ok
        ? { label_ko: 'IMS 등록 성공 (200 OK)', label_en: 'IMS registered (200 OK)' }
        : { label_ko: `IMS 등록 불가: ${ims.missing.join(', ')}`, label_en: `IMS reg fail: ${ims.missing.join(', ')}` }
    },
  },
  {
    id: 'ims-reg-403',
    ko: 'IMS 등록 403 (HSS 미가입)', en: 'IMS registration 403 (no HSS subscriber)', zh: 'IMS 注册 403 (HSS 无签约)',
    desc_ko: 'I-CSCF Cx UAR → HSS: 5001 USER_UNKNOWN → SIP 403 Forbidden → IMS 등록 실패.',
    desc_en: 'I-CSCF Cx UAR → HSS: 5001 USER_UNKNOWN → SIP 403 Forbidden → IMS registration fails.',
    desc_zh: 'I-CSCF Cx UAR → HSS: 5001 USER_UNKNOWN → SIP 403 Forbidden → IMS 注册失败。',
    ref: 'TS 24.229 · TS 29.228 (Cx 5001)', cause: 'SIP 403 / Cx 5001', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'HSS에 IMS 가입자 없음 → Cx 5001 USER_UNKNOWN → 403' },
    ],
    expect: () => ({ label_ko: 'IMS 등록 403 Forbidden (Cx 5001)', label_en: 'IMS 403 Forbidden (Cx 5001)' }),
  },
  {
    id: 'vonr-mt-paging-fail',
    ko: 'VoNR MT 페이징 실패 → 480', en: 'VoNR MT paging fail → 480', zh: 'VoNR MT 寻呼失败 → 480',
    desc_ko: '착신 UE 무선상태 불가(serving 없음/전원 off) → AMF Paging ×N (T3513 만료) → UE unreachable → SIP 480 Temporarily Unavailable.',
    desc_en: 'Callee unreachable (no serving/UE off) → AMF Paging ×N (T3513 expiry) → SIP 480 Temporarily Unavailable.',
    desc_zh: '被叫 UE 无线不可达(无服务/关机)→ AMF Paging ×N (T3513 到期)→ SIP 480 Temporarily Unavailable。',
    ref: 'TS 23.502 (paging) · RFC 3261 (480)', cause: 'SIP 480 (MT paging fail)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: '착신 측정요원 전원 OFF 상태로 통화 발신 → 480' },
    ],
    expect: () => ({ label_ko: 'MT 페이징 실패 → 480 Temporarily Unavailable', label_en: 'MT paging fail → 480' }),
  },
  {
    id: 'sms-fail-smsf',
    ko: 'SMS over NAS 불가 (SMSF 없음)', en: 'SMS over NAS unavailable (no SMSF)', zh: 'SMS over NAS 不可用 (无 SMSF)',
    desc_ko: 'AMF의 NRF SMSF discovery 0건 → SMS over NAS 활성 실패 → SMS allowed=false. SMSF 프로비저닝 필요.',
    desc_en: 'AMF NRF SMSF discovery returns none → SMS over NAS activation fails → SMS allowed=false. SMSF must be provisioned.',
    desc_zh: 'AMF 的 NRF SMSF discovery 返回 0 → SMS over NAS 激活失败 → SMS allowed=false。需开通 SMSF。',
    ref: 'TS 23.502 §4.13 (SMS over NAS) · SMSF', cause: 'no SMSF (NRF discovery)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'removeNf', zone: 'A', type: 'SMSF' },
      { op: 'note', text: 'SMSF 미배치 → SMS over NAS 불가' },
    ],
    expect: (c) => {
      const smsf = c.coreNfs.find((n) => n.zone === 'A' && n.nf_type === 'SMSF' && n.enabled)
      return !smsf
        ? { label_ko: 'SMS over NAS 불가 — SMSF 없음', label_en: 'SMS over NAS unavailable — no SMSF' }
        : { label_ko: '예상과 다름 (SMSF 존재)', label_en: 'unexpected (SMSF present)' }
    },
  },
  {
    id: 'n26-idle-tau',
    ko: 'N26 기반 5GS→EPS Idle 이동(TAU)', en: 'N26 5GS→EPS idle mobility (TAU)', zh: 'N26 5GS→EPS 空闲态移动(TAU)',
    desc_ko: 'N26 인터페이스 기반 idle 모드 이동: TAU Request(4G-GUTI mapped from 5G-GUTI) → MME가 N26 Context Request → AMF → 컨텍스트 이전. TAU 성공.',
    desc_en: 'N26-based idle-mode mobility: TAU Request(4G-GUTI mapped from 5G-GUTI) → MME N26 Context Request → AMF → context transferred. TAU OK.',
    desc_zh: '基于 N26 的空闲态移动:TAU Request(由 5G-GUTI 映射的 4G-GUTI)→ MME N26 Context Request → AMF → 上下文迁移。TAU 成功。',
    ref: 'TS 23.502 §4.11.1.3.2 (N26 idle TAU)', cause: 'N26 idle TAU', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'MME/SGW/PGW + AMF 공존(N26) → TAU로 idle 이동' },
    ],
    expect: () => ({ label_ko: 'N26 idle TAU 성공 (컨텍스트 이전)', label_en: 'N26 idle TAU OK (context transferred)' }),
  },

  // ════════ SECTION A: 등록 종류 · 상태전이 · MRO · reject cause · Xn/Reroute/MICO ════════
  {
    id: 'reg-no-suitable-cells-ta',
    ko: '등록 거부 #15 (TA 내 적합셀 없음)', en: 'Registration reject #15 (no suitable cells in TA)', zh: '注册拒绝 #15 (TA 内无合适小区)',
    desc_ko: 'UE는 셀에 붙어 NAS 등록을 시도하나 AMF가 해당 TA를 이 가입자에 미허용/barred 판정 → Registration Reject 5GMM #15 No suitable cells in tracking area → UE는 같은 PLMN의 다른 TA를 탐색(#12 TA not allowed와 구분: #15는 다른 TA 재탐색 유도).',
    desc_en: 'UE camps on a cell and attempts NAS registration but the AMF bars this TA for the subscriber → Registration Reject 5GMM #15 No suitable cells in TA → UE searches another TA in the same PLMN (distinct from RRC out-of-service and from #12).',
    desc_zh: 'UE 驻留小区并尝试 NAS 注册,但 AMF 判定该 TA 对该用户不可用 → Registration Reject 5GMM #15 → UE 在同一 PLMN 内搜索其他 TA。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #15 No suitable cells in tracking area', cause: '5GMM #15 No suitable cells in TA', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RU는 있으나 AMF가 이 TA를 barred 처리 → NAS #15 (RRC 무서비스 no-suitable-cell과 다른 계층). UE는 다른 TA 탐색' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #15 — No suitable cells in TA (다른 TA 탐색)', label_en: 'Registration Reject #15 — no suitable cells in TA' }),
  },
  {
    id: 'reg-periodic',
    ko: '주기 등록 갱신 (T3512)', en: 'Periodic registration update (T3512)', zh: '周期性注册更新 (T3512)',
    desc_ko: 'T3512 만료 → periodic-registration-updating. 기존 네이티브 5G 보안컨텍스트 재사용(재인증 없음), PDU 세션 재수립 없음, T3512만 재시작. Registration Accept로 5G-GUTI 유지.',
    desc_en: 'On T3512 expiry → periodic-registration-updating. Existing native 5G security context reused (no re-auth), no PDU re-establishment, T3512 restarted only. Registration Accept keeps 5G-GUTI.',
    desc_zh: 'T3512 到期 → periodic-registration-updating。复用现有 5G 安全上下文(无重鉴权),无 PDU 重建,仅重启 T3512。',
    ref: 'TS 24.501 §5.5.1.3 · 5GS-registration-type=periodic · T3512', cause: 'periodic registration updating', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'T3512 주기 만료 시 periodic 등록갱신(재인증/PDU재수립 없음)이 발생 — 빌더 buildAttachSteps(regType=periodic)' },
    ],
    expect: () => ({ label_ko: '주기 등록 갱신 성공 (T3512 재시작, PDU 재수립 없음)', label_en: 'Periodic reg update OK (T3512 restart)' }),
  },
  {
    id: 'reg-mobility',
    ko: '이동성 등록 갱신 (TAI 변경)', en: 'Mobility registration update (TAI change)', zh: '移动性注册更新 (TAI 变更)',
    desc_ko: 'TAI(존) 변경 → mobility-registration-updating. Uplink-data-status/PDU-session-status/active-flag=1 로 사용자평면 재활성(InitialContextSetup + N4 Modification). 걷기 모드에서 존 경계를 넘으면 자동 발생.',
    desc_en: 'TAI change → mobility-registration-updating with Uplink-data-status/PDU-session-status/active-flag=1 to re-activate the user plane (InitialContextSetup + N4 Modification). Fires automatically when crossing a zone boundary in walk mode.',
    desc_zh: 'TAI 变更 → mobility-registration-updating,通过 active-flag 重新激活用户面。步行模式跨区自动触发。',
    ref: 'TS 24.501 §5.5.1.3 · 5GS-registration-type=mobility · active-flag', cause: 'mobility registration updating', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' }, { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'setDn', zone: 'B', on: true },
      { op: 'note', text: '걷기 모드로 존 경계(TAI)를 넘으면 mobility registration update 로그가 자동 방출됨' },
    ],
    expect: () => ({ label_ko: '이동성 등록 갱신 성공 (active-flag → UP 재활성)', label_en: 'Mobility reg update OK (UP reactivated)' }),
  },
  {
    id: 'mro-too-late',
    ko: 'MRO: Too-Late 핸드오버', en: 'MRO: too-late handover', zh: 'MRO: 切换过晚',
    desc_ko: 'HO Command 이전에 서빙 급락 → N310→T310 만료 RLF → 다른(원래 target이 됐어야 할) 셀에 RRCReestablishment. RLF report=handover-too-late → CIO↑/TTT↓로 A3를 더 일찍 트리거하도록 조정.',
    desc_en: 'Serving degrades before any HO command → N310→T310 RLF → RRCReestablishment in a DIFFERENT cell. RLF report=handover-too-late → raise CIO / lower TTT to trigger A3 earlier.',
    desc_zh: '在 HO 命令前服务小区骤降 → T310 超时 RLF → 在不同小区重建。RLF 报告=切换过晚 → 提高 CIO/降低 TTT。',
    ref: 'TS 38.300 §9.2.6 · TS 37.340 MRO (too-late HO)', cause: 'RLF before HO cmd → too-late (re-est in different cell)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 2대 배치 후 걷기 모드로 급격히 경계 이동(A3 늦음) → too-late RLF, 다른 셀 재수립' },
    ],
    expect: () => ({ label_ko: 'Too-late HO — HO 전 RLF → 다른 셀 재수립', label_en: 'Too-late HO — RLF before cmd → re-est different cell' }),
  },
  {
    id: 'mro-too-early',
    ko: 'MRO: Too-Early 핸드오버', en: 'MRO: too-early handover', zh: 'MRO: 切换过早',
    desc_ko: 'A3가 너무 일찍 발동 → target으로 HO 직후 RLF → source 셀로 되돌아가 RRCReestablishment. RLF report=handover-too-early → CIO↓/TTT↑/A3 offset↑로 조기 HO 억제(ping-pong 방지).',
    desc_en: 'A3 fires too early → RLF just after handover → re-establish back in the SOURCE cell. RLF report=handover-too-early → lower CIO / raise TTT / raise A3 offset.',
    desc_zh: 'A3 触发过早 → 切换后立即 RLF → 回到源小区重建。RLF 报告=切换过早 → 降低 CIO/提高 TTT。',
    ref: 'TS 38.300 §9.2.6 · TS 37.340 MRO (too-early HO)', cause: 'RLF after HO → too-early (re-est in source)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'A3 offset/TTT를 매우 공격적으로 낮춘 상태로 경계 왕복 → too-early RLF, source 재수립(ping-pong)' },
    ],
    expect: () => ({ label_ko: 'Too-early HO — HO 직후 RLF → source 재수립', label_en: 'Too-early HO — RLF after HO → re-est source' }),
  },
  {
    id: 'mro-wrong-cell',
    ko: 'MRO: Wrong-Cell 핸드오버', en: 'MRO: handover to wrong cell', zh: 'MRO: 切换到错误小区',
    desc_ko: 'target으로 HO 후 RLF → source도 target도 아닌 제3의 셀에 RRCReestablishment. RLF report=handover-to-wrong-cell → 이웃 CIO 재튜닝으로 올바른 target이 A3에서 이기도록 조정.',
    desc_en: 'HO to target then RLF → re-establish in a THIRD cell (neither source nor target). RLF report=handover-to-wrong-cell → retune neighbor CIO so the correct target wins A3.',
    desc_zh: '切换到目标后 RLF → 在第三小区重建。RLF 报告=切换到错误小区 → 重调邻区 CIO。',
    ref: 'TS 38.300 §9.2.6 · TS 37.340 MRO (wrong-cell HO)', cause: 'RLF after HO → wrong-cell (re-est in third cell)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 3대 배치(중첩), 부적절 CIO로 잘못된 target 선정 → wrong-cell RLF, 제3의 셀 재수립' },
    ],
    expect: () => ({ label_ko: 'Wrong-cell HO — HO 후 RLF → 제3의 셀 재수립', label_en: 'Wrong-cell HO — RLF → re-est in third cell' }),
  },
  {
    id: 'reg-5gs-services-not-allowed',
    ko: '등록 거부 #7 (5GS 서비스 불허)', en: 'Registration reject #7 (5GS services not allowed)', zh: '注册拒绝 #7 (不允许 5GS 服务)',
    desc_ko: '가입자가 5GS 접속 자격 없음(EPS-only 가입/5G 미가입) → AMF가 Registration Reject 5GMM #7 5GS services not allowed → UE는 5GS에서 서비스 시도 중단(4G만 가능).',
    desc_en: 'Subscriber not entitled to 5GS (EPS-only / no 5G subscription) → AMF Registration Reject 5GMM #7 5GS services not allowed → UE stops attempting 5GS (4G only).',
    desc_zh: '用户无 5GS 接入权限(仅 EPS/未签约 5G)→ AMF 发送 Registration Reject 5GMM #7 → UE 停止在 5GS 尝试服务。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #7 5GS services not allowed', cause: '5GMM #7 5GS services not allowed', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '가입자 프로필을 EPS-only(5GS 미가입)로 → UDM 판정 → #7' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #7 — 5GS services not allowed', label_en: 'Registration Reject #7 — 5GS services not allowed' }),
  },
  {
    id: 'reg-identity-cannot-be-derived',
    ko: '등록 거부 #9 (UE 식별자 도출 불가)', en: 'Registration reject #9 (identity cannot be derived)', zh: '注册拒绝 #9 (无法导出身份)',
    desc_ko: 'AMF가 제시된 5G-GUTI/SUCI로 UE 식별자를 도출/해결 불가(오래된 GUTI, SUCI de-conceal 불가, 컨텍스트 소실) → Registration Reject 5GMM #9 UE identity cannot be derived by the network → UE는 SUCI로 재시도. (#3 Illegal UE와 구분: #9는 식별 자체 불가)',
    desc_en: 'AMF cannot derive/resolve the UE identity from the presented 5G-GUTI/SUCI (stale GUTI, un-deconcealable SUCI, lost context) → Registration Reject 5GMM #9 → UE retries with SUCI. (Distinct from #3: #9 is failure to identify at all.)',
    desc_zh: 'AMF 无法从提供的 5G-GUTI/SUCI 导出 UE 身份 → Registration Reject 5GMM #9 → UE 用 SUCI 重试。(区别于 #3)',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #9 UE identity cannot be derived', cause: '5GMM #9 UE identity cannot be derived', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '오래된 5G-GUTI/해결 불가 SUCI 제시 → AMF 식별 실패 → #9 → SUCI 재시도' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #9 — identity cannot be derived (SUCI 재시도)', label_en: 'Registration Reject #9 — identity cannot be derived' }),
  },
  {
    id: 'reg-implicitly-deregistered',
    ko: '등록 거부 #10 (묵시적 등록해제)', en: 'Registration reject #10 (implicitly de-registered)', zh: '注册拒绝 #10 (隐式去注册)',
    desc_ko: 'UE가 Service Request 시도하나 AMF에 UE 컨텍스트 없음(Implicit Dereg 타이머 만료로 AMF가 이미 해제) → 5GMM #10 Implicitly de-registered → UE는 초기 등록(initial registration)으로 강제 전환.',
    desc_en: 'UE sends Service Request but the AMF has no context (implicit-dereg timer expired, AMF already released) → 5GMM #10 Implicitly de-registered → UE is forced into initial registration.',
    desc_zh: 'UE 发起 Service Request 但 AMF 无上下文(隐式去注册定时器到期)→ 5GMM #10 → UE 被迫进行初始注册。',
    ref: 'TS 24.501 §5.6.1 (Service Reject) · 5GMM #10 Implicitly de-registered', cause: '5GMM #10 Implicitly de-registered → initial registration', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'AMF가 implicit dereg으로 컨텍스트 삭제 후 UE가 Service Request → #10 → 초기 등록 재수행' },
    ],
    expect: () => ({ label_ko: 'Service Reject #10 — Implicitly de-registered → 초기 등록', label_en: 'Service Reject #10 — implicitly de-registered → initial reg' }),
  },
  {
    id: 'reg-n1-mode-not-allowed',
    ko: '등록 거부 #27 (N1 모드 불허)', en: 'Registration reject #27 (N1 mode not allowed)', zh: '注册拒绝 #27 (不允许 N1 模式)',
    desc_ko: '망 정책상 이 가입자에 N1 모드(5GC NAS) 미허용 → 5GMM #27 N1 mode not allowed → UE는 N1 mode를 disable하고 EPS(S1 모드)로 재접속/리다이렉트. (주의: 기존 "#27"은 5GSM Missing/unknown DNN으로 계층·의미가 다름 — 이건 5GMM interworking 맥락)',
    desc_en: 'Network policy disallows N1 mode (5GC NAS) for this subscriber → 5GMM #27 N1 mode not allowed → UE disables N1 mode and falls back/redirects to EPS (S1 mode). (Note: the 5GSM "#27" is Missing/unknown DNN — different layer/meaning.)',
    desc_zh: '网络策略不允许该用户使用 N1 模式 → 5GMM #27 → UE 禁用 N1 模式并回退到 EPS(S1)。(注意与 5GSM #27 DNN 不同)',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #27 N1 mode not allowed (≠ 5GSM #27 DNN)', cause: '5GMM #27 N1 mode not allowed', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: '가입/정책상 N1 모드 불허 → #27 → N1 disable, EPS(S1)로 리다이렉트' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #27 — N1 mode not allowed (EPS 폴백)', label_en: 'Registration Reject #27 — N1 mode not allowed' }),
  },
  {
    id: 'reg-redirection-epc',
    ko: '등록 거부 #31 (EPC로 리다이렉션)', en: 'Registration reject #31 (redirection to EPC)', zh: '注册拒绝 #31 (重定向到 EPC)',
    desc_ko: 'AMF가 이 UE를 5GC 대신 EPC에서 서비스하도록 결정 → 5GMM #31 Redirection to EPC required → UE는 E-UTRAN/EPS(MME)로 이동해 EPS Attach/TAU. N26/EPS-fallback 셋업 재활용.',
    desc_en: 'AMF decides to serve this UE in EPC rather than 5GC → 5GMM #31 Redirection to EPC required → UE moves to E-UTRAN/EPS (MME) and performs EPS Attach/TAU. Reuses N26/EPS-fallback setup.',
    desc_zh: 'AMF 决定用 EPC 而非 5GC 服务该 UE → 5GMM #31 → UE 转到 E-UTRAN/EPS(MME)。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #31 Redirection to EPC required', cause: '5GMM #31 Redirection to EPC required', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'AMF가 EPC 서비스 결정 → #31 → MME로 리다이렉트(EPS Attach)' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #31 — Redirection to EPC (MME 이동)', label_en: 'Registration Reject #31 — redirection to EPC' }),
  },
  {
    id: 'reg-serving-network-not-authorized',
    ko: '등록 거부 #73 (서빙망 미인가)', en: 'Registration reject #73 (serving network not authorized)', zh: '注册拒绝 #73 (服务网络未授权)',
    desc_ko: '홈망이 현재 서빙 PLMN을 인가하지 않음(AUSF/UDM 서빙망 인증 실패, serving-network-name 불일치) → 5GMM #73 Serving network not authorized → 등록 거부.',
    desc_en: 'Home network does not authorize the current serving PLMN (AUSF/UDM serving-network authentication fails, serving-network-name mismatch) → 5GMM #73 Serving network not authorized → registration rejected.',
    desc_zh: '归属网不授权当前服务 PLMN(AUSF/UDM 服务网鉴权失败)→ 5GMM #73 → 注册拒绝。',
    ref: 'TS 24.501 §5.5.1.2.5 · TS 33.501 (serving-network-name) · 5GMM #73', cause: '5GMM #73 Serving network not authorized', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '홈 AUSF/UDM이 서빙 PLMN-B를 미인가(serving-network-name 검증 실패) → #73' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #73 — Serving network not authorized', label_en: 'Registration Reject #73 — serving network not authorized' }),
  },
  {
    id: 'snpn-permanently-not-authorized',
    ko: 'SNPN 영구 미인가 #75', en: 'SNPN permanently not authorized #75', zh: 'SNPN 永久未授权 #75',
    desc_ko: '가입자가 이 SNPN에 영구적으로 미인가 → 5GMM #75 Permanently not authorized for this SNPN → UE는 해당 SNPN을 "영구 금지 SNPN" 리스트에 추가(재시도 금지). #74(현재 SNPN 미인가, 일시)의 형제 cause.',
    desc_en: 'Subscriber is permanently not authorized for this SNPN → 5GMM #75 Permanently not authorized for this SNPN → UE adds it to the permanently-forbidden-SNPN list. Sibling of #74 (temporary).',
    desc_zh: '用户对该 SNPN 永久未授权 → 5GMM #75 → UE 将其加入永久禁止 SNPN 列表。#74 的兄弟原因。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #75 (SNPN) · sibling of #74', cause: '5GMM #75 Permanently not authorized for SNPN', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'SNPN(NID) 가입 없음/영구 미인가 → #75 → 영구 금지 SNPN 리스트' },
    ],
    expect: () => ({ label_ko: '#75 — Permanently not authorized for this SNPN', label_en: '#75 — permanently not authorized for SNPN' }),
  },
  {
    id: 'smc-reject-24',
    ko: 'Security Mode Reject #24', en: 'Security Mode Reject #24', zh: 'Security Mode Reject #24',
    desc_ko: 'UE가 NAS Security Mode Command를 수용 불가하나 #23(UE security cap mismatch)이 아닌 기타 사유 → Security Mode Reject 5GMM #24 Security mode rejected, unspecified. smc-reject-23의 형제 cause.',
    desc_en: 'UE cannot accept the NAS Security Mode Command for a reason other than #23 → Security Mode Reject 5GMM #24 Security mode rejected, unspecified. Sibling of smc-reject-23.',
    desc_zh: 'UE 因 #23 以外的原因无法接受 NAS SMC → Security Mode Reject 5GMM #24(未指明)。smc-reject-23 的兄弟。',
    ref: 'TS 24.501 §5.4.2 · 5GMM #24 Security mode rejected, unspecified', cause: '5GMM #24 Security mode rejected, unspecified', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'SMC 수용 불가(기타 미지정 사유, #23 아님) → #24' },
    ],
    expect: () => ({ label_ko: 'Security Mode Reject #24 — unspecified', label_en: 'Security Mode Reject #24 — unspecified' }),
  },
  {
    id: 'ho-xn',
    ko: 'Xn 핸드오버 (직접 + Path Switch)', en: 'Xn handover (direct + Path Switch)', zh: 'Xn 切换 (直连 + Path Switch)',
    desc_ko: '같은 AMF + Xn 연결 가정 → 소스↔타겟 gNB 간 Xn Handover Request/Ack, SN Status Transfer(PDCP SN/HFN), reconfigWithSync, 이후 Path Switch Request→AMF→UPF(N3 경로 갱신)+End Marker. N2(AMF 중계) 핸드오버보다 지연 낮음.',
    desc_en: 'Same AMF + Xn assumed → Xn Handover Request/Ack directly between source/target gNB, SN Status Transfer (PDCP SN/HFN), reconfigWithSync, then Path Switch Request → AMF → UPF (N3 path update) + End Marker. Lower latency than N2 (AMF-relayed) HO.',
    desc_zh: '同 AMF + Xn → 源/目标 gNB 间直接 Xn Handover Request/Ack、SN Status Transfer、reconfigWithSync,随后 Path Switch → AMF → UPF + End Marker。比 N2 切换时延更低。',
    ref: 'TS 38.423 §8.2 (XnAP HO) · TS 23.502 §4.9.1.2 (Xn handover)', cause: 'Xn handover (Path Switch)', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 2대(Xn 연결 가정) 배치, 걷기 모드로 셀 경계 이동 → Xn handover call flow(buildHandoverSteps xn=true)' },
    ],
    expect: () => ({ label_ko: 'Xn 핸드오버 성공 (Path Switch로 N3 경로 갱신)', label_en: 'Xn handover OK (Path Switch updates N3)' }),
  },
  {
    id: 'reg-reroute-nas',
    ko: 'Reroute NAS (다중 AMF 재라우팅)', en: 'Reroute NAS (multi-AMF re-allocation)', zh: 'Reroute NAS (多 AMF 重路由)',
    desc_ko: '초기 접속 AMF가 UE의 Requested-NSSAI를 서비스 불가(슬라이스 지원 분리) → NSSF로 target AMF-Set 조회 → Reroute NAS Message로 2번째 AMF에 NAS 전달 → target AMF가 등록 완료. 슬라이스 지원이 다른 AMF 2+ 인스턴스 필요.',
    desc_en: 'Initial AMF cannot serve the UE Requested-NSSAI (disjoint slice support) → query NSSF for target AMF-Set → Reroute NAS Message hands the NAS to a 2nd AMF → target AMF completes registration. Needs ≥2 AMF instances with disjoint slice support.',
    desc_zh: '初始 AMF 无法服务 UE 请求的 NSSAI → 查询 NSSF 获取目标 AMF-Set → 通过 Reroute NAS Message 转交第二个 AMF → 目标 AMF 完成注册。',
    ref: 'TS 23.502 §4.2.2.2.3 (Registration with AMF re-allocation) · Reroute NAS Message', cause: 'Reroute NAS (AMF re-allocation)', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NSSF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'addSlice', zone: 'A', sst: 2, sd: '000002' },
      { op: 'note', text: '슬라이스 지원이 다른 AMF 2+ 인스턴스(Core 패널에서 AMF 추가) → 초기 AMF가 Requested-NSSAI 미지원 → Reroute NAS → 2번째 AMF' },
    ],
    expect: () => ({ label_ko: 'Reroute NAS → target AMF가 등록 완료', label_en: 'Reroute NAS → target AMF completes registration' }),
  },
  {
    id: 'reg-mico-unreachable',
    ko: 'MICO 모드 → MT 도달불가', en: 'MICO mode → MT unreachable', zh: 'MICO 模式 → MT 不可达',
    desc_ko: 'Registration Accept에서 MICO(Mobile Initiated Connection Only) 협상 → UE는 CM-IDLE 동안 페이징을 수신하지 않음 → MT 데이터/통화 도착 시 AMF가 페이징 억제, DL은 버퍼링만 → MT 도달불가(UE가 MO로 접속할 때까지). IoT PSM과 유사한 절전 트레이드오프.',
    desc_en: 'Registration Accept negotiates MICO (Mobile Initiated Connection Only) → UE does not monitor paging while CM-IDLE → on MT data/call, AMF suppresses paging and only buffers DL → UE unreachable for MT until it connects MO. Power-saving trade-off like IoT PSM.',
    desc_zh: 'Registration Accept 协商 MICO → UE 在 CM-IDLE 期间不监听寻呼 → MT 数据/呼叫到达时 AMF 抑制寻呼,仅缓存 DL → MT 不可达。',
    ref: 'TS 23.501 §5.4.1.3 (MICO mode) · TS 24.501', cause: 'MICO mode (MT unreachable)', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'MICO 모드 협상 시 CM-IDLE 중 MT 페이징 억제 → MT 통화/데이터 도달불가(buildPagingSteps mico=true)' },
    ],
    expect: () => ({ label_ko: 'MICO — CM-IDLE 중 MT 도달불가 (페이징 억제)', label_en: 'MICO — MT unreachable in CM-IDLE (paging suppressed)' }),
  },
  {
    id: 'sr-idle-to-connected',
    ko: 'Service Request (CM-IDLE→CONNECTED)', en: 'Service Request (CM-IDLE→CONNECTED)', zh: 'Service Request (空闲→连接)',
    desc_ko: '이미 RM-REGISTERED인 UE가 CM-IDLE에서 상향 데이터 발생 → NAS Service Request → InitialContextSetup → DRB 재수립으로 CM-CONNECTED. full re-attach가 아니라 사용자평면만 재활성. (측정요원 전원 ON 후 트래픽 시작 시 자동 방출)',
    desc_en: 'A RM-REGISTERED UE with uplink data in CM-IDLE → NAS Service Request → InitialContextSetup → DRB re-establish → CM-CONNECTED. User plane re-activated without full re-attach. (Emitted automatically when a test UE that is powered ON starts traffic.)',
    desc_zh: '已 RM-REGISTERED 的 UE 在 CM-IDLE 有上行数据 → NAS Service Request → InitialContextSetup → DRB 重建 → CM-CONNECTED。仅重新激活用户面。',
    ref: 'TS 23.502 §4.2.3.2 (UE-triggered Service Request)', cause: 'Service Request (CM-IDLE→CONNECTED)', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '측정요원 전원 ON 상태에서 트래픽 시작 → Service Request 로그(buildServiceRequestSteps) 자동 방출' },
    ],
    expect: () => ({ label_ko: 'Service Request → CM-CONNECTED (DRB 재수립)', label_en: 'Service Request → CM-CONNECTED (DRB re-est)' }),
  },
  {
    id: 'dereg-ue-switchoff',
    ko: 'UE 개시 Deregistration (switch-off)', en: 'UE-initiated Deregistration (switch-off)', zh: 'UE 发起去注册 (关机)',
    desc_ko: '측정요원 전원 OFF → Deregistration Request(switch-off) → AMF가 PDU 세션 해제(Nsmf_PDUSession_ReleaseSMContext→N4 Delete) + UEContextRelease → RM-DEREGISTERED. switch-off라 Dereg Accept 없음. (전원 OFF 시 자동 방출)',
    desc_en: 'Test UE powered OFF → Deregistration Request (switch-off) → AMF releases PDU sessions (ReleaseSMContext→N4 Delete) + UEContextRelease → RM-DEREGISTERED. No Dereg Accept for switch-off. (Emitted automatically on power OFF.)',
    desc_zh: '测试 UE 关机 → Deregistration Request(switch-off)→ AMF 释放 PDU 会话 + UEContextRelease → RM-DEREGISTERED。关机不回 Accept。',
    ref: 'TS 23.502 §4.2.2.3.2 (UE-initiated deregistration)', cause: 'UE-init deregistration (switch-off)', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '측정요원을 전원 OFF 하면 Deregistration(switch-off) 로그(buildDeregisterSteps)가 방출됨' },
    ],
    expect: () => ({ label_ko: 'Deregistration(switch-off) → RM-DEREGISTERED', label_en: 'Deregistration(switch-off) → RM-DEREGISTERED' }),
  },
  {
    id: 'dereg-nw-reregister',
    ko: '망 개시 Deregistration (재등록 요구)', en: 'NW-initiated Deregistration (re-registration required)', zh: '网络发起去注册 (要求重注册)',
    desc_ko: '망 정책 변경/가입 갱신 → AMF가 Deregistration Request(de-registration type: re-registration-required) → UE가 Dereg Accept 후 즉시 초기 등록 재수행. UE 개시 switch-off와 구분되는 NW-init 절차.',
    desc_en: 'Policy change/subscription update → AMF sends Deregistration Request (type: re-registration-required) → UE sends Dereg Accept and immediately re-registers (initial). NW-initiated, distinct from UE switch-off.',
    desc_zh: '策略变更/签约更新 → AMF 发送 Deregistration Request(要求重注册)→ UE 回 Accept 后立即重新注册。',
    ref: 'TS 23.502 §4.2.2.3.3 (network-initiated deregistration)', cause: 'NW-init deregistration (re-registration required)', domain: 'registration', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '망 정책 변경 시 AMF가 re-registration-required Deregistration → UE 재등록(buildDeregisterSteps nwInit=true)' },
    ],
    expect: () => ({ label_ko: 'NW Deregistration → UE 재등록', label_en: 'NW Deregistration → UE re-registers' }),
  },
  {
    id: 'rnau-inactive',
    ko: 'RRC_INACTIVE + RNAU', en: 'RRC_INACTIVE + RNAU', zh: 'RRC_INACTIVE + RNAU',
    desc_ko: 'gNB가 RRCRelease-with-suspend(I-RNTI, RNA, T380)로 UE를 RRC_INACTIVE 전환(5GC는 CM-CONNECTED 유지) → 주기적 RNAU(RAN Notification Area Update) 또는 데이터 발생 시 RRCResume로 빠른 재개. AN release/재설정 오버헤드 절감.',
    desc_en: 'gNB suspends UE to RRC_INACTIVE via RRCRelease-with-suspend (I-RNTI, RNA, T380) while 5GC stays CM-CONNECTED → periodic RNAU or RRCResume on data. Avoids AN release/re-setup overhead.',
    desc_zh: 'gNB 通过 RRCRelease-with-suspend 将 UE 转入 RRC_INACTIVE(5GC 保持 CM-CONNECTED)→ 周期 RNAU 或有数据时 RRCResume 快速恢复。',
    ref: 'TS 38.331 §5.3.13 (resume) · §5.3.8.3 (suspend) · RNAU', cause: 'RRC_INACTIVE / RNAU', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RRCRelease-with-suspend → RRC_INACTIVE → 주기 RNAU/RRCResume(buildRnauSteps)' },
    ],
    expect: () => ({ label_ko: 'RRC_INACTIVE 전환 + RNAU/Resume', label_en: 'RRC_INACTIVE + RNAU/Resume' }),
  },
  {
    id: 'guti-reallocation',
    ko: '5G-GUTI 재배정 (Config Update)', en: '5G-GUTI reallocation (Config Update)', zh: '5G-GUTI 重分配 (配置更新)',
    desc_ko: 'AMF가 프라이버시/이동성 목적으로 Configuration Update Command(새 5G-GUTI, TAI-list, ack-requested, T3555) → UE가 Configuration Update Complete로 새 GUTI 채택. 기존 5G-S-TMSI 해제.',
    desc_en: 'For privacy/mobility, AMF sends Configuration Update Command (new 5G-GUTI, TAI-list, ack-requested, T3555) → UE replies Configuration Update Complete adopting the new GUTI; old 5G-S-TMSI released.',
    desc_zh: 'AMF 出于隐私/移动性发送 Configuration Update Command(新 5G-GUTI, T3555)→ UE 回 Complete 采用新 GUTI。',
    ref: 'TS 24.501 §5.4.4 (Generic UE configuration update) · 5G-GUTI reallocation', cause: 'Configuration Update Command (new 5G-GUTI)', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'AMF가 Configuration Update Command로 새 5G-GUTI 재배정(buildGutiReallocSteps)' },
    ],
    expect: () => ({ label_ko: '5G-GUTI 재배정 성공 (Config Update Complete)', label_en: '5G-GUTI reallocation OK (Config Update Complete)' }),
  },
  {
    id: 'mt-paging-ddn',
    ko: 'MT 페이징 (DDN → Paging)', en: 'MT paging (DDN → Paging)', zh: 'MT 寻呼 (DDN → Paging)',
    desc_ko: 'CM-IDLE UE로 하향 데이터 도착 → UPF N4 Session Report(DLDR) → SMF → Namf N1N2MessageTransfer → AMF Paging(RAN paging area, T3513) → UE MT Service Request → 버퍼된 DL 데이터 전달. T3513 만료/무응답 시 MT 실패.',
    desc_en: 'DL data arrives for a CM-IDLE UE → UPF N4 Session Report (DLDR) → SMF → Namf N1N2MessageTransfer → AMF Paging (RAN paging area, T3513) → UE MT Service Request → buffered DL delivered. T3513 expiry/no answer → MT fails.',
    desc_zh: 'DL 数据到达 CM-IDLE UE → UPF N4 Session Report(DLDR)→ SMF → Namf N1N2MessageTransfer → AMF Paging(T3513)→ UE MT Service Request → 递交缓存 DL。',
    ref: 'TS 23.502 §4.2.3.3 (Network-triggered Service Request) · DDN/paging · T3513', cause: 'MT paging (DDN)', domain: 'registration', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'CM-IDLE UE로 MT 데이터/통화 발생 → DDN→Paging→MT Service Request(buildPagingSteps)' },
    ],
    expect: () => ({ label_ko: 'MT 페이징 성공 (DDN → Service Request → DL 전달)', label_en: 'MT paging OK (DDN → SR → DL delivered)' }),
  },

  // ════════ BULK D — PDU 세션(5GSM) 추가 ════════
  {
    id: 'pdu-reject-dnn-t3396',
    ko: 'PDU 거부 #26 (DNN 혼잡+T3396)', en: 'PDU reject #26 (DNN congestion+T3396)', zh: 'PDU 拒绝 #26 (DNN 拥塞+T3396)',
    desc_ko: '특정 DNN 혼잡 제어 → 5GSM #26 Insufficient resources + Back-off timer(T3396) IE → 만료 전 동일 DNN 재시도 금지.',
    desc_en: 'Per-DNN congestion control → 5GSM #26 Insufficient resources + Back-off timer (T3396) IE → no retry to same DNN until expiry.',
    desc_zh: '针对 DNN 的拥塞控制 → 5GSM #26 资源不足 + Back-off 定时器(T3396) → 到期前禁止对同一 DNN 重试。',
    ref: 'TS 24.501 §6.4.1 · §6.2.8 (T3396) · 5GSM #26', cause: '5GSM #26 + T3396', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '특정 DNN 혼잡 → #26 + T3396 back-off (만료 전 동일 DNN 재시도 금지)' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #26 — DNN 혼잡, T3396 back-off', label_en: 'PDU Reject #26 — DNN congestion, T3396 back-off' }),
  },
  {
    id: 'pdu-nw-modification-ok',
    ko: '망 주도 PDU Modification (PCF)', en: 'Network-init PDU Modification (PCF)', zh: '网络发起 PDU 修改 (PCF)',
    desc_ko: 'PCF 정책 변경 → Npcf_SMPolicyControl_UpdateNotify → SMF → PDU SESSION MODIFICATION COMMAND(QoS rule 추가, QFI=2 5QI=1 GBR) → COMPLETE.',
    desc_en: 'PCF policy change → Npcf_SMPolicyControl_UpdateNotify → SMF → PDU SESSION MODIFICATION COMMAND (add QoS rule, QFI=2 5QI=1 GBR) → COMPLETE.',
    desc_zh: 'PCF 策略变更 → Npcf_SMPolicyControl_UpdateNotify → SMF → PDU SESSION MODIFICATION COMMAND(新增 QoS 规则,QFI=2 5QI=1 GBR)→ COMPLETE。',
    ref: 'TS 23.502 §4.3.3.2 (PCF-initiated) · TS 24.501 §6.3.2', cause: 'PDU Modification (PCF-initiated)', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return e.ok
        ? { label_ko: '망 주도 Modification 성공 (QoS rule 추가)', label_en: 'NW-init Modification OK (QoS rule added)' }
        : { label_ko: `불가: ${e.missing.join(', ')}`, label_en: `Fail: ${e.missing.join(', ')}` }
    },
  },
  {
    id: 'pdu-mod-reject-44',
    ko: 'PDU Modification 거부 #44', en: 'PDU Modification reject #44', zh: 'PDU 修改拒绝 #44',
    desc_ko: 'UE 주도 Modification의 패킷 필터 semantic error → MODIFICATION REJECT 5GSM #44 (semantic errors in packet filter(s)).',
    desc_en: 'UE-initiated Modification with semantic error in packet filters → MODIFICATION REJECT 5GSM #44.',
    desc_zh: 'UE 发起的修改中数据包过滤器语义错误 → MODIFICATION REJECT 5GSM #44。',
    ref: 'TS 24.501 §6.3.2 · 5GSM #44', cause: '5GSM #44 semantic error in packet filters', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'Modification의 TFT 패킷필터 semantic error → #44' },
    ],
    expect: () => ({ label_ko: 'MODIFICATION REJECT #44 (semantic error)', label_en: 'MODIFICATION REJECT #44 (semantic error)' }),
  },
  {
    id: 'pdu-mod-reject-45',
    ko: 'PDU Modification 거부 #45', en: 'PDU Modification reject #45', zh: 'PDU 修改拒绝 #45',
    desc_ko: 'UE 주도 Modification의 TFT 문법 오류 → MODIFICATION REJECT 5GSM #45 (syntactical error in packet filter(s)).',
    desc_en: 'UE-initiated Modification with syntactical error in packet filters → MODIFICATION REJECT 5GSM #45.',
    desc_zh: 'UE 发起的修改中过滤器语法错误 → MODIFICATION REJECT 5GSM #45。',
    ref: 'TS 24.501 §6.3.2 · 5GSM #45', cause: '5GSM #45 syntactical error in packet filters', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'Modification의 TFT 패킷필터 syntactical error → #45' },
    ],
    expect: () => ({ label_ko: 'MODIFICATION REJECT #45 (syntactical error)', label_en: 'MODIFICATION REJECT #45 (syntactical error)' }),
  },
  {
    id: 'pdu-release-reject-43',
    ko: 'PDU Release 거부 #43', en: 'PDU Release reject #43', zh: 'PDU 释放拒绝 #43',
    desc_ko: '존재하지 않는 PSI로 RELEASE REQUEST → PDU SESSION RELEASE REJECT 5GSM #43 (Invalid PDU session identity).',
    desc_en: 'RELEASE REQUEST with a non-existent PSI → PDU SESSION RELEASE REJECT 5GSM #43 (Invalid PDU session identity).',
    desc_zh: '使用不存在的 PSI 发送 RELEASE REQUEST → PDU SESSION RELEASE REJECT 5GSM #43(无效 PDU 会话标识)。',
    ref: 'TS 24.501 §6.3.3 · 5GSM #43', cause: '5GSM #43 Invalid PDU session identity', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '미존재 PSI로 RELEASE REQUEST → RELEASE REJECT #43' },
    ],
    expect: () => ({ label_ko: 'RELEASE REJECT #43 — Invalid PDU session identity', label_en: 'RELEASE REJECT #43 — Invalid PDU session identity' }),
  },
  {
    id: 'pdu-status-43',
    ko: 'MODIFICATION COMMAND → 5GSM STATUS #43', en: 'MODIFICATION COMMAND → 5GSM STATUS #43', zh: 'MODIFICATION COMMAND → 5GSM STATUS #43',
    desc_ko: 'UE가 미보유 PSI로 MODIFICATION COMMAND 수신 → UE가 5GSM STATUS 5GSM #43 회신 → 망 로컬 해제.',
    desc_en: 'UE receives MODIFICATION COMMAND for a PSI it does not hold → UE returns 5GSM STATUS #43 → network local release.',
    desc_zh: 'UE 收到针对其未持有 PSI 的 MODIFICATION COMMAND → UE 回 5GSM STATUS #43 → 网络本地释放。',
    ref: 'TS 24.501 §6.3.x (5GSM STATUS) · 5GSM #43', cause: '5GSM #43 (via 5GSM STATUS)', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '미보유 PSI로 MODIFICATION COMMAND → UE 5GSM STATUS #43' },
    ],
    expect: () => ({ label_ko: 'UE → 5GSM STATUS #43 (PSI 미보유)', label_en: 'UE → 5GSM STATUS #43 (unknown PSI)' }),
  },
  {
    id: 'pdu-alwayson-not-allowed',
    ko: 'Always-on 요청 불허(부분)', en: 'Always-on request not granted', zh: 'Always-on 请求未获准',
    desc_ko: 'UE Always-on PDU session 요청 → ACCEPT(세션 성립)하되 "Always-on PDU session allowed" 미포함 → 일반 세션으로 동작.',
    desc_en: 'UE requests Always-on PDU session → ACCEPT (session up) but without "Always-on PDU session allowed" → behaves as a normal session.',
    desc_zh: 'UE 请求 Always-on PDU 会话 → ACCEPT(会话建立)但不含 "Always-on PDU session allowed" → 按普通会话运行。',
    ref: 'TS 24.501 §6.4.1 (Always-on PDU session indication)', cause: 'Always-on not granted (ACCEPT)', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: 'ACCEPT (Always-on 미허용) — 일반 세션', label_en: 'ACCEPT (Always-on not granted) — normal session' }),
  },
  {
    id: 'pdu-up-integrity-82',
    ko: 'PDU 거부 #82 (UP 무결성 속도)', en: 'PDU reject #82 (UP integrity rate)', zh: 'PDU 拒绝 #82 (UP 完整性速率)',
    desc_ko: 'DNN이 UP 무결성보호 required인데 UE의 max data rate for UP integrity가 요구 미달 → 5GSM #82 (Maximum data rate per UE for user-plane integrity protection is too low).',
    desc_en: 'DNN requires UP integrity protection but UE max data rate for UP integrity is too low → 5GSM #82.',
    desc_zh: 'DNN 要求 UP 完整性保护,但 UE 的 UP 完整性最大速率过低 → 5GSM #82。',
    ref: 'TS 24.501 §6.4.1 · TS 33.501 §5.10 · 5GSM #82', cause: '5GSM #82 UP integrity max data rate too low', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'DNN=UP integrity required, UE max UP-IP rate 미달 → #82' },
    ],
    expect: () => ({ label_ko: 'PDU Reject #82 — UP integrity 속도 미달', label_en: 'PDU Reject #82 — UP integrity rate too low' }),
  },
  {
    id: 'pdu-t3580-timeout',
    ko: 'PDU 수립 타임아웃 (T3580)', en: 'PDU establishment timeout (T3580)', zh: 'PDU 建立超时 (T3580)',
    desc_ko: 'SMF 무응답 → ESTABLISHMENT REQUEST 4회 재전송(T3580=16s) → 5회째 만료 시 절차 중단·PTI 해제.',
    desc_en: 'SMF unresponsive → ESTABLISHMENT REQUEST retransmitted 4× (T3580=16s) → on 5th expiry procedure aborted, PTI released.',
    desc_zh: 'SMF 无响应 → ESTABLISHMENT REQUEST 重传 4 次(T3580=16s)→ 第 5 次到期终止流程,释放 PTI。',
    ref: 'TS 24.501 §6.4.1 · T3580 (16s, 4 retx)', cause: 'T3580 expiry (16s ×5)', domain: 'pdu', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'disableNf', zone: 'A', type: 'SMF' },
      { op: 'note', text: 'SMF 무응답(disabled) → ESTABLISHMENT REQUEST 재전송 4회 후 T3580 만료' },
    ],
    expect: () => ({ label_ko: 'T3580 만료 — PDU 수립 절차 중단(PTI 해제)', label_en: 'T3580 expiry — PDU establishment aborted' }),
  },
  {
    id: 'pdu-duplicate-psi',
    ko: '중복 PSI 재수립', en: 'Duplicate PSI re-establishment', zh: '重复 PSI 重建',
    desc_ko: '동일 PSI=1로 재수립 요청 → SMF가 구 컨텍스트 로컬 해제 후 신규 수립 진행.',
    desc_en: 'Re-establishment request with the same PSI=1 → SMF locally releases the old context, then establishes the new one.',
    desc_zh: '使用相同 PSI=1 重新建立请求 → SMF 本地释放旧上下文,再建立新会话。',
    ref: 'TS 24.501 §6.4.1 (duplicate PSI collision)', cause: 'duplicate PSI → local release + re-establish', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: '구 컨텍스트 로컬 해제 → 신규 PSI=1 수립', label_en: 'old context released → new PSI=1 established' }),
  },
  {
    id: 'pdu-3gpp-non3gpp-ho',
    ko: '3GPP↔non-3GPP PDU 핸드오버', en: '3GPP↔non-3GPP PDU handover', zh: '3GPP↔non-3GPP PDU 切换',
    desc_ko: '기존 PSI를 request type="existing PDU session"으로 N3IWF 경유 재수립 → 앵커 UPF 유지, 터널만 IPsec Child SA로 전환.',
    desc_en: 'Re-establish existing PSI with request type="existing PDU session" via N3IWF → anchor UPF kept, only tunnel switches to IPsec Child SA.',
    desc_zh: '以 request type="existing PDU session" 经 N3IWF 重建现有 PSI → 保持锚点 UPF,仅隧道切换为 IPsec Child SA。',
    ref: 'TS 23.502 §4.9.2 · TS 24.501 (existing PDU session)', cause: 'Request Type=existing PDU session', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'N3IWF' }, { op: 'setDn', zone: 'A', on: true },
    ],
    expect: () => ({ label_ko: '앵커 UPF 유지, N3(3GPP)↔IPsec(non-3GPP) 전환', label_en: 'anchor UPF kept, N3↔IPsec tunnel switch' }),
  },
  {
    id: 'pdu-ssc3-relocation',
    ko: 'SSC mode 3 앵커 재배치', en: 'SSC mode 3 anchor relocation', zh: 'SSC 模式 3 锚点重定位',
    desc_ko: 'SSC mode 3 make-before-make: 신규 UPF에 세션 병행 수립 → PDU Session Address Lifetime(PCO) 만료 → 구 앵커 세션 해제.',
    desc_en: 'SSC mode 3 make-before-break: new UPF session set up in parallel → PDU Session Address Lifetime (PCO) expires → old anchor released.',
    desc_zh: 'SSC 模式 3 先建后拆:在新 UPF 并行建立 → PDU Session Address Lifetime(PCO)到期 → 释放旧锚点。',
    ref: 'TS 23.501 §5.6.9.2 (SSC mode 3) · PDU Session Address Lifetime', cause: 'SSC3 make-before-break (address lifetime)', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'SSC3: 신규 UPF 병행 수립 후 구 앵커 address lifetime 만료 해제' },
    ],
    expect: () => ({ label_ko: 'SSC3 make-before-break — 구 앵커 lifetime 해제', label_en: 'SSC3 make-before-break — old anchor released' }),
  },
  {
    id: 'pdu-emergency-backoff-exempt',
    ko: '백오프 예외 (긴급/MPS)', en: 'Back-off exempt (emergency/MPS)', zh: '退避豁免 (紧急/MPS)',
    desc_ko: '백오프(#26/#67/#69) 실행 중에도 request type="initial emergency request" 또는 MPS 가입 UE는 재시도 허용.',
    desc_en: 'Even while a back-off (#26/#67/#69) is running, request type="initial emergency request" or an MPS-subscribed UE is allowed to retry.',
    desc_zh: '即使退避(#26/#67/#69)运行中,request type="initial emergency request" 或 MPS 签约 UE 仍允许重试。',
    ref: 'TS 24.501 §6.4.1 (emergency/MPS back-off exemption)', cause: 'emergency/MPS back-off exemption', domain: 'pdu', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '백오프 중 긴급/MPS 세션은 재시도 허용(예외)' },
    ],
    expect: () => ({ label_ko: '긴급/MPS → 백오프 무시 재시도 허용', label_en: 'emergency/MPS → back-off bypassed' }),
  },

  // ════════ BULK D — 인증/보안 추가 ════════
  {
    id: 'auth-sync-loop',
    ko: 'Synch failure 무한루프', en: 'Synch failure infinite loop', zh: 'Synch failure 无限循环',
    desc_ko: 'UDM이 AUTS 무시/동일 RAND 재전송 → UE가 5GMM #21 반복 송신 → 인증 루프(배터리 소모·등록 불가).',
    desc_en: 'UDM ignores AUTS / resends same RAND → UE repeats 5GMM #21 → auth loop (battery drain, cannot register).',
    desc_zh: 'UDM 忽略 AUTS / 重发同一 RAND → UE 反复发送 5GMM #21 → 鉴权循环(耗电、无法注册)。',
    ref: 'TS 33.501 §6.1.3.3 (AUTS resync) · 5GMM #21', cause: '5GMM #21 Synch failure (loop)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UDM이 AUTS 무시 → 동일 RAND 재전송 → #21 반복 루프' },
    ],
    expect: () => ({ label_ko: '#21 반복 → 인증 루프(등록 불가)', label_en: '#21 repeated → auth loop (no registration)' }),
  },
  {
    id: 'auth-non5g-unacceptable',
    ko: '인증 실패 #26 (non-5G AV)', en: 'Auth failure #26 (non-5G AV)', zh: '鉴权失败 #26 (非 5G AV)',
    desc_ko: 'UDM이 EPS AV(AMF separation bit=0) 잘못 생성 → USIM이 5G AV 아님 판정 → AUTHENTICATION FAILURE 5GMM #26 (non-5G authentication unacceptable).',
    desc_en: 'UDM wrongly generates an EPS AV (AMF separation bit=0) → USIM decides it is not a 5G AV → AUTHENTICATION FAILURE 5GMM #26 (non-5G authentication unacceptable).',
    desc_zh: 'UDM 错误生成 EPS AV(AMF 分离位=0)→ USIM 判定非 5G AV → AUTHENTICATION FAILURE 5GMM #26。',
    ref: 'TS 33.501 §6.1.3.1 (separation bit) · 5GMM #26', cause: '5GMM #26 non-5G authentication unacceptable', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UDM AV separation bit=0(EPS AV) → USIM #26' },
    ],
    expect: () => ({ label_ko: 'AUTHENTICATION FAILURE #26 (non-5G AV)', label_en: 'AUTHENTICATION FAILURE #26 (non-5G AV)' }),
  },
  {
    id: 'auth-reject-t3247',
    ko: '비보호 Auth Reject → T3247', en: 'Unprotected Auth Reject → T3247', zh: '未保护 Auth Reject → T3247',
    desc_ko: '무결성 미보호 Authentication Reject → USIM 즉시 무효화 대신 T3247(30-60min random) 기동 후 재시도 — 가짜 기지국 DoS 완화.',
    desc_en: 'Integrity-unprotected Authentication Reject → instead of invalidating USIM immediately, start T3247 (30-60min random) then retry — false-base-station DoS mitigation.',
    desc_zh: '完整性未保护的 Authentication Reject → 不立即使 USIM 失效,而启动 T3247(30-60min 随机)后重试 — 缓解伪基站 DoS。',
    ref: 'TS 24.501 §5.3.20a · T3247 (false base station mitigation)', cause: 'unprotected Auth Reject → T3247', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '무결성 미보호 Authentication Reject → T3247 기동(즉시 USIM 무효화 아님)' },
    ],
    expect: () => ({ label_ko: 'T3247 기동 (USIM 즉시 무효화 아님)', label_en: 'T3247 started (no immediate USIM invalidation)' }),
  },
  {
    id: 'auth-t3520',
    ko: '인증 타임아웃 (T3520, UE측)', en: 'Auth timeout (T3520, UE side)', zh: '鉴权超时 (T3520, UE 侧)',
    desc_ko: 'UE가 Auth Response 후 망 무응답 → T3520(15s) 만료 → 인증 절차 중단·로컬 해제.',
    desc_en: 'After UE sends Auth Response, network is silent → T3520 (15s) expiry → UE aborts auth, local release.',
    desc_zh: 'UE 发送 Auth Response 后网络无响应 → T3520(15s)到期 → UE 终止鉴权,本地释放。',
    ref: 'TS 24.501 §5.4.1.3 · T3520 (15s)', cause: 'T3520 expiry (UE-side auth timeout)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'disableNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'AMF 무응답 → UE T3520(15s) 만료 → 인증 중단' },
    ],
    expect: () => ({ label_ko: 'T3520 만료 — UE 인증 중단(로컬 해제)', label_en: 'T3520 expiry — UE aborts auth' }),
  },
  {
    id: 'auth-t3560',
    ko: '인증 타임아웃 (T3560, 망측)', en: 'Auth timeout (T3560, network side)', zh: '鉴权超时 (T3560, 网络侧)',
    desc_ko: 'UE 무응답 → AMF가 Auth Request T3560(6s) ×4 재전송 → 5회째 만료 시 인증 절차 중단.',
    desc_en: 'UE unresponsive → AMF retransmits Auth Request T3560 (6s) ×4 → aborts auth on 5th expiry.',
    desc_zh: 'UE 无响应 → AMF 重传 Auth Request T3560(6s)×4 → 第 5 次到期终止鉴权。',
    ref: 'TS 24.501 §5.4.1.3 · T3560 (6s, 4 retx)', cause: 'T3560 expiry (network-side auth timeout)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UE 무응답 → AMF Auth Request T3560 ×4 재전송 후 중단' },
    ],
    expect: () => ({ label_ko: 'T3560 ×5 만료 — 망이 인증 절차 중단', label_en: 'T3560 ×5 expiry — network aborts auth' }),
  },
  {
    id: 'smc-integrity-fail',
    ko: 'NAS SMC 무결성 실패(ABBA/키)', en: 'NAS SMC integrity fail (ABBA/key)', zh: 'NAS SMC 完整性失败 (ABBA/密钥)',
    desc_ko: 'ABBA/K_AMF 불일치 → UE가 Security Mode Command 무결성 검증 실패로 무응답 discard → 망 T3560 만료.',
    desc_en: 'ABBA/K_AMF mismatch → UE discards Security Mode Command (integrity check fail) with no response → network T3560 expiry.',
    desc_zh: 'ABBA/K_AMF 不一致 → UE 因完整性校验失败丢弃 Security Mode Command 且不响应 → 网络 T3560 到期。',
    ref: 'TS 33.501 §6.7.2 (ABBA/K_AMF) · TS 24.501 §5.4.2', cause: 'NAS SMC integrity fail → T3560', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'ABBA/KAMF 불일치 → SMC 무결성 실패 discard → T3560 만료' },
    ],
    expect: () => ({ label_ko: 'SMC 무결성 실패 → 무응답 discard → T3560', label_en: 'SMC integrity fail → discard → T3560' }),
  },
  {
    id: 'eir-timeout',
    ko: '5G-EIR 무응답 (정책 분기)', en: '5G-EIR timeout (policy branch)', zh: '5G-EIR 超时 (策略分支)',
    desc_ko: 'N5g-eir EquipmentStatus 무응답/장애 → 운용자 정책: continue-without-check(기본) 또는 reject.',
    desc_en: 'N5g-eir EquipmentStatus timeout/failure → operator policy: continue-without-check (default) or reject.',
    desc_zh: 'N5g-eir EquipmentStatus 超时/故障 → 运营商策略:continue-without-check(默认)或 reject。',
    ref: 'TS 23.502 §4.2.2 (5G-EIR ME check) · operator policy', cause: '5G-EIR timeout (continue/reject policy)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: '5G-EIR' }, { op: 'disableNf', zone: 'A', type: '5G-EIR' },
      { op: 'note', text: '5G-EIR 무응답 → continue-without-check(기본) 또는 reject 정책' },
    ],
    expect: (c) => {
      const up = c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === '5G-EIR' && n.enabled)
      return up
        ? { label_ko: '5G-EIR 정상 (정책 분기 미발생)', label_en: '5G-EIR up (no policy branch)' }
        : { label_ko: 'N5g-eir timeout → continue-without-check(기본)/reject', label_en: 'N5g-eir timeout → continue/reject policy' }
    },
  },
  {
    id: 'auth-snn-not-authorized',
    ko: 'SNN 미인가 (403 → #11)', en: 'SNN not authorized (403 → #11)', zh: 'SNN 未授权 (403 → #11)',
    desc_ko: 'VPLMN과 협정 없음 → 홈 AUSF가 Nausf_UEAuthentication 403 SERVING_NETWORK_NOT_AUTHORIZED → 방문 AMF Registration Reject 5GMM #11.',
    desc_en: 'No agreement with VPLMN → home AUSF returns Nausf_UEAuthentication 403 SERVING_NETWORK_NOT_AUTHORIZED → visited AMF Registration Reject 5GMM #11.',
    desc_zh: '与 VPLMN 无协议 → 归属 AUSF 返回 403 SERVING_NETWORK_NOT_AUTHORIZED → 拜访 AMF Registration Reject 5GMM #11。',
    ref: 'TS 33.501 §6.1.2 (SNN check) · TS 29.509 · 5GMM #11', cause: 'AUSF 403 SERVING_NETWORK_NOT_AUTHORIZED → #11', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'VPLMN-B와 협정 없음 → 홈 AUSF 403 SNN not authorized → #11' },
    ],
    expect: () => ({ label_ko: 'AUSF 403 SNN not authorized → Reject #11', label_en: 'AUSF 403 SNN not authorized → Reject #11' }),
  },
  {
    id: 'auth-linking-fail',
    ko: '인증-등록 linking 실패', en: 'Auth-registration linking fail', zh: '鉴权-注册联动失败',
    desc_ko: 'UDM이 최근 인증확인(Nausf 결과, SN 일치) 없이 온 Nudm_UECM_Registration 거부 — 스푸핑된 VPLMN 등록 차단.',
    desc_en: 'UDM rejects a Nudm_UECM_Registration that arrives without a recent auth confirmation (Nausf result, matching SN) — blocks spoofed VPLMN registration.',
    desc_zh: 'UDM 拒绝无近期鉴权确认(Nausf 结果、SN 一致)的 Nudm_UECM_Registration — 阻断伪造 VPLMN 注册。',
    ref: 'TS 33.501 §6.1.4 (linking auth confirmation) · Nudm_UECM', cause: 'Nudm_UECM_Registration rejected (no auth linking)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '최근 인증확인 없는 UECM 등록 → UDM 거부(스푸핑 차단)' },
    ],
    expect: () => ({ label_ko: 'UDM UECM 등록 거부 (인증 linking 실패)', label_en: 'UDM UECM registration rejected (no linking)' }),
  },
  {
    id: 'emergency-null-smc',
    ko: '비인증 긴급 등록 (NULL 알고리즘)', en: 'Unauth emergency (NULL algorithm SMC)', zh: '未鉴权紧急注册 (NULL 算法 SMC)',
    desc_ko: 'USIM 없음/인증 실패 상태의 긴급 등록 → AMF가 NULL 알고리즘(NEA0/NIA0) SMC로 무보호 긴급 PDU 세션 허용(운용자 정책).',
    desc_en: 'Emergency registration with no USIM / auth failed → AMF permits an unprotected emergency PDU session with NULL algorithms (NEA0/NIA0) SMC (operator policy).',
    desc_zh: '无 USIM/鉴权失败下的紧急注册 → AMF 用 NULL 算法(NEA0/NIA0)SMC 允许无保护紧急 PDU 会话(运营商策略)。',
    ref: 'TS 33.501 §10 (emergency, NEA0/NIA0) · TS 23.167', cause: 'NULL algorithm SMC (emergency)', domain: 'auth', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '미인증 긴급 등록 → NEA0/NIA0 SMC → 무보호 긴급 PDU 허용' },
    ],
    expect: () => ({ label_ko: '긴급 등록 성공 (NULL 알고리즘 SMC)', label_en: 'emergency registration OK (NULL algorithm SMC)' }),
  },
  {
    id: 'nas-count-wrap',
    ko: 'NAS COUNT wrap → 재인증', en: 'NAS COUNT wrap → re-auth', zh: 'NAS COUNT 回绕 → 重鉴权',
    desc_ko: 'UL/DL NAS COUNT 2^24 임박 → AMF가 wrap 전 신규 5G-AKA 재인증 + 새 K_AMF/NAS SMC → COUNT 리셋(재사용 금지).',
    desc_en: 'UL/DL NAS COUNT approaching 2^24 → AMF forces a new 5G-AKA re-auth + fresh K_AMF/NAS SMC before wrap → COUNT reset (no reuse).',
    desc_zh: 'UL/DL NAS COUNT 接近 2^24 → AMF 在回绕前强制 5G-AKA 重鉴权 + 新 K_AMF/NAS SMC → COUNT 复位(禁止重用)。',
    ref: 'TS 33.501 §6.4.3.1 (NAS COUNT wrap-around)', cause: 'NAS COUNT wrap → forced re-auth', domain: 'auth', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'NAS COUNT 2^24 임박 → 강제 재인증 + 새 KAMF' },
    ],
    expect: () => ({ label_ko: 'NAS COUNT wrap 전 재인증 → COUNT 리셋', label_en: 're-auth before COUNT wrap → COUNT reset' }),
  },
  {
    id: 'upu-ok',
    ko: 'UPU 정상 (UE Parameters Update)', en: 'UPU OK (UE Parameters Update)', zh: 'UPU 正常 (UE 参数更新)',
    desc_ko: 'UDM → AMF DL NAS TRANSPORT: UPU container(Routing Indicator/기본 NSSAI) + UPU-MAC-IAUSF → UE ack.',
    desc_en: 'UDM → AMF DL NAS TRANSPORT: UPU container (Routing Indicator/default NSSAI) + UPU-MAC-IAUSF → UE ack.',
    desc_zh: 'UDM → AMF DL NAS TRANSPORT:UPU container(Routing Indicator/默认 NSSAI)+ UPU-MAC-IAUSF → UE ack。',
    ref: 'TS 33.501 §6.15 UPU · TS 23.502 §4.20', cause: 'UPU (UE Parameters Update)', domain: 'auth', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' },
      { op: 'note', text: 'UDM UPU container + UPU-MAC-IAUSF → UE ack' },
    ],
    expect: () => ({ label_ko: 'UPU 성공 — 파라미터 갱신 + UE ack', label_en: 'UPU OK — parameters updated + UE ack' }),
  },
  {
    id: 'upu-mac-fail',
    ko: 'UPU-MAC 검증 실패', en: 'UPU-MAC verification fail', zh: 'UPU-MAC 校验失败',
    desc_ko: 'UPU-MAC-IAUSF 불일치 → UE가 UPU container discard(수용 안 함).',
    desc_en: 'UPU-MAC-IAUSF mismatch → UE discards the UPU container (not applied).',
    desc_zh: 'UPU-MAC-IAUSF 不一致 → UE 丢弃 UPU container(不采用)。',
    ref: 'TS 33.501 §6.15 UPU (UPU-MAC-IAUSF)', cause: 'UPU-MAC-IAUSF mismatch → discard', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UPU-MAC 불일치 → UE discard' },
    ],
    expect: () => ({ label_ko: 'UPU-MAC 불일치 → UE discard', label_en: 'UPU-MAC mismatch → UE discard' }),
  },
  {
    id: 'sor-upu-counter-wrap',
    ko: 'CounterSoR/UPU wrap 임박', en: 'CounterSoR/UPU wrap-around', zh: 'CounterSoR/UPU 回绕',
    desc_ko: 'CounterSoR/CounterUPU 0xFFFF 임박 → 홈망이 재인증(신규 K_AUSF)으로 카운터 리셋 강제.',
    desc_en: 'CounterSoR/CounterUPU approaching 0xFFFF → home network forces re-authentication (new K_AUSF) to reset the counter.',
    desc_zh: 'CounterSoR/CounterUPU 接近 0xFFFF → 归属网强制重鉴权(新 K_AUSF)以复位计数器。',
    ref: 'TS 33.501 §6.14/§6.15 (CounterSoR/CounterUPU)', cause: 'CounterSoR/UPU wrap → re-auth (new K_AUSF)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'Counter 0xFFFF 임박 → 재인증으로 KAUSF 재생성' },
    ],
    expect: () => ({ label_ko: 'Counter wrap → 재인증(신규 KAUSF)', label_en: 'counter wrap → re-auth (new K_AUSF)' }),
  },
  {
    id: 'kamf-horizontal-fail',
    ko: '수평 K_AMF 유도 실패', en: 'Horizontal K_AMF derivation fail', zh: '水平 K_AMF 推导失败',
    desc_ko: '타겟 AMF가 horizontal K_AMF 유도 후 NAS SMC에 K_AMF_change_flag=1 미설정(또는 UE 미지원) → UE 구 KAMF로 검증 → NAS SMC 무결성 실패 → 초기등록 폴백.',
    desc_en: 'Target AMF derives horizontal K_AMF but omits K_AMF_change_flag=1 in NAS SMC (or UE unsupported) → UE verifies with old K_AMF → NAS SMC integrity fail → fallback to initial registration.',
    desc_zh: '目标 AMF 水平推导 K_AMF 后 NAS SMC 未置 K_AMF_change_flag=1(或 UE 不支持)→ UE 用旧 K_AMF 校验 → NAS SMC 完整性失败 → 回退初始注册。',
    ref: 'TS 33.501 §6.9.3 (horizontal K_AMF derivation)', cause: 'K_AMF_change_flag mishandled → SMC integrity fail', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'horizontal KAMF 후 change_flag 미설정 → SMC 무결성 실패 → 초기등록 폴백' },
    ],
    expect: () => ({ label_ko: 'K_AMF_change_flag 오류 → SMC 실패 → 초기등록', label_en: 'K_AMF_change_flag error → SMC fail → initial reg' }),
  },
  {
    id: 'as-smc-fail',
    ko: 'AS Security Mode Failure (RRC)', en: 'AS Security Mode Failure (RRC)', zh: 'AS Security Mode Failure (RRC)',
    desc_ko: 'K_gNB/알고리즘 불일치 → AS SecurityModeFailure → RRC release.',
    desc_en: 'K_gNB/algorithm mismatch → AS SecurityModeFailure → RRC release.',
    desc_zh: 'K_gNB/算法不一致 → AS SecurityModeFailure → RRC 释放。',
    ref: 'TS 38.331 §5.3.4 (SecurityModeFailure)', cause: 'RRC SecurityModeFailure (K_gNB/algo mismatch)', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'K_gNB/algorithm 불일치 → AS SecurityModeFailure → RRC release' },
    ],
    expect: () => ({ label_ko: 'AS SecurityModeFailure → RRC release', label_en: 'AS SecurityModeFailure → RRC release' }),
  },
  {
    id: 'auth-eap-akaprime-ok',
    ko: 'EAP-AKA′ 정상 인증', en: 'EAP-AKA′ authentication OK', zh: 'EAP-AKA′ 鉴权成功',
    desc_ko: 'EAP-Request/AKA′-Challenge(AT_RAND, AT_AUTN, AT_MAC) → EAP-Response → EAP-Success + K_SEAF 도출.',
    desc_en: 'EAP-Request/AKA′-Challenge (AT_RAND, AT_AUTN, AT_MAC) → EAP-Response → EAP-Success + K_SEAF derivation.',
    desc_zh: 'EAP-Request/AKA′-Challenge(AT_RAND, AT_AUTN, AT_MAC)→ EAP-Response → EAP-Success + 推导 K_SEAF。',
    ref: 'TS 33.501 §6.1.3.1 · RFC 9048 (EAP-AKA′)', cause: 'EAP-AKA′ EAP-Success', domain: 'auth', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'EAP-AKA′ Challenge/Response → EAP-Success + KSEAF' },
    ],
    expect: () => ({ label_ko: 'EAP-AKA′ 인증 성공 (EAP-Success)', label_en: 'EAP-AKA′ authentication OK (EAP-Success)' }),
  },
  {
    id: 'auth-eap-resync',
    ko: 'EAP-AKA′ 재동기 (AT_AUTS)', en: 'EAP-AKA′ resync (AT_AUTS)', zh: 'EAP-AKA′ 重同步 (AT_AUTS)',
    desc_ko: 'SQN 불일치 → EAP-Response/AKA′-Synchronization-Failure(AT_AUTS) → UDM SQN 재동기 후 신규 Challenge.',
    desc_en: 'SQN out of range → EAP-Response/AKA′-Synchronization-Failure (AT_AUTS) → UDM resyncs SQN then new Challenge.',
    desc_zh: 'SQN 不匹配 → EAP-Response/AKA′-Synchronization-Failure(AT_AUTS)→ UDM 重同步 SQN 后新 Challenge。',
    ref: 'TS 33.501 §6.1.3.3 · RFC 9048 (AT_AUTS)', cause: 'EAP-AKA′ AT_AUTS resync', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'SQN 불일치 → AT_AUTS 재동기 → 신규 Challenge' },
    ],
    expect: () => ({ label_ko: 'AT_AUTS 재동기 → 재인증', label_en: 'AT_AUTS resync → re-auth' }),
  },
  {
    id: 'auth-mac-failure-final',
    ko: 'MAC 실패 2차 → 망 최종 거절', en: 'MAC failure 2nd → network reject', zh: 'MAC 失败第二次 → 网络最终拒绝',
    desc_ko: '#20 수신 → AMF가 Identity Request(SUCI)+신규 AV로 재인증 → 2차 #20 → 망이 Authentication Reject 송신, UE USIM 무효 처리.',
    desc_en: '#20 received → AMF re-authenticates with Identity Request(SUCI)+new AV → 2nd #20 → network sends Authentication Reject, UE invalidates USIM.',
    desc_zh: '收到 #20 → AMF 用 Identity Request(SUCI)+新 AV 重鉴权 → 第二次 #20 → 网络发送 Authentication Reject,UE 使 USIM 失效。',
    ref: 'TS 24.501 §5.4.1.3 · 5GMM #20 (repeated) → Authentication Reject', cause: '5GMM #20 twice → Authentication Reject', domain: 'auth', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '#20 2회 반복 → 망 Authentication Reject → USIM 무효' },
    ],
    expect: () => ({ label_ko: '2차 #20 → Authentication Reject (USIM 무효)', label_en: '2nd #20 → Authentication Reject (USIM invalid)' }),
  },
  // ════════ BULK D — RAN/RRC/PHY 추가 ════════
  {
    id: 'ran-sib1-fail',
    ko: 'SIB1 획득 실패 → cell barred', en: 'SIB1 acquisition fail → cell barred', zh: 'SIB1 获取失败 → 小区 barred',
    desc_ko: '서빙 RSRP가 디코드 임계 미달 → SIB1(kSSB 범위 밖) 미획득 → 셀을 barred로 취급, 최대 300s 배제.',
    desc_en: 'Serving RSRP below decode threshold → SIB1 not acquired (kSSB out of range) → cell treated as barred, excluded up to 300s.',
    desc_zh: '服务 RSRP 低于解码门限 → SIB1(kSSB 越界)未获取 → 小区视为 barred,最长排除 300s。',
    ref: 'TS 38.331 §5.2.2 · TS 38.304 §5.2.3 (SIB1 not acquired → barred)', cause: 'SIB1 not acquired → cell barred (300s)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '서빙 RSRP 매우 낮음 → SIB1 미획득 → barred 300s' },
    ],
    expect: () => ({ label_ko: 'SIB1 미획득 → cell barred(300s)', label_en: 'SIB1 not acquired → cell barred (300s)' }),
  },
  {
    id: 'ran-cell-reserved-operator',
    ko: 'SIB1 cellReservedForOperatorUse', en: 'SIB1 cellReservedForOperatorUse', zh: 'SIB1 cellReservedForOperatorUse',
    desc_ko: 'SIB1 cellReservedForOperatorUse → HPLMN AC11-15 UE만 캠핑, 일반/로머는 barred로 취급.',
    desc_en: 'SIB1 cellReservedForOperatorUse → only HPLMN AC11-15 UEs camp; ordinary/roamer UEs treat the cell as barred.',
    desc_zh: 'SIB1 cellReservedForOperatorUse → 仅 HPLMN AC11-15 UE 驻留;普通/漫游 UE 视为 barred。',
    ref: 'TS 38.304 §5.2.3 (cellReservedForOperatorUse)', cause: 'cellReservedForOperatorUse', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'SIB1 cellReservedForOperatorUse → 일반 UE barred' },
    ],
    expect: () => ({ label_ko: 'cellReservedForOperatorUse → 일반 UE barred', label_en: 'cellReservedForOperatorUse → ordinary UE barred' }),
  },
  {
    id: 'ran-2step-rach-ok',
    ko: '2-step CBRA 성공 (MsgA/MsgB)', en: '2-step CBRA success (MsgA/MsgB)', zh: '2-step CBRA 成功 (MsgA/MsgB)',
    desc_ko: 'MsgA(preamble+PUSCH) → MsgB successRAR(contention resolution ID, C-RNTI, TA) → RRC 연결(하이밴드/SCS120 권장).',
    desc_en: 'MsgA (preamble+PUSCH) → MsgB successRAR (contention resolution ID, C-RNTI, TA) → RRC connected (high-band/SCS120).',
    desc_zh: 'MsgA(preamble+PUSCH)→ MsgB successRAR(竞争解决 ID、C-RNTI、TA)→ RRC 连接(高频/SCS120)。',
    ref: 'TS 38.321 §5.1.1 (2-step RA) · TS 38.213', cause: '2-step CBRA successRAR', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '하이밴드 셀 2-step RACH → MsgA/MsgB successRAR' },
    ],
    expect: () => ({ label_ko: '2-step CBRA 성공 (MsgB successRAR)', label_en: '2-step CBRA success (MsgB successRAR)' }),
  },
  {
    id: 'ran-2step-rach-fallback',
    ko: '2-step RACH fallbackRAR', en: '2-step RACH fallbackRAR', zh: '2-step RACH fallbackRAR',
    desc_ko: 'MsgA PUSCH decode 실패 → MsgB fallbackRAR(RAPID, UL grant, TA) → Msg3 retx → Msg4 → msgA-TransMax 초과 시 4-step RA 전환.',
    desc_en: 'MsgA PUSCH decode fail → MsgB fallbackRAR (RAPID, UL grant, TA) → Msg3 retx → Msg4 → on msgA-TransMax switch to 4-step RA.',
    desc_zh: 'MsgA PUSCH 解码失败 → MsgB fallbackRAR(RAPID、UL grant、TA)→ Msg3 重传 → Msg4 → 超过 msgA-TransMax 切换 4-step RA。',
    ref: 'TS 38.321 §5.1.1 (fallbackRAR, msgA-TransMax)', cause: '2-step fallbackRAR → 4-step RA', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'MsgA PUSCH decode 실패 → fallbackRAR → 4-step RA 전환' },
    ],
    expect: () => ({ label_ko: 'fallbackRAR → Msg3/Msg4 → 4-step RA 전환', label_en: 'fallbackRAR → Msg3/Msg4 → switch to 4-step RA' }),
  },
  {
    id: 'ran-msg4-contention-fail',
    ko: 'Msg4 경합해소 실패', en: 'Msg4 contention resolution fail', zh: 'Msg4 竞争解决失败',
    desc_ko: '동시 접속 UE 다수 → 같은 preamble 선택 → ra-ContentionResolutionTimer 만료 → TC-RNTI 폐기, backoff 후 재시도.',
    desc_en: 'Many simultaneous UEs pick the same preamble → ra-ContentionResolutionTimer expiry → discard TC-RNTI, backoff, retry.',
    desc_zh: '大量 UE 同时选同一 preamble → ra-ContentionResolutionTimer 到期 → 丢弃 TC-RNTI,退避后重试。',
    ref: 'TS 38.321 §5.1.5 (ra-ContentionResolutionTimer)', cause: 'Msg4 contention resolution timer expiry', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '측정요원 다수 동시 접속 → Msg4 경합해소 실패/backoff' },
    ],
    expect: () => ({ label_ko: 'ra-ContentionResolutionTimer 만료 → TC-RNTI 폐기', label_en: 'ContentionResolutionTimer expiry → discard TC-RNTI' }),
  },
  {
    id: 'ran-msg2-backoff',
    ko: 'Msg2 Backoff Indicator', en: 'Msg2 Backoff Indicator', zh: 'Msg2 Backoff Indicator',
    desc_ko: 'RACH 혼잡 시 Msg2 BI=n → uniform backoff 0..PREAMBLE_BACKOFF ms 후 재시도(재시도 지연).',
    desc_en: 'Under RACH congestion Msg2 BI=n → uniform backoff 0..PREAMBLE_BACKOFF ms before retry.',
    desc_zh: 'RACH 拥塞时 Msg2 BI=n → 均匀退避 0..PREAMBLE_BACKOFF ms 后重试。',
    ref: 'TS 38.321 §5.1.4 · Table 7.2-1 (Backoff Indicator)', cause: 'Msg2 Backoff Indicator (RACH congestion)', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RACH 부하 높음 → Msg2 BI → uniform backoff' },
    ],
    expect: () => ({ label_ko: 'Msg2 BI → uniform backoff 재시도', label_en: 'Msg2 BI → uniform backoff retry' }),
  },
  {
    id: 'ran-on-demand-si',
    ko: 'On-demand SI 요청 (Msg1)', en: 'On-demand SI request (Msg1)', zh: '按需 SI 请求 (Msg1)',
    desc_ko: 'SIB si-BroadcastStatus=notBroadcasting → Msg1 기반 SI 요청(ra-PreambleStartIndex) → RAR ack → SI 획득.',
    desc_en: 'SIB si-BroadcastStatus=notBroadcasting → Msg1-based SI request (ra-PreambleStartIndex) → RAR ack → SI acquired.',
    desc_zh: 'SIB si-BroadcastStatus=notBroadcasting → 基于 Msg1 的 SI 请求(ra-PreambleStartIndex)→ RAR ack → 获取 SI。',
    ref: 'TS 38.331 §5.2.2.3.3 (on-demand SI)', cause: 'on-demand SI request (Msg1)', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '하이밴드 셀 SIB notBroadcasting → Msg1 SI 요청' },
    ],
    expect: () => ({ label_ko: 'Msg1 SI 요청 → RAR ack → SI 획득', label_en: 'Msg1 SI request → RAR ack → SI acquired' }),
  },
  {
    id: 'ran-reest-fallback-setup',
    ko: '재수립 폴백 → RRCSetup', en: 'Reestablishment fallback → RRCSetup', zh: '重建回退 → RRCSetup',
    desc_ko: '컨텍스트 조회 실패(타 존/소스 RU 삭제) → RRCReestablishmentReject/폴백 → RRCSetup → 전체 NAS 재등록.',
    desc_en: 'Context retrieval fails (other zone / source RU removed) → reestablishment falls back to RRCSetup → full NAS re-registration.',
    desc_zh: '上下文检索失败(异区/源 RU 删除)→ 重建回退 RRCSetup → 全量 NAS 重注册。',
    ref: 'TS 38.331 §5.3.7.5 (fallback to RRCSetup)', cause: 'reestablishment fallback → RRCSetup', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UE 컨텍스트 조회 실패 → RRCSetup 폴백 → 재등록' },
    ],
    expect: () => ({ label_ko: '컨텍스트 없음 → RRCSetup 폴백(재등록)', label_en: 'no context → fallback RRCSetup (re-registration)' }),
  },
  {
    id: 'ran-reest-t301',
    ko: '재수립 T301 만료', en: 'Reestablishment T301 expiry', zh: '重建 T301 到期',
    desc_ko: 'RRCReestablishmentRequest 후 응답 없음 → T301 만료 → RRC_IDLE, release cause rrc-connection-failure.',
    desc_en: 'No response after RRCReestablishmentRequest → T301 expiry → RRC_IDLE, release cause rrc-connection-failure.',
    desc_zh: 'RRCReestablishmentRequest 后无响应 → T301 到期 → RRC_IDLE,释放原因 rrc-connection-failure。',
    ref: 'TS 38.331 §5.3.7.7 (T301 expiry)', cause: 'T301 expiry → RRC_IDLE', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'disableNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RRCReestablishment 응답 없음 → T301 만료 → RRC_IDLE' },
    ],
    expect: () => ({ label_ko: 'T301 만료 → RRC_IDLE (connection-failure)', label_en: 'T301 expiry → RRC_IDLE (connection-failure)' }),
  },
  {
    id: 'ran-ca-scell-add',
    ko: 'CA SCell 추가/활성', en: 'CA SCell addition/activation', zh: 'CA SCell 添加/激活',
    desc_ko: 'RRCReconfiguration: sCellToAddModList(SCell 추가) → SCell Activation MAC CE → CSI reporting 시작(유효 대역폭 확대).',
    desc_en: 'RRCReconfiguration: sCellToAddModList (SCell add) → SCell Activation MAC CE → CSI reporting started (wider effective BW).',
    desc_zh: 'RRCReconfiguration:sCellToAddModList(添加 SCell)→ SCell Activation MAC CE → 开始 CSI 上报(有效带宽扩大)。',
    ref: 'TS 38.331 §5.3.5.5.9 · TS 38.321 §5.9 (SCell activation)', cause: 'CA SCell add + activation', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU에서 ca_enabled 토글 → SCell 추가/활성' },
    ],
    expect: () => ({ label_ko: 'SCell 추가/활성 → CSI 보고 시작', label_en: 'SCell add/activate → CSI reporting started' }),
  },
  {
    id: 'ran-beam-recovery',
    ko: '빔 실패 감지 + CFRA 복구', en: 'Beam failure + CFRA recovery', zh: '波束失败 + CFRA 恢复',
    desc_ko: 'FR2 순간 RSRP 급락 → BFI_COUNTER ≥ beamFailureInstanceMaxCount → 후보 SSB ≥ rsrp-ThresholdSSB → CFRA BFR → 복구.',
    desc_en: 'FR2 sudden RSRP drop → BFI_COUNTER ≥ beamFailureInstanceMaxCount → candidate SSB ≥ rsrp-ThresholdSSB → CFRA BFR → recovered.',
    desc_zh: 'FR2 瞬时 RSRP 骤降 → BFI_COUNTER ≥ beamFailureInstanceMaxCount → 候选 SSB ≥ rsrp-ThresholdSSB → CFRA BFR → 恢复。',
    ref: 'TS 38.321 §5.17 · TS 38.213 (beam failure recovery)', cause: 'CFRA beam failure recovery (recovered)', domain: 'ran', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'FR2 빔 차단 후 후보 SSB로 CFRA BFR 복구' },
    ],
    expect: () => ({ label_ko: 'CFRA BFR → 빔 복구 (RLF 회피)', label_en: 'CFRA BFR → beam recovered (RLF avoided)' }),
  },
  {
    id: 'ran-pci-confusion',
    ko: 'PCI confusion (동일 PCI 이웃)', en: 'PCI confusion (same-PCI neighbors)', zh: 'PCI confusion (同 PCI 邻区)',
    desc_ko: '한 서빙셀의 이웃 2개가 같은 PCI → A3가 잘못된 동일-PCI 타겟 선택 위험 → reportCGI 지시 → ANR이 CGI로 해소.',
    desc_en: 'Two neighbors of one serving cell share a PCI → risk of A3 picking the wrong same-PCI target → reportCGI ordered → ANR resolves via CGI.',
    desc_zh: '同一服务小区的两个邻区共用 PCI → A3 可能选错同 PCI 目标 → 下发 reportCGI → ANR 用 CGI 解决。',
    ref: 'TS 38.331 (reportCGI) · TS 38.300 (ANR)', cause: 'PCI confusion → reportCGI/ANR', domain: 'ran', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' },
      { op: 'note', text: '서빙셀 이웃 2개 PCI 동일 배치 → reportCGI/ANR 관측' },
    ],
    expect: () => ({ label_ko: 'PCI confusion → reportCGI → ANR CGI 해소', label_en: 'PCI confusion → reportCGI → ANR resolves CGI' }),
  },

  // ════════ BULK D — EN-DC / SCG (multi-RAT) ════════
  {
    id: 'endc-sgnb-add',
    ko: 'EN-DC SgNB 추가 성공', en: 'EN-DC SgNB addition success', zh: 'EN-DC SgNB 添加成功',
    desc_ko: 'B1 report → X2AP SgNB Addition Request/Ack → RRCConnectionReconfiguration(nr-SecondaryCellGroupConfig) → PSCell RACH → NR leg 활성.',
    desc_en: 'B1 report → X2AP SgNB Addition Request/Ack → RRCConnectionReconfiguration (nr-SecondaryCellGroupConfig) → RACH to PSCell → NR leg active.',
    desc_zh: 'B1 report → X2AP SgNB Addition Request/Ack → RRCConnectionReconfiguration(nr-SecondaryCellGroupConfig)→ PSCell RACH → NR leg 激活。',
    ref: 'TS 37.340 §10.2 (EN-DC SgNB addition)', cause: 'EN-DC SgNB addition', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' },
      { op: 'note', text: 'LTE RU(마스터)+NR RU(SgNB) 배치 → B1 → SgNB Addition' },
    ],
    expect: () => ({ label_ko: 'EN-DC SgNB 추가 성공 (NR leg 활성)', label_en: 'EN-DC SgNB addition OK (NR leg active)' }),
  },
  {
    id: 'scg-fail-t310',
    ko: 'SCG 실패 t310-Expiry', en: 'SCG failure t310-Expiry', zh: 'SCG 失败 t310-Expiry',
    desc_ko: 'PSCell RLF: SCGFailureInformation failureType=t310-Expiry → MCG 경유 통지(재수립 아님).',
    desc_en: 'PSCell RLF: SCGFailureInformation failureType=t310-Expiry → reported via MCG (not reestablishment).',
    desc_zh: 'PSCell RLF:SCGFailureInformation failureType=t310-Expiry → 经 MCG 上报(非重建)。',
    ref: 'TS 38.331 §5.7.3 (SCGFailureInformation)', cause: 'SCGFailureInformation failureType=t310-Expiry', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'note', text: 'NR PSCell RSRP 약화 → t310-Expiry' },
    ],
    expect: () => ({ label_ko: 'SCG 실패 t310-Expiry (MCG 통지)', label_en: 'SCG failure t310-Expiry (via MCG)' }),
  },
  {
    id: 'scg-fail-rach',
    ko: 'SCG 실패 randomAccessProblem', en: 'SCG failure randomAccessProblem', zh: 'SCG 失败 randomAccessProblem',
    desc_ko: 'PSCell RACH 실패 → SCGFailureInformation failureType=randomAccessProblem.',
    desc_en: 'PSCell RACH failure → SCGFailureInformation failureType=randomAccessProblem.',
    desc_zh: 'PSCell RACH 失败 → SCGFailureInformation failureType=randomAccessProblem。',
    ref: 'TS 38.331 §5.7.3', cause: 'SCGFailureInformation failureType=randomAccessProblem', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'note', text: 'NR PSCell UL PRACH 실패 → randomAccessProblem' },
    ],
    expect: () => ({ label_ko: 'SCG 실패 randomAccessProblem', label_en: 'SCG failure randomAccessProblem' }),
  },
  {
    id: 'scg-fail-synch',
    ko: 'SCG 실패 synchReconfigFailureSCG', en: 'SCG failure synchReconfigFailureSCG', zh: 'SCG 失败 synchReconfigFailureSCG',
    desc_ko: 'PSCell 변경 T304 만료 → SCGFailureInformation failureType=synchReconfigFailureSCG (MCG 경유).',
    desc_en: 'PSCell change T304 expiry → SCGFailureInformation failureType=synchReconfigFailureSCG (via MCG).',
    desc_zh: 'PSCell 变更 T304 到期 → SCGFailureInformation failureType=synchReconfigFailureSCG(经 MCG)。',
    ref: 'TS 38.331 §5.7.3 (T304 SCG)', cause: 'SCGFailureInformation failureType=synchReconfigFailureSCG', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'note', text: 'PSCell 변경 중 T304 만료 → synchReconfigFailureSCG' },
    ],
    expect: () => ({ label_ko: 'SCG 실패 synchReconfigFailureSCG', label_en: 'SCG failure synchReconfigFailureSCG' }),
  },
  {
    id: 'scg-fail-srb3',
    ko: 'SCG 실패 srb3-IntegrityFailure', en: 'SCG failure srb3-IntegrityFailure', zh: 'SCG 失败 srb3-IntegrityFailure',
    desc_ko: 'SRB3 PDCP 무결성 검증 실패 → SCGFailureInformation failureType=srb3-IntegrityFailure.',
    desc_en: 'SRB3 PDCP integrity check fail → SCGFailureInformation failureType=srb3-IntegrityFailure.',
    desc_zh: 'SRB3 PDCP 完整性校验失败 → SCGFailureInformation failureType=srb3-IntegrityFailure。',
    ref: 'TS 38.331 §5.7.3', cause: 'SCGFailureInformation failureType=srb3-IntegrityFailure', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'note', text: 'SRB3 PDCP 무결성 실패 → srb3-IntegrityFailure' },
    ],
    expect: () => ({ label_ko: 'SCG 실패 srb3-IntegrityFailure', label_en: 'SCG failure srb3-IntegrityFailure' }),
  },
  {
    id: 'scg-fail-reconfig',
    ko: 'SCG 실패 scg-ReconfigFailure', en: 'SCG failure scg-ReconfigFailure', zh: 'SCG 失败 scg-ReconfigFailure',
    desc_ko: 'SRB3 경유 RRCReconfiguration 미준수 → SCGFailureInformation failureType=scg-ReconfigFailure.',
    desc_en: 'Unable to comply with RRCReconfiguration via SRB3 → SCGFailureInformation failureType=scg-ReconfigFailure.',
    desc_zh: '无法遵从经 SRB3 的 RRCReconfiguration → SCGFailureInformation failureType=scg-ReconfigFailure。',
    ref: 'TS 38.331 §5.7.3', cause: 'SCGFailureInformation failureType=scg-ReconfigFailure', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'note', text: 'SRB3 RRCReconfiguration 미준수 → scg-ReconfigFailure' },
    ],
    expect: () => ({ label_ko: 'SCG 실패 scg-ReconfigFailure', label_en: 'SCG failure scg-ReconfigFailure' }),
  },
  {
    id: 'ran-mcg-recovery',
    ko: 'Fast MCG recovery (Rel-16)', en: 'Fast MCG recovery (Rel-16)', zh: 'Fast MCG recovery (Rel-16)',
    desc_ko: 'MCG RLF 시 재수립 대신 SCG(SRB3) 경유 MCGFailureInformation → T316 내 복구(Rel-16 fast MCG recovery).',
    desc_en: 'On MCG RLF, instead of reestablishment send MCGFailureInformation via SCG (SRB3) → recover within T316 (Rel-16 fast MCG recovery).',
    desc_zh: 'MCG RLF 时不重建,经 SCG(SRB3)发送 MCGFailureInformation → T316 内恢复(Rel-16 快速 MCG 恢复)。',
    ref: 'TS 38.331 §5.7.3b (MCGFailureInformation, T316)', cause: 'MCGFailureInformation + T316', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'note', text: 'MCG RLF → SCG 경유 MCGFailureInformation → T316 내 복구' },
    ],
    expect: () => ({ label_ko: 'MCGFailureInformation → T316 내 복구', label_en: 'MCGFailureInformation → recover within T316' }),
  },

  // ════════ BULK D — 로밍/Inter-PLMN 추가 ════════
  {
    id: 'roaming-lbo-ok',
    ko: 'LBO 로밍 수립 성공', en: 'Local Breakout roaming OK', zh: 'LBO 漫游建立成功',
    desc_ko: 'Local Breakout: 방문 SMF/UPF + 방문 DN + 홈 SEPP/AUSF/UDM(인증) → 방문망에서 직접 인터넷 브레이크아웃.',
    desc_en: 'Local Breakout: visited SMF/UPF + visited DN + home SEPP/AUSF/UDM (auth) → direct internet breakout in the visited network.',
    desc_zh: 'Local Breakout:拜访 SMF/UPF + 拜访 DN + 归属 SEPP/AUSF/UDM(鉴权)→ 在拜访网直接本地疏导。',
    ref: 'TS 23.501 §5.6.1 (LBO) · TS 23.502 §4.3.2', cause: 'LBO (visited breakout)', domain: 'roaming', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'setDn', zone: 'B', on: true },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'LBO — 방문망 UPF/DN 직접 브레이크아웃(홈은 인증만)' },
    ],
    expect: (c) => {
      // LBO: 인증은 홈(A)에서 하므로 방문망(B) 도달성 체크는 AUSF/UDM을 요구하지 않는다.
      // 방문망 브레이크아웃 = B의 RU + AMF/SMF/UPF + B의 DN. 인증은 홈(A) SEPP/AUSF/UDM.
      const visitedReach =
        c.objects.some((o) => o.kind === 'gnb' && (o.zone ?? 'A') === 'B' && o.gnb?.enabled !== false) &&
        (['AMF', 'SMF', 'UPF'] as NfType[]).every((t) => c.coreNfs.some((n) => n.zone === 'B' && n.nf_type === t && n.enabled)) &&
        c.coreDn['B']
      const homeAuth = ['SEPP', 'AUSF', 'UDM'].every((t) => c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === (t as NfType) && n.enabled))
      return visitedReach && homeAuth
        ? { label_ko: 'LBO 로밍 성공 (방문망 브레이크아웃)', label_en: 'LBO roaming OK (visited breakout)' }
        : { label_ko: `LBO 불가: ${!homeAuth ? '홈 인증 NF 부족' : '방문망 NF/DN 부족'}`, label_en: `LBO fail: ${!homeAuth ? 'home auth NF missing' : 'visited NF/DN missing'}` }
    },
  },
  {
    id: 'roaming-lbo-fallback-hr',
    ko: 'LBO 미허용 → HR 폴백', en: 'LBO not allowed → HR fallback', zh: 'LBO 不允许 → HR 回退',
    desc_ko: 'DNN이 LBO 미허용 → 방문망 브레이크아웃 실패 → 홈라우티드(HR) 경로로 폴백 선택.',
    desc_en: 'DNN not allowed for LBO → visited breakout fails → falls back to the home-routed (HR) path.',
    desc_zh: 'DNN 不允许 LBO → 拜访本地疏导失败 → 回退到 home-routed(HR)路径。',
    ref: 'TS 23.501 §5.6.1 (LBO vs HR selection)', cause: 'LBO not allowed → HR fallback', domain: 'roaming', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'LBO 미허용 DNN → HR 경로로 폴백' },
    ],
    expect: (c) => {
      const p = computeRoamingPath(c.objects, c.coreNfs, c.coreDn, 'B', 'A')
      return p.ok
        ? { label_ko: 'LBO 실패 → HR 폴백 성공', label_en: 'LBO fail → HR fallback OK' }
        : { label_ko: `HR 폴백 불가: ${p.missing.join(', ')}`, label_en: `HR fallback fail: ${p.missing.join(', ')}` }
    },
  },
  {
    id: 'roaming-hr-qos-n16',
    ko: 'HR QoS 협상 실패 (N16)', en: 'HR QoS negotiation fail (N16)', zh: 'HR QoS 协商失败 (N16)',
    desc_ko: 'VPLMN이 HPLMN 요구 GBR 5QI 미지원 → N16 per-flow rejection → 해당 GBR flow만 거절(세션은 유지).',
    desc_en: 'VPLMN does not support the HPLMN-requested GBR 5QI → N16 per-flow rejection → only that GBR flow is rejected (session kept).',
    desc_zh: 'VPLMN 不支持 HPLMN 请求的 GBR 5QI → N16 逐流拒绝 → 仅拒绝该 GBR flow(会话保留)。',
    ref: 'TS 23.502 §4.3.2.2.2 (HR, N16 per-flow)', cause: 'N16 per-flow QoS rejection', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' },
      { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'VPLMN 미지원 GBR 5QI → N16 per-flow rejection' },
    ],
    expect: () => ({ label_ko: 'N16 per-flow rejection (GBR flow만 거절)', label_en: 'N16 per-flow rejection (only GBR flow)' }),
  },
  {
    id: 'roaming-n32f-plmn-mismatch',
    ko: 'N32-f PLMN ID 불일치', en: 'N32-f PLMN ID mismatch', zh: 'N32-f PLMN ID 不匹配',
    desc_ko: 'N32-f 인증서 내 PLMN ID와 SBI 메시지 PLMN 불일치 → SEPP가 ProblemDetails 4xx로 거절(스푸핑 방어).',
    desc_en: 'PLMN ID in the N32-f certificate does not match the SBI message PLMN → SEPP rejects with ProblemDetails 4xx (spoofing defense).',
    desc_zh: 'N32-f 证书中的 PLMN ID 与 SBI 消息 PLMN 不匹配 → SEPP 以 ProblemDetails 4xx 拒绝(反欺骗)。',
    ref: 'TS 33.501 §13 · TS 29.573 (N32-f PLMN check)', cause: 'ProblemDetails 4xx (PLMN ID mismatch)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: 'SEPP servedPlmn 불일치 → N32-f 4xx' },
    ],
    expect: () => ({ label_ko: 'N32-f 4xx — PLMN ID mismatch', label_en: 'N32-f 4xx — PLMN ID mismatch' }),
  },
  {
    id: 'roaming-n32c-security-fail',
    ko: 'N32-c 보안협상 실패', en: 'N32-c security negotiation fail', zh: 'N32-c 安全协商失败',
    desc_ko: '양측 SEPP의 n32 security capability 교집합 공집합(PRINS vs TLS 전용) → N32-c 4xx no common security capability.',
    desc_en: 'Empty intersection of the two SEPPs’ N32 security capabilities (PRINS vs TLS-only) → N32-c 4xx no common security capability.',
    desc_zh: '双侧 SEPP 的 N32 安全能力交集为空(PRINS vs 仅 TLS)→ N32-c 4xx 无共同安全能力。',
    ref: 'TS 33.501 §13.2 · TS 29.573 (N32-c handshake)', cause: 'N32-c 4xx no common security capability', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: 'PRINS vs TLS 전용 → 공통 보안방식 없음 → N32-c 4xx' },
    ],
    expect: () => ({ label_ko: 'N32-c 4xx — 공통 보안방식 없음', label_en: 'N32-c 4xx — no common security capability' }),
  },
  {
    id: 'roaming-n32f-context-lost',
    ko: 'N32-f Context 소실', en: 'N32-f context lost', zh: 'N32-f 上下文丢失',
    desc_ko: 'SEPP 재기동으로 n32fContextId 소실 → N32-f Error Report: context not found → N32-c 재핸드셰이크 필요.',
    desc_en: 'SEPP restart loses n32fContextId → N32-f Error Report: context not found → N32-c re-handshake needed.',
    desc_zh: 'SEPP 重启丢失 n32fContextId → N32-f Error Report:context not found → 需 N32-c 重新握手。',
    ref: 'TS 29.573 §6 (N32-f context)', cause: 'N32-f Error Report: context not found', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'disableNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: '홈 SEPP 재기동 → n32fContextId 소실 → context not found' },
    ],
    expect: () => ({ label_ko: 'N32-f context not found → 재핸드셰이크', label_en: 'N32-f context not found → re-handshake' }),
  },
  {
    id: 'roaming-prins-ipx-tamper',
    ko: 'PRINS IPX 변조 탐지 (JWS)', en: 'PRINS IPX tamper detected (JWS)', zh: 'PRINS IPX 篡改检测 (JWS)',
    desc_ko: 'IPX가 비인가 필드 변조 → 수신 SEPP JWS 무결성 검증 실패(modificationsBlock 비인가 필드) → 거절.',
    desc_en: 'IPX tampers with a non-authorized field → receiving SEPP JWS integrity check fails (unauthorized modificationsBlock field) → rejected.',
    desc_zh: 'IPX 篡改未授权字段 → 接收 SEPP JWS 完整性校验失败(未授权 modificationsBlock 字段)→ 拒绝。',
    ref: 'TS 33.501 §13.2 (PRINS) · TS 29.573 (JWS/modificationsBlock)', cause: 'JWS integrity failure (unauthorized IPX modification)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: 'IPX 비인가 필드 변조 → JWS 무결성 실패' },
    ],
    expect: () => ({ label_ko: 'JWS 무결성 실패 — IPX 변조 탐지', label_en: 'JWS integrity fail — IPX tamper detected' }),
  },
  {
    id: 'roaming-nrf-discovery-ok',
    ko: 'Cross-PLMN NRF Discovery (N27)', en: 'Cross-PLMN NRF Discovery (N27)', zh: '跨 PLMN NRF 发现 (N27)',
    desc_ko: 'vNRF → (SEPP/N32) → hNRF 로 Nnrf_NFDiscovery → 홈 NF-profile 반환 → 로밍 등록 진행.',
    desc_en: 'vNRF → (SEPP/N32) → hNRF Nnrf_NFDiscovery → home NF-profiles returned → roaming registration proceeds.',
    desc_zh: 'vNRF →(SEPP/N32)→ hNRF Nnrf_NFDiscovery → 返回归属 NF-profile → 漫游注册继续。',
    ref: 'TS 29.510 §5 (cross-PLMN discovery, N27)', cause: 'vNRF→hNRF discovery (N27)', domain: 'roaming', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'NRF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'NRF' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'vNRF→N32→hNRF discovery 성공' },
    ],
    expect: () => ({ label_ko: 'vNRF→hNRF discovery 성공', label_en: 'vNRF→hNRF discovery OK' }),
  },
  {
    id: 'roaming-fail-hnrf',
    ko: 'hNRF 도달불가 (504)', en: 'hNRF unreachable (504)', zh: 'hNRF 不可达 (504)',
    desc_ko: '홈 NRF 제거 → vNRF의 cross-PLMN discovery 무응답 → 504 Gateway Timeout ProblemDetails → 로밍 등록 실패.',
    desc_en: 'Home NRF removed → vNRF cross-PLMN discovery times out → 504 Gateway Timeout ProblemDetails → roaming registration fails.',
    desc_zh: '归属 NRF 移除 → vNRF 跨 PLMN 发现超时 → 504 Gateway Timeout ProblemDetails → 漫游注册失败。',
    ref: 'TS 29.510 · TS 29.500 (ProblemDetails 504)', cause: '504 Gateway Timeout (hNRF)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'NRF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'removeNf', zone: 'A', type: 'NRF' },
      { op: 'note', text: 'hNRF 제거 → cross-PLMN discovery 504' },
    ],
    expect: () => ({ label_ko: 'hNRF 도달불가 → 504 → 로밍 실패', label_en: 'hNRF unreachable → 504 → roaming fail' }),
  },
  {
    id: 'roaming-routing-indicator-fail',
    ko: '잘못된 Routing Indicator', en: 'Wrong Routing Indicator', zh: '错误的 Routing Indicator',
    desc_ko: 'SUCI Routing Indicator가 프로비저닝 값과 다름 → NRF discovery 0건(UDM group not found) → 등록 실패.',
    desc_en: 'SUCI Routing Indicator differs from provisioned value → NRF discovery returns 0 (UDM group not found) → registration fails.',
    desc_zh: 'SUCI Routing Indicator 与开通值不同 → NRF 发现 0 条(UDM group not found)→ 注册失败。',
    ref: 'TS 23.003 §2.2b (Routing Indicator) · TS 29.510', cause: 'Routing Indicator mismatch → UDM group not found', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'NRF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: 'SIM Routing Indicator를 프로비저닝값과 다르게 → UDM group not found' },
    ],
    expect: () => ({ label_ko: 'Routing Indicator 불일치 → UDM 미발견', label_en: 'Routing Indicator mismatch → UDM not found' }),
  },
  {
    id: 'roaming-sor-absent',
    ko: 'SoR 컨테이너 삭제 탐지', en: 'SoR container absent (detected)', zh: 'SoR 容器缺失 (被检测)',
    desc_ko: 'VPLMN이 SoR 컨테이너 삭제 → UE는 SoR 기대했으나 부재 → VPLMN misbehaving 판정(TS 23.122).',
    desc_en: 'VPLMN deletes the SoR container → UE expected SoR but it is absent → deems VPLMN misbehaving (TS 23.122).',
    desc_zh: 'VPLMN 删除 SoR 容器 → UE 期望 SoR 但缺失 → 判定 VPLMN 行为异常(TS 23.122)。',
    ref: 'TS 33.501 §6.14 · TS 23.122 (SoR expected)', cause: 'SoR expected but absent → VPLMN misbehaving', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'VPLMN이 SoR 컨테이너 삭제 → UE misbehaving 판정' },
    ],
    expect: () => ({ label_ko: 'SoR 부재 → VPLMN misbehaving', label_en: 'SoR absent → VPLMN misbehaving' }),
  },
  {
    id: 'roaming-sor-counter-wrap',
    ko: 'CounterSoR 고갈', en: 'CounterSoR wrap-around', zh: 'CounterSoR 耗尽',
    desc_ko: 'CounterSoR(16bit) wrap-around 임박 → 재인증으로 KAUSF 재생성 → 카운터 리셋.',
    desc_en: 'CounterSoR (16-bit) wrap-around imminent → re-authentication regenerates K_AUSF → counter reset.',
    desc_zh: 'CounterSoR(16bit)接近回绕 → 重鉴权再生成 K_AUSF → 计数器复位。',
    ref: 'TS 33.501 §6.14 (CounterSoR)', cause: 'CounterSoR wrap → re-auth (K_AUSF)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'CounterSoR 0xFFFF 임박 → 재인증으로 KAUSF 재생성' },
    ],
    expect: () => ({ label_ko: 'CounterSoR wrap → 재인증(KAUSF)', label_en: 'CounterSoR wrap → re-auth (K_AUSF)' }),
  },
  {
    id: 'roaming-sor-cmci-fallback',
    ko: 'SoR 실패 → SOR-CMCI 폴백', en: 'SoR fail → SOR-CMCI fallback', zh: 'SoR 失败 → SOR-CMCI 回退',
    desc_ko: 'SoR 검증 실패 시 SOR-CMCI 폴백 — ME NVM 저장값이 USIM보다 우선(TS 23.122 C.4).',
    desc_en: 'On SoR verification failure, fall back to SOR-CMCI — ME NVM stored value takes priority over USIM (TS 23.122 C.4).',
    desc_zh: 'SoR 校验失败时回退 SOR-CMCI — ME NVM 存储值优先于 USIM(TS 23.122 C.4)。',
    ref: 'TS 23.122 §C.4 (SOR-CMCI, ME NVM > USIM)', cause: 'SoR fail → SOR-CMCI fallback', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: 'SoR 검증 실패 → SOR-CMCI 폴백(ME NVM 우선)' },
    ],
    expect: () => ({ label_ko: 'SoR 실패 → SOR-CMCI 폴백', label_en: 'SoR fail → SOR-CMCI fallback' }),
  },
  {
    id: 'roaming-mint-ok',
    ko: '재난 로밍(MINT) 성공', en: 'Disaster roaming (MINT) OK', zh: '灾难漫游(MINT)成功',
    desc_ko: '홈 PLMN 재난 → 협정 없는 VPLMN에도 registration type="disaster roaming"으로 등록 성공(MINT).',
    desc_en: 'Home PLMN in disaster → registers on a VPLMN without agreement using registration type="disaster roaming" (MINT).',
    desc_zh: '归属 PLMN 灾难 → 以 registration type="disaster roaming" 在无协议 VPLMN 注册成功(MINT)。',
    ref: 'TS 23.501 §5.40 (MINT) · TS 24.501', cause: 'disaster roaming registration', domain: 'roaming', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' }, { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'setDn', zone: 'B', on: true },
      { op: 'note', text: '홈 재난 조건 → VPLMN-B disaster roaming 등록 허용' },
    ],
    expect: () => ({ label_ko: '재난 로밍 등록 성공 (MINT)', label_en: 'disaster roaming registration OK (MINT)' }),
  },
  {
    id: 'lte-roaming-s6a-5004',
    ko: 'LTE 로밍 거절 (S6a 5004 → EMM #11)', en: 'LTE roaming reject (S6a 5004 → EMM #11)', zh: 'LTE 漫游拒绝 (S6a 5004 → EMM #11)',
    desc_ko: '방문 MME → 홈 HSS S6a ULR: DIAMETER_ERROR_ROAMING_NOT_ALLOWED(5004) → Attach Reject EMM #11 PLMN not allowed.',
    desc_en: 'Visited MME → home HSS S6a ULR: DIAMETER_ERROR_ROAMING_NOT_ALLOWED (5004) → Attach Reject EMM #11 PLMN not allowed.',
    desc_zh: '拜访 MME → 归属 HSS S6a ULR:DIAMETER_ERROR_ROAMING_NOT_ALLOWED(5004)→ Attach Reject EMM #11。',
    ref: 'TS 29.272 (S6a 5004) · TS 24.301 EMM #11', cause: 'S6a 5004 → EMM #11', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'HSS' },
      { op: 'note', text: '방문 MME → 홈 HSS S6a 5004 → EMM #11' },
    ],
    expect: () => ({ label_ko: 'S6a 5004 → Attach Reject EMM #11', label_en: 'S6a 5004 → Attach Reject EMM #11' }),
  },
  {
    id: 'roaming-misissued-11',
    ko: '오발행 #11 (홈 장애 함정)', en: 'Mis-issued #11 (home outage trap)', zh: '误发 #11 (归属故障陷阱)',
    desc_ko: '홈 UDM/HSS 다운 시 VPLMN AMF가 #11(영구 차단) 대신 #17 network failure/#22 congestion을 써야 함 — 오발행 시 영구 forbidden 등록.',
    desc_en: 'When home UDM/HSS is down, VPLMN AMF should use #17 network failure/#22 congestion, not #11 (permanent block) — mis-issuing #11 permanently forbids the PLMN.',
    desc_zh: '归属 UDM/HSS 宕机时,VPLMN AMF 应用 #17 network failure/#22 congestion,而非 #11(永久封禁)— 误发 #11 会永久禁用该 PLMN。',
    ref: 'TS 24.501 §5.5.1.2.5 (cause selection) · operational pitfall', cause: 'should be #17/#22, not #11 (home outage)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' }, { op: 'disableNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '홈 UDM 다운 → #11 대신 #17/#22 사용해야 함(오발행 방지)' },
    ],
    expect: () => ({ label_ko: '홈 장애 → #17/#22 (❌#11 영구차단)', label_en: 'home outage → #17/#22 (not #11 permanent block)' }),
  },
  {
    id: 'inter-plmn-n2-ho-ok',
    ko: 'Inter-PLMN N2 HO (HR 유지)', en: 'Inter-PLMN N2 HO (HR retained)', zh: '跨 PLMN N2 切换 (保持 HR)',
    desc_ko: '양측 AMF/SEPP 존재(N14 근사) → NGAP HandoverRequired → N14 UEContext → HandoverRequest/Ack → HR 앵커 동일, 세션 유지.',
    desc_en: 'Both AMF/SEPP present (N14 approx) → NGAP HandoverRequired → N14 UEContext → HandoverRequest/Ack → same HR anchor, session retained.',
    desc_zh: '双侧 AMF/SEPP 存在(N14 近似)→ NGAP HandoverRequired → N14 UEContext → HandoverRequest/Ack → HR 锚点不变,会话保留。',
    ref: 'TS 23.502 §4.9.1 (inter-PLMN N2 HO) · N14', cause: 'inter-PLMN N2 handover (HR retained)', domain: 'roaming', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureRU', zone: 'B' },
      { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SEPP' },
      { op: 'note', text: '양측 AMF/SEPP → 연결모드 inter-PLMN N2 HO, HR 앵커 유지' },
    ],
    expect: () => ({ label_ko: 'inter-PLMN N2 HO 성공 (세션 유지)', label_en: 'inter-PLMN N2 HO OK (session retained)' }),
  },
  {
    id: 'inter-plmn-ho-fail-n14',
    ko: 'Inter-PLMN HO 실패 (N14 부재)', en: 'Inter-PLMN HO fail (no N14)', zh: '跨 PLMN 切换失败 (无 N14)',
    desc_ko: '상대측 SEPP/AMF 부재 → NGAP Handover Preparation Failure(no N14/roaming agreement) → 드롭+재등록 폴백.',
    desc_en: 'Peer SEPP/AMF absent → NGAP Handover Preparation Failure (no N14/roaming agreement) → drop + re-registration fallback.',
    desc_zh: '对端 SEPP/AMF 缺失 → NGAP Handover Preparation Failure(无 N14/漫游协议)→ 掉话 + 重注册回退。',
    ref: 'TS 38.413 §8.4 (Handover Preparation Failure)', cause: 'Handover Preparation Failure (no N14)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'removeNf', zone: 'B', type: 'SEPP' },
      { op: 'note', text: '상대측 SEPP 부재 → HO Preparation Failure → 드롭' },
    ],
    expect: () => ({ label_ko: 'HO Preparation Failure (N14 부재) → 드롭', label_en: 'HO Preparation Failure (no N14) → drop' }),
  },
  {
    id: 'inter-plmn-lbo-release',
    ko: 'Inter-PLMN 이동 시 LBO 해제', en: 'Inter-PLMN move → LBO release', zh: '跨 PLMN 移动 → LBO 释放',
    desc_ko: 'LBO 세션은 앵커 UPF(구 VPLMN) 이전 불가 → 존 이동 시 PDU Session Release(SSC mode 1 연속성 없음) → 신규 존 재수립.',
    desc_en: 'LBO session cannot relocate the anchor UPF (old VPLMN) → on zone change, PDU Session Release (no SSC mode 1 continuity) → re-establish in new zone.',
    desc_zh: 'LBO 会话无法迁移锚点 UPF(旧 VPLMN)→ 换区时 PDU Session Release(无 SSC mode 1 连续性)→ 新区重建。',
    ref: 'TS 23.501 §5.6.1 (LBO no continuity on PLMN change)', cause: 'LBO session release (no continuity)', domain: 'roaming', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'B' }, { op: 'ensureNf', zone: 'B', type: 'AMF' }, { op: 'ensureNf', zone: 'B', type: 'SMF' }, { op: 'ensureNf', zone: 'B', type: 'UPF' }, { op: 'setDn', zone: 'B', on: true },
      { op: 'note', text: 'LBO 세션 → inter-PLMN 이동 시 앵커 이전 불가 → 해제 후 재수립' },
    ],
    expect: () => ({ label_ko: 'LBO 세션 해제 (연속성 없음) → 재수립', label_en: 'LBO session released (no continuity) → re-establish' }),
  },
  // ════════ BULK D — VoNR/IMS 추가 ════════
  {
    id: 'ims-reg-423',
    ko: 'IMS 등록 423 Interval Too Brief', en: 'IMS reg 423 Interval Too Brief', zh: 'IMS 注册 423 Interval Too Brief',
    desc_ko: 'REGISTER expires가 최소값 미만 → S-CSCF 423 Interval Too Brief + Min-Expires → UE가 Min-Expires로 재등록.',
    desc_en: 'REGISTER expires below minimum → S-CSCF 423 Interval Too Brief + Min-Expires → UE re-registers with Min-Expires.',
    desc_zh: 'REGISTER expires 低于最小值 → S-CSCF 423 Interval Too Brief + Min-Expires → UE 用 Min-Expires 重注册。',
    ref: 'TS 24.229 · RFC 3261 §10.2.8 (423 Interval Too Brief)', cause: 'SIP 423 Interval Too Brief', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'expires 너무 짧음 → 423 + Min-Expires 재등록' },
    ],
    expect: () => ({ label_ko: '423 Interval Too Brief → Min-Expires 재등록', label_en: '423 Interval Too Brief → re-register with Min-Expires' }),
  },
  {
    id: 'ims-reg-aka-resync',
    ko: 'IMS AKA MAC 실패/재동기', en: 'IMS AKA MAC fail / resync', zh: 'IMS AKA MAC 失败/重同步',
    desc_ko: 'ISIM 키 불일치 → 401 후 MAC failure(등록 실패) 또는 SQN 불일치 시 REGISTER(auts=) 재동기.',
    desc_en: 'ISIM key mismatch → after 401, MAC failure (reg fails) or, on SQN mismatch, REGISTER(auts=) resync.',
    desc_zh: 'ISIM 密钥不匹配 → 401 后 MAC failure(注册失败),或 SQN 不匹配时 REGISTER(auts=)重同步。',
    ref: 'TS 33.203 (IMS AKA) · TS 24.229', cause: 'IMS AKA MAC failure / AUTS resync', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'ISIM 키 불일치 → MAC failure / AUTS 재동기' },
    ],
    expect: () => ({ label_ko: 'IMS AKA MAC 실패 / AUTS 재동기', label_en: 'IMS AKA MAC fail / AUTS resync' }),
  },
  {
    id: 'ims-reg-ipsec-mismatch',
    ko: 'IMS IPsec SA 불일치', en: 'IMS IPsec SA mismatch', zh: 'IMS IPsec SA 不匹配',
    desc_ko: '401 성공 후 IPsec SA 파라미터 불일치 → 보호 REGISTER 무응답(Timer B) → 등록 실패.',
    desc_en: 'After 401 success, IPsec SA parameter mismatch → protected REGISTER gets no response (Timer B) → registration fails.',
    desc_zh: '401 成功后 IPsec SA 参数不匹配 → 受保护 REGISTER 无响应(Timer B)→ 注册失败。',
    ref: 'TS 33.203 §7 (IPsec SA) · TS 24.229', cause: 'IPsec SA mismatch (protected REGISTER lost)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'IPsec SA 파라미터 불일치 → 보호 REGISTER 유실' },
    ],
    expect: () => ({ label_ko: 'IPsec SA 불일치 → 보호 REGISTER 유실', label_en: 'IPsec SA mismatch → protected REGISTER lost' }),
  },
  {
    id: 'ims-reg-600',
    ko: 'IMS 등록 600 Busy Everywhere', en: 'IMS reg 600 Busy Everywhere', zh: 'IMS 注册 600 Busy Everywhere',
    desc_ko: 'I-CSCF up이나 S-CSCF 할당 실패 → 600 Busy Everywhere (S-CSCF assignment fail).',
    desc_en: 'I-CSCF up but S-CSCF assignment fails → 600 Busy Everywhere (S-CSCF assignment fail).',
    desc_zh: 'I-CSCF 在线但 S-CSCF 分配失败 → 600 Busy Everywhere(S-CSCF 分配失败)。',
    ref: 'TS 24.229 · RFC 3261 (600 Busy Everywhere)', cause: 'SIP 600 (S-CSCF assignment fail)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'removeNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'I-CSCF up + S-CSCF 부재 → 600 Busy Everywhere' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      return !ims.ok && ims.missing.includes('S-CSCF')
        ? { label_ko: '600 Busy Everywhere — S-CSCF 할당 실패', label_en: '600 Busy Everywhere — S-CSCF assignment fail' }
        : { label_ko: '예상과 다름', label_en: 'unexpected' }
    },
  },
  {
    id: 'ims-reg-504',
    ko: 'IMS 등록 504 Server Time-out', en: 'IMS reg 504 Server Time-out', zh: 'IMS 注册 504 Server Time-out',
    desc_ko: 'S-CSCF 무응답(disabled) → I-CSCF: no response from S-CSCF → 504 Server Time-out.',
    desc_en: 'S-CSCF unresponsive (disabled) → I-CSCF: no response from S-CSCF → 504 Server Time-out.',
    desc_zh: 'S-CSCF 无响应(disabled)→ I-CSCF:no response from S-CSCF → 504 Server Time-out。',
    ref: 'TS 24.229 · RFC 3261 (504 Server Time-out)', cause: 'SIP 504 Server Time-out', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'disableNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'S-CSCF disabled(무응답) → I-CSCF 504 Server Time-out' },
    ],
    expect: () => ({ label_ko: '504 Server Time-out — S-CSCF 무응답', label_en: '504 Server Time-out — S-CSCF no response' }),
  },
  {
    id: 'ims-dereg-notify',
    ko: '망 주도 IMS 등록해제 (NOTIFY)', en: 'NW-init IMS dereg (NOTIFY)', zh: '网络发起 IMS 去注册 (NOTIFY)',
    desc_ko: '해당 존 S-CSCF 상실 → NOTIFY(reg-event, state=terminated, event=deactivated) → UE IMS 재등록 필요, 진행 통화 failed.',
    desc_en: 'Loss of S-CSCF in the zone → NOTIFY (reg-event, state=terminated, event=deactivated) → UE must re-register IMS; ongoing call fails.',
    desc_zh: '该区 S-CSCF 丢失 → NOTIFY(reg-event, state=terminated, event=deactivated)→ UE 需 IMS 重注册,进行中通话失败。',
    ref: 'TS 24.229 · RFC 3680 (reg-event NOTIFY terminated)', cause: 'reg-event NOTIFY terminated', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'disableNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'S-CSCF 상실 → NOTIFY terminated → IMS 재등록 필요' },
    ],
    expect: () => ({ label_ko: 'NOTIFY terminated → IMS 재등록 필요', label_en: 'NOTIFY terminated → IMS re-registration required' }),
  },
  {
    id: 'vonr-mt-ok-paging',
    ko: 'VoNR MT 호 성공 (페이징)', en: 'VoNR MT call OK (paging)', zh: 'VoNR MT 通话成功 (寻呼)',
    desc_ko: '착신 CM-IDLE → AMF Paging(5G-S-TMSI) → UE Service Request → InitialContextSetup → INVITE 전달 → 통화 성립.',
    desc_en: 'Callee CM-IDLE → AMF Paging (5G-S-TMSI) → UE Service Request → InitialContextSetup → INVITE delivered → call up.',
    desc_zh: '被叫 CM-IDLE → AMF Paging(5G-S-TMSI)→ UE Service Request → InitialContextSetup → INVITE 送达 → 通话建立。',
    ref: 'TS 23.502 §4.2.3.3 (paging) · TS 24.229', cause: 'VoNR MT call with paging', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'ensurePerson', zone: 'A', name: 'UE-A1' }, { op: 'ensurePerson', zone: 'A', name: 'UE-A2' },
    ],
    expect: (c) => {
      const call = computeCall(c.objects, c.coreNfs, c.coreDn, 'A', 'A')
      return call.ok
        ? { label_ko: 'VoNR MT 성공 (페이징 → 통화)', label_en: 'VoNR MT OK (paging → call)' }
        : { label_ko: `불가: ${call.missing.join(', ')}`, label_en: `fail: ${call.missing.join(', ')}` }
    },
  },
  {
    id: 'vonr-roaming-transcode',
    ko: '로밍 코덱 트랜스코딩 구제', en: 'Roaming codec transcoding rescue', zh: '漫游编解码转码救活',
    desc_ko: '국제 구간 EVS↔AMR-WB SDP 불일치 → IBCF/SBC(MGW)가 트랜스코딩·미디어 anchoring → 통화 구제.',
    desc_en: 'EVS↔AMR-WB SDP mismatch on the international leg → IBCF/SBC(MGW) transcodes + media anchoring → call rescued.',
    desc_zh: '国际段 EVS↔AMR-WB SDP 不匹配 → IBCF/SBC(MGW)转码 + 媒体锚定 → 通话救活。',
    ref: 'TS 29.165 (IBCF) · GSMA IR.65 (transcoding)', cause: 'EVS↔AMR-WB transcoding (rescue)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'MGW' }, { op: 'ensureNf', zone: 'A', type: 'SEPP' },
      { op: 'note', text: '로밍 EVS↔AMR-WB 불일치 → SBC 트랜스코딩 구제' },
    ],
    expect: () => ({ label_ko: 'SBC 트랜스코딩 → 통화 구제', label_en: 'SBC transcoding → call rescued' }),
  },
  {
    id: 'vonr-480-callee-dereg',
    ko: '480 착신 IMS 등록 상실', en: '480 callee IMS reg lost', zh: '480 被叫 IMS 注册丢失',
    desc_ko: '착신 UE의 IMS 바인딩 없음/만료 → S-CSCF: 480 Temporarily Unavailable → 통화 실패.',
    desc_en: 'Callee IMS binding missing/expired → S-CSCF: 480 Temporarily Unavailable → call fails.',
    desc_zh: '被叫 IMS 绑定缺失/过期 → S-CSCF:480 Temporarily Unavailable → 通话失败。',
    ref: 'TS 24.229 · RFC 3261 (480)', cause: 'SIP 480 Temporarily Unavailable', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: '착신 IMS 바인딩 없음 → 480 Temporarily Unavailable' },
    ],
    expect: () => ({ label_ko: '480 Temporarily Unavailable (착신 등록 상실)', label_en: '480 Temporarily Unavailable (callee dereg)' }),
  },
  {
    id: 'vonr-408-timeout',
    ko: '408 Request Timeout (Timer B/F)', en: '408 Request Timeout (Timer B/F)', zh: '408 Request Timeout (Timer B/F)',
    desc_ko: 'IMS NF 존재하나 무응답(disabled) → STEP 지연 후 Timer B(64×T1) 만료 → 408 Request Timeout.',
    desc_en: 'IMS NF present but unresponsive (disabled) → after delay Timer B (64×T1) expiry → 408 Request Timeout.',
    desc_zh: 'IMS NF 存在但无响应(disabled)→ 延迟后 Timer B(64×T1)到期 → 408 Request Timeout。',
    ref: 'TS 24.229 · RFC 3261 §8.1.3.1 (408/Timer B)', cause: 'SIP 408 Request Timeout', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'disableNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'IMS NF 무응답 → Timer B 만료 → 408' },
    ],
    expect: () => ({ label_ko: '408 Request Timeout (Timer B 만료)', label_en: '408 Request Timeout (Timer B expiry)' }),
  },
  {
    id: 'vonr-invite-403',
    ko: 'INVITE 403 (발신 차단)', en: 'INVITE 403 (originating barred)', zh: 'INVITE 403 (主叫受限)',
    desc_ko: '발신금지/로밍 발신 제한 UE → S-CSCF/TAS: 403 Forbidden → 발신 실패.',
    desc_en: 'Barred/roaming-restricted originating UE → S-CSCF/TAS: 403 Forbidden → call fails.',
    desc_zh: '被限制/漫游受限的主叫 UE → S-CSCF/TAS:403 Forbidden → 呼叫失败。',
    ref: 'TS 24.229 · RFC 3261 (403 Forbidden)', cause: 'SIP 403 Forbidden (barred)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: '발신금지/로밍 제한 → 403 Forbidden' },
    ],
    expect: () => ({ label_ko: 'INVITE 403 Forbidden (발신 차단)', label_en: 'INVITE 403 Forbidden (originating barred)' }),
  },
  {
    id: 'vonr-epsfb-no-n26',
    ko: 'EPS Fallback (N26 미지원)', en: 'EPS Fallback (no N26)', zh: 'EPS Fallback (无 N26)',
    desc_ko: 'N26 미지원망 → RRCRelease redirect → LTE Attach(full) + PDN 재수립 → 통화연결 지연 증가.',
    desc_en: 'No N26 → RRCRelease redirect → LTE Attach (full) + PDN re-establishment → increased call setup delay.',
    desc_zh: '无 N26 → RRCRelease redirect → LTE Attach(full)+ PDN 重建 → 通话建立时延增加。',
    ref: 'TS 23.502 §4.13.6.1 (EPS fallback, no N26)', cause: 'EPS Fallback redirect (no N26, full attach)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'N26 미지원 → redirect + full LTE Attach → 지연 증가' },
    ],
    expect: () => ({ label_ko: 'EPS Fallback (redirect, full attach) — 지연 증가', label_en: 'EPS Fallback (redirect, full attach) — extra delay' }),
  },
  {
    id: 'vonr-epsfb-fail-congestion',
    ko: 'EPS Fallback 실패 (LTE 혼잡)', en: 'EPS Fallback fail (LTE congestion)', zh: 'EPS Fallback 失败 (LTE 拥塞)',
    desc_ko: '타겟 LTE 셀 없음/만석 → E-RAB setup fail (QCI1) → 호 실패.',
    desc_en: 'No/full target LTE cell → E-RAB setup fail (QCI1) → call fails.',
    desc_zh: '无/满载目标 LTE 小区 → E-RAB setup fail(QCI1)→ 呼叫失败。',
    ref: 'TS 23.216 · TS 36.413 (E-RAB setup fail)', cause: 'E-RAB setup fail (QCI1) → call fail', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: '타겟 LTE 셀 없음/만석 → E-RAB setup fail QCI1' },
    ],
    expect: () => ({ label_ko: 'EPS Fallback 실패 — E-RAB(QCI1) 거절', label_en: 'EPS Fallback fail — E-RAB (QCI1) rejected' }),
  },
  {
    id: 'vonr-emergency-anonymous',
    ko: '익명 긴급호 (limited service)', en: 'Anonymous emergency (limited service)', zh: '匿名紧急呼叫 (受限服务)',
    desc_ko: '미등록 IMSI여도 긴급호 허용 → limited service → emergency registration(anonymous) → sos DNN.',
    desc_en: 'Even with an unregistered IMSI, emergency call is allowed → limited service → emergency registration (anonymous) → sos DNN.',
    desc_zh: '即使 IMSI 未注册也允许紧急呼叫 → 受限服务 → 紧急注册(匿名)→ sos DNN。',
    ref: 'TS 23.167 · TS 24.501 §5.5.1 (emergency registration)', cause: 'anonymous emergency (limited service)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: '미등록 IMSI → 익명 긴급 등록 → sos DNN' },
    ],
    expect: () => ({ label_ko: '익명 긴급호 성공 (sos DNN)', label_en: 'anonymous emergency call OK (sos DNN)' }),
  },
  {
    id: 'vonr-380-alt-service',
    ko: '380 Alternative Service', en: '380 Alternative Service', zh: '380 Alternative Service',
    desc_ko: '일반 INVITE에 긴급번호 → P-CSCF 380 Alternative Service(XML emergency) → UE 긴급등록 후 재발신.',
    desc_en: 'Emergency number in a normal INVITE → P-CSCF 380 Alternative Service (XML emergency) → UE emergency-registers then redials.',
    desc_zh: '普通 INVITE 携带紧急号码 → P-CSCF 380 Alternative Service(XML emergency)→ UE 紧急注册后重拨。',
    ref: 'TS 24.229 §5.1.6 (380 Alternative Service)', cause: 'SIP 380 Alternative Service', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: '일반 INVITE에 긴급번호 → 380 Alternative Service' },
    ],
    expect: () => ({ label_ko: '380 Alternative Service → 긴급 재발신', label_en: '380 Alternative Service → emergency redial' }),
  },
  {
    id: 'vonr-emergency-reject',
    ko: '긴급 등록 거절 (정책/미지원)', en: 'Emergency registration reject', zh: '紧急注册拒绝',
    desc_ko: '운용자 정책상 긴급 미지원 IM CN → 긴급 등록 거절(5GMM #5 계열/SIP 403).',
    desc_en: 'IM CN not supporting emergency by operator policy → emergency registration rejected (5GMM #5-family / SIP 403).',
    desc_zh: '按运营商策略 IM CN 不支持紧急 → 紧急注册被拒(5GMM #5 系列/SIP 403)。',
    ref: 'TS 23.167 · TS 24.501 §5.5.1 (emergency reject)', cause: 'emergency reject (policy) — 5GMM #5 / SIP 403', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '긴급 미지원 IM CN/정책 → 긴급 등록 거절' },
    ],
    expect: () => ({ label_ko: '긴급 등록 거절 (정책/미지원)', label_en: 'emergency registration reject (policy)' }),
  },
  {
    id: 'vonr-srvcc-ok',
    ko: 'eSRVCC 성공 (PS→CS)', en: 'eSRVCC success (PS→CS)', zh: 'eSRVCC 成功 (PS→CS)',
    desc_ko: '통화 중 5G/LTE→UTRAN/GERAN 이동 → Sv PS-to-CS + ATCF anchoring → 음성단절 <0.3s.',
    desc_en: 'In-call move 5G/LTE→UTRAN/GERAN → Sv PS-to-CS + ATCF anchoring → voice gap <0.3s.',
    desc_zh: '通话中 5G/LTE→UTRAN/GERAN 移动 → Sv PS-to-CS + ATCF 锚定 → 语音中断 <0.3s。',
    ref: 'TS 23.216 (eSRVCC) · TS 23.237 (ATCF)', cause: 'eSRVCC PS→CS (ATCF)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'MGW' },
      { op: 'note', text: '통화 중 eSRVCC → Sv PS-to-CS + ATCF anchoring' },
    ],
    expect: () => ({ label_ko: 'eSRVCC 성공 (음성단절 <0.3s)', label_en: 'eSRVCC OK (voice gap <0.3s)' }),
  },
  {
    id: 'vonr-srvcc-fail-stnsr',
    ko: 'SRVCC 실패 (STN-SR 무효)', en: 'SRVCC fail (STN-SR invalid)', zh: 'SRVCC 失败 (STN-SR 无效)',
    desc_ko: 'STN-SR 미프로비저닝 → MME Sv PS-to-CS Request → MSC Session Transfer leg 오류 → HO 실패·호 절단.',
    desc_en: 'STN-SR not provisioned → MME Sv PS-to-CS Request → MSC session transfer leg error → HO fail, call dropped.',
    desc_zh: 'STN-SR 未开通 → MME Sv PS-to-CS Request → MSC 会话转移腿错误 → HO 失败,通话中断。',
    ref: 'TS 23.216 (STN-SR) · TS 29.280 (Sv)', cause: 'STN-SR invalid → session transfer error', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: 'STN-SR 미프로비저닝 → 세션 이전 실패' },
    ],
    expect: () => ({ label_ko: 'SRVCC 실패 — STN-SR 무효', label_en: 'SRVCC fail — STN-SR invalid' }),
  },
  {
    id: 'vonr-srvcc-cancel',
    ko: 'SRVCC HO Cancel', en: 'SRVCC HO Cancel', zh: 'SRVCC HO Cancel',
    desc_ko: 'HO Command 후 취소 → Sv Cancel → IMS 세션 원복(PS 유지).',
    desc_en: 'Cancel after HO Command → Sv Cancel → IMS session restored (stay on PS).',
    desc_zh: 'HO Command 后取消 → Sv Cancel → IMS 会话恢复(保持 PS)。',
    ref: 'TS 23.216 (SRVCC cancel) · TS 29.280', cause: 'SRVCC HO cancel (Sv Cancel)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: 'HO Command 후 취소 → Sv Cancel → IMS 원복' },
    ],
    expect: () => ({ label_ko: 'SRVCC 취소 → IMS 세션 원복', label_en: 'SRVCC cancel → IMS session restored' }),
  },
  {
    id: 'vonr-asrvcc',
    ko: 'aSRVCC (Alerting 단계)', en: 'aSRVCC (alerting phase)', zh: 'aSRVCC (振铃阶段)',
    desc_ko: '착신벨 울림(ringing) 중 SRVCC 트리거 → alerting 상태 이전 성공(early media/precondition 처리).',
    desc_en: 'SRVCC triggered during ringing → alerting-state transfer succeeds (early media/precondition handled).',
    desc_zh: '振铃中触发 SRVCC → 振铃态转移成功(处理 early media/precondition)。',
    ref: 'TS 23.216 §6a (aSRVCC)', cause: 'aSRVCC (alerting-phase transfer)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'MGW' },
      { op: 'note', text: 'ringing 중 SRVCC → alerting 상태 이전 성공' },
    ],
    expect: () => ({ label_ko: 'aSRVCC 성공 (alerting 이전)', label_en: 'aSRVCC OK (alerting-phase transfer)' }),
  },
  {
    id: 'vonr-rsrvcc-fail',
    ko: 'rSRVCC 실패 (IMS 등록 상실)', en: 'rSRVCC fail (IMS reg lost)', zh: 'rSRVCC 失败 (IMS 注册丢失)',
    desc_ko: 'IMS 등록 만료 상태에서 CS→PS 역방향 SRVCC 시도 → 실패(등록 상실 원인).',
    desc_en: 'Reverse CS→PS SRVCC attempted while IMS registration expired → fails (registration lost).',
    desc_zh: 'IMS 注册过期时尝试 CS→PS 反向 SRVCC → 失败(注册丢失)。',
    ref: 'TS 23.216 §6b (rSRVCC)', cause: 'rSRVCC fail (IMS registration lost)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'removeNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'IMS 등록 만료 → CS→PS rSRVCC 실패' },
    ],
    expect: () => ({ label_ko: 'rSRVCC 실패 — IMS 등록 상실', label_en: 'rSRVCC fail — IMS registration lost' }),
  },
  {
    id: 'vonr-bye-timeout',
    ko: 'BYE 무응답 → 베어러 잔류', en: 'BYE timeout → bearer retained', zh: 'BYE 超时 → 承载残留',
    desc_ko: 'BYE → no response(Timer F 64×T1) → 로컬 해제 + Rx STR 미수행 → 5QI1 flow 잔류(과금 지속).',
    desc_en: 'BYE → no response (Timer F 64×T1) → local release + no Rx STR → 5QI1 flow retained (charging continues).',
    desc_zh: 'BYE → 无响应(Timer F 64×T1)→ 本地释放 + 未执行 Rx STR → 5QI1 flow 残留(计费持续)。',
    ref: 'TS 24.229 · RFC 3261 (Timer F) · TS 29.214 Rx STR', cause: 'BYE timeout (Timer F) → 5QI1 flow retained', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' },
      { op: 'note', text: 'BYE 무응답 Timer F → Rx STR 미수행 → 5QI1 flow 잔류' },
    ],
    expect: () => ({ label_ko: 'BYE 타임아웃 → 5QI1 flow 잔류(과금)', label_en: 'BYE timeout → 5QI1 flow retained (charging)' }),
  },
  {
    id: 'vonr-oneway-alg',
    ko: '단방향 음성 (SIP ALG)', en: 'One-way audio (SIP ALG)', zh: '单向语音 (SIP ALG)',
    desc_ko: 'SIP ALG가 SDP c=/m= 재작성 → RTP 편도 차단 → 단방향 음성(해결: ALG off).',
    desc_en: 'SIP ALG rewrites SDP c=/m= → one-way RTP blocked → one-way audio (fix: disable ALG).',
    desc_zh: 'SIP ALG 改写 SDP c=/m= → 单向 RTP 被阻 → 单向语音(解决:关闭 ALG)。',
    ref: 'RFC 3261 SDP · NAT/SIP ALG pitfall', cause: 'SIP ALG SDP rewrite → one-way RTP', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'SIP ALG SDP 재작성 → RTP 편도 차단' },
    ],
    expect: () => ({ label_ko: '단방향 음성 — SIP ALG SDP 변조', label_en: 'one-way audio — SIP ALG SDP rewrite' }),
  },
  {
    id: 'vonr-oneway-hold',
    ko: '단방향 음성 (hold/resume)', en: 'One-way audio (hold/resume)', zh: '单向语音 (hold/resume)',
    desc_ko: 'hold 후 resume에서 sendrecv 미복원(sendonly 고착) → resume 후 단방향 음성.',
    desc_en: 'After hold, resume fails to restore sendrecv (stuck sendonly) → one-way audio after resume.',
    desc_zh: 'hold 后 resume 未恢复 sendrecv(卡在 sendonly)→ resume 后单向语音。',
    ref: 'RFC 3264 (hold/resume) · TS 24.229', cause: 'resume sendrecv not restored → one-way', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'resume re-INVITE에서 sendrecv 미복원 → 단방향' },
    ],
    expect: () => ({ label_ko: 'resume sendrecv 미복원 → 단방향', label_en: 'resume sendrecv not restored → one-way' }),
  },
  {
    id: 'vonr-pcscf-restoration',
    ko: 'P-CSCF Restoration', en: 'P-CSCF Restoration', zh: 'P-CSCF 恢复',
    desc_ko: 'P-CSCF 장애 → HSS restoration indication → PDN modify(PCO: new P-CSCF) → UE re-REGISTER to P-CSCF-2.',
    desc_en: 'P-CSCF failure → HSS restoration indication → PDN modify (PCO: new P-CSCF) → UE re-REGISTERs to P-CSCF-2.',
    desc_zh: 'P-CSCF 故障 → HSS restoration indication → PDN modify(PCO:new P-CSCF)→ UE 重注册到 P-CSCF-2。',
    ref: 'TS 23.380 §5.4 (P-CSCF restoration)', cause: 'P-CSCF restoration (HSS indication)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'HSS' },
      { op: 'note', text: 'P-CSCF 장애 → HSS restoration → 새 P-CSCF 재등록' },
    ],
    expect: () => ({ label_ko: 'P-CSCF Restoration → 새 P-CSCF 재등록', label_en: 'P-CSCF restoration → re-register to new P-CSCF' }),
  },
  {
    id: 'vonr-gnb-admission-reject',
    ko: 'gNB 어드미션 5QI1 거절', en: 'gNB admission 5QI1 reject', zh: 'gNB 准入 5QI1 拒绝',
    desc_ko: 'VoNR 셀 혼잡 → NGAP PDU Session Modify: QoS flow failed (not-enough-user-plane-processing-resources) → 580 또는 EPS fallback.',
    desc_en: 'VoNR cell congested → NGAP PDU Session Modify: QoS flow failed (not-enough-user-plane-processing-resources) → 580 or EPS fallback.',
    desc_zh: 'VoNR 小区拥塞 → NGAP PDU Session Modify:QoS flow failed(用户面处理资源不足)→ 580 或 EPS fallback。',
    ref: 'TS 38.413 (QoS flow failed to setup) · GSMA IR.92', cause: 'QoS flow failed (not-enough-UP-resources) → 580/EPSFB', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'VoNR 셀 혼잡 → 5QI1 QoS flow 거절 → 580/EPSFB' },
    ],
    expect: () => ({ label_ko: '5QI1 QoS flow 거절 → 580/EPS fallback', label_en: '5QI1 QoS flow rejected → 580/EPS fallback' }),
  },
  {
    id: 'ims-rx-pcrf-fail',
    ko: 'IMS Rx PCRF 오류 (등록 실패)', en: 'IMS Rx PCRF error (reg fail)', zh: 'IMS Rx PCRF 错误 (注册失败)',
    desc_ko: 'PCRF 부재/무응답 → P-CSCF Rx AAR Diameter timeout/UNABLE_TO_COMPLY → 403/500 등록 실패(open5gs IMS 연동 실검증).',
    desc_en: 'PCRF absent/unresponsive → P-CSCF Rx AAR Diameter timeout/UNABLE_TO_COMPLY → 403/500 registration fails (open5gs IMS integration case).',
    desc_zh: 'PCRF 缺失/无响应 → P-CSCF Rx AAR Diameter 超时/UNABLE_TO_COMPLY → 403/500 注册失败(open5gs IMS 对接实例)。',
    ref: 'TS 29.214 (Rx) · open5gs IMS integration', cause: 'Rx AAR timeout/UNABLE_TO_COMPLY → reg fail', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'removeNf', zone: 'A', type: 'PCRF' },
      { op: 'note', text: 'PCRF 부재 → Rx AAR 실패 → 등록 실패' },
    ],
    expect: () => ({ label_ko: 'Rx AAR 실패 → IMS 등록 실패', label_en: 'Rx AAR fail → IMS registration fail' }),
  },
  {
    id: 'vonr-mt-rrc-race',
    ko: 'MT RRC 경합 (QoS flow 충돌)', en: 'MT RRC race (QoS flow clash)', zh: 'MT RRC 竞争 (QoS flow 冲突)',
    desc_ko: '페이징→Service Request→InitialContextSetup 진행 중 5QI1 flow 설치 도착 → NGAP failure(abort/ue-in-rrc-inactive) → SIP 재시도.',
    desc_en: 'While paging→Service Request→InitialContextSetup is in progress, a 5QI1 flow install arrives → NGAP failure (abort/ue-in-rrc-inactive) → SIP retry.',
    desc_zh: '在寻呼→Service Request→InitialContextSetup 进行中到达 5QI1 flow 安装 → NGAP failure(abort/ue-in-rrc-inactive)→ SIP 重试。',
    ref: 'TS 38.413 (InitialContextSetup vs PDU modify race)', cause: 'MT RRC race → NGAP failure → SIP retry', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'InitialContextSetup 중 5QI1 flow 도착 → NGAP failure → SIP 재시도' },
    ],
    expect: () => ({ label_ko: 'MT RRC 경합 → NGAP failure → SIP 재시도', label_en: 'MT RRC race → NGAP failure → SIP retry' }),
  },
  // ════════ BULK D — 사용자평면 PFCP/GTP-U 추가 ════════
  {
    id: 'up-upf-restart-recovery',
    ko: 'UPF 재기동 감지 (Recovery TS)', en: 'UPF restart detected (Recovery TS)', zh: 'UPF 重启检测 (Recovery TS)',
    desc_ko: 'UPF enabled false→true → PFCP Assoc Setup Req(new Recovery Time Stamp) → SMF가 UPF 재시작 감지 → stale N4 세션 purge & 재수립.',
    desc_en: 'UPF enabled false→true → PFCP Assoc Setup Req (new Recovery Time Stamp) → SMF detects UPF restart → stale N4 sessions purged & re-established.',
    desc_zh: 'UPF enabled false→true → PFCP Assoc Setup Req(新 Recovery Time Stamp)→ SMF 检测 UPF 重启 → 清除并重建陈旧 N4 会话。',
    ref: 'TS 29.244 §6.2.6 · TS 23.527 (Recovery Time Stamp)', cause: 'UPF restart (new Recovery Time Stamp)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UPF disable→enable → 새 Recovery TS → stale 세션 purge 재수립' },
    ],
    expect: () => ({ label_ko: 'UPF 재시작 감지 → 세션 재수립', label_en: 'UPF restart detected → sessions re-established' }),
  },
  {
    id: 'up-smf-failure-sset',
    ko: 'SMF 장애 → SSET 세션 유지', en: 'SMF failure → SSET retention', zh: 'SMF 故障 → SSET 保持',
    desc_ko: 'UPF가 CP peer(SMF) 장애 감지 → 세션 SSET로 유지, F-SEID를 새 SMF로 재연관.',
    desc_en: 'UPF detects CP peer (SMF) failure → sessions retained via SSET, F-SEID re-associated to a new SMF.',
    desc_zh: 'UPF 检测到 CP 对端(SMF)故障 → 会话经 SSET 保持,F-SEID 重关联到新 SMF。',
    ref: 'TS 23.527 §4 (SMF set / SSET) · TS 29.244', cause: 'SMF failure → SSET F-SEID re-association', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'disableNf', zone: 'A', type: 'SMF' },
      { op: 'note', text: 'SMF 장애 → UPF SSET로 세션 유지, F-SEID 재연관' },
    ],
    expect: () => ({ label_ko: 'SMF 장애 → SSET 세션 유지', label_en: 'SMF failure → SSET session retention' }),
  },
  {
    id: 'up-graceful-release',
    ko: 'UPF Graceful Assoc Release', en: 'UPF graceful assoc release', zh: 'UPF 优雅关联释放',
    desc_ko: 'UPF 주도 PFCP Assoc Update Req(SARR/URSS) → 그레이스풀 릴리즈로 신규 세션 차단, 기존은 드레인.',
    desc_en: 'UPF-initiated PFCP Assoc Update Req (SARR/URSS) → graceful release blocks new sessions, drains existing.',
    desc_zh: 'UPF 发起 PFCP Assoc Update Req(SARR/URSS)→ 优雅释放阻断新会话,平滑排空现有会话。',
    ref: 'TS 29.244 §6.2.6.3 (SARR/URSS)', cause: 'PFCP Assoc Update SARR/URSS (graceful release)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'disableNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UPF SARR/URSS → 그레이스풀 릴리즈' },
    ],
    expect: () => ({ label_ko: 'SARR/URSS → graceful release', label_en: 'SARR/URSS → graceful release' }),
  },
  {
    id: 'up-pfcp-65',
    ko: 'PFCP Cause 65 (context not found)', en: 'PFCP Cause 65 (session context not found)', zh: 'PFCP Cause 65 (会话上下文未找到)',
    desc_ko: 'UPF 재기동 후 SMF가 구 SEID로 Session Modification → PFCP cause 65 Session context not found → SMF 세션 재수립.',
    desc_en: 'After UPF restart, SMF sends Session Modification with old SEID → PFCP cause 65 Session context not found → SMF re-establishes.',
    desc_zh: 'UPF 重启后 SMF 用旧 SEID 发 Session Modification → PFCP cause 65 → SMF 重建会话。',
    ref: 'TS 29.244 §8.2.1 (cause 65)', cause: 'PFCP 65 Session context not found', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UPF 재기동 후 구 SEID Modification → cause 65' },
    ],
    expect: () => ({ label_ko: 'PFCP 65 → SMF 세션 재수립', label_en: 'PFCP 65 → SMF re-establishes session' }),
  },
  {
    id: 'up-pfcp-66',
    ko: 'PFCP Cause 66 (Mandatory IE missing)', en: 'PFCP Cause 66 (Mandatory IE missing)', zh: 'PFCP Cause 66 (强制 IE 缺失)',
    desc_ko: 'PFCP 요청에 필수 IE 누락 → cause 66 Mandatory IE missing + Offending IE.',
    desc_en: 'Mandatory IE missing in a PFCP request → cause 66 Mandatory IE missing + Offending IE.',
    desc_zh: 'PFCP 请求缺少强制 IE → cause 66 Mandatory IE missing + Offending IE。',
    ref: 'TS 29.244 §8.2.1 (cause 66)', cause: 'PFCP 66 Mandatory IE missing', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '필수 IE 누락 → cause 66 + Offending IE' },
    ],
    expect: () => ({ label_ko: 'PFCP 66 — Mandatory IE missing', label_en: 'PFCP 66 — Mandatory IE missing' }),
  },
  {
    id: 'up-pfcp-71',
    ko: 'PFCP Cause 71 (Invalid F-TEID)', en: 'PFCP Cause 71 (Invalid F-TEID alloc)', zh: 'PFCP Cause 71 (无效 F-TEID)',
    desc_ko: 'SMF가 F-TEID 직접 할당했는데 UPF는 CH(할당 위임) 기대 → cause 71 Invalid F-TEID allocation option.',
    desc_en: 'SMF allocated F-TEID directly but UPF expected CH (delegated) → cause 71 Invalid F-TEID allocation option.',
    desc_zh: 'SMF 直接分配 F-TEID 但 UPF 期望 CH(委派)→ cause 71 Invalid F-TEID allocation option。',
    ref: 'TS 29.244 §8.2.1 (cause 71)', cause: 'PFCP 71 Invalid F-TEID allocation option', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'SMF 직접 F-TEID vs UPF CH 기대 → cause 71' },
    ],
    expect: () => ({ label_ko: 'PFCP 71 — Invalid F-TEID allocation', label_en: 'PFCP 71 — Invalid F-TEID allocation' }),
  },
  {
    id: 'up-pfcp-73',
    ko: 'PFCP Cause 73 (Rule creation fail)', en: 'PFCP Cause 73 (rule creation fail)', zh: 'PFCP Cause 73 (规则创建失败)',
    desc_ko: '미지원 SDF filter/기능(FTUP/UEIP 미보유) 룰 설치 → cause 73 Rule creation/modification failure + Failed Rule ID → SMF 세션 롤백.',
    desc_en: 'Unsupported SDF filter/feature (no FTUP/UEIP) rule install → cause 73 Rule creation/modification failure + Failed Rule ID → SMF rolls back.',
    desc_zh: '安装不受支持的 SDF 过滤器/功能(无 FTUP/UEIP)规则 → cause 73 + Failed Rule ID → SMF 回滚会话。',
    ref: 'TS 29.244 §8.2.1 (cause 73, Failed Rule ID)', cause: 'PFCP 73 Rule creation/modification failure', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '미지원 룰 설치 → cause 73 + Failed Rule ID → 롤백' },
    ],
    expect: () => ({ label_ko: 'PFCP 73 → 세션 롤백', label_en: 'PFCP 73 → session rollback' }),
  },
  {
    id: 'up-pfcp-74',
    ko: 'PFCP Cause 74 (entity congestion)', en: 'PFCP Cause 74 (entity in congestion)', zh: 'PFCP Cause 74 (实体拥塞)',
    desc_ko: 'UPF 과부하 → PFCP Session Est Response Cause 74 (entity in congestion) + OCI → SMF가 타 UPF 재선택/거절.',
    desc_en: 'UPF overload → PFCP Session Est Response Cause 74 (entity in congestion) + OCI → SMF reselects another UPF / rejects.',
    desc_zh: 'UPF 过载 → PFCP Session Est Response Cause 74 + OCI → SMF 重选其他 UPF/拒绝。',
    ref: 'TS 29.244 §8.2.1 (cause 74) · Overload Control Information', cause: 'PFCP 74 entity in congestion (OCI)', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UPF 과부하 → cause 74 + OCI → 타 UPF 재선택' },
    ],
    expect: () => ({ label_ko: 'PFCP 74 (congestion) + OCI → 재선택', label_en: 'PFCP 74 (congestion) + OCI → reselect' }),
  },
  {
    id: 'up-pfcp-75',
    ko: 'PFCP Cause 75 (No resources)', en: 'PFCP Cause 75 (No resources)', zh: 'PFCP Cause 75 (无资源)',
    desc_ko: 'UPF 자원 소진 → PFCP cause 75 No resources available → 5GSM #26 Insufficient resources 매핑.',
    desc_en: 'UPF out of resources → PFCP cause 75 No resources available → mapped to 5GSM #26 Insufficient resources.',
    desc_zh: 'UPF 资源耗尽 → PFCP cause 75 No resources available → 映射 5GSM #26。',
    ref: 'TS 29.244 §8.2.1 (cause 75) · 5GSM #26', cause: 'PFCP 75 → 5GSM #26', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UPF 자원 소진 → cause 75 → 5GSM #26' },
    ],
    expect: () => ({ label_ko: 'PFCP 75 → PDU Reject #26', label_en: 'PFCP 75 → PDU Reject #26' }),
  },
  {
    id: 'up-ul-pdr-mismatch',
    ko: 'UL PDR 미매칭 (상향 무통)', en: 'UL PDR mismatch (UL black-hole)', zh: 'UL PDR 不匹配 (上行黑洞)',
    desc_ko: 'UL PDR 미매칭 → 상향 패킷 silent drop(cause 코드 없음) → 상향 무통(one-way).',
    desc_en: 'UL PDR mismatch → uplink packets silently dropped (no cause code) → uplink black-hole (one-way).',
    desc_zh: 'UL PDR 不匹配 → 上行数据包静默丢弃(无 cause)→ 上行黑洞(单向)。',
    ref: 'TS 29.244 (PDR matching) · silent drop', cause: 'UL PDR mismatch → silent drop', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UL PDR 미매칭 → 상향 silent drop (cause 없음)' },
    ],
    expect: () => ({ label_ko: 'UL PDR 미매칭 → 상향 무통(silent)', label_en: 'UL PDR mismatch → UL black-hole (silent)' }),
  },
  {
    id: 'up-qer-gate-closed',
    ko: 'QER gate closed (스루풋 0)', en: 'QER gate closed (zero throughput)', zh: 'QER gate closed (吞吐 0)',
    desc_ko: 'QER MBR 0/gate=CLOSED 오설정 → 해당 flow 스루풋 0(패킷 폐기).',
    desc_en: 'QER MBR 0 / gate=CLOSED misconfig → that flow throughput 0 (packets dropped).',
    desc_zh: 'QER MBR 0/gate=CLOSED 误配 → 该 flow 吞吐为 0(丢包)。',
    ref: 'TS 29.244 (QER gate/MBR)', cause: 'QER gate closed / MBR 0 → zero throughput', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'QER MBR 0/gate closed → 스루풋 0' },
    ],
    expect: () => ({ label_ko: 'QER gate closed → 스루풋 0', label_en: 'QER gate closed → zero throughput' }),
  },
  {
    id: 'up-ddn-failure',
    ko: 'DDN Failure (버퍼 폐기)', en: 'DDN Failure (buffer discard)', zh: 'DDN Failure (缓冲丢弃)',
    desc_ko: '페이징 무응답 → DDN Failure Indication → 버퍼 폐기(Suggested Buffering Packets Count 초과분 폐기). Extended Buffering으로 완화.',
    desc_en: 'Paging no response → DDN Failure Indication → buffer discarded (packets beyond Suggested Buffering Packets Count dropped). Extended Buffering mitigates.',
    desc_zh: '寻呼无响应 → DDN Failure Indication → 缓冲丢弃(超过 Suggested Buffering Packets Count 的丢弃)。Extended Buffering 缓解。',
    ref: 'TS 29.244 · TS 23.502 (DDN Failure)', cause: 'DDN Failure → buffer discard', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: '페이징 무응답 → DDN Failure → 버퍼 폐기' },
    ],
    expect: () => ({ label_ko: 'DDN Failure → 버퍼 폐기', label_en: 'DDN Failure → buffer discard' }),
  },
  {
    id: 'up-end-marker-order',
    ko: 'HO End Marker 순서보장', en: 'HO End Marker in-order', zh: 'HO End Marker 保序',
    desc_ko: '핸드오버 시 UPF → source gNB: GTP-U End Marker(type 254) → in-order delivery, target로 DL path switch.',
    desc_en: 'On handover, UPF → source gNB: GTP-U End Marker (type 254) → in-order delivery, DL path switched to target.',
    desc_zh: '切换时 UPF → 源 gNB:GTP-U End Marker(type 254)→ 保序递交,DL 路径切到目标。',
    ref: 'TS 29.281 §5.1 (End Marker) · TS 38.300', cause: 'GTP-U End Marker (in-order delivery)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'HO 직후 End Marker(type 254) → in-order' },
    ],
    expect: () => ({ label_ko: 'End Marker → 순서보장 DL path switch', label_en: 'End Marker → in-order DL path switch' }),
  },
  {
    id: 'up-no-end-marker',
    ko: 'End Marker 미송신 (순서 역전)', en: 'No End Marker (reorder)', zh: '无 End Marker (乱序)',
    desc_ko: 'HO 중 End Marker 미송신 → 재정렬 실패 → TCP dup-ACK/성능 저하.',
    desc_en: 'No End Marker during HO → reordering fails → TCP dup-ACKs / performance degradation.',
    desc_zh: '切换中未发 End Marker → 重排序失败 → TCP dup-ACK/性能下降。',
    ref: 'TS 29.281 (End Marker) · TCP reorder pitfall', cause: 'no End Marker → reorder/TCP degrade', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'HO 중 End Marker 미송신 → TCP dup-ACK/성능 저하' },
    ],
    expect: () => ({ label_ko: 'End Marker 미송신 → 순서 역전(TCP 저하)', label_en: 'no End Marker → reorder (TCP degrade)' }),
  },
  {
    id: 'up-qfi-mismatch',
    ko: 'QFI 불일치 (오매핑/드롭)', en: 'QFI mismatch (mismap/drop)', zh: 'QFI 不匹配 (误映射/丢弃)',
    desc_ko: 'PDU Session Container 잘못된 QFI → default QoS flow로 오매핑 또는 드롭.',
    desc_en: 'Wrong QFI in PDU Session Container → mismapped to default QoS flow or dropped.',
    desc_zh: 'PDU Session Container QFI 错误 → 误映射到默认 QoS flow 或丢弃。',
    ref: 'TS 38.415 (PDU Session Container/QFI)', cause: 'QFI mismatch → mismap/drop', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '잘못된 QFI → default flow 오매핑/드롭' },
    ],
    expect: () => ({ label_ko: 'QFI 불일치 → 오매핑/드롭', label_en: 'QFI mismatch → mismap/drop' }),
  },
  {
    id: 'up-ulcl-insert',
    ko: 'ULCL 삽입 (LBO/MEC)', en: 'ULCL insertion (LBO/MEC)', zh: 'ULCL 插入 (LBO/MEC)',
    desc_ko: 'UPF 2개(PSA + ULCL) → ULCL이 로컬 DN 트래픽 분기(MEC), 나머지는 앵커 PSA로.',
    desc_en: 'Two UPFs (PSA + ULCL) → ULCL branches local-DN traffic (MEC), rest via anchor PSA.',
    desc_zh: '两个 UPF(PSA + ULCL)→ ULCL 分流本地 DN 流量(MEC),其余经锚点 PSA。',
    ref: 'TS 23.501 §5.6.4.1 (ULCL)', cause: 'ULCL insertion (local breakout/MEC)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'UPF 2개(PSA+ULCL) → 로컬 DN 분기(MEC)' },
    ],
    expect: () => ({ label_ko: 'ULCL 삽입 → 로컬 브레이크아웃(MEC)', label_en: 'ULCL insertion → local breakout (MEC)' }),
  },
  {
    id: 'up-ulcl-precedence',
    ko: 'ULCL precedence 오설정', en: 'ULCL precedence misconfig', zh: 'ULCL precedence 误配',
    desc_ko: 'ULCL PDR precedence 역전 → 전 트래픽이 로컬 DN으로 오분기.',
    desc_en: 'ULCL PDR precedence inverted → all traffic mis-branched to the local DN.',
    desc_zh: 'ULCL PDR precedence 反转 → 全部流量误分流到本地 DN。',
    ref: 'TS 29.244 (PDR precedence) · TS 23.501 §5.6.4', cause: 'ULCL PDR precedence inverted → all mis-branched', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'ULCL PDR precedence 역전 → 전 트래픽 오분기' },
    ],
    expect: () => ({ label_ko: 'ULCL precedence 역전 → 전 트래픽 오분기', label_en: 'ULCL precedence inverted → all mis-branched' }),
  },
  {
    id: 'up-ssc3-multihoming',
    ko: 'Branching Point + IPv6 멀티호밍', en: 'Branching Point + IPv6 multihoming', zh: 'Branching Point + IPv6 多归属',
    desc_ko: 'SSC mode 3 IPv6 멀티호밍 → Branching Point UPF가 2개 프리픽스로 분기(구/신 앵커 병행).',
    desc_en: 'SSC mode 3 IPv6 multihoming → Branching Point UPF splits across two prefixes (old/new anchor in parallel).',
    desc_zh: 'SSC 模式 3 IPv6 多归属 → Branching Point UPF 按两个前缀分流(新旧锚点并行)。',
    ref: 'TS 23.501 §5.6.4.2 (Branching Point, IPv6 multihoming)', cause: 'SSC3 Branching Point (IPv6 multihoming)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'SSC3 IPv6 멀티호밍 → Branching Point 2 프리픽스' },
    ],
    expect: () => ({ label_ko: 'Branching Point → IPv6 멀티호밍', label_en: 'Branching Point → IPv6 multihoming' }),
  },
  {
    id: 'up-iupf-insert',
    ko: 'I-UPF 삽입 (N9 모빌리티)', en: 'I-UPF insertion (N9 mobility)', zh: 'I-UPF 插入 (N9 移动)',
    desc_ko: '서빙 RU가 앵커 UPF와 먼 영역으로 이동 → I-UPF 삽입(N3→N9 relay) + End Marker.',
    desc_en: 'Serving RU moves far from the anchor UPF → I-UPF inserted (N3→N9 relay) + End Marker.',
    desc_zh: '服务 RU 移动到远离锚点 UPF 的区域 → 插入 I-UPF(N3→N9 中继)+ End Marker。',
    ref: 'TS 23.502 §4.9.1 (I-UPF insertion, N9)', cause: 'I-UPF insertion (N9 relay)', domain: 'userplane', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: '모빌리티로 서빙 RU 원거리 → I-UPF 삽입(N9)' },
    ],
    expect: () => ({ label_ko: 'I-UPF 삽입 (N3→N9 relay)', label_en: 'I-UPF inserted (N3→N9 relay)' }),
  },
  {
    id: 'up-session-report-storm',
    ko: 'PFCP Session Report 폭주', en: 'PFCP Session Report storm', zh: 'PFCP Session Report 风暴',
    desc_ko: 'IDLE UE 대량 + DL 트래픽 → DLDR 반복 → SMF 과부하 → DDN throttling(PFCP Overload/지연 통지).',
    desc_en: 'Many IDLE UEs + DL traffic → repeated DLDR → SMF overload → DDN throttling (PFCP Overload / delayed notify).',
    desc_zh: '大量 IDLE UE + DL 流量 → DLDR 反复 → SMF 过载 → DDN 限流(PFCP Overload/延迟通知)。',
    ref: 'TS 29.244 (Session Report/DLDR) · overload control', cause: 'DLDR storm → SMF overload → DDN throttling', domain: 'userplane', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'IDLE UE 대량 + DL → DLDR 반복 → SMF 과부하' },
    ],
    expect: () => ({ label_ko: 'DLDR 폭주 → SMF 과부하 → DDN throttling', label_en: 'DLDR storm → SMF overload → DDN throttling' }),
  },

  // ════════ BULK D — 과금/정책 (SECTION C 정합) ════════
  {
    id: 'chf-failure-continue',
    ko: 'CHF Failure-Handling CONTINUE', en: 'CHF Failure-Handling CONTINUE', zh: 'CHF Failure-Handling CONTINUE',
    desc_ko: 'CHF 무응답 + Failure-Handling=CONTINUE → 온라인 과금 실패 시에도 세션 유지, 오프라인 CDR 폴백.',
    desc_en: 'CHF unresponsive + Failure-Handling=CONTINUE → session kept despite online-charging failure, offline CDR fallback.',
    desc_zh: 'CHF 无响应 + Failure-Handling=CONTINUE → 在线计费失败仍保持会话,回退离线 CDR。',
    ref: 'TS 32.290/291 Nchf · Failure-Handling=CONTINUE (offline CDR)', cause: 'CHF Failure-Handling=CONTINUE (offline CDR fallback)', domain: 'charging', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'CHF' }, { op: 'disableNf', zone: 'A', type: 'CHF' },
      { op: 'note', text: 'CHF 무응답 + CONTINUE → 세션 유지, 오프라인 CDR 폴백' },
    ],
    expect: () => ({ label_ko: 'CONTINUE → 세션 유지 + 오프라인 CDR', label_en: 'CONTINUE → session kept + offline CDR' }),
  },
  {
    id: 'chf-retry-and-terminate',
    ko: 'CHF Failure-Handling RETRY_AND_TERMINATE', en: 'CHF Failure-Handling RETRY_AND_TERMINATE', zh: 'CHF Failure-Handling RETRY_AND_TERMINATE',
    desc_ko: 'CHF 무응답 + Failure-Handling=RETRY_AND_TERMINATE → 재시도 후 실패 시 세션 종료(TERMINATE와 구분).',
    desc_en: 'CHF unresponsive + Failure-Handling=RETRY_AND_TERMINATE → retries, then terminates session on failure (distinct from TERMINATE).',
    desc_zh: 'CHF 无响应 + Failure-Handling=RETRY_AND_TERMINATE → 重试后失败则终止会话(区别于 TERMINATE)。',
    ref: 'TS 32.290/291 Nchf · Failure-Handling=RETRY_AND_TERMINATE', cause: 'CHF Failure-Handling=RETRY_AND_TERMINATE', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'CHF' }, { op: 'disableNf', zone: 'A', type: 'CHF' },
      { op: 'note', text: 'CHF 무응답 + RETRY_AND_TERMINATE → 재시도 후 종료' },
    ],
    expect: () => ({ label_ko: 'RETRY_AND_TERMINATE → 재시도 후 종료', label_en: 'RETRY_AND_TERMINATE → retry then terminate' }),
  },
  {
    id: 'pcf-session-rule-fail',
    ko: 'Session Rule 자원할당 실패', en: 'Session rule resource alloc fail', zh: 'Session Rule 资源分配失败',
    desc_ko: 'session rule 레벨 SESSION_RESOURCE_ALLOCATION_FAILURE — PCC rule 레벨 RES_ALLO_FAIL과 구분(다른 리포트 대상).',
    desc_en: 'Session-rule level SESSION_RESOURCE_ALLOCATION_FAILURE — distinct from PCC-rule level RES_ALLO_FAIL (different report target).',
    desc_zh: 'session rule 级 SESSION_RESOURCE_ALLOCATION_FAILURE — 区别于 PCC rule 级 RES_ALLO_FAIL(报告对象不同)。',
    ref: 'TS 29.512 N7 (sessionRuleReport SESSION_RESOURCE_ALLOCATION_FAILURE)', cause: 'SESSION_RESOURCE_ALLOCATION_FAILURE (session rule)', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'session rule(AMBR 등) 자원할당 실패 → SESSION_RESOURCE_ALLOCATION_FAILURE (≠ RES_ALLO_FAIL)' },
    ],
    expect: () => ({ label_ko: 'sessionRuleReport SESSION_RESOURCE_ALLOCATION_FAILURE', label_en: 'sessionRuleReport SESSION_RESOURCE_ALLOCATION_FAILURE' }),
  },
  {
    id: 'af-n5-qos-ok',
    ko: 'N5 QoS 예약 성공', en: 'N5 QoS reservation OK', zh: 'N5 QoS 预留成功',
    desc_ko: 'AF Npcf_PolicyAuthorization → PCC rule 설치 성공 → SUCCESSFUL_RESOURCES_ALLOCATION(복수형) 이벤트 통지.',
    desc_en: 'AF Npcf_PolicyAuthorization → PCC rule installed → SUCCESSFUL_RESOURCES_ALLOCATION (plural) event notification.',
    desc_zh: 'AF Npcf_PolicyAuthorization → PCC 规则安装成功 → SUCCESSFUL_RESOURCES_ALLOCATION(复数)事件通知。',
    ref: 'TS 29.514 N5 (SUCCESSFUL_RESOURCES_ALLOCATION)', cause: 'SUCCESSFUL_RESOURCES_ALLOCATION', domain: 'charging', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'AF N5 예약 성공 → SUCCESSFUL_RESOURCES_ALLOCATION(복수)' },
    ],
    expect: () => ({ label_ko: 'N5 SUCCESSFUL_RESOURCES_ALLOCATION', label_en: 'N5 SUCCESSFUL_RESOURCES_ALLOCATION' }),
  },
  {
    id: 'af-n5-qos-fail',
    ko: 'N5 QoS 예약 실패', en: 'N5 QoS reservation fail', zh: 'N5 QoS 预留失败',
    desc_ko: 'AF Npcf_PolicyAuthorization → dedicated QoS flow 설정 실패 → FAILED_RESOURCES_ALLOCATION(복수형) 이벤트 통지.',
    desc_en: 'AF Npcf_PolicyAuthorization → dedicated QoS flow setup fails → FAILED_RESOURCES_ALLOCATION (plural) event notification.',
    desc_zh: 'AF Npcf_PolicyAuthorization → 专用 QoS flow 建立失败 → FAILED_RESOURCES_ALLOCATION(复数)事件通知。',
    ref: 'TS 29.514 N5 (FAILED_RESOURCES_ALLOCATION)', cause: 'FAILED_RESOURCES_ALLOCATION', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'AF N5 예약 실패 → FAILED_RESOURCES_ALLOCATION(복수)' },
    ],
    expect: () => ({ label_ko: 'N5 FAILED_RESOURCES_ALLOCATION', label_en: 'N5 FAILED_RESOURCES_ALLOCATION' }),
  },
  {
    id: 'qnc-not-guaranteed',
    ko: 'QNC NOT_GUARANTEED 통지', en: 'QNC NOT_GUARANTEED notify', zh: 'QNC NOT_GUARANTEED 通知',
    desc_ko: 'QoS Notification Control(QNC) — GBR flow가 GFBR 미충족 → NOT_GUARANTEED → AF에 통지(회복 시 GUARANTEED).',
    desc_en: 'QoS Notification Control (QNC) — GBR flow cannot meet GFBR → NOT_GUARANTEED → notify AF (GUARANTEED when recovered).',
    desc_zh: 'QoS Notification Control(QNC)— GBR flow 无法满足 GFBR → NOT_GUARANTEED → 通知 AF(恢复时 GUARANTEED)。',
    ref: 'TS 23.501 §5.7.2.4 (QNC: GUARANTEED/NOT_GUARANTEED)', cause: 'QNC NOT_GUARANTEED', domain: 'charging', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'GBR flow GFBR 미충족 → QNC NOT_GUARANTEED → AF 통지' },
    ],
    expect: () => ({ label_ko: 'QNC NOT_GUARANTEED (GFBR 미충족)', label_en: 'QNC NOT_GUARANTEED (GFBR not met)' }),
  },
  {
    id: 'smf-overload-503',
    ko: 'SMF/SBI 과부하 (503+Retry-After)', en: 'SMF/SBI overload (503+Retry-After)', zh: 'SMF/SBI 过载 (503+Retry-After)',
    desc_ko: 'SMF/SBI 과부하는 NGAP Overload가 아님 → HTTP 503 Service Unavailable + Retry-After로 흐름 제어(NGAP Overload는 AMF→gNB 전용).',
    desc_en: 'SMF/SBI overload is NOT NGAP Overload → flow-controlled via HTTP 503 Service Unavailable + Retry-After (NGAP Overload is AMF→gNB only).',
    desc_zh: 'SMF/SBI 过载不是 NGAP Overload → 用 HTTP 503 Service Unavailable + Retry-After 控流(NGAP Overload 仅 AMF→gNB)。',
    ref: 'TS 29.500 §6.4 (503 + Retry-After) · TS 23.501 §5.19', cause: 'HTTP 503 + Retry-After (SBI overload)', domain: 'scale', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'SMF 파드당 용량↓ + HPA off + 세션 대량 → 503 + Retry-After (NGAP Overload 아님)' },
    ],
    expect: () => ({ label_ko: 'SMF/SBI 과부하 → 503 + Retry-After', label_en: 'SMF/SBI overload → 503 + Retry-After' }),
  },
  {
    id: 'upf-overload-oci',
    ko: 'UPF 과부하 (PFCP OCI)', en: 'UPF overload (PFCP OCI)', zh: 'UPF 过载 (PFCP OCI)',
    desc_ko: 'UPF 과부하는 NGAP Overload가 아님 → PFCP Overload Control Information(OCI)로 SMF가 부하 저감(NGAP Overload는 AMF→gNB 전용).',
    desc_en: 'UPF overload is NOT NGAP Overload → SMF throttles via PFCP Overload Control Information (OCI) (NGAP Overload is AMF→gNB only).',
    desc_zh: 'UPF 过载不是 NGAP Overload → SMF 通过 PFCP Overload Control Information(OCI)降载(NGAP Overload 仅 AMF→gNB)。',
    ref: 'TS 29.244 §5.22 (PFCP Overload Control) · TS 23.501 §5.19', cause: 'PFCP Overload Control (OCI)', domain: 'scale', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UPF 과부하 → PFCP OCI로 SMF 부하 저감 (NGAP Overload 아님)' },
    ],
    expect: () => ({ label_ko: 'UPF 과부하 → PFCP OCI 저감', label_en: 'UPF overload → PFCP OCI throttling' }),
  },
  // ════════ BULK D — IoT/RedCap/URLLC/mMTC 추가 ════════
  {
    id: 'redcap-hdfdd-barred',
    ko: 'HD-FDD RedCap 차단', en: 'HD-FDD RedCap barred', zh: 'HD-FDD RedCap barred',
    desc_ko: 'SIB1에 halfDuplexRedCapAllowed-r17 부재 → HD-FDD RedCap UE 접속 불가(cell barred for HD-FDD RedCap).',
    desc_en: 'halfDuplexRedCapAllowed-r17 absent in SIB1 → HD-FDD RedCap UE cannot access (cell barred for HD-FDD RedCap).',
    desc_zh: 'SIB1 无 halfDuplexRedCapAllowed-r17 → HD-FDD RedCap UE 无法接入(对 HD-FDD RedCap barred)。',
    ref: 'TS 38.331 SIB1 (halfDuplexRedCapAllowed-r17)', cause: 'halfDuplexRedCapAllowed-r17 absent', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'SIB1 halfDuplexRedCapAllowed 부재 → HD-FDD RedCap barred' },
    ],
    expect: () => ({ label_ko: 'HD-FDD RedCap barred (halfDuplex 미허용)', label_en: 'HD-FDD RedCap barred (halfDuplex not allowed)' }),
  },
  {
    id: 'iot-cp-edt',
    ko: 'CP-EDT 성공 (Msg3 데이터)', en: 'CP-EDT success (data in Msg3)', zh: 'CP-EDT 成功 (Msg3 数据)',
    desc_ko: 'Msg3 RRCEarlyDataRequest+NAS data → Msg4 RRCEarlyDataComplete → RRC_CONNECTED 진입 없이 소량 데이터 전달.',
    desc_en: 'Msg3 RRCEarlyDataRequest+NAS data → Msg4 RRCEarlyDataComplete → small data delivered without entering RRC_CONNECTED.',
    desc_zh: 'Msg3 RRCEarlyDataRequest+NAS 数据 → Msg4 RRCEarlyDataComplete → 不进入 RRC_CONNECTED 完成小数据传输。',
    ref: 'TS 36.331 §5.3.3 (CP-EDT)', cause: 'CP-EDT (control-plane early data)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'IoT UE CP-EDT → Msg3 데이터/Msg4 complete' },
    ],
    expect: () => ({ label_ko: 'CP-EDT 성공 (RRC_CONNECTED 미진입)', label_en: 'CP-EDT OK (no RRC_CONNECTED)' }),
  },
  {
    id: 'iot-edt-fallback',
    ko: 'EDT 폴백 → RRCConnectionSetup', en: 'EDT fallback → RRCConnectionSetup', zh: 'EDT 回退 → RRCConnectionSetup',
    desc_ko: 'DL data pending/NAS 교환 과대 → Msg4 = RRCConnectionSetup 폴백(EDT 미완, 일반 연결).',
    desc_en: 'DL data pending / NAS exchange too large → Msg4 = RRCConnectionSetup fallback (EDT not completed, normal connection).',
    desc_zh: 'DL 数据待发/NAS 交换过大 → Msg4 = RRCConnectionSetup 回退(EDT 未完成,常规连接)。',
    ref: 'TS 36.331 §5.3.3 (EDT fallback)', cause: 'EDT fallback (Msg4 = RRCConnectionSetup)', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'DL data pending → EDT 폴백 → RRCConnectionSetup' },
    ],
    expect: () => ({ label_ko: 'EDT 폴백 → RRCConnectionSetup', label_en: 'EDT fallback → RRCConnectionSetup' }),
  },
  {
    id: 'iot-pur',
    ko: 'PUR 전송 성공 (RACH 없음)', en: 'PUR transmission OK (no RACH)', zh: 'PUR 传输成功 (无 RACH)',
    desc_ko: 'Rel-16 PUR: TA 유효성 확인 → PUR occasion에서 PUSCH 전송(Msg1/2 없음) → idle-mode grant.',
    desc_en: 'Rel-16 PUR: TA validity check → PUSCH on PUR occasion (no Msg1/2) → idle-mode grant.',
    desc_zh: 'Rel-16 PUR:TA 有效性检查 → 在 PUR 时机发送 PUSCH(无 Msg1/2)→ 空闲态授权。',
    ref: 'TS 36.331 (Rel-16 PUR)', cause: 'Rel-16 PUR (idle-mode grant)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'PUR: TA 유효 → PUR occasion PUSCH (RACH 없음)' },
    ],
    expect: () => ({ label_ko: 'PUR 전송 성공 (RACH 없음)', label_en: 'PUR transmission OK (no RACH)' }),
  },
  {
    id: 'iot-pur-ta-invalid',
    ko: 'PUR TA 무효 → 폴백', en: 'PUR TA invalid → fallback', zh: 'PUR TA 无效 → 回退',
    desc_ko: '이동으로 RSRP 변화 > 임계 → PUR TA validity 실패 → EDT/legacy RACH로 폴백.',
    desc_en: 'RSRP change > threshold from movement → PUR TA validity fails → fallback to EDT/legacy RACH.',
    desc_zh: '移动导致 RSRP 变化 > 门限 → PUR TA 有效性失败 → 回退 EDT/legacy RACH。',
    ref: 'TS 36.331 (PUR TA validity)', cause: 'PUR TA invalid → EDT/RACH fallback', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'RSRP 변화 큼 → PUR TA validity 실패 → RACH 폴백' },
    ],
    expect: () => ({ label_ko: 'PUR TA 무효 → EDT/RACH 폴백', label_en: 'PUR TA invalid → EDT/RACH fallback' }),
  },
  {
    id: 'iot-edrx-mt-latency',
    ko: 'eDRX MT 지연 (다음 PTW)', en: 'eDRX MT latency (next PTW)', zh: 'eDRX MT 时延 (下一 PTW)',
    desc_ko: 'MT 트래픽 도착 시 UE eDRX 상태 → 페이징을 다음 PTW(Paging Time Window)로 지연.',
    desc_en: 'MT traffic arrives while UE in eDRX → paging deferred to the next PTW (Paging Time Window).',
    desc_zh: 'MT 流量到达时 UE 处于 eDRX → 寻呼推迟到下一 PTW(Paging Time Window)。',
    ref: 'TS 23.501 §5.4.1 (eDRX) · PTW', cause: 'eDRX MT paging deferred to next PTW', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'UE eDRX → MT 페이징을 다음 PTW로 지연' },
    ],
    expect: () => ({ label_ko: 'eDRX → 페이징 다음 PTW 지연', label_en: 'eDRX → paging deferred to next PTW' }),
  },
  {
    id: 'iot-edrx-paging-miss',
    ko: 'eDRX 페이징 미스 (PTW 밖)', en: 'eDRX paging miss (outside PTW)', zh: 'eDRX 寻呼丢失 (PTW 外)',
    desc_ko: '페이징이 PTW 밖에 발행 → UE 미수신 → 다음 PTW에서 재시도(반복 시 MT 실패).',
    desc_en: 'Paging issued outside PTW → UE misses it → retry at next PTW (repeated → MT fails).',
    desc_zh: '寻呼在 PTW 外发出 → UE 未收 → 下一 PTW 重试(反复则 MT 失败)。',
    ref: 'TS 23.501 §5.4.1 (eDRX PTW)', cause: 'eDRX paging outside PTW → retry/miss', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '페이징 PTW 밖 발행 → 미수신 → 다음 PTW 재시도' },
    ],
    expect: () => ({ label_ko: 'PTW 밖 페이징 → 미스/재시도', label_en: 'paging outside PTW → miss/retry' }),
  },
  {
    id: 'iot-eab-barred',
    ko: 'EAB (SIB14) 지연허용 차단', en: 'EAB (SIB14) delay-tolerant bar', zh: 'EAB (SIB14) 延迟容忍阻断',
    desc_ko: 'SIB14 EAB로 AC 0-9 barred → 지연허용(delay-tolerant) MTC 단말 접속 차단.',
    desc_en: 'SIB14 EAB bars AC 0-9 → delay-tolerant MTC UEs are access-barred.',
    desc_zh: 'SIB14 EAB 阻断 AC 0-9 → 延迟容忍 MTC UE 接入被阻。',
    ref: 'TS 36.331 SIB14 (EAB)', cause: 'EAB (SIB14) — delay-tolerant barred', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'SIB14 EAB AC 0-9 barred → delay-tolerant MTC 차단' },
    ],
    expect: () => ({ label_ko: 'EAB → delay-tolerant 접속 차단', label_en: 'EAB → delay-tolerant access barred' }),
  },
  {
    id: 'iot-uac-barred',
    ko: '5G UAC 차단 (AC7, T390)', en: '5G UAC barred (AC7, T390)', zh: '5G UAC 阻断 (AC7, T390)',
    desc_ko: 'mIoT 슬라이스 MO data(Access Category 7/3) → UAC barring → RRCSetupRequest 이전 차단(T390 기동).',
    desc_en: 'mIoT slice MO data (Access Category 7/3) → UAC barring → barred before RRCSetupRequest (T390 started).',
    desc_zh: 'mIoT 切片 MO data(Access Category 7/3)→ UAC 阻断 → RRCSetupRequest 前被阻(启动 T390)。',
    ref: 'TS 22.261/TS 38.331 (UAC) · T390', cause: 'UAC access category 7 barred (T390)', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'UAC AC7 barring factor → RRCSetup 이전 차단, T390' },
    ],
    expect: () => ({ label_ko: 'UAC AC7 차단 (T390 기동)', label_en: 'UAC AC7 barred (T390 started)' }),
  },
  {
    id: 'iot-nbiot-ext-wait',
    ko: 'NB-IoT RRCReject extendedWaitTime', en: 'NB-IoT RRCReject extendedWaitTime', zh: 'NB-IoT RRCReject extendedWaitTime',
    desc_ko: 'NB-IoT 혼잡 → RRCConnectionReject (extendedWaitTime=1800s) → 최대 30분 접속 유예.',
    desc_en: 'NB-IoT congestion → RRCConnectionReject (extendedWaitTime=1800s) → up to 30-min access deferral.',
    desc_zh: 'NB-IoT 拥塞 → RRCConnectionReject(extendedWaitTime=1800s)→ 最长 30 分钟接入延迟。',
    ref: 'TS 36.331 §5.3.3.8 (extendedWaitTime)', cause: 'RRCConnectionReject extendedWaitTime=1800s', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'NB-IoT 혼잡 → RRCReject extendedWaitTime=1800s' },
    ],
    expect: () => ({ label_ko: 'RRCReject extendedWaitTime=1800s', label_en: 'RRCReject extendedWaitTime=1800s' }),
  },
  {
    id: 'iot-t3448-backoff',
    ko: 'CP data 백오프 (T3448)', en: 'CP data back-off (T3448)', zh: 'CP data 退避 (T3448)',
    desc_ko: 'AMF 혼잡 → CIoT CP data 전송 UE에 T3448 백오프(비지원 UE는 T3346).',
    desc_en: 'AMF congestion → T3448 back-off for CIoT CP-data UEs (non-supporting UEs get T3346).',
    desc_zh: 'AMF 拥塞 → 对 CIoT CP-data UE 施加 T3448 退避(不支持者用 T3346)。',
    ref: 'TS 24.501 §5.3.x (T3448)', cause: 'T3448 CP data back-off', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'AMF 혼잡 → CIoT CP data T3448 백오프' },
    ],
    expect: () => ({ label_ko: 'T3448 CP data 백오프', label_en: 'T3448 CP data back-off' }),
  },
  {
    id: 'iot-mo-exception',
    ko: 'mo-ExceptionData 바링 우회', en: 'mo-ExceptionData bypasses barring', zh: 'mo-ExceptionData 绕过阻断',
    desc_ko: '알람 버스트 시 establishmentCause=mo-ExceptionData → EAB/UAC 바링 우회 접속 허용.',
    desc_en: 'During alarm burst, establishmentCause=mo-ExceptionData → EAB/UAC barring bypassed, access allowed.',
    desc_zh: '告警突发时 establishmentCause=mo-ExceptionData → 绕过 EAB/UAC 阻断,允许接入。',
    ref: 'TS 38.331 (mo-ExceptionData)', cause: 'mo-ExceptionData (barring bypass)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'mo-ExceptionData → EAB/UAC 우회 접속' },
    ],
    expect: () => ({ label_ko: 'mo-ExceptionData → 바링 우회 접속', label_en: 'mo-ExceptionData → barring bypassed' }),
  },
  {
    id: 'iot-plmn-rate-control',
    ko: 'Serving PLMN rate control', en: 'Serving PLMN rate control', zh: 'Serving PLMN 速率控制',
    desc_ko: 'IoT UE의 Serving PLMN rate control(메시지/6min) 초과 → 초과 패킷 폐기.',
    desc_en: 'IoT UE exceeds Serving PLMN rate control (messages/6min) → excess packets discarded.',
    desc_zh: 'IoT UE 超过 Serving PLMN 速率控制(消息/6min)→ 丢弃超额数据包。',
    ref: 'TS 23.401 §4.7.7 (serving PLMN rate control)', cause: 'Serving PLMN rate control exceeded → discard', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'IoT UE PLMN rate control 초과 → 패킷 폐기' },
    ],
    expect: () => ({ label_ko: 'PLMN rate control 초과 → 패킷 폐기', label_en: 'PLMN rate control exceeded → packets discarded' }),
  },
  {
    id: 'iot-donas',
    ko: 'DoNAS (CP-CIoT, S11-U)', en: 'DoNAS (CP-CIoT, S11-U)', zh: 'DoNAS (CP-CIoT, S11-U)',
    desc_ko: 'NAS ESM DATA TRANSPORT via AMF/MME → S11-U to SGW, DRB 미설정(Control Plane CIoT 최적화).',
    desc_en: 'NAS ESM DATA TRANSPORT via AMF/MME → S11-U to SGW, no DRB established (Control Plane CIoT optimization).',
    desc_zh: 'NAS ESM DATA TRANSPORT 经 AMF/MME → S11-U 到 SGW,不建立 DRB(控制面 CIoT 优化)。',
    ref: 'TS 23.401 (Control Plane CIoT, DoNAS)', cause: 'DoNAS CP-CIoT (no DRB)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'DoNAS: NAS ESM DATA TRANSPORT → S11-U, DRB 없음' },
    ],
    expect: () => ({ label_ko: 'DoNAS 전송 성공 (DRB 없음)', label_en: 'DoNAS transfer OK (no DRB)' }),
  },
  {
    id: 'iot-up-ciot-resume-fail',
    ko: 'UP-CIoT resume 실패', en: 'UP-CIoT resume failure', zh: 'UP-CIoT resume 失败',
    desc_ko: 'RRCConnectionResumeRequest → Resume ID unknown/컨텍스트 조회 실패 → RRCConnectionSetup 폴백(full attach).',
    desc_en: 'RRCConnectionResumeRequest → Resume ID unknown / context retrieval fail → RRCConnectionSetup fallback (full attach).',
    desc_zh: 'RRCConnectionResumeRequest → Resume ID 未知/上下文检索失败 → RRCConnectionSetup 回退(全量 attach)。',
    ref: 'TS 36.331 (UP-CIoT resume)', cause: 'UP-CIoT resume fail → RRCConnectionSetup', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' },
      { op: 'note', text: 'Resume ID unknown → RRCConnectionSetup 폴백' },
    ],
    expect: () => ({ label_ko: 'UP-CIoT resume 실패 → full attach', label_en: 'UP-CIoT resume fail → full attach' }),
  },
  {
    id: 'iot-ra-sdt',
    ko: 'RA-SDT 성공 (RRC_INACTIVE)', en: 'RA-SDT success (RRC_INACTIVE)', zh: 'RA-SDT 成功 (RRC_INACTIVE)',
    desc_ko: 'Rel-17 SDT: RRCResumeRequest+data(SRB/DRB, INACTIVE 유지) → RRCRelease with suspendConfig.',
    desc_en: 'Rel-17 SDT: RRCResumeRequest+data (SRB/DRB, stay INACTIVE) → RRCRelease with suspendConfig.',
    desc_zh: 'Rel-17 SDT:RRCResumeRequest+数据(SRB/DRB,保持 INACTIVE)→ RRCRelease with suspendConfig。',
    ref: 'TS 38.331 (Rel-17 SDT)', cause: 'RA-SDT (small data in RRC_INACTIVE)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RA-SDT: INACTIVE 유지 소량 데이터 전송' },
    ],
    expect: () => ({ label_ko: 'RA-SDT 성공 (INACTIVE 유지)', label_en: 'RA-SDT OK (stay INACTIVE)' }),
  },
  {
    id: 'iot-sdt-t319a',
    ko: 'SDT 실패 (T319a 만료)', en: 'SDT failure (T319a expiry)', zh: 'SDT 失败 (T319a 到期)',
    desc_ko: 'SDT 중 응답 없음 → T319a 만료 → RRC_IDLE, release cause RRC Resume failure.',
    desc_en: 'No response during SDT → T319a expiry → RRC_IDLE, release cause RRC Resume failure.',
    desc_zh: 'SDT 中无响应 → T319a 到期 → RRC_IDLE,释放原因 RRC Resume failure。',
    ref: 'TS 38.331 (SDT, T319a)', cause: 'T319a expiry → RRC_IDLE', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'disableNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'SDT 응답 없음 → T319a 만료 → RRC_IDLE' },
    ],
    expect: () => ({ label_ko: 'T319a 만료 → RRC_IDLE (SDT 실패)', label_en: 'T319a expiry → RRC_IDLE (SDT fail)' }),
  },
  {
    id: 'iot-nidd-buffered',
    ko: 'MT NIDD 버퍼링', en: 'MT NIDD buffered', zh: 'MT NIDD 缓冲',
    desc_ko: 'PSM UE 대상 MT NIDD → T8 DeliveryStatus: BUFFERING_TEMPORARILY_NOT_REACHABLE (UE 도달 시 전달).',
    desc_en: 'MT NIDD to a PSM UE → T8 DeliveryStatus: BUFFERING_TEMPORARILY_NOT_REACHABLE (delivered when UE reachable).',
    desc_zh: '面向 PSM UE 的 MT NIDD → T8 DeliveryStatus:BUFFERING_TEMPORARILY_NOT_REACHABLE(UE 可达时递交)。',
    ref: 'TS 29.122 T8 (NIDD DeliveryStatus)', cause: 'NIDD BUFFERING_TEMPORARILY_NOT_REACHABLE', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NEF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' },
      { op: 'note', text: 'PSM UE MT NIDD → BUFFERING_TEMPORARILY_NOT_REACHABLE' },
    ],
    expect: () => ({ label_ko: 'MT NIDD 버퍼링 (도달불가 임시)', label_en: 'MT NIDD buffered (temp not reachable)' }),
  },
  {
    id: 'iot-nidd-nef-ok',
    ko: '5G NIDD via NEF 성공', en: '5G NIDD via NEF success', zh: '5G NIDD via NEF 成功',
    desc_ko: 'Nnef_NIDD Delivery → SMF(PDU session type=Unstructured) → UPF/NEF 경유 소량 비IP 데이터 전달.',
    desc_en: 'Nnef_NIDD Delivery → SMF (PDU session type=Unstructured) → small non-IP data delivered via UPF/NEF.',
    desc_zh: 'Nnef_NIDD Delivery → SMF(PDU session type=Unstructured)→ 经 UPF/NEF 递交小量非 IP 数据。',
    ref: 'TS 23.502 §4.25 (5G NIDD via NEF)', cause: 'Nnef_NIDD delivery (Unstructured)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'NEF' },
      { op: 'note', text: 'Nnef_NIDD Delivery → Unstructured PDU 전달' },
    ],
    expect: (c) => {
      const has = c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === 'NEF' && n.enabled)
      return has
        ? { label_ko: '5G NIDD via NEF 성공', label_en: '5G NIDD via NEF OK' }
        : { label_ko: 'NEF 없음 → NIDD 불가', label_en: 'no NEF → NIDD fail' }
    },
  },
  {
    id: 'urllc-rsn-redundant',
    ko: 'Redundant PDU (RSN 이중경로)', en: 'Redundant PDU (RSN dual path)', zh: '冗余 PDU (RSN 双路径)',
    desc_ko: 'RSN 이중 PDU 세션 → 서로 다른 사이트 UPF 2개 + RU 2개로 end-to-end disjoint 경로(고신뢰).',
    desc_en: 'RSN dual PDU sessions → 2 UPFs on different sites + 2 RUs for end-to-end disjoint paths (high reliability).',
    desc_zh: 'RSN 双 PDU 会话 → 不同站点的 2 个 UPF + 2 个 RU 构成端到端不相交路径(高可靠)。',
    ref: 'TS 23.501 §5.33.2 (RSN redundant PDU)', cause: 'RSN redundant PDU (disjoint paths)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'RU 2개(다른 사이트)+UPF 2개 → disjoint 이중경로' },
    ],
    expect: () => ({ label_ko: 'RSN 이중경로 (disjoint) 성립', label_en: 'RSN dual disjoint paths OK' }),
  },
  {
    id: 'urllc-pdcp-duplication',
    ko: 'PDCP 중복전송 (URLLC 구제)', en: 'PDCP duplication (URLLC rescue)', zh: 'PDCP 复制 (URLLC 救活)',
    desc_ko: 'MAC CE: duplication activated (2 RLC legs) → 한 leg 장애에도 URLLC flow 생존(패킷손실 반감).',
    desc_en: 'MAC CE: duplication activated (2 RLC legs) → URLLC flow survives one leg failure (halved packet loss).',
    desc_zh: 'MAC CE:duplication activated(2 RLC legs)→ 一条腿失效仍存活(丢包减半)。',
    ref: 'TS 38.323 (PDCP duplication) · TS 38.321 MAC CE', cause: 'PDCP duplication (2 RLC legs)', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'PDCP duplication 활성 → 2 RLC legs → 생존' },
    ],
    expect: () => ({ label_ko: 'PDCP duplication → URLLC flow 생존', label_en: 'PDCP duplication → URLLC flow survives' }),
  },
  {
    id: 'iot-service-gap',
    ko: 'Service Gap Control (T3447)', en: 'Service Gap Control (T3447)', zh: 'Service Gap Control (T3447)',
    desc_ko: 'IoT UE의 MO 연결 최소 간격(T3447) 강제 → 간격 내 MO 요청 차단(빈번한 연결 억제).',
    desc_en: 'Enforced minimum interval between IoT MO connections (T3447) → MO request within the interval is blocked.',
    desc_zh: '强制 IoT UE MO 连接的最小间隔(T3447)→ 间隔内 MO 请求被阻(抑制频繁连接)。',
    ref: 'TS 23.501 §5.31.16 (Service Gap Control) · T3447', cause: 'Service Gap T3447 running → MO blocked', domain: 'iot', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'Service Gap T3447 실행 중 → MO 요청 차단' },
    ],
    expect: () => ({ label_ko: 'Service Gap T3447 → MO 차단', label_en: 'Service Gap T3447 → MO blocked' }),
  },
  {
    id: 'iot-nbiot-no-pdn',
    ko: 'NB-IoT PDN 없는 attach', en: 'NB-IoT attach without PDN', zh: 'NB-IoT 无 PDN 附着',
    desc_ko: 'CIoT attach without PDN → RM-REGISTERED, PDN 연결 없음(SMS/NIDD 전용).',
    desc_en: 'CIoT attach without PDN → RM-REGISTERED, no PDN connection (SMS/NIDD only).',
    desc_zh: 'CIoT 无 PDN 附着 → RM-REGISTERED,无 PDN 连接(仅 SMS/NIDD)。',
    ref: 'TS 23.401 (attach without PDN)', cause: 'CIoT attach without PDN', domain: 'iot', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'CIoT attach without PDN → RM-REGISTERED, PDN 없음' },
    ],
    expect: () => ({ label_ko: 'PDN 없는 attach (SMS/NIDD 전용)', label_en: 'attach without PDN (SMS/NIDD only)' }),
  },
  // ════════ BULK D — 멀티RAT / interworking 추가 ════════
  {
    id: 'n26-ho-5g-to-4g',
    ko: 'N26 5GS→EPS Connected HO', en: 'N26 5GS→EPS connected HO', zh: 'N26 5GS→EPS 连接态切换',
    desc_ko: 'N26 기반 5GS→EPS 핸드오버: AMF↔MME Forward Relocation → SGW/PGW 경로 → 세션 유지(IP 보존).',
    desc_en: 'N26-based 5GS→EPS handover: AMF↔MME Forward Relocation → SGW/PGW path → session kept (IP preserved).',
    desc_zh: '基于 N26 的 5GS→EPS 切换:AMF↔MME Forward Relocation → SGW/PGW 路径 → 会话保持(IP 保留)。',
    ref: 'TS 23.502 §4.11.1.2.1 (N26 5GS→EPS HO)', cause: 'N26 5GS→EPS connected handover', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'NR+LTE RU, N26(AMF↔MME) → Forward Relocation, IP 보존' },
    ],
    expect: () => ({ label_ko: 'N26 5GS→EPS HO 성공 (IP 보존)', label_en: 'N26 5GS→EPS HO OK (IP preserved)' }),
  },
  {
    id: 'n26-ho-4g-to-5g',
    ko: 'N26 EPS→5GS Connected HO', en: 'N26 EPS→5GS connected HO', zh: 'N26 EPS→5GS 连接态切换',
    desc_ko: 'N26 기반 EPS→5GS 핸드오버: MME↔AMF Forward Relocation, Registration type=mobility → 세션 유지.',
    desc_en: 'N26-based EPS→5GS handover: MME↔AMF Forward Relocation, Registration type=mobility → session kept.',
    desc_zh: '基于 N26 的 EPS→5GS 切换:MME↔AMF Forward Relocation,Registration type=mobility → 会话保持。',
    ref: 'TS 23.502 §4.11.1.2.2 (N26 EPS→5GS HO)', cause: 'N26 EPS→5GS connected handover', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'N26(MME↔AMF) → Forward Relocation, mobility 등록' },
    ],
    expect: () => ({ label_ko: 'N26 EPS→5GS HO 성공', label_en: 'N26 EPS→5GS HO OK' }),
  },
  {
    id: 'n26-idle-mob-reg',
    ko: 'N26 EPS→5GS Idle 이동', en: 'N26 EPS→5GS idle mobility', zh: 'N26 EPS→5GS 空闲移动',
    desc_ko: 'Idle 모드 EPS→5GS: Mobility Registration(5G-GUTI mapped from EPS GUTI) → AMF가 N26 Context Request → MME.',
    desc_en: 'Idle-mode EPS→5GS: Mobility Registration (5G-GUTI mapped from EPS GUTI) → AMF N26 Context Request → MME.',
    desc_zh: '空闲态 EPS→5GS:Mobility Registration(由 EPS GUTI 映射 5G-GUTI)→ AMF N26 Context Request → MME。',
    ref: 'TS 23.502 §4.11.1.3.3 (idle EPS→5GS)', cause: 'N26 idle mobility registration', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'Idle EPS→5GS: mobility 등록 + N26 Context Request' },
    ],
    expect: () => ({ label_ko: 'N26 Idle 이동 등록 성공', label_en: 'N26 idle mobility registration OK' }),
  },
  {
    id: 'tau-fail-emm9',
    ko: 'TAU 실패 (EMM #9)', en: 'TAU fail (EMM #9)', zh: 'TAU 失败 (EMM #9)',
    desc_ko: 'N26 컨텍스트 조회 실패(MME/AMF 부재) → UE 식별 불가 → TAU Reject EMM #9 (UE identity cannot be derived) → re-attach.',
    desc_en: 'N26 context retrieval fails (MME/AMF absent) → UE cannot be identified → TAU Reject EMM #9 (UE identity cannot be derived) → re-attach.',
    desc_zh: 'N26 上下文检索失败(MME/AMF 缺失)→ 无法识别 UE → TAU Reject EMM #9 → 重新附着。',
    ref: 'TS 24.301 EMM #9 · TS 23.502 §4.11.1.3', cause: 'EMM #9 UE identity cannot be derived', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'removeNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'N26 컨텍스트 조회 실패 → EMM #9 → re-attach' },
    ],
    expect: () => ({ label_ko: 'TAU Reject EMM #9 → re-attach', label_en: 'TAU Reject EMM #9 → re-attach' }),
  },
  {
    id: 'ebi-alloc-fail',
    ko: 'EBI 할당 실패 (일부 flow 미이관)', en: 'EBI allocation fail (partial)', zh: 'EBI 分配失败 (部分未迁移)',
    desc_ko: 'EPS Bearer ID(5-15) 소진/ARP 기반 거절 → 일부 QoS flow만 EPS bearer로 이관, 나머지 미이관.',
    desc_en: 'EPS Bearer IDs (5-15) exhausted / ARP-based rejection → only some QoS flows map to EPS bearers, rest not transferred.',
    desc_zh: 'EPS Bearer ID(5-15)耗尽/基于 ARP 拒绝 → 仅部分 QoS flow 映射到 EPS bearer,其余未迁移。',
    ref: 'TS 23.502 §4.11.1.4.1 (EBI allocation)', cause: 'EBI 5-15 exhausted / ARP-based rejection', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: 'EBI 5-15 소진 → 일부 flow만 이관' },
    ],
    expect: () => ({ label_ko: 'EBI 소진 → 일부 QoS flow 미이관', label_en: 'EBI exhausted → some QoS flows not transferred' }),
  },
  {
    id: 'iwk-ethernet-pdu-excluded',
    ko: 'Ethernet PDU 이관 제외', en: 'Ethernet PDU excluded from IWK', zh: 'Ethernet PDU 排除互通',
    desc_ko: 'Ethernet PDU 세션은 EPS bearer 미매핑 → EPS 이관 제외(IP PDU만 이관 가능).',
    desc_en: 'Ethernet PDU session has no mapped EPS bearer → excluded from EPS interworking (only IP PDU transfers).',
    desc_zh: 'Ethernet PDU 会话无映射 EPS bearer → 排除 EPS 互通(仅 IP PDU 可迁移)。',
    ref: 'TS 23.501 §5.17.2 (Ethernet PDU no EPS bearer)', cause: 'Ethernet PDU — no EPS bearer mapped', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: 'Ethernet PDU → EPS bearer 미매핑 → 이관 제외' },
    ],
    expect: () => ({ label_ko: 'Ethernet PDU → EPS 이관 제외', label_en: 'Ethernet PDU → excluded from EPS interworking' }),
  },
  {
    id: 'ho-prep-fail-target',
    ko: 'HO 준비 실패 (타깃 거절)', en: 'HO prep fail (target reject)', zh: 'HO 准备失败 (目标拒绝)',
    desc_ko: '타깃 LTE 셀 max_ue=0/포화 → NGAP no radio resources available → Handover Preparation Failure.',
    desc_en: 'Target LTE cell max_ue=0/full → NGAP no radio resources available → Handover Preparation Failure.',
    desc_zh: '目标 LTE 小区 max_ue=0/满载 → NGAP no radio resources available → Handover Preparation Failure。',
    ref: 'TS 38.413 §8.4.1 (Handover Preparation Failure)', cause: 'NGAP no radio resources → HO Prep Failure', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: '타깃 LTE 셀 포화 → HO Preparation Failure' },
    ],
    expect: () => ({ label_ko: 'HO Preparation Failure (타깃 자원없음)', label_en: 'HO Preparation Failure (no target resources)' }),
  },
  {
    id: 'no-n26-ho-attach',
    ko: 'N26 없는 5GS→EPS Handover Attach', en: 'No-N26 5GS→EPS Handover Attach', zh: '无 N26 5GS→EPS Handover Attach',
    desc_ko: 'N26 부재 → Request Type=Handover로 LTE Attach → PGW(=SMF+PGW-C 결합)에서 IP 보존.',
    desc_en: 'No N26 → LTE Attach with Request Type=Handover → IP preserved at PGW (=SMF+PGW-C combined).',
    desc_zh: '无 N26 → 以 Request Type=Handover 进行 LTE Attach → 在 PGW(=SMF+PGW-C 合一)保留 IP。',
    ref: 'TS 23.502 §4.11.2.2 (no-N26 handover attach)', cause: 'Request Type=Handover (IP preserved)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'SGW' }, { op: 'ensureNf', zone: 'A', type: 'PGW' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'N26 부재 → Handover attach → PGW IP 보존' },
    ],
    expect: () => ({ label_ko: 'no-N26 Handover Attach (IP 보존)', label_en: 'no-N26 Handover Attach (IP preserved)' }),
  },
  {
    id: 'existing-pdu-not-found',
    ko: 'Existing PDU 이관 실패 #54', en: 'Existing PDU transfer fail #54', zh: 'Existing PDU 迁移失败 #54',
    desc_ko: 'EPS→5GS existing PDU session 이관 시 대상 세션 컨텍스트 부재 → 5GSM #54 PDU session does not exist.',
    desc_en: 'On EPS→5GS existing PDU session transfer, target session context absent → 5GSM #54 PDU session does not exist.',
    desc_zh: 'EPS→5GS existing PDU session 迁移时目标会话上下文缺失 → 5GSM #54 PDU session does not exist。',
    ref: 'TS 24.501 §6.4.1 · 5GSM #54', cause: '5GSM #54 PDU session does not exist', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'PGW' },
      { op: 'note', text: 'existing PDU 이관 대상 세션 부재 → #54' },
    ],
    expect: () => ({ label_ko: 'Existing PDU 이관 실패 → #54', label_en: 'Existing PDU transfer fail → #54' }),
  },
  {
    id: 'ssc23-no-eps-iwk',
    ko: 'SSC 2/3 PDU EPS 이관 불가', en: 'SSC 2/3 PDU no EPS interworking', zh: 'SSC 2/3 PDU 无 EPS 互通',
    desc_ko: 'IP 보존은 SSC mode 1만 → SSC mode 2/3 PDU 세션은 EPS 이관 불가(재수립 필요).',
    desc_en: 'IP preservation is SSC mode 1 only → SSC mode 2/3 PDU sessions cannot interwork to EPS (need re-establishment).',
    desc_zh: 'IP 保留仅 SSC 模式 1 → SSC 模式 2/3 PDU 会话无法 EPS 互通(需重建)。',
    ref: 'TS 23.501 §5.17.2 (SSC mode 1 only for IP preservation)', cause: 'SSC 2/3 — no EPS interworking', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: 'SSC 2/3 PDU → EPS 이관 불가(SSC1만 IP 보존)' },
    ],
    expect: () => ({ label_ko: 'SSC 2/3 → EPS 이관 불가', label_en: 'SSC 2/3 → no EPS interworking' }),
  },
  {
    id: 'rat-fallback-eutra-5gc',
    ko: 'RAT Fallback (E-UTRA/5GC)', en: 'RAT Fallback (E-UTRA connected to 5GC)', zh: 'RAT Fallback (E-UTRA 连 5GC)',
    desc_ko: 'NR RU+LTE RU 모두 5GC 존 → intra-5GC HO/redirect로 E-UTRA(5GC 유지) → TAU 불필요.',
    desc_en: 'NR RU + LTE RU both on 5GC → intra-5GC HO/redirect to E-UTRA (stay on 5GC) → no TAU needed.',
    desc_zh: 'NR RU + LTE RU 均连 5GC → 5GC 内 HO/redirect 到 E-UTRA(保持 5GC)→ 无需 TAU。',
    ref: 'TS 23.502 §4.13.6.2 (RAT fallback, E-UTRA/5GC)', cause: 'RAT fallback (E-UTRA connected to 5GC)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'NR+LTE(5GC) → RAT fallback, 5GC 유지, TAU 불필요' },
    ],
    expect: () => ({ label_ko: 'RAT Fallback → 5GC 유지 (TAU 불필요)', label_en: 'RAT fallback → stay on 5GC (no TAU)' }),
  },
  {
    id: 'eps-fallback-fail',
    ko: 'EPS Fallback 실패 (호 설정)', en: 'EPS Fallback fail (call setup)', zh: 'EPS Fallback 失败 (呼叫建立)',
    desc_ko: 'MME는 있으나 LTE RU 부재/포화 → QCI=1 bearer 미설정 → SIP 487/504 timeout, 호 실패.',
    desc_en: 'MME present but LTE RU absent/full → QCI=1 bearer not established → SIP 487/504 timeout, call fails.',
    desc_zh: 'MME 存在但 LTE RU 缺失/满载 → QCI=1 bearer 未建立 → SIP 487/504 timeout,呼叫失败。',
    ref: 'TS 23.502 §4.13.6.1 · SIP 487/504', cause: 'QCI=1 bearer not established → SIP 487/504', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'MME 있으나 LTE RU 부재/포화 → QCI1 미설정 → 호 실패' },
    ],
    expect: () => ({ label_ko: 'EPS Fallback 실패 — QCI1 미설정', label_en: 'EPS Fallback fail — QCI1 not established' }),
  },
  {
    id: 'fast-return-fail',
    ko: 'Fast Return 실패 (sticky LTE)', en: 'Fast Return fail (sticky LTE)', zh: 'Fast Return 失败 (LTE 粘滞)',
    desc_ko: '통화 종료 후 eNB redirect 미설정 → sticky LTE → 5G-4G-5G 핑퐁(hysteresis↓ 시 심화).',
    desc_en: 'After call end, eNB redirect not configured → sticky LTE → 5G-4G-5G ping-pong (worse with low hysteresis).',
    desc_zh: '通话结束后 eNB redirect 未配置 → LTE 粘滞 → 5G-4G-5G 乒乓(hysteresis 低时加剧)。',
    ref: 'TS 36.331 (redirect) · fast return pitfall', cause: 'fast return fail → sticky LTE / ping-pong', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' },
      { op: 'note', text: 'eNB fast-return redirect 미설정 → sticky LTE/핑퐁' },
    ],
    expect: () => ({ label_ko: 'Fast Return 실패 → sticky LTE/핑퐁', label_en: 'Fast Return fail → sticky LTE/ping-pong' }),
  },
  {
    id: 'voice-centric-n1-disable',
    ko: 'Voice-centric UE N1 비활성', en: 'Voice-centric UE N1 disable', zh: 'Voice-centric UE 禁用 N1',
    desc_ko: 'IMS voice not supported 지시(P-CSCF 없음) → voice-centric UE가 N1 모드 자체 비활성 → LTE 재선택.',
    desc_en: 'IMS voice not supported indication (no P-CSCF) → a voice-centric UE disables N1 mode itself → reselects LTE.',
    desc_zh: 'IMS voice not supported 指示(无 P-CSCF)→ voice-centric UE 自行禁用 N1 模式 → 重选 LTE。',
    ref: 'TS 24.501 §4.9.2 · TS 23.501 §5.16.3 (voice-centric)', cause: 'IMS voice not supported → N1 disabled', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'removeNf', zone: 'A', type: 'P-CSCF' },
      { op: 'note', text: 'IMS voice 미지원 → voice-centric UE N1 비활성 → LTE' },
    ],
    expect: () => ({ label_ko: 'IMS voice 미지원 → N1 비활성(LTE)', label_en: 'IMS voice unsupported → N1 disabled (LTE)' }),
  },
  {
    id: 'emergency-services-fallback',
    ko: 'Emergency Services Fallback', en: 'Emergency Services Fallback', zh: '紧急业务回退',
    desc_ko: 'Service Request(type=emergency services fallback) → NG-RAN HO/redirect → EPS 긴급호.',
    desc_en: 'Service Request (type=emergency services fallback) → NG-RAN HO/redirect → EPS emergency call.',
    desc_zh: 'Service Request(type=emergency services fallback)→ NG-RAN HO/redirect → EPS 紧急呼叫。',
    ref: 'TS 23.502 §4.13.4.2 (Emergency Services Fallback)', cause: 'Emergency Services Fallback (5GS→EPS)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'ESFB: emergency services fallback → EPS 긴급호' },
    ],
    expect: () => ({ label_ko: 'Emergency Services Fallback 성공', label_en: 'Emergency Services Fallback OK' }),
  },
  {
    id: 'n3iwf-auth-fail',
    ko: 'N3IWF 인증 실패 (IKEv2 24)', en: 'N3IWF auth fail (IKEv2 24)', zh: 'N3IWF 鉴权失败 (IKEv2 24)',
    desc_ko: 'N3IWF 존재하나 AUSF/UDM 부재/키 불일치 → IKE_AUTH 내 EAP-5G 실패 → IKEv2 Notify AUTHENTICATION_FAILED(24) → IKE SA 해제.',
    desc_en: 'N3IWF present but AUSF/UDM absent/key mismatch → EAP-5G fails inside IKE_AUTH → IKEv2 Notify AUTHENTICATION_FAILED (24) → IKE SA torn down.',
    desc_zh: 'N3IWF 存在但 AUSF/UDM 缺失/密钥不匹配 → IKE_AUTH 中 EAP-5G 失败 → IKEv2 Notify AUTHENTICATION_FAILED(24)→ 拆除 IKE SA。',
    ref: 'RFC 7296 (Notify 24) · TS 33.501 §7.2.1', cause: 'IKEv2 AUTHENTICATION_FAILED (24) / EAP-Failure', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'N3IWF' }, { op: 'removeNf', zone: 'A', type: 'AUSF' },
      { op: 'note', text: 'N3IWF + AUSF 제거 → EAP-5G 실패 → IKEv2 Notify 24' },
    ],
    expect: () => ({ label_ko: 'IKEv2 AUTHENTICATION_FAILED (24)', label_en: 'IKEv2 AUTHENTICATION_FAILED (24)' }),
  },
  {
    id: 'reg-non3gpp-not-allowed',
    ko: '등록 거부 #72 (non-3GPP 불허)', en: 'Registration reject #72 (non-3GPP not allowed)', zh: '注册拒绝 #72 (non-3GPP 不允许)',
    desc_ko: 'Non-3GPP access to 5GCN not allowed → Registration Reject 5GMM #72 (3GPP access 등록과 독립).',
    desc_en: 'Non-3GPP access to 5GCN not allowed → Registration Reject 5GMM #72 (independent of 3GPP access registration).',
    desc_zh: 'Non-3GPP access to 5GCN not allowed → Registration Reject 5GMM #72(与 3GPP 接入注册独立)。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #72', cause: '5GMM #72 non-3GPP access not allowed', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'N3IWF' },
      { op: 'note', text: 'non-3GPP access to 5GCN 미허용 → #72' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #72 (non-3GPP 불허)', label_en: 'Registration Reject #72 (non-3GPP not allowed)' }),
  },
  {
    id: 'n3iwf-to-nr-ho',
    ko: 'non-3GPP→3GPP PDU 핸드오버', en: 'non-3GPP→3GPP PDU handover', zh: 'non-3GPP→3GPP PDU 切换',
    desc_ko: 'Wi-Fi 이탈 → 동일 SMF/UPF 앵커 유지, Request Type=Existing PDU Session으로 NR(N3) 터널 전환.',
    desc_en: 'Wi-Fi leaving → same SMF/UPF anchor, switch to NR (N3) tunnel with Request Type=Existing PDU Session.',
    desc_zh: '离开 Wi-Fi → 保持同一 SMF/UPF 锚点,以 Request Type=Existing PDU Session 切到 NR(N3)隧道。',
    ref: 'TS 23.502 §4.9.2 (non-3GPP→3GPP)', cause: 'Existing PDU Session (same UPF anchor)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'N3IWF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'Wi-Fi 이탈 → 앵커 UPF 유지, NR N3 터널 전환' },
    ],
    expect: () => ({ label_ko: 'non-3GPP→3GPP HO (앵커 UPF 유지)', label_en: 'non-3GPP→3GPP HO (anchor UPF kept)' }),
  },
  {
    id: 'tngf-reg',
    ko: 'TNGF 신뢰 non-3GPP 등록', en: 'TNGF trusted non-3GPP reg', zh: 'TNGF 可信 non-3GPP 注册',
    desc_ko: 'TNGF 경유 신뢰 non-3GPP 접속 → EAP-5G 운반, TNGF 키 도출(NWt IPsec).',
    desc_en: 'Trusted non-3GPP access via TNGF → EAP-5G transport, TNGF key derivation (NWt IPsec).',
    desc_zh: '经 TNGF 的可信 non-3GPP 接入 → 承载 EAP-5G,推导 TNGF 密钥(NWt IPsec)。',
    ref: 'TS 23.502 §4.12a.2.2 · TS 33.501 (TNGF)', cause: 'TNGF trusted non-3GPP registration', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'TNGF 경유 신뢰 non-3GPP 등록 (EAP-5G, NWt IPsec)' },
    ],
    expect: () => ({ label_ko: 'TNGF 신뢰 non-3GPP 등록 성공', label_en: 'TNGF trusted non-3GPP registration OK' }),
  },
  {
    id: 'twif-n5cw',
    ko: 'TWIF 경유 N5CW 접속', en: 'N5CW via TWIF', zh: '经 TWIF 的 N5CW 接入',
    desc_ko: 'N5CW(비5G) 디바이스 → TWIF가 UE 대신 NAS 수행(EAP-AKA′) → 5GC 접속.',
    desc_en: 'N5CW (non-5G-capable) device → TWIF performs NAS on behalf of the UE (EAP-AKA′) → attaches to 5GC.',
    desc_zh: 'N5CW(非 5G)设备 → TWIF 代替 UE 执行 NAS(EAP-AKA′)→ 接入 5GC。',
    ref: 'TS 23.502 §4.12b (TWIF/N5CW)', cause: 'N5CW via TWIF (TWIF performs NAS)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'N5CW 디바이스 → TWIF 대행 NAS(EAP-AKA′)' },
    ],
    expect: () => ({ label_ko: 'TWIF 경유 N5CW 5GC 접속', label_en: 'N5CW via TWIF attaches to 5GC' }),
  },
  {
    id: 'ma-pdu-ok',
    ko: 'MA PDU 세션 성립 (ATSSS)', en: 'MA PDU session OK (ATSSS)', zh: 'MA PDU 会话建立 (ATSSS)',
    desc_ko: '양 access(3GPP+non-3GPP) 동시 → MA PDU 세션(MPTCP/ATSSS-LL, N4 MAR) → 트래픽 스티어링.',
    desc_en: 'Both accesses (3GPP + non-3GPP) simultaneously → MA PDU session (MPTCP/ATSSS-LL, N4 MAR) → traffic steering.',
    desc_zh: '两种接入(3GPP+non-3GPP)同时 → MA PDU 会话(MPTCP/ATSSS-LL,N4 MAR)→ 流量导向。',
    ref: 'TS 23.502 §4.22.2 (MA PDU) · ATSSS', cause: 'MA PDU (ATSSS, N4 MAR)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'N3IWF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'MA PDU: 3GPP+non-3GPP 동시, ATSSS steering' },
    ],
    expect: () => ({ label_ko: 'MA PDU 성립 (ATSSS)', label_en: 'MA PDU session OK (ATSSS)' }),
  },
  {
    id: 'ma-pdu-denied-single',
    ko: 'MA PDU 불허 → 단일 access', en: 'MA PDU denied → single access', zh: 'MA PDU 拒绝 → 单接入',
    desc_ko: 'PCF/가입정보가 MA PDU 불허 → 단일 access PDU 세션으로 수립.',
    desc_en: 'PCF/subscription denies MA PDU → established as a single-access PDU session.',
    desc_zh: 'PCF/签约不允许 MA PDU → 以单接入 PDU 会话建立。',
    ref: 'TS 23.502 §4.22.2 (MA PDU denial)', cause: 'MA PDU denied → single-access', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'ensureNf', zone: 'A', type: 'PCF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'PCF MA PDU 불허 → 단일 access PDU' },
    ],
    expect: () => ({ label_ko: 'MA PDU 불허 → 단일 access', label_en: 'MA PDU denied → single access' }),
  },
  {
    id: 'ma-pdu-release-amf',
    ko: 'ATSSS 미지원 AMF → MA PDU 해제', en: 'ATSSS-unsupported AMF → MA PDU release', zh: 'ATSSS 不支持 AMF → MA PDU 释放',
    desc_ko: 'ATSSS 미지원 AMF 존으로 이동 → MA PDU 세션 해제.',
    desc_en: 'Move to a zone with an ATSSS-unsupported AMF → MA PDU session released.',
    desc_zh: '移动到 ATSSS 不支持的 AMF 区 → MA PDU 会话释放。',
    ref: 'TS 23.501 §5.32 (ATSSS AMF capability)', cause: 'ATSSS-unsupported AMF → MA PDU release', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' },
      { op: 'note', text: 'ATSSS 미지원 AMF 존 이동 → MA PDU 해제' },
    ],
    expect: () => ({ label_ko: 'ATSSS 미지원 AMF → MA PDU 해제', label_en: 'ATSSS-unsupported AMF → MA PDU released' }),
  },
  {
    id: 'nssaa-ok',
    ko: 'NSSAA 성공 (pending→allowed)', en: 'NSSAA success (pending→allowed)', zh: 'NSSAA 成功 (pending→allowed)',
    desc_ko: 'Pending NSSAI → EAP(NSSAAF/AAA-S) → EAP-Success → UE Configuration Update로 Allowed NSSAI 승격.',
    desc_en: 'Pending NSSAI → EAP (NSSAAF/AAA-S) → EAP-Success → UE Configuration Update promotes to Allowed NSSAI.',
    desc_zh: 'Pending NSSAI → EAP(NSSAAF/AAA-S)→ EAP-Success → UE Configuration Update 升级为 Allowed NSSAI。',
    ref: 'TS 23.502 §4.2.9.2 (NSSAA)', cause: 'NSSAA success (pending→allowed)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NSSAAF' },
      { op: 'note', text: 'Pending NSSAI → NSSAAF/AAA-S EAP-Success → Allowed' },
    ],
    expect: (c) => {
      const has = c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === 'NSSAAF' && n.enabled)
      return has
        ? { label_ko: 'NSSAA 성공 → Allowed NSSAI 승격', label_en: 'NSSAA success → promoted to Allowed NSSAI' }
        : { label_ko: 'NSSAAF 없음 → NSSAA 불가', label_en: 'no NSSAAF → NSSAA fail' }
    },
  },
  {
    id: 'nssaa-revocation',
    ko: 'NSSAA 인가 철회 (revocation)', en: 'NSSAA authorization revocation', zh: 'NSSAA 授权撤销',
    desc_ko: 'AAA-S → NSSAAF → AMF Slice-Specific Authorization Revocation → UCU로 Allowed NSSAI 제거, 해당 슬라이스 PDU 세션 해제.',
    desc_en: 'AAA-S → NSSAAF → AMF Slice-Specific Authorization Revocation → S-NSSAI removed via UCU, PDU sessions on that slice released.',
    desc_zh: 'AAA-S → NSSAAF → AMF Slice-Specific Authorization Revocation → 经 UCU 移除 S-NSSAI,释放该切片 PDU 会话。',
    ref: 'TS 23.502 §4.2.9.3/4 (NSSAA revocation)', cause: 'NSSAA revocation (Allowed NSSAI removed)', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NSSAAF' },
      { op: 'note', text: 'AAA-S 개시 revocation → Allowed NSSAI 제거, PDU 해제' },
    ],
    expect: () => ({ label_ko: 'NSSAA revocation → 슬라이스 PDU 해제', label_en: 'NSSAA revocation → slice PDU released' }),
  },
  {
    id: 'nssaa-reauth',
    ko: 'NSSAA 재인증 (re-NSSAA)', en: 'NSSAA re-authentication (re-NSSAA)', zh: 'NSSAA 重鉴权 (re-NSSAA)',
    desc_ko: 'AAA-S가 re-NSSAA 트리거 → EAP 재수행 → 성공 시 Allowed 유지, 실패 시 nssaa-fail 경로.',
    desc_en: 'AAA-S triggers re-NSSAA → EAP re-run → success keeps Allowed, failure follows nssaa-fail path.',
    desc_zh: 'AAA-S 触发 re-NSSAA → 重跑 EAP → 成功保持 Allowed,失败走 nssaa-fail 路径。',
    ref: 'TS 23.502 §4.2.9.4 (re-NSSAA)', cause: 're-NSSAA (EAP re-run)', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'NSSAAF' },
      { op: 'note', text: 'AAA-S re-NSSAA 트리거 → EAP 재수행' },
    ],
    expect: () => ({ label_ko: 're-NSSAA → EAP 재수행', label_en: 're-NSSAA → EAP re-run' }),
  },
  {
    id: 'mico-negotiate',
    ko: 'MICO 모드 협상 성공', en: 'MICO mode negotiation OK', zh: 'MICO 模式协商成功',
    desc_ko: '등록 시 MICO 협상 성공 → Active Time/Strictly Periodic Registration Timer(Rel-17), CM-IDLE 중 페이징 불가 특성.',
    desc_en: 'MICO negotiated at registration → Active Time/Strictly Periodic Registration Timer (Rel-17), unpageable while CM-IDLE.',
    desc_zh: '注册时 MICO 协商成功 → Active Time/Strictly Periodic Registration Timer(Rel-17),CM-IDLE 期间不可寻呼。',
    ref: 'TS 23.501 §5.4.1.3 (MICO)', cause: 'MICO mode negotiated', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'Registration Accept MICO-indication 협상' },
    ],
    expect: () => ({ label_ko: 'MICO 협상 성공 (MT 페이징 불가)', label_en: 'MICO negotiated (unpageable in CM-IDLE)' }),
  },
  {
    id: 'ucu-reregistration',
    ko: 'UCU 재등록 요구 (T3555)', en: 'UCU registration requested (T3555)', zh: 'UCU 要求重注册 (T3555)',
    desc_ko: 'Configuration Update Command에 "registration requested" 지시 + T3555 → 협상 파라미터는 재등록으로 반영.',
    desc_en: 'Configuration Update Command with "registration requested" + T3555 → negotiated params applied via re-registration.',
    desc_zh: 'Configuration Update Command 携带 "registration requested" + T3555 → 协商参数经重注册生效。',
    ref: 'TS 24.501 §4.2.4.2 (UCU registration requested) · T3555', cause: 'UCU registration requested (T3555)', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'UCU: registration requested + T3555 → 재등록 반영' },
    ],
    expect: () => ({ label_ko: 'UCU registration requested → 재등록', label_en: 'UCU registration requested → re-registration' }),
  },
  {
    id: 'racs-id-assign',
    ko: 'RACS Capability ID 할당', en: 'RACS Capability ID assignment', zh: 'RACS Capability ID 分配',
    desc_ko: 'UCMF가 PLMN-assigned UE Radio Capability ID 할당 → UCU/Registration Accept로 전달(시그널링 절감).',
    desc_en: 'UCMF assigns a PLMN-assigned UE Radio Capability ID → delivered via UCU/Registration Accept (signalling reduction).',
    desc_zh: 'UCMF 分配 PLMN-assigned UE Radio Capability ID → 经 UCU/Registration Accept 传递(减少信令)。',
    ref: 'TS 23.501 §5.4.4.1a (RACS) · UCMF', cause: 'RACS PLMN-assigned Capability ID', domain: 'multirat', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UCMF' },
      { op: 'note', text: 'UCMF PLMN-assigned Capability ID 할당' },
    ],
    expect: () => ({ label_ko: 'RACS Capability ID 할당 성공', label_en: 'RACS Capability ID assigned' }),
  },
  {
    id: 'racs-id-unresolved',
    ko: 'RACS Capability ID 미해석', en: 'RACS Capability ID unresolved', zh: 'RACS Capability ID 未解析',
    desc_ko: 'Capability ID 미해석/dictionary Version ID 불일치 → UECapabilityEnquiry로 full capability 재획득 후 재할당.',
    desc_en: 'Capability ID not resolved / dictionary Version ID mismatch → re-acquire full capability via UECapabilityEnquiry, then reassign.',
    desc_zh: 'Capability ID 未解析/dictionary Version ID 不匹配 → 经 UECapabilityEnquiry 重新获取完整能力后再分配。',
    ref: 'TS 23.501 §5.4.4.1a (RACS dictionary mismatch)', cause: 'Capability ID unresolved / dictionary mismatch', domain: 'multirat', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UCMF' },
      { op: 'note', text: 'Capability ID 미해석 → UECapabilityEnquiry 재획득' },
    ],
    expect: () => ({ label_ko: 'Capability ID 미해석 → full capability 재획득', label_en: 'Capability ID unresolved → re-acquire full capability' }),
  },
  // ════════ BULK D — SNPN / NPN 추가 ════════
  {
    id: 'snpn-select-auto',
    ko: 'SNPN 자동 선택 (PLMN+NID)', en: 'SNPN auto selection (PLMN+NID)', zh: 'SNPN 自动选择 (PLMN+NID)',
    desc_ko: 'SNPN access mode UE가 브로드캐스트 PLMN ID+NID로 가입 SNPN 자동 선택 → 등록 성공.',
    desc_en: 'An SNPN-access-mode UE auto-selects the subscribed SNPN by broadcast PLMN ID+NID → registration OK.',
    desc_zh: 'SNPN 接入模式 UE 通过广播 PLMN ID+NID 自动选择签约 SNPN → 注册成功。',
    ref: 'TS 23.501 §5.30.2 (SNPN selection)', cause: 'SNPN auto selection (PLMN+NID)', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'UDM' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: 'zone C SNPN(PLMN+NID) → 자동 선택 등록' },
    ],
    expect: (c) => {
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'C')
      return e.ok ? { label_ko: 'SNPN 자동 선택 등록 성공', label_en: 'SNPN auto selection OK' } : { label_ko: `불가: ${e.missing.join(', ')}`, label_en: `fail: ${e.missing.join(', ')}` }
    },
  },
  {
    id: 'snpn-manual-hrnn',
    ko: 'SNPN 수동 선택 (HRNN)', en: 'SNPN manual selection (HRNN)', zh: 'SNPN 手动选择 (HRNN)',
    desc_ko: 'UE에 HRNN(Human-Readable Network Name) 목록 표시 → 사용자가 수동 선택하여 SNPN 등록.',
    desc_en: 'HRNN (Human-Readable Network Name) list shown to the UE → user manually selects an SNPN to register.',
    desc_zh: '向 UE 显示 HRNN(可读网络名)列表 → 用户手动选择 SNPN 注册。',
    ref: 'TS 23.501 §5.30.2 (HRNN, manual selection)', cause: 'SNPN manual selection (HRNN)', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'UDM' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: 'HRNN 목록 표시 → 수동 SNPN 선택' },
    ],
    expect: () => ({ label_ko: 'SNPN 수동 선택 (HRNN) 성공', label_en: 'SNPN manual selection (HRNN) OK' }),
  },
  {
    id: 'snpn-entry-invalidated-t3245',
    ko: 'SNPN 가입항목 무효화 (T3245)', en: 'SNPN entry invalidated (T3245)', zh: 'SNPN 签约项失效 (T3245)',
    desc_ko: 'CH 미지원 UE의 SNPN subscriber-data 항목 무효화 → T3245(24-48h) 만료 시 회복.',
    desc_en: 'SNPN subscriber-data entry invalidated for a CH-unsupported UE → recovers on T3245 (24-48h) expiry.',
    desc_zh: 'CH 不支持 UE 的 SNPN 签约数据项失效 → T3245(24-48h)到期后恢复。',
    ref: 'TS 24.501 (SNPN entry invalidation, T3245)', cause: 'SNPN entry invalidated → T3245 recovery', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' },
      { op: 'note', text: 'SNPN 가입항목 무효화 → T3245 만료 시 회복' },
    ],
    expect: () => ({ label_ko: 'SNPN 항목 무효화 → T3245 회복', label_en: 'SNPN entry invalidated → T3245 recovery' }),
  },
  {
    id: 'cag-access-ok',
    ko: 'CAG 셀 접속 성공 (PNI-NPN)', en: 'CAG cell access OK (PNI-NPN)', zh: 'CAG 小区接入成功 (PNI-NPN)',
    desc_ko: 'CAG-ID가 UE Allowed CAG list에 있음 → 접속 허용(PNI-NPN).',
    desc_en: 'CAG-ID in the UE Allowed CAG list → access permitted (PNI-NPN).',
    desc_zh: 'CAG-ID 在 UE Allowed CAG 列表中 → 允许接入(PNI-NPN)。',
    ref: 'TS 23.501 §5.30.3 (CAG, PNI-NPN)', cause: 'CAG-ID in Allowed CAG list', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'UDM' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: 'CAG-ID ∈ Allowed CAG list → 접속 허용' },
    ],
    expect: () => ({ label_ko: 'CAG 셀 접속 성공 (Allowed CAG)', label_en: 'CAG cell access OK (Allowed CAG)' }),
  },
  {
    id: 'cag-only-on-public-cell',
    ko: 'CAG 전용 UE #76 (일반 셀)', en: 'CAG-only UE #76 (public cell)', zh: 'CAG 专用 UE #76 (公共小区)',
    desc_ko: 'CAG-only UE가 일반(non-CAG) 셀 접속 시도 → Registration Reject 5GMM #76.',
    desc_en: 'CAG-only UE attempts a non-CAG (public) cell → Registration Reject 5GMM #76.',
    desc_zh: 'CAG 专用 UE 尝试接入普通(non-CAG)小区 → Registration Reject 5GMM #76。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #76 (CAG)', cause: '5GMM #76 (CAG-only on public cell)', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: 'CAG-only UE가 일반 셀 접속 → #76' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #76 (CAG-only)', label_en: 'Registration Reject #76 (CAG-only)' }),
  },
  {
    id: 'snpn-ch-aaa-auth',
    ko: 'SNPN CH AAA 1차 인증', en: 'SNPN CH AAA primary auth', zh: 'SNPN CH AAA 主鉴权',
    desc_ko: 'Credentials Holder AAA 서버 경유 1차 인증 → Nausf_UEAuthentication → (NSSAAF-유사 릴레이) → AAA(EAP-AKA′/TLS).',
    desc_en: 'Primary authentication via Credentials Holder AAA server → Nausf_UEAuthentication → (NSSAAF-like relay) → AAA (EAP-AKA′/TLS).',
    desc_zh: '经 Credentials Holder AAA 服务器主鉴权 → Nausf_UEAuthentication →(类 NSSAAF 中继)→ AAA(EAP-AKA′/TLS)。',
    ref: 'TS 33.501 §I (SNPN CH via AAA)', cause: 'SNPN CH AAA primary auth', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'NSSAAF' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: 'CH AAA 경유 1차 인증(EAP-AKA′/TLS)' },
    ],
    expect: () => ({ label_ko: 'SNPN CH AAA 1차 인증 성공', label_en: 'SNPN CH AAA primary auth OK' }),
  },
  {
    id: 'snpn-ch-ausf-udm',
    ko: 'SNPN CH AUSF/UDM 1차 인증', en: 'SNPN CH AUSF/UDM primary auth', zh: 'SNPN CH AUSF/UDM 主鉴权',
    desc_ko: '방문 SNPN(zone C) RU/AMF/SMF/UPF + CH(zone A) AUSF/UDM → CH의 AUSF/UDM으로 1차 인증.',
    desc_en: 'Visited SNPN (zone C) RU/AMF/SMF/UPF + CH (zone A) AUSF/UDM → primary auth against the CH’s AUSF/UDM.',
    desc_zh: '拜访 SNPN(zone C)RU/AMF/SMF/UPF + CH(zone A)AUSF/UDM → 用 CH 的 AUSF/UDM 主鉴权。',
    ref: 'TS 23.501 §5.30.2.9 (CH AUSF/UDM)', cause: 'SNPN CH AUSF/UDM primary auth', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'ensureNf', zone: 'A', type: 'AUSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '방문 SNPN(C) + CH(A) AUSF/UDM 인증' },
    ],
    expect: (c) => {
      const chAuth = ['AUSF', 'UDM'].every((t) => c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === (t as NfType) && n.enabled))
      const e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'C')
      const localOk = !e.missing.includes('RU') && !e.missing.includes('AMF') && !e.missing.includes('SMF') && !e.missing.includes('UPF')
      return chAuth && localOk
        ? { label_ko: 'SNPN CH AUSF/UDM 인증 성공', label_en: 'SNPN CH AUSF/UDM auth OK' }
        : { label_ko: `불가: ${!chAuth ? 'CH AUSF/UDM 부족' : 'SNPN 로컬 NF 부족'}`, label_en: `fail: ${!chAuth ? 'CH AUSF/UDM missing' : 'SNPN local NF missing'}` }
    },
  },
  {
    id: 'snpn-ch-auth-fail',
    ko: 'SNPN CH 인증 실패 (EAP-Failure)', en: 'SNPN CH auth fail (EAP-Failure)', zh: 'SNPN CH 鉴权失败 (EAP-Failure)',
    desc_ko: 'CH(zone A) AUSF/UDM 부재 → 1차 인증 불가 → EAP-Failure → SNPN 등록 실패.',
    desc_en: 'CH (zone A) AUSF/UDM absent → primary auth impossible → EAP-Failure → SNPN registration fails.',
    desc_zh: 'CH(zone A)AUSF/UDM 缺失 → 无法主鉴权 → EAP-Failure → SNPN 注册失败。',
    ref: 'TS 33.501 §I (CH auth) · EAP-Failure', cause: 'EAP-Failure (CH auth)', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' },
      { op: 'removeNf', zone: 'A', type: 'AUSF' }, { op: 'removeNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'CH AUSF/UDM 제거 → EAP-Failure' },
    ],
    expect: (c) => {
      const chAuth = ['AUSF', 'UDM'].some((t) => c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === (t as NfType) && n.enabled))
      return !chAuth
        ? { label_ko: 'SNPN CH 인증 실패 (EAP-Failure)', label_en: 'SNPN CH auth fail (EAP-Failure)' }
        : { label_ko: '예상과 다름 (CH 인증 존재)', label_en: 'unexpected (CH auth present)' }
    },
  },
  {
    id: 'snpn-gin-selection',
    ko: 'GIN 기반 SNPN 선택 (Rel-17)', en: 'GIN-based SNPN selection (Rel-17)', zh: '基于 GIN 的 SNPN 选择 (Rel-17)',
    desc_ko: '브로드캐스트 GIN(Group ID for Network selection)을 UE credential과 매칭하여 SNPN 선택(Rel-17).',
    desc_en: 'Broadcast GIN (Group ID for Network selection) matched against UE credentials to select the SNPN (Rel-17).',
    desc_zh: '将广播 GIN(Group ID for Network selection)与 UE 凭据匹配以选择 SNPN(Rel-17)。',
    ref: 'TS 23.501 §5.30.2 (GIN, Rel-17)', cause: 'GIN-based SNPN selection', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'UDM' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: '브로드캐스트 GIN 매칭 → SNPN 선택' },
    ],
    expect: () => ({ label_ko: 'GIN 기반 SNPN 선택 성공', label_en: 'GIN-based SNPN selection OK' }),
  },
  {
    id: 'snpn-onboarding-ok',
    ko: 'SNPN 온보딩 전체 성공', en: 'SNPN onboarding full success', zh: 'SNPN 引导全流程成功',
    desc_ko: 'ON-SNPN 등록 → PVS로 PDU → SO-SNPN credential 프로비저닝 → dereg → SO-SNPN 재등록(ONN→PVS→SO-SNPN).',
    desc_en: 'ON-SNPN registration → PDU to PVS → SO-SNPN credentials provisioned → dereg → re-register at SO-SNPN (ONN→PVS→SO-SNPN).',
    desc_zh: 'ON-SNPN 注册 → 到 PVS 的 PDU → 开通 SO-SNPN 凭据 → 去注册 → 在 SO-SNPN 重注册(ONN→PVS→SO-SNPN)。',
    ref: 'TS 23.501 §5.30.2.10 (SNPN onboarding)', cause: 'SNPN onboarding (ONN→PVS→SO-SNPN)', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'AUSF' }, { op: 'ensureNf', zone: 'C', type: 'UDM' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: 'ONN 셀 + DN=PVS → 온보딩 → SO-SNPN 재등록' },
    ],
    expect: () => ({ label_ko: 'SNPN 온보딩 성공 (SO-SNPN 재등록)', label_en: 'SNPN onboarding OK (re-register at SO-SNPN)' }),
  },
  {
    id: 'snpn-onboarding-no-cell',
    ko: '온보딩 셀 부재', en: 'No onboarding cell', zh: '无引导小区',
    desc_ko: 'SIB1 onboarding indication off → ONN(onboarding network) 미발견 → 온보딩 실패.',
    desc_en: 'SIB1 onboarding indication off → no ONN (onboarding network) found → onboarding fails.',
    desc_zh: 'SIB1 onboarding indication 关闭 → 未找到 ONN(引导网络)→ 引导失败。',
    ref: 'TS 23.501 §5.30.2.10 · TS 38.331 (onboarding SIB)', cause: 'no ONN found → onboarding fail', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' },
      { op: 'note', text: 'SIB1 onboarding off → ONN 미발견 → 온보딩 실패' },
    ],
    expect: () => ({ label_ko: '온보딩 셀 부재 → 온보딩 실패', label_en: 'no onboarding cell → onboarding fail' }),
  },
  {
    id: 'snpn-onboarding-reject',
    ko: '온보딩 서비스 거절 (#74/#75)', en: 'Onboarding service reject (#74/#75)', zh: '引导业务拒绝 (#74/#75)',
    desc_ko: 'onboarding services not authorized for this SNPN → Registration Reject 5GMM #74/#75.',
    desc_en: 'Onboarding services not authorized for this SNPN → Registration Reject 5GMM #74/#75.',
    desc_zh: '该 SNPN 未授权引导业务 → Registration Reject 5GMM #74/#75。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #74/#75 (onboarding)', cause: '5GMM #74/#75 (onboarding not authorized)', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' },
      { op: 'note', text: 'onboarding services 미인가 → #74/#75' },
    ],
    expect: () => ({ label_ko: '온보딩 거절 #74/#75', label_en: 'onboarding reject #74/#75' }),
  },
  {
    id: 'snpn-onboarding-no-pvs',
    ko: '온보딩 PVS 미확보', en: 'Onboarding no PVS', zh: '引导无 PVS',
    desc_ko: 'PVS 주소 미확보(SMF/PCF 미제공·미사전구성) → 프로비저닝 실패, 온보딩 PDU 해제.',
    desc_en: 'PVS address not obtained (not provided by SMF/PCF, not pre-configured) → provisioning fails, onboarding PDU released.',
    desc_zh: '未获取 PVS 地址(SMF/PCF 未提供且未预配)→ 开通失败,释放引导 PDU。',
    ref: 'TS 23.501 §5.30.2.10 (PVS address)', cause: 'PVS address not available → provisioning fail', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: false },
      { op: 'note', text: 'PVS 주소 미확보 → 프로비저닝 실패' },
    ],
    expect: () => ({ label_ko: 'PVS 미확보 → 온보딩 프로비저닝 실패', label_en: 'no PVS → onboarding provisioning fail' }),
  },
  {
    id: 'snpn-via-plmn-n3iwf',
    ko: 'PLMN 경유 SNPN (N3IWF in SNPN)', en: 'SNPN via PLMN (N3IWF in SNPN)', zh: '经 PLMN 访问 SNPN (SNPN 内 N3IWF)',
    desc_ko: 'PLMN(zone A) underlay E2E + SNPN(zone C) N3IWF/AMF/SMF/UPF → PLMN 경유 SNPN 서비스 접속.',
    desc_en: 'PLMN (zone A) underlay E2E + SNPN (zone C) N3IWF/AMF/SMF/UPF → access SNPN services via PLMN.',
    desc_zh: 'PLMN(zone A)underlay E2E + SNPN(zone C)N3IWF/AMF/SMF/UPF → 经 PLMN 访问 SNPN 业务。',
    ref: 'TS 23.501 §5.30.2.8 (SNPN via PLMN, N3IWF)', cause: 'SNPN via PLMN (N3IWF in SNPN)', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'C', type: 'N3IWF' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'note', text: 'PLMN(A) underlay + SNPN(C) N3IWF' },
    ],
    expect: (c) => {
      const under = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A').ok
      const snpnN3 = c.coreNfs.some((n) => n.zone === 'C' && n.nf_type === 'N3IWF' && n.enabled)
      return under && snpnN3
        ? { label_ko: 'PLMN 경유 SNPN 접속 성공', label_en: 'SNPN via PLMN OK' }
        : { label_ko: `불가: ${!under ? 'PLMN underlay 부족' : 'SNPN N3IWF 부족'}`, label_en: `fail: ${!under ? 'PLMN underlay missing' : 'SNPN N3IWF missing'}` }
    },
  },
  {
    id: 'plmn-via-snpn-n3iwf',
    ko: 'SNPN 경유 PLMN (N3IWF in PLMN)', en: 'PLMN via SNPN (N3IWF in PLMN)', zh: '经 SNPN 访问 PLMN (PLMN 内 N3IWF)',
    desc_ko: 'SNPN(zone C) underlay E2E + PLMN(zone A) N3IWF/코어 → SNPN 경유 PLMN 서비스 접속.',
    desc_en: 'SNPN (zone C) underlay E2E + PLMN (zone A) N3IWF/core → access PLMN services via SNPN.',
    desc_zh: 'SNPN(zone C)underlay E2E + PLMN(zone A)N3IWF/核心 → 经 SNPN 访问 PLMN 业务。',
    ref: 'TS 23.501 §5.30.2.8 (PLMN via SNPN, N3IWF)', cause: 'PLMN via SNPN (N3IWF in PLMN)', domain: 'snpn', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'C' }, { op: 'ensureNf', zone: 'C', type: 'AMF' }, { op: 'ensureNf', zone: 'C', type: 'SMF' }, { op: 'ensureNf', zone: 'C', type: 'UPF' }, { op: 'setDn', zone: 'C', on: true },
      { op: 'ensureNf', zone: 'A', type: 'N3IWF' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'note', text: 'SNPN(C) underlay + PLMN(A) N3IWF' },
    ],
    expect: (c) => {
      const under = computeE2E(c.objects, c.coreNfs, c.coreDn, 'C').ok
      const plmnN3 = c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === 'N3IWF' && n.enabled)
      return under && plmnN3
        ? { label_ko: 'SNPN 경유 PLMN 접속 성공', label_en: 'PLMN via SNPN OK' }
        : { label_ko: `불가: ${!under ? 'SNPN underlay 부족' : 'PLMN N3IWF 부족'}`, label_en: `fail: ${!under ? 'SNPN underlay missing' : 'PLMN N3IWF missing'}` }
    },
  },
  {
    id: 'n3iwf-select-fail',
    ko: 'N3IWF 선택 실패 (DNS)', en: 'N3IWF selection fail (DNS)', zh: 'N3IWF 选择失败 (DNS)',
    desc_ko: 'N3IWF FQDN DNS 미등록/부재 → non-3GPP 등록 불가.',
    desc_en: 'N3IWF FQDN not in DNS / absent → non-3GPP registration impossible.',
    desc_zh: 'N3IWF FQDN 未在 DNS 注册/缺失 → 无法进行 non-3GPP 注册。',
    ref: 'TS 23.501 §6.3.6 (N3IWF selection/DNS)', cause: 'N3IWF selection failure (FQDN/DNS)', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'removeNf', zone: 'A', type: 'N3IWF' },
      { op: 'note', text: 'N3IWF FQDN DNS 미등록 → non-3GPP 등록 불가' },
    ],
    expect: () => ({ label_ko: 'N3IWF 선택 실패 (FQDN/DNS)', label_en: 'N3IWF selection failure (FQDN/DNS)' }),
  },
  {
    id: 'wireline-not-allowed-77',
    ko: '유선 액세스 불허 #77', en: 'Wireline access not allowed #77', zh: '有线接入不允许 #77',
    desc_ko: '5G-RG/FN-CRG의 W-AGF 경유 유선 액세스 구역 불허 → 5GMM #77 wireline access area not allowed.',
    desc_en: '5G-RG/FN-CRG wireline access area not allowed (behind W-AGF) → 5GMM #77 wireline access area not allowed.',
    desc_zh: '5G-RG/FN-CRG 经 W-AGF 的有线接入区不允许 → 5GMM #77 wireline access area not allowed。',
    ref: 'TS 24.501 §5.5.1.2.5 · 5GMM #77 (wireline)', cause: '5GMM #77 wireline access area not allowed', domain: 'snpn', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' },
      { op: 'note', text: '5G-RG/FN-CRG(W-AGF) 유선 액세스 구역 불허 → #77' },
    ],
    expect: () => ({ label_ko: 'Registration Reject #77 (wireline)', label_en: 'Registration Reject #77 (wireline)' }),
  },

  // ════════ BULK D — SMS / 부가서비스 (MMTEL/T-ADS) 추가 ════════
  {
    id: 'sms-nas-reg-ok',
    ko: 'SMS over NAS 활성 성공', en: 'SMS over NAS activation OK', zh: 'SMS over NAS 激活成功',
    desc_ko: 'Registration(SMS over NAS supported) → AMF Nsmsf_SMService_Activate → SMSF(Nudm_UECM) → Registration Accept(SMS allowed=true).',
    desc_en: 'Registration (SMS over NAS supported) → AMF Nsmsf_SMService_Activate → SMSF (Nudm_UECM) → Registration Accept (SMS allowed=true).',
    desc_zh: 'Registration(支持 SMS over NAS)→ AMF Nsmsf_SMService_Activate → SMSF(Nudm_UECM)→ Registration Accept(SMS allowed=true)。',
    ref: 'TS 23.502 §4.13.3 (SMS over NAS) · SMSF', cause: 'SMS over NAS activated (SMS allowed=true)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' },
      { op: 'note', text: 'SMSF 존재 → SMS over NAS 활성(SMS allowed=true)' },
    ],
    expect: (c) => {
      const has = c.coreNfs.some((n) => n.zone === 'A' && n.nf_type === 'SMSF' && n.enabled)
      return has ? { label_ko: 'SMS over NAS 활성 성공', label_en: 'SMS over NAS activated' } : { label_ko: 'SMSF 없음 → SMS over NAS 불가', label_en: 'no SMSF → SMS over NAS fail' }
    },
  },
  {
    id: 'sms-no-subscription',
    ko: 'SMS 활성 거절 (미가입)', en: 'SMS activation reject (no subscription)', zh: 'SMS 激活拒绝 (未签约)',
    desc_ko: 'SMSF: Nudm_SDM_Get SMS subscription not found → SMS allowed=false (Nsmsf activate 실패).',
    desc_en: 'SMSF: Nudm_SDM_Get SMS subscription not found → SMS allowed=false (Nsmsf activate failure).',
    desc_zh: 'SMSF:Nudm_SDM_Get SMS subscription not found → SMS allowed=false(Nsmsf 激活失败)。',
    ref: 'TS 23.502 §4.13.3 (SMS subscription)', cause: 'SMS subscription not found → SMS allowed=false', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' },
      { op: 'note', text: 'SMS subscription 없음 → SMS allowed=false' },
    ],
    expect: () => ({ label_ko: 'SMS 미가입 → SMS allowed=false', label_en: 'no SMS subscription → SMS allowed=false' }),
  },
  {
    id: 'sms-mo-nas-ok',
    ko: 'MO-SMS over NAS 성공', en: 'MO-SMS over NAS success', zh: 'MO-SMS over NAS 成功',
    desc_ko: 'UL NAS Transport(CP-DATA/RP-DATA) → AMF → Nsmsf_SMService_UplinkSMS → SMSF → SMSC → CP-ACK/RP-ACK.',
    desc_en: 'UL NAS Transport (CP-DATA/RP-DATA) → AMF → Nsmsf_SMService_UplinkSMS → SMSF → SMSC → CP-ACK/RP-ACK.',
    desc_zh: 'UL NAS Transport(CP-DATA/RP-DATA)→ AMF → Nsmsf_SMService_UplinkSMS → SMSF → SMSC → CP-ACK/RP-ACK。',
    ref: 'TS 24.011 · TS 23.502 §4.13.3.2 (MO-SMS)', cause: 'MO-SMS over NAS (RP-ACK)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' },
      { op: 'note', text: 'MO-SMS: UL NAS Transport → SMSF → SMSC → RP-ACK' },
    ],
    expect: () => ({ label_ko: 'MO-SMS over NAS 성공 (RP-ACK)', label_en: 'MO-SMS over NAS OK (RP-ACK)' }),
  },
  {
    id: 'sms-mt-nas-paging',
    ko: 'MT-SMS over NAS (페이징)', en: 'MT-SMS over NAS (paging)', zh: 'MT-SMS over NAS (寻呼)',
    desc_ko: 'SMSC → SMSF → Namf_MT_EnableReachability → AMF Paging → UE Service Request → DL NAS Transport(CP-DATA) → RP-ACK.',
    desc_en: 'SMSC → SMSF → Namf_MT_EnableReachability → AMF Paging → UE Service Request → DL NAS Transport(CP-DATA) → RP-ACK.',
    desc_zh: 'SMSC → SMSF → Namf_MT_EnableReachability → AMF 寻呼 → UE Service Request → DL NAS Transport(CP-DATA)→ RP-ACK。',
    ref: 'TS 23.502 §4.13.3.3 (MT-SMS)', cause: 'MT-SMS over NAS with paging (RP-ACK)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' },
      { op: 'note', text: 'MT-SMS: 페이징 → Service Request → DL CP-DATA → RP-ACK' },
    ],
    expect: () => ({ label_ko: 'MT-SMS over NAS 성공 (페이징)', label_en: 'MT-SMS over NAS OK (paging)' }),
  },
  {
    id: 'sms-mt-paging-fail',
    ko: 'MT-SMS 페이징 실패', en: 'MT-SMS paging failure', zh: 'MT-SMS 寻呼失败',
    desc_ko: '착신 UE 무선상태 없음 → Paging no response → AbsentSubscriberSM, MNRF set at UDM/HSS.',
    desc_en: 'Callee has no radio state → Paging no response → AbsentSubscriberSM, MNRF set at UDM/HSS.',
    desc_zh: '被叫无无线状态 → 寻呼无响应 → AbsentSubscriberSM,UDM/HSS 置 MNRF。',
    ref: 'TS 23.502 · TS 29.503 (MNRF/AbsentSubscriberSM)', cause: 'MT-SMS paging fail → AbsentSubscriberSM (MNRF)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '착신 UE 무선상태 없음 → AbsentSubscriberSM, MNRF' },
    ],
    expect: () => ({ label_ko: 'MT-SMS 페이징 실패 → MNRF set', label_en: 'MT-SMS paging fail → MNRF set' }),
  },
  {
    id: 'sms-memory-full',
    ko: 'MT-SMS 단말 메모리 초과', en: 'MT-SMS UE memory full', zh: 'MT-SMS 终端存储满',
    desc_ko: '착신 UE 메모리 초과 → RP-ERROR cause 22 (Memory capacity exceeded) → MCEF set at UDM.',
    desc_en: 'Callee UE memory full → RP-ERROR cause 22 (Memory capacity exceeded) → MCEF set at UDM.',
    desc_zh: '被叫 UE 存储满 → RP-ERROR cause 22(Memory capacity exceeded)→ UDM 置 MCEF。',
    ref: 'TS 24.011 (RP cause 22) · TS 29.503 (MCEF)', cause: 'RP-ERROR 22 (memory full) → MCEF', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: '단말 메모리 초과 → RP-ERROR 22 → MCEF' },
    ],
    expect: () => ({ label_ko: 'RP-ERROR 22 (메모리 초과) → MCEF', label_en: 'RP-ERROR 22 (memory full) → MCEF' }),
  },
  {
    id: 'sms-odb',
    ko: 'MO-SMS ODB 차단', en: 'MO-SMS barred by ODB', zh: 'MO-SMS 被 ODB 阻断',
    desc_ko: 'UDM ODB 플래그 → MO-SMS 거절 RP cause 8 (Operator determined barring).',
    desc_en: 'UDM ODB flag → MO-SMS rejected RP cause 8 (Operator determined barring).',
    desc_zh: 'UDM ODB 标志 → MO-SMS 拒绝 RP cause 8(Operator determined barring)。',
    ref: 'TS 23.015 ODB · TS 24.011 (RP cause 8)', cause: 'RP cause 8 (ODB)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' }, { op: 'ensureNf', zone: 'A', type: 'UDM' },
      { op: 'note', text: 'UDM ODB → MO-SMS RP cause 8' },
    ],
    expect: () => ({ label_ko: 'MO-SMS ODB 차단 (RP cause 8)', label_en: 'MO-SMS barred by ODB (RP cause 8)' }),
  },
  {
    id: 'sms-mo-ip-ok',
    ko: 'MO SMS over IP 성공', en: 'MO SMS over IP success', zh: 'MO SMS over IP 成功',
    desc_ko: 'SIP MESSAGE(RP-DATA in body) → P/S-CSCF → IMS-AS(IP-SM-GW) → SMSC → 202 Accepted → 후속 MESSAGE(RP-ACK).',
    desc_en: 'SIP MESSAGE (RP-DATA in body) → P/S-CSCF → IMS-AS(IP-SM-GW) → SMSC → 202 Accepted → later MESSAGE(RP-ACK).',
    desc_zh: 'SIP MESSAGE(RP-DATA in body)→ P/S-CSCF → IMS-AS(IP-SM-GW)→ SMSC → 202 Accepted → 后续 MESSAGE(RP-ACK)。',
    ref: 'TS 24.341 (SMSoIP, IP-SM-GW)', cause: 'SMSoIP MO (202 + RP-ACK)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: 'SMSoIP MO: SIP MESSAGE → IP-SM-GW → SMSC' },
    ],
    expect: () => ({ label_ko: 'MO SMSoIP 성공 (202 → RP-ACK)', label_en: 'MO SMSoIP OK (202 → RP-ACK)' }),
  },
  {
    id: 'sms-mo-ip-202-trap',
    ko: 'SMSoIP 202 함정 (전달 아님)', en: 'SMSoIP 202 trap (not delivery)', zh: 'SMSoIP 202 陷阱 (非送达)',
    desc_ko: '202 Accepted는 전송 ack일 뿐 전달 확인 아님 → 이후 MESSAGE(RP-ERROR cause 41)로 실패 통지 가능.',
    desc_en: '202 Accepted is only a transport ack, NOT delivery confirmation → a later MESSAGE(RP-ERROR cause 41) can signal failure.',
    desc_zh: '202 Accepted 仅是传输 ack,不是送达确认 → 之后可用 MESSAGE(RP-ERROR cause 41)通知失败。',
    ref: 'TS 24.341 (202 vs RP-ACK trap)', cause: 'SMSoIP 202 ≠ delivery → RP-ERROR 41', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '202 Accepted = 전송 ack만 → 이후 RP-ERROR 41 가능' },
    ],
    expect: () => ({ label_ko: '202 ≠ 전달 확인 → RP-ERROR 41', label_en: '202 ≠ delivery → RP-ERROR 41' }),
  },
  {
    id: 'sms-domain-selection',
    ko: 'IP-SM-GW 도메인 선택', en: 'IP-SM-GW domain selection', zh: 'IP-SM-GW 域选择',
    desc_ko: 'IMS leg 480/408 → IP-SM-GW가 PS(SMSF/NAS) 또는 CS(MSC)로 재라우팅하여 전달.',
    desc_en: 'IMS leg 480/408 → IP-SM-GW re-routes via PS (SMSF/NAS) or CS (MSC) to deliver.',
    desc_zh: 'IMS 分支 480/408 → IP-SM-GW 经 PS(SMSF/NAS)或 CS(MSC)重路由送达。',
    ref: 'TS 24.341 (IP-SM-GW domain selection)', cause: 'IMS→PS/CS SMS domain selection', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' }, { op: 'ensureNf', zone: 'A', type: 'SMSF' },
      { op: 'note', text: 'IMS 실패 → IP-SM-GW PS/CS 재라우팅' },
    ],
    expect: () => ({ label_ko: 'IMS→PS/CS 도메인 선택 전달', label_en: 'IMS→PS/CS domain selection delivery' }),
  },
  {
    id: 'ss-cfu',
    ko: 'CFU 무조건 착신전환', en: 'CFU (unconditional forwarding)', zh: 'CFU 无条件前转',
    desc_ko: '착신자 CFU 설정 → IMS-AS(TAS): CDIV CFU → 181 Call Is Being Forwarded → 전환 대상에 INVITE.',
    desc_en: 'Callee has CFU → IMS-AS(TAS): CDIV CFU → 181 Call Is Being Forwarded → INVITE to forward target.',
    desc_zh: '被叫设置 CFU → IMS-AS(TAS):CDIV CFU → 181 Call Is Being Forwarded → 向前转目标 INVITE。',
    ref: 'TS 24.604 (CDIV CFU)', cause: 'CDIV CFU (181 → forward)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: 'TAS CFU → 181 → 전환 대상 INVITE' },
    ],
    expect: () => ({ label_ko: 'CFU → 181 → 전환 성공', label_en: 'CFU → 181 → forwarded' }),
  },
  {
    id: 'ss-cfnry',
    ko: 'CFNRy 무응답 착신전환', en: 'CFNRy (no reply forwarding)', zh: 'CFNRy 无应答前转',
    desc_ko: '착신자 무응답(no-reply timer, 기본 20s) → CFNRy timer 만료 → 181 → CDIV 전환.',
    desc_en: 'Callee no answer (no-reply timer, default 20s) → CFNRy timer expiry → 181 → CDIV forward.',
    desc_zh: '被叫无应答(no-reply 定时器,默认 20s)→ CFNRy 到期 → 181 → CDIV 前转。',
    ref: 'TS 24.604 (CDIV CFNRy)', cause: 'CDIV CFNRy (timer → forward)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '무응답 → CFNRy timer 만료 → 181 → 전환' },
    ],
    expect: () => ({ label_ko: 'CFNRy 타이머 → 181 → 전환', label_en: 'CFNRy timer → 181 → forward' }),
  },
  {
    id: 'ss-cfb',
    ko: 'CFB 통화중 착신전환', en: 'CFB (busy forwarding)', zh: 'CFB 遇忙前转',
    desc_ko: '착신자 통화중(NDUB) → 486 Busy Here → CFB 설정 시 TAS: CDIV CFB → 181 → 전환.',
    desc_en: 'Callee busy (NDUB) → 486 Busy Here → if CFB configured, TAS: CDIV CFB → 181 → forward.',
    desc_zh: '被叫忙(NDUB)→ 486 Busy Here → 若配置 CFB,TAS:CDIV CFB → 181 → 前转。',
    ref: 'TS 24.604 (CDIV CFB, NDUB)', cause: 'CDIV CFB (486 → forward)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '착신 통화중 → 486 → CFB → 181 → 전환' },
    ],
    expect: () => ({ label_ko: 'CFB (486 NDUB) → 전환', label_en: 'CFB (486 NDUB) → forward' }),
  },
  {
    id: 'ss-cfnrc',
    ko: 'CFNRc 도달불가 착신전환', en: 'CFNRc (not-reachable forwarding)', zh: 'CFNRc 不可达前转',
    desc_ko: '착신자 도달불가(E2E 실패/무선 상실) → 480 → CFNRc 설정 시 TAS: CDIV CFNRc → 181 → 전환.',
    desc_en: 'Callee not reachable (E2E fail/out of coverage) → 480 → if CFNRc configured, TAS: CDIV CFNRc → 181 → forward.',
    desc_zh: '被叫不可达(E2E 失败/失去覆盖)→ 480 → 若配置 CFNRc,TAS:CDIV CFNRc → 181 → 前转。',
    ref: 'TS 24.604 (CDIV CFNRc)', cause: 'CDIV CFNRc (480 → forward)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '착신 도달불가 → 480 → CFNRc → 181 → 전환' },
    ],
    expect: () => ({ label_ko: 'CFNRc (480) → 전환', label_en: 'CFNRc (480) → forward' }),
  },
  {
    id: 'ss-cdiv-loop',
    ko: 'CDIV 루프 (전환 초과)', en: 'CDIV loop (max diversion)', zh: 'CDIV 循环 (超转接上限)',
    desc_ko: '두 가입자가 상호 전환 → History-Info 전환 카운트 > 운용자 한도(보통 5) → 480/486, 루프 탐지.',
    desc_en: 'Two subscribers forward to each other → History-Info diversion count > operator limit (typ. 5) → 480/486, loop detected.',
    desc_zh: '两用户互相前转 → History-Info 转接计数 > 运营商上限(通常 5)→ 480/486,检测到循环。',
    ref: 'TS 24.604 (CDIV counter/History-Info)', cause: 'CDIV count > limit → loop (480/486)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '상호 전환 → History-Info 전환 초과 → 루프 탐지' },
    ],
    expect: () => ({ label_ko: 'CDIV 전환 초과 → 루프(480/486)', label_en: 'CDIV count exceeded → loop (480/486)' }),
  },
  {
    id: 'ss-conference',
    ko: '즉석 회의(Ad-hoc conference)', en: 'Ad-hoc conference', zh: '临时会议',
    desc_ko: 'INVITE conference-factory@ims → IMS-AS(MRF) focus URI 생성 → REFER로 참가자 초대 → MGW/MRF mixer.',
    desc_en: 'INVITE conference-factory@ims → IMS-AS(MRF) creates focus URI → REFER participants → mixer at MGW/MRF.',
    desc_zh: 'INVITE conference-factory@ims → IMS-AS(MRF)创建 focus URI → REFER 邀请参与者 → MGW/MRF 混音。',
    ref: 'TS 24.147 (conference) · MRF', cause: 'ad-hoc conference (focus URI/REFER)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' }, { op: 'ensureNf', zone: 'A', type: 'MGW' },
      { op: 'note', text: 'conference-factory → focus URI → REFER 참가' },
    ],
    expect: () => ({ label_ko: '회의 생성 성공 (focus URI)', label_en: 'conference created (focus URI)' }),
  },
  {
    id: 'ss-call-waiting',
    ko: '착신중 통화대기(CW)', en: 'Call waiting (CW)', zh: '呼叫等待 (CW)',
    desc_ko: '착신자 통화중 + CW 활성 → 180 Ringing + Alert-Info(call waiting tone), 통화중 UE에 대기호 표시.',
    desc_en: 'Callee busy + CW enabled → 180 Ringing + Alert-Info (call waiting tone), waiting-call indication to the busy UE.',
    desc_zh: '被叫忙 + CW 启用 → 180 Ringing + Alert-Info(呼叫等待音),向忙碌 UE 显示等待呼叫。',
    ref: 'TS 24.615 (Communication Waiting)', cause: 'Call Waiting (180 + Alert-Info)', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '착신 통화중 + CW → 180 + Alert-Info 대기호' },
    ],
    expect: () => ({ label_ko: 'Call Waiting 표시 (180+Alert-Info)', label_en: 'Call Waiting indication (180+Alert-Info)' }),
  },
  {
    id: 'ss-oir-acr',
    ko: 'ACR 익명호 거절 (433)', en: 'ACR anonymous reject (433)', zh: 'ACR 匿名拒绝 (433)',
    desc_ko: '착신 ACR 활성 + 발신 OIR/anonymous → TAS: ACR → 433 Anonymity Disallowed.',
    desc_en: 'Callee ACR enabled + caller OIR/anonymous → TAS: ACR → 433 Anonymity Disallowed.',
    desc_zh: '被叫启用 ACR + 主叫 OIR/匿名 → TAS:ACR → 433 Anonymity Disallowed。',
    ref: 'TS 24.607 (OIR) · RFC 5079 (433)', cause: 'SIP 433 Anonymity Disallowed (ACR)', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '착신 ACR + 발신 익명 → 433 Anonymity Disallowed' },
    ],
    expect: () => ({ label_ko: 'ACR → 433 Anonymity Disallowed', label_en: 'ACR → 433 Anonymity Disallowed' }),
  },
  {
    id: 'ss-icb',
    ko: 'ICB 착신 차단 (603)', en: 'ICB incoming barring (603)', zh: 'ICB 来话阻挡 (603)',
    desc_ko: '착신자 ICB rule 매치(예: 국제 차단) → TAS: ICB → 603 Decline(벨 울리기 전).',
    desc_en: 'Callee ICB rule match (e.g. bar international) → TAS: ICB → 603 Decline (before ringing).',
    desc_zh: '被叫 ICB 规则匹配(如阻挡国际)→ TAS:ICB → 603 Decline(振铃前)。',
    ref: 'TS 24.611 (ICB)', cause: 'ICB → 603 Decline', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '착신 ICB rule 매치 → 603 Decline' },
    ],
    expect: () => ({ label_ko: 'ICB → 603 Decline', label_en: 'ICB → 603 Decline' }),
  },
  {
    id: 'ss-ocb-international',
    ko: 'OCB 국제발신 차단 (603)', en: 'OCB international bar (603)', zh: 'OCB 国际去话阻挡 (603)',
    desc_ko: '발신자 OCB(international) + interPlmn → 발신 S-CSCF에서 SEPP/IPX leg 이전 TAS: OCB → 603 Decline.',
    desc_en: 'Caller OCB (international) + interPlmn → TAS: OCB → 603 Decline at originating S-CSCF, before the SEPP/IPX leg.',
    desc_zh: '主叫 OCB(international)+ interPlmn → 在主叫 S-CSCF、SEPP/IPX 分支之前 TAS:OCB → 603 Decline。',
    ref: 'TS 24.611 (OCB)', cause: 'OCB international → 603 Decline', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'IMS-AS' },
      { op: 'note', text: '발신 OCB(international) → 603 Decline' },
    ],
    expect: () => ({ label_ko: 'OCB 국제발신 → 603 Decline', label_en: 'OCB international → 603 Decline' }),
  },
  {
    id: 'tads-ps-selected',
    ko: 'T-ADS PS/IMS 선택', en: 'T-ADS PS/IMS selected', zh: 'T-ADS 选择 PS/IMS',
    desc_ko: 'SCC-AS: Nudm UE-reachability + VoPS 지원 조회 → 착신 존에 E2E+IMS 있으면 PS(IMS) 선택.',
    desc_en: 'SCC-AS: Nudm UE-reachability + VoPS support query → PS(IMS) selected when callee zone has E2E+IMS.',
    desc_zh: 'SCC-AS:Nudm UE-reachability + VoPS 支持查询 → 被叫区有 E2E+IMS 时选择 PS(IMS)。',
    ref: 'TS 23.292/23.237 (T-ADS)', cause: 'T-ADS PS/IMS selected', domain: 'vonr', category: 'success',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'SMF' }, { op: 'ensureNf', zone: 'A', type: 'UPF' }, { op: 'setDn', zone: 'A', on: true },
      { op: 'ensureNf', zone: 'A', type: 'P-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'I-CSCF' }, { op: 'ensureNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'T-ADS: VoPS 지원 → PS(IMS) 선택' },
    ],
    expect: (c) => {
      const ims = computeIms(c.coreNfs, 'A')
      const e2e = computeE2E(c.objects, c.coreNfs, c.coreDn, 'A')
      return ims.ok && e2e.ok
        ? { label_ko: 'T-ADS → PS/IMS 선택', label_en: 'T-ADS → PS/IMS selected' }
        : { label_ko: 'VoPS 미충족 → PS 선택 불가', label_en: 'no VoPS → PS not selectable' }
    },
  },
  {
    id: 'tads-cs-breakout',
    ko: 'T-ADS CS breakout (VoPS 없음)', en: 'T-ADS CS breakout (no VoPS)', zh: 'T-ADS CS 疏导 (无 VoPS)',
    desc_ko: '착신 존 IMS/VoPS 부재 + MME/HSS 존재 → T-ADS: no VoPS → CS breakout via MGCF/MGW(CSRN 라우팅).',
    desc_en: 'Callee zone lacks IMS/VoPS but has MME/HSS → T-ADS: no VoPS → CS breakout via MGCF/MGW (CSRN routing).',
    desc_zh: '被叫区无 IMS/VoPS 但有 MME/HSS → T-ADS:no VoPS → 经 MGCF/MGW 的 CS 疏导(CSRN 路由)。',
    ref: 'TS 23.292 (T-ADS CS breakout, CSRN)', cause: 'T-ADS no VoPS → CS breakout', domain: 'vonr', category: 'failure',
    setup: [
      { op: 'ensureRU', zone: 'A' }, { op: 'ensureNf', zone: 'A', type: 'AMF' }, { op: 'ensureNf', zone: 'A', type: 'MME' }, { op: 'ensureNf', zone: 'A', type: 'HSS' }, { op: 'ensureNf', zone: 'A', type: 'MGW' }, { op: 'removeNf', zone: 'A', type: 'S-CSCF' },
      { op: 'note', text: 'IMS/VoPS 없음 + MME/HSS → CS breakout(CSRN)' },
    ],
    expect: () => ({ label_ko: 'T-ADS → CS breakout (no VoPS)', label_en: 'T-ADS → CS breakout (no VoPS)' }),
  },
]

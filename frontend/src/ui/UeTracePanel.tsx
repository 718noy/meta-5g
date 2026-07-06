// SECTION T: UE 콜플로우 추적 — 선택한 한 UE(IMSI)가 유발한 모든 시그널링 메시지를
// 시간순으로 모아 sender→receiver 래더(sequence view)로 표시.
// UE↔RAN 뿐 아니라 그 UE 때문에 발생한 NF↔NF 시그널링(InitialUEMessage, AUSF/UDM 인증,
// NSSF 슬라이스, PCF 정책, SMF↔UPF N4, UPF→DN, 측위 LPP/NRPPa, VoNR SIP 등)까지 포함한다.
import { useMemo, useRef, useState } from 'react'
import { pick } from '../i18n'
import { useStore } from '../store'
import { usePanelDrag } from './panelDrag'
import { frontRef } from './zorder'
import type { LogEvent } from '../store'
import { defaultImsi, objZone } from '../types'

// 걷기(WALK) 단말은 배치된 person 객체가 아니라 SIM(ueSim) 자체로 식별된다.
// traceUe === WALK_UE 일 때 imsi 를 defaultImsi(ueSim) 로 해석해 걷는 단말의 트레이스를 보여준다.
export const WALK_UE = '__walk__'

type PhaseKey =
  | 'reg' | 'pdu' | 'sr' | 'ho' | 'paging' | 'dereg' | 'pos' | 'ims' | 'other'

// 메시지 내용으로 절차 단계(phase)를 추론 — 시각적 구분용. (데이터가 허용하는 범위의 근사)
function phaseOf(msg: string): PhaseKey {
  if (/LPP|NRPPa|MT-LR|Positioning|DetermineLocation|E-CID|TDOA|Multi-RTT|ProvidePositioning|\bLCS\b|GMLC|\bLMF\b|PDOP|multilateration/i.test(msg)) return 'pos'
  if (/SIP|INVITE|\bRTP\b|CSCF|📞|Ringing|CFU|CFB|CFNR|Call Waiting|MMTEL|\bTAS\b|AMR|200 OK|Busy Here|Hold|re-INVITE/i.test(msg)) return 'ims'
  if (/Handover|Measurement Report|Path Switch|Xn |Reestablish|\bMRO\b|reconfigurationWithSync|End Marker/i.test(msg)) return 'ho'
  if (/Paging|Paged|DLDR|N1N2Message|Downlink-Data|DL data/i.test(msg)) return 'paging'
  if (/Deregistration|DEREGISTERED|UEContextRelease|switch-off|powers down|powered OFF|전원 OFF|关机|단말 삭제|UE removed|终端删除/i.test(msg)) return 'dereg'
  if (/Service Request/i.test(msg)) return 'sr'
  if (/PDU Session|PFCP|N4 Session|SMPolicyControl|SM policy|Charging|\bCHF\b|\bDRB\b|GTP-U|Nsmf_PDUSession|UE IP|UE-IP|N6/i.test(msg)) return 'pdu'
  if (/Registration|RRCSetup|RRCReconfiguration|PRACH|Msg[1-4]|Cell search|MIB|SIB|Authentication|Security Mode|NSSAI|Nnssf|AMPolicy|AM policy|SDM|SUCI|RM-REGISTERED|InitialUEMessage|InitialContextSetup|NGAP|ATTACHED|USIM|전원 ON|powered ON|开机|AV|K_|de-conceal/i.test(msg)) return 'reg'
  return 'other'
}

function phaseLabel(lang: 'ko' | 'en' | 'zh', k: PhaseKey): string {
  switch (k) {
    case 'reg': return pick(lang, '등록 / 인증 (Registration)', 'Registration / Auth', '注册 / 鉴权')
    case 'pdu': return pick(lang, 'PDU 세션 (User Plane)', 'PDU Session', 'PDU 会话')
    case 'sr': return pick(lang, '서비스 요청 (Service Request)', 'Service Request', '业务请求')
    case 'ho': return pick(lang, '핸드오버 (Mobility)', 'Handover', '切换')
    case 'paging': return pick(lang, '페이징 (MT)', 'Paging (MT)', '寻呼')
    case 'dereg': return pick(lang, '등록 해제 (Deregistration)', 'Deregistration', '去注册')
    case 'pos': return pick(lang, '측위 (LCS / MT-LR)', 'Positioning (LCS)', '定位')
    case 'ims': return pick(lang, 'VoNR / IMS 통화', 'VoNR / IMS', 'VoNR / IMS')
    default: return pick(lang, '기타', 'Other', '其他')
  }
}

export function UeTracePanel() {
  const show = useStore((s) => s.showUeTrace)
  const setShow = useStore((s) => s.setShowUeTrace)
  const traceUe = useStore((s) => s.traceUe)
  const setTraceUe = useStore((s) => s.setTraceUe)
  const selectedId = useStore((s) => s.selectedId)
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const events = useStore((s) => s.events)
  const personImsi = useStore((s) => s.personImsi)
  const ueSim = useStore((s) => s.ueSim)
  const clearEvents = useStore((s) => s.clearEvents)
  const { dragStyle, headerProps } = usePanelDrag()

  // 패널 폭 — 사용자가 좌측 핸들을 드래그해 조절. 우측 가장자리는 고정.
  const MIN_W = 340
  const [width, setWidth] = useState(540)
  const [left, setLeft] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 좌측 핸들: 우측 가장자리를 고정한 채 left+width 조절.
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = panelRef.current?.getBoundingClientRect()
    const rightEdge = rect ? rect.right : window.innerWidth
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      const maxW = window.innerWidth * 0.8
      const newLeft = Math.max(0, ev.clientX)
      let newW = rightEdge - newLeft
      newW = Math.max(MIN_W, Math.min(maxW, newW))
      setWidth(newW)
      setLeft(rightEdge - newW)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 우측 핸들: 좌측 가장자리를 고정한 채 width만 조절 (오른쪽=넓게, 왼쪽=좁게).
  const onResizeRightStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = panelRef.current?.getBoundingClientRect()
    const leftEdge = rect ? rect.left : 0
    // 현재 left를 고정(잠금)해 드래그 중 좌측 가장자리가 움직이지 않게 한다.
    setLeft(leftEdge)
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      // 80vw와 화면 우측 경계(둘 중 작은 쪽)까지만 넓어지도록 제한.
      const maxW = Math.min(window.innerWidth * 0.8, window.innerWidth - leftEdge)
      let newW = ev.clientX - leftEdge
      newW = Math.max(MIN_W, Math.min(maxW, newW))
      setWidth(newW)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const persons = objects.filter((o) => o.kind === 'person')

  // 걷기 단말 추적 모드 — traceUe 가 WALK 센티넬이면 person 이 아니라 SIM 으로 필터.
  const isWalk = traceUe === WALK_UE

  // 추적 대상: (걷기 단말) → traceUe → (선택된 person) → 첫 person
  const activeId =
    (!isWalk && traceUe && persons.some((p) => p.id === traceUe) && traceUe) ||
    (!isWalk && selectedId && persons.some((p) => p.id === selectedId) && selectedId) ||
    (!isWalk && persons[0]?.id) ||
    null
  const activeObj = persons.find((p) => p.id === activeId) ?? null
  const imsi = isWalk
    ? defaultImsi(ueSim)
    : activeObj ? (personImsi[activeObj.id] ?? defaultImsi(ueSim)) : null

  // 이 UE(IMSI)의 이벤트만, 삽입(시간) 순서 그대로.
  const traced = useMemo(
    () => (imsi ? events.filter((e) => e.imsi === imsi) : []),
    [events, imsi],
  )

  // 등장 액터 집합 (from/to) — 헤더 칩
  const actors = useMemo(() => {
    const set = new Set<string>()
    for (const e of traced) {
      if (e.from) set.add(e.from)
      if (e.to) set.add(e.to)
    }
    return [...set]
  }, [traced])

  if (!show) return null

  const glyph = (e: LogEvent) => (e.dir === 'in' ? '←' : e.dir === 'out' ? '→' : '·')
  let lastPhase: PhaseKey | null = null

  return (
    <div
      className="uetrace panel"
      ref={(el) => { panelRef.current = el; frontRef(el) }}
      style={{ ...dragStyle, width, maxWidth: '80vw', ...(left != null ? { left } : {}) }}
    >
      <div
        className={`uetrace-resize${dragging ? ' dragging' : ''}`}
        onMouseDown={onResizeStart}
        title={pick(lang, '드래그하여 폭 조절', 'Drag to resize width', '拖动调整宽度')}
      />
      <div
        className={`uetrace-resize uetrace-resize-right${dragging ? ' dragging' : ''}`}
        onMouseDown={onResizeRightStart}
        title={pick(lang, '드래그하여 폭 조절', 'Drag to resize width', '拖动调整宽度')}
      />
      <div className="log-head" {...headerProps}>
        <span className="section-label">
          🪜 {pick(lang, 'UE 콜플로우 추적', 'UE Call-Flow Trace', 'UE 呼叫流程追踪')}
        </span>
        {persons.length > 0 && (
          <select
            className="node-filter"
            value={isWalk ? WALK_UE : (activeId ?? '')}
            title={pick(lang, '추적할 측정요원(UE) 선택 — 이 UE의 시그널링만 표시', 'Pick which test UE to trace — shows only its signaling', '选择要追踪的测试人员(UE) — 仅显示该UE的信令')}
            onChange={(e) => setTraceUe(e.target.value)}
          >
            {isWalk && (
              <option value={WALK_UE}>
                {pick(lang, '🚶 걷기 단말 (Walk UE)', '🚶 Walk UE', '🚶 行走终端')}
              </option>
            )}
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · PLMN-{objZone(p)}
              </option>
            ))}
          </select>
        )}
        <button
          className="log-btn uetrace-clear"
          onClick={clearEvents}
          title={pick(lang, '콜플로우 로그 싹 지우기', 'Clear all call-flow logs', '清除全部呼叫流程日志')}
        >
          🗑 {pick(lang, '지우기', 'Clear', '清除')}
        </button>
        <button className="log-btn" onClick={() => setShow(false)} title={pick(lang, '콜플로우 추적 패널 닫기', 'Close call-flow trace panel', '关闭呼叫流程追踪面板')}>✕</button>
      </div>

      {imsi && (
        <div className="uetrace-sub">
          {isWalk && (
            <span className="uetrace-chip" title={pick(lang, '걷기(1인칭) 모드에서 열림 — SIM으로 식별되는 걷는 단말', 'Opened from walk (first-person) mode — the walking UE identified by SIM', '从行走(第一人称)模式打开 — 由SIM标识的行走终端')}>
              🚶 {pick(lang, '걷기 단말 (Walk UE)', 'Walk UE', '行走终端')}
            </span>
          )}
          <span className="log-imsi" title="IMSI">SIM {imsi}</span>
          <span className="uetrace-count">
            {traced.length} {pick(lang, '메시지', 'messages', '消息')}
          </span>
        </div>
      )}

      {actors.length > 0 && (
        <div className="uetrace-actors" title={pick(lang, '관여 액터', 'actors involved', '参与节点')}>
          {actors.map((a) => (
            <span key={a} className="uetrace-chip">{a}</span>
          ))}
        </div>
      )}

      <div className="uetrace-body">
        {traced.length === 0 ? (
          <div className="log-empty">
            {pick(
              lang,
              '이 UE의 시그널링 없음 — 단말 전원을 켜거나(attach) 트래픽/통화를 시작하세요',
              'No signaling for this UE — power it on (attach) or start traffic/call',
              '此 UE 无信令 — 请开机(attach)或发起流量/通话',
            )}
          </div>
        ) : (
          traced.map((e, i) => {
            const ph = phaseOf(e.msg)
            const showPhase = ph !== lastPhase
            lastPhase = ph
            return (
              <div key={e.id}>
                {showPhase && (
                  <div className={`uetrace-phase ph-${ph}`}>{phaseLabel(lang, ph)}</div>
                )}
                <div className={`uetrace-row ${e.level}`}>
                  <span className="uetrace-seq">#{i + 1}</span>
                  <span className={`log-dir ${e.dir ?? ''}`}>{glyph(e)}</span>
                  <span className="uetrace-ft">
                    <span className="uetrace-from">{e.from ?? e.node ?? '·'}</span>
                    <span className="uetrace-to-arrow">→</span>
                    <span className="uetrace-to">{e.to ?? '·'}</span>
                  </span>
                  <span className="uetrace-msg">{e.msg}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

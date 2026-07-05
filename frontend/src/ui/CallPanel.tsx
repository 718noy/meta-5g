// VoNR 통화 패널 — 발신/착신 측정요원 선택, 통화 시작/종료, 실시간 상태.
// 통화 중 경과시간 표시. IMS 미구성 시 실패 사유를 즉시 안내.
import { useEffect, useState } from 'react'
import { pick } from '../i18n'
import { useStore } from '../store'
import { frontRef } from './zorder'
import { usePanelDrag } from './panelDrag'
import { computeCall, objZone } from '../types'

export function CallPanel() {
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const siteDown = useStore((s) => s.siteDown)
  const call = useStore((s) => s.call)
  const startCall = useStore((s) => s.startCall)
  const setCallPhase = useStore((s) => s.setCallPhase)
  const toggleHold = useStore((s) => s.toggleHold)
  const endCall = useStore((s) => s.endCall)
  const addEvent = useStore((s) => s.addEvent)
  const showCall = useStore((s) => s.showCall)
  const setShowCall = useStore((s) => s.setShowCall)

  const persons = objects.filter((o) => o.kind === 'person')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const { dragStyle, headerProps } = usePanelDrag()

  // 통화 active 경과시간
  useEffect(() => {
    if (call?.phase !== 'active') {
      setElapsed(0)
      return
    }
    const t0 = Date.now()
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(iv)
  }, [call?.phase])

  if (!showCall) return null

  const fromObj = persons.find((p) => p.id === from)
  const toObj = persons.find((p) => p.id === to)
  const preview =
    fromObj && toObj
      ? computeCall(objects, coreNfs, coreDn, objZone(fromObj), objZone(toObj), siteDown)
      : null

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const phaseLabel: Record<string, string> = {
    inviting: pick(lang, '연결 중…', 'Connecting…', '连接中…'),
    ringing: pick(lang, '벨 울림…', 'Ringing…', '振铃中…'),
    active: pick(lang, '통화 중', 'In call', '通话中'),
    ended: pick(lang, '종료됨', 'Ended', '已结束'),
    failed: pick(lang, '실패', 'Failed', '失败'),
  }

  return (
    <div className="callpanel panel" ref={frontRef} style={dragStyle}>
      <div className="log-head" {...headerProps}>
        <span className="section-label">📞 {pick(lang, 'VoNR 음성통화', 'VoNR Voice Call', 'VoNR 语音通话')}</span>
        <button className="log-btn" onClick={() => setShowCall(false)} title={pick(lang, '통화 패널 닫기', 'Close call panel', '关闭通话面板')}>✕</button>
      </div>

      {!call ? (
        <>
          <label className="field" title={pick(lang, '통화를 거는 측정요원(발신자) 선택', 'Choose the test UE that places the call (caller)', '选择发起通话的测试人员(主叫)')}>
            <span>{pick(lang, '발신', 'Caller', '主叫')}</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">—</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({objZone(p)})</option>
              ))}
            </select>
          </label>
          <label className="field" title={pick(lang, '통화를 받는 측정요원(착신자) 선택', 'Choose the test UE that receives the call (callee)', '选择接听通话的测试人员(被叫)')}>
            <span>{pick(lang, '착신', 'Callee', '被叫')}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">—</option>
              {persons.filter((p) => p.id !== from).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({objZone(p)})</option>
              ))}
            </select>
          </label>

          {preview && (
            <div className={`material-note ${preview.ok ? '' : 'warn-note'}`}>
              {preview.interPlmn ? pick(lang, '국제 통화 (IPX/SEPP 경유)', 'Inter-PLMN (via IPX/SEPP)', '国际通话 (经 IPX/SEPP)') : pick(lang, '동일 국가 통화', 'Same PLMN', '同一 PLMN 通话')}
              {!preview.ok && (
                <div style={{ color: 'var(--warn)', marginTop: 4 }}>
                  ⚠ {pick(lang, '누락', 'missing', '缺失')}: {preview.missing.join(', ')}
                </div>
              )}
            </div>
          )}

          <button
            className="traffic-btn"
            disabled={!from || !to}
            title={pick(lang, 'VoNR 통화 시작 — SIP INVITE부터 실제 IMS 호 설정 절차 실행', 'Start VoNR call — runs the IMS setup from SIP INVITE onward', '发起VoNR通话 — 从SIP INVITE起执行IMS建立流程')}
            onClick={() => startCall(from, to)}
          >
            📞 {pick(lang, '통화 시작', 'Start call', '发起通话')}
          </button>
        </>
      ) : (
        <div className="call-active">
          <div className="call-parties">
            {call.fromName} <span className="call-arrow">→</span> {call.toName}
            {call.interPlmn && <span className="roam-badge">✈ {pick(lang, '국제', 'Intl', '国际')}</span>}
            {call.held && <span className="roam-badge">⏸ {pick(lang, '보류', 'Hold', '保留')}</span>}
          </div>
          {call.forwardedFrom && (
            <div className="material-note">
              ↪ {pick(lang, `착신전환됨 (원 착신자: ${call.forwardedFrom})`, `Forwarded (original: ${call.forwardedFrom})`, `已前转 (原被叫: ${call.forwardedFrom})`)}
            </div>
          )}
          {call.waitingFrom && (
            <div className="material-note">
              ⏳ {pick(lang, `통화 대기 — ${call.waitingFrom} 보류 중`, `Call waiting — ${call.waitingFrom} on hold`, `呼叫等待 — ${call.waitingFrom} 保留中`)}
            </div>
          )}
          <div className={`call-phase ${call.phase}`}>
            {call.phase === 'active' && <span className="call-timer">{mmss(elapsed)}</span>}
            {phaseLabel[call.phase] ?? call.phase}
          </div>
          {call.phase === 'failed' && call.reason && (
            <div className="material-note" style={{ color: 'var(--bad)' }}>{call.reason}</div>
          )}
          <div className="call-buttons">
            {call.phase === 'active' && (
              <button
                className={`traffic-btn ${call.held ? '' : 'stop'}`}
                title={pick(lang, '통화 보류/재개 — SIP re-INVITE(hold)로 미디어 일시중지', 'Hold/resume the call — pauses media via SIP re-INVITE (hold)', '保留/恢复通话 — 经SIP re-INVITE暂停媒体')}
                onClick={() => toggleHold()}
              >
                {call.held
                  ? pick(lang, '▶ 통화 재개', '▶ Resume', '▶ 恢复')
                  : pick(lang, '⏸ 통화 보류', '⏸ Hold', '⏸ 保留')}
              </button>
            )}
            {(call.phase === 'active' || call.phase === 'ringing' || call.phase === 'inviting') && (
              <button
                className="traffic-btn stop"
                title={pick(lang, '통화 종료 — SIP BYE 전송으로 호 해제', 'Hang up — releases the call by sending SIP BYE', '挂断 — 发送SIP BYE释放呼叫')}
                onClick={() => {
                  addEvent('UE', 'info', `SIP BYE — 통화 종료 (${call.fromName}→${call.toName})`, 'P-CSCF')
                  setCallPhase('ended')
                  setTimeout(() => useStore.getState().endCall(), 800)
                }}
              >
                📵 {pick(lang, '통화 종료', 'Hang up', '挂断')}
              </button>
            )}
            {(call.phase === 'ended' || call.phase === 'failed') && (
              <button className="traffic-btn" onClick={endCall} title={pick(lang, '통화 기록 지우고 발신/착신 선택으로 돌아가기', 'Clear the call and return to caller/callee selection', '清除通话并返回主叫/被叫选择')}>
                {pick(lang, '닫기', 'Close', '关闭')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

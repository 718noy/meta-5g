// VoNR(IMS) 음성 통화 call flow 엔진.
// 발신 UE → P-CSCF → I-CSCF → S-CSCF → (IPX/SEPP, 국가간) → 착신측 → RTP.
// 각 단계에서 실제 SIP 메시지(INVITE/100/180/183/PRACK/200/ACK/BYE)를 로그로 흘린다.
import { useEffect, useRef } from 'react'
import { pick } from './i18n'
import { useStore } from './store'
import type { CallState } from './store'
import { computeCall, defaultImsi, objZone } from './types'

// 단계 간 지연(ms) — 실제 IMS 시그널링 왕복 느낌
const STEP = 550

// INVITE ~ 200 OK 시그널링 시퀀스 (SIP over IMS)
// SECTION T: from/to는 명시적 SIP 방향 — UE→P-CSCF→I-CSCF→S-CSCF, 응답(100/183/180)은 역방향.
interface SipStep { node: string; msg: string; src: 'UE' | 'NF'; from: string; to: string }
function inviteFlow(interPlmn: boolean): SipStep[] {
  const seq: SipStep[] = [
    { src: 'UE', node: 'P-CSCF', msg: 'SIP INVITE (sdp offer, AMR-WB) → P-CSCF', from: 'UE', to: 'P-CSCF' },
    { src: 'NF', node: 'P-CSCF', msg: '100 Trying', from: 'P-CSCF', to: 'UE' },
    { src: 'NF', node: 'S-CSCF', msg: 'INVITE → I-CSCF → S-CSCF (iFC 평가, T-AS 트리거)', from: 'I-CSCF', to: 'S-CSCF' },
  ]
  if (interPlmn)
    seq.push({ src: 'NF', node: 'SEPP', msg: 'INVITE → IPX 트렁크(SEPP/N32) → 상대 PLMN S-CSCF', from: 'S-CSCF', to: 'SEPP' })
  seq.push(
    { src: 'NF', node: 'S-CSCF', msg: '착신측 S-CSCF → P-CSCF → 착신 UE 라우팅', from: 'S-CSCF', to: 'P-CSCF' },
    { src: 'UE', node: 'P-CSCF', msg: '183 Session Progress (sdp answer) / PRACK', from: 'P-CSCF', to: 'UE' },
    { src: 'NF', node: 'PCF', msg: 'Rx(AAR) → PCF → SMF: 전용 QoS Flow 5QI=1(GBR) 생성', from: 'P-CSCF', to: 'PCF' },
    { src: 'UE', node: 'P-CSCF', msg: '180 Ringing', from: 'P-CSCF', to: 'UE' },
  )
  return seq
}

export function useCallEngine() {
  const timers = useRef<number[]>([])

  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      const c = state.call
      // 새 통화가 inviting으로 시작될 때만 시퀀스 구동
      if (c && c.phase === 'inviting' && prev.call?.phase !== 'inviting') {
        drive(c)
      }
    })
    return () => {
      unsub()
      timers.current.forEach(clearTimeout)
    }
  }, [])

  function drive(call: CallState) {
    timers.current.forEach(clearTimeout)
    timers.current = []
    const st = useStore.getState()
    const from = st.objects.find((o) => o.id === call.fromId)
    const to = st.objects.find((o) => o.id === call.toId)
    if (!from || !to) return
    const fromZone = objZone(from)
    const toZone = objZone(to)
    // SECTION T: 이 통화의 시그널링을 발신 UE의 IMSI로 태깅 → 해당 UE 콜플로우 추적에 포함
    const imsi = st.personImsi[call.fromId] ?? defaultImsi(st.ueSim)

    // 성립 가능성 판정
    const chk = computeCall(st.objects, st.coreNfs, st.coreDn, fromZone, toZone, st.siteDown)
    const L = st.lang === 'ko'
    const lang = st.lang
    const label = `${call.fromName}→${call.toName}`
    // MMTEL 조건부 착신전환(CFNR 무응답 / CFNRc 도달불가) — 착신자 TAS 설정.
    const suppTo = st.personSupp[call.toId] ?? {}
    // 착신전환 대상으로 재라우팅 (302 후 새 통화). heldCall 복원 없이 슬롯 교체.
    const forwardCall = (kind: string, reason: string): boolean => {
      const tgt = st.objects.find((o) => o.id === suppTo.cfTarget)
      if (!tgt || tgt.id === call.toId) return false
      const s = useStore.getState()
      s.addEvent('NF', 'info',
        pick(lang,
          `TAS ${kind}(${reason}): ${call.toName} → ${tgt.name} (SIP 302 Moved Temporarily)`,
          `TAS ${kind} (${reason}): ${call.toName} → ${tgt.name} (SIP 302 Moved Temporarily)`,
          `TAS ${kind}(${reason}): ${call.toName} → ${tgt.name} (SIP 302 Moved Temporarily)`),
        'S-CSCF', 'out', imsi, 'S-CSCF', call.fromName)
      useStore.setState({ call: null })
      s.startCall(call.fromId, tgt.id)
      return true
    }

    st.addEvent('UE', 'info', `📞 발신: ${label}${call.interPlmn ? ' (국제)' : ''}`, call.fromName, 'out', imsi, from.name, to.name)

    if (!chk.ok) {
      // BUG6: 결손 원인별 SIP 코드 매핑 (486 Busy는 실제 통화중 전용 → 여기선 사용 안 함)
      //   IMS 코어 NF 결손 → 503 Service Unavailable
      //   Inter-PLMN SEPP/IPX 결손 → 504 Server Time-out (IPX 경로)
      //   착신측 RU/E2E(무선·세션) 결손·미도달 → 480 Temporarily Unavailable
      const seppMissing = chk.missing.some((m) => m.includes('SEPP'))
      const imsMissing = chk.missing.some((m) => /P-CSCF|I-CSCF|S-CSCF/.test(m))
      const e2eMissing = chk.missing.some((m) => /RU|AMF|SMF|UPF|DN|AUSF|UDM/.test(m))
      let code = '503'
      let reason = L ? 'Service Unavailable (IMS)' : 'Service Unavailable (IMS)'
      let node = 'S-CSCF'
      if (seppMissing) { code = '504'; reason = 'Server Time-out (IPX/SEPP)'; node = 'SEPP' }
      else if (imsMissing) { code = '503'; reason = 'Service Unavailable (IMS core)'; node = 'S-CSCF' }
      else if (e2eMissing) { code = '480'; reason = 'Temporarily Unavailable (callee unreachable)'; node = 'S-CSCF' }
      // CFNRc(도달불가 착신전환): 착신자가 도달불가(480)이고 착신전환 대상이 있으면 전환.
      if (code === '480' && suppTo.cfnrc && suppTo.cfTarget) {
        const t0 = window.setTimeout(() => { forwardCall('CFNRc', L ? '도달불가 착신전환' : 'forward on not-reachable') }, STEP)
        timers.current.push(t0)
        return
      }
      const t = window.setTimeout(() => {
        const s = useStore.getState()
        s.addEvent(
          'NF', 'error',
          `SIP ${code} ${reason} — ${L ? '누락' : 'missing'}: ${chk.missing.join(', ')}`,
          node, 'out', imsi, node, call.fromName,
        )
        s.setCallPhase('failed', `${code} ${reason}`)
      }, STEP)
      timers.current.push(t)
      return
    }

    const seq = inviteFlow(call.interPlmn)
    let delay = STEP
    seq.forEach((step) => {
      const t = window.setTimeout(() => {
        useStore.getState().addEvent(step.src, 'info', step.msg, step.node, undefined, imsi, step.from, step.to)
      }, delay)
      timers.current.push(t)
      delay += STEP
    })

    // ringing 상태
    const tRing = window.setTimeout(() => useStore.getState().setCallPhase('ringing'), delay)
    timers.current.push(tRing)
    delay += STEP * 2 // 벨 울리는 시간

    // 200 OK → ACK → active — 단, 무응답 착신전환(CFNR)이 설정돼 있으면 벨 후 전환.
    const tAns = window.setTimeout(() => {
      const s = useStore.getState()
      // 통화가 그 사이 종료/교체됐으면 무시
      if (s.call?.fromId !== call.fromId || s.call?.toId !== call.toId) return
      if (suppTo.cfnr && suppTo.cfTarget) {
        s.addEvent('NF', 'info',
          pick(lang,
            `무응답 타이머(No-Reply timer) 만료 — CFNR 발동`,
            `No-Reply timer expired — CFNR triggered`,
            `无应答定时器超时 — 触发 CFNR`),
          'S-CSCF', 'out', imsi, 'S-CSCF', call.fromName)
        if (forwardCall('CFNR', L ? '무응답 착신전환' : 'forward on no-reply')) return
      }
      s.addEvent('UE', 'info', '200 OK (착신 응답) → ACK', 'P-CSCF', undefined, imsi, 'P-CSCF', call.fromName)
      s.addEvent('NF', 'info', 'RTP 미디어 스트림 개통 (AMR-WB, 5QI=1 GBR)', 'MGW', undefined, imsi, from.name, to.name)
      s.setCallPhase('active')
    }, delay)
    timers.current.push(tAns)
  }

  return null
}

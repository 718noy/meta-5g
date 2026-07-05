// 절차 상세 — UE의 현재 Call Flow를 좌(UE)→우(DN) E2E 다이어그램으로 표시.
// 노드 사이에는 인터페이스/메시지 라벨. 노드 클릭 시 그 노드가 보유한 정보를 pcap 스타일로 출력.
import { useEffect, useMemo, useState } from 'react'
import { pick } from '../i18n'
import { buildProcedure } from '../procedure'
import type { FlowNode } from '../procedure'
import { useStore } from '../store'
import { usePanelDrag } from './panelDrag'
import { frontRef } from './zorder'
import { objZone } from '../types'

export function ProcedurePanel() {
  const lang = useStore((s) => s.lang)
  const procedureUe = useStore((s) => s.procedureUe)
  const procedureNonce = useStore((s) => s.procedureNonce)
  const setProcedureUe = useStore((s) => s.setProcedureUe)
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const walkProbe = useStore((s) => s.probe)
  const personProbes = useStore((s) => s.personProbes)
  const ueSim = useStore((s) => s.ueSim)
  const ueZone = useStore((s) => s.ueZone)
  const call = useStore((s) => s.call)
  const personMbps = useStore((s) => s.personMbps)
  const trafficMbps = useStore((s) => s.trafficMbps)
  const events = useStore((s) => s.events)
  const selectedId = useStore((s) => s.selectedId)
  const [sel, setSel] = useState<string>('ue')
  const [tab, setTab] = useState<'pcap' | 'log'>('pcap')
  const [min, setMin] = useState(false)
  const { dragStyle, headerProps } = usePanelDrag()
  // item 15: 상단 경계 드래그로 창 높이 조절 (최소 바 ~ 화면 1/2). null = CSS 기본(33vh)
  const [height, setHeight] = useState<number | null>(null)
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const panel = e.currentTarget.parentElement as HTMLElement | null
    const startY = e.clientY
    const startH = height ?? panel?.offsetHeight ?? 300
    const MIN_H = 84
    const MAX_H = () => Math.round(window.innerHeight * 0.9)
    const onMove = (ev: PointerEvent) => {
      // 위로 드래그(clientY 감소) → 커짐
      const h = Math.min(Math.max(startH + (startY - ev.clientY), MIN_H), MAX_H())
      setHeight(h)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  // 씬에서 다른 오브젝트를 클릭(선택)하면 자동 최소화 → 덜 가리게
  useEffect(() => {
    if (selectedId) setMin(true)
  }, [selectedId])
  // 절차상세 버튼을 누르면(같은 UE 재클릭 포함) 펼침 — PART 2
  useEffect(() => {
    if (useStore.getState().procedureUe) setMin(false)
  }, [procedureNonce])

  const proc = useMemo(() => {
    if (!procedureUe) return null
    const isWalk = procedureUe === 'walk'
    const personObj = isWalk ? null : objects.find((o) => o.id === procedureUe)
    const zone = isWalk ? (ueZone ?? 'A') : personObj ? objZone(personObj) : 'A'
    const probe = isWalk ? walkProbe : personProbes[procedureUe]
    const ueName = isWalk ? 'UE (walk)' : (personObj?.name ?? 'UE')
    const inCall =
      call != null &&
      call.phase === 'active' &&
      (call.fromId === procedureUe || call.toId === procedureUe)
    const mbps = isWalk ? (trafficMbps || 0) : (personMbps[procedureUe] ?? 0)
    // UE IP는 시뮬 값(실스택 아닐 때) — 결정적으로 부여
    const ueIp = probe ? `10.45.${zone === 'A' ? 0 : zone === 'B' ? 1 : 2}.${((personObj?.name?.length ?? 2) % 250) + 2}` : '-'
    return buildProcedure({
      probe, ueSim, zone, ueName, ueIp, objects, coreNfs, inCall, mbps,
    })
  }, [procedureUe, objects, coreNfs, walkProbe, personProbes, ueSim, ueZone, call, personMbps, trafficMbps])

  if (!procedureUe || !proc) return null

  const selNode: FlowNode | undefined = proc.nodes.find((n) => n.id === sel) ?? proc.nodes[0]

  // PART 1: 메인 E2E 체인(좌→우)과 제어평면(CP) NF 층을 분리해 렌더.
  // links[i] = mainNodes[i] ↔ mainNodes[i+1].
  const mainNodes = proc.nodes.filter((n) => n.layer !== 'cp')
  const cpNodes = proc.nodes.filter((n) => n.layer === 'cp')
  // attachTo id → 짧은 라벨 (연결 대상 표기용)
  const labelOf = (id: string): string => {
    const n = proc.nodes.find((x) => x.id === id)
    if (!n) return id.replace(/^cp-/, '').toUpperCase()
    return n.role.toUpperCase()
  }

  const NodeCard = (n: FlowNode) => (
    <div className="proc-node-col">
      <button
        className={`proc-node ${sel === n.id ? 'sel' : ''}`}
        style={{ borderColor: n.color }}
        title={pick(lang, `${n.label} 노드 선택 — 이 노드가 보유한 정보/로그 보기`, `Select node ${n.label} — view its info & logs`, `选择节点 ${n.label} — 查看其信息/日志`)}
        onClick={() => setSel(n.id)}
      >
        <span className="proc-dot" style={{ background: n.color }} />
        <span className="proc-label">{n.label}</span>
        <span className="proc-role">{n.role.toUpperCase()}</span>
      </button>
      <div className="proc-node-tabs">
        <button
          className={sel === n.id && tab === 'pcap' ? 'on' : ''}
          title={pick(lang, '이 노드가 보유한 파라미터/식별자 (pcap 스타일)', 'Parameters & identifiers held by this node (pcap-style)', '此节点持有的参数/标识 (pcap风格)')}
          onClick={() => { setSel(n.id); setTab('pcap') }}
        >
          {pick(lang, '정보', 'Info', '信息')}
        </button>
        <button
          className={sel === n.id && tab === 'log' ? 'on' : ''}
          title={pick(lang, '이 노드에서 발생한 시그널링 로그만 표시', 'Show only signaling logs originating at this node', '仅显示此节点产生的信令日志')}
          onClick={() => { setSel(n.id); setTab('log') }}
        >
          {pick(lang, '로그', 'Log', '日志')}
        </button>
      </div>
    </div>
  )

  return (
    <div
      className={`procpanel panel ${min ? 'minimized' : ''}`}
      ref={frontRef}
      style={{ ...dragStyle, ...(!min && height != null ? { height, maxHeight: '90vh' } : {}) }}
    >
      {!min && (
        <div
          className="proc-resize-handle"
          onPointerDown={onResizeDown}
          title={pick(lang, '드래그하여 창 높이 조절', 'drag to resize', '拖动调整高度')}
        />
      )}
      <div
        className="log-head"
        {...headerProps}
        style={{ ...headerProps.style, ...(min ? { cursor: 'pointer' } : {}) }}
        onClick={() => min && setMin(false)}
        title={min ? pick(lang, '클릭하여 펼치기', 'click to expand', '点击展开') : undefined}
      >
        <span className="section-label">
          🔗 {pick(lang, '절차 상세 — E2E Call Flow', 'Procedure — E2E Call Flow', '流程详情 — E2E Call Flow')}
        </span>
        {!proc.ok && !min && (
          <span className="proc-warn">
            {pick(lang, '미등록 — 통신 경로 없음', 'Not registered — no path', '未注册 — 无通信路径')}
          </span>
        )}
        {/* 단일 접기/펼치기 컨트롤 — 접힘 시 위쪽 화살표(↑)로 복원 (PART 2) */}
        <button
          className="log-btn"
          onClick={(e) => { e.stopPropagation(); setMin((m) => !m) }}
          title={min ? pick(lang, '펼치기', 'expand', '展开') : pick(lang, '접기', 'minimize', '收起')}
        >
          {min ? '↑' : '—'}
        </button>
        <button className="log-btn" title={pick(lang, '절차 상세 패널 닫기', 'Close procedure panel', '关闭流程详情面板')} onClick={(e) => { e.stopPropagation(); setProcedureUe(null) }}>✕</button>
      </div>

      {min ? null : <>
      {/* 다이어그램: 상단=제어평면 NF(SBI) 층 / 하단=사용자·데이터 평면 메인 체인 (item 17).
          각 층에 라벨 + 배경 밴드를 두어 5G SBA 아키텍처로 읽히게 한다. 넓으면 함께 가로 스크롤. */}
      <div className="proc-flow-wrap">
        {cpNodes.length > 0 && (
          <div className="proc-layer proc-layer-cp">
            <div className="proc-layer-label">
              <span>▲ {pick(lang, '제어평면 (SBI)', 'Control plane (SBI)', '控制面 (SBI)')}</span>
              <em>{pick(lang,
                'NRF·NSSF·AUSF·UDM·PCF·CHF·BSF — SBI 버스로 AMF/SMF 연동',
                'NRF·NSSF·AUSF·UDM·PCF·CHF·BSF — via SBI bus to AMF/SMF',
                'NRF·NSSF·AUSF·UDM·PCF·CHF·BSF — 经 SBI 总线接 AMF/SMF')}</em>
            </div>
            <div className="proc-cp-layer">
              {cpNodes.map((n) => (
                <div key={n.id} className="proc-cp-item">
                  {NodeCard(n)}
                  {n.attachTo && n.attachTo.length > 0 && (
                    <div className="proc-cp-attach" title={pick(lang, '연동 노드', 'connects to', '连接节点')}>
                      ↕ {n.attachTo.map(labelOf).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="proc-cp-connector">
              {pick(lang, 'SBI 버스 (N7·N8·N10·N12·N22 …)', 'SBI bus (N7·N8·N10·N12·N22 …)', 'SBI 总线 (N7·N8·N10·N12·N22 …)')}
            </div>
          </div>
        )}
        {/* 하단: 사용자·데이터 평면 메인 체인 (좌→우) */}
        <div className="proc-layer proc-layer-up">
          <div className="proc-layer-label">
            <span>▼ {pick(lang, '사용자 · 데이터 평면', 'User / Data plane', '用户/数据面')}</span>
            <em>UE ↔ gNB ↔ AMF ↔ SMF ↔ UPF ↔ DN</em>
          </div>
          <div className="proc-flow">
          {mainNodes.map((n, i) => (
            <div key={n.id} className="proc-seg">
              {NodeCard(n)}
              {i < mainNodes.length - 1 && proc.links[i] && (
                <div className="proc-link">
                  <div className="proc-iface">{proc.links[i].iface}</div>
                  <div className="proc-dir">
                    <span className="proc-arrow up">→</span>
                    <span className="proc-msg">{proc.links[i].up}</span>
                  </div>
                  <div className="proc-dir">
                    <span className="proc-arrow down">←</span>
                    <span className="proc-msg">{proc.links[i].down}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>

      {/* 선택 노드: 정보(pcap) / 로그 탭 */}
      {selNode && (
        <div className="proc-pcap">
          <div className="proc-pcap-head" style={{ color: selNode.color }}>
            <span>▤ {selNode.label} — {tab === 'log' ? pick(lang, '로그', 'Log', '日志') : pick(lang, '정보', 'Info', '信息')}</span>
            {tab === 'log' && (
              <button
                className="proc-log-clear"
                title={pick(lang, '이 노드의 로그만 비우기', 'Clear only this node\'s logs', '仅清空此节点的日志')}
                onClick={() => useStore.getState().clearNodeEvents(selNode.label)}
              >
                🗑 {pick(lang, '이 노드 로그 지우기', 'Clear', '清空')}
              </button>
            )}
          </div>
          {tab === 'pcap' ? (
            <div className="proc-pcap-body">
              {selNode.fields.map((f, i) =>
                f.v === '' ? (
                  <div key={i} className="proc-sep">{f.k.replace(/—/g, '').trim()}</div>
                ) : (
                  <div key={i} className="proc-row">
                    <span className="proc-k">{f.k}</span>
                    <span className="proc-v">{f.v}</span>
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="proc-log-body">
              {(() => {
                const nodeLogs = events.filter((e) => e.node === selNode.label)
                if (nodeLogs.length === 0)
                  return (
                    <div className="proc-log-empty">
                      {pick(lang, '이 노드의 로그 없음 (단말 전원을 켜면 attach 로그가 쌓입니다)',
                        'No logs for this node (power on the UE to generate attach logs)',
                        '此节点无日志 (开机后生成attach日志)')}
                    </div>
                  )
                return nodeLogs.map((e) => (
                  <div key={e.id} className={`proc-log-line ${e.level}`}>
                    <span className="proc-log-time">{e.time}</span>
                    {e.dir && (
                      <span className={`proc-log-dir ${e.dir}`} title={e.dir === 'in' ? pick(lang, '수신', 'incoming', '接收') : pick(lang, '송신', 'outgoing', '发送')}>
                        {e.dir === 'in' ? '←' : '→'}
                      </span>
                    )}
                    {e.imsi && <span className="proc-log-imsi">SIM {e.imsi}</span>}
                    <span className="proc-log-msg">{e.msg}</span>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  )
}

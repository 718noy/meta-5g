// 이벤트 로그(시뮬레이션) + 실스택 로그(WSL Open5GS/UERANSIM 실제 로그 tail).
// 실스택 탭: NF 선택 + 프로토콜 계층 필터([ngap][gmm/nas][sbi][pfcp][rrc]...)
import { useEffect, useMemo, useRef, useState } from 'react'
import { pick, useT } from '../i18n'
import { useStore } from '../store'
import { usePanelDrag } from './panelDrag'
import { frontRef } from './zorder'
import type { LogSource } from '../store'

const SOURCES: (LogSource | 'ALL')[] = ['ALL', 'SIM', 'UE', 'RU', 'NF']

const REAL_SOURCES = [
  'amf', 'smf', 'upf', 'ausf', 'udm', 'udr',
  'nrf', 'scp', 'sepp', 'nssf', 'pcf', 'gnb', 'ue',
]
const LAYERS = ['all', 'ngap', 'nas', 'gmm', 'sbi', 'pfcp', 'gtp', 'rrc', 'sctp'] as const

// 실스택 로그 뷰 — 1초 폴링 tail
function RealLogView() {
  const lang = useStore((s) => s.lang)
  const [src, setSrc] = useState('amf')
  const [layer, setLayer] = useState<(typeof LAYERS)[number]>('all')
  const [lines, setLines] = useState<string[]>([])
  const offsetRef = useRef(-1)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    offsetRef.current = -1
    setLines([])
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch(
          `http://localhost:8000/p3/logs?src=${src}&offset=${offsetRef.current}`,
        )
        const j = await r.json()
        if (!alive) return
        offsetRef.current = j.offset ?? offsetRef.current
        if (j.lines?.length) setLines((prev) => [...prev, ...j.lines].slice(-400))
      } catch {
        /* 백엔드 미기동 */
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [src])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines])

  const filtered =
    layer === 'all' ? lines : lines.filter((l) => l.toLowerCase().includes(`[${layer}]`))

  const levelClass = (l: string) =>
    /ERROR|FATAL|\[error\]/.test(l) ? 'error' : /WARN|\[warning\]/.test(l) ? 'warn' : ''

  return (
    <>
      <div className="log-head" style={{ marginTop: 4 }}>
        <select className="node-filter" value={src} onChange={(e) => setSrc(e.target.value)}
          title={pick(lang, '어느 실스택 노드(NF/gNB/UE)의 로그를 tail 할지 선택', 'Pick which real-stack node (NF/gNB/UE) log to tail', '选择跟踪哪个真实栈节点(NF/gNB/UE)的日志')}>
          {REAL_SOURCES.map((s) => (
            <option key={s} value={s}>{s.toUpperCase()}</option>
          ))}
        </select>
        <div className="seg small" style={{ flexWrap: 'wrap' }}
          title={pick(lang, '프로토콜 계층으로 로그 필터 (ngap/nas/sbi/pfcp…)', 'Filter logs by protocol layer (ngap/nas/sbi/pfcp…)', '按协议层过滤日志 (ngap/nas/sbi/pfcp…)')}>
          {LAYERS.map((ly) => (
            <button key={ly} className={layer === ly ? 'on' : ''} onClick={() => setLayer(ly)}
              title={ly === 'all' ? pick(lang, '모든 계층 표시', 'Show all layers', '显示所有层') : pick(lang, `[${ly}] 태그가 있는 줄만 표시`, `Show only lines tagged [${ly}]`, `仅显示带[${ly}]标签的行`)}>
              {ly}
            </button>
          ))}
        </div>
      </div>
      <div className="log-body real" ref={bodyRef}>
        {filtered.length === 0 && (
          <div className="log-empty">
            {pick(
              lang,
              '로그 없음 — WSL 실스택(Open5GS/UERANSIM)이 기동 중인지 확인',
              'No logs — check WSL real stack (Open5GS/UERANSIM)',
              '无日志 — 请确认 WSL 真实栈(Open5GS/UERANSIM)已启动',
            )}
          </div>
        )}
        {filtered.map((l, i) => (
          <div key={i} className={`log-line ${levelClass(l)}`}>
            <span className="log-msg">{l}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export function LogPanel() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const events = useStore((s) => s.events)
  const showLog = useStore((s) => s.showLog)
  const setShowLog = useStore((s) => s.setShowLog)
  const clearEvents = useStore((s) => s.clearEvents)
  const [tab, setTab] = useState<'sim' | 'real'>('sim')
  const [filter, setFilter] = useState<LogSource | 'ALL'>('ALL')
  const [nodeFilter, setNodeFilter] = useState<string>('ALL')
  const bodyRef = useRef<HTMLDivElement>(null)
  const { dragStyle, headerProps } = usePanelDrag()

  // 패널 폭 — 우측(right:12px)에 앵커됨. 좌측 핸들을 드래그하면 우측 가장자리를 고정한 채
  // 폭을 넓혀(왼쪽으로 확장) / 좁힌다. 세로는 CSS resize:vertical(하단)로 조절.
  const MIN_W = 320
  const [width, setWidth] = useState(560)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const onResizeLeft = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = panelRef.current?.getBoundingClientRect()
    const rightEdge = rect ? rect.right : window.innerWidth - 12
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      const maxW = window.innerWidth * 0.8
      let newW = rightEdge - ev.clientX
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

  // NF/RU 인스턴스 목록 (해당 소스 이벤트에서 수집)
  const nodes = useMemo(() => {
    if (filter !== 'NF' && filter !== 'RU') return []
    const set = new Set<string>()
    for (const e of events) if (e.source === filter && e.node) set.add(e.node)
    return [...set].sort()
  }, [events, filter])

  const filtered = events.filter((e) => {
    if (filter !== 'ALL' && e.source !== filter) return false
    if ((filter === 'NF' || filter === 'RU') && nodeFilter !== 'ALL' && e.node !== nodeFilter)
      return false
    return true
  })

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [filtered.length, showLog])

  useEffect(() => setNodeFilter('ALL'), [filter])

  if (!showLog) return null

  return (
    <div className="logpanel panel" ref={(el) => { panelRef.current = el; frontRef(el) }} style={{ ...dragStyle, width }}>
      <div
        className={`logpanel-resize${dragging ? ' dragging' : ''}`}
        onMouseDown={onResizeLeft}
        title={pick(lang, '드래그하여 폭 조절', 'Drag to resize width', '拖动调整宽度')}
      />
      <div className="log-head" {...headerProps}>
        <span className="section-label">{t('log_title')}</span>
        <div className="seg small">
          <button className={tab === 'sim' ? 'on' : ''} onClick={() => setTab('sim')}
            title={pick(lang, '시뮬레이터가 생성한 이벤트 로그 보기', 'View simulator-generated event logs', '查看仿真器生成的事件日志')}>
            {pick(lang, '이벤트', 'Events', '事件')}
          </button>
          <button className={tab === 'real' ? 'on' : ''} onClick={() => setTab('real')}
            title={pick(lang, 'WSL 실스택(Open5GS/UERANSIM)의 실제 로그 tail', 'Tail real logs from the WSL stack (Open5GS/UERANSIM)', '跟踪WSL真实栈(Open5GS/UERANSIM)的实际日志')}>
            {pick(lang, '⚙ 실스택 (5GC)', '⚙ Real Stack (5GC)', '⚙ 真实栈 (5GC)')}
          </button>
        </div>
        {tab === 'sim' && (
          <>
            <div className="seg small" title={pick(lang, '로그 발생원으로 필터 (SIM/UE/RU/NF)', 'Filter logs by source (SIM/UE/RU/NF)', '按来源过滤日志 (SIM/UE/RU/NF)')}>
              {SOURCES.map((s) => (
                <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}
                  title={s === 'ALL' ? pick(lang, '모든 발생원', 'All sources', '所有来源') : pick(lang, `${s} 로그만 표시`, `Show only ${s} logs`, `仅显示 ${s} 日志`)}>
                  {s === 'ALL' ? t('all') : s}
                </button>
              ))}
            </div>
            {nodes.length > 0 && (
              <select
                className="node-filter"
                value={nodeFilter}
                title={pick(lang, '특정 NF/RU 인스턴스로 좁혀서 보기', 'Narrow to a specific NF/RU instance', '缩小到特定NF/RU实例')}
                onChange={(e) => setNodeFilter(e.target.value)}
              >
                <option value="ALL">{t('all_instances')}</option>
                {nodes.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
            <button className="log-btn" onClick={clearEvents} title={pick(lang, '이벤트 로그 전체 비우기', 'Clear all event logs', '清空全部事件日志')}>{t('clear')}</button>
          </>
        )}
        <button className="log-btn" onClick={() => setShowLog(false)} title={pick(lang, '로그 패널 닫기', 'Close log panel', '关闭日志面板')}>✕</button>
      </div>
      {tab === 'real' ? (
        <RealLogView />
      ) : (
        <div className="log-body" ref={bodyRef}>
          {filtered.length === 0 && <div className="log-empty">{t('no_events')}</div>}
          {filtered.map((e) => (
            <div key={e.id} className={`log-line ${e.level}`}>
              <span className="log-time">{e.time}</span>
              <span className={`log-src src-${e.source}`}>{e.source}</span>
              {e.node && <span className="log-node">{e.node}</span>}
              {/* PART 12: 노드 기준 메시지 방향 화살표 (수신 ← / 송신 →) */}
              {e.dir && (
                <span className={`log-dir ${e.dir}`} title={e.dir === 'in' ? 'incoming' : 'outgoing'}>
                  {e.dir === 'in' ? '←' : '→'}
                </span>
              )}
              {/* PART 11: 이 로그가 속한 SIM(IMSI) 병기 */}
              {e.imsi && <span className="log-imsi" title="IMSI">SIM {e.imsi}</span>}
              <span className="log-msg">{e.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 측정요원(UE) 목록 — 여러 단말을 한 곳에서 구분·개별 제어.
// 각 UE: 전원 · 트래픽 · 서비스종류 · RSRP · IMSI 등록상태. 상단에 전체 전원/트래픽.
import { pick } from '../i18n'
import { useStore } from '../store'
import { usePanelDrag } from './panelDrag'
import { frontRef } from './zorder'
import type { SimResult, TrafficType } from '../types'
import { TRAFFIC_TYPES, defaultImsi, imsiRegistered, objZone } from '../types'

function sample(sim: SimResult | null, x: number, z: number): number | null {
  if (!sim) return null
  const [cx, cy, cz] = sim.cell
  const ix = Math.min(Math.max(Math.floor(x / cx), 0), sim.nx - 1)
  const iy = Math.min(Math.max(Math.floor(1.5 / cy), 0), sim.ny - 1)
  const iz = Math.min(Math.max(Math.floor(z / cz), 0), sim.nz - 1)
  return sim.rsrp[ix + iy * sim.nx + iz * sim.nx * sim.ny]
}

export function UeListPanel() {
  const show = useStore((s) => s.showUeList)
  const setShow = useStore((s) => s.setShowUeList)
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const sims = useStore((s) => s.sims)
  const personUeOn = useStore((s) => s.personUeOn)
  const personTraffic = useStore((s) => s.personTraffic)
  const personMbps = useStore((s) => s.personMbps)
  const personTrafficType = useStore((s) => s.personTrafficType)
  const personImsi = useStore((s) => s.personImsi)
  const registeredImsis = useStore((s) => s.registeredImsis)
  const globalType = useStore((s) => s.trafficType)
  const ueSim = useStore((s) => s.ueSim)
  const togglePersonUe = useStore((s) => s.togglePersonUe)
  const togglePersonTraffic = useStore((s) => s.togglePersonTraffic)
  const setPersonTrafficType = useStore((s) => s.setPersonTrafficType)
  const setAllPersonUe = useStore((s) => s.setAllPersonUe)
  const setAllPersonTraffic = useStore((s) => s.setAllPersonTraffic)
  const select = useStore((s) => s.select)
  const selectedId = useStore((s) => s.selectedId)
  const setProcedureUe = useStore((s) => s.setProcedureUe)
  const setTraceUe = useStore((s) => s.setTraceUe)
  const bumpPanel = useStore((s) => s.bumpPanel)
  const { dragStyle, headerProps } = usePanelDrag()

  if (!show) return null
  const persons = objects.filter((o) => o.kind === 'person')
  const anyOn = persons.some((p) => personUeOn[p.id])
  const anyTraffic = persons.some((p) => personTraffic[p.id])

  return (
    <div className="uelist panel" ref={frontRef} style={dragStyle}>
      <div className="log-head" {...headerProps}>
        <span className="section-label">🚶 {pick(lang, '측정요원 (UE) 목록', 'Test UEs', '测试终端列表')} · {persons.length}</span>
        <button className="log-btn" onClick={() => setShow(false)} title={pick(lang, '단말 목록 패널 닫기', 'Close UE list panel', '关闭终端列表面板')}>✕</button>
      </div>
      <div className="uelist-allrow">
        <button className={anyOn ? 'on' : ''} onClick={() => setAllPersonUe(!anyOn)}
          title={pick(lang, '모든 측정요원 단말 전원 일괄 on/off (attach/detach)', 'Power all test UEs on/off at once (attach/detach)', '一键开关所有测试终端 (attach/detach)')}>
          {anyOn ? pick(lang, '전체 전원 끄기', 'Power off all', '全部关机') : pick(lang, '전체 전원 켜기', 'Power on all', '全部开机')}
        </button>
        <button className={anyTraffic ? 'on' : ''} onClick={() => setAllPersonTraffic(!anyTraffic)}
          title={pick(lang, '모든 단말 트래픽 생성 일괄 시작/중지', 'Start/stop traffic generation for all UEs at once', '一键开始/停止所有终端的流量生成')}>
          🚦 {anyTraffic ? pick(lang, '전체 트래픽 중지', 'Stop all', '停止全部') : pick(lang, '전체 트래픽 생성', 'Traffic all', '全部流量')}
        </button>
      </div>
      {/* item 16: 콜플로우 추적 패널을 여는 명확한 라벨 버튼 (선택 UE 없으면 첫 UE) */}
      {persons.length > 0 && (
        <button
          className="uelist-trace-btn"
          onClick={() => {
            const target = persons.find((p) => p.id === selectedId) ?? persons[0]
            setTraceUe(target.id) // setTraceUe 가 showUeTrace=true 로 패널을 연다
            bumpPanel('uetrace') // 재클릭 시 기본 위치/크기로 다시 열림
          }}
          title={pick(lang, '이 UE가 유발한 시그널링을 시간순 래더로 추적', 'trace this UE\'s signaling as a time-ordered ladder', '按时序追踪该UE的信令')}
        >
          🪜 {pick(lang, '콜플로우 추적', 'Call-flow trace', '呼叫流程追踪')}
        </button>
      )}
      {persons.length === 0 ? (
        <div className="uelist-empty">{pick(lang, '배치된 측정요원이 없습니다', 'No test UEs placed', '未放置测试终端')}</div>
      ) : (
        <div className="uelist-rows">
          {persons.map((p) => {
            const zone = objZone(p)
            const rsrp = personUeOn[p.id] ? sample(sims[zone], p.position[0], p.position[2]) : null
            const on = personUeOn[p.id] ?? false
            const tr = personTraffic[p.id] ?? false
            const type = personTrafficType[p.id] ?? globalType
            const imsi = personImsi[p.id] ?? defaultImsi(ueSim)
            const reg = imsiRegistered(imsi, ueSim, registeredImsis)
            return (
              <div key={p.id} className="uelist-row">
                <button className="uelist-name" onClick={() => select(p.id)} title={`${p.name} · PLMN-${zone}`}>
                  <span className={`ue-dot ${on ? 'on' : ''}`} />
                  <span className="ue-nm">{p.name}</span>
                  <em>PLMN-{zone}</em>
                </button>
                <button className={`ue-mini ${on ? 'on' : ''}`} onClick={() => togglePersonUe(p.id)} title={pick(lang, '전원', 'power', '电源')}>
                  {on ? '📱' : '📴'}
                </button>
                <button className={`ue-mini ${tr ? 'on' : ''}`} disabled={!on} onClick={() => togglePersonTraffic(p.id)} title={pick(lang, '트래픽', 'traffic', '流量')}>
                  🚦
                </button>
                <select className="ue-type" value={type} onChange={(e) => setPersonTrafficType(p.id, e.target.value as TrafficType)} title={pick(lang, '이 단말의 트래픽 서비스 종류(5QI)', 'Traffic service type (5QI) for this UE', '此终端的流量业务类型(5QI)')}>
                  {TRAFFIC_TYPES.map((tt) => <option key={tt.key} value={tt.key}>{tt.icon}</option>)}
                </select>
                <span className={`ue-rsrp ${!reg ? 'bad' : ''}`}>
                  {!reg ? pick(lang, '미등록', 'unreg', '未注册') : rsrp != null ? `${rsrp.toFixed(0)}` : on ? '…' : 'off'}
                </span>
                <span className="ue-mbps">{tr ? `${(personMbps[p.id] ?? 0).toFixed(0)}M` : ''}</span>
                <button className="ue-mini" onClick={() => setProcedureUe(p.id)} title={pick(lang, '절차상세', 'procedure', '流程')}>🔗</button>
                <button className="ue-mini" onClick={() => { setTraceUe(p.id); bumpPanel('uetrace') }} title={pick(lang, 'UE 콜플로우 추적', 'UE call-flow trace', 'UE 呼叫流程追踪')}>🪜</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// NMS(네트워크 관리 시스템) 대시보드 — 상용 OSS/NMS의 구성을 참조한 관리 뷰.
// KPI 타일, 알람, 셀/NF 인벤토리, 처리량 스파크라인, KPI 시계열 기록·CSV 내보내기.
import { useEffect, useMemo, useRef, useState } from 'react'
import { pick } from '../i18n'
import { useStore } from '../store'
import { frontRef } from './zorder'
import { usePanelDrag } from './panelDrag'
import type { SimResult } from '../types'
import { ZONES, computeE2E, objZone } from '../types'

// 커버리지 통계: 서비스 가능(≥-110dBm) / 양호(≥-95dBm) 복셀 비율
function coverageStats(sim: SimResult | null): { usable: number; good: number } | null {
  if (!sim || sim.rsrp.length === 0) return null
  let usable = 0
  let good = 0
  for (let i = 0; i < sim.rsrp.length; i++) {
    if (sim.rsrp[i] >= -110) usable++
    if (sim.rsrp[i] >= -95) good++
  }
  return { usable: (usable / sim.rsrp.length) * 100, good: (good / sim.rsrp.length) * 100 }
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="spark-empty">—</div>
  const w = 140
  const h = 36
  const max = Math.max(...data, 1)
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="sparkline" role="img" aria-label="throughput history">
      <polyline points={pts} fill="none" stroke="#4da3ff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function StatusChip({ level, label }: { level: 'good' | 'warn' | 'bad'; label: string }) {
  const icon = level === 'good' ? '●' : level === 'warn' ? '▲' : '✕'
  return <span className={`status-chip ${level}`}>{icon} {label}</span>
}

// sim 그리드에서 (x,z,높이1.5m) 지점의 값 샘플
function sampleGrid(sim: SimResult | null, x: number, z: number, arr?: Float32Array): number | null {
  if (!sim) return null
  const data = arr ?? sim.rsrp
  const [cx, cy, cz] = sim.cell
  const ix = Math.min(Math.max(Math.floor(x / cx), 0), sim.nx - 1)
  const iy = Math.min(Math.max(Math.floor(1.5 / cy), 0), sim.ny - 1)
  const iz = Math.min(Math.max(Math.floor(z / cz), 0), sim.nz - 1)
  return data[ix + iy * sim.nx + iz * sim.nx * sim.ny]
}

// 다중 UE(측정요원) 집계 통계 — sim 그리드 샘플로 항상 전체 집계.
function UeStats() {
  const lang = useStore((s) => s.lang)
  const personMbps = useStore((s) => s.personMbps)
  const objects = useStore((s) => s.objects)
  const sims = useStore((s) => s.sims)
  const persons = objects.filter((o) => o.kind === 'person')

  if (persons.length === 0) {
    return (
      <div className="ue-stats">
        {pick(lang, '배치된 측정요원이 없습니다 (사람을 배치하면 자동 집계)', 'No test UEs placed', '未放置测试UE (放置人员后自动统计)')}
      </div>
    )
  }

  const rsrps: number[] = []
  const sinrs: number[] = []
  for (const p of persons) {
    const zone = objZone(p)
    const r = sampleGrid(sims[zone], p.position[0], p.position[2])
    const si = sampleGrid(sims[zone], p.position[0], p.position[2], sims[zone]?.sinr)
    if (r != null) rsrps.push(r)
    if (si != null) sinrs.push(si)
  }
  const measured = rsrps.length
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const thr = persons.map((p) => personMbps[p.id] ?? 0)
  const good = rsrps.filter((r) => r >= -95).length
  const usable = rsrps.filter((r) => r >= -110).length
  const holes = rsrps.filter((r) => r < -110).length

  const cell = (label: string, val: string, warn = false) => (
    <div className="ue-stat">
      <span>{label}</span>
      <b className={warn ? 'warn' : ''}>{val}</b>
    </div>
  )

  return (
    <div className="ue-stats-box">
      <div className="section-label">
        {pick(lang, `측정요원 집계 통계 (${measured}/${persons.length} 측정됨)`, `Test-UE aggregate (${measured}/${persons.length})`, `测试UE汇总统计 (${measured}/${persons.length} 已测量)`)}
      </div>
      <div className="ue-stats-grid">
        {cell(pick(lang, '평균 RSRP', 'avg RSRP', '平均RSRP'), `${avg(rsrps).toFixed(1)} dBm`)}
        {cell(pick(lang, '평균 SINR', 'avg SINR', '平均SINR'), `${avg(sinrs).toFixed(1)} dB`)}
        {cell(pick(lang, '평균 스루풋', 'avg thr', '平均吞吐'), `${avg(thr).toFixed(0)} Mbps`)}
        {cell(pick(lang, '합계 스루풋', 'sum thr', '合计吞吐'), `${thr.reduce((a, b) => a + b, 0).toFixed(0)} Mbps`)}
        {cell(pick(lang, '양호(≥-95)', 'good', '良好(≥-95)'), `${good}/${measured}`)}
        {cell(pick(lang, '서비스가능(≥-110)', 'usable', '可用(≥-110)'), `${usable}/${measured}`)}
        {cell(pick(lang, '음영(<-110)', 'holes', '盲区(<-110)'), `${holes}`, holes > 0)}
        {cell(pick(lang, '커버리지', 'coverage', '覆盖'), `${measured ? Math.round((usable / measured) * 100) : 0}%`)}
      </div>
    </div>
  )
}

export function NmsPanel() {
  const showNms = useStore((s) => s.showNms)
  const setShowNms = useStore((s) => s.setShowNms)
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const sims = useStore((s) => s.sims)
  const events = useStore((s) => s.events)
  const trafficMbps = useStore((s) => s.trafficMbps)
  const trafficHistory = useStore((s) => s.trafficHistory)
  const engine = useStore((s) => s.engine)
  const nfLoads = useStore((s) => s.nfLoads)
  const personMbps = useStore((s) => s.personMbps)
  const siteDown = useStore((s) => s.siteDown)
  const { dragStyle, headerProps } = usePanelDrag()

  const cells = useMemo(() => objects.filter((o) => o.kind === 'gnb'), [objects])
  const persons = useMemo(() => objects.filter((o) => o.kind === 'person'), [objects])
  const allAlarms = useMemo(() => events.filter((e) => e.level !== 'info'), [events])
  const alarms = useMemo(() => allAlarms.slice(-30).reverse(), [allAlarms])
  const alarmTotal = allAlarms.length
  const covA = useMemo(() => coverageStats(sims.A), [sims.A])
  const covB = useMemo(() => coverageStats(sims.B), [sims.B])
  const covC = useMemo(() => coverageStats(sims.C), [sims.C])

  // KPI 시계열 기록 (초당 샘플) — 실제 OSS의 PM 카운터 수집처럼
  const [recording, setRecording] = useState(false)
  const recRef = useRef<string[]>([])
  const [recCount, setRecCount] = useState(0)
  useEffect(() => {
    if (!recording) return
    // 새 기록 세션 시작 → 이전 버퍼 비우고 헤더부터
    recRef.current = ['time,cells,nf_up,throughput_mbps,cov_good_A,cov_good_B,cov_good_C,alarms']
    setRecCount(0)
    const iv = setInterval(() => {
      const st = useStore.getState()
      const cl = st.objects.filter((o) => o.kind === 'gnb').length
      const up = st.coreNfs.filter((n) => n.enabled).length
      const thr =
        st.trafficMbps + Object.values(st.personMbps).reduce((a, b) => a + b, 0)
      const cA = coverageStats(st.sims.A)?.good ?? 0
      const cB = coverageStats(st.sims.B)?.good ?? 0
      const cC = coverageStats(st.sims.C)?.good ?? 0
      const al = st.events.filter((e) => e.level !== 'info').length
      recRef.current.push(
        `${new Date().toLocaleTimeString('en-GB')},${cl},${up},${thr.toFixed(1)},${cA.toFixed(1)},${cB.toFixed(1)},${cC.toFixed(1)},${al}`,
      )
      setRecCount(recRef.current.length - 1)
    }, 1000)
    return () => clearInterval(iv)
  }, [recording])

  const exportCsv = () => {
    const blob = new Blob([recRef.current.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'meta-5g-kpi.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!showNms) return null

  const nfUp = coreNfs.filter((n) => n.enabled).length

  return (
    <div className="nms panel" ref={frontRef} style={dragStyle}>
      <div className="log-head" {...headerProps}>
        <span className="section-label">
          📊 NMS — {pick(lang, '네트워크 관리', 'Network Management', '网络管理')}
        </span>
        <span className="nms-engine">{engine === 'rt' ? 'Engine: Ray Tracing' : 'Engine: Empirical'}</span>
        <button
          className={`log-btn ${recording ? 'rec-on' : ''}`}
          onClick={() => setRecording((r) => !r)}
          title={pick(lang, 'KPI 시계열 기록', 'Record KPI time-series', '记录KPI时间序列')}
        >
          {recording ? `⏹ ${pick(lang, '기록중', 'REC', '记录中')} (${recCount})` : `⏺ ${pick(lang, 'KPI 기록', 'Record', 'KPI记录')}`}
        </button>
        <button className="log-btn" disabled={recCount === 0} onClick={exportCsv}
          title={pick(lang, '기록한 KPI 시계열을 CSV 파일로 내보내기', 'Export the recorded KPI time-series as a CSV file', '将记录的KPI时间序列导出为CSV文件')}>
          ⬇ CSV
        </button>
        <button className="log-btn" onClick={() => setShowNms(false)} title={pick(lang, 'NMS 대시보드 닫기', 'Close NMS dashboard', '关闭NMS仪表盘')}>✕</button>
      </div>

      {/* 사용자수 + PLMN별 E2E 통신 상태 (TopBar에서 이동) */}
      <div className="nms-status-row">
        <div className="nms-users">
          {pick(lang, '사용자 수', 'Users', '用户数')} <b>{persons.length}</b>
          <em>
            A {persons.filter((o) => objZone(o) === 'A').length} · B{' '}
            {persons.filter((o) => objZone(o) === 'B').length} · C{' '}
            {persons.filter((o) => objZone(o) === 'C').length}
          </em>
        </div>
        {ZONES.map((z) => {
          const e = computeE2E(objects, coreNfs, coreDn, z, siteDown)
          if (e.empty) return null
          return (
            <div key={z} className={`e2e-badge ${e.ok ? 'ok' : 'bad'}`}
              title={e.ok ? undefined : e.missing.join(', ')}>
              PLMN-{z}: {e.ok
                ? pick(lang, '통신 가능', 'Reachable', '可通信')
                : `${pick(lang, '통신 불가', 'Unreachable', '不可通信')} (${e.missing.join(', ')})`}
            </div>
          )
        })}
      </div>

      {/* KPI 타일 */}
      <div className="nms-tiles">
        <div className="nms-tile">
          <span className="tile-label">{pick(lang, '셀 (RU)', 'Cells (RU)', '小区 (RU)')}</span>
          <b className="tile-value">{cells.length}</b>
          <span className="tile-sub">
            A {cells.filter((c) => objZone(c) === 'A').length} · B{' '}
            {cells.filter((c) => objZone(c) === 'B').length}
          </span>
        </div>
        <div className="nms-tile">
          <span className="tile-label">NF</span>
          <b className="tile-value">
            {nfUp}<em>/{coreNfs.length}</em>
          </b>
          <span className="tile-sub">{pick(lang, '가동/전체', 'up/total', '运行/总数')}</span>
        </div>
        {ZONES.map((z) => {
          const e = computeE2E(objects, coreNfs, coreDn, z, siteDown)
          if (e.empty) return null
          return (
            <div className="nms-tile" key={z}>
              <span className="tile-label">E2E PLMN-{z}</span>
              <StatusChip
                level={e.ok ? 'good' : 'warn'}
                label={e.ok ? pick(lang, '성립', 'Up', '就绪') : e.missing.join(',')}
              />
            </div>
          )
        })}
        {([['A', covA], ['B', covB], ['C', covC]] as const).map(([z, cov]) =>
          cov ? (
            <div className="nms-tile" key={`cov${z}`}>
              <span className="tile-label">
                {pick(lang, `커버리지 ${z} (양호)`, `Coverage ${z} (good)`, `覆盖 ${z} (良好)`)}
              </span>
              <b className="tile-value">{cov.good.toFixed(0)}<em>%</em></b>
              <div className="tile-meter">
                <div style={{ width: `${cov.good}%` }} />
              </div>
            </div>
          ) : null,
        )}
        <div className="nms-tile wide">
          <span className="tile-label">
            {pick(lang, '총 처리량 (걷는 UE + 측정요원)', 'Total throughput (walk + test UEs)', '总吞吐 (行走UE + 测试UE)')}
          </span>
          <div className="tile-spark-row">
            <b className="tile-value">
              {(trafficMbps + Object.values(personMbps).reduce((a, b) => a + b, 0)).toFixed(0)}
              <em> Mbps</em>
            </b>
            <Sparkline data={trafficHistory} />
          </div>
        </div>
        <div className="nms-tile">
          <span className="tile-label">{pick(lang, '알람', 'Alarms', '告警')}</span>
          <b className="tile-value">{alarmTotal}</b>
        </div>
      </div>

      <UeStats />


      <div className="nms-cols">
        {/* 셀 인벤토리 */}
        <div className="nms-section">
          <div className="section-label">{pick(lang, '셀 인벤토리 / KPI', 'Cell Inventory / KPI', '小区清单 / KPI')}</div>
          <table className="nms-table">
            <thead>
              <tr>
                <th>{pick(lang, '이름', 'Name', '名称')}</th><th>PLMN</th><th>PCI</th><th>MHz</th><th>dBm</th>
                <th>Load</th><th>{pick(lang, '안테나', 'Ant', '天线')}</th><th>{pick(lang, '상태', 'Status', '状态')}</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => {
                const li = nfLoads[c.id]
                const lp = li ? Math.round(li.load * 100) : null
                return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{objZone(c)}</td>
                  <td>{c.gnb?.pci}</td>
                  <td>{c.gnb?.freq_mhz}</td>
                  <td>{c.gnb?.tx_power_dbm}</td>
                  <td>
                    {lp === null || c.gnb?.enabled === false ? '-' : (
                      <span className={`nf-load ${lp > 95 ? 'bad' : lp > 80 ? 'warn' : 'good'}`}>{lp}%</span>
                    )}
                  </td>
                  <td>{c.gnb?.antenna}</td>
                  <td>
                    <StatusChip
                      level={c.gnb?.enabled ? 'good' : 'bad'}
                      label={c.gnb?.enabled ? pick(lang, '송출', 'On-air', '发射') : pick(lang, '중지', 'Off', '停止')}
                    />
                  </td>
                </tr>
                )
              })}
              {cells.length === 0 && (
                <tr><td colSpan={8} className="log-empty">{pick(lang, '셀 없음', 'No cells', '无小区')}</td></tr>
              )}
            </tbody>
          </table>

          <div className="section-label">{pick(lang, 'NF 인벤토리', 'NF Inventory', 'NF清单')}</div>
          <table className="nms-table">
            <thead>
              <tr>
                <th>{pick(lang, '이름', 'Name', '名称')}</th><th>PLMN</th><th>Pods</th><th>HA</th>
                <th>HPA</th><th>Load</th><th>CPU</th><th>{pick(lang, '상태', 'Status', '状态')}</th>
              </tr>
            </thead>
            <tbody>
              {coreNfs.map((n) => {
                const li = nfLoads[n.id]
                const pct = li ? Math.round(li.load * 100) : null
                return (
                  <tr key={n.id}>
                    <td>{n.name}</td>
                    <td>{n.zone}</td>
                    <td>{n.replicas}</td>
                    <td>{n.ha === 'geo-red' ? `GR/${n.site}` : n.ha === 'active-standby' ? 'AS' : '-'}</td>
                    <td>{n.auto_scale ? 'on' : 'off'}</td>
                    <td>
                      {pct === null || !n.enabled ? '-' : (
                        <span className={`nf-load ${pct > 95 ? 'bad' : pct > 80 ? 'warn' : 'good'}`}>
                          {pct}%
                        </span>
                      )}
                    </td>
                    <td>{li && n.enabled ? `${Math.round(li.cpu)}%` : '-'}</td>
                    <td>
                      <StatusChip
                        level={n.enabled ? 'good' : 'bad'}
                        label={n.enabled ? 'Running' : 'Down'}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* 알람 */}
        <div className="nms-section">
          <div className="section-label">{pick(lang, '알람 (최근)', 'Alarms (recent)', '告警 (最近)')}</div>
          <div className="nms-alarms">
            {alarms.length === 0 && (
              <div className="log-empty">{pick(lang, '알람 없음', 'No alarms', '无告警')}</div>
            )}
            {alarms.map((a) => (
              <div key={a.id} className={`nms-alarm ${a.level}`}>
                <StatusChip
                  level={a.level === 'error' ? 'bad' : 'warn'}
                  label={a.level === 'error' ? pick(lang, '심각', 'Critical', '严重') : pick(lang, '경고', 'Warning', '警告')}
                />
                <span className="log-time">{a.time}</span>
                {a.node && <span className="log-node">{a.node}</span>}
                <span className="alarm-msg">{a.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

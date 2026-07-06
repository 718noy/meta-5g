// 걷기 모드 폰 HUD — 드라이브테스트 툴 스타일 측정 화면.
// 전원 토글, 셀 측정(RSRP/RSRQ/SINR/CQI), 서빙셀 정보(밴드/ARFCN), 트래픽 시뮬레이션.
import { useState } from 'react'
import * as api from '../api'
import { rsrpColorCss } from '../colormap'
import { pick, useT } from '../i18n'
import { useStore } from '../store'
import { computeE2E, computeRoamingPath, suciOf, supiOf } from '../types'
import { WALK_UE } from './UeTracePanel'

function bars(rsrp: number): number {
  if (rsrp >= -65) return 4
  if (rsrp >= -80) return 3
  if (rsrp >= -95) return 2
  if (rsrp >= -108) return 1
  return 0
}

export function SignalHUD() {
  const t = useT()
  const mode = useStore((s) => s.mode)
  const probe = useStore((s) => s.probe)
  const ueOn = useStore((s) => s.ueOn)
  const toggleUe = useStore((s) => s.toggleUe)
  const trafficActive = useStore((s) => s.trafficActive)
  const toggleTraffic = useStore((s) => s.toggleTraffic)
  const trafficMbps = useStore((s) => s.trafficMbps)
  const trafficMb = useStore((s) => s.trafficMb)
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const siteDown = useStore((s) => s.siteDown)
  const ueZone = useStore((s) => s.ueZone)
  const ueSim = useStore((s) => s.ueSim)
  const setUeSim = useStore((s) => s.setUeSim)
  const setProcedureUe = useStore((s) => s.setProcedureUe)
  const setTraceUe = useStore((s) => s.setTraceUe)
  const bumpPanel = useStore((s) => s.bumpPanel)
  const lang = useStore((s) => s.lang)
  const homeZone = useStore((s) => s.homeZone)
  const [showSim, setShowSim] = useState(false)
  const [showSvc, setShowSvc] = useState(false)

  if (mode !== 'walk') return null

  const roaming = ueZone != null && ueZone !== homeZone
  const e2e = roaming
    ? computeRoamingPath(objects, coreNfs, coreDn, ueZone, homeZone, siteDown)
    : computeE2E(objects, coreNfs, coreDn, ueZone ?? homeZone, siteDown)
  const rsrp = probe?.rsrp_dbm
  const n = rsrp != null ? bars(rsrp) : 0
  const rrcState = !ueOn ? '-' : trafficActive ? 'RRC-CONNECTED' : 'RRC-IDLE'

  return (
    <div className="hud panel">
      <div className="hud-title">
        {t('hud_title')}
        {roaming && ueOn && <span className="roam-badge">✈ VPLMN-{ueZone}</span>}
        <button className={`power-btn ${ueOn ? 'on' : ''}`} onClick={toggleUe}
          title={pick(lang, '단말 전원 on/off — 켜면 셀 탐색·등록 시작', 'UE power on/off — powering on starts cell search & registration', '终端开关机 — 开机开始搜网·注册')}>
          ⏻
        </button>
      </div>

      {!ueOn ? (
        <div className="hud-nosig">{t('power_off')}</div>
      ) : probe && rsrp != null ? (
        <>
          <div className="hud-bars">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`bar b${i} ${i < n ? 'on' : ''}`} />
            ))}
            <span className="serving">{probe.serving_name ?? '-'}</span>
            <span className="hud-band">
              {probe.band} · {probe.bandwidth_mhz?.toFixed(0)}MHz
            </span>
          </div>

          <div className="hud-grid">
            <div className="hud-metric">
              <span>RSRP</span>
              <b style={{ color: rsrpColorCss(rsrp) }}>{rsrp.toFixed(1)}</b>
              <em>dBm</em>
            </div>
            <div className="hud-metric">
              <span>RSRQ</span>
              <b>{probe.rsrq_db?.toFixed(1)}</b>
              <em>dB</em>
            </div>
            <div className="hud-metric">
              <span>SINR</span>
              <b>{probe.sinr_db?.toFixed(1)}</b>
              <em>dB</em>
            </div>
            <div className="hud-metric">
              <span>CQI</span>
              <b>{probe.cqi}</b>
              <em>/15</em>
            </div>
          </div>

          <div className="hud-row">
            <span>NR-ARFCN {probe.nr_arfcn}</span>
            <span className={trafficActive ? 'rrc-conn' : ''}>{rrcState}</span>
          </div>

          <div className="hud-traffic">
            <button
              className={`traffic-btn ${trafficActive ? 'stop' : ''}`}
              disabled={!e2e.ok && !trafficActive}
              title={e2e.ok ? pick(lang, '데이터 트래픽(PDU 세션) 생성 시작/중지', 'Start/stop generating data traffic (PDU session)', '开始/停止生成数据流量(PDU会话)') : `${t('session_blocked')} ${e2e.missing.join(', ')}`}
              onClick={toggleTraffic}
            >
              {trafficActive ? t('traffic_stop') : t('traffic_start')}
            </button>
            {trafficActive && (
              <div className="traffic-stats">
                <b>{trafficMbps.toFixed(0)}</b> Mbps · {t('cumulative')} {trafficMb.toFixed(1)} MB
              </div>
            )}
            {!e2e.ok && !trafficActive && (
              <div className="traffic-blocked">
                {t('session_blocked')} {e2e.missing.join(', ')}
              </div>
            )}
          </div>

          {probe.cells.length > 1 && (
            <div className="hud-cells">
              {(() => {
                const servingGnb = objects.find((o) => o.kind === 'gnb' && o.name === probe.serving_name)
                const ca = servingGnb?.gnb?.ca_enabled
                const nonServ = probe.cells.filter((c) => c.id !== probe.serving).sort((a, b) => b.rsrp_dbm - a.rsrp_dbm)
                const scellId = ca && nonServ[0] ? nonServ[0].id : null
                return probe.cells.map((c) => {
                  const role = c.id === probe.serving ? 'P' : c.id === scellId ? 'S' : ''
                  return (
                    <div key={c.id} className={`hud-cell ${c.id === probe.serving ? 'serving' : ''}`}>
                      <span>
                        {role && <em className={`cell-role ${role === 'P' ? 'p' : 's'}`}>{role === 'P' ? 'PCell' : 'SCell'}</em>}{' '}{c.name}
                      </span>
                      <span>{c.rsrp_dbm.toFixed(0)}</span>
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </>
      ) : (
        <div className="hud-nosig">{t('no_signal')}</div>
      )}
      {/* 절차 상세 버튼 */}
      {ueOn && probe && rsrp != null && (
        <button className="proc-btn" onClick={() => setProcedureUe('walk')}
          title={pick(lang, '걷는 단말의 E2E 경로(UE→gNB→…→DN)를 노드별로 표시', 'Show the walking UE\'s E2E path (UE→gNB→…→DN) per node', '显示行走终端的端到端路径(UE→gNB→…→DN)及各节点')}>
          🔗 {pick(lang, '절차 상세 (Call Flow)', 'Procedure (Call Flow)', '流程详情 (Call Flow)')}
        </button>
      )}

      {/* 걷는 단말의 콜플로우 추적 — SIM(defaultImsi)으로 태그된 시그널링을 시간순 래더로 */}
      <button
        className="proc-btn"
        onClick={() => { setTraceUe(WALK_UE); bumpPanel('uetrace') }}
        title={pick(lang,
          '걷는 단말(이 SIM)이 유발한 시그널링(등록·이동성·핸드오버·서비스요청·통화)을 시간순으로 보기',
          "See the walking UE's signaling (attach, mobility, handover, service request, call) time-ordered",
          '按时间顺序查看行走终端(此SIM)引发的信令(注册·移动性·切换·业务请求·通话)')}>
        🪜 {pick(lang, '콜플로우 추적 (Walk UE)', 'Call-flow trace (Walk UE)', '呼叫流程追踪 (行走终端)')}
      </button>

      {/* 서비스모드 (*#0011# 스타일) — 실제 RAN 파라미터가 그대로 표시됨 */}
      {ueOn && probe && rsrp != null && (
        <div className="hud-sim">
          <button className="sim-toggle" onClick={() => setShowSvc(!showSvc)}
            title={pick(lang, '서비스모드(*#0011#) — 실제 RAN 파라미터 상세 펼치기/접기', 'ServiceMode (*#0011#) — expand/collapse detailed RAN parameters', '工程模式(*#0011#) — 展开/收起详细RAN参数')}>
            📶 ServiceMode {showSvc ? '▾' : '▸'}
          </button>
          {showSvc && (
            <div className="svc-grid">
              <span>Home PLMN</span><b>{ueSim.mcc}-{ueSim.mnc}</b>
              <span>Reg PLMN</span><b>{ueZone ? `PLMN-${ueZone}` : 'NO SVC'}</b>
              <span>RRC</span><b>{rrcState}</b>
              <span>Band</span><b>{probe.band}</b>
              <span>NR-ARFCN</span><b>{probe.nr_arfcn}</b>
              <span>PCI</span><b>{probe.pci}</b>
              <span>CellID</span><b>{probe.cell_id}</b>
              <span>TAC</span><b>{probe.tac}</b>
              <span>BW / SCS</span><b>{probe.bandwidth_mhz?.toFixed(0)}MHz / {probe.scs_khz}kHz</b>
              <span>SSB idx</span><b>{probe.ssb_idx}</b>
              <span>SSB-RSRP</span><b>{rsrp.toFixed(1)} dBm</b>
              <span>RSRQ</span><b>{probe.rsrq_db?.toFixed(1)} dB</b>
              <span>RSSI</span><b>{probe.rssi_dbm?.toFixed(1)} dBm</b>
              <span>SINR (DL)</span><b>{probe.sinr_db?.toFixed(1)} dB</b>
              <span>SINR (UL)</span><b>{probe.ul_sinr_db?.toFixed(1)} dB</b>
              <span>PRACH</span>
              <b style={{ color: probe.rach_ok === false ? 'var(--bad)' : 'var(--ok)' }}>
                {probe.rach_ok === false ? 'FAIL' : `OK (${probe.rach_attempts}x)`}
              </b>
              <span>CQI / RI</span><b>{probe.cqi} / {probe.ri}</b>
              <span>MIMO</span><b>{probe.ri === 4 ? '4x4' : '2x2'}</b>
              {probe.latency_ms != null && (
                <>
                  <span>{pick(lang, '지연', 'Latency', '时延')}</span>
                  <b style={{ color: probe.over_pdb ? 'var(--bad)' : '#d7e3f4' }}>
                    {probe.latency_ms} ms{probe.pdb_ms ? ` /${probe.pdb_ms}` : ''}
                  </b>
                  <span>{pick(lang, '손실률', 'Loss', '丢包率')}</span>
                  <b style={{ color: (probe.packet_loss_pct ?? 0) > 1 ? 'var(--warn)' : '#d7e3f4' }}>
                    {probe.packet_loss_pct}%
                  </b>
                  <span>{pick(lang, '지터', 'Jitter', '抖动')}</span><b>{probe.jitter_ms} ms</b>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* SIM / 가입자 식별 (SUPI ↔ SUCI) */}
      <div className="hud-sim">
        <button className="sim-toggle" onClick={() => setShowSim(!showSim)}
          title={pick(lang, 'SIM/가입자 식별(SUPI↔SUCI) 편집 패널 펼치기/접기', 'Expand/collapse SIM & subscriber identity (SUPI↔SUCI) editor', '展开/收起SIM及用户标识(SUPI↔SUCI)编辑')}>
          💳 SIM {showSim ? '▾' : '▸'}{' '}
          <span className={`sim-scheme ${ueSim.scheme}`}>
            {ueSim.scheme === 'null' ? 'IMSI 평문' : 'SUCI 은닉'}
          </span>
        </button>
        {showSim && (
          <div className="sim-body">
            <div className="sim-id">SUPI: {supiOf(ueSim)}</div>
            <div className="sim-id suci">SUCI: {suciOf(ueSim)}</div>
            <div className="sim-fields">
              <label title={pick(lang, '이동국 국가 코드(MCC) — 홈 PLMN 국가', 'Mobile Country Code — home PLMN country', '移动国家码(MCC) — 归属PLMN国家')}>MCC<input value={ueSim.mcc} maxLength={3}
                onChange={(e) => setUeSim({ mcc: e.target.value.replace(/\D/g, '') })} /></label>
              <label title={pick(lang, '이동망 코드(MNC) — 홈 PLMN 사업자', 'Mobile Network Code — home PLMN operator', '移动网络码(MNC) — 归属PLMN运营商')}>MNC<input value={ueSim.mnc} maxLength={3}
                onChange={(e) => setUeSim({ mnc: e.target.value.replace(/\D/g, '') })} /></label>
              <label title={pick(lang, '가입자 식별번호(MSIN) — IMSI의 가입자 부분', 'Mobile Subscriber ID Number — subscriber part of the IMSI', '移动用户识别码(MSIN) — IMSI的用户部分')}>MSIN<input value={ueSim.msin} maxLength={10}
                onChange={(e) => setUeSim({ msin: e.target.value.replace(/\D/g, '') })} /></label>
            </div>
            <label className="field" title={pick(lang, 'SUPI 보호 방식 — ECIES 은닉(SUCI) 또는 null(IMSI 평문 전송)', 'SUPI protection — ECIES concealment (SUCI) or null (cleartext IMSI)', 'SUPI保护方式 — ECIES隐藏(SUCI)或null(明文IMSI)')}>
              <span>{pick(lang, 'SUPI 보호', 'SUPI protection', 'SUPI 保护')}</span>
              <select value={ueSim.scheme}
                onChange={(e) => setUeSim({ scheme: e.target.value as 'null' | 'profileA' })}>
                <option value="profileA">ECIES Profile A</option>
                <option value="null">null-scheme ({pick(lang, '평문', 'cleartext', '明文')})</option>
              </select>
            </label>
            <button
              className="traffic-btn"
              title={pick(lang, '이 SIM을 WSL 실스택 가입자 DB에 등록하고 UE 재등록 실행', 'Provision this SIM to the WSL real-stack DB and re-register the UE', '将此SIM开通到WSL真实栈用户库并重新注册UE')}
              onClick={async () => {
                const st = useStore.getState()
                st.addEvent('UE', 'info', pick(lang, '⚙ 실스택에 SIM 적용 중…', '⚙ Applying SIM to real stack…', '⚙ 正在向真实栈应用 SIM…'))
                try {
                  const r = await api.p3UeApply(ueSim)
                  st.addEvent(
                    'UE',
                    r.ok ? 'info' : 'error',
                    r.ok
                      ? `⚙ 실스택 등록 성공 — ${r.imsi} (실스택 로그 탭에서 call flow 확인)`
                      : `⚙ 실스택 등록 실패 — ${r.error ?? pick(lang, '로그 확인', 'see logs', '查看日志')}`,
                  )
                } catch {
                  st.addEvent('UE', 'error', pick(lang, '백엔드 연결 실패', 'backend unreachable', '后端连接失败'))
                }
              }}
            >
              ⚙ {pick(lang, '실스택 적용 (진짜 재등록)', 'Apply to real stack', '应用到真实栈 (真实重新注册)')}
            </button>
            <div className="sim-note">
              {pick(
                lang,
                '적용 시: 가입자 DB 등록 → UE 재기동 → 실제 5G 등록. 로그 패널 "실스택" 탭에서 관찰',
                'On apply: subscriber DB → UE restart → real 5G registration. Watch in Real Stack logs',
                '应用时: 注册用户数据库 → UE 重启 → 真实 5G 注册。在日志面板 "真实栈" 标签中观察',
              )}
            </div>
          </div>
        )}
      </div>

      <div className="hud-help">{t('hud_help')}</div>
    </div>
  )
}

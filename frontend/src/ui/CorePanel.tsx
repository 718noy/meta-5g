// 논리 Core 구성 패널 — NF는 실물 배치 없이 국가(PLMN-A/B) 소속만 선택.
// NF 추가/삭제, 존 이동, 레플리카/HA/HPA/가동 제어, DN 연결.
import { useState } from 'react'
import { NF_DESC, pick, useT } from '../i18n'
import { useStore } from '../store'
import { frontRef } from './zorder'
import { usePanelDrag } from './panelDrag'
import type { CoreNf, NfType, RanUnit, SceneObject, Zone } from '../types'
import { DEFAULT_MAX_REPLICAS, NF_CAPACITY_PER_POD, NF_INFO, NF_TYPES, ZONES, activeNf, objZone } from '../types'

function NfRow({ nf }: { nf: CoreNf }) {
  const updateCoreNf = useStore((s) => s.updateCoreNf)
  const removeCoreNf = useStore((s) => s.removeCoreNf)
  const lang = useStore((s) => s.lang)
  const loadInfo = useStore((s) => s.nfLoads[nf.id])
  const [open, setOpen] = useState(false)
  const coreNfs = useStore((s) => s.coreNfs)
  const siteDown = useStore((s) => s.siteDown)

  const loadPct = loadInfo ? Math.round(loadInfo.load * 100) : null
  const loadClass = loadPct === null ? '' : loadPct > 95 ? 'bad' : loadPct > 80 ? 'warn' : 'good'
  const siblings = coreNfs.filter((n) => n.zone === nf.zone && n.nf_type === nf.nf_type)
  const active = activeNf(coreNfs, nf.zone, nf.nf_type, siteDown)
  const siteIsDown = siteDown[nf.site]
  const isActive = active?.id === nf.id
  // 다중 인스턴스일 때만 active/standby 개념 표시
  const roleBadge = siteIsDown
    ? { t: 'SITE-DOWN', c: 'bad' }
    : !nf.enabled
      ? { t: 'DOWN', c: 'bad' }
      : siblings.length >= 2
        ? isActive
          ? { t: pick(lang, '활성', 'ACTIVE', '活动'), c: 'good' }
          : { t: pick(lang, '대기', 'STANDBY', '待机'), c: 'warn' }
        : null

  return (
    <div className={`nf-row ${nf.enabled && !siteIsDown ? '' : 'off'}`}>
      <div className="nf-row-head" onClick={() => setOpen(!open)}>
        <span className="nf-dot" style={{ background: NF_INFO[nf.nf_type].color }} />
        <b>{nf.name}</b>
        {roleBadge && <span className={`nf-role-badge ${roleBadge.c}`}>{roleBadge.t}</span>}
        {nf.enabled && !siteIsDown && loadPct !== null && (
          <span className={`nf-load ${loadClass}`}>{loadPct}%</span>
        )}
        <span className="nf-meta">
          ×{nf.replicas} · P{nf.priority} · {nf.site}
          {nf.ha === 'geo-red' ? ' GR' : nf.ha === 'active-standby' ? ' AS' : ''}
        </span>
        <input
          type="checkbox"
          checked={nf.enabled}
          title={pick(lang, '가동', 'Running', '运行')}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => updateCoreNf(nf.id, { enabled: e.target.checked })}
        />
        <button
          className="log-btn"
          title={pick(lang, '이 NF 인스턴스 삭제', 'Delete this NF instance', '删除此 NF 实例')}
          onClick={(e) => {
            e.stopPropagation()
            removeCoreNf(nf.id)
          }}
        >
          ✕
        </button>
      </div>
      {open && (
        <div className="nf-row-body">
          {/* NF 설명 박스 — 아래 설정 레이블과 시각적으로 구분 (PART 10) */}
          <div className="nf-desc-box">{NF_DESC[lang][nf.nf_type]}</div>
          <label className="field" title={pick(lang, '이 NF의 파드(인스턴스) 수 — 늘리면 처리용량 증가', 'Number of pods (instances) for this NF — more = higher capacity', '此NF的Pod(实例)数 — 越多容量越大')}>
            <span>Replicas</span>
            <input
              type="number"
              value={nf.replicas}
              min={1}
              max={64}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!Number.isNaN(v))
                  updateCoreNf(nf.id, { replicas: Math.min(Math.max(v, 1), 64) })
              }}
            />
          </label>
          {/* HPA — Replicas 바로 아래 + 최대 replicas 상한 (PART 10) */}
          <label className="field checkbox" title={pick(lang, '부하 초과 시 파드 자동 증설(오토스케일)', 'Auto-scale: add pods automatically when load is high', '负载超限时自动扩容Pod(自动伸缩)')}>
            <span>HPA (auto-scale)</span>
            <input
              type="checkbox"
              checked={nf.auto_scale}
              onChange={(e) => updateCoreNf(nf.id, { auto_scale: e.target.checked })}
            />
          </label>
          {nf.auto_scale && (
            <label className="field">
              <span>{pick(lang, '최대 replicas', 'Max replicas', '最大replicas')}</span>
              <input
                type="number"
                value={nf.max_replicas ?? DEFAULT_MAX_REPLICAS}
                min={Math.max(nf.replicas, 1)}
                max={128}
                title={pick(lang, 'HPA가 이 값까지만 스케일아웃', 'HPA scales out up to this', 'HPA最多扩容到此值')}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { max_replicas: Math.min(Math.max(v, 1), 128) })
                }}
              />
            </label>
          )}
          <label className="field" title={pick(lang, '고가용성 방식 — Active-Standby(대기 이중화) 또는 Geo-Redundancy(사이트 이중화)', 'High-availability mode — Active-Standby or Geo-Redundancy (site failover)', '高可用方式 — Active-Standby 或 Geo-Redundancy(站点冗余)')}>
            <span>HA</span>
            <select
              value={nf.ha}
              onChange={(e) => updateCoreNf(nf.id, { ha: e.target.value as CoreNf['ha'] })}
            >
              <option value="none">none</option>
              <option value="active-standby">Active-Standby</option>
              <option value="geo-red">Geo-Redundancy</option>
            </select>
          </label>
          {/* NRF priority 와 Site는 무관 — 각각 별도 줄 (PART 10) */}
          <label className="field">
            <span>{pick(lang, 'NRF priority', 'NRF priority', 'NRF优先级')}</span>
            <input
              type="number"
              value={nf.priority}
              min={1}
              max={99}
              title={pick(lang, '낮을수록 우선 선택 (warm-standby는 높게)', 'lower = preferred', '越低越优先')}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!Number.isNaN(v)) updateCoreNf(nf.id, { priority: Math.min(Math.max(v, 1), 99) })
              }}
            />
          </label>
          <label className="field" title={pick(lang, '이 NF가 배치된 데이터센터(사이트) — 사이트 장애 시 절체 대상', 'Data-center site hosting this NF — subject to site-failure failover', '此NF所在数据中心(站点) — 站点故障时的切换对象')}>
            <span>{pick(lang, '사이트 (Site)', 'Site', '站点')}</span>
            <select
              value={nf.site}
              onChange={(e) => updateCoreNf(nf.id, { site: e.target.value as 'A' | 'B' })}
            >
              <option value="A">Site A</option>
              <option value="B">Site B</option>
            </select>
          </label>
          {NF_CAPACITY_PER_POD[nf.nf_type] && (
            <>
              <label className="field" title={pick(lang, '파드 1개가 감당하는 최대 용량 — HPA 스케일 판정 기준', 'Max capacity one pod can handle — drives HPA scaling decisions', '单个Pod可承载的最大容量 — HPA伸缩判定依据')}>
                <span>
                  {pick(lang, '파드당 용량', 'Capacity/pod', '每Pod容量')}{' '}
                  <em>({NF_CAPACITY_PER_POD[nf.nf_type]!.metric})</em>
                </span>
                <input
                  type="number"
                  value={nf.capacity_per_pod ?? NF_CAPACITY_PER_POD[nf.nf_type]!.value}
                  min={1}
                  max={10000000}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v) && v > 0)
                      updateCoreNf(nf.id, { capacity_per_pod: v })
                  }}
                />
              </label>
              {/* 파드당 처리량 (UL+DL 합) — HPA 스케일 판정에 사용 (PART 10) */}
              <label className="field" title={pick(lang, '파드 1개의 처리량 한계(UL+DL 합) — HPA 스케일 판정에 사용', 'Per-pod throughput limit (UL+DL) — used for HPA scaling', '单Pod吞吐上限(UL+DL) — 用于HPA伸缩判定')}>
                <span>
                  {pick(lang, '파드당 처리량', 'Throughput/pod', '每Pod吞吐')}{' '}
                  <em>(Mbps UL+DL)</em>
                </span>
                <input
                  type="number"
                  value={nf.throughput_per_pod ?? 5000}
                  min={1}
                  max={10000000}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v) && v > 0)
                      updateCoreNf(nf.id, { throughput_per_pod: v })
                  }}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ZoneCore({ zone }: { zone: Zone }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const addCoreNf = useStore((s) => s.addCoreNf)
  const setCoreDn = useStore((s) => s.setCoreDn)
  const ranArch = useStore((s) => s.ranArch)
  const setRanArch = useStore((s) => s.setRanArch)
  const homeZone = useStore((s) => s.homeZone)
  const slices = useStore((s) => s.slices)
  const addSlice = useStore((s) => s.addSlice)
  const removeSlice = useStore((s) => s.removeSlice)
  const [addType, setAddType] = useState<NfType>('AMF')
  const [addSst, setAddSst] = useState(1)

  const nfs = coreNfs.filter((n) => n.zone === zone)
  const isHome = zone === homeZone
  // 존별 올바른 PLMN 라벨(A/B/C) + 홈/방문 역할 (PART 10 버그 수정)
  const roleTxt = isHome
    ? pick(lang, '홈', 'Home', '归属')
    : pick(lang, '방문', 'Visited', '拜访')

  return (
    <div className={`zone-core zone-${zone}`}>
      <div className="zone-core-head">
        🌐 PLMN-{zone} ({roleTxt})
      </div>
      {/* RAN 아키텍처 — DU/CU는 논리 구성 (실물 배치 없음) */}
      <label className="field" title={pick(lang, 'RAN 아키텍처 — 일체형 gNB 또는 CU/DU 분리(F1) 논리 구성', 'RAN architecture — monolithic gNB or split CU/DU (F1)', 'RAN架构 — 一体式gNB或CU/DU分离(F1)')}>
        <span>{pick(lang, 'RAN 구성', 'RAN arch', 'RAN 架构')}</span>
        <select
          value={ranArch[zone]}
          onChange={(e) => setRanArch(zone, e.target.value as 'gnb' | 'cu-du')}
        >
          <option value="gnb">{pick(lang, '일체형 gNB', 'Monolithic gNB', '一体式 gNB')}</option>
          <option value="cu-du">{pick(lang, 'CU-DU 분리 (F1)', 'CU-DU split (F1)', 'CU-DU 分离 (F1)')}</option>
        </select>
      </label>

      {/* Core 구성 — AMF/SMF/UPF 등 NF 목록 (PART 10) */}
      <div className="section-label" style={{ marginBottom: 2 }}>
        {pick(lang, 'Core 구성', 'Core config', 'Core 配置')}
      </div>
      <div className="nf-add-row core">
        <select value={addType} onChange={(e) => setAddType(e.target.value as NfType)}
          title={pick(lang, '추가할 네트워크 기능(NF) 종류 선택 (AMF/SMF/UPF…)', 'Pick the Network Function type to add (AMF/SMF/UPF…)', '选择要添加的网络功能(NF)类型 (AMF/SMF/UPF…)')}>
          {NF_TYPES.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button onClick={() => addCoreNf(zone, addType)}
          title={pick(lang, `선택한 NF를 PLMN-${zone}에 인스턴스로 추가`, `Add the selected NF as an instance in PLMN-${zone}`, `将所选NF作为实例添加到PLMN-${zone}`)}>
          + {pick(lang, 'NF 추가', 'Add NF', '添加 NF')}
        </button>
      </div>
      {nfs.length === 0 && (
        <div className="log-empty">{pick(lang, 'NF 없음', 'No NFs', '无 NF')}</div>
      )}
      {nfs.map((nf) => (
        <NfRow key={nf.id} nf={nf} />
      ))}
      <label className="field checkbox dn-row" title={pick(lang, '데이터망(DN/인터넷) 연결 — 끄면 UPF 이후 외부망 도달 불가', 'Data Network (internet) link — off means no reach beyond UPF', '数据网(DN/互联网)连接 — 关闭则UPF之后无法到达外网')}>
        <span>DN ({pick(lang, '외부망 연결', 'external network', '外部网络连接')})</span>
        <input
          type="checkbox"
          checked={coreDn[zone]}
          onChange={(e) => setCoreDn(zone, e.target.checked)}
        />
      </label>

      {/* 네트워크 슬라이스 (S-NSSAI) */}
      <div className="section-label" style={{ marginTop: 6 }}>
        {pick(lang, '네트워크 슬라이스 (S-NSSAI)', 'Network Slices', '网络切片 (S-NSSAI)')}
      </div>
      {slices.filter((s) => s.zone === zone).map((s) => (
        <div key={s.id} className="nf-row">
          <div className="nf-row-head">
            <span className="nf-dot" style={{ background: '#7ad6ff' }} />
            <b>{s.name}</b>
            <span className="nf-meta">SST={s.sst} · SD={s.sd}</span>
            <button className="log-btn" onClick={() => removeSlice(s.id)} title={pick(lang, '이 슬라이스 삭제', 'Delete this slice', '删除此切片')}>✕</button>
          </div>
        </div>
      ))}
      <div className="nf-add-row slice">
        <select value={addSst} onChange={(e) => setAddSst(parseInt(e.target.value))}
          title={pick(lang, '슬라이스 종류(SST) 선택 — eMBB(대역폭)·URLLC(초저지연)·MIoT(대량IoT)', 'Slice type (SST) — eMBB, URLLC (ultra-low latency), MIoT (massive IoT)', '切片类型(SST) — eMBB·URLLC(超低时延)·MIoT(海量IoT)')}>
          <option value={1}>SST 1 · eMBB</option>
          <option value={2}>SST 2 · URLLC</option>
          <option value={3}>SST 3 · MIoT</option>
        </select>
        <button onClick={() => addSlice(zone, addSst, '0000' + (10 + addSst))}
          title={pick(lang, '선택한 종류의 네트워크 슬라이스(S-NSSAI) 추가', 'Add a network slice (S-NSSAI) of the selected type', '添加所选类型的网络切片(S-NSSAI)')}>
          + {pick(lang, '슬라이스', 'Slice', '切片')}
        </button>
      </div>
      <div className="material-note" style={{ marginTop: 6 }}>
        {t('upf_note')}
      </div>
    </div>
  )
}

export function CorePanel() {
  const showCore = useStore((s) => s.showCore)
  const setShowCore = useStore((s) => s.setShowCore)
  const lang = useStore((s) => s.lang)
  const ueSim = useStore((s) => s.ueSim)
  const { dragStyle, headerProps } = usePanelDrag()

  if (!showCore) return null

  return (
    <div className="corepanel panel" ref={frontRef} style={dragStyle}>
      <div className="log-head" {...headerProps}>
        <span className="section-label">
          ☁ {pick(lang, '5G Core 구성 (논리)', '5G Core Configuration (logical)', '5G 核心网配置 (逻辑)')}
        </span>
        <button
          className="log-btn"
          title={pick(
            lang,
            'SIM의 PLMN을 실스택(Open5GS 전 NF + gNB/UE)에 반영하고 재기동',
            'Apply SIM PLMN to real stack and restart',
            '将 SIM 的 PLMN 应用到真实栈 (Open5GS 全 NF + gNB/UE) 并重启',
          )}
          onClick={async () => {
            const st = useStore.getState()
            st.addEvent('SIM', 'info', `⚙ PLMN ${ueSim.mcc}/${ueSim.mnc} 실스택 반영 중… (전 NF 재기동)`)
            try {
              const { p3ApplyPlmn } = await import('../api')
              const r = await p3ApplyPlmn(ueSim.mcc, ueSim.mnc)
              st.addEvent(
                'SIM',
                r.ok ? 'info' : 'error',
                r.ok ? '⚙ PLMN 실스택 반영 완료' : '⚙ PLMN 반영 실패 — 실스택 로그 확인',
              )
            } catch {
              st.addEvent('SIM', 'error', 'backend unreachable')
            }
          }}
        >
          ⚙ PLMN {pick(lang, '실스택 동기화', 'sync to stack', '同步到真实栈')}
        </button>
        <button className="log-btn" onClick={() => setShowCore(false)} title={pick(lang, 'Core 구성 패널 닫기', 'Close Core config panel', '关闭核心网配置面板')}>✕</button>
      </div>
      <SiteFailureBar />
      <div className="corepanel-body">
        {ZONES.map((z) => (
          <ZoneCore key={z} zone={z} />
        ))}
      </div>
      <MobilitySection />
      <RanSection />
      <ImsiRegistrySection />
    </div>
  )
}

// PART 10/13: IMSI 레지스트리 — UDM/UDR 가입자 프로비저닝. 임의 IMSI 등록 + 목록/삭제.
function ImsiRegistrySection() {
  const lang = useStore((s) => s.lang)
  const registeredImsis = useStore((s) => s.registeredImsis)
  const addImsi = useStore((s) => s.addImsi)
  const removeImsi = useStore((s) => s.removeImsi)
  const ueSim = useStore((s) => s.ueSim)
  const defaultI = `${ueSim.mcc}${ueSim.mnc}${ueSim.msin}`
  const [draft, setDraft] = useState('')

  const commit = () => {
    const v = draft.trim()
    if (v) { addImsi(v); setDraft('') }
  }

  return (
    <div className="zone-core" style={{ marginTop: 10 }}>
      <div className="zone-core-head">
        🪪 {pick(lang, 'IMSI 등록 (UDM/UDR 가입자 프로비저닝)', 'IMSI Registry (UDM/UDR provisioning)', 'IMSI 注册 (UDM/UDR 签约开通)')}
      </div>
      <div className="nf-add-row core">
        <input
          type="text"
          value={draft}
          maxLength={15}
          placeholder={pick(lang, 'IMSI 14~15자리', 'IMSI (14-15 digits)', 'IMSI 14~15位')}
          style={{ flex: 1 }}
          title={pick(lang, '등록할 IMSI 입력 (미등록 IMSI는 등록 거부됨)', 'Enter an IMSI to provision (unregistered IMSIs are rejected)', '输入要开通的IMSI (未注册IMSI将被拒绝)')}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        />
        <button onClick={commit} title={pick(lang, 'UDM/UDR 가입자 DB에 이 IMSI 프로비저닝', 'Provision this IMSI into the UDM/UDR subscriber DB', '将此IMSI开通到UDM/UDR用户数据库')}>+ {pick(lang, '등록', 'Register', '注册')}</button>
      </div>
      <div className="imsi-list">
        {registeredImsis.map((im) => {
          const isDefault = im === defaultI
          return (
            <div key={im} className="imsi-item">
              <span className="nf-dot" style={{ background: isDefault ? '#2bd680' : '#7ad6ff' }} />
              <b>{im}</b>
              {isDefault && (
                <span className="nf-meta">{pick(lang, '측정요원 기본 SIM', 'default test SIM', '测试人员默认SIM')}</span>
              )}
              {!isDefault && (
                <button className="log-btn" onClick={() => removeImsi(im)} title={pick(lang, '가입자 DB에서 이 IMSI 등록 해제', 'De-provision this IMSI from the subscriber DB', '从用户数据库注销此IMSI')}>✕</button>
              )}
            </div>
          )
        })}
      </div>
      <div className="material-note">
        {pick(lang,
          '측정요원 생성 시 기본 SIM의 IMSI는 자동 등록됩니다. 여기에 등록되지 않은 IMSI는 Registration Reject(#3 Illegal UE)로 거부됩니다.',
          'A test UE\'s default SIM IMSI is auto-registered. IMSIs not listed here are rejected with Registration Reject (#3 Illegal UE).',
          '测试人员创建时其默认SIM的IMSI会自动注册。未在此登记的IMSI将被 Registration Reject (#3 Illegal UE) 拒绝。')}
      </div>
    </div>
  )
}

// 사이트(데이터센터) 장애 토글 — geo-redundancy 절체를 실제로 발생시킴
function SiteFailureBar() {
  const lang = useStore((s) => s.lang)
  const siteDown = useStore((s) => s.siteDown)
  const setSiteDown = useStore((s) => s.setSiteDown)
  return (
    <div className="site-fail-bar">
      <span className="section-label" style={{ margin: 0 }}>
        {pick(lang, '사이트 장애 (geo-red 절체)', 'Site failure (geo-red)', '站点故障 (geo切换)')}
      </span>
      {(['A', 'B'] as const).map((s) => (
        <button
          key={s}
          className={`site-fail-btn ${siteDown[s] ? 'down' : ''}`}
          onClick={() => setSiteDown(s, !siteDown[s])}
          title={pick(lang, `${s} 사이트를 강제 다운/복구`, `force site ${s} down/up`, `强制站点${s}宕机/恢复`)}
        >
          {siteDown[s] ? '⚠' : '●'} Site {s} {siteDown[s] ? pick(lang, '장애', 'DOWN', '故障') : pick(lang, '정상', 'up', '正常')}
        </button>
      ))}
    </div>
  )
}

// ─── RAN 구성 (RAN Configuration) ──────────────────────────────────────────
// 존별로 무선접속망(RAN)을 Core NF 목록과 동일한 방식으로 관리한다.
//   CU(RRC/PDCP) — DU(RLC/MAC/PHY-High, F1로 CU에 연결) — RU(gNB/eNB, 프론트홀로 DU에 연결)
// CU/DU는 논리 유닛(ranUnits), RU는 실물 라디오(objects, kind='gnb').

// CU 행 — 이름 + 가동 토글 + 삭제 + 소속 DU 수 상태
function RanCuRow({ cu }: { cu: RanUnit }) {
  const lang = useStore((s) => s.lang)
  const ranUnits = useStore((s) => s.ranUnits)
  const toggleRanUnit = useStore((s) => s.toggleRanUnit)
  const removeRanUnit = useStore((s) => s.removeRanUnit)
  const duCount = ranUnits.filter((u) => u.kind === 'du' && u.cu_id === cu.id).length
  return (
    <div className={`nf-row ${cu.enabled ? '' : 'off'}`}>
      <div className="nf-row-head">
        <span className="nf-dot" style={{ background: '#3da9ff' }} />
        <b>{cu.name}</b>
        <span className="nf-meta">
          {pick(lang, `DU ${duCount}개 연결`, `${duCount} DU linked`, `连接 ${duCount} 个DU`)}
        </span>
        <input
          type="checkbox"
          checked={cu.enabled}
          title={pick(lang, '이 CU 가동/정지', 'Enable/disable this CU', '启用/停用此CU')}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRanUnit(cu.id)}
        />
        <button
          className="log-btn"
          title={pick(lang, '이 CU 삭제 (소속 DU의 F1 링크 해제)', 'Delete this CU (clears F1 links of its DUs)', '删除此CU (解除其DU的F1链路)')}
          onClick={(e) => { e.stopPropagation(); removeRanUnit(cu.id) }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// DU 행 — 클릭 시 설정 펼침: 연결 CU / F1 지연 / 최대 셀 + 연결 RU 상태
function RanDuRow({ du }: { du: RanUnit }) {
  const [open, setOpen] = useState(false)
  const lang = useStore((s) => s.lang)
  const ranUnits = useStore((s) => s.ranUnits)
  const objects = useStore((s) => s.objects)
  const updateRanUnit = useStore((s) => s.updateRanUnit)
  const removeRanUnit = useStore((s) => s.removeRanUnit)
  const toggleRanUnit = useStore((s) => s.toggleRanUnit)
  const cus = ranUnits.filter((u) => u.kind === 'cu' && u.zone === du.zone)
  const parentCu = cus.find((c) => c.id === du.cu_id)
  const connectedRus = objects.filter((o) => o.kind === 'gnb' && o.gnb?.du_id === du.id)
  return (
    <div className={`nf-row ${du.enabled ? '' : 'off'}`}>
      <div className="nf-row-head" onClick={() => setOpen(!open)}>
        <span className="nf-dot" style={{ background: '#3dffd2' }} />
        <b>{du.name}</b>
        <span className="nf-meta">
          {parentCu ? `→ ${parentCu.name}` : pick(lang, 'CU 미연결', 'no CU', '未连CU')} · RU {connectedRus.length}
        </span>
        <input
          type="checkbox"
          checked={du.enabled}
          title={pick(lang, '이 DU 가동/정지', 'Enable/disable this DU', '启用/停用此DU')}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRanUnit(du.id)}
        />
        <button
          className="log-btn"
          title={pick(lang, '이 DU 삭제 (연결 RU의 프론트홀 해제)', 'Delete this DU (clears fronthaul of its RUs)', '删除此DU (解除其RU的前传)')}
          onClick={(e) => { e.stopPropagation(); removeRanUnit(du.id) }}
        >
          ✕
        </button>
      </div>
      {open && (
        <div className="nf-row-body">
          <label className="field" title={pick(lang, '이 DU가 F1로 연결될 상위 CU (RRC/PDCP 종단)', 'Upper CU this DU connects to over F1 (RRC/PDCP)', '此DU通过F1连接的上级CU (RRC/PDCP)')}>
            <span>{pick(lang, '연결 CU', 'Linked CU', '连接CU')}</span>
            <select
              value={du.cu_id ?? ''}
              onChange={(e) => updateRanUnit(du.id, { cu_id: e.target.value || undefined })}
            >
              <option value="">{pick(lang, '(없음)', '(none)', '(无)')}</option>
              {cus.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="field" title={pick(lang, 'F1(CU-DU) 인터페이스 지연 — 중앙집중 배치의 전송 지연', 'F1 (CU-DU) interface latency — transport delay of centralized deployment', 'F1(CU-DU)接口时延 — 集中化部署的传输时延')}>
            <span>F1 {pick(lang, '지연', 'latency', '时延')} <em>(ms)</em></span>
            <input
              type="number"
              value={du.f1_latency_ms ?? 2}
              min={0}
              max={50}
              step={0.5}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!Number.isNaN(v)) updateRanUnit(du.id, { f1_latency_ms: Math.min(Math.max(v, 0), 50) })
              }}
            />
          </label>
          <label className="field" title={pick(lang, '이 DU가 수용하는 셀(RU) 수 상한', 'Max number of cells (RUs) this DU can host', '此DU可承载的小区(RU)数上限')}>
            <span>{pick(lang, '최대 셀', 'Max cells', '最大小区')}</span>
            <input
              type="number"
              value={du.max_cells ?? 4}
              min={1}
              max={64}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!Number.isNaN(v)) updateRanUnit(du.id, { max_cells: Math.min(Math.max(v, 1), 64) })
              }}
            />
          </label>
          <div className="material-note">
            {connectedRus.length === 0
              ? pick(lang, '연결된 RU 없음 — RU 목록에서 "연결 DU"로 이 DU를 선택하세요.', 'No RUs connected — pick this DU as "Linked DU" in the RU list.', '无连接RU — 在RU列表中将此DU选为"连接DU"。')
              : pick(lang,
                  `연결 RU (${connectedRus.length}/${du.max_cells ?? 4}): `,
                  `Connected RUs (${connectedRus.length}/${du.max_cells ?? 4}): `,
                  `连接RU (${connectedRus.length}/${du.max_cells ?? 4}): `) + connectedRus.map((r) => r.name).join(', ')}
          </div>
        </div>
      )}
    </div>
  )
}

// RU 행 — gNB/eNB 태그 + 전파 표시 + 연결 DU 선택 + 전체 설정 열기(RU 선택)
function RanRuRow({ ru }: { ru: SceneObject }) {
  const lang = useStore((s) => s.lang)
  const ranUnits = useStore((s) => s.ranUnits)
  const updateGnb = useStore((s) => s.updateGnb)
  const select = useStore((s) => s.select)
  const g = ru.gnb
  if (!g) return null
  const isNr = g.radio_tech === 'nr'
  const dus = ranUnits.filter((u) => u.kind === 'du' && u.zone === objZone(ru))
  const linkedDu = dus.find((d) => d.id === g.du_id)
  return (
    <div className={`nf-row ${g.enabled ? '' : 'off'}`}>
      <div className="nf-row-head">
        <span
          className="nf-dot"
          title={g.enabled ? pick(lang, '전파 송출 중', 'Transmitting', '正在发射') : pick(lang, '전파 정지', 'TX off', '停止发射')}
          style={{ background: g.enabled ? '#2bd680' : '#ff6b6b' }}
        />
        <b>{ru.name}</b>
        <span
          style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: isNr ? '#1b3a5c' : '#5c3a1b', color: isNr ? '#7ad6ff' : '#ffb14d' }}
        >
          {isNr ? 'gNB' : 'eNB'}
        </span>
        <span className="nf-meta">
          {linkedDu ? `→ ${linkedDu.name}` : pick(lang, 'DU 미연결', 'no DU', '未连DU')}
        </span>
        <select
          value={g.du_id ?? ''}
          title={pick(lang, '이 RU가 프론트홀로 연결될 DU', 'DU this RU connects to over fronthaul', '此RU通过前传连接的DU')}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => updateGnb(ru.id, { du_id: e.target.value || undefined })}
        >
          <option value="">{pick(lang, 'DU 없음', 'no DU', '无DU')}</option>
          {dus.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button
          className="log-btn"
          title={pick(lang, '이 RU의 전체 무선 파라미터 설정 열기 (주파수·출력·안테나…)', 'Open this RU’s full radio settings (freq/power/antenna…)', '打开此RU的全部无线参数设置 (频率·功率·天线…)')}
          onClick={() => select(ru.id)}
        >
          ⚙
        </button>
      </div>
    </div>
  )
}

// 존별 RAN 구성 — CU / DU / RU(gNB/eNB) 3개 그룹 + 존별 추가 버튼
function RanZone({ zone }: { zone: Zone }) {
  const lang = useStore((s) => s.lang)
  const ranUnits = useStore((s) => s.ranUnits)
  const objects = useStore((s) => s.objects)
  const addRanUnit = useStore((s) => s.addRanUnit)
  const addRadio = useStore((s) => s.addRadio)

  const cus = ranUnits.filter((u) => u.kind === 'cu' && u.zone === zone)
  const dus = ranUnits.filter((u) => u.kind === 'du' && u.zone === zone)
  const rus = objects.filter((o) => o.kind === 'gnb' && objZone(o) === zone)

  const subLabel = { marginTop: 6, marginBottom: 2 }

  return (
    <div className={`zone-core zone-${zone}`}>
      <div className="zone-core-head">
        📡 PLMN-{zone} · RAN
      </div>

      {/* 존별 추가 버튼 — gNB/eNB(실물 RU) + CU/DU(논리 유닛) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        <button className="log-btn" onClick={() => addRadio('nr', zone)}
          title={pick(lang, `PLMN-${zone}에 5G NR 기지국(gNB) 추가`, `Add a 5G NR radio (gNB) to PLMN-${zone}`, `向PLMN-${zone}添加5G NR基站(gNB)`)}>
          ＋gNB
        </button>
        <button className="log-btn" onClick={() => addRadio('lte', zone)}
          title={pick(lang, `PLMN-${zone}에 4G LTE 기지국(eNB) 추가`, `Add a 4G LTE radio (eNB) to PLMN-${zone}`, `向PLMN-${zone}添加4G LTE基站(eNB)`)}>
          ＋eNB
        </button>
        <button className="log-btn" onClick={() => addRanUnit('cu', zone)}
          title={pick(lang, `PLMN-${zone}에 CU(RRC/PDCP) 추가`, `Add a CU (RRC/PDCP) to PLMN-${zone}`, `向PLMN-${zone}添加CU(RRC/PDCP)`)}>
          ＋CU
        </button>
        <button className="log-btn" onClick={() => addRanUnit('du', zone)}
          title={pick(lang, `PLMN-${zone}에 DU(RLC/MAC/PHY-High) 추가`, `Add a DU (RLC/MAC/PHY-High) to PLMN-${zone}`, `向PLMN-${zone}添加DU(RLC/MAC/PHY-High)`)}>
          ＋DU
        </button>
      </div>

      {/* CU 그룹 */}
      <div className="section-label" style={subLabel}>
        CU <em>(RRC/PDCP)</em>
      </div>
      {cus.length === 0
        ? <div className="log-empty">{pick(lang, 'CU 없음', 'No CU', '无 CU')}</div>
        : cus.map((cu) => <RanCuRow key={cu.id} cu={cu} />)}

      {/* DU 그룹 */}
      <div className="section-label" style={subLabel}>
        DU <em>(RLC/MAC/PHY-High · F1)</em>
      </div>
      {dus.length === 0
        ? <div className="log-empty">{pick(lang, 'DU 없음', 'No DU', '无 DU')}</div>
        : dus.map((du) => <RanDuRow key={du.id} du={du} />)}

      {/* RU 그룹 */}
      <div className="section-label" style={subLabel}>
        RU (gNB/eNB) <em>({pick(lang, '실물 라디오', 'physical radio', '实物无线')})</em>
      </div>
      {rus.length === 0
        ? <div className="log-empty">{pick(lang, 'RU 없음', 'No RU', '无 RU')}</div>
        : rus.map((ru) => <RanRuRow key={ru.id} ru={ru} />)}
    </div>
  )
}

// RAN 구성 섹션 — MobilitySection과 동일하게 corepanel 하단에 배치. 존별 RanZone 나열.
function RanSection() {
  const lang = useStore((s) => s.lang)
  return (
    <div className="zone-core" style={{ marginTop: 10 }}>
      <div className="zone-core-head">
        📡 {pick(lang, 'RAN 구성 (무선접속망)', 'RAN Configuration', 'RAN 配置')}
      </div>
      <div className="corepanel-body">
        {ZONES.map((z) => (
          <RanZone key={z} zone={z} />
        ))}
      </div>
      <div className="material-note" style={{ marginTop: 6 }}>
        {pick(lang,
          'RAN 계층: RU(gNB/eNB, 실물 라디오) → 프론트홀 → DU(RLC/MAC/PHY-High) → F1 → CU(RRC/PDCP). RU의 "연결 DU", DU의 "연결 CU"로 상위 노드에 연결합니다. gNB/eNB는 존별 ＋버튼으로 추가하고 ⚙로 전체 무선 파라미터를 엽니다.',
          'RAN hierarchy: RU (gNB/eNB, physical radio) → fronthaul → DU (RLC/MAC/PHY-High) → F1 → CU (RRC/PDCP). Attach an RU to a DU via its "Linked DU", and a DU to a CU via its "Linked CU". Add gNB/eNB with the per-zone ＋buttons and open full radio params with ⚙.',
          'RAN 层级: RU(gNB/eNB, 实物无线) → 前传 → DU(RLC/MAC/PHY-High) → F1 → CU(RRC/PDCP)。通过RU的"连接DU"、DU的"连接CU"连接上级节点。用各区的＋按钮添加gNB/eNB，用⚙打开全部无线参数。')}
      </div>
    </div>
  )
}

// 이동성 일괄 설정 — 전역 A3/CIO 값을 모든 RU에 일괄 적용. 걷기 모드 핸드오버 판정에도 적용됨.
function MobilitySection() {
  const lang = useStore((s) => s.lang)
  const mobility = useStore((s) => s.mobility)
  const setMobility = useStore((s) => s.setMobility)
  const bulkApplyMobility = useStore((s) => s.bulkApplyMobility)

  const MOB_TIP: Record<string, [string, string, string]> = {
    a3_offset_db: ['A3 오프셋 — 이웃셀이 서빙셀보다 이만큼 강해야 핸드오버 후보', 'A3 offset — neighbor must exceed serving by this to trigger handover', 'A3偏置 — 邻区须比服务小区强此值才触发切换'],
    hysteresis_db: ['히스테리시스 — 핑퐁 방지용 여유 마진', 'Hysteresis — margin to prevent ping-pong handovers', '迟滞 — 防止乒乓切换的余量'],
    ttt_ms: ['TimeToTrigger — 조건이 이 시간 지속돼야 핸드오버', 'TimeToTrigger — condition must hold this long before handover', 'TimeToTrigger — 条件须持续此时长才切换'],
    cio_db: ['셀 개별 오프셋(CIO) — 셀 경계 미세 조정', 'Cell Individual Offset — fine-tune cell boundary', '小区独立偏置(CIO) — 微调小区边界'],
    a2_threshold_dbm: ['A2 임계 — 서빙셀이 이 아래로 떨어지면 측정 시작', 'A2 threshold — start measurements when serving drops below this', 'A2门限 — 服务小区低于此值时开始测量'],
    t310_ms: ['T310 — 하향품질 저하 지속 시 만료→무선링크실패(RLF)', 'T310 — expires on sustained poor downlink → Radio Link Failure', 'T310 — 下行质量持续变差超时→无线链路失败(RLF)'],
    n310: ['N310 — RLF 판정 전 연속 불량 지시 횟수', 'N310 — consecutive out-of-sync indications before RLF', 'N310 — 判定RLF前连续失步次数'],
    call_drop_rsrp_dbm: ['통화드롭 RSRP — 이 세기 아래로 떨어지면 통화 끊김', 'Call-drop RSRP — call drops when signal falls below this', '掉话RSRP — 信号低于此值时通话中断'],
  }
  const num = (label: string, key: keyof typeof mobility, min: number, max: number, step: number, unit: string) => (
    <label className="field" title={MOB_TIP[key as string] ? pick(lang, MOB_TIP[key as string][0], MOB_TIP[key as string][1], MOB_TIP[key as string][2]) : undefined}>
      <span>{label} <em>({unit})</em></span>
      <input
        type="number"
        value={mobility[key]}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) setMobility({ [key]: Math.min(Math.max(v, min), max) })
        }}
      />
    </label>
  )

  return (
    <div className="zone-core" style={{ marginTop: 10 }}>
      <div className="zone-core-head">
        📶 {pick(lang, '이동성 일괄 설정 (A3 이벤트)', 'Mobility — bulk settings (A3 event)', '移动性 — 一键设置 (A3 事件)')}
      </div>
      <div className="mobility-row">
        {num('A3 Offset', 'a3_offset_db', 0, 15, 0.5, 'dB')}
        {num('Hysteresis', 'hysteresis_db', 0, 15, 0.5, 'dB')}
        {num('TimeToTrigger', 'ttt_ms', 0, 5120, 40, 'ms')}
      </div>
      <div className="mobility-row">
        {num('CIO', 'cio_db', -24, 24, 0.5, 'dB')}
        {num('A2 임계', 'a2_threshold_dbm', -140, -60, 1, 'dBm')}
        {num('T310 (RLF)', 't310_ms', 0, 8000, 100, 'ms')}
      </div>
      <div className="mobility-row">
        {num('N310', 'n310', 1, 20, 1, '회')}
        {/* 통화드롭 RSRP — 라벨 바로 오른쪽에 입력 (PART 10) */}
        {num(pick(lang, '통화드롭', 'Call-drop', '掉话'), 'call_drop_rsrp_dbm', -140, -80, 1, 'dBm')}
        <span className="mobility-filler" />
      </div>
      <button className="mobility-apply" onClick={bulkApplyMobility}
        title={pick(lang, '위 A3/CIO/TTT 값을 모든 RU에 한 번에 반영', 'Push the A3/CIO/TTT values above to every RU at once', '将上面的A3/CIO/TTT值一次性下发到所有RU')}>
        📶 {pick(lang, '모든 RU에 일괄 적용', 'Apply to all RUs', '应用到所有 RU')}
      </button>
      <div className="material-note">
        {pick(
          lang,
          'A3(핸드오버): 이웃 셀 RSRP가 (서빙 + Offset + Hysteresis)를 TTT 시간만큼 넘어서면 핸드오버하며, 셀별 CIO로 경계를 미세 조정합니다. A2: 서빙 셀이 임계 아래로 떨어지면 측정을 시작합니다. T310/N310: 하향 무선품질 저하가 지속되면 T310이 만료되어 무선링크 실패(RLF)로 판정합니다. TTT를 낮추면 핑퐁 핸드오버가, 임계를 높이면 조기 핸드오버가 로그에 나타납니다. [일괄 적용]은 위 A3/CIO 값을 모든 RU에 한 번에 반영합니다.',
          'A3 (handover): triggers when a neighbor\'s RSRP stays above (serving + Offset + Hysteresis) for the TTT duration; per-cell CIO fine-tunes the boundary. A2: starts measurements once the serving cell drops below the threshold. T310/N310: sustained poor downlink expires T310, declaring Radio Link Failure (RLF). Lowering TTT surfaces ping-pong handovers; raising the threshold surfaces early handovers in the logs. "Apply to all RUs" pushes the A3/CIO values above to every RU at once.',
          'A3(切换): 当邻区 RSRP 在 TTT 时长内持续高于 (服务小区 + Offset + Hysteresis) 时触发切换，并用每小区 CIO 微调边界。A2: 服务小区低于门限时开始测量。T310/N310: 下行质量持续变差使 T310 超时，判定无线链路失败(RLF)。减小 TTT 会出现乒乓切换，提高门限会出现过早切换。"应用到所有 RU" 将上面的 A3/CIO 值一次性下发到每个 RU。',
        )}
      </div>
    </div>
  )
}

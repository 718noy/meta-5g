// 논리 Core 구성 패널 — NF는 실물 배치 없이 국가(PLMN-A/B) 소속만 선택.
// NF 추가/삭제, 존 이동, 레플리카/HA/HPA/가동 제어, DN 연결.
import { Fragment, useState } from 'react'
import { NF_DESC, pick, useT } from '../i18n'
import { useStore } from '../store'
import { frontRef } from './zorder'
import { usePanelDrag } from './panelDrag'
import { GnbRfFields, GnbDuFields, GnbCuFields } from './ParamsPanel'
import type { CoreNf, NfType, RanUnit, SceneObject, Zone } from '../types'
import { DEFAULT_MAX_REPLICAS, NF_CAPACITY_PER_POD, NF_INFO, NF_TYPES, ZONES, activeNf, nfUp, objZone } from '../types'

function NfRow({ nf }: { nf: CoreNf }) {
  const updateCoreNf = useStore((s) => s.updateCoreNf)
  const removeCoreNf = useStore((s) => s.removeCoreNf)
  const lang = useStore((s) => s.lang)
  const loadInfo = useStore((s) => s.nfLoads[nf.id])
  const [open, setOpen] = useState(false)
  const [imsiOpen, setImsiOpen] = useState(false)
  const coreNfs = useStore((s) => s.coreNfs)
  const siteDown = useStore((s) => s.siteDown)
  // QoS 정책은 PCF가 저작(TS 23.501 §5.7), UE-AMBR은 UDM 가입 데이터(§5.7.1.6)
  const qos = useStore((s) => s.qos)
  const setQos = useStore((s) => s.setQos)
  const subscription = useStore((s) => s.subscription)
  const setSubscription = useStore((s) => s.setSubscription)

  const loadPct = loadInfo ? Math.round(loadInfo.load * 100) : null
  const loadClass = loadPct === null ? '' : loadPct > 95 ? 'bad' : loadPct > 80 ? 'warn' : 'good'
  const hasNssf = coreNfs.some((n) => n.nf_type === 'NSSF')
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
          {/* AMF 전용 접속 제어(admission) — TS 24.501 §5.5.1 / TS 23.501 §5.19.5 */}
          {nf.nf_type === 'AMF' && (
            <>
              <label className="field" title={pick(lang, 'AMF 등록 UE 상한(0=무제한). 초과 시 Registration Reject #22 혼잡 + T3346 백오프. TS 24.501 §5.5.1.', 'AMF max registered UE (0=unlimited). Excess → Registration Reject #22 Congestion + T3346 back-off. TS 24.501 §5.5.1.', 'AMF注册UE上限(0=无限). 超出→Registration Reject #22拥塞 + T3346退避。TS 24.501 §5.5.1。')}>
                <span>{pick(lang, '최대 등록 UE', 'Max registered UE', '最大注册UE')} <em>(0=∞)</em></span>
                <input
                  type="number"
                  value={nf.max_registered_ue ?? 0}
                  min={0}
                  max={10000000}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!Number.isNaN(v)) updateCoreNf(nf.id, { max_registered_ue: Math.max(v, 0) })
                  }}
                />
              </label>
              <label className="field" title={pick(lang, '주기적 등록 타이머 T3512(분). Registration Accept에 전달. TS 24.501.', 'Periodic registration timer T3512 (min), delivered in Registration Accept. TS 24.501.', '周期注册定时器T3512(分), 在Registration Accept中传递。TS 24.501。')}>
                <span>T3512 <em>(min)</em></span>
                <input
                  type="number"
                  value={nf.t3512_min ?? 54}
                  min={1}
                  max={1080}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!Number.isNaN(v)) updateCoreNf(nf.id, { t3512_min: Math.min(Math.max(v, 1), 1080) })
                  }}
                />
              </label>
              <label className="field" title={pick(lang, '암시적 디레지스트레이션 타이머(분, 0=무제한). T3512 만료 후 UE 무응답 시 AMF가 암묵적으로 등록 해제. TS 23.501 §5.3.4.', 'Implicit de-registration timer (min, 0=unlimited). After T3512 expiry with no UE response, AMF implicitly de-registers the UE. TS 23.501 §5.3.4.', '隐式去注册定时器(分, 0=无限). T3512超时后UE无响应时AMF隐式去注册。TS 23.501 §5.3.4。')}>
                <span>{pick(lang, '암시적 디레지', 'Implicit de-reg', '隐式去注册')} <em>(min, 0=∞)</em></span>
                <input
                  type="number"
                  value={nf.implicit_dereg_min ?? 0}
                  min={0}
                  max={100000}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!Number.isNaN(v)) updateCoreNf(nf.id, { implicit_dereg_min: Math.max(v, 0) })
                  }}
                />
              </label>
              {/* NSSF 부재 시 AMF에서 max_allowed_nssai 편집 가능(폴백) — TS 23.501 §5.15.4 */}
              {!hasNssf && (
                <label className="field" title={pick(lang, '동시 허용 S-NSSAI 최대(NSSF 부재 시 AMF 폴백). 초과분은 Allowed-NSSAI에서 배제, 전부 배제 시 Registration Reject #62. TS 23.501 §5.15.4.', 'Max simultaneously allowed S-NSSAIs (AMF fallback when no NSSF). Excess dropped from Allowed-NSSAI; if all dropped → Registration Reject #62. TS 23.501 §5.15.4.', '同时允许S-NSSAI最大数(无NSSF时AMF回退). 超出的从Allowed-NSSAI排除, 全部排除→Registration Reject #62。TS 23.501 §5.15.4。')}>
                  <span>{pick(lang, '최대 허용 S-NSSAI', 'Max allowed S-NSSAI', '最大允许S-NSSAI')}</span>
                  <input
                    type="number"
                    value={nf.max_allowed_nssai ?? 8}
                    min={1}
                    max={16}
                    onChange={(e) => {
                      const v = parseInt(e.target.value)
                      if (!Number.isNaN(v)) updateCoreNf(nf.id, { max_allowed_nssai: Math.min(Math.max(v, 1), 16) })
                    }}
                  />
                </label>
              )}
            </>
          )}
          {/* SMF 전용 PDU 세션 상한 — TS 23.501 §5.6 */}
          {nf.nf_type === 'SMF' && (
            <>
              <label className="field" title={pick(lang, 'SMF PDU 세션 상한(0=무제한). 초과 시 5GSM #26 Insufficient resources. TS 23.501 §5.6.', 'SMF max PDU sessions (0=unlimited). Excess → 5GSM #26 Insufficient resources. TS 23.501 §5.6.', 'SMF PDU会话上限(0=无限). 超出→5GSM #26 Insufficient resources。TS 23.501 §5.6。')}>
                <span>{pick(lang, '최대 PDU 세션', 'Max PDU sessions', '最大PDU会话')} <em>(0=∞)</em></span>
                <input
                  type="number"
                  value={nf.max_pdu_sessions ?? 0}
                  min={0}
                  max={10000000}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!Number.isNaN(v)) updateCoreNf(nf.id, { max_pdu_sessions: Math.max(v, 0) })
                  }}
                />
              </label>
              <label className="field" title={pick(lang, 'DNN 백오프 타이머 T3396(분, 0=미부가). 5GSM #26 리젝트에 부가되어 UE의 재시도를 억제(혼잡 완화). TS 24.501 §6.2.8.', 'DNN back-off timer T3396 (min, 0=not included). Attached to 5GSM #26 reject to throttle UE retries (congestion relief). TS 24.501 §6.2.8.', 'DNN退避定时器T3396(分, 0=不附加). 附加到5GSM #26拒绝以抑制UE重试(缓解拥塞)。TS 24.501 §6.2.8。')}>
                <span>T3396 <em>(min)</em></span>
                <input
                  type="number"
                  value={nf.t3396_min ?? 12}
                  min={0}
                  max={1440}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!Number.isNaN(v)) updateCoreNf(nf.id, { t3396_min: Math.min(Math.max(v, 0), 1440) })
                  }}
                />
              </label>
            </>
          )}
          {/* NRF 전용 NF-profile heartbeat TTL — TS 29.510 */}
          {nf.nf_type === 'NRF' && (
            <label className="field" title={pick(lang, 'NF-profile heartbeat TTL(초). 이 시간 내 heartbeat 미수신 시 NRF가 NF-profile을 SUSPENDED/삭제 → NF discovery에서 제외. TS 29.510.', 'NF-profile heartbeat TTL (sec). Missing a heartbeat within this window marks the NF-profile SUSPENDED/removed → excluded from NF discovery. TS 29.510.', 'NF-profile心跳TTL(秒). 此窗口内未收到心跳则NRF将NF-profile置为SUSPENDED/删除 → 从NF发现中排除。TS 29.510。')}>
              <span>{pick(lang, 'Heartbeat TTL', 'Heartbeat TTL', '心跳TTL')} <em>(sec)</em></span>
              <input
                type="number"
                value={nf.nrf_ttl_sec ?? 30}
                min={5}
                max={600}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { nrf_ttl_sec: Math.min(Math.max(v, 5), 600) })
                }}
              />
            </label>
          )}
          {/* NSSF 전용 동시 허용 S-NSSAI 최대 — TS 23.501 §5.15.4 */}
          {nf.nf_type === 'NSSF' && (
            <label className="field" title={pick(lang, '동시 허용 S-NSSAI 최대. 초과분은 Allowed-NSSAI에서 배제, 전부 배제 시 Registration Reject #62 No network slices available. TS 23.501 §5.15.4.', 'Max simultaneously allowed S-NSSAIs. Excess dropped from Allowed-NSSAI; if all dropped → Registration Reject #62 No network slices available. TS 23.501 §5.15.4.', '同时允许S-NSSAI最大数. 超出的从Allowed-NSSAI排除, 全部排除→Registration Reject #62 No network slices available。TS 23.501 §5.15.4。')}>
              <span>{pick(lang, '최대 허용 S-NSSAI', 'Max allowed S-NSSAI', '最大允许S-NSSAI')}</span>
              <input
                type="number"
                value={nf.max_allowed_nssai ?? 8}
                min={1}
                max={16}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { max_allowed_nssai: Math.min(Math.max(v, 1), 16) })
                }}
              />
            </label>
          )}
          {/* AUSF/UDM 전용 인증 장애 주입 — TS 33.501 5G-AKA */}
          {(nf.nf_type === 'AUSF' || nf.nf_type === 'UDM') && (
            <label className="field" title={pick(lang, '인증 장애 주입: mac→인증 응답 #20 MAC failure, sync→#21 synchronisation failure. 5G-AKA(TS 33.501). 기본 none(정상).', 'Authentication fault injection: mac→auth response #20 MAC failure, sync→#21 synchronisation failure. 5G-AKA (TS 33.501). Default none (normal).', '认证故障注入: mac→认证响应 #20 MAC failure, sync→#21 synchronisation failure。5G-AKA(TS 33.501)。默认none(正常)。')}>
              <span>{pick(lang, '인증 장애 주입', 'Auth fault', '认证故障注入')}</span>
              <select
                value={nf.auth_fail_mode ?? 'none'}
                onChange={(e) => updateCoreNf(nf.id, { auth_fail_mode: e.target.value as 'none' | 'mac' | 'sync' })}
              >
                <option value="none">{pick(lang, 'none (정상)', 'none (normal)', 'none (正常)')}</option>
                <option value="mac">mac · #20 MAC failure</option>
                <option value="sync">sync · #21 sync failure</option>
              </select>
            </label>
          )}
          {/* UPF/SMF 전용 PFCP N4 heartbeat 주기 — TS 29.244 */}
          {(nf.nf_type === 'UPF' || nf.nf_type === 'SMF') && (
            <label className="field" title={pick(lang, 'PFCP N4 heartbeat 주기(초). 0=꺼짐. 응답 없으면 N4 association 해제 → PDU 세션 해제. TS 29.244.', 'PFCP N4 heartbeat period (sec). 0=off. No response → N4 association released → PDU sessions dropped. TS 29.244.', 'PFCP N4心跳周期(秒). 0=关闭. 无响应则N4关联解除→PDU会话释放。TS 29.244。')}>
              <span>N4 heartbeat <em>(sec, 0=off)</em></span>
              <input
                type="number"
                value={nf.n4_heartbeat_sec ?? 0}
                min={0}
                max={600}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { n4_heartbeat_sec: Math.min(Math.max(v, 0), 600) })
                }}
              />
            </label>
          )}
          {/* SEPP 전용 N32 보안(handshake/cert) — TS 29.573 */}
          {nf.nf_type === 'SEPP' && (
            <label className="field checkbox" title={pick(lang, 'N32 handshake/cert 유효. 끄면 로밍 등록 실패 #11 PLMN not allowed. TS 29.573.', 'N32 handshake/cert valid. Off → roaming registration fails #11 PLMN not allowed. TS 29.573.', 'N32握手/证书有效. 关闭则漫游注册失败 #11 PLMN not allowed。TS 29.573。')}>
              <span>N32 secure</span>
              <input
                type="checkbox"
                checked={nf.sepp_n32_secure !== false}
                onChange={(e) => updateCoreNf(nf.id, { sepp_n32_secure: e.target.checked })}
              />
            </label>
          )}
          {/* CHF 전용 온라인 과금 quota — TS 32.290 */}
          {nf.nf_type === 'CHF' && (
            <label className="field" title={pick(lang, '온라인 과금 부여 quota(MB). 0=무제한. 소진 시 세션 종료. TS 32.290.', 'Online-charging granted quota (MB). 0=unlimited. Exhaustion → session termination. TS 32.290.', '在线计费授予配额(MB). 0=无限. 耗尽则会话终止。TS 32.290。')}>
              <span>{pick(lang, '과금 quota', 'Charging quota', '计费配额')} <em>(MB, 0=∞)</em></span>
              <input
                type="number"
                value={nf.chf_quota_mb ?? 0}
                min={0}
                max={1000000}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { chf_quota_mb: Math.min(Math.max(v, 0), 1000000) })
                }}
              />
            </label>
          )}
          {/* PCF 전용 기본 QoS-flow 5QI — TS 23.501 §5.7.4 */}
          {nf.nf_type === 'PCF' && (
            <label className="field" title={pick(lang, '기본 QoS-flow 5QI. TS 23.501 §5.7.4.', 'Default QoS-flow 5QI. TS 23.501 §5.7.4.', '默认QoS-flow 5QI。TS 23.501 §5.7.4。')}>
              <span>{pick(lang, '기본 5QI', 'Default 5QI', '默认5QI')}</span>
              <input
                type="number"
                value={nf.pcf_default_5qi ?? 9}
                min={1}
                max={255}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { pcf_default_5qi: Math.min(Math.max(v, 1), 255) })
                }}
              />
            </label>
          )}
          {/* PCF 전용 QoS 정책 — ARP 선점 / 도착 모델 / GBR 알림 / Reflective QoS. PCF가 QoS 정책 저작. TS 23.501 §5.7 */}
          {nf.nf_type === 'PCF' && (
            <>
              <label className="field checkbox" title={pick(lang, 'ARP 기반 선점 활성. 혼잡 시 높은 ARP 우선순위 GBR이 낮은 흐름을 선점. TS 23.501 §5.7.2.2. 기본 꺼짐.', 'Enable ARP-based pre-emption. Under congestion, higher-ARP GBR flows pre-empt lower ones. TS 23.501 §5.7.2.2. Default off.', '启用基于ARP的抢占. 拥塞时高ARP优先级GBR抢占低优先级流。TS 23.501 §5.7.2.2。默认关闭。')}>
                <span>{pick(lang, 'ARP 선점', 'ARP pre-emption', 'ARP抢占')}</span>
                <input
                  type="checkbox"
                  checked={qos.arp_preemption_enabled}
                  onChange={(e) => setQos({ arp_preemption_enabled: e.target.checked })}
                />
              </label>
              <label className="field" title={pick(lang, '트래픽 도착 모델: constant(고정)/poisson(변동)/onoff(버스트). 기본 constant.', 'Traffic arrival model: constant / poisson (variable) / onoff (bursty). Default constant.', '流量到达模型: constant(固定)/poisson(变动)/onoff(突发)。默认constant。')}>
                <span>{pick(lang, '도착 모델', 'Arrival model', '到达模型')}</span>
                <select
                  value={qos.arrival_model}
                  onChange={(e) => setQos({ arrival_model: e.target.value as 'constant' | 'poisson' | 'onoff' })}
                >
                  <option value="constant">constant</option>
                  <option value="poisson">poisson</option>
                  <option value="onoff">onoff</option>
                </select>
              </label>
              <label className="field checkbox" title={pick(lang, 'GBR Notification control: GFBR 미보장 시 RAN 알림(Npcf). TS 23.501 §5.7.2.4. 기본 꺼짐.', 'GBR Notification control: notify RAN (Npcf) when GFBR cannot be guaranteed. TS 23.501 §5.7.2.4. Default off.', 'GBR Notification control: GFBR无法保证时通知RAN(Npcf)。TS 23.501 §5.7.2.4。默认关闭。')}>
                <span>{pick(lang, 'GBR 알림 제어', 'GBR notify ctrl', 'GBR通知控制')}</span>
                <input
                  type="checkbox"
                  checked={qos.gbr_notify_control}
                  onChange={(e) => setQos({ gbr_notify_control: e.target.checked })}
                />
              </label>
              <label className="field checkbox" title={pick(lang, 'Reflective QoS(RQA): UL을 DL QFI로 반영 매핑. TS 23.501 §5.7.5. 기본 꺼짐.', 'Reflective QoS (RQA): reflect UL onto DL QFI mapping. TS 23.501 §5.7.5. Default off.', 'Reflective QoS(RQA): 将UL反射映射到DL QFI。TS 23.501 §5.7.5。默认关闭。')}>
                <span>{pick(lang, 'Reflective QoS', 'Reflective QoS', 'Reflective QoS')}</span>
                <input
                  type="checkbox"
                  checked={qos.reflective_qos}
                  onChange={(e) => setQos({ reflective_qos: e.target.checked })}
                />
              </label>
            </>
          )}
          {/* UDM 전용 가입 데이터 UE-AMBR — UE 전체 비-GBR 집계 대역 상한. TS 23.501 §5.7.1.6 */}
          {nf.nf_type === 'UDM' && (
            <label className="field" title={pick(lang, 'UE-AMBR: UE 전체 비-GBR 집계 대역 상한(0=무제한). UDM 가입 데이터. TS 23.501 §5.7.1.6.', 'UE-AMBR: aggregate non-GBR bandwidth cap across all of a UE\'s sessions (0=unlimited). UDM subscription data. TS 23.501 §5.7.1.6.', 'UE-AMBR: UE全部非GBR聚合带宽上限(0=无限). UDM签约数据。TS 23.501 §5.7.1.6。')}>
              <span>UE-AMBR <em>(Mbps, 0=∞)</em></span>
              <input
                type="number"
                value={subscription.ue_ambr_mbps}
                min={0}
                max={100000}
                step={1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!Number.isNaN(v)) setSubscription({ ue_ambr_mbps: Math.max(v, 0) })
                }}
              />
            </label>
          )}
          {/* UDM 전용 IMSI 등록 — UDM/UDR 가입자 프로비저닝. 버튼 클릭 시 목록+등록 UI 전개. */}
          {nf.nf_type === 'UDM' && (
            <>
              <button
                className="mobility-apply"
                onClick={() => setImsiOpen(!imsiOpen)}
                title={pick(lang, 'UDM/UDR 가입자 DB(IMSI) 프로비저닝 열기/닫기', 'Open/close UDM/UDR subscriber (IMSI) provisioning', '打开/关闭UDM/UDR用户(IMSI)开通')}
              >
                🪪 {pick(lang, 'IMSI 등록 (UDM/UDR 가입자 프로비저닝)', 'IMSI Registry (UDM/UDR provisioning)', 'IMSI 注册 (UDM/UDR 签约开通)')} {imsiOpen ? '▾' : '▸'}
              </button>
              {imsiOpen && <ImsiRegistrySection />}
            </>
          )}
          {/* AMF 전용 T3502 재시도 타이머 — TS 24.501 */}
          {nf.nf_type === 'AMF' && (
            <label className="field" title={pick(lang, 'T3502 재시도 타이머(분). #22 리젝트에 부가되어 UE 재시도 간격을 늘림. TS 24.501.', 'T3502 retry timer (min), attached to #22 reject to widen UE retry interval. TS 24.501.', 'T3502重试定时器(分). 附加到#22拒绝以拉长UE重试间隔。TS 24.501。')}>
              <span>T3502 <em>(min)</em></span>
              <input
                type="number"
                value={nf.t3502_min ?? 12}
                min={0}
                max={1440}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateCoreNf(nf.id, { t3502_min: Math.min(Math.max(v, 0), 1440) })
                }}
              />
            </label>
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
  const homeZone = useStore((s) => s.homeZone)
  const slices = useStore((s) => s.slices)
  const addSlice = useStore((s) => s.addSlice)
  const removeSlice = useStore((s) => s.removeSlice)
  const updateSlice = useStore((s) => s.updateSlice)
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
          <div className="nf-row-body">
            <label className="field" title={pick(lang, '슬라이스/서비스 유형(SST): 1=eMBB, 2=URLLC, 3=MIoT. TS 23.501 §5.15.2.', 'Slice/Service Type (SST): 1=eMBB, 2=URLLC, 3=MIoT. TS 23.501 §5.15.2.', '切片/服务类型(SST): 1=eMBB, 2=URLLC, 3=MIoT。TS 23.501 §5.15.2。')}>
              <span>SST</span>
              <select
                value={s.sst}
                onChange={(e) => updateSlice(s.id, { sst: parseInt(e.target.value) })}
              >
                <option value={1}>1 · eMBB</option>
                <option value={2}>2 · URLLC</option>
                <option value={3}>3 · MIoT</option>
              </select>
            </label>
            <label className="field" title={pick(lang, 'Slice Differentiator(SD) — 6자리 16진수. TS 23.003.', 'Slice Differentiator (SD) — 6 hex digits. TS 23.003.', 'Slice Differentiator(SD) — 6位十六进制。TS 23.003。')}>
              <span>SD</span>
              <input
                type="text"
                value={s.sd}
                maxLength={6}
                onChange={(e) => updateSlice(s.id, { sd: e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6) })}
              />
            </label>
            <label className="field" title={pick(lang, '슬라이스/세션 비-GBR 집계 대역 상한(Session-AMBR, 0=무제한). 초과분은 정책적 제한(스로틀). TS 23.501 §5.7.2.6.', 'Slice/session non-GBR aggregate bandwidth cap (Session-AMBR, 0=unlimited). Excess is policed/throttled. TS 23.501 §5.7.2.6.', '切片/会话非GBR聚合带宽上限(Session-AMBR, 0=无限). 超出部分被策略限速。TS 23.501 §5.7.2.6。')}>
              <span>Session-AMBR <em>(Mbps, 0=∞)</em></span>
              <input
                type="number"
                value={s.session_ambr_mbps ?? 0}
                min={0}
                max={100000}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!Number.isNaN(v)) updateSlice(s.id, { session_ambr_mbps: Math.max(v, 0) })
                }}
              />
            </label>
            <label className="field" title={pick(lang, '슬라이스 NSAC UE 수용 상한(0=무제한). 초과 시 PDU 세션 거부 5GSM #69 + T3585 백오프. TS 23.501 §5.15.11.', 'Slice NSAC max admitted UEs (0=unlimited). Excess → PDU session reject 5GSM #69 + T3585 back-off. TS 23.501 §5.15.11.', '切片NSAC UE容纳上限(0=无限). 超出→PDU会话拒绝 5GSM #69 + T3585退避。TS 23.501 §5.15.11。')}>
              <span>NSAC {pick(lang, '최대 UE', 'Max UE', '最大UE')} <em>(0=∞)</em></span>
              <input
                type="number"
                value={s.nsac_max_ues ?? 0}
                min={0}
                max={10000000}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!Number.isNaN(v)) updateSlice(s.id, { nsac_max_ues: Math.max(v, 0) })
                }}
              />
            </label>
            <label className="field" title={pick(lang, '슬라이스-AMBR: 슬라이스 집계 비-GBR 대역 상한(0=무제한). 초과분은 정책적 제한(스로틀). TS 23.501 §5.7.2.6.', 'Slice-AMBR: aggregate non-GBR bandwidth cap across the slice (0=unlimited). Excess is policed/throttled. TS 23.501 §5.7.2.6.', '切片-AMBR: 切片聚合非GBR带宽上限(0=无限). 超出部分被策略限速。TS 23.501 §5.7.2.6。')}>
              <span>Slice-AMBR <em>(Mbps, 0=∞)</em></span>
              <input
                type="number"
                value={s.slice_ambr_mbps ?? 0}
                min={0}
                max={100000}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!Number.isNaN(v)) updateSlice(s.id, { slice_ambr_mbps: Math.max(v, 0) })
                }}
              />
            </label>
            <label className="field" title={pick(lang, '이 슬라이스가 지원하는 5QI 목록. 목록 밖 5QI 요청 시 PDU 거부 #59. 비우면 전체 허용. TS 23.501 §5.7.', 'List of 5QIs this slice supports. Requesting a 5QI outside the list → PDU reject #59. Empty = allow all. TS 23.501 §5.7.', '此切片支持的5QI列表. 请求列表外的5QI时PDU拒绝 #59. 留空则全部允许。TS 23.501 §5.7。')}>
              <span>{pick(lang, '허용 5QI', 'Allowed 5QI', '允许5QI')} <em>({pick(lang, '쉼표구분, 비움=전체', 'comma-sep, empty=all', '逗号分隔, 空=全部')})</em></span>
              <input
                type="text"
                value={s.allowed_5qi?.join(',') ?? ''}
                placeholder={pick(lang, '예: 1,2,9', 'e.g. 1,2,9', '例: 1,2,9')}
                onChange={(e) => {
                  const parsed = e.target.value
                    .split(',')
                    .map((x) => parseInt(x.trim(), 10))
                    .filter((n) => !Number.isNaN(n))
                  updateSlice(s.id, { allowed_5qi: parsed })
                }}
              />
            </label>
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
          📡 {pick(lang, 'RAN/Core 구성', 'RAN/Core Configuration', 'RAN/Core 配置')}
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
      {/* 존별로 Core 구성 → RAN 구성을 한 블록으로 묶어 표시 */}
      <div className="corepanel-body">
        {ZONES.map((z) => (
          <Fragment key={z}>
            <ZoneCore zone={z} />
            <RanZone zone={z} />
          </Fragment>
        ))}
      </div>
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
  const [open, setOpen] = useState(false)
  const lang = useStore((s) => s.lang)
  const ranUnits = useStore((s) => s.ranUnits)
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const siteDown = useStore((s) => s.siteDown)
  const updateRanUnit = useStore((s) => s.updateRanUnit)
  const toggleRanUnit = useStore((s) => s.toggleRanUnit)
  const removeRanUnit = useStore((s) => s.removeRanUnit)
  const cuDuIds = ranUnits.filter((u) => u.kind === 'du' && u.cu_id === cu.id).map((d) => d.id)
  const duCount = cuDuIds.length
  // 이 CU 하위(연결된 DU들)에 프론트홀로 붙은 RU들 — CU 계층(RRC/이동성/PDCP) 파라미터 편집 대상
  const cuRus = objects.filter((o) => o.kind === 'gnb' && !!o.gnb?.du_id && cuDuIds.includes(o.gnb.du_id))

  const amfs = coreNfs.filter((n) => n.nf_type === 'AMF' && n.zone === cu.zone)
  const upfs = coreNfs.filter((n) => n.nf_type === 'UPF' && n.zone === cu.zone)
  const linkedAmf = cu.amf_id ? coreNfs.find((n) => n.id === cu.amf_id && n.nf_type === 'AMF') : undefined
  const linkedUpf = cu.upf_id ? coreNfs.find((n) => n.id === cu.upf_id && n.nf_type === 'UPF') : undefined
  const amfOk = linkedAmf ? nfUp(linkedAmf, siteDown) : false
  const upfOk = linkedUpf ? nfUp(linkedUpf, siteDown) : false
  const coreConnected = !!cu.amf_id && !!cu.upf_id

  return (
    <div className={`nf-row ${cu.enabled ? '' : 'off'}`}>
      <div className="nf-row-head" onClick={() => setOpen(!open)}>
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
      {open && (
        <div className="nf-row-body">
          <label className="field" title={pick(lang, 'N2/NGAP로 CU-CP가 연결되는 AMF', 'AMF that CU-CP connects to over N2/NGAP', 'CU-CP通过N2/NGAP连接的AMF')}>
            <span>{pick(lang, '연결 AMF (N2)', 'Linked AMF (N2)', '连接AMF (N2)')}</span>
            <select
              value={cu.amf_id ?? ''}
              onChange={(e) => updateRanUnit(cu.id, { amf_id: e.target.value || undefined })}
            >
              <option value="">{pick(lang, '(없음)', '(none)', '(无)')}</option>
              {amfs.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </label>
          <label className="field" title={pick(lang, 'N3/GTP-U로 CU-UP가 연결되는 UPF', 'UPF that CU-UP connects to over N3/GTP-U', 'CU-UP通过N3/GTP-U连接的UPF')}>
            <span>{pick(lang, '연결 UPF (N3)', 'Linked UPF (N3)', '连接UPF (N3)')}</span>
            <select
              value={cu.upf_id ?? ''}
              onChange={(e) => updateRanUnit(cu.id, { upf_id: e.target.value || undefined })}
            >
              <option value="">{pick(lang, '(없음)', '(none)', '(无)')}</option>
              {upfs.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </label>
          {coreConnected ? (
            <div className="material-note" style={{ color: amfOk && upfOk ? '#2bd680' : '#ff6b6b' }}>
              {amfOk && upfOk
                ? `✓ ${linkedAmf!.name} · ${linkedUpf!.name}`
                : `⚠ ${!amfOk ? pick(lang, 'AMF 미연결/비활성', 'AMF down/unlinked', 'AMF未连接/停用') : linkedAmf!.name}` +
                  ` · ${!upfOk ? pick(lang, 'UPF 미연결/비활성', 'UPF down/unlinked', 'UPF未连接/停用') : linkedUpf!.name}`}
            </div>
          ) : (
            <div className="material-note" style={{ color: '#ff6b6b' }}>
              {pick(lang,
                '⚠ CU가 Core에 미연결 → 이 CU 하위 RU들 트래픽/통화 불가',
                '⚠ CU not connected to Core → RUs under this CU cannot carry traffic/calls',
                '⚠ CU未连接到核心网 → 此CU下的RU无法承载流量/通话')}
            </div>
          )}
          {/* CU 계층(RRC/이동성/측정/PDCP) 파라미터 — 이 CU 하위 각 RU의 gnb 필드를 여기서 편집 (TS 38.401) */}
          {cuRus.length === 0 ? (
            <div className="material-note" style={{ borderLeft: '3px solid #ffb43d' }}>
              {pick(lang, '연결된 RU 없음', 'No connected RU', '无连接RU')}
            </div>
          ) : (
            cuRus.map((ru) => (
              <div key={ru.id}>
                {cuRus.length > 1 && (
                  <div className="section-label sub-bold">📡 {ru.name}</div>
                )}
                <GnbCuFields obj={ru} />
              </div>
            ))
          )}
        </div>
      )}
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
  const coreNfs = useStore((s) => s.coreNfs)
  const siteDown = useStore((s) => s.siteDown)
  const cus = ranUnits.filter((u) => u.kind === 'cu' && u.zone === du.zone)
  const parentCu = cus.find((c) => c.id === du.cu_id)
  const connectedRus = objects.filter((o) => o.kind === 'gnb' && o.gnb?.du_id === du.id)

  // CU를 통해 도달하는 Core(N2 AMF / N3 UPF) — 읽기 전용 표시
  const coreAmf = parentCu?.amf_id ? coreNfs.find((n) => n.id === parentCu.amf_id && n.nf_type === 'AMF') : undefined
  const coreUpf = parentCu?.upf_id ? coreNfs.find((n) => n.id === parentCu.upf_id && n.nf_type === 'UPF') : undefined
  const coreAmfOk = coreAmf ? nfUp(coreAmf, siteDown) : false
  const coreUpfOk = coreUpf ? nfUp(coreUpf, siteDown) : false
  const coreOk = !!parentCu && coreAmfOk && coreUpfOk
  const coreMissing = !parentCu
    ? pick(lang, 'CU 미연결', 'no CU', '未连CU')
    : !coreAmfOk
      ? pick(lang, 'CU→AMF 미연결', 'CU→AMF missing', 'CU→AMF未连接')
      : !coreUpfOk
        ? pick(lang, 'CU→UPF 미연결', 'CU→UPF missing', 'CU→UPF未连接')
        : ''
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
          <div className="material-note" style={{ color: coreOk ? '#2bd680' : '#ff6b6b' }}>
            {coreOk
              ? `→ ${parentCu!.name} → ${coreAmf!.name} (N2) · ${coreUpf!.name} (N3)`
              : `⚠ ${pick(lang, 'Core 미도달', 'Core unreachable', '核心网不可达')}: ${coreMissing}`}
          </div>
          {/* DU 계층(RLC/MAC/PHY-high·스케줄링) 파라미터 — 연결된 각 RU의 gnb 필드를 여기서 편집 (TS 38.401) */}
          {connectedRus.length === 0 ? (
            <div className="material-note" style={{ borderLeft: '3px solid #ffb43d' }}>
              {pick(lang, '연결된 RU 없음', 'No connected RU', '无连接RU')}
            </div>
          ) : (
            connectedRus.map((ru) => (
              <div key={ru.id}>
                {connectedRus.length > 1 && (
                  <div className="section-label sub-bold">📡 {ru.name}</div>
                )}
                <GnbDuFields obj={ru} />
              </div>
            ))
          )}
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
  const [open, setOpen] = useState(false)
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
          title={pick(lang, '이 RU의 전체 무선 파라미터 펼치기/접기 (주파수·출력·안테나·이동성…)', 'Expand/collapse this RU’s full radio params (freq/power/antenna/mobility…)', '展开/收起此RU的全部无线参数 (频率·功率·天线·移动性…)')}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▾ ⚙' : '▸ ⚙'}
        </button>
      </div>
      {open && (
        <div className="nf-row-body">
          {/* RU 행은 RF/PHY-low 필드만 편집 (TS 38.401 기능분할). DU/CU 필드는 각 DU/CU 행에서 편집. */}
          <GnbRfFields obj={ru} />
        </div>
      )}
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
  const ranArch = useStore((s) => s.ranArch)
  const setRanArch = useStore((s) => s.setRanArch)

  const cus = ranUnits.filter((u) => u.kind === 'cu' && u.zone === zone)
  const dus = ranUnits.filter((u) => u.kind === 'du' && u.zone === zone)
  const rus = objects.filter((o) => o.kind === 'gnb' && objZone(o) === zone)

  const subLabel = { marginTop: 6, marginBottom: 2 }

  return (
    <div className={`zone-core zone-${zone}`}>
      <div className="zone-core-head">
        📡 PLMN-{zone} · RAN
      </div>

      {/* RAN 아키텍처 — 일체형 gNB 또는 CU/DU 분리(F1) 논리 구성 (RAN config) */}
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

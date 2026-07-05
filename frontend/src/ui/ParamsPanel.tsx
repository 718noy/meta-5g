import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { rsrpColorCss } from '../colormap'
import { pick, useT } from '../i18n'
import { useStore } from '../store'
import { usePanelDrag } from './panelDrag'
import { frontRef } from './zorder'
import type { CableType, SceneObject, SuppServices } from '../types'
import {
  CABLE_TYPES,
  CATALOG,
  TRAFFIC_TYPES,
  defaultImsi,
  defaultScsForFr,
  feederLossDb,
  findAntennaFor,
  frOfBandClass,
  frOfFreq,
  bandClassOfFreq,
  getRadiator,
  imsiRegistered,
  objZone,
  trafficInfo,
  validScsForFr,
} from '../types'

// 모든 수치는 직접 입력 가능. min/max는 물리적으로 무의미한 값만 막는 넓은 한계.
function Num({
  label, value, min, max, step, unit, onChange, title,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
  title?: string
}) {
  return (
    <label className="field" title={title}>
      <span>
        {label} {unit && <em>({unit})</em>}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(Math.min(Math.max(v, min), max))
        }}
      />
    </label>
  )
}

function GnbParamsEditor({ obj }: { obj: SceneObject }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const updateGnb = useStore((s) => s.updateGnb)
  const ranUnits = useStore((s) => s.ranUnits)
  const g = obj.gnb!
  // 이 RU와 같은 존의 DU 목록 (프론트홀 연결 후보)
  const zoneDus = ranUnits.filter((u) => u.kind === 'du' && u.zone === objZone(obj))
  const linkedAnt = g.ru_type === 'passive' ? findAntennaFor(obj, objects) : undefined
  const rad = getRadiator(obj, objects)
  const feeder =
    rad && rad.feeder_len > 0 ? feederLossDb(rad.feeder_len, g.freq_mhz, rad.cable) : 0

  // FR 판정: NR은 실제 캐리어 주파수(≥24.25GHz=FR2)로 판정, LTE는 항상 FR1.
  // (n257 같은 mmWave 주파수를 고르면 즉시 FR2 SCS가 뜨도록 band_class가 아닌 freq 기준으로.)
  const fr = g.radio_tech === 'nr' ? frOfFreq(g.freq_mhz) : 'FR1'
  // 주파수 변경 시: FR에 맞춰 SCS 스냅 + band_class 동기화.
  const setFreq = (v: number) => {
    const nf = frOfFreq(v)
    updateGnb(obj.id, {
      freq_mhz: v,
      band_class: bandClassOfFreq(v),
      // 밴드 드롭다운과 동일하게: FR2(mmWave)면 빔포밍, FR1이면 sector 안테나로 동기화
      antenna: nf === 'FR2' ? 'beam' : 'sector',
      ...(validScsForFr(nf).includes(g.scs_khz) ? {} : { scs_khz: defaultScsForFr(nf) }),
    })
  }
  const validScs = validScsForFr(fr)
  // 무효한 (밴드, SCS) 조합이면 FR 기본값으로 스냅 (저장 데이터/외부 변경 방어).
  useEffect(() => {
    if (!validScs.includes(g.scs_khz)) {
      updateGnb(obj.id, { scs_khz: defaultScsForFr(fr) })
    }
  }, [fr, g.scs_khz, obj.id, updateGnb, validScs])

  return (
    <>
      <div className="section-label">{t('radio_params')}</div>
      {/* 전파 송출 On/Off — 가장 눈에 띄게(컬러 pill) 최상단에 배치 (item 6). g.enabled와 연동 */}
      <div
        className="field"
        title={pick(lang,
          '이 라디오의 전파 송출을 켜고 끕니다 — OFF면 방사하지 않아 커버리지에서 사라집니다',
          'Turn this radio\'s RF transmission on/off — OFF means it stops radiating and disappears from coverage',
          '开关此射频单元的电波发射 — 关闭则不辐射，将从覆盖中消失')}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 10px', margin: '4px 0 8px', borderRadius: 8,
          background: g.enabled ? 'rgba(61,214,140,0.16)' : 'rgba(255,77,77,0.14)',
          border: `1px solid ${g.enabled ? 'var(--ok, #3dd68c)' : 'var(--bad, #ff4d4d)'}`,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          📡 {pick(lang, '전파 송출 (Tx On/Off)', 'RF transmit', '射频发射')}
        </span>
        <button
          type="button"
          onClick={() => updateGnb(obj.id, { enabled: !g.enabled })}
          style={{
            minWidth: 68, padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
            fontWeight: 700, color: '#fff', border: 'none',
            background: g.enabled ? 'var(--ok, #3dd68c)' : 'var(--bad, #ff4d4d)',
          }}
        >
          {g.enabled ? pick(lang, 'ON 송출중', 'ON', 'ON 发射中') : pick(lang, 'OFF 꺼짐', 'OFF', 'OFF 关闭')}
        </button>
      </div>
      {/* 프론트홀 연결 DU — 같은 존의 DU 목록 (item 9, 라디오 측) */}
      <label className="field" title={pick(lang, '이 RU가 프론트홀로 연결되는 DU를 지정', 'The DU this RU connects to over fronthaul', '指定此RU经前传连接的DU')}>
        <span>{pick(lang, '연결 DU (프론트홀)', 'Fronthaul DU', '前传DU')}</span>
        <select
          value={g.du_id ?? ''}
          onChange={(e) => updateGnb(obj.id, { du_id: e.target.value || undefined })}
        >
          <option value="">{pick(lang, '(없음)', '(none)', '(无)')}</option>
          {zoneDus.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </label>
      {zoneDus.length === 0 && (
        <div className="material-note" style={{ borderLeft: '3px solid #ffb43d' }}>
          {pick(lang,
            '이 지역에 DU 없음 — RAN 구성에서 DU를 추가하세요',
            'No DU in this zone — add one in RAN Configuration',
            '此区域无DU — 请在RAN配置中添加DU')}
        </div>
      )}
      <label className="field" title={pick(lang, '무선 접속 기술 — 5G NR(gNB) 또는 4G LTE(eNB)', 'Radio access technology — 5G NR (gNB) or 4G LTE (eNB)', '无线接入技术 — 5G NR(gNB) 或 4G LTE(eNB)')}>
        <span>{pick(lang, '무선 기술', 'Radio', '无线制式')}</span>
        <select
          value={g.radio_tech}
          onChange={(e) => {
            const tech = e.target.value as 'lte' | 'nr'
            updateGnb(obj.id, tech === 'lte'
              ? { radio_tech: 'lte', freq_mhz: 1800, antenna: 'sector' }
              : { radio_tech: 'nr' })
          }}
        >
          <option value="nr">5G NR (gNB)</option>
          <option value="lte">LTE (eNB)</option>
        </select>
      </label>
      {g.radio_tech === 'nr' && (
        <label className="field" title={pick(lang, 'NR 주파수 대역 — Low(광역)·Mid(FR1 3.5G)·High(FR2 mmWave 빔포밍)', 'NR band — Low (wide), Mid (FR1 3.5G), High (FR2 mmWave beamforming)', 'NR频段 — 低频(广域)·中频(FR1 3.5G)·高频(FR2毫米波波束赋形)')}>
          <span>{pick(lang, 'NR 밴드', 'NR band', 'NR频段')}</span>
          <select
            value={g.band_class}
            onChange={(e) => {
              const b = e.target.value as 'low' | 'mid' | 'high'
              // 밴드 선택 시 대표 주파수 + 안테나 자동 구성 (하이밴드 → 빔포밍)
              const preset =
                b === 'low' ? { freq_mhz: 700, antenna: 'sector' as const }
                  : b === 'mid' ? { freq_mhz: 3500, antenna: 'sector' as const }
                    : { freq_mhz: 28000, antenna: 'beam' as const }
              // 새 밴드의 FR에서 현재 SCS가 무효면 FR 기본값으로 자동 보정 (FR1→30, FR2→120)
              const nextFr = frOfBandClass(b)
              const scsPatch = validScsForFr(nextFr).includes(g.scs_khz)
                ? {}
                : { scs_khz: defaultScsForFr(nextFr) }
              updateGnb(obj.id, { band_class: b, ...preset, ...scsPatch })
            }}
          >
            <option value="low">{pick(lang, 'Low (Sub-1GHz)', 'Low (Sub-1GHz)', '低频 (Sub-1GHz)')}</option>
            <option value="mid">{pick(lang, 'Mid (FR1 3.5GHz)', 'Mid (FR1 3.5GHz)', '中频 (FR1 3.5G)')}</option>
            <option value="high">{pick(lang, 'High (FR2 mmWave)', 'High (FR2 mmWave)', '高频 (FR2 毫米波)')}</option>
          </select>
        </label>
      )}
      <label className="field" title={pick(lang, 'RU 타입 — Active(안테나 일체형) 또는 Passive(외장 안테나 급전선 연결)', 'RU type — Active (integrated antenna) or Passive (external antenna via feeder)', 'RU类型 — Active(一体化天线)或Passive(经馈线接外接天线)')}>
        <span>{pick(lang, 'RU 타입', 'RU type', 'RU类型')}</span>
        <select
          value={g.ru_type}
          onChange={(e) => updateGnb(obj.id, { ru_type: e.target.value as 'active' | 'passive' })}
        >
          <option value="active">{pick(lang, 'Active (일체형)', 'Active (integrated)', 'Active (一体)')}</option>
          <option value="passive">{pick(lang, 'Passive (외장형)', 'Passive (external)', 'Passive (外接)')}</option>
        </select>
      </label>
      <label className="field" title={pick(lang, '설치 방식 — 봉/천장(소형셀)/벽면 (안테나 높이·방향에 영향)', 'Mounting — pole / ceiling (small cell) / wall (affects height & direction)', '安装方式 — 立杆/吸顶(小基站)/壁挂 (影响高度·方向)')}>
        <span>{pick(lang, '설치', 'Mount', '安装')}</span>
        <select
          value={g.mount}
          onChange={(e) => updateGnb(obj.id, { mount: e.target.value as 'pole' | 'ceiling' | 'wall' })}
        >
          <option value="pole">{pick(lang, '봉 거치', 'Pole', '立杆')}</option>
          <option value="ceiling">{pick(lang, '천장형 (소형셀)', 'Ceiling (small cell)', '吸顶 (小基站)')}</option>
          <option value="wall">{pick(lang, '벽면', 'Wall', '壁挂')}</option>
        </select>
      </label>
      {g.ru_type === 'passive' &&
        (linkedAnt ? (
          <div className="material-note">
            🔗 {linkedAnt.name} · {pick(lang, '급전선', 'feeder', '馈线')} {rad?.feeder_len.toFixed(1)}m ·{' '}
            {pick(lang, '손실', 'loss', '损耗')} {feeder.toFixed(1)} dB
          </div>
        ) : (
          <div className="material-note" style={{ borderLeft: '3px solid #ffb43d' }}>
            ⚠ {pick(lang,
              '연결된 외장 안테나 없음 — 방사되지 않습니다. 안테나를 배치하고 이 RU에 연결하세요.',
              'No external antenna linked — not radiating. Place an antenna and link it to this RU.',
              '未连接外接天线 — 不会辐射。请放置天线并连接到此RU。')}
          </div>
        ))}
      <Num label={t('freq')} unit="MHz" value={g.freq_mhz} min={100} max={300000} step={100}
        title={pick(lang, '중심 캐리어 주파수 — 높을수록 대역폭↑·전파도달↓ (24.25GHz↑=FR2)', 'Center carrier frequency — higher = more bandwidth but shorter reach (≥24.25GHz = FR2)', '中心载频 — 越高带宽越大但传播越近 (≥24.25GHz=FR2)')}
        onChange={setFreq} />
      <div className="preset-row">
        {[
          { f: 850, t: 'n5' }, { f: 1800, t: 'n3' }, { f: 3500, t: 'n78' }, { f: 28000, t: 'n257' },
        ].map((p) => (
          <button key={p.f} className={g.freq_mhz === p.f ? 'on' : ''}
            title={pick(lang, `${p.t} · ${p.f}MHz (${frOfFreq(p.f)})`, `${p.t} · ${p.f}MHz (${frOfFreq(p.f)})`, `${p.t} · ${p.f}MHz (${frOfFreq(p.f)})`)}
            onClick={() => setFreq(p.f)}>
            {p.t}
          </button>
        ))}
      </div>
      <Num label={t('tx_power')} unit="dBm" value={g.tx_power_dbm} min={-30} max={80} step={1}
        title={pick(lang, '송신 출력 — 높이면 커버리지↑ 그러나 인접셀 간섭↑', 'Transmit power — higher extends coverage but raises inter-cell interference', '发射功率 — 提高可扩大覆盖但增加邻区干扰')}
        onChange={(v) => updateGnb(obj.id, { tx_power_dbm: v })} />
      <Num label={pick(lang, '최대 접속 UE', 'Max UEs', '最大接入UE')} unit="UE" value={g.max_ue} min={1} max={10000} step={1}
        title={pick(lang, '이 셀이 동시에 수용하는 최대 단말 수 (초과 시 접속 거부/혼잡)', 'Max UEs this cell admits at once (excess → admission reject/congestion)', '此小区同时接入的最大终端数 (超出则拒绝接入/拥塞)')}
        onChange={(v) => updateGnb(obj.id, { max_ue: Math.round(v) })} />
      <Num label="PCI" unit="0-1007" value={g.pci} min={0} max={1007} step={1}
        title={pick(lang, '물리 셀 식별자 — 인접셀과 mod-3/mod-30 충돌 시 간섭 발생', 'Physical Cell ID — mod-3/mod-30 clashes with neighbors cause interference', '物理小区标识 — 与邻区mod-3/mod-30冲突会产生干扰')}
        onChange={(v) => updateGnb(obj.id, { pci: Math.round(v) })} />
      <Num label="TAC" unit="" value={g.tac} min={0} max={16777215} step={1}
        title={pick(lang, '추적 영역 코드 — 페이징/등록 영역 구분 (경계에서 TAU 발생)', 'Tracking Area Code — defines paging/registration area (TAU at borders)', '跟踪区码 — 划分寻呼/注册区域 (边界触发TAU)')}
        onChange={(v) => updateGnb(obj.id, { tac: Math.round(v) })} />
      <label className="field" title={pick(lang, '부반송파 간격(SCS) — FR에 따라 유효값 제한 (FR1:15/30/60, FR2:60/120)', 'Subcarrier spacing — valid values depend on FR (FR1:15/30/60, FR2:60/120)', '子载波间隔 — 有效值取决于FR (FR1:15/30/60, FR2:60/120)')}>
        <span>SCS <em>(kHz · {fr})</em></span>
        <select value={validScs.includes(g.scs_khz) ? g.scs_khz : defaultScsForFr(fr)}
          onChange={(e) => updateGnb(obj.id, { scs_khz: parseInt(e.target.value) as 15 | 30 | 60 | 120 })}>
          {validScs.map((s) => (
            <option key={s} value={s}>{s} ({fr})</option>
          ))}
        </select>
      </label>
      <Num label={pick(lang, 'TDD DL 비율', 'TDD DL ratio', 'TDD DL比例')} unit="0~1" value={g.tdd_dl_ratio}
        min={0.1} max={0.9} step={0.05}
        onChange={(v) => updateGnb(obj.id, { tdd_dl_ratio: v })} />
      <label className="field checkbox drx-center" title={pick(lang, '불연속 수신(DRX) — 단말 배터리 절감(주기적 수신 슬립)', 'Discontinuous Reception — saves UE battery via periodic sleep', '非连续接收(DRX) — 通过周期休眠节省终端电量')}>
        <span>DRX</span>
        <input type="checkbox" checked={g.drx}
          onChange={(e) => updateGnb(obj.id, { drx: e.target.checked })} />
      </label>

      <div className="section-label sub-bold">{pick(lang, 'PRACH / UL 전력', 'PRACH / UL power', 'PRACH / UL功率')}</div>
      <Num label="PRACH target" unit="dBm" value={g.prach_power_dbm} min={-130} max={-80} step={1}
        onChange={(v) => updateGnb(obj.id, { prach_power_dbm: v })} />
      <Num label={pick(lang, '램핑 스텝', 'ramp step', '功率爬升步长')} unit="dB" value={g.prach_ramp_step_db} min={0} max={6} step={0.5}
        onChange={(v) => updateGnb(obj.id, { prach_ramp_step_db: v })} />
      <Num label={pick(lang, '최대 재시도', 'max tx', '最大重传')} unit="회" value={g.prach_max_tx} min={1} max={200} step={1}
        onChange={(v) => updateGnb(obj.id, { prach_max_tx: Math.round(v) })} />
      <Num label="P0-nominal" unit="dBm" value={g.p0_nominal_dbm} min={-120} max={-60} step={1}
        onChange={(v) => updateGnb(obj.id, { p0_nominal_dbm: v })} />
      <Num label="alpha" unit="0~1" value={g.alpha} min={0} max={1} step={0.1}
        onChange={(v) => updateGnb(obj.id, { alpha: v })} />
      <div className="material-note">
        {pick(lang,
          'UL 링크버짓 부족 시 PRACH 접속 실패(걷기 모드 로그). P0/alpha를 높이면 셀 외곽 UL 커버리지가 개선됩니다.',
          'Weak UL link budget → PRACH failure. Raise P0/alpha to improve cell-edge UL coverage.',
          'UL链路预算不足时PRACH接入失败(行走模式日志)。提高P0/alpha可改善小区边缘UL覆盖。')}
      </div>
      <Num label={t('bandwidth')} unit="MHz" value={g.bandwidth_mhz} min={1} max={2000} step={5}
        onChange={(v) => updateGnb(obj.id, { bandwidth_mhz: v })} />
      <Num label={t('ant_height')} unit="m" value={g.height} min={0.1} max={50} step={0.1}
        onChange={(v) => updateGnb(obj.id, { height: v })} />
      <Num label={t('ant_gain')} unit="dBi" value={g.gain_dbi} min={-10} max={40} step={0.5}
        onChange={(v) => updateGnb(obj.id, { gain_dbi: v })} />
      <label className="field" title={pick(lang, '안테나 패턴 — 무지향(전방향)·섹터(방향성)·빔(빔포밍 추적)', 'Antenna pattern — omni, sector (directional), or beam (beamforming)', '天线方向图 — 全向·扇区(定向)·波束(波束赋形)')}>
        <span>{t('ant_type')}</span>
        <select value={g.antenna}
          onChange={(e) => {
            const antenna = e.target.value as 'omni' | 'sector' | 'beam'
            updateGnb(obj.id, antenna === 'beam' ? { antenna, gain_dbi: 24 } : { antenna })
          }}>
          <option value="omni">{t('ant_omni')}</option>
          <option value="sector">{t('ant_sector')}</option>
          <option value="beam">{t('ant_beam')}</option>
        </select>
      </label>
      {g.antenna !== 'omni' && (
        <>
          <Num label={t('azimuth')} unit="°" value={g.azimuth_deg} min={-180} max={180} step={5}
            onChange={(v) => updateGnb(obj.id, { azimuth_deg: v })} />
          <Num label={t('downtilt')} unit="°" value={g.tilt_deg} min={-90} max={90} step={1}
            onChange={(v) => updateGnb(obj.id, { tilt_deg: v })} />
        </>
      )}
      {g.antenna === 'beam' && (
        <>
          <Num label={t('beamwidth')} unit="°" value={g.beamwidth_deg} min={1} max={90} step={1}
            onChange={(v) => updateGnb(obj.id, { beamwidth_deg: v })} />
          <label className="field checkbox" title={pick(lang, '빔이 단말 위치를 실시간 추종 (빔포밍 이득 유지)', 'Beam steers to follow the UE in real time (keeps beamforming gain)', '波束实时跟踪终端位置 (保持波束赋形增益)')}>
            <span>{t('ue_tracking')}</span>
            <input type="checkbox" checked={g.beam_tracking}
              onChange={(e) => updateGnb(obj.id, { beam_tracking: e.target.checked })} />
          </label>
          {g.freq_mhz < 24250 && <div className="material-note">{t('beam_note')}</div>}
        </>
      )}
      <div className="section-label">{t('ran_features')}</div>
      <label className="field checkbox" title={pick(lang, '캐리어 집성(CA) — 여러 주파수 묶어 속도↑ (PCell+SCell)', 'Carrier Aggregation — bond carriers for higher rate (PCell+SCell)', '载波聚合(CA) — 绑定多载波提速 (PCell+SCell)')}>
        <span>{t('feat_ca')}</span>
        <input type="checkbox" checked={g.ca_enabled}
          onChange={(e) => updateGnb(obj.id, { ca_enabled: e.target.checked })} />
      </label>
      <label className="field checkbox" title={pick(lang, '256QAM 변조 — 신호 좋을 때 속도↑ (SINR 요구 높음)', '256QAM modulation — higher rate when SINR is good', '256QAM调制 — 信号好时提速 (要求高SINR)')}>
        <span>{t('feat_qam')}</span>
        <input type="checkbox" checked={g.qam256}
          onChange={(e) => updateGnb(obj.id, { qam256: e.target.checked })} />
      </label>
      <label className="field checkbox" title={pick(lang, '4x4 MIMO — 다중 안테나 공간다중화로 속도↑', '4x4 MIMO — spatial multiplexing across antennas for higher rate', '4x4 MIMO — 多天线空间复用提速')}>
        <span>{t('feat_mimo')}</span>
        <input type="checkbox" checked={g.mimo4x4}
          onChange={(e) => updateGnb(obj.id, { mimo4x4: e.target.checked })} />
      </label>
      <label className="field checkbox" title={pick(lang, '에너지 절감 — 저부하 시 셀 출력/자원 절약', 'Energy saving — trims cell power/resources under low load', '节能 — 低负载时节省小区功率/资源')}>
        <span>{t('feat_es')}</span>
        <input type="checkbox" checked={g.energy_saving}
          onChange={(e) => updateGnb(obj.id, { energy_saving: e.target.checked })} />
      </label>
      <label className="field checkbox" title={pick(lang, 'PDCP 복제 — 같은 패킷을 두 경로로 보내 신뢰성↑ (URLLC)', 'PDCP duplication — send packet over two paths for reliability (URLLC)', 'PDCP复制 — 双路径发送同一包提升可靠性 (URLLC)')}>
        <span>{t('feat_pdcp')}</span>
        <input type="checkbox" checked={g.pdcp_duplication ?? false}
          onChange={(e) => updateGnb(obj.id, { pdcp_duplication: e.target.checked })} />
      </label>
      <div className="material-note">{t('feat_note')}</div>

      {/* PART 9: RU별 이동성(A3 이벤트) — Core 패널의 '이동성 일괄 설정'으로도 일괄 적용됨 */}
      <div className="section-label sub-bold">
        📶 {pick(lang, '이동성 — A3 이벤트 (이 Radio)', 'Mobility — A3 event (this Radio)', '移动性 — A3 事件 (本Radio)')}
      </div>
      <Num label="A3 Offset" unit="dB" value={g.a3_offset_db ?? 3} min={0} max={15} step={0.5}
        title={pick(lang, '이 셀 기준 A3 오프셋 — 이웃셀이 이만큼 강해야 핸드오버 후보', 'A3 offset for this cell — neighbor must exceed serving by this to hand over', '本小区A3偏置 — 邻区须强此值才成为切换候选')}
        onChange={(v) => updateGnb(obj.id, { a3_offset_db: v })} />
      <Num label="Hysteresis" unit="dB" value={g.hysteresis_db ?? 1} min={0} max={15} step={0.5}
        title={pick(lang, '히스테리시스 — 핑퐁 핸드오버 방지용 여유 마진', 'Hysteresis — margin preventing ping-pong handovers', '迟滞 — 防止乒乓切换的余量')}
        onChange={(v) => updateGnb(obj.id, { hysteresis_db: v })} />
      <Num label="TimeToTrigger" unit="ms" value={g.ttt_ms ?? 320} min={0} max={5120} step={40}
        title={pick(lang, 'TimeToTrigger — A3 조건이 이 시간 지속돼야 핸드오버 실행', 'TimeToTrigger — A3 condition must persist this long before handover', 'TimeToTrigger — A3条件须持续此时长才切换')}
        onChange={(v) => updateGnb(obj.id, { ttt_ms: Math.round(v) })} />
      <Num label="CIO" unit="dB" value={g.cio_db} min={-24} max={24} step={0.5}
        title={pick(lang, '셀 개별 오프셋(CIO) — 이 셀의 핸드오버 경계 미세 조정', 'Cell Individual Offset — fine-tunes this cell\'s handover boundary', '小区独立偏置(CIO) — 微调本小区切换边界')}
        onChange={(v) => updateGnb(obj.id, { cio_db: v })} />
      <div className="material-note">
        {pick(lang,
          'A3: 이웃 셀 RSRP > 서빙 + Offset + Hysteresis 가 TTT 동안 지속되면 핸드오버. CIO로 이 셀의 경계를 개별 조정합니다.',
          'A3: HO when neighbor RSRP > serving + Offset + Hysteresis sustained for TTT. CIO shifts this cell boundary.',
          'A3: 邻区 RSRP > 服务小区 + Offset + Hysteresis 且持续 TTT 时切换。CIO 单独调整本小区边界。')}
      </div>
    </>
  )
}

// 배치형 UE(측정 요원)의 실시간 수신 측정 — 선택 중 2Hz 폴링 + 트래픽 제어
// IMSI 편집 — 기본값은 전역 SIM. 변경 시 경고 후 적용, 미등록이면 트래픽 즉시 차단.
function ImsiField({ obj }: { obj: SceneObject }) {
  const lang = useStore((s) => s.lang)
  const ueSim = useStore((s) => s.ueSim)
  const registeredImsis = useStore((s) => s.registeredImsis)
  const stored = useStore((s) => s.personImsi[obj.id])
  const setPersonImsi = useStore((s) => s.setPersonImsi)
  const imsi = stored ?? defaultImsi(ueSim)
  const reg = imsiRegistered(imsi, ueSim, registeredImsis)
  const [draft, setDraft] = useState(imsi)
  useEffect(() => setDraft(imsi), [imsi])

  const commit = () => {
    if (draft === imsi) return
    const ok = window.confirm(
      pick(lang,
        'IMSI를 변경하면 트래픽에 영향이 있을 수 있습니다 (미등록 IMSI면 등록 거부·트래픽 차단). 계속할까요?',
        'Changing IMSI may affect traffic (unregistered IMSI → registration reject, traffic blocked). Continue?',
        '更改IMSI可能影响流量(未注册IMSI将被拒绝注册并中断流量)。是否继续？'),
    )
    if (ok) setPersonImsi(obj.id, draft.trim())
    else setDraft(imsi)
  }

  return (
    <label className="field">
      <span>IMSI {reg
        ? <em style={{ color: 'var(--ok)' }}>{pick(lang, '가입됨', 'registered', '已签约')}</em>
        : <em style={{ color: 'var(--bad)' }}>{pick(lang, '미등록', 'unregistered', '未注册')}</em>}</span>
      <input
        type="text"
        value={draft}
        maxLength={15}
        style={!imsiRegistered(draft, ueSim, registeredImsis) ? { borderColor: 'var(--bad)' } : undefined}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </label>
  )
}

function PersonMeasure({ obj }: { obj: SceneObject }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const probe = useStore((s) => s.personProbes[obj.id])
  const setPersonProbe = useStore((s) => s.setPersonProbe)
  const objects = useStore((s) => s.objects)
  const trafficOn = useStore((s) => s.personTraffic[obj.id] ?? false)
  const togglePersonTraffic = useStore((s) => s.togglePersonTraffic)
  const mbps = useStore((s) => s.personMbps[obj.id])
  const setProcedureUe = useStore((s) => s.setProcedureUe)
  const setTraceUe = useStore((s) => s.setTraceUe)
  const bumpPanel = useStore((s) => s.bumpPanel)
  const ueOn = useStore((s) => s.personUeOn[obj.id] ?? false)
  const togglePersonUe = useStore((s) => s.togglePersonUe)
  const trafficType = useStore((s) => s.personTrafficType[obj.id] ?? s.trafficType)
  const setPersonTrafficType = useStore((s) => s.setPersonTrafficType)
  const barred = useStore((s) => s.personBarred[obj.id] ?? false)
  const togglePersonBarred = useStore((s) => s.togglePersonBarred)
  const supp = useStore((s) => s.personSupp[obj.id])
  const setPersonSupp = useStore((s) => s.setPersonSupp)
  const personCallee = useStore((s) => s.personCallee)
  const setPersonCallee = useStore((s) => s.setPersonCallee)

  // 전원 ON 일 때만 측정(폰이 켜져 있어야 신호 수신)
  const wasAgc = useRef(false)
  useEffect(() => {
    if (!ueOn) {
      setPersonProbe(obj.id, null)
      return
    }
    let alive = true
    const tick = async () => {
      const st0 = useStore.getState()
      const { objects, space } = st0
      // 걷는 UE와 동일하게: 트래픽 활성 시 UE의 트래픽 종류 5QI + 서빙셀 부하를 백엔드로 전달
      // → CE/URLLC/PDB/PDCP-복제 PHY 경로가 배치 UE에서도 실제로 구동된다.
      const trafficOn0 = st0.personTraffic[obj.id] ?? false
      const ti0 = trafficInfo(st0.personTrafficType[obj.id] ?? st0.trafficType)
      const servId0 = st0.personProbes[obj.id]?.serving ?? null
      const servLoad0 = servId0 ? (st0.nfLoads[servId0]?.load ?? 0) : 0
      try {
        const p = await api.probe(
          objects, space, objZone(obj),
          [obj.position[0], 1.5, obj.position[2]],
          st0.ceiling,
          trafficOn0 ? ti0.fiveqi : 9,
          trafficOn0 ? servLoad0 : 0,
        )
        if (!alive) return
        setPersonProbe(obj.id, p)
        // AGC 수신 포화 방지 (근거리 과입력 RSRP > -45 → ADC 클리핑 방지 위해 이득 감쇠)
        const st = useStore.getState()
        if (p.agc_active && !wasAgc.current) {
          wasAgc.current = true
          st.addEvent('UE', 'warn',
            pick(st.lang,
              `${obj.name}: AGC 수신 포화 방지 — 과입력(RSRP > -45dBm) 감지, 수신 이득 감쇠로 -45dBm 제한 (ADC 클리핑 방지)`,
              `${obj.name}: AGC receiver saturation — high input (RSRP > -45dBm), gain reduced to -45dBm (avoid ADC clipping)`,
              `${obj.name}: AGC 接收饱和保护 — 输入过强(RSRP > -45dBm)，增益衰减限制到-45dBm (防止ADC削波)`),
            obj.name)
        } else if (!p.agc_active && wasAgc.current) {
          wasAgc.current = false
        }
      } catch {
        /* 백엔드 미동작 시 무시 */
      }
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [obj.id, obj.position[0], obj.position[2], obj, setPersonProbe, ueOn])

  return (
    <>
      <div className="section-label">{t('ue_measure')}</div>
      {/* 단말 전원 — 켜면 3GPP attach 절차 수행 */}
      <button
        className={`ue-power-btn ${ueOn ? 'on' : ''}`}
        title={pick(lang, '단말 전원 on/off — 켜면 3GPP 등록(attach) 절차를 수행', 'Toggle UE power — powering on runs the 3GPP attach/registration', '终端开关机 — 开机执行3GPP注册(attach)流程')}
        onClick={() => togglePersonUe(obj.id)}
      >
        {ueOn
          ? pick(lang, '📴 단말 전원 끄기', '📴 Power OFF', '📴 关机')
          : pick(lang, '📱 단말 전원 켜기 (attach)', '📱 Power ON (attach)', '📱 开机 (attach)')}
      </button>
      {/* IMSI (기본값=전역 SIM, 편집 가능 — 미등록 시 트래픽 차단) */}
      <ImsiField obj={obj} />
      {/* 서비스: 트래픽 시작 버튼(왼쪽) + 서비스 종류 선택(오른쪽) 한 줄 (PART 8) */}
      <div className="section-label" style={{ marginBottom: 2 }}>
        {pick(lang, '서비스', 'Service', '业务')}
      </div>
      <div className="traffic-service-row">
        <button
          className={`traffic-btn ${trafficOn ? 'stop' : ''}`}
          disabled={!ueOn}
          title={pick(lang, '선택한 서비스로 데이터 트래픽 생성 시작/중지 (PDU 세션)', 'Start/stop generating data traffic for the selected service (PDU session)', '按所选业务开始/停止生成数据流量 (PDU会话)')}
          onClick={() => togglePersonTraffic(obj.id)}
        >
          {trafficOn ? t('traffic_stop') : t('traffic_start')}
        </button>
        <select
          value={trafficType}
          title={pick(lang, '트래픽 서비스 종류(5QI) — QoS/지연/속도 특성 결정', 'Traffic service type (5QI) — sets QoS/latency/rate profile', '流量业务类型(5QI) — 决定QoS/时延/速率特性')}
          onChange={(e) => setPersonTrafficType(obj.id, e.target.value as typeof trafficType)}
        >
          {TRAFFIC_TYPES.map((tt) => (
            <option key={tt.key} value={tt.key}>
              {tt.icon} {pick(lang, tt.ko, tt.en, tt.zh)} · 5QI{tt.fiveqi}
            </option>
          ))}
        </select>
      </div>
      {/* 음성(VoNR) 선택 시: 통화 대상 UE 선택 (item 4). 트래픽 시작 시 이 대상으로 실제 VoNR 발신 */}
      {trafficType === 'voice' && (() => {
        const otherUes = objects.filter((o) => o.kind === 'person' && o.id !== obj.id)
        if (otherUes.length === 0) {
          return (
            <div className="material-note" style={{ borderLeft: '3px solid #ffb43d' }}>
              {pick(lang,
                '통화할 다른 단말이 없습니다 — 측정요원을 더 배치하세요',
                'No other UE to call — place more measurement UEs',
                '没有可通话的其他终端 — 请增加测试人员')}
            </div>
          )
        }
        return (
          <label
            className="field"
            title={pick(lang,
              '통화 대상 단말 — 트래픽 시작 시 이 대상으로 실제 VoNR 통화를 발신합니다',
              'Callee UE — starting traffic places a real VoNR call to this target',
              '通话对象终端 — 开始流量时向此对象发起真实VoNR通话')}
          >
            <span>{pick(lang, '통화 대상', 'Callee', '通话对象')}</span>
            <select
              value={personCallee[obj.id] ?? ''}
              onChange={(e) => setPersonCallee(obj.id, e.target.value)}
            >
              <option value="">{pick(lang, '(대상 선택…)', '(select…)', '(选择…)')}</option>
              {otherUes.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        )
      })()}
      {trafficOn && (
        <div className="traffic-stats">
          <b>{(mbps ?? 0).toFixed(0)}</b> Mbps
          {(mbps ?? 0) === 0 && (
            <span className="traffic-blocked">
              {' '}{pick(lang, '(신호 없음/음영)', '(no signal)', '(无信号/盲区)')}
            </span>
          )}
        </div>
      )}

      {/* 접속 제어 (UAC) — 셀 접속(RRC/NAS) 자체를 막음. MMTEL 부가서비스와 다른 별도 그룹 (item 14) */}
      <div className="section-label sub-bold" style={{ marginTop: 6 }}>
        🚫 {pick(lang, '접속 제어 (UAC)', 'Access control (UAC)', '接入控制 (UAC)')}
      </div>
      <label
        className="field checkbox"
        title={pick(lang,
          'UAC 접속 차단 — 셀 접속(RRC/NAS)을 막습니다. 통화 부가서비스가 아닙니다.',
          'UAC access barring — blocks cell access (RRC/NAS). Not a call supplementary service.',
          'UAC 接入禁止 — 阻断小区接入(RRC/NAS)。非通话补充业务。')}
      >
        <span>{pick(lang, '접속 차단 (UAC)', 'Access barring (UAC)', '接入禁止 (UAC)')}</span>
        <input type="checkbox" checked={barred}
          onChange={() => togglePersonBarred(obj.id)} />
      </label>
      <div className="material-note">
        {pick(lang,
          'UAC 접속 차단 — 셀 접속(RRC/NAS)을 막습니다. 통화 부가서비스가 아닙니다.',
          'UAC access barring — blocks cell access (RRC/NAS). Not a call supplementary service.',
          'UAC 接入禁止 — 阻断小区接入(RRC/NAS)。非通话补充业务。')}
      </div>

      {/* MMTEL 부가서비스 (TAS/iFC) — 통화 결과를 실제로 바꾸는 상호작용 토글 (접속제어와 별개) */}
      <div className="section-label" style={{ marginTop: 6 }}>
        {pick(lang, '부가서비스 (MMTEL/TAS)', 'Supplementary services (MMTEL/TAS)', '补充业务 (MMTEL/TAS)')}
      </div>
      {([
        ['ocb', pick(lang, '발신 차단 (OCB)', 'Outgoing barring (OCB)', '呼出限制 (OCB)')],
        ['icb', pick(lang, '착신 차단 (ICB)', 'Incoming barring (ICB)', '呼入限制 (ICB)')],
        ['cw', pick(lang, '통화 중 대기 (CW)', 'Call waiting (CW)', '呼叫等待 (CW)')],
        ['oir', pick(lang, '발신번호 표시제한 (OIR)', 'Id restriction (OIR)', '号码限制显示 (OIR)')],
        ['cfu', pick(lang, '무조건 착신전환 (CFU)', 'Forward unconditional (CFU)', '无条件前转 (CFU)')],
        ['cfb', pick(lang, '통화중 착신전환 (CFB)', 'Forward on busy (CFB)', '遇忙前转 (CFB)')],
        ['cfnr', pick(lang, '무응답 착신전환 (CFNR)', 'Forward no-reply (CFNR)', '无应答前转 (CFNR)')],
        ['cfnrc', pick(lang, '도달불가 착신전환 (CFNRc)', 'Forward not-reachable (CFNRc)', '不可达前转 (CFNRc)')],
      ] as const).map(([key, label]) => (
        <label className="field checkbox" key={key}>
          <span>{label}</span>
          <input type="checkbox" checked={supp?.[key] ?? false}
            onChange={(e) => setPersonSupp(obj.id, { [key]: e.target.checked } as Partial<SuppServices>)} />
        </label>
      ))}
      {(supp?.cfu || supp?.cfb || supp?.cfnr || supp?.cfnrc) && (
        <label className="field" title={pick(lang, '착신전환(CF)이 발생할 때 통화를 넘길 대상 단말', 'Target UE the call is forwarded to when call-forwarding triggers', '呼叫前转触发时转接的目标终端')}>
          <span>{pick(lang, '전환 대상', 'Forward to', '前转目标')}</span>
          <select value={supp?.cfTarget ?? ''}
            onChange={(e) => setPersonSupp(obj.id, { cfTarget: e.target.value })}>
            <option value="">—</option>
            {objects.filter((o) => o.kind === 'person' && o.id !== obj.id).map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({objZone(o)})</option>
            ))}
          </select>
        </label>
      )}

      {probe && probe.rsrp_dbm != null ? (
        <>
          <div className="hud-grid">
            <div className="hud-metric">
              <span>RSRP</span>
              <b style={{ color: rsrpColorCss(probe.rsrp_dbm) }}>{probe.rsrp_dbm.toFixed(1)}</b>
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
          <div className="pos-row">
            {t('serving_cell')}: {probe.serving_name ?? '-'} · {probe.band} ·{' '}
            {probe.bandwidth_mhz?.toFixed(0)}MHz · ARFCN {probe.nr_arfcn}
          </div>
          {probe.cells.length > 0 && (() => {
            const servingGnb = objects.find((o) => o.kind === 'gnb' && o.name === probe.serving_name)
            const ca = servingGnb?.gnb?.ca_enabled
            const nonServ = probe.cells
              .filter((c) => c.id !== probe.serving)
              .sort((a, b) => b.rsrp_dbm - a.rsrp_dbm)
            const scellId = ca && nonServ[0] ? nonServ[0].id : null
            return (
              <div className="hud-cells">
                {probe.cells.map((c) => {
                  const role = c.id === probe.serving ? 'P' : c.id === scellId ? 'S' : ''
                  return (
                    <div key={c.id} className={`hud-cell ${c.id === probe.serving ? 'serving' : ''}`}>
                      <span>
                        {role && (
                          <em className={`cell-role ${role === 'P' ? 'p' : 's'}`}
                            title={role === 'P' ? 'PCell (primary)' : 'SCell (secondary, CA)'}>
                            {role === 'P' ? 'PCell' : 'SCell'}
                          </em>
                        )}{' '}{c.name}
                      </span>
                      <span>{c.rsrp_dbm.toFixed(0)}</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      ) : (
        <div className="hud-nosig">{t('no_signal')}</div>
      )}
      {/* 콜플로우 추적 — 이 UE의 집계 로그(호 흐름) 패널을 연다. 주 발견 경로이므로 크게·눈에 띄게 (PART 8) */}
      <button className="callflow-btn" onClick={() => { setTraceUe(obj.id); bumpPanel('uetrace') }}
        title={pick(lang, '이 측정요원(UE)이 발생시킨 모든 시그널링을 시간순 래더로 모아보기', 'View all signaling this UE generated as a time-ordered ladder', '将该测试人员(UE)产生的全部信令按时序汇总为阶梯图')}>
        🪜 {pick(lang, '콜플로우 추적', 'Call-flow trace', '呼叫流程追踪')}
      </button>
      {/* 절차상세 — 패널 하단 (삭제 버튼 제외 맨 아래) (PART 8) */}
      <button className="proc-btn" style={{ marginTop: 8 }} onClick={() => setProcedureUe(obj.id)}
        title={pick(lang, '이 UE의 E2E 경로(UE→gNB→AMF→SMF→UPF→DN)를 노드별 정보와 함께 표시', 'Show this UE\'s E2E path (UE→gNB→…→DN) with per-node info', '显示此UE的端到端路径(UE→gNB→…→DN)及各节点信息')}>
        🔗 {pick(lang, '절차 상세 (Call Flow)', 'Procedure (Call Flow)', '流程详情 (Call Flow)')}
      </button>
    </>
  )
}

// 외장 안테나: passive RU 연결, 설치 높이, 급전선 종류 (거리 기반 손실 표시)
function AntennaEditor({ obj }: { obj: SceneObject }) {
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const updateObject = useStore((s) => s.updateObject)

  const passiveRus = objects.filter(
    (o) => o.kind === 'gnb' && o.gnb?.ru_type === 'passive' && objZone(o) === objZone(obj),
  )
  const linkedRu = passiveRus.find((r) => r.id === obj.link_ru)
  let feederInfo: string | null = null
  if (linkedRu) {
    const rad = getRadiator(linkedRu, objects)
    if (rad && rad.feeder_len > 0) {
      const loss = feederLossDb(rad.feeder_len, linkedRu.gnb!.freq_mhz, rad.cable)
      feederInfo = `${rad.feeder_len.toFixed(1)}m · ${loss.toFixed(1)} dB`
    }
  }

  return (
    <>
      <div className="section-label">{pick(lang, '외장 안테나', 'External Antenna', '外接天线')}</div>
      <label className="field" title={pick(lang, '이 외장 안테나를 급전할 Passive RU 선택 (미연결 시 방사 안 됨)', 'Passive RU that feeds this external antenna (none = not radiating)', '为此外接天线馈电的Passive RU (未连接则不辐射)')}>
        <span>{pick(lang, '연결 RU', 'Linked RU', '连接RU')}</span>
        <select
          value={obj.link_ru ?? ''}
          onChange={(e) => updateObject(obj.id, { link_ru: e.target.value || undefined })}
        >
          <option value="">{pick(lang, '— 미연결 —', '— none —', '— 未连接 —')}</option>
          {passiveRus.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <Num label={pick(lang, '설치 높이', 'Mount height', '安装高度')} unit="m" value={obj.ant_height ?? 4}
        min={0.5} max={50} step={0.1}
        onChange={(v) => updateObject(obj.id, { ant_height: v })} />
      <label className="field" title={pick(lang, '급전선 종류 — 길이·주파수에 따라 신호 손실(dB) 결정', 'Feeder cable type — sets signal loss (dB) by length & frequency', '馈线类型 — 按长度·频率决定信号损耗(dB)')}>
        <span>{pick(lang, '급전선', 'Feeder cable', '馈线')}</span>
        <select
          value={obj.cable ?? 'half'}
          onChange={(e) => updateObject(obj.id, { cable: e.target.value as CableType })}
        >
          {(Object.keys(CABLE_TYPES) as CableType[]).map((c) => (
            <option key={c} value={c}>{CABLE_TYPES[c].label}</option>
          ))}
        </select>
      </label>
      {feederInfo && (
        <div className="material-note">
          🔗 {linkedRu!.name} · {pick(lang, '급전 손실', 'feeder loss', '馈线损耗')}: {feederInfo}
        </div>
      )}
      {passiveRus.length === 0 && (
        <div className="material-note" style={{ borderLeft: '3px solid #ffb43d' }}>
          {pick(lang,
            '이 국가에 Passive RU가 없습니다. RU를 배치하고 타입을 Passive로 바꾸세요.',
            'No passive RU in this PLMN. Place an RU and set its type to Passive.',
            '此PLMN中无Passive RU。请放置RU并将类型设为Passive。')}
        </div>
      )}
    </>
  )
}

export function ParamsPanel() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const selectedId = useStore((s) => s.selectedId)
  const objects = useStore((s) => s.objects)
  const updateObject = useStore((s) => s.updateObject)
  const removeObject = useStore((s) => s.removeObject)
  const mode = useStore((s) => s.mode)
  const space = useStore((s) => s.space)
  const { dragStyle, headerProps } = usePanelDrag()

  const obj = objects.find((o) => o.id === selectedId)
  if (mode !== 'edit' || !obj) return null

  const cat = CATALOG[obj.kind]
  const matKey =
    cat.material === 'concrete' ? 'mat_concrete'
    : cat.material === 'glass' ? 'mat_glass'
    : cat.material === 'metal' ? 'mat_metal'
    : 'mat_wood'

  return (
    <div className="params panel" ref={frontRef} style={dragStyle}>
      <div className="params-scroll">
      <div className="params-head" {...headerProps}>
        <input
          className="name-input"
          title={pick(lang, '이 오브젝트의 표시 이름 편집', 'Edit this object\'s display name', '编辑此对象的显示名称')}
          value={obj.name}
          onChange={(e) => updateObject(obj.id, { name: e.target.value })}
        />
      </div>

      <div className="section-label">{t('placement')}</div>
      <Num label="X" unit="m" value={Math.round(obj.position[0] * 10) / 10}
        min={0} max={space.width} step={0.5}
        onChange={(v) => updateObject(obj.id, { position: [v, 0, obj.position[2]] })} />
      <Num label="Z" unit="m" value={Math.round(obj.position[2] * 10) / 10}
        min={0} max={space.depth} step={0.5}
        onChange={(v) => updateObject(obj.id, { position: [obj.position[0], 0, v] })} />
      <Num label={t('rotation')} unit="°" value={obj.rotation_deg} min={-180} max={180} step={5}
        onChange={(v) => updateObject(obj.id, { rotation_deg: Math.round(v) })} />

      {cat.resizable && obj.size && (
        <>
          <Num label={t('length')} unit="m" value={obj.size[0]} min={0.1} max={200} step={0.5}
            onChange={(v) => updateObject(obj.id, { size: [v, obj.size![1], obj.size![2]] })} />
          <Num label={t('height_m')} unit="m" value={obj.size[1]} min={0.1} max={50} step={0.1}
            onChange={(v) => updateObject(obj.id, { size: [obj.size![0], v, obj.size![2]] })} />
        </>
      )}

      {obj.kind === 'gnb' && obj.gnb && <GnbParamsEditor obj={obj} />}
      {obj.kind === 'person' && <PersonMeasure obj={obj} />}
      {obj.kind === 'antenna' && <AntennaEditor obj={obj} />}

      {obj.kind !== 'gnb' && obj.kind !== 'person' && cat.material && (
        <div className="material-note">
          {t('mat_prefix')}: {t(matKey)} {t('mat_suffix')}
        </div>
      )}

      <button className="danger" onClick={() => removeObject(obj.id)}
        title={pick(lang, '선택한 오브젝트를 씬에서 삭제', 'Delete the selected object from the scene', '从场景中删除所选对象')}>
        {t('delete')}
      </button>
      </div>
    </div>
  )
}

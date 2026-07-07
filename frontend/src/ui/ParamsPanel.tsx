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

// per-cell 오버라이드용 숫자 입력 — 비우면 undefined(전역 기본값 폴백). 0을 강제하지 않는다.
// 값이 undefined면 빈 칸으로 표시하고 placeholder로 "전역값" 힌트를 보여준다.
function NumOpt({
  label, value, min, max, step, unit, onChange, title, placeholder,
}: {
  label: string
  value: number | undefined
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number | undefined) => void
  title?: string
  placeholder?: string
}) {
  return (
    <label className="field" title={title}>
      <span>
        {label} {unit && <em>({unit})</em>}
      </span>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value
          if (raw.trim() === '') {
            onChange(undefined) // 비움 → undefined (전역 RAN/RF 기본값 사용)
            return
          }
          const v = parseFloat(raw)
          if (!Number.isNaN(v)) onChange(Math.min(Math.max(v, min), max))
        }}
      />
    </label>
  )
}

// ── RU / RF·PHY-low: RF 프론트엔드 + 안테나 + 전파환경 (TS 38.401 · O-RAN 기능분할) ──
// 모든 필드는 여전히 RU(gnb) 오브젝트에 저장된다(updateGnb) — "어느 편집기가 어느 필드를 보여주는가"만 재배치.
export function GnbRfFields({ obj }: { obj: SceneObject }) {
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

  return (
    <>
      <div className="section-label">RU · {pick(lang, 'RF/안테나', 'RF/Antenna', 'RF/天线')}</div>
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
      <div className="section-label sub-bold">{pick(lang, 'PRACH 프리앰블 (RF)', 'PRACH preamble (RF)', 'PRACH 前导 (RF)')}</div>
      <Num label="PRACH target" unit="dBm" value={g.prach_power_dbm} min={-130} max={-80} step={1}
        onChange={(v) => updateGnb(obj.id, { prach_power_dbm: v })} />
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
      <Num label={pick(lang, '안테나 어레이 행 (rows)', 'Antenna array rows', '天线阵列行 (rows)')}
        unit="rows" value={g.ant_rows ?? 1} min={1} max={8} step={1}
        title={pick(lang,
          '안테나 어레이 행 수. 어레이 이득 +10log10(행×열) dB → 커버리지↑. TR 38.901.',
          '안테나 어레이 행 수. 어레이 이득 +10log10(행×열) dB → 커버리지↑. TR 38.901.',
          '안테나 어레이 행 수. 어레이 이득 +10log10(행×열) dB → 커버리지↑. TR 38.901.')}
        onChange={(v) => updateGnb(obj.id, { ant_rows: Math.round(v) })} />
      <Num label={pick(lang, '안테나 어레이 열 (cols)', 'Antenna array cols', '天线阵列列 (cols)')}
        unit="cols" value={g.ant_cols ?? 1} min={1} max={8} step={1}
        title={pick(lang,
          '안테나 어레이 열 수. 어레이 이득 +10log10(행×열) dB → 커버리지↑. TR 38.901.',
          '안테나 어레이 열 수. 어레이 이득 +10log10(행×열) dB → 커버리지↑. TR 38.901.',
          '안테나 어레이 열 수. 어레이 이득 +10log10(행×열) dB → 커버리지↑. TR 38.901.')}
        onChange={(v) => updateGnb(obj.id, { ant_cols: Math.round(v) })} />
      <label className="field checkbox" title={pick(lang, '에너지 절감 — 저부하 시 셀 출력/자원 절약', 'Energy saving — trims cell power/resources under low load', '节能 — 低负载时节省小区功率/资源')}>
        <span>{t('feat_es')}</span>
        <input type="checkbox" checked={g.energy_saving}
          onChange={(e) => updateGnb(obj.id, { energy_saving: e.target.checked })} />
      </label>
      {/* per-cell RF 수신기 오버라이드 (TS 38.104/38.214). 비우면 전역 RF 기본값 폴백. */}
      <div className="section-label sub-bold">
        📡 {pick(lang,
          'RF 수신 (per-cell override)',
          'RF reception (per-cell override)',
          'RF 接收 (per-cell 覆盖)')}
      </div>
      <div className="material-note">
        {pick(lang,
          '미입력 시 전역 RF 기본값 사용 (TS 38.104/38.214).',
          'Empty = global RF default (TS 38.104/38.214).',
          '留空则使用全局RF默认值 (TS 38.104/38.214)。')}
      </div>
      <NumOpt label={pick(lang, '잡음 지수 (NF)', 'Noise figure (NF)', '噪声系数 (NF)')} unit="dB" value={g.noise_figure_db} min={0} max={15} step={0.1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '수신기 잡음 지수 — 클수록 잡음 바닥↑·SINR↓·커버리지↓. 미입력 시 전역값. TS 38.104.', 'Receiver noise figure — higher raises noise floor, lowers SINR/coverage. Empty = global. TS 38.104.', '接收机噪声系数 — 越大噪声基底越高，SINR/覆盖越低。留空=全局。TS 38.104。')}
        onChange={(v) => updateGnb(obj.id, { noise_figure_db: v })} />
      <NumOpt label={pick(lang, '목표 BLER', 'Target BLER', '目标BLER')} unit="0~1" value={g.target_bler} min={0.001} max={0.5} step={0.01}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '링크 적응 목표 BLER(초기송신, 통상 0.1). 낮출수록 견고·처리량↓. 미입력 시 전역값. TS 38.214.', 'Link-adaptation target BLER (initial tx, typ. 0.1). Lower = more robust but lower throughput. Empty = global. TS 38.214.', '链路自适应目标BLER(初传，通常0.1)。越低越稳健但吞吐越低。留空=全局。TS 38.214。')}
        onChange={(v) => updateGnb(obj.id, { target_bler: v })} />
      <NumOpt label={pick(lang, '간섭 마진', 'Interference margin', '干扰余量')} unit="dB" value={g.interference_margin_db} min={0} max={20} step={0.5}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '링크버짓 간섭 마진 — 셀 부하/인접셀 간섭 여유(클수록 유효 SINR↓). 미입력 시 전역값. TS 38.214.', 'Link-budget interference margin — headroom for cell load/inter-cell interference (higher lowers effective SINR). Empty = global. TS 38.214.', '链路预算干扰余量 — 小区负载/邻区干扰余量(越大有效SINR越低)。留空=全局。TS 38.214。')}
        onChange={(v) => updateGnb(obj.id, { interference_margin_db: v })} />

      {/* per-cell 전파환경 오버라이드 (TR 38.901 / TS 38.101-1). 비우면 전역 RF 기본값 폴백. */}
      <div className="section-label sub-bold">
        🌐 {pick(lang,
          '전파환경 (per-cell)',
          'Propagation (per-cell)',
          '传播环境 (per-cell)')}
      </div>
      <NumOpt label={pick(lang, '경로손실 지수 n', 'Path-loss exponent n', '路径损耗指数 n')} unit="n" value={g.path_loss_exp} min={1.5} max={6} step={0.1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '경로손실 지수 n (셀 국소 환경, TR 38.901). 미입력=전역', 'Path-loss exponent n (cell-local environment, TR 38.901). Empty = global.', '路径损耗指数 n (小区局部环境, TR 38.901)。留空=全局。')}
        onChange={(v) => updateGnb(obj.id, { path_loss_exp: v })} />
      <NumOpt label={pick(lang, '쉐도우 페이딩 σ', 'Shadow fading σ', '阴影衰落 σ')} unit="dB" value={g.shadow_sigma_db} min={0} max={12} step={0.1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '쉐도우 페이딩 σ (셀 국소, TR 38.901). 미입력=전역', 'Shadow fading σ (cell-local, TR 38.901). Empty = global.', '阴影衰落 σ (小区局部, TR 38.901)。留空=全局。')}
        onChange={(v) => updateGnb(obj.id, { shadow_sigma_db: v })} />
      <NumOpt label={pick(lang, 'UE 최대 송신출력 Pmax', 'UE max Tx power Pmax', 'UE 最大发射功率 Pmax')} unit="dBm" value={g.ue_pmax_dbm} min={0} max={33} step={0.5}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '이 셀 가정 UE 최대 송신출력 Pmax (UL 링크버짓, TS 38.101-1). 미입력=전역', 'Assumed UE max Tx power Pmax for this cell (UL link budget, TS 38.101-1). Empty = global.', '本小区假定UE最大发射功率Pmax (UL链路预算, TS 38.101-1)。留空=全局。')}
        onChange={(v) => updateGnb(obj.id, { ue_pmax_dbm: v })} />
    </>
  )
}

// ── DU / RLC·MAC·PHY-high & 스케줄링·수비학 (TS 38.401 · O-RAN 기능분할) ──
// DU 편집기는 자신에게 연결된 RU(들)의 gnb 필드를 편집한다(데이터는 RU에 저장).
export function GnbDuFields({ obj }: { obj: SceneObject }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const updateGnb = useStore((s) => s.updateGnb)
  const g = obj.gnb!
  // FR 판정: NR은 실제 캐리어 주파수(≥24.25GHz=FR2)로 판정, LTE는 항상 FR1.
  const fr = g.radio_tech === 'nr' ? frOfFreq(g.freq_mhz) : 'FR1'
  const validScs = validScsForFr(fr)
  // 무효한 (밴드, SCS) 조합이면 FR 기본값으로 스냅 (저장 데이터/외부 변경 방어).
  useEffect(() => {
    if (!validScs.includes(g.scs_khz)) {
      updateGnb(obj.id, { scs_khz: defaultScsForFr(fr) })
    }
  }, [fr, g.scs_khz, obj.id, updateGnb, validScs])

  return (
    <>
      <div className="section-label">DU · {pick(lang, '스케줄링/RLC·MAC/수비학', 'Scheduling/RLC·MAC/Numerology', '调度/RLC·MAC/数字学')}</div>
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
      <Num label={pick(lang, '최대 접속 UE', 'Max UEs', '最大接入UE')} unit="UE" value={g.max_ue} min={1} max={10000} step={1}
        title={pick(lang, '이 셀이 동시에 수용하는 최대 단말 수 (초과 시 접속 거부/혼잡)', 'Max UEs this cell admits at once (excess → admission reject/congestion)', '此小区同时接入的最大终端数 (超出则拒绝接入/拥塞)')}
        onChange={(v) => updateGnb(obj.id, { max_ue: Math.round(v) })} />
      <Num label="PCI" unit="0-1007" value={g.pci} min={0} max={1007} step={1}
        title={pick(lang, '물리 셀 식별자 — 인접셀과 mod-3/mod-30 충돌 시 간섭 발생', 'Physical Cell ID — mod-3/mod-30 clashes with neighbors cause interference', '物理小区标识 — 与邻区mod-3/mod-30冲突会产生干扰')}
        onChange={(v) => updateGnb(obj.id, { pci: Math.round(v) })} />
      <Num label="TAC" unit="" value={g.tac} min={0} max={16777215} step={1}
        title={pick(lang, '추적 영역 코드 — 페이징/등록 영역 구분 (경계에서 TAU 발생)', 'Tracking Area Code — defines paging/registration area (TAU at borders)', '跟踪区码 — 划分寻呼/注册区域 (边界触发TAU)')}
        onChange={(v) => updateGnb(obj.id, { tac: Math.round(v) })} />
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
      {/* MIMO 레이어/랭크 — mimo4x4 토글을 대체하는 상세 스케줄링 파라미터 */}
      <Num label={pick(lang, 'MIMO 레이어 (layers/rank)', 'MIMO layers (rank)', 'MIMO层数 (rank)')}
        unit="layers" value={g.mimo_layers ?? 2} min={1} max={8} step={1}
        title={pick(lang,
          'DL 공간 레이어/랭크 수. 높을수록 피크 처리량 비례 증가(랭크 상한 8). TS 38.211/214. (mimo4x4 토글 대체)',
          'DL 공간 레이어/랭크 수. 높을수록 피크 처리량 비례 증가(랭크 상한 8). TS 38.211/214. (mimo4x4 토글 대체)',
          'DL 공간 레이어/랭크 수. 높을수록 피크 처리량 비례 증가(랭크 상한 8). TS 38.211/214. (mimo4x4 토글 대체)')}
        onChange={(v) => updateGnb(obj.id, { mimo_layers: Math.round(v) })} />
      <div className="material-note">
        {pick(lang,
          'mimo4x4 토글은 레거시(하위호환용 유지) — 실제 처리량은 위 MIMO 레이어 수로 결정됩니다.',
          'mimo4x4 toggle is legacy (kept for back-compat) — throughput now follows the MIMO layers above.',
          'mimo4x4 开关为旧版(为向后兼容保留) — 吞吐量现由上方MIMO层数决定。')}
      </div>
      <div className="material-note">{t('feat_note')}</div>
      <div className="section-label sub-bold">{pick(lang, 'UL 전력제어 / RACH', 'UL power control / RACH', 'UL功率控制 / RACH')}</div>
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
      {/* RACH/RLC/브로드캐스트 per-cell 오버라이드 (미입력 시 전역값). TS 38.331/38.322. */}
      <div className="section-label sub-bold">{pick(lang, 'RACH/RLC/브로드캐스트 (per-cell override)', 'RACH/RLC/Broadcast (per-cell override)', 'RACH/RLC/广播 (per-cell 覆盖)')}</div>
      <NumOpt label="RA response window" unit="ms" value={g.ra_response_window_ms} min={1} max={80} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'ra-ResponseWindow: RAR 수신 대기 윈도우. 미입력 시 전역값. TS 38.331 §6.3.2.', 'ra-ResponseWindow: RAR reception window. Empty = global. TS 38.331 §6.3.2.', 'ra-ResponseWindow: RAR接收窗口。留空=全局。TS 38.331 §6.3.2。')}
        onChange={(v) => updateGnb(obj.id, { ra_response_window_ms: v })} />
      <NumOpt label="RLC maxRetxThreshold" unit="회" value={g.rlc_max_retx} min={1} max={64} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'maxRetxThreshold: RLC AM 최대 재전송(초과 시 RLF). 미입력 시 전역값. TS 38.322/38.331.', 'maxRetxThreshold: RLC AM max retransmissions (exceed → RLF). Empty = global. TS 38.322/38.331.', 'maxRetxThreshold: RLC AM最大重传(超过→RLF)。留空=全局。TS 38.322/38.331。')}
        onChange={(v) => updateGnb(obj.id, { rlc_max_retx: v == null ? undefined : Math.round(v) })} />
      <NumOpt label="SSB periodicity" unit="ms" value={g.ssb_periodicity_ms} min={5} max={160} step={5}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'ssb-PeriodicityServingCell: SSB 버스트 주기(5/10/20/40/80/160). 미입력 시 전역값. TS 38.331.', 'ssb-PeriodicityServingCell: SSB burst period (5/10/20/40/80/160). Empty = global. TS 38.331.', 'ssb-PeriodicityServingCell: SSB突发周期(5/10/20/40/80/160)。留空=全局。TS 38.331。')}
        onChange={(v) => updateGnb(obj.id, { ssb_periodicity_ms: v })} />
      <NumOpt label="SIB1 periodicity" unit="ms" value={g.sib1_periodicity_ms} min={5} max={160} step={5}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'SIB1 반복 주기(기본 20ms). 미입력 시 전역값. TS 38.331 §5.2.2.', 'SIB1 repetition period (default 20ms). Empty = global. TS 38.331 §5.2.2.', 'SIB1重复周期(默认20ms)。留空=全局。TS 38.331 §5.2.2。')}
        onChange={(v) => updateGnb(obj.id, { sib1_periodicity_ms: v })} />
    </>
  )
}

// ── CU / RRC & PDCP: 이동성·측정·SIB1·PDCP (TS 38.401 · O-RAN 기능분할) ──
// CU 편집기는 자신 하위(연결된 DU들)의 RU(들)의 gnb 필드를 편집한다(데이터는 RU에 저장).
export function GnbCuFields({ obj }: { obj: SceneObject }) {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const updateGnb = useStore((s) => s.updateGnb)
  const g = obj.gnb!

  return (
    <>
      <div className="section-label">CU · {pick(lang, 'RRC/이동성/PDCP', 'RRC/Mobility/PDCP', 'RRC/移动性/PDCP')}</div>
      {/* SIB1 cellBarred — 이 셀 캠핑 불가(무서비스), UE 재선택. TS 38.331/38.304 */}
      <label className="field checkbox" title={pick(lang,
        'SIB1 cellBarred=barred — 이 셀 캠핑 불가(무서비스), UE는 재선택. 표준: TS 38.331/38.304.',
        'SIB1 cellBarred=barred — UE cannot camp on this cell (no service) and reselects. Std: TS 38.331/38.304.',
        'SIB1 cellBarred=barred — UE 无法驻留此小区(无服务)并重选。标准: TS 38.331/38.304.')}>
        <span>{pick(lang, '셀 접속 차단 (cell barred)', 'Cell barred', '小区禁止接入 (cell barred)')}</span>
        <input type="checkbox" checked={g.cell_barred ?? false}
          onChange={(e) => updateGnb(obj.id, { cell_barred: e.target.checked })} />
      </label>
      <Num label={pick(lang, 'Qrxlevmin (셀선택 최소수신)', 'Qrxlevmin (min RX for cell selection)', 'Qrxlevmin (小区选择最小接收)')}
        unit="dBm" value={g.q_rx_lev_min_dbm ?? -120} min={-140} max={-30} step={1}
        title={pick(lang,
          "셀선택 S-기준 최소 RSRP(Qrxlevmin). 측정 RSRP가 이 값보다 낮으면(Srxlev<0) '적합 셀 없음(No Suitable Cell)'로 접속 불가. 표준: TS 38.304.",
          "Minimum RSRP for cell selection S-criterion (Qrxlevmin). If measured RSRP is below this (Srxlev<0) → 'No Suitable Cell' and access is blocked. Std: TS 38.304.",
          "小区选择S准则最小RSRP(Qrxlevmin)。测量RSRP低于此值(Srxlev<0)则'无合适小区(No Suitable Cell)'无法接入。标准: TS 38.304.")}
        onChange={(v) => updateGnb(obj.id, { q_rx_lev_min_dbm: v })} />
      <label className="field checkbox drx-center" title={pick(lang, '불연속 수신(DRX) — 단말 배터리 절감(주기적 수신 슬립)', 'Discontinuous Reception — saves UE battery via periodic sleep', '非连续接收(DRX) — 通过周期休眠节省终端电量')}>
        <span>DRX</span>
        <input type="checkbox" checked={g.drx}
          onChange={(e) => updateGnb(obj.id, { drx: e.target.checked })} />
      </label>
      <label className="field checkbox" title={pick(lang, 'PDCP 복제 — 같은 패킷을 두 경로로 보내 신뢰성↑ (URLLC)', 'PDCP duplication — send packet over two paths for reliability (URLLC)', 'PDCP复制 — 双路径发送同一包提升可靠性 (URLLC)')}>
        <span>{t('feat_pdcp')}</span>
        <input type="checkbox" checked={g.pdcp_duplication ?? false}
          onChange={(e) => updateGnb(obj.id, { pdcp_duplication: e.target.checked })} />
      </label>

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

      {/* per-cell 이동성/측정 오버라이드 (TS 38.331). 비우면 RAN 전역 기본값 폴백 (undefined). */}
      <div className="section-label sub-bold">
        📐 {pick(lang,
          '이동성/측정 (per-cell 오버라이드, TS 38.331)',
          'Mobility/measurement (per-cell override, TS 38.331)',
          '移动性/测量 (per-cell 覆盖, TS 38.331)')}
      </div>
      <div className="material-note">
        {pick(lang,
          '미입력 시 RAN 전역 기본값 사용 (칸을 비우면 전역값으로 폴백). TS 38.331.',
          'Empty = fall back to the global RAN default (clear a field to use the global value). TS 38.331.',
          '留空则使用RAN全局默认值 (清空该项即回退到全局值)。TS 38.331。')}
      </div>
      <NumOpt label="A1 threshold" unit="dBm" value={g.a1_threshold_dbm} min={-140} max={-30} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'A1: 서빙 RSRP > 임계 시 이벤트(측정 중단). 미입력 시 전역값. TS 38.331 §5.5.4.2.', 'A1: serving RSRP above threshold (stop measurement). Empty = global. TS 38.331 §5.5.4.2.', 'A1: 服务RSRP高于门限(停止测量)。留空=全局。TS 38.331 §5.5.4.2。')}
        onChange={(v) => updateGnb(obj.id, { a1_threshold_dbm: v })} />
      <NumOpt label="A2 threshold" unit="dBm" value={g.a2_threshold_dbm} min={-140} max={-30} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'A2: 서빙 RSRP < 임계 시 이벤트(셀 이탈). 미입력 시 전역값. TS 38.331 §5.5.4.3.', 'A2: serving RSRP below threshold (leaving cell). Empty = global. TS 38.331 §5.5.4.3.', 'A2: 服务RSRP低于门限(离开小区)。留空=全局。TS 38.331 §5.5.4.3。')}
        onChange={(v) => updateGnb(obj.id, { a2_threshold_dbm: v })} />
      <NumOpt label="A4 threshold" unit="dBm" value={g.a4_threshold_dbm} min={-140} max={-30} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'A4: 이웃 RSRP > 임계 시 이벤트. 미입력 시 전역값. TS 38.331 §5.5.4.5.', 'A4: neighbor RSRP above threshold. Empty = global. TS 38.331 §5.5.4.5.', 'A4: 邻区RSRP高于门限。留空=全局。TS 38.331 §5.5.4.5。')}
        onChange={(v) => updateGnb(obj.id, { a4_threshold_dbm: v })} />
      <NumOpt label="A5 threshold-1" unit="dBm" value={g.a5_thresh1_dbm} min={-140} max={-30} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'A5 Thr1: 서빙 RSRP < thresh1. 미입력 시 전역값. TS 38.331 §5.5.4.6.', 'A5 Thr1: serving RSRP below thresh1. Empty = global. TS 38.331 §5.5.4.6.', 'A5 Thr1: 服务RSRP低于thresh1。留空=全局。TS 38.331 §5.5.4.6。')}
        onChange={(v) => updateGnb(obj.id, { a5_thresh1_dbm: v })} />
      <NumOpt label="A5 threshold-2" unit="dBm" value={g.a5_thresh2_dbm} min={-140} max={-30} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'A5 Thr2: 이웃 RSRP > thresh2. 미입력 시 전역값. TS 38.331 §5.5.4.6.', 'A5 Thr2: neighbor RSRP above thresh2. Empty = global. TS 38.331 §5.5.4.6.', 'A5 Thr2: 邻区RSRP高于thresh2。留空=全局。TS 38.331 §5.5.4.6。')}
        onChange={(v) => updateGnb(obj.id, { a5_thresh2_dbm: v })} />
      <NumOpt label="T300" unit="ms" value={g.t300_ms} min={0} max={2000} step={50}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'T300: RRCSetupRequest 후 대기 타이머. 미입력 시 전역값. TS 38.331 §7.1.', 'T300: timer after RRCSetupRequest. Empty = global. TS 38.331 §7.1.', 'T300: RRCSetupRequest后等待定时器。留空=全局。TS 38.331 §7.1。')}
        onChange={(v) => updateGnb(obj.id, { t300_ms: v })} />
      <NumOpt label="T304" unit="ms" value={g.t304_ms} min={0} max={8000} step={50}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'T304: 핸드오버 실행 타이머(만료 시 HO 실패→재확립). 미입력 시 전역값. TS 38.331 §7.1.', 'T304: handover execution timer (expiry → HO failure/re-establishment). Empty = global. TS 38.331 §7.1.', 'T304: 切换执行定时器(超时→切换失败/重建)。留空=全局。TS 38.331 §7.1。')}
        onChange={(v) => updateGnb(obj.id, { t304_ms: v })} />
      <NumOpt label="T310" unit="ms" value={g.t310_ms} min={0} max={8000} step={50}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'T310: 물리계층 문제 지속 타이머(N310 후 시작, 만료 시 RLF). 미입력 시 전역값. TS 38.331 §7.1.', 'T310: physical-layer problem timer (starts after N310; expiry → RLF). Empty = global. TS 38.331 §7.1.', 'T310: 物理层问题定时器(N310后启动，超时→RLF)。留空=全局。TS 38.331 §7.1。')}
        onChange={(v) => updateGnb(obj.id, { t310_ms: v })} />
      <NumOpt label="T311" unit="ms" value={g.t311_ms} min={0} max={30000} step={100}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'T311: RRC 재확립 셀 탐색 타이머. 미입력 시 전역값. TS 38.331 §7.1.', 'T311: RRC re-establishment cell-search timer. Empty = global. TS 38.331 §7.1.', 'T311: RRC重建小区搜索定时器。留空=全局。TS 38.331 §7.1。')}
        onChange={(v) => updateGnb(obj.id, { t311_ms: v })} />
      <NumOpt label="N310" unit="회" value={g.n310} min={1} max={20} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'N310: 연속 out-of-sync 지시 횟수(초과 시 T310 시작). 미입력 시 전역값. TS 38.331 §7.1.', 'N310: consecutive out-of-sync count (exceed → start T310). Empty = global. TS 38.331 §7.1.', 'N310: 连续失步指示计数(超过→启动T310)。留空=全局。TS 38.331 §7.1。')}
        onChange={(v) => updateGnb(obj.id, { n310: v == null ? undefined : Math.round(v) })} />
      <NumOpt label="N311" unit="회" value={g.n311} min={1} max={20} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'N311: 연속 in-sync 지시 횟수(초과 시 T310 정지). 미입력 시 전역값. TS 38.331 §7.1.', 'N311: consecutive in-sync count (exceed → stop T310). Empty = global. TS 38.331 §7.1.', 'N311: 连续同步指示计数(超过→停止T310)。留空=全局。TS 38.331 §7.1。')}
        onChange={(v) => updateGnb(obj.id, { n311: v == null ? undefined : Math.round(v) })} />
      <NumOpt label="L3 filter coefficient k" unit="k" value={g.filter_coef_k} min={0} max={19} step={1}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'filterCoefficient k: L3 측정 필터 계수(가중치 1/2^(k/4)). 클수록 평활↑·반응↓. 미입력 시 전역값. TS 38.331 §5.5.3.2.', 'filterCoefficient k: L3 measurement filter coeff (weight 1/2^(k/4)); higher = smoother/slower. Empty = global. TS 38.331 §5.5.3.2.', 'filterCoefficient k: L3测量滤波系数(权重1/2^(k/4))；越大越平滑越慢。留空=全局。TS 38.331 §5.5.3.2。')}
        onChange={(v) => updateGnb(obj.id, { filter_coef_k: v == null ? undefined : Math.round(v) })} />
      <NumOpt label="CHO exec offset" unit="dB" value={g.cho_exec_offset_db} min={0} max={15} step={0.5}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'Conditional HO 실행 오프셋 — 조건 충족 후 실제 실행 여유. 미입력 시 전역값. TS 38.331 §5.3.5.13.', 'Conditional HO execution offset — margin before actually executing after condition met. Empty = global. TS 38.331 §5.3.5.13.', '条件切换执行偏置 — 条件满足后实际执行余量。留空=全局。TS 38.331 §5.3.5.13。')}
        onChange={(v) => updateGnb(obj.id, { cho_exec_offset_db: v })} />
      <NumOpt label={pick(lang, '핑퐁 최소 체류', 'Ping-pong min-stay', '乒乓最小驻留')} unit="ms" value={g.pingpong_min_stay_ms} min={0} max={10000} step={100}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, '핸드오버 후 최소 체류 시간 — 이 시간 내 재HO를 핑퐁으로 억제. 미입력 시 전역값. TS 38.331(MTS).', 'Minimum stay time after handover — suppresses re-HO within this window as ping-pong. Empty = global. TS 38.331 (MTS).', '切换后最小驻留时间 — 此窗口内的再切换视为乒乓抑制。留空=全局。TS 38.331(MTS)。')}
        onChange={(v) => updateGnb(obj.id, { pingpong_min_stay_ms: v })} />
      <NumOpt label={pick(lang, '측정 보고 주기', 'Report interval', '测量报告周期')} unit="ms" value={g.report_interval_ms} min={120} max={30720} step={40}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'reportInterval: periodic 측정 보고 주기. 미입력 시 전역값. TS 38.331 §5.5.5.', 'reportInterval: periodic measurement report interval. Empty = global. TS 38.331 §5.5.5.', 'reportInterval: 周期测量报告间隔。留空=全局。TS 38.331 §5.5.5。')}
        onChange={(v) => updateGnb(obj.id, { report_interval_ms: v })} />
      <NumOpt label={pick(lang, '측정 갭 주기 (MGRP)', 'Gap period (MGRP)', '测量间隙周期 (MGRP)')} unit="ms" value={g.gap_period_ms} min={20} max={160} step={20}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'Measurement Gap Repetition Period — 인터주파수 측정 갭 주기. 미입력 시 전역값. TS 38.133 §9.1.', 'Measurement Gap Repetition Period — inter-frequency measurement gap period. Empty = global. TS 38.133 §9.1.', '测量间隙重复周期 — 异频测量间隙周期。留空=全局。TS 38.133 §9.1。')}
        onChange={(v) => updateGnb(obj.id, { gap_period_ms: v })} />
      <NumOpt label={pick(lang, '측정 갭 길이 (MGL)', 'Gap length (MGL)', '测量间隙长度 (MGL)')} unit="ms" value={g.gap_length_ms} min={1} max={20} step={0.5}
        placeholder={pick(lang, '전역값', 'global', '全局')}
        title={pick(lang, 'Measurement Gap Length — 갭당 측정 시간(길수록 처리량 손실↑). 미입력 시 전역값. TS 38.133 §9.1.', 'Measurement Gap Length — per-gap measurement time (longer = more throughput loss). Empty = global. TS 38.133 §9.1.', '测量间隙长度 — 每间隙测量时间(越长吞吐损失越大)。留空=全局。TS 38.133 §9.1。')}
        onChange={(v) => updateGnb(obj.id, { gap_length_ms: v })} />
    </>
  )
}

// 3D 선택 파라미터 패널(ParamsPanel)에서 쓰는 통합 편집기 — 세 그룹을 순서대로 렌더.
// RU=RF, DU=스케줄링/RLC·MAC, CU=RRC/이동성/PDCP (모두 이 RU의 gnb에 저장, 동작 불변).
export function GnbParamsEditor({ obj }: { obj: SceneObject }) {
  return (
    <>
      <GnbRfFields obj={obj} />
      <GnbDuFields obj={obj} />
      <GnbCuFields obj={obj} />
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
  const select = useStore((s) => s.select)
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
        <button
          className="log-btn"
          style={{ marginLeft: 'auto' }}
          title={pick(lang, '닫기 (선택 해제)', 'Close (deselect)', '关闭 (取消选择)')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => select(null)}
        >
          ✕
        </button>
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

import { useState } from 'react'
import type { StrKey } from '../i18n'
import { pick, useT } from '../i18n'
import { useStore } from '../store'
import type { Tool, Zone } from '../types'
import { ZONES } from '../types'

// 구조물/가구 배치 (RF 장애물 포함) — tip = 전파 감쇠 특성 설명
const STRUCT_TOOLS: { tool: Tool; icon: string; key: StrKey; tip: [string, string, string] }[] = [
  { tool: 'wall', icon: '🧱', key: 'tool_wall', tip: ['콘크리트 벽 — 전파를 강하게 차단', 'Concrete wall — strongly blocks RF', '混凝土墙 — 强烈阻挡信号'] },
  { tool: 'glasswall', icon: '🪟', key: 'tool_glasswall', tip: ['유리벽 — 전파 감쇠 약함(부분 투과)', 'Glass wall — weak attenuation (partially transparent)', '玻璃墙 — 弱衰减(部分穿透)'] },
  { tool: 'pillar', icon: '🏛', key: 'tool_pillar', tip: ['기둥 — 국소 음영/차폐 발생', 'Pillar — creates a local shadow/block', '柱子 — 产生局部盲区/遮挡'] },
  { tool: 'door', icon: '🚪', key: 'tool_door', tip: ['문 — 개폐에 따른 부분 차단', 'Door — partial blocking', '门 — 部分阻挡'] },
  { tool: 'desk', icon: '🪑', key: 'tool_desk', tip: ['책상 — 낮은 가구 장애물', 'Desk — low furniture obstacle', '办公桌 — 低矮家具障碍'] },
  { tool: 'table', icon: '🍽', key: 'tool_table', tip: ['테이블 — 낮은 가구 장애물', 'Table — low furniture obstacle', '餐桌 — 低矮家具障碍'] },
  { tool: 'chair', icon: '💺', key: 'tool_chair', tip: ['의자 — 작은 장애물', 'Chair — small obstacle', '椅子 — 小障碍'] },
  { tool: 'cabinet', icon: '🗄', key: 'tool_cabinet', tip: ['캐비닛 — 금속이면 강한 차폐', 'Cabinet — strong shielding if metal', '柜子 — 金属则强屏蔽'] },
  { tool: 'shelf', icon: '📚', key: 'tool_shelf', tip: ['선반 — 통로 음영 원인', 'Shelf — causes aisle shadowing', '货架 — 造成通道盲区'] },
  { tool: 'sofa', icon: '🛋', key: 'tool_sofa', tip: ['소파 — 약한 흡수성 장애물', 'Sofa — weak absorbing obstacle', '沙发 — 弱吸收障碍'] },
  { tool: 'machine', icon: '⚙', key: 'tool_machine', tip: ['기계 — 금속 다중경로/강한 차폐', 'Machine — metal multipath / strong shielding', '机器 — 金属多径/强屏蔽'] },
  { tool: 'plant', icon: '🪴', key: 'tool_plant', tip: ['화분 — 미미한 감쇠', 'Plant — negligible attenuation', '盆栽 — 轻微衰减'] },
]

// 라디오(RU) 변형 — Ceiling/Wall 은 요청대로 영어 표기 고정
const RADIO_KINDS: { kind: 'active' | 'passive' | 'ceiling' | 'wall'; icon: string; label: string; tip: [string, string, string] }[] = [
  { kind: 'active', icon: '📡', label: 'Active RU', tip: ['안테나 일체형 RU — 별도 안테나 없이 바로 방사', 'Integrated-antenna RU — radiates directly, no external antenna', '一体化天线RU — 无需外接天线直接辐射'] },
  { kind: 'passive', icon: '📡', label: 'Passive RU', tip: ['외장 안테나 필요 — 급전선으로 안테나에 연결해야 방사', 'Needs an external antenna linked via feeder to radiate', '需外接天线 — 经馈线连接天线后才辐射'] },
  { kind: 'ceiling', icon: '🔵', label: 'Ceiling small cell', tip: ['천장 부착 실내 소형셀 — 아래로 균일 커버리지', 'Ceiling-mounted indoor small cell — even downward coverage', '吸顶室内小基站 — 向下均匀覆盖'] },
  { kind: 'wall', icon: '🟦', label: 'Wall-mounted RU', tip: ['벽면 부착 RU — 실내 한쪽 방향 커버리지', 'Wall-mounted RU — directional indoor coverage', '壁挂RU — 室内单向覆盖'] },
]

// 외장 안테나 3종 — 요청대로 영어 표기 고정 (스탠드형/천장형/벽면형)
const ANTENNA_TOOLS: { tool: Tool; icon: string; label: string; tip: [string, string, string] }[] = [
  { tool: 'antenna', icon: '📶', label: 'Standalone external antenna', tip: ['스탠드형 외장 안테나 — Passive RU에 연결', 'Stand-type external antenna — link to a passive RU', '立式外接天线 — 连接到Passive RU'] },
  { tool: 'antceiling', icon: '📶', label: 'Ceiling external antenna', tip: ['천장형 외장 안테나 — Passive RU에 연결', 'Ceiling external antenna — link to a passive RU', '吸顶外接天线 — 连接到Passive RU'] },
  { tool: 'antwall', icon: '📶', label: 'Wall external antenna', tip: ['벽면형 외장 안테나 — Passive RU에 연결', 'Wall external antenna — link to a passive RU', '壁挂外接天线 — 连接到Passive RU'] },
]

function SpaceInput({
  label, value, onChange, title,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  title?: string
}) {
  return (
    <label className="space-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={10}
        max={500}
        step={5}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </label>
  )
}

export function Toolbar() {
  const t = useT()
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const mode = useStore((s) => s.mode)
  const space = useStore((s) => s.space)
  const setSpace = useStore((s) => s.setSpace)
  const lang = useStore((s) => s.lang)
  const ceiling = useStore((s) => s.ceiling)
  const setCeiling = useStore((s) => s.setCeiling)
  const homeZone = useStore((s) => s.homeZone)
  const setHomeZone = useStore((s) => s.setHomeZone)
  const autoPlanPci = useStore((s) => s.autoPlanPci)
  const autoOptimizeRan = useStore((s) => s.autoOptimizeRan)
  const optimizing = useStore((s) => s.optimizing)
  const radioKind = useStore((s) => s.radioKind)
  const setRadioKind = useStore((s) => s.setRadioKind)
  const applyLayoutPreset = useStore((s) => s.applyLayoutPreset)
  const [presetZone, setPresetZone] = useState<Zone>('A')

  if (mode !== 'edit') return null

    const preset = (p: 'spacious' | 'office' | 'factory' | 'warehouse' | 'hall' | 'cafe') => {
    const ok = window.confirm(
      pick(lang,
        `PLMN-${presetZone} 지역의 기존 배치가 지워지고 예시로 대체됩니다 (다른 지역은 유지). 계속할까요?`,
        `PLMN-${presetZone} layout will be cleared and replaced by the example (other zones kept). Continue?`,
        `PLMN-${presetZone} 区域布局将被替换为示例（其他区域保留）。是否继续？`),
    )
    if (ok) applyLayoutPreset(p, presetZone)
  }

  return (
    <div className="toolbar panel">
      {/* ── 자동 배치 (배치 예시) ── */}
      <div className="section-label big">{pick(lang, '자동 배치', 'Auto layout', '自动布局')}</div>
      <label className="field preset-zone" title={pick(lang, '자동 배치 예시를 적용할 PLMN 지역 선택', 'Choose which PLMN zone the auto-layout preset applies to', '选择自动布局示例应用到哪个PLMN区域')}>
        <span>{pick(lang, '배치 지역', 'Zone', '区域')}</span>
        <select value={presetZone} onChange={(e) => setPresetZone(e.target.value as Zone)}>
          {ZONES.map((z) => <option key={z} value={z}>PLMN-{z}</option>)}
        </select>
      </label>
      <button className="tool-btn" onClick={() => preset('spacious')} title={pick(lang, '장애물 거의 없는 개활지 예시 (광역 커버리지)', 'Open area with almost no obstacles (wide coverage)', '几乎无障碍的开阔场景 (广域覆盖)')}>🌄 {pick(lang, '광활한 공간', 'Open area', '开阔空间')}</button>
      <button className="tool-btn" onClick={() => preset('office')} title={pick(lang, '칸막이·유리벽 많은 사무실 예시 (실내 소형셀)', 'Office with partitions & glass walls (indoor small cells)', '隔断·玻璃墙较多的办公室 (室内小基站)')}>🏢 {pick(lang, '사무실', 'Office', '办公室')}</button>
      <button className="tool-btn" onClick={() => preset('factory')} title={pick(lang, '금속 기계 많은 공장 예시 (다중경로·차폐 강함)', 'Factory with metal machinery (strong multipath/shadowing)', '金属机器较多的工厂 (多径/遮挡强)')}>🏭 {pick(lang, '공장', 'Factory', '工厂')}</button>
      <button className="tool-btn" onClick={() => preset('warehouse')} title={pick(lang, '높은 선반 창고 예시 (통로 음영 발생)', 'Warehouse with tall racks (aisle shadowing)', '高货架仓库 (通道盲区)')}>📦 {pick(lang, '물류창고', 'Warehouse', '物流仓库')}</button>
      <button className="tool-btn" onClick={() => preset('hall')} title={pick(lang, '넓은 개방형 대형 홀 예시 (고밀도 접속)', 'Large open hall (high-density access)', '大型开放大厅 (高密度接入)')}>🏟 {pick(lang, '대형 홀', 'Large hall', '大厅')}</button>
      <button className="tool-btn" onClick={() => preset('cafe')} title={pick(lang, '소규모 카페/상가 예시 (근거리 실내)', 'Small cafe/shop (short-range indoor)', '小型咖啡厅/店铺 (近距离室内)')}>☕ {pick(lang, '카페/상가', 'Cafe/shop', '咖啡厅')}</button>

      {/* ── 배치 도구 ── */}
      <div className="section-label big">{t('toolbar_title')}</div>

      {/* UE (측정요원 / 고정 UE) */}
      <div className="tool-sublabel">UE</div>
      <button
        className={`tool-btn ${tool === 'person' ? 'on' : ''}`}
        onClick={() => setTool('person')}
        title={pick(lang, '측정요원(이동 UE) 배치 — 클릭한 위치에 실측용 단말 생성', 'Place a test UE (mobile) — a measurement terminal at the clicked spot', '放置测试人员(移动UE) — 在点击处生成实测终端')}
      >
        <span className="icon">🚶</span> {t('tool_person')}
      </button>
      <button
        className={`tool-btn ${tool === 'fixedue' ? 'on' : ''}`}
        onClick={() => setTool('fixedue')}
        title={pick(lang, '고정 UE — 공장 기계형 단말 (UE로 동작)', 'Fixed UE — factory-machine terminal (acts as a UE)', '固定 UE — 工厂机器型终端（作为UE）')}
      >
        <span className="icon">🏭</span> {pick(lang, '고정 UE', 'Fixed UE', '固定 UE')}
      </button>

      {/* Radio Unit */}
      <div className="tool-sublabel">Radio Unit</div>
      {RADIO_KINDS.map((r) => (
        <button
          key={r.kind}
          className={`tool-btn ${tool === 'gnb' && radioKind === r.kind ? 'on' : ''}`}
          onClick={() => setRadioKind(r.kind)}
          title={pick(lang, r.tip[0], r.tip[1], r.tip[2])}
        >
          <span className="icon">{r.icon}</span> {r.label}
        </button>
      ))}
      {ANTENNA_TOOLS.map((a) => (
        <button
          key={a.tool}
          className={`tool-btn ${tool === a.tool ? 'on' : ''}`}
          onClick={() => setTool(a.tool)}
          title={pick(lang, a.tip[0], a.tip[1], a.tip[2])}
        >
          <span className="icon">{a.icon}</span> {a.label}
        </button>
      ))}

      {/* 구조물 / 가구 */}
      <div className="tool-sublabel">{pick(lang, '구조물 / 가구', 'Structures / Furniture', '结构 / 家具')}</div>
      {STRUCT_TOOLS.map((tl) => (
        <button
          key={tl.tool}
          className={`tool-btn ${tool === tl.tool ? 'on' : ''}`}
          onClick={() => setTool(tl.tool)}
          title={pick(lang, tl.tip[0], tl.tip[1], tl.tip[2])}
        >
          <span className="icon">{tl.icon}</span> {t(tl.key)}
        </button>
      ))}

      {/* ── 공간 크기 (W/D/H 각각 줄바꿈) ── */}
      <div className="section-label big">{pick(lang, '공간 크기 (m)', 'Space Size (m)', '空间尺寸 (m)')}</div>
      <div className="space-col">
        <SpaceInput label={pick(lang, 'W 가로', 'W width', 'W 宽')} value={space.width} onChange={(v) => setSpace({ width: v })} title={pick(lang, '시뮬레이션 공간의 가로 폭(m)', 'Width of the simulation space (m)', '仿真空间的宽度(m)')} />
        <SpaceInput label={pick(lang, 'D 세로', 'D depth', 'D 深')} value={space.depth} onChange={(v) => setSpace({ depth: v })} title={pick(lang, '시뮬레이션 공간의 세로 깊이(m)', 'Depth of the simulation space (m)', '仿真空间的深度(m)')} />
        <SpaceInput label={pick(lang, 'H 높이', 'H height', 'H 高')} value={space.height} onChange={(v) => setSpace({ height: v })} title={pick(lang, '시뮬레이션 공간의 천장 높이(m)', 'Ceiling height of the simulation space (m)', '仿真空间的层高(m)')} />
      </div>

      <label className="field checkbox ceiling-row" style={{ marginTop: 6 }}
        title={pick(lang, '천장 유무 — 켜면 전파가 천장에 반사/차단됨', 'Toggle a ceiling — RF then reflects off / is blocked by it', '有无天花板 — 开启后信号会被天花板反射/阻挡')}>
        <span>{pick(lang, '천장', 'Ceiling', '天花板')}</span>
        <span className="ceiling-check">
          <input type="checkbox" checked={ceiling} onChange={(e) => setCeiling(e.target.checked)} />
        </span>
      </label>

      <label className="field plmn-row"
        title={pick(lang, '단말의 홈 PLMN(가입 사업자) — 다른 지역에선 로밍으로 동작', 'UE home PLMN (subscribed operator) — other zones act as roaming', '终端归属PLMN(签约运营商) — 其他区域按漫游处理')}>
        <span>{pick(lang, '홈 PLMN', 'Home PLMN', '归属 PLMN')}</span>
        <select value={homeZone} onChange={(e) => setHomeZone(e.target.value as Zone)}>
          {ZONES.map((z) => (
            <option key={z} value={z}>PLMN-{z}</option>
          ))}
        </select>
      </label>

      <div className="section-label big">{pick(lang, '자동 계획 (ACP)', 'Auto plan (ACP)', '自动规划 (ACP)')}</div>
      <button
        className="tool-btn"
        title={pick(lang, '인접 셀 mod-3/mod-30 충돌 회피 PCI 자동 배정', 'Auto-assign PCIs avoiding mod-3/mod-30 clashes', '自动分配 PCI，避免相邻小区 mod-3/mod-30 冲突')}
        onClick={() => autoPlanPci()}
      >
        📡 {pick(lang, 'PCI 자동 계획', 'Auto PCI plan', 'PCI 自动规划')}
      </button>
      <button
        className="tool-btn"
        disabled={optimizing}
        title={pick(lang, '커버리지·간섭 목표로 틸트/출력 자동 최적화', 'Auto-optimize tilt/power for coverage', '按覆盖·干扰目标自动优化下倾角/功率')}
        onClick={() => autoOptimizeRan()}
      >
        🎯 {optimizing ? pick(lang, '최적화 중…', 'Optimizing…', '优化中…') : pick(lang, '틸트/출력 최적화', 'Optimize tilt/power', '下倾角/功率优化')}
      </button>

      {/* ── 조작 안내 (맨 아래, 3줄) ── */}
      <div className="toolbar-hint-bottom">
        <div>{pick(lang, '클릭 → 선택', 'Click → select', '点击 → 选择')}</div>
        <div>{pick(lang, 'Shift+드래그 → 다중선택', 'Shift+drag → multi-select', 'Shift+拖拽 → 多选')}</div>
        <div>{pick(lang, 'Delete → 삭제', 'Delete → remove', 'Delete → 删除')}</div>
      </div>
    </div>
  )
}

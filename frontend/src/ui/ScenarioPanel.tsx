// 시나리오 재현·검증 패널 — 실제 5G use case(성공/실패)를 한 클릭으로 씬에 적용하고,
// 시뮬레이터가 내는 결과가 기대 결과와 맞는지(재현 성공 여부) 실시간 판정.
import { useState } from 'react'
import { pick } from '../i18n'
import { useStore } from '../store'
import { frontRef } from './zorder'
import { usePanelDrag } from './panelDrag'
import { SCENARIOS } from '../scenarios'

export function ScenarioPanel() {
  const show = useStore((s) => s.showScenarios)
  const setShow = useStore((s) => s.setShowScenarios)
  const applyScenario = useStore((s) => s.applyScenario)
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const homeZone = useStore((s) => s.homeZone)
  const ko = lang === 'ko'
  const { dragStyle, headerProps } = usePanelDrag()
  const [notice, setNotice] = useState<string | null>(null)

  if (!show) return null

  return (
    <div className="scenariopanel panel" ref={frontRef} style={dragStyle}>
      <div className="log-head" {...headerProps}>
        <span className="section-label">
          🧪 {pick(lang, '시나리오 재현·검증', 'Scenario Reproduction', '场景复现·验证')}
        </span>
        <button className="log-btn" onClick={() => setShow(false)} title={pick(lang, '시나리오 패널 닫기', 'Close scenario panel', '关闭场景面板')}>✕</button>
      </div>
      <div className="scenario-note">
        {pick(
          lang,
          '실제 5G use case(성공/실패 콜플로우)를 적용하고, 시뮬레이터 재현 결과를 확인합니다.',
          'Apply real 5G use cases and verify the simulator reproduces the expected outcome.',
          '应用真实 5G use case(成功/失败呼叫流程),并确认仿真复现结果。',
        )}
      </div>
      {notice && (
        <div className="scenario-notice" style={{ padding: '8px 10px', margin: '6px 8px', borderRadius: 6, background: 'rgba(255,120,80,0.15)', border: '1px solid rgba(255,120,80,0.55)', fontSize: '0.88em', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{notice}</span>
          <button className="log-btn" onClick={() => setNotice(null)} title={pick(lang, '닫기', 'Dismiss', '关闭')} style={{ flexShrink: 0 }}>✕</button>
        </div>
      )}
      <div className="scenario-list">
        {SCENARIOS.map((sc) => {
          const res = sc.expect({ objects, coreNfs, coreDn, homeZone })
          const descriptive = sc.simulable !== true
          return (
            <div key={sc.id} className={`scenario-row ${sc.category}${descriptive ? ' descriptive' : ''}`}>
              <div className="scenario-main">
                <div className="scenario-title">
                  <span className={`scenario-tag ${sc.category}`}>
                    {sc.category === 'success' ? pick(lang, '성공', 'OK', '成功') : pick(lang, '실패', 'FAIL', '失败')}
                  </span>
                  {pick(lang, sc.ko, sc.en, sc.zh)}
                  {sc.validated && (
                    <span className="scenario-verified" title={pick(lang, '실제 Open5GS/UERANSIM 스택으로 검증됨', 'Verified on real Open5GS/UERANSIM', '已在真实 Open5GS/UERANSIM 协议栈上验证')}>
                      ✔ {pick(lang, '실스택 검증', 'stack-verified', '真实栈验证')}
                    </span>
                  )}
                  {descriptive && (
                    <span className="scenario-descriptive" style={{ opacity: 0.6, fontSize: '0.85em', marginLeft: 6 }} title={pick(lang, '이 시나리오는 현재 엔진에서 실제 시뮬 불가 — 설명용. Apply 시 안내만 표시, 씬 변경 없음.', 'Not simulable in the current engine — descriptive only. Apply shows a notice, no scene change.', '当前引擎无法实际仿真 — 仅说明。Apply 仅显示提示,无场景变更。')}>
                      ⓘ {pick(lang, '설명용', 'descriptive', '仅说明')}
                    </span>
                  )}
                </div>
                <div className="scenario-desc">{pick(lang, sc.desc_ko, sc.desc_en, sc.desc_zh)}</div>
                <div className="scenario-ref">📘 {sc.ref}</div>
                <div className="scenario-result">
                  ▶ {pick(lang, '현재 결과', 'now', '当前结果')}: {ko ? res.label_ko : res.label_en}
                </div>
              </div>
              <button
                className="scenario-apply"
                title={descriptive
                  ? pick(lang, '이 시나리오는 설명용 — Apply 시 안내만 표시, 변경 없음', 'This scenario is descriptive-only — Apply just shows a notice, no change', '此场景仅供说明 — Apply 仅显示提示,无变更')
                  : pick(lang, '이 시나리오대로 씬을 새로 구성해 재현·검증 (기존 배치 초기화)', 'Rebuild the scene per this scenario to reproduce & verify (clears current setup)', '按此场景重建场景以复现·验证 (清除当前布置)')}
                onClick={() => {
                  if (descriptive) {
                    // 설명용 시나리오 — 씬 변경 없이, 패널에 바로 보이는 안내 배너 + 로그.
                    setNotice(pick(lang,
                      `🚫 "${sc.ko}" — 현 시점에서 실제 시뮬레이션 불가 (설명용). 씬/로그 변경 없음.\n예상 절차: ${sc.cause ?? sc.desc_ko ?? ''}`,
                      `🚫 "${sc.en}" — not simulable in the current engine yet (descriptive only). No scene/log change.\nExpected: ${sc.cause ?? sc.desc_en ?? ''}`,
                      `🚫 "${sc.zh}" — 当前引擎尚无法实际仿真 (仅说明)。无场景/日志变更。\n预期: ${sc.cause ?? sc.desc_zh ?? ''}`))
                    applyScenario(sc.id)
                    return
                  }
                  const ok = window.confirm(
                    pick(lang,
                      '기존 설정(장비·측정요원·Core 등)이 모두 지워지고 이 검증 시나리오에 따라 새로 배치됩니다. 계속할까요?',
                      'Your current setup (equipment, test UEs, Core, etc.) will be cleared and rebuilt per this scenario. Continue?',
                      '当前配置(设备·测试UE·Core等)将全部清除并按此验证场景重新部署。是否继续？'),
                  )
                  if (ok) applyScenario(sc.id)
                }}
              >
                {descriptive ? pick(lang, '안내', 'Info', '提示') : pick(lang, '적용', 'Apply', '应用')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { pick, useT } from '../i18n'
import { useStore } from '../store'
import type { TrafficType } from '../types'
import { TRAFFIC_TYPES } from '../types'

export function TopBar() {
  const t = useT()
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const vizMode = useStore((s) => s.vizMode)
  const setVizMode = useStore((s) => s.setVizMode)
  const vizMetric = useStore((s) => s.vizMetric)
  const setVizMetric = useStore((s) => s.setVizMetric)
  const vizDensity = useStore((s) => s.vizDensity)
  const setVizDensity = useStore((s) => s.setVizDensity)
  const sliceY = useStore((s) => s.sliceY)
  const setSliceY = useStore((s) => s.setSliceY)
  const space = useStore((s) => s.space)
  const simStatus = useStore((s) => s.simStatus)
  const showLog = useStore((s) => s.showLog)
  const setShowLog = useStore((s) => s.setShowLog)
  const eventCount = useStore((s) => s.events.length)
  const objects = useStore((s) => s.objects)
  const engine = useStore((s) => s.engine)
  const setEngine = useStore((s) => s.setEngine)
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const showCore = useStore((s) => s.showCore)
  const setShowCore = useStore((s) => s.setShowCore)
  const showNms = useStore((s) => s.showNms)
  const setShowNms = useStore((s) => s.setShowNms)
  const showCall = useStore((s) => s.showCall)
  const setShowCall = useStore((s) => s.setShowCall)
  const callActive = useStore((s) => s.call != null)
  const showScenarios = useStore((s) => s.showScenarios)
  const setShowScenarios = useStore((s) => s.setShowScenarios)
  const personTraffic = useStore((s) => s.personTraffic)
  const personUeOn = useStore((s) => s.personUeOn)
  const setAllPersonTraffic = useStore((s) => s.setAllPersonTraffic)
  const setAllPersonUe = useStore((s) => s.setAllPersonUe)
  const showUeList = useStore((s) => s.showUeList)
  const setShowUeList = useStore((s) => s.setShowUeList)
  const trafficType = useStore((s) => s.trafficType)
  const setTrafficType = useStore((s) => s.setTrafficType)
  const bumpPanel = useStore((s) => s.bumpPanel)
  const persons = objects.filter((o) => o.kind === 'person')
  const anyTraffic = persons.some((p) => personTraffic[p.id])
  const anyUeOn = persons.some((p) => personUeOn[p.id])

  return (
    <div className="topbar panel">
      {/* 브랜드 타이틀 — 모든 언어 고정 "Meta 5G", 영역 내 상하좌우 중앙 */}
      <div className="title-block">
        <div className="title">
          📡 Meta 5G
          <span
            className={`status-dot ${simStatus}`}
            title={
              simStatus === 'running'
                ? t('status_running')
                : simStatus === 'error'
                  ? t('status_error')
                  : t('status_idle')
            }
          />
        </div>
      </div>

      {/* 언어 설정 — 레이블 아래로 EN/한/中 이동 */}
      <div className="tb-group lang-group">
        <div className="tb-label">{pick(lang, '언어설정', 'Language', '语言设置')}</div>
        <div className="seg lang-seg">
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} title={pick(lang, '영어로 표시', 'Switch UI to English', '切换为英文')}>EN</button>
          <button className={lang === 'ko' ? 'on' : ''} onClick={() => setLang('ko')} title={pick(lang, '한국어로 표시', 'Switch UI to Korean', '切换为韩文')}>한</button>
          <button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')} title={pick(lang, '중국어로 표시', 'Switch UI to Chinese', '切换为中文')}>中</button>
        </div>
      </div>

      {/* 파일 (맨 좌측) */}
      <div className="tb-group">
        <div className="tb-label">{pick(lang, '파일', 'File', '文件')}</div>
        <div className="seg">
          <button
            title={pick(lang, '현재 네트워크 구성 저장(JSON)', 'Save config (JSON)', '保存网络配置(JSON)')}
            onClick={() => {
              const blob = new Blob([useStore.getState().exportConfig()], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = 'meta-5g-config.json'
              a.click()
              URL.revokeObjectURL(a.href)
            }}
          >💾 {pick(lang, '저장', 'Save', '保存')}</button>
          <button
            title={pick(lang, '구성 불러오기(JSON)', 'Load config (JSON)', '载入配置(JSON)')}
            onClick={() => {
              const inp = document.createElement('input')
              inp.type = 'file'
              inp.accept = 'application/json'
              inp.onchange = () => {
                const f = inp.files?.[0]
                if (!f) return
                f.text().then((t) => useStore.getState().importConfig(t))
              }
              inp.click()
            }}
          >📂 {pick(lang, '불러오기', 'Load', '载入')}</button>
          <button
            className="reset-btn"
            title={pick(lang, '기본 구성으로 초기화', 'Reset to default', '重置为默认配置')}
            onClick={() => {
              const ok = window.confirm(
                pick(lang,
                  '정말 초기화할까요? 현재 구성이 모두 삭제되고 기본 상태로 돌아갑니다.',
                  'Reset everything? Your current configuration will be cleared.',
                  '确定要重置吗？当前配置将全部删除并恢复到默认状态。'),
              )
              if (ok) useStore.getState().resetScene()
            }}
          >↺ {pick(lang, '초기화', 'Reset', '重置')}</button>
        </div>
      </div>

      {/* 사용자 모드 */}
      <div className="tb-group">
        <div className="tb-label">{pick(lang, '사용자 모드', 'User Mode', '用户模式')}</div>
        <div className="seg">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}
            title={pick(lang, '편집 모드 — 위에서 내려다보며 장비·측정요원·구조물을 배치/설정', 'Edit mode — top-down view to place & configure equipment/UEs/structures', '编辑模式 — 俯视布置并配置设备/终端/结构')}>
            {t('mode_edit')}
          </button>
          <button className={mode === 'walk' ? 'on' : ''} onClick={() => setMode('walk')}
            title={pick(lang, '걷기 모드 — 1인칭 단말 시점으로 실측(드라이브테스트)', 'Walk mode — first-person UE view for live drive-test measurement', '行走模式 — 第一人称终端视角实测(路测)')}>
            {t('mode_walk')}
          </button>
        </div>
      </div>

      {/* 전파 설정 */}
      <div className="tb-group">
        <div className="tb-label">{pick(lang, '전파 설정', 'RF Settings', '无线电设置')}</div>
        <div className="tb-subrows">
          <div className="tb-sub">
            <span className="tb-sub-label">{pick(lang, '전파표시', 'RF display', '显示')}</span>
            <div className="seg small">
              <button className={vizMode === 'volume' ? 'on' : ''} onClick={() => setVizMode('volume')} title={pick(lang, '공간 전체를 3D 볼륨(구름)으로 전파 세기 표시', 'Show RF strength as a 3D volume cloud filling the space', '以3D体积(云)显示全空间信号强度')}>{t('viz_volume')}</button>
              <button className={vizMode === 'slice' ? 'on' : ''} onClick={() => setVizMode('slice')} title={pick(lang, '지정 높이의 수평 단면(히트맵)만 표시', 'Show a horizontal cross-section heatmap at a chosen height', '仅显示指定高度的水平切面(热力图)')}>{t('viz_slice')}</button>
              <button className={vizMode === 'off' ? 'on' : ''} onClick={() => setVizMode('off')} title={pick(lang, '전파 시각화 끄기 (장비 배치만 표시)', 'Turn off RF visualization (show layout only)', '关闭信号可视化 (仅显示布局)')}>{t('viz_off')}</button>
            </div>
          </div>
          <div className="tb-sub">
            <span className="tb-sub-label">{pick(lang, '측정기준', 'Metric', '测量基准')}</span>
            <div className="seg small">
              <button className={vizMetric === 'rsrp' ? 'on' : ''} onClick={() => setVizMetric('rsrp')} title={pick(lang, '수신 신호 세기(RSRP)로 색칠 — 커버리지 확인', 'Color by received signal power (RSRP) — coverage view', '按接收信号强度(RSRP)着色 — 查看覆盖')}>RSRP</button>
              <button className={vizMetric === 'sinr' ? 'on' : ''} onClick={() => setVizMetric('sinr')} title={pick(lang, '신호대간섭잡음비(SINR)로 색칠 — 품질·간섭 확인', 'Color by signal-to-interference (SINR) — quality/interference view', '按信干噪比(SINR)着色 — 查看质量/干扰')}>SINR</button>
              <button className={vizMetric === 'cell' ? 'on' : ''} onClick={() => setVizMetric('cell')} title={pick(lang, '서빙 셀(RU)별로 다른 색 — 셀 경계 확인', 'Color by serving cell (RU) — see cell boundaries', '按服务小区(RU)着色 — 查看小区边界')}>{pick(lang, '셀별', 'Cell', '小区')}</button>
            </div>
          </div>
          <div className="tb-sub">
            <span className="tb-sub-label">{pick(lang, '표현 정밀도', 'Detail', '显示精度')}</span>
            <div className="seg small" title={t('engine_tip')}>
              <button className={engine === 'empirical' ? 'on' : ''} onClick={() => setEngine('empirical')} title={pick(lang, '경험식 모델 — 빠르지만 근사 (실시간 갱신에 적합)', 'Empirical model — fast approximation (good for real-time updates)', '经验模型 — 快速近似 (适合实时更新)')}>{t('engine_fast')}</button>
              <button className={engine === 'rt' ? 'on' : ''} onClick={() => setEngine('rt')} title={pick(lang, '레이트레이싱 — 반사·회절까지 정밀 계산 (느림)', 'Ray tracing — accurate with reflection/diffraction (slower)', '光线追踪 — 精确计算反射/绕射 (较慢)')}>{t('engine_rt')}</button>
            </div>
          </div>
          {vizMode === 'volume' && (
            <label className="slice-ctl" title={pick(lang, '볼륨 구름의 밀도(불투명도) 조절 — 높이면 진하게', 'Adjust volume cloud density/opacity — higher = denser', '调整体积云密度(不透明度) — 越高越浓')}>
              {t('density')}
              <input type="range" min={0.1} max={1.2} step={0.05} value={vizDensity}
                onChange={(e) => setVizDensity(parseFloat(e.target.value))} />
            </label>
          )}
          {vizMode === 'slice' && (
            <label className="slice-ctl" title={pick(lang, '단면 히트맵을 볼 높이(바닥에서 m)를 조절', 'Set the height (m above floor) of the cross-section heatmap', '调整切面热力图的高度(离地m)')}>
              {t('slice_height')} {sliceY.toFixed(1)}m
              <input type="range" min={0.2} max={space.height - 0.2} step={0.1} value={sliceY}
                onChange={(e) => setSliceY(parseFloat(e.target.value))} />
            </label>
          )}
        </div>
      </div>

      {/* NMS */}
      <div className="tb-group">
        <div className="tb-label">NMS</div>
        <div className="seg">
          <button className={showNms ? 'on' : ''} onClick={() => { setShowNms(true); bumpPanel('nms') }}
            title={pick(lang, 'NMS 대시보드 — KPI·커버리지·셀/NF 인벤토리·알람·CSV 기록', 'NMS dashboard — KPIs, coverage, cell/NF inventory, alarms, CSV recording', 'NMS 仪表盘 — KPI·覆盖·小区/NF清单·告警·CSV记录')}>
            📊 Dashboard
          </button>
          <button className={showLog ? 'on' : ''} onClick={() => { setShowLog(true); bumpPanel('log') }}
            title={pick(lang, '이벤트/실스택 로그 패널 열기 (시그널링·NAS·NGAP 등)', 'Open event & real-stack log panel (signaling, NAS, NGAP…)', '打开事件/真实栈日志面板 (信令·NAS·NGAP等)')}>
            {t('log_btn')} {eventCount > 0 ? `(${eventCount})` : ''}
          </button>
        </div>
      </div>

      {/* 네트워크 설정 */}
      <div className="tb-group">
        <div className="tb-label">{pick(lang, '네트워크 설정', 'Network', '网络设置')}</div>
        <div className="seg">
          <button className={showCore ? 'on' : ''} onClick={() => { setShowCore(true); bumpPanel('core') }}
            title={pick(lang, 'RAN/Core 구성 — 지역별 Core(NF·슬라이스·IMSI) + RAN(gNB/eNB/RU·CU/DU 노드별 파라미터)', 'RAN/Core config — per-zone Core (NFs, slices, IMSI) + RAN (per-node gNB/eNB/RU, CU/DU params)', 'RAN/Core 配置 — 分区Core(NF·切片·IMSI) + RAN(gNB/eNB/RU·CU/DU 逐节点参数)')}>☁ RAN/Core</button>
          <button className={showCall || callActive ? 'on' : ''} onClick={() => { setShowCall(true); bumpPanel('call') }}
            title={pick(lang, 'VoNR 음성통화 — 두 측정요원 간 통화 발신/종료·상태 확인', 'VoNR voice call — place/end a call between two test UEs', 'VoNR语音通话 — 两个测试终端间发起/结束通话')}>
            📞 {callActive ? pick(lang, '통화중', 'In call', '通话中') : pick(lang, '통화', 'Call', '通话')}
          </button>
          <button className={showScenarios ? 'on' : ''} onClick={() => { setShowScenarios(true); bumpPanel('scenarios') }}
            title={pick(lang, '실제 5G use case를 한 클릭으로 재현·검증', 'Reproduce & verify real 5G use cases in one click', '一键复现·验证真实5G用例')}>
            🧪 {pick(lang, '시나리오', 'Scenarios', '场景')}
          </button>
        </div>
      </div>

      {/* 트래픽 / 단말 설정 */}
      {persons.length > 0 && (
        <div className="tb-group">
          <div className="tb-label">{pick(lang, '트래픽 / 단말 설정', 'Traffic / UE settings', '流量 / 终端设置')}</div>
          <div className="tb-subrows">
            {/* 트래픽 소레이블: [전체 트래픽 생성](왼쪽) + [5QI 옵션] */}
            <div className="tb-sub">
              <span className="tb-sub-label">{pick(lang, '트래픽', 'Traffic', '流量')}</span>
              <div className="tb-sub-row">
                <button
                  className={anyTraffic ? 'on' : ''}
                  title={pick(lang, '모든 측정요원 트래픽 생성 시작/중지', 'Start/stop traffic for all test UEs', '启动/停止所有测试UE的流量')}
                  onClick={() => setAllPersonTraffic(!anyTraffic)}
                >
                  🚦 {anyTraffic
                    ? pick(lang, '모든 단말 트래픽 중지', 'Stop all-UE traffic', '停止所有终端流量')
                    : pick(lang, '모든 단말 트래픽 생성', 'Generate all-UE traffic', '生成所有终端流量')}
                </button>
                <select
                  className="traffic-type-sel"
                  value={trafficType}
                  title={pick(lang, '트래픽 서비스 종류 (5QI)', 'Traffic service type (5QI)', '流量业务类型 (5QI)')}
                  onChange={(e) => setTrafficType(e.target.value as TrafficType)}
                >
                  {TRAFFIC_TYPES.map((tt) => (
                    <option key={tt.key} value={tt.key}>
                      {tt.icon} {pick(lang, tt.ko, tt.en, tt.zh)} · 5QI{tt.fiveqi}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* 단말 소레이블: [전체 끄기](왼쪽) + [단말 목록] */}
            <div className="tb-sub">
              <span className="tb-sub-label">{pick(lang, '단말', 'UE', '终端')}</span>
              <div className="tb-sub-row">
                <button
                  className={anyUeOn ? 'on' : ''}
                  onClick={() => setAllPersonUe(!anyUeOn)}
                  title={pick(lang, '전체 단말 전원', 'Power all UEs', '全部终端电源')}
                >{anyUeOn ? '📴' : '📱'} {anyUeOn ? pick(lang, '전체 끄기', 'Off all', '全部关') : pick(lang, '전체 켜기', 'On all', '全部开')}</button>
                <button
                  className={showUeList ? 'on' : ''}
                  onClick={() => { setShowUeList(true); bumpPanel('uelist') }}
                  title={pick(lang, '측정요원 목록 (개별 제어)', 'Test-UE list', '测试终端列表')}
                >🚶 {pick(lang, `단말별 설정 (${persons.length})`, `Per-UE settings (${persons.length})`, `终端设置 (${persons.length})`)}</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

import {
  cellColorCss,
  cssGradient,
  RSRP_VIZ_MAX,
  RSRP_VIZ_MIN,
  SINR_VIZ_MAX,
  SINR_VIZ_MIN,
} from '../colormap'
import { pick, useT } from '../i18n'
import { useStore } from '../store'
import { enabledGnbIndex, objZone } from '../types'

export function Legend() {
  const t = useT()
  const vizMetric = useStore((s) => s.vizMetric)
  const vizMode = useStore((s) => s.vizMode)
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)

  if (vizMode === 'off') return null

  // 셀별(오라) 모드 — 라디오 이름 ↔ 색 매핑 범례
  if (vizMode === 'volume' && vizMetric === 'cell') {
    const rus = objects.filter((o) => o.kind === 'gnb' && o.gnb?.enabled !== false)
    return (
      <div className="legend panel">
        <div className="legend-title">{pick(lang, '라디오별 전파 색상', 'Per-radio RF color', '各射频单元信号颜色')}</div>
        <div className="cell-legend">
          {rus.map((r) => (
            <div key={r.id} className="cell-legend-row">
              <span
                className="ru-cell-dot"
                style={{ background: cellColorCss(enabledGnbIndex(r, objects)) }}
              />
              {r.name} <em>({objZone(r)})</em>
            </div>
          ))}
          {rus.length === 0 && (
            <div className="legend-unit">{pick(lang, '켜진 RU 없음', 'no active RU', '无激活 RU')}</div>
          )}
        </div>
        <div className="legend-unit">
          {pick(lang, '색이 진할수록 신호 강함', 'darker = stronger', '颜色越深信号越强')}
        </div>
      </div>
    )
  }

  const [lo, hi, unit] =
    vizMetric === 'rsrp'
      ? [RSRP_VIZ_MIN, RSRP_VIZ_MAX, 'dBm']
      : [SINR_VIZ_MIN, SINR_VIZ_MAX, 'dB']

  const ticks = 5
  return (
    <div className="legend panel">
      <div className="legend-title">
        {vizMetric === 'rsrp' ? t('legend_rsrp') : t('legend_sinr')}
      </div>
      <div className="legend-bar" style={{ background: cssGradient() }} />
      <div className="legend-ticks">
        {Array.from({ length: ticks }, (_, i) => {
          const v = lo + ((hi - lo) * i) / (ticks - 1)
          return <span key={i}>{v.toFixed(0)}</span>
        })}
      </div>
      <div className="legend-unit">
        {unit} · {t('legend_note')}
      </div>
    </div>
  )
}

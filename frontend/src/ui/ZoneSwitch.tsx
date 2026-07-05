// 지역(PLMN) 이동 버튼 — 편집(3인칭)에서는 카메라를 해당 지역으로, 걷기에서는 UE를 이동.
// 오브젝트가 있는 지역만 표시.
import { pick } from '../i18n'
import { useStore } from '../store'
import { ZONES, objZone } from '../types'

export function ZoneSwitch() {
  const lang = useStore((s) => s.lang)
  const objects = useStore((s) => s.objects)
  const goToZone = useStore((s) => s.goToZone)
  const homeZone = useStore((s) => s.homeZone)
  const gotoZoneReq = useStore((s) => s.gotoZoneReq)

  // 오브젝트(RU/사람/장애물)가 하나라도 있는 지역만 이동 대상
  const activeZones = ZONES.filter((z) => objects.some((o) => objZone(o) === z))
  if (activeZones.length < 2) return null

  return (
    <div className="zone-switch">
      <span className="zone-switch-label">{pick(lang, '지역 이동', 'Go to zone', '前往地区')}</span>
      {activeZones.map((z) => (
        <button
          key={z}
          className={gotoZoneReq?.zone === z ? 'on' : ''}
          onClick={() => goToZone(z)}
          title={z === homeZone ? pick(lang, '홈 PLMN', 'Home PLMN', '归属 PLMN') : pick(lang, '방문 PLMN', 'Visited PLMN', '拜访 PLMN')}
        >
          PLMN-{z}
          {z === homeZone && <span className="zone-home">⌂</span>}
        </button>
      ))}
    </div>
  )
}

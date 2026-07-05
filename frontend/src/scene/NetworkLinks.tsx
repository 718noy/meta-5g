// RAN 연결 표시:
//   - passive RU ↔ 외장 안테나: 급전선(RF) 라인 (실물 배치이므로 선 유지)
//   - RU ↔ Core: 선 대신 RU 머리 위에 "RU 이름 + 연결된 5GC(존)" 라벨로 표기
//     (Core는 논리 구성이라 위치가 중요치 않음)
import { Html, Line } from '@react-three/drei'
import { useMemo } from 'react'
import { cellColorCss } from '../colormap'
import { useStore } from '../store'
import type { Zone } from '../types'
import { ZONES, computeE2E, enabledGnbIndex, objZone, zoneOffset } from '../types'

interface RfLink {
  key: string
  a: [number, number, number]
  b: [number, number, number]
}

export function NetworkLinks() {
  const objects = useStore((s) => s.objects)
  const coreNfs = useStore((s) => s.coreNfs)
  const coreDn = useStore((s) => s.coreDn)
  const siteDown = useStore((s) => s.siteDown)
  const space = useStore((s) => s.space)
  const lang = useStore((s) => s.lang)
  const vizMode = useStore((s) => s.vizMode)
  const vizMetric = useStore((s) => s.vizMetric)
  const { width: W, depth: D } = space
  const showCellColor = vizMode === 'volume' && vizMetric === 'cell'

  const { rf, labels } = useMemo(() => {
    const rfOut: RfLink[] = []
    const labelOut: {
      id: string
      pos: [number, number, number]
      name: string
      zone: Zone
      coreOk: boolean
      cellColor: string | null
    }[] = []

    for (const zone of ZONES) {
      const [ox, oz] = zoneOffset(zone, W, D)
      const zObjs = objects.filter((o) => objZone(o) === zone)
      const e2e = computeE2E(objects, coreNfs, coreDn, zone, siteDown)
      const rus = zObjs.filter((o) => o.kind === 'gnb')

      for (const g of rus) {
        const h = g.gnb?.height ?? 2.5
        // passive RU 급전선
        if (g.gnb?.ru_type === 'passive') {
          const ant = zObjs.find((o) => o.kind === 'antenna' && o.link_ru === g.id)
          if (ant) {
            rfOut.push({
              key: `rf-${g.id}`,
              a: [ox + g.position[0], 0.85, oz + g.position[2]],
              b: [ox + ant.position[0], (ant.ant_height ?? 4) - 0.4, oz + ant.position[2]],
            })
          }
        }
        const idx = g.gnb?.enabled !== false ? enabledGnbIndex(g, objects) : -1
        labelOut.push({
          id: g.id,
          pos: [ox + g.position[0], h + 1.0, oz + g.position[2]],
          name: g.name,
          zone,
          coreOk: e2e.ok,
          cellColor: showCellColor && idx >= 0 ? cellColorCss(idx) : null,
        })
      }
    }
    return { rf: rfOut, labels: labelOut }
  }, [objects, coreNfs, coreDn, siteDown, W, D, showCellColor])

  return (
    <group>
      {rf.map((l) => (
        <Line
          key={l.key}
          points={[l.a, l.b]}
          color="#c8ced8"
          lineWidth={1.5}
          dashed
          dashSize={0.5}
          gapSize={0.25}
          transparent
          opacity={0.75}
        />
      ))}
      {labels.map((l) => (
        <Html key={l.id} position={l.pos} center distanceFactor={40} zIndexRange={[0, 10]}>
          <div className={`ru-label zone-${l.zone}`}>
            <div className="ru-label-name">
              {l.cellColor && (
                <span className="ru-cell-dot" style={{ background: l.cellColor }} />
              )}
              {l.name}
            </div>
            <div className={`ru-label-core ${l.coreOk ? '' : 'down'}`}>
              {l.coreOk
                ? `⛓ 5GC-${l.zone}`
                : lang === 'ko'
                  ? `⚠ Core-${l.zone} 미구성`
                  : `⚠ Core-${l.zone} down`}
            </div>
          </div>
        </Html>
      ))}
    </group>
  )
}

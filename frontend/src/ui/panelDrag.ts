import { useCallback, useRef, useState } from 'react'

// 서브윈도우(패널)를 헤더로 드래그해 이동. CSS 기본 위치에서의 오프셋(transform)만 관리하므로
// 리마운트(버튼 재클릭 시 key 변경) 시 오프셋이 0으로 돌아가 자동으로 디폴트 위치로 리셋된다.
// 헤더 안의 버튼/입력 위에서 시작한 포인터다운은 무시해 클릭을 방해하지 않는다.
export function usePanelDrag() {
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('button, input, select, textarea, a, [data-nodrag]')) return
      if (e.button !== 0) return
      e.preventDefault()
      drag.current = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y }
      const move = (ev: PointerEvent) => {
        const d = drag.current
        if (!d) return
        setOff({ x: d.ox + (ev.clientX - d.sx), y: d.oy + (ev.clientY - d.sy) })
      }
      const up = () => {
        drag.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [off.x, off.y],
  )

  // 패널 루트 style 에 펼쳐 넣고, 헤더에 headerProps 를 펼쳐 넣는다.
  const dragStyle: React.CSSProperties = { transform: `translate(${off.x}px, ${off.y}px)` }
  const headerProps = { onPointerDown: onHeaderPointerDown, style: { cursor: 'move' as const } }
  return { dragStyle, headerProps }
}

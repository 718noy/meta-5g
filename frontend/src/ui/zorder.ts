// 플로팅 패널 z-index 관리 — 새로 열리거나 클릭된 창이 항상 최상단에 오도록.
//   패널 루트에 ref={frontRef} 만 붙이면 됨:
//     - mount(=창 열림) 시 다음 순번을 받아 기존 창들 위로 올라가고,
//     - 패널 아무 곳이나 pointerdown 하면 다시 최상단으로.
//   기준값 40 = ZoneSwitch(z:20)·마퀴 박스(z:5)·헤더 sticky(z:6)보다 위.
//   같은 요소에 대해선 한 번만 초기화(멱등) → 인라인 콜백 ref 병합에도 안전.
let TOP = 40
const SEEN = new WeakSet<HTMLElement>()

export function frontRef(el: HTMLElement | null): void {
  if (!el || SEEN.has(el)) return
  SEEN.add(el)
  el.style.zIndex = String((TOP += 1))
  el.addEventListener('pointerdown', () => {
    el.style.zIndex = String((TOP += 1))
  })
}

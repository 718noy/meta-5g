// 실행취소/다시실행 — 씬 편집(objects/coreNfs/coreDn/slices/space) 스냅샷 히스토리.
// 변경을 디바운스로 감지해 과거 스택에 쌓고 Ctrl+Z / Ctrl+Shift+Z(또는 Ctrl+Y)로 이동.
//
// 중요: capacity.ts의 주기 시뮬레이터가 부하 시 HPA로 replicas를 자동 증가시키고(크래시 시
// enabled 자동 해제) coreNfs를 갱신한다. 이 자동 변경이 실행취소 스택을 오염시키면 Ctrl+Z가
// 사용자 편집이 아닌 시스템 틱을 되돌려 "안 되는 것처럼" 보인다. 그래서 "새 히스토리 항목을
// 쌓을지"를 판단하는 키(stableKey)에서는 자동/휘발 필드(replicas, enabled)를 제외하고,
// 복원용 스냅샷(fullKey)에는 전체 상태를 담는다. 직렬화 실패도 조용히 무시(방어).
import { useEffect, useRef } from 'react'
import { useStore } from './store'
import { pick } from './i18n'

interface Snap {
  objects: unknown
  coreNfs: unknown
  coreDn: unknown
  slices: unknown
  space: unknown
  ranUnits: unknown // RAN 논리유닛(CU/DU) — 편집 실행취소 대상
  // BUG6: UE 런타임 맵을 스냅샷에 포함 — UE 삭제 실행취소 시 IMSI/전원/차단/부가서비스 복원.
  // 이 맵들은 HPA 틱(replicas/enabled)으로 바뀌지 않으므로 stableKey에 들어가도 자동 틱을 오염시키지 않는다.
  personImsi: unknown
  personUeOn: unknown
  personTraffic: unknown
  personTrafficType: unknown
  personBarred: unknown
  personSupp: unknown
  registeredImsis: unknown
}

function snapOf(): Snap {
  const s = useStore.getState()
  return {
    objects: s.objects, coreNfs: s.coreNfs, coreDn: s.coreDn,
    slices: s.slices, space: s.space, ranUnits: s.ranUnits,
    personImsi: s.personImsi, personUeOn: s.personUeOn, personTraffic: s.personTraffic,
    personTrafficType: s.personTrafficType, personBarred: s.personBarred, personSupp: s.personSupp,
    registeredImsis: s.registeredImsis,
  }
}

// 복원용 전체 스냅샷 키(전체 상태 직렬화)
function fullKey(x: Snap): string {
  try { return JSON.stringify(x) } catch { return '' }
}

// "히스토리 항목을 쌓을지" 판단용 안정 키 — 시뮬레이터가 자동으로 바꾸는 휘발 필드 제외.
function stableKey(x: Snap): string {
  try {
    const core = Array.isArray(x.coreNfs)
      ? (x.coreNfs as Record<string, unknown>[]).map((n) => {
          if (!n || typeof n !== 'object') return n
          // 자동 변경 필드 제외: replicas(HPA), enabled(크래시 자동 비활성)
          const { replicas: _r, enabled: _e, ...rest } = n
          void _r; void _e
          return rest
        })
      : x.coreNfs
    return JSON.stringify({ ...x, coreNfs: core })
  } catch { return '' }
}

export function useHistory() {
  const past = useRef<string[]>([]) // 전체 스냅샷(복원용) 스택
  const future = useRef<string[]>([])
  const applying = useRef(false)
  const lastStable = useRef<string>('')
  const debounce = useRef<number | null>(null)

  useEffect(() => {
    lastStable.current = stableKey(snapOf())
    past.current = [fullKey(snapOf())]

    const unsub = useStore.subscribe((state, prev) => {
      if (
        state.objects === prev.objects &&
        state.coreNfs === prev.coreNfs &&
        state.coreDn === prev.coreDn &&
        state.slices === prev.slices &&
        state.space === prev.space &&
        state.ranUnits === prev.ranUnits
      )
        return
      if (applying.current) return
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = window.setTimeout(() => {
        const sk = stableKey(snapOf())
        // 안정 키가 바뀐 경우에만(=실제 구조적 사용자 편집) 히스토리에 쌓는다.
        // HPA replicas / 크래시 enabled 같은 자동 변경은 sk를 바꾸지 않아 무시된다.
        if (sk && sk !== lastStable.current) {
          past.current.push(fullKey(snapOf()))
          if (past.current.length > 50) past.current.shift()
          future.current = []
          lastStable.current = sk
        }
      }, 350)
    })

    const restore = (full: string) => {
      if (!full) return
      applying.current = true
      try {
        useStore.getState().applySnapshot(JSON.parse(full))
      } catch {
        /* 직렬화/복원 실패는 무시 — 히스토리가 깨지지 않게 */
      }
      lastStable.current = stableKey(snapOf())
      setTimeout(() => (applying.current = false), 50)
    }

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const z = e.key === 'z' || e.key === 'Z'
      const y = e.key === 'y' || e.key === 'Y'
      if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) {
        if (past.current.length > 1) {
          const cur = past.current.pop()!
          future.current.push(cur)
          restore(past.current[past.current.length - 1])
          useStore.getState().addEvent('SIM', 'info', pick(useStore.getState().lang, '실행취소', 'Undo', '撤销'))
        }
        e.preventDefault()
      } else if ((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey))) {
        if (future.current.length > 0) {
          const k = future.current.pop()!
          past.current.push(k)
          restore(k)
          useStore.getState().addEvent('SIM', 'info', pick(useStore.getState().lang, '다시실행', 'Redo', '重做'))
        }
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unsub()
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

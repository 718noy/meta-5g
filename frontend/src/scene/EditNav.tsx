// 편집 모드 시점 이동 — WASD/화살표로 카메라+궤도 타깃을 수평 패닝.
// (마우스: 좌드래그 회전 · 우드래그 패닝 · 휠 줌은 OrbitControls 기본 제공)
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

export function EditNav() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const keys = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      keys.current[e.code] = true
    }
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((_, dt) => {
    if (useStore.getState().mode !== 'edit' || !controls) return
    const k = keys.current
    const dir = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) return
    fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0))

    if (k['KeyW'] || k['ArrowUp']) dir.add(fwd)
    if (k['KeyS'] || k['ArrowDown']) dir.sub(fwd)
    if (k['KeyD'] || k['ArrowRight']) dir.add(right)
    if (k['KeyA'] || k['ArrowLeft']) dir.sub(right)
    if (dir.lengthSq() === 0) return

    dir.normalize()
    // 줌 레벨에 비례한 이동 속도 (멀리서 보면 빠르게)
    const dist = camera.position.distanceTo(controls.target)
    const speed = Math.max(dist * 0.6, 8) * (k['ShiftLeft'] || k['ShiftRight'] ? 2.5 : 1)
    const delta = dir.multiplyScalar(speed * Math.min(dt, 0.05))
    camera.position.add(delta)
    controls.target.add(delta)
    controls.update()
  })

  return null
}

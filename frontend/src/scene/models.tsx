// 절차적 3D 모델 — 외부 에셋 없이 게임 느낌이 나도록 재질/디테일을 잡는다.
import { RoundedBox } from '@react-three/drei'
import type { SceneObject } from '../types'
import { CATALOG } from '../types'

// 실제 기지국 라디오의 일반적 형상을 참조한 절차적 모델 (특정 제조사 디자인 아님).
// 옴니 = 폴 + 원통형 라돔 / 섹터 = 패널 라디오(방열핀) / 빔포밍 = 정방형 어레이 패널
// Passive RU: 안테나 없는 라디오 유닛 본체 — 외장 안테나에 급전선으로 연결
function PassiveRuModel({ enabled }: { enabled: boolean }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[0.55, 0.1, 0.45]} />
        <meshStandardMaterial color="#3a3f46" metalness={0.6} roughness={0.4} />
      </mesh>
      <RoundedBox castShadow args={[0.45, 0.65, 0.35]} radius={0.03} smoothness={3}
        position={[0, 0.45, 0]}>
        <meshStandardMaterial color="#c9ced6" metalness={0.35} roughness={0.5} />
      </RoundedBox>
      {/* 방열핀 */}
      {[-0.15, -0.05, 0.05, 0.15].map((x, i) => (
        <mesh key={i} castShadow position={[x, 0.45, -0.2]}>
          <boxGeometry args={[0.03, 0.55, 0.06]} />
          <meshStandardMaterial color="#9aa1ab" metalness={0.55} roughness={0.45} />
        </mesh>
      ))}
      {/* 상단 RF 출력 포트 (급전선 연결부) */}
      {[-0.1, 0.1].map((x, i) => (
        <mesh key={`p${i}`} position={[x, 0.82, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.08, 10]} />
          <meshStandardMaterial color="#22262b" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0.15, 0.62, 0.18]}>
        <sphereGeometry args={[0.025, 10, 10]} />
        <meshStandardMaterial
          color={enabled ? '#2bff88' : '#555'}
          emissive={enabled ? '#00cc55' : '#000'}
          emissiveIntensity={enabled ? 2.5 : 0}
        />
      </mesh>
    </group>
  )
}

// 외장 안테나: 마스트 + 지향성 라돔 패널 (전면 +x)
function AntennaModel({ obj }: { obj: SceneObject }) {
  const h = obj.ant_height ?? 4
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.06, 20]} />
        <meshStandardMaterial color="#3a3f46" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.035, 0.045, h, 14]} />
        <meshStandardMaterial color="#8a919b" metalness={0.8} roughness={0.3} />
      </mesh>
      <group position={[0.12, h - 0.15, 0]} rotation={[0, Math.PI / 2, 0]}>
        <RoundedBox castShadow args={[0.3, 0.7, 0.08]} radius={0.03} smoothness={4}
          position={[0, 0, 0.04]}>
          <meshStandardMaterial color="#dfe3e8" roughness={0.45} />
        </RoundedBox>
        {/* 브래킷 */}
        {[0.25, -0.25].map((y, i) => (
          <mesh key={i} position={[0, y, -0.05]}>
            <boxGeometry args={[0.08, 0.05, 0.08]} />
            <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
        {/* 하단 급전 포트 */}
        <mesh position={[0, -0.38, 0.02]}>
          <cylinderGeometry args={[0.015, 0.015, 0.06, 8]} />
          <meshStandardMaterial color="#22262b" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  )
}

// 천장형 소형 RU (실내 소형셀) — 천장(높이 h)에 부착된 원반형 라돔
function CeilingRuModel({ enabled, h }: { enabled: boolean; h: number }) {
  return (
    <group position={[0, h, 0]}>
      {/* 천장 브래킷 */}
      <mesh castShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.08, 12]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.35} />
      </mesh>
      {/* 원반형 본체 (아래로 방사) */}
      <mesh castShadow position={[0, -0.03, 0]}>
        <cylinderGeometry args={[0.22, 0.19, 0.07, 28]} />
        <meshStandardMaterial color="#e8ebee" roughness={0.5} />
      </mesh>
      {/* 상태 LED */}
      <mesh position={[0.1, -0.07, 0]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial
          color={enabled ? '#2bd680' : '#555'}
          emissive={enabled ? '#2bd680' : '#000'}
          emissiveIntensity={enabled ? 1.4 : 0}
        />
      </mesh>
    </group>
  )
}

// 벽면 부착형 RU — 얇은 패널 (전면 +x 방향으로 방사)
function WallRuModel({ enabled, h }: { enabled: boolean; h: number }) {
  return (
    <group position={[0, h, 0]}>
      {/* 벽 브래킷 */}
      <mesh castShadow position={[-0.06, 0, 0]}>
        <boxGeometry args={[0.05, 0.4, 0.3]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* 패널 본체 */}
      <mesh castShadow position={[0.03, 0, 0]}>
        <boxGeometry args={[0.12, 0.55, 0.34]} />
        <meshStandardMaterial color="#dfe3e8" roughness={0.5} />
      </mesh>
      <mesh position={[0.1, 0.2, 0]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial
          color={enabled ? '#2bd680' : '#555'}
          emissive={enabled ? '#2bd680' : '#000'}
          emissiveIntensity={enabled ? 1.4 : 0}
        />
      </mesh>
    </group>
  )
}

function GnbModel({ obj }: { obj: SceneObject }) {
  const h = obj.gnb?.height ?? 2.5
  const enabled = obj.gnb?.enabled ?? true
  const ant = obj.gnb?.antenna ?? 'omni'
  const radomeCol = '#dfe3e8'
  const bodyCol = '#c9ced6'
  const finCol = '#9aa1ab'

  if (obj.gnb?.ru_type === 'passive') return <PassiveRuModel enabled={enabled} />

  const mount = obj.gnb?.mount ?? 'pole'
  if (mount === 'ceiling') return <CeilingRuModel enabled={enabled} h={h} />
  if (mount === 'wall') return <WallRuModel enabled={enabled} h={h} />

  return (
    <group>
      {/* 받침대 + 폴 */}
      <mesh castShadow receiveShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.08, 24]} />
        <meshStandardMaterial color="#3a3f46" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.045, 0.06, h, 16]} />
        <meshStandardMaterial color="#8a919b" metalness={0.8} roughness={0.3} />
      </mesh>

      {ant === 'omni' && (
        // 원통형 옴니 라돔 (콜리니어 안테나 스타일)
        <group position={[0, h, 0]}>
          <mesh castShadow position={[0, 0.28, 0]}>
            <cylinderGeometry args={[0.045, 0.055, 0.6, 20]} />
            <meshStandardMaterial color={radomeCol} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.6, 0]}>
            <sphereGeometry args={[0.045, 16, 12]} />
            <meshStandardMaterial color={radomeCol} roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0, -0.05, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.1, 16]} />
            <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.35} />
          </mesh>
        </group>
      )}

      {ant === 'sector' && (
        // 실제 RU 스타일: 라운드 라돔 패널(전면 +x 방향) + 후면 방열핀 블록 +
        // 폴 마운팅 브래킷 2개 + 하단 RF/광 포트 + 상태 LED
        <group position={[0.2, h - 0.1, 0]} rotation={[0, Math.PI / 2, 0]}>
          {/* 전면 라돔 (둥근 모서리) */}
          <RoundedBox castShadow args={[0.34, 0.8, 0.09]} radius={0.035} smoothness={4}
            position={[0, 0.12, 0.05]}>
            <meshStandardMaterial color={radomeCol} roughness={0.45} />
          </RoundedBox>
          {/* 본체 */}
          <RoundedBox castShadow args={[0.3, 0.74, 0.07]} radius={0.02} smoothness={3}
            position={[0, 0.12, -0.03]}>
            <meshStandardMaterial color={bodyCol} metalness={0.35} roughness={0.5} />
          </RoundedBox>
          {/* 후면 방열핀 */}
          {[-0.11, -0.055, 0, 0.055, 0.11].map((x, i) => (
            <mesh key={i} castShadow position={[x, 0.12, -0.09]}>
              <boxGeometry args={[0.025, 0.66, 0.06]} />
              <meshStandardMaterial color={finCol} metalness={0.55} roughness={0.45} />
            </mesh>
          ))}
          {/* 폴 브래킷 (상/하) */}
          {[0.42, -0.18].map((y, i) => (
            <group key={`b${i}`} position={[0, y, -0.14]}>
              <mesh castShadow>
                <boxGeometry args={[0.12, 0.06, 0.12]} />
                <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0, -0.06]}>
                <cylinderGeometry args={[0.07, 0.07, 0.05, 12]} />
                <meshStandardMaterial color="#3a3f46" metalness={0.7} roughness={0.4} />
              </mesh>
            </group>
          ))}
          {/* 하단 포트 (RF ×2 + 광/전원 ×2) */}
          {[-0.1, -0.035, 0.035, 0.1].map((x, i) => (
            <mesh key={`p${i}`} position={[x, -0.29, 0]}>
              <cylinderGeometry args={[i < 2 ? 0.016 : 0.012, i < 2 ? 0.016 : 0.012, 0.07, 10]} />
              <meshStandardMaterial color="#22262b" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          {/* 전면 상태 LED 스트립 */}
          <mesh position={[0.1, 0.46, 0.098]}>
            <boxGeometry args={[0.06, 0.015, 0.005]} />
            <meshStandardMaterial
              color={enabled ? '#2bff88' : '#555'}
              emissive={enabled ? '#00cc55' : '#000'}
              emissiveIntensity={enabled ? 2 : 0}
            />
          </mesh>
        </group>
      )}

      {ant === 'beam' && (
        // 정방형 다중안테나 어레이 패널 (방열핀 강화)
        <group position={[0.18, h - 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh castShadow position={[0, 0.1, 0.03]}>
            <boxGeometry args={[0.48, 0.48, 0.08]} />
            <meshStandardMaterial color={radomeCol} roughness={0.45} />
          </mesh>
          {/* 어레이 소자 힌트 (전면 격자) */}
          {[-0.15, -0.05, 0.05, 0.15].map((x) =>
            [-0.15, -0.05, 0.05, 0.15].map((y) => (
              <mesh key={`${x}-${y}`} position={[x, 0.1 + y, 0.075]}>
                <boxGeometry args={[0.05, 0.05, 0.004]} />
                <meshStandardMaterial color="#c4cad2" roughness={0.4} />
              </mesh>
            )),
          )}
          <mesh castShadow position={[0, 0.1, -0.05]}>
            <boxGeometry args={[0.44, 0.44, 0.08]} />
            <meshStandardMaterial color={bodyCol} metalness={0.4} roughness={0.5} />
          </mesh>
          {[-0.16, -0.08, 0, 0.08, 0.16].map((x, i) => (
            <mesh key={i} castShadow position={[x, 0.1, -0.12]}>
              <boxGeometry args={[0.03, 0.4, 0.07]} />
              <meshStandardMaterial color={finCol} metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}

      {/* 상태 램프 */}
      <mesh position={[0, h + (ant === 'omni' ? 0.72 : 0.55), 0]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial
          color={enabled ? '#2bff88' : '#555'}
          emissive={enabled ? '#00cc55' : '#000'}
          emissiveIntensity={enabled ? 2.5 : 0}
        />
      </mesh>
    </group>
  )
}

function WallModel({ obj }: { obj: SceneObject }) {
  const [w, h, t] = obj.size ?? CATALOG.wall.size
  return (
    <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
      <boxGeometry args={[w, h, t]} />
      <meshStandardMaterial color="#b6b0a6" roughness={0.95} />
    </mesh>
  )
}

function GlassWallModel({ obj }: { obj: SceneObject }) {
  const [w, h, t] = obj.size ?? CATALOG.glasswall.size
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, t]} />
        <meshPhysicalMaterial
          color="#bfe3ee"
          transparent
          opacity={0.28}
          roughness={0.05}
          metalness={0}
          side={2}
        />
      </mesh>
      {/* 프레임 */}
      <mesh castShadow position={[0, h, 0]}>
        <boxGeometry args={[w, 0.05, t + 0.03]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh castShadow position={[0, 0.025, 0]}>
        <boxGeometry args={[w, 0.05, t + 0.03]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  )
}

function DeskModel() {
  const [w, h, d] = CATALOG.desk.size
  const legX = w / 2 - 0.05
  const legZ = d / 2 - 0.05
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, h - 0.02, 0]}>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color="#9a6f4b" roughness={0.7} />
      </mesh>
      {[
        [-legX, -legZ], [legX, -legZ], [-legX, legZ], [legX, legZ],
      ].map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, (h - 0.04) / 2, z]}>
          <boxGeometry args={[0.05, h - 0.04, 0.05]} />
          <meshStandardMaterial color="#5c4530" roughness={0.8} />
        </mesh>
      ))}
      {/* 모니터 */}
      <mesh castShadow position={[0, h + 0.18, -d / 4]}>
        <boxGeometry args={[0.5, 0.3, 0.03]} />
        <meshStandardMaterial color="#15181c" roughness={0.4} emissive="#0a2a3a" emissiveIntensity={0.6} />
      </mesh>
      <mesh castShadow position={[0, h + 0.015, -d / 4]}>
        <cylinderGeometry args={[0.06, 0.09, 0.03, 12]} />
        <meshStandardMaterial color="#2a2e33" />
      </mesh>
    </group>
  )
}

function ChairModel() {
  return (
    <group>
      <mesh castShadow position={[0, 0.44, 0]}>
        <boxGeometry args={[0.45, 0.06, 0.45]} />
        <meshStandardMaterial color="#3f5875" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.7, 0.21]}>
        <boxGeometry args={[0.45, 0.5, 0.06]} />
        <meshStandardMaterial color="#3f5875" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.44, 12]} />
        <meshStandardMaterial color="#2a2e33" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh castShadow position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.04, 16]} />
        <meshStandardMaterial color="#2a2e33" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  )
}

function CabinetModel() {
  const [w, h, d] = CATALOG.cabinet.size
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#7d8794" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* 문 라인/손잡이 */}
      <mesh position={[0, h / 2, d / 2 + 0.002]}>
        <boxGeometry args={[0.015, h - 0.1, 0.004]} />
        <meshStandardMaterial color="#4d555f" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh castShadow position={[w / 4, h / 2, d / 2 + 0.02]}>
        <boxGeometry args={[0.03, 0.15, 0.03]} />
        <meshStandardMaterial color="#3a4048" metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  )
}

// 폰을 든 측정 요원 — 배치형 UE
function PersonModel() {
  return (
    <group>
      {/* 다리 */}
      <mesh castShadow position={[-0.09, 0.4, 0]}>
        <capsuleGeometry args={[0.07, 0.6, 4, 8]} />
        <meshStandardMaterial color="#3a4152" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0.09, 0.4, 0]}>
        <capsuleGeometry args={[0.07, 0.6, 4, 8]} />
        <meshStandardMaterial color="#3a4152" roughness={0.8} />
      </mesh>
      {/* 몸통 */}
      <mesh castShadow position={[0, 1.05, 0]}>
        <capsuleGeometry args={[0.17, 0.45, 4, 12]} />
        <meshStandardMaterial color="#4d7dab" roughness={0.7} />
      </mesh>
      {/* 머리 */}
      <mesh castShadow position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color="#d9b99a" roughness={0.6} />
      </mesh>
      {/* 왼팔 — 앞으로 굽혀 폰을 받침 */}
      <mesh castShadow position={[-0.15, 1.18, 0.13]} rotation={[1.05, 0, 0.32]}>
        <capsuleGeometry args={[0.05, 0.34, 4, 8]} />
        <meshStandardMaterial color="#4d7dab" roughness={0.7} />
      </mesh>
      {/* 오른팔 — 앞으로 굽혀 폰을 받침 */}
      <mesh castShadow position={[0.15, 1.18, 0.13]} rotation={[1.05, 0, -0.32]}>
        <capsuleGeometry args={[0.05, 0.34, 4, 8]} />
        <meshStandardMaterial color="#4d7dab" roughness={0.7} />
      </mesh>
      {/* 두 손 (살색) — 폰을 양손으로 받침 */}
      <mesh castShadow position={[-0.07, 1.29, 0.27]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#d9b99a" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0.07, 1.29, 0.27]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#d9b99a" roughness={0.6} />
      </mesh>
      {/* 폰 (화면 발광) — 두 손 사이 중앙, 얼굴 향해 살짝 기울임 */}
      <mesh castShadow position={[0, 1.33, 0.3]} rotation={[0.42, 0, 0]}>
        <boxGeometry args={[0.09, 0.17, 0.012]} />
        <meshStandardMaterial color="#15181c" emissive="#3da9ff" emissiveIntensity={1.3} />
      </mesh>
    </group>
  )
}

// 고정 UE — 공장 기계 껍데기의 산업용 단말(사람 아님). 상단에 소형 안테나 + 연결 LED.
function FixedUeModel() {
  return (
    <group>
      {/* 본체 (산업용 인클로저) */}
      <RoundedBox castShadow receiveShadow args={[0.8, 1.2, 0.6]} radius={0.04} smoothness={3}
        position={[0, 0.6, 0]}>
        <meshStandardMaterial color="#5b6470" metalness={0.7} roughness={0.4} />
      </RoundedBox>
      {/* 받침 베이스 */}
      <mesh castShadow receiveShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[0.9, 0.1, 0.7]} />
        <meshStandardMaterial color="#3a4048" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* HMI 터치 스크린 (발광) */}
      <mesh position={[0, 0.82, 0.31]}>
        <boxGeometry args={[0.5, 0.34, 0.02]} />
        <meshStandardMaterial color="#10151b" emissive="#3da9ff" emissiveIntensity={1.1} />
      </mesh>
      {/* 방열 그릴 */}
      {[-0.18, -0.06, 0.06, 0.18].map((x, i) => (
        <mesh key={i} position={[x, 0.3, 0.31]}>
          <boxGeometry args={[0.05, 0.24, 0.01]} />
          <meshStandardMaterial color="#2a2e33" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {/* 5G 연결 안테나 (whip) + 팁 LED */}
      <mesh castShadow position={[0.28, 1.42, -0.1]}>
        <cylinderGeometry args={[0.015, 0.02, 0.5, 10]} />
        <meshStandardMaterial color="#22262b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.28, 1.69, -0.1]}>
        <sphereGeometry args={[0.03, 10, 8]} />
        <meshStandardMaterial color="#2bff88" emissive="#00cc55" emissiveIntensity={2.2} />
      </mesh>
      {/* 상태 표시등 */}
      <mesh position={[-0.28, 1.05, 0.31]}>
        <sphereGeometry args={[0.04, 10, 8]} />
        <meshStandardMaterial color="#ffb43d" emissive="#ffb43d" emissiveIntensity={1.1} />
      </mesh>
    </group>
  )
}

// 천장형 외장 안테나 — 천장(ant_height)에 매달린 하향 지향 라돔
function CeilingAntennaModel({ obj }: { obj: SceneObject }) {
  const h = obj.ant_height ?? 4
  return (
    <group position={[0, h, 0]}>
      {/* 천장 마운트 */}
      <mesh castShadow position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.06, 12]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.7} roughness={0.35} />
      </mesh>
      {/* 짧은 드롭 스템 */}
      <mesh castShadow position={[0, -0.14, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.22, 10]} />
        <meshStandardMaterial color="#8a919b" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* 원반형 하향 라돔 */}
      <mesh castShadow position={[0, -0.3, 0]}>
        <cylinderGeometry args={[0.2, 0.16, 0.12, 24]} />
        <meshStandardMaterial color="#dfe3e8" roughness={0.5} />
      </mesh>
      <mesh position={[0.09, -0.36, 0]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial color="#2bd680" emissive="#2bd680" emissiveIntensity={1.4} />
      </mesh>
    </group>
  )
}

// 벽면형 외장 안테나 — 벽 브래킷 + 얇은 세로 패널 라돔 (전면 +x)
function WallAntennaModel({ obj }: { obj: SceneObject }) {
  const h = obj.ant_height ?? 3
  return (
    <group position={[0, h, 0]}>
      {/* 벽 브래킷 */}
      <mesh castShadow position={[-0.09, 0, 0]}>
        <boxGeometry args={[0.06, 0.5, 0.14]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* 세로 패널 라돔 */}
      <RoundedBox castShadow args={[0.1, 0.75, 0.22]} radius={0.03} smoothness={3}
        position={[0.02, 0, 0]}>
        <meshStandardMaterial color="#dfe3e8" roughness={0.45} />
      </RoundedBox>
      {/* 하단 급전 포트 */}
      <mesh position={[0.02, -0.4, 0.02]}>
        <cylinderGeometry args={[0.015, 0.015, 0.06, 8]} />
        <meshStandardMaterial color="#22262b" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  )
}

function PillarModel({ obj }: { obj: SceneObject }) {
  const [w, h] = obj.size ?? CATALOG.pillar.size
  return (
    <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
      <cylinderGeometry args={[w / 2, w / 2, h, 20]} />
      <meshStandardMaterial color="#b0aaa0" roughness={0.95} />
    </mesh>
  )
}

function DoorModel({ obj }: { obj: SceneObject }) {
  const [w, h, t] = obj.size ?? CATALOG.door.size
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#7a5330" roughness={0.7} />
      </mesh>
      <mesh position={[w / 2 - 0.1, h / 2, t / 2 + 0.02]}>
        <sphereGeometry args={[0.04, 10, 8]} />
        <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  )
}

function TableModel() {
  const [w, h, d] = CATALOG.table.size
  const lx = w / 2 - 0.06
  const lz = d / 2 - 0.06
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, h - 0.03, 0]}>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color="#9a6f4b" roughness={0.65} />
      </mesh>
      {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, (h - 0.05) / 2, z]}>
          <cylinderGeometry args={[0.03, 0.03, h - 0.05, 10]} />
          <meshStandardMaterial color="#7d5638" roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function ShelfModel({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size ?? CATALOG.shelf.size
  const shelves = 4
  return (
    <group>
      {/* 세로 프레임 */}
      {[[-w / 2 + 0.03, -d / 2 + 0.03], [w / 2 - 0.03, -d / 2 + 0.03], [-w / 2 + 0.03, d / 2 - 0.03], [w / 2 - 0.03, d / 2 - 0.03]].map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, h / 2, z]}>
          <boxGeometry args={[0.05, h, 0.05]} />
          <meshStandardMaterial color="#8b939c" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      {/* 선반 판 */}
      {Array.from({ length: shelves }).map((_, i) => (
        <mesh key={i} castShadow receiveShadow position={[0, (h / (shelves - 1)) * i + 0.02, 0]}>
          <boxGeometry args={[w, 0.03, d]} />
          <meshStandardMaterial color="#9aa2ab" metalness={0.7} roughness={0.45} />
        </mesh>
      ))}
    </group>
  )
}

function SofaModel() {
  const [w, h, d] = CATALOG.sofa.size
  const col = '#4a5568'
  return (
    <group>
      {/* 좌석 베이스 */}
      <mesh castShadow receiveShadow position={[0, h * 0.35, 0]}>
        <boxGeometry args={[w, h * 0.5, d]} />
        <meshStandardMaterial color={col} roughness={0.85} />
      </mesh>
      {/* 등받이 */}
      <mesh castShadow position={[0, h * 0.7, -d / 2 + 0.12]}>
        <boxGeometry args={[w, h * 0.6, 0.22]} />
        <meshStandardMaterial color={col} roughness={0.85} />
      </mesh>
      {/* 팔걸이 */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * (w / 2 - 0.1), h * 0.55, 0]}>
          <boxGeometry args={[0.2, h * 0.55, d]} />
          <meshStandardMaterial color={col} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

function MachineModel({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size ?? CATALOG.machine.size
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#6b7480" metalness={0.75} roughness={0.4} />
      </mesh>
      {/* 상단 제어 패널 (발광) */}
      <mesh position={[0, h * 0.75, d / 2 + 0.01]}>
        <boxGeometry args={[w * 0.4, h * 0.2, 0.02]} />
        <meshStandardMaterial color="#10151b" emissive="#2bd6a0" emissiveIntensity={0.9} />
      </mesh>
      {/* 파이프/덕트 */}
      <mesh castShadow position={[w / 2 - 0.1, h + 0.15, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.3, 10]} />
        <meshStandardMaterial color="#4d555f" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* 경고등 */}
      <mesh position={[-w / 2 + 0.15, h + 0.1, 0]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color="#ffb43d" emissive="#ffb43d" emissiveIntensity={1.2} />
      </mesh>
    </group>
  )
}

function PlantModel() {
  const [, h] = CATALOG.plant.size
  return (
    <group>
      {/* 화분 */}
      <mesh castShadow receiveShadow position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.18, 0.13, 0.3, 16]} />
        <meshStandardMaterial color="#a2603b" roughness={0.8} />
      </mesh>
      {/* 잎 */}
      <mesh castShadow position={[0, h * 0.6, 0]}>
        <sphereGeometry args={[0.28, 12, 10]} />
        <meshStandardMaterial color="#3f7a3a" roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0.12, h * 0.82, 0.05]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color="#4c8c45" roughness={0.85} />
      </mesh>
    </group>
  )
}

export function ObjectModel({ obj }: { obj: SceneObject }) {
  switch (obj.kind) {
    case 'gnb':
      return <GnbModel obj={obj} />
    case 'wall':
      return <WallModel obj={obj} />
    case 'glasswall':
      return <GlassWallModel obj={obj} />
    case 'pillar':
      return <PillarModel obj={obj} />
    case 'door':
      return <DoorModel obj={obj} />
    case 'desk':
      return <DeskModel />
    case 'table':
      return <TableModel />
    case 'chair':
      return <ChairModel />
    case 'cabinet':
      return <CabinetModel />
    case 'shelf':
      return <ShelfModel obj={obj} />
    case 'sofa':
      return <SofaModel />
    case 'machine':
      return <MachineModel obj={obj} />
    case 'plant':
      return <PlantModel />
    case 'person':
      return obj.ueShell === 'machine' ? <FixedUeModel /> : <PersonModel />
    case 'antenna':
      return <AntennaModel obj={obj} />
    case 'antceiling':
      return <CeilingAntennaModel obj={obj} />
    case 'antwall':
      return <WallAntennaModel obj={obj} />
    case 'fixedue':
      return <FixedUeModel />
  }
}

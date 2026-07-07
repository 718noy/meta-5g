import type { ProbeResult, SceneObject, SimResult, SpaceConfig, Zone } from './types'
import { CATALOG, feederLossDb, getRadiator, objZone } from './types'
import { useStore } from './store'

// API 베이스: 개발(npm run dev)에서는 백엔드(8000)를 직접 호출,
// 프로덕션 빌드(백엔드가 dist를 서빙)에서는 같은 오리진('')으로 상대 요청.
const API = import.meta.env.DEV ? 'http://localhost:8000' : ''

// 프론트 씬 → 백엔드 물리엔진 입력 JSON (존별 — 두 국가는 전파적으로 완전 분리)
export function buildScene(
  allObjects: SceneObject[],
  space: SpaceConfig,
  zone: Zone,
  engine: 'empirical' | 'rt' = 'empirical',
  ceiling = true,
) {
  const objects = allObjects.filter((o) => objZone(o) === zone)
  const gnbs = objects
    .filter((o) => o.kind === 'gnb' && o.gnb)
    .map((o) => {
      // 방사점: active=RU 자신 / passive=연결된 외장 안테나 (미연결 시 무방사)
      const rad = getRadiator(o, objects)
      if (!rad) return null
      const feeder =
        rad.feeder_len > 0 ? feederLossDb(rad.feeder_len, o.gnb!.freq_mhz, rad.cable) : 0
      return {
        id: o.id,
        name: o.name,
        position: [rad.x, 0, rad.z],
        height: rad.height,
        freq_mhz: o.gnb!.freq_mhz,
        tx_power_dbm: o.gnb!.tx_power_dbm - feeder, // 급전선 손실 반영
        bandwidth_mhz: o.gnb!.bandwidth_mhz,
        pci: o.gnb!.pci,
        tac: o.gnb!.tac,
        scs_khz: o.gnb!.scs_khz,
        tdd_dl_ratio: o.gnb!.tdd_dl_ratio,
        drx: o.gnb!.drx,
        prach_power_dbm: o.gnb!.prach_power_dbm,
        prach_ramp_step_db: o.gnb!.prach_ramp_step_db,
        prach_max_tx: o.gnb!.prach_max_tx,
        p0_nominal_dbm: o.gnb!.p0_nominal_dbm,
        alpha: o.gnb!.alpha,
        antenna: o.gnb!.antenna,
        // 유효 방위각 = 방사체가 바라보는 방향(회전) + 오프셋 (three.js y회전 → 물리 az 부호 반전)
        azimuth_deg: -rad.rotation_deg + o.gnb!.azimuth_deg,
        tilt_deg: o.gnb!.tilt_deg,
        gain_dbi: o.gnb!.gain_dbi,
        beamwidth_deg: o.gnb!.beamwidth_deg,
        beam_tracking: o.gnb!.beam_tracking,
        enabled: o.gnb!.enabled,
        ca_enabled: o.gnb!.ca_enabled,
        qam256: o.gnb!.qam256,
        mimo4x4: o.gnb!.mimo4x4,
        energy_saving: o.gnb!.energy_saving,
        // URLLC 신뢰성: PDCP 복제/중복 PDU 세션 (physics.probe QoS 손실 모델에서 사용)
        pdcp_duplication: o.gnb!.pdcp_duplication,
      }
    })
    .filter((g) => g !== null)

  const obstacles = objects
    .filter((o) => o.kind !== 'gnb' && o.kind !== 'person')
    .map((o) => {
      const size = o.size ?? CATALOG[o.kind].size
      return {
        id: o.id,
        material: CATALOG[o.kind].material ?? 'wood',
        position: [o.position[0], size[1] / 2, o.position[2]],
        size,
        rotation_deg: o.rotation_deg,
      }
    })

  // 큰 공간은 셀 크기를 키워 복셀 수를 억제 (성능). 가로 최대치를 ~120셀로 유지.
  const maxDim = Math.max(space.width, space.depth)
  const resolution = Math.min(Math.max(maxDim / 120, 0.5), 2.0)

  // 씬 레벨 RF 설정 (스토어) — 물리엔진으로 전달
  const rf = useStore.getState().rf

  return {
    engine,
    ceiling,
    space: { width: space.width, depth: space.depth, height: space.height },
    resolution,
    path_loss_exp: rf.path_loss_exp, // 경로손실 지수 (log-distance) — TR 38.901
    noise_figure_db: rf.noise_figure_db, // 수신기 잡음지수 (dB) — TS 38.101-4
    ue_pmax_dbm: rf.ue_pmax_dbm, // UE 최대 송신전력 (dBm) — TS 38.101-1 Pcmax
    gnbs,
    obstacles,
  }
}

function decodeF32(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

// uint8 서빙 인덱스 → float 배열 (3D 텍스처 업로드용)
function decodeU8toF32(b64: string): Float32Array {
  const bin = atob(b64)
  const out = new Float32Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function simulate(
  objects: SceneObject[],
  space: SpaceConfig,
  zone: Zone,
  engine: 'empirical' | 'rt' = 'empirical',
  ceiling = true,
): Promise<SimResult> {
  const res = await fetch(`${API}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene: buildScene(objects, space, zone, engine, ceiling) }),
  })
  if (!res.ok) throw new Error(`simulate failed: ${res.status}`)
  const j = await res.json()
  return {
    nx: j.nx,
    ny: j.ny,
    nz: j.nz,
    cell: j.cell,
    rsrp: decodeF32(j.rsrp_dbm),
    sinr: decodeF32(j.sinr_db),
    serving: decodeU8toF32(j.serving),
    gnbIds: j.gnb_ids ?? [],
    rsrpMin: j.rsrp_min,
    rsrpMax: j.rsrp_max,
  }
}

// ---- Phase 3 실스택 브릿지 ----
export async function p3UeApply(sim: {
  mcc: string
  mnc: string
  msin: string
  scheme: string
}): Promise<{ ok: boolean; imsi?: string; log?: string; error?: string }> {
  const res = await fetch(`${API}/p3/ue_apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sim),
  })
  return res.json()
}

export async function p3ApplyPlmn(mcc: string, mnc: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/p3/apply_plmn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcc, mnc }),
  })
  return res.json()
}

export async function probe(
  objects: SceneObject[],
  space: SpaceConfig,
  zone: Zone,
  position: [number, number, number], // 존 로컬 좌표
  ceiling = true,
  fiveqi = 9,
  cellLoad = 0,
): Promise<ProbeResult> {
  const res = await fetch(`${API}/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: buildScene(objects, space, zone, 'empirical', ceiling),
      position,
      fiveqi,
      cell_load: cellLoad,
    }),
  })
  if (!res.ok) throw new Error(`probe failed: ${res.status}`)
  return res.json()
}

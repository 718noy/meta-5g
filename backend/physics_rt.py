"""Phase 2 전파 엔진: Sionna RT (GPU 레이트레이싱, Mitsuba/Dr.Jit 기반).

경험적 모델(physics.py)과 동일한 API 계약(씬 dict → 그리드 dict)을 유지하되,
반사(specular)·투과(refraction)를 ITU-R P.2040 재질 물성으로 물리 계산한다.

좌표 변환: 프론트/백엔드는 y-up, Sionna는 z-up.
  ours (x, y_height, z_depth)  →  sionna (x, z_depth, y_height)

구현 방식: 장애물·바닥·외벽을 PLY 박스 메시로 생성 → XML 씬 → load_scene.
gNB마다 안테나가 다르므로 gNB별로 RadioMapSolver를 높이 슬라이스마다 실행해
3D 그리드를 쌓고, 셀 결합(best/SINR)은 physics.py와 동일 로직을 쓴다.
"""

import base64
import os
import shutil
import struct
import tempfile

import numpy as np

import mitsuba as mi

mi.set_variant("cuda_ad_mono_polarized")

from sionna.rt import PlanarArray, RadioMapSolver, Receiver, Transmitter, load_scene  # noqa: E402

from physics import NOISE_FIGURE_DB  # noqa: E402

# 재질 → Sionna ITU 라디오 머티리얼 id
MAT_MAP = {
    "concrete": "mat-itu_concrete",
    "glass": "mat-itu_glass",
    "wood": "mat-itu_wood",
    "metal": "mat-itu_metal",
}

_solver = RadioMapSolver()


def _write_box_ply(path: str, center, size, yaw_deg: float):
    """z-up 좌표계 기준 회전(yaw, z축)·이동된 박스 PLY(ascii) 생성."""
    hx, hy, hz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    verts = np.array(
        [
            [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
            [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
        ]
    )
    yaw = np.deg2rad(yaw_deg)
    c, s = np.cos(yaw), np.sin(yaw)
    rot = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    verts = verts @ rot.T + np.asarray(center)[None, :]
    faces = [
        [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
        [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
        [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
    ]
    with open(path, "w", encoding="ascii") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(verts)}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        f.write(f"element face {len(faces)}\n")
        f.write("property list uchar int vertex_indices\nend_header\n")
        for v in verts:
            f.write(f"{v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
        for face in faces:
            f.write(f"3 {face[0]} {face[1]} {face[2]}\n")


def _build_scene_xml(scene: dict, workdir: str) -> str:
    """씬 dict → Mitsuba XML + PLY 파일 생성, XML 경로 반환."""
    space = scene.get("space", {})
    w = float(space.get("width", 40.0))
    h = float(space.get("height", 6.0))
    d = float(space.get("depth", 30.0))

    shapes = []  # (ply 파일명, 재질 id)
    idx = 0

    def add_box(center, size, yaw, mat):
        nonlocal idx
        name = f"box_{idx}.ply"
        _write_box_ply(os.path.join(workdir, name), center, size, yaw)
        shapes.append((name, MAT_MAP.get(mat, "mat-itu_concrete")))
        idx += 1

    # 구조체: 바닥/천장/외벽 (z-up: 바닥은 z=0 아래 슬래브)
    add_box([w / 2, d / 2, -0.1], [w + 2, d + 2, 0.2], 0, "concrete")   # 바닥
    if scene.get("ceiling", True):
        add_box([w / 2, d / 2, h + 0.1], [w + 2, d + 2, 0.2], 0, "concrete")  # 천장
    add_box([w / 2, -0.1, h / 2], [w + 2, 0.2, h], 0, "concrete")
    add_box([w / 2, d + 0.1, h / 2], [w + 2, 0.2, h], 0, "concrete")
    add_box([-0.1, d / 2, h / 2], [0.2, d + 2, h], 0, "concrete")
    add_box([w + 0.1, d / 2, h / 2], [0.2, d + 2, h], 0, "concrete")

    # 장애물 (ours y-up → sionna z-up 변환)
    for obs in scene.get("obstacles", []):
        p = obs["position"]  # [x, y_height, z_depth]
        s = obs["size"]      # [sx, sy_height, sz_depth]
        add_box(
            [p[0], p[2], p[1]],
            [s[0], s[2], s[1]],
            -float(obs.get("rotation_deg", 0.0)),  # y-up yaw → z-up yaw 부호 반전
            obs.get("material", "wood"),
        )

    mats = "\n".join(
        f'  <bsdf type="twosided" id="{mid}"><bsdf type="diffuse">'
        f'<rgb value="0.5 0.5 0.5" name="reflectance"/></bsdf></bsdf>'
        for mid in sorted(set(m for _, m in shapes))
    )
    shp = "\n".join(
        f'  <shape type="ply"><string name="filename" value="{fn}"/>'
        f'<ref id="{mid}"/></shape>'
        for fn, mid in shapes
    )
    xml = (
        '<scene version="2.1.0">\n'
        '  <default name="spp" value="4096"/>\n'
        f"{mats}\n{shp}\n"
        "</scene>\n"
    )
    xml_path = os.path.join(workdir, "scene.xml")
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml)
    return xml_path


def _tx_array_for(gnb: dict) -> PlanarArray:
    ant = gnb.get("antenna", "omni")
    if ant == "omni":
        return PlanarArray(
            num_rows=1, num_cols=1,
            vertical_spacing=0.5, horizontal_spacing=0.5,
            pattern="iso", polarization="V",
        )
    # sector / beam: 3GPP TR 38.901 지향성 소자 (beam은 v1에서 지향 소자로 근사)
    return PlanarArray(
        num_rows=1, num_cols=1,
        vertical_spacing=0.5, horizontal_spacing=0.5,
        pattern="tr38901", polarization="V",
    )


def simulate_rt(scene: dict) -> dict:
    """레이트레이싱 3D 그리드 계산 — physics.simulate 과 동일한 반환 포맷."""
    space = scene.get("space", {})
    w = float(space.get("width", 40.0))
    h = float(space.get("height", 6.0))
    d = float(space.get("depth", 30.0))
    res = float(scene.get("resolution", 0.5))

    gnbs = [g for g in scene.get("gnbs", []) if g.get("enabled", True)]

    nx = max(int(round(w / res)), 2)
    ny = max(int(round(h / res)), 2)
    nz = max(int(round(d / res)), 2)
    n = nx * ny * nz

    if not gnbs:
        empty = np.full(n, -200.0, dtype=np.float32)
        return {
            "nx": nx, "ny": ny, "nz": nz,
            "cell": [w / nx, h / ny, d / nz],
            "rsrp_dbm": _b64(empty), "sinr_db": _b64(empty),
            "serving": _b64(np.zeros(n, dtype=np.uint8)),
            "gnb_ids": [], "rsrp_min": -200.0, "rsrp_max": -200.0,
            "engine": "rt",
        }

    workdir = tempfile.mkdtemp(prefix="dtrt_")
    try:
        xml_path = _build_scene_xml(scene, workdir)

        # 높이 슬라이스: RT는 수직 1m 간격으로 계산 후 그리드 높이로 보간
        ny_rt = max(int(round(h / 1.0)), 2)
        heights = (np.arange(ny_rt) + 0.5) * (h / ny_rt)

        # gNB별 RSS 그리드 [G, ny_rt, nz, nx]
        rss_all = np.full((len(gnbs), ny_rt, nz, nx), -200.0)

        for gi, g in enumerate(gnbs):
            sc = load_scene(xml_path)
            sc.frequency = float(g.get("freq_mhz", 3500.0)) * 1e6
            sc.tx_array = _tx_array_for(g)
            sc.rx_array = PlanarArray(
                num_rows=1, num_cols=1,
                vertical_spacing=0.5, horizontal_spacing=0.5,
                pattern="iso", polarization="V",
            )
            tx_pow = float(g.get("tx_power_dbm", 30.0))
            if g.get("energy_saving", False):
                tx_pow -= 6.0
            # 지향 안테나 방향 (ours 방위각: +x기준 +z방향 → sionna yaw)
            az = float(g.get("azimuth_deg", 0.0))
            tilt = float(g.get("tilt_deg", 0.0))
            tx = Transmitter(
                name=f"tx{gi}",
                position=[float(g["position"][0]), float(g["position"][2]),
                          float(g.get("height", 2.5))],
                orientation=[float(np.deg2rad(az)), float(np.deg2rad(tilt)), 0.0],
                power_dbm=tx_pow,
            )
            sc.add(tx)

            for hi, hh in enumerate(heights):
                rm = _solver(
                    sc,
                    max_depth=3,
                    samples_per_tx=2**20,
                    cell_size=(res, res),
                    center=[w / 2, d / 2, float(hh)],
                    orientation=[0, 0, 0],
                    size=[w, d],
                    specular_reflection=True,
                    refraction=True,
                )
                rss = rm.rss.numpy()[0]  # [cells_y(d방향), cells_x(w방향)]
                rss_dbm = 10.0 * np.log10(np.maximum(rss, 1e-30)) + 30.0
                # 이득 보정 (iso/tr38901 소자 대비 사용자 지정 이득)
                elem_gain = 0.0 if g.get("antenna", "omni") == "omni" else 8.0
                rss_dbm += float(g.get("gain_dbi", 0.0)) - elem_gain
                # rm 격자 → (nz, nx) 로 정합 (필요시 리사이즈)
                rss_dbm = _fit_grid(rss_dbm, nz, nx)
                rss_all[gi, hi] = rss_dbm

        # 수직 보간: ny_rt → ny
        y_src = (np.arange(ny_rt) + 0.5) / ny_rt
        y_dst = (np.arange(ny) + 0.5) / ny
        idx = np.clip(np.searchsorted(y_src, y_dst), 1, ny_rt - 1)
        lo, hi_ = idx - 1, idx
        wgt = ((y_dst - y_src[lo]) / (y_src[hi_] - y_src[lo]))[None, :, None, None]
        powers = rss_all[:, lo] * (1 - wgt) + rss_all[:, hi_] * wgt  # [G, ny, nz, nx]

        # 셀 결합 (physics.py 와 동일 로직)
        # 레이아웃 정합: (G, ny, nz, nx) → (G, nz, ny, nx) → ravel (ix 최속, iz 최완)
        powers_flat = powers.transpose(0, 2, 1, 3).reshape(len(gnbs), -1)
        powers_mw = np.power(10.0, powers_flat / 10.0)
        serving = np.argmax(powers_flat, axis=0)
        best_dbm = np.max(powers_flat, axis=0)
        best_mw = np.max(powers_mw, axis=0)
        # PCI mod-3 충돌 이웃 간섭 ×2 (physics.py 경험적 엔진과 동일 — 자동 PCI 계획이 RT에서도 유효)
        mod3 = np.array([int(g.get("pci", 0)) % 3 for g in gnbs])
        serving_mod3 = mod3[serving]
        gi = np.arange(len(gnbs))[:, None]
        is_serv = gi == serving[None, :]
        same_mod3 = mod3[:, None] == serving_mod3[None, :]
        weight = np.where(is_serv, 0.0, np.where(same_mod3, 2.0, 1.0))
        interference_mw = np.sum(powers_mw * weight, axis=0)
        bw_hz = np.array([float(g.get("bandwidth_mhz", 100.0)) * 1e6 for g in gnbs])
        noise_dbm = -174.0 + 10.0 * np.log10(bw_hz[serving]) + NOISE_FIGURE_DB
        noise_mw = np.power(10.0, noise_dbm / 10.0)
        sinr_db = 10.0 * np.log10(np.maximum(best_mw, 1e-30) / (interference_mw + noise_mw))

        return {
            "nx": nx, "ny": ny, "nz": nz,
            "cell": [w / nx, h / ny, d / nz],
            "rsrp_dbm": _b64(best_dbm.astype(np.float32)),
            "sinr_db": _b64(np.clip(sinr_db, -50, 60).astype(np.float32)),
            "serving": _b64(serving.astype(np.uint8)),
            "gnb_ids": [g.get("id", str(i)) for i, g in enumerate(gnbs)],
            "rsrp_min": float(best_dbm.min()),
            "rsrp_max": float(best_dbm.max()),
            "engine": "rt",
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _fit_grid(a: np.ndarray, rows: int, cols: int) -> np.ndarray:
    """RadioMap 셀 수가 목표 그리드와 1~2셀 어긋날 때 최근접 리샘플."""
    if a.shape == (rows, cols):
        return a
    ri = np.clip((np.arange(rows) + 0.5) / rows * a.shape[0], 0, a.shape[0] - 1).astype(int)
    ci = np.clip((np.arange(cols) + 0.5) / cols * a.shape[1], 0, a.shape[1] - 1).astype(int)
    return a[np.ix_(ri, ci)]


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")

"""전파 물리 엔진 (Phase 1: 경험적 모델, numpy 벡터화).

좌표계는 프론트엔드(three.js)와 동일: x=가로, y=높이(위), z=세로.
공간은 x∈[0,W], y∈[0,H], z∈[0,D].

복셀별 수신전력:
  RSRP = TxPower + G_ant(방위,앙각) - FSPL(d, f) - Σ 재질손실(통과길이 × dB/m)

FSPL(dB) = 20·log10(d[m]) + 20·log10(f[MHz]) - 27.55
섹터 안테나: 3GPP TR 38.901 패턴 (HPBW 65°, 전후방비 30dB)
SINR = 최강 셀 / (나머지 셀 간섭 합 + 열잡음(-174dBm/Hz + 10log10(BW) + NF 7dB))

Phase 2에서 이 모듈만 Sionna RT(GPU 레이트레이싱) 어댑터로 교체한다.
API 계약(씬 dict → 그리드 dict)은 동일하게 유지할 것.
"""

import base64

import numpy as np

from materials import MAX_LOSS_PER_OBSTACLE_DB, attenuation_db_per_m

NOISE_FIGURE_DB = 7.0
MIN_DIST_M = 0.5  # 안테나 초근접 특이점 방지
REFLECT_LOSS_DB = 6.0  # 바닥/천장 1회 반사 손실 (콘크리트 근사)


def _antenna_gain_db(gnb: dict, dx, dy, dz):
    """복셀 방향별 안테나 이득(dBi). dx,dy,dz: 안테나→복셀 벡터 성분(배열).

    - omni: 등방 이득
    - sector: 3GPP TR 38.901 패턴 (HPBW 65°)
    - beam: Massive MIMO 빔포밍 — 좁은 빔폭(beamwidth_deg)의 조향 빔.
      조향 방향은 azimuth_deg/tilt_deg (probe에서 UE 추적 시 동적으로 덮어씀).
    """
    gain = float(gnb.get("gain_dbi", 0.0))
    ant = gnb.get("antenna", "omni")
    if ant == "omni":
        return gain

    hpbw = float(gnb.get("beamwidth_deg", 10.0)) if ant == "beam" else 65.0
    az_bore = np.deg2rad(float(gnb.get("azimuth_deg", 0.0)))
    tilt = float(gnb.get("tilt_deg", 0.0))  # 양수 = 아래로 틸트

    # 방위각: x-z 평면 (three.js에서 -z가 북쪽이라 가정할 필요 없이 atan2(x, -z) 관례 대신
    # 단순히 +x축 기준 반시계 방향을 0°로 사용. 프론트와 관례만 일치하면 됨.
    az = np.arctan2(dz, dx)
    dphi = np.rad2deg(np.arctan2(np.sin(az - az_bore), np.cos(az - az_bore)))

    horiz = np.hypot(dx, dz)
    elev = np.rad2deg(np.arctan2(dy, np.maximum(horiz, 1e-6)))  # 위쪽 양수
    dtheta = elev + tilt  # 다운틸트만큼 빔 중심이 아래로

    a_h = -np.minimum(12.0 * (dphi / hpbw) ** 2, 30.0)
    a_v = -np.minimum(12.0 * (dtheta / hpbw) ** 2, 30.0)
    pattern = -np.minimum(-(a_h + a_v), 30.0)
    return gain + pattern


def _segment_box_lengths(a, points, box):
    """점 a(3,)에서 각 point(N,3)까지의 선분이 회전된 박스 내부를 지나는 길이(N,).

    박스: position(중심), size(변 길이), rotation_deg(y축 yaw).
    슬랩 방법을 박스 로컬 좌표계에서 벡터화 수행.
    """
    center = np.asarray(box["position"], dtype=np.float64)
    half = np.asarray(box["size"], dtype=np.float64) / 2.0
    yaw = np.deg2rad(float(box.get("rotation_deg", 0.0)))
    c, s = np.cos(-yaw), np.sin(-yaw)  # 월드→로컬 회전 (y축)

    def to_local(p):
        q = p - center
        x = q[..., 0] * c - q[..., 2] * s
        z = q[..., 0] * s + q[..., 2] * c
        return np.stack([x, q[..., 1], z], axis=-1)

    a_l = to_local(a[None, :])[0]
    p_l = to_local(points)
    d = p_l - a_l  # (N,3)
    seg_len = np.linalg.norm(d, axis=1)

    with np.errstate(divide="ignore", invalid="ignore"):
        inv = np.where(np.abs(d) > 1e-12, 1.0 / d, np.inf)
    t0 = (-half - a_l) * inv
    t1 = (half - a_l) * inv

    # 방향 성분이 0인 축: 시작점이 슬랩 안이면 (-inf, +inf), 밖이면 교차 없음
    zero = np.abs(d) <= 1e-12
    inside = np.abs(a_l) <= half
    lo = np.where(zero, np.where(inside, -np.inf, np.inf), np.minimum(t0, t1))
    hi = np.where(zero, np.where(inside, np.inf, -np.inf), np.maximum(t0, t1))

    t_enter = np.max(lo, axis=1)
    t_exit = np.min(hi, axis=1)
    t_enter = np.clip(t_enter, 0.0, 1.0)
    t_exit = np.clip(t_exit, 0.0, 1.0)
    frac = np.maximum(t_exit - t_enter, 0.0)
    return frac * seg_len


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def _inv_norm_cdf(p):
    """표준정규 역누적분포(분위수) — Acklam 유리함수 근사(벡터화).
    해시→균등난수 u를 정규분포 z로 사상하는 데 사용(섀도우 페이딩). scipy 불필요."""
    p = np.asarray(p, dtype=np.float64)
    a = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00)
    b = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01)
    c = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00)
    d = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00)
    plow, phigh = 0.02425, 1.0 - 0.02425
    lo = p < plow
    hi = p > phigh
    ql = np.sqrt(-2.0 * np.log(np.clip(p, 1e-300, None)))
    x_lo = ((((((c[0] * ql + c[1]) * ql + c[2]) * ql + c[3]) * ql + c[4]) * ql + c[5])
            / ((((d[0] * ql + d[1]) * ql + d[2]) * ql + d[3]) * ql + 1.0))
    qh = np.sqrt(-2.0 * np.log(np.clip(1.0 - p, 1e-300, None)))
    x_hi = -((((((c[0] * qh + c[1]) * qh + c[2]) * qh + c[3]) * qh + c[4]) * qh + c[5])
             / ((((d[0] * qh + d[1]) * qh + d[2]) * qh + d[3]) * qh + 1.0))
    qm = p - 0.5
    rm = qm * qm
    x_mid = (((((a[0] * rm + a[1]) * rm + a[2]) * rm + a[3]) * rm + a[4]) * rm + a[5]) * qm \
        / (((((b[0] * rm + b[1]) * rm + b[2]) * rm + b[3]) * rm + b[4]) * rm + 1.0)
    return np.where(lo, x_lo, np.where(hi, x_hi, x_mid))


def _shadow_offset_db(points: np.ndarray, cell_id: int, sigma: float):
    """섀도우 페이딩 오프셋(dB) — 3GPP TR 38.901 §7.4.1 로그정규 쉐도잉.

    (복셀인덱스, 셀ID) 해시 → 균등[0,1) → 역정규CDF → ×σ. 결정론적이라 재계산해도
    맵이 동일(깜빡임 없음). σ=0이면 오프셋 없음(하위호환). σ↑ → 셀 경계 RSRP 분산↑(패치형 커버리지).
    좌표를 0.5m 격자 정수 인덱스로 양자화해 위치별 안정적인 값을 얻는다."""
    if sigma <= 0.0:
        return 0.0
    ix = np.floor(points[:, 0] * 2.0).astype(np.int64).astype(np.uint64)
    iy = np.floor(points[:, 1] * 2.0).astype(np.int64).astype(np.uint64)
    iz = np.floor(points[:, 2] * 2.0).astype(np.int64).astype(np.uint64)
    c = np.uint64(int(cell_id) & 0xFFFFFFFFFFFFFFFF)
    h = ix * np.uint64(0x9E3779B97F4A7C15)
    h = h ^ (iy * np.uint64(0xC2B2AE3D27D4EB4F))
    h = h ^ (iz * np.uint64(0x165667B19E3779F9))
    h = h ^ (c * np.uint64(0x27D4EB2F165667C5))
    h = h ^ (h >> np.uint64(30))
    h = h * np.uint64(0xBF58476D1CE4E5B9)
    h = h ^ (h >> np.uint64(27))
    h = h * np.uint64(0x94D049BB133111EB)
    h = h ^ (h >> np.uint64(31))
    u = (h >> np.uint64(11)).astype(np.float64) * (1.0 / 9007199254740992.0)
    u = np.clip(u, 1e-9, 1.0 - 1e-9)
    return _inv_norm_cdf(u) * float(sigma)


def _bler_se_factor(target_bler: float) -> float:
    """목표 BLER → 유효 스펙트럼효율(SE) 백오프 계수 — 3GPP TS 38.214 §5.1.3.
    CQI/MCS는 목표 BLER 기준으로 선택된다. f(0.1)=1.0, f(0.01)≈0.85 —
    낮은 목표(보수적 MCS)일수록 최대 SE가 낮아진다(단조 감소)."""
    tb = float(np.clip(target_bler, 1e-3, 0.1))
    return float(1.0 + 0.15 * (np.log10(tb) - np.log10(0.1)))


def _received_power_dbm(
    gnb: dict,
    points: np.ndarray,
    obstacles: list,
    path_loss_exp: float = 3.5,
    ceil_h: float | None = None,
    shadow_sigma_db: float = 0.0,
    cell_id: int = 0,
) -> np.ndarray:
    """points(N,3)에서 gnb 하나의 수신전력(dBm).

    로그거리 경로손실 모델: PL = PL(1m) + 10·n·log10(d)
      PL(1m) = 20·log10(f_MHz) - 27.55  (자유공간 1m 기준)
      n = path_loss_exp (자유공간 2.0, 실내 LOS ~1.7, 실내/도심 NLOS ~3.5~4.0)

    다중경로: 직접파 + 바닥 반사 + (천장 있을 때) 천장 반사 를 전력합.
      ceil_h=None 이면 천장 없음 → 천장 반사 없이 상방으로 전파가 뻗음.
    """
    x0, y0, z0 = float(gnb["position"][0]), float(gnb.get("height", 2.5)), float(gnb["position"][2])
    pos = np.array([x0, y0, z0], dtype=np.float64)
    freq = float(gnb.get("freq_mhz", 3500.0))
    tx = float(gnb.get("tx_power_dbm", 30.0))
    if gnb.get("energy_saving", False):
        tx -= 6.0

    delta = points - pos[None, :]
    dx, py, dz = delta[:, 0], points[:, 1], delta[:, 2]
    pl_1m = 20.0 * np.log10(freq) - 27.55
    gain = _antenna_gain_db(gnb, delta[:, 0], delta[:, 1], delta[:, 2])
    # 안테나 배열 이득 (coherent combining) — TR 38.901 §7.3.
    #   G_array = 10·log10(N_elem),  N_elem = ant_rows × ant_cols.
    # 1×1 → 0dB(정확한 하위호환). 배열이 클수록 이득↑ → 커버리지/SINR↑ (단조 증가).
    n_ant = float(gnb.get("ant_rows", 1) or 1) * float(gnb.get("ant_cols", 1) or 1)
    gain = gain + 10.0 * np.log10(max(1.0, n_ant))

    # 장애물 투과 손실 (직접파 경로)
    loss = np.zeros(len(points))
    for obs in obstacles:
        alpha = attenuation_db_per_m(obs.get("material", "wood"), freq)
        lengths = _segment_box_lengths(pos, points, obs)
        loss += np.minimum(alpha * lengths, MAX_LOSS_PER_OBSTACLE_DB)

    def path_mw(dist, extra_db):
        pl = pl_1m + 10.0 * path_loss_exp * np.log10(np.maximum(dist, MIN_DIST_M))
        return np.power(10.0, (tx + gain - pl - extra_db) / 10.0)

    # 직접파
    total = path_mw(np.linalg.norm(delta, axis=1), loss)
    # 바닥 반사 (이미지: y=-y0) — 반사 경로도 동일 장애물 손실 근사 적용
    d_floor = np.sqrt(dx * dx + (py + y0) ** 2 + dz * dz)
    total = total + path_mw(d_floor, loss + REFLECT_LOSS_DB)
    # 천장 반사 (이미지: y=2H-y0) — 천장 있을 때만
    if ceil_h is not None:
        img_y = 2.0 * ceil_h - y0
        d_ceil = np.sqrt(dx * dx + (py - img_y) ** 2 + dz * dz)
        total = total + path_mw(d_ceil, loss + REFLECT_LOSS_DB)

    rsrp = 10.0 * np.log10(np.maximum(total, 1e-30))
    # 섀도우 페이딩(로그정규) — 결정론적 오프셋을 수신전력에 가산. TR 38.901 §7.4.1
    if shadow_sigma_db > 0.0:
        rsrp = rsrp + _shadow_offset_db(points, cell_id, shadow_sigma_db)
    return rsrp


def simulate(scene: dict) -> dict:
    """씬 전체를 복셀 그리드로 계산. 반환 그리드는 ix가 가장 빠른 C-order
    (index = ix + iy*nx + iz*nx*ny) — three.js Data3DTexture 레이아웃과 일치."""
    space = scene.get("space", {})
    w = float(space.get("width", 40.0))
    h = float(space.get("height", 3.0))
    d = float(space.get("depth", 30.0))
    res = float(scene.get("resolution", 0.5))

    gnbs = [g for g in scene.get("gnbs", []) if g.get("enabled", True)]
    obstacles = scene.get("obstacles", [])
    ple = float(scene.get("path_loss_exp", 3.5))
    scene_nf = float(scene.get("noise_figure_db", NOISE_FIGURE_DB))  # 씬 기본 잡음지수 (TS 38.101-4)
    sigma = float(scene.get("shadow_sigma_db", 0.0))  # 섀도우 페이딩 σ (TR 38.901 §7.4.1)
    scene_im_db = float(scene.get("interference_margin_db", 0.0))  # 씬 기본 간섭 마진 (TS 38.104 IoT)
    ceil_h = h if scene.get("ceiling", True) else None

    nx = max(int(round(w / res)), 2)
    ny = max(int(round(h / res)), 2)
    nz = max(int(round(d / res)), 2)

    xs = (np.arange(nx) + 0.5) * (w / nx)
    ys = (np.arange(ny) + 0.5) * (h / ny)
    zs = (np.arange(nz) + 0.5) * (d / nz)
    # shape (nz, ny, nx) → ravel 시 ix 최속
    Z, Y, X = np.meshgrid(zs, ys, xs, indexing="ij")
    points = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    n = len(points)

    if not gnbs:
        empty = np.full(n, -200.0, dtype=np.float32)
        return {
            "nx": nx, "ny": ny, "nz": nz,
            "cell": [w / nx, h / ny, d / nz],
            "rsrp_dbm": _b64(empty),
            "sinr_db": _b64(empty),
            "serving": _b64(np.zeros(n, dtype=np.uint8)),
            "gnb_ids": [],
            "rsrp_min": -200.0, "rsrp_max": -200.0,
        }

    # 셀별 전파 파라미터 오버라이드 — 각 gNB 값이 있으면 셀 고유값, 없으면 씬 기본값.
    # 로그거리 경로손실 지수(TR 38.901)/섀도우 페이딩 σ(TR 38.901 §7.4.1)를 셀마다 적용
    # (일부 셀만 더 열악한 국소 환경을 모델링 가능). 미설정(None) → 씬 기본 → 기존 출력 그대로.
    ple_arr = [
        float(g["path_loss_exp"]) if g.get("path_loss_exp") is not None else ple
        for g in gnbs
    ]
    sigma_arr = [
        float(g["shadow_sigma_db"]) if g.get("shadow_sigma_db") is not None else sigma
        for g in gnbs
    ]
    powers_dbm = np.stack(
        [_received_power_dbm(g, points, obstacles, ple_arr[i], ceil_h, sigma_arr[i], i)
         for i, g in enumerate(gnbs)]
    )  # (G, N)
    powers_mw = np.power(10.0, powers_dbm / 10.0)

    serving = np.argmax(powers_dbm, axis=0)
    best_dbm = np.max(powers_dbm, axis=0)
    best_mw = np.max(powers_mw, axis=0)

    # PCI mod-3 충돌: 서빙과 같은 PCI%3인 이웃 셀은 참조신호/스케줄링이 겹쳐
    # 간섭이 실효적으로 커진다(약 ×2 전력, +3dB). 실제 필드의 mod3 간섭 재현.
    mod3 = np.array([int(g.get("pci", 0)) % 3 for g in gnbs])
    serving_mod3 = mod3[serving]  # (N,)
    gidx = np.arange(len(gnbs))[:, None]
    is_serving = gidx == serving[None, :]
    same_mod3 = mod3[:, None] == serving_mod3[None, :]
    weight = np.where(is_serving, 0.0, np.where(same_mod3, 2.0, 1.0))  # (G,N)
    interference_mw = np.sum(powers_mw * weight, axis=0)
    bw_hz = np.array([float(g.get("bandwidth_mhz", 100.0)) * 1e6 for g in gnbs])
    # 셀별 잡음지수/간섭 마진 오버라이드 — 각 gNB 값이 있으면 셀 고유값, 없으면 씬 기본값.
    # 서빙 셀 기준으로 잡음/마진을 적용(desense된 개별 RU 모델링 가능).
    nf_arr = np.array([
        float(g["noise_figure_db"]) if g.get("noise_figure_db") is not None else scene_nf
        for g in gnbs
    ])
    im_arr = np.array([
        float(g["interference_margin_db"]) if g.get("interference_margin_db") is not None else scene_im_db
        for g in gnbs
    ])
    noise_dbm = -174.0 + 10.0 * np.log10(bw_hz[serving]) + nf_arr[serving]
    noise_mw = np.power(10.0, noise_dbm / 10.0)
    # 간섭 마진(IoT): 부하 네트워크 근사 — SINR을 마진(dB)만큼 균일 저하. TS 38.104
    sinr_db = 10.0 * np.log10(best_mw / (interference_mw + noise_mw)) - im_arr[serving]

    return {
        "nx": nx, "ny": ny, "nz": nz,
        "cell": [w / nx, h / ny, d / nz],
        "rsrp_dbm": _b64(best_dbm.astype(np.float32)),
        "sinr_db": _b64(np.clip(sinr_db, -50, 60).astype(np.float32)),
        "serving": _b64(serving.astype(np.uint8)),
        "gnb_ids": [g.get("id", str(i)) for i, g in enumerate(gnbs)],
        "rsrp_min": float(best_dbm.min()),
        "rsrp_max": float(best_dbm.max()),
    }


def _nr_arfcn(freq_mhz: float) -> int:
    """3GPP TS 38.104 글로벌 주파수 래스터 기반 NR-ARFCN."""
    if freq_mhz < 3000:
        return int(round(freq_mhz * 200))  # 5 kHz 래스터
    if freq_mhz < 24250:
        return int(round(600000 + (freq_mhz - 3000) / 0.015))  # 15 kHz
    return int(round(2016667 + (freq_mhz - 24250) / 0.06))  # 60 kHz


def _band_guess(freq_mhz: float) -> str:
    for lo, hi, band in [
        (700, 900, "n5"), (900, 1500, "n8"), (1500, 2000, "n3"),
        (2000, 2300, "n1"), (2300, 2700, "n41"), (3300, 3800, "n78"),
        (3800, 4200, "n77"), (4400, 5000, "n79"),
        (24250, 27500, "n258"), (26500, 29500, "n257"), (37000, 40000, "n260"),
    ]:
        if lo <= freq_mhz < hi:
            return band
    return "-"


def _cqi_from_sinr(sinr_db: float) -> int:
    """SINR → CQI(0~15) 근사 매핑."""
    return int(np.clip(round((sinr_db + 6.0) / 2.2), 0, 15))


# UE 수신단 AGC 오버로드 방지 — 초근접 시 RSRP가 이 값을 넘으면 감쇠기로 제한
AGC_MAX_RSRP_DBM = -45.0


# 5QI별 Packet Delay Budget(ms) / Packet Error Rate — 3GPP TS 23.501 Table 5.7.4-1 근사.
#   82/83=10ms, 84=30ms, 85=5ms 는 delay-critical GBR(초저지연 산업제어/원격제어).
#   90 은 NB-IoT/LTE-M 커버리지확장 데이터용 프로젝트 관례 마커(3GPP 표준 5QI 아님).
FIVEQI_PDB = {1: 100, 2: 150, 3: 50, 4: 300, 5: 100, 6: 300, 7: 100, 8: 300, 9: 300,
              82: 10, 83: 10, 84: 30, 85: 5, 90: 1000}
FIVEQI_PER = {1: 1e-2, 2: 1e-3, 3: 1e-3, 4: 1e-6, 5: 1e-6, 6: 1e-6, 7: 1e-3, 8: 1e-6, 9: 1e-6,
              82: 1e-4, 83: 1e-4, 84: 1e-5, 85: 1e-5, 90: 1e-2}
FIVEQI_GBR = {1, 2, 3, 4, 82, 83, 84, 85}
# delay-critical GBR: PDB 초과 패킷은 '저하'가 아니라 '폐기'(PER로 계상), MDBV 초과분도 폐기.
FIVEQI_DELAY_CRITICAL = {82, 83, 84, 85}
# Maximum Data Burst Volume(bytes) — TS 23.501 Table 5.7.4-1 (PDB 내 전달해야 할 최대 버스트).
FIVEQI_MDBV = {82: 5600, 83: 1354, 84: 1354, 85: 255}
# Priority Level — TS 23.501 Table 5.7.4-1. 낮을수록 높은 우선도(스케줄러가 혼잡 시 존중, §5.7.3.3).
#   미표기/비표준 5QI 는 기본 90(최저 우선, eMBB 5QI9 동급) — 하위호환 안전값.
FIVEQI_PRIORITY = {1: 20, 2: 40, 3: 30, 4: 50, 5: 10, 6: 60, 7: 70, 8: 80, 9: 90,
                   65: 7, 66: 20, 82: 19, 83: 22, 84: 24, 85: 21, 90: 90}
# Averaging Window(ms) — TS 23.501 Table 5.7.4-1. GBR 계열은 표준 2000ms, 비GBR 은 미적용(None).
FIVEQI_AVG_WINDOW = {q: 2000 for q in FIVEQI_GBR}
# NB-IoT/LTE-M 커버리지 확장(CE) 프로파일 마커(프로젝트 관례 5QI).
IOT_CE_5QI = {90}
# 코어/전송 지연(UPF+N3/N6 근사) — delay-critical 예산에서 무선 큐잉 여유 계산에 차감.
CORE_TRANSPORT_DELAY_MS = 2.0
# DRX 페이징/웨이크업 지연 근사 — 짧은 DRX 주기의 절반 수준(~40ms 주기 → +20ms). TS 38.321 §5.7.
DRX_PAGING_LATENCY_MS = 20.0

# ── 뉴머롤로지(SCS) ── TS 38.211/38.104
def _slot_ms(scs_khz: int) -> float:
    """슬롯 길이(ms) = 1 / 2^μ,  μ = log2(scs_khz/15). 15→1.0, 30→0.5, 60→0.25, 120→0.125."""
    mu = np.log2(max(float(scs_khz), 15.0) / 15.0)
    return float(1.0 / (2.0 ** mu))


# TS 38.104 표 (대역폭 MHz → SCS kHz → 최대 전송 RB 수 N_RB). 가드밴드 제외 유효 RB.
NR_MAX_RB = {
    20: {15: 106, 30: 51, 60: 24},
    40: {15: 216, 30: 106, 60: 51},
    100: {30: 273, 60: 135, 120: 66},
}


def _usable_prbs(bw_mhz: float, scs_khz: int) -> int:
    """유효(가드밴드 제외) PRB 수 — TS 38.104 표, 미표기 조합은 근사식.
    근사: N_RB ≈ floor(대역폭 × 0.95 / RB대역폭),  RB대역폭(MHz) = 12·scs_khz/1000."""
    tab = NR_MAX_RB.get(int(round(bw_mhz)))
    if tab and int(scs_khz) in tab:
        return tab[int(scs_khz)]
    rb_bw_mhz = 12.0 * float(scs_khz) / 1000.0  # 한 RB의 대역폭(MHz)
    return max(int(np.floor(bw_mhz * 0.95 / rb_bw_mhz)), 1)


def _qos_metrics(fiveqi: int, cell_load: float, sinr_db: float, pdcp_dup: bool = False,
                 scs_khz: int = 30, drx: bool = False, target_bler: float = 0.1) -> dict:
    """QoS 스케줄러 관점 지표: 지연/지터/패킷손실.
    혼잡(cell_load>1)이면 큐잉 지연 증가. GBR(고우선)은 완만, 비GBR은 급증.
    나쁜 무선품질(낮은 SINR)은 HARQ 재전송으로 지연·손실 증가.

    delay-critical GBR(5QI 82/83/84/85): 큐잉 지연이 (PDB − 코어/전송 지연)을 넘으면
    해당 패킷은 재전송 여유 없이 '폐기'되고 PER(packet_loss)로 계상한다. Maximum Data
    Burst Volume(MDBV)을 PDB 안에 못 실을 만큼 혼잡하면 초과 버스트도 폐기한다.

    PDCP 복제/중복 PDU 세션(pdcp_dup=True): delay-critical/URLLC 트래픽을 두 독립 경로로
    복제 전송 → 무선 신뢰성 손실(PER+BLER)이 다이버시티로 약 절반이 된다(TS 38.323/23.501).
    스케줄링 폐기(PDB/MDBV 초과)는 자원 부족 문제라 복제로 구제되지 않는다."""
    pdb = FIVEQI_PDB.get(fiveqi, 300)
    per = FIVEQI_PER.get(fiveqi, 1e-6)
    gbr = fiveqi in FIVEQI_GBR
    delay_critical = fiveqi in FIVEQI_DELAY_CRITICAL
    over = max(cell_load - 1.0, 0.0)  # 용량 초과분
    # 기본 지연 = 전송지연 + 스케줄링. delay-critical은 mini-slot/configured grant/선점으로
    # 무혼잡 시 예산 안(~1.5ms), 일반 서비스는 슬롯 스케줄링(~8ms) 기준.
    base = 1.5 if delay_critical else 8.0
    # 뉴머롤로지: 슬롯 길이를 전송/스케줄링 지연에 반영 (높은 SCS → 짧은 슬롯 → 낮은 지연). TS 38.211
    base += _slot_ms(scs_khz)
    # DRX: 페이징/웨이크업 지연 페널티 (배터리↔지연 트레이드오프, 처리량 불변). TS 38.321 §5.7
    if drx:
        base += DRX_PAGING_LATENCY_MS
    # 혼잡 시 큐잉 지연 (비GBR이 훨씬 민감). TS 23.501 §5.7.3.3: 스케줄러가 Priority Level 존중 →
    # 우선도 높은(낮은 값) 플로우는 큐잉 지연이 작고, 낮은 플로우는 크다. 기준 priority=90(5QI9)
    # → prio_factor=1.0 이라 기본 eMBB 는 기존과 동일(하위호환). 단조·유계(0.05~1.5).
    priority = FIVEQI_PRIORITY.get(fiveqi, 90)
    prio_factor = min(max(priority / 90.0, 0.05), 1.5)
    queue = over * (25.0 if gbr else 120.0) * prio_factor
    # 목표 BLER(TS 38.214 §5.1.3): 낮은 목표→보수적 MCS→잔여 BLER↓·재전송↓ (단조).
    # 기준 0.1 → scale=1.0(하위호환), 0.01 → 0.1. HARQ 재전송 지연/잔여 BLER를 함께 축소.
    retx_scale = min(max(float(target_bler) / 0.1, 0.1), 1.0)
    radio_penalty = max(0.0, (5.0 - sinr_db)) * 1.5 * retx_scale  # 저SINR HARQ 재전송
    latency = round(min(base + queue + radio_penalty, pdb * 3), 1)
    radio_loss = 10 ** (-max(sinr_db + 3, 0.5) / 8.0) * retx_scale  # 저SINR 잔여 BLER 근사
    mdbv = FIVEQI_MDBV.get(fiveqi)
    dropped_over_pdb = False
    mdbv_exceeded = False
    # PDCP 복제 다이버시티: 무선 신뢰성 손실(PER+BLER)만 절반으로 (delay-critical/URLLC 대상).
    dup_factor = 0.5 if (pdcp_dup and delay_critical) else 1.0
    if delay_critical:
        # delay-critical: 코어/전송 지연을 뺀 무선 예산 안에 못 들어오면 폐기.
        eff_pdb = max(pdb - CORE_TRANSPORT_DELAY_MS, 1.0)
        drop_frac = 0.0
        if latency > eff_pdb:
            dropped_over_pdb = True
            drop_frac += min((latency - eff_pdb) / eff_pdb, 1.0)  # 예산 초과율 → 드롭율
        if mdbv is not None and over > 0.0:
            # 혼잡으로 스케줄 자원이 MDBV 버스트를 PDB 안에 못 실음 → 초과분 폐기.
            mdbv_exceeded = True
            drop_frac += min(over, 1.0) * 0.5
        # 복제는 무선 손실(per+radio_loss)만 구제, 스케줄 폐기(drop_frac)는 그대로.
        ploss = round(((per + radio_loss) * dup_factor + min(drop_frac, 1.0)) * 100, 3)
    else:
        # 비 delay-critical: 예산 초과는 즉시 폐기가 아니라 완만한 손실(재전송 여유).
        budget_loss = 0.0 if latency <= pdb else min((latency - pdb) / pdb * 0.3, 0.5)
        ploss = round((per + budget_loss + radio_loss) * 100, 3)
    jitter = round(min(2.0 + over * (3 if gbr else 15), 60), 1)
    return {
        "latency_ms": latency,
        "packet_loss_pct": min(ploss, 100.0),
        "jitter_ms": jitter,
        "pdb_ms": pdb,
        "over_pdb": latency > pdb,
        "delay_critical": delay_critical,
        "mdbv_bytes": mdbv,
        "mdbv_exceeded": mdbv_exceeded,
        "dropped_over_pdb": dropped_over_pdb,
        "pdcp_duplication": bool(pdcp_dup and delay_critical),
    }


# ── NB-IoT / LTE-M 커버리지 확장(Coverage Enhancement) 사다리 — 근사 물리 모델 ──
# 반복(repetition) 전송으로 정상 MCL(~144dB)에서 NB-IoT 목표 MCL(~164dB)까지 링크버짓 확장.
# 반복 2배당 약 +3dB 결합이득(coherent combining) 근사. 실제 BLER 곡선·자원매핑은 근사.
#   - NB-IoT: NPRACH 반복 ≤128, 데이터(NPDSCH/NPUSCH) 반복 ≤2048.
#   - LTE-M: CE Mode A 반복 ≤32(중간 커버리지), CE Mode B 반복 ≤2048(심층 커버리지).
CE0_SNR_DB = -6.0        # NB-IoT/LTE-M CE level 0 동작점 SNR 근사 (이 이상이면 반복 불필요)
CE_MAX_GAIN_DB = 20.0    # 최대 반복 결합이득 근사 — LTE MCL 144→NB-IoT 164dB(+20dB)에 대응
NBIOT_LTEM_MAX_MBPS = 1.0  # 협대역/저Cat 단말 DL 처리량 상한(LTE-M ~1Mbps, NB-IoT 훨씬 낮음)


def _ce_ladder(snr_db: float, coupling_loss_db: float) -> dict:
    """수신 SNR(링크 마진) → CE 레벨/반복수/커버리지 여부.

    CE는 수신 SNR이 CE0 동작점(~-6dB) 아래로 떨어지면 반복(repetition)으로 링크를 확장한다.
    반복 결합이득은 부족분(deficit=CE0−SNR)만큼 필요하며 3dB/2배로 근사. 최대 결합이득
    ~20dB(NB-IoT가 LTE MCL 144dB 대비 164dB로 +20dB 확장하는 것에 대응)까지 커버.
    부족분이 최대 이득을 넘거나(≈SNR<-26dB) NPRACH 반복 상한(128)을 넘으면 CE로도 미달 →
    RACH 실패. 절대 MCL은 저전력 실내셀에선 커플링손실 자체가 작으므로 SNR 마진으로 판정하고,
    reporting용 유효 MCL(mcl_db)은 현재 커플링손실 + 반복이득으로 환산한다(근사)."""
    deficit = CE0_SNR_DB - snr_db  # CE0 임계 대비 SNR 부족분(dB)
    eff_mcl = round(coupling_loss_db + max(min(deficit, CE_MAX_GAIN_DB), 0.0), 1)
    if deficit <= 0.0:
        return {"ce_level": 0, "ce_mode": "none", "data_reps": 1, "nprach_reps": 1,
                "in_coverage": True, "nprach_ok": True, "mcl_db": eff_mcl}
    reps_needed = int(2 ** int(np.ceil(deficit / 3.0)))  # 3dB/2배 결합이득 근사
    data_reps = int(min(reps_needed, 2048))
    nprach_reps = int(min(reps_needed, 128))
    if deficit <= 6.0:
        ce_level, mode = 0, "A"
    elif deficit <= 14.0:
        ce_level, mode = 1, ("A" if reps_needed <= 32 else "B")
    else:
        ce_level, mode = 2, "B"
    nprach_ok = reps_needed <= 128  # NPRACH 반복 상한 초과 → preamble 미도달 → RACH 실패
    in_coverage = deficit <= CE_MAX_GAIN_DB and nprach_ok
    return {"ce_level": ce_level, "ce_mode": mode, "data_reps": data_reps,
            "nprach_reps": nprach_reps, "in_coverage": in_coverage,
            "nprach_ok": nprach_ok, "mcl_db": eff_mcl}


# ── PRACH 경합/충돌(CBRA) 모델 — 부하에 따른 preamble 충돌 근사 ──
RACH_CBRA_PREAMBLES = 54      # 64 preamble − CFRA/SI 예약분 근사 (경합용 free preamble 수)
RACH_CONTENTION_SCALE = 30.0  # cell_load(0~2) → 한 RACH occasion당 동시 경합 UE 수 환산
MSGA_PUSCH_SINR_DB = -2.0     # 2-step MsgA PUSCH 복조 임계 (4-step Msg3 −8dB보다 높음)
RAR_WINDOW_MS = 10.0          # ra-ResponseWindow 근사


def _rach_contention(cell_load: float, max_tx: int, radio_ok: bool) -> dict:
    """동시 경합 UE 수(부하 기반) → preamble 충돌확률·접속성공확률·접속지연.

    같은 RACH occasion에서 n명이 R개 preamble 중 임의 선택 →
    한 UE의 충돌확률 p = 1 − ((R−1)/R)^(n−1).
    preambleTransMax 회 재시도까지 성공확률 = 1 − p^N (무선링크가 되는 경우)."""
    contenders = max(1, int(round(max(cell_load, 0.0) * RACH_CONTENTION_SCALE)))
    r = RACH_CBRA_PREAMBLES
    p_coll = 1.0 - ((r - 1) / r) ** max(contenders - 1, 0)
    q = 1.0 - p_coll  # 단일 시도 무충돌 확률
    n = max(int(max_tx), 1)
    if not radio_ok:
        access_prob = 0.0
        exp_attempts = float(n)
    else:
        access_prob = 1.0 - p_coll ** n
        # 절단 기하분포 기대 시도수(성공 포함): (1 − p^N)/(1 − p)
        exp_attempts = (1.0 - p_coll ** n) / max(q, 1e-9)
        exp_attempts = min(max(exp_attempts, 1.0), float(n))
    # Msg2 Backoff Indicator(38.321 Table 7.2-1)는 부하에 따라 커짐 → 재시도 지연 증가.
    bi_ms = min(10.0 + contenders, 160.0)
    access_delay = round((exp_attempts - 1.0) * (RAR_WINDOW_MS + bi_ms / 2.0) + RAR_WINDOW_MS, 1)
    return {
        "contenders": contenders,
        "collision_prob": round(p_coll, 3),
        "access_prob": round(access_prob, 3),
        "exp_attempts": exp_attempts,
        "access_delay_ms": access_delay,
        "bi_ms": round(bi_ms, 0),
    }


def probe(scene: dict, position: list, fiveqi: int = 9, cell_load: float = 0.0) -> dict:
    """한 지점(UE 위치)의 셀별 상세 측정값 — 드라이브테스트 툴 스타일."""
    gnbs = [g for g in scene.get("gnbs", []) if g.get("enabled", True)]
    obstacles = scene.get("obstacles", [])
    ple = float(scene.get("path_loss_exp", 3.5))
    scene_nf = float(scene.get("noise_figure_db", NOISE_FIGURE_DB))  # 씬 기본 잡음지수 (TS 38.101-4)
    sigma = float(scene.get("shadow_sigma_db", 0.0))  # 섀도우 페이딩 σ (TR 38.901 §7.4.1)
    scene_im_db = float(scene.get("interference_margin_db", 0.0))  # 씬 기본 간섭 마진 (TS 38.104 IoT)
    scene_target_bler = float(scene.get("target_bler", 0.1))  # 씬 기본 목표 BLER (TS 38.214 §5.1.3)
    scene_ue_pmax = float(scene.get("ue_pmax_dbm", 23.0))  # 씬 기본 UE 최대 송신전력 (TS 38.101-1 Pcmax)
    ceil_h = float(scene.get("space", {}).get("height", 10.0)) if scene.get("ceiling", True) else None
    point = np.array([position], dtype=np.float64)

    if not gnbs:
        return {"cells": [], "serving": None}

    cells = []
    powers_mw = []
    raw_dbm = []  # AGC 클램프 이전 실제 수신전력 (UL 경로손실 역산용)
    agc_active = False
    for ci, g in enumerate(gnbs):
        # 빔포밍 + UE 추적: 빔을 UE 방향으로 조향한 상태로 계산
        if g.get("antenna") == "beam" and g.get("beam_tracking", True):
            ax = float(g["position"][0])
            ay = float(g.get("height", 2.5))
            az = float(g["position"][2])
            dx, dy, dz = position[0] - ax, position[1] - ay, position[2] - az
            g = dict(
                g,
                azimuth_deg=float(np.rad2deg(np.arctan2(dz, dx))),
                tilt_deg=float(-np.rad2deg(np.arctan2(dy, max(np.hypot(dx, dz), 1e-6)))),
            )
        # 셀별 전파 파라미터 오버라이드 — 셀 고유값이 있으면 사용, 없으면 씬 기본값 폴백.
        # 경로손실 지수(TR 38.901)·섀도우 σ(TR 38.901 §7.4.1)를 셀마다 적용(국소 열악환경 모델링).
        g_ple = float(g["path_loss_exp"]) if g.get("path_loss_exp") is not None else ple
        g_sigma = float(g["shadow_sigma_db"]) if g.get("shadow_sigma_db") is not None else sigma
        raw = float(_received_power_dbm(g, point, obstacles, g_ple, ceil_h, g_sigma, ci)[0])
        # AGC: 과입력 시 UE가 수신 감쇠기로 -45dBm 이하로 제한
        if raw > AGC_MAX_RSRP_DBM:
            agc_active = True
        p_dbm = min(raw, AGC_MAX_RSRP_DBM)
        raw_dbm.append(raw)
        powers_mw.append(10.0 ** (p_dbm / 10.0))
        cells.append({
            "id": g.get("id"),
            "name": g.get("name", "gNB"),
            "rsrp_dbm": round(p_dbm, 1),
            "freq_mhz": float(g.get("freq_mhz", 3500.0)),
        })

    powers_mw = np.array(powers_mw)
    # AGC는 합성 RF에 대한 단일 감쇠기이므로 셀 간 비율(SINR/RSRQ)은 불변.
    # → SINR/RSRQ/서빙선택은 클램프 이전 raw 전력으로 계산(물리적으로 정확).
    raw_mw = np.array([10.0 ** (r / 10.0) for r in raw_dbm])
    si = int(np.argmax(raw_mw))
    serving_gnb = gnbs[si]
    # 서빙 셀별 RF 파라미터 오버라이드 — 셀 고유값이 있으면 사용, 없으면 씬 기본값 폴백.
    _cell_nf = serving_gnb.get("noise_figure_db")
    nf = float(_cell_nf) if _cell_nf is not None else scene_nf  # 수신기 잡음지수 (TS 38.101-4)
    _cell_im = serving_gnb.get("interference_margin_db")
    im_db = float(_cell_im) if _cell_im is not None else scene_im_db  # 간섭 마진 (TS 38.104 IoT)
    _cell_tb = serving_gnb.get("target_bler")
    target_bler = float(_cell_tb) if _cell_tb is not None else scene_target_bler  # 목표 BLER (TS 38.214 §5.1.3)
    _cell_pmax = serving_gnb.get("ue_pmax_dbm")
    ue_pmax = float(_cell_pmax) if _cell_pmax is not None else scene_ue_pmax  # UE 최대 송신전력 (TS 38.101-1 Pcmax)
    bw_mhz = float(serving_gnb.get("bandwidth_mhz", 100.0))
    bw_hz = bw_mhz * 1e6
    noise_mw = 10.0 ** ((-174.0 + 10.0 * np.log10(bw_hz) + nf) / 10.0)
    # PCI mod-3 충돌 이웃은 간섭 ×2 (DL 참조신호/스케줄링 겹침)
    s_mod3 = int(serving_gnb.get("pci", 0)) % 3
    interference = 0.0
    for j, g in enumerate(gnbs):
        if j == si:
            continue
        w = 2.0 if int(g.get("pci", 0)) % 3 == s_mod3 else 1.0
        interference += raw_mw[j] * w
    # 간섭 마진(IoT): 부하 네트워크 근사 — DL SINR을 마진(dB)만큼 균일 저하. TS 38.104
    sinr = float(np.clip(10.0 * np.log10(raw_mw[si] / (interference + noise_mw)) - im_db, -50, 60))
    # PCI mod-30 충돌: 이웃과 UL DMRS 패턴 겹침 → UL BLER↑ (UL SINR 페널티)
    s_mod30 = int(serving_gnb.get("pci", 0)) % 30
    mod30_clash = any(
        j != si and int(g.get("pci", 0)) % 30 == s_mod30 and raw_mw[j] > raw_mw[si] * 0.1
        for j, g in enumerate(gnbs)
    )

    # RSRQ 근사: 서빙 전력 / (전체 수신 + 잡음) — AGC 불변이므로 raw 사용
    rsrq = float(np.clip(10.0 * np.log10(raw_mw[si] / (np.sum(raw_mw) + noise_mw)), -25, 0))

    # 예상 처리량: Shannon 용량 × 구현효율 × 공간 레이어, RAN feature 반영
    #   256QAM: 레이어당 SE 상한 7.4, 미적용(64QAM) 5.55 bps/Hz
    #   4x4 MIMO: 레이어 2→4 / CA: 유효 대역폭 2배
    qam_cap = 7.4 if serving_gnb.get("qam256", True) else 5.55
    # DL 공간 레이어(rank) — TS 38.211/214. 명시 mimo_layers를 레이어 배수로 사용(≤8, rank 상한).
    # 미지정 시 기존 mimo4x4 불리언 파생값(True→4, False→2)으로 폴백 → 하위호환.
    # 기본 2 → 기존 2-레이어 동작 그대로. SINR/SE 계산은 불변, 레이어 배수만 변화(단조 증가).
    default_layers = 4 if serving_gnb.get("mimo4x4", False) else 2
    layers = int(np.clip(int(serving_gnb.get("mimo_layers", default_layers)), 1, 8))
    # 뉴머롤로지: 유효(가드밴드 제외) PRB → 유효 대역폭(≤ 공칭). 높은 SCS일수록 RB 폭↑·오버헤드 반영. TS 38.104
    scs = int(serving_gnb.get("scs_khz", 30))
    n_rb = _usable_prbs(bw_mhz, scs)
    bw_usable = n_rb * 12.0 * scs / 1000.0  # MHz
    bw_eff = bw_usable * (2.0 if serving_gnb.get("ca_enabled", False) else 1.0)
    # TDD DL 슬롯 비율 → DL 처리량은 DL 시간 점유율에 비례 (기본 0.75)
    dl_ratio = float(serving_gnb.get("tdd_dl_ratio", 0.75))
    se = min(np.log2(1.0 + 10.0 ** (sinr / 10.0)), qam_cap)
    # 목표 BLER(TS 38.214 §5.1.3): CQI/MCS는 목표 BLER 기준 선택 — 낮은 목표→보수적 MCS→최대 SE↓.
    se = se * _bler_se_factor(target_bler)
    throughput_mbps = round(se * bw_eff * 0.567 * layers * dl_ratio, 1)

    freq = float(serving_gnb.get("freq_mhz", 3500.0))

    # UL 링크 버짓 / PRACH 접속 성공률
    # 하향 RSRP로 경로손실 역산. UE Pmax(TS 38.101-1)로 상한 클램프.
    tx_dl = float(serving_gnb.get("tx_power_dbm", 30.0)) + float(serving_gnb.get("gain_dbi", 0.0))
    est_pl = tx_dl - raw_dbm[si]  # 경로손실 역산 (AGC 클램프 이전 원신호 사용)
    # ue_pmax 는 서빙 셀 오버라이드 우선(위에서 해석) → UL PUSCH/PRACH 전력 클램프에 사용.
    p0 = float(serving_gnb.get("p0_nominal_dbm", -90.0))
    alpha = float(serving_gnb.get("alpha", 0.8))
    ramp = float(serving_gnb.get("prach_ramp_step_db", 2.0))
    max_tx = int(serving_gnb.get("prach_max_tx", 10))
    gnb_gain = float(serving_gnb.get("gain_dbi", 0.0))
    ul_noise_dbm = -174.0 + 10.0 * np.log10(bw_hz) + nf

    # PUSCH 개루프 전력제어 (P0 + alpha·PL, Pmax 클램프) → MsgA PUSCH / UL SINR. TS 38.213
    pusch_tx = min(ue_pmax, p0 + alpha * est_pl)
    ul_sinr = (pusch_tx - est_pl + gnb_gain) - ul_noise_dbm

    # PRACH 프리앰블 개루프: preambleInitialReceivedTargetPower(prach_power_dbm)를 gNB 수신 목표로,
    # UE 프리앰블 송신 = target + PL + (시도−1)·powerRampingStep, Pmax 클램프. 수신전력 ≥ 목표면
    # preambleTransMax 내 검출 성공. 목표가 높거나 Pmax 부족(셀 경계)이면 실패. TS 38.321/38.213
    prach_target_dbm = float(serving_gnb.get("prach_power_dbm", -104.0))
    radio_attempts = 0
    radio_ok = False  # 무선(경로손실/전력) 관점의 preamble 도달 성공
    for att in range(max_tx):
        ue_tx = min(ue_pmax, prach_target_dbm + est_pl + ramp * att)
        ul_rx = ue_tx - est_pl + gnb_gain  # gNB 수신 프리앰블 전력
        radio_attempts = att + 1
        if ul_rx >= prach_target_dbm:
            radio_ok = True
            break
    if mod30_clash:
        ul_sinr -= 4.0  # mod-30 UL DMRS 충돌 페널티

    # 커플링 손실 ≈ DL 경로손실(UE 안테나이득 0 근사). CE 사다리/커버리지 판정 입력.
    coupling_loss = round(float(est_pl), 1)
    iot_ce = fiveqi in IOT_CE_5QI
    ce = _ce_ladder(sinr, coupling_loss) if iot_ce else None

    # CBRA 경합(충돌) 모델 — 부하가 높을수록 preamble 충돌 → 접속 지연/실패.
    cont = _rach_contention(cell_load, max_tx, radio_ok)

    # 2-step → 4-step fallback (FR2 120kHz SCS에서 2-step CBRA 사용 가정).
    two_step_rach = int(serving_gnb.get("scs_khz", 30)) == 120
    msgA_fallback = False
    ra_type = "4-step"
    if two_step_rach:
        ra_type = "2-step"
        # MsgA PUSCH 복조 임계 미달(셀 경계) → fallbackRAR → 4-step RA로 폴백.
        if ul_sinr < MSGA_PUSCH_SINR_DB:
            msgA_fallback = True
            ra_type = "2-step→4-step"

    if iot_ce:
        # 커버리지 확장 UE: 반복으로 무선링크는 확장. NPRACH 반복 상한 초과 시 CE 미달 → RACH 실패.
        rach_ok = bool(ce["in_coverage"]) and cont["access_prob"] > 0.3
        # rach_attempts = 시도한 CE 레벨 수(0→1→2 에스컬레이션)
        rach_attempts = ce["ce_level"] + 1
        rach_access_delay = round(cont["access_delay_ms"] + ce["nprach_reps"] * 1.0, 1)
    else:
        rach_ok = bool(radio_ok) and cont["access_prob"] > 0.5
        rach_attempts = int(round(cont["exp_attempts"])) if radio_ok else max_tx
        rach_access_delay = cont["access_delay_ms"]

    # QoS 지표(지연/손실/PDB) — delay-critical 5QI(82/83/84/85) 드롭·MDBV 포함.
    # PDCP 복제/중복 PDU 세션이 켜진 서빙셀이면 URLLC 무선 손실을 다이버시티로 절반.
    pdcp_dup = bool(serving_gnb.get("pdcp_duplication", False))
    # 뉴머롤로지(슬롯 지연)·DRX(페이징 웨이크 지연) 반영. TS 38.211 / TS 38.321 §5.7
    drx_on = bool(serving_gnb.get("drx", False))
    qos = _qos_metrics(fiveqi, cell_load, sinr, pdcp_dup, scs_khz=scs, drx=drx_on,
                       target_bler=target_bler)

    # NB-IoT/LTE-M 커버리지 확장: 반복이 지연을 부풀리고 유효 처리량을 나눈다(협대역 상한).
    if iot_ce and ce is not None:
        reps = max(int(ce["data_reps"]), 1)
        # 반복 지연 ≈ 데이터 반복수 × 서브프레임(~1ms) + NPRACH 반복 접속지연.
        qos["latency_ms"] = round(qos["latency_ms"] + reps * 1.0 + ce["nprach_reps"] * 1.0, 1)
        throughput_mbps = round(min(throughput_mbps / reps, NBIOT_LTEM_MAX_MBPS), 3)
        if not ce["in_coverage"]:
            # CE 레벨을 최대로 올려도 MCL 미달 → 커버리지 밖, 접속/전송 실패.
            qos["over_pdb"] = True
            qos["packet_loss_pct"] = min(qos["packet_loss_pct"] + 50.0, 100.0)

    # 서비스모드 확장: RSSI(전체 수신 전력), RI(공간 레이어), SSB 인덱스(빔 근사), NCI
    rssi = float(min(10.0 * np.log10(np.sum(powers_mw) + noise_mw), AGC_MAX_RSRP_DBM))
    ri = layers  # 보고용 RI = 실제 사용 공간 레이어 수 (mimo_layers 반영)
    if serving_gnb.get("antenna") == "beam":
        ssb_idx = int(float(serving_gnb.get("azimuth_deg", 0.0)) % 360 // 45)
    else:
        ssb_idx = 0
    return {
        "cells": cells,
        "serving": cells[si]["id"],
        "serving_name": cells[si]["name"],
        "rsrp_dbm": cells[si]["rsrp_dbm"],
        "sinr_db": round(sinr, 1),
        "rsrq_db": round(rsrq, 1),
        "cqi": _cqi_from_sinr(sinr),
        "est_throughput_mbps": throughput_mbps,
        "nr_arfcn": _nr_arfcn(freq),
        "band": _band_guess(freq),
        "bandwidth_mhz": bw_mhz,
        "pci": int(serving_gnb.get("pci", 0)),
        "tac": int(serving_gnb.get("tac", 1)),
        "scs_khz": int(serving_gnb.get("scs_khz", 30)),
        "rssi_dbm": round(rssi, 1),
        "agc_active": agc_active,
        "ul_sinr_db": round(float(ul_sinr), 1),
        "rach_ok": bool(rach_ok),
        "rach_attempts": int(rach_attempts),
        # PRACH 경합/충돌(CBRA) — 부하 기반
        "rach_contenders": int(cont["contenders"]),
        "rach_collision_prob": cont["collision_prob"],
        "rach_access_prob": cont["access_prob"],
        "rach_access_delay_ms": rach_access_delay,
        "two_step_rach": bool(two_step_rach),
        "msgA_fallback": bool(msgA_fallback),
        "ra_type": ra_type,
        # NB-IoT/LTE-M 커버리지 확장(CE) 사다리
        "coupling_loss_db": coupling_loss,
        "ce_level": (ce["ce_level"] if ce is not None else 0),
        "ce_mode": (ce["ce_mode"] if ce is not None else "none"),
        "ce_repetitions": (ce["data_reps"] if ce is not None else 1),
        "ce_nprach_reps": (ce["nprach_reps"] if ce is not None else 1),
        "ce_in_coverage": (bool(ce["in_coverage"]) if ce is not None else True),
        "mcl_db": (ce["mcl_db"] if ce is not None else coupling_loss),
        "pci_mod3_clash": any(
            j != si and int(g.get("pci", 0)) % 3 == s_mod3 and powers_mw[j] > powers_mw[si] * 0.25
            for j, g in enumerate(gnbs)
        ),
        "pci_mod30_clash": bool(mod30_clash),
        **qos,
        "ri": ri,
        "ssb_idx": ssb_idx,
        "cell_id": f"0x{(si + 1) * 16:09X}",
    }

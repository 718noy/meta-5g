"""Meta 5G 백엔드 — 전파 시뮬레이션 API + Phase 3 실스택 브릿지."""

import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import physics

# 빌드된 프론트엔드(dist) 위치 — 백엔드가 UI까지 함께 서빙한다.
# PyInstaller로 번들된 실행(exe)에서는 sys._MEIPASS(번들 루트) 아래에서 찾고,
# 일반 실행에서는 소스 트리(backend/../frontend/dist)에서 찾는다.
if getattr(sys, "frozen", False):
    DIST_DIR = (Path(getattr(sys, "_MEIPASS", ".")) / "frontend" / "dist").resolve()
else:
    DIST_DIR = (Path(__file__).resolve().parent.parent / "frontend" / "dist").resolve()

# Phase 3: WSL 실스택 로그 (Windows에서 \\wsl.localhost 경로로 직접 읽음)
WSL = r"\\wsl.localhost\Ubuntu-24.04"
REAL_LOG_SOURCES = {
    **{
        nf: rf"{WSL}\var\log\open5gs\{nf}.log"
        for nf in [
            "amf", "smf", "upf", "ausf", "udm", "udr",
            "nrf", "scp", "sepp", "nssf", "bsf", "pcf",
        ]
    },
    "gnb": rf"{WSL}\opt\dtsim\gnb.log",
    "ue": rf"{WSL}\opt\dtsim\ue.log",
}
# 리눅스 경로 (권한 문제 시 wsl root tail 폴백용)
REAL_LOG_LINUX = {
    **{nf: f"/var/log/open5gs/{nf}.log" for nf in [
        "amf", "smf", "upf", "ausf", "udm", "udr",
        "nrf", "scp", "sepp", "nssf", "bsf", "pcf",
    ]},
    "gnb": "/opt/dtsim/gnb.log",
    "ue": "/opt/dtsim/ue.log",
}
MAX_CHUNK = 64 * 1024  # 한 번에 읽는 최대 바이트


def _wsl_read(src: str, offset: int) -> tuple[bytes, int]:
    """권한 폴백: wsl root로 파일 크기 조회 + offset부터 청크 읽기."""
    lp = REAL_LOG_LINUX[src]
    r = subprocess.run(
        ["wsl", "-d", "Ubuntu-24.04", "-u", "root", "bash", "-c",
         f"stat -c %s {lp} 2>/dev/null || echo 0"],
        capture_output=True, timeout=10,
    )
    size = int(r.stdout.decode().strip() or "0")
    if offset < 0:
        offset = max(0, size - 8192)
    if offset > size:
        offset = 0
    if size == 0:
        return b"", 0
    r = subprocess.run(
        ["wsl", "-d", "Ubuntu-24.04", "-u", "root", "bash", "-c",
         f"tail -c +{offset + 1} {lp} | head -c {MAX_CHUNK}"],
        capture_output=True, timeout=10,
    )
    return r.stdout, offset + len(r.stdout)

app = FastAPI(title="Meta 5G Simulation Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 로컬 개발용
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulateRequest(BaseModel):
    scene: dict


class ProbeRequest(BaseModel):
    scene: dict
    position: list[float]
    fiveqi: int = 9
    cell_load: float = 0.0


@app.get("/health")
def health():
    return {"status": "ok"}


_rt_error: str | None = None


@app.post("/simulate")
def simulate(req: SimulateRequest):
    """engine=rt 이면 Sionna RT(GPU 레이트레이싱), 아니면 경험적 모델."""
    global _rt_error
    if req.scene.get("engine") == "rt":
        try:
            import physics_rt  # 최초 호출 시에만 GPU/JIT 초기화

            return physics_rt.simulate_rt(req.scene)
        except Exception as e:  # RT 실패 시 경험적 모델로 폴백
            _rt_error = str(e)
            result = physics.simulate(req.scene)
            result["engine"] = "empirical-fallback"
            result["rt_error"] = _rt_error[:200]
            return result
    result = physics.simulate(req.scene)
    result["engine"] = "empirical"
    return result


@app.post("/probe")
def probe(req: ProbeRequest):
    return physics.probe(req.scene, req.position, req.fiveqi, req.cell_load)


@app.get("/p3/sources")
def p3_sources():
    """실스택 로그 소스 목록 + 존재 여부."""
    out = []
    for name, path in REAL_LOG_SOURCES.items():
        try:
            size = os.path.getsize(path)
            out.append({"name": name, "available": True, "size": size})
        except OSError:
            out.append({"name": name, "available": False, "size": 0})
    return {"sources": out}


def _wsl_run(script: str, timeout: int = 60) -> str:
    """스크립트를 stdin으로 전달(bash -s) — Windows 인자 인용 문제 회피."""
    r = subprocess.run(
        ["wsl", "-d", "Ubuntu-24.04", "-u", "root", "bash", "-s"],
        input=script.encode("utf-8"),
        capture_output=True, timeout=timeout,
    )
    return r.stdout.decode("utf-8", errors="replace")


class PlmnApply(BaseModel):
    mcc: str
    mnc: str


class UeApply(BaseModel):
    mcc: str
    mnc: str
    msin: str
    scheme: str = "null"  # null | profileA


def _digits(s: str, lo: int, hi: int) -> str:
    d = "".join(c for c in s if c.isdigit())
    if not (lo <= len(d) <= hi):
        raise ValueError(f"invalid length: {s}")
    return d


@app.post("/p3/apply_plmn")
def p3_apply_plmn(req: PlmnApply):
    """3D UI의 PLMN을 실스택 전체(Open5GS 전 NF + UERANSIM)에 반영하고 재기동."""
    try:
        mcc = _digits(req.mcc, 3, 3)
        mnc = _digits(req.mnc, 2, 3)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    script = f"""
sed -i -E 's/mcc: [0-9]+/mcc: {mcc}/g; s/mnc: [0-9]+/mnc: {mnc}/g' /etc/open5gs/*.yaml
sed -i -E "s/mcc: '[0-9]+'/mcc: '{mcc}'/; s/mnc: '[0-9]+'/mnc: '{mnc}'/" /opt/dtsim/gnb.yaml /opt/dtsim/ue.yaml
systemctl restart open5gs-nrfd open5gs-scpd; sleep 2
systemctl restart open5gs-ausfd open5gs-udmd open5gs-udrd open5gs-pcfd open5gs-nssfd open5gs-bsfd open5gs-seppd; sleep 2
systemctl restart open5gs-amfd open5gs-smfd open5gs-upfd; sleep 3
echo PLMN_APPLIED
"""
    out = _wsl_run(script, timeout=120)
    return {"ok": "PLMN_APPLIED" in out, "log": out[-500:]}


@app.post("/p3/ue_apply")
def p3_ue_apply(req: UeApply):
    """UI의 SIM(SUPI/보호스킴)을 UERANSIM UE에 반영: 가입자 보장 → ue.yaml 갱신 → 재등록."""
    try:
        mcc = _digits(req.mcc, 3, 3)
        mnc = _digits(req.mnc, 2, 3)
        msin = _digits(req.msin, 9, 10)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    imsi = f"{mcc}{mnc}{msin}"
    scheme = 1 if req.scheme == "profileA" else 0
    # 가입자 인증키(K/OPc)는 로컬 WSL 랩의 Open5GS DB에 이미 등록돼 있음(공개 저장소에 커밋하지 않음).
    # 아래 스크립트는 기존 가입자를 복제해 신규 IMSI만 추가하므로 K/OPc를 코드에 둘 필요가 없다.
    script = f"""
mongosh --quiet open5gs --eval '
  if (!db.subscribers.findOne({{imsi:"{imsi}"}})) {{
    var t = db.subscribers.findOne();
    if (t) {{ delete t._id; t.imsi = "{imsi}"; db.subscribers.insertOne(t); }}
  }}
  print("SUB=" + db.subscribers.countDocuments({{imsi:"{imsi}"}}));
'
sed -i -E "s/supi: 'imsi-[0-9]+'/supi: 'imsi-{imsi}'/; s/mcc: '[0-9]+'/mcc: '{mcc}'/; s/mnc: '[0-9]+'/mnc: '{mnc}'/; s/protectionScheme: [0-9]/protectionScheme: {scheme}/" /opt/dtsim/ue.yaml
pkill -x nr-ue; sleep 1
cd /opt/UERANSIM/build && nohup ./nr-ue -c /opt/dtsim/ue.yaml > /opt/dtsim/ue.log 2>&1 &
for i in $(seq 1 24); do
  grep -qi 'registration is successful' /opt/dtsim/ue.log && break
  grep -q 'Registration failed' /opt/dtsim/ue.log && break
  sleep 0.5
done
grep -qi 'registration is successful' /opt/dtsim/ue.log && echo REG_OK || echo REG_FAIL
tail -3 /opt/dtsim/ue.log
"""
    out = _wsl_run(script, timeout=60)
    return {"ok": "REG_OK" in out, "imsi": imsi, "log": out[-800:]}


@app.post("/p3/restart")
def p3_restart(target: str = "ranue"):
    """실스택 재기동: ranue(gNB+UE) 또는 core."""
    if target == "core":
        script = (
            "systemctl restart open5gs-nrfd open5gs-scpd; sleep 2; "
            "systemctl restart open5gs-ausfd open5gs-udmd open5gs-udrd open5gs-pcfd "
            "open5gs-nssfd open5gs-bsfd open5gs-seppd; sleep 2; "
            "systemctl restart open5gs-amfd open5gs-smfd open5gs-upfd; echo DONE"
        )
    else:
        script = (
            "pkill -x nr-ue; pkill -x nr-gnb; sleep 2; cd /opt/UERANSIM/build; "
            "nohup ./nr-gnb -c /opt/dtsim/gnb.yaml > /opt/dtsim/gnb.log 2>&1 & sleep 4; "
            "nohup ./nr-ue -c /opt/dtsim/ue.yaml > /opt/dtsim/ue.log 2>&1 & sleep 8; "
            "grep -c 'registration is successful' /opt/dtsim/ue.log; echo DONE"
        )
    out = _wsl_run(script, timeout=90)
    return {"ok": "DONE" in out, "log": out[-400:]}


@app.post("/p3/ping")
def p3_ping(host: str = "10.100.0.1", count: int = 4):
    """실 데이터플레인 검증: UE 터널(uesimtun0/val0000...)로 host에 ping.

    PacketRusher는 val<msin> 이름의 TUN을 만든다. UERANSIM은 uesimtun0.
    둘 중 존재하는 인터페이스로 ping을 시도한다.
    """
    safe_host = "".join(c for c in host if c.isdigit() or c in ".:")
    script = f"""
IF=$(ip -o link show | grep -oE '(uesimtun0|val[0-9]+)' | head -1)
[ -z "$IF" ] && {{ echo NO_TUN; exit 0; }}
echo "IF=$IF"
ping -I "$IF" -c {int(count)} -W 2 {safe_host} 2>&1 | tail -3
"""
    out = _wsl_run(script, timeout=30)
    ok = "0% packet loss" in out or ", 0% packet" in out
    return {"ok": ok, "log": out[-500:]}


@app.get("/p3/state")
def p3_state():
    """실스택 상태 요약."""
    script = (
        "pgrep -x nr-gnb >/dev/null && echo GNB_UP || echo GNB_DOWN; "
        "pgrep -x nr-ue >/dev/null && echo UE_UP || echo UE_DOWN; "
        "grep -i 'registration is successful' /opt/dtsim/ue.log 2>/dev/null | tail -1; "
        "grep 'TUN interface' /opt/dtsim/ue.log 2>/dev/null | tail -1; "
        "grep -E \"supi: 'imsi\" /opt/dtsim/ue.yaml 2>/dev/null"
    )
    out = _wsl_run(script, timeout=30)
    return {
        "gnb": "GNB_UP" in out,
        "ue": "UE_UP" in out,
        "registered": "registration is successful" in out,
        "detail": out[-400:],
    }


@app.get("/p3/logs")
def p3_logs(src: str, offset: int = -1):
    """실스택 로그 tail. offset=-1이면 마지막 8KB부터 시작."""
    path = REAL_LOG_SOURCES.get(src)
    if not path:
        return {"error": "unknown source", "lines": [], "offset": 0}
    started = offset
    try:
        try:
            size = os.path.getsize(path)
            if offset < 0:
                offset = max(0, size - 8192)
            if offset > size:  # 로그 로테이션/재시작
                offset = 0
            with open(path, "rb") as f:
                f.seek(offset)
                data = f.read(MAX_CHUNK)
            new_offset = offset + len(data)
        except PermissionError:
            data, new_offset = _wsl_read(src, started)
            offset = started if started >= 0 else max(0, new_offset - len(data))
        text = data.decode("utf-8", errors="replace")
        lines = [ln for ln in text.split("\n") if ln.strip()]
        if offset > 0 and lines and not data.startswith(b"\n"):
            lines = lines[1:] if len(lines) > 1 else lines
        return {"lines": lines[-200:], "offset": new_offset}
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        return {"error": str(e), "lines": [], "offset": 0}


# ============================================================================
# 프론트엔드(dist) 정적 서빙 — 이 블록은 모든 API 라우트 "뒤에" 등록되어야
# API 경로(/simulate, /probe, /p3/* 등)가 SPA 폴백보다 우선 매칭된다.
# dist가 아직 없으면(빌드 전) 크래시하지 않고 안내 메시지만 출력한다.
# ============================================================================
if DIST_DIR.is_dir() and (DIST_DIR / "index.html").is_file():
    _assets = DIST_DIR / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA 폴백: 실제 정적 파일이 있으면 그 파일을, 없으면 index.html을 반환.

        (경로 탈출 방지: 요청 경로를 resolve 후 dist 내부인지 검증)
        """
        if full_path:
            candidate = (DIST_DIR / full_path).resolve()
            if candidate.is_file() and (
                candidate == DIST_DIR or DIST_DIR in candidate.parents
            ):
                return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")

else:
    print(
        "\n[안내] frontend\\dist 가 없습니다 — UI 없이 API만 제공됩니다.\n"
        "       UI까지 함께 서빙하려면 먼저 프론트엔드를 빌드하세요:\n"
        "         cd frontend && npm run build\n"
        "       (개발 중에는 'npm run dev'로 5173 포트에서 UI를 띄워도 됩니다.)\n"
        "[note] frontend\\dist not found — serving API only. "
        "Run 'npm run build' in frontend to serve the UI here.\n"
    )

# Meta 5G

An interactive **5G/LTE network simulator** that runs in your browser: build a 3D space, place radios (gNB/eNB) and 5G core functions, *see* the otherwise-invisible radio coverage, and walk through it as a phone (UE) to watch signaling, calls, and handovers happen in real time.

- Place **RUs (gNB/eNB)**, logical **5GC network functions**, **DN** servers, and furniture/obstacles anywhere in a 3D space.
- Visualize RF as a **gradient volume** (red = strong → blue = weak → transparent = dead zone) or a horizontal slice heatmap.
- Tune frequency, power, antenna, bandwidth, SCS, and dozens of RAN/Core parameters — the field **recomputes instantly**.
- **First-person walk mode** drive test: live RSRP/RSRQ/SINR/CQI, traffic generation, A3 handover, RLF.
- Full **call-flow engine**: attach, service request, paging, handover, roaming, **VoNR voice calls**, and 350+ 3GPP scenarios with pass/fail verification.
- **RAN management** (CU/DU/RU hierarchy, fronthaul links) and **Core management** (NF replicas, HA, K8s HPA, geo-redundancy).
- E2E reachability judgment (UE↔RU↔AMF↔SMF↔UPF↔DN) + per-NF event logs and an NMS dashboard.

Everything runs **locally on your PC** — a benign, self-contained simulator (no external services).

---

## Quick start (Windows)

**No prerequisites.** Just double-click **`start.bat`**.

- On first run it automatically installs Python and the dependencies — this takes a few minutes and needs an internet connection.
- When ready, your browser opens **`http://localhost:8000`** automatically.
- **To stop:** close the black console window — that window *is* the server.

> Only one window opens; keep it open while you use the app.

### Troubleshooting

| Symptom | Fix |
|---|---|
| First launch is slow / looks stuck | The first run installs packages — it can take **several minutes**. Don't close the window; wait. |
| Browser doesn't open | Wait a moment, then open `http://localhost:8000` manually. |
| "Port already in use" / blank page | Another program may be using port 8000. Close it (or reboot) and re-run. |
| Antivirus / firewall prompt | This app runs only on your local machine. Choose "Allow / Run". |
| UI loads but nothing computes | Make sure the server console window is still open — closing it stops the backend. |

---

## Architecture

```
backend/   Python FastAPI — RF physics (numpy) + serves the built UI on the same port
frontend/  React 19 + TypeScript + Three.js (@react-three/fiber) — 3D scene / editor / volume rendering
start.bat  one-click launcher (auto-installs Python + deps on first run)
```

A single backend serves **both the API and the UI on port 8000**.

## For developers

Node.js is required only if you want to change the UI and rebuild it:

```bat
cd frontend
npm install        REM first time only
npm run dev        REM dev mode (http://localhost:5173; run the backend separately via start.bat)
npm run build      REM production build -> updates frontend/dist
```

## Tech stack

React 19 · TypeScript · Three.js / @react-three/fiber / drei · zustand · Python · FastAPI · numpy.

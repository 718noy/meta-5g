@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Meta 5G
cd /d "%~dp0"

echo ============================================================
echo   Meta 5G - starting up...
echo   First run auto-installs Python + the runtime environment.
echo ============================================================
echo.

set "BACKEND=%~dp0backend"
set "VENVPY=%BACKEND%\.venv\Scripts\python.exe"

REM ===== Decide whether the venv must be built (goto-based; no paren blocks) =====
set "NEEDVENV="
if not exist "%VENVPY%" set "NEEDVENV=1"
if defined NEEDVENV goto :setup
"%VENVPY%" -c "import fastapi,uvicorn,numpy" >nul 2>nul
if errorlevel 1 set "NEEDVENV=1"
if defined NEEDVENV goto :setup
goto :run


:setup
echo [setup] First run - preparing the environment. This can take a few minutes.
echo.

REM ---- 1) Ensure Python (auto-install if missing: winget then official installer) ----
set "PY="
set "PYOUT=%TEMP%\dt_pyexe.txt"
del "%PYOUT%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure_python.ps1" -OutFile "%PYOUT%"
if exist "%PYOUT%" set /p PY=<"%PYOUT%"
if not defined PY goto :nopy
echo [ok] Python: !PY!
echo.

REM ---- 2) Create the virtual environment ----
if exist "%BACKEND%\.venv" rmdir /s /q "%BACKEND%\.venv"
echo [setup] creating virtual environment...
"!PY!" -m venv "%BACKEND%\.venv"
if errorlevel 1 goto :venvfail

REM ---- 3) Install runtime packages ----
echo [setup] installing packages (fastapi/uvicorn/numpy)...
"%VENVPY%" -m pip install --upgrade --disable-pip-version-check -q pip >nul 2>nul
"%VENVPY%" -m pip install --disable-pip-version-check -q -r "%BACKEND%\requirements.txt"
if errorlevel 1 goto :pipfail
echo [done] environment ready.
echo.

REM Prepare only, without launching the server (testing / pre-setup): set DT_SETUP_ONLY=1
if defined DT_SETUP_ONLY goto :setuponly
goto :run


:run
if not exist "%~dp0frontend\dist\index.html" echo [note] frontend\dist not found - serving API only. Run 'npm run build' in frontend to build the UI.

REM Open the browser once the server answers (background helper)
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-RestMethod http://localhost:8000/health -TimeoutSec 1 ^| Out-Null; Start-Process 'http://localhost:8000'; break}catch{Start-Sleep -Milliseconds 500}}"

echo Server starting... close this window to stop it.
echo URL: http://localhost:8000
echo.
cd /d "%BACKEND%"
"%VENVPY%" -m uvicorn main:app --port 8000
echo.
echo Server stopped.
goto :end


:nopy
echo.
echo [error] Could not obtain Python.
echo         Check your internet connection and re-run, or install Python 3.10+
echo         from https://python.org (tick "Add python.exe to PATH"), then re-run.
goto :fail

:venvfail
echo [error] Failed to create the virtual environment.
goto :fail

:pipfail
echo [error] Package install failed. Check your internet connection.
goto :fail

:setuponly
echo [done] Setup-only finished (server not started).
goto :end

:fail
echo.
pause
endlocal
exit /b 1

:end
pause
endlocal

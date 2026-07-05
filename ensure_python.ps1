# ensure_python.ps1  [-OutFile <path>]
# Find a usable Python 3.10+, or auto-install one if none is present.
# On success: writes the resolved python.exe full path to -OutFile and exits 0.
# Progress messages go to the console (installation can take a few minutes).
param([string]$OutFile = "")
$ErrorActionPreference = 'SilentlyContinue'
$MinMajor = 3
$MinMinor = 10

function Emit($path) {
  if ($OutFile) {
    try { Set-Content -LiteralPath $OutFile -Value $path -Encoding ASCII } catch { }
  }
  Write-Host "PYTHON=$path"
}

function Test-Py($exe) {
  if (-not $exe) { return $false }
  # `--version` has no quotes/special chars, so it survives PowerShell -> native arg passing.
  # (Old Python prints to stderr, hence 2>&1; the Store stub won't match "Python 3.x".)
  $v = (& $exe --version 2>&1 | Select-Object -First 1 | Out-String)
  if ($v -notmatch 'Python\s+(\d+)\.(\d+)') { return $false }
  $maj = [int]$Matches[1]; $min = [int]$Matches[2]
  if ($maj -gt $MinMajor) { return $true }
  if ($maj -eq $MinMajor -and $min -ge $MinMinor) { return $true }
  return $false
}

function Find-Py {
  # 1) py launcher (registered by the official installer) -> resolve the real python.exe
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $exe = & py -3 -c "import sys;print(sys.executable)" 2>$null
    if (-not $exe) { $exe = & py -c "import sys;print(sys.executable)" 2>$null }
    $exe = ($exe | Select-Object -First 1)
    if ($exe) { $exe = "$exe".Trim() ; if (Test-Py $exe) { return $exe } }
  }
  # 2) python on PATH (skip the Windows Store execution-alias stub)
  foreach ($c in (Get-Command python -All -ErrorAction SilentlyContinue)) {
    if ($c.Source -and ($c.Source -notlike '*\WindowsApps\*') -and (Test-Py $c.Source)) { return $c.Source }
  }
  # 3) common install locations (in case PATH is not refreshed yet)
  $roots = @("$env:LocalAppData\Programs\Python", "$env:ProgramFiles\Python*", "${env:ProgramFiles(x86)}\Python*")
  foreach ($r in $roots) {
    foreach ($f in (Get-ChildItem -Path $r -Filter python.exe -Recurse -ErrorAction SilentlyContinue)) {
      if (Test-Py $f.FullName) { return $f.FullName }
    }
  }
  return $null
}

# -- 0) Already available? use it --------------------------------
$found = Find-Py
if ($found) { Write-Host "[ok] Found Python: $found" ; Emit $found ; exit 0 }

Write-Host ""
Write-Host "[setup] Python 3.10+ not found - installing automatically..."

# -- 1) Prefer winget (built into Windows 10 1809+/11) -----------
if (Get-Command winget -ErrorAction SilentlyContinue) {
  Write-Host "[setup] installing Python 3.12 via winget (a few minutes)..."
  & winget install -e --id Python.Python.3.12 --silent --scope user `
      --accept-package-agreements --accept-source-agreements 2>&1 | Out-Host
  Start-Sleep -Seconds 3
  $found = Find-Py
  if ($found) { Write-Host "[ok] winget install succeeded: $found" ; Emit $found ; exit 0 }
  Write-Host "[info] winget install not detected - retrying with the official installer."
}

# -- 2) Fallback: official python.org installer, silent per-user --
$ver  = "3.12.7"
$url  = "https://www.python.org/ftp/python/$ver/python-$ver-amd64.exe"
$inst = Join-Path $env:TEMP "python-$ver-amd64.exe"
Write-Host "[download] $url"
try { Invoke-WebRequest -Uri $url -OutFile $inst -UseBasicParsing } catch { }
if (-not (Test-Path $inst)) { & curl.exe -L -s -o "$inst" "$url" 2>&1 | Out-Host }
if (-not (Test-Path $inst)) {
  Write-Host "[error] installer download failed - check your internet connection."
  exit 1
}
Write-Host "[setup] installing silently (current user, adds to PATH)..."
# InstallAllUsers=0 -> no admin/UAC; PrependPath=1 -> PATH for future sessions
Start-Process -FilePath $inst -ArgumentList `
  '/quiet','InstallAllUsers=0','PrependPath=1','Include_test=0','Include_launcher=1','Include_pip=1' `
  -Wait
# PATH is not refreshed in the current session, so re-scan for the exe (up to ~60s)
$found = Find-Py
$tries = 0
while (-not $found -and $tries -lt 20) { Start-Sleep -Seconds 3; $found = Find-Py; $tries++ }
if ($found) { Write-Host "[ok] Python installed: $found" ; Emit $found ; exit 0 }

Write-Host "[error] automatic Python install failed."
Write-Host "        Install it from https://python.org (tick 'Add to PATH'), then re-run."
exit 1

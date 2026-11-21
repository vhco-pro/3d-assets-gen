# Runs at logon (scheduled task AssetStudio-Logon): starts Docker Desktop, waits up to three minutes for
# the engine, and brings Asset Studio back from current.json, pulling its image by digest when missing.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'AssetStudio'
$log = Join-Path $dir 'logon.log'
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -Path $log }
$exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if (-not (docker desktop status 2>$null | Select-String -Quiet 'running')) { Start-Process $exe }
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
  docker version --format '{{.Server.Version}}' *> $null
  if ($LASTEXITCODE -eq 0) { break }
  if ((Get-Date) -gt $deadline) { Log 'FAIL Failed: Docker engine did not answer within 3 minutes'; exit 1 }
  Start-Sleep -Seconds 3
}
$current = Join-Path $dir 'current.json'
if (-not (Test-Path $current)) { Log 'SKIP Skipped: no current.json yet'; exit 0 }
$c = Get-Content $current -Raw | ConvertFrom-Json
docker image inspect $c.tag *> $null
if ($LASTEXITCODE -ne 0) {
  docker pull "ghcr.io/vhco-pro/3d-assets-gen@$($c.digest)"
  if ($LASTEXITCODE -ne 0) { Log "FAIL Failed: could not pull $($c.digest)"; exit 1 }
  docker tag "ghcr.io/vhco-pro/3d-assets-gen@$($c.digest)" $c.tag
}
"ASSET_STUDIO_IMAGE=$($c.tag)" | Set-Content -Path (Join-Path $dir '.env') -Encoding ascii
docker compose --project-directory $dir -f (Join-Path $dir 'compose.yaml') up -d
if ($LASTEXITCODE -ne 0) { Log 'FAIL Failed: docker compose up'; exit 1 }
Log "OK Passed: Asset Studio $($c.version) started"

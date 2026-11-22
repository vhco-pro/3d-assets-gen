# Prints one JSON line describing the deployment, for check-upgrade.sh: the config file's SHA-256 (never
# its content), current.json, previous.json, the .env image, a digest of the job IDs and /api/health.
$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:LOCALAPPDATA 'AssetStudio'
$read = { param($name) $p = Join-Path $dir $name; if (Test-Path $p) { (Get-Content $p -Raw | ConvertFrom-Json).version } else { '' } }
$token = ((Get-Content (Join-Path $dir 'config.yaml') | Select-String '^token:').ToString() -split '\s+')[1]
$jobs = ''
try {
  $ids = (Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/jobs' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 10).jobs | ForEach-Object { $_.id } | Sort-Object
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($ids -join ','))
  $jobs = "$(@($ids).Count):" + ([BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)) -replace '-', '').Substring(0, 16)
} catch { }
$health = try { Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -TimeoutSec 10 } catch { $null }
[ordered]@{
  config = (Get-FileHash (Join-Path $dir 'config.yaml')).Hash
  current = & $read 'current.json'
  previous = & $read 'previous.json'
  env = ((Get-Content (Join-Path $dir '.env')) -replace '^ASSET_STUDIO_IMAGE=', '') -join ''
  jobs = $jobs
  health = if ($health) { "$($health.version) $($health.commit)" } else { '' }
} | ConvertTo-Json -Compress

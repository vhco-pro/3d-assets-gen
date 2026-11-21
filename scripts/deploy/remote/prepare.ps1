# Prepares %LOCALAPPDATA%\AssetStudio for a version: folders, config.yaml (new token only when none exists,
# or with -RotateToken), current.json, the previous-version record (only when the version changes), .env
# and the AssetStudio-Logon task. compose.yaml and start-asset-studio.ps1 were copied beside this script.
param([Parameter(Mandatory)][string]$Version, [Parameter(Mandatory)][string]$Tag, [Parameter(Mandatory)][string]$Digest, [switch]$RotateToken)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'AssetStudio'
$shared = Join-Path $env:LOCALAPPDATA 'Comfy-Desktop\ComfyUI-Shared'
foreach ($d in @($dir, (Join-Path $shared 'input\asset-studio'), (Join-Path $shared 'output\asset-studio'))) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
$config = Join-Path $dir 'config.yaml'
if ($RotateToken -or -not (Test-Path $config)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  "token: $token" | Set-Content -Path $config -Encoding ascii
  Write-Output ($(if ($RotateToken) { 'rotated the access token' } else { 'created config.yaml with a new access token' }))
}
$current = Join-Path $dir 'current.json'
$previous = Join-Path $dir 'previous.json'
if (Test-Path $current) {
  $old = Get-Content $current -Raw | ConvertFrom-Json
  if ($old.version -ne $Version) { Copy-Item $current $previous -Force; Write-Output "recorded $($old.version) as the previous version" }
}
@{ version = $Version; tag = $Tag; digest = $Digest } | ConvertTo-Json | Set-Content -Path $current -Encoding ascii
"ASSET_STUDIO_IMAGE=$Tag" | Set-Content -Path (Join-Path $dir '.env') -Encoding ascii
$logon = 'AssetStudio-Logon'
if (-not (Get-ScheduledTask -TaskName $logon -ErrorAction SilentlyContinue)) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $dir 'start-asset-studio.ps1')`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User (whoami)
  $principal = New-ScheduledTaskPrincipal -UserId (whoami) -LogonType Interactive
  Register-ScheduledTask -TaskName $logon -Action $action -Trigger $trigger -Principal $principal | Out-Null
  Write-Output 'registered AssetStudio-Logon'
}

# Registers AssetStudio-Docker (interactive principal, starts Docker Desktop) when missing, runs it when
# Docker Desktop is not running, and waits up to three minutes for the engine. Exit 3 when it never answers.
# Windows PowerShell turns a native command's stderr into a terminating error under 'Stop', so the
# docker calls run under 'Continue' and are checked through $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$name = 'AssetStudio-Docker'
if (-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)) {
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  $action = New-ScheduledTaskAction -Execute $exe
  $principal = New-ScheduledTaskPrincipal -UserId (whoami) -LogonType Interactive
  Register-ScheduledTask -TaskName $name -Action $action -Principal $principal | Out-Null
  Write-Output 'registered AssetStudio-Docker'
}
if (-not (docker desktop status 2>$null | Select-String -Quiet 'running')) {
  Start-ScheduledTask -TaskName $name
  Write-Output 'started Docker Desktop'
}
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
  docker version --format '{{.Server.Version}}' *> $null
  if ($LASTEXITCODE -eq 0) { exit 0 }
  if ((Get-Date) -gt $deadline) { exit 3 }
  Start-Sleep -Seconds 3
}

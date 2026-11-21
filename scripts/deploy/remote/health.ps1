# Waits up to three minutes for /api/health to report the expected version and commit, then makes sure
# tailscale serve forwards HTTPS 443 to it. Exit 4 when health never matches.
param([Parameter(Mandatory)][string]$Version, [Parameter(Mandatory)][string]$Commit)
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -TimeoutSec 5
    if ($h.version -eq $Version -and $h.commit -eq $Commit) { break }
  } catch { }
  if ((Get-Date) -gt $deadline) { exit 4 }
  Start-Sleep -Seconds 3
}
$serve = (tailscale serve status 2>&1) -join "`n"
if ($serve -match '127\.0\.0\.1:8790') { Write-Output 'tailscale serve already forwards to 127.0.0.1:8790'; exit 0 }
tailscale serve --bg --https=443 http://127.0.0.1:8790
exit $LASTEXITCODE

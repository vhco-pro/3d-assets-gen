# The AC-15 logon recovery setup: stops the Compose project, removes the current image, confirms it is
# gone and starts the AssetStudio-Logon task. Exit 7 when the image is still present afterwards.
param([Parameter(Mandatory)][string]$Tag)
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $env:LOCALAPPDATA 'AssetStudio')
docker compose down 2>&1 | Out-Null
docker image rm $Tag 2>&1 | Out-Null
docker image inspect $Tag 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { exit 7 }
Write-Output "image absent: $Tag"
schtasks /run /tn AssetStudio-Logon | Out-Null
exit $LASTEXITCODE

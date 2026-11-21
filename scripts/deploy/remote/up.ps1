# Brings the Compose project up on the tag in .env.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'AssetStudio'
docker compose --project-directory $dir -f (Join-Path $dir 'compose.yaml') up -d --remove-orphans
exit $LASTEXITCODE

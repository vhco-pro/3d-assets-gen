# Brings the Compose project up on the tag in .env.
# Windows PowerShell turns a native command's stderr into a terminating error under 'Stop', so the
# docker calls run under 'Continue' and are checked through $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:LOCALAPPDATA 'AssetStudio'
docker compose --project-directory $dir -f (Join-Path $dir 'compose.yaml') up -d --remove-orphans
exit $LASTEXITCODE

# Rolls back to previous.json: stops the project, restores the matching backup across a schema change,
# rewrites current.json and .env, clears the previous record and brings the project up.
# Exit 5 without a previous version, 6 without a matching backup.
# Windows PowerShell turns a native command's stderr into a terminating error under 'Stop', so the
# docker calls run under 'Continue' and are checked through $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:LOCALAPPDATA 'AssetStudio'
$previousFile = Join-Path $dir 'previous.json'
if (-not (Test-Path $previousFile)) { exit 5 }
$prev = Get-Content $previousFile -Raw | ConvertFrom-Json
$cur = Get-Content (Join-Path $dir 'current.json') -Raw | ConvertFrom-Json
docker compose --project-directory $dir -f (Join-Path $dir 'compose.yaml') down
$curSchema = (docker run --rm $cur.tag schema-version).Trim()
$prevSchema = (docker run --rm $prev.tag schema-version).Trim()
if ($curSchema -ne $prevSchema) {
  $volume = 'asset-studio_data'
  $backup = (docker run --rm -v "${volume}:/data:ro" alpine:3.22 sh -c "ls -1 /data/backup/schema-$prevSchema-*.sqlite 2>/dev/null | sort -t- -k3 -n | tail -1").Trim()
  if (-not $backup) { exit 6 }
  "token: restore-only-not-a-real-token-0000000000000000000" | Set-Content -Path (Join-Path $dir 'restore.yaml') -Encoding ascii
  docker run --rm -v "${volume}:/data" -v "$(Join-Path $dir 'restore.yaml'):/config/config.yaml:ro" $prev.tag restore-backup $backup --config /config/config.yaml
  if ($LASTEXITCODE -ne 0) { exit 7 }
  Remove-Item (Join-Path $dir 'restore.yaml')
  Write-Output "restored $backup"
}
Copy-Item $previousFile (Join-Path $dir 'current.json') -Force
Remove-Item $previousFile
"ASSET_STUDIO_IMAGE=$($prev.tag)" | Set-Content -Path (Join-Path $dir '.env') -Encoding ascii
docker compose --project-directory $dir -f (Join-Path $dir 'compose.yaml') up -d
exit $LASTEXITCODE

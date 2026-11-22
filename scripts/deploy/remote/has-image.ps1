param([Parameter(Mandatory)][string]$Tag)
docker image inspect $Tag *> $null
exit $LASTEXITCODE

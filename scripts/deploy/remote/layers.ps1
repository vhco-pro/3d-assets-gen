param([Parameter(Mandatory)][string]$Tag)
docker image inspect --format '{{json .RootFS.Layers}}' $Tag
exit $LASTEXITCODE

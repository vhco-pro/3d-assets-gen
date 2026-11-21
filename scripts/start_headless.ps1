# Starts the ComfyUI server with no UI, using the same install, models, input and output folders as Comfy Desktop.
# Close Comfy Desktop first (it uses the same port), or pass -Port to run on another one.
# -ModelPathsConfig defaults to the first instance file Comfy Desktop keeps under %APPDATA%.
param(
    [int]$Port = 8188,
    [string]$ModelPathsConfig = ""
)

$root   = Join-Path $env:LOCALAPPDATA "Comfy-Desktop\ComfyUI-Installs\ComfyUI"
$shared = Join-Path $env:LOCALAPPDATA "Comfy-Desktop\ComfyUI-Shared"
if (-not $ModelPathsConfig) {
    $ModelPathsConfig = (Get-ChildItem (Join-Path $env:APPDATA "Comfy Desktop\instance-model-paths") -Filter *.yaml |
        Select-Object -First 1).FullName
}

Set-Location $root
& "$root\ComfyUI\.venv\Scripts\python.exe" -s ComfyUI\main.py `
    --listen 127.0.0.1 --port $Port --disable-auto-launch `
    --extra-model-paths-config "$ModelPathsConfig" `
    --input-directory "$shared\input" --output-directory "$shared\output"

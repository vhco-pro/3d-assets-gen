# 3d-assets-gen handoff

Goal: a private web app so a friend can generate game-ready 3D assets on demand on the owner's
GPU. Repo to create: `vhco-pro/3d-assets-gen` (public). Build it with the vh-adlc plugin.

## What exists today

`scripts/generate_3d.py` works headless against a ComfyUI server and was tested end to end:
prompt -> 2D image (Z-Image Turbo) -> 3D GLB (TRELLIS.2 by default, Hunyuan3D 2.1 optional).
It only uses the Python standard library and talks to ComfyUI's HTTP API
(`/prompt`, `/history/<id>`, `/view`, `/upload/image`). The workflows are built inline as
ComfyUI API-format graphs.

`scripts/start_headless.ps1` starts ComfyUI with no UI on the Windows PC (same install, models
and folders as Comfy Desktop).

Options: `--image` (skip 2D step), `--engine trellis|hunyuan`, `--faces` (triangle target,
default 10000), `--tex` (texture size, default 2048), `--seed`, `--size`, `--octree`
(hunyuan detail), `--no-style`, `--out`, `--server`.

## The GPU machine

- Windows 11 PC `win-main`, RTX 4070 Ti SUPER 16 GB, 32 GB RAM.
- Comfy Desktop, ComfyUI 0.46.2, Python 3.13, torch 2.12.1+cu130. Server on `127.0.0.1:8188`
  (localhost only; it would need `--listen` to be reachable from another machine).
- Models in `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models`:
  Z-Image Turbo, Hunyuan3D 2.1, TRELLIS.2 (int8), BiRefNet, DINOv3, TRELLIS.2 shape/texture
  VAEs, plus MoGe and Pixal3D (downloaded, not used by the script yet).
- ComfyUI-3D-Pack was rejected: its prebuilt wheels stop at Python 3.12 / torch 2.7 and its
  installer would downgrade torch and break this install. Everything uses native ComfyUI nodes.

## Measured on the 4070 Ti SUPER

| Asset | Engine | Triangles | 3D step | Notes |
| --- | --- | --- | --- | --- |
| Treasure chest | Hunyuan3D raw | 467k | 59 s | untextured, before cleanup existed |
| Pistol | Hunyuan3D + remesh/decimate | 9,976 | 154 s | raw was 985k, cleanup 3 s |
| Pistol | TRELLIS.2 | 10,000 | 179 s | color + ORM + normal maps, 2048² |
| Monstera | TRELLIS.2 | 19,978 | 160 s | thin leaves with holes |

Image generation takes about 20 s. The GPU runs one job at a time, so the web app needs a queue.

## Open decisions for the owner

1. Where the web app server runs: on `win-main` next to ComfyUI, or on `fedora-43` calling
   ComfyUI over Tailscale (then ComfyUI must listen on its Tailscale IP).
2. How the friend gets private access: Tailscale node share, Cloudflare Tunnel + Access, or an
   app-level token with exposure decided later.

## Web app ideas discussed

Prompt or image upload, progress while queued and generating, 3D preview of the textured result
in the browser, `.glb` download. Previews were built with three.js r128 (MeshStandardMaterial with
the baked color / ORM / normal maps, `flipY = false`, normal Y flipped since no tangents are used).

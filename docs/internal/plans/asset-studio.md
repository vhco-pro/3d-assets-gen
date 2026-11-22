---
status: draft
status_description: "Revising: VH Midnight restyle of the page and TRELLIS.2 as the only engine; waiting for spec review."
issue: https://github.com/vhco-pro/3d-assets-gen/issues/2
branch: feat/asset-studio
goal: "A friend opens a private tailnet URL, queues a batch of prompts or images, and downloads the finished game-ready GLB assets in bulk."
covers:
  - app/
  - package.json
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - tsconfig.*.json
  - vite.config.ts
  - eslint.config.js
  - playwright.config.ts
  - Dockerfile
  - .dockerignore
  - renovate.json
  - LICENSE
  - scripts/generate_3d.py
  - README.md
  - AGENTS.md
  - scripts/deploy/
  - scripts/ci/
  - scripts/verify.sh
  - dev/
  - .gitignore
  - .github/
---

# Plan: Asset Studio

A small TypeScript web app, shipped as a container on the owner's GPU PC, that queues batches of 3D
asset jobs in ComfyUI, shows their progress and a 3D preview, and lets a token holder download the
results to import into their own projects.

## Context

### Owner summary

`scripts/generate_3d.py` already turns a prompt into a textured, decimated GLB, but only from a terminal
on the GPU machine. This feature puts a web page in front of the same pipeline so a friend can queue
many assets at once and pull them into their own engine or modelling tool.

The app is TypeScript on Bun, packaged as a distroless Linux container without OpenSSL that runs under
Docker Desktop on `win-main` beside the native ComfyUI. Each job is one combined ComfyUI graph (prompt to image to mesh,
or uploaded image to mesh), and ComfyUI's own queue runs the jobs in order. Every mesh comes from
TRELLIS.2, textured; the owner dropped Hunyuan3D because its results were clearly worse. Combined prompts
were run on `win-main` during this spec at 10k and 20k triangles with 2048 textures, and all of them fit
the 16 GB card. The app gives every submission
attempt its own prompt ID and output prefix, keeps a small job record, collects finished files, cleans
its own files out of ComfyUI's folders, and resubmits jobs ComfyUI lost. Cancelling uses ComfyUI's
per-job cancel, so it never stops other ComfyUI work. The app needs ComfyUI 0.46.2 or newer and stops
submitting with a clear banner otherwise. Rewriting the client in Go would not make generation faster:
the time goes to the GPU, inside ComfyUI's PyTorch models (see Background).

The friend reaches the app through a Tailscale node share of `win-main` and `tailscale serve` HTTPS, and
signs in with a shared access token; the server accepts a session cookie for 30 days after sign-in. The token lives only in
`config.yaml` on `win-main`; the owner reads it over SSH and passes it on, and a deploy flag rotates it.
ComfyUI and the container's port stay on localhost. Like Comfy Desktop, the app runs only while the owner
is signed in on `win-main`. The form offers presets (5k/10k/20k
triangles, 1024 or 2048 textures, 1 to 4 variants, the style suffix and an optional seed). The page uses
the owner's VH Midnight style: a deep-blue gradient, pale text, translucent surfaces and a solid green
Generate button. On a desktop a composer column sits beside the queue and a thumbnail gallery, and the
3D preview opens in a dialog; on a phone everything stacks in one column. A batch holds
at most 25 jobs and 200 MiB of images, and the app allows at most 100 unfinished jobs, enforced inside
one database transaction. Uploads stream to disk and export zips stream to the browser, so the container
stays inside its 1 GiB memory limit. Downloads are a GLB per asset or a zip of up to 100 assets and
2 GiB with source images and a `manifest.json`.

Out of scope: user accounts, engine-specific exporters, other file formats, a sync client, mesh editing,
public exposure and changes to the ComfyUI install. Delivery ends at a working tailnet URL. Sharing the
node with the friend and limiting `autogroup:shared` to port 443 in the tailnet ACL are the owner's
steps in the Tailscale admin console, and the README gives a checklist for them.

Observed before this revision: v0.1.0 passed `bun run verify` in CI, two real generations and the
upgrade, rollback and logon-recovery script on `win-main`, and an independent implementation review (R-13)
that met every criterion except the Renovate one, which waits for the owner to add the repository to the
`vhco-renovate` installation.

Changed in this revision, at the owner's request: the page is restyled in VH Midnight with the layout
above; TRELLIS.2 is the only engine, so the Engine field, the Hunyuan3D builder and its golden graphs
leave the app (`scripts/generate_3d.py` keeps its Hunyuan3D path as reference); at every start the server
cancels any Hunyuan3D prompt still queued or running in ComfyUI, then deletes Hunyuan3D jobs and their
files; the live check runs a second TRELLIS.2 job at 20k triangles and
1024 textures instead of a Hunyuan3D job; the shared conventions pin moves to `edd4c09`, which brings the
frontend design procedure, the interface colour guideline and a before-and-after screenshot record in
pull requests that change the page. This revision adds the new pin's quick workflow and check rules
(workflow permissions, a bash default shell, job timeouts, actionlint, a fail-closed installation check
and a recorded security-analysis coverage); its larger rules (tag-triggered, repeat-safe releases, 422
and RFC 3339 in the API, test waits, container labels and a PowerShell analyzer) are tracked in #3, and
the Renovate installation gap in #4. Prompts may now be up to 2000 characters; the gallery clips them to
two lines and the preview dialog shows the full text. This is an alpha: the owner accepts that a rollback across this
revision brings back no deleted Hunyuan3D jobs, and no check covers that. The existing upgrade and
rollback procedure (AC-15, `scripts/deploy/check-upgrade.sh`) still runs, between two prereleases of this
revision.

The repository becomes public `vhco-pro/3d-assets-gen` under Apache-2.0, after the local history was
scrubbed of `win-main`'s tailnet address, its Windows user name and its Windows paths. Two stored review
records keep the same `fedora-43` home path, which the owner accepted. It gets the organisation's
CodeQL and Scorecard workflows, a Renovate configuration, and the dependency graph, Dependabot alerts,
secret scanning, push protection and automatic branch deletion. Images are published to a GHCR package,
which is switched to public after the first publication (an irreversible GitHub setting the owner
approved), through the shared container release action with scanning, signing, SBOM and attestations. The
shared GitVersion workflow versions them in the same CI run and tags with the repository's own
`GITHUB_TOKEN`, so no App key is needed. Each version whose scan passed gets a GitHub Release holding its
image digest, which deploy and rollback read. A prerelease image from the feature branch is deployed for the
live checks before the implementation review; the release image from `main` is deployed after merge.

Acceptance of this revision authorizes building it on `feat/asset-studio`, opening its PR, pushing the
before-and-after captures to `refs/pr-visuals/<PR number>`, publishing prerelease and release images to
the public GHCR package, merging the PR once CI and an independent implementation review pass, and
deploying prereleases and the release to `win-main`, where the two scheduled tasks from the first
release stay as they are. After the owner adds the repository to the `vhco-renovate` installation (#4),
it also authorizes re-adding the repository to `vhco-pro/renovate-runner`'s `config/targets.json`
through a PR merged with the owner's admin bypass, as the owner approved for PR #11, followed at once by
a dry run limited to this repository and a revert if that run fails. The installation change itself
stays the owner's step. It does not authorize changing tailnet ACLs, sharing the node, changing Docker
Desktop's or WSL's settings, or touching ComfyUI beyond creating the two `asset-studio` subfolders in its input and output
folders and deleting the app's own files there.

### Background

The pipeline is a pure HTTP client. `scripts/generate_3d.py:27-30` sends every request with
`urllib.request`, `scripts/generate_3d.py:33-39` queues a graph on `/prompt`, and
`scripts/generate_3d.py:42-53` polls `/history/<id>` once a second until the job finishes. The three
graphs are built at `scripts/generate_3d.py:87` (Z-Image Turbo image), `:104` (Hunyuan3D 2.1 mesh) and
`:136` (TRELLIS.2 textured mesh). The script runs the image graph, downloads the image, uploads it
again and runs a mesh graph as a second prompt (`scripts/generate_3d.py:221-236`). All model work
happens inside the ComfyUI server process.

The measured cost is GPU time. `HANDOFF.md:34-41` records 154 to 179 seconds for the 3D step and about
20 seconds for the image, and notes the GPU runs one job at a time. Python's share is a few HTTP calls
per job plus one poll per second, so moving the client to Go or Bun saves milliseconds on a
multi-minute job. A faster runtime for the models would mean leaving ComfyUI and PyTorch. No Go library
runs TRELLIS.2 or Hunyuan3D, and the handoff shows how easily the 3D stack breaks on version changes
(`HANDOFF.md:29-30`).

The GPU machine is `win-main`, with 16 GB of VRAM and 32 GB of RAM (`HANDOFF.md:23`), reached over
Tailscale (`HANDOFF.md:45-47`). ComfyUI keeps its inputs and outputs under the `ComfyUI-Shared` input and
output folders (`scripts/start_headless.ps1:10,20`). ComfyUI listens only on localhost (`scripts/start_headless.ps1:18`,
`HANDOFF.md:25`). Measured during this run, over `ssh win-main`:

- `Invoke-WebRequest http://127.0.0.1:8188/system_stats` returned `"comfyui_version": "0.46.2"`.
- The host has `node.exe 25.6.1`, `git.exe 2.46.0`, no Bun, Tailscale `1.104.4` with `No serve config`,
  and Docker Desktop (CLI plugin `v0.2.0`, engine `28.4.0`, `linux`) whose settings have `AutoStart`
  true. Docker Desktop was stopped when first checked; `wsl -l -v` listed `Ubuntu` and `docker-desktop`,
  both stopped.
- `curl` to `win-main`'s tailnet address on port 8188 from `fedora-43` got no answer, as expected for a
  localhost-only server.
- In the installed ComfyUI's `server.py` (under `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\`):
  `POST /prompt` takes an optional client-supplied `prompt_id` that must be a canonical lowercase UUID
  and otherwise answers 400 with `invalid_prompt_id` (lines 1180-1196);
  `POST /api/jobs/{job_id}/cancel` cancels one job whether pending or running, interrupts only if that
  job is still the one running, and answers `{"cancelled": false}` for a finished or unknown ID
  (lines 1063-1079); a bare `POST /interrupt` without a `prompt_id` interrupts whatever is running
  (lines 1287-1290).
- Combined prompts (the image graph plus a mesh graph rewired as Design describes, built from the
  Python builders and posted with a client `prompt_id` through an SSH tunnel) both succeeded, and
  ComfyUI used the client's prompt ID each time. TRELLIS.2 at 10k triangles and 2048 textures took
  405 seconds with a sampled peak of 14.32 GB VRAM of 15.99 GB; Hunyuan3D at 10k took 92 seconds with a
  sampled peak of 14.35 GB. Each wrote one PNG and one GLB under its `filename_prefix`. The test files
  were deleted afterwards.
- With Docker Desktop running, a container reached ComfyUI at `http://host.docker.internal:8188` and got
  the `system_stats` JSON; with `--network host`, `127.0.0.1:8188` was refused; a container port
  published on `127.0.0.1:18790` answered `Invoke-WebRequest` on the host.
- Over SSH, `docker run` of an image not present locally failed with `error getting credentials ...
  A specified logon session does not exist`, also with a separate `DOCKER_CONFIG`; `docker load` of a
  saved image worked.
- A second pair of combined prompts at 20k triangles also succeeded: TRELLIS.2 with 2048 textures took
  416 seconds with a sampled peak of 14.41 GB, and Hunyuan3D took 87 seconds with a sampled peak of
  14.93 GB. The test files were deleted afterwards.
- Inside a container reached through a port published on `127.0.0.1`, `netstat -tn` showed the peer as
  the gateway of the container's network: `172.17.0.1` on the default bridge (whose default route is
  `via 172.17.0.1`), and `172.18.0.1` on a user-defined network whose `docker network inspect` gateway
  was `172.18.0.1`.
- `docker save alpine:3.22 | ssh win-main docker load` printed `Loaded image: alpine:3.22`. The Docker
  Desktop instance started from SSH listed images such as `log-spector:test` and `test-image:latest`;
  after Docker Desktop was started in the owner's session, `docker image ls` listed only the
  `alpine:3.22` loaded into that instance, while `docker volume ls` still listed other projects' volumes
  such as `svelte-go-dating_postgres_data`. Whether images in the owner's instance survive a Docker
  Desktop restart was not tested, because restarting it would stop the owner's other containers.
- A container running as `--user 65532:65532 --read-only` with a `%LOCALAPPDATA%` folder bind-mounted at
  `/comfy/output` saw a file written by Windows as `-rwxrwxrwx` owned by UID 0, deleted it, and created and
  removed a file of its own; Windows then reported the file gone. The test folder was deleted
  afterwards.
- A temporary scheduled task with an interactive principal ran `docker pull
  ghcr.io/linuxcontainers/alpine:latest` in the owner's session and printed `Status: Downloaded newer
  image`, unlike the same pull over SSH. The image and the task were removed afterwards.
- During implementation, the first release run's Trivy scan (`HIGH,CRITICAL`, exit code 1) failed on an
  image built from `gcr.io/distroless/cc-debian13:nonroot`. A local scan with the same Trivy 0.69.3 found
  one finding, CVE-2026-124709 (HIGH) in `libssl3t64` 3.5.7-1~deb13u3, status affected, no fixed
  version. The same image rebuilt on `gcr.io/distroless/base-nossl-debian13:nonroot@sha256:89815d620ac01d8de13cdaf04d19ed874447ca2296d4985b14b818f6e5e47854`
  reported 0 HIGH or CRITICAL findings and passed the image start check (4 pass). `ldd` on the compiled
  executable lists only `libc`, `libpthread`, `libdl`, `libm` and the loader, so nothing needs OpenSSL.
- Headless Firefox (Playwright's build) could not create a WebGL context on `fedora-43` (`Exhausted GL
  driver options`) or in the CI run on `ubuntu-latest`, so the Firefox viewer render check skipped in
  both; Chromium rendered the fixture GLB in both. In the `mcr.microsoft.com/playwright:v1.65.1-noble`
  image, which ships Mesa, Playwright's Firefox 1.65.1 reported the WebGL renderer `llvmpipe, or similar`
  both headless and headed under `xvfb-run`.
- Docker Desktop started with `docker desktop start` from an SSH session stopped when that session
  ended. Started instead by a temporary scheduled task with an interactive principal (while the owner's
  console session was active), `docker desktop status` still reported `running` from a new SSH session
  90 seconds later. The task was removed afterwards.

The upload helper always declares `image/png` (`scripts/generate_3d.py:79`), whatever the file is. The
handoff lists the web features discussed: prompt or image upload, progress, a 3D preview and GLB
download (`HANDOFF.md:50-54`). Before this feature, `AGENTS.md:21` stated that no build or test commands existed yet.

Existing web front ends were checked before choosing to build. Open WebUI drives ComfyUI only for
images, through one static workflow mapped onto its prompt and size controls, and has no 3D output.
ViewComfy turns a workflow into a form for image, video and text outputs, is AGPL-3.0, and has no GLB
preview or export. ComfyUI Mini and ComfyBox are general workflow runners without 3D output handling.
See Sources.

## Scope

In scope:

- A Bun HTTP server, run in a container on `win-main`, that records jobs, submits each as one ComfyUI
  graph, tracks it through ComfyUI's queue and history, stores results, cleans up its own ComfyUI files
  and serves the API and the built web page.
- A TypeScript port of the image and TRELLIS.2 graph builders in `scripts/generate_3d.py`, and a
  combiner that joins the image graph, the TRELLIS.2 mesh graph and a thumbnail branch into one graph.
- A React page in the VH Midnight style to sign in with the access token, submit a batch of prompts
  (one per line) or images, watch queue progress, cancel or retry jobs, browse the library, preview a GLB
  in 3D and download one asset or a zip of a selection.
- Removal of Hunyuan3D from the app, including the deletion of existing Hunyuan3D jobs and their files.
- Reconciliation after an app restart and resubmission of jobs ComfyUI lost.
- A deterministic fake ComfyUI server for tests and the development fixture, an idempotent seed command
  and a Playwright suite.
- A distroless container image published to GHCR, a Compose file, and deploy and rollback scripts that
  install it on `win-main`, keep Docker Desktop running in the owner's session, configure
  `tailscale serve` and rotate the token.
- The public repository: an Apache-2.0 `LICENSE`, CI and release workflows, the organisation's CodeQL
  and Scorecard workflows, a `renovate.json`, and the repository settings for a public repository.
- A README (including the owner's node-share checklist) and the `AGENTS.md` "Local commands and
  constraints" section naming the bootstrap, seed, run, verify, deploy, rollback and clean commands, plus
  an `AGENTS.md` route to `conventions/terminal-output.md` for the repository's command-line tools.

Out of scope:

- User accounts or per-user quotas; one shared token gives full access.
- Engine-specific import plugins, FBX or OBJ conversion, and a sync client. The download is glTF
  binary, which Blender, Godot, Unity and Unreal import.
- Exposing octree resolution or image size, which stay at the script defaults (256 and 1024).
- Changing models, the ComfyUI install, Comfy Desktop's settings or `scripts/start_headless.ps1`.
- Changing Docker Desktop's or WSL's settings, including memory limits.
- Mesh editing, retexturing, or rerunning one stage of a finished job.
- Exposure outside the tailnet, changes to tailnet ACLs, node sharing, and checking access from the
  friend's device.
- Removing or changing `scripts/generate_3d.py`; it stays as the reference, Hunyuan3D path included.
- A light theme; VH Midnight is dark only.
- Keeping deleted Hunyuan3D jobs recoverable, and any rollback check across this revision.
- Changing the `vhco-renovate` App itself; the feature only adds this repository to its installation.
- Tagging through the `vhco-release-bot` App; the repository's own token tags instead.

## Design

### Runtime and layout

Bun runs the server, the tests and the build, as `conventions/coding.md` requires for new JavaScript
tooling. The code lives under `app/`:

- `app/server/` holds the HTTP server (`Bun.serve`), the job store, the tracker and the ComfyUI client.
- `app/memory/` holds the memory tests, which need the built image.
- `app/pipeline/` holds the graph builders, the combiner and the preset definitions.
- `app/web/` holds the React page and its `index.html`; it is the Vite root, configured by
  `vite.config.ts` at the repository root. The page uses TanStack Query for server state and the
  `@google/model-viewer` web component for the preview.
- `app/fake-comfy/` holds the fake ComfyUI server.
- `app/e2e/` holds the Playwright scenarios.

TypeScript runs in strict mode with type-aware ESLint, per `conventions/typescript.md`, and every rule
that `eslint-plugin-react-hooks` 7.1 recommends (among them `rules-of-hooks`, `exhaustive-deps`,
`purity`, `refs`, `set-state-in-render`, `immutability` and `static-components`) at error severity, per
`conventions/react.md`.
External input (HTTP bodies, ComfyUI responses, database rows, the configuration file) enters as
`unknown` and is validated at named parse functions. Sizes in this document use MiB (2^20 bytes).

### Pipeline port and combined graphs

`app/pipeline/graphs.ts` exports `imageGraph` and `trellisGraph`, pure functions that mirror
`image_graph` and `trellis_graph` node for node, including the `min(tex, 1024)` cap on the ambient
occlusion bake. The app has no Hunyuan3D builder; `mesh_graph` stays in the script only.
Their `prefix` input becomes each graph's `filename_prefix`, as in the script.

`combineGraph` builds the graph a job submits, with the prefix `asset-studio/<job id>/<attempt id>`:

- A prompt job takes the image graph unchanged (node IDs `1` to `10`) and the TRELLIS.2 graph with every node
  ID raised by 100. The mesh graph's `LoadImage` node is dropped, and every input that pointed to it
  points to the image graph's `VAEDecode` output (`["9", 0]`) instead. The image graph's `SaveImage`
  stays, so ComfyUI stores the source image too.
- An image job takes the TRELLIS.2 graph alone with IDs raised by 100; its `LoadImage` names the file the app
  uploaded for that job.
- Both kinds get a thumbnail branch: node `200` (`ImageScale`, `lanczos`, 256 by 256, `center` crop)
  takes the source image (`["9", 0]` or the `LoadImage` output) and node `201` (`SaveImage`) saves it
  with the prefix plus `/thumb`.

Because the prefix contains the attempt ID, every attempt's output nodes have inputs ComfyUI has not
seen before, so its output cache cannot skip writing them.

The combined prompt fits on `win-main`'s card at 10k and 20k triangles with 2048 textures (Background).
1024 textures and 5k triangles were not measured; both ask less of the card than the measured cases.
AC-11 runs 10k with 2048 textures and 20k with 1024 textures through the deployed app.

Presets map to builder inputs in `app/pipeline/presets.ts`:

| Form field | Values | Builder input |
| --- | --- | --- |
| Detail | 5k, 10k (default), 20k triangles | `faces` 5000, 10000 or 20000 |
| Texture | 1024, 2048 (default) | `tex` |
| Variants | 1 (default) to 4; prompt batches only | number of jobs per prompt |
| Game-asset style | on (default), off | appends the suffix at `scripts/generate_3d.py:23` |
| Seed | empty (random) or 0 to 4294967295 | variant k, counted from 0, uses seed + k modulo 2^32 |

Image size is fixed at 1024. With the seed field empty, one random seed
is drawn uniformly from 0 to 4294967295 for each prompt line or image, and variant k of that line uses
that seed + k modulo 2^32.

The graph test checks the builders against the Python script. A dump helper in `app/pipeline/` loads
`scripts/generate_3d.py` by path under `python3 -I` and prints each builder's graph as JSON for a fixed
set of inputs, including a prefix of the `asset-studio/<job id>/<attempt id>` form. The committed golden
files come from it, so the test also runs where Python is absent, and `bun run golden:check`
regenerates and compares them. The combiner test asserts the rewiring rules and the thumbnail branch on
the same golden graphs.

### ComfyUI client

`app/server/comfy.ts` covers `/system_stats`, `POST /prompt` with a client-supplied `prompt_id`,
`/queue` (read), `/history/<id>`, `POST /api/jobs/<prompt id>/cancel`, `/view` and `/upload/image`. The
client never calls `/interrupt`. Upload sends the file's real content type, the subfolder
`asset-studio` and the name `<job id>.<ext>`, so two jobs never overwrite each other's input. Every call
has a 10-second timeout. Errors are typed in three kinds: unreachable (connection failure or timeout),
server error (5xx or an unparsable body) and rejected (4xx, carrying ComfyUI's `error` and
`node_errors` text). Errors on job-specific calls (`/prompt`, `/upload/image`, `/view`) count per job: a
job that gets three server errors in a row while `/system_stats` still answers becomes `failed` with the
last error text, so one bad job cannot hold up the queue. The count resets on any successful job call,
on retry and on every lost-job resubmission.

The app requires ComfyUI 0.46.2 or newer, the first version known to accept a client `prompt_id` and
to offer the per-job cancel. The tracker reads `/system_stats`, and with it `comfyui_version`, at the start
of every tick before any other step, so a version change is seen within one tick whether or not
ComfyUI was unreachable in between. While the
version is older or missing, the tracker runs none of its tick steps: it submits, reconciles, cancels and
times out nothing, so every job keeps its state. `/api/health` then reports ComfyUI as incompatible
together with the version it found (or none), and the page shows that in its banner. The banner's
Glossary term is its own element; the version and explanation follow in separate text.

### Jobs and batches

A batch is one submission: either prompts or images, plus one set of preset values. Each prompt line
becomes as many jobs as the variant count, and each image becomes one job. A batch may hold at most 25
jobs after this expansion and at most 200 MiB of image bytes in total, and a batch is refused when it
would take the number of unfinished (`pending` or `submitted`) jobs above 100. The three limits live in
the configuration file with these defaults.

A job has one of these states:

| State | Meaning |
| --- | --- |
| `pending` | Recorded by the app, not yet confirmed accepted by ComfyUI |
| `submitted` | Accepted by ComfyUI; queued or running there |
| `done` | GLB, source image and thumbnail stored by the app |
| `failed` | Stopped with an error message; can be retried |
| `cancelled` | Cancelled by the user; can be retried |

Jobs and batches are stored in SQLite through `bun:sqlite` in WAL mode under `/data`. A job row holds
its batch, preset values, seed, prompt text or upload name, the current attempt's prompt ID, the time
that attempt was last posted, the attempt count, the loss count, the consecutive server-error count, a
cancel-requested flag, a fixture flag, the error message, and the times it was created, first seen
running and finished. The row's engine column keeps its schema and always holds `trellis` for new
jobs. Files go to
`/data/assets/<job id>/` as `source.png` (or the upload's extension), `thumb.png` and `model.glb`.

The batch API's `presets` object no longer has an `engine` field. A request that still sends one is
accepted when it is `trellis` and refused with 400 and `Hunyuan3D is no longer available; use TRELLIS.2.`
for any other value, so a page loaded before the upgrade fails clearly. The status matches the API's other
validation answers; moving them all to 422, as `conventions/http-api.md` asks, is tracked in #3.

Job and batch IDs are canonical lowercase UUIDs. The app generates job IDs; fixture jobs use fixed UUIDs
and carry the fixture flag. Every `<id>` in an API path is checked against that form, and anything else
gets 404 before any database or filesystem access.

The tracker keeps the latest `/queue` snapshot in memory. `GET /api/jobs` reads queue positions and the
running job from that snapshot and never calls ComfyUI.

### Submission, concurrency and idempotency

`POST /api/batches` carries a client-generated batch ID in the `X-Batch-Id` header, which must be a
canonical lowercase UUID; any other value gets 400 before the handler reads the body or touches the
filesystem. The handler rejects a request whose `Content-Length` is above 201 MiB (the image cap plus
1 MiB for multipart headers and form fields) with 413 and the app's message, before reading the body.
A JSON prompt batch is limited to 1 MiB: a larger `Content-Length`, or a body that passes 1 MiB while
being read, gets 413 and the app's message. It parses a multipart body as a stream and writes each image part straight to disk, counting image
bytes, and stops with 413 and the same message as soon as they pass 200 MiB; it never holds a whole
image or body in memory. Bun's `maxRequestBodySize` is 256 MiB, above both checks. The page checks the
total image size before uploading.

The batch's content hash is SHA-256 over a canonical encoding of what the batch asks for: the kind, the
preset values, then each prompt line in order, or each image's file name and bytes in order. It does not depend on
the multipart boundary or field order, so a genuine retry of the same batch has the same hash.

When a batch row with that ID already exists, the handler answers before writing anything: 200 with the
existing batch when the hash matches, 409 with a message when it does not. Otherwise it writes the images
to its own `/data/staging/<batch id>-<random>/`, and then opens one `BEGIN IMMEDIATE` transaction that
checks the batch ID again, counts unfinished jobs, inserts the batch and all its jobs as `pending`, and,
still inside the transaction, renames the staging directory to `/data/uploads/<batch id>/`. SQLite
allows one such writer at a time, so two concurrent batches cannot both pass the limit check, and a
concurrent duplicate sees the first request's row inside its own transaction and answers 200 or 409 as
above. On any refusal, failure or duplicate, the handler deletes only its own staging directory, never
`/data/uploads/<batch id>/`. A batch over a limit gets 400, 409 or 413 with a message that names the
limit, and creates nothing.

A crash after the rename and before the commit leaves an uploads directory with no batch row. The sweep
(below) removes it.

One tracker loop in the server does all work that talks to ComfyUI's API. HTTP handlers insert rows,
set flags (cancel requested, retry) or delete finished jobs (see Cancel, retry and delete), so no two
requests talk to ComfyUI's queue at once. Every state change
is one SQL update guarded by the expected current state.

Each submission attempt has its own prompt ID, a fresh lowercase UUID. The tracker writes it to the row
before posting, so the app knows the ID of any prompt it may have created even if it crashes or times
out during the call.

Each tick, every two seconds, the tracker:

1. Handles cancel requests (see Cancel, retry and delete).
2. Submits `pending` jobs oldest first by creation time, then by their position in the batch (prompt
   line, then variant, or image order), which each job row stores:
   - A job with the cancel-requested flag set is never submitted; step 1 handles it.
   - A job without an attempt ID gets a new one, stored before anything is posted.
   - If the attempt ID is already in ComfyUI's queue or history, which happens when the app crashed or
     timed out after posting, the job becomes `submitted` without posting again.
   - If the attempt's recorded post time is less than 30 seconds ago and the attempt is in neither, the
     job waits for a later tick, so a post that timed out while ComfyUI was still accepting it is found
     before any repost.
   - Otherwise the tracker uploads the image for an image job, writes the post time to the row under the
     same state guard, then posts the combined graph with that `prompt_id` and marks the job `submitted`
     on success. The post time is written before every post, so the wait above also covers a post that
     timed out or a crash during the call.
   - A rejected answer from `/prompt` or `/upload/image` marks the job `failed` with ComfyUI's error
     text, and the tracker goes on to the next job. A server-error answer counts toward the job's limit
     of three (see ComfyUI client) and the tracker goes on to the next job. An unreachable answer leaves
     the job `pending` with its attempt ID and stops submitting for this tick.
3. Reads `/queue`, then the history of each `submitted` job, in that order. ComfyUI moves a finished
   prompt from the queue to the history, so reading the queue first means a job that finishes between
   the two reads is still found in the history. A job seen running for the first time gets its started
   time.
4. For a job whose attempt is in the history with a success status, collects the outputs (below). With
   an error or interrupted status it marks the job `failed` with ComfyUI's message.
5. For a job whose attempt is in neither, treats it as lost (ComfyUI restarted and dropped its queue or
   history): it clears the attempt ID, the started and finished times and the error message, returns
   the job to `pending` with the same seed and adds one to its loss count. A job whose ComfyUI output files can no longer be fetched is treated the same way.
   On its third loss the job becomes `failed` with a message saying ComfyUI lost it repeatedly. The
   next attempt has a new prompt ID and a new output prefix, so ComfyUI writes its files again.
6. Cancels, through the per-job cancel, any job without the fixture flag that has been running for more
   than 15 minutes since its started time. When the cancel answers `{"cancelled": true}`, the job
   becomes `failed` with a timeout message. When it answers `{"cancelled": false}`, the tracker reads the
   history again and collects a success or records the error, as a user cancel does. When the cancel call
   is unreachable or gets a server error, the job stays `submitted` and the timeout is tried again on a
   later tick.

When ComfyUI does not answer, the tracker keeps every job in its state, backs off up to 60 seconds
between attempts, and `/api/health` reports ComfyUI offline until it answers again.

Collecting outputs is idempotent. If `/data/assets/<job id>/` already holds the GLB, source image and
thumbnail, the tracker only runs the `done` update. Otherwise it deletes any partial final directory
and leftover collection directory for the job, and fills `/data/assets/.collect-<job id>-<attempt id>/`:
it downloads the GLB and thumbnail from ComfyUI, and the source image too for a prompt job; for an image
job it copies the source from `/data/uploads/<batch id>/`. It then renames that directory to
`/data/assets/<job id>/` in one step and runs the `done` update. After `done`, it deletes the job's files
from ComfyUI's folders (see Files in ComfyUI's folders).

A sweep runs at start and every ten minutes. It deletes, in ComfyUI's `asset-studio` folders, every
job directory and upload whose job is `done`, deleted or unknown to the database; in `/data/uploads/`,
every directory with no batch row; in `/data/assets/`, every job directory with no job row, apart from
collection directories; and every staging and collection directory not in use by a running request or
collection. The seed writes its rows before their files, and a collection writes into a directory for a
job whose row already exists, so the asset-directory rule never removes fresh files. It also deletes the ComfyUI output directory of every `failed` or `cancelled` job whose
prompt is in neither the queue nor running, so partial outputs of cancelled and timed-out jobs do not
stay behind. It checks and deletes uploads directories inside its own `BEGIN IMMEDIATE`
transaction, so it cannot run between a batch request's rename and that request's commit. A crash after the `done` update, a failed ComfyUI cleanup, or a rollback that
leaves outputs of prompts the restored app no longer knows is therefore cleaned up at the next sweep.

The tracker submits every pending job at once, so ComfyUI's queue sets the order: first submitted runs
first. If the owner uses Comfy Desktop at the same time, those prompts interleave with the app's jobs in
ComfyUI's order.

### Cancel, retry and delete

Cancel sets the cancel-requested flag. On the next tick the tracker acts on it:

- A `pending` job without an attempt ID becomes `cancelled` without contacting ComfyUI.
- A `pending` job with an attempt ID whose recorded post time is less than 30 seconds old keeps its
  flag until the attempt shows up in ComfyUI's queue or history (then it is cancelled as a `submitted`
  job below) or the 30 seconds pass.
- A `pending` job with an attempt ID whose post time is older than that gets `POST /api/jobs/<prompt id>/cancel`
  first, which is a no-op when ComfyUI does not know the ID, and then becomes `cancelled`.
- When the per-job cancel is unreachable or gets a server error, for a `pending` or a `submitted` job,
  the job keeps its state and its flag, and the tracker tries again on a later tick.
- For a `submitted` job, the tracker first checks the history. When the attempt already finished with
  success, the completion wins: the job is collected and becomes `done`, and the flag is cleared.
  Otherwise the tracker calls the per-job cancel, which removes a pending prompt or interrupts it only
  while it is still the one running. When the cancel answers `{"cancelled": true}`, the job becomes
  `cancelled`. When it answers `{"cancelled": false}`, the prompt finished in between: the tracker reads
  the history again, collects a success and marks the job `done`, or marks an error `failed`.

Whenever the tracker marks a job `cancelled`, it clears the cancel-requested flag in the same update.

Retry returns a `failed` or `cancelled` job to `pending` with the same preset values and seed, clears
its attempt ID, loss count, server-error count, cancel-requested flag, started and finished times and
error message, and adds one to its attempt count. The timeout of the new attempt therefore counts from
when that attempt is first seen running. It runs in the same kind of
transaction as a batch insert and is refused with a message when the unfinished-job limit is reached.

Delete runs in the request handler, since it does not call ComfyUI's API. In one update guarded by the
job being `done`, `failed` or `cancelled`, it removes the job's row, and then deletes its
`/data/assets/<job id>/` directory and its files in ComfyUI's folders if any remain. It answers 204, and
a later `GET` of the job answers 404. A file it fails to delete is left for the sweep. It removes `/data/uploads/<batch id>/` when the batch's
last job is deleted. The data directory is a Linux volume, so deleting a file that a download is still
streaming lets the download finish.

### Files in ComfyUI's folders

With the prefix `asset-studio/<job id>/<attempt id>`, ComfyUI writes the source PNG and the GLB as
`output/asset-studio/<job id>/<attempt id>_NNNNN_.png` and `.glb`, and the thumbnail inside
`output/asset-studio/<job id>/<attempt id>/`. Image uploads go to `input/asset-studio/<job id>.<ext>`.
The container mounts only those two `asset-studio` subfolders of ComfyUI's shared input and output
folders, read-write. Cleanup, after `done`, on delete and in the sweep, deletes
`output/asset-studio/<job id>/` and `input/asset-studio/<job id>.<ext>`. The app never reads or deletes
anything outside those subfolders.

### Restart, upgrade and rollback

An app restart needs no separate recovery path. Rows keep their state and attempt IDs, and the next
tracker tick reconciles them against ComfyUI as described above: finished jobs are collected, queued
ones keep waiting, and lost ones are resubmitted.

At every start the server purges Hunyuan3D jobs; the schema version stays 1. Before its first tick the
tracker reads the prompt IDs of every Hunyuan3D job that is `submitted`, or `pending` with an attempt
ID. On the first tick with a compatible ComfyUI, it sends ComfyUI's per-job cancel for each of those
prompt IDs, treating an answer that the prompt is unknown or already finished as done, and then deletes
every job whose engine is `hunyuan`, and every batch left without jobs, in one transaction. A cancel
that fails with a network error or a server error keeps the purge for the next tick, so no Hunyuan3D
row is deleted while its prompt might still be queued. Until the purge completes, the tracker submits
nothing for Hunyuan3D rows and the job list hides them. The sweep
that follows removes those jobs' asset directories, uploads and files in ComfyUI's `asset-studio`
folders, through its rules for asset directories without a job row, uploads without a batch and ComfyUI
files without a job. A prompt cancelled while it was running may still write files; the
sweep every 10 minutes removes them because they no longer have a row. A rerun finds nothing to cancel
or delete, so the purge is idempotent, and a crash inside it leaves the rows as they were for the next
start.
An earlier version still reads the database. Hunyuan3D jobs it shows after a rollback are not restored.

The database holds a schema version. At start, the app refuses to run, with a message naming both
versions, when the database's version is newer than the one it knows. Only when a migration is about to
run, it writes a consistent copy with `VACUUM INTO '/data/backup/schema-<current schema version>-<timestamp>.sqlite'`,
then runs each migration in a transaction. The executable's `schema-version` command prints the schema
version it knows. The executable also has a `restore-backup <file>` command that replaces the
database with that copy and deletes the `-wal` and `-shm` files. The first release has schema version 1
and nothing to migrate.

`scripts/deploy/rollback.sh` first ensures Docker Desktop runs in the owner's session through the
`AssetStudio-Docker` task, as `deploy.sh` step 1 does. When the previous image is not loaded on `win-main`, it loads it the way `deploy.sh` does,
from that version's GitHub Release record and with the same checks; when no record exists, it stops with
a failure and changes nothing. It stops the Compose project, asks both images for their schema version,
and when they differ runs the previous image's `restore-backup` on the newest
`schema-<previous image's schema version>-*.sqlite` backup, stopping with a failure when there is none.
Then it rewrites `current.json` and `.env` (see Deployment and exposure) with the previous version's
tag and digest from its Release record, clears the record of the previous version, and brings the
project up, so a later logon starts the rolled-back version. Jobs created after that backup disappear
from the app; their asset directories stay in the volume until a version with the asset-directory sweep
runs again, and ComfyUI may still run their prompts, which the restored app ignores.

### Access token

The configuration file holds one access token, at least 32 random bytes encoded as base64url without
padding (43 or more characters from the base64url alphabet); the loader refuses any other value. The deploy
script generates it on the first install and never prints it or copies it off `win-main`. The owner
reads it with `ssh win-main` from `config.yaml` and gives it to the friend out of band.
`scripts/deploy/deploy.sh --rotate-token` writes a new token and restarts the app. `bun run verify:live`
reads the token over SSH into memory for its run and never writes it to disk or logs.

Every `/api` route except `GET /api/health`, `GET /api/session` and `POST /api/session` requires either an
`Authorization: Bearer <token>` header or the session cookie. `GET /api/session` always answers 200 with
`{"signedIn": true}` or `{"signedIn": false}`, judged from the session cookie alone; it ignores any
`Authorization` header, so it cannot be used to test tokens, and it never counts toward the failure limit. `POST /api/session` compares the submitted
token in constant time and sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie with `Max-Age` of 30
days. Its value is `<issued-at>.<mac>`, where `<issued-at>` is the sign-in time in Unix seconds and
`<mac>` is HMAC-SHA256 keyed with the token over `asset-studio-session-v1.<issued-at>`. The server
rejects a cookie whose MAC does not match or whose issue time is more than 30 days ago or in the future,
so a copied cookie stops working after 30 days, and rotating the token signs every browser out. `GET /api/health` reveals only the app version, the build
commit, ComfyUI's state (reachable, offline or incompatible) and the ComfyUI version it last read.

Every failed authentication counts toward one limit of 10 in any sliding 60-second window per client: a wrong token on
`POST /api/session`, a wrong bearer token or a cookie that does not match on any protected route. Over
the limit, failed attempts get 429 instead of 401 until fewer than 10 failures fall within the last 60
seconds. A correct token or cookie is always accepted, even from a client over the limit, so nobody is
locked out; the token's 256 bits of randomness, not the limit, are what stop guessing, and the limit
only keeps a misbehaving client from flooding the logs. The client address is the last
`X-Forwarded-For` value when the socket peer is trusted and sends that header, and the socket address
otherwise, including a trusted peer without the header. Trusted peers
are loopback addresses and the container's default gateway, which the server reads from
`/proc/net/route` at start. Through Docker's published port every connection arrives from that gateway
(Background), and `tailscale serve` puts the tailnet source address in `X-Forwarded-For`.

### HTTP API

JSON over HTTP under `/api`; the page uses only this API.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | App version, build commit and ComfyUI state, without a token |
| `GET /api/session` | 200 with `{"signedIn": bool}` from the session cookie alone; no token needed, bearer tokens ignored, never counted as a failure |
| `POST /api/session` | Exchange the token for the session cookie |
| `POST /api/batches` | Create a batch from prompts (JSON) or images (multipart) |
| `GET /api/jobs?state=&batch=` | List jobs, newest batch first and in batch position order within a batch, with queue position for submitted jobs |
| `GET /api/jobs/<id>` | One job |
| `POST /api/jobs/<id>/cancel` | Request cancellation of a pending or submitted job |
| `POST /api/jobs/<id>/retry` | Requeue a failed or cancelled job |
| `DELETE /api/jobs/<id>` | Delete a done, failed or cancelled job and its files |
| `GET /api/assets/<id>/model.glb` | Download the GLB, named after the prompt |
| `GET /api/assets/<id>/source` | The source image |
| `GET /api/assets/<id>/thumb` | The 256 by 256 thumbnail |
| `POST /api/exports` | Check a selection of done jobs and return a one-time download link |
| `GET /api/exports/<export id>` | Stream the zip for that link, once, within five minutes |

Uploaded images are limited to PNG, JPEG and WebP, checked by their leading bytes, at most 20 MiB each.
Prompts are 1 to 2000 characters after trimming; empty lines are dropped.

### Glossary

The page uses exactly these terms for job states, preset fields, banners and the library heading. The
Glossary covers only these; button labels are set in Page.

| Term on the page | Meaning |
| --- | --- |
| Waiting | Job state `pending` |
| Queued | Job state `submitted`, not yet running in ComfyUI |
| Generating | Job state `submitted`, running in ComfyUI |
| Done | Job state `done` |
| Failed | Job state `failed` |
| Cancelled | Job state `cancelled` |
| Detail | The triangle target: 5k, 10k or 20k |
| Texture | The texture size: 1024 or 2048 |
| Variants | Jobs per prompt line, each with its own seed |
| Game-asset style | Whether the style suffix is appended to the prompt |
| Seed | The seed of the first variant |
| ComfyUI offline | The banner when ComfyUI does not answer |
| ComfyUI incompatible | The banner when ComfyUI is older than 0.46.2 or reports no version |
| Library | The heading of the list of done assets |

### Page

The page follows `guides/vh-midnight.md` at the pinned revision, with its token block copied into
`app/web/styles.css` as written there: the three-stop gradient from `#020814` to `#0b1f45`, `--card`
surfaces, `--ink` text, `--accent` for links, focus and selection, and the semantic `--ok`, `--warn` and
`--danger` colours. It is dark only: `color-scheme: dark`, `<meta name="theme-color" content="#020814">`
and native controls styled for the dark scheme. Type is the guide's system sans-serif stack, with
monospace for seeds and job IDs. The design follows `guides/use-frontend-design-skills.md`; colour
follows `conventions/interface-colour.md`.

Colour carries meaning only. Job state badges use the guide's badge recipe with these exact values: a
coloured badge has its semantic colour at 15 percent opacity for the fill, at 40 percent for a 1px
border, and a tint for the text (`#b9d1ff` for `--accent`, `#a7f0d2` for `--ok`, `#ffc4c4` for
`--danger`); the neutral badge has white at 9 percent for the fill, white at 18 percent for its 1px
border and `--ink-dim` text. Generating uses `--accent`, Done `--ok`, Failed `--danger`, and Waiting,
Queued and Cancelled the neutral badge. `--ok`, `--warn` and `--danger` appear on nothing else except
the Generate button, the two banners and the Delete hover state. Every
badge shows its Glossary term, so colour is never the only signal. The ComfyUI offline and incompatible
banners use `--danger` and `--warn` with their terms. Generate is the one solid `--ok` button with
`--on-ok` text; every other button is translucent (`--control-bg`, a border at least 3:1 against its
surface, `--control-bg-hover` on hover, a 2px `--accent` focus outline), and Delete turns a translucent
`--danger` on hover. Descriptive facts (detail, texture, seed, times, IDs) stay neutral `--ink-dim`
text. The header carries the identity: the `Asset Studio` name and a small `VH & Co` mark, beside a
neutral ComfyUI status line.

The sign-in screen is one centred card with the name, the Access token field and the Sign in button.

The main view, at 1024 CSS pixels and wider, has two columns. The left column is the composer, at most
380 pixels wide and sticky below the header while it fits the viewport: the Prompts field, an image
drop zone that also opens the file picker, Detail and Texture as segmented button groups (each a radio
group with its Glossary label), Variants as a number field with minus and plus buttons, the Game-asset
style switch, the Seed field, and a Generate button whose label names the job count (`Generate 1 job`,
`Generate 6 jobs`). With no prompt and no image the button reads `Generate` and is disabled; the server
still refuses an empty batch as before. The right column holds the queue and then the library. Below 1024 pixels the
composer comes first and everything stacks in one column.

The queue lists unfinished, failed and cancelled jobs as compact rows: the prompt or file name, the
state badge, the queue position for Queued jobs or the minutes since the job started for Generating
jobs, and the row's actions (Cancel, Retry, Delete). It is hidden when it would be empty.

The library is a gallery of cards, four or more per row on wide screens, two from 390 pixels and one
below that. Each card shows the 256-pixel thumbnail on a `--card` surface, the prompt or file name on
at most two lines (the full text is its `title` and accessible name), its Done badge, a Select
checkbox, and Preview, Download and Delete buttons. A toolbar above the
gallery shows the asset count, a Select all control and Download selected with the selected count.
With no assets, the library shows its empty state.

Preview opens a native modal `<dialog>` holding the `<model-viewer>`, the full prompt or file name,
its detail, texture, seed and creation time as neutral text, a Download button and a Close button. The
dialog fits the viewport at every matrix size: the viewer shrinks first, the text scrolls inside the
dialog, and Close and Download stay visible. Escape closes it
and returns focus to the Preview button that opened it. Selecting an asset loads the `<model-viewer>`
module on demand. While it loads, the dialog shows a loading state; when the import fails, it shows an
error with a retry button that imports it again. The viewer opens with camera controls on the asset's
GLB, with no auto-rotation, and with camera interpolation turned off under `prefers-reduced-motion`.

On load the page asks `GET /api/session` whether it is signed in, so it never makes a failing call to
find out. Each job's state label is its own element holding only its Glossary term; the queue position
or elapsed time follows in separate text. A 401 from any API call stops every query that needs a
session, clears the cached job data and shows the sign-in screen, so a tab left open after a token
rotation stops sending the old cookie. A health query polls `/api/health` every five seconds while the
page is open, and a banner shows when ComfyUI is offline or incompatible. The job list refetches every
two seconds while any job is unfinished and every 15 seconds otherwise, so jobs another person submits
appear too. Single-asset downloads use the asset links directly; a zip export first posts the selection
and then sends the browser to the returned link.

The initial page load stays within 150 KiB of JavaScript after gzip at level 9, counted over the entry
chunk, every chunk it imports statically and every `modulepreload` link in the built `index.html`. The
viewer chunk loads only when an asset is opened and stays within 350 KiB after gzip at level 9.
`bun run size` measures both from the Vite build output. The page loads no web fonts or other network
resources besides its own.

Layout rules the visual tests hold: body text at least 14 CSS pixels; prompt text in the queue and
library at most 90 characters per line; no label or button text clipped; no horizontal overflow; text
contrast at least 4.5:1, or 3:1 for text of at least 24 pixels or bold text of at least 18.66 pixels;
and control borders and the focus outline at least 3:1 against the surface they sit on. The tests
measure contrast against the composited background: the element's nearest background with an alpha
above zero, blended over its ancestors' backgrounds down to the page gradient, checked against both
the darkest and the lightest gradient stop.

### Export

`POST /api/exports` takes a JSON body `{"jobs": [<job id>, ...]}`. It checks the selection and answers
413 with the app's message, which the page shows, when the limits below are exceeded; otherwise it
answers `{"url": "/api/exports/<export id>"}`, where the export ID is a random UUID that expires after
five minutes or one use. Fetching it still needs a valid session cookie or bearer token, like every
protected route; it is not tied to the particular session that created it. The page sets the browser's location
to that URL, so the browser downloads the zip natively without holding it in memory. Before it streams
anything, `GET /api/exports/<export id>` checks again that every selected job exists, is `done` and has
its files; when one does not, it answers with a redirect to `/?export=gone`, and the page shows that the
selection changed and asks for a new export.

A job row stores the prompt as the user typed it, without the style suffix; the suffix is added only
when the graph is built. File names use a slug and a short ID. The slug is that prompt, or for an image job the upload's file name
without its extension, lowercased, with every run of characters outside `a-z` and `0-9` replaced by one
`-`, leading and trailing `-` removed and cut to 40 characters; an empty result becomes `asset`. The short
ID is the first 8 hex characters of the job ID. A single GLB downloads as `<slug>-<short id>.glb`, sent with
`Content-Disposition: attachment; filename="<slug>-<short id>.glb"`, which is safe because the slug only
holds `a-z`, `0-9` and `-`. The zip holds, per asset, `<slug>-<short id>.glb` and the source image as
`<slug>-<short id>.<png|jpg|webp>`, plus `manifest.json`:

```json
{"schema": 1, "assets": [{"id": "<job id>", "glb": "<file>", "source": "<file>", "prompt": "<text or null>",
  "upload": "<file name or null>", "engine": "trellis", "faces": 10000, "texture": 2048,
  "style": true, "seed": 0, "created": "<RFC 3339 UTC>"}]}
```

`engine` is always `trellis` and `texture` always a number. A selection of more than 100 assets, or whose files
add up to more than 2 GiB, is refused with 413 and a message to split it, and the page shows the same
limit before sending; the zip therefore never needs ZIP64. The server writes the zip to the response as a
stream, one file at a time, without compression of the already-compressed GLB and PNG data, so its
memory use does not grow with the selection.

### Container image

The `Dockerfile` has two stages. The builder stage, a digest-pinned `oven/bun` image, installs
dependencies, builds the page with Vite and runs
`bun build --compile --target=bun-linux-x64` to produce one executable with the page embedded, then
collects the shared libraries `ldd` reports for it, except the glibc core the runtime already has. The
runtime stage is a digest-pinned `gcr.io/distroless/base-nossl-debian13:nonroot` (glibc without
OpenSSL, the same Debian 13 as the builder) with that executable and those libraries only, `USER
nonroot:nonroot` and an exec-form `ENTRYPOINT`. The build receives the version and commit as build
arguments and embeds them. `.dockerignore` is an allowlist.

The runtime stage also holds an empty `/data` directory owned by `65532:65532`, copied from the builder
with `COPY --chown=nonroot:nonroot`, so a new named volume mounted there is writable by the app.

The container runs with a read-only root filesystem. Its writable paths are `/data` (a named Docker
volume), `/comfy/input` and `/comfy/output` (the two ComfyUI subfolder mounts), and a `tmpfs` at `/tmp`.
`/config/config.yaml` is a read-only bind mount of `%LOCALAPPDATA%\AssetStudio\config.yaml`.
Configuration, loaded strictly: listen address (default `0.0.0.0:8790` inside the container), ComfyUI
URL (default `http://host.docker.internal:8188`), data directory (default `/data`), ComfyUI input and
output `asset-studio` folders (defaults `/comfy/input` and `/comfy/output`), the access token and the
three limits.

### Deployment and exposure

`scripts/deploy/compose.yaml` defines one service whose image is `${ASSET_STUDIO_IMAGE}`, with
`pull_policy: never`, the port published only on `127.0.0.1:8790`, the mounts above, `read_only: true`,
`restart: unless-stopped` and a 1 GiB memory limit. The two ComfyUI mounts come from
`%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\input\asset-studio` and `...\output\asset-studio`, the
folders the running ComfyUI uses (Background). `compose.yaml` writes these and the `config.yaml` mount
as `${LOCALAPPDATA}/...`, which Compose interpolates from the owner's environment on `win-main`, so no
user name or local path is committed and no script writes the paths; `.env` holds only
`ASSET_STUDIO_IMAGE`. Compose runs on `win-main` from
`%LOCALAPPDATA%\AssetStudio\`, where `deploy.sh` copies `compose.yaml`. Next to it, `current.json` holds
the version, tag and digest that should run, and `.env` holds `ASSET_STUDIO_IMAGE=<tag>` derived from
it. `deploy.sh`, `rollback.sh` and the logon script all write `.env` from `current.json`, so Compose
always runs the version `current.json` names.

Two scheduled tasks with an interactive principal live on `win-main`. `AssetStudio-Docker` has no
trigger and only starts `Docker Desktop.exe`; `deploy.sh` and `rollback.sh` run it on demand.
`AssetStudio-Logon` has a logon trigger and runs `start-asset-studio.ps1`.

`deploy.sh`, `rollback.sh`, `check-image.sh`, `check-repo.sh` and `bun run verify` use `cosign`, `gh` and
`shellcheck` binaries they download at exact versions into a cache directory, checking SHA-256 checksums
pinned in `scripts/deploy/tools.env`. They never run a preinstalled copy. `tools.env` is an exception to
the YAML rule for settings files, chosen by the owner: the shell scripts source it directly, which a YAML
file would need a parser for. A Renovate custom manager in `renovate.json` (regex, datasource
`github-release-attachments`) captures each version and its digest together, so an update moves both.

`scripts/deploy/deploy.sh <version>` runs on `fedora-43`:

1. Ensures Docker Desktop runs in the owner's session: it registers `AssetStudio-Docker` when missing,
   runs it when `docker desktop status` is not `running`, and waits up to three minutes for the engine
   to answer. When it does not, for example because the owner is not signed in, it stops with a failure
   that says so.
2. Reads `release.json` from the GitHub Release of `v<version>` (below), pulls
   `ghcr.io/vhco-pro/3d-assets-gen@<digest>` without credentials (the package is public), and verifies
   it: `cosign verify --certificate-identity-regexp '^https://github\.com/vhco-pro/3d-assets-gen/\.github/workflows/ci\.yml@refs/heads/.+$' --certificate-oidc-issuer https://token.actions.githubusercontent.com`,
   which accepts this repository's `ci.yml` on any branch (prereleases come from the feature branch) and
   nothing else, then `gh attestation verify oci://ghcr.io/vhco-pro/3d-assets-gen@<digest> --repo vhco-pro/3d-assets-gen`
   once for the default provenance predicate and once with `--predicate-type` set to the SPDX predicate
   type `https://spdx.dev/Document/v2.3` that the action's `actions/attest` step records for its SPDX
   SBOM.
3. Tags the verified image `ghcr.io/vhco-pro/3d-assets-gen:<version>`, streams it with `docker save`
   over SSH into `docker load` on `win-main`, and checks that `docker image inspect --format '{{json .RootFS.Layers}}'`
   gives the same layer diff IDs on both hosts. Image IDs can differ between Docker's classic and
   containerd image stores, while the uncompressed layer diff IDs do not. Registry pulls over SSH fail on `win-main` (Background), so the
   image never comes from a pull there.
4. Creates the two ComfyUI `asset-studio` folders when missing, copies `compose.yaml` and
   `start-asset-studio.ps1`, registers `AssetStudio-Logon` when missing, and writes `config.yaml` with a
   new token only when none exists. It writes `current.json` with the version, tag and digest being
   deployed, and `.env` from it. When the running tag differs from the
   one being deployed, records the running tag as the previous one; a rerun of the same version leaves
   that record alone. Then brings the Compose project up on the new tag.
5. Over SSH on `win-main`, waits up to three minutes until `/api/health` on `127.0.0.1:8790` reports the
   new version and commit, failing the deploy when it does not, then runs
   `tailscale serve --bg --https=443 http://127.0.0.1:8790` unless serve already forwards there.

Running it again keeps the token, the data volume and the record of the previous tag. The app keeps
running only while the owner is signed in on `win-main`, the same condition Comfy Desktop already has.

At logon, `start-asset-studio.ps1` starts Docker Desktop and waits up to three minutes for the engine,
logging a failure to `logon.log` when it does not answer. When `current.json`
does not exist yet, it stops there. Otherwise, when the tag in `current.json` is not loaded, it pulls
`ghcr.io/vhco-pro/3d-assets-gen@<digest>` from `current.json` (registry pulls work in the owner's
session, Background) and tags it; pulling by the digest `deploy.sh` already verified guarantees the same
image. It then writes `.env` from `current.json` and brings the Compose project up, so the app returns
after a reboot without a redeploy. Deploy and rollback never run this script, so it cannot race their
own Compose steps.
The container's port is published on localhost only, so Tailscale serve is the only way in from other
devices.

### Versioning and release path

The only artifact is the container image `ghcr.io/vhco-pro/3d-assets-gen`, a GHCR package owned by the
repository. GitHub creates it private on the first publication; right after that first `release` run,
it is switched to public once in the package settings (`Change visibility`), which cannot be undone.
Every later deploy and logon pull relies on that. Everything runs in one workflow, `ci.yml`, triggered by pushes to any branch and by
`workflow_dispatch`. It follows the same-workflow arrangement described at the top of
`vhco-pro/version-workflow`'s `version.yml` (`contents: write`, no App, a dependent release job), with
the trigger and concurrency layout of its `tag-after-checks` example:

- `checks` runs `bun run verify`.
- `version` calls `vhco-pro/version-workflow/.github/workflows/version.yml` at commit
  `46a1ac93fdbd3abaa3a7d17259c5565edd2053c0` (`v0.1.2`) with the `release:preview` label and an empty
  `release-app-client-id`, so it pushes the exact tag with the workflow's `GITHUB_TOKEN`. That job has
  `contents: write` and `pull-requests: read`, which the reusable workflow needs to find the labelled
  PR.
- `release` runs only when `version` pushed a tag. It calls `michielvha/docker-release-action` at `v2`
  (`c499e52a1a05e5bdd8cf03ba19a423d4c7ec25e3`) with `registry: ghcr.io`, `username: vhco-pro`,
  `password: ${{ secrets.GITHUB_TOKEN }}`, `project: 3d-assets-gen`, `platforms: linux/amd64`,
  `build-args` carrying `APP_VERSION` and `APP_COMMIT` (the build arguments the Dockerfile reads), that
  version, and the required security profile
  (`trivy-scan`, `trivy-severity: HIGH,CRITICAL`, `trivy-exit-code: '1'`, `cosign-sign`, `sbom`,
  `attest-provenance`, `attest-sbom`). Only after that step succeeds, scan included, does the next step
  create a GitHub Release for the tag (marked prerelease for a prerelease version) with one asset,
  `release.json`, holding `{version, commit, digest}` from the action's `release-digest` output. That
  step has no `if: always()` and no `continue-on-error`. The job has `contents: write`, `packages: write`,
  `id-token: write` and `attestations: write`. A version without that Release is never deployed.

`preview.yml`, copied from that example, reruns `ci.yml` on the PR branch when the `release:preview`
label is added. The image's version and commit are the ones `/api/health` reports. A tag pushed with
`GITHUB_TOKEN` starts no other workflow, which this arrangement does not need.

1. The feature PR carries the `release:preview` label, so each push that passes CI gets a prerelease
   version and image. The prerelease image of the feature branch head is deployed before the
   implementation review, so the review can observe AC-10, AC-11 and AC-15 against it.
2. After merge, the release image from `main` is deployed and AC-10's check is repeated.

A version whose tag was pushed but whose `release` job failed has no GitHub Release and is never
deployed. A failure caused by the code or the image (a scan finding, a build error) is fixed by a new
commit, which gets the next version; a transient failure (a registry or network error) is retried by
re-running the failed `release` job in the same run. The same holds for `main`: step 2 waits for the next
successful release.

The feature is delivered when step 2 has run. Deployments always use an exact version with its recorded
digest, never the action's `latest` alias.

### Repository and CI

The repository is public `vhco-pro/3d-assets-gen` with an Apache-2.0 `LICENSE` naming VH & Co BV. The
`checks` job runs `bun run verify` on every branch push, which a PR shows on its head commit; it builds
the container image locally and runs the Playwright suite against it. Every action and reusable workflow is pinned to a
full commit SHA with a release-tag comment, and every job has least-privilege permissions. The
repository also has:

- CodeQL workflows that call `reusable-codeql-js.yml` with `languages: javascript-typescript,python`
  (the repository keeps `scripts/generate_3d.py` and the golden dump helper) and
  `reusable-codeql-actions.yml` from `vhco-pro/.github` (the JavaScript workflow uploads both languages
  under the category `/language:js-ts`, so Python coverage shows as that analysis or as `py/` rules), and
  a Scorecard workflow that calls `reusable-scorecard.yml` from the same
  repository with `publish_results: true`, each pinned to a commit.
- A `renovate.json` for the managed Renovate app with `config:recommended`,
  `helpers:pinGitHubActionDigests` and the baseline `packageRules` from the managed Renovate guide, covering the Bun
  dependencies, the Dockerfile base images, the workflow actions and the tool pins in
  `scripts/deploy/tools.env`. The repository is added to the `vhco-renovate` App installation right
  after it is created.
- The dependency graph, Dependabot alerts, secret scanning, push protection and
  `delete_branch_on_merge`, turned on with `gh` right after the repository is created, before the
  first code push.

Every workflow sets `permissions: {}` at the top and grants each job only what its steps use, sets
`defaults.run.shell: bash`, and gives every job that runs steps a `timeout-minutes`, as
`conventions/github-actions.md` requires. `bun run verify` runs `actionlint` over `.github/workflows/`
right after shellcheck, with the binary pinned by version and SHA-256 in `scripts/deploy/tools.env` and
fetched by `scripts/deploy/lib/tools.sh` like the other tools. The README records the security analysis
coverage per language: CodeQL for JavaScript, TypeScript, Python and Actions; shellcheck (a linter, not
a security analyzer) for the Bash scripts; and no analyzer yet for the PowerShell scripts; adopting
`vhco-pro/pwsh-ci-action` (PSScriptAnalyzer) for them is tracked in #3.

`check-repo.sh` fails closed: when it cannot read the `vhco-renovate` installation's repositories, it
reports the installation check as failed with the HTTP status or error it got, never as skipped, and API
errors in the other checks are reported as failed with the error rather than as a missing analysis. The
owner's `gh` token cannot list the installation (HTTP 403), so the installation check takes its token
from `ASSET_STUDIO_INSTALLATION_TOKEN` when that is set: a fine-grained personal access token the owner
creates with read access to the organisation's GitHub Apps, kept in the owner's shell for that run only.
Without it, the check fails with that instruction. As an alternative proof for AC-14, a successful
`renovate-runner` dry run limited to this repository shows the installation includes it.

### Command-line output

`deploy.sh`, `rollback.sh`, `check-repo.sh`, `check-image.sh`, `bun run seed`, `bun run size`,
`bun run verify:live` and the executable's `restore-backup` command follow
`conventions/terminal-output.md`: each step and result is a line with a status symbol and an outcome
word (`✓ Passed`, `✗ Failed`, `∅ Skipped`, `› <step>`), colour only on a TTY and never when `NO_COLOR`
is nonempty, plain append-only output when the stream is not a terminal, and an `--ascii` flag that
prints `OK`, `FAIL`, `SKIP` and `>` instead of the symbols. Exit codes are zero only when every step
passed. The shell scripts share one small reporter in `scripts/deploy/lib/report.sh`; the Bun tools share
one in `app/cli/report.ts`. Shell tests use `bats-core`, installed as the `bats` npm package in
`devDependencies` and pinned with its integrity hash in `bun.lock`, which Renovate updates once the
repository is in the `vhco-renovate` installation.

### Verification commands

`bun run verify` (`scripts/verify.sh`) runs, in this order: the type check; lint; shellcheck of every
shell script with the pinned binary; `actionlint` over `.github/workflows/` with the pinned binary;
unit tests (`bun test app --path-ignore-patterns='app/e2e/**'
--path-ignore-patterns='app/image/**' --path-ignore-patterns='app/memory/**'`; the flag replaces the
`bunfig.toml` list, so all three are given); the workflow tests (`bun test ./.github`, by explicit path
since Bun's discovery skips dot-directories); the shell tests (`bunx bats scripts/deploy/tests`); the
golden check (`bun run golden:check`, which needs `python3`); the production build and size check; the
local image build with its start check (`bun test ./app/image`); the memory tests
(`bun test ./app/memory`) against that image;
the `bun run dev` readiness check; the docs check (AC-21); and the Playwright suite against that image
with the fake ComfyUI.

The Playwright suite starts the image with a host data directory and the fake's two `asset-studio`
folders bind-mounted, all created by the harness and given to UID 65532 with `chmod 0777` on the
temporary folders, so the container can write and delete there. It seeds by running the image's own
`seed` command (the executable's subcommand behind `bun run seed`) against that data directory before
the server starts. The fake looks up fixture prompt IDs in the data directory's database on every
`/queue` and `/history` request, so it serves seeded `submitted` jobs as queued or running whether the
seed ran before or after the fake started.

Each of these Playwright projects runs against its own container, data directory and fake: the sign-in
and token-rotation scenarios (their failures consume the rate-limit budget), the offline and
incompatible-version scenarios and the glossary scenario (they stop or change the fake), and the
empty-profile scenarios. The CI `checks` job installs `xvfb` and Mesa's software GL (`libegl1`,
`libgl1-mesa-dri`, `libgles2`) and runs `bun run verify` under `xvfb-run -a` with `E2E_REQUIRE_WEBGL=1`,
because Firefox creates a WebGL context only with an X display; the variable turns a missing context into
a failure of the viewer render check, so CI supplies the Firefox render evidence. Without that variable, as on
`fedora-43`, the check skips with the reason instead of passing or failing. The
remaining journeys share one seeded container; those that change data (submit, cancel, retry, delete)
act only on jobs they created in the same test. `bun run verify:live` runs the real generations against a deployed app and is never part
of CI.

`bun run dev` starts the fake ComfyUI on `127.0.0.1:8189` and the server on `127.0.0.1:8790` with the
committed `dev/config.yaml`, whose token is `ZGV2LXRva2VuLW5vdC1mb3ItcHJvZHVjdGlvbi0wMDA` (base64url of
`dev-token-not-for-production-000`, 32 bytes, so it passes the loader), with the data directory
`.dev-data/data` and the ComfyUI folders `.dev-data/comfy/input/asset-studio` and
`.dev-data/comfy/output/asset-studio` (`.dev-data/` is ignored by Git). The fake ComfyUI writes its
outputs and uploads under `.dev-data/comfy/`, and the tests give each run its own temporary copy of that
layout. It reports ready once `/api/health` answers with ComfyUI reachable. The server refuses to
start with that token unless the ComfyUI URL answers the fake's marker endpoint
`GET /asset-studio-fake`, so the development token can never serve a real ComfyUI. Bun, Docker and
`python3` (for the golden check) are the only dependencies.

Before handoff, the restyled page is reviewed with the procedure in `guides/use-frontend-design-skills.md`:
the Vercel web interface rules at the commit that guide names, applied to the rendered page at the
viewport matrix, with the result recorded in the evidence; Impeccable's launcher is not run, and the
review reads its guidance directly. The pull request that delivers this revision carries the
before-and-after record `conventions/frontend-testing.md` requires: for the sign-in screen and its wrong
token error, the main view at 390x844 and 1280x720 with the queue open, the empty library, the open
preview dialog, the viewer's error state, and the offline and incompatible banners. Both sides use head's
TRELLIS.2-only fixture: the before is the base commit's build seeded with that fixture through the base
executable's own `seed` command fed head's fixture rows, so the libraries match. The viewer's loading
state is left uncaptured because it lasts well under a second on the fixture. Captures are committed to
`refs/pr-visuals/<PR number>` and linked at that ref's commit.

`bun run bootstrap` runs `bun install --frozen-lockfile` and installs the Playwright browsers.
`bun run clean` deletes `.dev-data/` and the ignored `.artifacts/` test output folder and nothing else.

`bun run seed` runs the executable's `seed` subcommand, which loads the development fixture into the
configured data directory and refuses to run unless the configured ComfyUI URL answers that marker
endpoint. Fixture jobs have fixed UUIDs and the fixture flag, and a rerun replaces those rows and
their files and leaves every other row alone. The fixture holds done jobs with
fixture GLBs and thumbnails, a failed job, a cancelled job, and `submitted` jobs whose prompt IDs the
fake serves as queued and running prompts that never finish. The tracker's timeout skips
flagged jobs, so they stay stable. `bun run seed --profile empty` loads no jobs. `bun run seed --reset`
deletes only flagged fixture rows and their files.

## Acceptance Criteria

- [ ] AC-01: For every input in the golden set, the TypeScript image and TRELLIS.2 graph builders return the graph the matching Python builder in `scripts/generate_3d.py` returns, and each combined graph follows the node renumbering, rewiring, prefix and thumbnail rules in Design.
- [ ] AC-02: Submitting a batch through the page creates one pending job per prompt line and variant, or per image; a batch that is empty, has an over-long prompt, a wrong or oversized file, more than 25 jobs, more than 200 MiB of images, a malformed batch ID, or would exceed 100 unfinished jobs is rejected with a message that names the problem and creates no job and leaves no file; concurrent batches never take the unfinished count above 100; and a repeated batch ID, sequential or concurrent and with any multipart boundary, returns the existing batch, or a conflict when its content differs, without creating anything and without touching the first batch's uploads.
- [ ] AC-03: Each job is submitted to ComfyUI as one prompt with its own attempt ID and output prefix, jobs run in submission order, and each ends `done` with its GLB, source image and thumbnail stored, or `failed` with ComfyUI's error message, including when ComfyUI rejects the prompt or the upload, or answers one job with three server errors in a row while later jobs still run.
- [ ] AC-04: While ComfyUI is unreachable the page shows it offline, and while it reports a version older than 0.46.2 or none the page shows it incompatible and the app neither submits, reconciles, cancels nor times out anything, whether or not jobs are unfinished; every job keeps its state, and jobs continue once a compatible ComfyUI answers again.
- [ ] AC-05: A pending job can be cancelled, and ComfyUI receives a per-job cancel only when the job has an attempt ID; a submitted job is cancelled through ComfyUI's per-job cancel for its own prompt ID, unless it already finished, in which case it ends `done`; a failed or cancelled job can be retried and runs again as a new ComfyUI prompt with the same settings and seed; and a retry over the unfinished-job limit is refused with a message.
- [ ] AC-06: After an app restart, a timeout or a ComfyUI restart, every job ends in the state ComfyUI's queue and history imply; a job ComfyUI lost is resubmitted as a new prompt with a new output prefix up to twice and fails on the third loss; a prompt ComfyUI accepted before the app recorded it, or after the app's request timed out, is adopted rather than submitted twice; no asset directory is left half written; and the sweep removes orphaned uploads and the app's leftover files in ComfyUI's `asset-studio` folders.
- [ ] AC-07: The library lists done assets with thumbnails, shows an empty state when there are none, renders the selected GLB in a 3D viewer in Chromium and Firefox, and recovers from a failed viewer load through its retry button.
- [ ] AC-08: In Chromium and Firefox, a single asset downloads as a GLB, a selection of up to 100 assets and 2 GiB downloads as one zip holding each GLB, its source image and a `manifest.json` describing them, and a larger selection is refused with a message.
- [ ] AC-09: The page's sign-in, submit, queue and library journeys meet the layout and contrast rules in Design at every size in the project viewport matrix and at 200 percent zoom, including the open preview dialog with Close and Download visible and through a resize while it is open, are usable by keyboard with labelled controls, and the library and viewer journey works with reduced motion.
- [ ] AC-10: The deployed app answers over HTTPS at `win-main`'s tailnet name from another device in the owner's tailnet with the deployed version and commit, while port 8790 and ComfyUI's port 8188 are not reachable on `win-main`'s tailnet address.
- [ ] AC-11: Through the deployed app, one prompt job at the default preset (10k triangles, 2048 textures) and one at 20k triangles with 1024 textures each produce a textured GLB from the real ComfyUI on `win-main`, and the app's files for both are gone from ComfyUI's `asset-studio` folders afterwards.
- [ ] AC-12: Every API route except health and sign-in refuses a request without a valid token or session cookie; wrong tokens and cookies, on sign-in or any protected route, are rate limited per client address, with clients behind `tailscale serve` and Docker's published port counted separately; a page that receives a 401 stops polling and shows sign-in; and sign-in works in Chromium and Firefox and survives a reload.
- [ ] AC-13: The production page's initial JavaScript stays within 150 KiB after gzip at level 9, and the 3D viewer loads only when an asset is opened and stays within 350 KiB after gzip at level 9.
- [ ] AC-14: The public repository has an Apache-2.0 licence, CodeQL and Scorecard workflows calling the organisation's reusable workflows with a completed run of each on the default branch, a Renovate configuration, and the dependency graph, Dependabot alerts, secret scanning, push protection and automatic branch deletion turned on.
- [ ] AC-15: Deploying a second time keeps the access token and the data, records the previous version only when the version changes, and a rerun of the same version keeps that record; rolling back stops the app, reloads the previous image when it is missing, restores the matching backup across a schema change, and returns the app to the previous version serving again; the logon task brings the app back after its image was removed; a backup taken while writes are still in the WAL restores completely; and an executable refuses to start on a database with a newer schema version.
- [ ] AC-16: The seed command is repeatable without duplicating rows, leaves non-fixture rows untouched, refuses a ComfyUI that is not the fake, and its fixture jobs keep their states while the app runs, including past the 15-minute timeout; `bun run dev` starts the fake and the server and reports ready, and the development token is refused against a ComfyUI that is not the fake.
- [ ] AC-17: The published image at its recorded digest runs as the non-root user with a read-only root filesystem and a fresh data volume and serves the page with its version and commit; its signature and its provenance and SBOM attestations verify; and its GitHub Release record exists only for a version whose scan passed.
- [ ] AC-18: The page labels job states, the preset fields (Detail, Texture, Variants, Game-asset style, Seed), the two banners and the library heading with exactly the terms in the Glossary.
- [ ] AC-19: The command-line tools print labelled status lines, add no colour or cursor control when `NO_COLOR` is nonempty or the stream is not a terminal, offer an ASCII mode, and exit non-zero whenever a step failed.
- [ ] AC-20: A 25-image batch at the 200 MiB cap, two such batches at once, and an export of 100 assets each complete without the container being killed for memory under its 1 GiB limit, and the server's anonymous memory stays below 512 MiB.
- [ ] AC-21: The README names `bun run bootstrap`, `bun run dev`, `bun run seed`, `bun run verify`, `scripts/deploy/deploy.sh`, `scripts/deploy/rollback.sh` and `bun run clean`, how readiness is detected, the dependencies, and the owner's checklist (share the node, limit `autogroup:shared` to port 443); `AGENTS.md` names the same commands and routes to `conventions/terminal-output.md`, and no longer says that no commands exist.
- [ ] AC-22: The page uses the VH Midnight tokens and recipes Design names: the gradient body background, `color-scheme: dark`, solid `--ok` only on Generate, semantic badge colours only on job states and banners, the two-column composer layout from 1024 pixels and one column below it, the exact badge colours, semantic colours on nothing but job states, banners, Generate and the Delete hover, and a preview in a modal dialog that shows the full prompt and that Escape closes with focus returned to its opener in Chromium and Firefox; the rendered page passed the design review Design names; and the pull request carries the before-and-after record Design lists.
- [ ] AC-23: The app offers no engine choice and submits only TRELLIS.2 graphs; a batch that sends an engine other than `trellis` is refused with the Hunyuan3D message; at start the server cancels every Hunyuan3D prompt it knows in ComfyUI and then deletes every Hunyuan3D job, its batch when no job is left, and their files, while TRELLIS.2 rows and their files under `/data` stay untouched; and the README offers no engine choice and names TRELLIS.2 as the only mesh model.
- [ ] AC-24: Every workflow sets `permissions: {}` at the top, a bash default shell and a timeout on every job that runs steps, and passes the pinned `actionlint` in `bun run verify`; `check-repo.sh` fails the installation check when it cannot read the installation and reports any other failed API call as a failure with its error; and the README records the security analysis coverage per language.

## Test Plan

| Criterion | Proof |
| --- | --- |
| AC-01 | `bun test app/pipeline` compares the image and TRELLIS.2 builders with the committed golden graphs (which hold no Hunyuan3D case) and asserts the combiner's renumbering, the dropped `LoadImage`, every rewired input, the `asset-studio/<job id>/<attempt id>` prefix on every save node, and the thumbnail branch's nodes and inputs; `bun run golden:check` regenerates the golden files from the Python script with `python3 -I` and fails on any difference. |
| AC-02 | `bun test app/server` (which no longer contains the memory tests) API tests for each rejection case (asserting the message names the limit, no rows, and empty staging and uploads trees), a non-UUID `X-Batch-Id` such as `../x` (400, nothing written), the job counts, a 25-image batch with exactly 200 MiB of image bytes accepted, a batch with 200 MiB plus one byte of images refused with the app's 413 message, two concurrent batches that together exceed 100 (exactly one accepted), a repeated image batch ID sent again with a different multipart boundary (200, same batch, the first batch's upload files byte-identical), two concurrent requests with the same image batch ID (one creates the batch, the other answers 200, uploads intact), a reused ID with different content or the same bytes under a different file name (409, uploads intact), and a JSON prompt batch over 1 MiB (413 with the app's message). Playwright `submit.spec.ts` submits three prompt lines with two variants (six jobs) in Chromium, an image batch in Chromium and Firefox, then each invalid case, against the fake ComfyUI. |
| AC-03 | `bun test app/server` (which no longer contains the memory tests) tracker tests against the fake ComfyUI: each job reaches the fake as one `/prompt` call with a UUID `prompt_id` and a graph matching the combiner with that attempt's prefix; two batches finish in submission order with three files on disk; a fake execution error ends `failed` with its message; a fake 400 from `/prompt` and from `/upload/image` each end that job `failed` with the fake's error text while the next job is still submitted; a fake that answers one job's `/prompt` with 500 every time fails that job after the third answer while the next job is submitted and finishes. Playwright `queue.spec.ts` watches a job reach `done`, reloads and checks it persists. |
| AC-04 | Tracker tests: stopping the fake ComfyUI with jobs pending and submitted leaves every state unchanged and `/api/health` reports offline, and restarting it lets the jobs finish; a fake that switches to `comfyui_version` 0.46.1 while staying up, and one that restarts within a single tick reporting 0.46.1 with its queue emptied, each make `/api/health` report incompatible with that version, leave every job state unchanged and receive no `/prompt` or cancel call, until the fake reports 0.46.2 again and the jobs finish. Playwright `offline.spec.ts` checks the banner appears and clears for offline with unfinished jobs, for offline on the empty profile, and for an incompatible version. |
| AC-05 | Tracker tests with a fake that keeps finished, failed and cancelled prompts in its history: cancel pending without an attempt ID (the fake receives no call); cancel pending with an attempt ID the fake has queued (the fake receives `POST /api/jobs/<that id>/cancel`); cancel queued and cancel running (the fake receives the per-job cancel for that prompt ID and never `/interrupt`); cancel requested after the fake already finished the prompt (job ends `done`, no cancel call); the fake finishes the prompt between the history read and the cancel and answers `{"cancelled": false}` (job ends `done`); retry after a failure and retry after a cancel (the fake receives a new `/prompt` with a different `prompt_id` and prefix, the same seed and preset values, the cancel-requested flag, server-error count, started time and error message are cleared, and the job ends `done` without being cancelled again); retry after a timeout on a faked clock (the new attempt is not cancelled before it has run 15 minutes); retry at 100 unfinished jobs (refused with a message); cancel of a pending job whose post timed out 5 seconds earlier, with a fake that accepts the post 10 seconds after the cancel request (the job keeps its flag, the late prompt appears, receives the per-job cancel, and the job ends `cancelled`); a per-job cancel that is unreachable or answers 500 leaves the job in its state with the flag set, the job is not submitted meanwhile, and the next tick's successful cancel ends it `cancelled`. Playwright `queue.spec.ts` cancels and retries through the page. |
| AC-06 | Restart tests kill and restart the server against the fake in these states: prompt finished in history (job ends `done`); prompt still queued (job stays submitted and later finishes); prompt unknown after a fake restart that empties queue and history (job resubmitted with a new `prompt_id` and prefix, and on the third loss `failed`); attempt ID stored with the prompt already posted but the job still `pending` (the job becomes `submitted`; the fake receives one `/prompt` call in total); the fake accepts a prompt 15 seconds after the client's 10-second timeout, later than the next tick (the job becomes `submitted` and the fake receives one `/prompt` call in total); the fake reports the previous attempt's files missing (the resubmitted prompt carries a different prefix). Fault-injection tests kill the server after the first file is written into the collection directory, and again after the rename and before the `done` update; each time the next tick ends with a `done` row and three complete files. A timeout test on a faked clock has the fake finish the prompt just before the per-job cancel, which answers `{"cancelled": false}`, and asserts the job ends `done`. Sweep tests: kill the server after the `done` update and before ComfyUI cleanup, and after a batch's uploads rename and before its commit, restart immediately, and assert the fake's `asset-studio` folders and `/data/uploads/` hold nothing for those jobs after the start sweep. |
| AC-07 | Playwright `library.spec.ts` in Chromium and Firefox (the Firefox render evidence comes from CI, where the suite runs under `xvfb-run -a` with Mesa installed and `E2E_REQUIRE_WEBGL=1` makes a missing WebGL context fail the test): on the seeded fixture, thumbnails load from `/api/assets/<id>/thumb`, the viewer fires `load` for the fixture GLB and its canvas has non-background pixels, and the console has no errors; with the viewer chunk blocked, the error state and retry button appear, and after unblocking, retry loads the viewer; on the empty profile, the library shows its empty state. |
| AC-08 | Playwright `export.spec.ts` in Chromium and Firefox downloads one GLB and checks its glTF binary header, then selects three assets, starts the export, receives the browser download from the one-time link, and checks its six file names follow the slug and short ID rule and that `manifest.json` matches the documented schema with the six files and their settings; a fixture prompt with only non-Latin characters and the style suffix on downloads as `asset-<short id>.glb`, and manifest prompts carry no style suffix; a second request to the same link answers 404. `bun test app/server` (which no longer contains the memory tests) export tests: 101 assets refused with 413 and the split message, a selection whose fixture files add up to just over 2 GiB (sparse files) refused the same way, a link fetched without credentials refused with 401, a link whose selection lost a job after it was issued redirected to `/?export=gone` before any byte of zip is sent, and a link older than five minutes refused (clock faked). |
| AC-09 | Playwright `layout.spec.ts` runs the sign-in, submit, queue and library journeys in Chromium at 320x568, 390x844, 390x667, 844x390, 768x1024, 1024x768, 1280x720 and 1440x900, and at 640x450 as the reflow equivalent of 1280x900 at 200 percent zoom: no horizontal overflow, body text at least 14 px, prompt lines at most 90 characters, no label or button whose `scrollWidth` exceeds its `clientWidth`, primary actions inside the viewport, text and control-border contrast as Design measures it, the open preview dialog with Close and Download inside the viewport, a resize from 1280x720 to 390x844 and to 844x390 while it is open with both still inside, every control with an accessible name, and sign-in and submit completed by keyboard alone. The library and viewer journey also runs with `reducedMotion: 'reduce'` and asserts the viewer has no auto-rotate and interpolation off. A manual check at 200 percent browser zoom in Chromium on a 1280x720 window covers the same journeys, with screenshots. All screenshots are reviewed and the review result is recorded in the evidence. |
| AC-10 | Manual procedure after each deploy, run from `fedora-43`: `curl https://win-main.<tailnet>.ts.net/api/health` returns the deployed version and commit; `curl --connect-timeout 5` to `win-main`'s tailnet address on ports 8790 and 8188 fails to connect. |
| AC-11 | `bun run verify:live` against the deployed URL, with the token read over SSH into memory, submits `a small wooden crate` at the default preset (10k, 2048) and `a stone pillar` at 20k with 1024 textures, waits for both to reach `done`, downloads both GLBs, checks both parse as glTF and each has at least one material with a base colour texture, then lists ComfyUI's `output/asset-studio/` and `input/asset-studio/` over SSH every ten seconds and passes once no entry for either job remains, failing if any remains after two minutes. |
| AC-12 | `bun test app/server` (which no longer contains the memory tests) auth tests: every protected route returns 401 without credentials, with a wrong bearer token and with a forged cookie, and succeeds with the bearer token and with the cookie from `POST /api/session` (whose `Max-Age` is 2592000), and refuses that cookie once the faked clock passes 30 days and a cookie with a future issue time; from the trusted gateway peer, the eleventh failed authentication within 60 seconds with one `X-Forwarded-For` value returns 429, counting wrong sign-ins, wrong bearer tokens and forged cookies together, a different `X-Forwarded-For` value still gets 401, and after 60 seconds without failures the first value gets 401 again (clock faked); from an untrusted peer the header is ignored; `GET /api/session` answers 200 `{"signedIn": false}` without a cookie, with a forged cookie and with a valid bearer token, 200 `{"signedIn": true}` with a valid cookie, and twelve calls with a wrong bearer token leave the next wrong sign-in at 401; a correct token from a client over the limit still succeeds. Playwright `signin.spec.ts` in Chromium and Firefox signs in through the page, reloads with the cookie still valid, shows an error for a wrong token, and after the token is rotated shows the sign-in screen and sends no further job-list requests, then signs in with the new token. After deploy, from `fedora-43` and from a second tailnet device: the eleventh wrong sign-in from `fedora-43` within a minute gets 429 while the second device's next wrong sign-in still gets 401. |
| AC-13 | `bun run size` after `vite build` gzips at level 9 and sums the entry chunk, its static imports and every `modulepreload` link in the built `index.html` (at most 150 KiB), and the viewer chunk (at most 350 KiB), and fails when the viewer module is reachable from the entry's static imports. Its own tests run it on two fixture builds and assert failure on one that imports the viewer statically and on one whose entry is above 150 KiB. |
| AC-14 | `scripts/deploy/check-repo.sh` after the first merge: `gh api repos/vhco-pro/3d-assets-gen` reports public visibility, licence `apache-2.0`, `delete_branch_on_merge` true, and `security_and_analysis.secret_scanning` and `secret_scanning_push_protection` enabled; `gh api repos/vhco-pro/3d-assets-gen/dependency-graph/sbom` returns 200; `gh api repos/vhco-pro/3d-assets-gen/vulnerability-alerts` returns 204; the CodeQL and Scorecard workflow files call the named reusable workflows at a full commit SHA, with `languages` naming `javascript-typescript` and `python`; `gh run list` shows a completed successful run of each on `main`, and code scanning lists a `/language:js-ts` analysis on `main` (which carries the Python results) and an Actions analysis; `renovate.json` exists on `main`; the repository is listed in the `vhco-renovate` installation's repositories, and a Renovate Dependency Dashboard issue or Renovate PR exists. |
| AC-15 | Manual procedure on `win-main`: deploy two prerelease versions in turn and compare the SHA-256 of `config.yaml` (unchanged), confirm the recorded previous version is the first one and the job rows are intact, rerun `deploy.sh` with the second version and confirm the recorded previous version is still the first one, remove the first image with `docker image rm`, run `rollback.sh` and confirm it stops the app, reloads the first image, `current.json` and `.env` name the first version, and `/api/health` reports the first version and commit. Then run `docker compose down`, remove the current image with `docker image rm`, confirm `docker image inspect` reports it absent, start the `AssetStudio-Logon` task and confirm `/api/health` answers with the current version within five minutes. `bats` tests of `rollback.sh` with stubbed `docker`, `ssh` and `gh`: it ensures Docker Desktop first, reloads and verifies a missing previous image, runs the remote rollback, and fails without a previous version, without a release record or without a matching backup. Unit tests: write rows without a checkpoint, take the backup, run `restore-backup` on a copy and find every row; start the server on a database whose schema version is one higher and assert it exits with the version message; with a test migration from schema 1 to 2, assert a `schema-1-*` backup is written only on the migrating start and not on the next start, and that the rollback logic picks the newest `schema-1-*` backup. |
| AC-16 | `bun test app/server` (which no longer contains the memory tests) seed tests: running the seed twice gives the same row count and IDs; a non-fixture job inserted beforehand survives the seed and `--reset`; the seed refuses a ComfyUI URL that does not answer `/asset-studio-fake`; with the app and fake running on a faked clock advanced 20 minutes after seeding, every fixture job keeps its state, both when the seed ran before the fake started and when it ran after; the loader refuses a token shorter than 43 base64url characters; the server refuses to start with `ZGV2LXRva2VuLW5vdC1mb3ItcHJvZHVjdGlvbi0wMDA` against a ComfyUI without the marker. The `bun run dev` readiness step of `bun run verify` starts it and sees its ready line within 30 seconds. |
| AC-17 | `bun run verify` builds the image (on `base-nossl-debian13`) and runs it with `--read-only`, the declared mounts and a new named volume at `/data`: the process runs as UID 65532, a write to `/` fails, the database is created in `/data`, and the page and `/api/health` answer. After publication, `scripts/deploy/check-image.sh <version>` checks that an anonymous `docker pull` of the digest works (the package is public), reads `release.json` from the GitHub Release, runs the same `cosign verify` and two `gh attestation verify` checks as `deploy.sh` with the pinned tools, then runs that digest the same way with a new named volume and asserts UID 65532, a failed write to `/`, and the page and `/api/health` answering with that version and commit. `bun test ./.github` parses `ci.yml` and asserts the Release step comes after the release action in the same job with no `if: always()`, `if: failure()` or `continue-on-error`, and that no other step or job creates a Release or uploads `release.json`. |
| AC-18 | Playwright `glossary.spec.ts` on the seeded fixture reads the job-state label elements, the labels of the five preset fields, the banner term element for both banners and the library heading, and asserts each equals its Glossary term. |
| AC-19 | `bun test app/cli` and `bats` tests in `scripts/deploy/tests/` (both run by `bun run verify`) capture each tool's output for passed, failed, skipped and partial runs: with `NO_COLOR` absent, empty, `0` and `1`, on a pseudoterminal and redirected to a file, in Unicode and `--ascii` mode; they assert the status words, no ANSI or cursor-control bytes in plain captures, and a non-zero exit whenever a step failed. |
| AC-20 | The memory tests in `app/memory/`, run by `bun run verify` after the image build, run the built image with `docker run --memory 1g`, find the container's cgroup on the host from `docker inspect` (`/sys/fs/cgroup/system.slice/docker-<id>.scope/memory.stat` on a systemd host) and sample its `anon` value every 100 ms while it accepts a 25-image 200 MiB batch, two such batches concurrently, and streams an export of 100 fixture assets; they assert `docker inspect` reports `OOMKilled` false and every `anon` sample stays below 512 MiB. |
| AC-21 | `bun test ./app/docs` reads `README.md` and `AGENTS.md` and asserts both name the seven commands exactly as listed in AC-21, that each `bun run` name exists in `package.json` scripts and each script path exists on disk, that the README lists the dependencies, the readiness signal and the checklist items, that `AGENTS.md` links `conventions/terminal-output.md`, and that the sentence saying no commands exist is gone. |
| AC-22 | Playwright `style.spec.ts` on the seeded fixture: the body's computed `background-image` is a linear gradient through `rgb(2, 8, 20)`, `rgb(6, 18, 41)` and `rgb(11, 31, 69)`; the root's `color-scheme` is `dark` and the theme-color meta is `#020814`; Generate's background is `rgb(52, 211, 156)` and no other element's text, border or background resolves to `--ok`, `--warn` or `--danger` except the badges, the banners and Delete on hover; each badge's fill, border and text colour equal Design's exact values, with Waiting observed on a job the fake is held from accepting and Done on a library card; with the fake stopped and then reporting 0.46.1, the offline banner uses `--danger` and the incompatible banner `--warn`; at 1280x720 and 1024x768 the composer and the queue sit side by side and at 1023x768 and 390x844 the composer is above the queue; a card's clipped prompt carries the full text as `title`; in Chromium and Firefox Preview opens a `dialog` element that is open and modal and shows the full prompt, Escape closes it and focus returns to that Preview button. The design review is recorded in T43's evidence, and the before-and-after record is checked by reading the PR body links at `refs/pr-visuals/<number>`. |
| AC-23 | `bun test app/server`: a batch with `engine` `hunyuan` answers 400 with the Hunyuan3D message and creates nothing, one with `engine` `trellis` or without the field is accepted, and a 2000-character prompt is accepted while 2001 is refused; with Hunyuan3D jobs `pending` (with and without an attempt ID), `submitted`, `done`, `failed` and `cancelled`, TRELLIS.2 jobs in the same states, their asset directories, an upload batch, and ComfyUI files seeded only for the Hunyuan3D jobs, a start through `start()` sends the fake a per-job cancel for each Hunyuan3D attempt it holds, then leaves no Hunyuan3D row, no batch without jobs and none of their files, and, read before the first TRELLIS.2 submission, every TRELLIS.2 row and every file under `/data/assets/` and `/data/uploads/` that belongs to a TRELLIS.2 job is byte-identical; a fake that answers the cancel with 500 leaves every Hunyuan3D row in place until a later tick succeeds; a second start sends nothing and deletes nothing; the tracker test asserts every submitted graph uses the TRELLIS.2 node types. Playwright `glossary.spec.ts` asserts the form has no Engine field. `bun test ./app/docs` asserts the README names TRELLIS.2 as the mesh model and does not mention Hunyuan3D or an engine choice. |
| AC-24 | `bun test ./.github` parses every workflow and asserts top-level `permissions: {}`, `defaults.run.shell: bash` and `timeout-minutes` on each job with `steps`; `bats scripts/deploy/tests/verify.bats` runs the verify script's actionlint step with the pinned binary on a fixture directory holding a workflow with an error and asserts it fails, and on `.github/workflows/` and asserts it passes; `bats scripts/deploy/tests/check-repo.bats` asserts a failed installation check (exit 1, the status in the message) when the stubbed `gh` answers 403 or exits non-zero without `ASSET_STUDIO_INSTALLATION_TOKEN`, and a code-scanning call that exits non-zero reported as a failure carrying its error; `bun test ./app/docs` asserts the README's coverage list names JavaScript, TypeScript, Python, Actions, Bash and PowerShell. |

## Tasks

- [x] T1 `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `tsconfig.*.json`, `eslint.config.js`, `.gitignore` - Bun project with strict TypeScript, type-aware ESLint and the React hooks rules at error, the script names Design lists (`bootstrap`, `dev`, `seed`, `verify`, `verify:live`, `clean`, `golden:check`, `size`); `bun run typecheck` and `bun run lint` pass on the empty tree (Design)
      Evidence: `bun run typecheck` (tsc -b over tsconfig.web.json and tsconfig.node.json) and `bun run lint` both exit 0 at this commit; no tests yet.
- [x] T2 `app/pipeline/dump_graphs.py`, `app/pipeline/golden/` - dump helper that loads `scripts/generate_3d.py` by path and the committed golden graphs for the fixed inputs; `bun run golden:check` regenerates them with no diff (AC-01)
      Evidence: `bun run golden:check -- --write` wrote 11 golden cases (2 image, 6 TRELLIS.2, 3 Hunyuan3D); `bun run golden:check` then printed `✓ Passed: golden graphs match scripts/generate_3d.py`; typecheck and lint pass.
- [x] T3 `app/pipeline/graphs.test.ts` - failing tests for the three builders against the golden graphs and for the combiner's renumbering, rewiring, prefix and thumbnail branch; fail because the modules do not exist (AC-01)
      Evidence: `bun test app/pipeline` fails as intended: `error: Cannot find module './graphs.ts'` (0 pass, 1 fail); the builders and combiner do not exist yet.
- [x] T4 `app/pipeline/graphs.ts`, `app/pipeline/combine.ts`, `app/pipeline/presets.ts` - builders, combiner and presets with per-line random seeds; T3 passes (AC-01)
      Evidence: `bun test app/pipeline`: 17 pass, 0 fail (the 15 T3 tests plus 2 seed-rule tests); typecheck and lint pass.
- [x] T5 `app/fake-comfy/` - fake ComfyUI with `/system_stats` (settable version), `/prompt` with client `prompt_id`, `/queue`, `/history`, per-job cancel, `/upload/image`, `/view`, the `/asset-studio-fake` marker, fixture lookup in the data directory per request, and controls for delays, errors, restarts and lost history; its own `bun test app/fake-comfy` passes (AC-03, AC-04, AC-05, AC-06, AC-16)
      Evidence: `bun test app/fake-comfy`: 4 pass, 0 fail (client prompt IDs and outputs with a valid glTF header, 400 rejections, per-job cancel of pending and running with no /interrupt call, restart and version control); typecheck and lint pass.
- [x] T6 `app/server/store.test.ts`, `app/server/config.test.ts` - failing tests for the strict config loader (token format, paths, limits), the schema version guard, `VACUUM INTO` backups only on migration, `restore-backup` with WAL rows and the rollback backup choice; fail because the modules do not exist (AC-15, AC-16)
      Evidence: `bun test app/server` fails as intended: `Cannot find module './config.ts'` and `Cannot find module './store.ts'` (0 pass, 2 fail).
- [x] T7 `app/server/config.ts`, `app/server/store.ts`, `app/server/main.ts` - config loader, SQLite store in WAL mode with schema version 1, backups, and the `schema-version` and `restore-backup` subcommands; T6 passes (AC-15, AC-16)
      Evidence: `bun test app/server`: 8 pass, 0 fail (the T6 config and store tests); `bun app/server/main.ts schema-version` prints `1`; typecheck and lint pass.
- [x] T8 `app/server/api.test.ts`, `app/server/auth.test.ts` - failing API tests for batch validation and limits, the `X-Batch-Id` and canonical hash rules, concurrent and duplicate batches, the JSON and multipart size caps, cookies with issue time, bearer tokens, the trusted-peer rate limit and correct tokens over the limit; fail because the routes do not exist (AC-02, AC-12)
      Evidence: `bun test app/server/api.test.ts app/server/auth.test.ts` fails as intended: `Cannot find module './http.ts'` and `'./auth.ts'` (0 pass, 2 fail).
- [x] T9 `app/server/http.ts`, `app/server/auth.ts`, `app/server/batches.ts` - `Bun.serve` routes, streamed multipart staging, the `BEGIN IMMEDIATE` insert with the in-transaction rename, sessions and the sliding-window limiter; T8 passes (AC-02, AC-12)
      Evidence: `bun test app/server`: 31 pass, 0 fail, including every T8 batch and auth test (200 MiB accepted and 200 MiB plus one byte refused with 413, concurrent limit and duplicate IDs, 30-day cookies, the shared failure budget and correct tokens over the limit); the T8 route-sweep test now gives each route its own forwarded client so the limiter does not mask the 401 it checks; typecheck and lint pass.
- [x] T10 `app/server/tracker.test.ts` - failing tracker tests against the fake for submission order, attempt IDs and prefixes, the 30-second post window, rejections and the three-5xx rule, offline and incompatible ComfyUI, cancels and their races, retries, lost jobs, timeouts, restarts, collection fault injection and the sweep; fail because the tracker does not exist (AC-03, AC-04, AC-05, AC-06)
      Evidence: `bun test app/server/tracker.test.ts` fails as intended: `Cannot find module './comfy.ts'` (0 pass, 1 fail); the tracker and ComfyUI client do not exist yet.
- [x] T11 `app/server/comfy.ts`, `app/server/tracker.ts`, `app/server/collect.ts`, `app/server/sweep.ts` - ComfyUI client, tick loop, collection and cleanup in the ComfyUI folders; T10 passes (AC-03, AC-04, AC-05, AC-06)
      Evidence: `bun test app`: 77 pass, 0 fail on the last three consecutive runs, including all 25 T10 tracker tests; fixes made to the T10 tests during this task: the GLB save node is `136` after the +100 offset, race-prone tests hold the fake until the job is submitted, and the 5xx test pre-assigns its attempt ID; the store now uses `synchronous = NORMAL` with WAL and a test preload raises the default timeout to 60 s, because this host's disk was saturated (load 33, 0.04 s CPU over 5 to 10 s wall time for the store tests); one earlier full run under that load failed two store tests that pass on their own, not reproduced since; typecheck and lint pass.
- [x] T12 `app/server/export.test.ts` - failing tests for asset downloads with slug names, delete, export limits, one-time links, the export recheck redirect and the manifest schema; fail because the routes do not exist (AC-08)
      Evidence: `bun test app/server/export.test.ts` fails as intended: `Cannot find module './export.ts'` (0 pass, 1 fail).
- [x] T13 `app/server/assets.ts`, `app/server/export.ts` - asset routes, delete, streamed zip export; T12 passes (AC-08)
      Evidence: `bun test app/server/export.test.ts`: 10 pass, 0 fail (slug names and Content-Disposition, delete with uploads and ComfyUI cleanup, a one-time link whose zip has six named files and the documented manifest, a reused link 404, 101 assets and over 2 GiB refused with 413, credentials, expiry and the `/?export=gone` redirect with an empty body); `bun test app` all pass; typecheck and lint pass.
- [x] T14 `app/server/seed.ts`, `app/server/seed.test.ts`, `app/cli/dev.ts`, `dev/config.yaml` - `seed` subcommand with fixed fixture UUIDs and profiles, `bun run dev` with readiness, and `bun run clean`; `bun test app/server/seed.test.ts` passes and `bun run dev` prints its ready line within 30 seconds (AC-16)
      Evidence: `bun test app/server/seed.test.ts`: 6 pass (repeatable seed with non-fixture rows kept and reset, refusal of a non-fake ComfyUI, fixture states held past 15 minutes with the seed before and after the fake started, dev token refused without the fake marker, committed dev config loads); `bun run dev -- --check` printed `✓ Ready: http://127.0.0.1:8790 ...` in 2.6 s; `bun run clean` removed .dev-data/; `bun test app` 93 pass; typecheck and lint pass.
- [x] T15 `app/cli/report.ts`, `app/cli/report.test.ts`, `scripts/deploy/lib/report.sh` - shared status reporters with symbols, ASCII mode, `NO_COLOR` and plain non-TTY output; `bun test app/cli` passes (AC-19)
      Evidence: `bun test app/cli`: 4 pass (Unicode and ASCII lines with outcome words, failures on stderr, colour only on a TTY with NO_COLOR absent or empty and none for `0`, `1` or non-TTY); `shellcheck scripts/deploy/lib/report.sh` clean; golden-check, clean, dev, seed, the executable and the fake now print through the reporter; `bun test app` 97 pass; typecheck and lint pass. The unverified `shellcheck` npm wrapper was removed; shellcheck gets a checksum pin with the deploy tools (T21, T22).
- [x] T16 `playwright.config.ts`, `app/e2e/` - failing Playwright projects and specs (`submit`, `queue`, `offline`, `library`, `export`, `layout`, `signin`, `glossary`) with their isolated containers and fixtures; fail because the page does not exist (AC-02, AC-03, AC-04, AC-05, AC-07, AC-08, AC-09, AC-12, AC-18)
      Evidence: `E2E_TARGET=source npx playwright test submit.spec.ts export.spec.ts --project=chromium` fails as intended: the shared stack starts (fake, seed, server ready), then each test times out `waiting for getByLabel('Access token')` because the page does not exist (3 failed before --max-failures). Isolated stacks: signin (own projects and container), offline, offline-empty, library-empty and glossary; the shared stack serves the rest, and mutating specs act only on jobs they create (per-prompt hold and fail controls on the fake).
- [x] T17 `app/web/`, `vite.config.ts` - the React page: sign-in, submit form with presets, queue with health and job polling and 401 handling, library with thumbnails, lazy `<model-viewer>` with retry, downloads and export links, Glossary labels; T16 passes in Chromium and Firefox (AC-02, AC-03, AC-04, AC-05, AC-07, AC-08, AC-09, AC-12, AC-18)
      Evidence: `E2E_TARGET=source npx playwright test`: 33 passed, 1 skipped, in Chromium and Firefox (submit, queue cancel and retry, offline and incompatible banners, library and viewer with a blocked-chunk retry, export, layout at all 9 sizes plus keyboard and reduced motion, glossary, sign-in with token rotation). The skip is the Firefox viewer render: headless Firefox on fedora-43 cannot create a WebGL context (`Exhausted GL driver options`), so the test reports that instead of passing; CI must supply that evidence. Screenshots in .artifacts/screens reviewed at 320x568 and 1440x900 (stacked single column, no clipping or overflow; side-by-side columns on desktop). Changes found while making T16 pass: a public `GET /api/session` probe so the page makes no failing call before sign-in, eager `<model-viewer>` loading scrolled into view, no autofocus on the token field, eager thumbnails, and WebGL prefs for the Firefox projects. Run against the source server; the image run follows T19.
- [x] T18 `app/cli/size.ts`, `app/cli/size.test.ts` - bundle budget check with leak and breach fixtures; `bun run size` passes on the build and its tests fail the two fixtures (AC-13)
      Evidence: `bun run size` on the build: `initial 80.4 KiB, viewer 280.5 KiB (gzip level 9)`, `✓ Passed: bundle budgets met`; `bun test app/cli`: 7 pass, including the size tests that fail a build whose entry imports the viewer statically and one whose modulepreload pushes the initial load over 150 KiB (fixture enlarged from 120 to 180 KiB of random data so it really exceeds the budget after gzip).
- [x] T19 `Dockerfile`, `.dockerignore`, `app/e2e/image.test.ts` - two-stage distroless image with an owned `/data`, build arguments for version and commit; the local start check passes as UID 65532 with a read-only root and a new volume (AC-17)
      Evidence: `docker build -t asset-studio:local --build-arg APP_VERSION=0.0.0-local --build-arg APP_COMMIT=<HEAD>` succeeds (179 MB, oven/bun 1.4.3 trixie builder and distroless cc-debian13:nonroot runtime pinned by digest; ldd shows only glibc, so nothing is harvested); `bun test ./app/image` (in app/image rather than app/e2e, since app/e2e holds Playwright specs): 4 pass (`nonroot:nonroot` and `docker top` UID 65532, read-only root with a real write outside the declared paths failing, schema 1 database created in a fresh named volume and owned by 65532, page with the viewer meta and health reporting 0.0.0-local and the commit); `npx playwright test` against the image: 33 passed, 1 skipped (the Firefox WebGL render, as in T17). The harness now removes container-owned files through a throwaway container. Unit step: `bun test app` with all three `--path-ignore-patterns` (the flag replaces the bunfig list) 100 pass.
- [x] T20 `app/memory/memory.test.ts` - memory tests against the built image under `--memory 1g`; `bun test ./app/memory` passes with no OOM kill and `anon` below 512 MiB (AC-20)
      Evidence: `bun test ./app/memory` against asset-studio:local under `--memory 1g`: first run failed, the container was OOM-killed (`true false 137`) during the 100-asset export, because the zip stream enqueued every chunk from `start()` without backpressure; fixed by a pull-based zip stream and by pausing uploads until the file drains; after rebuilding, 1 pass with `OOMKilled` false and `› peak anonymous memory 42.0 MiB` (sampled every 100 ms from the container's cgroup memory.stat on the host) across a 200 MiB batch, two concurrent 200 MiB batches and a 1.5 GiB export of sparse files; unit suite 100 pass.
- [x] T21 `scripts/verify.sh`, `package.json` - `bun run verify` in the Design order, including `bats scripts/deploy/tests` and `shellcheck scripts/deploy`; it passes end to end on a clean checkout (AC-01 to AC-09, AC-12, AC-13, AC-16 to AC-21)
      Evidence: `bun run verify` exits 0 end to end in the Design order (type check, lint, shellcheck with the pinned 0.11.0 binary, unit tests 100 pass, golden check, page build, bundle budgets 80.4/280.5 KiB, image build, image start check 4 pass, memory check peak 46.5 MiB, dev readiness, browser journeys 33 passed and 1 skipped); the workflow tests, bats tests and docs check report `∅ Skipped` until T22 to T24 add them. The first full run failed the keyboard journey, which pressed Tab while the page still showed its loading state; the test now waits for the sign-in form first and passed three runs in a row. Tool pins (shellcheck, cosign, gh) with SHA-256 checksums live in scripts/deploy/tools.env and download through scripts/deploy/lib/tools.sh.
- [x] T22 `scripts/deploy/` - `compose.yaml`, `deploy.sh`, `rollback.sh`, `check-image.sh`, `check-repo.sh`, `start-asset-studio.ps1`, `tools.env` and `bats` tests with stubbed `docker`, `ssh` and `gh`; `bats scripts/deploy/tests` passes (AC-14, AC-15, AC-17, AC-19)
      Evidence: `bunx bats scripts/deploy/tests`: 19 ok, 0 skipped, with stubbed docker, ssh, scp, gh and cosign recording every call (deploy order with Docker Desktop ensured before `docker load`, the exact cosign identity regexp and issuer, provenance and SPDX attestation checks, tagging, layer comparison, prepare with and without `-RotateToken`, bounded health; stops for Docker not answering, a missing release record, failed signature or attestation, different layers and health timeout; rollback without a previous version, with the image present, with a reload after verification, without a release record and without a matching backup; check-image for a missing record and a failed anonymous pull; the shell reporter's words, ASCII mode, no colour when redirected for NO_COLOR unset, empty, 0 and 1, and colour on a real pty only for unset or empty); shellcheck 0.11.0 clean on every script. check-repo.sh and the PowerShell steps on win-main are exercised for real in T26.
- [x] T23 `.github/workflows/`, `.github/tests/ci.test.ts`, `renovate.json` - `ci.yml` (checks, version, release), `preview.yml`, CodeQL and Scorecard callers, Renovate config; `bun test ./.github` passes (AC-14, AC-17)
      Evidence: `bun test ./.github`: 6 pass (release job needs version and runs only for a pushed tag with the stated permissions; the record step follows the release action with no always(), failure(), cancelled() or continue-on-error; the required security profile and build arguments; no other step creates a release or writes release.json; every external action and reusable workflow pinned to a 40-character commit; the Renovate custom manager matches all three tool pins with their SHA-256); shellcheck clean on scripts/ci; lint and typecheck pass. Pins: checkout v7.0.1 3d3c42e, setup-bun v2.2.0 0c5077e, upload-artifact v7.0.2 cf430e0, version-workflow v0.1.2 46a1ac9, docker-release-action v2 c499e52, vhco-pro/.github main e03ad61. The workflows run for real once pushed (T26).
- [x] T24 `README.md`, `AGENTS.md`, `LICENSE`, `app/docs/docs.test.ts` - commands, readiness, dependencies, owner checklist, terminal-output route and Apache-2.0 licence; `bun test ./app/docs` passes (AC-14, AC-21)
      Evidence: `bun test ./app/docs`: 6 pass (README.md and AGENTS.md each name the seven commands and every named `bun run` script and script path exists; the README lists Bun, Docker and python3, the `✓ Passed: ready at` signal and the share and `autogroup:shared` port 443 checklist items; AGENTS.md links conventions/terminal-output.md and no longer says no commands exist); LICENSE is GitHub's apache-2.0 text with `Copyright 2026 VH & Co BV`.
- [x] T25 `app/cli/verify-live.ts` - live check of two real generations and the polled ComfyUI cleanup; runs against a deployed app (AC-11)
      Evidence: 2026-11-22 `bun run verify:live` against .4 passed: both real generations done, textured GLB checked, ComfyUI folders cleaned (AC-11).
- [x] T27 `Dockerfile` - runtime on `gcr.io/distroless/base-nossl-debian13:nonroot` at the recorded digest; `bun test ./app/image` passes and Trivy 0.69.3 reports no HIGH or CRITICAL finding (AC-17); do before T26
      Evidence: Dockerfile runtime now `gcr.io/distroless/base-nossl-debian13:nonroot@sha256:89815d62...`; rebuilt asset-studio:local; `bun test ./app/image` 4 pass; `aquasec/trivy:0.69.3 image --severity HIGH,CRITICAL --exit-code 1 asset-studio:local` reports 0 findings for debian 13.7.
- [x] T28 `.github/workflows/ci.yml`, `app/e2e/library.spec.ts` - install Mesa in the checks job and set `E2E_REQUIRE_WEBGL=1` so a missing WebGL context fails; the Firefox viewer render passes in CI (AC-07); do before T26
      Evidence: CI run 44991050480 at 7580523: checks, version and release succeeded; the browser suite had 34 passed and 0 skipped, and .artifacts/webgl.log reported `webgl-renderer firefox: llvmpipe, or similar`, so the Firefox viewer render ran with `E2E_REQUIRE_WEBGL=1`. Mesa alone (run 44990314907) still failed the render, as R-11 F-01 anticipated; in the Playwright noble image Firefox got WebGL only under `xvfb-run` (2 passed), so the checks job installs xvfb and Mesa and runs `xvfb-run -a bun run verify`. The Design's CI sentence names Mesa and the requirement but not xvfb-run; recorded here for the next revision.
- [x] T29 `app/server/http.ts`, `app/server/auth.test.ts` - `GET /api/session` judges the cookie alone and never counts failures; the AC-12 session tests pass (AC-12); do before T26
      Evidence: Test first: the new `GET /api/session` test in `app/server/auth.test.ts` failed (`{signedIn: true}` for a valid bearer token); after the change `bun test app/server/auth.test.ts` 6 pass: no cookie, a forged cookie and a valid bearer token answer `{signedIn: false}`, a valid cookie `{signedIn: true}`, all with 200, and twelve calls each with a wrong bearer token, a forged cookie and an expired cookie (clock advanced 31 days) leave the next wrong sign-in at 401; typecheck and lint pass.
- [x] T30 `docs/internal/plans/asset-studio.md` - manual check at 200 percent browser zoom in Chromium on a 1280x720 window over the sign-in, submit, queue and library journeys, with screenshots, plus a review of every layout screenshot in .artifacts/screens; the result recorded under AC-09 (AC-09); do before T26
      Evidence: 200 percent zoom check on the dev stack in headless Chromium, method: Chromium's page zoom maps a 1280x720 window to a 640x360 CSS viewport at device scale factor 2, so the page ran at that viewport and scale (Playwright cannot press the browser's zoom keys headless); sign-in and main view had 0 px horizontal overflow, Generate sat inside the viewport (574 x 40 px at x 33) and submitting `zoom check crate` showed `1 job added`; screenshots in .artifacts/zoom (signin, main, main-viewport) reviewed: readable, single column, nothing clipped. Reviewed every layout screenshot in .artifacts/screens from the last full run (9 sizes, sign-in and main each): no overflow, clipping or overlap; one cosmetic note, the New batch panel stretches to the column's full height on desktop widths, leaving empty space below Generate.
- [x] T26 `docs/internal/plans/asset-studio.md` - deploy the feature-branch prerelease to `win-main` and run the AC-10, AC-11, AC-12 deployed and AC-15 procedures, plus `check-image.sh` and `check-repo.sh`; evidence recorded under each criterion (AC-10, AC-11, AC-12, AC-14, AC-15, AC-17)
      Evidence: Deployed prereleases .2, .3 and .4 to win-main on 2026-11-22 with deploy.sh (after fixes b6bfa82/f86b113 for Windows PowerShell 5.1 and 6527af5 for Windows subfolders); AC-10, AC-11, AC-12 deployed and AC-15 procedures passed and are recorded under each criterion; check-image.sh passed for .2 and .4; check-repo.sh passes every pre-merge item and fails only the items AC-14 checks after the first merge (licence detection, CodeQL/Scorecard runs on main, renovate.json on main, Renovate activity).
- [x] T32 `scripts/deploy/check-repo.sh`, `scripts/deploy/tests/check-repo.bats` - list the repository in the `vhco-renovate` installation, require an Actions analysis, and filter code-scanning analyses by `ref=refs/heads/main`; bats with a stubbed `gh` fails a feature-branch-only analysis (AC-14, R-12 F-01); do before T31
      Evidence: `bunx bats scripts/deploy/tests/check-repo.bats`: 4 tests failed against the previous script and pass now (pull-request-only analyses fail both analysis checks, the query uses ref=refs/heads/main, an installation without the repo fails, a token that cannot list it skips); full bats suite 23 ok; shellcheck clean. Real run before merge: both main analysis checks fail as expected, and the installation check skips because this gh token gets HTTP 403 listing installation repositories.
- [x] T33 `app/e2e/layout.spec.ts` - at every size, submit a prompt and open the preview before the layout check and screenshot; the spec passes in Chromium (AC-09, R-12 F-02)
      Evidence: `E2E_TARGET=source npx playwright test layout.spec.ts --project=chromium`: 11 passed; each of the 9 sizes now also submits a prompt (`1 job added`) and opens the preview panel, running the layout check and saving `-submitted` and `-preview` screenshots; reviewed 320x568-preview.png: single column, no clipping, preview panel below the library.
- [x] T34 `app/server/batches.ts`, `app/server/tracker.test.ts` - a fault hook between the uploads rename and the commit; a test kills there, restarts through `start()` and finds the orphan swept, and a sweep test removes a cancelled job's leftover ComfyUI output (AC-06, R-12 F-03)
      Evidence: `bun test app/server/tracker.test.ts`: 28 pass. The kill test failed without the hook (the batch answered 201) and passes with `faults.afterRename` throwing inside the transaction: no job rows, the uploads directory remains, and a restart through `start()` sweeps it. The cancelled-job sweep test passed on first run (it covers existing code at tracker.ts:351 that had no test). Unit suite 110 pass; typecheck and lint clean.
- [x] T35 `scripts/deploy/check-upgrade.sh`, `scripts/deploy/tests/check-upgrade.bats` - runs the AC-15 win-main procedure for two given versions (deploy, rerun, image removal and rollback, compose down and image removal with the logon task) and writes each step's observed values to `.artifacts/check-upgrade.log`, so a reviewer can rerun it; bats with stubs pass (AC-15)
      Evidence: `bunx bats scripts/deploy/tests/check-upgrade.bats`: 5 ok (full procedure passes and logs, a config rewrite fails, a rerun dropping the previous version fails, no logon recovery fails, missing versions exit 2); full bats suite 28 ok, shellcheck clean, docs test 6 pass. The real run on win-main is T36.
- [x] T36 `docs/internal/plans/asset-studio.md` - rerun `bun run verify:live` and `scripts/deploy/check-upgrade.sh` against the latest prereleases and record the results; the next implementation review is dispatched with permission to run both (AC-11, AC-15)
      Evidence: check-upgrade.sh .5 to .6 and verify:live against .6 both passed on 2026-11-22 (evidence under AC-11 and AC-15); the follow-up review is dispatched with permission to rerun both.
- [x] T31 `docs/internal/plans/asset-studio.md` - after merge, deploy the release image from `main` with `deploy.sh` and repeat the AC-10 check; the result recorded under AC-10 (AC-10)
      Evidence: 2026-11-22 after merge e1d8e1e: `scripts/deploy/deploy.sh 0.1.0` passed (release record sha256:e3560222..., signature and attestations verified, layers matched, serving through tailscale serve); from fedora-43 /api/health returned `0.1.0` at e1d8e1e4e5bb with ComfyUI reachable, and ports 8790 and 8188 on win-main's tailnet address timed out.
- [ ] T37 `app/pipeline/graphs.ts`, `app/pipeline/combine.ts`, `app/pipeline/presets.ts`, `app/pipeline/dump_graphs.py`, `app/pipeline/golden/`, `app/pipeline/graphs.test.ts`, `README.md`, `app/docs/docs.test.ts` - remove the Hunyuan3D builder, its golden cases and the engine preset, and the README's engine wording, with the docs assertion; `bun test app/pipeline` and `bun run golden:check` pass (AC-01, AC-23)
- [ ] T38 `app/server/batches.ts`, `app/server/jobs.ts`, `app/server/export.ts`, `app/server/api.test.ts`, `app/server/export.test.ts`, `app/web/App.tsx` - presets without an engine, the 400 for a non-`trellis` engine, prompts up to 2000 characters on server and page, manifest `engine` always `trellis`; tests written first fail, then pass (AC-23, AC-08)
- [ ] T39 `app/server/tracker.ts`, `app/server/main.ts`, `app/server/tracker.test.ts` - the start purge (cancel each known Hunyuan3D attempt, then delete Hunyuan3D jobs and empty batches) and the sweep of asset directories without a row; the AC-23 purge tests fail first, then pass (AC-23, AC-06)
- [ ] T40 `app/server/seed.ts`, `app/server/seed.test.ts`, `app/fake-comfy/`, `app/cli/verify-live.ts`, `app/memory/memory.test.ts` - TRELLIS.2-only fixtures and fake outputs, and the live check's second job at 20k with 1024 textures; seed and memory tests pass (AC-16, AC-11, AC-20)
- [ ] T41 `app/e2e/style.spec.ts`, `app/e2e/layout.spec.ts`, `app/e2e/glossary.spec.ts` - the VH Midnight style checks, the contrast measurement and the missing Engine field; they fail against the current page (AC-22, AC-09, AC-18, AC-23)
- [ ] T42 `app/web/styles.css`, `app/web/App.tsx`, `app/web/Viewer.tsx`, `app/web/index.html`, `app/web/api.ts`, `app/e2e/` - the restyled page: tokens, header, sign-in card, composer column, queue rows, gallery, preview dialog; the Playwright suite passes in Chromium and Firefox and `bun run size` stays within budget (AC-22, AC-07, AC-09, AC-13, AC-18)
- [ ] T43 `docs/internal/plans/asset-studio.md` - the design review of the rendered page with the pinned Vercel rules at the viewport matrix, screenshots reviewed, result recorded (AC-22, AC-09)
- [ ] T44 `docs/internal/plans/asset-studio.md` - PR with the before-and-after record at `refs/pr-visuals/<number>`; prerelease deployed to `win-main` with `deploy.sh`, then the AC-10 check, `bun run verify:live`, the AC-12 deployed check and `scripts/deploy/check-upgrade.sh` between two prereleases of this revision; results recorded (AC-10, AC-11, AC-12, AC-15, AC-17, AC-22, AC-23)
- [ ] T45 `docs/internal/plans/asset-studio.md` - after merge, deploy the release from `main` and repeat the AC-10 check; after the owner adds the repository to the `vhco-renovate` installation (#4), re-add it to `vhco-pro/renovate-runner`'s targets with a dry run first and rerun `check-repo.sh` (AC-10, AC-14)
- [ ] T46 `.github/workflows/`, `.github/tests/ci.test.ts`, `scripts/deploy/tools.env`, `scripts/deploy/lib/tools.sh`, `scripts/verify.sh`, `scripts/deploy/tests/verify.bats` - workflow permissions, bash default shell and job timeouts; pinned actionlint in verify; the workflow tests fail first, then pass (AC-24)
- [ ] T47 `scripts/deploy/check-repo.sh`, `scripts/deploy/tests/check-repo.bats`, `README.md`, `app/docs/docs.test.ts` - fail-closed installation check with `ASSET_STUDIO_INSTALLATION_TOKEN`, and API errors reported as failures; the coverage list in the README; bats and docs tests fail first, then pass (AC-24, AC-14)

## Open Questions

None.

## Review Log

| Date | Review | Kind | Commit | Model | Isolation | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | R-1 | spec | `79aed7b` | claude-opus-5-5 | procedural | 1 blocking, 18 should-fix, 1 nit |
| 2026-11-21 | R-2 | spec | `b6d68e3` | claude-opus-5-5 | procedural | 1 blocking, 20 should-fix, 3 nits |
| 2026-11-21 | R-3 | spec | `0a8d589` | claude-opus-5-5 | procedural | 2 blocking, 14 should-fix, 3 nits |
| 2026-11-21 | R-4 | spec | `093c118` | claude-opus-5-5 | procedural | 1 blocking, 18 should-fix, 3 nits |
| 2026-11-21 | R-5 | spec | `7ed1b66` | claude-opus-5-5 | procedural | 0 blocking, 10 should-fix, 5 nits |
| 2026-11-21 | R-6 | spec | `945c51a` | claude-opus-5-5 | procedural | 2 blocking, 6 should-fix, 2 nits |
| 2026-11-21 | R-7 | spec | `5d41ca9` | claude-opus-5-5 | procedural | 1 blocking, 10 should-fix, 2 nits |
| 2026-11-21 | R-8 | spec | `b810be8` | claude-opus-5-5 | procedural | 3 blocking, 11 should-fix, 4 nits |
| 2026-11-21 | R-9 | spec | `2768304` | claude-opus-5-5 | procedural | 0 blocking, 10 should-fix, 1 nit |
| 2026-11-21 | R-9 | spec | `2768304` | n/a | n/a | accepted by owner |
| 2026-11-22 | R-10 | spec | `c2dbee2` | claude-opus-5-5 | procedural | 0 blocking, 6 should-fix, 2 nits |
| 2026-11-22 | R-11 | spec | `5400611` | claude-opus-5-5 | procedural | 0 blocking, 4 should-fix, 1 nit |
| 2026-11-22 | R-11 | spec | `5400611` | n/a | n/a | accepted by owner |
| 2026-11-22 | R-12 | implementation | `81b4b51` | claude-opus-5-5 | procedural | 18 met, 1 not met (AC-14, after merge), 2 not verified (AC-11, AC-15: live procedures not rerun by the read-only reviewer); 0 blocking, 3 should-fix, 3 nits |
| 2026-11-22 | R-13 | implementation | `b54bca4` | claude-opus-5-5 | procedural | 20 met, 1 not met (AC-14, after merge); 0 blocking, 1 should-fix, 2 nits |
| 2026-11-22 | R-14 | spec | `adeab21` | claude-opus-5-5 | procedural | 0 blocking, 15 should-fix, 5 nits |
| 2026-11-22 | R-15 | spec | `e0f334f` | claude-opus-5-5 | procedural | 1 blocking, 7 should-fix, 4 nits |

### R-1

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Jobs and batches (line 210); Design > ComfyUI client (lines 188-189); Design > Submission, concurrency and idempotency (tracker step 4 line 239 and the client_id adoption paragraph lines 249-252); Design > Cancel, retry and delete (lines 265-266); AC-05; AC-06; Test Plan rows AC-05 and AC-06
EVIDENCE: Every `/prompt` call sends `client_id` = `asset-studio:<job id>`, which stays the same for the whole life of the job. Before it submits any `pending` job, the tracker looks for that client_id in `/queue` and history entries and adopts any prompt it finds. Retry (line 265) puts a `failed` or `cancelled` job back to `pending` under the same job ID. ComfyUI keeps the failed, interrupted or timed-out prompt in its history (server.py `get_history` on win-main, ComfyUI 0.46.2), so the next tick adopts that old prompt, step 3 sees its error status, and the job goes straight back to `failed` without anything new being submitted. The rule at line 239 has the same problem: it returns a job whose output files are gone to `pending`, adoption finds the old successful history entry, collection fails again, and after two rounds the job fails without ever being resubmitted. The AC-05 retry proof only checks "retry keeps preset values and seed", so a fake that does not keep history would let this bug pass. The ComfyUI on win-main also accepts a client-supplied `prompt_id` UUID on POST /prompt (the `client_prompt_id = json_data.get("prompt_id")` branch in post_prompt, route at server.py:1164), which allows a simpler and exact design.
PROPOSAL: Give each submission attempt its own identity. The best option is a fresh UUID `prompt_id` that the app stores on the row before it calls POST /prompt and then looks up by ID. The alternative is a client_id carrying an attempt number. Add retry-after-failure and retry-after-interrupt cases to the AC-05 and AC-06 proofs, with the fake keeping the earlier prompt in its history and receiving a new `/prompt` call.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (tracker step 1, line 228 onward); Design > ComfyUI client (line 188); AC-03; Test Plan row AC-03
EVIDENCE: Step 1 only says what happens when ComfyUI is unreachable. On win-main, POST /prompt returns HTTP 400 with `error` and `node_errors` when the graph fails validation, for example a missing model or node (post_prompt in server.py). The document only says "a non-2xx answer ... becomes a typed error" and never gives the job's resulting state. Two implementers could leave the job `pending` and resubmit it every 2 seconds forever, or stop the whole submission loop at that job, or fail it. An upload failure on an image job is just as undefined. AC-03 covers only errors that come back through history.
PROPOSAL: State that a 4xx rejection from /prompt or /upload/image marks the job `failed` with ComfyUI's error text and the tracker moves on to the next job, while timeouts and 5xx keep the job `pending`. Add a fake rejection case to the AC-03 tracker test.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Cancel, retry and delete (lines 260-263); Design > ComfyUI client (`/interrupt`); tracker step 5 (line 240); AC-05; Test Plan row AC-05
EVIDENCE: The design reads `/queue`, checks that the running prompt is the job's own, and only then calls `/interrupt`. A prompt that finishes between those two calls lets the next prompt start, which may belong to the owner's Comfy Desktop, and a bare `/interrupt` is global ("Global interrupt (no prompt_id specified)", post_interrupt in server.py on win-main). The installed ComfyUI 0.46.2 offers `/interrupt` with a `prompt_id` body and also `POST /api/jobs/{job_id}/cancel`, whose `interrupt_if_running` is documented in the code as "Atomic: only interrupts if the job is still the one running". The ComfyUI client's endpoint list includes neither form. A fake that answers `/queue` and `/interrupt` in strict sequence cannot expose this race, so the AC-05 proof passes on the racy implementation.
PROPOSAL: Specify a targeted cancel, either `POST /api/jobs/<prompt id>/cancel` or `/interrupt` with `{"prompt_id": ...}`, for both user cancel and the 15-minute timeout. Make the AC-05 proof assert that the fake receives the prompt ID in the interrupt request.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Access token (line 289, "10 per minute per client address"); AC-12; Test Plan row AC-12
EVIDENCE: The server listens on 127.0.0.1 behind `tailscale serve`, so every request the deployed app receives comes from the loopback address. Tailscale 1.104.4 (the version on win-main) carries the real source in a header: `ipn/ipnlocal/serve.go:1150` `r.Out.Header.Set("X-Forwarded-For", c.SrcAddr.Addr().String())`. The document never says which address is the client address. Keyed on the socket address, one wrong-token loop would lock out the owner and the friend together. The AC-12 test runs without the proxy, so it passes either way.
PROPOSAL: Say that the limiter keys on `X-Forwarded-For` only when the socket peer is loopback, and on the socket address otherwise. Add an AC-12 test showing that two different forwarded addresses get separate budgets.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > HTTP API (line 309, 20 MB per image); Design > Jobs and batches (25 jobs per batch, line 193 onward); Design > Runtime and layout (`Bun.serve`); AC-02; Test Plan row AC-02
EVIDENCE: With 25 images of up to 20 MB each, one valid multipart batch can be 500 MB. Bun's default `maxRequestBodySize` is 128 MB (`packages/bun-types/serve.d.ts:844` "@default 1024 * 1024 * 128 // 128MB"). Bun refuses a larger body before the handler runs, so a batch that satisfies every stated limit gets a bare error and no message. That conflicts with AC-02's "rejected with a message" behaviour for invalid batches and with accepting valid ones. The AC-02 proofs only use one oversized file, so they cannot catch it.
PROPOSAL: Set a request body limit that matches the batch limits, or cap the total batch size and state that cap. Add an AC-02 case for a maximal valid image batch, and one just over the total cap that is rejected with the app's message.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (lines 215-220); Design > Jobs and batches (lines 193-196); Design > Cancel, retry and delete (line 266, "Retry counts toward the 100 unfinished jobs limit"); AC-02; Test Plan row AC-02
EVIDENCE: The design validates the batch, including the 100-unfinished check, writes the image bytes, and only then commits. Several cases are undefined. Two concurrent batches can both pass the check across the async gap and together go over 100. Two concurrent requests with the same batch ID can both write files, and one then fails on the unique key: does it return the existing batch or a 500? A repeat with the same ID but different content is not covered. Files written by a request whose transaction fails, or by a duplicate request, are left orphaned. Line 266 does not say whether a retry that would exceed 100 is refused, or with what message. The AC-02 proof only tests a sequential repeat.
PROPOSAL: Run the limit check and the insert in one immediate transaction. Write uploads to a staging path and move them into place only after the commit, deleting them otherwise. Define the response to a concurrent duplicate ID and to a retry that hits the limit, and add concurrent-request cases to the AC-02 tests.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: Design > Jobs and batches (job row, line 210); tracker step 1 ("oldest first", line 228); tracker step 5 (line 240); Design > HTTP API (`GET /api/jobs`, "newest first", line 300); Design > Export (line 324, "creation time"); Design > Submission, concurrency and idempotency (line 222, "mark intent")
EVIDENCE: The listed job row fields are batch, preset values, seed, prompt text or upload name, prompt ID, resubmission count and error message. They include no creation time and no running-since time, yet ordering, the 15-minute timeout and the manifest's creation time all depend on timestamps. Handlers "mark intent (cancel, retry, delete)", but no state or column holds a pending cancel of a `submitted` job, and nothing says which wins if the tracker finds that job finished in history before it acts on the cancel.
PROPOSAL: Add created, submitted and started timestamps and a cancel-requested marker to the row definition. State that a cancel request loses to a completion already in history, or the reverse, and add that race to the AC-05 tests.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (collection paragraph, lines 245-247); AC-06; Test Plan row AC-06 (fault-injection sentence)
EVIDENCE: Design downloads "each file ... to a temporary name and renamed into place", so after the first rename one file is already at its final path. The AC-06 proof "kills the server between the two file writes and asserts ... no file at the final path until the next tick completes". If "the final path" means either file, a correct per-file rename fails the proof. If it means only the second file, the proof says nothing about the first. Two implementers would read and build this differently.
PROPOSAL: Either stage both files in a temporary directory and rename the directory once, or change the proof to assert no `done` row and no partial file at either final path, with a complete first file allowed.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Pipeline port and combined graphs (lines 158-161); AC-11; Test Plan row AC-11
EVIDENCE: "ComfyUI loads and unloads models per node within a prompt the same way it does across prompts" has no citation, though Design must cite its claims. ComfyUI keeps a prompt's node outputs, including loaded model objects, until the prompt ends, while the script runs the image and mesh graphs as two separate prompts (scripts/generate_3d.py:226 and :236). The document names AC-11 as the check that the combined prompt fits the 16 GB card (HANDOFF.md:23, 32 GB RAM; win-main system_stats showed ram_total 34039816192). Yet the AC-11 proof runs only 5k detail and 1024 textures, while the defaults are 10k and 2048, and it never runs Hunyuan3D. The proof can pass while a default job fails with out-of-memory.
PROPOSAL: Run the live check at the default preset (TRELLIS.2, 10k, 2048) and with one Hunyuan3D job, or cite evidence for the memory claim. Otherwise state the limitation in the criterion.

FINDING: F-10
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Access token (line 284, "never prints or copies it off win-main"); Context > Owner summary (line 38, "signs in once with a shared access token"); Test Plan row AC-11 ("with the token read on win-main")
EVIDENCE: The live check runs against the deployed URL from another machine with "the token read on win-main", which means the token leaves win-main even though the design says it is never copied off. No section says how the friend receives the token, or how the owner rotates it, although changing the token is mentioned as the way to sign every browser out.
PROPOSAL: Define how the token is handed over and rotated, for example the owner reads `config.yaml` over SSH and passes it out of band, and how `verify:live` gets the token without storing it. Make the deploy script statement agree with that.

FINDING: F-11
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (line 350, seed fixture); Scope (seed command bullet); Test Plan row AC-07 ("on the seeded fixture")
EVIDENCE: conventions/frontend-testing.md lines 69-72 say default seeds "must be inert ... Inspect the workers that consume seeded rows and satisfy their lifecycle preconditions". The seed creates `submitted` jobs, but the tracker treats any `submitted` job whose prompt ID ComfyUI does not know as lost and resubmits it (tracker step 4). Against the fake, the fixture's submitted jobs change state on their own. Against a real ComfyUI, seeding queues real GPU work. The document also does not say how a rerun avoids duplicate rows (frontend-testing.md lines 61-64) or which ownership boundary a reset uses.
PROPOSAL: Define how seeded `submitted` jobs stay stable, for example the fake preloads matching queued prompts or the seed refuses a non-fake ComfyUI URL. Give the seed stable IDs and an idempotent rerun, and add a check for both.

FINDING: F-12
KIND: factual
SEVERITY: should-fix
WHERE: Context > Owner summary (line 49, "Playwright journeys in Chromium and Firefox across a viewport matrix"); Test Plan rows AC-09 (Chromium only), AC-12 (`signin.spec.ts`, no browser named), AC-02, AC-03, AC-05; Design > Page (line 315)
EVIDENCE: The owner summary promises Chromium and Firefox across the viewport matrix, but the AC-09 row runs only Chromium. frontend-testing.md lines 103-105 require Firefox for sign-in and cookies, and react.md line 167 requires both engines for authentication, storage and file transfer, yet the AC-12 sign-in and AC-08 download journeys name no Firefox run. frontend-testing.md lines 88-89 require an unseeded or empty-state scenario next to the populated one. The seed has an empty profile, but no Test Plan row uses it.
PROPOSAL: Make the summary match the plan. Run the sign-in, cookie and download journeys in Firefox, and add an empty-library scenario to a named spec.

FINDING: F-13
KIND: factual
SEVERITY: should-fix
WHERE: Acceptance Criteria (no criterion); Design > Page; Design > Runtime and layout (`@google/model-viewer`, React, TanStack Query)
EVIDENCE: conventions/react.md lines 96-99: "For changes to routes, shared providers, dependencies, or visible assets, include client delivery cost in the acceptance criteria ... For a new application, record the initial budget and measurement conditions instead." This is a new React application that adds a 3D viewer dependency, and no criterion or Test Plan row records an initial budget or measurement conditions.
PROPOSAL: Add a criterion that records the initial entry budget and its measurement conditions, for example with the viewer loaded only when an asset is selected, and add a Test Plan row that measures the built output.

FINDING: F-14
KIND: factual
SEVERITY: should-fix
WHERE: Design > Repository and CI (lines 342-346); Context > Owner summary (repository paragraph); Scope (CI bullet)
EVIDENCE: The repository becomes public. conventions/repository-security.md (Public repositories) requires the dependency graph, Dependabot alerts, secret scanning, push protection, the CodeQL workflow covering TypeScript and GitHub Actions, and Scorecard with `publish_results: true`, "in the same change of visibility". conventions/delivery.md (Pinning and updates) names managed Renovate as the updater, and every dependency must be discoverable by it. The document mentions only `bun run verify` and SHA pinning, and no criterion covers repository settings.
PROPOSAL: Add the public-repository security workflows, settings and updater to Scope and Design, together with a criterion and a proof such as a `gh api` check after the repository is created, or record which of these the owner handles.

FINDING: F-15
KIND: judgement
SEVERITY: should-fix
WHERE: Context > Owner summary (authorization paragraph); Design > Build, deployment and exposure; AC-10; AC-11
EVIDENCE: Acceptance authorizes "merging the feature PR once CI and an independent implementation review pass, and deploying to win-main". The implementation review must see AC-10 and AC-11 met, and both need the deployed app, so deployment has to happen from the feature branch before merge. The document never says this, and never says which artifact is deployed (a local build or the CI workflow artifact). conventions/delivery.md (Feature delivery, "Prove the real release path") requires naming each artifact and the path that builds and publishes it.
PROPOSAL: State that the CI-built `asset-studio.exe` from the feature branch head is deployed before the implementation review, then redeployed from `main` after merge, or give whatever order is intended, and name that path as the release path.

FINDING: F-16
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (lines 274-279); Design > Build, deployment and exposure (deploy.sh, line 333 onward); Acceptance Criteria (no criterion)
EVIDENCE: Several deployment behaviours have no criterion or Test Plan row: running deploy.sh again keeps the existing token and data, it stops the task before swapping the exe, it leaves `asset-studio.previous.exe` behind, and it backs up the database before migrating. The rollback procedure is prose with no script or check. It also leaves undefined what happens to asset files and ComfyUI prompts of jobs created after the backup, and whether an older executable refuses a database with a newer schema version. Running the deploy again and overwriting the token would sign the friend out without anyone noticing.
PROPOSAL: Add a criterion that a second deploy keeps the token, data and the previous executable, with a proof such as running deploy.sh twice and comparing the config hash. Specify that the app refuses to start on a newer schema version.

FINDING: F-17
KIND: factual
SEVERITY: should-fix
WHERE: Frontmatter `covers`; Design > Pipeline port and combined graphs (golden check); Test Plan row AC-01
EVIDENCE: `bun run golden:check` loads `scripts/generate_3d.py` under `python3 -I` and fails on any difference, so a change to that script changes the AC-01 result. The convention says "`covers` lists every path whose change can affect the feature", but `covers` does not list `scripts/generate_3d.py`, so freshness and `feature_tree_clean` ignore changes to it.
PROPOSAL: Add `scripts/generate_3d.py` to `covers`, plus any root build configuration the feature reads that lives outside `app/`, such as a Vite or bunfig file.

FINDING: F-18
KIND: judgement
SEVERITY: should-fix
WHERE: Scope (README bullet, line 111); Design > Verification commands; Open Questions
EVIDENCE: AGENTS.md:21 says "No build or test commands exist yet." frontend-testing.md lines 28-29 require that "The repository's README and agent instructions name the commands to bootstrap, seed, run, verify and clean". The document puts only the README in scope, so after the feature AGENTS.md would be out of date. A change to the repository instructions has to be an owner decision, not something assumed.
PROPOSAL: Raise an Open Question on updating the AGENTS.md "Local commands and constraints" section with the new commands as part of this feature, and add AGENTS.md to Scope if the owner agrees.

FINDING: F-19
KIND: factual
SEVERITY: should-fix
WHERE: Design > Page (lines 315-316); AC-04; Test Plan row AC-04
EVIDENCE: The queue query polls only "while any job is unfinished and stops when none are", and the document defines no separate health poll. With no unfinished jobs, the page never learns that ComfyUI went offline, and it never shows jobs that another user submitted. AC-04 requires the page to show ComfyUI offline, but `offline.spec.ts` runs with jobs pending and submitted, so it passes on that implementation.
PROPOSAL: Specify a health query (and a slower list refresh) that keeps polling while the page is open, and add an AC-04 Playwright case with no unfinished jobs.

FINDING: F-20
KIND: factual
SEVERITY: nit
WHERE: Design > Pipeline port and combined graphs (presets table, Seed row, line 172)
EVIDENCE: "seed of the first variant; variant n uses seed + n" does not say whether n starts at 0 or 1. If the first variant is n = 1, it gets seed + 1, which contradicts "seed of the first variant".
PROPOSAL: Say "variant k, counted from 0, uses seed + k modulo 2^32".

### R-2

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Submission, concurrency and idempotency (lines 256-258); Design > Jobs and batches (lines 220-223); Context > Owner summary (lines 47-48); AC-02; Test Plan row AC-02
EVIDENCE: Design says "The handler rejects a request whose `Content-Length` is above 200 MB with a 413", and the AC-02 proof requires "a 25-image batch at 200 MB accepted". A multipart body carries boundaries, part headers and the batch ID and preset fields as well as the image bytes. A batch holding exactly 200 MB of images therefore has a `Content-Length` above 200 MB. An implementation that follows the Design returns 413 for it, so the proof fails a correct implementation. The document also never says whether MB means 10^6 or 2^20 bytes, and the boundary cases ("at 200 MB", "just over 200 MB", 20 MB per image) depend on that. This traces to the fix for R-1 F-05.
PROPOSAL: Apply the 200 MB limit to the total image bytes the handler or the page counts, and set the `Content-Length` pre-check to that limit plus a stated allowance for multipart overhead (or drop it in favour of the 256 MB body limit). Define MB once, in Design, and use that unit in the AC-02 boundary cases.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (tracker step 5, lines 284-287); Design > Pipeline port and combined graphs (lines 174-181); AC-06; Test Plan row AC-06
EVIDENCE: Step 5 says "A job whose ComfyUI output files can no longer be fetched is treated the same way" and resubmits it "with the same seed", so the new attempt posts the same graph again. ComfyUI on win-main skips an output node whose result is cached: execution.py:468 `if cached is not None and (unique_id in executed or not _should_force_output_rerun(class_def))`, and comfy/cli_args.py:145 describes `--force-output-rerun` as the flag that makes output nodes "write their output files again". RAM-pressure caching is the default (cli_args.py:139), and the running Comfy Desktop process command line has no `--force-output-rerun` or `--cache-none`. A resubmitted identical graph can therefore return the same missing file names from history without writing them again. The job is then lost twice more and fails without ever being regenerated. The Design never says which `filename_prefix` the app passes to `SaveImage` and `SaveGLB`, so nothing makes an attempt's graph differ from the previous one.
PROPOSAL: State the `filename_prefix` the app uses and include the attempt ID in it, so each attempt's output nodes have different inputs and run again, and include that prefix in the golden inputs. Add an AC-06 case where the fake reports the previous attempt's files as missing and the resubmitted prompt's prefix differs.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (lines 264-266 and tracker step 2, lines 271-277); Context > Owner summary (lines 36-38); AC-06; Test Plan row AC-06
EVIDENCE: Step 2 reposts a stored attempt ID whenever the ID is in neither the queue nor the history. ComfyUI 0.46.2 does not reject a duplicate `prompt_id`: `validate_job_id` in comfy_execution/jobs.py only checks the canonical UUID form, and post_prompt (server.py:1180-1235) calls `prompt_queue.put` with no lookup of existing IDs (execution.py:1345 `heapq.heappush`). A POST that hits the 10-second timeout while ComfyUI is still validating or queueing it leaves the job `pending`. The next tick does not find the ID yet, posts it again, and the same job then runs twice on the GPU under one ID. AC-06 states that an accepted prompt "is adopted rather than submitted twice", and the proof only covers a crash after a completed post.
PROPOSAL: Say that after an unreachable or timed-out `/prompt` answer the tracker waits a stated interval and checks the queue and history again before reposting the same ID. Alternatively, accept and document that a duplicate run can happen in that window. Add a fake that accepts the prompt after the client timeout to the AC-06 tests.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (collection paragraph, lines 297-300; staging paragraph, lines 244-249); AC-06; Test Plan rows AC-06 and AC-02
EVIDENCE: "A crash during collection leaves no final directory and no `done` row" does not hold for a crash after the rename to `data/assets/<job id>/` but before the `done` update. The next tick then collects into a new `.collect-` directory, and renaming it onto the existing non-empty directory fails on Windows and on Linux, so the job never reaches `done`. That outcome is undefined. The batch path has the same window: a crash after the commit but before staging is renamed to `data/uploads/<batch id>/` leaves `pending` image jobs whose files sit in a staging directory that is "deleted at start" after one hour. The AC-06 fault injection only kills the server after the first file is written, so it passes on both defects.
PROPOSAL: Define recovery for both windows. For example, collection treats an existing final directory with both files as collected and runs the `done` update, and the batch rename happens before the commit, with the directory deleted when the transaction fails. Add kill points after each rename to the AC-06 and AC-02 tests.

FINDING: F-05
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Cancel, retry and delete (line 310); AC-05; Test Plan row AC-05
EVIDENCE: "A `pending` job becomes `cancelled` without contacting ComfyUI." A `pending` job can already have a stored attempt ID whose prompt ComfyUI accepted, which is the crash-after-post case in step 2 and the timeout case in F-03. Cancelling it then leaves that prompt queued or running on the GPU for minutes, ahead of every other job, and its results are ignored. AC-05 says the same thing ("A pending job can be cancelled without contacting ComfyUI").
PROPOSAL: For a `pending` job that has an attempt ID, call `POST /api/jobs/<prompt id>/cancel` before marking it `cancelled`, which is harmless when ComfyUI does not know the ID. Adjust AC-05 and add that case to its proof.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > ComfyUI client (lines 209-215); Context > Background (lines 98-104); Design > Submission, concurrency and idempotency (tracker step 5)
EVIDENCE: The design depends on two ComfyUI features that this repository has only seen in 0.46.2: a client-supplied `prompt_id` (server.py:1180-1196) and `POST /api/jobs/{job_id}/cancel` (server.py:1063-1079). Comfy Desktop updates and reinstalls ComfyUI outside the app's control. A ComfyUI that ignores `prompt_id` mints its own ID, so the tracker never finds its attempt. Every job is then treated as lost and runs on the GPU three times before it fails. No minimum version is stated and no startup or health check reads `comfyui_version` from `/system_stats`.
PROPOSAL: State the minimum ComfyUI version, check `comfyui_version` from `/system_stats` before submitting, and report an incompatible ComfyUI through `/api/health` and the page instead of submitting. Add a fake-version case to the tests.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (lines 328-336); AC-15; Test Plan row AC-15
EVIDENCE: The database runs in WAL mode (line 236), and before migrating the app "copies the database file to `data/backup/<version>-<timestamp>.sqlite`". Deploy and rollback stop the scheduled task, which ends the process without a clean close, so committed transactions can remain in the `-wal` file. A copy of the main file alone then misses them. When rollback puts that copy back next to a newer `-wal` and `-shm`, SQLite's result is unspecified. The AC-15 proof never exercises a backup or a restore.
PROPOSAL: Take the backup with `VACUUM INTO` or the SQLite backup API after opening the database, and make rollback remove the `-wal` and `-shm` files when it restores. Add a unit test that restores a backup taken after uncheckpointed writes.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Access token (line 349, "the app version"); Design > HTTP API (`GET /api/health`, line 362); Design > Release path (lines 414-420); Test Plan rows AC-10 and AC-15
EVIDENCE: The AC-10 proof checks that `/api/health` "returns the deployed version", and the AC-15 proof checks that it "reports the first build's version" after rollback. Tagged releases are out of scope (line 147) and the document never defines where the version comes from. If it comes from `package.json`, two CI builds report the same value, and both proofs pass whichever executable is running.
PROPOSAL: Define the version as a value that differs per build, for example the commit SHA that CI embeds at compile time, and name it in both proofs.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (lines 244-249); Design > HTTP API (`POST /api/batches`, line 364)
EVIDENCE: "`POST /api/batches` carries a client-generated batch ID", and that ID goes straight into the paths `data/staging/<batch id>-<random>/` and `data/uploads/<batch id>/`. The document never gives the ID's format. A value such as `..\..\x` from a token holder would write outside the data directory on `win-main`.
PROPOSAL: Require the batch ID to be a canonical lowercase UUID, reject anything else with 400 before touching the filesystem, and add that rejection to the AC-02 tests.

FINDING: F-10
KIND: factual
SEVERITY: should-fix
WHERE: Design > Access token (lines 346-354); AC-12; Test Plan row AC-12
EVIDENCE: Design limits only "Failed sign-ins", but AC-12 says "repeated wrong tokens are rate limited per client address". Every protected route also accepts `Authorization: Bearer <token>`, so wrong bearer tokens on those routes are either limited or not, and the AC-12 proof only tests `POST /api/session`. Two implementers would build different limiters. The cookie's lifetime is not stated either: "signs in once" (line 44) suggests a persistent cookie, but no `Max-Age` or `Expires` is given, and the HMAC key is not named.
PROPOSAL: State whether wrong bearer tokens count toward the same per-client limit and make AC-12 and its proof match. Give the cookie's lifetime and the HMAC key.

FINDING: F-11
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 443-448); Design > Submission, concurrency and idempotency (tracker step 6, lines 288-289); AC-16; Test Plan row AC-16
EVIDENCE: The fixture's `submitted` jobs map to fake prompts that run and "never finish". Tracker step 6 cancels and fails any job running for more than 15 minutes after its started time, so a development stack left running turns the running fixture job into `failed` after 15 minutes. That breaks AC-16's "its fixture jobs keep their states while the app runs" and the inert-seed rule in conventions/frontend-testing.md lines 69-72. The AC-16 proof watches for only 30 seconds, so it passes on this behaviour.
PROPOSAL: Define how running fixture jobs avoid the timeout, for example a running time the fake reports or a fixture marker the timeout skips. Run the AC-16 check with a fake clock past 15 minutes.

FINDING: F-12
KIND: factual
SEVERITY: should-fix
WHERE: Design > Repository and CI (lines 426-435); Scope (line 132-133); Context > Owner summary (lines 63-64 and 66-68); AC-14; Test Plan row AC-14
EVIDENCE: conventions/repository-security.md (Public repositories) requires the dependency graph as well as Dependabot alerts, secret scanning and push protection, and CodeQL and Scorecard "with the reusable CodeQL workflow in `vhco-pro/.github`" and "the reusable Scorecard workflow from the same repository". The document lists no dependency graph and describes its own workflows. conventions/delivery.md lines 12-14 require `delete_branch_on_merge` on each repository, which is neither in the settings acceptance authorizes nor in AC-14. The AC-14 proof only checks that the workflow files exist, so a workflow that never runs passes it.
PROPOSAL: Add the dependency graph and `delete_branch_on_merge` to the Design, the owner summary's authorization and AC-14. Say that the CodeQL and Scorecard workflows call the pinned reusable workflows, and have the proof check a completed run of each on the default branch.

FINDING: F-13
KIND: factual
SEVERITY: should-fix
WHERE: Frontmatter `covers` (lines 6-18); AC-14
EVIDENCE: The convention says "`covers` lists every path whose change can affect the feature". AC-14 asserts the Apache-2.0 licence, but `LICENSE` is not covered. A Vite project's `index.html` lives at the Vite root, which is the repository root when `vite.config.ts` is there (line 159), and solution-style tsconfig files (`tsconfig.*.json`, which frontend-testing.md line 38 asks for) would also sit at the root. Neither pattern is covered, so `fresh` and `feature_tree_clean` ignore changes to them.
PROPOSAL: Add `LICENSE`, the root `index.html` (or move the Vite root under `app/web/`) and any root `tsconfig.*.json` to `covers`.

FINDING: F-14
KIND: factual
SEVERITY: should-fix
WHERE: AC-09; Test Plan row AC-09
EVIDENCE: conventions/frontend-testing.md lines 156-159 require reduced motion and 200 percent browser zoom on affected flows, with a manual check where automation cannot set zoom, and lines 132-147 ask for the readability invariants to be stated as criteria or visual tests. AC-09 says "stay readable", and its proof checks only overflow, the position of primary actions, accessible names and keyboard completion. It has no zoom, no reduced-motion check (the viewer's camera controls and any auto-rotate are affected) and no stated readability bound.
PROPOSAL: Add a 200 percent zoom check (or a recorded manual one) and a reduced-motion run of the library and viewer journey to the AC-09 proof, and replace "readable" with the invariants the screenshots and assertions check.

FINDING: F-15
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan rows AC-02, AC-07, AC-08, AC-09 and AC-12; Design > Verification commands (lines 439-441); Context > Owner summary (lines 57-58)
EVIDENCE: conventions/react.md line 167 requires Chromium and Firefox for "file transfer", and frontend-testing.md lines 103-105 name browser APIs. The image-upload journey in `submit.spec.ts` runs only in Chromium. frontend-testing.md lines 108-109 and react.md line 168 require deployment-sensitive paths, such as the `Secure` session cookie and the embedded page, to run against the built application. The document never says whether Playwright drives the Bun server serving the production build or the Vite dev server.
PROPOSAL: Run the image-upload part of `submit.spec.ts` in Firefox too, and state that the Playwright suite runs against the Bun server serving the production build. Update the owner summary's list of Firefox journeys to match.

FINDING: F-16
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-13; Design > Page (lines 387-389)
EVIDENCE: conventions/react.md lines 136-141 require the budget check to count the complete static entry graph "including shared chunks and explicit preloads", to "State the compression settings", and to "Test that the check rejects a representative leak and budget breach". The AC-13 proof does not name the gzip level, does not mention preloads, and has no case showing that `bun run size` fails on a leaked viewer import or an oversized entry.
PROPOSAL: Name the gzip level and count modulepreload links, and add tests in which `bun run size` fails on a fixture build that imports the viewer statically and on one that exceeds 150 kB.

FINDING: F-17
KIND: factual
SEVERITY: should-fix
WHERE: Design > Page (lines 382-385); AC-07; Test Plan row AC-07
EVIDENCE: conventions/react.md lines 119-121 require "explicit recovery for a missing module" and exercising "delayed and failed imports". The viewer module loads on demand, and no design text or proof covers a failed or slow viewer import. react.md line 131 says "Size images for their rendered dimensions", but the library uses the full source images, which are 1024 pixels and PNG for prompt jobs, as thumbnails. ComfyUI's `/view` can serve a compressed preview, and Bun has no built-in resizer.
PROPOSAL: Define the loading and error states for the viewer import and add a Playwright case that blocks the viewer chunk. Specify a thumbnail size and how thumbnails are produced, for example a small preview stored at collection time.

FINDING: F-18
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Pipeline port and combined graphs (lines 183-185); AC-11; Context > Owner summary (lines 35-37)
EVIDENCE: The document admits that whether both models fit in one prompt on the 16 GB card "is not established by any measurement", and leaves AC-11 to settle it after implementation. Queue order, per-job cancel, adoption and the timeout all assume one prompt per job. If the combined prompt runs out of memory, the accepted design cannot meet AC-11 and has to be redesigned after acceptance. Running one combined prompt on `win-main` would settle the question now.
PROPOSAL: Run one combined TRELLIS.2 prompt and one combined Hunyuan3D prompt on `win-main` before acceptance and cite the result, or raise an Open Question naming the fallback (two prompts per job) and what it changes.

FINDING: F-19
KIND: judgement
SEVERITY: should-fix
WHERE: Frontmatter `goal` (line 5); AC-10; Test Plan row AC-10; Context > Owner summary (lines 43-53)
EVIDENCE: The goal is that "A friend opens a private tailnet URL". AC-10 is checked only from `fedora-43`, which is in the owner's tailnet. Nothing checks the path through the node share, which the owner sets up outside the feature, or that the friend's device reaches the HTTPS name and nothing but port 443. The feature can be complete while the friend cannot reach the app.
PROPOSAL: Add a manual check from a device that receives the share, run after the owner shares the node, or state in the criterion and the summary that delivery stops before the share and name the owner step that completes the goal.

FINDING: F-20
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Repository and CI (line 427); Design > Build, deployment and exposure (lines 399-410); Design > Verification commands (lines 439-441)
EVIDENCE: The only deployment target is Windows, but `bun run verify` and every automated test run on Linux in CI. Windows behaves differently on exactly the paths this design relies on: renaming a directory, deleting or renaming a file that a download, export or thumbnail request has open, and path separators. Delete (line 320) can happen while a GLB is streaming. Only the manual AC-15 and live AC-11 checks touch Windows.
PROPOSAL: Run the `app/server` tests on a `windows-latest` runner as well, and say what Delete does when a file is in use.

FINDING: F-21
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Jobs and batches (lines 236-240); Design > Cancel, retry and delete (line 320); Scope > Out of scope (line 143)
EVIDENCE: Every job leaves its outputs in ComfyUI's shared output folder and its upload in ComfyUI's input folder (`--output-directory` and `--input-directory` on the running Comfy Desktop process). The app also keeps its own copy under `data/assets/` and the batch images under `data/uploads/<batch id>/`. Delete removes only "a job's row and its files", and nothing says whether that includes the upload or ComfyUI's copies. Two implementers would differ on whether the app deletes files in ComfyUI's folders, which Scope may count as touching the ComfyUI install.
PROPOSAL: State which files Delete removes, whether the app removes its own files from ComfyUI's input and output folders after collection, and when `data/uploads/<batch id>/` is removed.

FINDING: F-22
KIND: factual
SEVERITY: nit
WHERE: Context > Background (line 88)
EVIDENCE: "The GPU machine is `win-main` on the tailnet (`HANDOFF.md:23`)". HANDOFF.md:23 reads "Windows 11 PC `win-main`, RTX 4070 Ti SUPER 16 GB, 32 GB RAM." and does not mention the tailnet. Tailscale appears at HANDOFF.md:45-47.
PROPOSAL: Cite HANDOFF.md:23 for the hardware and HANDOFF.md:45-47 for the tailnet.

FINDING: F-23
KIND: factual
SEVERITY: nit
WHERE: Design > Jobs and batches (lines 235-236); Design > Submission, concurrency and idempotency (lines 260-262); Design > HTTP API (`GET /api/jobs`, line 365)
EVIDENCE: The page shows queue positions "read from ComfyUI's `/queue`", while "HTTP handlers only insert rows or set flags". The document does not say that `GET /api/jobs` serves positions from the tracker's last `/queue` snapshot rather than calling ComfyUI.
PROPOSAL: Say that the tracker keeps the latest queue snapshot and that `GET /api/jobs` reads positions from it.

FINDING: F-24
KIND: factual
SEVERITY: nit
WHERE: Design > Runtime and layout (line 164)
EVIDENCE: conventions/react.md line 151: "For new applications, make hook-order and dependency violations fail lint." The Design names only type-aware ESLint from typescript.md.
PROPOSAL: Add the React hooks rules at error severity to the lint line.

### R-3

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Submission, concurrency and idempotency (lines 304-314); AC-02; Test Plan row AC-02
EVIDENCE: The handler "renames that directory to `/data/uploads/<batch id>/`, then opens one `BEGIN IMMEDIATE` transaction that checks the batch ID" (lines 304-306), and "When the transaction is refused or fails, the handler deletes the uploads directory" (lines 307-308). For a repeated image batch, `/data/uploads/<batch id>/` already exists and holds the first request's images, so rename(2) of the new staging directory onto it fails with ENOTEMPTY before any transaction runs. The statements "in both cases the handler deletes the files it just wrote" and "A concurrent duplicate ends the same way, because the second transaction sees the first one's row" (lines 311-314) are therefore false for image batches. An implementer who follows the order literally returns an error for the AC-02 case "a repeated batch ID (200, same batch, no new files)". One who treats the duplicate as a refused transaction deletes the first batch's uploads while its image jobs are still `pending`, so those jobs can no longer be uploaded to ComfyUI. Prompt batches carry no files and are unaffected. This traces to the change the previous revision made for R-2 F-04 (rename before commit).
PROPOSAL: Check for an existing batch row before the rename (and again inside the transaction). On a rename failure or a duplicate, delete only the request's own staging directory, never `/data/uploads/<batch id>/`. Make the AC-02 repeated-ID and concurrent-duplicate cases use image batches and assert the first batch's upload files are intact.

FINDING: F-02
KIND: factual
SEVERITY: blocking
WHERE: Test Plan row AC-14; AC-14; Design > Repository and CI (lines 555-557); Context > Owner summary (lines 73-74)
EVIDENCE: The AC-14 proof says "`gh api repos/vhco-pro/3d-assets-gen` reports public visibility, licence `apache-2.0`, `delete_branch_on_merge` true, and secret scanning, push protection and the dependency graph enabled". That endpoint does not report the dependency graph. I checked a public repository of the same owner: `gh api repos/michielvha/docker-release-action --jq .security_and_analysis` returned only `dependabot_security_updates`, `secret_scanning`, `secret_scanning_non_provider_patterns`, `secret_scanning_push_protection` and `secret_scanning_validity_checks`. A `check-repo.sh` written to this proof either fails on every correct repository or silently skips the dependency graph.
PROPOSAL: Name a check for the dependency graph that can actually be observed, for example `gh api repos/vhco-pro/3d-assets-gen/dependency-graph/sbom` returning 200, and keep the other fields on the repository endpoint.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (tracker step 2, lines 327-337; lines 320-322); Design > Jobs and batches (job row, lines 287-288); AC-06; Test Plan row AC-06
EVIDENCE: The 30-second wait applies when "the attempt was posted less than 30 seconds ago and is in neither" (line 331). But the only place the post time is written is after the post succeeds: "posts the combined graph with that `prompt_id`, records the post time and marks the job `submitted`" (lines 333-334). The unreachable bullet only "leaves the job `pending` with its attempt ID" (lines 336-337). After a timed-out or crashed post the row has no post time for that attempt, so the next tick falls through to "Otherwise" and posts the same ID again. That is the duplicate GPU run R-2 F-03 described, since ComfyUI 0.46.2 does not reject a duplicate `prompt_id`. Whether the AC-06 case "the fake accepts a prompt only after the client's 10-second timeout" passes then depends on the fake's timing. This traces to the fix the previous revision made for R-2 F-03.
PROPOSAL: State that the tracker writes the post time to the row, under the same update guard, immediately before each `POST /prompt`, and that the 30-second wait counts from that time. Make the AC-06 fake accept the prompt later than the next tick after the timeout, so the case fails when the time is written only on success.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (lines 297-298 and 311-313); Design > HTTP API (`POST /api/batches`, line 442); AC-02; Test Plan row AC-02
EVIDENCE: "A batch ID that already exists returns that batch with 200 when the request's content hash matches the stored one" does not say what is hashed. An image batch is multipart (line 442), and a browser picks a new multipart boundary on every request. A hash of the raw body therefore never matches on a genuine retry and returns 409, while a hash over the parsed prompts, preset values and image bytes does match. Two implementers would build different retry behaviour. The batch ID must also be rejected "before the handler touches the filesystem" (lines 297-298). A streaming handler can only do that when the ID arrives before the file parts, and the document does not say where the ID travels (field order, header or path).
PROPOSAL: Define the content hash over the normalised batch content (prompts or image bytes in order, plus preset values) and say where the batch ID is carried, for example a header or the first multipart field. Add an AC-02 case that resends the same image batch with a different multipart boundary and expects 200.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Versioning and release path (lines 527-540); Design > Repository and CI (lines 545-546); Context > Owner summary (lines 74-77); AC-10; AC-11; AC-15
EVIDENCE: CI "runs `bun run verify` on every pull request and push to `main`" (lines 545-546), and the release workflow "calls `vhco-pro/version-workflow` ... after the checks pass" (lines 527-529), but no trigger is given for the release workflow. `vhco-pro/version-workflow` decides on `github.ref_name` and an open labelled PR at `github.sha` (version.yml step "Look for an open PR with the preview label at this commit"). Its example `examples/tag-after-checks/ci.yml` says "Runs on branch pushes, not pull_request ... those runs never tag", and it ships a `preview.yml` that reruns branch CI when the label is added. With checks only on `pull_request` and `main`, a feature-branch push never gets a prerelease tag. Step 1 (deploy the prerelease before the implementation review to observe AC-10, AC-11 and AC-15) therefore cannot happen. The document also does not say which arrangement it uses: one workflow (`contents: write`, no App), or a tag-triggered release workflow with a release App. The second needs a variable and a secret on the new repository that the acceptance does not list.
PROPOSAL: State the workflow triggers and arrangement: branch-push CI (`push: branches: ['**']`) feeding version-workflow, the `pull_request: labeled` rerun workflow, and either the same-workflow release job or the tag-triggered workflow with its App credentials. Add any needed repository variable or secret to the authorised settings.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy step 1, lines 507-508); Design > Versioning and release path (lines 531-532 and 539-540); AC-17; Test Plan row AC-17
EVIDENCE: Deploy "checks that its digest is the one the release recorded" and `check-image.sh` compares with "the one recorded in the release run". But "The workflow records the image's release digest" never says where (run summary, artifact, release notes or attestation) or how `deploy.sh` on `fedora-43` reads it, and a digest read back from GHCR itself makes the check vacuous. knowledge/container-release.md says "The inspected action scans after pushing. A failed scan fails the job but does not remove or quarantine the already-pushed image. Consumers must wait for the security gates". conventions/containers.md says "Verify the scan, signature, and attestation results before allowing consumers to use a published image". Deploy verifies only the Cosign signature, so a version whose Trivy scan failed after the push can be deployed. containers.md also asks to "Configure package ownership and visibility intentionally", and the document states neither the GHCR package's visibility nor how `fedora-43` authenticates to pull it.
PROPOSAL: Name where the release digest is recorded (written only after the scan passes) and how `deploy.sh` and `check-image.sh` read it. Have both verify the provenance and SBOM attestations as well as the signature, and state the package's visibility.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: AC-17; Test Plan row AC-17
EVIDENCE: AC-17 says "The published image runs as the non-root user with a read-only root filesystem and serves the page". The proof runs the UID 65532, read-only and page checks only on the image `bun run verify` builds locally. For the published image it checks only the signature and the digest. The release image is built by `michielvha/docker-release-action` with different build arguments, so the proof passes even when the published image differs from the one tested locally. conventions/containers.md: "Prove it starts under its declared user with the expected filesystem restrictions; a successful build does not establish runtime compatibility."
PROPOSAL: Have `check-image.sh <version>` also run the published digest with `--read-only` and the declared mounts, and assert UID 65532, a failed write to `/`, and the page and `/api/health` answering with that version and commit.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy step 4, lines 515-516; line 520); Design > Restart, upgrade and rollback (lines 408-409); AC-15; Test Plan row AC-15
EVIDENCE: Step 4 "records the running tag as the previous one" on every run, while line 520 says "Running it again keeps the token, the data volume and the record of the previous tag". Rerunning `deploy.sh` with the version that is already running records that version as the previous one and loses the real previous tag, after which `rollback.sh` rolls back to the same version. AC-15 says "Deploying a second time keeps ... the record of the previous version", but its proof deploys two different versions and never reruns the same one.
PROPOSAL: Say that the previous tag is updated only when the running tag differs from the one being deployed. Add a same-version rerun to the AC-15 procedure that confirms the recorded previous version is unchanged.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Access token (lines 428-432); AC-12; Test Plan row AC-12
EVIDENCE: The client address is `X-Forwarded-For` "when the socket peer is a loopback address or the Docker gateway, which is how `tailscale serve` and Docker's port forwarding pass on the source". Background measures that the container is reachable, but not the peer address that a connection through Docker Desktop's published `127.0.0.1:8790` has inside the container. "The Docker gateway" is not tied to a network either (the default bridge, the Compose network, or Docker Desktop's host address). If the deployed peer is none of these, the header is ignored and every friend and owner device shares one rate-limit bucket, which breaks AC-12's "clients behind `tailscale serve` counted separately". The proof uses only a loopback peer in a unit test, so it passes either way.
PROPOSAL: State how the trusted peer set is determined (for example the Compose network's gateway read at start) and cite a peer address measured through Docker Desktop's port publishing. Add a deployed check in which two tailnet clients' failed attempts are counted separately.

FINDING: F-10
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Page (lines 458-462); Design > Access token (lines 424-432); AC-12; Test Plan row AC-12
EVIDENCE: Every cookie that does not match "on any protected route" counts toward one limit of 10 per minute per client, and "Rotating the token therefore signs every browser out". The page refetches the job list every 2 or 15 seconds, and the document never says what the page does on a 401. A tab left open after a rotation keeps polling with the old cookie and uses up its client's 10 failures within a minute or two. It then keeps the limit exhausted, so the friend's sign-in with the new token from the same device gets 429 for as long as the tab stays open.
PROPOSAL: Specify that a 401 from any API call stops the job list query and any other query that needs a session, and shows the sign-in screen. Add a Playwright or unit case where an old cookie gets 401 and a sign-in from the same client with the new token then succeeds.

FINDING: F-11
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (compose memory limit, line 503); Design > Submission, concurrency and idempotency (lines 297-304); Design > HTTP API (`POST /api/exports`, line 451); Design > Export (lines 479-481)
EVIDENCE: The container has "a 1 GiB memory limit". A batch can be 201 MiB, and the document does not say that uploads stream to disk. `Request.formData()` in Bun buffers the whole body, so two concurrent maximum-size batches plus their parsing copies come close to the limit. `POST /api/exports` zips "the selected done jobs" with no limit on the selection and no statement that the zip streams. The library grows without bound, and each TRELLIS.2 asset at 2048 textures plus a source image of up to 20 MiB can be tens of MiB, so a buffered export of a large selection exceeds 1 GiB. An out-of-memory kill restarts the whole server, tracker included. Two implementers would build different memory behaviour, and no proof covers it.
PROPOSAL: State that uploads stream to the staging directory and the export zip streams to the response, or cap the export selection and the number of concurrent uploads. Add a test that exports or uploads at the limits within the memory budget.

FINDING: F-12
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (collection paragraph, lines 355-360; startup cleanup, lines 308-309); Design > Files in ComfyUI's folders (lines 389-393); Design > Restart, upgrade and rollback (lines 410-411); AC-06; AC-11
EVIDENCE: ComfyUI files are deleted only "After `done`" and on delete. A crash or a failed delete between the `done` update and that cleanup leaves the job's files in ComfyUI's folders for good, because nothing revisits `done` rows. After a rollback, "ComfyUI may still run their prompts, which the restored app ignores", and their outputs under `output/asset-studio/` are never removed. At start the app deletes an orphaned uploads directory only when it "is older than one hour", although no request can be in flight at start. A restart soon after the crash therefore leaves the orphan until some later restart. AC-06 says "no asset directory or upload is left half written or orphaned", and neither the AC-02 nor the AC-06 proof covers any of these windows.
PROPOSAL: Add a sweep, at start and periodically, that deletes the ComfyUI subfolders and uploads of `done`, deleted or unknown jobs, and orphaned uploads directories. Add fault-injection cases that kill the server after the `done` update, and that crash shortly before a restart.

FINDING: F-13
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (tracker step 2, lines 335-337); Design > ComfyUI client (lines 258-260); AC-03; Test Plan row AC-03
EVIDENCE: "An unreachable or server-error answer leaves the job `pending` with its attempt ID and stops submitting for this tick." A server error includes a 5xx or "an unparsable body". A graph or upload that makes ComfyUI answer 500 every time is retried forever at the head of the oldest-first order. Every later job waits behind it with no message, while `/api/health` still reports ComfyUI reachable. There is no bound or failure rule for repeated server errors, and no proof covers them.
PROPOSAL: Bound repeated server errors per job, for example fail the job after a stated number of consecutive 5xx answers while ComfyUI's `/system_stats` still answers. Add a fake case that returns 500 for one job's `/prompt` while the next job still gets submitted.

FINDING: F-14
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Pipeline port and combined graphs (lines 227-240); Context > Owner summary (lines 41-42 and 52-53); AC-11; Test Plan row AC-11
EVIDENCE: "The 20k preset and 2048 textures with Hunyuan3D are not measured" mixes two things, because Hunyuan3D takes no texture size ("Texture | 1024, 2048 (default); TRELLIS.2 only", line 237). What Background measured is TRELLIS.2 at 10k and 2048 (sampled peak 14.32 GB of 15.99 GB) and Hunyuan3D at 10k. The form still offers 20k for both engines and 1024 for TRELLIS.2, and AC-11 repeats only the two measured cases. A preset that runs out of memory or passes the 15-minute timeout in a combined prompt therefore passes every criterion. The owner summary says the combined prompt "fit the 16 GB card" without saying this was at 10k.
PROPOSAL: Correct the sentence. Either add a live check of TRELLIS.2 at 20k with 2048 textures and Hunyuan3D at 20k to AC-11, or raise an Open Question on offering presets that were not measured. Qualify the owner summary.

FINDING: F-15
KIND: factual
SEVERITY: should-fix
WHERE: Open Questions; Design > Jobs and batches (state table, lines 276-284); Design > Pipeline port and combined graphs (presets table, lines 233-240); Acceptance Criteria
EVIDENCE: conventions/feature-documents.md (Open questions): "User-facing terms the feature introduces or changes appear in a glossary row and are held to it by a criterion." The page introduces user-facing terms: the job states (`pending`, `submitted`, `done`, `failed`, `cancelled`), the form fields "Detail", "Variants" and "Game-asset style", the ComfyUI states "offline" and "incompatible", and the library. The document has no glossary and no criterion that holds the page's labels to one.
PROPOSAL: Add a glossary of the labels the page shows (state names, form fields, banner states), and a criterion with a Test Plan row that the page uses exactly those terms.

FINDING: F-16
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Deployment and exposure; Design > Verification commands; Scope (AGENTS.md "Local commands and constraints" section, lines 168-169)
EVIDENCE: The feature adds command-line tools that people read: `deploy.sh`, `rollback.sh`, `check-repo.sh`, `check-image.sh`, `bun run seed`, `bun run size`, `bun run verify:live` and the executable's `restore-backup` command. The central AGENTS.md at the pinned revision says "For command-line output or terminal interaction, read the required terminal output standard". conventions/terminal-output.md requires labelled status words, `NO_COLOR` handling and plain output on non-TTY streams, enforced by output tests in the adopting repository. The repository's AGENTS.md does not route to that page, and the document does not say whether these tools follow it. Adding that route would change the repository instructions.
PROPOSAL: Raise an Open Question on whether these tools follow conventions/terminal-output.md and whether AGENTS.md routes to it. If they do, state it in Design and add a Test Plan check.

FINDING: F-17
KIND: factual
SEVERITY: nit
WHERE: Design > Files in ComfyUI's folders (line 389); Design > Submission, concurrency and idempotency (lines 359-360)
EVIDENCE: "ComfyUI writes each attempt's outputs under `output/asset-studio/<job id>/<attempt id>/`" is not what ComfyUI 0.46.2 does with the prefix `asset-studio/<job id>/<attempt id>`. `folder_paths.get_save_image_path` sets `subfolder = os.path.dirname(...)` and `filename = os.path.basename(...)` (folder_paths.py:556-557), and `SaveGLB.execute` uses the same function (nodes_save_3d.py:567). The source PNG and the GLB are written as `output/asset-studio/<job id>/<attempt id>_NNNNN_.png` and `.glb`, and only the thumbnail lands inside `<attempt id>/`. Line 359 also says the app deletes "the attempt's files", while line 392 deletes "that job's directory". Deleting the job directory still removes everything.
PROPOSAL: Describe the real layout, and say once that cleanup deletes `output/asset-studio/<job id>/`.

FINDING: F-18
KIND: factual
SEVERITY: nit
WHERE: Design > Submission, concurrency and idempotency (collection paragraph, lines 355-358)
EVIDENCE: Collection "downloads all three files", but an image job's combined graph is "the mesh graph alone" plus the thumbnail branch (lines 218-222), with no `SaveImage` of the source. ComfyUI therefore has no source image to download; it is in `/data/uploads/<batch id>/`.
PROPOSAL: Say that for an image job the source is copied from the batch's uploads directory into the collection directory.

FINDING: F-19
KIND: factual
SEVERITY: nit
WHERE: Context > Background (line 140)
EVIDENCE: The citation `HANDOFF.md:50-55` runs past the end of the file, which has 54 lines (`git show 0a8d589:HANDOFF.md | wc -l` printed 54).
PROPOSAL: Cite `HANDOFF.md:50-54`.

### R-4

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Versioning and release path (`version` bullet, lines 603-606)
EVIDENCE: The document pins `vhco-pro/version-workflow` at `v0.1.2` (`a59c42c7e4ecc074cd5204e8e585e05900144c5a`). `gh api repos/vhco-pro/version-workflow/git/ref/tags/v0.1.2 --jq .object` returned `{"sha":"a59c42c7...","type":"tag"}`, so that SHA is the annotated tag object, not a commit. `gh api repos/vhco-pro/version-workflow/git/tags/a59c42c7e4ecc074cd5204e8e585e05900144c5a` gives `object.sha` `46a1ac93fdbd3abaa3a7d17259c5565edd2053c0` (type commit), and `gh api repos/vhco-pro/version-workflow/tags` lists `v0.1.2 46a1ac93fdbd3abaa3a7d17259c5565edd2053c0`. conventions/delivery.md (Pinning and updates): "Pin external GitHub Actions and reusable workflows to full 40-character commit SHAs" and "Resolve the current ref, including annotated tags, to its commit". A `uses:` built from this document names a non-commit object, so the release path fails or pins the wrong identity. This SHA was added by the previous revision. (The docker-release-action pin `c499e52...` is a commit and is correct.)
PROPOSAL: Pin `vhco-pro/version-workflow/.github/workflows/version.yml@46a1ac93fdbd3abaa3a7d17259c5565edd2053c0 # v0.1.2`.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Versioning and release path (`version` bullet, "That job has `contents: write`", lines 605-606); Design > Repository and CI ("every job has least-privilege permissions", line 631)
EVIDENCE: version.yml at 46a1ac9 says "same workflow: contents: write, pull-requests: read and no App", and its preview step runs `gh pr list --head "$BRANCH" --state open --label "$LABEL"` inside `echo "labelled=$(...)"`. When the caller job grants only `contents: write`, every other scope is `none`. The PR lookup then cannot read pull requests, the substitution yields an empty value without failing the step, and `gate` decides not to tag. Feature-branch pushes then never get a prerelease, so release-path step 1 (deploying the prerelease before the implementation review, so AC-10, AC-11 and AC-15 can be observed) cannot happen. The permission list was added by the previous revision.
PROPOSAL: State that the `version` job has `contents: write` and `pull-requests: read`, and give the `release` job's permissions too (`contents: read`, `packages: write`, `id-token: write`, `attestations: write`, as knowledge/container-release.md lists).

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy.sh steps 2 and 3, lines 579-584); Test Plan row AC-15
EVIDENCE: Step 2 runs `docker load` on `win-main` over SSH. Only step 3 then ensures Docker Desktop is running in the owner's session. Background records that Docker Desktop "was stopped when first checked" (line 114), and that one started from SSH stops when the session ends and loses loaded images (lines 144-150). Followed in order, a deploy against a stopped Docker Desktop fails at step 2. If an implementer starts the engine some other way first, the image can go into an instance that does not survive. The AC-15 procedure restarts Docker Desktop, so the order matters there.
PROPOSAL: Move "ensure Docker Desktop runs in the owner's session" ahead of the `docker load` step in deploy.sh, and in rollback.sh before any reload, and give the wait a bounded timeout with a clear failure when the owner is not signed in.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback ("which happens after Docker Desktop restarts (Background)", lines 449-451); Context > Background (lines 144-146); Test Plan row AC-15 ("restart Docker Desktop, run `rollback.sh` and confirm it reloads the first image"); AC-15
EVIDENCE: Background only observed lost images for "the Docker Desktop instance started from SSH". The Design generalises this to every Docker Desktop restart. On win-main now, `docker volume ls` lists other projects' named volumes (`svelte-go-dating_postgres_data` and others) that have survived restarts in the owner's session, which suggests that store persists. If restarts in the owner's session keep images, a correct rollback.sh (which reloads only "when that image is no longer loaded") does not reload, and the AC-15 step "confirm it reloads the first image" fails it. If restarts really do drop images, the running image and the `/data` volume go too, and `restart: unless-stopped` cannot bring the app back after the owner signs in again. Nothing in the design then covers that case.
PROPOSAL: Establish the behaviour with a restart in the owner's session and cite it. Then make the AC-15 procedure remove the first image explicitly (`docker image rm`) before running rollback.sh, or, if restarts drop images, design a reload of the current image at logon.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Container image (runtime stage "with that executable and those libraries only", lines 556-562); Design > Deployment and exposure (compose.yaml, lines 569-571); AC-17
EVIDENCE: A new named volume takes the ownership of the image's mount point, and is root-owned 0755 when the image has no such directory. Observed here: `docker run --rm --user 65532:65532 --read-only -v <new volume>:/data alpine:3.22 sh -c 'ls -ld /data; touch /data/x'` printed `drwxr-xr-x root root /data` and `touch: /data/x: Permission denied`. A distroless runtime holding only the executable and libraries has no `/data`, and has no shell to create it at start, so the non-root app cannot open its SQLite database on a fresh deploy.
PROPOSAL: State that the runtime stage creates `/data` (and its subdirectories if wanted) owned by 65532:65532, for example `COPY --chown=nonroot:nonroot` of an empty directory from the builder. Have the AC-17 start checks use a fresh named volume.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (rename inside the transaction, lines 331-341); Design > Submission, concurrency and idempotency (sweep, lines 394-398); AC-02; AC-06; Test Plan rows AC-02 and AC-06
EVIDENCE: The handler renames staging to `/data/uploads/<batch id>/` "still inside the transaction", before commit. The sweep runs every ten minutes and deletes "in `/data/uploads/`, every directory with no batch row", and it exempts only "staging and collection director[ies] not in use by a running request". Under WAL, a sweep reading through another connection does not see the uncommitted batch row. A sweep that runs between the rename and the commit therefore deletes the new batch's uploads, and its image jobs are then `pending` with no source to upload. This traces to the previous revision's changes for R-3 F-01 and R-3 F-12, which moved the rename into the transaction and added the periodic sweep.
PROPOSAL: Exempt uploads directories of batches a running request is inserting, or serialise the sweep with batch inserts (for example, have the sweep's uploads check run inside its own `BEGIN IMMEDIATE`). Add a test that runs the sweep between the rename and the commit.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: Design > Jobs and batches (job row and `/data/assets/<job id>/`, lines 304-309); Design > Submission, concurrency and idempotency (idempotent collection, lines 386-391); Design > Restart, upgrade and rollback (lines 451-452); Design > HTTP API (`<id>` routes, lines 487-493); Design > Files in ComfyUI's folders (lines 427-432); Design > Verification commands (`fixture-` IDs, line 662)
EVIDENCE: The document never defines the job ID format, yet it goes into `/data/assets/<job id>/`, `output/asset-studio/<job id>/`, `input/asset-studio/<job id>.<ext>` and the API paths. Fixture IDs are "fixed IDs starting with `fixture-`", which implies free text. If an implementer uses SQLite integer IDs, a rollback that restores an older database reuses IDs whose asset directories "stay in the volume" (line 451). Collection then finds "`/data/assets/<job id>/` already holds the GLB, source image and thumbnail", "only runs the `done` update", and marks a new job done with another job's files. Unvalidated `<id>` path parameters also reach the filesystem, unlike the batch ID, which must be a canonical UUID.
PROPOSAL: Define job IDs as canonical lowercase UUIDs generated by the app (fixture IDs in a fixed validated form), and validate every `<id>` path parameter against that form before any database or filesystem access.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Cancel, retry and delete (cancel handling lines 406-414, retry lines 416-418); Design > ComfyUI client (three server errors in a row, lines 276-278); Design > Jobs and batches (job row fields, lines 305-307); Test Plan row AC-05
EVIDENCE: Retry "clears its attempt ID and loss count", but not the consecutive server-error count or the cancel-requested flag. The flag is said to be cleared only when "the completion wins" (line 412). A job that failed after three server errors and is retried fails on its next single server error. A cancelled job keeps its flag after retry, so the next tick's step 1 may cancel it again at once. Two implementers would reset different fields. The server-error count was added by the previous revision for R-3 F-13.
PROPOSAL: State that retry and every lost-job resubmission reset the consecutive server-error count, that the count resets on any successful job call, and that the tracker clears the cancel-requested flag when it marks a job `cancelled` (and retry clears it too).

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > ComfyUI client (version check "at start and after every period in which ComfyUI was unreachable", lines 280-284); Design > Submission, concurrency and idempotency (tracker steps 3 to 6, lines 369-381); AC-04; Test Plan row AC-04
EVIDENCE: The tracker re-reads `comfyui_version` only after unreachability. The AC-04 proof expects the fake to get no `/prompt` or cancel "until it reports 0.46.2", which a fake that changes its reported version while staying up never triggers under the Design. A correct implementation can then fail the proof, or an implementer adds an undocumented periodic re-read. The Design also does not say whether steps 3 to 6 run while ComfyUI is incompatible. If they do, a downgraded ComfyUI that lost its queue makes step 5 move `submitted` jobs back to `pending`, which contradicts AC-04's "every job keeps its state".
PROPOSAL: State when the version is re-read while incompatible (for example every tick, or every N seconds), and that reconciliation steps 3 to 6 are suspended while incompatible. Make the AC-04 proof switch the fake's version both with and without a restart.

FINDING: F-10
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (backup naming and rollback, lines 441-452); AC-15; Test Plan row AC-15
EVIDENCE: rollback.sh runs the previous image's `restore-backup` "on the newest backup when the schema version changed". The document does not say whether the running container is stopped first, although the command replaces the database and deletes `-wal` and `-shm` under a live writer. It does not say how rollback.sh learns that the schema version changed, or whether `<version>` in `/data/backup/<version>-<timestamp>.sqlite` is the app or the schema version. "Before running migrations it writes a consistent copy" also leaves open whether a backup is taken on every start. If it is, the newest backup after a restart of the migrated app has the new schema, and the restored old executable refuses it. The AC-15 proof never exercises a schema change.
PROPOSAL: State that rollback stops the service before restoring, that a backup is written only when migrations will run and is named with the schema version it holds, and that rollback restores the newest backup whose schema version equals the previous image's.

FINDING: F-11
KIND: factual
SEVERITY: should-fix
WHERE: Design > Versioning and release path (`release-<version>` workflow artifact, lines 610-612); Design > Deployment and exposure (deploy step 1, lines 575-578); Design > Restart, upgrade and rollback (reload "the way `deploy.sh` does", lines 449-451); Test Plan row AC-17 (`check-image.sh` reads the artifact)
EVIDENCE: The only release record is a workflow artifact, and "A version without that artifact is never deployed". Workflow artifacts expire. Observed: `gh api repos/vhco-pro/stackweaver-launcher/actions/artifacts` shows artifacts created 2026-11-20 with `expires_at` 2027-02-18 (90 days) and some sooner (2026-12-20 and 2026-11-25). After expiry, deploy and check-image of that version fail, and so does a rollback that must reload an image no longer loaded, which is exactly when rollback is needed. The artifact record was added by the previous revision.
PROPOSAL: Keep the release record somewhere durable, for example a GitHub Release asset or the tag annotation written only after the scan passes, or set and state the artifact retention and accept the window. Say what rollback does when the record is gone.

FINDING: F-12
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy step 1, lines 576-578); Test Plan row AC-17 (`check-image.sh`)
EVIDENCE: Deploy "verifies the Cosign signature and the provenance and SBOM attestations for that digest with `gh attestation verify --repo vhco-pro/3d-assets-gen`". `gh attestation verify --help` shows `--predicate-type` with default `"https://slsa.dev/provenance/v1"`, so one call checks provenance only, not the SBOM attestation. It does not verify the Cosign keyless signature, which the action creates with `cosign sign`. A literal implementation skips two of the three checks that AC-17 requires.
PROPOSAL: Name the checks: `cosign verify` with the expected certificate identity and issuer for the signature, and `gh attestation verify oci://...@<digest> --repo ...` once for provenance and once with the SPDX predicate type for the SBOM, in both deploy.sh and check-image.sh.

FINDING: F-13
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan row AC-17 ("A CI test of the release job runs it with a scan step forced to fail and asserts no `release-<version>` artifact is uploaded"); AC-17; Design > Versioning and release path (`release` bullet)
EVIDENCE: The `release` job calls `michielvha/docker-release-action`, which pushes `<version>`, `latest` and `<sha>` tags (action.yaml lines 113-123 at c499e52) before Trivy runs (lines 202-208). Running the real job "with a scan step forced to fail" therefore publishes a failing image, and moves `latest`, in the public package under some version. The row does not say which workflow, trigger or version the test uses, or how the scan is made to fail inside a pinned external action. The proof is not executable as written.
PROPOSAL: Define the check concretely, for example a workflow test that asserts the artifact upload step follows the action step in the same job with no `if: always()` or `continue-on-error`, or a stub local action in a test workflow that fails in place of the release action.

FINDING: F-14
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-20; AC-20; Design > Container image (`ENTRYPOINT`, lines 553-559); Design > Deployment and exposure (1 GiB memory limit, line 571); Context > Owner summary (lines 56-57)
EVIDENCE: The proof runs the server "under `--smol`", but the Design never runs the deployed executable with `--smol`, so the test measures a different configuration from production. The proof also asserts that "peak resident memory, read from `/sys/fs/cgroup/memory.peak`, stays under 1 GiB" under `--memory 1g`. cgroup v2 `memory.peak` counts page cache as well as anonymous memory, and it cannot exceed `memory.max`. Writing 400 MiB of uploads and reading an export fills the cache toward the limit, so the assertion either fails a correct server or passes vacuously. AC-20 was added by the previous revision.
PROPOSAL: Either embed `--smol` in the compiled executable and say so in Design, or drop it from the proof. Assert that the container is not OOM-killed (`docker inspect` `OOMKilled` false) and bound anonymous memory, for example `memory.stat` `anon` below a stated value such as 512 MiB.

FINDING: F-15
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-12 (unit case "the eleventh failed authentication within a minute ... returns 429" and deployed case "ten wrong sign-ins from `fedora-43` reach 429"); Design > Access token ("one limit of 10 per minute per client", "Over the limit", lines 469-471)
EVIDENCE: The Design allows 10 failures per minute and answers 429 only over the limit, and the unit test checks that the eleventh is 429. The deployed procedure says ten wrong sign-ins "reach 429". Read literally, it fails a correct implementation, while the unit test fails the alternative. The deployed check was added by the previous revision.
PROPOSAL: Make the deployed step send eleven wrong sign-ins from `fedora-43` and expect 429 on the eleventh. State whether the minute is a fixed or a sliding window.

FINDING: F-16
KIND: factual
SEVERITY: should-fix
WHERE: Design > Repository and CI (CodeQL bullet, lines 634-636); AC-14; Test Plan row AC-14; Context > Owner summary (CodeQL, lines 75-76)
EVIDENCE: conventions/repository-security.md: "Run CodeQL code scanning with the reusable CodeQL workflow in `vhco-pro/.github` for each language in the repository." The repository has Python (`scripts/generate_3d.py`, and the golden dump helper runs it). The Design calls only `reusable-codeql-js.yml` (input `languages`, default `javascript-typescript`) and `reusable-codeql-actions.yml`. `gh api repos/vhco-pro/.github/contents/.github/workflows` lists no Python workflow.
PROPOSAL: Pass `languages: javascript-typescript,python` to `reusable-codeql-js.yml` (it uses `build-mode: none`), or record why Python is excluded. Make the AC-14 check name the Python analysis.

FINDING: F-17
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Export (lines 545-549); Design > HTTP API (`POST /api/exports`, line 494); AC-08; AC-20
EVIDENCE: An export takes "the selected done jobs" with no cap, and the library grows without bound. Each asset adds a GLB of TRELLIS.2 2048 textures (colour, ORM and normal maps, HANDOFF.md:38) plus a source image of up to 20 MiB. A select-all of a few hundred assets passes 4 GiB, or 65,535 entries in larger libraries. A streamed zip without ZIP64 is then corrupt, and the document does not mention ZIP64. AC-20 exports only 100 fixture assets, which stay far below that.
PROPOSAL: Either cap the export selection (count and total bytes) with a message, or require ZIP64 records and add a test that exports past 4 GiB with sparse fixture files.

FINDING: F-18
KIND: factual
SEVERITY: should-fix
WHERE: Scope (AGENTS.md and README commands bullet, lines 182-184); Design > Verification commands (lines 654-667); Design > Container image (configuration, lines 563-565)
EVIDENCE: conventions/frontend-testing.md lines 28-33 require the README and agent instructions to name the bootstrap, seed, run, verify and clean commands, and to "State which dependencies and services are needed and how an agent detects readiness". Lines 45-48 ask for a stable nonproduction identity and its login. The Design defines `seed`, `verify` and `verify:live` but no run command for the development stack. It does not say where its configuration file lives outside the container, which token a developer signs in with, how the fake is started, or how `seed` recognises "the fake's" URL. Two implementers would build different development paths.
PROPOSAL: Define the development run command, its configuration file and fixed nonproduction token, how it starts the fake ComfyUI and what readiness signal it waits for, and how seed identifies the fake (for example a marker endpoint the fake answers).

FINDING: F-19
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-19 ("`bats`-style shell tests in `scripts/deploy/tests/`")
EVIDENCE: "`bats`-style" leaves open whether the repository adds the `bats` tool (not installed on fedora-43: `which bats` found nothing) or a hand-written Bash runner. conventions/delivery.md requires tools to be pinned in a manifest the updater reads, with a verified checksum. The document names neither the tool nor its pin.
PROPOSAL: Name the shell test runner. If it is `bats-core`, say how it is pinned and verified (for example a Bun dev dependency in `bun.lock`).

FINDING: F-20
KIND: factual
SEVERITY: nit
WHERE: Design > ComfyUI client (incompatible "with the version it found", lines 282-284); Design > Access token (health "reveals only the app version, the build commit and ComfyUI's state", lines 466-467); Design > HTTP API (`GET /api/health` row); Design > Glossary ("ComfyUI incompatible ... older than 0.46.2", line 518)
EVIDENCE: One place says health reports the version found, and another says health reveals only the state. The glossary covers "older" but the Design also treats a missing version as incompatible.
PROPOSAL: Say once whether `/api/health` includes ComfyUI's reported version, and make the glossary row read "older than 0.46.2 or reports no version".

FINDING: F-21
KIND: factual
SEVERITY: nit
WHERE: Design > Deployment and exposure (deploy step 5, line 588)
EVIDENCE: deploy.sh "runs on `fedora-43`" and "Waits until `/api/health` on `127.0.0.1:8790` reports the new version", but that address is `win-main`'s loopback, not `fedora-43`'s.
PROPOSAL: Say the health wait runs on `win-main` over SSH.

FINDING: F-22
KIND: factual
SEVERITY: nit
WHERE: Design > Submission, concurrency and idempotency ("HTTP handlers only insert rows or set flags (cancel requested, retry, delete)", lines 343-345); Design > Cancel, retry and delete (Delete, lines 420-423); Design > HTTP API (`DELETE /api/jobs/<id>`)
EVIDENCE: One sentence makes delete a flag for the tracker. The Delete paragraph has the request remove the row and files, so it could be synchronous.
PROPOSAL: State whether `DELETE` acts synchronously in the handler or sets a flag the tracker acts on, and what the response and later `GET` show in between.

### R-5

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > Jobs and batches (job row fields, lines 310-315); Design > Submission, concurrency and idempotency (tracker step 3 "A job seen running for the first time gets its started time", lines 380-383; step 5 lost-job reset, lines 386-390; step 6 timeout, lines 391-392); Design > Cancel, retry and delete (retry, lines 430-433); AC-05; AC-06; Test Plan rows AC-05 and AC-06
EVIDENCE: The row keeps the times the job was "first seen running and finished", and the 15-minute timeout counts "since its started time". Retry clears "its attempt ID, loss count, server-error count and cancel-requested flag" (lines 430-431), and a lost job only "clears the attempt ID, returns the job to `pending` ... and adds one to its loss count" (lines 387-388). Neither resets the started time, the finished time or the error message. Take a job that timed out after 15 minutes, or one lost when ComfyUI restarted 10 minutes into its run. When it is retried or resubmitted and runs again, it is not "seen running for the first time", so step 6 measures from the old start and cancels it as timed out on the first tick, or shortly after. The AC-05 retry case ("the job ends `done` without being cancelled again") and the AC-06 lost-job case run on a clock that is not advanced, so they pass on that implementation.
PROPOSAL: State that retry and every lost-job resubmission clear the started time, the finished time and the error message, so the next attempt's timeout counts from when that attempt is first seen running. Add a tracker test that retries a job after a timeout on a faked clock and asserts the new attempt is not cancelled before it has run 15 minutes.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Container image (configuration list "listen address ..., ComfyUI URL ..., the access token and the three limits", lines 590-591; writable paths `/data`, `/comfy/input`, `/comfy/output`, lines 587-588); Design > Files in ComfyUI's folders (lines 444-450); Design > Verification commands (`bun run dev` with data under `.dev-data/`, lines 696-701); Test Plan rows AC-06 and AC-16
EVIDENCE: The configuration is "loaded strictly" and lists only the listen address, ComfyUI URL, token and limits. The data directory and the two ComfyUI folders the app deletes from appear only as the fixed container paths `/data`, `/comfy/input` and `/comfy/output`. `bun run dev` runs the server outside a container with "data under `.dev-data/`", and the sweep and cleanup tests in AC-06 assert on "the fake's `asset-studio` folders", so the server must delete files in folders the fake writes. The document does not say how the server learns its data directory or the ComfyUI folders outside the container. A strict loader rejects any key it does not list, so two implementers would add different config keys, environment variables or flags, or hard-code paths that only exist in the container.
PROPOSAL: Add the data directory and the ComfyUI input and output `asset-studio` folders to the configuration schema with the container paths as defaults, and say what `dev/config.yaml` sets them to and which folders the fake ComfyUI writes in development and tests.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Files in ComfyUI's folders ("The container mounts only those two `asset-studio` subfolders of ComfyUI's shared input and output folders", lines 447-448); Design > Container image (mounts, lines 587-589); Design > Deployment and exposure (compose.yaml "the mounts above", lines 595-597; deploy step 4 "brings the Compose project up", lines 615-617); AC-11
EVIDENCE: The host side of the two ComfyUI mounts is never named, and nothing says how deploy.sh finds it. The running Comfy Desktop process on win-main, read over SSH, has `--input-directory C:\Users\<user>\AppData\Local\Comfy-Desktop\ComfyUI-Shared\input --output-directory ...\ComfyUI-Shared\output`. Those paths contain the Windows user name, which the summary says was scrubbed from the public repository (line 74-75), and Comfy Desktop can move them. `Test-Path` for `input\asset-studio` and `output\asset-studio` under that folder both returned False today. The document also does not say where compose.yaml lives when Compose runs on win-main, or whether it runs remotely from fedora-43. No observation shows that UID 65532 in the container can delete files ComfyUI wrote on NTFS through Docker Desktop's bind mount, yet cleanup, the sweep and AC-11's "gone from ComfyUI's `asset-studio` folders" depend on it.
PROPOSAL: Name the host paths as `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\{input,output}\asset-studio` (or read them from the Comfy Desktop process), say that deploy.sh creates them and copies compose.yaml to a named place on win-main, and cite a measured delete by UID 65532 through such a mount, or make that the first deploy check.

FINDING: F-04
KIND: judgement
SEVERITY: should-fix
WHERE: Context > Background ("Whether images in the owner's instance survive a Docker Desktop restart was not tested", lines 149-150); Design > Deployment and exposure ("The app keeps running only while the owner is signed in on `win-main`", lines 621-622; `restart: unless-stopped`, line 597); Design > Restart, upgrade and rollback; AC-15; Open Questions
EVIDENCE: The design expects the app to come back by itself after win-main reboots and the owner signs in: the logon task starts Docker Desktop and `restart: unless-stopped` restarts the container. Background records that the Docker Desktop instance started from SSH and the one in the owner's session showed different image lists, and that image persistence across a restart in the owner's session was never tested. If the image does not survive, the container cannot start after a reboot and the friend's URL stays down until someone reruns deploy.sh. No criterion or Test Plan row covers recovery after a restart, and checking it means restarting Docker Desktop, which stops the owner's other containers.
PROPOSAL: Raise an Open Question. Option A: the owner allows one Docker Desktop restart (or sign-out and sign-in) during the AC-15 procedure, which then confirms that `/api/health` answers again without a redeploy. Option B: the logon task also reloads the current image from its Release record when it is missing. Option C: accept the gap and record it as a limitation in the summary.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Scope > Out of scope ("Installing the managed Renovate GitHub App on the repository", line 202); Design > Repository and CI (`renovate.json` bullet, lines 671-672); Design > Command-line output ("pinned with its integrity hash in `bun.lock`, which Renovate updates", lines 686-687); Context > Owner summary (lines 76-77, 61-63); AC-14; Test Plan row AC-14
EVIDENCE: `gh api orgs/vhco-pro/installations` lists `vhco-renovate selected`, so the managed Renovate App only covers repositories added to it one by one. A new `vhco-pro/3d-assets-gen` is not covered until someone adds it, which the document treats as out of scope but does not list among the owner's steps or the README checklist. knowledge/managed-renovate.md: "A config file is not proof that the App is installed or that its newest run succeeded. Check the Dependency Dashboard or update PRs after adoption." conventions/delivery.md: "Adding a dependency includes confirming the updater will propose its next version." The AC-14 proof checks only that `renovate.json` exists on `main`, so the claim that Renovate updates `bats`, the base images and the actions can stay false while AC-14 is met.
PROPOSAL: Name adding the repository to the `vhco-renovate` installation as an owner step in the summary and the README checklist, and either add a check that the Dependency Dashboard issue or a Renovate PR exists, or qualify the "which Renovate updates" statements until the owner has done it.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Frontmatter `covers` (lines 6-22); Design > Verification commands (committed `dev/config.yaml`, `.dev-data/` ignored by Git, lines 696-698); Test Plan rows AC-16 and AC-17 (`bun test .github` and the test workflow with a local stub action)
EVIDENCE: The feature commits `dev/config.yaml`, whose token and fake-only rule AC-16 checks, and adds `.dev-data/` to `.gitignore`. The AC-17 proof adds tests run as `bun test .github` and a local stub action, which normally sit under `.github/` outside `.github/workflows/`. The convention says "`covers` lists every path whose change can affect the feature", but `covers` lists none of `dev/`, `.gitignore` or `.github/` beyond `workflows/`, so `fresh` and `feature_tree_clean` ignore changes there.
PROPOSAL: Add `dev/`, `.gitignore`, and the directory holding the `.github` tests and the stub action (or `.github/` as a whole) to `covers`.

FINDING: F-07
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan row AC-17 ("and a test workflow in which a local stub action fails in place of the release action ends with no Release created"); AC-17
EVIDENCE: The row does not say where that test workflow lives, what triggers it, which tag or version its Release step would use, or how "no Release created" is observed. `bun test` cannot run a GitHub workflow, and the sentence is joined to the `bun test .github` check. A workflow that only copies the job's shape around a stub tests GitHub's step semantics, not `ci.yml`. Two implementers would build different checks, or none that runs in `bun run verify` or CI. This row text came from the previous revision's change for R-4 F-13.
PROPOSAL: Either drop the test workflow and rely on the `ci.yml` structure assertions, or name its file, its trigger (for example `workflow_dispatch` on the feature branch), the tag it would release and the `gh release view` check that must fail afterwards.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Cancel, retry and delete (submitted job: history check, then per-job cancel, lines 423-426); Design > Submission, concurrency and idempotency (sweep "every job directory and upload whose job is `done`, deleted or unknown", lines 405-407); Design > Files in ComfyUI's folders (cleanup, lines 448-449); AC-05; AC-06
EVIDENCE: The tracker checks the history and then calls `POST /api/jobs/<prompt id>/cancel`. A prompt that finishes between those two calls makes the cancel a no-op: server.py at lines 1060-1079 on win-main returns `{"cancelled": false}` for a finished ID. The Design marks the job `cancelled` anyway, so a job that finished ends `cancelled`, against AC-05's "unless it already finished, in which case it ends `done`". Its GLB and PNG stay in `output/asset-studio/<job id>/`, because cleanup runs only after `done` and on delete, and the sweep skips `failed` and `cancelled` jobs. The same is true of the partial outputs of every cancelled or timed-out job, which stay in ComfyUI's output folder until someone deletes the job.
PROPOSAL: State that when the per-job cancel answers `{"cancelled": false}`, the tracker reads the history again and collects a success. Also state whether the sweep, or the transition to `failed` or `cancelled`, removes that job's ComfyUI output directory.

FINDING: F-09
KIND: judgement
SEVERITY: should-fix
WHERE: Design > HTTP API (`POST /api/exports`, line 515); Design > Page ("Downloads use the API links directly", line 554); Design > Export (lines 566-572); AC-08; Test Plan row AC-08
EVIDENCE: The export is a POST carrying the selection, so it cannot be a plain link. The document does not give the request body or say how the browser turns the streamed response into a download. A `fetch` that buffers into a Blob holds up to 2 GiB in the browser tab. A form POST navigation needs a form-encoded body and gets a 413 page instead of the app's message. The server streams so its memory stays flat (AC-20), but the AC-08 journey downloads a three-asset zip, which both approaches pass.
PROPOSAL: Define the export request format and the browser mechanism, for example a form POST or a short-lived GET link issued by `POST /api/exports` that the browser downloads natively, and how the 413 message reaches the page.

FINDING: F-10
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy step 2, `cosign verify` and `gh attestation verify`, lines 606-611); Test Plan row AC-17 (`scripts/deploy/check-image.sh`)
EVIDENCE: deploy.sh and check-image.sh verify the image with `cosign` and `gh` from whatever is installed on fedora-43 (`which cosign` there gives `/home/m/go/bin/cosign`, a `go install` build with no recorded version). conventions/delivery.md: "Download executable tools at an exact version and verify an independently pinned checksum before executing them. Do not silently accept a different preinstalled version", and a pin must sit in a manifest the updater reads. The document names no version, checksum or manifest for these verification tools, so two implementers would differ, and the security gate depends on an unpinned binary.
PROPOSAL: State that the scripts fetch cosign (and pin gh, or check its version) at an exact version with a checksum kept where Renovate tracks it, for example a custom-manager pin, or record an explicit exception for host tools on fedora-43.

FINDING: F-11
KIND: factual
SEVERITY: nit
WHERE: Design > Versioning and release path ("as `vhco-pro/version-workflow`'s `tag-after-checks` example arranges it", lines 629-630; "`preview.yml`, copied from the same example", line 647)
EVIDENCE: At 46a1ac9, `examples/tag-after-checks/ci.yml` uses the separate-workflows arrangement: the `version` job has `contents: read`, passes `vars.RELEASE_APP_CLIENT_ID` and `secrets.RELEASE_APP_PRIVATE_KEY`, and says "The App's tag push starts the repository's tag-triggered release workflow". The single-workflow arrangement the document uses (`contents: write`, no App, a dependent release job) is the one described in the header comment of `version.yml`, not the example. `preview.yml` does match the example.
PROPOSAL: Say that ci.yml follows the "same workflow" arrangement described in `version.yml` and takes its trigger and concurrency layout from the example.

FINDING: F-12
KIND: factual
SEVERITY: nit
WHERE: Design > Access token (client address, lines 492-496)
EVIDENCE: "The client address is the last `X-Forwarded-For` value when the socket peer is trusted." A request from a trusted peer that has no `X-Forwarded-For` header has no defined client address. That covers the Playwright suite through the published port, deploy.sh's health wait and any direct call to `127.0.0.1:8790` on win-main.
PROPOSAL: Say that a trusted peer without the header is keyed on its socket address.

FINDING: F-13
KIND: factual
SEVERITY: nit
WHERE: Test Plan row AC-20 ("sample `anon` from `/sys/fs/cgroup/memory.stat` every 100 ms")
EVIDENCE: `/sys/fs/cgroup/memory.stat` is the path inside the container. The runtime image is distroless with no shell or `cat`, so the test cannot read it with `docker exec`. From the test process it has to read the container's cgroup on the host, for example `/sys/fs/cgroup/system.slice/docker-<id>.scope/memory.stat`.
PROPOSAL: Name the host-side cgroup path, or the method the test uses to read the container's `memory.stat`.

FINDING: F-14
KIND: factual
SEVERITY: nit
WHERE: Design > Submission, concurrency and idempotency (tracker step 2 "oldest first by creation time", line 365); Design > HTTP API (`GET /api/jobs` "newest first by creation time", line 507)
EVIDENCE: Every job in a batch is inserted in one transaction and can share a creation time, so the order of prompt lines and variants within a batch is not defined for submission or for the list.
PROPOSAL: Add a tie-break, for example the insertion order within the batch.

FINDING: F-15
KIND: factual
SEVERITY: nit
WHERE: Design > Deployment and exposure (deploy steps 2 to 4, lines 606-617; compose "on the image tag being deployed", lines 595-596); Design > Restart, upgrade and rollback ("When the previous image is not loaded", line 467)
EVIDENCE: Step 2 pulls `ghcr.io/vhco-pro/3d-assets-gen@<digest>`, and an image pulled by digest has no tag. Step 3 saves and loads it, but Compose (`pull_policy: never`), the record of the previous tag and rollback's "not loaded" check all use a tag. No step creates it.
PROPOSAL: Say that deploy.sh tags the verified image `ghcr.io/vhco-pro/3d-assets-gen:<version>` before `docker save`, so the loaded image carries that tag.

### R-6

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Export (lines 581-584, "tied to the session that created it"); Design > Access token (lines 496-499, cookie value); Design > HTTP API (`GET /api/exports/<export id>` row, line 529); AC-08; Test Plan row AC-08 ("a link used from another session refused")
EVIDENCE: The session cookie's value is "HMAC-SHA256 keyed with the token over the string `asset-studio-session-v1`" (lines 497-499). Every sign-in under the same token therefore gets a byte-identical cookie, and the app stores no session record, so nothing identifies "the session that created" an export. Two Playwright contexts that each sign in send the same cookie, so the AC-08 case "a link used from another session refused" cannot be built or passed by an implementation that follows the cookie design. A bearer-token client (as `verify:live` is) has no session at all, so it is also undefined what an export it creates is tied to.
PROPOSAL: Either drop the session binding and rely on the random one-time, five-minute export ID, removing the "another session" case from the AC-08 row, or give each sign-in its own random session ID (signed with the token key) and say what a bearer-token export is tied to.

FINDING: F-02
KIND: factual
SEVERITY: blocking
WHERE: Test Plan row AC-17 ("`bun test .github` parses `ci.yml` ..."); Design > Verification commands (line 734, "unit tests" in `bun run verify`); Frontmatter `covers` (`.github/`)
EVIDENCE: With Bun 1.4.3 on fedora-43, in a scratch directory holding only `.github/tests/ci.test.ts`, `bun test .github` printed "The following filters did not match any test files ... .github" and exited 1, and a bare `bun test` printed "error: 0 test files matching **{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}" and exited 1. `bun test ./.github` ran the test and passed. Bun's discovery skips dot-directories, so the proof command as written fails a correct implementation. A `bun run verify` that runs `bun test` without that explicit path also never runs these checks, so CI does not enforce them.
PROPOSAL: Write the command as `bun test ./.github`, or put the workflow tests under a non-hidden path such as `app/ci/`, and say that `bun run verify` runs them by that explicit path.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy.sh step 1, lines 631-635; step 4, lines 645-649; logon task paragraph, lines 656-662); Design > Restart, upgrade and rollback (rollback.sh first step, lines 478-479); AC-15; Test Plan row AC-15
EVIDENCE: Step 1 registers `AssetStudio-Docker` and runs it when Docker Desktop is not running. The task runs `start-asset-studio.ps1` (line 656), but deploy.sh copies that script only in step 4 (line 646). On a first install against a stopped Docker Desktop, which Background records as the state when first checked (line 117), the task has no script to run, Docker Desktop never starts and step 1 fails after three minutes. On later deploys and on rollback, running the task also starts the script's own `docker compose up` on the tag in `current.json`, the version being replaced. That runs at the same time as deploy step 4's `compose up` on the new tag, or as rollback's stop and `restore-backup`. The newer app can then start on the restored database and migrate it again before rollback brings up the previous image, which then refuses the newer schema. The behaviour when `current.json` does not exist yet is also undefined. The task's Compose step was added by the previous revision.
PROPOSAL: Copy `start-asset-studio.ps1` before step 1 registers or runs the task. Give the script a mode, or have step 1 use a separate start action, that only starts Docker Desktop when deploy.sh or rollback.sh call it. Say that the script does nothing beyond starting Docker Desktop when `current.json` is missing.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (rollback.sh, lines 478-485); Design > Deployment and exposure (compose.yaml "on the image tag being deployed", line 617; `current.json` written in step 4, lines 646-649; logon script reads `current.json`, lines 656-660); AC-15
EVIDENCE: deploy.sh writes `current.json` with the version, tag and digest, and the logon script brings the app up from it. rollback.sh brings the project up on the previous tag but never updates `current.json` or the previous-tag record. After a rollback, the next reboot or sign-in therefore brings back the newer version on the restored older-schema database, so it migrates again and the rollback is silently undone. The document also does not say how a committed, static `compose.yaml` gets the tag to run (for example an interpolated variable in a `.env` file that deploy.sh writes), so deploy, rollback and the logon script could each set it differently.
PROPOSAL: State that rollback.sh rewrites `current.json` with the previous version's tag and digest from its Release record, and say how the tag reaches Compose (one file that deploy.sh, rollback.sh and the logon script all read). Add to the AC-15 procedure a check that `current.json` names the first version after the rollback.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (logon script "pulls ... in the owner's session, where registry pulls work", lines 657-659); Context > Background (lines 137-139); Context > Owner summary (lines 88-89, "reloading its image if it is missing")
EVIDENCE: Background only records that a registry pull over SSH failed with `error getting credentials ... A specified logon session does not exist`, and that `docker load` worked. No observation shows a pull succeeding from a scheduled task in the owner's session, yet Design states as fact that pulls work there. Design must cite its claims, and the logon recovery in the summary depends on this one. If the credential helper also fails in the task's context, the app does not come back after a reboot until someone redeploys.
PROPOSAL: Cite a measured pull of a public image from a temporary interactive-principal task, or mark the claim as unverified until the AC-15 logon step runs and name the fallback, for example the task loading a saved image tar that deploy.sh leaves on `win-main`.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (tracker step 6, lines 398-399); Design > Cancel, retry and delete (cancel answer handling, lines 434-437); AC-06
EVIDENCE: Step 6 calls the per-job cancel for a job running more than 15 minutes "and marks it `failed` with a timeout message". It does not say what happens when the cancel answers `{"cancelled": false}`. On win-main, `_cancel_job_by_id` in server.py returns False for an ID that has already finished. In that case a prompt that completed in the gap is marked `failed` and its outputs are never collected. The user-cancel path handles this case (lines 436-437); the timeout path does not, and it also does not say what happens when the cancel call gets an unreachable or server-error answer.
PROPOSAL: Say that the timeout path follows the same rule as a user cancel: on `{"cancelled": false}` it reads the history again and collects a success or records the error, and on an unreachable answer the job stays `submitted` until a later tick.

FINDING: F-07
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan row AC-11 ("then lists ComfyUI's `output/asset-studio/` and `input/asset-studio/` over SSH and finds no entry for either job"); Design > Submission, concurrency and idempotency (collection, lines 409-410); AC-11
EVIDENCE: The tracker runs the `done` update first and deletes the job's ComfyUI files afterwards (lines 409-410). A failed delete is left for the sweep, which runs every ten minutes (lines 412, 418-419). `verify:live` waits for `done` and then lists the folders straight away, so a correct implementation can still have the files present when the listing runs, or until the next sweep after a transient delete failure. The proof can therefore fail a correct implementation intermittently.
PROPOSAL: Have the proof poll the two folders until no entry for either job remains, with a stated bound (for example two minutes), or until after the next sweep, and fail only when that bound passes.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy.sh step 2, `cosign verify` "with the certificate identity of this repository's `ci.yml` workflow", lines 637-639); Design > Versioning and release path (`ci.yml` triggered by pushes to any branch, lines 667-668; prerelease images from the feature branch, lines 691-694); Test Plan row AC-17 (`check-image.sh` "runs the same `cosign verify`")
EVIDENCE: The release action signs with `cosign sign --yes` inside the `release` job of `ci.yml` (docker-release-action action.yaml at c499e52, step "Sign image with cosign (keyless)"). A keyless certificate's identity includes the workflow ref, which here is `refs/heads/<feature branch>` for a prerelease and `refs/heads/main` for a release. The document gives no exact identity or pattern. An implementer who pins `.../ci.yml@refs/heads/main` rejects every prerelease, which must be deployed before the implementation review. One who uses a loose regular expression accepts other workflows or forks.
PROPOSAL: Give the exact check, for example `--certificate-identity-regexp '^https://github.com/vhco-pro/3d-assets-gen/\.github/workflows/ci\.yml@refs/heads/.+$'` with `--certificate-oidc-issuer https://token.actions.githubusercontent.com`, and use it in both deploy.sh and check-image.sh.

FINDING: F-09
KIND: factual
SEVERITY: nit
WHERE: Design > Deployment and exposure (deploy.sh step 2, "the SPDX predicate type that `actions/attest-sbom` records", lines 640-641); Design > Versioning and release path (`attest-sbom` input, line 681)
EVIDENCE: At c499e52 the action's "Attest SBOM" step uses `actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0` with `sbom-path`, not `actions/attest-sbom`. The SPDX predicate type is the same, so nothing that gets built changes.
PROPOSAL: Name `actions/attest` with an SPDX `sbom-path`, or give the predicate type URI directly.

FINDING: F-10
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (lines 52-60 and 86-89); Design > Deployment and exposure (line 653-654, "The app keeps running only while the owner is signed in on `win-main`")
EVIDENCE: Design states that the friend's app is available only while the owner is signed in on win-main. The summary describes the logon task but never says that the app is down whenever the owner is signed out. That is a trade-off the owner should see before accepting.
PROPOSAL: Add one sentence to the summary saying that the app, like Comfy Desktop, runs only while the owner is signed in on `win-main`.

### R-7

TARGET: 5d41ca98fc810620e5582fcc99bb2fb30bfb6087

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Acceptance Criteria AC-18 (line 801); Test Plan row AC-18 (line 826); Design > Glossary (lines 546-566); Scope (submit form bullet, lines 186-188); Test Plan row AC-09 ("every control with an accessible name", line 817)
EVIDENCE: AC-18 requires the page to label "job states, form fields, banners and the library with exactly the terms in the Glossary", and its proof "reads every job-state label, form-field label, banner text and the library heading and asserts each is one of the Glossary terms". The submit form must also have a prompt field ("submit a batch of prompts (one per line) or images", line 186), an image file field, and a sign-in token field, and AC-09 requires every control to have an accessible name. The Glossary (lines 550-566) has no term for the prompt field, the image field, the prompts-or-images choice or the access token field. Any correct, labelled form therefore has form-field labels that are not Glossary terms, so the AC-18 proof fails a correct implementation.
PROPOSAL: Add Glossary rows for every form field the page shows (for example Prompts, Images and Access token), or limit AC-18 and its proof to the preset fields, job states, banners and library heading and say so in both places.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (`bun test app`, lines 758-761); Design > Runtime and layout (`app/e2e/` holds the Playwright scenarios, line 229); Test Plan row AC-20 (line 828); Test Plan row AC-17 (line 825)
EVIDENCE: With Bun 1.4.3 on fedora-43, in a scratch tree holding `app/server/a.test.ts` and `app/e2e/submit.spec.ts`, `bun test app` printed `app/e2e/submit.spec.ts:` and ran it; Bun's discovery matches `.spec.` files, and `bun test --help` lists `--path-ignore-patterns`. The Playwright specs the Test Plan names (`submit.spec.ts`, `queue.spec.ts` and the others) sit under `app/e2e/`, so the literal `bun run verify` step loads them under Bun's runner, where `@playwright/test`'s `test()` does not run. Separately, the AC-20 memory tests live in `bun test app/server` and "run the built image", but `bun run verify` runs the unit tests before "the production build ... a local image build", so on a clean CI checkout the image they need does not exist yet, or a stale one is measured.
PROPOSAL: State that the unit test step excludes `app/e2e/` (for example with `--path-ignore-patterns` or a bunfig setting), and either move the AC-20 memory tests after the image build in `bun run verify` or say that they build the image themselves.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (Playwright suite against the image, lines 760-761; `bun run seed`, lines 774-780; dev layout, lines 764-769); Design > Container image (`/data` named volume and `/comfy/*` mounts, lines 620-622); Test Plan rows AC-07, AC-04 and AC-18 ("on the seeded fixture", "on the empty profile")
EVIDENCE: The Playwright suite runs "against that image with the fake ComfyUI", and AC-07 and AC-18 run "on the seeded fixture". `bun run seed` is a Bun tool that writes rows and fixture GLBs and thumbnails into the configured data directory, while the container keeps its database in a named volume at `/data`, and the executable offers only `schema-version` and `restore-backup` commands (lines 482-484). Nothing says how the fixture gets into the container's `/data`, how the fake learns the seeded prompt IDs in that setup, or how the container (UID 65532) can delete files the fake writes in a host folder owned by the CI runner's user when that folder is bind-mounted at `/comfy/output`. Two implementers would build different harnesses, and one that seeds only `.dev-data/` leaves the container's library empty.
PROPOSAL: Say how the suite seeds the container: for example a `seed` command in the executable run against the volume, or a seeded data directory bind-mounted with ownership 65532, and how the fake's folders are made writable for the container.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Context > Owner summary ("published as a public GHCR package", lines 80-81; authorization, line 88); Design > Versioning and release path (line 690-691); Design > Deployment and exposure (deploy step 2 "without credentials (the package is public)", lines 655-656; logon pull, lines 679-681); Test Plan row AC-17 (`check-image.sh`, line 825)
EVIDENCE: GitHub's "Configuring a package's access control and visibility" page says a package linked to a repository "inherits the access permissions (but not the visibility) of the linked repository" and "When you first publish a package, the default visibility is private ... Once you make your package public, you cannot make your package private again." The first `release` job therefore creates a private `ghcr.io/vhco-pro/3d-assets-gen`, and deploy step 2, the logon pull and `check-image.sh` all pull without credentials. No step makes the package public, no check confirms it, and the change is a one-way setting in the package's Danger Zone that the acceptance does not name.
PROPOSAL: Add the one-time step that sets the package public after the first publication (naming who does it and that it is irreversible), list it in the authorized actions or the owner's checklist, and have `check-image.sh` assert an anonymous pull works.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Export (file names and manifest, lines 598-601); Design > HTTP API (`GET /api/assets/<id>/model.glb` "named after the prompt", line 537); AC-08 (line 791); Test Plan row AC-08 ("checks its six file names", line 816)
EVIDENCE: The zip holds "`<slug>-<short id>.glb` and the source image under the same base name", and the single download is "named after the prompt", but the document never defines the slug (character set, length, what an image job or a prompt with no Latin letters gives), the short ID's length, or how the prompt reaches `Content-Disposition` safely. `manifest.json` lists "prompt (or upload name), engine, seed, face target, texture size and creation time" with no field names or structure, although it is the file a friend's tooling reads. The AC-08 proof "checks its six file names", which cannot be written without the rule, and two implementers would produce different names and manifests.
PROPOSAL: Define the slug and short ID rules, the download file name for both job kinds, and the manifest's JSON fields, and have the AC-08 proof check those exact names and fields.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Design > Cancel, retry and delete (lines 436-448); Design > Submission, concurrency and idempotency (tracker step 2, lines 376-391; "When ComfyUI does not answer", lines 410-411); AC-05; Test Plan row AC-05 (line 813)
EVIDENCE: For a `pending` job with an attempt ID the tracker "gets `POST /api/jobs/<prompt id>/cancel` first ... and then becomes `cancelled`", and for a `submitted` job only the `{"cancelled": true}` and `{"cancelled": false}` answers are defined. The user-cancel path does not say what happens when that call is unreachable or gets a server error: whether the job becomes `cancelled` anyway (leaving a prompt ComfyUI may still run) or keeps the flag for a later tick. The timeout path now defines this case (lines 407-408), the user path does not. Step 2 also does not say whether it skips a `pending` job whose cancel flag is set, so a job whose cancel failed can be posted in the same tick. The AC-05 proof has no case for either.
PROPOSAL: State that on an unreachable or server-error cancel answer the job keeps its state and flag until a later tick, and that step 2 never submits a job with the cancel flag set. Add both cases to the AC-05 tracker tests.

FINDING: F-07
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Access token (cookie, lines 508-511); Context > Owner summary ("the session cookie lasts 30 days", line 53); Test Plan row AC-12 (`Max-Age` 2592000, line 820)
EVIDENCE: The cookie's value is "HMAC-SHA256 keyed with the token over the string `asset-studio-session-v1`", so every sign-in gets the same value and the server holds no issue time. `Max-Age` only tells the browser when to drop it; the server accepts that value, from any client that has it, until the token is rotated. The summary's "the session cookie lasts 30 days" therefore overstates what the server enforces, and a copied cookie never expires. Neither the summary nor an Open Question states this trade-off.
PROPOSAL: Either sign an issue time into the cookie and reject it after 30 days (with a test on a faked clock), or say in the summary and Design that a cookie stays valid until the token is rotated.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Scope (README and `AGENTS.md` bullet, lines 197-199); Acceptance Criteria (no criterion); Test Plan (no row); Frontmatter `covers`
EVIDENCE: Scope puts in a README with the owner's node-share checklist, and the `AGENTS.md` "Local commands and constraints" section naming the bootstrap, seed, run, verify, deploy, rollback and clean commands plus a route to `conventions/terminal-output.md`. conventions/frontend-testing.md lines 28-33 require the README and agent instructions to name those commands and state readiness detection. No criterion or Test Plan row checks any of it, and neither `README.md` nor `AGENTS.md` is in `covers`, so the feature can reach `complete` with `AGENTS.md:21` still saying "No build or test commands exist yet."
PROPOSAL: Add a criterion that the README and `AGENTS.md` name those commands, the checklist and the route, with a check (for example a test that each named command exists in `package.json` or `scripts/`), and add both files to `covers`.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (Content-Length and body limits, lines 337-344); Design > HTTP API (`POST /api/batches` "prompts (JSON)", line 531); AC-20 (line 803); Context > Owner summary (lines 59-60)
EVIDENCE: The only body limits are the 201 MiB `Content-Length` check and Bun's 256 MiB `maxRequestBodySize`, and only the multipart path is said to stream. A prompt batch is JSON, and its valid content is at most 25 lines of 500 characters plus presets, yet a JSON body up to 201 MiB passes the checks and is parsed whole. Two such requests at once can approach the container's 1 GiB limit, which the summary says streaming keeps it inside. AC-20 tests only image batches and exports.
PROPOSAL: Give JSON batch bodies their own small cap (for example 1 MiB) checked from `Content-Length` and while reading, answered with the app's 413 message, and add that case to the AC-02 tests.

FINDING: F-10
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Access token (client address and trusted peers, lines 514-521); Test Plan rows AC-12 (`signin.spec.ts`, line 820) and AC-02, AC-07, AC-08 (Playwright against the container)
EVIDENCE: Playwright reaches the container through its published port, so every browser context arrives from the gateway without `X-Forwarded-For` and is keyed on that one socket address. `signin.spec.ts` deliberately sends wrong tokens and, after the rotation, old-cookie requests in both Chromium and Firefox, all counted in that single budget of 10 per 60 seconds, while other specs run against the same container. conventions/frontend-testing.md lines 94-95: "Separate tests that consume rate-limit or lockout budgets". The document does not separate them, so parallel journeys can receive 429 for reasons unrelated to what they test.
PROPOSAL: State that the sign-in and rotation scenarios run against their own container instance, or serially in a separate Playwright project with the budget reset between them.

FINDING: F-11
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-15 ("Then stop the Compose project, remove the current image, start the `AssetStudio-Logon` task", line 823)
EVIDENCE: `docker compose stop` keeps the service's container, and Docker refuses `docker image rm` of an image's last tag while a stopped container still references it ("conflict: unable to remove repository reference ... container ... is using its referenced image"). Followed as written, the logon step fails before the logon task is started, or an operator forces the removal, which only untags the image and leaves it present, so the task's reload is not exercised.
PROPOSAL: Write the step as `docker compose down`, then `docker image rm` of the current tag, then confirm the image is absent before starting the task.

FINDING: F-12
KIND: factual
SEVERITY: nit
WHERE: Test Plan row AC-16 ("`bun run dev` in CI starts and prints its ready line within 30 seconds", line 824); Design > Repository and CI (`checks` runs `bun run verify`, lines 725-727); Design > Verification commands (lines 758-762)
EVIDENCE: The only CI job that runs checks is `checks`, which runs `bun run verify`, and the list of what `bun run verify` runs does not include starting `bun run dev`. The AC-16 proof says this check runs "in CI" without saying where.
PROPOSAL: Add the `bun run dev` readiness check to the `bun run verify` list, or name the CI step that runs it.

FINDING: F-13
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary ("after the local history was scrubbed of the PC's tailnet address, Windows user name and local paths", lines 77-78); Review Log > R-5 F-10 (line 1521)
EVIDENCE: The stored R-5 F-10 record, which must be kept verbatim, contains the fedora-43 path `/home/m/go/bin/cosign` (`sed -n 1521p` on the document). The summary says the history was scrubbed of local paths, but this document will carry one into the public repository.
PROPOSAL: Qualify the summary to say which paths were scrubbed, or have the owner decide whether that one home path is acceptable in the public history.

### R-8

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > ComfyUI client (version check, lines 301-306); Test Plan row AC-04 (line 861); AC-04 (line 835); Context > Owner summary ("stops submitting with a clear banner otherwise", lines 50-51); Design > Glossary ("ComfyUI incompatible" row, line 576)
EVIDENCE: Design says the tracker reads `comfyui_version` "at start, after every period in which ComfyUI was unreachable, and on every tick while ComfyUI is incompatible" (lines 302-303). Nothing re-reads the version while ComfyUI is reachable and was last seen as compatible. The AC-04 proof needs "a fake that switches to `comfyui_version` 0.46.1 while staying up" to make `/api/health` report incompatible and to get no `/prompt` or cancel call. Under the Design that switch is never read, so the tracker keeps submitting and a correct implementation fails the proof. The second case, "one that restarts reporting 0.46.1 with its queue emptied", has the same problem whenever the fake's restart falls between two 2-second ticks: the tracker never sees an unreachable period, so it never re-reads the version, and step 5 treats every `submitted` job as lost and posts it again to the old fake. This gap traces to the change made for R-4 F-09, which added only the re-read while already incompatible.
PROPOSAL: Re-read `/system_stats` and its version on every tick (or before every submission step), so a change while reachable is detected. Alternatively, drop the "while staying up" case and make the restart case's downtime span at least one tick, and say so in the row.

FINDING: F-02
KIND: factual
SEVERITY: blocking
WHERE: Design > Verification commands (Playwright seeding, lines 802-806; `bun run dev`, lines 811-819; `bun run seed`, lines 821-828); AC-16 (line 847); Test Plan row AC-16 (line 873); Test Plan rows AC-07 and AC-18 ("on the seeded fixture")
EVIDENCE: The seed "refuses to run unless the configured ComfyUI URL answers that marker endpoint" (lines 822-823), so the fake has to be running before the seed runs. The fake loads the seeded `submitted` jobs' prompt IDs "at start as queued and running prompts" (lines 825-826), and in the Playwright harness "the fake reads the seeded prompt IDs from the same data directory at start" (line 806), so the fake has to start after the seed. Both cannot hold. In the documented development flow, `bun run dev` starts the fake and the server, and `bun run seed` then writes `submitted` fixture rows whose prompt IDs the already-running fake never loaded. Tracker step 5 then finds those attempts "in neither" the queue nor the history, returns the jobs to `pending` and resubmits them, so the fixture's `submitted` jobs change state, against AC-16 ("its fixture jobs keep their states while the app runs") and the inert-seed rule in conventions/frontend-testing.md lines 69-72. The AC-16 proof ("with the app and fake running ... after seeding") fails an implementation that follows these lines.
PROPOSAL: Have the fake look up seeded prompt IDs from the data directory on every `/queue` and `/history` request (or reload them on a control call the seed makes), instead of only at start. Alternatively, let the seed check the marker in a way that does not need the fake to load fixture state, and state the start order for `bun run dev`, `bun run seed` and the Playwright harness.

FINDING: F-03
KIND: factual
SEVERITY: blocking
WHERE: Design > Glossary (lines 557-587); AC-18 (line 849); Test Plan row AC-18 (line 875); AC-08 and Test Plan row AC-08 ("selects three assets", lines 839 and 865); Design > Page (viewer "retry button", lines 598-600); AC-07 (line 838); Test Plan row AC-09 ("every control with an accessible name", line 866)
EVIDENCE: The AC-18 proof "reads every job-state label, form-field label, button label, banner text and the library heading on the sign-in screen and the main view and asserts each is one of the Glossary terms". "Download selected" needs a selection control on each library asset (the AC-08 journey "selects three assets"), and the AC-09 proof requires every control to have an accessible name. The Glossary has no term for that selection control, so any correct, labelled checkbox fails the proof. The viewer's error state also has "a retry button that imports it again" (line 599), while the Glossary defines "Retry" only as "The button that retries a failed or cancelled job" (line 584). The viewer button therefore either contradicts the Glossary meaning or carries a label that is not a Glossary term. This traces to the change made for R-7 F-01, which added only Prompts, Images and Access token.
PROPOSAL: Add Glossary rows for every control the page shows, at least the per-asset selection control and the viewer's retry button (with its own meaning), and check the page for any other control (for example a viewer close button). Alternatively, limit the AC-18 proof to the categories AC-18 names and list them exactly.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan rows AC-02 (line 859), AC-03 (line 860), AC-08 (line 865), AC-12 (line 869) and AC-16 (line 873), which name `bun test app/server`; Design > Verification commands (unit test step and memory tests, lines 794-798); Test Plan row AC-20 (line 877)
EVIDENCE: The memory tests live in `app/server/memory/` and need the built image (lines 797-798, 877). `bun test` takes positional arguments as path filters. With Bun 1.4.3 in a scratch tree holding `app/server/a.test.ts` and `app/server/memory/m.test.ts`, `bun test app/server` printed "Ran 2 tests across 2 files", so it ran the memory test too. The `bun run verify` step excludes `app/server/memory/**` explicitly, but the five Test Plan rows name plain `bun test app/server`. A reviewer who runs those proofs as written also starts the memory tests, which fail or measure a stale image when the image has not just been built.
PROPOSAL: Name the proof command as `bun test app/server --path-ignore-patterns 'app/server/memory/**'` in those rows (or move the memory tests out of `app/server/`, for example to `app/memory/`), so each row runs only the tests it names.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Access token ("at least 32 random bytes encoded as base64url", line 510); Design > Container image (configuration "loaded strictly" including the access token, lines 657-660); Design > Verification commands (dev token `dev-token-not-for-production`, lines 811-812); AC-16 (line 847)
EVIDENCE: The configuration is loaded strictly and its token is described as "at least 32 random bytes encoded as base64url". The committed development token `dev-token-not-for-production` is 28 base64url characters, which decode to 21 bytes. A loader that enforces the stated form refuses `dev/config.yaml`, so `bun run dev` never reports ready and the AC-16 readiness step fails. A loader that does not enforce it accepts any short token in production. Two implementers would build different loaders.
PROPOSAL: Say whether the loader enforces the token format. If it does, make the development token meet it (for example a fixed 43-character base64url value that still reads as non-production) or name the exception for the token the fake-marker rule already guards.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Verification commands (one image with one seeded data directory and one fake, lines 802-808); Test Plan rows AC-04 (`offline.spec.ts`, line 861), AC-07 (empty profile, line 864), AC-05 and AC-03 (`queue.spec.ts`), AC-08 (`export.spec.ts`) and AC-18 (`glossary.spec.ts`)
EVIDENCE: Only the sign-in and token-rotation scenarios get their own container (lines 806-808). Every other journey shares one container, one seeded data directory and one fake. `offline.spec.ts` stops the fake and switches it to an incompatible version, which halts submission, cancel and collection for every journey running at the same time. The AC-07 and AC-04 empty-profile cases need a data directory with no jobs, which the shared seeded fixture is not. `queue.spec.ts` and `export.spec.ts` cancel, retry and download fixture jobs that `glossary.spec.ts` and `library.spec.ts` read. conventions/frontend-testing.md lines 78-79: "Mutating scenarios use dedicated owned identities/data so parallel tests and persistent demonstrations cannot overwrite each other."
PROPOSAL: State which specs get their own container, data directory and fake (at least the offline and incompatible cases and the empty profile), or that those projects run serially, and that mutating journeys act only on rows they create.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (mount paths, `compose.yaml`, `current.json` and `.env`, lines 664-673; logon script, lines 712-718; deploy step 4, lines 700-705); Design > Restart, upgrade and rollback (rollback rewrites `.env`, lines 502-504); Design > Container image (`config.yaml` bind mount from `%LOCALAPPDATA%`, line 656)
EVIDENCE: "`deploy.sh` resolves `%LOCALAPPDATA%` on `win-main` at deploy time", but the document never says where the resolved host paths go. `deploy.sh` "copies `compose.yaml`", and `.env` "holds `ASSET_STUDIO_IMAGE=<tag>`" and is rewritten from `current.json` by `deploy.sh`, `rollback.sh` and the logon script, none of which is said to know the paths. One implementer substitutes the paths into the copied `compose.yaml`. Another relies on Compose interpolating `${LOCALAPPDATA}` from the process environment, which then needs no resolution step. A third writes them to `.env` from `deploy.sh`, and the next rollback or logon rewrite of `.env` drops them, so the container no longer mounts the ComfyUI folders or `config.yaml`.
PROPOSAL: Name the one place the host paths live (for example `${LOCALAPPDATA}` interpolation in `compose.yaml`, or a second env file only `deploy.sh` writes) and say that the `.env` rewrite by all three scripts preserves it.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Scope (README and `AGENTS.md` bullet naming bootstrap, seed, run, verify, deploy, rollback and clean commands, lines 202-204); AC-21 (line 852); Test Plan row AC-21 (line 878); Design > Verification commands (lines 792-828)
EVIDENCE: AC-21 and its proof require both files to "name the seven commands", including bootstrap and clean. Design defines `bun run dev`, `bun run seed` (with `--profile empty` and `--reset`), `bun run verify`, `bun run verify:live`, `deploy.sh` and `rollback.sh`, but no bootstrap command and no clean command. It is not said whether clean is `bun run seed --reset`, a removal of `.dev-data/`, or something else, or whether bootstrap is `bun install` or a script. conventions/frontend-testing.md lines 28-29 require all five development commands. Two implementers would name different commands, and the AC-21 test cannot tell which one is "clean".
PROPOSAL: Define the bootstrap and clean commands in Design (name, what they do and what clean deletes, within the fixture's ownership boundary), and have the AC-21 test assert those exact names.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Versioning and release path (`release` bullet, lines 738-745); Design > Container image (version and commit as build arguments, lines 648-649); AC-17 (line 848)
EVIDENCE: At c499e52 `michielvha/docker-release-action`'s `action.yaml` has `registry` defaulting to `docker.io`, requires `username`, `password` and `project`, builds the tags as `${registry}/${username}/${project}:<version>`, and passes caller build arguments only through `build-args`. The document gives the action "that version and the required security profile" and nothing else. knowledge/container-release.md: "Supply the actual registry, credentials, project, computed version, context, and platforms required by the selected action." Without `registry: ghcr.io`, `username: vhco-pro` and `project: 3d-assets-gen` the image is not `ghcr.io/vhco-pro/3d-assets-gen`. Without `build-args` carrying the version and commit, the published image cannot report them, which AC-17 and the deploy health wait need.
PROPOSAL: List the release call's remaining inputs: `registry: ghcr.io`, `username: vhco-pro`, `password: ${{ secrets.GITHUB_TOKEN }}`, `project: 3d-assets-gen`, `platforms: linux/amd64`, and `build-args` with the version and commit argument names the Dockerfile reads.

FINDING: F-10
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy step 3, "checks that the loaded image ID equals the pulled one", lines 697-698); Test Plan row AC-15
EVIDENCE: On fedora-43, `docker info` reports Docker 29.9.3 with storage driver `overlayfs` and `driver-type io.containerd.snapshotter.v1`. With the containerd image store, `docker image inspect --format '{{.Id}}'` is the manifest or index digest. With the classic store it is the config digest, and `docker save | docker load` drops `RepoDigests`. Background records only that `docker load` on win-main printed "Loaded image: alpine:3.22" (line 154). It does not record which ID win-main reports for a loaded image, and an SSH `docker info` against win-main did not return within 60 seconds during this review. The document does not say which identity is compared, so the check can fail every correct deploy when the two hosts use different image stores, or compare a value that proves nothing.
PROPOSAL: Name the identity the check compares (for example the image config digest from `docker image inspect --format '{{.Id}}'` under a stated store, or the config digest read from the saved archive) and cite a measured save and load between fedora-43 and win-main that shows the values match.

FINDING: F-11
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Access token (rate limit, lines 525-527); AC-12 (line 843); Test Plan row AC-12 (line 869)
EVIDENCE: "Over the limit, those requests get 429", where "those requests" are wrong sign-ins, wrong bearer tokens and cookies that do not match. A correct token from a limited client is still accepted, so a guessing client sees 429 for a wrong token and success for the right one. That is the same information it gets from 401, so the limit does not slow guessing. Read the other way, every authentication request from a limited client gets 429, which also locks out a correct sign-in from that device for up to 60 seconds. The AC-12 proof never sends a correct token while the client is over the limit, so both readings pass it.
PROPOSAL: State whether a correct sign-in or bearer token from a client over the limit gets 429 or succeeds, and add that case to the AC-12 auth tests. If correct tokens still succeed, say in Design that the token's entropy, not the limit, is the defence against guessing.

FINDING: F-12
KIND: factual
SEVERITY: should-fix
WHERE: Design > Cancel, retry and delete (pending job with an attempt ID, lines 445-447); Design > Submission, concurrency and idempotency (30-second wait after a post, lines 388-394); AC-05 (line 836); Test Plan row AC-05 (line 862)
EVIDENCE: A `pending` job can hold an attempt whose post timed out less than 30 seconds ago, the case step 2 waits for because ComfyUI may still be accepting the prompt (lines 388-390), and ComfyUI 0.46.2 does not reject an unknown ID on cancel ("answers `{"cancelled": false}` for a finished or unknown ID", line 133). The cancel path calls the per-job cancel, gets `{"cancelled": false}` because ComfyUI has not queued the prompt yet, and marks the job `cancelled`. ComfyUI then accepts the late post and runs it for several minutes ahead of later jobs, and its results are ignored. The AC-05 proof covers only a pending job whose prompt the fake has already queued.
PROPOSAL: Apply the same 30-second rule to cancel: a `pending` job whose recorded post time is less than 30 seconds old keeps its flag until the attempt shows up or the window passes, then is cancelled. Add a fake that accepts the post after the cancel call to the AC-05 tests.

FINDING: F-13
KIND: factual
SEVERITY: should-fix
WHERE: Design > Export (lines 612-619); Design > HTTP API (`GET /api/exports/<export id>`, line 552); Design > Cancel, retry and delete (Delete, lines 465-470)
EVIDENCE: `POST /api/exports` checks the selection and issues a link that stays valid for five minutes. Delete is allowed on any `done` job at any time. The document covers a file deleted while a download is streaming (lines 468-470), but not a job deleted, or its files gone, after the link was issued and before the GET starts. One implementer skips the missing asset and writes a `manifest.json` that no longer matches the selection. Another answers an error, and because the page navigates the browser to the link, the friend lands on a JSON error page instead of the app. The two size limits were checked at POST time and could also change.
PROPOSAL: Say what `GET /api/exports/<export id>` does when a selected job no longer exists or its files are missing (for example answer 409 before streaming, with the page showing the message) and add that case to the AC-08 export tests.

FINDING: F-14
KIND: factual
SEVERITY: should-fix
WHERE: Design > Pipeline port and combined graphs (presets table Seed row and "A random seed is drawn uniformly", lines 276-279); Design > Glossary ("Seed: The seed of the first variant", line 574); Context > Owner summary ("an optional seed", line 60)
EVIDENCE: With the seed field empty, "A random seed is drawn uniformly from 0 to 4294967295", but the document does not say how many are drawn: one per batch (every prompt line then shares it, variant k using seed + k), one per prompt line, or one per job. It also does not say which seed an image batch with an empty field uses for each image. Two implementers would produce different seeds for the same batch, and the manifest's `seed` values would differ.
PROPOSAL: State the unit a random seed is drawn for (for example one per prompt line or image, with variant k using that seed + k modulo 2^32), and assert it in a tracker or API test.

FINDING: F-15
KIND: factual
SEVERITY: nit
WHERE: Context > Background (per-job cancel citation "lines 1040-1079", line 133)
EVIDENCE: In the installed `server.py` on win-main, `@routes.post("/api/jobs/{job_id}/cancel")` is at line 1063 and its `return web.json_response({"cancelled": cancelled})` at line 1079. Lines 1040-1062 belong to the `GET /api/jobs/{job_id}` handler, which starts at line 1011.
PROPOSAL: Cite lines 1063-1079.

FINDING: F-16
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary ("One stored review record keeps a `fedora-43` home path, which the owner accepted", lines 80-81); Review Log > R-5 F-10 (line 1572); Review Log > R-7 F-13 (line 1774)
EVIDENCE: The fedora-43 home path appears in two stored records: R-5 F-10's EVIDENCE (line 1572) and R-7 F-13's EVIDENCE (line 1774), which quotes it again. The sentence was added by the previous revision for R-7 F-13.
PROPOSAL: Say "Two stored review records keep the same `fedora-43` home path", and confirm the owner's acceptance covers both.

FINDING: F-17
KIND: factual
SEVERITY: nit
WHERE: Design > Verification commands ("the golden check" in `bun run verify`, lines 794-800; "Bun and Docker are the only dependencies; Python is needed only for `golden:check`", lines 818-819); Design > Pipeline port and combined graphs (lines 281-286)
EVIDENCE: The unit tests already compare against the committed golden files, so "the golden check" in the `bun run verify` list is `bun run golden:check`, which regenerates them with `python3 -I`. Python is then needed for the aggregate verify command, not only for a separate check, and frontend-testing.md lines 32-33 ask the README to state the needed dependencies.
PROPOSAL: Say that `bun run verify` needs `python3` for its golden check, or name the golden check in `verify` as the committed-file comparison and run `golden:check` separately.

FINDING: F-18
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (acceptance "does not authorize ... touching ComfyUI beyond deleting the app's own files in its input and output folders", lines 96-98); Design > Deployment and exposure (deploy step 4 "Creates the two ComfyUI `asset-studio` folders when missing", line 700)
EVIDENCE: Deploy creates `input\asset-studio` and `output\asset-studio` inside ComfyUI's shared folders, which the summary's limit, read literally, does not cover.
PROPOSAL: Say the acceptance also covers creating the two `asset-studio` subfolders in ComfyUI's input and output folders.

### R-9

TARGET: 2768304e1f1b0860bcb70dd49ebc6ad8757f9c21

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > ComfyUI client (line 309); Design > Glossary ("ComfyUI offline" and "ComfyUI incompatible" rows, lines 585-586); AC-18 (line 869); Test Plan row AC-18 (line 895); Test Plan row AC-04 (line 881); Design > HTTP API (`GET /api/jobs` "with queue position for submitted jobs")
EVIDENCE: Line 309 says `/api/health` "reports ComfyUI as incompatible together with the version it found (or none), and the page shows that in its banner". The AC-18 proof reads "the two banner texts" and "asserts each equals its Glossary term", so a banner that reads, for example, "ComfyUI incompatible (found 0.46.1)" as line 309 asks fails the equality check. The job-state labels have the same problem when the queue shows the queue position the API returns next to "Queued". The previous revision (the fix for R-8 F-03) changed the proof from "is one of the Glossary terms" to "equals its Glossary term", which makes this conflict exact.
PROPOSAL: Say that the banner and state label each carry the Glossary term as their own labelled element, with the version and queue position in separate text, and have the AC-18 proof compare only that element. Alternatively, change the proof to "starts with its Glossary term".

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Command-line output (bats, line 798); Design > Verification commands (the `bun run verify` order, lines 804-811); Design > Repository and CI (`checks` runs `bun run verify`); Test Plan row AC-19 (line 896)
EVIDENCE: The AC-19 proof depends on "`bats` tests in `scripts/deploy/tests/`" for `deploy.sh`, `rollback.sh`, `check-repo.sh` and `check-image.sh`. The `bun run verify` list (type check, lint, `bun test app` and `bun test ./.github`, golden check, build and size, image build, memory tests, dev readiness, docs check, Playwright) never runs `bats`, and the CI `checks` job runs only `bun run verify`. conventions/terminal-output.md: "its documented verification command and CI run reporter/output tests for the modes below". conventions/frontend-testing.md lines 30-32: the aggregate command runs the relevant tests and "CI must run the applicable automated checks before merge". As written, the shell tools' output and exit-code tests never run in CI.
PROPOSAL: Add the `bats scripts/deploy/tests` step (and shellcheck of `scripts/deploy/`, which conventions/coding.md line 21 expects scripts to support) to the `bun run verify` order.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Runtime and layout (line 238)
EVIDENCE: Design enables only "the React hooks rules (`rules-of-hooks` and `exhaustive-deps`) at error severity, per `conventions/react.md`". conventions/react.md (Enforcement and verification): "Use the React lint rules supported by the chosen plugin version to check purity, ref access, state updates, immutability, and component identity. Pin and verify the actual configuration." An implementer who follows line 238 enables two rules and leaves out the rest the convention asks for.
PROPOSAL: Name the `eslint-plugin-react-hooks` version and say that its purity, refs, set-state-in-render, immutability and component-identity rules also run at error severity, or record why one is not available.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (`scripts/deploy/tools.env`, lines 684-686); Design > Repository and CI (Renovate bullet, lines 781-783)
EVIDENCE: The tool versions and SHA-256 checksums that `deploy.sh`, `rollback.sh` and `check-image.sh` read live in `scripts/deploy/tools.env`, a file this repository defines and that a person reviews in every Renovate PR. conventions/coding.md lines 70-71: "Configuration a person writes or reviews is YAML. ... Settings files we define use the `.yaml` suffix and load strictly." An env file that the scripts source is neither YAML nor loaded strictly.
PROPOSAL: Keep the pins in `scripts/deploy/tools.yaml` read with a strict parser, or record why a sourced env file is an accepted exception.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (lines 684-686); Design > Repository and CI (`renovate.json` bullet, lines 781-784); Test Plan row AC-14 (line 891, "`renovate.json` exists on `main`")
EVIDENCE: Each pin in `tools.env` is a version plus a SHA-256 checksum, and "a Renovate custom manager in `renovate.json` updates" them. A regex custom manager that only captures the version bumps it and leaves the old checksum, so the next `deploy.sh` fails its checksum check. Digest updates need a datasource that supports them and a captured `currentDigest`, and the document names neither. conventions/delivery.md lines 159-160: "Adding a dependency includes confirming the updater will propose its next version." knowledge/managed-renovate.md lines 50-67 also give a baseline (`config:recommended` and two `packageRules` that block automerge for action majors and `github-digest` updates), and Design lists only `helpers:pinGitHubActionDigests`. The AC-14 proof checks only that the file exists.
PROPOSAL: Specify the custom manager's datasource (for example `github-release-attachments`) with version and digest captured together, adopt the baseline config, and add a check (for example `renovate-config-validator` plus a test that the manager's pattern matches every pin in the file with its checksum) to `bun run verify`.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (deploy step 5, lines 713-714; logon script, line 719); AC-19 (line 870)
EVIDENCE: Deploy step 1 "waits up to three minutes for the engine". Step 5 "waits until `/api/health` on `127.0.0.1:8790` reports the new version and commit", and `start-asset-studio.ps1` "waits for the engine", and neither gives a limit. A container that crash-loops or an engine that never starts leaves `deploy.sh` hanging with no failed step, which AC-19 ("exit non-zero whenever a step failed") cannot observe. One implementer waits forever, another picks some timeout.
PROPOSAL: Give step 5 and the logon script a bounded wait (for example three minutes) that ends in a reported failure, and add the timeout case to the `bats` tests.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: AC-15 (line 866); Test Plan row AC-15 (line 892); Design > Restart, upgrade and rollback (lines 494-507)
EVIDENCE: AC-15 requires that rolling back "restores the matching backup across a schema change". The manual procedure deploys two prerelease versions, and both have schema version 1 ("The first release has schema version 1 and nothing to migrate", lines 499-500), so `rollback.sh` never takes its restore branch. The unit tests are Bun tests: they run `restore-backup` "on a copy" and assert that "the rollback logic picks the newest `schema-1-*` backup". That logic lives in `rollback.sh`, a shell script that asks both images for their schema version and runs the previous image's `restore-backup` against the Compose volume. None of those steps runs in any proof, so a `rollback.sh` that never calls `restore-backup`, or calls it without the volume, passes.
PROPOSAL: Add a `bats` test of `rollback.sh` with stubbed `docker` and `ssh` that asserts it queries both schema versions, picks the newest matching backup, runs `restore-backup` with the data volume mounted, and fails when no backup exists. Alternatively, add a local Docker test that uses a test image at schema 2.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Export (slug rule, line 624; manifest `prompt`, line 633); Design > Pipeline port and combined graphs (Game-asset style row, line 276); Design > Jobs and batches (job row "prompt text", line 330); Test Plan row AC-08 (non-Latin fixture, line 885)
EVIDENCE: "The slug is the prompt", and the manifest has `"prompt": "<text or null>"`. Game-asset style is on by default and "appends the suffix at `scripts/generate_3d.py:23`" (", single object, game asset, centered, ..."). Nothing says whether the slug and the manifest use the user's text or the text with the suffix appended. With the suffix, a non-Latin prompt slugs to `single-object-game-asset-centered-full-o`, not `asset`, so the AC-08 case "downloads as `asset-<short id>.glb`" passes or fails depending on that choice, and on whether the fixture job has style on. Two implementers would produce different file names and manifests.
PROPOSAL: State that the job row stores the user's prompt without the suffix, and that the slug and the manifest `prompt` use it (optionally add a `style` boolean to the manifest). Say which style setting the non-Latin fixture uses.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Repository and CI (CodeQL bullet, lines 777-780); Test Plan row AC-14 (line 891, "code scanning lists analyses for JavaScript/TypeScript, Python and Actions")
EVIDENCE: `vhco-pro/.github` `.github/workflows/reusable-codeql-js.yml` (read with `gh api` during this review) passes `languages: ${{ inputs.languages }}` to `codeql-action/init` and always uploads with `category: "/language:js-ts"`. With `languages: javascript-typescript,python`, the Python results go up under the JS/TS category, so code scanning shows no separate Python category, and the proof does not say how `check-repo.sh` tells a Python analysis apart. An implementer who calls the workflow twice, once per language, gets two uploads with the same category, and the second replaces the first.
PROPOSAL: Keep the single call, and state how `check-repo.sh` confirms Python coverage (for example alerts or rules with the `py/` prefix in the `/language:js-ts` analysis, or the SARIF run's language). Alternatively, add a `category` input to the reusable workflow upstream before relying on per-language analyses.

FINDING: F-10
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (content hash paragraph); Design > Export (image-job slug from "the upload's file name", line 624; manifest `upload`); AC-02 ("a conflict when its content differs")
EVIDENCE: The batch hash covers "the kind, the preset values, then each prompt line in order, or each image's bytes in order". For an image job, the upload's file name decides the slug, the download names and the manifest `upload` field, but it is not hashed. A reused batch ID whose images have the same bytes and different file names gets 200 with the first batch, whose names differ, instead of the 409 that AC-02 requires when content differs.
PROPOSAL: Include each image's file name, as the slug and manifest use it, in the canonical encoding, and add that case to the AC-02 idempotency tests.

FINDING: F-11
KIND: factual
SEVERITY: nit
WHERE: Design > Deployment and exposure (lines 669-671, "the folders the running ComfyUI uses (Background)"); Context > Background
EVIDENCE: No Background bullet states which input and output folders the running ComfyUI uses. The supporting evidence is `scripts/start_headless.ps1:20` (`--input-directory "$shared\input" --output-directory "$shared\output"`, with `$shared` the `ComfyUI-Shared` folder at line 10), and the stored R-5 record that quotes the running process's `--input-directory`.
PROPOSAL: Cite `scripts/start_headless.ps1:10,20`, or add a Background bullet with the running process's directory arguments, path redacted.

### R-10

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > HTTP API (`GET /api/session` row, line 567); Design > Access token (line 539, and the rate-limit paragraph, lines 548-553); Design > Page (line 609); AC-12 (line 898); Test Plan row AC-12 (line 924)
EVIDENCE: This revision (c2dbee2) added `GET /api/session` "without a token and without counting as a failure". Line 539 still says "Every `/api` route except `GET /api/health` and `POST /api/session` requires either an `Authorization: Bearer <token>` header or the session cookie". That makes `GET /api/session` a protected route, and the AC-12 proof's "every protected route returns 401 without credentials" would then cover it. The row also says the route checks whether "the request's cookie or bearer token is valid" without counting failures. Lines 548-553 count every "wrong bearer token" on a protected route toward the limit of 10, so this route is an unthrottled way to test tokens, which undoes the purpose the limit is given there ("keeps a misbehaving client from flooding the logs"). The implementation does this: app/server/http.ts:84-87 returns `Response.json({ signedIn: authorised(req) })` before any limiter call. The document never gives the route's response (status and body), and no Test Plan row checks that it never fails, never counts, or that the page "never makes a failing call".
PROPOSAL: Add `GET /api/session` to the exceptions at line 539. Define its answer, for example 200 with `{"signedIn": bool}`. Have it look only at the cookie, or count a wrong bearer token it receives as a failure. Add AC-12 auth tests for its answer with and without a valid cookie and for its effect on the limiter.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 855-857); Context > Background (Firefox WebGL bullet, lines 177-179); AC-07 (line 893); Test Plan row AC-07 (line 919); Context > Owner summary (lines 73-80)
EVIDENCE: AC-07 requires the viewer to render "in Chromium and Firefox". The AC-07 row asserts the `load` event and non-background canvas pixels in both. This revision adds "where a browser still has no WebGL, the viewer render check skips with that reason rather than pass or fail" (lines 856-857), and app/e2e/library.spec.ts:34 calls `test.skip(!webgl, ...)`. Firefox has rendered in no environment observed so far. On fedora-43 the check skipped (T17 evidence), and so did CI run 44961046719 (checks job log: "1 skipped", "33 passed"). The claim that headed Firefox under Xvfb "can use Mesa for WebGL" has no citation or observed run, and .github/workflows/ci.yml at c2dbee2 runs `bun run verify` with no Xvfb. As written, CI goes green with the Firefox half of AC-07 never executed. Under the standard's composite rule, an implementation review can then only return untested or not verified for AC-07. The Owner summary does not mention this gap.
PROPOSAL: Name in the AC-07 row the environment that supplies the Firefox render, for example the headed Xvfb project in CI, and make a skip there a failure. Otherwise add a written manual Firefox procedure as a fallback, and cite or observe the Xvfb claim.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Tasks (T19, line 973; no unchecked task after T26); Design > Container image (lines 666-673); Design > Verification commands (lines 855-856)
EVIDENCE: This revision changes the runtime to `gcr.io/distroless/base-nossl-debian13:nonroot` and adds headed Firefox under Xvfb in CI. At c2dbee2, Dockerfile line 19 is still `FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2`, and ci.yml has no Xvfb step. T19 is ticked with evidence for the cc runtime, and the only unchecked tasks are T25 (verify-live) and T26 (deploy and live procedures). conventions/feature-documents.md (Tasks): "Re-planning keeps checked tasks and changes only the unchecked tail; new requirements get new task IDs." Nothing in the task list builds the two new requirements, so an implementer who follows the tasks deploys the image the release scan rejects.
PROPOSAL: Add new unchecked tasks, for example T27 `Dockerfile` (base-nossl at the recorded digest, with the image start check and a passing Trivy scan as done conditions) and T28 `.github/workflows/ci.yml`, `playwright.config.ts` (headed Firefox under Xvfb, with the render check passing in CI), both before T26.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Context > Owner summary (lines 46-47 and 73-80)
EVIDENCE: The summary says "Planned proof, none of it run yet". Background (lines 171-179) and the ticked task evidence record observed runs: `bun run verify` end to end (T21), the image start check on base-nossl (4 pass), the memory check, the release Trivy failure, and the Firefox render skip in CI (confirmed in run 44961046719). conventions/feature-documents.md (Owner summary): the summary "must ... distinguish planned checks from observed proof" and should "Explain material changes since the last accepted scope". The summary names the OpenSSL-free container but never says what changed since the R-9 acceptance: the runtime switch and its cause, the Firefox WebGL skip, the new unauthenticated `GET /api/session`, the `tools.env` exception to the YAML rule, the pinned shellcheck, the manifest `style` field, and file names in the batch hash.
PROPOSAL: Replace "none of it run yet" with what was observed during implementation and what is still planned, and add a short paragraph listing the material changes since the accepted R-9 scope.

FINDING: F-05
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Deployment and exposure (lines 705-710); Open Questions ("None.")
EVIDENCE: This revision (c2dbee2, answering R-9 F-04) adds "`tools.env` is an exception to the YAML rule for settings files: the shell scripts source it directly". conventions/coding.md (Configuration format): "Configuration a person writes or reviews is YAML ... Settings files we define use the `.yaml` suffix and load strictly." conventions/feature-documents.md (Open questions): "Every trade-off the document settles is an open question". The document settles a deviation from a repository-routed convention without asking the owner. No Open Question or owner decision records it, and a sourced shell file is executed rather than loaded strictly.
PROPOSAL: Raise the exception as an Open Question, for example A. keep the sourced `tools.env` or B. `tools.yaml` read with a strict parser, and fold in the owner's answer.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Versioning and release path (lines 765-781 and the delivery steps, lines 787-792)
EVIDENCE: The `version` job pushes the tag before `release` runs, and `release` "runs only when `version` pushed a tag". The pinned version.yml (46a1ac9) describes `tagged` as "Whether this run pushed a new exact tag", so a later run at an already tagged commit does not release it. That partial failure has happened: `git ls-remote --tags origin` shows `v0.1.0-feat-asset-studio.1` at ba04bda, `gh release list` shows no Release, and run 44961046719 failed in the release action's Trivy step. The document does not say how a failed release is retried: rerun the failed job in the same run, or push a new commit for the next version. It also does not say what happens after merge when the `main` release fails, when step 2 ("the release image from `main` is deployed") cannot run.
PROPOSAL: State the retry path, for example: rerun the failed `release` job for a transient failure, or land a fix commit that gets the next version for a scan failure; an orphan tag without a Release stays undeployable.

FINDING: F-07
KIND: factual
SEVERITY: nit
WHERE: Context > Background (line 187)
EVIDENCE: "`AGENTS.md:21` states that no build or test commands exist yet." At c2dbee2, AGENTS.md:21 is `## Local commands and constraints`, and lines 23-30 list the commands, as AC-21 requires.
PROPOSAL: Mark the statement as the state before implementation, or cite the earlier commit.

FINDING: F-08
KIND: factual
SEVERITY: nit
WHERE: Sources; Design > Container image (lines 670-671); Design > Deployment and exposure (lines 709-710); Design > Runtime and layout (lines 250-253)
EVIDENCE: This revision adds claims that rest on external pages: base-nossl is "glibc without OpenSSL", the Renovate `github-release-attachments` datasource updates a version and its SHA-256 together, and `eslint-plugin-react-hooks` 7.1 recommends the named rules. Sources lists none of the pages read for these. conventions/feature-documents.md: "Sources lists every external page read, each with the claim it supports."
PROPOSAL: Add the distroless, Renovate datasource and eslint-plugin-react-hooks pages to Sources, each with the claim it supports.

### R-11

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 873-876); Test Plan row AC-07 (line 938); Context > Owner summary (lines 77-78 and 82-83); Context > Background (Firefox WebGL bullet, lines 185-189); Tasks (T28, line 1006)
EVIDENCE: Design says the CI `checks` job "installs Mesa's software GL (`libgl1-mesa-dri`, `libegl1`) ... so CI supplies the Firefox render evidence". The only observation behind this is in Background: Firefox rendered inside `mcr.microsoft.com/playwright:v1.65.1-noble`, a different OS and image. The CI run where Firefox had no WebGL (44961046719, checks job) ran on `Image: ubuntu-26.04`, and its `playwright install --with-deps` step printed `xvfb is already the newest version (2:21.1.22-1ubuntu1.3)` and `libgbm1 is already the newest version (26.0.8-1ubuntu0.3)`. On Ubuntu 26.04, `apt-get install -s xvfb` (run in `ubuntu:26.04` during this review) pulls in `libgl1-mesa-dri`, `mesa-libgallium`, `libglx-mesa0` and `libgl1` 26.0.8, so Mesa's software GL was most likely already installed when Firefox failed. Whether `libegl1`, the one package that may be missing, fixes it was never observed on the runner. Design, the AC-07 row and the Owner summary all present this remedy as settled. If it does nothing, T28's done condition cannot pass and the design has to be revised again.
PROPOSAL: Run the remedy on the real runner before relying on it, for example a throwaway `workflow_dispatch` job on `ubuntu-latest` that installs `libegl1` and reports Firefox's WebGL renderer, and cite that run in Background. Otherwise name a fallback environment for the Firefox render, for example a CI job using the Playwright noble image for the browser suite only.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: AC-12 (line 917); Design > Access token (line 549); Design > HTTP API (`GET /api/session` row, line 579); Test Plan row AC-12 (line 943)
EVIDENCE: AC-12 reads "Every API route except health and sign-in refuses a request without a valid token or session cookie". Design now lists three exceptions, "`GET /api/health`, `GET /api/session` and `POST /api/session`". `GET /api/session` "always answers 200" even without a valid cookie, so it does not refuse such a request. The route came in with c2dbee2 and its behaviour was defined at 5400611, but the criterion text was never updated. Read literally, an implementation that follows Design does not meet AC-12, and an implementation reviewer comparing against the exact accepted text could return `not met`.
PROPOSAL: Reword AC-12 to name the session status route as an exception, for example "Every API route except health, sign-in and the session status check refuses ...", and say in the criterion that the status check never accepts a bearer token.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-12 (line 943); Design > Access token (lines 550-552); Design > HTTP API (`GET /api/session` row, line 579)
EVIDENCE: Design says `GET /api/session` is judged "from the session cookie alone" and "never counts toward the failure limit". The AC-12 row added at 5400611 checks only that "twelve calls with a wrong bearer token leave the next wrong sign-in at 401". A forged or expired cookie on `GET /api/session` is never checked against the limiter. That is the case a real browser hits after a token rotation or after 30 days, because the page calls this route on every load. An implementation that counts a non-matching cookie on this route as a failed authentication passes the row. R-10 F-01 asked for tests of "its effect on the limiter".
PROPOSAL: Add to the AC-12 auth tests that twelve `GET /api/session` calls with a forged cookie (and with an expired one on the faked clock) also leave the next wrong sign-in at 401.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Tasks (T17, line 989; T26, line 1008; no other unchecked task); Test Plan row AC-09 (line 940); Design > Versioning and release path (step 2, line 802, and line 810)
EVIDENCE: The AC-09 row requires "A manual check at 200 percent browser zoom in Chromium on a 1280x720 window ... with screenshots. All screenshots are reviewed and the review result is recorded in the evidence." T17's evidence reviewed screenshots only "at 320x568 and 1440x900" and does not mention a browser zoom check. The unchecked tasks T25 and T27 to T29 do not cover AC-09, and T26 covers AC-10, AC-11, AC-12, AC-14, AC-15 and AC-17 only. Design also says "After merge, the release image from `main` is deployed and AC-10's check is repeated" and "The feature is delivered when step 2 has run", and no task does this. conventions/feature-documents.md (Tasks): each task names "a done condition that is a test or check, and the criteria it advances". Someone following the task list never runs the AC-09 manual procedure, so the implementation review can only return `untested` or `not verified` for AC-09.
PROPOSAL: Add an unchecked task before T26 for the manual 200 percent zoom check and the review of all layout screenshots, with the result recorded under AC-09. Add a final task, or name the shipping step, for the post-merge deploy of the `main` release and the repeat of AC-10's check.

FINDING: F-05
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary ("Still planned", lines 77-79)
EVIDENCE: The summary lists as still planned "the Firefox render in CI with Mesa, the published image's start check, the deploy and rollback checks on `win-main`, the reachability and rate-limit checks from other tailnet devices, and two real generations". Two planned proofs are missing from that list: the `check-repo.sh` repository settings check for AC-14 (T26) and the AC-09 manual 200 percent zoom check with its screenshot review. Neither has been observed.
PROPOSAL: Add the repository settings check and the manual zoom check to the "Still planned" list.

### R-12

TARGET: 81b4b51b7a2cb2d5f31fdaf5a5e8c5165328615b

CRITERION: AC-01 For every input in the golden set, each TypeScript graph builder returns the graph the matching Python builder in `scripts/generate_3d.py` returns, and each combined graph follows the node renumbering, rewiring, prefix and thumbnail rules in Design.
VERDICT: met
EVIDENCE: `bun run golden:check` and `bun run verify` in a `git archive` copy of 81b4b51 (code identical to 6527af5), plus the log of CI run 44996495739 at 6527af5, which I read myself; `✓ Passed: golden graphs match scripts/generate_3d.py`, 11 builder cases and 4 combined-graph tests passed in both; no limitations.

CRITERION: AC-02 Submitting a batch through the page creates one pending job per prompt line and variant, or per image; a batch that is empty, has an over-long prompt, a wrong or oversized file, more than 25 jobs, more than 200 MiB of images, a malformed batch ID, or would exceed 100 unfinished jobs is rejected with a message that names the problem and creates no job and leaves no file; concurrent batches never take the unfinished count above 100; and a repeated batch ID, sequential or concurrent and with any multipart boundary, returns the existing batch, or a conflict when its content differs, without creating anything and without touching the first batch's uploads.
VERDICT: met
EVIDENCE: Local unit suite at 81b4b51 (108 pass) and CI run 44996495739; app/server/api.test.ts covers every rejection, 200 MiB accepted and 200 MiB plus one byte refused with 413, the concurrent limit, a repeated ID under a new boundary, a concurrent duplicate, and different bytes or file name answered with 409; submit.spec.ts passed locally and in CI (Chromium, plus the image batch in Firefox); no limitations.

CRITERION: AC-03 Each job is submitted to ComfyUI as one prompt with its own attempt ID and output prefix, jobs run in submission order, and each ends `done` with its GLB, source image and thumbnail stored, or `failed` with ComfyUI's error message, including when ComfyUI rejects the prompt or the upload, or answers one job with three server errors in a row while later jobs still run.
VERDICT: met
EVIDENCE: Local unit suite and CI run 44996495739: all 7 "AC-03 submission and completion" tracker tests passed, including the 400 from /prompt or /upload/image, three 5xx answers, and Windows backslash subfolders; queue.spec.ts "a job reaches Done and is still there after a reload" passed locally and in CI; limitation: these runs use the fake ComfyUI (the real-ComfyUI path is under AC-11).

CRITERION: AC-04 While ComfyUI is unreachable the page shows it offline, and while it reports a version older than 0.46.2 or none the page shows it incompatible and the app neither submits, reconciles, cancels nor times out anything, whether or not jobs are unfinished; every job keeps its state, and jobs continue once a compatible ComfyUI answers again.
VERDICT: met
EVIDENCE: Local and CI: the two AC-04 tracker tests passed (offline, a version change while up, a restart that reports an old version), and offline.spec.ts passed for offline with jobs, offline on the empty profile, and incompatible; app/server/tracker.ts:111-128 returns before any step unless the version is compatible; no limitations.

CRITERION: AC-05 A pending job can be cancelled, and ComfyUI receives a per-job cancel only when the job has an attempt ID; a submitted job is cancelled through ComfyUI's per-job cancel for its own prompt ID, unless it already finished, in which case it ends `done`; a failed or cancelled job can be retried and runs again as a new ComfyUI prompt with the same settings and seed; and a retry over the unfinished-job limit is refused with a message.
VERDICT: met
EVIDENCE: Local and CI: all 8 "AC-05 cancel and retry" tracker tests passed, and queue.spec.ts "a job can be cancelled and retried through the page" passed (Chromium); no limitations.

CRITERION: AC-06 After an app restart, a timeout or a ComfyUI restart, every job ends in the state ComfyUI's queue and history imply; a job ComfyUI lost is resubmitted as a new prompt with a new output prefix up to twice and fails on the third loss; a prompt ComfyUI accepted before the app recorded it, or after the app's request timed out, is adopted rather than submitted twice; no asset directory is left half written; and the sweep removes orphaned uploads and the app's leftover files in ComfyUI's `asset-studio` folders.
VERDICT: met
EVIDENCE: Local and CI: all 9 "AC-06 restarts, losses and replay" tracker tests passed (restart reconciliation, third-loss failure, adoption after a crash and after a client timeout, missing outputs, collection fault injection, timeout race, start sweep, fixtures exempt); limitation: the sweep test makes its orphaned upload with mkdir and calls sweep() directly, and the sweep of failed or cancelled jobs' outputs has no test (see F-04).

CRITERION: AC-07 The library lists done assets with thumbnails, shows an empty state when there are none, renders the selected GLB in a 3D viewer in Chromium and Firefox, and recovers from a failed viewer load through its retry button.
VERDICT: met
EVIDENCE: CI run 44996495739 log, read myself: library.spec.ts render, retry and empty-profile tests passed in chromium and firefox with E2E_REQUIRE_WEBGL=1, 34 passed and 0 skipped, and webgl.log printed `firefox: llvmpipe, or similar`; locally the same suite passed except the Firefox render, which skipped for lack of WebGL as Design says; limitation: the Firefox render was observed only in CI.

CRITERION: AC-08 In Chromium and Firefox, a single asset downloads as a GLB, a selection of up to 100 assets and 2 GiB downloads as one zip holding each GLB, its source image and a `manifest.json` describing them, and a larger selection is refused with a message.
VERDICT: met
EVIDENCE: Local and CI: export.spec.ts single GLB and three-asset zip passed in chromium and firefox; the export unit tests passed (101 assets and over 2 GiB refused with the split message, credentials, expiry, the gone redirect); no limitations.

CRITERION: AC-09 The page's sign-in, submit, queue and library journeys meet the layout rules in Design at every size in the project viewport matrix and at 200 percent zoom, are usable by keyboard with labelled controls, and the library and viewer journey works with reduced motion.
VERDICT: met
EVIDENCE: layout.spec.ts passed locally and in CI (9 sizes, keyboard, reduced motion). I also ran my own Playwright script on the scratch dev stack at the 9 sizes and at 640x360 with device scale factor 2 (a 1280x720 window at 200 percent). After a submit and with the viewer open, it found no overflow, no text under 14 px and no clipped controls at any size, and I reviewed the 640x360@2 screenshot; limitation: 200 percent was emulated through viewport and scale factor, not the browser's zoom keys, and the committed layout spec does not itself submit or open the viewer (see F-03).

CRITERION: AC-10 The deployed app answers over HTTPS at `win-main`'s tailnet name from another device in the owner's tailnet with the deployed version and commit, while port 8790 and ComfyUI's port 8188 are not reachable on `win-main`'s tailnet address.
VERDICT: met
EVIDENCE: From fedora-43: `curl https://win-main.tail6948f.ts.net/api/health` returned version `0.1.0-feat-asset-studio.4` and commit 6527af52efe7..., with ComfyUI reachable at 0.46.2; `curl --connect-timeout 5` to 100.123.74.118 on 8790 and 8188 timed out; limitation: this is the feature-branch prerelease, and the repeat after merge (T31) is still to come.

CRITERION: AC-11 Through the deployed app, one prompt job at the default TRELLIS.2 preset and one Hunyuan3D prompt job at 10k each produce a GLB from the real ComfyUI on `win-main`, the TRELLIS.2 one is textured, and the app's files for both are gone from ComfyUI's `asset-studio` folders afterwards.
VERDICT: not verified
EVIDENCE: `bun run verify:live` exists and the document records a pass at .4, but I did not run it, because it creates jobs on win-main and the dispatch allowed read-only checks only. My attempt to read the job list on win-main was denied, since it needed the access token. Over SSH I saw only that ComfyUI's output\asset-studio and input\asset-studio folders are empty and that .4 is running; limitation: I observed neither the generations nor the GLBs.

CRITERION: AC-12 Every API route except health and sign-in refuses a request without a valid token or session cookie; wrong tokens and cookies, on sign-in or any protected route, are rate limited per client address, with clients behind `tailscale serve` and Docker's published port counted separately; a page that receives a 401 stops polling and shows sign-in; and sign-in works in Chromium and Firefox and survives a reload.
VERDICT: met
EVIDENCE: Local and CI: the 6 auth tests passed, and signin.spec.ts passed in signin-chromium and signin-firefox, including token rotation with no further polling. Against the deployed .4: eleven wrong POST /api/session calls from fedora-43 returned 401 x10 then 429; a wrong sign-in from win-main through its tailnet HTTPS name right after returned 401; GET /api/jobs without credentials returned 401; GET /api/session with a bearer token returned {"signedIn":false}; no limitations.

CRITERION: AC-13 The production page's initial JavaScript stays within 150 KiB after gzip at level 9, and the 3D viewer loads only when an asset is opened and stays within 350 KiB after gzip at level 9.
VERDICT: met
EVIDENCE: Local `bun run verify` printed `initial 80.4 KiB, viewer 280.5 KiB (gzip level 9)` and `✓ Passed: bundle budgets met`; the 3 size fixture tests passed (leak and breach builds fail); CI showed the same; no limitations.

CRITERION: AC-14 The public repository has an Apache-2.0 licence, CodeQL and Scorecard workflows calling the organisation's reusable workflows with a completed run of each on the default branch, a Renovate configuration, and the dependency graph, Dependabot alerts, secret scanning, push protection and automatic branch deletion turned on.
VERDICT: not met
EVIDENCE: `scripts/deploy/check-repo.sh` from the scratch copy exited 1. It passed public visibility, delete_branch_on_merge, secret scanning, push protection, dependency graph, Dependabot alerts, the workflow pins and Python analysis. It failed `licence apache-2.0`, `a successful codeql.yml run on main`, `a successful scorecard.yml run on main` (HTTP 404, workflow not on the default branch), `renovate.json on main` and Renovate activity; limitation: the document plans this check for after merge.

CRITERION: AC-15 Deploying a second time keeps the access token and the data, records the previous version only when the version changes, and a rerun of the same version keeps that record; rolling back stops the app, reloads the previous image when it is missing, restores the matching backup across a schema change, and returns the app to the previous version serving again; the logon task brings the app back after its image was removed; a backup taken while writes are still in the WAL restores completely; and an executable refuses to start on a database with a newer schema version.
VERDICT: not verified
EVIDENCE: Locally and in CI, the bats rollback tests 15 to 19 and the store tests passed (WAL restore, newer-schema refusal, backup only on migration, pickBackup). On win-main (read-only): current.json and .env name .4, previous.json names .2, the AssetStudio-Logon and AssetStudio-Docker tasks are Ready, and logon.log shows `Asset Studio 0.1.0-feat-asset-studio.4 started`; limitation: I did not observe the live deploy, rerun, rollback or logon-recovery procedure, which would change win-main.

CRITERION: AC-16 The seed command is repeatable without duplicating rows, leaves non-fixture rows untouched, refuses a ComfyUI that is not the fake, and its fixture jobs keep their states while the app runs, including past the 15-minute timeout; `bun run dev` starts the fake and the server and reports ready, and the development token is refused against a ComfyUI that is not the fake.
VERDICT: met
EVIDENCE: Local and CI: the 6 seed tests passed, and the dev readiness step printed `✓ Passed: ready at http://127.0.0.1:8790`; I also started `bun run dev` and `bun run seed` in the scratch copy (`seeded 9 fixture jobs`); no limitations.

CRITERION: AC-17 The published image at its recorded digest runs as the non-root user with a read-only root filesystem and a fresh data volume and serves the page with its version and commit; its signature and its provenance and SBOM attestations verify; and its GitHub Release record exists only for a version whose scan passed.
VERDICT: met
EVIDENCE: `scripts/deploy/check-image.sh 0.1.0-feat-asset-studio.4` from the scratch copy exited 0: release record sha256:550a923d..., anonymous pull, cosign signature, provenance and SBOM verified, and the image starts as UID 65532, read-only, with a fresh volume, reporting .4. Tag v0.1.0-feat-asset-studio.1 has no Release, and its run 44961046719 failed in the release action; .2 to .5 have Releases. `bun test ./.github` 6 pass; no limitations.

CRITERION: AC-18 The page labels job states, the preset fields (Engine, Detail, Texture, Variants, Game-asset style, Seed), the two banners and the library heading with exactly the terms in the Glossary.
VERDICT: met
EVIDENCE: glossary.spec.ts passed locally and in CI run 44996495739; no limitations.

CRITERION: AC-19 The command-line tools print labelled status lines, add no colour or cursor control when `NO_COLOR` is nonempty or the stream is not a terminal, offer an ASCII mode, and exit non-zero whenever a step failed.
VERDICT: met
EVIDENCE: Locally and in CI, bats (including the reporter tests with NO_COLOR unset, empty, 0 and 1 and on a pty) and the 4 app/cli report tests passed. In my own runs with NO_COLOR=1 to a pipe, verify, check-image.sh and check-repo.sh printed plain `✓ Passed` and `✗ Failed` lines, and check-repo.sh exited 1 on failures; no limitations.

CRITERION: AC-20 A 25-image batch at the 200 MiB cap, two such batches at once, and an export of 100 assets each complete without the container being killed for memory under its 1 GiB limit, and the server's anonymous memory stays below 512 MiB.
VERDICT: met
EVIDENCE: Local memory check against the image built from 81b4b51 passed with `peak anonymous memory 42.7 MiB` under --memory 1g; CI run 44996495739 also passed (1 pass); no limitations.

CRITERION: AC-21 The README names `bun run bootstrap`, `bun run dev`, `bun run seed`, `bun run verify`, `scripts/deploy/deploy.sh`, `scripts/deploy/rollback.sh` and `bun run clean`, how readiness is detected, the dependencies, and the owner's checklist (share the node, limit `autogroup:shared` to port 443); `AGENTS.md` names the same commands and routes to `conventions/terminal-output.md`, and no longer says that no commands exist.
VERDICT: met
EVIDENCE: `bun test ./app/docs` 6 pass locally and in CI; no limitations.

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: scripts/deploy/check-repo.sh; Test Plan AC-14
EVIDENCE: The Test Plan AC-14 row requires the repository to be listed in the `vhco-renovate` installation's repositories, code scanning to list an Actions analysis, and a `/language:js-ts` analysis on `main`. check-repo.sh has no installation check and no Actions-analysis check. Its Python check queries `code-scanning/analyses?per_page=20` without filtering by `ref`, so a feature-branch analysis passes it; this run passed "Python is analysed by CodeQL" before anything was merged.
PROPOSAL: Add the installation listing and Actions-analysis checks, and filter the analyses by `ref=refs/heads/main`, before T31 and the AC-14 run.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: app/e2e/layout.spec.ts:54-69; Test Plan AC-09
EVIDENCE: The row says layout.spec.ts "runs the sign-in, submit, queue and library journeys" at every size. Each size test only checks the sign-in screen and the main view at rest; it never submits a batch or opens the viewer. Layout breakage after a submit or in the preview panel would pass. My own script covering those states found no problems at this commit.
PROPOSAL: Extend the size loop to submit a prompt and open the preview before the layout check and screenshot.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: app/server/tracker.test.ts:449-465; Test Plan AC-06; Design "Submission, concurrency and idempotency" (sweep)
EVIDENCE: The row asks for a server killed after a batch's uploads rename and before its commit, then a restart and the start sweep. The test instead creates an orphaned uploads directory with mkdirSync and calls `tracker().sweep()` directly. The sweep's deletion of failed or cancelled jobs' ComfyUI output (app/server/tracker.ts:351) has no test.
PROPOSAL: Add a fault hook between the rename and the commit in batches.ts and a test that restarts through `start()`, plus a sweep test for a cancelled job's leftover output.

FINDING: F-04
KIND: factual
SEVERITY: nit
WHERE: app/server/auth.ts:30; Design "Access token"
EVIDENCE: Design rejects a cookie whose issue time is "in the future"; `verifyCookieValue` accepts up to 60 seconds ahead (`issuedAt > nowS + 60`). The test only checks an hour ahead (app/server/auth.test.ts:75).
PROPOSAL: Either state the 60-second skew allowance in Design at the next revision or drop it from the code.

FINDING: F-05
KIND: factual
SEVERITY: nit
WHERE: Design "Verification commands" (CI sentence on Mesa and E2E_REQUIRE_WEBGL); Context "Owner summary"
EVIDENCE: Design says the checks job installs `libgl1-mesa-dri` and `libegl1` and sets E2E_REQUIRE_WEBGL=1. .github/workflows/ci.yml:34-35 also installs `xvfb` and `libgles2` and runs `xvfb-run -a bun run verify`, which T28's evidence notes as left for the next revision.
PROPOSAL: Name xvfb-run and the extra packages in Design at the next normative revision.

FINDING: F-06
KIND: judgement
SEVERITY: nit
WHERE: Design "Versioning and release path"
EVIDENCE: Run 44961046719 (v0.1.0-feat-asset-studio.1, the failed OpenSSL scan) pushed `ghcr.io/vhco-pro/3d-assets-gen:0.1.0-feat-asset-studio.1`, `:latest` and `:<commit>` before the Trivy step failed. So the public package can carry an unscanned or failed-scan image under `latest`. Deploys are unaffected, since they use the Release digest only.
PROPOSAL: Note in Design that the action pushes before scanning and that `latest` and version tags are not a scan guarantee, or raise it as an Open Question at the next revision.

### R-13

CRITERION: AC-01 For every input in the golden set, each TypeScript graph builder returns the graph the matching Python builder in `scripts/generate_3d.py` returns, and each combined graph follows the node renumbering, rewiring, prefix and thumbnail rules in Design.
VERDICT: met
EVIDENCE: `bun run golden:check` and the unit suite (`bun test app` with the three ignore patterns, 110 pass) run by me in the repository at b54bca4, plus the log of CI run 44999441049 at 8ca8afe (code identical to b54bca4 apart from the feature document), which I read myself; `✓ Passed: golden graphs match scripts/generate_3d.py` in both; no limitations.

CRITERION: AC-02 Submitting a batch through the page creates one pending job per prompt line and variant, or per image; a batch that is empty, has an over-long prompt, a wrong or oversized file, more than 25 jobs, more than 200 MiB of images, a malformed batch ID, or would exceed 100 unfinished jobs is rejected with a message that names the problem and creates no job and leaves no file; concurrent batches never take the unfinished count above 100; and a repeated batch ID, sequential or concurrent and with any multipart boundary, returns the existing batch, or a conflict when its content differs, without creating anything and without touching the first batch's uploads.
VERDICT: met
EVIDENCE: Local unit suite at b54bca4 (110 pass, including the api.test.ts rejection, 200 MiB boundary, concurrent-limit and duplicate-ID tests) and CI run 44999441049: submit.spec.ts six-job prompt batch (chromium), image batch (chromium and firefox) and invalid batches passed, 34 passed 0 skipped; no limitations.

CRITERION: AC-03 Each job is submitted to ComfyUI as one prompt with its own attempt ID and output prefix, jobs run in submission order, and each ends `done` with its GLB, source image and thumbnail stored, or `failed` with ComfyUI's error message, including when ComfyUI rejects the prompt or the upload, or answers one job with three server errors in a row while later jobs still run.
VERDICT: met
EVIDENCE: Local unit suite and CI run 44999441049: the AC-03 tracker tests passed (execution error, 400 from /prompt and /upload/image, three 5xx answers with later jobs running); queue.spec.ts "a job reaches Done and is still there after a reload" passed in CI. Live: during my `bun run verify:live` against .6 I listed ComfyUI's output\asset-studio over SSH and saw job b4744613 written under `<job id>\<attempt id>_00001_.png` and `<attempt id>\thumb_00001_.png`, and both jobs reached done; no limitations.

CRITERION: AC-04 While ComfyUI is unreachable the page shows it offline, and while it reports a version older than 0.46.2 or none the page shows it incompatible and the app neither submits, reconciles, cancels nor times out anything, whether or not jobs are unfinished; every job keeps its state, and jobs continue once a compatible ComfyUI answers again.
VERDICT: met
EVIDENCE: Local unit suite (AC-04 tracker tests for offline, a version change while up and a restart reporting 0.46.1) and CI run 44999441049: offline.spec.ts offline with jobs, incompatible, and offline on the empty profile all passed; no limitations.

CRITERION: AC-05 A pending job can be cancelled, and ComfyUI receives a per-job cancel only when the job has an attempt ID; a submitted job is cancelled through ComfyUI's per-job cancel for its own prompt ID, unless it already finished, in which case it ends `done`; a failed or cancelled job can be retried and runs again as a new ComfyUI prompt with the same settings and seed; and a retry over the unfinished-job limit is refused with a message.
VERDICT: met
EVIDENCE: Local unit suite and CI run 44999441049: all 8 "AC-05 cancel and retry" tracker tests passed, and queue.spec.ts "a job can be cancelled and retried through the page" passed in CI; no limitations.

CRITERION: AC-06 After an app restart, a timeout or a ComfyUI restart, every job ends in the state ComfyUI's queue and history imply; a job ComfyUI lost is resubmitted as a new prompt with a new output prefix up to twice and fails on the third loss; a prompt ComfyUI accepted before the app recorded it, or after the app's request timed out, is adopted rather than submitted twice; no asset directory is left half written; and the sweep removes orphaned uploads and the app's leftover files in ComfyUI's `asset-studio` folders.
VERDICT: met
EVIDENCE: Local unit suite at b54bca4 and CI run 44999441049: all 11 "AC-06 restarts, losses and replay" tests passed, including the new kill between the uploads rename and the commit (faults.afterRename throws inside the transaction, no rows, uploads directory present, then removed by a restart through start()) and the sweep of a cancelled job's leftover ComfyUI output; live, ComfyUI's output\asset-studio was empty after my verify:live run; no limitations.

CRITERION: AC-07 The library lists done assets with thumbnails, shows an empty state when there are none, renders the selected GLB in a 3D viewer in Chromium and Firefox, and recovers from a failed viewer load through its retry button.
VERDICT: met
EVIDENCE: CI run 44999441049 log, read myself: library.spec.ts render, failed-load retry and empty-profile tests passed in chromium and firefox under `xvfb-run -a bun run verify` with E2E_REQUIRE_WEBGL=1, 34 passed 0 skipped, and webgl.log printed `webgl-renderer firefox: llvmpipe, or similar`; limitation: the Firefox render was observed only in CI.

CRITERION: AC-08 In Chromium and Firefox, a single asset downloads as a GLB, a selection of up to 100 assets and 2 GiB downloads as one zip holding each GLB, its source image and a `manifest.json` describing them, and a larger selection is refused with a message.
VERDICT: met
EVIDENCE: CI run 44999441049: export.spec.ts single GLB and three-asset zip passed in chromium and firefox; local unit suite: export tests passed (101 assets and over 2 GiB refused with 413, credentials, expiry, the gone redirect); no limitations.

CRITERION: AC-09 The page's sign-in, submit, queue and library journeys meet the layout rules in Design at every size in the project viewport matrix and at 200 percent zoom, are usable by keyboard with labelled controls, and the library and viewer journey works with reduced motion.
VERDICT: met
EVIDENCE: CI run 44999441049: layout.spec.ts passed at all 9 sizes, now submitting a prompt and opening the preview at each size, plus the keyboard and reduced-motion tests. I also ran my own Playwright script against the published .6 image with the fake ComfyUI at 640x360 with device scale factor 2 (a 1280x720 window at 200 percent), 320x568 and 1440x900, over sign-in, main, after a submit and with the preview open: 0 px overflow, no text under 14 px, no clipped buttons or labels; I reviewed the 640x360 submitted and preview screenshots (single column, nothing clipped or overlapping); limitation: 200 percent was emulated through viewport and scale factor, not the browser's zoom keys.

CRITERION: AC-10 The deployed app answers over HTTPS at `win-main`'s tailnet name from another device in the owner's tailnet with the deployed version and commit, while port 8790 and ComfyUI's port 8188 are not reachable on `win-main`'s tailnet address.
VERDICT: met
EVIDENCE: From fedora-43 after check-upgrade.sh left .6 deployed: `curl https://win-main.tail6948f.ts.net/api/health` returned `0.1.0-feat-asset-studio.6`, commit 8ca8afe7c8175be749162281e25db3f4738381e4, ComfyUI reachable 0.46.2; `curl --connect-timeout 5` to 100.123.74.118 (`tailscale ip -4 win-main`) on 8790 and 8188 both exited 28 (timeout); limitation: this is the feature-branch prerelease; the repeat with the release image from main (T31) is post-merge.

CRITERION: AC-11 Through the deployed app, one prompt job at the default TRELLIS.2 preset and one Hunyuan3D prompt job at 10k each produce a GLB from the real ComfyUI on `win-main`, the TRELLIS.2 one is textured, and the app's files for both are gone from ComfyUI's `asset-studio` folders afterwards.
VERDICT: met
EVIDENCE: I ran `bun run verify:live` from the repository against the deployed .6 (8ca8afe), exit 0: TRELLIS.2 job b4744613 (10k/2048) and Hunyuan3D job 3fac6b49 (10k) went pending, submitted, done; `9.3 MiB glTF with a base colour texture` and `0.2 MiB glTF`; `both jobs' files are gone from ComfyUI's asset-studio folders`. Mid-run I listed output\asset-studio over SSH and saw b4744613's PNG and thumbnail, so the script's listing path is real; after the run the same listing was empty; no limitations.

CRITERION: AC-12 Every API route except health and sign-in refuses a request without a valid token or session cookie; wrong tokens and cookies, on sign-in or any protected route, are rate limited per client address, with clients behind `tailscale serve` and Docker's published port counted separately; a page that receives a 401 stops polling and shows sign-in; and sign-in works in Chromium and Firefox and survives a reload.
VERDICT: met
EVIDENCE: Local unit suite (6 auth tests) and CI run 44999441049 (signin.spec.ts in signin-chromium and signin-firefox, including token rotation with no further polling). Against the deployed .6: eleven wrong POST /api/session calls from fedora-43 returned 401 ten times then 429; a wrong sign-in from win-main through the tailnet HTTPS name right after returned 401; GET /api/jobs without credentials returned 401; GET /api/session with a wrong bearer token returned {"signedIn":false}; no limitations.

CRITERION: AC-13 The production page's initial JavaScript stays within 150 KiB after gzip at level 9, and the 3D viewer loads only when an asset is opened and stays within 350 KiB after gzip at level 9.
VERDICT: met
EVIDENCE: CI run 44999441049: `✓ Passed: bundle budgets met`; local unit suite includes the size fixture tests (leak and breach builds fail), which passed; limitation: I did not rebuild the page locally, the build and budget step was observed in the CI log.

CRITERION: AC-14 The public repository has an Apache-2.0 licence, CodeQL and Scorecard workflows calling the organisation's reusable workflows with a completed run of each on the default branch, a Renovate configuration, and the dependency graph, Dependabot alerts, secret scanning, push protection and automatic branch deletion turned on.
VERDICT: not met
EVIDENCE: `scripts/deploy/check-repo.sh` at b54bca4 exited 1: passed public visibility, delete_branch_on_merge, secret scanning, push protection, dependency graph, Dependabot alerts and the workflow pins; failed `licence apache-2.0`, a successful codeql.yml and scorecard.yml run on main (scorecard.yml HTTP 404 on the default branch), the /language:js-ts and Actions analyses on main, renovate.json on main and Renovate activity; skipped the installation listing (HTTP 403); limitation: the document plans this check for after merge.

CRITERION: AC-15 Deploying a second time keeps the access token and the data, records the previous version only when the version changes, and a rerun of the same version keeps that record; rolling back stops the app, reloads the previous image when it is missing, restores the matching backup across a schema change, and returns the app to the previous version serving again; the logon task brings the app back after its image was removed; a backup taken while writes are still in the WAL restores completely; and an executable refuses to start on a database with a newer schema version.
VERDICT: met
EVIDENCE: I ran `scripts/deploy/check-upgrade.sh 0.1.0-feat-asset-studio.5 0.1.0-feat-asset-studio.6`, exit 0, 13 passed: config.yaml SHA-256 9AA20BA8... unchanged by the second deploy and the rerun, previous recorded as .5 and kept by the rerun, job digest `6:C898BD99DEBC6FC9` identical in every state, rollback printed `Reloading ...:0.1.0-feat-asset-studio.5` after the image was removed, current.json and .env named .5, health `0.1.0-feat-asset-studio.5 81b4b51b...`, then after compose down and removing .6 (`image absent`) the logon task brought .6 back in 6 s; win-main logon.log shows `Asset Studio 0.1.0-feat-asset-studio.6 started` at 09:19:02 local. Schema change: I ran rollback.ps1's backup selection (`ls ... | sort -t- -k3 -n | tail -1`) and the .6 image's `restore-backup` with its restore.yaml token on a local data directory with two schema-1 backups; it picked the newer one and the restored database held exactly the rows of that backup. Local store tests (WAL restore, newer-schema refusal, backup only on migration, pickBackup) and 28 bats tests passed; starting `bun app/server/main.ts serve` on a schema-2 database exited 1 with `database is at schema 2, but this executable only knows schema 1`. Limitation: no live rollback across a real schema change, since every release has schema 1; that path was exercised locally outside PowerShell (see F-02).

CRITERION: AC-16 The seed command is repeatable without duplicating rows, leaves non-fixture rows untouched, refuses a ComfyUI that is not the fake, and its fixture jobs keep their states while the app runs, including past the 15-minute timeout; `bun run dev` starts the fake and the server and reports ready, and the development token is refused against a ComfyUI that is not the fake.
VERDICT: met
EVIDENCE: Local unit suite: the 6 seed tests passed (repeatable, keeps non-fixture rows, refuses a non-fake ComfyUI, fixtures held past 20 minutes, dev token refused without the marker); CI run 44999441049 dev readiness step printed `✓ Passed: ready at http://127.0.0.1:8790`; I also ran the .6 image's `seed` against the fake (`seeded 9 fixture jobs`); limitation: `bun run dev` readiness observed in CI, not locally.

CRITERION: AC-17 The published image at its recorded digest runs as the non-root user with a read-only root filesystem and a fresh data volume and serves the page with its version and commit; its signature and its provenance and SBOM attestations verify; and its GitHub Release record exists only for a version whose scan passed.
VERDICT: met
EVIDENCE: `scripts/deploy/check-image.sh 0.1.0-feat-asset-studio.6` exit 0: release record sha256:76549b48..., anonymous pull, cosign signature, provenance and SBOM verified, starts as UID 65532 read-only with a fresh volume and reports .6. CI run 44999441049 release job succeeded with trivy-scan HIGH,CRITICAL exit-code 1; `gh release list` shows Releases for .2 to .6 and none for .1 (its scan failed); `bun test ./.github` 6 pass locally; no limitations.

CRITERION: AC-18 The page labels job states, the preset fields (Engine, Detail, Texture, Variants, Game-asset style, Seed), the two banners and the library heading with exactly the terms in the Glossary.
VERDICT: met
EVIDENCE: CI run 44999441049: glossary.spec.ts passed; my screenshots of the .6 image show Waiting, Queued, Generating, Done, Failed, Cancelled, the six preset labels and Library; no limitations.

CRITERION: AC-19 The command-line tools print labelled status lines, add no colour or cursor control when `NO_COLOR` is nonempty or the stream is not a terminal, offer an ASCII mode, and exit non-zero whenever a step failed.
VERDICT: met
EVIDENCE: Local `bunx bats scripts/deploy/tests` (28 ok, including the reporter tests for NO_COLOR unset, empty, 0 and 1 and on a pty) and app/cli report tests in the unit suite passed; my runs of check-upgrade.sh, check-image.sh, check-repo.sh and verify:live with NO_COLOR=1 to a file printed plain `✓ Passed`, `✗ Failed`, `∅ Skipped` and `›` lines, and check-repo.sh exited 1 on its failures; no limitations.

CRITERION: AC-20 A 25-image batch at the 200 MiB cap, two such batches at once, and an export of 100 assets each complete without the container being killed for memory under its 1 GiB limit, and the server's anonymous memory stays below 512 MiB.
VERDICT: met
EVIDENCE: CI run 44999441049: memory check 1 pass, `peak anonymous memory 48.7 MiB` under --memory 1g; limitation: not rerun locally.

CRITERION: AC-21 The README names `bun run bootstrap`, `bun run dev`, `bun run seed`, `bun run verify`, `scripts/deploy/deploy.sh`, `scripts/deploy/rollback.sh` and `bun run clean`, how readiness is detected, the dependencies, and the owner's checklist (share the node, limit `autogroup:shared` to port 443); `AGENTS.md` names the same commands and routes to `conventions/terminal-output.md`, and no longer says that no commands exist.
VERDICT: met
EVIDENCE: `bun test ./app/docs` 6 pass locally at b54bca4 and in CI run 44999441049; no limitations.

FINDING: F-01
KIND: factual
SEVERITY: nit
WHERE: scripts/deploy/check-repo.sh (vhco-renovate installation check); Test Plan AC-14
EVIDENCE: The AC-14 row requires "the repository is listed in the `vhco-renovate` installation's repositories". check-repo.sh now reports `∅ Skipped` when the token gets HTTP 403, as it did in my run, and a skip does not fail the exit code, so a post-merge run can pass without observing the listing. The Renovate activity check that stands in accepts any issue whose title matches `Dependency Dashboard`.
PROPOSAL: For the AC-14 run after merge, use a token that can list the installation, or record the listing from the App's settings page as part of the evidence.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: scripts/deploy/remote/rollback.ps1:15-23; scripts/deploy/tests/rollback.bats; Test Plan AC-15
EVIDENCE: The schema-change branch of the rollback (schema comparison, `asset-studio_data` volume, backup selection by `sort -t- -k3 -n`, the restore-only config and `restore-backup`) is not executed by any test: rollback.bats stubs ssh and covers only the no-backup failure, and the live check-upgrade run used two schema-1 releases. I ran the selection and restore commands myself against the .6 image and they worked, but a wrong volume name or a PowerShell error in that branch would pass every committed check.
PROPOSAL: Before the first release with schema 2, add a check that exercises the restore branch end to end, for example a check-upgrade run with a test image at schema 2, or a local Docker test that runs rollback.ps1's commands.

FINDING: F-03
KIND: factual
SEVERITY: nit
WHERE: scripts/deploy/remote/state.ps1:7-11; scripts/deploy/check-upgrade.sh ("job rows intact" checks)
EVIDENCE: state.ps1 leaves `jobs` as an empty string when the authenticated /api/jobs call fails, so "job rows intact" compares two empty strings and passes if the API is unreachable in both states. In my run every state had `6:C898BD99DEBC6FC9`, so the check was real this time.
PROPOSAL: Make the check fail when `jobs` is empty.

### R-14

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > Submission, concurrency and idempotency (sweep paragraph, lines 470-477); Design > Restart, upgrade and rollback (lines 533-538 and 558-560); Tasks T39 (line 1126)
EVIDENCE: Line 535-536 says the sweep removes the purged jobs' asset directories "because it deletes any asset directory that has no job row, as it already does for uploads without a batch". The sweep paragraph at lines 470-475 lists ComfyUI's folders, uploads without a batch row, and staging and collection directories, but no asset directories. The code agrees with the paragraph, not with line 535: app/server/tracker.ts:383-387 only removes `.collect-*` entries under `/data/assets/`. T39 adds "the sweep of asset directories without a row" as new work. Line 558-560 still says that after a rollback, asset directories of jobs created after the backup "stay in the volume". The new sweep deletes them the next time this version runs. This sentence was written before this revision added the rule.
PROPOSAL: Add "every `/data/assets/<job id>/` directory with no job row, apart from collection directories" to the sweep paragraph. Drop "as it already does". Say whether a seed running beside a live server writes rows before files, so the new sweep cannot remove fresh fixture files. Update the rollback sentence.

FINDING: F-02
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (lines 537-538); Context > Owner summary (lines 84-85); Open Questions
EVIDENCE: "A Hunyuan3D prompt still queued or running in ComfyUI keeps running there." Up to 100 unfinished jobs are allowed (line 349), and Background measured about 90 seconds per Hunyuan3D job. ComfyUI runs jobs first submitted, first run (line 479), so those orphaned prompts run ahead of every new TRELLIS.2 job, and their output is then thrown away. Before the purge deletes them, the rows hold each attempt's prompt ID, and the per-job cancel already exists (line 148-150, `app/server/comfy.ts`). Leaving the prompts running is a settled trade-off that is not raised as an Open Question.
PROPOSAL: Before deleting the rows, cancel each `submitted` Hunyuan3D attempt, and each `pending` one that has an attempt ID, through the per-job cancel. For example, keep their prompt IDs and cancel them on the first compatible tick. Otherwise, raise the choice as an Open Question.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan row AC-23 (line 1047); Acceptance Criteria AC-23 (line 1018)
EVIDENCE: The row seeds "Hunyuan3D and TRELLIS.2 jobs in every state, their asset directories, an upload batch and files in both ComfyUI `asset-studio` folders". It then requires that a start through `start()` "keeps every TRELLIS.2 row and file byte-identical". By Design (line 470-471, and app/server/tracker.ts:347-351), the start sweep deletes the ComfyUI files of every `done` job. After that, the first tick changes `submitted` and `pending` TRELLIS.2 rows that the fake does not know (lost-job handling, line 447-449). Read literally, the proof fails a correct implementation, or two implementers scope the fixture differently.
PROPOSAL: Limit the byte-identical assertion to TRELLIS.2 rows and to files under `/data/assets/` and `/data/uploads/`, checked before the first tick. Say that ComfyUI files are seeded only for Hunyuan3D jobs, or for TRELLIS.2 jobs that the sweep keeps.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Page (badge paragraph lines 649-652, queue line 670-672, library lines 674-678); Design > Glossary (Done and Waiting rows); Acceptance Criteria AC-18 (line 1013) and AC-22 (line 1017); Test Plan rows AC-18 (line 1042) and AC-22 (line 1046)
EVIDENCE: Badges define "Done `--ok`". However, the queue lists only "unfinished, failed and cancelled jobs", and a library card shows a thumbnail, a name, a checkbox and buttons, with no state badge. The Done term and badge therefore have no place on the page. AC-18 still requires job states to be labelled with the Glossary terms, and the AC-22 proof checks "each state badge's border colour". A Waiting badge cannot be observed on the seeded fixture either: app/server/seed.ts:29-37 holds no `pending` job, and the tracker submits a pending job within one tick.
PROPOSAL: State where a Done job shows its badge, for example on its library card. Give the AC-18 and AC-22 proofs a way to observe Waiting, such as a fake held offline or a fixture pending job the tracker skips.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Acceptance Criteria AC-22 (line 1017); Test Plan row AC-22 (line 1046); Design > Page (lines 649-656); Design > Verification commands (lines 973-976); Tasks T43 (line 1130)
EVIDENCE: The AC-22 proof checks the gradient, the colour scheme, Generate, badge borders, side by side at 1280x720, stacked at 390x844, and the dialog. It does not check that semantic colours appear "only on job states and banners", or the banner colours (`--danger` and `--warn`). It also does not check the 1024-pixel breakpoint: a layout that switches at 1200 passes, although 1024x768 is in the matrix. "About 40 percent" for the border leaves the expected colour open. The guide (guides/vh-midnight.md, Tokens) defines a neutral badge as white at 9% with `--ink-dim` text and gives it no border, so "neutral" has no border colour to match. The row checks the design review, but no criterion text requires that review.
PROPOSAL: Fix the badge fill, border and text alphas (including a neutral border). Add assertions at 1024x768 (two columns) and at 1023 wide (one column), and for both banner colours. Assert that no other element uses `--ok`, `--warn` or `--danger` as text, border or background. Add the design review to AC-22's text, or drop it from the row.

FINDING: F-06
KIND: factual
SEVERITY: should-fix
WHERE: Design > Page (preview dialog lines 680-685; layout rules lines 703-709); Acceptance Criteria AC-09 (line 1004); Test Plan rows AC-09 (line 1033) and AC-22 (line 1046)
EVIDENCE: conventions/frontend-testing.md (Responsive visual quality) asks that "a dialog's controls must stay reachable at short heights", and to "Resize and change orientation while a scene or dialog is open". It also asks for Firefox coverage of browser APIs. This revision adds a native modal `<dialog>` holding the viewer, metadata and two buttons. The AC-09 journeys and layout rules never name the dialog, and do not check Close and Download inside the viewport at 844x390 or 320x568. They also do not check a resize while the dialog is open. Escape closing the dialog and focus returning to the opener are checked only in Chromium.
PROPOSAL: Add the open dialog to the AC-09 journeys at every matrix size, with Close and Download inside the viewport and a resize while it is open. Run the Escape and focus-return check in Firefox as well.

FINDING: F-07
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Page (library card line 675-676; preview dialog line 680-681)
EVIDENCE: A card shows "the prompt or file name on at most two lines". The dialog shows "the asset's name", which may be the slug. guides/vh-midnight.md (Type and layout) asks to keep long content "accessible without page-wide scrolling or truncation", and guides/use-frontend-design-skills.md says "Do not hide content to make an overflow assertion pass". Prompts may be up to 500 characters (line 616). The document does not say where the full prompt can be read once it is clamped.
PROPOSAL: State that the dialog shows the full prompt (or the full file name), and that the clamped card text keeps the full text as its accessible name or title.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 976-980); Acceptance Criteria AC-22 (line 1017); Tasks T40 (line 1127) and T44 (line 1131)
EVIDENCE: conventions/frontend-testing.md (Visual record) requires both sides "with the same fixture data", with the before from the base commit and the after from the head. It also requires an after image of each state the change alters, and asks the author to name any changed state left uncaptured. The base's fixture holds a Hunyuan3D done job (app/server/seed.ts:32, "a stone pillar"). T40 removes it at head, and head's start purge would delete it, so the two libraries differ. The listed captures leave out restyled states: the offline and incompatible banners, the viewer loading and error states inside the dialog, and the sign-in error.
PROPOSAL: Name one fixture for both sides (for example head's TRELLIS.2-only fixture loaded into the base build), or name the one-asset difference. Add the banner, viewer error and sign-in error states to the record, or name them as left uncaptured with the reason.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 954-957); Test Plan row AC-07 (line 1031)
EVIDENCE: Design says that the CI `checks` job "installs Mesa's software GL (`libgl1-mesa-dri`, `libegl1`)", and the AC-07 row credits the Firefox render to "CI, where Mesa is installed". .github/workflows/ci.yml:31-36 installs `xvfb libegl1 libgl1-mesa-dri libgles2` and runs `xvfb-run -a bun run verify`. T28's evidence (line 1105) says Mesa alone still failed the render, and that the missing xvfb-run was "recorded here for the next revision". This revision does not fold it in.
PROPOSAL: State that the checks job installs xvfb and Mesa and runs `bun run verify` under `xvfb-run -a` with `E2E_REQUIRE_WEBGL=1`, and say the same in the AC-07 row.

FINDING: F-10
KIND: factual
SEVERITY: should-fix
WHERE: Scope (line 222); Tasks T37-T47 (lines 1124-1134); Acceptance Criteria AC-21 and AC-23 (lines 1016, 1018)
EVIDENCE: README.md:4 says "pick an engine and a detail level", and README.md:8-9 says "TRELLIS.2 (textured) or Hunyuan3D 2.1 makes the mesh". No task updates these lines: T47 touches README.md only for the coverage list. No proof checks the README for the engine choice. An implementer following the Tasks would ship a README that describes a removed engine.
PROPOSAL: Add the README description to T37 or T42, and add an assertion to `bun test ./app/docs` that the README offers no engine choice and names TRELLIS.2 as the only mesh model.

FINDING: F-11
KIND: factual
SEVERITY: should-fix
WHERE: Acceptance Criteria AC-24 (line 1019); Test Plan row AC-24 (line 1048); Design > Repository and CI (lines 913-915); Tasks T47 (line 1134)
EVIDENCE: The row says "`bun run verify` runs `actionlint` from the pinned binary and fails on a fixture workflow with an error". `bun run verify` lints `.github/workflows/` (line 906), so it never sees a fixture workflow, and the row does not say which test feeds it one. Design and T47 also require that "API errors in the other checks are reported as errors rather than as a missing analysis". Today scripts/deploy/check-repo.sh:43 hides errors with `2>/dev/null || true`. No criterion or proof covers this part.
PROPOSAL: Name the test that runs the verify actionlint step on a fixture directory and expects a failure (for example a bats test of that step). Add the API-error rule to AC-24, with a bats case in which a stubbed code-scanning call that fails is reported as an error.

FINDING: F-12
KIND: factual
SEVERITY: should-fix
WHERE: Design > Repository and CI (lines 913-915); Test Plan row AC-14 (line 1038); Tasks T45 (line 1132)
EVIDENCE: scripts/deploy/check-repo.sh:53-58 lists the installation's repositories with `gh api user/installations/<id>/repositories`. The comment there says this "needs a token the installation authorises (a personal access token or a GitHub App user token)". T32's evidence (line 1113) records HTTP 403 with the owner's `gh` token. Once the check fails closed, the AC-14 proof run through check-repo.sh cannot pass with that token, even after #4 is resolved. The document does not name a credential that can read the listing.
PROPOSAL: Name the credential T45 uses for the installation listing and how it is obtained, or replace the listing with evidence that the owner's token can read, such as the renovate-runner dry run.

FINDING: F-13
KIND: factual
SEVERITY: should-fix
WHERE: Context > Owner summary (lines 107-114); Tasks T45 (line 1132)
EVIDENCE: The permissions paragraph still says that acceptance authorises "creating that repository and turning on those settings" and "adding the repository to the `vhco-renovate` App installation". For this revision the first is done, and #4 calls the second an owner step in organisation settings. T45 has the agent "re-add it to `vhco-pro/renovate-runner`'s targets with a dry run first". That is a change to another repository, and the paragraph does not authorise it. The earlier attempt needed separate owner approval (renovate-runner PR #11, per the removed AC-14 evidence).
PROPOSAL: Rewrite the paragraph for this revision: what acceptance authorises now (branch, PR, merge, prerelease and release deploys, the visual-record ref) and whether it covers the renovate-runner target change. Keep the installation change as the owner's step.

FINDING: F-14
KIND: judgement
SEVERITY: should-fix
WHERE: Context > Owner summary (lines 92-93); Scope > Out of scope (line 248); Tasks T44 (line 1131); Acceptance Criteria AC-15 (line 1010)
EVIDENCE: The summary says that "the revision adds no rollback checks", and the dispatch records that the owner does not want rollback checks for this revision. AC-15 still requires a rollback that reloads a missing image and serves the previous version. T44 runs `scripts/deploy/check-upgrade.sh` between two prereleases on `win-main`, which deploys, removes images, rolls back and runs logon recovery. The summary does not tell the owner that this rollback procedure still runs.
PROPOSAL: State in the summary that AC-15's rollback procedure still runs, between two prereleases of this revision, and that only a rollback across the revision is unchecked. If the owner meant no rollback run at all, raise residualising AC-15 as an Open Question.

FINDING: F-15
KIND: factual
SEVERITY: should-fix
WHERE: Design > Repository and CI (lines 908-911); Context > Owner summary (lines 88-92)
EVIDENCE: Design says that "no analyzer for the PowerShell scripts ... stays an accepted gap tracked in #3". Issue #3 lists "recorded security coverage for Bash and PowerShell" among the gaps this revision fixes, and does not track a PowerShell analyzer. The repository-security convention at edd4c09 says "Use an appropriate source-security analyzer for other languages and record each language's actual coverage". knowledge/shared-delivery.md lists `vhco-pro/pwsh-ci-action` (PSScriptAnalyzer) for PowerShell source.
PROPOSAL: Add the PowerShell analyzer gap to #3, naming `vhco-pro/pwsh-ci-action`, or adopt it in this revision. Cite the tracker accurately.

FINDING: F-16
KIND: factual
SEVERITY: nit
WHERE: Design > Verification commands (lines 932-941); Design > Repository and CI (lines 906-908)
EVIDENCE: Repository and CI says that `bun run verify` runs `actionlint` "right after shellcheck". The ordered list in Verification commands does not include actionlint, and scripts/verify.sh:2 says it follows "the order the feature document's Verification commands give".
PROPOSAL: Insert the actionlint step after shellcheck in the Verification commands list.

FINDING: F-17
KIND: factual
SEVERITY: nit
WHERE: Frontmatter (`issue`, line 4)
EVIDENCE: `issue: 2`. conventions/feature-documents.md (Frontmatter) shows the field as a full issue URL (`https://github.com/OWNER/REPO/issues/42`). The binary's lint passes with the number.
PROPOSAL: Use `https://github.com/vhco-pro/3d-assets-gen/issues/2`.

FINDING: F-18
KIND: factual
SEVERITY: nit
WHERE: Sources (lines 2578-2592); Design > Jobs and batches (line 373); Design > Repository and CI (line 906)
EVIDENCE: Design cites `conventions/http-api.md` and `conventions/github-actions.md` for rules it adopts or defers, and the Vercel rules commit through the frontend guide. Sources does not list them, although it lists the other new convention pages. A blank line also splits Sources into two lists.
PROPOSAL: Add the HTTP API and GitHub Actions pages at edd4c09 to Sources, each with the claim it supports, and join the two lists.

FINDING: F-19
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (lines 88-90)
EVIDENCE: "The new pin's quick workflow and check rules are met here (workflow permissions, a bash default shell, job timeouts, actionlint, a fail-closed installation check ...)". AC-24 is unticked and T46-T47 are open. ci.yml still has top-level `permissions: contents: read` and no `defaults.run.shell`. The feature-documents convention asks the summary to tell planned checks apart from observed proof.
PROPOSAL: Write "this revision adds" instead of "are met here".

FINDING: F-20
KIND: judgement
SEVERITY: nit
WHERE: Design > Page (lines 666-667, 676-677, 680-681); Design > Glossary
EVIDENCE: The restyle changes user-facing labels: `Generate` becomes `Generate 1 job` or `Generate 6 jobs`, `Close preview` (app/web/Viewer.tsx:63) becomes `Close`, and `Select all` is new. The Glossary rows and AC-18 do not cover them. The label for a form that would create no job (for example `Generate 0 jobs`, or a disabled button) is not defined.
PROPOSAL: Add the button terms to the Glossary or state that the Glossary is limited to states, fields, banners and the heading. Define the Generate label and state when no job would be created.

### R-15

TARGET: e0f334fe90c0abb296b6c116778b250c0e783f28

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Repository and CI (lines 938-945); Test Plan row AC-14 (line 1073); Acceptance Criteria AC-24 (line 1054); Test Plan row AC-24 (line 1083); Tasks T45 (line 1167) and T47 (line 1169); Context > Owner summary (lines 111-121)
EVIDENCE: Design says the installation check reads its token from `ASSET_STUDIO_INSTALLATION_TOKEN`, "a fine-grained personal access token the owner creates with read access to the organisation's GitHub Apps". The check calls `GET /user/installations/<id>/repositories` (scripts/deploy/check-repo.sh:55). GitHub's page "Endpoints available for fine-grained personal access tokens" (fetched from docs.github.com/api/article/body?pathname=/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens) lists, under apps, only `PUT` and `DELETE /user/installations/{installation_id}/repositories/{repository_id}`, not the `GET .../repositories` listing. Fine-grained tokens also have no "GitHub Apps" read permission to grant. So the credential the document names cannot make the check pass. The AC-14 row still requires "the repository is listed in the `vhco-renovate` installation's repositories" through check-repo.sh. The alternative proof (a renovate-runner dry run) appears only in Design, not in the row, so the AC-14 proof as written cannot be executed after #4 is resolved. The Owner summary does not mention that the owner must create a token at all. This traces to how the previous revision applied R-14 F-12.
PROPOSAL: Name a credential that can list the installation (for example a GitHub App user access token, verified against the endpoint) or drop the listing. Put the renovate-runner dry run into the AC-14 row as the accepted proof. Mention any owner credential step in the Owner summary, and raise the choice as an Open Question if it adds owner work.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (lines 542-556); Design > Submission, concurrency and idempotency (sweep paragraph, lines 477-486); Acceptance Criteria AC-23 (line 1053); Test Plan row AC-23 (line 1082); Tasks T39 (line 1161)
EVIDENCE: The purge runs "on the first tick with a compatible ComfyUI", and "The sweep that follows removes those jobs' asset directories, uploads and files". The sweep runs "at start and every ten minutes" (line 477). In the tree the start sweep runs before the first tick: app/server/tracker.ts:84-85 calls `this.sweep({ atStart: true })` and only then starts the tick interval. So the sweep that follows the purge is the ten-minute one. The AC-23 row asserts that a start through `start()` "leaves no Hunyuan3D row, no batch without jobs and none of their files" without saying when. One implementer runs a sweep right after the purge commits; another leaves the files for up to ten minutes and the test advances a faked clock. The two build different things, and a test that checks soon after start fails the second.
PROPOSAL: State whether a sweep runs right after the purge completes. In the AC-23 row, say when the file assertion is read (for example after the purge's own sweep, or after the faked clock passes the next ten-minute sweep).

FINDING: F-03
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Restart, upgrade and rollback (lines 543-549); Design > Cancel, retry and delete (lines 497-501); Context > Owner summary (lines 84-86); Acceptance Criteria AC-23 (line 1053)
EVIDENCE: For a user cancel, a `pending` job whose post is under 30 seconds old keeps its flag until the attempt appears or 30 seconds pass (lines 497-499), because a post that timed out may still be accepted. The purge has no such wait: it cancels each known Hunyuan3D prompt ID at once, treats `{"cancelled": false}` for an unknown ID as done, and deletes the rows. A v0.1.0 post that was in flight when deploy.sh replaced the container can land in ComfyUI after that cancel. It then runs with no row, and its GPU time is lost ahead of TRELLIS.2 jobs. Line 548-549 says "no Hunyuan3D row is deleted while its prompt might still be queued", which is not true in that window. The Owner summary says the server cancels "any Hunyuan3D prompt still queued or running", while AC-23 says only "every Hunyuan3D prompt it knows".
PROPOSAL: Apply the same 30-second rule to Hunyuan3D `pending` rows with a recent post time before cancelling and deleting them, or state the window as accepted. Align the Owner summary with AC-23's "it knows".

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Context > Owner summary (lines 93-94); Design > HTTP API (line 632); Design > Page (queue paragraph lines 692-694, library lines 696-699, layout rules lines 728-734); Test Plan rows AC-09 (line 1068) and AC-22 (line 1081); Tasks T38 (line 1160) and T40 (line 1162)
EVIDENCE: This revision raises prompts from 500 to 2000 characters. It says the gallery clips them to two lines with the full text as `title` and in the dialog. The queue row shows "the prompt or file name" with no rule: unclipped, a 2000-character prompt fills about 23 lines at 90 characters each; clipped, a failed or cancelled job never reaches the library, so its full prompt can be read nowhere. guides/vh-midnight.md asks to keep long content "accessible without page-wide scrolling or truncation", and conventions/frontend-testing.md asks to "Include longer text or expanded copy when content length affects sizing". The fixture holds no long prompt: app/server/seed.ts:28-38 has prompts of at most 24 characters, and T40 only makes it TRELLIS.2-only. The AC-22 assertion "a card's clipped prompt carries the full text as `title`" then has no clipped card to check, and the AC-09 layout runs never meet a long prompt.
PROPOSAL: Define how a queue row shows a long prompt and where its full text can be read. Add a long fixture prompt (near 2000 characters, including one long unbroken word) to T40, and run the AC-09 layout rules and the AC-22 title check on it.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 1005-1015); Acceptance Criteria AC-22 (line 1052); Tasks T44 (line 1166)
EVIDENCE: The before side is "the base commit's build seeded with that fixture through the base executable's own `seed` command fed head's fixture rows". The base executable's seed takes no fixture input. Its rows are compiled in as `FIXTURE_JOBS` (app/server/seed.ts:28-38, including the Hunyuan3D "a stone pillar" job), and its options are only `--profile default|empty` and `--reset` (app/server/main.ts:5). As written, the procedure cannot be executed without changing the base build, which would no longer be the base commit's build.
PROPOSAL: Describe an executable route, for example seeding the data directory with head's `seed` command (the schema version is 1 on both sides) and then serving that directory with the base executable.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Page (lines 666-679); Acceptance Criteria AC-22 (line 1052); Test Plan row AC-22 (line 1081)
EVIDENCE: Design says "`--ok`, `--warn` and `--danger` appear on nothing else except the Generate button, the two banners and the Delete hover state", and the AC-22 proof asserts no other element's text, border or background resolves to them. The page has other error outputs: the wrong-token error, batch rejection messages, a failed job's error text, job action errors, the viewer error state and the export-gone notice. Today they use the danger colour (app/web/styles.css:32 `.error`, :51 `.job-error`). conventions/interface-colour.md says to use colour for "whether an action succeeded or failed". The document does not say these messages turn neutral. One implementer keeps them red and fails the AC-22 proof. Another makes them neutral and departs from the colour guideline. Neither choice is raised as an Open Question.
PROPOSAL: Name the error messages and say which colour each uses. Either add them to the allowed list in Design, AC-22 and its row, or state that they stay neutral with their text as the signal. Raise the choice as an Open Question if it departs from the colour guideline.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: Design > Verification commands (lines 982-991); Test Plan row AC-22 (line 1081); Tasks T40 (line 1162) and T41 (line 1163)
EVIDENCE: The AC-22 row stops the fake, switches it to 0.46.1, and holds it "from accepting" so a Waiting badge can be seen. Design lists the Playwright projects that get their own container and fake: sign-in and token rotation, offline and incompatible, glossary, and empty profile. Every other journey shares one seeded container. `style.spec.ts` is not on the isolated list, so as written it stops the fake under the shared journeys. The fake's Playwright control (app/fake-comfy/fake.ts:340-366) offers `version`, `restart`, `reject-next`, `hold`, `release`, `hold-matching`, `release-matching` and `fail-matching`. `hold` holds running prompts and does not stop acceptance. No task names adding a control that keeps a post unaccepted.
PROPOSAL: Add `style.spec.ts`, or its banner and Waiting cases, to the isolated projects. Name the fake control that holds a post unaccepted, and add it to T40 or T41.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Tasks (T43-T47, lines 1165-1169)
EVIDENCE: conventions/feature-documents.md (Tasks) asks to "Order by dependency". T46 (workflow permissions, shell, timeouts, actionlint) and T47 (fail-closed check-repo.sh, README coverage) come after T44, which deploys the prerelease and records the live checks, and after T45, which runs "after merge". Both change files that ship in the PR and that AC-24 checks before merge. Followed in order, the prerelease evidence of T44 is taken at a commit without them, and T45 runs on `main` before T46 and T47 exist.
PROPOSAL: Move T46 and T47 before T43 (or at least before T44). Keep T44 and T45 last.

FINDING: F-09
KIND: factual
SEVERITY: nit
WHERE: Acceptance Criteria AC-22 (line 1052)
EVIDENCE: AC-22 says "semantic badge colours only on job states and banners" and later "semantic colours on nothing but job states, banners, Generate and the Delete hover". Generate and the Delete hover use `--ok` and `--danger`, so read literally the first clause conflicts with the second. The previous revision added the second clause without removing the first. The AC-22 row follows the second.
PROPOSAL: Drop "semantic badge colours only on job states and banners" from AC-22.

FINDING: F-10
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (lines 89-93)
EVIDENCE: The summary lists what #3 tracks as "tag-triggered, repeat-safe releases, 422 and RFC 3339 in the API, test waits, container labels and a PowerShell analyzer". Issue #3 also tracks `conventions/coding.md` fallbacks that announce themselves (app/server/assets.ts, app/server/auth.ts, scripts/deploy/rollback.sh), and the github-actions rule to run only the checks a change needs.
PROPOSAL: Add the fallback rule and the check-selection rule to the summary's list, or write "among them" before the list.

FINDING: F-11
KIND: factual
SEVERITY: nit
WHERE: Design > Repository and CI (lines 909-911)
EVIDENCE: Design says "Every action and reusable workflow is pinned to a full commit SHA with a release-tag comment". .github/workflows/codeql.yml (both jobs) and .github/workflows/scorecard.yml pin `vhco-pro/.github` at `e03ad61274b2bf0738b36ed67dff1c376321fb64` with the comment `# main`, which is a branch, not a release tag.
PROPOSAL: Say that reusable workflows from a repository without release tags carry the branch name in the comment, or change the comments to name a tag where one exists.

FINDING: F-12
KIND: factual
SEVERITY: nit
WHERE: Design > Restart, upgrade and rollback (lines 548-549); Design > Export (line 763); Tasks T39 (line 1161)
EVIDENCE: "Until the purge completes, the tracker submits nothing for Hunyuan3D rows and the job list hides them." T39 touches only `app/server/tracker.ts`, `app/server/main.ts` and `app/server/tracker.test.ts`. The job list is served elsewhere (`app/server/jobs.ts`, `app/server/http.ts`). While ComfyUI stays offline the purge waits, so hidden Hunyuan3D `done` jobs can still be fetched or exported by ID. Their manifest entry would then say `engine` "trellis", which Export calls always true.
PROPOSAL: Add the file that hides Hunyuan3D rows to T39. Say whether `GET /api/jobs/<id>`, assets and exports also refuse Hunyuan3D rows before the purge completes.

## Sources

- [VH Midnight](https://github.com/vhco-pro/docs/blob/edd4c091cd7913e5c4eeb716e6f0f13df2fe7ab7/guides/vh-midnight.md): the token block, button and badge recipes, contrast notes and theme rules the restyled page follows.
- [Use frontend design skills](https://github.com/vhco-pro/docs/blob/edd4c091cd7913e5c4eeb716e6f0f13df2fe7ab7/guides/use-frontend-design-skills.md): the design, critique and review procedure, with the pinned Vercel interface rules.
- [Colour in interfaces](https://github.com/vhco-pro/docs/blob/edd4c091cd7913e5c4eeb716e6f0f13df2fe7ab7/conventions/interface-colour.md): colour only for status, state and identity, never as the only signal.
- [Frontend testing, visual record](https://github.com/vhco-pro/docs/blob/edd4c091cd7913e5c4eeb716e6f0f13df2fe7ab7/conventions/frontend-testing.md): the before-and-after record at `refs/pr-visuals/<number>`, and dialogs reachable at short heights and through resizes.
- [HTTP API](https://github.com/vhco-pro/docs/blob/edd4c091cd7913e5c4eeb716e6f0f13df2fe7ab7/conventions/http-api.md): 422 for well-formed requests with invalid values and RFC 3339 timestamps, deferred to #3.
- [GitHub Actions](https://github.com/vhco-pro/docs/blob/edd4c091cd7913e5c4eeb716e6f0f13df2fe7ab7/conventions/github-actions.md): `permissions: {}`, a bash default shell, job timeouts and actionlint, adopted here; exact-tag dispatch and repeat-safe publication, deferred to #3.
- [Open WebUI ComfyUI image generation](https://docs.openwebui.com/features/image-generation-and-editing/comfyui): ComfyUI support covers image workflows mapped onto Open WebUI's controls.
- [ViewComfy](https://github.com/viewcomfy/viewcomfy): turns ComfyUI workflows into web forms for image, video and text outputs, AGPL-3.0.
- [ComfyUI Mini](https://github.com/ImDarkTom/ComfyUIMini): a lightweight mobile web UI that runs ComfyUI workflows over its API.
- [ComfyBox](https://github.com/space-nuko/ComfyBox): an alternative ComfyUI front end with a prompt queue and history.
- [TRELLIS.2 and Pixal3D are now native](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native): ComfyUI runs TRELLIS.2 with native nodes.
- [Renovate GitHub Release Attachments datasource](https://docs.renovatebot.com/modules/datasource/github-release-attachments/): needs a version and a `currentDigest`, finds the release file whose sha256 matches and supports sha256 and sha512, so a version and its checksum update together.
- [Renovate regex custom manager](https://docs.renovatebot.com/modules/manager/regex): named capture groups such as `currentValue` and `currentDigest`, matched per file.
- The `base-nossl` runtime's content and the plugin's rule list come from measurements, not pages: the Trivy scans and `ldd` output in Background, and `eslint-plugin-react-hooks` 7.1's `configs.recommended.rules` read from `node_modules` during implementation.

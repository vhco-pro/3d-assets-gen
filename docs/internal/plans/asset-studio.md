---
status: draft
status_description: "Owner answers folded in; waiting for the first independent spec review."
issue: null
goal: "A friend opens a private tailnet URL, queues a batch of prompts or images, and downloads the finished game-ready GLB assets in bulk."
covers:
  - app/
  - package.json
  - bun.lock
  - tsconfig.json
  - eslint.config.js
  - playwright.config.ts
  - scripts/deploy/
  - .github/workflows/
---

# Plan: Asset Studio

A small TypeScript web app on the owner's GPU PC that queues batches of 3D asset jobs in ComfyUI,
shows their progress and a 3D preview, and lets a token holder download the results to import into
their own projects.

## Context

### Owner summary

`scripts/generate_3d.py` already turns a prompt into a textured, decimated GLB in about three minutes,
but only from a terminal on the GPU machine. This feature puts a web page in front of the same pipeline
so a friend can queue many assets at once and pull them into their own engine or modelling tool.

The app is TypeScript on Bun and runs on `win-main` beside ComfyUI. Each job is one combined ComfyUI
graph (prompt to image to mesh, or uploaded image to mesh), and ComfyUI's own queue runs the jobs in
order. The app keeps a small job record, collects finished files, and resubmits jobs that ComfyUI lost
in a restart. Preview uses Google's `<model-viewer>` component. Rewriting the client in Go would not make
generation faster: the time goes to the GPU, inside ComfyUI's PyTorch models (see Background).

The friend reaches the app through a Tailscale node share of `win-main` and `tailscale serve` HTTPS, and
signs in once with a shared access token. ComfyUI and the app's own port stay on localhost. The form
offers presets (engine, 5k/10k/20k triangles, 1024 or 2048 textures, 1 to 4 variants, the style suffix
and an optional seed). A batch holds at most 25 jobs and the app allows at most 100 unfinished jobs.
Downloads are a GLB per asset or a zip of a selection with source images and a `manifest.json`.

Out of scope: user accounts, engine-specific exporters, other file formats, a sync client, mesh editing,
public exposure and changes to the ComfyUI install. Sharing the node and restricting `autogroup:shared`
to port 443 in the tailnet ACL are steps the owner takes in the Tailscale admin console.

Planned proof, none of it run yet: unit tests that compare the graphs the app builds with the Python
builders' graphs; a fake ComfyUI server that drives queueing, cancellation, restarts and lost jobs in
tests; Playwright journeys in Chromium and Firefox across a viewport matrix; and after deployment, a
reachability check from another tailnet device and one real generation on `win-main`.

The repository becomes public `vhco-pro/3d-assets-gen` under Apache-2.0, after the local history was
scrubbed of the PC's tailnet address, Windows user name and local paths. Acceptance authorizes building
on a feature branch, creating that repository, merging the feature PR once CI and an independent
implementation review pass, and deploying to `win-main`. It does not authorize changing tailnet ACLs,
sharing the node or touching ComfyUI.

### Background

The pipeline is a pure HTTP client. `scripts/generate_3d.py:27-30` sends every request with
`urllib.request`, `scripts/generate_3d.py:33-39` queues a graph on `/prompt`, and
`scripts/generate_3d.py:42-53` polls `/history/<id>` once a second until the job finishes. The three
graphs are built at `scripts/generate_3d.py:87` (Z-Image Turbo image), `:104` (Hunyuan3D 2.1 mesh) and
`:136` (TRELLIS.2 textured mesh). The script runs the image graph, downloads the image, uploads it
again and runs a mesh graph (`scripts/generate_3d.py:221-236`). All model work happens inside the ComfyUI
server process.

The measured cost is GPU time. `HANDOFF.md:34-41` records 154 to 179 seconds for the 3D step and about
20 seconds for the image, and notes the GPU runs one job at a time. Python's share is a few HTTP calls
per job plus one poll per second, so moving the client to Go or Bun saves milliseconds on a three-minute
job. A faster runtime for the models would mean leaving ComfyUI and PyTorch. No Go library runs
TRELLIS.2 or Hunyuan3D, and the handoff shows how easily the 3D stack breaks on version changes
(`HANDOFF.md:29-30`).

The GPU machine is `win-main` on the tailnet (`HANDOFF.md:23`). ComfyUI listens only on localhost
(`scripts/start_headless.ps1:18`, `HANDOFF.md:25`). Measured during this run:

- `ssh win-main` with a PowerShell `Invoke-WebRequest http://127.0.0.1:8188/system_stats` returned
  `"comfyui_version": "0.46.2"`, so ComfyUI is up and reachable on that host.
- The same session found `node.exe 25.6.1`, `git.exe 2.46.0`, no Bun, Tailscale `1.104.4` and
  `No serve config`.
- `curl` to `win-main`'s tailnet address on port 8188 from `fedora-43` got no answer, as expected for a
  localhost-only server.

The upload helper always declares `image/png` (`scripts/generate_3d.py:79`), whatever the file is. The
handoff lists the web features discussed: prompt or image upload, progress, a 3D preview and GLB
download (`HANDOFF.md:50-55`).

Existing web front ends were checked before choosing to build. Open WebUI drives ComfyUI only for
images, through one static workflow mapped onto its prompt and size controls, and has no 3D output.
ViewComfy turns a workflow into a form for image, video and text outputs, is AGPL-3.0, and has no GLB
preview or export. ComfyUI Mini and ComfyBox are general workflow runners without 3D output handling.
See Sources.

## Scope

In scope:

- A Bun HTTP server on `win-main` that records jobs, submits each as one ComfyUI graph, tracks it
  through ComfyUI's queue and history, stores results and serves the API and the built web page.
- A TypeScript port of the three graph builders in `scripts/generate_3d.py`, and a combiner that joins
  the image graph and a mesh graph into one graph.
- A React page to sign in with the access token, submit a batch of prompts (one per line) or images,
  watch queue progress, cancel or retry jobs, browse the library, preview a GLB in 3D and download one
  asset or a zip of a selection.
- Reconciliation after an app restart and resubmission of jobs ComfyUI lost.
- A deterministic fake ComfyUI server for tests and the development fixture, a seed command and a
  Playwright suite.
- A cross-compiled Windows executable with the page embedded, and deploy scripts that install it on
  `win-main`, start it at logon and configure `tailscale serve`.
- A README naming the bootstrap, seed, run, verify, deploy and clean commands; an Apache-2.0 `LICENSE`;
  CI on GitHub Actions.

Out of scope:

- User accounts or per-user quotas; one shared token gives full access.
- Engine-specific import plugins, FBX or OBJ conversion, and a sync client. The download is glTF
  binary, which Blender, Godot, Unity and Unreal import.
- Exposing octree resolution or image size, which stay at the script defaults (256 and 1024).
- Changing models, the ComfyUI install, Comfy Desktop's settings or `scripts/start_headless.ps1`.
- Mesh editing, retexturing, or rerunning one stage of a finished job.
- Exposure outside the tailnet, and changes to tailnet ACLs or node sharing.
- Removing or changing `scripts/generate_3d.py`; it stays as the reference.
- Tagged releases; CI uploads the executable as a workflow artifact only.

## Design

### Runtime and layout

Bun runs the server, the tests and the build, as `conventions/coding.md` requires for new JavaScript
tooling. The code lives under `app/`:

- `app/server/` holds the HTTP server (`Bun.serve`), the job store, the tracker and the ComfyUI client.
- `app/pipeline/` holds the graph builders, the combiner and the preset definitions.
- `app/web/` holds the React page, built with Vite, with TanStack Query for server state and the
  `@google/model-viewer` web component for the preview.
- `app/fake-comfy/` holds the fake ComfyUI server.
- `app/e2e/` holds the Playwright scenarios.

TypeScript runs in strict mode with type-aware ESLint, per `conventions/typescript.md`. External input
(HTTP bodies, ComfyUI responses, database rows, the configuration file) enters as `unknown` and is
validated at named parse functions.

### Pipeline port and combined graphs

`app/pipeline/graphs.ts` exports `imageGraph`, `hunyuanGraph` and `trellisGraph`, pure functions that
mirror `image_graph`, `mesh_graph` and `trellis_graph` node for node, including the cleanup nodes
`mesh_graph` adds when faces is above zero and the `min(tex, 1024)` cap on the ambient occlusion bake.

`combineGraph` builds the graph a job submits:

- A prompt job takes the image graph unchanged (node IDs `1` to `10`) and a mesh graph with every node
  ID raised by 100. The mesh graph's `LoadImage` node is dropped, and every input that pointed to it
  points to the image graph's `VAEDecode` output (`["9", 0]`) instead. The image graph's `SaveImage`
  stays, so ComfyUI stores the source image too.
- An image job takes the mesh graph alone with IDs raised by 100; its `LoadImage` names the file the app
  uploaded for that job.

Both models then run inside one ComfyUI prompt. ComfyUI loads and unloads models per node within a
prompt the same way it does across prompts; AC-11 is the check that the combined prompt fits the
16 GB card in practice.

Presets map to builder inputs in `app/pipeline/presets.ts`:

| Form field | Values | Builder input |
| --- | --- | --- |
| Engine | TRELLIS.2 (default), Hunyuan3D 2.1 | which mesh builder |
| Detail | 5k, 10k (default), 20k triangles | `faces` 5000, 10000 or 20000 |
| Texture | 1024, 2048 (default); TRELLIS.2 only | `tex` |
| Variants | 1 (default) to 4; prompt batches only | number of jobs per prompt |
| Game-asset style | on (default), off | appends the suffix at `scripts/generate_3d.py:23` |
| Seed | empty (random) or 0 to 4294967295 | seed of the first variant; variant n uses seed + n, wrapping at 2^32 |

Image size is fixed at 1024 and Hunyuan3D's octree at 256. A random seed is drawn uniformly from
0 to 4294967295.

The graph test checks the builders against the Python script. A dump helper in `app/pipeline/` loads
`scripts/generate_3d.py` by path under `python3 -I` and prints each builder's graph as JSON for a fixed
set of inputs. The committed golden files come from it, so the test also runs where Python is absent,
and `bun run golden:check` regenerates and compares them. The combiner test asserts the rewiring rules
above on the same golden graphs.

### ComfyUI client

`app/server/comfy.ts` covers `/system_stats`, `/prompt`, `/queue` (read and delete), `/history/<id>`,
`/interrupt`, `/view` and `/upload/image`. Upload sends the file's real content type and the name
`asset-studio-<job id>.<ext>`, so two jobs never overwrite each other's input. Every call has a
10-second timeout, and a non-2xx answer or unparsable body becomes a typed error. Each `/prompt` call
sends `client_id` set to `asset-studio:<job id>`.

### Jobs and batches

A batch is one submission: either prompts or images, plus one set of preset values. Each prompt line
becomes as many jobs as the variant count, and each image becomes one job. A batch may hold at most 25
jobs after this expansion, and a batch is refused when it would take the number of unfinished jobs
above 100. Both limits live in the configuration file with these defaults.

A job has one of these states:

| State | Meaning |
| --- | --- |
| `pending` | Recorded by the app, not yet accepted by ComfyUI |
| `submitted` | Accepted by ComfyUI; queued or running there |
| `done` | GLB and source image stored by the app |
| `failed` | Stopped with an error message; can be retried |
| `cancelled` | Cancelled by the user; can be retried |

The page shows `submitted` jobs as queued (with their position) or running, read from ComfyUI's
`/queue`. Jobs and batches are stored in SQLite through `bun:sqlite` in WAL mode under the data
directory. A job row holds its batch, preset values, seed, prompt text or upload name, ComfyUI prompt
ID, resubmission count and error message. Files go to `data/assets/<job id>/` as `source.<ext>` and
`model.glb`.

### Submission, concurrency and idempotency

`POST /api/batches` validates the whole batch, then inserts the batch and all its jobs as `pending` in
one transaction, so a batch is accepted whole or not at all. The request carries a client-generated
batch ID; a repeat with the same ID returns the existing batch and creates nothing, so a double click
or a retried request cannot duplicate jobs. Image bytes are written to the data directory in the same
request, before the transaction commits.

One tracker loop in the server does all ComfyUI work. HTTP handlers only insert rows or mark intent
(cancel, retry, delete), so no two requests talk to ComfyUI's queue at once. Every state change is one
SQL update guarded by the expected current state.

Each tick, every two seconds, the tracker:

1. Submits `pending` jobs oldest first: uploads the image for an image job, posts the combined graph,
   and stores the returned prompt ID with state `submitted` in one update. If ComfyUI is unreachable it
   stops submitting for this tick.
2. Reads `/queue`, then the history of each `submitted` job, in that order. ComfyUI moves a finished
   prompt from the queue to the history, so reading the queue first means a job that finishes between
   the two reads is still found in the history.
3. For a job found in the history with a success status, collects the outputs (below). With an error
   status it marks the job `failed` with ComfyUI's error message.
4. For a job in neither, treats it as lost (ComfyUI restarted and dropped its queue or history): it
   returns the job to `pending` with the same seed and adds one to its resubmission count. After two
   resubmissions the job becomes `failed` with a message saying ComfyUI lost it repeatedly. A job
   whose ComfyUI output files can no longer be fetched is treated the same way.
5. Interrupts and fails a job that has been running for more than 15 minutes.

When ComfyUI does not answer, the tracker keeps every job in its state, backs off up to 60 seconds
between attempts, and `/api/health` reports ComfyUI offline until it answers again.

Collecting outputs is idempotent. Each file is downloaded to a temporary name and renamed into place,
and the `done` update runs only after both files exist. A crash during collection repeats the download
on the next tick instead of leaving a half-written asset.

A crash between ComfyUI accepting a prompt and the app storing its ID would leave a `pending` row whose
prompt is already in ComfyUI. Before submitting any `pending` job, the tracker therefore looks for its
`client_id` in the `extra_data` of `/queue` entries and history entries. When it finds one, it stores
that prompt ID instead of submitting again.

The tracker submits every pending job at once, so ComfyUI's queue sets the order: first submitted runs
first. If the owner uses Comfy Desktop at the same time, those prompts interleave with the app's jobs in
ComfyUI's order.

### Cancel, retry and delete

Cancelling a `pending` job changes its row only. Cancelling a `submitted` job deletes its prompt from
ComfyUI's pending queue; if `/queue` shows that prompt running, the tracker calls `/interrupt` instead.
It interrupts only when the running prompt ID is the job's own, so it never stops someone else's
ComfyUI work. The job then becomes `cancelled`.

Retry returns a `failed` or `cancelled` job to `pending` with the same preset values and seed and resets
its resubmission count. Retry counts toward the 100 unfinished jobs limit.

Delete removes a `done`, `failed` or `cancelled` job's row and its files.

### Restart, upgrade and rollback

An app restart needs no separate recovery path. Rows keep their state and prompt IDs, and the next
tracker tick reconciles them against ComfyUI as described above: finished jobs are collected, queued
ones keep waiting, and lost ones are resubmitted.

The database holds a schema version. Before running migrations, the app copies the database file to
`data/backup/<version>-<timestamp>.sqlite`, then runs each migration in a transaction. Rolling back
means stopping the scheduled task, restoring the previous executable and the backup taken before the
upgrade. The first release has schema version 1 and nothing to migrate.

### Access token

The configuration file holds one access token, at least 32 random bytes encoded as base64url. The deploy
script generates it on first install and never prints or copies it off `win-main`. Every `/api` route
except `GET /api/health` and `POST /api/session` requires either an `Authorization: Bearer <token>`
header or the session cookie. `POST /api/session` compares the submitted token in constant time and sets
an `HttpOnly`, `Secure`, `SameSite=Strict` cookie holding an HMAC of the token, so changing the token
and restarting the app signs every browser out. Failed sign-ins are limited to 10 per minute per
client address. `GET /api/health` reveals only the app version and whether ComfyUI is reachable.

### HTTP API

JSON over HTTP under `/api`; the page uses only this API.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | App version and ComfyUI reachability, without a token |
| `POST /api/session` | Exchange the token for the session cookie |
| `POST /api/batches` | Create a batch from prompts (JSON) or images (multipart) |
| `GET /api/jobs?state=&batch=` | List jobs, newest first, with queue position for submitted jobs |
| `GET /api/jobs/<id>` | One job |
| `POST /api/jobs/<id>/cancel` | Cancel a pending or submitted job |
| `POST /api/jobs/<id>/retry` | Requeue a failed or cancelled job |
| `DELETE /api/jobs/<id>` | Delete a done, failed or cancelled job and its files |
| `GET /api/assets/<id>/model.glb` | Download the GLB, named after the prompt |
| `GET /api/assets/<id>/source` | The source image |
| `POST /api/exports` | Zip the selected done jobs and return it |

Uploaded images are limited to PNG, JPEG and WebP, checked by their leading bytes, at most 20 MB each.
Prompts are 1 to 500 characters after trimming; empty lines are dropped.

### Page

The page has a sign-in screen and one main view with three areas: the submit form, the queue and the
library. The queue polls through a TanStack Query `refetchInterval` of two seconds while any job is
unfinished and stops when none are. A banner shows when ComfyUI is offline. The library shows source
images as thumbnails; selecting an asset opens a `<model-viewer>` element with camera controls on its
GLB. Downloads use the API links directly.

### Export

The zip from `POST /api/exports` holds, per asset, `<slug>-<short id>.glb` and the source image under
the same base name, plus `manifest.json` listing each file with its prompt (or upload name), engine,
seed, face target, texture size and creation time.

### Build, deployment and exposure

`bun build --compile --target=bun-windows-x64` produces `asset-studio.exe` with the built page
embedded, cross-compiled on Linux. Configuration is `config.yaml` next to the executable, loaded
strictly: listen address (default `127.0.0.1:8790`), ComfyUI URL (default `http://127.0.0.1:8188`), data
directory, access token and the two limits.

`scripts/deploy/deploy.sh` runs from a Linux machine with SSH access to `win-main`. It copies the
executable to `%LOCALAPPDATA%\AssetStudio\`, writes `config.yaml` with a new token only when none exists,
stops the running copy, swaps the executable, registers a logon scheduled task for the current user and
starts it, then runs `tailscale serve --bg --https=443 http://127.0.0.1:8790`. It keeps the previous
executable as `asset-studio.previous.exe` for rollback. The server listens on localhost only; Tailscale
serve is the only way in from other devices.

### Repository and CI

The repository is public `vhco-pro/3d-assets-gen` with an Apache-2.0 `LICENSE` naming VH & Co BV.
GitHub Actions run `bun run verify` on every pull request and push to `main`, with actions pinned to
full commit SHAs and a release-tag comment. The CI job builds the Windows executable with the same
command the deploy script uses and uploads it as a workflow artifact. The live check never runs in CI.

### Verification commands

`bun run verify` runs the type check, lint, unit tests, the golden check, the production build and the
Playwright suite against the fake ComfyUI. `bun run seed` loads the development fixture: done,
submitted, failed and cancelled jobs with fixture GLBs, plus an empty profile. `bun run verify:live`
runs one small real generation against a deployed app and is never part of CI.

## Acceptance Criteria

- [ ] AC-01: For every input in the golden set, each TypeScript graph builder returns the graph the matching Python builder in `scripts/generate_3d.py` returns, and each combined graph follows the node renumbering and rewiring rules in Design.
- [ ] AC-02: Submitting a batch through the page creates one pending job per prompt line and variant, or per image, and a batch that is empty, has an over-long prompt, a wrong or oversized file, more than 25 jobs, or would exceed 100 unfinished jobs is rejected with a message and creates no job; repeating a submission with the same batch ID creates nothing new.
- [ ] AC-03: Each job is submitted to ComfyUI as one prompt, jobs run in submission order, and each ends `done` with its GLB and source image stored, or `failed` with ComfyUI's error message.
- [ ] AC-04: While ComfyUI is unreachable the page shows it offline and every job keeps its state, and jobs continue once ComfyUI answers again.
- [ ] AC-05: A pending job can be cancelled without contacting ComfyUI; a submitted job can be cancelled and its prompt is removed from ComfyUI's queue, or interrupted only when it is the running prompt; a failed or cancelled job can be retried with the same settings and seed.
- [ ] AC-06: After an app restart, every job ends in the state ComfyUI's queue and history imply; a job ComfyUI lost is resubmitted up to twice and then fails; a prompt ComfyUI accepted before the app stored its ID is adopted rather than submitted twice; and no asset is left half written.
- [ ] AC-07: The library lists done assets with a thumbnail and renders the selected GLB in a 3D viewer in Chromium and Firefox.
- [ ] AC-08: A single asset downloads as a GLB, and a selection downloads as one zip holding each GLB, its source image and a `manifest.json` describing them.
- [ ] AC-09: The page's sign-in, submit, queue and library journeys stay readable and usable with no horizontal overflow at every size in the project viewport matrix, with keyboard access and labelled controls.
- [ ] AC-10: The deployed app answers over HTTPS at `win-main`'s tailnet name from another tailnet device, while port 8790 and ComfyUI's port 8188 are not reachable on `win-main`'s tailnet address.
- [ ] AC-11: One real prompt job submitted through the deployed app produces a textured GLB from the real ComfyUI on `win-main`.
- [ ] AC-12: Every API route except health and sign-in refuses a request without a valid token or session cookie, a wrong token is refused, and repeated wrong tokens from one client are rate limited.

## Test Plan

| Criterion | Proof |
| --- | --- |
| AC-01 | `bun test app/pipeline` compares each builder with the committed golden graphs and asserts the combiner's renumbering, the dropped `LoadImage` and every rewired input; `bun run golden:check` regenerates the golden files from the Python script with `python3 -I` and fails on any difference. |
| AC-02 | `bun test app/server` API tests for each rejection case, the job counts and a repeated batch ID; Playwright `submit.spec.ts` submits three prompt lines with two variants (six jobs) and an image batch, then each invalid case, against the fake ComfyUI. |
| AC-03 | `bun test app/server` tracker tests against the fake ComfyUI: each job reaches the fake as one `/prompt` call whose graph matches the combiner, two batches finish in submission order with files on disk, and a fake execution error ends `failed` with its message. Playwright `queue.spec.ts` watches a job reach `done`, reloads and checks it persists. |
| AC-04 | Tracker test stops the fake ComfyUI with jobs pending and submitted, asserts no state changes and `/api/health` reports offline, restarts the fake and asserts the jobs finish. Playwright `offline.spec.ts` checks the offline banner appears and clears. |
| AC-05 | Tracker tests: cancel pending (the fake receives no call), cancel queued (the fake receives a queue delete for that prompt ID), cancel running (the fake receives `/interrupt` only while the job's own prompt runs, and none when another prompt runs), retry keeps preset values and seed. Playwright `queue.spec.ts` cancels and retries through the page. |
| AC-06 | Restart tests kill and restart the server against the fake in four states: prompt finished in history (job ends `done`), prompt still queued (job stays submitted and later finishes), prompt unknown after a fake restart (job resubmitted, and after a third loss `failed`), and prompt accepted with the ID never stored (job adopts the prompt by `client_id`; the fake receives one `/prompt` call in total). A fault-injection test kills the server between the two file writes and asserts no `done` row and no file at the final path until the next tick completes. |
| AC-07 | Playwright `library.spec.ts` in Chromium and Firefox on the seeded fixture: thumbnails present, the viewer fires `load` for the fixture GLB and its canvas has non-background pixels, and the console has no errors. |
| AC-08 | Playwright `export.spec.ts` downloads one GLB and checks its glTF binary header, then selects three assets, downloads the zip and checks its six file names and that `manifest.json` parses and lists all six files with their settings. |
| AC-09 | Playwright `layout.spec.ts` runs the sign-in, submit, queue and library journeys in Chromium at 320x568, 390x844, 390x667, 844x390, 768x1024, 1024x768, 1280x720 and 1440x900: no horizontal overflow, primary actions inside the viewport, every control has an accessible name, and sign-in and submit complete by keyboard alone. A screenshot of each size is saved and reviewed, and the review result is recorded in the evidence. |
| AC-10 | Manual procedure after deploy, run from `fedora-43`: `curl https://win-main.<tailnet>.ts.net/api/health` returns the deployed version; `curl --connect-timeout 5` to `win-main`'s tailnet address on ports 8790 and 8188 fails to connect. |
| AC-11 | `bun run verify:live` against the deployed URL, with the token read on `win-main`, submits the prompt `a small wooden crate` with 5k detail and 1024 textures, waits for `done`, downloads the GLB and checks that it parses as glTF with at least one material that has a base colour texture. |
| AC-12 | `bun test app/server` auth tests: every protected route returns 401 without credentials and with a wrong token, succeeds with the bearer token and with the cookie from `POST /api/session`, and the eleventh wrong sign-in within a minute returns 429. Playwright `signin.spec.ts` signs in through the page, and a wrong token shows an error. |

## Tasks

None yet; written once the document is planned.

## Open Questions

None.

## Review Log

| Date | Review | Kind | Commit | Model | Isolation | Outcome |
| --- | --- | --- | --- | --- | --- | --- |

## Sources

- [Open WebUI ComfyUI image generation](https://docs.openwebui.com/features/image-generation-and-editing/comfyui): ComfyUI support covers image workflows mapped onto Open WebUI's controls.
- [ViewComfy](https://github.com/viewcomfy/viewcomfy): turns ComfyUI workflows into web forms for image, video and text outputs, AGPL-3.0.
- [ComfyUI Mini](https://github.com/ImDarkTom/ComfyUIMini): a lightweight mobile web UI that runs ComfyUI workflows over its API.
- [ComfyBox](https://github.com/space-nuko/ComfyBox): an alternative ComfyUI front end with a prompt queue and history.
- [TRELLIS.2 and Pixal3D are now native](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native): ComfyUI runs TRELLIS.2 with native nodes.

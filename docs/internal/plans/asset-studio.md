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
| 2026-11-21 | R-1 | spec | `79aed7b` | claude-opus-5-5 | procedural | 1 blocking, 18 should-fix, 1 nit |

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

## Sources

- [Open WebUI ComfyUI image generation](https://docs.openwebui.com/features/image-generation-and-editing/comfyui): ComfyUI support covers image workflows mapped onto Open WebUI's controls.
- [ViewComfy](https://github.com/viewcomfy/viewcomfy): turns ComfyUI workflows into web forms for image, video and text outputs, AGPL-3.0.
- [ComfyUI Mini](https://github.com/ImDarkTom/ComfyUIMini): a lightweight mobile web UI that runs ComfyUI workflows over its API.
- [ComfyBox](https://github.com/space-nuko/ComfyBox): an alternative ComfyUI front end with a prompt queue and history.
- [TRELLIS.2 and Pixal3D are now native](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native): ComfyUI runs TRELLIS.2 with native nodes.

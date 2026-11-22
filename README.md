# Asset Studio

A small web app that queues batches of 3D asset jobs on a GPU PC running ComfyUI and hands back
game-ready GLB files. Type prompts (one per line) or upload images, pick a detail level and texture size,
watch the queue, preview each model in the browser, and download one GLB or a zip of a selection with a
`manifest.json`.

Each job is one ComfyUI prompt: Z-Image Turbo makes the source image, then TRELLIS.2 makes the textured
mesh, decimated to 5k, 10k or 20k triangles. The graphs mirror the image and TRELLIS.2 builders in
`scripts/generate_3d.py`, which stays in the repository as the reference.

The feature document is [docs/internal/plans/asset-studio.md](docs/internal/plans/asset-studio.md).

## Develop

Needs Bun 1.4, Docker and python3 (python3 only for the golden check).

| Command | What it does |
| --- | --- |
| `bun run bootstrap` | Installs dependencies from `bun.lock` and the Playwright browsers |
| `bun run dev` | Starts the fake ComfyUI on port 8189 and the server on http://127.0.0.1:8790 with `dev/config.yaml`; ready when it prints `✓ Passed: ready at ...` (it waits for `/api/health` to report ComfyUI reachable) |
| `bun run seed` | Loads the fixture jobs (every state the page shows) into the dev data; `--profile empty` loads none, `--reset` removes only fixture jobs. Only runs against the fake ComfyUI |
| `bun run verify` | Type check, lint, shellcheck, unit, workflow and shell tests, golden check, page build, bundle budgets, image build and start check, memory check, dev readiness, docs check and the Playwright journeys |
| `bun run clean` | Deletes `.dev-data/` and the `.artifacts/` test output, nothing else |

Sign in to the dev stack with the token in `dev/config.yaml`. The server refuses that token unless
ComfyUI answers the fake's marker endpoint, so it can never serve a real ComfyUI.

## Deploy

The app runs as a container under Docker Desktop on `win-main`, next to ComfyUI, and is reached through
`tailscale serve` HTTPS. Releases come from CI: every push to `main` (or to a branch whose PR has the
`release:preview` label) that passes the checks gets a version, a signed and attested image in
`ghcr.io/vhco-pro/3d-assets-gen`, and a GitHub Release holding the image digest.

| Command | What it does |
| --- | --- |
| `scripts/deploy/deploy.sh <version>` | Verifies the release's signature and attestations, loads the image on `win-main`, refuses it before changing anything when it knows an older schema than the database there (use `rollback.sh` to go back), and brings the app up; `--rotate-token` makes a new access token |
| `scripts/deploy/rollback.sh` | Returns to the previous version, restoring the matching database backup when the schema changed |
| `scripts/deploy/check-image.sh <version>` | Checks a published image: anonymous pull, signature, attestations and a read-only start |
| `scripts/deploy/check-repo.sh` | Checks the repository's security settings, workflows and Renovate |
| `scripts/deploy/check-upgrade.sh <first> <second>` | Runs the upgrade, rollback and logon-recovery check on `win-main` with two released versions, keeping what it saw in `.artifacts/check-upgrade.log`; it leaves `<second>` deployed |

All scripts print `✓ Passed`, `✗ Failed`, `∅ Skipped` and `›` status lines, use no colour when
`NO_COLOR` is set or output is not a terminal, and accept `--ascii`.

The app keeps running while the owner is signed in on `win-main`; a scheduled task brings it back at each
logon. The access token lives only in `%LOCALAPPDATA%\AssetStudio\config.yaml` on `win-main`; read it
with `ssh win-main type AppData\Local\AssetStudio\config.yaml` and pass it on yourself.

## Security analysis

What each language in the repository is checked with:

| Language | Analysis |
| --- | --- |
| JavaScript and TypeScript | CodeQL (`codeql.yml`, category `/language:js-ts`) |
| Python | CodeQL, in the same `/language:js-ts` analysis (`scripts/generate_3d.py`, the golden dump helper) |
| GitHub Actions | CodeQL (`/language:actions`) and actionlint in `bun run verify` |
| Bash | shellcheck in `bun run verify`; a linter, not a security analyzer |
| PowerShell | None yet; adopting PSScriptAnalyzer through `vhco-pro/pwsh-ci-action` is tracked in [#3](https://github.com/vhco-pro/3d-assets-gen/issues/3) |

## Owner checklist

These steps happen outside the repository and complete access for the friend:

- [ ] Share the `win-main` node with the friend's tailnet (Tailscale admin console, Machines, Share).
- [ ] Limit `autogroup:shared` to port 443 on `win-main` in the tailnet ACL, so the share reaches only
      the app.
- [ ] Add `3d-assets-gen` to the `vhco-renovate` GitHub App installation (organisation settings, GitHub
      Apps, Configure), so dependency updates start.
- [ ] Send the friend the HTTPS URL and the access token.

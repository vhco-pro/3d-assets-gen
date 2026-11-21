# Repository instructions

Read the personal conventions at
https://github.com/vhco-pro/docs/blob/1ccf8f314575ece1f3fcc8e48c4fd804a1ca88ff/AGENTS.md
and follow the task routes there before implementation.

For all code, read conventions/coding.md at that revision.
To specify, plan or implement a feature, read conventions/feature-documents.md.
For Go, also read conventions/go.md; for images, conventions/containers.md;
for CI and releases, conventions/delivery.md and knowledge/shared-delivery.md.
For TypeScript, read conventions/typescript.md; for React, also read conventions/react.md,
including when specifying or reviewing those parts of a feature.
When onboarding or bootstrapping, read the matching guides/ page.

Load only the relevant documents. If they are inaccessible, report it and stop.
Preserve this repository's local instructions; report a conflict instead of
silently overriding either source.

For command-line output or terminal interaction, read conventions/terminal-output.md at that revision.

## Local commands and constraints

Needs Bun 1.4, Docker and python3. Commands, from the repository root:

- `bun run bootstrap`: install dependencies and the Playwright browsers.
- `bun run dev`: fake ComfyUI and server on http://127.0.0.1:8790; ready when it prints `✓ Passed: ready at`.
- `bun run seed`: load the fixture jobs (only against the fake ComfyUI).
- `bun run verify`: every check, including the image build and the Playwright journeys; CI runs it.
- `scripts/deploy/deploy.sh <version>` and `scripts/deploy/rollback.sh`: deploy to or roll back win-main.
- `bun run clean`: delete `.dev-data/` and `.artifacts/`.

`scripts/generate_3d.py` is the reference pipeline; `bun run golden:check` holds the TypeScript graph
builders to it. The deploy and check scripts follow conventions/terminal-output.md through
`scripts/deploy/lib/report.sh` and `app/cli/report.ts`.

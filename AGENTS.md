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

## Local commands and constraints

No build or test commands exist yet. `scripts/generate_3d.py` is the reference
pipeline and runs with the Python standard library against a ComfyUI server.

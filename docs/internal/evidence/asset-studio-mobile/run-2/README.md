# Emulator run 2

`bun scripts/phone/android-journey.ts --run 2` against `https://win-main.tail6948f.ts.net` running
`0.3.0-feat-asset-studio-mobile.3` (commit `bdf3725`), on the `asset-studio` AVD (API 35, Chrome 124), on
2026-11-23. It printed `run 2 passed`. Every step that submits a job (notify, camera, share) was refused, so
no job was submitted.

- `transcript.txt` is the run's transcript as written. Only `01-installed.png` (the installed app opening
  without browser chrome) is committed, at half size. The other screenshots show the client's real prompts
  and assets, and the sign-in screen shows the token's last character. This repository is public, so they
  stay out under the redaction rule in `conventions/frontend-testing.md`.
- "notifications on" found notifications already on: the subscription from the earlier run 2 against
  `.2` was still in place, and AC-09 recorded its endpoints across the rollback.
- "ar load": after 16 minutes on the Asset page, View in your room launched the Scene Viewer intent with a
  freshly signed link. Scene Viewer in this image's Google app (15.22) crashes with a `StackOverflowError`
  before fetching the model, so win-main logged no `signed GLB` line from it. Scene Viewer showing the model
  stays open as https://github.com/vhco-pro/3d-assets-gen/issues/16.
- `signed-link-check.txt`: the same job's signed link fetched from this host with no cookie returned 200
  with the 19,135,844-byte GLB (`model/gltf-binary`), and the server logged
  `signed GLB <id> for <client> (<user agent>)`. The plain `model.glb` with no cookie returned 401, and the
  link with one signature character changed returned 401. The client address is redacted.

# Emulator run 2

`bun scripts/phone/android-journey.ts --run 2`, with `PHONE_LOG_COMMAND` reading the app's log on win-main,
against `https://win-main.tail6948f.ts.net` running `0.3.0-feat-asset-studio-mobile.3` (page code from
`bdf3725`; the journey at `6bb7f09`), on the `asset-studio` AVD (API 35, Chrome 124), on 2026-11-24. The run
ended `run 2: 1 step(s) failed`: every step passed except "ar load". Every step that submits a job (notify,
camera, share) was refused, so no job was submitted.

- `transcript.txt` is the run's transcript as written. Only `01-installed.png` (the installed app opening
  without browser chrome) is committed, at half size. The other screenshots show the client's real prompts
  and assets, and the sign-in screen shows the token's last character. This repository is public, so they
  stay out under the redaction rule in `conventions/frontend-testing.md`.
- "notifications on": the switch was still on from an earlier run, so the step turned it off and on again,
  and `POST /api/push/subscriptions` answered 204.
- "ar load" failed, and the transcript says why. After 16 minutes on the Asset page, View in your room
  launched Scene Viewer: logcat shows the `android.intent.action.VIEW` for `arvr.google.com` in
  `com.google.android.googlequicksearchbox`. Twenty seconds later the Asset Studio window was back on top,
  and win-main had logged no `signed GLB` line for the job. Scene Viewer in this image's Google app (15.22)
  crashes with a `StackOverflowError` before it fetches the model, as earlier runs showed. Scene Viewer showing
  the model stays open as https://github.com/vhco-pro/3d-assets-gen/issues/16, which covers AC-05 and AC-12.
- `signed-link-check.txt` (2026-11-23, against the same prerelease): the job's signed link fetched from this
  host with no cookie returned 200 with the 19,135,844-byte GLB (`model/gltf-binary`), and the server logged
  `signed GLB <id> for <client> (<user agent>)`. The plain `model.glb` with no cookie returned 401, and the
  link with one signature character changed returned 401. The client address is redacted.
- An earlier version of this README credited run 2 with an AR load. That run's "ar load" step asserted
  nothing after the tap (review R-25 F-01). T35 made the step check the intent, the activity on top and the
  server log.

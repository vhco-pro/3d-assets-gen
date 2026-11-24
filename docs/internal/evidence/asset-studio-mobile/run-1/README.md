# Emulator run 1

`bun scripts/phone/android-journey.ts --run 1` against `bun run dev` (fixture data), through `adb reverse`,
on the `asset-studio` AVD (API 35, Chrome 124), at commit `6bb7f09` on 2026-11-24. Every step passed. The
page under test is the same as at `bdf3725`, as later commits change only the journey and docs.

- `transcript.txt` is the run's transcript as written. Its screenshot paths point at
  `.artifacts/phone/run-1/`, and the files here have the same names, at half size and 256 colours to keep
  the repository small.
- Step "zoom": Chrome 124's accessibility text scaling at 200 percent only enlarges the text blocks its text
  autosizer picks, here the shared style field (`06-zoom-create.png`). Headings and labels keep their size
  (the transcript's `heading 19.2px` is the 100 percent size). So the step shows that nothing clips or covers
  Generate under the scaling Chrome actually applies. The 200 percent zoom reflow itself is the 640x450 case in
  `app/e2e/layout.spec.ts`.
- Step "share": Chrome on Android takes the download path (AC-08), and the GLB lands in `/sdcard/Download`
  at its full size.
- Step "notify": `14-notify-foreground.png` and `15-notify-closed.png` show each notification's Asset page.
  The step waits for the reopened page's model to load before taking the screenshot (review R-25 F-04).

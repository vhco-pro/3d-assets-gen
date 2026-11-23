---
status: draft
status_description: "Owner answered all eleven questions; waiting for the spec review and acceptance."
issue: https://github.com/vhco-pro/3d-assets-gen/issues/12
goal: "The client installs Asset Studio on an Android phone or iPhone, queues prompts or camera photos with one Quality choice, gets a notification when an asset is ready, and opens it in their room through AR or shares the GLB."
covers:
  - app/
  - package.json
  - bun.lock
  - vite.config.ts
  - playwright.config.ts
  - scripts/verify.sh
  - scripts/phone/
  - .github/workflows/ci.yml
  - README.md
  - AGENTS.md
---

# Plan: Asset Studio mobile

Asset Studio becomes an installable web app (PWA) with a phone layout: bottom tabs for Create, Queue and
Library, an Asset page with AR and sharing, one Quality control, camera upload and "asset ready"
notifications. It is the same React page and the same server on win-main, for Android and iPhone alike.

## Context

### Owner summary

The client mostly uses Asset Studio from an Android phone, and today's page is built for a desktop: one
long column with every setting visible. You approved a phone design with four screens, and this feature
builds it on the existing code. Nothing is rewritten and there is no store app; Capacitor stays possible
later on the same code.

On a screen narrower than 1024 pixels the page shows a bottom tab bar (Create, Queue, Library) and opens a
full-screen Asset page from the Library. Wider screens keep today's two-column layout. A Quality control
with four levels (Fast, Standard, High, Ultra) replaces Detail and Texture. The Create screen gets Take
photo and From photos buttons for image batches. The Asset page has View in your room (Scene Viewer on
Android, Quick Look on iPhone), Share GLB, Download and Delete.

The page gets a web app manifest, icons and a small service worker, so Chrome and Safari can add it to
the home screen. The service worker only handles notifications; it caches nothing, so a deploy is visible
on the next load. When the client allows notifications, the server sends a Web Push message through
Google's or Apple's push service each time a job finishes, also with the app closed. The message holds
the asset name, encrypted end to end, and win-main makes an outbound HTTPS call to that service.

Two server additions carry this: push subscriptions with a key pair kept in one file in the data volume,
and a short-lived signed link for the GLB, because Scene Viewer is a separate Android app that cannot send
the session cookie. There is no database migration, so a rollback to v0.2.0 keeps every job.

Planned proof: unit tests for the push encryption (against the RFC 8291 example) and the signed link;
Playwright journeys at phone sizes in Chromium and in WebKit, Safari's engine; and an agent-run procedure
on an Android emulator on fedora-43, first against a local stack and then against the prerelease on
win-main. You do one final check on your iPhone against the prerelease. None of this has run yet, and
the spec has not been reviewed.

Your decisions, all as recommended: the Quality pairs above, on every layout; tabs below 1024 pixels;
Scene Viewer with a 15-minute signed link; Share GLB falls back to a download on Android; Web Push to
every device that turned it on; no offline cache and no Install button; Remix included; the emulator
check against win-main submits no real job; and the merge does not wait for your iPhone check, so an
iPhone-only problem it finds becomes a follow-up fix.

Accepting the spec authorizes the implementation on a feature branch, prerelease deploys to win-main
(which replace the running v0.2.0 for the client while testing), the rollback test there, the merge and
the v0.3.0 deploy. You approved the tracking issue,
[vhco-pro/3d-assets-gen#12](https://github.com/vhco-pro/3d-assets-gen/issues/12).

### Background

The harm: the client works from a phone, and the page they get there is the desktop layout stacked into one
column (`app/web/App.tsx:196-202` renders the composer, queue and library in one `layout` grid; below 1024
pixels it stacks, per `docs/internal/plans/asset-studio.md` Design > Page). Every preset is on screen at
once, including two controls (Detail and Texture, `app/web/App.tsx:344-345`) whose numbers a phone user does
not think in. Generation takes minutes per job, so the client has to keep the page open and look at it to
know when an asset is ready, and there is no way to see a model in a room or hand the file to another app
from the phone. This happens on every phone visit and does not heal by itself.

The simplest alternative without machinery is a responsive restyle only: phone CSS, no manifest, no push,
no signed link. It fixes the layout but leaves the waiting problem (no notification with the page closed)
and AR on Android (Scene Viewer cannot load a cookie-protected GLB, see below). The owner approved a design
that includes both, so the design below adds the two pieces of machinery those need and nothing else: no
offline cache, no badge, no store wrapper.

Current state, measured in this repository at `efac26a`:

- The page is one React component tree, `App` → `Gate` → `Studio`, with `Composer`, `Queue`, `Library` and
  the `Viewer` dialog (`app/web/App.tsx:90-206`, `app/web/Viewer.tsx:55-137`). There is no router; the only
  URL state is `?export=gone` (`app/web/App.tsx:159`).
- `index.html` already has `viewport-fit=cover` and `theme-color` `#020814`
  (`app/web/index.html:5-6`), but no manifest, icons or service worker (`git ls-files app/web` lists none).
- Presets: `DETAILS` are 5000, 10000, 20000 and 30000 triangles and `TEXTURES` 1024, 2048 and 4096
  (`app/pipeline/presets.ts:4-5`); 30000 and 4096 are valid only together as Ultra
  (`app/pipeline/presets.ts:10-12`). The batch API takes `faces` and `tex`
  (`app/web/api.ts`, `PresetsInput`).
- The image input accepts PNG, JPEG and WebP, several at once, and replaces the selection on every change
  (`app/web/App.tsx:328`); a batch's images may add up to 200 MiB (`app/web/App.tsx:277-278`).
- The viewer is `<model-viewer>` 4.4.0 (`node_modules/@google/model-viewer/package.json`), loaded on demand
  from the URL in `<meta name="viewer-src">` (`app/server/static.ts:27-28`, `app/web/Viewer.tsx:13-36`),
  without the `ar` attribute (`app/web/Viewer.tsx:99-108`).
- model-viewer launches Scene Viewer with an `intent://arvr.google.com/scene-viewer/1.2` URL whose `file`
  parameter is the model's absolute URL, for the Google app package
  (`node_modules/@google/model-viewer/lib/features/ar.js:271-291`). Its default `ar-modes` is
  `webxr scene-viewer quick-look` (`ar.js:33`).
- Every `/api` route except health and session needs the token or the session cookie (`app/server/http.ts:104-106`).
  The cookie is `HttpOnly; Secure; SameSite=Strict` and lasts 30 days (`app/server/auth.ts:6`,
  `app/server/auth.ts:35`). The GLB is served at `/api/assets/<id>/model.glb` as an attachment
  (`app/server/assets.ts:25-27`).
- The server returns `index.html` for every path outside `/api/` and `/assets/`
  (`app/server/static.ts:34-44`), so `/manifest.webmanifest` or `/sw.js` would get the page today. The
  compiled executable embeds every file under `dist/web` (`app/cli/build-exe.ts:25`).
- A job becomes `done` in one place, after its files are renamed into the asset directory
  (`app/server/tracker.ts:398`).
- The database is at schema version 2; a rollback restores a backup only when the two images' schema
  versions differ (`docs/internal/plans/asset-studio.md` Design > Restart, upgrade and rollback).
- Playwright runs Chromium and Firefox only (`playwright.config.ts:18-23`); CI installs those two
  (`.github/workflows/ci.yml:36`). The layout test already covers 320x568 to 1440x900
  (`app/e2e/layout.spec.ts:7`).
- The app is reached at `https://win-main.tail6948f.ts.net` through `tailscale serve`
  (`docs/internal/plans/asset-studio.md` AC-10 evidence), so it is a secure context, which service workers
  and Web Push need.
- fedora-43 has `/dev/kvm` usable by the user (`ls -l /dev/kvm`: `crw-rw-rw-. root kvm`), 31 GiB RAM and
  106 GiB free on `/home` (`free -g`, `df -h ~`). No Android SDK is installed. Playwright's WebKit is not
  installed locally (`ls ~/.cache/ms-playwright` lists Chromium and Firefox only).

Related work: [vhco-pro/3d-assets-gen#2](https://github.com/vhco-pro/3d-assets-gen/issues/2) and
`docs/internal/plans/asset-studio.md` delivered v0.2.0; that document stays `in-progress` for a tooling
reason and covers `app/`, so this feature's changes make its reviews stale. That does not block this
feature. [vhco-pro/3d-assets-gen#9](https://github.com/vhco-pro/3d-assets-gen/issues/9) (a
`check-upgrade.sh` comparison bug) is not fixed here.

## Scope

In scope:

- A web app manifest, icons (including a maskable icon and an Apple touch icon) and a service worker, so
  the page can be added to the home screen on Android and iPhone and opens without browser chrome.
- A phone layout below 1024 CSS pixels: a bottom tab bar with Create, Queue and Library, one screen at a
  time, and a full-screen Asset page opened from the Library. Tabs and the open asset are in the URL, so
  reload, Back and links work.
- The Quality control (Fast, Standard, High, Ultra) in place of Detail and Texture.
- Take photo and From photos on Create for image batches.
- On the Asset page: View in your room (AR), Share GLB, Download, Delete, and Remix (fills Create with
  the asset's prompt and settings).
- "Asset ready" notifications through Web Push, with a switch to turn them on and off.
- A signed, short-lived GLB link for Scene Viewer.
- WebKit (Safari's engine) and phone-sized Chromium in the Playwright suite.
- An agent-run Android emulator procedure on fedora-43 and its committed scripts.

Out of scope, by name:

- Offline use. The app needs the tailnet anyway, and the service worker caches nothing.
- An app icon badge with the queue count, background sync, and an in-app Install button (installing goes
  through the browser menu, with instructions on the page).
- A store app (Capacitor or other), and any React Native or Expo rewrite.
- Server-side USDZ files for iPhone AR; Quick Look uses the file model-viewer builds in the page.
- Sharing several GLBs at once from the phone; Select and Download selected (the existing zip export) stay.
- Notifications only for one's own jobs; every subscribed device hears about every finished job.
- Any change to the batch API's `faces` and `tex` fields, the pipeline or the database schema.
- Fixing [vhco-pro/3d-assets-gen#9](https://github.com/vhco-pro/3d-assets-gen/issues/9).

## Design

### Layout and navigation

`Studio` keeps its data hooks (`app/web/App.tsx:144-157`) and chooses a layout from a
`(min-width: 1024px)` media query. At 1024 pixels and wider it renders today's two-column page, with the
Quality control in the composer and the Preview dialog unchanged except for the Asset actions below.
Narrower, it renders the phone shell: a top bar with the screen title, the content of one screen, and a
fixed bottom tab bar with Create, Queue and Library (lucide icons with text labels), padded with
`env(safe-area-inset-bottom)`. The ComfyUI banners show above the screen content in both layouts.

The screen lives in the URL query: `?tab=create` (the default when absent), `?tab=queue`,
`?tab=library` and `?asset=<job id>`. Switching tabs uses `history.replaceState`; opening an asset uses
`history.pushState`, so the browser's Back (and Android's back gesture) returns to the Library. A
`popstate` listener re-reads the URL. Reloading keeps the screen. The `?export=gone` notice keeps working
in both layouts. When the query names an asset that is not in the job list or not `done`, the Asset page
shows `This asset is no longer available.` with a button back to the Library. The server needs no route
change, since every path outside `/api/` returns the page (`app/server/static.ts:42-44`).

Create holds the existing composer fields in this order: Prompts, Take photo and From photos, the chosen
images, Quality, Variants, Game-asset style, Seed, Shared style, and Generate. Queue holds the existing
queue component, with its summary strip, batch groups and job rows. When the queue is empty it shows
`Nothing in the queue.` instead of hiding (the desktop queue still hides). Library is a two-column grid of
thumbnail tiles (one column below 360 pixels) with the name under each, a Select button that turns the
tiles into checkboxes with Select all and Download selected, and the empty state. Tapping a tile outside
select mode opens its Asset page.

The Asset page shows `<model-viewer>` at the top (square, at most 60 percent of the viewport height), the
name, its Quality (see below), `Generated in`, Seed and Created, then the actions View in your room (when
AR is available), Share GLB, Download, Remix and Delete. Delete goes back to the Library after the job is
deleted. Remix fills Create's prompt, Quality, Game-asset style and Shared style from the asset (image
assets fill only Quality and Game-asset style, since the image is not re-uploaded) and switches to Create.
On the desktop layout the Preview dialog gets the same actions next to Download GLB and Close.

Every control in the phone shell has a hit area of at least 44 by 44 CSS pixels. The existing layout rules
(body text at least 14 pixels, no clipped text, no horizontal overflow, contrast as in
`docs/internal/plans/asset-studio.md` Design > Page) apply to the phone shell at every matrix size.

The initial page load keeps its 150 KiB gzip budget (`bun run size`); the service worker is a separate
file and is not counted.

### Quality

`app/pipeline/presets.ts` gains `QUALITIES`, an ordered list of four named levels, each a valid pairing of
the existing values:

| Quality | Triangles | Texture | Note on Create |
| --- | --- | --- | --- |
| Fast | 5000 | 1024 | none |
| Standard | 10000 | 2048 | none (the default, as today's 10k and 2048) |
| High | 20000 | 2048 | none |
| Ultra | 30000 | 4096 | `Ultra: best quality, about 10 min per job.` |

Create shows Quality as one segmented radio group with those four names, and the request still sends
`faces` and `tex`, so the server, the database and the estimates keep working unchanged. Job rows, the
Asset page, the Preview dialog and the Library show `Quality: <name>` for a job whose pair matches a
level, and `Custom (<k>k, <texture>)` for an older job whose pair does not (for example 5000 with 2048);
a Hunyuan3D job with no texture shows `Custom (<k>k)`. The queue's typical-duration grouping by triangles
and texture is unchanged. Detail and Texture leave the page and the Glossary.

### Images from the camera

Create shows two buttons in place of the drop zone on the phone shell (the desktop keeps its drop zone and
gains the same two buttons): Take photo, a file input with `accept="image/png,image/jpeg,image/webp"` and
`capture="environment"`, and From photos, the same input with `multiple` and no `capture`. A picked photo
is appended to the chosen images instead of replacing them, so a batch can hold several camera shots; the
existing list, Clear images, the 20 MiB per image and 200 MiB per batch limits and the server's
leading-byte check stay. A file of another type is refused on the page with
`Only PNG, JPEG or WebP photos can be used.` Keeping the explicit type list makes iPhone convert HEIC
photos to JPEG on upload.

### AR: View in your room

The Asset page and the Preview dialog set `ar`, `ar-modes="scene-viewer quick-look"` and
`ar-scale="auto"` on `<model-viewer>`, and render their own View in your room button in model-viewer's
`ar-button` slot, so the button shows only when model-viewer reports AR as possible
(`ar-status` and its `canActivateAR`); desktop browsers never show it. WebXR is left out so Android always
uses Scene Viewer, the native viewer the owner approved.

Scene Viewer downloads the model itself, in the Google app, without the browser's cookies. So the page
first asks `GET /api/assets/<id>/ar-link` (session required), which answers
`{"url": "/api/assets/<id>/model.glb?exp=<unix seconds>&sig=<base64url>"}` with `exp` 15 minutes ahead and
`sig` the HMAC-SHA256 of `ar:<id>:<exp>` keyed with the access token, and uses that URL as the viewer's
`src` on the phone shell and in the Preview dialog. `model.glb` with a valid, unexpired `exp` and `sig`
for that job ID is served without a session, with `cache-control: private, no-store`; an invalid or
expired signature answers 401 and counts toward the per-client failure limit as a wrong cookie does
(`app/server/http.ts:76-81`). Without `exp` and `sig` the route behaves as today. Rotating the token
invalidates every link. A link only reaches the tailnet, and anyone holding one can fetch that single GLB
until it expires.

On iPhone, model-viewer builds a USDZ in the page from the loaded GLB and opens Quick Look, so no
signed link is needed there; the signed URL is used anyway since the same component renders both.

### Notifications

The page has a Notifications switch on the Queue screen (and below the queue on the desktop), labelled
`Notify me when assets are ready`. Turning it on registers the service worker if needed, asks
`Notification.requestPermission()` from the tap, gets the server's public key from `GET /api/push/key`,
subscribes with `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and posts the
subscription to `POST /api/push/subscriptions`. Turning it off unsubscribes and calls
`DELETE /api/push/subscriptions` with the endpoint. The switch shows the browser's state on load. When
permission is denied it is disabled with `Notifications are blocked in the browser settings.` In Safari
on iPhone outside an installed app, where Web Push is unavailable, it is replaced by
`Add Asset Studio to your Home Screen to get notifications.` Every subscribed device gets every finished
job, whoever queued it.

The service worker is `/sw.js`, scope `/`, built from `app/web/sw.ts` as its own Vite entry with a fixed
file name. It has `push` and `notificationclick` handlers and no `fetch` handler. On `push` it shows a
notification with title `Asset Studio`, body `<name> is ready.` (the name cut to 80 characters), the app
icon, `tag` set to the batch ID and `renotify: true`, so a batch's notifications replace each other on the
device instead of piling up. On click it focuses an open Asset Studio window and navigates it to
`/?asset=<job id>`, or opens one.

Server side, `app/server/push.ts` owns everything:

- State is one JSON file, `<data dir>/push.json`, holding the VAPID key pair (P-256, created on first use)
  and the subscriptions: endpoint, `p256dh` and `auth` keys, creation time, the https origin the page was
  served from (used as the VAPID `sub` claim), and a fingerprint of the access token (the first 16 hex
  characters of HMAC-SHA256 of `push` keyed with the token). Writes go to a temporary file and are renamed
  into place, one at a time through a promise chain, so concurrent requests cannot interleave. A
  subscription is upserted by endpoint; at most 20 are kept, dropping the oldest. A corrupt or missing
  file starts empty with new keys, and the page re-subscribes when the key it subscribed with differs from
  `GET /api/push/key`.
- Routes, all behind the session or token: `GET /api/push/key` returns `{"publicKey": "<base64url>"}`;
  `POST /api/push/subscriptions` takes the browser's subscription JSON, checks the endpoint is `https`
  and the keys decode to 65 and 16 bytes, and answers 204; `DELETE /api/push/subscriptions` takes
  `{"endpoint": "..."}` and answers 204 whether or not it existed.
- Sending: right after the tracker marks a job `done` (`app/server/tracker.ts:398`), it calls
  `push.jobDone(job)` without awaiting it. For each subscription whose fingerprint matches the current
  token (others are deleted), it encrypts the payload `{"jobId", "batchId", "name"}` with RFC 8291
  (aes128gcm) and signs a VAPID JWT (RFC 8292, ES256, 12 hours) with WebCrypto, then POSTs it with
  `TTL: 3600` and `Urgency: normal`, a 10-second timeout, and no retry. A 404 or 410 deletes the
  subscription; any other failure is logged with the push service's host and status and dropped. No new
  dependency is added.
- Delivery is at most once: a crash between the `done` update and the send loses that notification, and
  the asset is still in the Library. A job collected after a restart goes through the same path, so it
  notifies. Seeded fixture jobs never pass through the tracker and never notify.
- The payload leaves win-main encrypted; the push service (Google's FCM for Chrome, Apple's for Safari)
  sees the endpoint, size and timing, not the name. The container needs outbound HTTPS to those hosts,
  which Docker Desktop allows by default.

### Manifest, icons and serving

`app/web/public/` holds `manifest.webmanifest` (`name` and `short_name` `Asset Studio`, `start_url` `/`,
`scope` `/`, `display` `standalone`, `background_color` and `theme_color` `#020814`, icons 192 and 512 and
a 512 maskable), the PNG icons (the `Box` glyph in `--vh-ink` on the midnight gradient, generated once
and committed), and `apple-touch-icon.png` (180 pixels). `index.html` links the manifest and the touch
icon and sets `apple-mobile-web-app-title`. The page registers `/sw.js` on load in a secure context.

`app/server/static.ts` serves `manifest.webmanifest` (`application/manifest+json`), `sw.js`
(`text/javascript`, `cache-control: no-cache`) and the icons by exact name, with every other path as
before. The executable embeds them like the rest of `dist/web`.

On iPhone, the installed app keeps its own cookie store separate from Safari, so the client signs in once
inside the installed app; the 30-day cookie then applies there.

### Upgrade, rollback and concurrency

There is no schema change, so a deploy runs no migration and `scripts/deploy/rollback.sh` to v0.2.0
restores no backup and keeps every job. v0.2.0 ignores `push.json`, the `?exp&sig` parameters and the new
routes (it answers 404 to them, and the page it serves registers no service worker). A service worker
already installed on a phone stays registered after a rollback and can still show a notification only if
the server sends one, which v0.2.0 never does. After rolling forward again, existing subscriptions keep
working because `push.json` and its keys persist in the data volume.

Two devices toggling notifications at once each upsert or delete their own endpoint through the serialized
writer. Two tracker ticks cannot mark the same job done, since `update` checks the expected state
(`app/server/tracker.ts:398`), so a job notifies once.

### Glossary

The page uses exactly these terms; the existing Glossary in `docs/internal/plans/asset-studio.md` keeps
its rows except Detail and Texture, which this feature removes.

| Term on the page | Meaning |
| --- | --- |
| Quality | The preset level: Fast, Standard, High or Ultra |
| Fast, Standard, High, Ultra | The four Quality levels in the table above |
| Custom | The Quality shown for an older job whose settings match no level |
| Create, Queue, Library | The three tabs of the phone layout |
| View in your room | The AR action on the Asset page and in the Preview dialog |
| Share GLB | The share action for one asset |
| Remix | Copies an asset's prompt and settings into Create |
| Take photo, From photos | The camera and photo-library buttons on Create |
| Notify me when assets are ready | The notifications switch |

### Testing and the Android emulator

The Playwright config gains three projects: `phone-chromium` (Chromium with the `Pixel 7` device
profile), `phone-webkit` (WebKit with `iPhone 15`) and `webkit-desktop` for the existing tagged journeys
(`@webkit`, as `@firefox` works today). `bun run bootstrap` and CI install WebKit
(`bunx playwright install --with-deps chromium firefox webkit` in CI). CI sets `E2E_REQUIRE_WEBKIT=1`;
without it, as on fedora-43 where WebKit's libraries may be missing, the WebKit projects skip with the
launch error as the reason instead of passing or failing, the same arrangement as `E2E_REQUIRE_WEBGL`.

The new journeys live in `app/e2e/phone.spec.ts`, against the image and the fake ComfyUI like the rest. The
layout spec adds the phone shell to its matrix (`app/e2e/layout.spec.ts:7`). The push sender is tested in
`app/server/push.test.ts` against a local fake push service that decrypts what it receives with the
subscriber's private key.

`scripts/phone/` holds the emulator tooling, run by the agent and never by CI:

- `setup-emulator.sh` installs, user-locally under `~/.local/share/android-sdk`, the command-line tools,
  platform tools, the emulator and one `google_apis_playstore` x86_64 system image (API 35), accepts the
  SDK licences, creates the AVD `asset-studio`, and installs Google Play Services for AR's emulator APK
  from the official `google-ar/arcore-android-sdk` release, checking its published checksum. It is
  idempotent and prints what it installed.
- `android-journey.ts` starts the AVD headless with KVM and drives Chrome on it through Playwright's
  Android support, with `adb` for what Playwright cannot reach (the camera app, the notification shade,
  `logcat`). It takes the base URL and the token from the environment and writes a transcript and
  screenshots to `.artifacts/phone/`.

Run 1 is against a local stack: `bun run dev` on fedora-43, made reachable as `http://localhost:8790`
inside the emulator with `adb reverse`, which keeps it a secure context, so the whole journey including a
finished job's notification runs on the fake. Run 2 is against the prerelease at
`https://win-main.tail6948f.ts.net`, reached over the host's Tailscale, with the token from
`%LOCALAPPDATA%\AssetStudio\config.yaml` read over the existing deploy connection and never printed.
Run 2 submits no generation to the deployed app, so the notification of a finished job is proven only in
run 1.

### Release and delivery

The only artifact is still the image `ghcr.io/vhco-pro/3d-assets-gen`, built and published by `ci.yml`
as today. The PR carries `release:preview`; each passing push gets a prerelease version. The prerelease of
the PR head is deployed to win-main with `scripts/deploy/deploy.sh <version>`, emulator run 2 runs against
it, and the owner does the iPhone check against it (install, allow notifications, open a model in AR)
when they have time. The merge does not wait for that check; a problem it finds becomes a follow-up fix
with its own issue. After merge, `v0.3.0` (a `feat` commit makes a minor
version) is deployed the same way and `/api/health` is checked as in AC-10 of the earlier feature.

## Acceptance Criteria

- [ ] AC-01: The built page serves a valid web app manifest, its icons and `/sw.js`, and Chromium reports
      no installability errors for it; on the Android emulator, Chrome installs Asset Studio from its menu
      and the home-screen icon opens it without browser chrome.
- [ ] AC-02: Below 1024 CSS pixels the page shows the bottom tab bar with Create, Queue and Library, shows
      one screen at a time with Create first, keeps the screen across reload and Back, and meets the layout
      rules (text at least 14 pixels, no clipped text, no horizontal overflow, the contrast rules, hit areas
      at least 44 by 44 pixels) at every phone and tablet size of the matrix in Chromium and WebKit; at 1024
      pixels and wider the two-column layout remains.
- [ ] AC-03: Tapping a Library tile opens the Asset page with the 3D model, name, Quality, generation time,
      seed and creation time and the actions View in your room (where AR is available), Share GLB, Download,
      Remix and Delete; Back returns to the Library; `?asset=<id>` opens that asset directly; and an unknown
      or unfinished asset shows `This asset is no longer available.` with a way back.
- [ ] AC-04: Create offers one Quality control with Fast, Standard (selected first), High and Ultra, a batch
      created with each level gets the triangles and texture of the Quality table, Detail and Texture appear
      nowhere on the page, and jobs show their Quality name, or `Custom (...)` when their settings match no
      level.
- [ ] AC-05: On Android, View in your room opens Scene Viewer with a link that serves the GLB without a
      session; that link answers 401 once expired, with a changed signature, for another job or after a token
      rotation; and on a browser without AR support the button is not shown.
- [ ] AC-06: With notifications turned on, a device receives a notification titled `Asset Studio` with
      `<name> is ready.` within a minute of a job finishing, also with the app closed; tapping it opens that
      asset's Asset page; after turning notifications off, or after a token rotation, that device receives
      none.
- [ ] AC-07: Take photo opens the camera and each photo taken is added to the chosen images; From photos
      adds several images; a batch made this way creates one image job per photo; and a file of another type
      is refused with `Only PNG, JPEG or WebP photos can be used.`
- [ ] AC-08: Share GLB opens the system share sheet with the GLB file where the browser can share files of
      that type, and otherwise downloads the GLB and says `Saved to your downloads.`
- [ ] AC-09: Deploying this version runs no migration, rolling back to v0.2.0 keeps every job, and rolling
      forward again keeps the existing notification subscriptions working.
- [ ] AC-10: The page uses the Glossary terms of this document for Quality, the tabs and the new actions.
- [ ] AC-11: The initial page load stays within 150 KiB of JavaScript after gzip at level 9.
- [ ] AC-12: The prerelease deployed on win-main passes the Android emulator journey run 2 against
      `https://win-main.tail6948f.ts.net`: install, sign in, the three tabs, an existing asset opened in Scene
      Viewer, and notifications turned on.

## Test Plan

| Criterion | Proof |
| --- | --- |
| AC-01 | `app/e2e/phone.spec.ts` "installable": fetches `/manifest.webmanifest`, each icon and `/sw.js` from the image with their content types, then opens a CDP session and asserts `Page.getInstallabilityErrors` returns an empty list. Emulator run 1 step "install": Chrome's menu item `Install app` or `Add to Home screen`, then the launcher icon opened through `adb shell monkey -p` of the installed WebAPK; pass when the Playwright page reports `matchMedia('(display-mode: standalone)').matches` true. |
| AC-02 | `app/e2e/phone.spec.ts` "tabs" in `phone-chromium` and `phone-webkit`: Create is shown first, each tab shows only its screen, the URL carries `?tab=`, reload and `page.goBack()` keep or restore the screen. `app/e2e/layout.spec.ts` runs its existing rules plus the 44-pixel hit-area rule over the phone shell at 320x568, 390x844, 390x667, 844x390 and 768x1024 in both engines, and asserts the two-column layout at 1024x768, 1280x720 and 1440x900. Captures of each screen at 390x844 and 844x390 are inspected and attached to the PR. |
| AC-03 | `app/e2e/phone.spec.ts` "asset page": tap a seeded done tile, assert the model loads (`data-loaded`), the facts and the actions; `page.goBack()` shows the Library; open `/?asset=<seeded id>` directly; open `/?asset=<random uuid>` and a seeded failed job's ID and assert the gone message and its button. Remix fills Create's prompt and Quality from the seeded asset. Delete on a job the test created returns to the Library without it. |
| AC-04 | `app/pipeline/presets.test.ts`: every Quality maps to the table's pair and passes `validPairing`; the label function returns each name and `Custom (5k, 2048)` and `Custom (10k)`. `app/e2e/phone.spec.ts` "quality": submit one prompt per level and read the created jobs from `GET /api/jobs`, asserting `faces` and `tex`; assert the page has no element with the text `Detail` or `Texture`; the seeded cancelled Ultra job shows `Quality: Ultra`. |
| AC-05 | `app/server/arlink.test.ts`: a link from `ar-link` fetches the GLB with no cookie (200, GLB bytes); the same link after the clock passes `exp`, with one changed character in `sig`, with another job's ID, and after the token changes answers 401; a bad signature counts toward the failure limit. `app/e2e/phone.spec.ts` asserts no View in your room button in desktop Chromium, Firefox and WebKit. Emulator run 1 step "AR": tap View in your room; pass when `logcat` shows an `android.intent.action.VIEW` for `arvr.google.com/scene-viewer` whose `file` is the signed URL and the dev server answers that URL with 200 to a request without a cookie. |
| AC-06 | `app/server/push.test.ts`: the RFC 8291 section 5 example encrypts to the published ciphertext; a VAPID JWT verifies with the public key; marking a job done POSTs one encrypted message to the fake push service that decrypts to `{"jobId","batchId","name"}`; a 410 deletes the subscription; a subscription with an old token fingerprint gets nothing and is deleted; concurrent subscribe and delete calls leave a valid file. `app/e2e/phone.spec.ts` "notifications switch": with permission granted and `pushManager.subscribe` answered by a stub, turning the switch on posts the subscription and off deletes it; denied permission shows the blocked message. Emulator run 1 step "notify": turn notifications on, submit one Fast prompt, press Home so Chrome is in the background, wait for the fake to finish it; pass when `adb shell dumpsys notification --noredact` lists `Asset Studio` with `<prompt> is ready.` within 60 seconds and tapping it through `adb shell cmd notification` opens `/?asset=<that job id>`. Then turn notifications off, submit another prompt and assert no new notification within 60 seconds after it finishes. |
| AC-07 | `app/e2e/phone.spec.ts` "photos": both inputs carry the stated `accept`, Take photo carries `capture="environment"`; two `setInputFiles` calls on Take photo leave two images chosen; a GIF is refused with the message; Generate creates two image jobs. Emulator run 1 step "camera": tap Take photo, press the emulator camera's shutter and confirm through `adb shell input`, then assert `1 image chosen` and that Generate creates one image job. |
| AC-08 | `app/e2e/phone.spec.ts` "share": with `navigator.canShare` stubbed to accept files, Share GLB calls `navigator.share` with one `File` named `<slug>-<short id>.glb` of type `model/gltf-binary`; with it stubbed to refuse, Share GLB starts a download of `/api/assets/<id>/model.glb` and shows `Saved to your downloads.` Emulator run 1 step "share": Chrome on Android refuses GLB files, so the download path runs; pass when the file appears in `/sdcard/Download` with the GLB's size. |
| AC-09 | `app/server/store.test.ts` asserts the migration list still has 2 entries. `app/server/push.test.ts` "reload": a server started on an existing `push.json` sends with the stored keys to the stored subscription. Written procedure after emulator run 2, run by the agent: record the `GET /api/jobs` count, the `schema-version` of both images (both 2) and the sha256 of `push.json` on win-main; run `scripts/deploy/rollback.sh` to v0.2.0 and assert the job count is unchanged; deploy the prerelease again and assert the job count and the `push.json` sha256 are unchanged and `GET /api/push/key` returns the same key as before. |
| AC-10 | `app/e2e/glossary.spec.ts`: asserts each new term appears with its element (Quality group label and its four items, the three tab labels, the four Asset actions, the two photo buttons, the switch label) and that `Detail` and `Texture` do not. |
| AC-11 | `bun run size` in `bun run verify`, unchanged budget. |
| AC-12 | Emulator run 2 against the deployed prerelease: install and open standalone as in AC-01; sign in with the deployed token; open each tab; open an existing done asset and pass the AC-05 Scene Viewer step against the deployed URL (`curl` from fedora-43 of the logged signed URL answers 200 without a cookie); turn notifications on and assert `POST /api/push/subscriptions` answered 204 in the transcript. Transcript and screenshots committed with the evidence. |

## Tasks

None yet; written once the document is planned.

## Open Questions

None.

## Review Log

| Date | Review | Kind | Commit | Model | Isolation | Outcome |
| --- | --- | --- | --- | --- | --- | --- |

## Sources

- [Chromium: Web Share permitted file extensions](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webshare/FILE_TYPES.md): Chrome shares only the listed types, which include images, PDF, audio, video and text but not `.glb`.
- [model-viewer issue 3101](https://github.com/google/model-viewer/issues/3101): Scene Viewer is a separate app and cannot use the browser's cookies or authentication to download the model.
- [Scene Viewer documentation](https://developers.google.com/ar/develop/scene-viewer): the `file` parameter is the URL of the glTF or GLB that Scene Viewer loads.
- [WebKit: Web Push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): Web Push on iPhone works from iOS 16.4 for web apps added to the Home Screen, with permission requested from a user gesture.
- [Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria): installing from Chrome's menu no longer needs a service worker with a `fetch` handler (Chrome 108 on mobile); the automatic install prompt still did.
- [Playwright Android API](https://playwright.dev/docs/api/class-android): experimental automation of Chrome for Android on a device or emulator through `adb`, with `launchBrowser()`.
- [Run AR apps in Android Emulator](https://developers.google.com/ar/develop/java/emulator): ARCore on the emulator needs an x86 or x86_64 image at API 27 or later and the emulator build of Google Play Services for AR installed with `adb install`.
- [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) and [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292): Web Push message encryption (with the worked example in section 5) and VAPID.
- [Owner-approved phone design](https://claude.ai/artifact/P7NTa7J8JBXeJkef8tayfc): the four screens, the Quality levels, View in your room, notifications, camera upload and Share GLB.

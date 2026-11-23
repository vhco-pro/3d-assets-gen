---
status: draft
status_description: "Revised for spec review R-1 with the owner's nine answers; waiting for a new spec review, then acceptance."
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

After the first spec review you also decided: the AR link is refreshed when View in your room is tapped
close to its expiry; the page re-saves its notification subscription on every load while the switch is
on; a `?asset=` link on a wide screen opens the Preview dialog; Remix of an older asset picks the level
with the same triangle count, otherwise Standard; the earlier Asset Studio document stays as history,
and this document takes over its Detail and Texture terms; and the emulator checks prove that Scene
Viewer itself loads the model on win-main, that notifications arrive with the app swiped away, that the
script cannot submit a job to win-main, and that a rollback keeps every recorded job.

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
reason and covers `app/`, so this feature's changes make its reviews stale. By the owner's decision it is
left unchanged as history: its met AC-18 and AC-29 name Detail and Texture, which this feature removes, and
from this feature on, this document's Quality design and Glossary replace those parts of it. No task here
edits that document. [vhco-pro/3d-assets-gen#9](https://github.com/vhco-pro/3d-assets-gen/issues/9) (a
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

In the two-column layout `?tab=` is ignored, and `?asset=<job id>` of a done asset opens the Preview
dialog for it; closing the dialog removes `?asset=` from the URL. An unknown or unfinished asset there
shows the same gone message in the page's notice area, with Dismiss. A layout change across 1024 pixels
keeps the open asset: the Asset page becomes the Preview dialog and the other way round, and the model
reloads in the new view.

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
For an asset whose pair matches no level, Remix selects the level with the same triangle count (5000 Fast,
10000 Standard, 20000 High) and otherwise Standard; `remixQuality` in `app/pipeline/presets.ts` holds the
rule.
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
and texture is unchanged. Detail and Texture leave the page; this document's Glossary is where the preset
terms are defined from now on.

### Images from the camera

Create shows two buttons in place of the drop zone on the phone shell (the desktop keeps its drop zone and
gains the same two buttons): Take photo, a file input with `accept="image/png,image/jpeg,image/webp"` and
`capture="environment"`, and From photos, the same input with `multiple` and no `capture`. A picked photo
is appended to the chosen images instead of replacing them, so a batch can hold several camera shots; the
existing list, Clear images, the 20 MiB per image and 200 MiB per batch limits and the server's
leading-byte check stay. A file of another type is refused on the page with
`Only PNG, JPEG or WebP photos can be used.` Keeping the explicit type list is expected to make iPhone
convert HEIC photos to JPEG on upload; this is unverified, and a HEIC file that still arrives is refused by
the page's type check with the message above and by the server's leading-byte check.

### AR: View in your room

The Asset page and the Preview dialog set `ar`, `ar-modes="scene-viewer quick-look"` and
`ar-scale="auto"` on `<model-viewer>`, and render their own View in your room button in model-viewer's
`ar-button` slot, so the button shows only when model-viewer reports AR as possible
(`ar-status` and its `canActivateAR`); desktop browsers never show it. WebXR is left out so Android always
uses Scene Viewer, the native viewer the owner approved.

Scene Viewer downloads the model itself, in the Google app, without the browser's cookies. So the page
first asks `GET /api/assets/<id>/ar-link` (session required), which answers
`{"url": "/api/assets/<id>/model.glb?exp=<unix seconds>&sig=<base64url>"}` (404 `No such asset.` for an
unknown job or one that is not `done`) with `exp` 15 minutes ahead and
`sig` the HMAC-SHA256 of `ar:<id>:<exp>` keyed with the access token, and uses that URL as the viewer's
`src` on the phone shell and in the Preview dialog. `model.glb` with a valid, unexpired `exp` and `sig`
for that job ID is served without a session, with `cache-control: private, no-store`, and logged as
one line holding the job ID, the client address and the `User-Agent`; an invalid or
expired signature answers 401 and counts toward the per-client failure limit as a wrong cookie does
(`app/server/http.ts:76-81`). Without `exp` and `sig` the route behaves as today.

When View in your room is tapped and the current link has less than 5 minutes left, the page first fetches
a new link, sets it as `src`, waits for the model's `load` event and only then activates AR, so Scene
Viewer never receives an expired link. The button shows `Preparing…` while that runs. This is the only
time the link changes, and it costs one more download of the model after a page has been open more than
10 minutes. Rotating the token
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
`DELETE /api/push/subscriptions` with the endpoint. On each signed-in load the switch shows the browser's state, and when the browser has a subscription
the page posts it again to `POST /api/push/subscriptions` (an idempotent upsert), so a subscription the
server dropped after a token rotation, a 404 or 410, or eviction comes back. When `pushManager.subscribe`
or that POST fails, the switch is off and shows `Notifications could not be turned on. Try again.` When
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
  and the subscriptions: endpoint, `p256dh` and `auth` keys, creation time, and a fingerprint of the access token (the first 16 hex
  characters of HMAC-SHA256 of `push` keyed with the token). Writes go to a temporary file and are renamed
  into place, one at a time through a promise chain, so concurrent requests cannot interleave. A
  subscription is upserted by endpoint; at most 20 are kept, dropping the oldest. A corrupt or missing
  file starts empty with new keys, and the page re-subscribes when the key it subscribed with differs from
  `GET /api/push/key`.
- Routes, all behind the session or token: `GET /api/push/key` returns `{"publicKey": "<base64url>"}`;
  `POST /api/push/subscriptions` takes the browser's subscription JSON, checks the endpoint is `https`
  and the keys decode to 65 and 16 bytes, and answers 204, or 422 with an error naming the invalid field
  (`endpoint`, `keys.p256dh` or `keys.auth`); `DELETE /api/push/subscriptions` takes
  `{"endpoint": "..."}` and answers 204 whether or not it existed.
- Sending: right after the tracker marks a job `done` (`app/server/tracker.ts:398`), it calls
  `push.jobDone(job)` without awaiting it. For each subscription whose fingerprint matches the current
  token (others are deleted), it encrypts the payload `{"jobId", "batchId", "name"}` with RFC 8291
  (aes128gcm) and signs a VAPID JWT (RFC 8292, ES256, 12 hours, `sub` the fixed `https://github.com/vhco-pro/3d-assets-gen`) with WebCrypto, then POSTs it with
  `TTL: 3600` and `Urgency: normal`, a 10-second timeout, and no retry. A 404 or 410 deletes the
  subscription; any other failure is logged with the push service's host and status and dropped. No new
  dependency is added.
- Delivery is at most once: a crash between the `done` update and the send loses that notification, and
  the asset is still in the Library. A job collected after a restart goes through the same path, so it
  notifies. Seeded fixture jobs never pass through the tracker and never notify.
- The payload leaves win-main encrypted; the push service (Google's FCM for Chrome, Apple's for Safari)
  sees the endpoint, size and timing, not the name. The container needs outbound HTTPS to those hosts.
  Docker Desktop is expected to allow that by default; this is unverified until a real job's notification
  arrives from win-main (the owner's iPhone check or first use), and a failed send shows in the log line
  above.

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

The page uses exactly these terms. `docs/internal/plans/asset-studio.md` stays unchanged as history; for
the page from this feature on, Quality and its levels replace that document's Detail and Texture rows, and
its other rows still hold.

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
  from the official `google-ar/arcore-android-sdk` release, checking its published checksum. Because a
  Play Store image is a user build, it turns on Chrome's `Enable command line on non-rooted devices` flag,
  which Playwright's Android support requires, by opening
  `chrome://flags/#enable-command-line-on-non-rooted-devices` and selecting `Enabled` with `uiautomator`
  and `input tap`, relaunches Chrome, and checks that `chrome://version` shows the command line Playwright
  wrote. It also checks Chrome is version 105 or newer. It is idempotent and prints what it installed and each check's result.
- `android-journey.ts` starts the AVD headless with KVM and drives Chrome on it through Playwright's
  Android support, with `adb` for what Playwright cannot reach (the camera app, the notification shade,
  `logcat`, `uiautomator dump` and `input tap` for the notification shade). It takes the base URL and
  the token from the environment and writes a transcript and screenshots to `.artifacts/phone/`. Each step
  is declared as submitting or not; a submitting step (notify, camera, share) refuses to run and fails the
  run unless the base URL's host is `localhost`, and `scripts/phone/journey.test.ts` checks that refusal
  for `https://win-main.tail6948f.ts.net`.

Run 1 is against a local stack: `bun run dev` on fedora-43, made reachable as `http://localhost:8790`
inside the emulator with `adb reverse`, which keeps it a secure context, so the whole journey including a
finished job's notification runs on the fake. Run 2 is against the prerelease at
`https://win-main.tail6948f.ts.net`, reached over the host's Tailscale, with the token from
`%LOCALAPPDATA%\AssetStudio\config.yaml` read over the existing deploy connection and never printed.
Run 2 submits no generation to the deployed app, so the notification of a finished job is proven only in
run 1. Scene Viewer's own fetch of the signed link is observed only in run 2: in run 1 the link is
cleartext `http://localhost`, which the Google app may refuse, so run 1 checks only the launch.

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
      one screen at a time with Create first, keeps the screen across reload and Back, keeps Generate
      reachable while the on-screen keyboard is open, and meets the layout rules (text at least 14 pixels,
      no clipped text, no horizontal overflow, the contrast rules, hit areas at least 44 by 44 pixels) at
      every matrix size below 1024 pixels in Chromium and WebKit; at 1024 pixels and wider the two-column
      layout remains.
- [ ] AC-03: Tapping a Library tile opens the Asset page with the 3D model, name, Quality, generation time,
      seed and creation time and the actions View in your room (where AR is available), Share GLB, Download,
      Remix and Delete; Back returns to the Library; `?asset=<id>` opens that asset directly, as the Asset
      page below 1024 pixels and as the Preview dialog at 1024 and wider, and the open asset survives a
      layout change across 1024 pixels; an unknown or unfinished asset shows
      `This asset is no longer available.` with a way back; and Remix fills Create from the asset, choosing
      for a Custom asset the level with its triangle count, otherwise Standard.
- [ ] AC-04: Create offers one Quality control with Fast, Standard (selected first), High and Ultra, a batch
      created with each level gets the triangles and texture of the Quality table, Detail and Texture appear
      nowhere on the page, and jobs show their Quality name, or `Custom (...)` when their settings match no
      level.
- [ ] AC-05: On Android, View in your room opens Scene Viewer showing the model, loaded through a link that
      needs no session, also when the page has been open longer than the first link's lifetime; that link
      answers 401 once expired, with a changed signature, for another job or after a token rotation; and on
      a browser without AR support the button is not shown.
- [ ] AC-06: With notifications turned on, a device receives a notification titled `Asset Studio` with
      `<name> is ready.` within a minute of a job finishing, also after the app was removed from the recent
      apps; tapping it opens that asset's Asset page; a subscription the server dropped is restored on the
      next signed-in load while the switch is on; and after turning notifications off, or after a token
      rotation without a new load, that device receives none.
- [ ] AC-07: Take photo opens the camera and each photo taken is added to the chosen images; From photos
      adds several images; a batch made this way creates one image job per photo; and a file of another type
      is refused with `Only PNG, JPEG or WebP photos can be used.`
- [ ] AC-08: Share GLB opens the system share sheet with the GLB file where the browser can share files of
      that type, and otherwise downloads the GLB and says `Saved to your downloads.`
- [ ] AC-09: Deploying this version runs no migration, rolling back to v0.2.0 keeps every job that existed
      before the rollback, and rolling forward again keeps the push key and the existing notification
      subscriptions.
- [ ] AC-10: The page uses the Glossary terms of this document for Quality, the tabs and the new actions.
- [ ] AC-11: The initial page load stays within 150 KiB of JavaScript after gzip at level 9.
- [ ] AC-12: The prerelease deployed on win-main passes the Android emulator journey run 2 against
      `https://win-main.tail6948f.ts.net`: install, sign in, the three tabs, an existing asset shown in Scene
      Viewer, and notifications turned on, without submitting any job.

## Test Plan

Project names: `chromium` and `firefox` are the existing desktop projects (`@firefox` tags opt a journey
into Firefox), `webkit-desktop` runs `@webkit` journeys, and `phone-chromium` (Pixel 7) and `phone-webkit`
(iPhone 15) run `app/e2e/phone.spec.ts`.

| Criterion | Proof |
| --- | --- |
| AC-01 | `app/e2e/phone.spec.ts` "installable" in `chromium`: fetches `/manifest.webmanifest`, each icon and `/sw.js` from the image with their content types, then opens a CDP session and asserts `Page.getInstallabilityErrors` returns an empty list. Emulator run 1 step "install": Chrome's menu item `Install app` or `Add to Home screen`, then the launcher icon opened through `adb shell monkey -p` of the installed WebAPK; pass when the Playwright page reports `matchMedia('(display-mode: standalone)').matches` true. |
| AC-02 | `app/e2e/phone.spec.ts` "tabs" in `phone-chromium` and `phone-webkit`: Create is shown first, each tab shows only its screen, the URL carries `?tab=`, reload and `page.goBack()` keep or restore the screen; "keyboard": with the Prompts field focused and the viewport reduced to 390x500 to stand in for the open keyboard, Generate can be scrolled into view and is not covered by the tab bar. `app/e2e/layout.spec.ts` runs its existing rules plus the 44-pixel hit-area rule over the phone shell at 320x568, 390x844, 390x667, 844x390, 768x1024 and 640x450 in `chromium` and `webkit-desktop`, and asserts the two-column layout at 1024x768, 1280x720 and 1440x900. 640x450 is also the 200 percent zoom reflow case for 1280x900; real zoom is checked in emulator run 1 step "zoom" (Chrome's accessibility text scaling at 200 percent, a screenshot of each tab, no clipped label or covered Generate). Emulator run 1 step "keyboard": with the Prompts field focused and the on-screen keyboard open, Generate is reachable by scrolling and tappable. The pull request carries before-and-after captures as `conventions/frontend-testing.md` defines them: each phone screen and the Asset page at 390x844 and 844x390, and the desktop composer at 1280x720 before (Detail and Texture) and after (Quality), committed to `refs/pr-visuals/<PR number>`. |
| AC-03 | `app/e2e/phone.spec.ts` "asset page" in `phone-chromium` and `phone-webkit`: tap a seeded done tile, assert the model loads (`data-loaded`), the facts and the actions; `page.goBack()` shows the Library; open `/?asset=<seeded id>` directly; open `/?asset=<random uuid>` and a seeded failed job's ID and assert the gone message and its button; with the Asset page open, resize from 768x1024 to 1024x768 and assert the Preview dialog shows the same asset, then back to the Asset page. "asset link desktop" in `chromium` and `webkit-desktop` at 1280x720: `/?asset=<seeded id>` opens the Preview dialog, closing it removes `?asset=`, an unknown ID shows the gone notice. "remix" in `phone-chromium`: Remix fills Create's prompt and Quality from a seeded asset. `app/pipeline/presets.test.ts`: `remixQuality` gives Fast for 5000 with 2048, Standard for 10000 with no texture, High for 20000 with 4096 and Standard for 15000 with 2048. "delete" in `phone-chromium`: Delete on a job the test created returns to the Library without it. |
| AC-04 | `app/pipeline/presets.test.ts`: every Quality maps to the table's pair and passes `validPairing`; the label function returns each name and `Custom (5k, 2048)` and `Custom (10k)`. `app/e2e/phone.spec.ts` "quality" in `phone-chromium` and `chromium`: submit one prompt per level and read the created jobs from `GET /api/jobs`, asserting `faces` and `tex`; assert the page has no element with the text `Detail` or `Texture`; the seeded cancelled Ultra job shows `Quality: Ultra`. |
| AC-05 | `app/server/arlink.test.ts`: a link from `ar-link` fetches the GLB with no cookie (200, GLB bytes) and logs one line with the job ID and user agent; the same link after the clock passes `exp`, with one changed character in `sig`, with another job's ID, and after the token changes answers 401; a bad signature counts toward the failure limit; `ar-link` for an unknown or failed job answers 404. `app/e2e/phone.spec.ts` asserts no View in your room button in `chromium`, `firefox` and `webkit-desktop`; "ar refresh" in `phone-chromium` with an Android user agent and model-viewer's `canActivateAR` forced true: with the page clock advanced past 10 minutes, tapping View in your room requests a new `ar-link` and sets it as `src` before `activateAR` is called, and with less than 10 minutes it requests none. Emulator run 1 step "AR launch": tap View in your room; pass when `logcat` shows an `android.intent.action.VIEW` for `arvr.google.com/scene-viewer` whose `file` is the signed URL. Emulator run 2 step "AR load": wait 16 minutes on the Asset page, tap View in your room; pass when the server log on win-main (read with `docker logs` over the deploy connection) has a signed-link line for that job, written after the tap, from the emulator's tailnet address with a user agent that is not Chrome's, and a screenshot shows Scene Viewer displaying the model. |
| AC-06 | `app/server/push.test.ts`: the RFC 8291 section 5 example encrypts to the published ciphertext; a VAPID JWT verifies with the public key and has `sub` `https://github.com/vhco-pro/3d-assets-gen`; marking a job done POSTs one encrypted message to the fake push service that decrypts to `{"jobId","batchId","name"}`; a 410 deletes the subscription; a subscription with an old token fingerprint gets nothing and is deleted; an invalid body answers 422 naming the field; concurrent subscribe and delete calls leave a valid file. `app/e2e/phone.spec.ts` "notifications switch" in `phone-chromium` and `chromium`: with permission granted and `pushManager.subscribe` answered by a stub, turning the switch on posts the subscription and off deletes it; denied permission shows the blocked message; a failing POST turns the switch off with its message; after the test deletes the subscription on the server, a reload posts it again. Emulator run 1 step "notify": turn notifications on, submit one Fast prompt, open the recent-apps screen with `adb shell input keyevent KEYCODE_APP_SWITCH` and swipe the Asset Studio task away with `adb shell input swipe` (never `am force-stop`), wait for the fake to finish it; pass when `adb shell dumpsys notification --noredact` lists `Asset Studio` with `<prompt> is ready.` within 60 seconds; then `adb shell cmd statusbar expand-notifications`, find the notification's bounds in `uiautomator dump` and tap it with `adb shell input tap`; pass when the app opens on `/?asset=<that job id>`. Then turn notifications off, submit another prompt and assert no new notification within 60 seconds after it finishes. |
| AC-07 | `app/e2e/phone.spec.ts` "photos" in `phone-chromium`, `phone-webkit` and, for the desktop buttons, `chromium` and `firefox` (`@firefox`): both inputs carry the stated `accept`, Take photo carries `capture="environment"`; two `setInputFiles` calls on Take photo leave two images chosen; a GIF is refused with the message; Generate creates two image jobs. Emulator run 1 step "camera": tap Take photo, press the emulator camera's shutter and confirm through `adb shell input`, then assert `1 image chosen` and that Generate creates one image job. |
| AC-08 | `app/e2e/phone.spec.ts` "share" in `phone-chromium`, `phone-webkit` and, for the Preview dialog, `chromium` and `firefox` (`@firefox`): with `navigator.canShare` stubbed to accept files, Share GLB calls `navigator.share` with one `File` named `<slug>-<short id>.glb` of type `model/gltf-binary`; with it stubbed to refuse or absent, Share GLB starts a download of `/api/assets/<id>/model.glb` (Playwright's `download` event with that file name) and shows `Saved to your downloads.` Emulator run 1 step "share": Chrome on Android refuses GLB files, so the download path runs; pass when the file appears in `/sdcard/Download` with the GLB's size. |
| AC-09 | `app/server/store.test.ts` asserts the migration list still has 2 entries. `app/server/push.test.ts` "reload": a server started on an existing `push.json` sends with the stored keys to the stored subscription. Written procedure after emulator run 2, run by the agent: record the set of job IDs from `GET /api/jobs`, the `schema-version` of both images (both 2), the `GET /api/push/key` public key and the subscription endpoints in `push.json` on win-main; run `scripts/deploy/rollback.sh` to v0.2.0 and assert every recorded job ID is still listed (new IDs are allowed); deploy the prerelease again and assert every recorded job ID is still listed, the public key is the same and every recorded endpoint is still in `push.json`. |
| AC-10 | `app/e2e/glossary.spec.ts` in `chromium` and `phone-chromium`: asserts each new term appears with its element (the Quality group label and its four items, the three tab labels, Share GLB, Download, Remix and Delete on the Asset page, the two photo buttons, the switch label) and that `Detail` and `Texture` do not; in `phone-chromium` with an Android user agent and `canActivateAR` forced true, the Asset page shows View in your room. |
| AC-11 | `bun run size` in `bun run verify`, unchanged budget. |
| AC-12 | Emulator run 2 against the deployed prerelease: install and open standalone as in AC-01; sign in with the deployed token; open each tab; pass the AC-05 run 2 step "AR load" on an existing done asset; turn notifications on and assert `POST /api/push/subscriptions` answered 204 in the transcript; the transcript shows each submitting step refused, as the script's guard requires. Transcript and screenshots committed with the evidence. |

## Tasks

None yet; written once the document is planned.

## Open Questions

None.

## Review Log

| Date | Review | Kind | Commit | Model | Isolation | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-23 | R-1 | spec | `8a89924` | claude-opus-5-5 | procedural | 1 blocking, 14 should-fix, 2 nits; all applied with the owner's nine answers; removed author extra: stored page origin as the VAPID `sub` claim, now a fixed URL (R-1 F-04) |

### R-1

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Test Plan, AC-06 row (emulator run 1 step "notify")
EVIDENCE: The row passes when "tapping it through `adb shell cmd notification` opens `/?asset=<that job id>`". AOSP NotificationShellCmd.java (frameworks/base main, fetched from android.googlesource.com) lists the subcommands allow_listener, disallow_listener, allow_assistant, remove_assistant, set_dnd, allow_dnd, disallow_dnd, reset_assistant_user_set, get_approved_assistant, post/notify, list, get, snooze, unsnooze, snoozed, set_bubbles, set_bubbles_channel and set_exempt_th_force_grouping. None of them taps or clicks a posted notification, so this step cannot be run as written.
PROPOSAL: Replace the tap with a command that exists, for example `adb shell cmd statusbar expand-notifications` and then a tap on the notification found through `uiautomator dump` and `adb shell input tap`. Keep the same pass condition: the page opens `/?asset=<that job id>`.

FINDING: F-02
KIND: judgement
SEVERITY: should-fix
WHERE: Design > AR: View in your room; Acceptance Criteria AC-05; Test Plan AC-05
EVIDENCE: The page fetches `ar-link` once and uses the signed URL as the viewer's `src`, with `exp` 15 minutes ahead. model-viewer builds the Scene Viewer intent from the current `src` at tap time (node_modules/@google/model-viewer/lib/features/ar.js, `new URL(firstSrc, location)` followed by `'&file=' + encodeURIComponent(modelUrl.toString())`). If the Asset page or Preview dialog stays open for more than 15 minutes, View in your room hands Scene Viewer an expired link and gets 401, and that 401 also counts toward the failure limit. The document does not say whether the link is refreshed before activation, on a timer, or never.
PROPOSAL: Say when a fresh link is fetched, for example right before activating AR when fewer than N minutes are left, and how that avoids reloading the visible model. Add a proof step that activates AR after the clock passes the first link's `exp`.

FINDING: F-03
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Notifications (switch paragraph; push.ts State bullet; Sending bullet); Design > Upgrade, rollback and concurrency; AC-06
EVIDENCE: "The switch shows the browser's state on load", and the page re-subscribes only "when the key it subscribed with differs from `GET /api/push/key`". The server can still drop a subscription while the browser keeps it: a token rotation (old fingerprints are deleted at send time), a 404 or 410, eviction past 20, or a failed `POST /api/push/subscriptions` after `pushManager.subscribe` succeeded. In each case the switch shows on and the device silently gets nothing. After a rotation the client signs in again and still sees the switch on.
PROPOSAL: Define how the page brings the server back in line, for example by re-posting its current subscription (an idempotent upsert) on each signed-in load while the switch is on, and say what the switch shows when that POST fails. Add a check that a subscription deleted on the server comes back after a reload.

FINDING: F-04
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Notifications (State bullet: "the https origin the page was served from (used as the VAPID `sub` claim)"); Design > Testing and the Android emulator (Run 1)
EVIDENCE: Run 1 serves the page as `http://localhost:8790`, which is not an https origin, and the whole notify step is proven only in run 1. In production the server sits behind `tailscale serve`, and the document does not say where the origin comes from (the request's Origin header, Host, or forwarded headers). One implementer may reject or skip a subscription whose origin is not https, which breaks run 1. Another may send `sub: http://localhost:8790`. RFC 8292 expects a mailto: or https: URI in `sub`.
PROPOSAL: State the source of the stored origin and the `sub` value for a non-https origin, for example a fixed `mailto:` or https contact URL from configuration, so run 1 and win-main both send a valid claim.

FINDING: F-05
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation; Design > Notifications (notificationclick navigates to `/?asset=<job id>`); AC-03; AC-06
EVIDENCE: The URL query (`?tab=`, `?asset=`) is defined only for the phone shell. A notification click on desktop Chrome, or on a tablet that is 1024 pixels or wider, opens `/?asset=<job id>` in the two-column layout, and the document does not say whether that opens the Preview dialog, is ignored, or shows the gone message. Rotating a 768x1024 tablet to 1024x768 while an Asset page is open crosses the breakpoint with `?asset=` in the URL, and that case is undefined too.
PROPOSAL: Define what `?asset=` and `?tab=` do in the two-column layout, for example by opening the Preview dialog for a done asset, and what happens on a layout change while one is open. Add a Test Plan step at 1280x720 that opens `/?asset=<seeded id>`.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (Remix sentence); Design > Quality
EVIDENCE: "Remix fills Create's prompt, Quality, Game-asset style and Shared style from the asset." Create offers only the four levels, but older jobs can have a pair that matches none (the document's own example is 5000 with 2048), and a job can have no texture (`tex: number | null`, app/server/jobs.ts:19, which the document shows as `Custom (<k>k)`). Which Quality Remix selects for those jobs is undefined. One implementer would pick Standard, another the nearest level, another would leave Quality unchanged.
PROPOSAL: State the rule for a Custom job, for example by selecting the level with the same triangle count and otherwise Standard, and add it to the AC-03 Remix check or to presets.test.ts.

FINDING: F-07
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-02; Acceptance Criteria AC-02; Design > Layout and navigation ("apply to the phone shell at every matrix size")
EVIDENCE: The project matrix is `[[320, 568], [390, 844], [390, 667], [844, 390], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [640, 450]]` (app/e2e/layout.spec.ts:7). 640x450, the 200 percent zoom reflow equivalent of 1280x900 that docs/internal/plans/asset-studio.md AC-09 covers, is below 1024, so it renders the phone shell with a top bar and a fixed bottom bar at 450 pixels high. The AC-02 row lists only the other phone sizes, so the proof can pass while AC-02 ("every phone and tablet size of the matrix") fails there. conventions/frontend-testing.md also asks for 200 percent zoom, an orientation change while a dialog or scene is open, actions that stay reachable with the on-screen keyboard (the Create form above a fixed tab bar), and a before and after image pair in the pull request. The row has only "captures ... attached to the PR".
PROPOSAL: Add 640x450 to the phone-shell list in the AC-02 row. Add steps for an orientation change with the Asset page open and for Generate staying reachable with the keyboard open. Ask for before and after captures as frontend-testing.md defines them.

FINDING: F-08
KIND: factual
SEVERITY: should-fix
WHERE: Design > Testing and the Android emulator (setup-emulator.sh and android-journey.ts bullets); Sources (Playwright Android API)
EVIDENCE: The Playwright Android page lists its requirements as: "Chrome 105 or newer installed on the device" and "'Enable command line on non-rooted devices' enabled in chrome://flags" (fetched from https://playwright.dev/docs/api/class-android). setup-emulator.sh installs a `google_apis_playstore` image, which is a non-rooted user build, and the document never mentions this flag or another way to let Playwright pass Chrome its command line. Without it, `launchBrowser()` cannot attach and no emulator step runs.
PROPOSAL: Make setup-emulator.sh (or android-journey.ts before launch) enable that flag, or use an equivalent such as `am set-debug-app --persistent com.android.chrome`, and say so in the bullet, with its check in the printed setup report.

FINDING: F-09
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan AC-09 (written procedure after emulator run 2); Context > Owner summary (prerelease deploys "replace the running v0.2.0 for the client while testing")
EVIDENCE: The procedure records "the `GET /api/jobs` count" and "the sha256 of `push.json`", then asserts that both are unchanged after a rollback and a redeploy on the live win-main that the client is using. If the client queues or deletes a job, or turns notifications on, during that window, a correct implementation fails. If one job is lost and another added, a wrong implementation passes, because the count stays the same.
PROPOSAL: Record the set of job IDs and check that every recorded ID is still present, and compare the VAPID public key and the recorded subscription endpoints rather than the file hash, or agree a quiet window with the owner and state it in the procedure.

FINDING: F-10
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Testing and the Android emulator (android-journey.ts bullet; Run 2 paragraph); AC-12; Test Plan AC-12
EVIDENCE: One script, android-journey.ts, "takes the base URL and the token from the environment". Run 1 includes steps that submit generations (notify, camera), and "Run 2 submits no generation to the deployed app" is an owner decision. The document does not say how the script leaves those steps out against win-main. The existing guard (app/docs/docs.test.ts:53-57, `submitsBatches`) only catches `/api/batches` near an HTTP client call. It does not catch a Playwright tap on Generate, so nothing in the repository would stop a real GPU job.
PROPOSAL: Define the mechanism, for example a step list per run where the submitting steps refuse to run unless the base URL is localhost, and add a check of that refusal.

FINDING: F-11
KIND: judgement
SEVERITY: should-fix
WHERE: Context > Background (Related work); Context > Owner summary; Design > Glossary (introductory sentence); Design > Quality (last sentence)
EVIDENCE: docs/internal/plans/asset-studio.md is `in-progress` on `branch: main` and covers `app/`. Its met AC-18 requires the page to label "the preset fields (Detail, Texture, ...)" and its met AC-29 requires "Detail offers Ultra ... and its chip reads `Ultra`". This feature removes Detail and Texture, so both criteria become false. This document also says that document's Glossary "keeps its rows except Detail and Texture, which this feature removes", which edits that document's Design section, a normative revision of an in-progress document. Background only says the earlier reviews go stale and that "does not block this feature". The Owner summary does not mention it.
PROPOSAL: Raise an Open Question on what happens to asset-studio.md (marked superseded in part, revised to point at this document, or left as it is with its Glossary unchanged) and add the answer to the Owner summary and to Tasks.

FINDING: F-12
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan AC-05 (emulator run 1 step "AR"); Test Plan AC-12
EVIDENCE: Run 1 passes when logcat shows the VIEW intent and "the dev server answers that URL with 200 to a request without a cookie". That request may come from any client, and run 2 uses "`curl` from fedora-43 of the logged signed URL". No step observes Scene Viewer itself fetching or showing the model, so the proofs pass even when Scene Viewer cannot load the link, for example a cleartext `http://localhost` URL in run 1 or the GLB served as `content-disposition: attachment` (app/server/assets.ts:25-27). Getting the model into the room is the problem the signed link exists to solve.
PROPOSAL: Pass only on a server log entry, made after the tap, of a cookieless GET for that signed URL from the emulator with a non-Chrome user agent, plus a screenshot of Scene Viewer showing the model, in both runs.

FINDING: F-13
KIND: judgement
SEVERITY: should-fix
WHERE: Acceptance Criteria AC-06; Test Plan AC-06
EVIDENCE: AC-06 requires the notification "also with the app closed". The emulator step only says "press Home so Chrome is in the background", which leaves the app open in the background. No step closes the installed app or removes its task before the job finishes, so the "closed" half of the criterion is never observed.
PROPOSAL: Before the fake finishes the job, remove the installed app's task from recents (not force-stop, which blocks delivery), and keep the 60-second notification assertion.

FINDING: F-14
KIND: factual
SEVERITY: should-fix
WHERE: Design > Notifications (Routes bullet); Design > AR: View in your room (`GET /api/assets/<id>/ar-link`)
EVIDENCE: `POST /api/push/subscriptions` "checks the endpoint is `https` and the keys decode to 65 and 16 bytes" but does not give the status or error for a failed check. conventions/http-api.md at the pin says a malformed value answers 422 and the error names the invalid field. The document also does not give the answer of `ar-link` for an unknown job or one that is not done.
PROPOSAL: State 422 with the field name for an invalid subscription body and 404 for `ar-link` on a job that is not done, and cover both in the unit tests.

FINDING: F-15
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-03, AC-04, AC-06, AC-07, AC-08; Design > Testing and the Android emulator
EVIDENCE: Only the AC-02 row names its Playwright projects. The rows for the photo inputs (file upload), Share GLB and Download (file transfer), the notifications switch (browser API) and Remix do not say whether they run in phone-chromium, phone-webkit, desktop Chromium or Firefox. The desktop layout gains the same photo buttons and the new Preview dialog actions. conventions/react.md asks for Chromium and Firefox for "storage, redirects, clipboard, file transfer, or reported engine-specific behavior", and conventions/frontend-testing.md asks to "name the journeys, themes and browser projects exercised at each size".
PROPOSAL: Name the projects for each phone.spec.ts journey in its row, including a Firefox run (tagged `@firefox`) for the desktop photo and download paths.

FINDING: F-16
KIND: judgement
SEVERITY: nit
WHERE: Test Plan AC-10; Design > Glossary
EVIDENCE: The AC-10 row asserts "the four Asset actions", while the Asset page has five actions (View in your room, Share GLB, Download, Remix, Delete) and the Glossary lists View in your room as a new term. No automated row asserts the View in your room label.
PROPOSAL: Name the actions the glossary test asserts, and cover View in your room where the button renders, for example in phone-chromium with its Android user agent.

FINDING: F-17
KIND: factual
SEVERITY: nit
WHERE: Design > Images from the camera; Design > Notifications (last bullet)
EVIDENCE: "Keeping the explicit type list makes iPhone convert HEIC photos to JPEG on upload" and "which Docker Desktop allows by default" are external claims with no citation and no Sources entry. The standard asks Context and Design to cite their claims.
PROPOSAL: Add a source for each claim to Sources, or mark it as unverified and give the check that will confirm it.

## Sources

- [Chromium: Web Share permitted file extensions](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webshare/FILE_TYPES.md): Chrome shares only the listed types, which include images, PDF, audio, video and text but not `.glb`.
- [model-viewer issue 3101](https://github.com/google/model-viewer/issues/3101): Scene Viewer is a separate app and cannot use the browser's cookies or authentication to download the model.
- [Scene Viewer documentation](https://developers.google.com/ar/develop/scene-viewer): the `file` parameter is the URL of the glTF or GLB that Scene Viewer loads.
- [WebKit: Web Push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): Web Push on iPhone works from iOS 16.4 for web apps added to the Home Screen, with permission requested from a user gesture.
- [Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria): installing from Chrome's menu no longer needs a service worker with a `fetch` handler (Chrome 108 on mobile); the automatic install prompt still did.
- [Playwright Android API](https://playwright.dev/docs/api/class-android): experimental automation of Chrome for Android on a device or emulator through `adb`, with `launchBrowser()`; it needs Chrome 105 or newer and Chrome's `Enable command line on non-rooted devices` flag.
- [Run AR apps in Android Emulator](https://developers.google.com/ar/develop/java/emulator): ARCore on the emulator needs an x86 or x86_64 image at API 27 or later and the emulator build of Google Play Services for AR installed with `adb install`.
- [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) and [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292): Web Push message encryption (with the worked example in section 5) and VAPID.
- [Owner-approved phone design](https://claude.ai/artifact/P7NTa7J8JBXeJkef8tayfc): the four screens, the Quality levels, View in your room, notifications, camera upload and Share GLB.

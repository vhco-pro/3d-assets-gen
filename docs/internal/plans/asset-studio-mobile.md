---
status: in-progress
status_description: "Being implemented on feat/asset-studio-mobile."
issue: https://github.com/vhco-pro/3d-assets-gen/issues/12
branch: feat/asset-studio-mobile
goal: "The client installs Asset Studio on an Android phone or iPhone, queues prompts or camera photos with one Quality choice, gets a notification when an asset is ready, and opens it in their room through AR or shares the GLB."
covers:
  - app/
  - package.json
  - bun.lock
  - vite.config.ts
  - playwright.config.ts
  - scripts/verify.sh
  - tsconfig.json
  - tsconfig.*.json
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

On a screen narrower than 1024 pixels the page shows a bottom tab bar (Create, Queue, Library) and opens an
Asset page from the Library, with the tab bar still shown. Wider screens keep today's two-column layout. A Quality control
with four levels (Fast, Standard, High, Ultra) replaces Detail and Texture. The Create screen gets Take
photo and From photos buttons for image batches. The Asset page has View in your room (Scene Viewer on
Android, Quick Look on iPhone), Share GLB, Download and Delete.

The page gets a web app manifest, icons and a small service worker, so Chrome and Safari can add it to
the home screen. The service worker only handles notifications; it caches nothing, so a deploy is visible
on the next load. When the client allows notifications, the server sends a Web Push message through
Google's or Apple's push service each time a job finishes, also with the app closed. The message holds
the asset name and its job and batch IDs, encrypted end to end, and win-main makes an outbound HTTPS call to that service.

Two server additions carry this: push subscriptions with a key pair kept in one file in the data volume,
and a short-lived signed link for the GLB, because Scene Viewer is a separate Android app that cannot send
the session cookie. There is no database migration, so a rollback to v0.2.0 keeps every job.

Planned proof: unit tests for the push encryption (against the RFC 8291 example) and the signed link;
Playwright journeys at phone sizes in Chromium and in WebKit, Safari's engine; and an agent-run procedure
on an Android emulator on fedora-43, first against a local stack and then against the prerelease on
win-main. You do one final check on your iPhone against the prerelease. None of this has run yet. Spec
review R-1 found 1 blocking and 14 should-fix findings, R-2 found 12 should-fix findings, R-3 found 2
blocking and 4 should-fix findings, R-4, R-5 and R-6 found 2 should-fix findings each, R-7 found 1,
R-8 found 5, R-9 found 1 blocking and 2 should-fix findings, R-10 found 1 should-fix finding, R-11 found 2,
R-12 to R-15 found 1 each, R-16 found 1 blocking and 1 should-fix finding, and R-17 and R-18 found 1 should-fix
finding each; all are folded in. R-19 at `145dc76` is clean, with one nit (a line citation) left as
the nit rule allows.

Your decisions, all as recommended: the Quality pairs above, on every layout; tabs below 1024 pixels;
Scene Viewer with a 15-minute signed link; Share GLB falls back to a download on Android; Web Push to
every device that turned it on; no offline cache and no Install button; Remix included; the emulator
check against win-main submits no real job; and the merge does not wait for your iPhone check, so an
iPhone-only problem it finds becomes a follow-up fix.

After the first spec review you also decided: the page re-saves its notification subscription on every load while the switch is
on; a `?asset=` link on a wide screen opens the Preview dialog; Remix of an older asset picks the level
with the same triangle count, otherwise Standard; the earlier Asset Studio document stays as history,
and this document takes over its Detail and Texture terms; and the emulator checks prove that Scene
Viewer itself loads the model on win-main, that notifications arrive with the app swiped away, that the
script cannot submit a job to win-main, and that a rollback keeps every recorded job.

After the second review you decided: the page refreshes the AR link quietly every 10 minutes while an
asset is open, so the tap opens Scene Viewer at once; Back from a tab leaves the app; the notifications
switch asks permission first, undoes a subscription the server did not save, and says when a browser
cannot show notifications; the service worker takes control of open pages so a notification tap reaches
the asset; the emulator install step falls back to tapping the icon; the current tab has an accent bar as
well as its colour; a missing WebKit fails a local `bun run verify` unless you skip it explicitly; and the
photo test proves From photos adds several files.

After the third review you decided to seed two more fixture assets (one High, one old-style 5k with 2048
textures) so the tests see Remix pick a level and a `Custom` label, and to keep the Preview dialog's
`Download GLB` label. After the fourth review you decided that the page builds the full, encoded
address it hands to Scene Viewer the way model-viewer does. After the eighth review you decided that the
Asset page keeps the tab bar and a `‹ Library` button, and that the desktop notifications switch is
always visible above the Library. After the ninth review you decided that a failed re-subscribe after a key
change shows the switch off with its error. After the eleventh review you chose to keep history simple:
leaving an Asset page by the Create or Queue tab or by Remix just switches tab, so Back from there visits
the Library once before leaving the app, and a desktop tile still opens the Preview dialog without
changing the URL. After the twelfth review you dropped carrying an open asset across a rotation past 1024
pixels: crossing that width closes the open asset view, and the address becomes `?tab=library` either way. After the fourteenth review you decided that on a
phone the changed-selection notice after a failed zip download opens on the Library tab, and after the
sixteenth review that the page reads the notice's marker once on load and cleans the address at once,
so Dismiss only hides the notice and Back never brings it back.

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
  time, and an Asset page opened from the Library that keeps the tab bar. Tabs and the open asset are in the URL, so
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
`env(safe-area-inset-bottom)`. The current tab has `aria-current="page"`, its icon and label in
`--vh-accent`, and a 3-pixel accent bar above the icon, so colour is never the only signal. The ComfyUI banners show above the screen content in both layouts.

The screen lives in the URL query: `?tab=create` (the default when absent), `?tab=queue`,
`?tab=library` and `?asset=<job id>`. Switching tabs uses `history.replaceState`; opening an asset uses
`history.pushState`, so the browser's Back (and Android's back gesture) returns from the Asset page to
the Library. Tab switches add no history entry, so Back from Create, Queue or Library leaves Asset Studio,
as it does in most phone apps, except once after leaving a tile-opened Asset page (see below) and once after a failed zip
download, whose redirect loads a new page after the Library it came from. A `popstate` listener re-reads the URL. Reloading keeps the screen. The `?export=gone` notice keeps working
in both layouts: below 1024 pixels a URL with `export=gone` and no `tab` opens the Library tab, where
Select and Download selected are, and the notice shows above the screen content like the ComfyUI
banners. The page reads `export=gone` once, on load, into component state as today
(`app/web/App.tsx:159`), and at once replaces the URL with `history.replaceState`: `?tab=library` below
1024 pixels, `/` at 1024 and wider. No URL the page writes carries `export` after that, and `popstate`
never shows the notice. Dismiss only hides the notice; it does not touch the URL or history. A reload
before Dismiss loses the notice. When the query names an asset that is not in the job list or not `done`, the Asset page
shows `This asset is no longer available.` with a button back to the Library. The server needs no route
change, since every path outside `/api/` returns the page (`app/server/static.ts:42-44`).

In the two-column layout `?tab=` is ignored. A Library tile opens the Preview dialog through component
state as today (`app/web/App.tsx:202-203`), without changing the URL or history. A `?asset=<job id>`
of a done asset (a link or a notification) opens the
Preview dialog for it; closing a dialog whose URL has `?asset=` applies the `‹ Library` rule below
(`history.back()` when the entry carries `{ from: "library" }`, otherwise `replaceState` without
`?asset=`). An unknown or unfinished asset there
shows the same gone message in the page's notice area, with Dismiss. A layout change across 1024 pixels
closes any open asset view: narrowing from an open Preview dialog shows the phone shell's Library tab
(the URL replaced with `?tab=library`), and widening from an open Asset page shows the two-column page
with no dialog (the URL replaced with `?tab=library`, so narrowing again shows the Library). Both use
`history.replaceState`, so neither adds a history entry.

Create holds the existing composer fields in this order: Prompts, Take photo and From photos, the chosen
images, Quality, Variants, Game-asset style, Seed, Shared style, and Generate. Queue holds the existing
queue component, with its summary strip, batch groups and job rows. When the queue is empty it shows
`Nothing in the queue.` instead of hiding (the desktop queue still hides). Library is a two-column grid of
thumbnail tiles (one column below 360 pixels) with the name under each, a Select button that turns the
tiles into checkboxes with Select all and Download selected, and the empty state. Tapping a tile outside
select mode opens its Asset page.

The Asset page keeps the bottom tab bar, with Library as the current tab, and its top bar has a
`‹ Library` button in place of the screen title. That button calls `history.back()` when the page was
opened from the Library in this session (the pushed entry carries `{ from: "library" }` in its history
state), and otherwise replaces the URL with `?tab=library`; tapping the Library tab does the same as the
button. So an asset opened from a notification or a link always has a way to the Library, also in the
installed iPhone app, which has no browser Back button. Delete returns to the Library through the same
rule, and so does the gone message's button. Leaving the Asset page by the Create or Queue tab or by
Remix replaces the URL with the target tab, like any tab switch; when the asset was opened from a
Library tile, the Library entry before it stays in history, so Back from that tab shows the Library once
and the next Back leaves Asset Studio. The Asset page shows `<model-viewer>` at the top (square, at most 60 percent of the viewport height), the
name, its Quality (see below), `Generated in`, Seed and Created, then the actions View in your room (when
AR is available), Share GLB, Download, Remix and Delete. Delete goes back to the Library after the job is
deleted. Remix fills Create's prompt, Quality, Game-asset style and Shared style from the asset (image
assets fill only Quality and Game-asset style, since the image is not re-uploaded) and switches to Create.
For an asset whose pair matches no level, Remix selects the level with the same triangle count (5000 Fast,
10000 Standard, 20000 High) and otherwise Standard; `remixQuality` in `app/pipeline/presets.ts` holds the
rule.
On the desktop layout the Preview dialog's buttons are, in this order: View in your room (when AR is
available), Share GLB, Remix, Delete, Download GLB and Close; `Download GLB` keeps its current label.

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
(`ar-status` and its `canActivateAR`); desktop browsers never show it. model-viewer also listens for
clicks on that slot's container and would call `activateAR()` itself with the cookie-protected `src`
(`lib/features/ar.js:76-79`, `199-200`), so the button's click listener is a native one, attached
with `addEventListener('click', ...)` on the button element through a React ref (not a React `onClick`
prop, which runs only after the click has bubbled past model-viewer's container), and it calls
`stopPropagation()` and `preventDefault()` first; each tap then starts exactly one AR launch, the page's own. WebXR is left out so Android always
uses Scene Viewer, the native viewer the owner approved.

Scene Viewer downloads the model itself, in the Google app, without the browser's cookies. So the page
first asks `GET /api/assets/<id>/ar-link` (session required), which answers
`{"url": "/api/assets/<id>/model.glb?exp=<unix seconds>&sig=<base64url>"}` (404 `No such asset.` for an
unknown job or one that is not `done`) with `exp` 15 minutes ahead and
`sig` the HMAC-SHA256 of `ar:<id>:<exp>` keyed with the access token. The viewer's `src` stays the
ordinary `/api/assets/<id>/model.glb`, loaded with the cookie as today. `model.glb` with a valid, unexpired `exp` and `sig`
for that job ID is served without a session, with `cache-control: private, no-store`, and logged as
one line holding the job ID, the client address and the `User-Agent`; an invalid or
expired signature answers 401 and counts toward the per-client failure limit as a wrong cookie does
(`app/server/http.ts:76-81`). Without `exp` and `sig` the route behaves as today.

On Android the page fetches a link when the Asset page or the Preview dialog opens and again every 10
minutes while it stays open and the document is visible (on `visibilitychange` back to visible it fetches
at once when the link has less than 5 minutes left). The request is a few bytes; the model is not
reloaded. Tapping View in your room then opens Scene Viewer synchronously in the tap handler, by setting
`location.href` to an intent URL built from the current link in the same format model-viewer 4.4.0 uses
(`intent://arvr.google.com/scene-viewer/1.2?mode=ar_preferred&disable_occlusion=true&file=<link>` with the
Google app package, where `<link>` is the `ar-link` path resolved against `location.origin` into an
absolute URL, `exp` and `sig` included, and encoded with `encodeURIComponent`, as model-viewer does
(`ar.js:258`, `289-290`), and a `browser_fallback_url` back to the page; `ar.js:271-291`), so the tap keeps its
user activation. When no valid link is held (its fetch failed), the button is disabled with
`AR is not available right now.` and the next timer tick tries again. Rotating the token
invalidates every link. A link only reaches the tailnet, and anyone holding one can fetch that single GLB
until it expires.

On iPhone the tap calls model-viewer's `activateAR()`, which builds a USDZ in the page from the loaded
GLB and opens Quick Look; the page fetches no signed link there. "Android" and "iPhone" here follow which
AR mode model-viewer can activate: `quick-look` on iOS and iPadOS, `scene-viewer` otherwise.

### Share GLB

When the Asset page or the Preview dialog opens and the browser has `navigator.share` and
`navigator.canShare`, the page first asks
`navigator.canShare({ files: [new File([], "<slug>-<short id>.glb", { type: "model/gltf-binary" })] })`
with an empty file. Only when that is true does it fetch the GLB from `/api/assets/<id>/model.glb` with the cookie into a
`File` named `<slug>-<short id>.glb` with type `model/gltf-binary` (the name the server's
`Content-Disposition` gives) and keeps it while the view is open. Share GLB is enabled once that file is
ready (`Preparing…` until then). Tapping it calls `navigator.canShare({ files: [file] })` and, when that is
true, `navigator.share({ files: [file], title: <name> })` synchronously in the tap handler, so the
gesture's activation still holds. A rejected share with `AbortError` (the user closed the sheet) shows
nothing; any other rejection shows `Sharing did not work. Use Download instead.` When the browser has no
`navigator.share`, or `canShare` is false (Chrome on Android, which does not share `.glb` files), Share GLB
starts the download of `/api/assets/<id>/model.glb` as Download does and shows
`Saved to your downloads.` On those browsers the page does not prefetch the file.

### Notifications

The page has a Notifications switch on the Queue screen, and on the desktop in its own row in the right
column above the Library, shown whether or not the queue is visible; it is labelled
`Notify me when assets are ready`. Turning it on first calls `Notification.requestPermission()` as the
tap handler's first statement, so the request keeps the gesture; then it waits for the service worker
registration made on page load, gets the server's public key from `GET /api/push/key`,
subscribes with `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and posts the
subscription to `POST /api/push/subscriptions`. Turning it off unsubscribes and calls
`DELETE /api/push/subscriptions` with the endpoint. On each signed-in load the page first checks that both `Notification` and `PushManager` exist on
`window`, before reading `Notification.permission` or anything else; when either is missing it shows the
Home Screen or unsupported message below and reads nothing more. Otherwise the switch shows the
browser's state. When the browser has a subscription, the page compares its
`options.applicationServerKey` with `GET /api/push/key`; on a mismatch (the server lost `push.json` and
made new keys) it unsubscribes, subscribes again with the server's key and posts the new subscription;
when that new `subscribe` fails after the old subscription was removed, the switch is off with
`Notifications could not be turned on. Try again.`
When the keys match, the page posts it again to `POST /api/push/subscriptions` (an idempotent upsert), so a subscription the
server dropped after a token rotation, a 404 or 410, or eviction comes back. When turning it on fails
(`pushManager.subscribe` or the POST), the page unsubscribes any subscription it just made, and the switch
is off with `Notifications could not be turned on. Try again.` When the re-post on load fails, the switch
stays on and shows `Could not reach Asset Studio; notifications may not arrive.`, and the next load tries
again. When permission is denied the switch is disabled with
`Notifications are blocked in the browser settings.` When `Notification` or `PushManager` is missing from `window`: on iOS
or iPadOS (the user agent names iPhone, iPad or iPod, or reports Macintosh with touch points) outside an
installed app (`display-mode: standalone` does not match), the switch is replaced by
`Add Asset Studio to your Home Screen to get notifications.`; on any other browser by
`This browser cannot show notifications.` Every subscribed device gets every finished
job, whoever queued it.

The service worker is `/sw.js`, scope `/`, built from `app/web/sw.ts` as its own Vite entry with a fixed
file name. It has `install`, `activate`, `push` and `notificationclick` handlers and no `fetch` handler; `install`
calls `skipWaiting()` and `activate` calls `clients.claim()`, so a page open when the worker first starts
is controlled without a reload. On `push` it shows a
notification with title `Asset Studio`, body `<name> is ready.` (the server has already cut the name), the app
icon, `tag` set to the batch ID and `renotify: true`, so a batch's notifications replace each other on the
device instead of piling up. On click, for an open Asset Studio window it calls
`focus()` and `navigate('/?asset=<job id>')` without waiting for `focus()` to succeed, and ignores a
`focus()` rejection; when there is no window, or `navigate()` rejects, it calls
`clients.openWindow('/?asset=<job id>')`.

Server side, `app/server/push.ts` owns everything:

- State is one JSON file, `<data dir>/push.json`, holding the VAPID key pair (P-256, created on first use)
  and the subscriptions: endpoint, `p256dh` and `auth` keys, creation time, and a fingerprint of the access token (the first 16 hex
  characters of HMAC-SHA256 of `push` keyed with the token). Writes go to a temporary file and are renamed
  into place, one at a time through a promise chain, so concurrent requests cannot interleave. A
  subscription is upserted by endpoint; at most 20 are kept, dropping the oldest. A corrupt or missing
  file starts empty with new keys, and the page re-subscribes on its next load when the key it subscribed
  with differs from `GET /api/push/key` (see the switch paragraph).
- Routes, all behind the session or token: `GET /api/push/key` returns `{"publicKey": "<base64url>"}`;
  `POST /api/push/subscriptions` takes the browser's subscription JSON, checks the endpoint is `https`
  and the keys decode to 65 and 16 bytes, and answers 204, or 422 with an error naming the invalid field
  (`endpoint`, `keys.p256dh` or `keys.auth`); `DELETE /api/push/subscriptions` takes
  `{"endpoint": "..."}` and answers 204 whether or not it existed.
- Sending: right after the tracker marks a job `done` (`app/server/tracker.ts:398`), and only when that
  `update` returns true (a row changed), it calls `push.jobDone(job)` without awaiting it. For each subscription whose fingerprint matches the current
  token (others are deleted), it encrypts the payload `{"jobId", "batchId", "name"}`, where `name` is the prompt, or the upload's
  file name for an image job, cut to its first 80 characters (code points) on the server, with RFC 8291
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
(`app/server/tracker.ts:398`) and `jobDone` runs only when it returns true, so a job notifies once.

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
(`@webkit`, as `@firefox` works today). Journeys are placed in projects by tags in their titles:
`phone-chromium` runs journeys tagged `@phone` or `@android` (`grep: /@phone|@android/`), `phone-webkit`
runs those tagged `@phone` or `@ios` (`grep: /@phone|@ios/`), `chromium` runs every journey without `@mobile-only`
(`grepInvert: /@mobile-only/`, alongside its existing `signin.spec.ts` ignore), `firefox` runs `@firefox`
and `webkit-desktop` runs `@webkit`. A journey that needs the phone shell carries `@mobile-only` as well,
so it never runs at the desktop size. Tags apply in every spec file, so the phone check in
`glossary.spec.ts` runs in `phone-chromium` through its `@android` tag. Each Test Plan row's project list
is the set of tags its journeys carry. `bun run bootstrap` and CI install WebKit
(`bunx playwright install --with-deps chromium firefox webkit` in CI). A WebKit
project that cannot launch fails the run, as `conventions/testing.md` requires. On a host where WebKit's
libraries are missing, such as fedora-43 may be, `E2E_SKIP_WEBKIT=1` leaves the WebKit projects out;
`scripts/verify.sh` then prints `WebKit journeys skipped (E2E_SKIP_WEBKIT=1)` as a warning line in its
report, and such a run is never cited as WebKit evidence. CI never sets it. The older
`E2E_REQUIRE_WEBGL` arrangement is unchanged.

The new journeys live in `app/e2e/phone.spec.ts`, against the image and the fake ComfyUI like the rest.
Playwright's default headless Chromium reports `Notification.permission` as `denied` even after
`grantPermissions`, so the switch journeys set the permission state by stubbing `Notification.permission`
and `Notification.requestPermission` in an init script, as they stub `pushManager.subscribe`. The
notification click path is proven on the emulator, where a real tap carries user activation. The seed
fixture gains two done assets with GLBs and thumbnails: one at High (20000 with 2048) and one with a pair
outside the levels (5000 with 2048); existing journeys that count Library assets or the summary strip
are updated for them. The
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

`scripts/verify.sh` runs `bun test ./scripts/phone` after the workflow tests (it needs no emulator), adds
`scripts/phone/*.sh` to its shellcheck list, and a `tsconfig.scripts.json` referenced from `tsconfig.json`
includes `scripts/phone/**/*.ts`, so the type check covers them.

The install step looks for a WebAPK with `adb shell pm list packages org.chromium.webapk` after Chrome's
install finishes. When one exists it is opened with `adb shell monkey -p <package> 1`; when Chrome made a
plain home-screen shortcut instead (no Google account is signed in), the script finds the `Asset Studio`
icon in `uiautomator dump` of the launcher and taps it with `input tap`. The transcript says which path
ran.

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
      one screen at a time with Create first, marks the current tab by more than colour, keeps the screen
      across reload, adds no history entry for a tab switch, keeps Generate
      reachable while the on-screen keyboard is open, and meets the layout rules (text at least 14 pixels,
      no clipped text, no horizontal overflow, the contrast rules, hit areas at least 44 by 44 pixels) at
      every matrix size below 1024 pixels in Chromium and WebKit; at 1024 pixels and wider the two-column
      layout remains.
- [ ] AC-03: Tapping a Library tile opens the Asset page with the 3D model, name, Quality, generation time,
      seed and creation time and the actions View in your room (where AR is available), Share GLB, Download,
      Remix and Delete, with the tab bar still shown; Back returns to the Library, and the `‹ Library`
      button reaches the Library from inside the app even when the asset was opened directly; `?asset=<id>` opens that asset directly, as the Asset
      page below 1024 pixels and as the Preview dialog at 1024 and wider; a layout change across 1024
      pixels closes the open asset view; an unknown or unfinished asset shows
      `This asset is no longer available.` with a way back; below 1024 pixels the changed-selection
      notice after a failed zip download opens on the Library tab, the address no longer carries its marker,
      and Dismiss hides it for good;
      and Remix fills Create from the asset, choosing
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
(iPhone 15) run journeys tagged `@phone`, and `phone-chromium` also `@android`, `phone-webkit` also `@ios`; `chromium` skips
journeys tagged `@mobile-only`. Design > Testing and the Android emulator gives the selection. A
journey listed only for phone projects carries `@mobile-only`; one listed for `phone-chromium` alone
carries `@android` instead of `@phone`, and one listed for `phone-webkit` alone carries `@ios` instead of
`@phone` (the AC-05 no-`ar-link` check and the AC-06 Home Screen check). A step that starts "from
`about:blank`" first calls `page.goto("about:blank")`, so a committed `about:blank` entry exists (Firefox
replaces a new page's initial entry on the first `goto`), then reads any `history.length` baseline and
opens the app.

| Criterion | Proof |
| --- | --- |
| AC-01 | `app/e2e/phone.spec.ts` "installable" in `chromium`: fetches `/manifest.webmanifest`, each icon and `/sw.js` from the image with their content types. The installability check launches Chromium itself (`channel: "chromium"`, not the headless shell) with `launchPersistentContext`, opens the page through `http://localhost:<port>` (a secure context) and asserts `Page.getInstallabilityErrors` returns an empty list; as a negative control the same call on `/api/health` (a page without the manifest) must return at least one error. Emulator run 1 step "install": Chrome's menu item `Install app` or `Add to Home screen`, then the app opened through its WebAPK with `monkey -p`, or by tapping its launcher icon when Chrome made a shortcut, as Design describes; pass when the Playwright page reports `matchMedia('(display-mode: standalone)').matches` true. |
| AC-02 | `app/e2e/phone.spec.ts` "tabs" in `phone-chromium` and `phone-webkit`: Create is shown first, each tab shows only its screen and only the current tab has `aria-current="page"` and the accent bar, the URL carries `?tab=`, reload keeps the screen, and after opening the page from `about:blank` and switching Create, Queue, Library, `page.goBack()` returns to `about:blank` (tab switches add no history); "keyboard": with the Prompts field focused and the viewport reduced to 390x500 to stand in for the open keyboard, Generate can be scrolled into view and is not covered by the tab bar. `app/e2e/layout.spec.ts` runs its existing rules plus the 44-pixel hit-area rule over the phone shell at 320x568, 390x844, 390x667, 844x390, 768x1024 and 640x450 in `chromium` and `webkit-desktop`, and asserts the two-column layout at 1024x768, 1280x720 and 1440x900. 640x450 is also the 200 percent zoom reflow case for 1280x900; real zoom is checked in emulator run 1 step "zoom" (Chrome's accessibility text scaling at 200 percent, a screenshot of each tab, no clipped label or covered Generate). Emulator run 1 step "keyboard": with the Prompts field focused and the on-screen keyboard open, Generate is reachable by scrolling and tappable. The pull request carries before-and-after captures as `conventions/frontend-testing.md` defines them, committed to `refs/pr-visuals/<PR number>`: before-and-after pairs at 1280x720 of the desktop composer (Detail and Texture, then Quality), the desktop queue with job rows (Detail and Texture chips, then Quality labels), the desktop library and the open Preview dialog (two buttons, then the new actions and `Quality:` line), and at 390x844 of the main view (stacked page, then the Create screen); after-only images of the Queue and Library screens, the Asset page at 390x844 and 844x390, the empty Queue text, the gone message, a `Custom (5k, 2048)` label, the Notifications switch above the desktop Library with a visible queue (shared stack) and without one (the empty-profile stack) and on the Queue screen, and its blocked, could-not-turn-on, could-not-reach, unsupported-browser and Home Screen messages, the refused-photo message, `Saved to your downloads.`, `Sharing did not work. Use Download instead.` and the disabled View in your room button with `AR is not available right now.` (from the "ar link" journey's failing route). The enabled View in your room button is left uncaptured in the browser projects because no headless browser offers AR; the emulator transcript's screenshots show it and Scene Viewer instead. |
| AC-03 | `app/e2e/phone.spec.ts` "asset page" in `phone-chromium` and `phone-webkit`: tap a seeded done tile, assert the model loads (`data-loaded`), the facts and the actions; `page.goBack()` shows the Library; the Asset page shows the tab bar with Library current; open `/?asset=<seeded id>` directly from `about:blank` and reach the Library with `‹ Library`, which stays inside the app (the URL becomes `?tab=library`, and `page.goBack()` afterwards returns to `about:blank`); from `about:blank` open the Library, open an asset from a tile, tap Queue, assert the Queue screen shows and the URL carries `?tab=queue`, then `page.goBack()` shows the Library and a second `page.goBack()` returns to `about:blank`; after Remix from a tile-opened asset, the Create screen shows with `?tab=create`; open `/?asset=<random uuid>` and a seeded failed job's ID and assert the gone message and its button; with the Asset page open, resize from 768x1024 to 1024x768 and assert no dialog is open and the URL is `?tab=library`, then resize back to 768x1024 and assert the Library tab shows; with a tile's Preview dialog open at 1024x768, resize to 768x1024 and assert the Library tab shows with `?tab=library`; `history.length` is the same before and after each resize. "asset link desktop" in `chromium`, `firefox` (`@firefox`) and `webkit-desktop` at 1280x720: `/?asset=<seeded id>` opens the Preview dialog, closing it removes `?asset=`; from `about:blank` open the page, open a tile's Preview dialog (the URL does not change), close it, and `page.goBack()` returns to `about:blank`; an unknown ID shows the gone notice; `/?export=gone` shows the changed-selection notice with the URL already `/`, and Dismiss hides it without changing the URL. "remix" in `phone-chromium`: Remix on the seeded High asset fills Create's prompt and selects High, and Remix on the seeded 5000 with 2048 asset selects Fast; that asset's Asset page and Library tile show `Custom (5k, 2048)`. `app/pipeline/presets.test.ts`: `remixQuality` gives Fast for 5000 with 2048, Standard for 10000 with no texture, High for 20000 with 4096 and Standard for 15000 with 2048. "export gone" in `phone-chromium` and `phone-webkit`: from `about:blank`, read `history.length`, open `/?export=gone`, assert the Library tab and the changed-selection notice, that the URL is already `?tab=library` and that `history.length` is exactly one more than on `about:blank`; open a tile (the URL has no `export`), dismiss on the Asset page, assert the Asset page still shows, then `page.goBack()` shows the Library without the notice; a reload then shows the Library tab without the notice. "delete" in `phone-chromium`: Delete on a job the test created returns to the Library without it. "reduced motion" in `phone-chromium` with `reducedMotion: "reduce"`: the Asset page's `<model-viewer>` has `interpolation-decay` `0`, and without it `200`. |
| AC-04 | `app/pipeline/presets.test.ts`: every Quality maps to the table's pair and passes `validPairing`; the label function returns each name and `Custom (5k, 2048)` and `Custom (10k)`. `app/e2e/phone.spec.ts` "quality" in `phone-chromium` and `chromium`: submit one prompt per level and read the created jobs from `GET /api/jobs`, asserting `faces` and `tex`; assert the page has no element with the text `Detail` or `Texture`; the seeded cancelled Ultra job shows `Quality: Ultra` in the queue, and in `chromium` the seeded 5000 with 2048 asset's Preview dialog shows `Custom (5k, 2048)`. |
| AC-05 | `app/server/arlink.test.ts`: a link from `ar-link` fetches the GLB with no cookie (200, GLB bytes) and logs one line with the job ID and user agent; the same link after the clock passes `exp`, with one changed character in `sig`, with another job's ID, and after the token changes answers 401; a bad signature counts toward the failure limit; `ar-link` for an unknown or failed job answers 404. `app/e2e/phone.spec.ts` asserts no View in your room button in `chromium`, `firefox` and `webkit-desktop`; "ar link" in `phone-chromium` with an Android user agent and model-viewer's `canActivateAR` forced true: opening the Asset page requests one `ar-link`; with the page clock advanced 10 minutes it requests another and the viewer's `src` stays `/api/assets/<id>/model.glb` with no reload; tapping View in your room makes exactly one request matching `^intent:` (captured with `page.waitForRequest`, then counted through the `request` event for two seconds), whose decoded `file` parameter equals the latest link resolved against the page's origin, `exp` and `sig` included (and no `sig` parameter appears outside `file`), with no other request between the tap and it; the button's listener is native, which the test checks by asserting the single intent request with model-viewer's own container listener active (no forced `canActivateAR` in this case, the Pixel 7 profile's Android user agent makes model-viewer choose `scene-viewer`); with the `ar-link` route failing, the button is disabled with `AR is not available right now.`; in `phone-webkit` with `canActivateAR` forced true, opening the Asset page requests no `ar-link`. Emulator run 1 step "AR launch": tap View in your room; pass when `logcat` shows an `android.intent.action.VIEW` for `arvr.google.com/scene-viewer` whose decoded `file` is the absolute signed URL. Emulator run 2 step "AR load": wait 16 minutes on the Asset page, tap View in your room; pass when the server log on win-main (read with `docker logs` over the deploy connection) has a signed-link line for that job, written after the tap, from fedora-43's tailnet address (or the address the server logs for it) with a user agent that is not Chrome's, and a screenshot shows Scene Viewer displaying the model. |
| AC-06 | `app/server/push.test.ts`: the RFC 8291 section 5 example encrypts to the published ciphertext; a VAPID JWT verifies with the public key and has `sub` `https://github.com/vhco-pro/3d-assets-gen`; marking a job done POSTs one encrypted message to the fake push service that decrypts to `{"jobId","batchId","name"}`; a 410 deletes the subscription; a subscription with an old token fingerprint gets nothing and is deleted; an invalid body answers 422 naming the field; a job with a 2000-character CJK prompt produces a payload whose plaintext is under 3993 bytes and decrypts to the first 80 characters; a second `done` update that changes no row sends nothing; concurrent subscribe and delete calls leave a valid file. `app/e2e/phone.spec.ts` "notifications switch" in `phone-chromium`, `chromium` and `firefox` (`@firefox`): with `Notification.permission` and `requestPermission` stubbed to `granted` and `pushManager.subscribe` answered by a stub, turning the switch on calls `requestPermission` before any other awaited call, posts the subscription, and off deletes it; with the permission stubbed to `denied`, the blocked message shows; a failing POST calls `unsubscribe` on the stub and turns the switch off with its message; after the test deletes the subscription on the server, a reload posts it again; after the stubbed subscription's `options.applicationServerKey` is changed to differ from the server's key, a reload calls `unsubscribe`, then `subscribe` with the server's key, then posts once; with that `subscribe` stub rejecting, the reload leaves the switch off with `Notifications could not be turned on. Try again.`; in `chromium` on its own stack started with `startStack(<name>, "empty")` (no jobs, so the queue is hidden), the switch is still shown above the Library; no job on the shared stack is cancelled for this; a failing re-post on load keeps the switch on with `Could not reach Asset Studio; notifications may not arrive.` In `phone-webkit` (iPhone user agent, not standalone) with both `Notification` and `PushManager` deleted from `window` by an init script before load, the Home Screen message shows and the page logs no error; in `phone-chromium` with `PushManager` deleted before load, `This browser cannot show notifications.` shows. In `chromium`, after the first registration the page has `navigator.serviceWorker.controller` set without a reload. Emulator run 1 step "notify": turn notifications on, submit one Fast prompt, open the recent-apps screen with `adb shell input keyevent KEYCODE_APP_SWITCH` and swipe the Asset Studio task away with `adb shell input swipe` (never `am force-stop`), wait for the fake to finish it; pass when `adb shell dumpsys notification --noredact` lists `Asset Studio` with `<prompt> is ready.` within 60 seconds; then `adb shell cmd statusbar expand-notifications`, find the notification's bounds in `uiautomator dump` and tap it with `adb shell input tap`; pass when the app opens on `/?asset=<that job id>`. Before that, with the app still open in the foreground, a first job's notification is tapped the same way and the open app moves to `/?asset=<that job id>` without a second app window (`dumpsys activity recents` lists one Asset Studio task). Then turn notifications off, submit another prompt and assert no new notification within 60 seconds after it finishes. |
| AC-07 | `app/e2e/phone.spec.ts` "photos" in `phone-chromium`, `phone-webkit` and, for the desktop buttons, `chromium` and `firefox` (`@firefox`): both inputs carry the stated `accept`, Take photo carries `capture="environment"` and no `multiple`, From photos carries `multiple` and no `capture`; two `setInputFiles` calls on Take photo leave two images chosen; one more Take photo file followed by one From photos pick of two files leaves three images chosen when started from none; a GIF is refused with the message; Generate creates two image jobs. Emulator run 1 step "camera": tap Take photo, press the emulator camera's shutter and confirm through `adb shell input`, then assert `1 image chosen` and that Generate creates one image job. |
| AC-08 | `app/e2e/phone.spec.ts` "share" in `phone-chromium`, `phone-webkit` and, for the Preview dialog, `chromium` and `firefox` (`@firefox`): with `navigator.share` and `navigator.canShare` stubbed to accept files, opening the view calls `canShare` with an empty `.glb` file and then fetches the GLB once, Share GLB is enabled after that, and tapping it calls `navigator.share` with one `File` named `<slug>-<short id>.glb` of type `model/gltf-binary` with no request between the tap and the call; a stub rejecting with `AbortError` shows nothing and one rejecting with `NotAllowedError` shows `Sharing did not work. Use Download instead.`; with it stubbed to refuse or absent, opening the view makes no `model.glb` request before the tap, and Share GLB starts a download of `/api/assets/<id>/model.glb` (Playwright's `download` event with that file name) and shows `Saved to your downloads.` Emulator run 1 step "share": Chrome on Android refuses GLB files, so the download path runs; pass when the file appears in `/sdcard/Download` with the GLB's size. |
| AC-09 | `app/server/store.test.ts` asserts the migration list still has 2 entries. `app/server/push.test.ts` "reload": a server started on an existing `push.json` sends with the stored keys to the stored subscription. Written procedure after emulator run 2, run by the agent: record the set of job IDs from `GET /api/jobs`, the `schema-version` of both images (both 2), the `GET /api/push/key` public key and the subscription endpoints in `push.json` on win-main; run `scripts/deploy/rollback.sh` to v0.2.0 and assert every recorded job ID is still listed (new IDs are allowed); deploy the prerelease again and assert every recorded job ID is still listed, the public key is the same and every recorded endpoint is still in `push.json`. |
| AC-10 | `app/e2e/glossary.spec.ts` in `chromium` and `phone-chromium`: asserts each new term appears with its element (the Quality group label and its four items, the three tab labels, Share GLB, Download, Remix and Delete on the Asset page, the two photo buttons, the switch label) and that `Detail` and `Texture` do not; in `phone-chromium` with an Android user agent and `canActivateAR` forced true, the Asset page shows View in your room. |
| AC-11 | `bun run size` in `bun run verify`, unchanged budget. |
| AC-12 | Emulator run 2 against the deployed prerelease: install and open standalone as in AC-01; sign in with the deployed token; open each tab; pass the AC-05 run 2 step "AR load" on an existing done asset; turn notifications on and assert `POST /api/push/subscriptions` answered 204 in the transcript; the transcript shows each submitting step refused, as the script's guard requires, and `scripts/phone/journey.test.ts` (run by `bun run verify`) asserts that every submitting step refuses `https://win-main.tail6948f.ts.net` and runs for `http://localhost:8790`. Transcript and screenshots committed with the evidence. |

## Tasks

- [x] T1 `app/pipeline/presets.test.ts` - failing tests: every Quality maps to its table pair and passes `validPairing`; the label function returns each name, `Custom (5k, 2048)` and `Custom (10k)`; `remixQuality` gives Fast for 5000 with 2048, Standard for 10000 with no texture, High for 20000 with 4096 and Standard for 15000 with 2048; they fail because the exports do not exist (AC-03, AC-04)
      Evidence: `bun test app/pipeline/presets.test.ts` fails as intended: `SyntaxError: Export named 'QUALITIES' not found in module app/pipeline/presets.ts` (0 pass, 1 fail, 1 error).

- [x] T2 `app/pipeline/presets.ts` - `QUALITIES`, the Quality label function and `remixQuality`; T1 passes (AC-03, AC-04)
      Evidence: `bun test app/pipeline/presets.test.ts` 5 pass 0 fail; `bun run typecheck`, `bun run lint` and the unit run (`bun test app` without e2e, image and memory) pass, 167 pass 0 fail.

- [x] T3 `app/server/arlink.test.ts`, `app/server/store.test.ts` - failing AC-05 server tests: a link from `ar-link` fetches the GLB with no cookie and logs one line with the job ID and user agent; the link answers 401 after `exp`, with one changed `sig` character, for another job and after a token change; a bad signature counts toward the failure limit; `ar-link` answers 404 for an unknown or failed job; plus the guard that the migration list still has 2 entries; the link tests fail because the route does not exist (AC-05, AC-09)
      Evidence: `bun test app/server/arlink.test.ts app/server/store.test.ts`: the four link tests fail as intended (`ar-link` answers 404 `Not found.` instead of 200, a bad signature is never limited), 10 pass including the 2-migration guard and the unchanged session rule for `model.glb`; the `log` server option does not type-check until T4.

- [x] T4 `app/server/arlink.ts`, `app/server/http.ts`, `app/server/export.ts` - `GET /api/assets/<id>/ar-link` and the signed `model.glb` served without a session, with `cache-control: private, no-store` and its log line, while an invalid or expired signature answers 401 through the failure limiter; T3 passes (AC-05)
      Evidence: `bun test app/server/arlink.test.ts` 5 pass 0 fail; typecheck, lint and the unit run pass (173 pass 0 fail). Both routes live in `app/server/http.ts` beside `app/server/arlink.ts`, because the signed GLB is answered before the session check; `app/server/export.ts` needed no change.

- [x] T5 `app/server/push.test.ts` - failing tests against a local fake push service that decrypts with the subscriber's key: the RFC 8291 section 5 example, the VAPID JWT and its `sub`, one encrypted message per job done, 410 deletion, old token fingerprints, 422 naming the field, the 2000-character CJK prompt, no send on an unchanged `done` update, concurrent subscribe and delete, and "reload" with an existing `push.json`; they fail because `push.ts` does not exist (AC-06, AC-09)
      Evidence: `bun test app/server/push.test.ts` fails as intended: `Cannot find module './push.ts'` (0 pass, 1 fail, 1 error). The fake push service is an injected `fetch` that records each POST, and each test subscriber decrypts with `node:crypto`, separately from the sender's WebCrypto code.

- [x] T6 `app/server/push.ts`, `app/server/tracker.ts`, `app/server/serve.ts`, `app/server/http.ts` - `push.json` with the serialized writer, the key and subscription routes, aes128gcm encryption and the ES256 VAPID JWT with WebCrypto, and `jobDone` called without awaiting when the tracker's `done` update changes a row; T5 passes and `bun test app/server` passes (AC-06, AC-09)
      Evidence: `bun test app/server/push.test.ts` 14 pass 0 fail, including the RFC 8291 section 5 example byte for byte and the test's own `node:crypto` decryption of every sent message; typecheck, lint and the unit run (`bun test app` without e2e, image and memory) pass, 187 pass 0 fail. `app/server/http.ts` needed no change: `serve.ts` routes `/api/push/*` through the existing authenticated extra-routes hook.

- [ ] T7 `playwright.config.ts`, `package.json`, `.github/workflows/ci.yml`, `scripts/verify.sh` - the `phone-chromium`, `phone-webkit` and `webkit-desktop` projects with the tag selection in Design, `@mobile-only` left out of `chromium`, WebKit in `bun run bootstrap` and CI, and `E2E_SKIP_WEBKIT=1` with its warning line in the verify report; `bunx playwright test --list` shows the projects and the existing journeys still pass (AC-02, AC-03, AC-05, AC-06, AC-07, AC-08)

- [ ] T8 `app/server/seed.ts`, `app/server/seed.test.ts`, `app/e2e/` - two more done fixture assets with GLBs and thumbnails, one at High (20000 with 2048) and one at 5000 with 2048, and the existing journeys that count Library assets or the summary strip updated for them; the seed test and those journeys pass (AC-03, AC-04)

- [ ] T9 `app/e2e/phone.spec.ts` - the failing "installable" journey (manifest, icons and `/sw.js` with their content types, `Page.getInstallabilityErrors` empty on the page and non-empty on `/api/health`) and the `navigator.serviceWorker.controller` check in `chromium`; they fail because nothing is served at those paths (AC-01, AC-06)

- [ ] T10 `app/web/public/`, `app/web/sw.ts`, `app/web/index.html`, `app/web/main.tsx`, `vite.config.ts`, `app/server/static.ts`, `tsconfig.web.json` - the manifest, the generated icons and touch icon, the worker built to `/sw.js` with its four handlers, registration on load in a secure context, and exact-name serving with the stated types; T9 passes and `bun run size` stays in budget (AC-01, AC-06, AC-11)

- [ ] T11 `app/e2e/phone.spec.ts` - the failing "tabs", "keyboard", "asset page", "asset link desktop", "export gone", "delete" and "reduced motion" journeys with the tags the Test Plan gives them; they fail against the current single-layout page (AC-02, AC-03)

- [ ] T12 `app/web/App.tsx`, `app/web/nav.ts`, `app/web/Shell.tsx`, `app/web/AssetPage.tsx`, `app/web/Viewer.tsx`, `app/web/styles.css` - the phone shell below 1024 pixels: top bar, tab bar with `aria-current` and the accent bar, the URL rules with `replaceState`, `pushState` and `popstate`, the `‹ Library` rule, the gone message, `export=gone` read once, the close-on-crossing rule, the Library grid with Select mode, the empty Queue text and the Asset page with its facts, Download and Delete; on the desktop, `?asset=` opens the Preview dialog; T11 passes (AC-02, AC-03)

- [ ] T13 `app/e2e/layout.spec.ts`, `app/web/styles.css` - the phone shell sizes and the 44-pixel hit-area rule in the matrix for `chromium` and `webkit-desktop`, and the two-column layout asserted at 1024x768, 1280x720 and 1440x900; any rule the shell misses fails first and passes after the style fix (AC-02)

- [ ] T14 `app/e2e/phone.spec.ts`, `app/e2e/glossary.spec.ts` - the failing "quality" and "remix" journeys and the glossary checks for the new terms with no `Detail` or `Texture`; they fail because the page still shows Detail and Texture (AC-03, AC-04, AC-10)

- [ ] T15 `app/web/App.tsx`, `app/web/AssetPage.tsx`, `app/web/Viewer.tsx`, `app/e2e/` - the Quality segmented group with the Ultra note, `Quality: <name>` or `Custom (...)` on job rows, the Asset page, the Preview dialog and the Library, and Remix filling Create; existing journeys that named Detail or Texture move to Quality; T14 passes (AC-03, AC-04, AC-10)

- [ ] T16 `app/e2e/phone.spec.ts` - the failing "photos" journey for both inputs' attributes, appended picks, the GIF refusal and two image jobs; it fails because the buttons do not exist (AC-07)

- [ ] T17 `app/web/App.tsx` - Take photo and From photos on Create (and beside the desktop drop zone), picks appended to the chosen images, and other types refused with `Only PNG, JPEG or WebP photos can be used.`; T16 passes (AC-07)

- [ ] T18 `app/e2e/phone.spec.ts`, `app/e2e/glossary.spec.ts` - the failing "ar link" journey (one `ar-link` per open and per 10 minutes, one `intent:` request whose `file` is the latest absolute link, the native listener, the disabled button), no View in your room in the desktop projects, no `ar-link` in `phone-webkit`, and the glossary's View in your room check; they fail because the page has no AR (AC-05, AC-10)

- [ ] T19 `app/web/ar.ts`, `app/web/AssetPage.tsx`, `app/web/Viewer.tsx`, `app/web/api.ts`, `app/web/model-viewer.d.ts` - `ar`, `ar-modes` and `ar-scale` on `<model-viewer>`, the slot button with its native click listener, the link refresh every 10 minutes and on return to visible, the intent URL built as model-viewer 4.4.0 builds it, and `activateAR()` for Quick Look; T18 passes (AC-05, AC-10)

- [ ] T20 `app/e2e/phone.spec.ts` - the failing "share" journey for the prefetch after `canShare`, the synchronous `navigator.share`, the `AbortError` and `NotAllowedError` cases and the download fallback; it fails because Share GLB does not exist (AC-08)

- [ ] T21 `app/web/share.ts`, `app/web/AssetPage.tsx`, `app/web/Viewer.tsx` - Share GLB with the empty-file `canShare` probe, the prefetched `File`, `Preparing…`, the share call in the tap handler and the download fallback with `Saved to your downloads.`; T20 passes (AC-08)

- [ ] T22 `app/e2e/phone.spec.ts` - the failing "notifications switch" journeys: permission first, post and delete, blocked, the failed POST, the re-post on load, the key mismatch and its failure, the empty-stack desktop row, the could-not-reach message, the Home Screen and unsupported messages; they fail because the switch does not exist (AC-06)

- [ ] T23 `app/web/notify.ts`, `app/web/App.tsx`, `app/web/Shell.tsx`, `app/web/api.ts` - the `Notify me when assets are ready` switch on the Queue screen and above the desktop Library, with the load-time checks, the re-post and re-subscribe rules and each message in Design; T22 passes (AC-06)

- [ ] T24 `scripts/phone/journey.test.ts` - failing test that every submitting step refuses `https://win-main.tail6948f.ts.net` and runs for `http://localhost:8790`; it fails because the journey module does not exist (AC-12)

- [ ] T25 `scripts/phone/android-journey.ts`, `tsconfig.scripts.json`, `tsconfig.json`, `scripts/verify.sh` - the emulator journey with run 1 and run 2 steps, each declared submitting or not, the host guard, the install fallback and the transcript and screenshots in `.artifacts/phone/`; verify runs `bun test ./scripts/phone` and shellchecks `scripts/phone/*.sh`; T24 passes and `bun run typecheck` covers the scripts (AC-12, AC-01, AC-05, AC-06, AC-07, AC-08)

- [ ] T26 `scripts/phone/setup-emulator.sh` - user-local SDK under `~/.local/share/android-sdk`, the API 35 Play Store image, the `asset-studio` AVD, the ARCore emulator APK with its checksum checked, Chrome's command-line flag and the Chrome 105 check; a run on fedora-43 prints every check as passed, a second run changes nothing, and shellcheck passes (AC-01, AC-05, AC-12)

- [ ] T27 `README.md`, `AGENTS.md` - installing on Android and iPhone through the browser menu, signing in once inside the installed iPhone app, the notifications switch, and the `scripts/phone/` commands; both files name them (Design)

- [ ] T28 `docs/internal/plans/asset-studio-mobile.md`, `docs/internal/evidence/asset-studio-mobile/run-1/` - emulator run 1 against `bun run dev` through `adb reverse` (install, zoom, keyboard, AR launch, notify, camera, share), with the transcript and screenshots committed and cited under each criterion (AC-01, AC-02, AC-05, AC-06, AC-07, AC-08)

- [ ] T29 `refs/pr-visuals/<PR number>`, `docs/internal/plans/asset-studio-mobile.md` - once the PR exists, the before-and-after and after-only captures the AC-02 row lists, committed to that ref and linked from the PR; the PR body shows them (AC-02)

- [ ] T30 `docs/internal/plans/asset-studio-mobile.md`, `docs/internal/evidence/asset-studio-mobile/run-2/` - the PR head's prerelease deployed with `scripts/deploy/deploy.sh <version>`, then emulator run 2 against `https://win-main.tail6948f.ts.net` including the 16-minute AR load and the refused submitting steps; transcript, screenshots and the signed-link log line recorded (AC-12, AC-05, AC-01)

- [ ] T31 `docs/internal/plans/asset-studio-mobile.md` - the AC-09 procedure on win-main after run 2: job IDs, both schema versions, the push key and endpoints recorded; rollback to v0.2.0 keeps every job; the prerelease deployed again keeps the jobs, the key and the endpoints; the values recorded under AC-09 (AC-09)

- [ ] T32 `docs/internal/plans/asset-studio-mobile.md` - after the merge, v0.3.0 deployed with `scripts/deploy/deploy.sh` and `/api/health` checked as in the earlier feature's AC-10; the result recorded (Design)

## Open Questions

None.

## Review Log

| Date | Review | Kind | Commit | Model | Isolation | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-23 | R-1 | spec | `8a89924` | claude-opus-5-5 | procedural | 1 blocking, 14 should-fix, 2 nits; all applied with the owner's nine answers; removed author extra: stored page origin as the VAPID `sub` claim, now a fixed URL (R-1 F-04) |
| 2026-11-23 | R-2 | spec | `9527e14` | claude-opus-5-5 | procedural | 0 blocking, 12 should-fix, 2 nits; all applied with the owner's eight answers; F-01 replaced the R-1 refresh-on-tap with a background link refresh |
| 2026-11-23 | R-3 | spec | `5bce6c5` | claude-opus-5-5 | procedural | 2 blocking, 4 should-fix; all applied with the owner's two answers; removed author extra: the Chromium `notificationclick` journey, the emulator foreground tap proves that path (R-3 F-02) |
| 2026-11-23 | R-4 | spec | `3d878f2` | claude-opus-5-5 | procedural | 0 blocking, 2 should-fix, 1 nit |
| 2026-11-23 | R-5 | spec | `52d44c8` | claude-opus-5-5 | procedural | 0 blocking, 2 should-fix |
| 2026-11-23 | R-6 | spec | `61367c4` | claude-opus-5-5 | procedural | 0 blocking, 2 should-fix, 1 nit; all applied |
| 2026-11-23 | R-7 | spec | `490eb4c` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix, 1 nit; all applied |
| 2026-11-23 | R-8 | spec | `8ce3ce4` | claude-opus-5-5 | procedural | 0 blocking, 5 should-fix, 1 nit; all applied with the owner's two answers |
| 2026-11-23 | R-9 | spec | `5abb796` | claude-opus-5-5 | procedural | 1 blocking, 2 should-fix; all applied with the owner's two answers; F-01 replaced the R-8 shared-stack cancel step |
| 2026-11-23 | R-10 | spec | `fed6bf1` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix, 1 nit; all applied with the owner's answer; F-01 revisited the R-9 history rule |
| 2026-11-23 | R-11 | spec | `09015b5` | claude-opus-5-5 | procedural | 0 blocking, 2 should-fix; met by removing the pending-history rule (R-10) and keeping desktop tiles state-only, as the owner chose |
| 2026-11-23 | R-12 | spec | `da24564` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix, 2 nits; F-01 met by removing asset carry-over across 1024 pixels, as the owner chose; nits applied |
| 2026-11-23 | R-13 | spec | `1e6b63b` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix; applied with the owner's answer |
| 2026-11-23 | R-14 | spec | `600a13d` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix; applied with the owner's answer |
| 2026-11-23 | R-15 | spec | `33ad841` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix, 1 nit; applied with the owner's answer, nit applied |
| 2026-11-23 | R-16 | spec | `083ecbb` | claude-opus-5-5 | procedural | 1 blocking, 1 should-fix; met by removing the URL marker rules of R-14 and R-15, as the owner chose |
| 2026-11-23 | R-17 | spec | `e770962` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix, 2 nits; all applied |
| 2026-11-23 | R-18 | spec | `5ce2f43` | claude-opus-5-5 | procedural | 0 blocking, 1 should-fix; applied |
| 2026-11-23 | R-19 | spec | `145dc76` | claude-opus-5-5 | procedural | clean: 1 nit, left unapplied under the nit rule |
| 2026-11-23 | R-19 | spec | `145dc76` | n/a | n/a | accepted by owner |

### R-19

FINDING: F-01
KIND: factual
SEVERITY: nit
WHERE: Design > Layout and navigation (two-column paragraph: "A Library tile opens the Preview dialog through component state as today (`app/web/App.tsx:202-203`), without changing the URL or history")
EVIDENCE: At 145dc76, which has the same `app/` as the measured `efac26a` (`git diff --stat efac26a 145dc76 -- app` prints nothing), the tile's state-only handler `onPreview={(job, opener) => { setPreview({ job, opener }); }}` is at app/web/App.tsx:200. Line 202 is `</main>` and line 203 is the `Viewer` render with `onClose={() => { setPreview(null); }}`. So the citation is off by two for the tile handler. The behaviour the sentence describes is correct, and an implementer builds the same thing either way. This citation was not changed by the R-18 revision (`git diff 5ce2f43 145dc76` touches only the Test Plan intro, the Owner summary count, status_description and the Review Log). I checked the R-18 change itself, the "from `about:blank`" rule in the Test Plan intro: it covers every step that uses that phrase (AC-02 "tabs", AC-03 "asset page", "asset link desktop" and "export gone"), and its "exactly one more" and `page.goBack()` assertions stay correct whether or not an engine keeps the explicit `about:blank` as a separate entry. I found nothing wrong with it. `vh-adlc lint` passes, and `vh-adlc next` answers `spec review` (stale: baseline-changed), as expected before this pass is recorded. A scratch Playwright run to repeat R-18's Firefox observation was refused by the session sandbox, so I did not observe it again.
PROPOSAL: Cite `app/web/App.tsx:200` for the tile handler and `app/web/App.tsx:203` for the dialog's close, or `app/web/App.tsx:200-203` for both.

### R-18

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-03 ("asset link desktop" in `chromium`, `firefox` (`@firefox`) and `webkit-desktop`: "from `about:blank` open the page, open a tile's Preview dialog (the URL does not change), close it, and `page.goBack()` returns to `about:blank`"; "export gone" in `phone-chromium` and `phone-webkit`: "from `about:blank`, read `history.length`, open `/?export=gone` ... and that `history.length` is exactly one more than on `about:blank`"; "asset page": "open `/?asset=<seeded id>` directly from `about:blank` ... `page.goBack()` afterwards returns to `about:blank`" and "from `about:blank` open the Library ... a second `page.goBack()` returns to `about:blank`"); Test Plan AC-02 ("tabs": "after opening the page from `about:blank` and switching Create, Queue, Library, `page.goBack()` returns to `about:blank`")
EVIDENCE: The rows never say how a step gets to `about:blank`. A new Playwright page already sits on its initial `about:blank`, so the obvious way to write "from `about:blank`" is to call `page.goto(url)` on a fresh page. I ran Playwright 1.65.1 from the main checkout's node_modules against a local server whose page calls `history.replaceState`. On a fresh page in Firefox, `page.goto` replaced the initial `about:blank` entry: `history.length` was 1 before and 1 after, and `page.goBack()` left the page where it was (`fresh page goBack url http://localhost:.../`). With an explicit `page.goto('about:blank')` first, Firefox gave 1 then 2, and `page.goBack()` returned to `about:blank`. Chromium gave 1 then 2 and returned to `about:blank` both ways. WebKit is not installed on this host, so I did not observe it there. Written the obvious way, the "asset link desktop" step fails a correct build in `firefox`, and the "export gone", "tabs" and "asset page" steps depend on how WebKit treats the initial entry, which nobody has checked. The "export gone" baseline came in with the R-17 revision (`git diff 479237b 5ce2f43`). The Firefox `goBack` step dates from the R-11 revision.
PROPOSAL: In the Test Plan's project-names paragraph (or in each step), state that "from `about:blank`" means the step first calls `page.goto("about:blank")` so that a committed `about:blank` entry exists, then reads any `history.length` baseline and opens the app.

### R-17

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-03 ("export gone" in `phone-chromium` and `phone-webkit`: "open `/?export=gone`, assert the Library tab and the changed-selection notice and that the URL is already `?tab=library` with `history.length` unchanged"); Design > Layout and navigation (URL paragraph: "at once replaces the URL with `history.replaceState`: `?tab=library` below 1024 pixels"); Acceptance Criteria AC-03 ("the address no longer carries its marker")
EVIDENCE: This step came in with the R-16 revision (git diff 083ecbb e770962, docs/internal/plans/asset-studio-mobile.md:623). The page rewrites the URL during load, before `page.goto` resolves, so the test cannot read `history.length` between the load and the rewrite. The step does not say what "unchanged" is measured against. A test that reads `history.length` after `page.goto` and again later in the step passes a build that uses `history.pushState` for the rewrite, because the extra entry already exists at the first read. That build leaves `/?export=gone` in history, which is the thing Design rules out. Other steps in the same row give a baseline: "from `about:blank`", and "`history.length` is the same before and after each resize".
PROPOSAL: Start the step from `about:blank`, read `history.length` there, open `/?export=gone` and assert `history.length` is exactly one more. Or assert that `page.goBack()` returns to `about:blank`, as the "tabs" step does.

FINDING: F-02
KIND: factual
SEVERITY: nit
WHERE: Design > Layout and navigation (URL paragraph: "Tab switches add no history entry, so Back from Create, Queue or Library leaves Asset Studio, as it does in most phone apps, except once after leaving a tile-opened Asset page (see below)"; "The page reads `export=gone` once, on load ... and at once replaces the URL with `history.replaceState`: `?tab=library` below 1024 pixels")
EVIDENCE: Download selected navigates with `window.location.assign(url)` (app/web/App.tsx:575). When the selection changed, the server answers that URL with 302 to `/?export=gone` (app/server/export.ts:212). That is a full navigation that adds a new history entry and a new document after the Library document it came from. The rewrite to `?tab=library` replaces only the new entry, so Back from the Library tab after an export-gone redirect shows the earlier Library document once before leaving Asset Studio. That is a second exception the Back sentence does not name. No proof reaches this path, because the "export gone" step opens `/?export=gone` directly, and nothing a careful implementer builds changes.
PROPOSAL: Name this case next to the tile-opened Asset page exception, for example "and once after a failed zip download".

FINDING: F-03
KIND: judgement
SEVERITY: nit
WHERE: Design > Layout and navigation (URL paragraph: "`/` at 1024 and wider"; "Dismiss only hides the notice; it does not touch the URL or history. A reload before Dismiss loses the notice."); Acceptance Criteria AC-03 ("below 1024 pixels the changed-selection notice ... the address no longer carries its marker, and Dismiss hides it for good"); Test Plan AC-03 ("export gone" runs only in `phone-chromium` and `phone-webkit`); Context > Owner summary ("the page reads the notice's marker once on load and cleans the address at once")
EVIDENCE: The R-16 revision also changes the desktop path. Today Dismiss calls `window.history.replaceState(null, "", "/")` and the URL keeps `export=gone` until then, so a reload keeps the notice (app/web/App.tsx:159, 189). Under the new Design the desktop rewrites the URL to `/` on load and Dismiss leaves the URL alone. AC-03 limits the clause to below 1024 pixels, and no Test Plan row opens `/?export=gone` at 1280x720. A build that leaves today's desktop code as it is passes every proof. Design states the desktop rule plainly, so implementers following it build the same thing.
PROPOSAL: Add an `/?export=gone` case at 1280x720 to the "asset link desktop" journey that asserts the notice shows and the URL is already `/`. Or say in Design that the desktop path keeps today's behaviour.

### R-16

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Design > Layout and navigation (URL paragraph: "below 1024 pixels a URL with `export=gone` and no `tab` opens the Library tab"; "While the notice shows, every URL the page writes (a tab switch or an opened asset) keeps `export=gone`. Dismiss hides the notice and removes only `export` from the current URL with `history.replaceState(history.state, ...)`, keeping the rest of the query"; "`?tab=create` (the default when absent)"); Test Plan AC-03 ("export gone": "open `/?export=gone`, assert the Library tab and the changed-selection notice, dismiss it, and assert the URL is `?tab=library`"); Acceptance Criteria AC-03 ("Dismiss changes only the notice"); Context > Owner summary ("its Dismiss only hides the notice and changes nothing else")
EVIDENCE: The R-15 revision replaced "Dismiss replaces the URL with the current `?tab=`" with "removes only `export` from the current URL ... keeping the rest of the query". The server's redirect lands on `/?export=gone` with no `tab` (app/server/export.ts:212, `location: "/?export=gone"`), and Design shows the Library tab there because `tab` is absent, without saying that the page writes `?tab=library` into the URL on load. Design's only URL writes are tab switches and opened assets, so with no tap the current URL is still `/?export=gone`. Removing only `export` from it, as Design says, gives `/`. The "export gone" step then asserts `?tab=library` after Dismiss, so a build that follows Design word for word fails the step. The `/` it leaves also contradicts Design's own default: `/` means Create (the default when `tab` is absent), so a reload after Dismiss shows Create, not the Library the client was on. Only a build that also rewrites `/?export=gone` to `?tab=library&export=gone` on load passes, and Design states no such rewrite.
PROPOSAL: State that below 1024 pixels a URL with `export=gone` and no `tab` is first replaced, with `history.replaceState(history.state, ...)`, by `?tab=library&export=gone`, so that Dismiss removing only `export` leaves `?tab=library`. Or state that Dismiss writes `tab=library` when the URL has neither `tab` nor `asset`. Keep the step's `?tab=library` assertion and add a reload after Dismiss that asserts the Library tab.

FINDING: F-02
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (URL paragraph: "A `popstate` listener re-reads the URL"; "below 1024 pixels a URL with `export=gone` and no `tab` opens the Library tab"; "While the notice shows, every URL the page writes (a tab switch or an opened asset) keeps `export=gone`. Dismiss hides the notice and removes only `export` from the current URL ... so the screen shown and what Back does stay as they were"); Acceptance Criteria AC-03 ("Dismiss changes only the notice"); Context > Owner summary ("its Dismiss only hides the notice and changes nothing else"); Test Plan AC-03 ("export gone": "dismiss on the Asset page, assert the Asset page still shows with `?asset=<id>` and no `export`, then `page.goBack()` shows the Library")
EVIDENCE: This follows from the R-15 revision. Dismiss now clears `export` only from the current entry, and the earlier entries the page wrote while the notice showed still carry `export=gone`. In the step's own sequence the Library entry is `/?export=gone` (or `?tab=library&export=gone`). After Dismiss on the Asset page, Back fires `popstate`, and Design says the listener "re-reads the URL". Design does not say whether reading `export=gone` there shows the notice again. Today the notice is component state set once from the URL (app/web/App.tsx:159), so one implementer keeps it dismissed. Another derives the notice from the URL on every `popstate`, so it comes back after the client dismissed it, which goes against the owner's "Dismiss only hides the notice". A third treats `export` as spent after Dismiss and ignores it, but then `/?export=gone` with no `tab` falls back to Create, the default, instead of the Library. The step asserts only that `page.goBack()` shows the Library and never checks the notice, so the first two builds both pass.
PROPOSAL: State that once dismissed, the notice stays hidden for the rest of the document's life whatever URL `popstate` brings back, while `export=gone` with no `tab` still selects the Library tab. Or state that it shows again. Add to the "export gone" step, after `page.goBack()`, an assertion that the notice is or is not visible, whichever is chosen.

### R-15

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (URL paragraph: "the notice shows above the screen content like the ComfyUI banners. A tab switch keeps `export=gone` until the notice is dismissed, and Dismiss replaces the URL with the current `?tab=` (or `/` in the two-column layout) and no `export`"; URL paragraph: "opening an asset uses `history.pushState`"; Asset page paragraph: the `{ from: "library" }` rule for `‹ Library`); Context > Owner summary ("on a phone the changed-selection notice after a failed zip download opens on the Library tab"); Test Plan AC-03 ("export gone")
EVIDENCE: The R-14 revision added this text. On the phone shell the notice shows above the screen content on every screen, as the ComfyUI banners do, and it stays until dismissed (today it lives in component state that is set once from the URL, app/web/App.tsx:159). So a client who lands on `/?export=gone` can open an asset from a Library tile and tap Dismiss on the Asset page. That page's URL is `?asset=<job id>` with no `tab`, and its history entry carries `{ from: "library" }`. Design does not say what "the current `?tab=`" is there, or whether the pushed `?asset=` URL keeps `export=gone`. One implementer writes `?tab=library` with `replaceState(null, ...)` as today's handler does (app/web/App.tsx:189). The Asset page then closes, history holds two `?tab=library` entries, so the next Back seems to do nothing, and the `{ from: "library" }` state is gone. Another implementer keeps `?asset=<id>`, drops only `export`, and keeps the history state, so the Asset page stays and Back still returns to the Library. The "export gone" step opens `/?export=gone` and dismisses on the Library tab only, so both builds pass.
PROPOSAL: State that Dismiss on the Asset page removes only `export` from the URL and keeps `?asset=` and the entry's history state, or that the notice is not shown on the Asset page. Add that case to the AC-03 "export gone" step: open `/?export=gone`, open a tile, dismiss on the Asset page, assert the Asset page still shows, then `page.goBack()` shows the Library.

FINDING: F-02
KIND: factual
SEVERITY: nit
WHERE: Acceptance Criteria AC-03; Test Plan AC-03 ("export gone" in `phone-chromium` and `phone-webkit`); Design > Layout and navigation (URL paragraph on `?export=gone`); Context > Owner summary ("on a phone the changed-selection notice after a failed zip download opens on the Library tab")
EVIDENCE: The R-14 revision added the "export gone" journey to the AC-03 row, but AC-03's text names the Asset page, `?asset=`, the 1024-pixel crossing, the gone message and Remix. It says nothing about the changed-selection notice or the tab it opens on, and AC-02 does not either. So the owner's R-14 decision is held only by Design and a proof step, not by any criterion an implementation review gives a verdict on. Design and the step fix the behaviour, so an implementer builds the same thing.
PROPOSAL: Add a clause to AC-03 (or AC-02), for example "below 1024 pixels the changed-selection notice opens on the Library tab and Dismiss keeps the current tab".

### R-14

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (URL paragraph: "The `?export=gone` notice keeps working in both layouts"; "`?tab=create` (the default when absent)"; phone shell paragraph: "The ComfyUI banners show above the screen content in both layouts"; Library paragraph: "a Select button that turns the tiles into checkboxes with Select all and Download selected"); Context > Background ("the only URL state is `?export=gone` (`app/web/App.tsx:159`)"); Acceptance Criteria AC-02, AC-03; Test Plan AC-02, AC-03
EVIDENCE: On the phone shell, Download selected sits on the Library tab. When the selection changes before the zip is fetched, the server answers the export GET with `302` to `/?export=gone` (app/server/export.ts:212), so the browser loads a URL with no `?tab=`, and Design's default puts the client on Create, away from the Library the notice tells them to use ("Select the assets again and download them.", app/web/App.tsx:159). Today's Dismiss also calls `window.history.replaceState(null, "", "/")` (app/web/App.tsx:189), so in the phone shell it would drop any `?tab=` the client has since chosen and send them back to Create. Design does not say which tab the phone shell shows for `?export=gone`, where the notice renders there (it names only the ComfyUI banners), whether a tab switch keeps or drops `export=gone` from the query, or what URL Dismiss writes. One implementer keeps the code as it is (Create, Dismiss to `/`), another opens the Library and keeps `?tab=` on Dismiss. No Test Plan row opens `/?export=gone` at a phone size (`grep -rn "export=gone" app/e2e` finds nothing), so both builds pass. This does not trace to the R-13 revision. Its diff only changed the widening URL to `?tab=library` and added the resize-back and `history.length` checks, and I found nothing wrong with those.
PROPOSAL: State that below 1024 pixels `?export=gone` opens the Library tab with the notice above the screen content, and that Dismiss replaces the URL with the current `?tab=` and without `export`. Add a step to the AC-03 "asset page" journey (or to "tabs"): open `/?export=gone` in `phone-chromium` and `phone-webkit`, assert the Library tab and the notice, dismiss it, and assert the URL is `?tab=library`.

### R-13

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (two-column paragraph: "widening from an open Asset page shows the two-column page with no dialog (the URL replaced without `?asset=`). Neither adds a history entry."; URL paragraph: "`?tab=create` (the default when absent)"); Context > Owner summary ("crossing that width closes the open asset view"); Acceptance Criteria AC-03 ("a layout change across 1024 pixels closes the open asset view"); Test Plan AC-03 ("asset page": "with the Asset page open, resize from 768x1024 to 1024x768 and assert no dialog is open and the URL has no `?asset=`; with a tile's Preview dialog open at 1024x768, resize to 768x1024 and assert the Library tab shows with `?tab=library`")
EVIDENCE: The R-12 revision added this rule. The narrowing direction names its exact URL (`?tab=library`), but the widening direction only says the URL is "replaced without `?asset=`". The Asset page's own URL is `?asset=<job id>`, pushed from the Library, so one implementer drops the parameter and leaves `/`, while another writes `?tab=library` to match the Library tab that the Asset page marks as current. In the two-column layout `?tab=` is ignored, so the two builds look the same until the window narrows again, for example a tablet rotated 768x1024 to 1024x768 and back. Then the first build shows Create (the default when `?tab` is absent) and the second shows Library. The proof asserts only "no dialog is open and the URL has no `?asset=`" and never resizes back, so both builds pass. "Neither adds a history entry" is also unchecked in both resize steps, so a build that uses `pushState` here passes. In that build, Back after widening returns to the `?asset=` entry and opens the Preview dialog again, the carry-over the owner chose to drop.
PROPOSAL: State the widening URL exactly, for example `replaceState` to `?tab=library`, so the two directions are symmetric. In the AC-03 "asset page" step, resize back to 768x1024 after widening and assert the chosen tab shows, and assert that `history.length` is unchanged across each of the two resizes.

### R-12

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (two-column paragraph: "A Library tile opens the Preview dialog through component state as today (`app/web/App.tsx:202-203`), without changing the URL or history" and "A layout change across 1024 pixels keeps the open asset: the Asset page becomes the Preview dialog and the other way round, and the model reloads in the new view"; URL paragraph: "The screen lives in the URL query ... `?asset=<job id>`"); Scope ("Tabs and the open asset are in the URL, so reload, Back and links work"); Context > Owner summary ("a desktop tile still opens the Preview dialog without changing the URL"); Acceptance Criteria AC-03 ("the open asset survives a layout change across 1024 pixels"); Test Plan AC-03 ("asset page": "with the Asset page open, resize from 768x1024 to 1024x768 and assert the Preview dialog shows the same asset, then back to the Asset page")
EVIDENCE: The R-11 revision made a desktop tile open the dialog through React state only, so the URL holds no `?asset=` while that dialog is open (the dialog is driven by `preview` state today, app/web/App.tsx:158 and 202-203). Design says the phone shell picks its screen from the URL, and that a layout change turns the dialog into the Asset page. It does not say how a state-only dialog becomes an Asset page when the window narrows below 1024 pixels, for example a tablet rotated from 1024x768 to 768x1024. One implementer writes `?asset=` with `replaceState` and no history state, so `‹ Library` replaces the URL with `?tab=library`. Another uses `pushState` with `{ from: "library" }`, so Back and `‹ Library` call `history.back()`. A third keeps the asset in component state on the phone shell, so the URL lacks `?asset=` and a reload loses the asset, against Scope's "the open asset are in the URL". The only resize step starts on the phone shell with `?asset=` already in the URL, so all three builds pass.
PROPOSAL: State what happens to the URL when a tile-opened desktop dialog crosses below 1024 pixels, for example `replaceState` adding `?asset=<id>` with no history state, so the `‹ Library` rule then replaces the URL with `?tab=library`. Add an AC-03 step in `phone-chromium` and `phone-webkit`: at 1024x768 open a tile's Preview dialog, resize to 768x1024, and assert the Asset page shows that asset with `?asset=<id>` in the URL and that `‹ Library` reaches the Library.

FINDING: F-02
KIND: factual
SEVERITY: nit
WHERE: Design > Layout and navigation (URL paragraph: "Tab switches add no history entry, so Back from Create, Queue or Library leaves Asset Studio, as it does in most phone apps"; Asset page paragraph: "when the asset was opened from a Library tile, the Library entry before it stays in history, so Back from that tab shows the Library once and the next Back leaves Asset Studio"); Context > Owner summary ("After the second review you decided: ... Back from a tab leaves the app"; "After the eleventh review you chose to keep history simple ... Back from there visits the Library once before leaving the app")
EVIDENCE: The R-11 revision added the exception in the Asset page paragraph but left the URL paragraph's unqualified statement that Back from any tab leaves Asset Studio. The two now disagree for a tab reached by leaving a tile-opened Asset page. The later, specific sentence and the AC-03 "asset page" step (`page.goBack()` shows the Library, then a second one returns to `about:blank`) fix the behaviour, and AC-02 ("adds no history entry for a tab switch") still holds, so an implementer builds the same thing.
PROPOSAL: Qualify the URL paragraph's sentence, for example "Back from Create, Queue or Library leaves Asset Studio, except once after leaving a tile-opened Asset page (see below)".

FINDING: F-03
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (validation paragraph: "R-9 found 1 blocking and 2 should-fix findings R-10 found 1 should-fix finding and R-11 found 2")
EVIDENCE: The R-11 revision edited this sentence and removed the "and" between the R-9 and R-10 clauses without adding a comma, which runs the clauses together, the same slip R-6 F-03 reported. The counts match the Review Log rows for R-9, R-10 and R-11.
PROPOSAL: Write "R-9 found 1 blocking and 2 should-fix findings, R-10 found 1 should-fix finding and R-11 found 2".

### R-11

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (Asset page paragraph: "When the entry carries `{ from: "library" }`, the page stores the target tab as pending, calls `history.back()`, and replaces the URL with the target tab only in the `popstate` handler that the traversal fires; while a target is pending, that handler renders the target and not the Library it landed on"; URL paragraph: "A `popstate` listener re-reads the URL. Reloading keeps the screen."); Context > Owner summary ("After the tenth review you kept that Back rule, with the page waiting for the browser's history step before it switches tab"); Acceptance Criteria AC-03; Test Plan AC-03 ("asset page": "open an asset from a tile, tap Queue, assert the Queue screen shows, the Library screen never rendered after the tap ... the same after Remix")
EVIDENCE: The R-10 F-01 revision added this rule. It assumes that `history.back()` from the asset entry is always a same-document traversal that fires `popstate` in the same page, with the pending target still held in memory. Design says "Reloading keeps the screen", and `history.state` (which carries `{ from: "library" }`) survives a reload. After a reload on a tile-opened Asset page, though, the `?tab=library` entry belongs to the document that existed before the reload. Going back to it is commonly a cross-document load rather than a `popstate`. If so, a fresh page loads `?tab=library`, the in-memory pending target is gone, and the client who tapped Queue or Remix ends up on the Library, the case R-10 F-01 set out to prevent. One implementer keeps the pending target in memory, another keeps it in `sessionStorage` and reads it on load, and a third skips `history.back()` after a reload. The AC-03 step never reloads the Asset page, so all three builds pass. I could not observe the traversal: the session sandbox refused a scratch Playwright script under /tmp. The cross-document behaviour comes from how session history ties entries to documents and is not an observed result.
PROPOSAL: Define the reload case. For example, keep the pending target in `sessionStorage` and apply it on load as well as in `popstate`, or have the page record in memory that this document pushed the asset entry and otherwise replace the URL with the target at once. Add an AC-03 step that opens an asset from a tile, reloads, taps Queue, and asserts the Queue screen, `?tab=queue`, and that `page.goBack()` leaves the app.

FINDING: F-02
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (URL paragraph: "opening an asset uses `history.pushState`"; two-column paragraph: "`?asset=<job id>` of a done asset opens the Preview dialog for it; closing the dialog removes `?asset=` from the URL ... A layout change across 1024 pixels keeps the open asset: the Asset page becomes the Preview dialog and the other way round"; Asset page paragraph: the `{ from: "library" }` rule); Acceptance Criteria AC-03 ("the open asset survives a layout change across 1024 pixels"); Test Plan AC-03 ("asset link desktop": "closing it removes `?asset=`"; "asset page": the 768x1024 to 1024x768 resize step)
EVIDENCE: Today a desktop Library tile opens the Preview dialog through React state only (`onPreview={(job, opener) => { setPreview({ job, opener }); }}` and `onClose={() => { setPreview(null); }}`, app/web/App.tsx:202-203). Nothing touches the URL. Design defines what a `?asset=` link does on the desktop and how closing removes it, but never says whether a desktop tile tap pushes `?asset=` (with `{ from: "library" }`), replaces the URL, or leaves the URL alone. It also never says whether Close removes `?asset=` with `history.back()` or `replaceState`. If the tile pushes and Close replaces, history keeps a duplicate Library entry, so Back after closing appears to do nothing. That is the stale-entry problem R-9 F-02 and R-10 F-01 fixed for the phone shell. A phone Asset page that is resized into the dialog carries `{ from: "library" }` too, and Design gives no rule for closing it. One implementer pushes on the desktop, one replaces, and one keeps today's state-only dialog. The "asset link desktop" journey opens only a direct link, and the resize step starts on the phone shell, so all three builds pass.
PROPOSAL: State what a desktop tile tap does to the URL and how Close removes `?asset=`: apply the same `{ from: "library" }` rule, with `history.back()` when the entry was pushed and otherwise `replaceState`. In "asset link desktop", add a step that opens a tile's dialog, closes it, and asserts that `page.goBack()` leaves the app or returns to the page the test started from.

### R-10

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (Asset page paragraph: "Every other way off the Asset page (the Create or Queue tab, Remix, or the gone message's button, which leads to the Library) first applies that rule, `history.back()` when the entry carries `{ from: "library" }`, and then replaces the URL with the target tab, so the pushed asset entry never stays in history"; URL paragraph: "A `popstate` listener re-reads the URL"); Context > Owner summary ("leaving an Asset page any way keeps Back leaving the app"); Test Plan AC-03 ("asset page": "from `about:blank` open the Library, open an asset from a tile, tap Queue, and `page.goBack()` returns to `about:blank`; the same after Remix from a tile-opened asset")
EVIDENCE: This text came in with the R-9 F-02 revision. `history.back()` does not move the session history right away. The HTML standard queues the traversal, and `location` and the current entry change only later, when `popstate` fires. If an implementer writes the rule as it reads, `history.back(); history.replaceState(null, "", "?tab=queue")` in one handler, the replace hits the asset entry while it is still current. The queued traversal then lands on the `?tab=library` entry, and the document's own `popstate` listener re-reads the URL and shows the Library. The client taps Queue (or Remix, which should show Create) and ends up on the Library. A second implementer waits for `popstate` before replacing, and their build shows Queue. The new AC-03 step passes both builds: with the naive build, history is [about:blank, `?tab=library` (current), `?tab=queue` (forward)], so `page.goBack()` still returns to `about:blank`. The step never asserts which screen shows after the tap. I did not run this in a browser, because the session sandbox refused a scratch script outside the worktree. The ordering comes from the history traversal model, not from an observed run.
PROPOSAL: State that the page replaces the URL with the target tab only after the `popstate` from `history.back()` has arrived, and that the `popstate` listener does not render the Library in between, for example by checking a pending-target flag. In the AC-03 "asset page" step, assert that the Queue screen (and Create, after Remix) is shown and that the URL carries `?tab=queue` (and `?tab=create`) before `page.goBack()`.

FINDING: F-02
KIND: factual
SEVERITY: nit
WHERE: Test Plan AC-06 ("notifications switch": "in `chromium` on its own stack started with `startStack` and seeded with `bun run seed --profile empty`"); Test Plan AC-02 (visual record: "without one (the empty-profile stack)")
EVIDENCE: `bun run seed` is `bun app/server/main.ts seed --config dev/config.yaml` (package.json:8), so it seeds the dev stack's data, not a test stack. `startStack(name, "empty")` seeds its own stack with the image's `seed --profile empty` command (app/e2e/harness.ts:62, 111-113), which is how library.spec.ts:67 and queue-board.spec.ts:105 already do it. The `startStack` part makes the intent clear, so an implementer builds the same journey.
PROPOSAL: Write "on its own stack started with `startStack(<name>, "empty")`" and drop the `bun run seed` reference.

### R-9

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Test Plan AC-06 ("notifications switch": "in `chromium` with no unfinished job (the seeded unfinished jobs cancelled through the API first) the queue is hidden and the switch is still shown above the Library"); Test Plan AC-02 (visual record: "the Notifications switch above the desktop Library (with and without a visible queue)"); Design > Layout and navigation ("the desktop queue still hides"); Design > Notifications ("shown whether or not the queue is visible")
EVIDENCE: The desktop `Queue` lists every job that is not done and returns null only when that list is empty: `const rows = jobs.filter((j) => j.state !== "done"); ... if (!loading && !failedLoad && rows.length === 0) return null;` (app/web/App.tsx:518-520). Cancelled and failed jobs are rows. The seed has failed jobs id(5), id(11) and id(13) and cancelled jobs id(6) and id(14) (app/server/seed.ts:56-70), and other rows rely on them: AC-03 opens "a seeded failed job's ID" and AC-04 needs "the seeded cancelled Ultra job shows `Quality: Ultra` in the queue". Cancelling the two submitted jobs (id(7), id(8)) only adds two more cancelled rows, so a correct build still shows the queue and the step's "the queue is hidden" assertion fails. Cancelling id(7) also changes the shared stack the other journeys run against at the same time (playwright.config.ts:15, `workers: 2`; app/e2e/global.ts:1, "the one seeded stack the non-isolated journeys share"). The "without a visible queue" capture has the same problem. The R-8 revision added this step for R-8 F-05, whose evidence described the hide rule as "when no job is unfinished"; the code hides the queue only when every job is done.
PROPOSAL: Run the hidden-queue check on its own isolated stack seeded with the `empty` profile, or with only done jobs (the harness already supports per-test stacks through `startStack`), and say so in the row and the visual record entry. Do not cancel jobs on the shared stack.

FINDING: F-02
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (URL paragraph: "Switching tabs uses `history.replaceState`; opening an asset uses `history.pushState` ... Tab switches add no history entry, so Back from Create, Queue or Library leaves Asset Studio"; Asset page paragraph: "The Asset page keeps the bottom tab bar ... tapping the Library tab does the same as the button" and "Remix ... switches to Create"; gone message "with a button back to the Library"); Acceptance Criteria AC-02 ("adds no history entry for a tab switch"); Test Plan AC-02 ("tabs") and AC-03 ("asset page", "remix")
EVIDENCE: The R-8 revision kept the tab bar on the Asset page and defined only the Library tab and the `‹ Library` button there. Tapping Create or Queue on the Asset page, or Remix (which switches to Create), is still covered only by the general rule "Switching tabs uses `history.replaceState`". After a tile tap pushes `?asset=`, replacing that entry with `?tab=queue` leaves history as [previous page, `?tab=library`, `?tab=queue`], so Back from Queue returns to the Library instead of leaving Asset Studio as Design says. One implementer replaces the entry (leaving the stale Library entry), another calls `history.back()` first and then replaces, and a third pushes. The "tabs" journey starts from Create without an open asset, and the "remix" journey never presses Back, so all three builds pass. The gone message's button also has no stated rule, unlike `‹ Library` and Delete.
PROPOSAL: State that leaving the Asset page by any tab, by Remix or by the gone message's button first applies the `‹ Library` rule (`history.back()` when the entry carries `{ from: "library" }`) and then replaces the URL with the target tab. Add a step to the "asset page" or "remix" journey: open an asset from a tile, tap Queue (or Remix), and assert that `page.goBack()` leaves the app.

FINDING: F-03
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Notifications (switch paragraph: "on a mismatch (the server lost `push.json` and made new keys) it unsubscribes, subscribes again with the server's key and posts the new subscription", "When the re-post on load fails, the switch stays on and shows `Could not reach Asset Studio; notifications may not arrive.`"; server bullet: "the page re-subscribes on its next load when the key it subscribed with differs"); Test Plan AC-06 ("notifications switch": the key-mismatch reload step)
EVIDENCE: The R-8 revision added the key-mismatch path on load. It changes state in two places (the browser's push subscription and the server's `push.json`) and crosses the push service boundary, but only the final POST's failure is covered. If `unsubscribe` succeeds and the new `pushManager.subscribe` then fails, for example because the push service is unreachable or the browser refuses a subscribe call outside a gesture, the device has no subscription. Design does not say whether the switch then shows off with no message, off with `Notifications could not be turned on. Try again.`, or on with the could-not-reach message. One implementer leaves the switch silently off, another shows a message, and the journey only covers the success order (`unsubscribe`, `subscribe`, one POST).
PROPOSAL: State what the switch shows when the re-subscribe on load fails after the old subscription was removed (for example off with `Notifications could not be turned on. Try again.`), and add that case to the key-mismatch step with a `subscribe` stub that rejects.

### R-8

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (phone shell paragraph: "a top bar with the screen title, the content of one screen, and a fixed bottom tab bar"; URL paragraph: "opening an asset uses `history.pushState`, so the browser's Back (and Android's back gesture) returns from the Asset page to the Library"; Asset page paragraph: "Delete goes back to the Library after the job is deleted"); Scope ("a full-screen Asset page opened from the Library"); Context > Owner summary ("opens a full-screen Asset page from the Library"); Acceptance Criteria AC-03 ("Back returns to the Library"); Test Plan AC-03 ("asset page": "`page.goBack()` shows the Library")
EVIDENCE: Design gives the gone message "a button back to the Library", but never says whether the Asset page keeps the bottom tab bar or has an on-screen back control. It only calls the page "full-screen" and relies on the browser's Back. Two common ways in have no earlier history entry: the notification tap (`clients.openWindow('/?asset=<job id>')`, Design > Notifications) and a direct `?asset=` link. From there, Back on Android leaves Asset Studio. On iPhone the installed app runs `display` `standalone` (Design > Manifest), so there is no browser Back button at all. If "full-screen" hides the tab bar, the client who opens an asset from a notification cannot reach the Library except by closing the app. "Delete goes back to the Library" has the same gap if it is built with `history.back()`. One implementer keeps the tab bar on the Asset page, one hides it and adds a back arrow, and one hides it with nothing. All three pass the AC-03 row, which only checks `page.goBack()` after tapping a tile.
PROPOSAL: State the Asset page's way back: either the tab bar stays visible, or the top bar has a Back to Library control that uses `history.back()` when the page was pushed from the Library and otherwise replaces the URL with `?tab=library`. Add a check to the AC-03 "asset page" journey: open `/?asset=<seeded id>` directly from `about:blank`, then reach the Library through that control.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design > Notifications (switch paragraph: "When permission is denied the switch is disabled with `Notifications are blocked in the browser settings.` When `PushManager` is missing from `window`: on iOS or iPadOS ... outside an installed app ... `Add Asset Studio to your Home Screen to get notifications.`"; "On each signed-in load the switch shows the browser's state"); Test Plan AC-06 ("In `phone-webkit` (iPhone user agent, not standalone) with `PushManager` deleted from `window` by an init script before load, the Home Screen message shows"); Test Plan intro ("the AC-06 Home Screen check")
EVIDENCE: The page shows this Home Screen case in Safari on iOS before the app is installed. There the Notification API is not exposed either: Web Push and `Notification` are available only to Home Screen web apps (Sources: WebKit, Web Push for web apps on iOS and iPadOS), so `window.Notification` is undefined as well as `PushManager`. The R-7 F-01 revision made the phone-webkit check delete only `PushManager`, which leaves `Notification` defined. Design lists the denied-permission check, which reads `Notification.permission`, before the `PushManager` check, and the load-time "browser's state" reads permission too. A page that reads `Notification.permission` without first checking that `Notification` exists passes this journey but throws a ReferenceError on a real iPhone outside the installed app. Depending on where it runs, that loses the Home Screen message or breaks the Queue screen. Only the owner's iPhone check, which the merge does not wait for, would catch it.
PROPOSAL: Say that the page checks for `Notification` and `PushManager` before reading permission, and that either one missing leads to the Home Screen or unsupported message. Have the phone-webkit Home Screen check delete both `window.Notification` and `window.PushManager` in its init script.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > Notifications (server bullet: "A corrupt or missing file starts empty with new keys, and the page re-subscribes when the key it subscribed with differs from `GET /api/push/key`"; switch paragraph: "On each signed-in load ... when the browser has a subscription the page posts it again ... so a subscription the server dropped ... comes back"); Acceptance Criteria AC-06 ("a subscription the server dropped is restored on the next signed-in load while the switch is on"); Test Plan AC-06 ("after the test deletes the subscription on the server, a reload posts it again")
EVIDENCE: A corrupt or lost `push.json` is a case where the server drops every subscription and also changes its VAPID key. A browser subscription is bound to the `applicationServerKey` it was made with, and the push service rejects messages signed with another key. Design's sending bullet then logs that failure and keeps the subscription ("any other failure is logged with the push service's host and status and dropped"; only 404 or 410 deletes). The only fix is the key comparison on load. That comparison appears in the server bullet alone. The page's load steps in the switch paragraph do not mention it, and no Test Plan row checks it: the AC-06 reload journey deletes the subscription while keeping the same key. A page that only re-posts passes AC-06's proof and puts the subscription back in `push.json`, but that device never gets another notification after a key change.
PROPOSAL: Put the key comparison into the load steps of the switch paragraph: read `subscription.options.applicationServerKey`, compare it with `GET /api/push/key`, and on a mismatch unsubscribe, subscribe again and post. Add to the "notifications switch" journey a reload after the stubbed subscription's key is changed so that it differs from the server key, and assert that `unsubscribe`, a new `subscribe` and one POST follow.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Notifications (sending bullet: "it encrypts the payload `{"jobId", "batchId", "name"}` with RFC 8291 (aes128gcm)"; service worker paragraph: "body `<name> is ready.` (the name cut to 80 characters)"); Test Plan AC-06 (`app/server/push.test.ts`)
EVIDENCE: The page's asset name is the full prompt for a prompt job (`label`, app/web/App.tsx:47-49). A prompt may be 2000 UTF-16 code units (MAX_PROMPT_CHARS, app/pipeline/presets.ts; checked with `p.length` in app/server/batches.ts:266). Non-ASCII prompts are expected: the fixture has `木箱` (app/server/seed.ts:54) and a 1990-character prompt (seed.ts:43-45). In UTF-8 a 2000-character CJK prompt is about 6000 bytes. RFC 8030 section 7.2 only requires push services to accept 4096-byte payloads, and RFC 8291 then leaves at most 3993 bytes of plaintext. Over that limit the push service answers 413, which Design logs and drops, so the notification is lost. Design never says how the server derives `name` or bounds it. Cutting it to 80 characters happens only in the service worker, after decryption. One implementer sends the full prompt, another truncates on the server, and no row tests a long name.
PROPOSAL: Define `name` on the server as the prompt, or the upload name for an image job, cut to 80 characters before encryption, so the service worker's cut is no longer needed. Add a push.test.ts case where a 2000-character non-ASCII prompt yields a payload under 3993 bytes that decrypts to the cut name.

FINDING: F-05
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Notifications ("The page has a Notifications switch on the Queue screen (and below the queue on the desktop)"); Design > Layout and navigation ("When the queue is empty it shows `Nothing in the queue.` instead of hiding (the desktop queue still hides)"); Test Plan AC-02 (visual record: "the Notifications switch on the desktop queue"); Test Plan AC-06 ("notifications switch" in `chromium` and `firefox`)
EVIDENCE: The desktop `Queue` returns null when no job is unfinished (app/web/App.tsx:518-520, `if (!loading && !failedLoad && rows.length === 0) return null;`), and Design keeps that. That is the usual state once a batch is done. Design places the switch "below the queue" but does not say whether it stays visible when the queue is hidden. One implementer puts it inside the Queue card, so it disappears whenever nothing is queued. Another puts it after the Queue in the right column, so it is always visible. The desktop journeys run against the seed, which always has a submitted job (app/server/seed.ts:63), so both builds pass.
PROPOSAL: Say whether the desktop switch shows when the queue is hidden (for example, always shown in the right column above the Library), and add that empty-queue state to the "notifications switch" journey or to the AC-02 visual record.

FINDING: F-06
KIND: factual
SEVERITY: nit
WHERE: Design > Notifications (sending bullet: "right after the tracker marks a job `done` (`app/server/tracker.ts:398`), it calls `push.jobDone(job)`"); Design > Upgrade, rollback and concurrency ("Two tracker ticks cannot mark the same job done, since `update` checks the expected state (`app/server/tracker.ts:398`), so a job notifies once")
EVIDENCE: `update` returns whether a row changed (app/server/tracker.ts:203-205), and the call at tracker.ts:398 ignores the result. "A job notifies once" depends on `jobDone` running only when that call returns true. Design does not say this. In practice ticks are already serialized through `inFlight` (tracker.ts:128), so building it either way changes nothing that can be observed today.
PROPOSAL: Say that `push.jobDone(job)` is called only when the `done` update returns true.

### R-7

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-06 ("In `phone-webkit` (iPhone user agent, not standalone, no `PushManager`) the Home Screen message shows; in `phone-chromium` with `PushManager` deleted before load, `This browser cannot show notifications.` shows"); Design > Notifications ("When `PushManager` is missing from `window`: on iOS or iPadOS ... outside an installed app ... the switch is replaced by `Add Asset Studio to your Home Screen to get notifications.`"); Test Plan intro ("the AC-06 Home Screen check")
EVIDENCE: The phone-chromium case removes `PushManager` with an init script, but the phone-webkit case takes "no `PushManager`" as a given of the project. Nothing in the document or its Sources backs that up. Playwright's WebKit is the Linux port built from WebKit trunk, not Safari on iOS, and the iPhone 15 device profile only changes the user agent, viewport and touch. It does not remove Web APIs. Whether that build exposes `window.PushManager` is not shown anywhere. I could not check it either: WebKit is not installed on this host (`ls ~/.cache/ms-playwright` lists only chromium, chromium_headless_shell, firefox and ffmpeg), which the document also notes in Context > Background. If the build does expose `PushManager`, a correct page shows the switch and not the Home Screen message, and the check fails. Two implementers end up with different journeys: one relies on the engine, the other deletes the API. Only the second one passes for certain.
PROPOSAL: Have the phone-webkit Home Screen check remove `PushManager` from `window` in an init script before load, the same way the phone-chromium unsupported-browser check does, so the result does not depend on how the WebKit build is configured.

FINDING: F-02
KIND: factual
SEVERITY: nit
WHERE: Test Plan intro (first sentence: "`phone-chromium` (Pixel 7) and `phone-webkit` (iPhone 15) run journeys tagged `@phone`, and `phone-chromium` also `@android`"); Design > Testing and the Android emulator ("`phone-webkit` runs those tagged `@phone` or `@ios` (`grep: /@phone|@ios/`)")
EVIDENCE: The R-6 F-01 revision added `@ios` to the `phone-webkit` grep in Design and added a later sentence about it in the Test Plan intro. The intro's first sentence still lists only `@android` as the extra tag for a phone project. The later sentence in the same paragraph and Design both state the selection correctly, so an implementer builds the same thing either way.
PROPOSAL: Change the first sentence to "and `phone-chromium` also `@android`, `phone-webkit` also `@ios`".

### R-6

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > Testing and the Android emulator (project selection paragraph: "`phone-webkit` runs those tagged `@phone` (`grep: /@phone/`)" and "Each Test Plan row's project list is the set of tags its journeys carry"); Test Plan intro ("one listed for `phone-chromium` alone carries `@android` instead of `@phone`"); Test Plan AC-05 ("in `phone-webkit` with `canActivateAR` forced true, opening the Asset page requests no `ar-link`"); Test Plan AC-06 ("In `phone-webkit` (iPhone user agent, not standalone, no `PushManager`) the Home Screen message shows")
EVIDENCE: The R-5 F-01 revision gives `phone-webkit` the grep `/@phone/` and `phone-chromium` the grep `/@phone|@android/`. No tag selects `phone-webkit` alone, so any journey that reaches `phone-webkit` also runs in `phone-chromium`. Two rows have checks meant for `phone-webkit` only. The AC-05 check forces `canActivateAR` true and expects no `ar-link` request. In `phone-chromium` the Pixel 7 profile's Android user agent makes model-viewer choose `scene-viewer` (the same row relies on this), so a correct build requests an `ar-link` there and the check fails. The AC-06 Home Screen check expects no `PushManager` and an iOS user agent. In `phone-chromium` `PushManager` exists and the user agent is Android, so a correct build shows the switch and not the message. The scheme cannot give these journeys the project list the rows name. One implementer tags them `@phone` and the suite fails on a correct build. Another adds `test.skip` by project name, the ad hoc selection R-5 F-01 asked the document to replace. A third folds them into a shared journey that branches on the browser. The rule "Each Test Plan row's project list is the set of tags its journeys carry" is then false for these rows.
PROPOSAL: Add a tag that only `phone-webkit` selects, for example `@ios` with `phone-webkit` grep `/@phone|@ios/`, carried with `@mobile-only` by the two WebKit-only checks. Say so in the Test Plan intro alongside `@android`.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-02 (visual record sentences: "after-only images of ... and its blocked, could-not-turn-on and Home Screen messages. The View in your room button is left uncaptured ...")
EVIDENCE: conventions/frontend-testing.md:193-198 at edd4c09 asks for "an after image of each state the change adds or alters, such as an open dialog, a collapsed narrow layout or an error" and says "Name any changed state left uncaptured and say why." The R-5 F-02 revision extended the list, but these states that Design adds are neither captured nor named as left out with a reason. `Only PNG, JPEG or WebP photos can be used.` (Design > Images from the camera). `Sharing did not work. Use Download instead.` and `Saved to your downloads.` (Design > Share GLB). `This browser cannot show notifications.` and `Could not reach Asset Studio; notifications may not arrive.` (Design > Notifications). `AR is not available right now.` (Design > AR). The reason given for the AR button, that no headless browser offers AR, does not apply to the disabled state: the AC-05 "ar link" journey already forces `canActivateAR` true in `phone-chromium` and fails the `ar-link` route to show that message. The AC-07, AC-08 and AC-06 journeys reach the other states. An implementer who follows the list exactly still produces a record the convention calls incomplete.
PROPOSAL: Add after-only images of those six states, or name each one left out and say why.

FINDING: F-03
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (validation paragraph: "R-3 found 2 blocking and 4 should-fix findings R-4 found 2 should-fix findings and R-5 found 2 should-fix findings")
EVIDENCE: The R-5 revision edited this sentence, and it now runs three clauses together with no comma or "and" between "should-fix findings" and "R-4". The counts agree with the Review Log rows for R-3, R-4 and R-5.
PROPOSAL: Punctuate it as a list, for example "R-3 found 2 blocking and 4 should-fix findings, R-4 found 2 should-fix findings and R-5 found 2 should-fix findings".

### R-5

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan (intro paragraph: "`phone-chromium` (Pixel 7) and `phone-webkit` (iPhone 15) run `app/e2e/phone.spec.ts`"); Design > Testing and the Android emulator (project list paragraph: "`phone-chromium` ..., `phone-webkit` ... and `webkit-desktop` for the existing tagged journeys"); Test Plan AC-10 ("`app/e2e/glossary.spec.ts` in `chromium` and `phone-chromium`"); Test Plan AC-01, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08 (rows that run some `phone.spec.ts` journeys in `chromium` and others only in the phone projects)
EVIDENCE: The existing `chromium` project is `{ name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/signin.spec.ts" }` (playwright.config.ts:19), with no testMatch or grep, so it runs every spec file, including a new `app/e2e/phone.spec.ts`. The Test Plan wants only some phone.spec.ts journeys in `chromium` ("installable", "asset link desktop", "quality", "notifications switch", the desktop "photos" and "share" cases, the no-AR-button check). It wants others only in the phone projects ("tabs", "keyboard", "asset page", "remix", "delete", "reduced motion", "ar link"). Those would fail at the Desktop Chrome 1280x720 size, because no tab bar renders there. The document never says how a journey is limited to a project. The `@firefox` and `@webkit` tags only add journeys to their projects through grep. Read literally, the phone projects run only `phone.spec.ts`, so the AC-10 row's `glossary.spec.ts` in `phone-chromium` would never run. One implementer gives the phone projects a testMatch on phone.spec.ts, and the AC-10 phone check silently disappears. Another lets them run every spec, so the desktop-sized specs run at phone size. A third adds `test.skip` calls by project name. The three suites prove different things.
PROPOSAL: State the selection mechanism: each project's testMatch or grep, and how a phone.spec.ts journey is restricted to its listed projects (for example `@phone` and `@desktop` tags, with `chromium` given `grepInvert: /@phone/`). Make the phone projects' scope include glossary.spec.ts, or move the AC-10 phone check into phone.spec.ts.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-02 (last sentence: "The pull request carries before-and-after captures as `conventions/frontend-testing.md` defines them: each phone screen and the Asset page at 390x844 and 844x390, and the desktop composer at 1280x720 before (Detail and Texture) and after (Quality)")
EVIDENCE: conventions/frontend-testing.md at edd4c09, "Visual record in the pull request", says: "For each affected screen it shows a before and after pair, and an after image of each state the change adds or alters, such as an open dialog, a collapsed narrow layout or an error" and "Name any changed state left uncaptured and say why." The Design also changes several desktop states that the row's list leaves out. The Preview dialog gains View in your room, Share GLB, Remix and Delete and a `Quality:` line (Design > Layout and navigation, Design > Quality; today it has only `Download GLB` and `Close`, app/web/Viewer.tsx:131-132). Job rows and Library tiles show `Quality: <name>` or `Custom (...)`. The Notifications switch is added below the desktop queue. The phone shell also adds new states: the gone message, the empty Queue text and the notification messages. An implementer who follows the list exactly produces a record that the convention calls incomplete. The row also does not name the uncaptured states.
PROPOSAL: Extend the list to the desktop Preview dialog, the desktop queue and library with the Quality labels and the Notifications switch, and the added phone states (gone message, empty Queue, a notifications message), or name the states left out and say why.

### R-4

FINDING: F-01
KIND: factual
SEVERITY: should-fix
WHERE: Design > AR: View in your room (first paragraph: "so the button's click handler calls `stopPropagation()` and `preventDefault()` first; each tap then starts exactly one AR launch, the page's own"); Design > AR: View in your room (iPhone paragraph: "the tap calls model-viewer's `activateAR()`"); Test Plan AC-05 ("ar link": "makes exactly one request matching `^intent:`")
EVIDENCE: The page is React 19 (package.json:26-27), and React attaches its event listeners at the root container, so a React `onClick` runs only after the native click has bubbled past every ancestor. model-viewer adds its click listener to the shadow container `div.slot.ar-button` (node_modules/@google/model-viewer/lib/features/ar.js:76-79 and 199-200), which sits between the slotted button and the root. I tested this with a scratch page outside the repository: a custom element with that shadow structure and a click listener on the container, and a React 19 `<button slot="ar-button" onClick={e => { e.stopPropagation(); e.preventDefault(); ... }}>`, clicked with the repository's Playwright Chromium. The order logged was `["container","react"]`, so the container listener ran before the React handler's `stopPropagation()`. If the "click handler" is the usual React prop, model-viewer still calls `activateAR()`. On Android that sends a second intent with the cookie-protected `src` (ar.js:250-291), and on iPhone `activateAR()` runs twice. The document does not say whether the handler is a React prop or a native listener, so two implementers build different things. The "ar link" row would catch the Android double intent in `phone-chromium`. The iPhone case goes unchecked, because in `phone-webkit` model-viewer selects no AR mode and attaches no container listener (the test forces `canActivateAR`). This text came in with the R-3 F-03 revision.
PROPOSAL: Say that the button's click listener is a native one, attached with `addEventListener` on the button element through a ref (not a React `onClick` prop), so `stopPropagation()` runs before the event reaches model-viewer's container. The other option is to render the button outside the `ar-button` slot and drive its visibility from `ar-status` and `canActivateAR`.

FINDING: F-02
KIND: judgement
SEVERITY: should-fix
WHERE: Design > AR: View in your room (`ar-link` answer `{"url": "/api/assets/<id>/model.glb?exp=<unix seconds>&sig=<base64url>"}`; Android tap paragraph: "`...&file=<link>` ... in the same format model-viewer 4.4.0 uses"); Test Plan AC-05 ("ar link": "whose `file` parameter is the latest link"; emulator run 1 step "AR launch": "whose `file` is the signed URL")
EVIDENCE: `ar-link` returns a path relative to the origin. model-viewer resolves the model against the page with `new URL(firstSrc, location)` and adds it percent-encoded as `'&file=' + encodeURIComponent(modelUrl.toString())` (node_modules/@google/model-viewer/lib/features/ar.js:258 and 289-290). The document writes `file=<link>`, where `<link>` is the relative path, and never says that the value is made absolute and encoded. A build that puts the relative path in the intent, or leaves `?exp=...&sig=...` unencoded so that `sig` becomes a separate intent parameter, gives Scene Viewer a URL it cannot load, or one that answers 401. That build still passes a "ar link" assertion that compares `file` with the `ar-link` response, and it passes run 1, which checks only the launch. Only emulator run 2 would catch it.
PROPOSAL: State that `file` is the link resolved against `location.origin` into an absolute URL and encoded with `encodeURIComponent`. In the "ar link" row, assert that the decoded `file` parameter equals that absolute URL, including `exp` and `sig`.

FINDING: F-03
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary (validation paragraph: "Spec review R-1 found 1 blocking and 14 should-fix findings and R-2 found 12 should-fix findings; all are folded in, and a new review is pending.")
EVIDENCE: The Review Log records R-3 at `5bce6c5` with 2 blocking and 4 should-fix findings, and status_description says the document was revised for R-3. The summary's validation state stops at R-2. A later paragraph mentions "After the third review you decided ..." but does not give R-3's findings.
PROPOSAL: Add that R-3 found 2 blocking and 4 should-fix findings, all folded in.

### R-3

FINDING: F-01
KIND: factual
SEVERITY: blocking
WHERE: Test Plan AC-05 ("ar link" in `phone-chromium`: "sets `location.href` (captured by a route on `intent://`)"); Design > AR: View in your room (Android tap paragraph)
EVIDENCE: Observed with a scratch Bun script outside the repository, using the repository's Playwright with the `Pixel 7` profile and the default headless Chromium. The page was served from `http://localhost:<port>` and ran `location.href = "intent://arvr.google.com/..."`. `page.route("intent://**", ...)`, `page.route(/^intent:/, ...)` and a context-level predicate route were never called for the intent URL (the predicate saw only `http://localhost...`). `page.on("request")` and `page.waitForRequest(/^intent:/)` did see `intent://arvr.google.com/x?fil...`, which then failed with `net::ERR_ABORTED`. A test built as the row says waits for a route handler that never runs, so it fails a correct implementation. The capture text came in with the R-2 F-01 revision.
PROPOSAL: Capture the navigation with `page.waitForRequest` (or the `request` event) matching `^intent:`, and assert the `file` parameter and the absence of other requests between the tap and that request.

FINDING: F-02
KIND: factual
SEVERITY: blocking
WHERE: Test Plan AC-06 ("notification click" in `chromium`; "notifications switch" in `phone-chromium` and `chromium`, "with permission granted"); Design > Notifications (service worker paragraph: "On click it focuses an open Asset Studio window and navigates it ... when there is none, or `navigate()` rejects, it calls `clients.openWindow`"); Design > Testing and the Android emulator (project list)
EVIDENCE: Observed with scratch scripts outside the repository. The `chromium` and `phone-chromium` projects run the default headless shell (playwright.config.ts:19). There, after `context.grantPermissions(["notifications"], { origin })`, `Notification.permission` is `denied` (while `Notification.requestPermission()` resolves `granted`), and `registration.showNotification` in the worker throws "No notification permission has been granted for this origin". `NotificationEvent` needs a real `Notification`, so the "notification click" step cannot be built in `chromium`. With `channel: "chromium"`, a notification was shown and a synthetic `notificationclick` was dispatched to a worker that called `clients.claim()`. In that handler `client.focus()` rejected with `InvalidAccessError`, `client.navigate("/?asset=1")` succeeded and `clients.openWindow` rejected with `InvalidAccessError`, because a dispatched event carries no user activation. A worker that awaits `focus()` before `navigate()`, which is the order Design gives, never navigates in this test. Separately, a switch that reads `Notification.permission === "denied"` on load and shows the blocked message, as Design requires, is disabled in the headless shell, so the "permission granted" switch journey fails a correct build unless the test also stubs the permission state. The click check came in with the R-2 F-07 revision.
PROPOSAL: Run the click check in Chromium proper (`channel: "chromium"`). Say that the worker calls `navigate()` without waiting for `focus()` to succeed, and that a `focus()` rejection is ignored. For the switch journeys, say how the test sets the granted state (for example by stubbing `Notification.permission` and `requestPermission`), or run them in a project where `grantPermissions` takes effect.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Design > AR: View in your room ("render their own View in your room button in model-viewer's `ar-button` slot"; Android tap paragraph; iPhone paragraph "the tap calls model-viewer's `activateAR()`"); Test Plan AC-05 ("ar link" with `canActivateAR` forced true)
EVIDENCE: In model-viewer 4.4.0 the `ar-button` slot sits inside the shadow `<div class="slot ar-button">` (node_modules/@google/model-viewer/lib/template.js:317-318). When an AR mode is available, model-viewer adds a click listener to that container that calls `event.preventDefault(); this.activateAR()` (lib/features/ar.js:76-79 and 199-200). A click on a slotted button bubbles through that container. On Android, model-viewer's own handler then opens Scene Viewer with `this.src` (ar.js:250-291), which Design keeps as the cookie-protected `/api/assets/<id>/model.glb`. That is a second intent navigation after the page's own `location.href`, and it hands Scene Viewer a URL that answers 401 and counts toward the failure limit. On iPhone, `activateAR()` runs twice. Design says neither to stop propagation nor to keep the button out of the slot. Forcing `canActivateAR` in the test does not cover the real listener path.
PROPOSAL: State that the page's handler calls `stopPropagation()` (or that the button lives outside the slot and its visibility follows `canActivateAR` and `ar-status`), and add an assertion in "ar link" that exactly one intent request is made per tap.

FINDING: F-04
KIND: factual
SEVERITY: should-fix
WHERE: Design > Share GLB ("When the Asset page or the Preview dialog opens and the browser has `navigator.share` and `navigator.canShare`, the page fetches the GLB ... On those browsers the page does not prefetch the file."); Test Plan AC-08
EVIDENCE: Chrome on Android has both `navigator.share` and `navigator.canShare`, yet refuses `.glb` files (Sources, Chromium FILE_TYPES.md). Under the first sentence, Chrome on Android prefetches the whole GLB on every Asset page open. The last sentence says it does not. The client's main device is Android, and a 4096-texture GLB is several megabytes. Whether a dummy `File` is passed to `canShare` before fetching is not said. The AC-08 row stubs `canShare` to refuse but never asserts that no GLB request follows, so either build passes. This text came in with the R-2 F-02 revision.
PROPOSAL: Say that the page first calls `navigator.canShare({ files: [new File([], "<name>.glb", { type: "model/gltf-binary" })] })` and prefetches only when that is true, and assert in the AC-08 row that with `canShare` refusing, opening the view makes no `model.glb` request before the tap.

FINDING: F-05
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan AC-03 ("remix" in `phone-chromium`: "Remix fills Create's prompt and Quality from a seeded asset"); Test Plan AC-04 (Custom label checked only in `presets.test.ts`); Design > Quality ("`Custom (<k>k, <texture>)` for an older job"); Design > Layout and navigation (Remix)
EVIDENCE: Every seeded fixture job is 10000 with 2048, except the cancelled Ultra job (app/server/seed.ts:93, `j.ultra ? 30000 : 10000, j.ultra ? 4096 : 2048`). So every seeded done asset is Standard, and Standard is also Create's default. A Remix that never sets Quality passes the "remix" journey. No seeded job has a pair outside the levels, so no journey ever renders `Custom (...)` on a job row, the Asset page or the Library. conventions/frontend-testing.md asks fixtures to "Cover the states the feature renders".
PROPOSAL: Choose a non-Standard Quality before Remix, or add a seeded done job at another level and one with a pair outside the levels (for example 5000 with 2048), and assert the Quality Remix selects and the `Custom (5k, 2048)` label on the page.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation ("On the desktop layout the Preview dialog gets the same actions next to Download GLB and Close"; Asset page action list "Share GLB, Download, Remix and Delete"); Test Plan AC-08 ("for the Preview dialog")
EVIDENCE: The Preview dialog today has `Download GLB` and `Close` (app/web/Viewer.tsx:131-132). "The same actions" includes Download, so a literal build shows both `Download` and `Download GLB` in the dialog. Another implementer keeps only `Download GLB`, and a third renames it to `Download`. No row says which labels the dialog carries.
PROPOSAL: List the Preview dialog's exact buttons, for example View in your room, Share GLB, Remix, Delete, Download GLB and Close.

### R-2

FINDING: F-01
KIND: judgement
SEVERITY: should-fix
WHERE: Design > AR: View in your room (refresh paragraph "When View in your room is tapped and the current link has less than 5 minutes left..." and the iPhone paragraph); Context > Owner summary ("the AR link is refreshed when View in your room is tapped close to its expiry"); Acceptance Criteria AC-05 ("also when the page has been open longer than the first link's lifetime"); Test Plan AC-05 ("ar refresh" and emulator run 2 step "AR load")
EVIDENCE: The refresh path awaits a fetch of `ar-link`, a new `src` and the model's `load` event before activating AR. That means a full re-download of the GLB, which no-store forbids caching. model-viewer then launches Scene Viewer by clicking an anchor with an `intent://` href (/home/m/code/3d-assets-gen/node_modules/@google/model-viewer/lib/features/ar.js:289-321). Chrome on Android launches an external app only from a navigation that still has transient user activation, which lasts a few seconds after the tap. model-viewer's own fallback comment says a deferred activateAR "fails due to not seeing a user activation" (ar.js, undoHashChange). A 4096-texture GLB loaded over the tailnet can outlast that window, so the intent may be blocked after `Preparing…` and nothing opens. The document defines no path for that case. On iPhone the rule still applies even though Quick Look does not use the link ("no signed link is needed there"), so iPhone also pays a reload and the same activation risk. Run 2 "AR load" (wait 16 minutes, then tap) exercises exactly this path, so a build that follows the document can fail it.
PROPOSAL: Keep the tap synchronous. One way: refresh the link in the background while the Asset page or dialog is visible, for example a timer that swaps `src` before the link has 5 minutes left. Another: after `Preparing…`, ask for a second tap. Limit any refresh to Scene Viewer, and keep run 2 "AR load" as the proof.

FINDING: F-02
KIND: factual
SEVERITY: should-fix
WHERE: Design (no Share GLB subsection; Layout and navigation, Asset page action list); Scope ("Share GLB"); Design > Glossary (Share GLB row); Acceptance Criteria AC-08; Test Plan AC-08
EVIDENCE: Outside the action lists and the Glossary, "Share GLB" appears only in AC-08 and its Test Plan row. `navigator.canShare`, the file name `<slug>-<short id>.glb`, the type `model/gltf-binary` and the fallback download of `/api/assets/<id>/model.glb` are stated only in the Test Plan. Design never says how the File is obtained: fetched with the cookie at tap time, prefetched, or taken from the signed link. It also leaves open what happens when `navigator.share` rejects (the user cancels, or NotAllowedError). Safari requires `navigator.share` to run with transient user activation. Fetching a multi-megabyte GLB after the tap can outlast that, so one implementer's iPhone share works and another's fails.
PROPOSAL: Add a Share GLB subsection to Design that gives the file source and when it is fetched (before the tap, so `share` runs inside the gesture), the name and type, the `canShare` test, the download fallback with `Saved to your downloads.`, and the behaviour on a rejected share.

FINDING: F-03
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-01 ("installable" in `chromium`: "asserts `Page.getInstallabilityErrors` returns an empty list"); Acceptance Criteria AC-01
EVIDENCE: The `chromium` project is `devices["Desktop Chrome"]` with Playwright 1.65.1 defaults (playwright.config.ts:19, bun.lock:146), which run headless Chromium as chromium-headless-shell. Observed with a scratch script outside the repository: on `data:text/html,<p>x</p>`, a page with no manifest, the default launch returned `{"installabilityErrors":[]}` (Chromium 159.0.8154.6). With `channel: "chromium"` and a normal context it returned `in-incognito`, `not-from-secure-origin` and `manifest-parsing-or-network-error`. With `launchPersistentContext` it returned only `not-from-secure-origin` and `manifest-parsing-or-network-error`. As written, the proof passes on a page with no manifest at all. The obvious repair of switching the channel would then fail a correct build with `in-incognito`.
PROPOSAL: Run the installability check in Chromium (not the headless shell) with a persistent context, and add a negative control: the same call on a page without the manifest must report errors.

FINDING: F-04
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation ("Switching tabs uses `history.replaceState`"); Acceptance Criteria AC-02 ("keeps the screen across reload and Back"); Test Plan AC-02 ("reload and `page.goBack()` keep or restore the screen"); Scope ("so reload, Back and links work")
EVIDENCE: Tab switches replace the history entry, so Back after switching tabs leaves Asset Studio for whatever came before it (about:blank in a fresh Playwright page). Only opening an asset pushes an entry. AC-02 and the "tabs" row still say Back keeps or restores the screen, without saying from which state. A test writer who calls `page.goBack()` after a tab switch fails a correct build. One who calls it only after opening an asset duplicates the AC-03 check.
PROPOSAL: State what Back does on each screen (from the Asset page it returns to the Library; from a tab it leaves the app), and make the "tabs" row assert exactly that.

FINDING: F-05
KIND: factual
SEVERITY: should-fix
WHERE: Design > Testing and the Android emulator (android-journey.ts bullet, "`scripts/phone/journey.test.ts` checks that refusal"); Test Plan AC-12; Context > Owner summary ("the emulator checks prove ... that the script cannot submit a job to win-main"); frontmatter covers (`scripts/verify.sh`, `scripts/phone/`)
EVIDENCE: `bun run verify` runs unit tests only with `bun test app ...` (scripts/verify.sh, step "unit tests"). Shellcheck covers only scripts/verify.sh, scripts/ci, scripts/deploy (shell_checks). The TypeScript projects include app/ paths and playwright.config.ts only (tsconfig.node.json, tsconfig.e2e.json, tsconfig.web.json). So `scripts/phone/journey.test.ts` never runs in verify or CI, `setup-emulator.sh` is never shellchecked and `android-journey.ts` is never type-checked. No Test Plan row names journey.test.ts. The guard behind an owner decision rests only on a transcript from one run.
PROPOSAL: Say that verify.sh runs `bun test ./scripts/phone` and shellchecks `scripts/phone/*.sh`, that a tsconfig includes scripts/phone, and name journey.test.ts in the AC-12 row.

FINDING: F-06
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Notifications (switch paragraph); Acceptance Criteria AC-06; Test Plan AC-06 ("notifications switch" in `phone-chromium` and `chromium`)
EVIDENCE: "When `pushManager.subscribe` or that POST fails, the switch is off", yet after a failed POST the browser subscription remains. On the next load "the switch shows the browser's state" and re-posts, so a switch the client saw fail turns itself on. If the load-time re-post fails, the switch shows off while the server may still hold the subscription and keep notifying. Design does not say whether the page unsubscribes on failure. The Home Screen message applies to "Safari on iPhone outside an installed app", but no detection rule is given. Nor does Design say what any other browser without `PushManager` shows. The order "registers the service worker if needed, asks `Notification.requestPermission()` from the tap" puts an await before the permission request, and Safari needs that request inside the gesture. No row checks the blocked, Home Screen or unsupported states in WebKit or Firefox. conventions/frontend-testing.md asks for Firefox on "browser APIs".
PROPOSAL: Define the failure states: unsubscribe on a failed POST, and say what the switch shows on a failed re-post. Give the detection rule and the message for browsers without Push support. Request permission first in the tap handler. Add phone-webkit and Firefox runs of the switch journey that cover those messages.

FINDING: F-07
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Notifications (service worker paragraph, "On click it focuses an open Asset Studio window and navigates it to `/?asset=<job id>`, or opens one"); Acceptance Criteria AC-06 ("tapping it opens that asset's Asset page"); Test Plan AC-06 (emulator run 1 step "notify")
EVIDENCE: `WindowClient.navigate()` rejects for a window the service worker does not control. The page registers `/sw.js` on load, and Design names no `clients.claim()`, so the window open when the client first turns notifications on stays uncontrolled until it reloads. A click on a notification while that window is open would focus it and fail to navigate. The only proof swipes the app away first, so it exercises the `openWindow` path and never the focus-and-navigate path.
PROPOSAL: Say that the worker calls `clients.claim()` on activate, or that it falls back to `postMessage` or `openWindow` when navigate fails. Add a check with the app window still open, for example in emulator run 1 before the swipe or in a Chromium journey.

FINDING: F-08
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan AC-01 (emulator run 1 step "install": "the launcher icon opened through `adb shell monkey -p` of the installed WebAPK"); Test Plan AC-12 ("install and open standalone as in AC-01"); Design > Testing and the Android emulator (setup-emulator.sh bullet)
EVIDENCE: The step assumes Chrome mints and installs a WebAPK package that `monkey -p` can launch. Run 1 serves the page from `http://localhost:8790`. setup-emulator.sh signs in no Google account, and Chrome falls back to a plain home-screen shortcut, which has no package, when WebAPK install does not complete. The document defines neither how the step finds the package name nor what it does if Chrome creates a shortcut, so the proof's mechanism is undefined on the environment it names.
PROPOSAL: Say how the script finds the WebAPK package (for example `pm list packages org.chromium.webapk`) and what it does without one: tap the launcher icon through `uiautomator dump` and `input tap`, or fail with a named setup gap. Keep the `display-mode: standalone` pass condition.

FINDING: F-09
KIND: factual
SEVERITY: should-fix
WHERE: Test Plan AC-02, AC-03 ("asset link desktop" in `chromium` and `webkit-desktop`); Design > Testing and the Android emulator
EVIDENCE: conventions/frontend-testing.md at the pin says "Test reduced motion and 200 percent browser zoom on affected flows" and "Include Firefox for engine-sensitive behavior such as ... navigation reuse, browser APIs". No row checks reduced motion on the new Asset page or the phone shell. The URL-state journeys (`?asset=` on the desktop, popstate) and the notifications switch run without Firefox, although Firefox is the existing second desktop engine (playwright.config.ts:20).
PROPOSAL: Add a reduced-motion check of the Asset page viewer (for example `interpolation-decay` 0 under `reducedMotion: "reduce"`), and tag the "asset link desktop" and "notifications switch" journeys `@firefox`.

FINDING: F-10
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Layout and navigation (bottom tab bar paragraph); Acceptance Criteria AC-02; Test Plan AC-02
EVIDENCE: Design gives the tab bar's icons, labels and safe-area padding, but not how the current tab is marked. guides/vh-midnight.md says "Never distinguish a required field, error or selection by colour alone". conventions/interface-colour.md lets the current item use the accent and says "Colour is never the only signal". One implementer may tint the active tab only, another may add `aria-current` and an indicator, and the "tabs" journey checks neither.
PROPOSAL: Define the active tab as `aria-current="page"` plus a non-colour cue (for example a bar or a filled icon) in the accent, and assert `aria-current` in the "tabs" journey.

FINDING: F-11
KIND: judgement
SEVERITY: should-fix
WHERE: Design > Testing and the Android emulator ("without it ... the WebKit projects skip with the launch error as the reason instead of passing or failing"); Test Plan AC-02, AC-03, AC-05, AC-07, AC-08 (rows that rely on `phone-webkit` or `webkit-desktop`)
EVIDENCE: conventions/testing.md at the pin, which AGENTS.md routes to before claiming a run proves a change, says: "A test that needs a dependency, a service or a file fails when that dependency is missing; it does not skip and report green." Without `E2E_REQUIRE_WEBKIT`, a local `bun run verify` finishes green with every WebKit journey skipped, and the document says WebKit's libraries may be missing on fedora-43. The existing `E2E_REQUIRE_WEBGL` arrangement (app/e2e/library.spec.ts:38-40) is precedent, but the pinned convention now says otherwise. This is a conflict with repository instructions that the document does not raise.
PROPOSAL: Make a missing WebKit fail by default, with an explicit opt-out variable that the run reports. Or raise the exception as an Open Question naming the convention.

FINDING: F-12
KIND: judgement
SEVERITY: should-fix
WHERE: Test Plan AC-07 ("photos": "both inputs carry the stated `accept`, Take photo carries `capture="environment"`; two `setInputFiles` calls on Take photo leave two images chosen"); Acceptance Criteria AC-07 ("From photos adds several images")
EVIDENCE: Nothing asserts that From photos has `multiple`, or that one From photos pick of several files adds them all to images already chosen. A From photos input without `multiple`, or one that replaces the selection as today's input does (app/web/App.tsx:328), passes the row.
PROPOSAL: Assert `multiple` on From photos and no `multiple` on Take photo. Add a step where one Take photo file followed by a From photos pick of two files leaves three images chosen.

FINDING: F-13
KIND: factual
SEVERITY: nit
WHERE: Context > Owner summary ("None of this has run yet, and the spec has not been reviewed."; "The message holds the asset name")
EVIDENCE: The Review Log records spec review R-1 at `8a89924`, so "the spec has not been reviewed" is no longer true. Design > Notifications gives the payload as `{"jobId", "batchId", "name"}`, which is more than the asset name.
PROPOSAL: Say that R-1 found 1 blocking and 14 should-fix findings, all folded in, and that a new review is pending. Say the encrypted message holds the asset name and its job and batch IDs.

FINDING: F-14
KIND: factual
SEVERITY: nit
WHERE: Test Plan AC-05 (emulator run 2 step "AR load": "from the emulator's tailnet address")
EVIDENCE: The emulator has no tailnet address. Its traffic leaves through the emulator's NAT on fedora-43, so win-main sees fedora-43's node, the same address Chrome on the emulator uses. Behind `tailscale serve` the logged address is the last X-Forwarded-For value only when the socket peer is trusted (app/server/auth.ts:52-62). Only the user agent tells Scene Viewer's fetch from Chrome's.
PROPOSAL: Say "from fedora-43's tailnet address (or the address the server logs for it) with a user agent that is not Chrome's".

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

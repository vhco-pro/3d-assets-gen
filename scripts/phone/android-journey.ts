// The Android emulator journey (feature document asset-studio-mobile, Design > Testing and the Android
// emulator): drives Chrome on the asset-studio AVD through Playwright's Android support, with adb for what
// Playwright cannot reach (the launcher, the camera app, the notification shade, logcat, uiautomator and
// input tap). Run by the agent, never by CI:
//
//   PHONE_BASE_URL=http://localhost:8790 PHONE_TOKEN=... bun scripts/phone/android-journey.ts --run 1
//   PHONE_BASE_URL=https://win-main.tail6948f.ts.net PHONE_TOKEN=... \
//     PHONE_LOG_COMMAND='ssh win-main docker logs --since 30m asset-studio-app-1' bun scripts/phone/android-journey.ts --run 2
//
// The token comes from the environment and is never printed. Every step is declared as submitting a
// generation or not; a submitting step refuses to run, and fails, unless the base URL's host is localhost, so
// run 2 against win-main can never queue a job. The transcript and screenshots go to .artifacts/phone/run-<n>/.
import { _android as android, type AndroidDevice, type BrowserContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { createReporter } from "../../app/cli/report.ts";

const run = promisify(execFile);
const ROOT = join(import.meta.dir, "..", "..");
const ADB = join(process.env.ANDROID_HOME ?? join(homedir(), ".local", "share", "android-sdk"), "platform-tools", "adb");
export const CHROME = "com.android.chrome";

export interface StepContext {
  baseUrl: string;
  token: string;
  run: 1 | 2;
  device: AndroidDevice;
  context: BrowserContext;
  page: Page;
  dir: string;
  /** Values steps hand to later steps (job IDs, the open asset). */
  state: Record<string, string>;
  log(line: string): void;
  shot(name: string): Promise<void>;
  adb(...args: string[]): Promise<string>;
}

export interface Step {
  name: string;
  /** True when the step queues a generation on the server it talks to. */
  submits: boolean;
  /** The runs the step belongs to. */
  runs: readonly (1 | 2)[];
  run(ctx: StepContext): Promise<void>;
}

export class Refused extends Error {}

/** Runs one step, refusing a submitting step unless the base URL's host is localhost. */
export async function runStep(step: Step, ctx: StepContext): Promise<void> {
  const host = new URL(ctx.baseUrl).hostname;
  if (step.submits && host !== "localhost") {
    throw new Refused(`${step.name} refused: it submits a job and ${host} is not localhost`);
  }
  await step.run(ctx);
}

// ---- helpers ------------------------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, check: () => Promise<T | null | undefined | false>, ms = 60_000, every = 1000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what} did not happen within ${String(ms / 1000)} s`);
    await sleep(every);
  }
}

interface UiNode { text: string; desc: string; res: string; bounds: [number, number, number, number] }

/** The screen's uiautomator nodes. */
export async function uiNodes(ctx: Pick<StepContext, "adb">): Promise<UiNode[]> {
  // uiautomator refuses to dump while the screen never goes idle (a rendering 3D view); it is asked again.
  let xml = "";
  for (let i = 0; i < 5 && !xml.includes("<hierarchy"); i++) {
    xml = await ctx.adb("exec-out", "uiautomator", "dump", "/dev/tty").catch(() => "");
    if (!xml.includes("<hierarchy")) await sleep(700);
  }
  const nodes: UiNode[] = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const tag = m[0];
    const attr = (name: string): string => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr("bounds"));
    if (!b) continue;
    nodes.push({ text: decode(attr("text")), desc: decode(attr("content-desc")), res: attr("resource-id"), bounds: [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] });
  }
  return nodes;
}

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Taps the first node whose text or description matches; returns false when there is none. */
export async function uiTap(ctx: Pick<StepContext, "adb">, pattern: RegExp): Promise<boolean> {
  const node = (await uiNodes(ctx)).find((n) => pattern.test(n.text) || pattern.test(n.desc));
  if (!node) return false;
  const [x1, y1, x2, y2] = node.bounds;
  await ctx.adb("shell", "input", "tap", String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
  return true;
}

/**
 * Where the page's top-left corner sits on the screen. Chrome's toolbar overlays the top of the web view in a
 * tab, so the page starts below it; the installed app has no toolbar. The last good answer is kept, because
 * uiautomator cannot read the screen while a 3D view keeps rendering.
 */
async function pageOrigin(ctx: StepContext): Promise<{ left: number; top: number }> {
  const nodes = await uiNodes(ctx);
  const view = nodes.find((n) => n.desc === "Web View");
  if (view) {
    const toolbar = nodes.find((n) => n.res === "com.android.chrome:id/control_container" && n.bounds[3] > view.bounds[1]);
    ctx.state.originLeft = String(view.bounds[0]);
    ctx.state.originTop = String(toolbar ? toolbar.bounds[3] : view.bounds[1]);
  }
  if (ctx.state.originTop === undefined) throw new Error("no web view on screen");
  return { left: Number(ctx.state.originLeft), top: Number(ctx.state.originTop) };
}

/**
 * A touch on a page element through Playwright's click: CDP input, which Chrome treats as a user gesture
 * (permission prompts, the Scene Viewer intent and the camera picker all open from it).
 */
async function tapElement(_ctx: StepContext, selector: ReturnType<Page["locator"]>): Promise<void> {
  // noWaitAfter: an intent:// navigation (Scene Viewer) never finishes as a page navigation.
  await selector.click({ noWaitAfter: true });
}

/** A screen touch through adb input tap: the element's CSS box mapped through the page's origin on screen. */
async function screenTap(ctx: StepContext, selector: ReturnType<Page["locator"]>): Promise<void> {
  await selector.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
  await sleep(400);
  const box = await selector.boundingBox();
  if (!box) throw new Error("element has no box");
  const dpr = await ctx.page.evaluate(() => window.devicePixelRatio);
  const { left, top } = await pageOrigin(ctx);
  const x = Math.round(left + (box.x + box.width / 2) * dpr);
  const y = Math.round(top + (box.y + box.height / 2) * dpr);
  await ctx.adb("shell", "input", "tap", String(x), String(y));
}

/** Answers Chrome's own prompts: its notification permission (needed for web push) and the system dialog. */
async function chromePrompts(ctx: StepContext): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const nodes = await uiNodes(ctx);
    const has = (re: RegExp): boolean => nodes.some((n) => re.test(n.text) || re.test(n.desc));
    if (has(/Chrome notifications make things easier/)) await uiTap(ctx, /^Continue$/);
    else if (has(/Allow .*to send you notifications/)) await uiTap(ctx, /^Allow$/);
    else if (has(/^(Turn on sync\?|Sign in to Chrome)/)) await uiTap(ctx, /^(No thanks|No, thanks|Cancel)$/);
    else return;
    ctx.log("answered a Chrome prompt");
    await sleep(1500);
  }
}

async function signedIn(page: Page): Promise<boolean> {
  return page.getByRole("navigation", { name: "Screens" }).isVisible();
}

/** The installed app's standalone window on this run's origin, or null when none has opened within `ms`. */
async function standalonePage(ctx: StepContext, ms: number): Promise<Page | null> {
  return until("the standalone Asset Studio window", async () => {
    for (const p of ctx.context.pages()) {
      if (p.isClosed() || !p.url().startsWith(ctx.baseUrl)) continue;
      if (await p.evaluate(() => matchMedia("(display-mode: standalone)").matches).catch(() => false)) return p;
    }
    return null;
  }, ms).catch(() => null);
}

/**
 * Sets Chrome's Settings > Accessibility > Text scaling (50 to 200 percent) with its slider: tap where the
 * value should sit, read the shown percentage, and correct until it matches. Leaves Chrome's settings open.
 */
async function setChromeTextScale(ctx: StepContext, percent: number): Promise<void> {
  const onSlider = async (): Promise<boolean> => (await uiNodes(ctx)).some((n) => n.res === "com.android.chrome:id/seekbar");
  if (!(await onSlider())) {
    await ctx.adb("shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main");
    await sleep(2000);
    await until("Chrome's menu", () => uiTap(ctx, /(^|\. )More options$|^Customize and control Google Chrome$/), 20_000);
    await sleep(1500);
    await until("Settings", () => uiTap(ctx, /^Settings$/), 10_000);
    await sleep(2500);
    await until("Accessibility", async () => {
      if (await uiTap(ctx, /^Accessibility$/)) return true;
      await ctx.adb("shell", "input", "swipe", "540", "1800", "540", "700", "300");
      return null;
    }, 20_000);
    await sleep(2000);
  }
  const bar = (await uiNodes(ctx)).find((n) => n.res === "com.android.chrome:id/seekbar");
  if (!bar) throw new Error("Chrome's text scaling slider is not on screen");
  const [x1, y1, x2, y2] = bar.bounds;
  const y = Math.round((y1 + y2) / 2);
  let x = Math.round(x1 + ((percent - 50) / 150) * (x2 - x1));
  for (let i = 0; i < 8; i++) {
    await ctx.adb("shell", "input", "tap", String(Math.min(x2 - 1, Math.max(x1 + 1, x))), String(y));
    await sleep(800);
    const shown = Number((await uiNodes(ctx)).find((n) => /^\d+%$/.test(n.text))?.text.replace("%", "") ?? "NaN");
    if (shown === percent) {
      ctx.log(`Chrome text scaling set to ${String(percent)} percent`);
      return;
    }
    x += shown < percent ? 15 : -15;
  }
  throw new Error(`could not set Chrome's text scaling to ${String(percent)} percent`);
}

async function apiJobs(ctx: StepContext): Promise<{ id: string; prompt: string | null; upload: string | null; state: string; kind: string }[]> {
  const res = await fetch(`${ctx.baseUrl}/api/jobs`, { headers: { authorization: `Bearer ${ctx.token}` } });
  if (!res.ok) throw new Error(`GET /api/jobs answered ${String(res.status)}`);
  return ((await res.json()) as { jobs: { id: string; prompt: string | null; upload: string | null; state: string; kind: string }[] }).jobs;
}

async function notifications(ctx: StepContext): Promise<string> {
  return ctx.adb("shell", "dumpsys", "notification", "--noredact");
}

async function submitPrompt(ctx: StepContext, prompt: string): Promise<string> {
  const page = ctx.page;
  await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Create" }).click();
  await page.getByLabel("Prompts").fill(prompt);
  await page.getByLabel("Quality", { exact: true }).getByRole("radio", { name: "Fast" }).click();
  await page.getByRole("button", { name: /^Generate/ }).click();
  await page.getByRole("status").filter({ hasText: "1 job added" }).waitFor();
  const job = await until("the submitted job", async () => (await apiJobs(ctx)).find((j) => j.prompt?.startsWith(prompt)));
  return job.id;
}

async function waitDone(ctx: StepContext, id: string): Promise<void> {
  await until(`job ${id} done`, async () => (await apiJobs(ctx)).find((j) => j.id === id && j.state === "done"), 180_000, 2000);
}

/** Opens the notification shade and taps the Asset Studio notification whose text holds the prompt. */
async function tapNotification(ctx: StepContext, prompt: string): Promise<void> {
  await ctx.adb("shell", "cmd", "statusbar", "expand-notifications");
  const short = prompt.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await until("the notification in the shade", async () => (await uiTap(ctx, new RegExp(short))) || null, 15_000, 1500).catch(() => {
    throw new Error("the notification is not in the shade");
  });
}

/** The activity Android shows on top, from dumpsys (empty when none is resumed). */
async function resumedActivity(ctx: StepContext): Promise<string> {
  const top = await ctx.adb("shell", "dumpsys", "activity", "activities");
  return /(?:mResumedActivity|topResumedActivity)[^{]*\{[^}]*\}/.exec(top)?.[0] ?? "";
}

/** The Chrome and installed-app tasks in the recent apps (the installed app runs as Chrome's web app activity). */
async function appTasks(ctx: StepContext): Promise<number> {
  const out = await ctx.adb("shell", "dumpsys", "activity", "recents");
  return out.split("\n").filter((l) => /^\s*\* Recent #\d+/.test(l) && /(webapk|webapp|com\.android\.chrome)/i.test(l)).length;
}

// ---- steps --------------------------------------------------------------------------------------------

export const STEPS: Step[] = [
  {
    name: "install",
    submits: false,
    runs: [1, 2],
    async run(ctx) {
      // Chrome's menu: Install app (a WebAPK) or Add to Home screen (a shortcut, without a Google account).
      await ctx.page.goto(ctx.baseUrl);
      await ctx.page.bringToFront();
      await sleep(4000);
      await chromePrompts(ctx);
      // The menu button's label gains a prefix such as "Update available." when Chrome has news.
      await until("Chrome's menu", () => uiTap(ctx, /(^|\. )More options$|^Customize and control Google Chrome$/), 20_000);
      await sleep(1500);
      const item = await until("Install app or Add to Home screen", async () => {
        if (await uiTap(ctx, /^Install app$/)) return "Install app";
        if (await uiTap(ctx, /^Add to (H|h)ome screen$/)) return "Add to Home screen";
        await ctx.adb("shell", "input", "swipe", "800", "1600", "800", "900", "300");
        return null;
      }, 20_000);
      ctx.log(`menu item: ${item}`);
      await sleep(2000);
      await until("the install confirmation", async () => (await uiTap(ctx, /^(Install|Add)$/)) || null, 20_000);
      // Without a WebAPK, the launcher asks to place Chrome's shortcut; that sheet can take a while to appear.
      await until("the WebAPK or the launcher's add sheet", async () => {
        if (/package:org\.chromium\.webapk/.test(await ctx.adb("shell", "pm", "list", "packages", "org.chromium.webapk"))) return true;
        return (await uiTap(ctx, /^(Add automatically|Add to home screen)$/)) || null;
      }, 60_000, 2000).catch(() => null);
      await sleep(2000);
      const webapk = await until("Chrome's install to finish", async () => {
        const out = await ctx.adb("shell", "pm", "list", "packages", "org.chromium.webapk");
        const pkg = /package:(org\.chromium\.webapk\.\S+)/.exec(out)?.[1];
        if (pkg) return pkg;
        return item === "Add to Home screen" ? "shortcut" : null;
      }, 60_000, 2000).catch(() => "shortcut");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_HOME");
      await sleep(2000);
      let app: Page | null = null;
      if (webapk !== "shortcut") {
        ctx.log(`opened through its WebAPK ${webapk} with monkey -p`);
        await ctx.adb("shell", "monkey", "-p", webapk, "1");
        app = await standalonePage(ctx, 45_000);
      } else {
        // The launcher may hold an icon from an earlier run against another origin; each Asset Studio icon is
        // tried until the standalone window on this run's origin opens.
        ctx.log("Chrome made a home-screen shortcut; tapping the Asset Studio launcher icon");
        const icons = (await uiNodes(ctx)).filter((n) => n.text === "Asset Studio" || n.desc === "Asset Studio");
        for (const icon of icons) {
          const [x1, y1, x2, y2] = icon.bounds;
          await ctx.adb("shell", "input", "tap", String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
          app = await standalonePage(ctx, 30_000);
          if (app) break;
          await ctx.adb("shell", "input", "keyevent", "KEYCODE_HOME");
          await sleep(2000);
        }
        if (icons.length === 0) throw new Error("no Asset Studio icon on the home screen");
      }
      if (!app) {
        await ctx.shot("installed");
        throw new Error("the app did not open standalone");
      }
      ctx.page = app;
      await ctx.page.waitForLoadState();
      ctx.log("display-mode standalone: true");
      await ctx.shot("installed");
    },
  },
  {
    name: "sign in",
    submits: false,
    runs: [1, 2],
    async run(ctx) {
      const page = ctx.page;
      if (!(await signedIn(page))) {
        await page.getByLabel("Access token").fill(ctx.token);
        await page.getByRole("button", { name: "Sign in" }).click();
      }
      await page.getByRole("navigation", { name: "Screens" }).waitFor();
      ctx.log("signed in; the tab bar shows");
      await ctx.shot("signed-in");
    },
  },
  {
    name: "tabs",
    submits: false,
    runs: [1, 2],
    async run(ctx) {
      for (const name of ["Create", "Queue", "Library"]) {
        await ctx.page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name, exact: true }).click();
        await ctx.page.locator(`[data-screen="${name.toLowerCase()}"]`).waitFor();
        ctx.log(`${name} screen shows`);
        await ctx.shot(`tab-${name.toLowerCase()}`);
      }
    },
  },
  {
    name: "zoom",
    submits: false,
    runs: [1],
    async run(ctx) {
      // Chrome's own accessibility text scaling (Settings > Accessibility > Text scaling) at 200 percent, checked
      // in a Chrome tab on the app; the installed app shares Chrome's settings.
      await setChromeTextScale(ctx, 200);
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await sleep(1000);
      const tab = await ctx.context.newPage();
      let failure: unknown = null;
      try {
        await tab.goto(ctx.baseUrl);
        await tab.bringToFront();
        await tab.getByRole("navigation", { name: "Screens" }).waitFor();
        for (const name of ["Create", "Queue", "Library"]) {
          await tab.getByRole("navigation", { name: "Screens" }).getByRole("link", { name, exact: true }).dispatchEvent("click");
          await sleep(1200);
          const report = await tab.evaluate(() => {
            const problems: string[] = [];
            const doc = document.documentElement;
            if (doc.scrollWidth > doc.clientWidth + 1) problems.push(`horizontal overflow ${String(doc.scrollWidth)}`);
            for (const el of document.querySelectorAll("button, label, a")) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${el.textContent.trim().slice(0, 30)}`);
            }
            const h1 = document.querySelector("h1");
            return { problems, heading: h1 ? getComputedStyle(h1).fontSize : "?" };
          });
          ctx.log(`${name} at 200 percent text (heading ${report.heading}): ${report.problems.length === 0 ? "no clipped label, no overflow" : report.problems.join("; ")}`);
          await ctx.shot(`zoom-${name.toLowerCase()}`);
          if (report.problems.length > 0) throw new Error(`layout problems at 200 percent: ${report.problems.join("; ")}`);
          if (name === "Create") {
            // A disabled Generate takes no pointer events, so a prompt is typed first, as a person would.
            await tab.getByLabel("Prompts").fill("zoom check");
            const generate = tab.getByRole("button", { name: /^Generate/ });
            await generate.evaluate((el) => { el.scrollIntoView({ block: "nearest" }); });
            await sleep(600);
            const hit = await generate.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return { ok: at !== null && (at === el || el.contains(at)), top: Math.round(r.top), bottom: Math.round(r.bottom), height: window.innerHeight, over: at ? `${at.tagName}.${at.className.slice(0, 40)}` : "nothing" };
            });
            ctx.log(`Generate at 200 percent: ${hit.ok ? "uncovered" : `covered by ${hit.over}`} (${String(hit.top)}-${String(hit.bottom)} of ${String(hit.height)})`);
            await ctx.shot("zoom-generate");
            await tab.getByLabel("Prompts").fill("");
            // Closes the on-screen keyboard the typing opened, so the tab bar is back on screen.
            await tab.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
            await sleep(1500);
            if (!hit.ok) throw new Error("Generate is covered at 200 percent");
          }
        }
      } catch (e) {
        failure = e;
        ctx.log(`zoom check failed: ${e instanceof Error ? e.message : String(e)}`);
        await ctx.shot("zoom-failure");
      }
      await tab.close().catch(() => undefined);
      await setChromeTextScale(ctx, 100);
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await ctx.page.bringToFront().catch(() => undefined);
      if (failure) throw failure instanceof Error ? failure : new Error("the zoom check failed");
    },
  },
  {
    name: "keyboard",
    submits: false,
    runs: [1],
    async run(ctx) {
      const page = ctx.page;
      await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Create" }).click();
      await tapElement(ctx, page.getByLabel("Prompts"));
      await sleep(1500);
      // A screen touch as well when the CDP tap focused the field without raising the keyboard.
      if (!/mInputShown=true|isInputViewShown=true/.test(await ctx.adb("shell", "dumpsys", "input_method"))) await screenTap(ctx, page.getByLabel("Prompts"));
      await until("the on-screen keyboard", async () => /mInputShown=true|isInputViewShown=true/.test(await ctx.adb("shell", "dumpsys", "input_method")), 15_000);
      await page.keyboard.type("keyboard check");
      const generate = page.getByRole("button", { name: /^Generate/ });
      await generate.evaluate((el) => { el.scrollIntoView({ block: "nearest" }); });
      await sleep(800);
      const state = await generate.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const vv = window.visualViewport;
        const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { inside: r.top >= 0 && r.bottom <= bottom, tappable: hit === el || el.contains(hit), bottom: Math.round(r.bottom), viewport: Math.round(bottom) };
      });
      ctx.log(`keyboard open; Generate bottom ${String(state.bottom)} of visible ${String(state.viewport)}, ${state.tappable ? "tappable" : "covered"}`);
      await ctx.shot("keyboard");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await page.getByLabel("Prompts").fill("");
      if (!state.inside || !state.tappable) throw new Error("Generate is not reachable with the keyboard open");
    },
  },
  {
    name: "notifications on",
    submits: false,
    runs: [1, 2],
    async run(ctx) {
      const page = ctx.page;
      await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Queue" }).click();
      const sw = page.getByLabel("Notify me when assets are ready", { exact: true });
      if ((await sw.getAttribute("aria-checked")) === "true") {
        // Left on by an earlier run: turn it off and on again so this run sees the subscription saved.
        ctx.log("notifications already on; turning them off and on again");
        await tapElement(ctx, sw);
        await until("the switch off", async () => ((await sw.getAttribute("aria-checked")) === "false" ? true : null), 30_000);
      }
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/push/subscriptions") && r.request().method() === "POST", { timeout: 60_000 });
      await tapElement(ctx, sw);
      // The site's permission prompt, then (when Chrome itself may not notify yet) Android's prompt for Chrome.
      for (let i = 0; i < 4; i++) {
        await sleep(2000);
        if (await uiTap(ctx, /^Allow$/)) ctx.log("a notification permission prompt appeared; tapped Allow");
      }
      const res = await posted;
      ctx.log(`POST /api/push/subscriptions answered ${String(res.status())}`);
      await ctx.shot("notifications-on");
      if (res.status() !== 204) throw new Error(`the subscription was not saved (${String(res.status())})`);
    },
  },
  {
    name: "ar launch",
    submits: false,
    runs: [1],
    async run(ctx) {
      const page = ctx.page;
      await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Library" }).click();
      await page.getByRole("button", { name: /^Open / }).first().click();
      const asset = page.getByTestId("asset-page");
      await asset.locator("model-viewer[data-loaded=true]").waitFor({ timeout: 90_000 });
      const link = await page.waitForResponse((r) => r.url().endsWith("/ar-link"), { timeout: 30_000 }).then((r) => r.json() as Promise<{ url: string }>).catch(() => null);
      ctx.log(`signed link held: ${link ? "yes" : "fetched before the wait"}`);
      await ctx.adb("logcat", "-c");
      await ctx.shot("ar-button");
      await tapElement(ctx, asset.getByRole("button", { name: "View in your room" }));
      // logcat shows the launch with its data shortened (dat=https://arvr.google.com/...); the recent tasks
      // keep the whole intent, file parameter included.
      const line = await until("Scene Viewer's intent in logcat", async () => {
        const log = await ctx.adb("logcat", "-d", "-s", "ActivityTaskManager:I");
        return log.split("\n").find((l) => l.includes("START u0") && l.includes("android.intent.action.VIEW") && l.includes("arvr.google.com")) ?? null;
      }, 20_000);
      ctx.log(`logcat: ${line.trim().slice(0, 260)}`);
      const recents = await ctx.adb("shell", "dumpsys", "activity", "recents");
      const full = recents.split("\n").find((l) => l.includes("arvr.google.com/scene-viewer") && l.includes("file=")) ?? "";
      const file = /[?&]file=([^ &}]+)/.exec(full)?.[1];
      const decoded = file ? decodeURIComponent(file) : "";
      ctx.log(`intent: ${(/dat=(\S+)/.exec(full)?.[1] ?? "").replace(/sig%3D[^ &]+/, "sig%3D<signature>").slice(0, 300)}`);
      ctx.log(`decoded file: ${decoded.replace(/sig=[^&]+/, "sig=<signature>")}`);
      await sleep(4000);
      await ctx.shot("ar-launch");
      if (!/^https?:\/\/[^/]+\/api\/assets\/[0-9a-f-]+\/model\.glb\?exp=\d+&sig=/.test(decoded)) throw new Error("the intent's file is not the absolute signed URL");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await sleep(2000);
    },
  },
  {
    name: "ar load",
    submits: false,
    runs: [2],
    async run(ctx) {
      const page = ctx.page;
      await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Library" }).click();
      await page.getByRole("button", { name: /^Open / }).first().click();
      const asset = page.getByTestId("asset-page");
      await asset.locator("model-viewer[data-loaded=true]").waitFor({ timeout: 120_000 });
      const id = new URL(page.url()).searchParams.get("asset") ?? "";
      ctx.state.arJob = id;
      ctx.log(`Asset page open for ${id}; waiting 16 minutes, past the first link's lifetime`);
      const wait = Number(process.env.PHONE_AR_WAIT_MS ?? 16 * 60_000);
      const end = Date.now() + wait;
      while (Date.now() < end) {
        await sleep(60_000);
        await ctx.adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      }
      ctx.state.arTapAt = new Date().toISOString();
      ctx.log(`tapping View in your room at ${ctx.state.arTapAt}`);
      await ctx.adb("logcat", "-c");
      await tapElement(ctx, asset.getByRole("button", { name: "View in your room" }));
      const line = await until("Scene Viewer's intent in logcat", async () => {
        const log = await ctx.adb("logcat", "-d", "-s", "ActivityTaskManager:I");
        return log.split("\n").find((l) => l.includes("START u0") && l.includes("android.intent.action.VIEW") && l.includes("arvr.google.com")) ?? null;
      }, 20_000);
      ctx.log(`logcat: ${line.trim().slice(0, 260)}`);
      await sleep(20_000);
      await ctx.shot("scene-viewer");
      const focused = await resumedActivity(ctx);
      ctx.log(`resumed activity: ${focused.slice(0, 200) || "none"}`);
      // Scene Viewer runs in the Google app (or ARCore); anything else on top means it is not showing the model.
      const showing = /googlequicksearchbox|com\.google\.ar\.core/.test(focused) && !/crash|ErrorActivity/i.test(focused);
      // The server's log line, read with PHONE_LOG_COMMAND (a shell command printing the app's log), e.g.
      // `ssh win-main docker logs --since 5m asset-studio-app-1`.
      const logCommand = process.env.PHONE_LOG_COMMAND ?? "";
      let logged = "";
      if (logCommand) {
        const out = await run("sh", ["-c", logCommand], { maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout + r.stderr).catch(() => "");
        logged = out.split("\n").filter((l) => l.includes(`signed GLB ${id}`)).pop() ?? "";
        ctx.log(`server log: ${logged.replace(/for \S+ \(/, "for <client> (") || "no signed GLB line for this job"}`);
      } else {
        ctx.log("server log: not read (PHONE_LOG_COMMAND is not set)");
      }
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await sleep(3000);
      if (!showing) throw new Error(`Scene Viewer is not showing the model (resumed: ${focused.slice(0, 120) || "none"})`);
      if (!logCommand) throw new Error("the server log was not read; set PHONE_LOG_COMMAND");
      if (!logged || /Chrome\//.test(logged)) throw new Error("the server logged no signed GLB fetch from Scene Viewer for this job");
    },
  },
  {
    name: "notify",
    submits: true,
    runs: [1, 2],
    async run(ctx) {
      // With the app in the foreground, a first job's notification moves the open app to its asset.
      const first = `notify foreground ${Math.random().toString(36).slice(2, 7)}`;
      const firstId = await submitPrompt(ctx, first);
      await waitDone(ctx, firstId);
      await until("the foreground notification", async () => (await notifications(ctx)).includes(`${first} is ready.`) || null, 60_000);
      const before = await appTasks(ctx);
      await tapNotification(ctx, first);
      await until("the open app on the asset", () => Promise.resolve(ctx.page.url().includes(`asset=${firstId}`) ? true : null), 20_000);
      const tasks = await appTasks(ctx);
      ctx.log(`foreground tap moved the open app to /?asset=${firstId}; Chrome and app tasks in recents before ${String(before)}, after ${String(tasks)}`);
      if (tasks !== before) throw new Error("the notification tap opened a second window");
      await ctx.page.getByTestId("asset-page").waitFor({ timeout: 20_000 });
      await ctx.shot("notify-foreground");

      // Swiped away from the recent apps, the device still gets the notification, and a tap opens the asset.
      const prompt = `notify closed ${Math.random().toString(36).slice(2, 7)}`;
      const id = await submitPrompt(ctx, prompt);
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_APP_SWITCH");
      await sleep(2000);
      await ctx.adb("shell", "input", "swipe", "540", "1300", "540", "200", "250");
      await sleep(1500);
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_HOME");
      ctx.log("Asset Studio swiped away from the recent apps");
      await waitDone(ctx, id);
      const doneAt = Date.now();
      const listed = await until("the notification", async () => {
        const out = await notifications(ctx);
        return out.includes(`${prompt} is ready.`) ? out : null;
      }, 60_000);
      ctx.log(`dumpsys notification lists "Asset Studio" with "${prompt} is ready." ${String(Math.round((Date.now() - doneAt) / 1000))} s after the job finished${listed.includes("Asset Studio") ? "" : " (title not found)"}`);
      await tapNotification(ctx, prompt);
      ctx.page = await until("the reopened app", () => Promise.resolve(ctx.context.pages().find((p) => p.url().includes(`asset=${id}`)) ?? null), 30_000);
      await ctx.page.getByTestId("asset-page").waitFor({ timeout: 20_000 });
      // The reopened window paints a few seconds after its page renders (uiautomator cannot read the page while
      // its 3D view renders), so the screenshot waits for the model and then for the window.
      await ctx.page.getByTestId("asset-page").locator("model-viewer[data-loaded=true]").waitFor({ timeout: 60_000 });
      await sleep(2000);
      ctx.log(`the tap opened /?asset=${id} and its Asset page shows the model`);
      await ctx.shot("notify-closed");

      // Turned off, a finished job brings no notification.
      await ctx.page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Queue" }).click();
      await tapElement(ctx, ctx.page.getByLabel("Notify me when assets are ready", { exact: true }));
      await sleep(2000);
      const quiet = `notify off ${Math.random().toString(36).slice(2, 7)}`;
      const quietId = await submitPrompt(ctx, quiet);
      await waitDone(ctx, quietId);
      await sleep(60_000);
      const after = await notifications(ctx);
      ctx.log(`notifications off: ${after.includes(`${quiet} is ready.`) ? "a notification arrived" : "no notification within 60 s"}`);
      if (after.includes(`${quiet} is ready.`)) throw new Error("a notification arrived after turning notifications off");
    },
  },
  {
    name: "camera",
    submits: true,
    runs: [1, 2],
    async run(ctx) {
      const page = ctx.page;
      await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Create" }).click();
      await tapElement(ctx, page.getByText("Take photo", { exact: true }));
      await sleep(4000);
      await uiTap(ctx, /^(While using the app|Only this time|Allow)$/);
      await sleep(2000);
      await ctx.shot("camera");
      await until("the shutter", async () => (await uiTap(ctx, /^(Shutter|Take photo|Capture)$/i)) || null, 20_000);
      await sleep(3000);
      await until("the camera's confirm", async () => (await uiTap(ctx, /^(Done|OK|Confirm|Use photo)$/i)) || null, 20_000);
      await page.getByText("1 image chosen").waitFor({ timeout: 30_000 });
      ctx.log("1 image chosen after the camera");
      const before = (await apiJobs(ctx)).length;
      await page.getByRole("button", { name: /^Generate/ }).click();
      await page.getByRole("status").filter({ hasText: "1 job added" }).waitFor();
      const jobs = await apiJobs(ctx);
      ctx.log(`Generate added ${String(jobs.length - before)} job; newest kind ${jobs[0]?.kind ?? "?"}`);
      await ctx.shot("camera-job");
    },
  },
  {
    name: "share",
    submits: true,
    runs: [1, 2],
    async run(ctx) {
      const page = ctx.page;
      await page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name: "Library" }).click();
      await page.getByRole("button", { name: /^Open / }).first().click();
      const id = new URL(page.url()).searchParams.get("asset") ?? "";
      const size = (await (await fetch(`${ctx.baseUrl}/api/assets/${id}/model.glb`, { headers: { authorization: `Bearer ${ctx.token}` } })).arrayBuffer()).byteLength;
      await ctx.adb("shell", "rm", "-f", "/sdcard/Download/*.glb");
      await tapElement(ctx, page.getByTestId("asset-page").getByRole("button", { name: "Share GLB" }));
      await sleep(2000);
      await uiTap(ctx, /^Download$/);
      await page.getByText("Saved to your downloads.").waitFor({ timeout: 20_000 });
      const listing = await until("the downloaded GLB", async () => {
        const out = await ctx.adb("shell", "ls", "-l", "/sdcard/Download/");
        return out.split("\n").find((l) => l.trim().endsWith(".glb") && l.includes(String(size))) ?? null;
      }, 30_000);
      ctx.log(`/sdcard/Download: ${listing.trim()} (the GLB is ${String(size)} bytes)`);
      await ctx.shot("share");
    },
  },
];

// ---- runner -------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const report = createReporter();
  const { values } = parseArgs({ options: { run: { type: "string", default: "1" }, only: { type: "string" }, ascii: { type: "boolean", default: false } } });
  const runNo = values.run === "2" ? 2 : 1;
  const baseUrl = process.env.PHONE_BASE_URL ?? "";
  const token = process.env.PHONE_TOKEN ?? "";
  if (!baseUrl || !token) {
    report.fail("set PHONE_BASE_URL and PHONE_TOKEN");
    return 2;
  }
  const dir = join(ROOT, ".artifacts", "phone", `run-${String(runNo)}`);
  mkdirSync(dir, { recursive: true });
  const transcript = join(dir, "transcript.txt");
  writeFileSync(transcript, "");
  const write = (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line.split(token).join("<token>")}`;
    appendFileSync(transcript, `${stamped}\n`);
  };
  const adb = async (...args: string[]): Promise<string> => (await run(ADB, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const [device] = await android.devices();
  if (!device) {
    report.fail("no emulator; start it with scripts/phone/setup-emulator.sh --keep-running");
    return 1;
  }
  write(`run ${String(runNo)} against ${baseUrl} on ${device.model()} (serial ${device.serial()})`);
  if (new URL(baseUrl).hostname === "localhost") {
    const port = new URL(baseUrl).port || "80";
    await adb("reverse", `tcp:${port}`, `tcp:${port}`);
    write(`adb reverse tcp:${port} tcp:${port}: the emulator reaches the host's server as ${baseUrl}`);
  }
  await adb("shell", "am", "force-stop", CHROME);
  const context = await device.launchBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  let n = 0;
  const ctx: StepContext = {
    baseUrl, token, run: runNo, device, context, page, dir, state: {},
    log: (line) => { write(`  ${line}`); },
    shot: async (name) => {
      n += 1;
      const file = join(dir, `${String(n).padStart(2, "0")}-${name}.png`);
      await device.screenshot({ path: file });
      write(`  screenshot ${file.slice(ROOT.length + 1)}`);
    },
    adb,
  };
  const steps = STEPS.filter((s) => (values.only ? values.only.split(",").includes(s.name) : s.runs.includes(runNo)));
  // A run that skips install (re-running chosen steps with --only) works in a Chrome tab on the app.
  if (steps[0]?.name !== "install") await page.goto(baseUrl);
  let failed = 0;
  for (const step of steps) {
    report.step(step.name);
    write(`step ${step.name} (${step.submits ? "submits a job" : "submits nothing"})`);
    try {
      await runStep(step, ctx);
      write(`PASS ${step.name}`);
      report.pass(step.name);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof Refused && !values.only) {
        // Run 2 lists the submitting steps so the transcript shows the guard refusing each one.
        write(`REFUSED ${step.name}: ${message}`);
        report.pass(`${step.name} refused by the guard, as run ${String(runNo)} requires`);
        continue;
      }
      failed += 1;
      write(`FAIL ${step.name}: ${message}`);
      report.fail(`${step.name}: ${message}`);
      await ctx.shot(`fail-${step.name.replace(/\s+/g, "-")}`).catch(() => undefined);
      // A failure can leave the notification shade or a system sheet open over the app; clear it so the next step
      // starts on the app.
      await adb("shell", "cmd", "statusbar", "collapse").catch(() => "");
      await ctx.page.bringToFront().catch(() => undefined);
    }
  }
  await context.close().catch(() => undefined);
  await device.close();
  write(failed === 0 ? `run ${String(runNo)} passed` : `run ${String(runNo)}: ${String(failed)} step(s) failed`);
  if (failed === 0) report.pass(`run ${String(runNo)} passed; transcript ${transcript.slice(ROOT.length + 1)}`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main());

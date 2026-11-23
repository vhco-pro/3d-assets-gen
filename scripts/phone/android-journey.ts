// The Android emulator journey (feature document asset-studio-mobile, Design > Testing and the Android
// emulator): drives Chrome on the asset-studio AVD through Playwright's Android support, with adb for what
// Playwright cannot reach (the launcher, the camera app, the notification shade, logcat, uiautomator and
// input tap). Run by the agent, never by CI:
//
//   PHONE_BASE_URL=http://localhost:8790 PHONE_TOKEN=... bun scripts/phone/android-journey.ts --run 1
//   PHONE_BASE_URL=https://win-main.tail6948f.ts.net PHONE_TOKEN=... bun scripts/phone/android-journey.ts --run 2
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
  const xml = await ctx.adb("exec-out", "uiautomator", "dump", "/dev/tty");
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

/** A real touch on a page element: its CSS box mapped to screen pixels, tapped with adb input tap. */
async function tapElement(ctx: StepContext, selector: ReturnType<Page["locator"]>): Promise<void> {
  await selector.scrollIntoViewIfNeeded();
  const box = await selector.boundingBox();
  if (!box) throw new Error("element has no box");
  const view = await ctx.page.evaluate(() => ({ dpr: window.devicePixelRatio, inner: window.innerHeight, outer: window.outerHeight }));
  const screen = await screenSize(ctx);
  // The page fills the screen's width; its top sits below the status bar and any browser chrome.
  const top = screen.height - Math.round(view.inner * view.dpr) - (await navBarHeight(ctx));
  const x = Math.round((box.x + box.width / 2) * view.dpr);
  const y = Math.round(top + (box.y + box.height / 2) * view.dpr);
  await ctx.adb("shell", "input", "tap", String(x), String(y));
}

async function screenSize(ctx: Pick<StepContext, "adb">): Promise<{ width: number; height: number }> {
  const m = /(\d+)x(\d+)/.exec(await ctx.adb("shell", "wm", "size"));
  return { width: Number(m?.[1] ?? 1080), height: Number(m?.[2] ?? 2400) };
}

async function navBarHeight(ctx: Pick<StepContext, "adb">): Promise<number> {
  // Gesture navigation leaves a thin bar; read its height from the window manager when it reports one.
  const out = await ctx.adb("shell", "dumpsys", "window", "displays").catch(() => "");
  const m = /mStableInsets=\[0,\d+\]\[0,(\d+)\]/.exec(out) ?? /navigationBarFrame.*?\[0,(\d+)\]\[\d+,(\d+)\]/.exec(out);
  return m ? Number(m[1]) : 0;
}

async function signedIn(page: Page): Promise<boolean> {
  return page.getByRole("navigation", { name: "Screens" }).isVisible();
}

/** The Asset Studio page in Chrome: the standalone app window once installed, otherwise the newest tab. */
async function appPage(ctx: StepContext): Promise<Page> {
  return until("an Asset Studio page", async () => {
    const pages = ctx.context.pages().filter((p) => p.url().startsWith(ctx.baseUrl));
    for (const p of pages.reverse()) {
      if (await p.evaluate(() => matchMedia("(display-mode: standalone)").matches).catch(() => false)) return p;
    }
    return pages[0] ?? null;
  }, 30_000);
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
  await sleep(1500);
  const short = prompt.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!(await uiTap(ctx, new RegExp(short)))) throw new Error("the notification is not in the shade");
}

async function appTasks(ctx: StepContext): Promise<number> {
  const out = await ctx.adb("shell", "dumpsys", "activity", "recents");
  return out.split("\n").filter((l) => /Recent #\d+/.test(l) && /(webapk|Asset Studio|chrome)/i.test(l)).length;
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
      await sleep(3000);
      await ctx.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", ctx.baseUrl, "-n", "com.android.chrome/com.google.android.apps.chrome.Main");
      await sleep(3000);
      await until("Chrome's menu", () => uiTap(ctx, /^(More options|Customize and control Google Chrome)$/), 20_000);
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
      await sleep(8000);
      await uiTap(ctx, /^(Add automatically|Add to home screen|Add)$/);
      const webapk = await until("Chrome's install to finish", async () => {
        const out = await ctx.adb("shell", "pm", "list", "packages", "org.chromium.webapk");
        const pkg = /package:(org\.chromium\.webapk\.\S+)/.exec(out)?.[1];
        if (pkg) return pkg;
        return item === "Add to Home screen" ? "shortcut" : null;
      }, 60_000, 2000).catch(() => "shortcut");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_HOME");
      await sleep(2000);
      if (webapk !== "shortcut") {
        ctx.log(`opened through its WebAPK ${webapk} with monkey -p`);
        await ctx.adb("shell", "monkey", "-p", webapk, "1");
      } else {
        ctx.log("Chrome made a home-screen shortcut; tapping the Asset Studio launcher icon");
        await until("the Asset Studio icon", () => uiTap(ctx, /^Asset Studio$/), 20_000);
      }
      await sleep(5000);
      ctx.page = await appPage(ctx);
      const standalone = await ctx.page.evaluate(() => matchMedia("(display-mode: standalone)").matches);
      ctx.log(`display-mode standalone: ${String(standalone)}`);
      await ctx.shot("installed");
      if (!standalone) throw new Error("the app did not open standalone");
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
      // Android's font scale drives Chrome's accessibility text scaling (Chrome's default follows the system).
      await ctx.adb("shell", "settings", "put", "system", "font_scale", "2.0");
      try {
        await sleep(2000);
        await ctx.page.reload();
        for (const name of ["Create", "Queue", "Library"]) {
          await ctx.page.getByRole("navigation", { name: "Screens" }).getByRole("link", { name, exact: true }).click();
          await sleep(1000);
          const report = await ctx.page.evaluate(() => {
            const problems: string[] = [];
            const doc = document.documentElement;
            if (doc.scrollWidth > doc.clientWidth + 1) problems.push(`horizontal overflow ${String(doc.scrollWidth)}`);
            for (const el of document.querySelectorAll("button, label, a")) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${el.textContent.trim().slice(0, 30)}`);
            }
            return { problems, textZoom: getComputedStyle(document.body).fontSize };
          });
          ctx.log(`${name} at 200 percent text (body ${report.textZoom}): ${report.problems.length === 0 ? "no clipped label, no overflow" : report.problems.join("; ")}`);
          await ctx.shot(`zoom-${name.toLowerCase()}`);
          if (report.problems.length > 0) throw new Error(`layout problems at 200 percent: ${report.problems.join("; ")}`);
          if (name === "Create") {
            const generate = ctx.page.getByRole("button", { name: /^Generate/ });
            await generate.evaluate((el) => { el.scrollIntoView({ block: "nearest" }); });
            const covered = await generate.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return !(hit && (hit === el || el.contains(hit)));
            });
            ctx.log(`Generate at 200 percent: ${covered ? "covered" : "uncovered"}`);
            if (covered) throw new Error("Generate is covered at 200 percent");
          }
        }
      } finally {
        await ctx.adb("shell", "settings", "put", "system", "font_scale", "1.0");
        await sleep(1000);
        await ctx.page.reload();
      }
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
        ctx.log("notifications already on");
        return;
      }
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/push/subscriptions") && r.request().method() === "POST", { timeout: 60_000 });
      await tapElement(ctx, sw);
      await sleep(1500);
      if (await uiTap(ctx, /^Allow$/)) ctx.log("Android asked for notification permission; tapped Allow");
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
      const line = await until("Scene Viewer's intent in logcat", async () => {
        const log = await ctx.adb("logcat", "-d", "-s", "ActivityTaskManager:I", "ActivityManager:I");
        return log.split("\n").find((l) => l.includes("android.intent.action.VIEW") && l.includes("arvr.google.com/scene-viewer")) ?? null;
      }, 20_000);
      ctx.log(`logcat: ${line.trim().slice(0, 300)}`);
      const file = /file=([^ &}]+)/.exec(line)?.[1];
      const decoded = file ? decodeURIComponent(file) : "";
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
      await tapElement(ctx, asset.getByRole("button", { name: "View in your room" }));
      await sleep(20_000);
      await ctx.shot("scene-viewer");
      const top = await ctx.adb("shell", "dumpsys", "activity", "activities");
      const focused = /mResumedActivity.*?\{[^}]*\}/.exec(top)?.[0] ?? "";
      ctx.log(`resumed activity: ${focused.slice(0, 200)}`);
      ctx.log("the server log line for the signed link is read on win-main with docker logs after this run");
      await ctx.adb("shell", "input", "keyevent", "KEYCODE_BACK");
      await sleep(3000);
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
      await tapNotification(ctx, first);
      await until("the open app on the asset", () => Promise.resolve(ctx.page.url().includes(`asset=${firstId}`) ? true : null), 20_000);
      const tasks = await appTasks(ctx);
      ctx.log(`foreground tap opened /?asset=${firstId}; Asset Studio tasks in recents: ${String(tasks)}`);
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
      ctx.log(`the tap opened /?asset=${id}`);
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
  const steps = STEPS.filter((s) => (values.only ? s.name === values.only : s.runs.includes(runNo)));
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
    }
  }
  await context.close().catch(() => undefined);
  await device.close();
  write(failed === 0 ? `run ${String(runNo)} passed` : `run ${String(runNo)}: ${String(failed)} step(s) failed`);
  if (failed === 0) report.pass(`run ${String(runNo)} passed; transcript ${transcript.slice(ROOT.length + 1)}`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main());

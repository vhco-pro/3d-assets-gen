// Checks that Chrome on the emulator reads the command line Playwright writes: launchBrowser() connects only
// when it does, and chrome://version then shows Playwright's switches. Exit 0 when it does, 1 otherwise.
//   bun scripts/phone/check-chrome.ts [--quiet]   (--quiet: say nothing when Chrome does not read it)
import { _android as android } from "@playwright/test";

const quiet = process.argv.includes("--quiet");

const timeout = (ms: number): Promise<never> => new Promise((_, reject) => setTimeout(() => { reject(new Error(`no connection within ${String(ms / 1000)} s`)); }, ms));

const [device] = await android.devices();
if (!device) {
  console.log("✗ Failed: no emulator");
  process.exit(1);
}
try {
  const context = await Promise.race([device.launchBrowser(), timeout(45_000)]);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("chrome://version");
  const line = (await page.locator("#command_line").textContent()) ?? "";
  await context.close();
  const ok = /--remote-debugging-socket-name|--enable-remote-debugging/.test(line) || line.includes("playwright");
  console.log(ok ? `✓ Passed: chrome://version shows the written command line (${line.slice(0, 120)}…)` : `✗ Failed: chrome://version shows ${line.slice(0, 200)}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  if (!quiet) console.log(`✗ Failed: Chrome does not read its command line: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  await device.close().catch(() => undefined);
}

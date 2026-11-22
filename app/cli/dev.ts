// `bun run dev`: starts the fake ComfyUI and the server with dev/config.yaml and reports when ready.
// `bun run dev -- --check` exits 0 once ready (used by `bun run verify`), or 1 after 30 seconds.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../server/config.ts";
import { createReporter } from "./report.ts";

const report = createReporter();

const root = join(import.meta.dir, "..", "..");
const check = process.argv.includes("--check");
const config = loadConfig(join(root, "dev", "config.yaml"));
const comfyRoot = join(root, ".dev-data", "comfy");
mkdirSync(join(comfyRoot, "input", "asset-studio"), { recursive: true });
mkdirSync(join(comfyRoot, "output", "asset-studio"), { recursive: true });
const port = new URL(config.comfyuiUrl).port;

const children = [
  Bun.spawn(["bun", join(root, "app/fake-comfy/main.ts"), "--port", port, "--comfy", comfyRoot, "--data", join(root, config.dataDir)], { cwd: root, stdout: "inherit", stderr: "inherit" }),
];
const stopAll = (): void => {
  for (const c of children) c.kill();
};
process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

async function ready(url: string, until: number, test: (r: Response) => Promise<boolean>): Promise<boolean> {
  while (Date.now() < until) {
    try {
      if (await test(await fetch(url))) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  return false;
}

const deadline = Date.now() + 30_000;
if (!(await ready(`${config.comfyuiUrl}/asset-studio-fake`, deadline, (r) => Promise.resolve(r.ok)))) {
  report.fail("the fake ComfyUI did not start within 30 seconds");
  stopAll();
  process.exit(1);
}
children.push(Bun.spawn(["bun", join(root, "app/server/main.ts"), "serve", "--config", join(root, "dev", "config.yaml")], { cwd: root, stdout: "inherit", stderr: "inherit" }));
const base = `http://${config.listen}`;
const ok = await ready(`${base}/api/health`, deadline, async (r) => r.ok && ((await r.json()) as { comfyui?: string }).comfyui === "reachable");
if (!ok) {
  report.fail("Asset Studio did not report ComfyUI reachable within 30 seconds");
  stopAll();
  process.exit(1);
}
report.pass(`ready at ${base} (sign in with the token in dev/config.yaml; \`bun run seed\` loads the fixture)`);
if (check) {
  stopAll();
  process.exit(0);
}

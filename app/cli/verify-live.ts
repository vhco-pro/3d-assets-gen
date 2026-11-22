// `bun run verify:live`: two real generations through the deployed app on win-main.
//   bun run verify:live [-- --url https://win-main.<tailnet>.ts.net] [--host win-main] [--ascii]
// Reads the access token over SSH into memory only, submits a TRELLIS.2 job at the default preset and a
// Hunyuan3D job at 10k, waits for both, checks the GLBs, then polls ComfyUI's asset-studio folders until the
// app has removed its files (at most two minutes). Never part of CI.
import { parseArgs } from "node:util";
import { createReporter } from "./report.ts";

const report = createReporter();
const { values } = parseArgs({ options: { url: { type: "string" }, host: { type: "string", default: "win-main" }, ascii: { type: "boolean", default: false } } });
const host = values.host;

function ssh(command: string): string {
  const p = Bun.spawnSync(["ssh", "-o", "BatchMode=yes", host, command]);
  if (p.exitCode !== 0) throw new Error(`ssh ${host} failed: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}

function tailnetUrl(): string {
  const p = Bun.spawnSync(["tailscale", "status", "--json"]);
  const suffix = (JSON.parse(p.stdout.toString()) as { MagicDNSSuffix?: string }).MagicDNSSuffix;
  if (!suffix) throw new Error("cannot read the tailnet name; pass --url");
  return `https://${host}.${suffix}`;
}

/** The glTF JSON chunk of a GLB, or null. */
function gltfJson(bytes: Uint8Array): { asset?: { version?: string }; materials?: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }[] } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return null;
  const len = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as ReturnType<typeof gltfJson>;
}

async function main(): Promise<number> {
  const base = values.url ?? tailnetUrl();
  const token = /^token:\s*(\S+)/m.exec(ssh("type AppData\\Local\\AssetStudio\\config.yaml"))?.[1];
  if (!token) {
    report.fail(`no token in config.yaml on ${host}`);
    return 1;
  }
  const headers = { authorization: `Bearer ${token}` };
  const health = (await (await fetch(`${base}/api/health`)).json()) as { version: string; commit: string; comfyui: string };
  report.step(`Asset Studio ${health.version} (${health.commit.slice(0, 12)}), ComfyUI ${health.comfyui}`);

  const submit = async (prompt: string, presets: Record<string, unknown>): Promise<string> => {
    const res = await fetch(`${base}/api/batches`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "x-batch-id": crypto.randomUUID() },
      body: JSON.stringify({ kind: "prompt", prompts: [prompt], presets }),
    });
    if (res.status !== 201) throw new Error(`batch for ${prompt} answered ${String(res.status)}: ${await res.text()}`);
    const id = ((await res.json()) as { batch: { jobs: { id: string }[] } }).batch.jobs[0]?.id;
    if (!id) throw new Error("no job id");
    return id;
  };
  const trellis = await submit("a small wooden crate", { faces: 10000, tex: 2048, variants: 1, style: true, seed: null });
  const pillar = await submit("a stone pillar", { faces: 20000, tex: 1024, variants: 1, style: true, seed: null });
  report.step(`submitted ${trellis} (TRELLIS.2 10k/2048) and ${pillar} (TRELLIS.2 20k/1024)`);

  const deadline = Date.now() + 30 * 60_000;
  const states = new Map<string, string>();
  while (Date.now() < deadline) {
    for (const id of [trellis, pillar]) {
      const job = ((await (await fetch(`${base}/api/jobs/${id}`, { headers })).json()) as { job: { state: string; error: string | null } }).job;
      if (states.get(id) !== job.state) report.step(`${id.slice(0, 8)}: ${job.state}`);
      states.set(id, job.state);
      if (job.state === "failed" || job.state === "cancelled") {
        report.fail(`${id} ended ${job.state}: ${job.error ?? ""}`);
        return 1;
      }
    }
    if ([trellis, pillar].every((id) => states.get(id) === "done")) break;
    await Bun.sleep(5000);
  }
  if (![trellis, pillar].every((id) => states.get(id) === "done")) {
    report.fail("the jobs did not finish within 30 minutes");
    return 1;
  }
  // Both jobs are TRELLIS.2, so both GLBs must carry a base colour texture.
  for (const id of [trellis, pillar]) {
    const bytes = new Uint8Array(await (await fetch(`${base}/api/assets/${id}/model.glb`, { headers })).arrayBuffer());
    const gltf = gltfJson(bytes);
    if (gltf?.asset?.version !== "2.0") {
      report.fail(`${id}: the download is not a glTF 2.0 binary`);
      return 1;
    }
    if (!gltf.materials?.some((m) => m.pbrMetallicRoughness?.baseColorTexture)) {
      report.fail(`${id}: no material with a base colour texture`);
      return 1;
    }
    report.pass(`${id.slice(0, 8)}: ${(bytes.length / 1024 / 1024).toFixed(1)} MiB glTF with a base colour texture`);
  }
  const listing = (): string =>
    ssh("dir /b /s %LOCALAPPDATA%\\Comfy-Desktop\\ComfyUI-Shared\\output\\asset-studio %LOCALAPPDATA%\\Comfy-Desktop\\ComfyUI-Shared\\input\\asset-studio 2>nul & exit 0");
  const cleanDeadline = Date.now() + 2 * 60_000;
  for (;;) {
    const left = listing();
    if (!left.includes(trellis) && !left.includes(pillar)) break;
    if (Date.now() > cleanDeadline) {
      report.fail("the app's files are still in ComfyUI's asset-studio folders after two minutes");
      return 1;
    }
    await Bun.sleep(10_000);
  }
  report.pass("both jobs' files are gone from ComfyUI's asset-studio folders");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    report.fail(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });

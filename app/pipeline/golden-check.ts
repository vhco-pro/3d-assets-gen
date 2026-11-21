// Regenerates the golden graphs from scripts/generate_3d.py and fails on any difference.
// `bun run golden:check -- --write` refreshes the committed file instead.
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const goldenPath = join(import.meta.dir, "golden", "graphs.json");
const proc = Bun.spawnSync(["python3", "-I", "-B", join(import.meta.dir, "dump_graphs.py"), join(root, "scripts", "generate_3d.py")]);
if (proc.exitCode !== 0) {
  process.stderr.write(proc.stderr);
  console.error("✗ Failed: golden graphs could not be generated (python3 is required)");
  process.exit(1);
}
const fresh = proc.stdout.toString();
if (process.argv.includes("--write")) {
  await Bun.write(goldenPath, fresh);
  console.log(`✓ Passed: wrote ${goldenPath}`);
  process.exit(0);
}
const committed = await Bun.file(goldenPath).text();
if (committed !== fresh) {
  console.error("✗ Failed: app/pipeline/golden/graphs.json differs from scripts/generate_3d.py; run with --write and review");
  process.exit(1);
}
console.log("✓ Passed: golden graphs match scripts/generate_3d.py");

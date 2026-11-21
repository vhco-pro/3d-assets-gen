// `bun run clean`: deletes the development data and ignored test output, nothing else.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
for (const dir of [".dev-data", ".artifacts"]) {
  const path = join(root, dir);
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    console.log(`✓ Passed: removed ${dir}/`);
  } else {
    console.log(`∅ Skipped: ${dir}/ does not exist`);
  }
}

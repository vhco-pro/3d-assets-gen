// `bun run clean`: deletes the development data and ignored test output, nothing else.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createReporter } from "./report.ts";

const report = createReporter();

const root = join(import.meta.dir, "..", "..");
for (const dir of [".dev-data", ".artifacts"]) {
  const path = join(root, dir);
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    report.pass(`removed ${dir}/`);
  } else {
    report.skip(`${dir}/ does not exist`);
  }
}

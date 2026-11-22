// Compiles the server into one executable with the built page embedded.
//   bun app/cli/build-exe.ts [--version 1.2.3] [--commit <sha>] [--target bun-linux-x64] [--out dist/asset-studio]
// Expects `bun run build:web` to have produced dist/web.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createReporter } from "./report.ts";

const report = createReporter();
const { values } = parseArgs({
  options: {
    version: { type: "string", default: "dev" },
    commit: { type: "string", default: "unknown" },
    target: { type: "string", default: "bun-linux-x64" },
    out: { type: "string", default: "dist/asset-studio" },
  },
});
const root = join(import.meta.dir, "..", "..");
const dist = join(root, "dist", "web");
if (!existsSync(join(dist, "index.html"))) {
  report.fail("dist/web is missing; run bun run build:web first");
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const embeddedPath = join(root, "app", "server", "embedded.ts");
const original = readFileSync(embeddedPath, "utf8");
const files = walk(dist).map((p) => relative(dist, p));
const lines = files.map((f, i) => `import f${String(i)} from "../../dist/web/${f}" with { type: "file" };`);
lines.push("export const embedded: Record<string, string> = {");
files.forEach((f, i) => lines.push(`  ${JSON.stringify(f)}: f${String(i)},`));
lines.push("};", "");
writeFileSync(embeddedPath, lines.join("\n"));
try {
  const proc = Bun.spawnSync([
    "bun", "build", "--compile", `--target=${values.target}`, "--minify",
    `--define=process.env.APP_VERSION=${JSON.stringify(values.version)}`,
    `--define=process.env.APP_COMMIT=${JSON.stringify(values.commit)}`,
    join(root, "app", "server", "main.ts"), "--outfile", resolve(root, values.out),
  ], { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    report.fail("bun build --compile failed");
    process.exit(1);
  }
} finally {
  writeFileSync(embeddedPath, original);
}
report.pass(`built ${values.out} (${values.version}, ${values.commit.slice(0, 12)}) with ${String(files.length)} embedded page files`);

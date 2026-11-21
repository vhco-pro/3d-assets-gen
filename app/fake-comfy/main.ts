// Runs the fake ComfyUI as a process: bun app/fake-comfy/main.ts --port 8189 --comfy <dir> [--data <dir>]
// Outputs go to <dir>/output, uploads to <dir>/input.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FakeComfy } from "./fake.ts";
import { createReporter } from "../cli/report.ts";

const report = createReporter();

const { values } = parseArgs({
  options: { port: { type: "string", default: "8189" }, comfy: { type: "string" }, data: { type: "string" }, version: { type: "string" } },
});
if (!values.comfy) {
  report.fail("--comfy <dir> is required");
  process.exit(2);
}
const fake = new FakeComfy({
  outputDir: join(values.comfy, "output"),
  inputDir: join(values.comfy, "input"),
  ...(values.data ? { dataDir: values.data } : {}),
  ...(values.version ? { version: values.version } : {}),
});
fake.start(Number(values.port));
report.step(`fake ComfyUI listening on ${fake.url}`);

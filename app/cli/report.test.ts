import { describe, expect, test } from "bun:test";
import { createReporter, type Output } from "./report.ts";

function capture(isTTY: boolean): Output & { text: string } {
  const o = { text: "", isTTY, write(t: string) { o.text += t; return true; } };
  return o;
}
// eslint-disable-next-line no-control-regex -- the test looks for escape sequences on purpose.
const ANSI = /\x1b\[/;

function run(isTTY: boolean, env: Record<string, string | undefined>, ascii = false): { out: string; err: string; failed: boolean } {
  const out = capture(isTTY);
  const err = capture(isTTY);
  const r = createReporter({ out, err, env, ascii });
  r.step("Deploying 1.2.3");
  r.pass("image verified");
  r.skip("tailscale serve already configured");
  r.none("no previous version");
  r.fail("health did not report 1.2.3");
  return { out: out.text, err: err.text, failed: r.failed };
}

describe("status lines", () => {
  test("Unicode symbols with outcome words; failures on stderr", () => {
    const { out, err, failed } = run(false, {});
    expect(out).toBe("› Deploying 1.2.3\n✓ Passed: image verified\n∅ Skipped: tailscale serve already configured\n∅ No results: no previous version\n");
    expect(err).toBe("✗ Failed: health did not report 1.2.3\n");
    expect(failed).toBe(true);
  });

  test("ASCII mode replaces the symbols and keeps the words", () => {
    const { out, err } = run(false, {}, true);
    expect(out).toBe("> Deploying 1.2.3\nOK Passed: image verified\nSKIP Skipped: tailscale serve already configured\nNONE No results: no previous version\n");
    expect(err).toBe("FAIL Failed: health did not report 1.2.3\n");
  });

  test("colour only on a terminal with NO_COLOR absent or empty", () => {
    expect(ANSI.test(run(true, {}).out)).toBe(true);
    expect(ANSI.test(run(true, { NO_COLOR: "" }).out)).toBe(true);
    for (const value of ["0", "1"]) {
      const r = run(true, { NO_COLOR: value });
      expect(ANSI.test(r.out + r.err)).toBe(false);
    }
    for (const env of [{}, { NO_COLOR: "" }, { NO_COLOR: "1" }]) {
      const r = run(false, env);
      expect(ANSI.test(r.out + r.err)).toBe(false);
    }
  });

  test("a run without failures is not failed", () => {
    const out = capture(false);
    const r = createReporter({ out, err: out, env: {} });
    r.pass("ok");
    expect(r.failed).toBe(false);
  });
});

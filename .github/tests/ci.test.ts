// Structure checks of the workflows: the release record is written only after the release action
// succeeded, nothing else publishes a release, and every external action and reusable workflow is
// pinned to a full commit SHA. Run with: bun test ./.github
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(import.meta.dir, "..", "workflows");
interface Step { name?: string; uses?: string; run?: string; if?: string; "continue-on-error"?: unknown; id?: string }
interface Job { needs?: string | string[]; if?: string; steps?: Step[]; uses?: string; permissions?: Record<string, string>; "continue-on-error"?: unknown }
interface Workflow { jobs: Record<string, Job> }
const load = (file: string): Workflow => parse(readFileSync(join(DIR, file), "utf8")) as Workflow;
const files = readdirSync(DIR).filter((f) => f.endsWith(".yml"));

describe("ci.yml release gate", () => {
  const ci = load("ci.yml");
  const release = ci.jobs.release;
  test("the release job follows the version job and runs only for a pushed tag", () => {
    expect(release?.needs).toEqual(["version"]);
    expect(release?.if).toContain("needs.version.outputs.tagged == 'true'");
    expect(ci.jobs.version?.needs).toEqual(["checks"]);
    expect(ci.jobs.version?.permissions).toEqual({ contents: "write", "pull-requests": "read" });
    expect(release?.permissions).toEqual({ contents: "write", packages: "write", "id-token": "write", attestations: "write" });
  });

  test("the record step comes after the release action in the same job and cannot run after a failure", () => {
    const steps = release?.steps ?? [];
    const action = steps.findIndex((s) => s.uses?.startsWith("michielvha/docker-release-action@"));
    const record = steps.findIndex((s) => s.run?.includes("scripts/ci/release-record.sh"));
    expect(action).toBeGreaterThanOrEqual(0);
    expect(record).toBeGreaterThan(action);
    for (const s of steps.slice(action)) {
      expect(s["continue-on-error"]).toBeUndefined();
      expect(s.if ?? "").not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    }
    expect(release?.["continue-on-error"]).toBeUndefined();
  });

  test("the release action uses the required security profile", () => {
    const action = (release?.steps ?? []).find((s) => s.uses?.startsWith("michielvha/docker-release-action@")) as Step & { with: Record<string, string> };
    expect(action.with).toMatchObject({
      registry: "ghcr.io", username: "vhco-pro", project: "3d-assets-gen", platforms: "linux/amd64",
      "trivy-scan": "true", "trivy-severity": "HIGH,CRITICAL", "trivy-exit-code": "1", "cosign-sign": "true",
      sbom: "true", "attest-provenance": "true", "attest-sbom": "true",
    });
    expect(action.with["build-args"]).toContain("APP_VERSION=");
    expect(action.with["build-args"]).toContain("APP_COMMIT=");
  });

  test("no other step or job creates a release or writes release.json", () => {
    for (const file of files) {
      for (const [name, job] of Object.entries(load(file).jobs)) {
        for (const s of job.steps ?? []) {
          const text = `${s.run ?? ""} ${s.uses ?? ""}`;
          const isRecord = file === "ci.yml" && name === "release" && s.run?.includes("scripts/ci/release-record.sh");
          if (!isRecord) {
            expect(text).not.toMatch(/release create|release\.json|action-gh-release|create-release/);
          }
        }
      }
    }
  });
});

test("every external action and reusable workflow is pinned to a full commit SHA", () => {
  for (const file of files) {
    for (const job of Object.values(load(file).jobs)) {
      const refs = [job.uses, ...(job.steps ?? []).map((s) => s.uses)].filter((u): u is string => !!u && !u.startsWith("./"));
      for (const ref of refs) expect(ref).toMatch(/@[0-9a-f]{40}$/);
    }
  }
});

test("the Renovate custom manager matches every pin in tools.env with its checksum", () => {
  const config = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "renovate.json"), "utf8")) as { customManagers: { matchStrings: string[] }[] };
  const pattern = new RegExp(config.customManagers[0]?.matchStrings[0] ?? "", "g");
  const tools = readFileSync(join(import.meta.dir, "..", "..", "scripts", "deploy", "tools.env"), "utf8");
  const matches = [...tools.matchAll(pattern)].map((m) => [m.groups?.depName, m.groups?.currentValue, m.groups?.currentDigest?.length]);
  expect(matches).toEqual([
    ["koalaman/shellcheck", "v0.11.0", 64],
    ["sigstore/cosign", "v3.1.4", 64],
    ["cli/cli", "v2.105.0", 64],
  ]);
  expect((tools.match(/_VERSION=/g) ?? []).length).toBe(3);
});

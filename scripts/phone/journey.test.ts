// The emulator journey's guard: a step that submits a generation (notify, camera, share) refuses to run unless
// the base URL's host is localhost, so run 2 against win-main can never queue a job (asset-studio-mobile AC-12).
import { expect, test } from "bun:test";
import { runStep, STEPS, type Step, type StepContext } from "./android-journey.ts";

const WIN_MAIN = "https://win-main.tail6948f.ts.net";
const LOCAL = "http://localhost:8790";

/** The step with its body replaced by a recorder, so the test needs no emulator. */
function recorded(step: Step): { step: Step; ran: () => number } {
  let count = 0;
  return { step: { ...step, run: () => { count += 1; return Promise.resolve(); } }, ran: () => count };
}

const ctx = (baseUrl: string): StepContext => ({ baseUrl, log: () => undefined }) as unknown as StepContext;

test("the submitting steps are notify, camera and share", () => {
  expect(STEPS.filter((s) => s.submits).map((s) => s.name).sort()).toEqual(["camera", "notify", "share"]);
});

test("every submitting step refuses https://win-main.tail6948f.ts.net and fails the run without running", async () => {
  for (const s of STEPS.filter((x) => x.submits)) {
    const r = recorded(s);
    let refused: unknown = null;
    try {
      await runStep(r.step, ctx(WIN_MAIN));
    } catch (e) {
      refused = e;
    }
    expect(refused, s.name).toBeInstanceOf(Error);
    expect(String(refused), s.name).toContain("refused");
    expect(r.ran(), s.name).toBe(0);
  }
});

test("every submitting step runs for http://localhost:8790", async () => {
  for (const s of STEPS.filter((x) => x.submits)) {
    const r = recorded(s);
    await runStep(r.step, ctx(LOCAL));
    expect(r.ran(), s.name).toBe(1);
  }
});

test("a step that submits nothing runs against win-main", async () => {
  const s = STEPS.find((x) => !x.submits);
  if (!s) throw new Error("no read-only step");
  const r = recorded(s);
  await runStep(r.step, ctx(WIN_MAIN));
  expect(r.ran()).toBe(1);
});

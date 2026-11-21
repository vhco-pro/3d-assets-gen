// Status lines for the command-line tools (conventions/terminal-output.md): a symbol and an outcome word,
// colour only on a terminal and never when NO_COLOR is non-empty, plain append-only output otherwise,
// and an ASCII mode (--ascii) that replaces the symbols.

export interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface ReporterOptions {
  out?: Output;
  err?: Output;
  env?: Record<string, string | undefined>;
  ascii?: boolean;
}

type Kind = "pass" | "fail" | "skip" | "none" | "step";

const SYMBOL: Record<Kind, [string, string]> = {
  pass: ["✓", "OK"],
  fail: ["✗", "FAIL"],
  skip: ["∅", "SKIP"],
  none: ["∅", "NONE"],
  step: ["›", ">"],
};
const WORD: Record<Kind, string> = { pass: "Passed: ", fail: "Failed: ", skip: "Skipped: ", none: "No results: ", step: "" };
const COLOUR: Record<Kind, string> = { pass: "\x1b[32m", fail: "\x1b[31m", skip: "\x1b[33m", none: "\x1b[33m", step: "\x1b[36m" };

export interface Reporter {
  pass(message: string): void;
  fail(message: string): void;
  skip(message: string): void;
  none(message: string): void;
  step(message: string): void;
  /** True once any failure was reported. */
  readonly failed: boolean;
}

export function createReporter(opts: ReporterOptions = {}): Reporter {
  const out = opts.out ?? process.stdout;
  const err = opts.err ?? process.stderr;
  const env = opts.env ?? process.env;
  const ascii = opts.ascii ?? process.argv.includes("--ascii");
  const noColour = (env.NO_COLOR ?? "") !== "";
  let failed = false;
  const line = (kind: Kind, message: string): void => {
    const stream = kind === "fail" ? err : out;
    const symbol = SYMBOL[kind][ascii ? 1 : 0];
    const coloured = stream.isTTY === true && !noColour;
    const head = coloured ? `${COLOUR[kind]}${symbol}\x1b[0m` : symbol;
    stream.write(`${head} ${WORD[kind]}${message}\n`);
  };
  return {
    pass: (m) => { line("pass", m); },
    fail: (m) => {
      failed = true;
      line("fail", m);
    },
    skip: (m) => { line("skip", m); },
    none: (m) => { line("none", m); },
    step: (m) => { line("step", m); },
    get failed() {
      return failed;
    },
  };
}

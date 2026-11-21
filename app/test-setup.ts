// Loaded before every `bun test` run (bunfig.toml): server tests drive a real HTTP server and the fake
// ComfyUI, so allow for a busy machine.
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(60_000);

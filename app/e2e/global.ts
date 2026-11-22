// Starts the one seeded stack the non-isolated journeys share, and stops it afterwards.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SHARED_FILE, startStack } from "./harness.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack("shared", "default");
  mkdirSync(dirname(SHARED_FILE), { recursive: true });
  writeFileSync(SHARED_FILE, JSON.stringify({ url: stack.url, token: stack.token, root: stack.root, fakeUrl: stack.fakeUrl }));
  return async () => {
    await stack.stop();
  };
}

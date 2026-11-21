// Entry point of the asset-studio executable.
//   asset-studio [serve] [--config /config/config.yaml]
//   asset-studio schema-version
//   asset-studio restore-backup <file> [--config ...]
//   asset-studio seed [--profile default|empty] [--reset] [--config ...]
import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
import { restoreBackup, SCHEMA_VERSION } from "./store.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", default: "/config/config.yaml" },
    profile: { type: "string", default: "default" },
    reset: { type: "boolean", default: false },
  },
});
const command = positionals[0] ?? "serve";

async function main(): Promise<number> {
  switch (command) {
    case "schema-version":
      console.log(String(SCHEMA_VERSION));
      return 0;
    case "restore-backup": {
      const file = positionals[1];
      if (!file) {
        console.error("✗ Failed: restore-backup needs a backup file");
        return 2;
      }
      const config = loadConfig(values.config);
      restoreBackup(config.dataDir, file);
      console.log(`✓ Passed: restored ${file}`);
      return 0;
    }
    case "serve": {
      const { startServer } = await import("./serve.ts");
      const srv = await startServer(loadConfig(values.config));
      console.log(`› Asset Studio listening on ${srv.url}`);
      const stop = (): void => {
        void srv.stop().then(() => process.exit(0));
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      return -1;
    }
    case "seed": {
      const { runSeed } = await import("./seed.ts");
      return runSeed(loadConfig(values.config), { profile: values.profile, reset: values.reset });
    }
    default:
      console.error(`✗ Failed: unknown command ${command}`);
      return 2;
  }
}

const code = await main();
if (code >= 0) process.exit(code);

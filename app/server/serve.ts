// Production wiring: HTTP server, tracker, asset routes and the page.
import type { Config } from "./config.ts";
import { ComfyClient } from "./comfy.ts";
import { assetRoutes } from "./export.ts";
import { createServer, type ExtraRoutes, type RunningServer } from "./http.ts";
import { pageRoute } from "./static.ts";
import { Tracker } from "./tracker.ts";

/** The committed development token; the server refuses it unless ComfyUI is the fake. */
export const DEV_TOKEN = "ZGV2LXRva2VuLW5vdC1mb3ItcHJvZHVjdGlvbi0wMDA";

export async function isFakeComfy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/asset-studio-fake`, { signal: AbortSignal.timeout(3000) });
    return res.ok && ((await res.json()) as { fake?: unknown }).fake === true;
  } catch {
    return false;
  }
}

export async function startServer(config: Config): Promise<RunningServer> {
  if (config.token === DEV_TOKEN && !(await isFakeComfy(config.comfyuiUrl))) {
    throw new Error("the development token only works against the fake ComfyUI; set a real token in config.yaml");
  }
  const assets = assetRoutes(config);
  const routes: ExtraRoutes = { api: (req, url, store) => assets.api?.(req, url, store) ?? null, page: pageRoute };
  return createServer(config, {
    routes,
    tracker: (store) => {
      const t = new Tracker({ store, config, comfy: new ComfyClient(config.comfyuiUrl) });
      t.start();
      return t;
    },
  });
}

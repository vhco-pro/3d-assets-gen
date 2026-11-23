// The phone layout's screen lives in the URL query: ?tab=create (the default), ?tab=queue, ?tab=library and
// ?asset=<job id>. Tab switches replace the history entry; opening an asset from the Library pushes one that
// carries { from: "library" } (feature document asset-studio-mobile, Design > Layout and navigation).

export type Tab = "create" | "queue" | "library";
export const TABS: readonly Tab[] = ["create", "queue", "library"];
export const WIDE_QUERY = "(min-width: 1024px)";

export interface Route {
  tab: Tab;
  /** The job ID of an open asset, or null. */
  asset: string | null;
}

/** Reads the route from a query string. `export=gone` with no tab selects the Library, where the export is. */
export function readRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const asset = q.get("asset");
  const raw = q.get("tab");
  const tab: Tab = raw === "queue" || raw === "library" || raw === "create" ? raw : q.get("export") === "gone" ? "library" : "create";
  return { tab: asset ? "library" : tab, asset: asset || null };
}

export const tabHref = (tab: Tab): string => `/?tab=${tab}`;
export const assetHref = (id: string): string => `/?asset=${encodeURIComponent(id)}`;

/** True when the current history entry was pushed by opening an asset from the Library in this session. */
export function openedFromLibrary(): boolean {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null && (state as { from?: unknown }).from === "library";
}

export function replaceUrl(href: string): void {
  window.history.replaceState(null, "", href);
}

export function pushAsset(id: string): void {
  window.history.pushState({ from: "library" }, "", assetHref(id));
}

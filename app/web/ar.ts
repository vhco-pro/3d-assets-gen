// View in your room (feature document asset-studio-mobile, Design > AR: View in your room). On Android the page
// keeps a fresh signed GLB link and opens Scene Viewer itself, synchronously in the tap; on iPhone model-viewer's
// activateAR() builds a USDZ in the page and opens Quick Look.
import { useEffect, useState } from "react";
import { fetchArLink } from "./api.ts";

export type ArMode = "scene-viewer" | "quick-look";
export const AR_UNAVAILABLE = "AR is not available right now.";
const REFRESH_MS = 10 * 60_000;
const LOW_MS = 5 * 60_000;

/** iOS and iPadOS, including an iPad that reports a Macintosh with touch points. */
export function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Which AR mode model-viewer can activate here: Quick Look on iOS and iPadOS, Scene Viewer otherwise, or none. */
export function arModeOf(canActivate: boolean): ArMode | null {
  if (!canActivate) return null;
  return isAppleMobile() ? "quick-look" : "scene-viewer";
}

/**
 * The Scene Viewer intent, in the format model-viewer 4.4.0 builds (lib/features/ar.js): the signed link resolved
 * against the page's origin and encoded whole as `file`, so `exp` and `sig` stay inside it.
 */
export function sceneViewerIntent(link: string, origin: string, page: string): string {
  const file = encodeURIComponent(new URL(link, origin).toString());
  const fallback = encodeURIComponent(page);
  return `intent://arvr.google.com/scene-viewer/1.2?mode=ar_preferred&disable_occlusion=true&file=${file}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
}

export interface ArLink {
  url: string;
  /** When the link stops working, in milliseconds. */
  expires: number;
}

/**
 * Keeps a signed link for Scene Viewer while the view is open: one on open, one every 10 minutes while the
 * document is visible, and one at once on return to visible when less than 5 minutes are left. Returns the
 * current link, or "failed" when the last fetch failed (the next tick tries again), or null before the first.
 */
export function useArLink(jobId: string, enabled: boolean): ArLink | "failed" | null {
  const [state, setState] = useState<{ jobId: string; link: ArLink | "failed" } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let current: ArLink | null = null;
    const load = (): void => {
      fetchArLink(jobId)
        .then((url) => {
          const exp = Number(new URL(url, window.location.origin).searchParams.get("exp"));
          current = { url, expires: exp * 1000 };
          if (!cancelled) setState({ jobId, link: current });
        })
        .catch(() => {
          current = null;
          if (!cancelled) setState({ jobId, link: "failed" });
        });
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && (!current || current.expires - Date.now() < LOW_MS)) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [jobId, enabled]);
  return enabled && state?.jobId === jobId ? state.link : null;
}

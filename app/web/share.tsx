// Share GLB (feature document asset-studio-mobile, Design > Share GLB): where the browser can share a .glb file,
// the file is fetched when the view opens and shared in the tap, so the gesture still counts. In Chromium-based
// browsers (their canShare answers true for .glb without checking the type, then share refuses it) and wherever
// sharing is refused or missing, Share GLB downloads the file instead.
import { useEffect, useState, type ReactNode } from "react";
import type { Job } from "./api.ts";
import { label } from "./common.tsx";
import { Button } from "./components/ui/button.tsx";

const GLB_TYPE = "model/gltf-binary";
export const SHARE_FAILED = "Sharing did not work. Use Download instead.";
export const SAVED = "Saved to your downloads.";

/** The server's download name (app/server/assets.ts baseName): the slug of the prompt or file name, then the short ID. */
export function glbName(job: Job): string {
  const text = job.kind === "prompt" ? (job.prompt ?? "") : (job.upload ?? "").replace(/\.[^.]*$/, "");
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "asset";
  return `${slug}-${job.id.slice(0, 8)}.glb`;
}

function canShareFiles(files: File[]): boolean {
  return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files });
}

/** Chromium-based browsers (user agent with `Chrome/`) never get the share attempt or the advance fetch. */
const onChromium = (): boolean => /Chrome\//.test(navigator.userAgent);

/** The prepared file: "download" when this browser cannot share it, null while it is being fetched. */
function useShareFile(job: Job): File | "download" | null {
  const [state, setState] = useState<{ id: string; file: File | "download" } | null>(null);
  const id = job.id;
  const name = glbName(job);
  const shareable = !onChromium() && canShareFiles([new File([], name, { type: GLB_TYPE })]);
  useEffect(() => {
    if (!shareable) return;
    const ctrl = new AbortController();
    fetch(`/api/assets/${id}/model.glb`, { credentials: "same-origin", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setState({ id, file: new File([await res.blob()], name, { type: GLB_TYPE }) });
      })
      .catch(() => { if (!ctrl.signal.aborted) setState({ id, file: "download" }); });
    return () => { ctrl.abort(); };
  }, [id, name, shareable]);
  if (!shareable) return "download";
  return state?.id === job.id ? state.file : null;
}

/** The Share GLB button and its message. */
export function ShareButton({ job, size }: { job: Job; size?: "lg" }): ReactNode {
  const file = useShareFile(job);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const download = (): void => {
    window.location.assign(`/api/assets/${job.id}/model.glb`);
    setMessage({ text: SAVED, error: false });
  };
  const onShare = (): void => {
    setMessage(null);
    if (file === null) return;
    if (file === "download" || !canShareFiles([file])) {
      download();
      return;
    }
    // Called synchronously in the tap handler, so the gesture's activation still holds.
    navigator.share({ files: [file], title: label(job) }).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // The browser refuses to share this file: save it instead.
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        download();
        return;
      }
      setMessage({ text: SHARE_FAILED, error: true });
    });
  };
  return (
    <>
      <Button type="button" size={size} disabled={file === null} onClick={onShare}>{file === null ? "Preparing…" : "Share GLB"}</Button>
      {message && (
        <p role={message.error ? "alert" : "status"} data-error={message.error ? "" : undefined} className="col-span-full text-sm">{message.text}</p>
      )}
    </>
  );
}

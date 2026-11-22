import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Job } from "./api.ts";

type Status = "loading" | "ready" | "failed";

/** URL of the viewer entry; the server puts it in <meta name="viewer-src">. */
function viewerSrc(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="viewer-src"]')?.content ?? null;
}

function useViewerModule(attempt: number): Status {
  const [state, setState] = useState<{ attempt: number; status: Status }>({ attempt: -1, status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const src = viewerSrc();
    const load = async (): Promise<void> => {
      if (customElements.get("model-viewer")) return;
      if (!src) throw new Error("viewer URL missing");
      // A fresh query string per retry, because browsers may cache a failed module import.
      await import(/* @vite-ignore */ attempt === 0 ? src : `${src}?attempt=${String(attempt)}`);
    };
    load()
      .then(() => { if (!cancelled) setState({ attempt, status: "ready" }); })
      .catch(() => { if (!cancelled) setState({ attempt, status: "failed" }); });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return state.attempt === attempt ? state.status : "loading";
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => { setReduced(mq.matches); };
    mq.addEventListener("change", onChange);
    return () => { mq.removeEventListener("change", onChange); };
  }, []);
  return reduced;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The preview: a native modal dialog with the viewer, the full prompt, the settings and the downloads. */
export function Viewer({ job, name, onClose }: { job: Job; name: string; onClose: () => void }): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const status = useViewerModule(attempt);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const onCloseEvent = (): void => { onClose(); };
    d.addEventListener("close", onCloseEvent);
    return () => { d.removeEventListener("close", onCloseEvent); };
  }, [onClose]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = (): void => { console.info("asset-studio:viewer-load"); };
    el.addEventListener("load", onLoad);
    return () => { el.removeEventListener("load", onLoad); };
  }, [status, job.id]);
  return (
    <dialog ref={dialog} className="preview" aria-labelledby="viewer-heading">
      <div className="preview-head">
        <h2 id="viewer-heading">Preview</h2>
      </div>
      <div className="preview-body">
        <div className="preview-stage">
          {status === "loading" && <p className="status">Loading the 3D viewer…</p>}
          {status === "failed" && (
            <div className="toolbar">
              <p role="alert" data-error="">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5v4.2M8 11.2v.3" strokeLinecap="round" /></svg>
                <span>The 3D viewer could not load.</span>
              </p>
              <button type="button" onClick={() => { setAttempt((a) => a + 1); }}>Reload viewer</button>
            </div>
          )}
          {status === "ready" && (
            <model-viewer
              ref={ref}
              key={job.id}
              src={`/api/assets/${job.id}/model.glb`}
              alt={name}
              camera-controls=""
              loading="eager"
              interpolation-decay={reduced ? "0" : "200"}
              shadow-intensity="1"
            />
          )}
        </div>
        <p data-testid="full-prompt" className="full-prompt">{name}</p>
        <dl className="facts">
          <div><dt>Detail</dt><dd>{`${String(job.faces / 1000)}k triangles`}</dd></div>
          {job.tex !== null && <div><dt>Texture</dt><dd>{String(job.tex)}</dd></div>}
          <div><dt>Seed</dt><dd className="mono">{String(job.seed)}</dd></div>
          <div><dt>Created</dt><dd>{dateFormat.format(job.createdAt)}</dd></div>
        </dl>
      </div>
      <div className="preview-foot">
        <button type="button" onClick={() => { window.location.assign(`/api/assets/${job.id}/model.glb`); }}>Download GLB</button>
        <button type="button" onClick={() => { dialog.current?.close(); }}>Close</button>
      </div>
    </dialog>
  );
}

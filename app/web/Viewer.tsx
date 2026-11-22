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

export function Viewer({ job, name, onClose }: { job: Job; name: string; onClose: () => void }): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const status = useViewerModule(attempt);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [job.id, reduced]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = (): void => { console.info("asset-studio:viewer-load"); };
    el.addEventListener("load", onLoad);
    return () => { el.removeEventListener("load", onLoad); };
  }, [status, job.id]);
  return (
    <section ref={section} className="panel viewer" aria-labelledby="viewer-heading">
      <div className="library-head">
        <h2 id="viewer-heading">Preview</h2>
        <button type="button" onClick={onClose}>Close preview</button>
      </div>
      <p data-testid="prompt-text" className="prompt">{name}</p>
      {status === "loading" && <p>Loading the 3D viewer…</p>}
      {status === "failed" && (
        <p role="alert" className="error">
          The 3D viewer could not load.{" "}
          <button type="button" onClick={() => { setAttempt((a) => a + 1); }}>Reload viewer</button>
        </p>
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
          style={{ width: "100%", height: "min(60vh, 480px)", background: "#eef0f3" }}
        />
      )}
    </section>
  );
}

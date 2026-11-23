import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Job } from "./api.ts";
import { dateFormat, ErrorText } from "./common.tsx";
import { Button } from "./components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog.tsx";
import { Progress } from "./components/ui/progress.tsx";
import { isUltra } from "../pipeline/presets.ts";
import { formatDuration } from "./queue.ts";

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

/**
 * The 3D stage: loads the viewer module on demand, shows the model with its download progress, and offers
 * Reload viewer when the module fails. Used by the Preview dialog and the phone's Asset page.
 */
export function ModelStage({ job, name, className, children }: { job: Job; name: string; className: string; children?: ReactNode }): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const status = useViewerModule(attempt);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Tests wait for data-loaded; production logs nothing to the console.
    const onLoad = (): void => { el.dataset.loaded = "true"; setLoaded(true); };
    const onProgress = (e: Event): void => { setProgress((e as CustomEvent<{ totalProgress: number }>).detail.totalProgress); };
    el.addEventListener("load", onLoad);
    el.addEventListener("progress", onProgress);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("progress", onProgress);
    };
  }, [status, job.id]);
  return (
    <div className={`preview-stage grid place-items-center overflow-hidden rounded-md ${className}`}>
      {status === "loading" && <p className="text-muted-foreground">Loading the 3D viewer…</p>}
      {status === "failed" && (
        <div className="flex flex-wrap items-center gap-3">
          <ErrorText>The 3D viewer could not load.</ErrorText>
          <Button type="button" onClick={() => { setAttempt((a) => a + 1); }}>Reload viewer</Button>
        </div>
      )}
      {status === "ready" && (
        <div className="relative size-full">
          <model-viewer
            ref={ref}
            key={job.id}
            src={`/api/assets/${job.id}/model.glb`}
            alt={name}
            camera-controls=""
            loading="eager"
            interpolation-decay={reduced ? "0" : "200"}
            shadow-intensity="1"
          >
            {children}
          </model-viewer>
          {!loaded && (
            <div className="absolute inset-x-4 bottom-4 grid gap-1.5" role="status">
              <span className="text-sm text-muted-foreground">{`Loading model… ${String(Math.round(progress * 100))}%`}</span>
              <Progress value={Math.round(progress * 100)} aria-label="Model download" className="h-1.5" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The timing facts of a finished job: how long it waited, generated and took in total. */
export function timing(job: Job): { waited: number | null; generated: number | null; total: number | null } {
  return {
    waited: job.startedAt !== null ? job.startedAt - job.queuedAt : null,
    generated: job.startedAt !== null && job.finishedAt !== null ? job.finishedAt - job.startedAt : null,
    total: job.finishedAt !== null ? job.finishedAt - job.queuedAt : null,
  };
}

/**
 * The preview: a modal dialog (focus trapped; Escape closes it and focus returns to the opener) with the
 * viewer, its download progress, the full prompt, the settings, the timing and the downloads.
 */
export function Viewer({ job, name, opener, onClose }: { job: Job; name: string; opener: HTMLElement | null; onClose: () => void }): ReactNode {
  const { waited, generated, total } = timing(job);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-modal="true" onCloseAutoFocus={(e) => { e.preventDefault(); opener?.focus(); }} className="grid max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-[var(--vh-bg-1)] p-0 sm:max-w-none">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="text-[1.05rem]">Preview</DialogTitle>
          <DialogDescription className="sr-only">The 3D model with its prompt, settings and timing.</DialogDescription>
        </div>
        <div className="grid min-h-0 gap-3.5 overflow-y-auto p-4">
          <ModelStage job={job} name={name} className="h-[clamp(9rem,50dvh,30rem)]" />
          <p data-testid="full-prompt" className="max-w-[72ch] whitespace-pre-wrap [overflow-wrap:anywhere]">{name}</p>
          {job.sharedStyle && <p className="text-sm text-muted-foreground"><span className="font-semibold">Shared style</span>{` ${job.sharedStyle}`}</p>}
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[.95rem] text-muted-foreground">
            <div className="flex gap-1.5"><dt className="font-semibold">Detail</dt><dd className="tabular-nums">{isUltra(job.faces, job.tex) ? "Ultra (30k triangles)" : `${String(job.faces / 1000)}k triangles`}</dd></div>
            {job.tex !== null && <div className="flex gap-1.5"><dt className="font-semibold">Texture</dt><dd className="tabular-nums">{String(job.tex)}</dd></div>}
            <div className="flex gap-1.5"><dt className="font-semibold">Seed</dt><dd className="mono">{String(job.seed)}</dd></div>
            <div className="flex gap-1.5"><dt className="font-semibold">Created</dt><dd>{dateFormat.format(job.createdAt)}</dd></div>
            {waited !== null && <div className="flex gap-1.5"><dt className="font-semibold">Waited</dt><dd className="tabular-nums">{formatDuration(waited)}</dd></div>}
            {generated !== null && <div className="flex gap-1.5"><dt className="font-semibold">Generated in</dt><dd className="tabular-nums">{formatDuration(generated)}</dd></div>}
            {total !== null && <div className="flex gap-1.5"><dt className="font-semibold">Total</dt><dd className="tabular-nums">{formatDuration(total)}</dd></div>}
          </dl>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" onClick={() => { window.location.assign(`/api/assets/${job.id}/model.glb`); }}>Download GLB</Button>
          <Button type="button" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

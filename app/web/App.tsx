import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type SyntheticEvent } from "react";
import { DETAILS, MAX_PROMPT_CHARS, MAX_SEED, MAX_VARIANTS, TEXTURES } from "../pipeline/presets.ts";
import { ApiError, deleteJob, fetchHealth, fetchJobs, fetchSession, jobAction, signIn, startExport, submitImages, submitPrompts, type Job, type PresetsInput } from "./api.ts";
import { Viewer } from "./Viewer.tsx";

const MiB = 1024 * 1024;
const IMAGE_CAP = 200 * MiB;

/** Glossary terms for job states (feature document, Glossary). */
export function stateTerm(job: Job): string {
  switch (job.state) {
    case "pending":
      return "Waiting";
    case "submitted":
      return job.running ? "Generating" : "Queued";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

/** The badge colour key: Generating, Done and Failed are coloured; the other states are neutral (Design > Page). */
function badgeKind(job: Job): string {
  if (job.state === "submitted" && job.running) return "generating";
  if (job.state === "done") return "done";
  if (job.state === "failed") return "failed";
  return "neutral";
}

export function label(job: Job): string {
  return job.kind === "prompt" ? (job.prompt ?? "") : (job.upload ?? "image");
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function ErrorIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4.2M8 11.2v.3" strokeLinecap="round" />
    </svg>
  );
}

/** An error message: a failed outcome, so it uses the danger tint with an icon (Design > Page). A job's stored
 * error is not a live event, so it is not announced as an alert. */
function ErrorText({ children, live = true }: { children: ReactNode; live?: boolean }): ReactNode {
  return (
    <p role={live ? "alert" : undefined} data-error="">
      <ErrorIcon />
      <span>{children}</span>
    </p>
  );
}

function Brand(): ReactNode {
  return (
    <div className="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M12 2.8 20 7.2v9.6l-8 4.4-8-4.4V7.2z" />
        <path d="M4 7.2l8 4.4 8-4.4M12 11.6v9.6" />
      </svg>
      <h1>Asset Studio</h1>
      <span className="mark" translate="no">VH &amp; Co</span>
    </div>
  );
}

export function App(): ReactNode {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2 } } }));
  return (
    <QueryClientProvider client={client}>
      <Gate client={client} />
    </QueryClientProvider>
  );
}

/** Shows sign-in or the studio. Any 401 from a session query stops every query and returns to sign-in. */
function Gate({ client }: { client: QueryClient }): ReactNode {
  const session = useQuery({ queryKey: ["session"], queryFn: ({ signal }) => fetchSession(signal), staleTime: Infinity });
  const [override, setOverride] = useState<boolean | null>(null);
  const signedIn = override ?? session.data ?? null;
  const signOut = (): void => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    setOverride(false);
  };
  if (signedIn === null) return <main className="loading">{session.isError ? "Could not reach Asset Studio." : "Loading…"}</main>;
  if (!signedIn) return <SignIn onSignedIn={() => { setOverride(true); }} />;
  return <Studio onUnauthorised={signOut} />;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }): ReactNode {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: SyntheticEvent): void => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    signIn(token.trim())
      .then(() => { onSignedIn(); })
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 429 ? "Too many wrong tokens. Wait a minute, then try again." : "That access token is not right. Check it and try again.");
      })
      .finally(() => { setBusy(false); });
  };
  return (
    <main className="signin">
      <section className="panel" aria-labelledby="signin-title">
        <Brand />
        <h2 id="signin-title" className="visually-hidden">Sign in</h2>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="token">Access token</label>
          <input id="token" name="token" type="password" autoComplete="current-password" spellCheck={false} value={token} onChange={(e) => { setToken(e.target.value); }} required />
          <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </section>
    </main>
  );
}

function ComfyStatus({ state, version }: { state: string | undefined; version: string | null | undefined }): ReactNode {
  if (state !== "reachable") return null;
  return (
    <p className="comfy">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>
      <span>{`ComfyUI ${version ?? ""} ready`}</span>
    </p>
  );
}

function Studio({ onUnauthorised }: { onUnauthorised: () => void }): ReactNode {
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: async ({ signal }) => {
      try {
        return await fetchJobs(signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onUnauthorised();
        throw e;
      }
    },
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === "pending" || j.state === "submitted") ? 2000 : 15000),
  });
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => fetchHealth(signal), refetchInterval: 5000 });
  const [preview, setPreview] = useState<{ job: Job; opener: HTMLElement | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(() => (new URLSearchParams(window.location.search).get("export") === "gone" ? "The selection changed after the export started. Select the assets again and download them." : null));
  const list = jobs.data ?? [];
  const queue = list.filter((j) => j.state !== "done");
  const library = list.filter((j) => j.state === "done");
  const comfy = health.data?.comfyui;
  const closePreview = (): void => {
    const opener = preview?.opener;
    setPreview(null);
    opener?.focus();
  };
  return (
    <div className="studio">
      <header className="topbar">
        <Brand />
        <ComfyStatus state={comfy} version={health.data?.comfyuiVersion} />
      </header>
      {(comfy === "offline" || comfy === "incompatible" || notice) && (
        <div className="notices">
          {comfy === "offline" && (
            <div data-banner="offline" role="status">
              <strong data-testid="comfy-banner-term">ComfyUI offline</strong>
              <span>Jobs wait until it answers again.</span>
            </div>
          )}
          {comfy === "incompatible" && (
            <div data-banner="incompatible" role="status">
              <strong data-testid="comfy-banner-term">ComfyUI incompatible</strong>
              <span>{`Found ${health.data?.comfyuiVersion ?? "no version"}. Asset Studio needs 0.46.2 or newer and submits nothing until then.`}</span>
            </div>
          )}
          {notice && (
            <div className="toolbar">
              <ErrorText>{notice}</ErrorText>
              <button type="button" onClick={() => { setNotice(null); window.history.replaceState(null, "", "/"); }}>Dismiss</button>
            </div>
          )}
        </div>
      )}
      <main className="layout">
        <Composer />
        <div className="workspace">
          <Queue jobs={queue} loading={jobs.isPending} error={jobs.error} />
          <Library jobs={library} onPreview={(job, opener) => { setPreview({ job, opener }); }} />
        </div>
      </main>
      {preview && <Viewer job={preview.job} name={label(preview.job)} onClose={closePreview} />}
    </div>
  );
}

function Segments({ name, legend, values, value, format, onChange }: { name: string; legend: string; values: readonly number[]; value: number; format: (v: number) => string; onChange: (v: number) => void }): ReactNode {
  const id = `${name}-label`;
  return (
    <div className="row">
      <span className="field-label" id={id}>{legend}</span>
      <div className="segments" role="radiogroup" aria-labelledby={id}>
        {values.map((v) => (
          <label key={v}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => { onChange(v); }} />
            <span>{format(v)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Composer(): ReactNode {
  const qc = useQueryClient();
  const [prompts, setPrompts] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [faces, setFaces] = useState(10000);
  const [tex, setTex] = useState(2048);
  const [variants, setVariants] = useState("1");
  const [style, setStyle] = useState(true);
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const lines = prompts.split("\n").map((l) => l.trim()).filter(Boolean);
  const v = Number(variants);
  const perLine = Number.isInteger(v) && v >= 1 ? Math.min(v, MAX_VARIANTS) : 1;
  // Images win when both are present; the composer says so instead of dropping the prompts silently.
  const count = files.length > 0 ? files.length : lines.length * perLine;
  const mutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!Number.isInteger(v) || v < 1 || v > MAX_VARIANTS) throw new ApiError(400, `Variants must be between 1 and ${String(MAX_VARIANTS)}.`);
      const s = seed.trim() === "" ? null : Number(seed);
      if (s !== null && (!Number.isInteger(s) || s < 0 || s > MAX_SEED)) throw new ApiError(400, `Seed must be empty or a whole number from 0 to ${String(MAX_SEED)}.`);
      const presets: PresetsInput = { faces, tex, variants: v, style, seed: s };
      if (files.length > 0) {
        const total = files.reduce((n, f) => n + f.size, 0);
        if (total > IMAGE_CAP) throw new ApiError(413, "The images in a batch can add up to at most 200 MiB. Remove some and try again.");
        return submitImages(files, presets);
      }
      // Lengths count UTF-16 code units, as the server does.
      const long = lines.findIndex((l) => l.length > MAX_PROMPT_CHARS);
      if (long >= 0) throw new ApiError(400, `Prompt ${String(long + 1)} is longer than ${String(MAX_PROMPT_CHARS)} characters. Shorten it and try again.`);
      return submitPrompts(lines, presets);
    },
    onSuccess: (n) => {
      setError(null);
      setStatus(`${plural(n, "job", "jobs")} added`);
      setPrompts("");
      setFiles([]);
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    },
  });
  const submit = (e: SyntheticEvent): void => {
    e.preventDefault();
    setStatus(null);
    mutation.mutate();
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setOver(false);
    const dropped = [...e.dataTransfer.files].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (dropped.length > 0) setFiles(dropped);
  };
  const generateLabel = count === 0 ? "Generate" : `Generate ${plural(count, "job", "jobs")}`;
  return (
    <section className="panel composer" aria-labelledby="new-batch" data-testid="composer">
      <div className="panel-head">
        <h2 id="new-batch">New batch</h2>
      </div>
      <form onSubmit={submit}>
        <div className="row">
          <label className="field-label" htmlFor="prompts">Prompts</label>
          <textarea id="prompts" name="prompts" rows={5} autoComplete="off" placeholder="A mossy stone well, one prompt per line…" value={prompts} onChange={(e) => { setPrompts(e.target.value); }} />
        </div>
        <div className="row">
          <span className="field-label">Images</span>
          <label className="drop" data-over={over ? "" : undefined} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => { setOver(false); }} onDrop={onDrop}>
            <input id="images" name="images" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Images" onChange={(e) => { setFiles(e.target.files ? [...e.target.files] : []); }} />
            <strong>{files.length > 0 ? plural(files.length, "image chosen", "images chosen") : "Drop images here or choose files"}</strong>
            <span className="hint">PNG, JPEG or WebP, up to 20 MiB each</span>
          </label>
          {files.length > 0 && (
            <>
              <ul className="file-list">
                {files.slice(0, 5).map((f) => <li key={`${f.name}-${String(f.size)}`}>{f.name}</li>)}
                {files.length > 5 && <li>{`and ${String(files.length - 5)} more`}</li>}
              </ul>
              {lines.length > 0 && <p className="hint">Images are added; the prompts above are ignored.</p>}
              <button type="button" onClick={() => { setFiles([]); }}>Clear images</button>
            </>
          )}
        </div>
        <div className="pair">
          <Segments name="detail" legend="Detail" values={DETAILS} value={faces} format={(d) => `${String(d / 1000)}k`} onChange={setFaces} />
          <Segments name="texture" legend="Texture" values={TEXTURES} value={tex} format={String} onChange={setTex} />
        </div>
        <div className="pair">
        <div className="row">
          <label className="field-label" htmlFor="variants">Variants</label>
          <div className="stepper">
            <button type="button" aria-label="Fewer variants" disabled={perLine <= 1} onClick={() => { setVariants(String(Math.max(1, perLine - 1))); }}>−</button>
            <input id="variants" name="variants" type="number" inputMode="numeric" min={1} max={MAX_VARIANTS} value={variants} onChange={(e) => { setVariants(e.target.value); }} />
            <button type="button" aria-label="More variants" disabled={perLine >= MAX_VARIANTS} onClick={() => { setVariants(String(Math.min(MAX_VARIANTS, perLine + 1))); }}>+</button>
          </div>
        </div>
        <div className="row">
          <label className="field-label" htmlFor="seed">Seed</label>
          <input id="seed" name="seed" className="mono" inputMode="numeric" autoComplete="off" placeholder="Random" value={seed} onChange={(e) => { setSeed(e.target.value); }} />
        </div>
        </div>
        <label className="switch">
          <input type="checkbox" role="switch" name="style" checked={style} onChange={(e) => { setStyle(e.target.checked); }} />
          <span>Game-asset style</span>
        </label>
        <button type="submit" data-generate="" disabled={count === 0 || mutation.isPending}>{mutation.isPending ? "Adding…" : generateLabel}</button>
        <div aria-live="polite">
          {error && <ErrorText>{error}</ErrorText>}
          {status && <p role="status" className="status">{status}</p>}
        </div>
      </form>
    </section>
  );
}

function useJobAction(): { run: (fn: () => Promise<void>) => void; error: string | null } {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>): void => {
    setError(null);
    fn()
      .then(() => qc.invalidateQueries({ queryKey: ["jobs"] }))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "That action failed. Try again."); });
  };
  return { run, error };
}

function minutesSince(ms: number | null): string | null {
  if (ms === null) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  return minutes < 1 ? "started under a minute ago" : `started ${plural(minutes, "minute", "minutes")} ago`;
}

/** Prompt text clipped to two lines; when it is clipped, More and Less expand and collapse it in place. */
function ClampedText({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = (): void => { setClipped(el.scrollHeight > el.clientHeight + 1); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [text, open]);
  return (
    <>
      <span ref={ref} data-testid="prompt-text" className={open ? "prompt" : "prompt clamp"} title={text}>{text}</span>
      {(clipped || open) && (
        <button type="button" className="more" aria-expanded={open} onClick={() => { setOpen((o) => !o); }}>{open ? "Less" : "More"}</button>
      )}
    </>
  );
}

function Queue({ jobs, loading, error }: { jobs: Job[]; loading: boolean; error: Error | null }): ReactNode {
  const action = useJobAction();
  const failedLoad = error && !(error instanceof ApiError && error.status === 401);
  if (!loading && !failedLoad && jobs.length === 0 && !action.error) return null;
  return (
    <section className="panel" aria-labelledby="queue-heading" data-testid="queue">
      <div className="panel-head">
        <h2 id="queue-heading">Queue</h2>
        <span className="count">{plural(jobs.length, "job", "jobs")}</span>
      </div>
      {loading && <p className="status">Loading…</p>}
      {failedLoad && <ErrorText>{`Could not load jobs: ${error.message}`}</ErrorText>}
      {action.error && <ErrorText>{action.error}</ErrorText>}
      <ul className="jobs">
        {jobs.map((j) => (
          <li key={j.id} data-testid="job" data-job-id={j.id}>
            <ClampedText text={label(j)} />
            <div className="job-top">
              <span data-testid="job-state" data-badge={badgeKind(j)}>{stateTerm(j)}</span>
              {j.queuePosition !== null && <span className="job-meta">{`#${String(j.queuePosition)} in line`}</span>}
              {j.state === "submitted" && j.running && <span className="job-meta">{minutesSince(j.startedAt)}</span>}
            </div>
            {j.error && <ErrorText live={false}>{j.error}</ErrorText>}
            <div className="actions">
              {(j.state === "pending" || j.state === "submitted") && (
                <button type="button" onClick={() => { action.run(() => jobAction(j.id, "cancel")); }}>Cancel</button>
              )}
              {(j.state === "failed" || j.state === "cancelled") && (
                <>
                  <button type="button" onClick={() => { action.run(() => jobAction(j.id, "retry")); }}>Retry</button>
                  <button type="button" className="delete" onClick={() => { action.run(() => deleteJob(j.id)); }}>Delete</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Library({ jobs, onPreview }: { jobs: Job[]; onPreview: (j: Job, opener: HTMLElement | null) => void }): ReactNode {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const action = useJobAction();
  const live = new Set(jobs.map((j) => j.id));
  const chosen = [...selected].filter((id) => live.has(id));
  const allChosen = jobs.length > 0 && chosen.length === jobs.length;
  const toggle = (id: string, on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const exportSelected = (): void => {
    setError(null);
    startExport(chosen)
      .then((url) => { window.location.assign(url); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "The download could not start. Try again."); });
  };
  return (
    <section className="panel library" aria-labelledby="library-heading">
      <div className="panel-head">
        <h2 id="library-heading">Library</h2>
        <div className="toolbar">
          <span className="count">{plural(jobs.length, "asset", "assets")}</span>
          {jobs.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={allChosen} onChange={(e) => { setSelected(e.target.checked ? new Set(jobs.map((j) => j.id)) : new Set()); }} />
              <span>Select all</span>
            </label>
          )}
          <button type="button" disabled={chosen.length === 0} onClick={exportSelected}>{chosen.length > 0 ? `Download selected (${String(chosen.length)})` : "Download selected"}</button>
        </div>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {action.error && <ErrorText>{action.error}</ErrorText>}
      {jobs.length === 0 && (
        <div className="empty">
          <strong>No assets yet</strong>
          <span>Finished models appear here. Add prompts or images to start a batch.</span>
        </div>
      )}
      <ul className="assets">
        {jobs.map((j) => (
          <li key={j.id} className="asset" data-testid="asset" data-job-id={j.id}>
            <button type="button" className="stage" aria-label={`Preview ${label(j)}`} onClick={(e) => { onPreview(j, e.currentTarget); }}>
              <img src={`/api/assets/${j.id}/thumb`} alt={label(j)} width={256} height={256} loading="lazy" />
            </button>
            <ClampedName text={label(j)} />
            <div className="asset-foot">
              <span data-testid="job-state" data-badge="done">{stateTerm(j)}</span>
              <label className="check">
                <input type="checkbox" checked={selected.has(j.id)} onChange={(e) => { toggle(j.id, e.target.checked); }} aria-label={`Select ${label(j)}`} />
                <span>Select</span>
              </label>
            </div>
            <div className="actions">
              <button type="button" aria-label={`Download ${label(j)}`} onClick={() => { window.location.assign(`/api/assets/${j.id}/model.glb`); }}>Download</button>
              <button type="button" className="delete" aria-label={`Delete ${label(j)}`} onClick={() => { action.run(() => deleteJob(j.id)); }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A card's name: two lines at most, the full text as title and accessible name; the dialog shows all of it. */
function ClampedName({ text }: { text: string }): ReactNode {
  return <span data-testid="prompt-text" className="prompt clamp" title={text}>{text}</span>;
}

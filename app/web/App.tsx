import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { DETAILS, MAX_SEED, MAX_VARIANTS } from "../pipeline/presets.ts";
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

function label(job: Job): string {
  return job.kind === "prompt" ? (job.prompt ?? "") : (job.upload ?? "image");
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
        setError(err instanceof ApiError && err.status === 429 ? "Too many wrong tokens; wait a minute and try again." : "That access token is not right.");
      })
      .finally(() => { setBusy(false); });
  };
  return (
    <main className="signin">
      <h1>Asset Studio</h1>
      <form onSubmit={submit}>
        <label htmlFor="token">Access token</label>
        <input id="token" type="password" autoComplete="current-password" value={token} onChange={(e) => { setToken(e.target.value); }} required />
        <button type="submit" disabled={busy}>Sign in</button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </main>
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
  const [preview, setPreview] = useState<Job | null>(null);
  const [notice, setNotice] = useState<string | null>(() => (new URLSearchParams(window.location.search).get("export") === "gone" ? "The selection changed after the export started; select the assets again and export." : null));
  const list = jobs.data ?? [];
  const queue = list.filter((j) => j.state !== "done");
  const library = list.filter((j) => j.state === "done");
  return (
    <div className="studio">
      <header>
        <h1>Asset Studio</h1>
        {health.data && health.data.comfyui !== "reachable" && (
          <div className="banner" role="status">
            <strong data-testid="comfy-banner-term">{health.data.comfyui === "offline" ? "ComfyUI offline" : "ComfyUI incompatible"}</strong>
            <span>
              {health.data.comfyui === "offline"
                ? " Jobs wait until it answers again."
                : ` Found ${health.data.comfyuiVersion ?? "no version"}; Asset Studio needs 0.46.2 or newer. Nothing is submitted until then.`}
            </span>
          </div>
        )}
      </header>
      {notice && (
        <p role="alert" className="error">
          {notice}{" "}
          <button type="button" onClick={() => { setNotice(null); window.history.replaceState(null, "", "/"); }}>Dismiss</button>
        </p>
      )}
      <main className="columns">
        <SubmitForm />
        <Queue jobs={queue} loading={jobs.isPending} error={jobs.error} />
        <Library jobs={library} onPreview={setPreview} />
        {preview && <Viewer job={preview} name={label(preview)} onClose={() => { setPreview(null); }} />}
      </main>
    </div>
  );
}

function SubmitForm(): ReactNode {
  const qc = useQueryClient();
  const [prompts, setPrompts] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [faces, setFaces] = useState(10000);
  const [tex, setTex] = useState(2048);
  const [variants, setVariants] = useState("1");
  const [style, setStyle] = useState(true);
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (): Promise<number> => {
      const v = Number(variants);
      if (!Number.isInteger(v) || v < 1 || v > MAX_VARIANTS) throw new ApiError(400, `Variants must be between 1 and ${String(MAX_VARIANTS)}.`);
      const s = seed.trim() === "" ? null : Number(seed);
      if (s !== null && (!Number.isInteger(s) || s < 0 || s > MAX_SEED)) throw new ApiError(400, `Seed must be empty or a whole number from 0 to ${String(MAX_SEED)}.`);
      const presets: PresetsInput = { faces, tex, variants: v, style, seed: s };
      if (files.length > 0) {
        const total = files.reduce((n, f) => n + f.size, 0);
        if (total > IMAGE_CAP) throw new ApiError(413, "The images in a batch can add up to at most 200 MiB.");
        return submitImages(files, presets);
      }
      const lines = prompts.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) throw new ApiError(400, "Add at least one prompt or image.");
      return submitPrompts(lines, presets);
    },
    onSuccess: (n) => {
      setError(null);
      setStatus(`${String(n)} ${n === 1 ? "job" : "jobs"} added`);
      setPrompts("");
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    },
  });
  const submit = (e: SyntheticEvent): void => {
    e.preventDefault();
    setStatus(null);
    mutation.mutate();
  };
  return (
    <section className="panel submit" aria-labelledby="new-batch">
      <h2 id="new-batch">New batch</h2>
      <form onSubmit={submit}>
        <label htmlFor="prompts">Prompts</label>
        <textarea id="prompts" rows={5} placeholder="One prompt per line" value={prompts} onChange={(e) => { setPrompts(e.target.value); }} />
        <label htmlFor="images">Images</label>
        <input id="images" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => { setFiles(e.target.files ? [...e.target.files] : []); }} />
        <div className="grid">
          <label htmlFor="detail">Detail</label>
          <select id="detail" value={faces} onChange={(e) => { setFaces(Number(e.target.value)); }}>
            {DETAILS.map((d) => (
              <option key={d} value={d}>{`${String(d / 1000)}k triangles`}</option>
            ))}
          </select>
          <label htmlFor="texture">Texture</label>
          <select id="texture" value={tex} onChange={(e) => { setTex(Number(e.target.value)); }}>
            <option value={1024}>1024</option>
            <option value={2048}>2048</option>
          </select>
          <label htmlFor="variants">Variants</label>
          <input id="variants" type="number" min={1} max={MAX_VARIANTS} value={variants} onChange={(e) => { setVariants(e.target.value); }} />
          <label htmlFor="seed">Seed</label>
          <input id="seed" inputMode="numeric" placeholder="random" value={seed} onChange={(e) => { setSeed(e.target.value); }} />
        </div>
        <label className="check">
          <input type="checkbox" checked={style} onChange={(e) => { setStyle(e.target.checked); }} />
          <span>Game-asset style</span>
        </label>
        <button type="submit" disabled={mutation.isPending}>Generate</button>
        {error && <p role="alert" className="error">{error}</p>}
        {status && <p role="status" className="ok">{status}</p>}
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
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "Something went wrong."); });
  };
  return { run, error };
}

function Queue({ jobs, loading, error }: { jobs: Job[]; loading: boolean; error: Error | null }): ReactNode {
  const action = useJobAction();
  return (
    <section className="panel" aria-labelledby="queue-heading">
      <h2 id="queue-heading">Queue</h2>
      {loading && <p>Loading…</p>}
      {error && !(error instanceof ApiError && error.status === 401) && <p role="alert" className="error">{`Could not load jobs: ${error.message}`}</p>}
      {!loading && jobs.length === 0 && <p className="muted">Nothing waiting.</p>}
      {action.error && <p role="alert" className="error">{action.error}</p>}
      <ul className="jobs">
        {jobs.map((j) => (
          <li key={j.id} data-testid="job" data-job-id={j.id}>
            <span data-testid="prompt-text" className="prompt">{label(j)}</span>
            <span className="meta">
              <span data-testid="job-state" className={`state state-${j.state}`}>{stateTerm(j)}</span>
              {j.queuePosition !== null && <span className="position">{` #${String(j.queuePosition)} in line`}</span>}
            </span>
            {j.error && <span className="job-error">{j.error}</span>}
            <span className="actions">
              {(j.state === "pending" || j.state === "submitted") && (
                <button type="button" onClick={() => { action.run(() => jobAction(j.id, "cancel")); }}>Cancel</button>
              )}
              {(j.state === "failed" || j.state === "cancelled") && (
                <>
                  <button type="button" onClick={() => { action.run(() => jobAction(j.id, "retry")); }}>Retry</button>
                  <button type="button" onClick={() => { action.run(() => deleteJob(j.id)); }}>Delete</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Library({ jobs, onPreview }: { jobs: Job[]; onPreview: (j: Job) => void }): ReactNode {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const action = useJobAction();
  const live = new Set(jobs.map((j) => j.id));
  const chosen = [...selected].filter((id) => live.has(id));
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
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "The export failed."); });
  };
  return (
    <section className="panel library" aria-labelledby="library-heading">
      <div className="library-head">
        <h2 id="library-heading">Library</h2>
        <button type="button" disabled={chosen.length === 0} onClick={exportSelected}>Download selected</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {action.error && <p role="alert" className="error">{action.error}</p>}
      {jobs.length === 0 && <p className="muted">No assets yet</p>}
      <ul className="assets">
        {jobs.map((j) => (
          <li key={j.id} data-testid="asset" data-job-id={j.id}>
            <img src={`/api/assets/${j.id}/thumb`} alt={label(j)} width={128} height={128} />
            <span data-testid="prompt-text" className="prompt">{label(j)}</span>
            <span data-testid="job-state" className="state state-done">{stateTerm(j)}</span>
            <label className="check">
              <input type="checkbox" checked={selected.has(j.id)} onChange={(e) => { toggle(j.id, e.target.checked); }} aria-label={`Select ${label(j)}`} />
              <span>Select</span>
            </label>
            <span className="actions">
              <button type="button" aria-label={`Preview ${label(j)}`} onClick={() => { onPreview(j); }}>Preview</button>
              <button type="button" aria-label={`Download ${label(j)}`} onClick={() => { window.location.assign(`/api/assets/${j.id}/model.glb`); }}>Download</button>
              <button type="button" aria-label={`Delete ${label(j)}`} onClick={() => { action.run(() => deleteJob(j.id)); }}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

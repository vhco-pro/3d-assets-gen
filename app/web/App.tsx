import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, ChevronDown, Images } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type SyntheticEvent } from "react";
import { DEFAULT_QUALITY, DEFAULT_SHARED_STYLE, MAX_PROMPT_CHARS, MAX_SEED, MAX_SHARED_STYLE_CHARS, MAX_VARIANTS, QUALITIES, qualityByName, remixQuality, type QualityName } from "../pipeline/presets.ts";
import { ApiError, deleteJob, fetchHealth, fetchJobs, fetchSession, jobAction, signIn, submitImages, submitPrompts, type Job, type PresetsInput } from "./api.ts";
import { AssetGone, AssetPage, GONE_MESSAGE } from "./AssetPage.tsx";
import { ErrorText, label, plural, qualityText, StateBadge, useSelection } from "./common.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Checkbox } from "./components/ui/checkbox.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible.tsx";
import { Input } from "./components/ui/input.tsx";
import { Progress } from "./components/ui/progress.tsx";
import { Switch } from "./components/ui/switch.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group.tsx";
import { openedFromLibrary, pushAsset, readRoute, replaceUrl, tabHref, WIDE_QUERY, type Route, type Tab } from "./nav.ts";
import { estimates, formatDuration } from "./queue.ts";
import { PhoneLibrary, PhoneShell } from "./Shell.tsx";
import { Viewer } from "./Viewer.tsx";

export { label, stateTerm } from "./common.tsx";

const MiB = 1024 * 1024;
const IMAGE_CAP = 200 * MiB;
const SHARED_KEY = "asset-studio:shared-style";
const EXPORT_NOTICE = "The selection changed after the export started. Select the assets again and download them.";

function Brand(): ReactNode {
  return (
    <div className="flex items-center gap-2.5">
      <Box size={22} aria-hidden="true" strokeWidth={1.5} />
      <h1 className="text-[1.2rem] font-semibold tracking-tight">Asset Studio</h1>
      <span className="border-l border-border pl-2.5 text-sm text-muted-foreground" translate="no">VH &amp; Co</span>
    </div>
  );
}

/** Re-renders every second so elapsed times move between job-list refreshes. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(t); };
  }, []);
  return now;
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
  if (signedIn === null) return <main className="grid min-h-screen place-items-center text-muted-foreground">{session.isError ? "Could not reach Asset Studio." : "Loading…"}</main>;
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
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="grid w-full max-w-sm gap-4 p-6" aria-labelledby="signin-title">
        <Brand />
        <h2 id="signin-title" className="sr-only">Sign in</h2>
        <form onSubmit={submit} className="grid gap-3">
          <label className="font-semibold" htmlFor="token">Access token</label>
          <Input id="token" name="token" type="password" autoComplete="current-password" spellCheck={false} value={token} onChange={(e) => { setToken(e.target.value); }} required />
          <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Card>
    </main>
  );
}

/** One notice with a Dismiss button, in the banner area above the content. */
function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ErrorText>{text}</ErrorText>
      <Button type="button" onClick={onDismiss}>Dismiss</Button>
    </div>
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
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [route, setRoute] = useState<Route>(() => readRoute(window.location.search));
  const [preview, setPreview] = useState<{ job: Job; opener: HTMLElement | null } | null>(null);
  // The export notice is read once, on load; the address loses its marker at once (below).
  const [notice, setNotice] = useState<string | null>(() => (new URLSearchParams(window.location.search).get("export") === "gone" ? EXPORT_NOTICE : null));
  // Remix remounts the composer with the asset's prompt and settings.
  const [remix, setRemix] = useState<{ seq: number; draft: Draft | null }>({ seq: 0, draft: null });
  const previewOpen = useRef(false);
  useEffect(() => {
    previewOpen.current = preview !== null;
  }, [preview]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("export")) return;
    replaceUrl(window.matchMedia(WIDE_QUERY).matches ? "/" : tabHref(readRoute(window.location.search).tab));
  }, []);

  useEffect(() => {
    const onPop = (): void => { setRoute(readRoute(window.location.search)); };
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); };
  }, []);

  useEffect(() => {
    // Crossing 1024 pixels closes any open asset view, without a history entry.
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = (): void => {
      const open = previewOpen.current || new URLSearchParams(window.location.search).has("asset");
      setWide(mq.matches);
      setPreview(null);
      if (open) {
        replaceUrl(tabHref("library"));
        setRoute({ tab: "library", asset: null });
      }
    };
    mq.addEventListener("change", onChange);
    return () => { mq.removeEventListener("change", onChange); };
  }, []);

  const list = jobs.data ?? [];
  const done = list.filter((j) => j.state === "done");
  const comfy = health.data?.comfyui;
  const assetJob = route.asset ? (done.find((j) => j.id === route.asset) ?? null) : null;
  const assetGone = route.asset !== null && !jobs.isPending && assetJob === null;

  const goTab = (tab: Tab): void => {
    replaceUrl(tabHref(tab));
    setRoute({ tab, asset: null });
  };
  const openAsset = (job: Job): void => {
    pushAsset(job.id);
    setRoute({ tab: "library", asset: job.id });
  };
  /** Back to the Library: history.back() when the Library pushed this entry, otherwise replace the address. */
  const toLibrary = (fallback: string, next: Route): void => {
    if (openedFromLibrary()) {
      window.history.back();
      return;
    }
    replaceUrl(fallback);
    setRoute(next);
  };
  const phoneLibrary = (): void => { toLibrary(tabHref("library"), { tab: "library", asset: null }); };
  const startRemix = (job: Job): void => {
    const draft = draftFrom(job);
    if (draft.sharedStyle !== undefined) saveShared(draft.sharedStyle);
    setRemix((r) => ({ seq: r.seq + 1, draft }));
  };
  const closeLinkedAsset = (): void => { toLibrary("/", { tab: "create", asset: null }); };

  const banners = (comfy === "offline" || comfy === "incompatible" || notice || (wide && assetGone)) && (
    <div className="mx-auto grid w-full max-w-[90rem] gap-2 px-4 pt-3">
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
      {notice && <Notice text={notice} onDismiss={() => { setNotice(null); }} />}
      {wide && assetGone && <Notice text={GONE_MESSAGE} onDismiss={closeLinkedAsset} />}
    </div>
  );

  if (!wide) {
    let content: ReactNode;
    if (route.asset !== null) {
      content = assetJob ? <AssetPage job={assetJob} onLibrary={phoneLibrary} onRemix={() => { startRemix(assetJob); goTab("create"); }} /> : assetGone ? <AssetGone onLibrary={phoneLibrary} /> : <p className="text-muted-foreground">Loading…</p>;
    } else if (route.tab === "queue") {
      content = <section data-screen="queue"><Queue jobs={list} loading={jobs.isPending} error={jobs.error} showEmpty /></section>;
    } else if (route.tab === "library") {
      content = <PhoneLibrary jobs={done} onOpen={openAsset} />;
    } else {
      content = <section data-screen="create"><Composer key={remix.seq} draft={remix.draft} /></section>;
    }
    return (
      <PhoneShell tab={route.asset !== null ? "library" : route.tab} onTab={goTab} onAssetBack={route.asset !== null ? phoneLibrary : null} banners={banners}>
        {content}
      </PhoneShell>
    );
  }

  const dialog = preview ?? (assetJob ? { job: assetJob, opener: null } : null);
  return (
    <div>
      <a className="skip" href="#library-heading">Skip to library</a>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <Brand />
        {comfy === "reachable" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-current" aria-hidden="true" />
            <span>{`ComfyUI ${health.data?.comfyuiVersion ?? ""} ready`}</span>
          </p>
        )}
      </header>
      {banners}
      <main className="layout">
        <Composer key={remix.seq} draft={remix.draft} />
        <div className="grid min-w-0 gap-5">
          <Queue jobs={list} loading={jobs.isPending} error={jobs.error} />
          <Library jobs={done} onPreview={(job, opener) => { setPreview({ job, opener }); }} />
        </div>
      </main>
      {dialog && (
        <Viewer
          job={dialog.job}
          name={label(dialog.job)}
          opener={dialog.opener}
          onClose={() => { if (preview) setPreview(null); else closeLinkedAsset(); }}
          onRemix={() => { startRemix(dialog.job); if (preview) setPreview(null); else closeLinkedAsset(); }}
        />
      )}
    </div>
  );
}

function readShared(): string {
  try {
    return window.localStorage.getItem(SHARED_KEY) ?? DEFAULT_SHARED_STYLE;
  } catch {
    return DEFAULT_SHARED_STYLE;
  }
}

export function saveShared(value: string): void {
  try {
    window.localStorage.setItem(SHARED_KEY, value);
  } catch {
    // An unavailable store only means the field starts from the default next time.
  }
}

/** What Remix copies into Create: an image asset fills only Quality and Game-asset style. */
interface Draft {
  prompt?: string;
  quality: QualityName;
  style: boolean;
  sharedStyle?: string;
}

function draftFrom(job: Job): Draft {
  const quality = remixQuality(job.faces, job.tex);
  if (job.kind === "image") return { quality, style: job.style };
  return { prompt: job.prompt ?? "", quality, style: job.style, sharedStyle: job.sharedStyle ?? "" };
}

/** Quality: one segmented radio group with the four levels (asset-studio-mobile, Design > Quality). */
function QualityControl({ value, onChange }: { value: QualityName; onChange: (q: QualityName) => void }): ReactNode {
  return (
    <div className="col-span-full grid gap-1.5">
      <span className="font-semibold" id="quality-label">Quality</span>
      <ToggleGroup type="single" variant="outline" aria-labelledby="quality-label" value={value} onValueChange={(v) => { const q = QUALITIES.find((x) => x.name === v); if (q) onChange(q.name); }} className="w-fit flex-wrap">
        {QUALITIES.map((q) => (
          <ToggleGroupItem key={q.name} value={q.name} className="min-w-16">{q.name}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function Composer({ draft }: { draft: Draft | null }): ReactNode {
  const qc = useQueryClient();
  const [prompts, setPrompts] = useState(draft?.prompt ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [quality, setQuality] = useState<QualityName>(draft?.quality ?? DEFAULT_QUALITY);
  const { faces, tex } = qualityByName(quality);
  const [variants, setVariants] = useState("1");
  const [style, setStyle] = useState(draft?.style ?? true);
  const [seed, setSeed] = useState("");
  const [shared, setShared] = useState(() => draft?.sharedStyle ?? readShared());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const lines = prompts.split("\n").map((l) => l.trim()).filter(Boolean);
  const v = Number(variants);
  const perLine = Number.isInteger(v) && v >= 1 ? Math.min(v, MAX_VARIANTS) : 1;
  // Images win when both are present; the composer says so instead of dropping the prompts silently.
  const count = files.length > 0 ? files.length : lines.length * perLine;
  const updateShared = (value: string): void => {
    setShared(value);
    saveShared(value);
  };
  const mutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!Number.isInteger(v) || v < 1 || v > MAX_VARIANTS) throw new ApiError(400, `Variants must be between 1 and ${String(MAX_VARIANTS)}.`);
      const s = seed.trim() === "" ? null : Number(seed);
      if (s !== null && (!Number.isInteger(s) || s < 0 || s > MAX_SEED)) throw new ApiError(400, `Seed must be empty or a whole number from 0 to ${String(MAX_SEED)}.`);
      if (files.length > 0) {
        const total = files.reduce((n, f) => n + f.size, 0);
        if (total > IMAGE_CAP) throw new ApiError(413, "The images in a batch can add up to at most 200 MiB. Remove some and try again.");
        return submitImages(files, { faces, tex, variants: v, style, seed: s });
      }
      // Lengths count UTF-16 code units, as the server does.
      const long = lines.findIndex((l) => l.length > MAX_PROMPT_CHARS);
      if (long >= 0) throw new ApiError(400, `Prompt ${String(long + 1)} is longer than ${String(MAX_PROMPT_CHARS)} characters. Shorten it and try again.`);
      const presets: PresetsInput = { faces, tex, variants: v, style, seed: s, sharedStyle: shared.trim() === "" ? null : shared.trim() };
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
    <Card className="composer gap-0 p-4" aria-labelledby="new-batch" data-testid="composer">
      <h2 id="new-batch" className="mb-3 text-[1.05rem] font-semibold">New batch</h2>
      <form onSubmit={submit} className="grid gap-3.5">
        <div className="grid gap-1.5">
          <label className="font-semibold" htmlFor="prompts">Prompts</label>
          <Textarea id="prompts" name="prompts" rows={4} autoComplete="off" placeholder="A mossy stone well, one prompt per line…" value={prompts} onChange={(e) => { setPrompts(e.target.value); }} className="min-h-24 text-[15px]" />
        </div>
        <div className="grid gap-1.5">
          <span className="font-semibold">Images</span>
          <label
            className="relative grid cursor-pointer place-items-center gap-0.5 rounded-md border border-dashed border-input bg-black/20 p-3 text-center hover:bg-vh-control-bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring data-[over]:border-ring"
            data-over={over ? "" : undefined}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => { setOver(false); }}
            onDrop={onDrop}
          >
            <input id="images" name="images" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Images" className="sr-only" onChange={(e) => { setFiles(e.target.files ? [...e.target.files] : []); }} />
            <span className="flex items-center gap-2 font-semibold"><Images size={16} aria-hidden="true" />{files.length > 0 ? plural(files.length, "image chosen", "images chosen") : "Drop images here or choose files"}</span>
            <span className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 20 MiB each</span>
          </label>
          {files.length > 0 && (
            <div className="grid gap-1.5">
              <ul className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {files.slice(0, 5).map((f) => <li key={`${f.name}-${String(f.size)}`}>{f.name}</li>)}
                {files.length > 5 && <li>{`and ${String(files.length - 5)} more`}</li>}
              </ul>
              {lines.length > 0 && <p className="text-sm text-muted-foreground">Images are added; the prompts above are ignored.</p>}
              <Button type="button" className="justify-self-start" onClick={() => { setFiles([]); }}>Clear images</Button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-x-4 gap-y-3.5">
          <QualityControl value={quality} onChange={setQuality} />
          {quality === "Ultra" && <p className="col-span-full text-sm text-muted-foreground">Ultra: best quality, about 10 min per job.</p>}
          <div className="grid gap-1.5">
            <label className="font-semibold" htmlFor="variants">Variants</label>
            <div className="flex gap-1.5">
              <Button type="button" size="icon" aria-label="Fewer variants" disabled={perLine <= 1} onClick={() => { setVariants(String(Math.max(1, perLine - 1))); }}>−</Button>
              <Input id="variants" name="variants" type="number" inputMode="numeric" min={1} max={MAX_VARIANTS} value={variants} onChange={(e) => { setVariants(e.target.value); }} className="w-16 text-center tabular-nums" />
              <Button type="button" size="icon" aria-label="More variants" disabled={perLine >= MAX_VARIANTS} onClick={() => { setVariants(String(Math.min(MAX_VARIANTS, perLine + 1))); }}>+</Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <label className="font-semibold" htmlFor="seed">Seed</label>
            <Input id="seed" name="seed" className="mono" inputMode="numeric" autoComplete="off" placeholder="Random" value={seed} onChange={(e) => { setSeed(e.target.value); }} />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Switch id="style" checked={style} onCheckedChange={setStyle} />
          <label className="font-semibold" htmlFor="style">Game-asset style</label>
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="font-semibold" htmlFor="shared-style">Shared style</label>
            <Button type="button" size="sm" disabled={files.length > 0 || shared === DEFAULT_SHARED_STYLE} onClick={() => { updateShared(DEFAULT_SHARED_STYLE); }}>Reset</Button>
          </div>
          <Textarea id="shared-style" name="shared-style" rows={2} maxLength={MAX_SHARED_STYLE_CHARS} autoComplete="off" disabled={files.length > 0} value={shared} onChange={(e) => { updateShared(e.target.value); }} className="min-h-14 text-[15px]" />
          {files.length > 0 && <p className="text-sm text-muted-foreground">Shared style applies to prompts only.</p>}
        </div>
        <Button type="submit" variant="generate" size="lg" data-generate="" disabled={count === 0 || mutation.isPending} className="w-full">{mutation.isPending ? "Adding…" : generateLabel}</Button>
        <div aria-live="polite">
          {error && <ErrorText>{error}</ErrorText>}
          {status && <p role="status" className="text-muted-foreground">{status}</p>}
        </div>
      </form>
    </Card>
  );
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
    <div className="grid min-w-0 gap-1">
      <span ref={ref} data-testid="prompt-text" className={open ? "prompt" : "prompt clamp"} title={text}>{text}</span>
      {(clipped || open) && (
        <Button type="button" size="sm" className="justify-self-start" aria-expanded={open} onClick={() => { setOpen((o) => !o); }}>{open ? "Less" : "More"}</Button>
      )}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }): ReactNode {
  return <span className="rounded-[var(--vh-radius-badge)] border border-border px-1.5 text-sm tabular-nums text-muted-foreground">{children}</span>;
}

type Estimates = ReturnType<typeof estimates>;

function JobRow({ job, est, now, onAction }: { job: Job; est: Estimates; now: number; onAction: (fn: () => Promise<void>) => void }): ReactNode {
  const e = est.jobs.get(job.id);
  const unfinished = job.state === "pending" || job.state === "submitted";
  return (
    <li data-testid="job" data-job-id={job.id} className="flex min-w-0 gap-3 rounded-md border border-border bg-white/[.02] p-3">
      <div className="stage size-16 flex-none overflow-hidden rounded-md">
        {job.sourceReady && <img src={`/api/jobs/${job.id}/source-preview`} alt={`Source of ${label(job)}`} width={64} height={64} loading="lazy" className="size-full object-cover" />}
      </div>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <ClampedText text={label(job)} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StateBadge job={job} />
          <Chip>{qualityText(job)}</Chip>
          <Chip><span className="mono">{`seed ${String(job.seed)}`}</span></Chip>
        </div>
        {unfinished && (
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {job.state === "submitted" && job.running && job.startedAt !== null ? (
              <span>{`Generating for ${formatDuration(now - job.startedAt)}`}</span>
            ) : (
              <span>{`Added ${formatDuration(now - job.queuedAt)} ago`}</span>
            )}
            {job.queuePosition !== null && <span>{`#${String(job.queuePosition)} in line`}</span>}
            {e?.startsIn !== null && e?.startsIn !== undefined && <span>{`Starts in about ${formatDuration(e.startsIn)}`}</span>}
            {e?.left !== null && e?.left !== undefined && <span>{e.overTypical ? "taking longer than usual" : `about ${formatDuration(e.left)} left`}</span>}
          </p>
        )}
        {e?.progress !== null && e?.progress !== undefined && <Progress value={Math.round(e.progress * 100)} aria-label={`Progress of ${label(job)}`} className="h-1.5" />}
        {job.error && <ErrorText live={false}>{job.error}</ErrorText>}
        <div className="flex flex-wrap gap-1.5">
          {unfinished && <Button type="button" size="sm" onClick={() => { onAction(() => jobAction(job.id, "cancel")); }}>Cancel</Button>}
          {(job.state === "failed" || job.state === "cancelled") && (
            <>
              <Button type="button" size="sm" onClick={() => { onAction(() => jobAction(job.id, "retry")); }}>Retry</Button>
              <Button type="button" size="sm" variant="delete" onClick={() => { onAction(() => deleteJob(job.id)); }}>Delete</Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function BatchGroup({ jobs, all, est, now, open, onOpenChange }: { jobs: Job[]; all: Job[]; est: Estimates; now: number; open: boolean; onOpenChange: (open: boolean) => void }): ReactNode {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [first] = all;
  const done = all.filter((j) => j.state === "done").length;
  const unfinished = all.filter((j) => j.state === "pending" || j.state === "submitted");
  const retryable = all.filter((j) => j.state === "failed" || j.state === "cancelled");
  // Batch actions go one job at a time, continue past a refusal and report how many were refused.
  const runEach = async (targets: Job[], fn: (id: string) => Promise<void>, verb: string): Promise<void> => {
    setBusy(true);
    setError(null);
    let refused = 0;
    for (const j of targets) {
      try {
        await fn(j.id);
      } catch {
        refused += 1;
      }
    }
    setBusy(false);
    if (refused > 0) setError(`${String(refused)} of ${plural(targets.length, "job", "jobs")} could not be ${verb}.`);
    await qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const action = (fn: () => Promise<void>): void => {
    setError(null);
    fn()
      .then(() => qc.invalidateQueries({ queryKey: ["jobs"] }))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "That action failed. Try again."); });
  };
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <li data-testid="batch" className="grid gap-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CollapsibleTrigger asChild>
            <Button type="button" size="icon-sm" aria-label={open ? "Collapse batch" : "Expand batch"}>
              <ChevronDown aria-hidden="true" className={open ? "rotate-180" : undefined} />
            </Button>
          </CollapsibleTrigger>
          <span className="clamp min-w-0 flex-1 font-semibold" title={first ? label(first) : ""}>{first ? label(first) : ""}</span>
          <span className="text-sm tabular-nums text-muted-foreground">{`${String(done)} of ${String(all.length)} done`}</span>
          {unfinished.length > 0 && <Button type="button" size="sm" disabled={busy} onClick={() => { void runEach(unfinished, (id) => jobAction(id, "cancel"), "cancelled"); }}>Cancel all</Button>}
          {retryable.length > 0 && <Button type="button" size="sm" disabled={busy} onClick={() => { void runEach(retryable, (id) => jobAction(id, "retry"), "retried"); }}>Retry failed</Button>}
        </div>
        <Progress value={Math.round((done / Math.max(1, all.length)) * 100)} aria-label="Batch progress" className="h-1.5" />
        {error && <ErrorText>{error}</ErrorText>}
        <CollapsibleContent asChild>
          <ul className="grid gap-2">
            {jobs.map((j) => <JobRow key={j.id} job={j} est={est} now={now} onAction={action} />)}
          </ul>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

function Queue({ jobs, loading, error, showEmpty = false }: { jobs: Job[]; loading: boolean; error: Error | null; showEmpty?: boolean }): ReactNode {
  const now = useNow();
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  // A group's first state comes from whether it had unfinished jobs when it first appeared; after that the
  // user's choice (or that first state) is kept across refreshes, so a batch finishing does not collapse it.
  const [firstOpen, setFirstOpen] = useState<Record<string, boolean>>({});
  const rows = jobs.filter((j) => j.state !== "done");
  const failedLoad = error && !(error instanceof ApiError && error.status === 401);
  if (!loading && !failedLoad && rows.length === 0) {
    // The desktop queue hides when empty; the phone's Queue screen says so instead.
    return showEmpty ? <Card className="p-4 text-muted-foreground" data-testid="queue">Nothing in the queue.</Card> : null;
  }
  const est = estimates(jobs.map((j) => ({ id: j.id, state: j.state, running: j.running, queuePosition: j.queuePosition, faces: j.faces, tex: j.tex, queuedAt: j.queuedAt, startedAt: j.startedAt, finishedAt: j.finishedAt })), now);
  const batches: string[] = [];
  for (const j of rows) if (!batches.includes(j.batchId)) batches.push(j.batchId);
  const unseen = batches.filter((b) => !(b in firstOpen));
  if (unseen.length > 0) {
    setFirstOpen((f) => ({ ...f, ...Object.fromEntries(unseen.map((b) => [b, jobs.some((j) => j.batchId === b && (j.state === "pending" || j.state === "submitted"))])) }));
  }
  const count = (pred: (j: Job) => boolean): number => rows.filter(pred).length;
  const counts: [string, number][] = [
    ["Generating", count((j) => j.state === "submitted" && j.running)],
    ["Queued", count((j) => j.state === "submitted" && !j.running)],
    ["Waiting", count((j) => j.state === "pending")],
    ["Failed", count((j) => j.state === "failed")],
  ];
  return (
    <Card className="gap-3 p-4" aria-labelledby="queue-heading" data-testid="queue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="queue-heading" className="text-[1.05rem] font-semibold">Queue</h2>
        <p data-testid="queue-summary" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {counts.map(([term, n]) => <span key={term}><span className="tabular-nums">{String(n)}</span>{` ${term}`}</span>)}
          {est.queueClear !== null && <span>{`Queue clear in about ${formatDuration(est.queueClear)}`}</span>}
        </p>
      </div>
      {loading && <p className="text-muted-foreground">Loading…</p>}
      {failedLoad && <ErrorText>{`Could not load jobs: ${error.message}`}</ErrorText>}
      <ul className="grid gap-2.5">
        {batches.map((b) => {
          const all = jobs.filter((j) => j.batchId === b);
          const open = openState[b] ?? firstOpen[b] ?? all.some((j) => j.state === "pending" || j.state === "submitted");
          return <BatchGroup key={b} jobs={rows.filter((j) => j.batchId === b)} all={all} est={est} now={now} open={open} onOpenChange={(o) => { setOpenState((s) => ({ ...s, [b]: o })); }} />;
        })}
      </ul>
    </Card>
  );
}

function Library({ jobs, onPreview }: { jobs: Job[]; onPreview: (j: Job, opener: HTMLElement | null) => void }): ReactNode {
  const qc = useQueryClient();
  const { chosen, allChosen, isSelected, toggle, setAll, exportSelected, error, setError } = useSelection(jobs);
  const remove = (id: string): void => {
    setError(null);
    deleteJob(id)
      .then(() => qc.invalidateQueries({ queryKey: ["jobs"] }))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "That action failed. Try again."); });
  };
  return (
    <Card className="gap-3 p-4" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="library-heading" className="text-[1.05rem] font-semibold">Library</h2>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <span className="tabular-nums text-muted-foreground">{plural(jobs.length, "asset", "assets")}</span>
          {jobs.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox id="select-all" checked={allChosen} onCheckedChange={(c) => { setAll(c === true); }} />
              <label htmlFor="select-all">Select all</label>
            </div>
          )}
          <Button type="button" disabled={chosen.length === 0} onClick={exportSelected}>{chosen.length > 0 ? `Download selected (${String(chosen.length)})` : "Download selected"}</Button>
        </div>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {jobs.length === 0 && (
        <div className="grid gap-1 rounded-xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
          <strong>No assets yet</strong>
          <span>Finished models appear here. Add prompts or images to start a batch.</span>
        </div>
      )}
      <ul className="assets">
        {jobs.map((j) => (
          <li key={j.id} className="asset grid min-w-0 content-start gap-2 rounded-xl border border-border bg-white/[.02] p-2.5" data-testid="asset" data-job-id={j.id}>
            <button type="button" className="stage block aspect-square w-full cursor-zoom-in overflow-hidden rounded-md" aria-label={`Preview ${label(j)}`} onClick={(e) => { onPreview(j, e.currentTarget); }}>
              <img src={`/api/assets/${j.id}/thumb`} alt={label(j)} width={256} height={256} loading="lazy" className="size-full object-contain" />
            </button>
            <span data-testid="prompt-text" className="prompt clamp" title={label(j)}>{label(j)}</span>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <StateBadge job={j} />
              <div className="flex items-center gap-2">
                <Checkbox id={`select-${j.id}`} checked={isSelected(j.id)} onCheckedChange={(c) => { toggle(j.id, c === true); }} aria-label={`Select ${label(j)}`} />
                <label htmlFor={`select-${j.id}`}>Select</label>
              </div>
            </div>
            <span className="text-sm text-muted-foreground">{qualityText(j)}</span>
            {j.startedAt !== null && j.finishedAt !== null && <span className="text-sm text-muted-foreground">{`Generated in ${formatDuration(j.finishedAt - j.startedAt)}`}</span>}
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" aria-label={`Download ${label(j)}`} onClick={() => { window.location.assign(`/api/assets/${j.id}/model.glb`); }}>Download</Button>
              <Button type="button" size="sm" variant="delete" aria-label={`Delete ${label(j)}`} onClick={() => { remove(j.id); }}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

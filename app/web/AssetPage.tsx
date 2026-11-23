// The phone layout's Asset page: the model, its facts and its actions (feature document asset-studio-mobile,
// Design > Layout and navigation).
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { deleteJob, type Job } from "./api.ts";
import { dateFormat, ErrorText, label, qualityText } from "./common.tsx";
import { Button } from "./components/ui/button.tsx";
import { formatDuration } from "./queue.ts";
import { ModelStage, timing } from "./Viewer.tsx";

export const GONE_MESSAGE = "This asset is no longer available.";

function Fact({ term, children }: { term: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex gap-1.5">
      <dt className="font-semibold">{term}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

export function AssetPage({ job, onLibrary, onRemix }: { job: Job; onLibrary: () => void; onRemix: () => void }): ReactNode {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = label(job);
  const { generated } = timing(job);
  const remove = (): void => {
    setBusy(true);
    setError(null);
    deleteJob(job.id)
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ["jobs"] });
        onLibrary();
      })
      .catch((e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : "That action failed. Try again.");
      });
  };
  return (
    <section data-screen="asset" data-testid="asset-page" aria-labelledby="asset-name" className="grid gap-3.5">
      <ModelStage job={job} name={name} className="aspect-square max-h-[60dvh] w-full justify-self-center" />
      <h2 id="asset-name" className="text-[1.15rem] [overflow-wrap:anywhere]">{name}</h2>
      <p className="font-semibold text-muted-foreground">{qualityText(job)}</p>
      {job.sharedStyle && <p className="text-sm text-muted-foreground"><span className="font-semibold">Shared style</span>{` ${job.sharedStyle}`}</p>}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[.95rem] text-muted-foreground">
        {generated !== null && <Fact term="Generated in">{formatDuration(generated)}</Fact>}
        <Fact term="Seed"><span className="mono">{String(job.seed)}</span></Fact>
        <Fact term="Created">{dateFormat.format(job.createdAt)}</Fact>
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="lg" onClick={() => { window.location.assign(`/api/assets/${job.id}/model.glb`); }}>Download</Button>
        <Button type="button" size="lg" onClick={onRemix}>Remix</Button>
        <Button type="button" size="lg" variant="delete" disabled={busy} onClick={remove}>Delete</Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}

/** Shown for an `?asset=` that is not in the job list or not done. */
export function AssetGone({ onLibrary }: { onLibrary: () => void }): ReactNode {
  return (
    <section data-screen="asset" className="grid justify-items-start gap-3 rounded-xl border border-dashed border-border px-4 py-8">
      <p>{GONE_MESSAGE}</p>
      <Button type="button" size="lg" onClick={onLibrary}>Back to Library</Button>
    </section>
  );
}

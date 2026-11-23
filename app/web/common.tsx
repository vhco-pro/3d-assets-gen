// Small pieces both layouts share: Glossary terms for job states, names, the state badge, error text and the
// Library's selection with its zip download.
import { CircleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { qualityLabel, qualityOf } from "../pipeline/presets.ts";
import { startExport, type Job } from "./api.ts";
import { Badge } from "./components/ui/badge.tsx";

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

export function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** `Quality: <name>` for a job whose pair matches a level, otherwise `Custom (<k>k, <texture>)` (Design > Quality). */
export function qualityText(job: Pick<Job, "faces" | "tex">): string {
  return qualityOf(job.faces, job.tex) ? `Quality: ${qualityLabel(job.faces, job.tex)}` : qualityLabel(job.faces, job.tex);
}

export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function StateBadge({ job }: { job: Job }): ReactNode {
  return <Badge data-testid="job-state" data-badge={badgeKind(job)}>{stateTerm(job)}</Badge>;
}

/** An error message: a failed outcome, so it uses the danger tint with an icon. A job's stored error is not
 * a live event, so it is not announced as an alert. */
export function ErrorText({ children, live = true }: { children: ReactNode; live?: boolean }): ReactNode {
  return (
    <p role={live ? "alert" : undefined} data-error="">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The Library's selection of done assets and Download selected (the existing zip export). */
export function useSelection(jobs: Job[]): {
  chosen: string[];
  allChosen: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string, on: boolean) => void;
  setAll: (on: boolean) => void;
  exportSelected: () => void;
  error: string | null;
  setError: (e: string | null) => void;
} {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const live = new Set(jobs.map((j) => j.id));
  const chosen = [...selected].filter((id) => live.has(id));
  return {
    chosen,
    allChosen: jobs.length > 0 && chosen.length === jobs.length,
    isSelected: (id) => selected.has(id),
    toggle: (id, on) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    setAll: (on) => { setSelected(on ? new Set(jobs.map((j) => j.id)) : new Set()); },
    exportSelected: () => {
      setError(null);
      startExport(chosen)
        .then((url) => { window.location.assign(url); })
        .catch((e: unknown) => { setError(e instanceof Error ? e.message : "The download could not start. Try again."); });
    },
    error,
    setError,
  };
}

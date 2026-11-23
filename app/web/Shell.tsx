// The phone layout below 1024 pixels: a top bar with the screen title, one screen at a time, and a fixed bottom
// tab bar with Create, Queue and Library (feature document asset-studio-mobile, Design > Layout and navigation).
import { Images, ListOrdered, SquarePen } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { Job } from "./api.ts";
import { ErrorText, label, plural, useSelection } from "./common.tsx";
import { Button } from "./components/ui/button.tsx";
import { Checkbox } from "./components/ui/checkbox.tsx";
import { tabHref, type Tab } from "./nav.ts";

const TITLES: Record<Tab, string> = { create: "Create", queue: "Queue", library: "Library" };
const ICONS: Record<Tab, typeof Images> = { create: SquarePen, queue: ListOrdered, library: Images };

function TabBar({ current, onTab }: { current: Tab; onTab: (tab: Tab) => void }): ReactNode {
  const click = (tab: Tab) => (e: MouseEvent<HTMLAnchorElement>): void => {
    // A plain click switches in place; a modified click keeps the browser's own behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onTab(tab);
  };
  return (
    <nav aria-label="Screens" className="tabbar">
      {(["create", "queue", "library"] as const).map((tab) => {
        const Icon = ICONS[tab];
        const on = tab === current;
        return (
          <a key={tab} href={tabHref(tab)} aria-current={on ? "page" : undefined} data-tab={tab} onClick={click(tab)}>
            {on && <span data-accent="" aria-hidden="true" />}
            <Icon size={22} strokeWidth={on ? 2 : 1.6} aria-hidden="true" />
            <span>{TITLES[tab]}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** The shell around one screen. `onAssetBack` set means the Asset page is open and the top bar shows ‹ Library. */
export function PhoneShell({ tab, onTab, onAssetBack, banners, children }: { tab: Tab; onTab: (tab: Tab) => void; onAssetBack: (() => void) | null; banners: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="phone">
      <header className="phone-top">
        {onAssetBack ? (
          <Button type="button" variant="ghost" size="lg" className="-ml-3 px-3 text-base" onClick={onAssetBack}>‹ Library</Button>
        ) : (
          <h1 className="text-[1.2rem] font-semibold tracking-tight">{TITLES[tab]}</h1>
        )}
      </header>
      {banners}
      <main className="phone-main">{children}</main>
      <TabBar current={tab} onTab={onTab} />
    </div>
  );
}

/** The Library screen: a grid of thumbnail tiles; Select turns the tiles into checkboxes for the zip download. */
export function PhoneLibrary({ jobs, onOpen }: { jobs: Job[]; onOpen: (job: Job) => void }): ReactNode {
  const sel = useSelection(jobs);
  const [selecting, setSelecting] = useState(false);
  return (
    <section data-screen="library" aria-label="Library" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tabular-nums text-muted-foreground">{plural(jobs.length, "asset", "assets")}</span>
        {jobs.length > 0 && (
          <Button type="button" size="lg" aria-pressed={selecting} onClick={() => { setSelecting((s) => !s); sel.setAll(false); }}>{selecting ? "Done" : "Select"}</Button>
        )}
      </div>
      {selecting && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-2">
            <Checkbox checked={sel.allChosen} onCheckedChange={(c) => { sel.setAll(c === true); }} />
            <span>Select all</span>
          </label>
          <Button type="button" size="lg" disabled={sel.chosen.length === 0} onClick={sel.exportSelected}>{sel.chosen.length > 0 ? `Download selected (${String(sel.chosen.length)})` : "Download selected"}</Button>
        </div>
      )}
      {sel.error && <ErrorText>{sel.error}</ErrorText>}
      {jobs.length === 0 && (
        <div className="grid gap-1 rounded-xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
          <strong>No assets yet</strong>
          <span>Finished models appear here. Add prompts or images to start a batch.</span>
        </div>
      )}
      <ul className="phone-tiles">
        {jobs.map((j) => (
          <li key={j.id} className="grid min-w-0 content-start gap-1.5" data-testid="asset" data-job-id={j.id}>
            {selecting ? (
              <label className="relative block cursor-pointer">
                <img src={`/api/assets/${j.id}/thumb`} alt={label(j)} width={256} height={256} loading="lazy" className="stage aspect-square w-full rounded-md object-contain" />
                <span className="absolute top-1 left-1 grid size-11 place-items-center">
                  <Checkbox checked={sel.isSelected(j.id)} onCheckedChange={(c) => { sel.toggle(j.id, c === true); }} aria-label={`Select ${label(j)}`} />
                </span>
              </label>
            ) : (
              <button type="button" className="stage block aspect-square w-full overflow-hidden rounded-md" aria-label={`Open ${label(j)}`} onClick={() => { onOpen(j); }}>
                <img src={`/api/assets/${j.id}/thumb`} alt="" width={256} height={256} loading="lazy" className="size-full object-contain" />
              </button>
            )}
            <span data-testid="prompt-text" className="prompt clamp text-[.95rem]" title={label(j)}>{label(j)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

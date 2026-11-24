// The service worker, served as /sw.js with scope /. It only shows "asset ready" notifications and opens the
// asset on a tap; it has no fetch handler and caches nothing, so a deploy shows on the next load
// (feature document asset-studio-mobile, Design > Notifications).
/// <reference lib="webworker" />
export {};
const sw = self as unknown as ServiceWorkerGlobalScope;

interface Ready {
  jobId: string;
  batchId: string;
  name: string;
}

function parse(data: PushMessageData | null): Ready | null {
  try {
    const v: unknown = data?.json();
    if (typeof v !== "object" || v === null) return null;
    const { jobId, batchId, name } = v as Record<string, unknown>;
    return typeof jobId === "string" && typeof batchId === "string" && typeof name === "string" ? { jobId, batchId, name } : null;
  } catch {
    return null;
  }
}

sw.addEventListener("install", () => {
  void sw.skipWaiting();
});

sw.addEventListener("activate", (event) => {
  // Takes control of pages already open, so a notification tap can reach them without a reload.
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener("push", (event) => {
  const ready = parse(event.data);
  if (!ready) return;
  // tag groups a batch's notifications, and renotify alerts again when one replaces another.
  const options: NotificationOptions & { renotify: boolean } = { body: `${ready.name} is ready.`, icon: "/icon-192.png", tag: ready.batchId, renotify: true, data: { jobId: ready.jobId } };
  event.waitUntil(sw.registration.showNotification("Asset Studio", options));
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const jobId = typeof data === "object" && data !== null && typeof (data as { jobId?: unknown }).jobId === "string" ? (data as { jobId: string }).jobId : null;
  const url = jobId ? `/?asset=${encodeURIComponent(jobId)}` : "/";
  event.waitUntil((async () => {
    const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows[0];
    if (open) {
      // Not awaited: focus() may be refused, and navigating must not wait for it.
      open.focus().catch(() => undefined);
      try {
        await open.navigate(url);
        return;
      } catch {
        // Falls through to a new window.
      }
    }
    await sw.clients.openWindow(url);
  })());
});

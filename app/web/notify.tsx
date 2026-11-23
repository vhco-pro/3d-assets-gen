// The "Notify me when assets are ready" switch (feature document asset-studio-mobile, Design > Notifications).
// Its state lives in the studio, so the check on each signed-in load runs once per page load.
import { useEffect, useState, type ReactNode } from "react";
import { deletePushSubscription, fetchPushKey, postPushSubscription } from "./api.ts";
import { isAppleMobile } from "./ar.ts";
import { ErrorText } from "./common.tsx";
import { Switch } from "./components/ui/switch.tsx";
import { serviceWorkerRegistration } from "./pwa.ts";

export const SWITCH_LABEL = "Notify me when assets are ready";
const NOT_ON = "Notifications could not be turned on. Try again.";
const BLOCKED = "Notifications are blocked in the browser settings.";
const UNREACHABLE = "Could not reach Asset Studio; notifications may not arrive.";
const HOME_SCREEN = "Add Asset Studio to your Home Screen to get notifications.";
const NO_NOTIFICATIONS = "This browser cannot show notifications.";

type Support = "home-screen" | "unsupported" | "supported";

export interface Notifications {
  support: Support;
  on: boolean;
  blocked: boolean;
  busy: boolean;
  message: string | null;
  toggle: (on: boolean) => void;
}

function support(): Support {
  // Checked before reading Notification.permission or anything else.
  const w = window as unknown as Record<string, unknown>;
  if ("Notification" in w && "PushManager" in w) return "supported";
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  return isAppleMobile() && !standalone ? "home-screen" : "unsupported";
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function pushManager(): Promise<PushManager> {
  const reg = await serviceWorkerRegistration();
  if (!reg) throw new Error("no service worker");
  return reg.pushManager;
}

async function subscribeAndPost(pm: PushManager, key: Uint8Array<ArrayBuffer>): Promise<void> {
  const sub = await pm.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await postPushSubscription(sub.toJSON());
  } catch (e) {
    // A subscription the server did not save is undone.
    await sub.unsubscribe().catch(() => false);
    throw e;
  }
}

export function useNotifications(): Notifications {
  const [state] = useState(support);
  const [on, setOn] = useState(false);
  const [blocked, setBlocked] = useState(() => state === "supported" && Notification.permission === "denied");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "supported" || Notification.permission === "denied") return;
    const run = { cancelled: false };
    const live = (): boolean => !run.cancelled;
    const check = async (): Promise<void> => {
      const pm = await pushManager();
      const sub = await pm.getSubscription();
      if (!sub || !live()) return;
      setOn(true);
      let key: Uint8Array<ArrayBuffer>;
      try {
        key = b64urlToBytes(await fetchPushKey());
      } catch {
        if (live()) setMessage(UNREACHABLE);
        return;
      }
      if (!sameKey(sub.options.applicationServerKey, key)) {
        // The server made new keys (it lost push.json): subscribe again with its key.
        await sub.unsubscribe().catch(() => false);
        try {
          await subscribeAndPost(pm, key);
        } catch {
          if (live()) {
            setOn(false);
            setMessage(NOT_ON);
          }
        }
        return;
      }
      // An idempotent upsert: brings back a subscription the server dropped.
      try {
        await postPushSubscription(sub.toJSON());
      } catch {
        if (live()) setMessage(UNREACHABLE);
      }
    };
    check().catch(() => undefined);
    return () => { run.cancelled = true; };
  }, [state]);

  const toggle = (next: boolean): void => {
    if (state !== "supported") return;
    setMessage(null);
    if (next) {
      // The tap handler's first statement, so the permission request keeps the gesture.
      const permission = Notification.requestPermission();
      setBusy(true);
      void (async () => {
        try {
          const answer = await permission;
          if (answer === "denied") {
            setBlocked(true);
            return;
          }
          if (answer !== "granted") return;
          const pm = await pushManager();
          await subscribeAndPost(pm, b64urlToBytes(await fetchPushKey()));
          setOn(true);
        } catch {
          setOn(false);
          setMessage(NOT_ON);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const pm = await pushManager();
        const sub = await pm.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await deletePushSubscription(endpoint);
        }
      } catch {
        // Off on this device either way; the server drops an endpoint the push service refuses.
      } finally {
        setOn(false);
        setBusy(false);
      }
    })();
  };

  return { support: state, on, blocked, busy, message, toggle };
}

export function NotifySwitch({ n }: { n: Notifications }): ReactNode {
  if (n.support === "home-screen") return <p className="text-muted-foreground">{HOME_SCREEN}</p>;
  if (n.support === "unsupported") return <p className="text-muted-foreground">{NO_NOTIFICATIONS}</p>;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2.5">
        <Switch id="notify" checked={n.on} disabled={n.blocked || n.busy} onCheckedChange={n.toggle} />
        <label className="font-semibold" htmlFor="notify">{SWITCH_LABEL}</label>
      </div>
      {n.blocked && <p className="text-sm text-muted-foreground">{BLOCKED}</p>}
      {!n.blocked && n.message && <ErrorText>{n.message}</ErrorText>}
    </div>
  );
}

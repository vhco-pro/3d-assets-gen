// Registers /sw.js once on page load in a secure context. The notifications switch waits on this registration.
let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    registration = Promise.resolve(null);
    return registration;
  }
  registration = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  return registration;
}

/** The page's registration, or null when the browser has no service workers or registering failed. */
export function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  return registration ?? registerServiceWorker();
}

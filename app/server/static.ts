// Serves the built page. The page itself arrives in a later task; until then the root answers plainly.
export function pageRoute(_req: Request, url: URL): Response {
  if (url.pathname === "/") return new Response("<!doctype html><title>Asset Studio</title><p>Asset Studio</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response("Not found", { status: 404 });
}

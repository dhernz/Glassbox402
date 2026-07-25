// Serving the built dashboard from the hub itself.
//
// The whole product is one origin: the hub answers /lanes, /analytics and the
// websocket, and also hands out lens/dist. That removes CORS, removes the
// http-page-to-https-hub mixed-content problem, and means the deployed URL is
// just one service instead of two that have to find each other.
//
// The .wasm content-type below is the single most important line in this file.
// World's IDKit ships an 868KB wasm blob that vite emits into lens/dist/assets;
// if it's served as anything but application/wasm, instantiateStreaming fails
// and the widget dies with a generic "Something went wrong" — no console error,
// no failed request. That cost us an evening once already (see the comment in
// lens/vite.config.ts, and the demo.sh commit that switched off `vite dev`).

import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// Resolved from this module, never from cwd: the hub runs from core/ under
// demo.sh and from /app in the container, and a cwd-relative root silently
// serves nothing in one of those.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../lens/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function fileAt(p: string): string | null {
  try {
    return statSync(p).isFile() ? p : null;
  } catch {
    return null;
  }
}

export function distAvailable(): boolean {
  return !!fileAt(join(ROOT, "index.html"));
}

/** Serve a GET out of lens/dist. Returns false if the caller should handle it
 *  (i.e. this is not a static asset request we can answer). */
export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const target = resolve(ROOT, "." + decodeURIComponent(pathname));
  // path traversal: resolve() collapses ../, so anything that escapes ROOT is
  // a request we refuse to answer rather than one we serve.
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return false;

  const ext = extname(target);
  let file = fileAt(target);

  if (!file) {
    // A request with a file extension that doesn't exist is a 404, NOT the SPA
    // fallback. Falling back would return index.html for a stale
    // /assets/index-OLDHASH.js and the browser would report
    // "Unexpected token '<'" instead of a missing file.
    if (ext) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return true;
    }
    file = fileAt(join(ROOT, "index.html"));
    if (!file) return false; // no build present — let the hub answer as an API
  }

  const isAsset = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    // /assets/* filenames carry a content hash, so they can be cached forever.
    // index.html must not be, or a judge's browser keeps yesterday's bundle
    // (and yesterday's asset hashes) across a redeploy.
    "cache-control": isAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache, must-revalidate",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

// x402ify — the one command. Wraps ANY API with the real x402 protocol
// (@x402/hono paymentMiddleware) and settles on Hedera testnet through the
// blocky402 facilitator. Every hop is emitted to the hub for the dashboard.
//
//   npx x402ify <upstream-url> --price 0.01 --wallet 0.0.1234 [--name x] [--port n] [--sample /path]
//
// --wallet is your Hedera payout account (payTo); price is in HBAR.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { emit, gbe, HUB_URL } from "./events.js";
import { isHumanVerified } from "./world.js";

const argv = process.argv.slice(2);
const upstream = argv.find((a) => !a.startsWith("--"));
const flag = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
if (!upstream) { console.error("usage: x402ify <url> --price 0.01 --wallet 0.0.x [--name] [--port] [--sample]"); process.exit(1); }

const priceHbar = Number(flag("price", "0.01"));
// your payout account — never hardcoded; every payment settles here.
const payTo = flag("wallet") ?? flag("pay-to");
if (!payTo) { console.error("--wallet <your Hedera account, e.g. 0.0.1234> is required (payouts go here)"); process.exit(1); }
const lane = flag("name", new URL(upstream).hostname.replace(/^api\./, "").split(".")[0])!;
const port = Number(flag("port", "4030"));
const sample = flag("sample", "/")!;
const FACILITATOR = process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com";

// --header "Name: Value" (repeatable) → upstream auth headers, e.g. Tally's `Api-Key`.
const flagAll = (n: string) => argv.reduce<string[]>((acc, a, i) => (a === `--${n}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const customHeaders: Record<string, string> = {};
for (const h of flagAll("header")) { const i = h.indexOf(":"); if (i > 0) customHeaders[h.slice(0, i).trim()] = h.slice(i + 1).trim(); }
// --query "name=value" (repeatable) → secret query params injected into the upstream
// URL (e.g. Etherscan/Alpha Vantage's ?apikey=), merged with the buyer's own query.
const injectedQuery: Record<string, string> = {};
for (const q of flagAll("query")) { const i = q.indexOf("="); if (i > 0) injectedQuery[q.slice(0, i).trim()] = q.slice(i + 1).trim(); }
// how the test-buyer should call this API (GET, or POST a GraphQL query) — advertised to the dashboard.
const sampleMethod = (flag("method", "GET") as string).toUpperCase();
const sampleBody = flag("body");
const toAtomic = (hbar: number) => String(Math.round(hbar * 1e8)); // HBAR → tinybar

// live feature policy (World human-verified tiering), refreshed from the hub.
let policy: { humanVerifiedOnly?: boolean; botMultiplier?: number } = {};
setInterval(async () => {
  try { policy = (await fetch(`${HUB_URL}/policy/${lane}`).then((r) => r.json())).policy ?? {}; } catch {}
}, 2000);

const x402Server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR }))
  .register("hedera:*", new ExactHederaScheme() as any);

// price varies per request: unverified callers pay the bot multiplier when the
// human-verified policy is on. Kept sync (policy is cached) as the middleware needs.
const priceForCtx = (ctx: any) => {
  const verified = ctx?.headers?.["x-world-proof"] || ctx?.req?.header?.("x-world-proof");
  const isBot = policy.humanVerifiedOnly && !verified;
  const hbar = isBot ? priceHbar * (policy.botMultiplier ?? 10) : priceHbar;
  return { amount: toAtomic(hbar), asset: "0.0.0" };
};

const mkRoute = () => ({
  description: `${lane} via GlassBox402`,
  accepts: { scheme: "exact", network: "hedera:testnet", payTo, price: priceForCtx, maxTimeoutSeconds: 180 },
});
const samplePath = sample.split("?")[0];
// gate both GET and POST so REST *and* GraphQL APIs are paywalled.
const routes: any = {
  [`GET ${samplePath}`]: mkRoute(),
  "GET /*": mkRoute(),
  [`POST ${samplePath}`]: mkRoute(),
  "POST /*": mkRoute(),
};

const app = new Hono();

// event + settlement wrapper around the payment middleware
app.use("*", async (c, next) => {
  const reqId = crypto.randomUUID();
  const path = c.req.path;
  (c as any).set("reqId", reqId);
  await emit(gbe("request_in", lane, reqId, { method: c.req.method, path }));
  const verified = await isHumanVerified(c.req.header("x-world-proof"));
  await next();

  const status = c.res.status;
  if (status === 402) {
    await emit(gbe("quote_402", lane, reqId, { price: priceHbar, payTo, verified }));
    return;
  }
  const settleHeader = c.res.headers.get("payment-response");
  if (status < 300 && settleHeader) {
    try {
      const s: any = decodePaymentResponseHeader(settleHeader);
      const from = s.payer ?? "unknown";
      const tier = policy.humanVerifiedOnly && !verified ? "bot" : verified ? "human" : "anon";
      const amount = policy.humanVerifiedOnly && !verified ? priceHbar * (policy.botMultiplier ?? 10) : priceHbar;
      await emit(gbe("payment_submitted", lane, reqId, { from, amount, tier, verified }));
      await emit(gbe("settled", lane, reqId, { from, amount, payTo, path, tier, verified, txHash: s.transaction }));
      if (s.transaction) {
        const hs = `https://hashscan.io/testnet/transaction/${String(s.transaction).replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
        await emit(gbe("hedera_receipt", lane, reqId, { hashscan: hs, txId: s.transaction }));
      }
    } catch (e) { console.error("settle-emit failed:", String(e)); }
  }
});

app.use("*", paymentMiddleware(routes, x402Server));

// proxy handler — our upstream key stays server-side ("reselling my access")
app.all("*", async (c) => {
  const upstreamBase = new URL(upstream);
  // single-endpoint upstream (e.g. /api, /query) keeps its path; otherwise append the buyer's path.
  const url = new URL(upstreamBase.pathname !== "/" ? upstreamBase.pathname : c.req.path, upstreamBase.origin);
  // merge query params: upstream's own, then the buyer's, then our injected secrets (API key).
  for (const [k, v] of upstreamBase.searchParams) url.searchParams.set(k, v);
  const qs = c.req.url.includes("?") ? c.req.url.split("?").slice(1).join("?") : "";
  for (const [k, v] of new URLSearchParams(qs)) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(injectedQuery)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: "application/json", ...customHeaders };
  // Graph subgraph auth only for Graph upstreams — never leak a Bearer to other APIs (e.g. Tally).
  if (process.env.GRAPH_API_KEY && upstream.includes("thegraph.com") && !customHeaders.authorization && !customHeaders.Authorization) {
    headers.authorization = `Bearer ${process.env.GRAPH_API_KEY}`;
  }
  // forward the request body + content-type for non-GET (e.g. GraphQL POST queries)
  let reqBody: string | undefined;
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    reqBody = await c.req.text();
    headers["content-type"] = c.req.header("content-type") ?? "application/json";
  }
  const up = await fetch(url, { method: c.req.method, headers, body: reqBody });
  const body = await up.text();
  return new Response(body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
});

serve({ fetch: app.fetch, port }, async () => {
  await emit(gbe("lane_up", lane, crypto.randomUUID(), { upstream, price: priceHbar, payTo, owner: payTo, port, sample, sampleMethod, sampleBody }));
  console.log(`💰 ${lane} is x402 (real, blocky402→Hedera):  http://localhost:${port}  →  ${upstream}   (${priceHbar} HBAR/call → ${payTo})`);
});

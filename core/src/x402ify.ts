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
const payTo = flag("wallet") ?? flag("pay-to") ?? "0.0.9742887";
const lane = flag("name", new URL(upstream).hostname.replace(/^api\./, "").split(".")[0])!;
const port = Number(flag("port", "4030"));
const sample = flag("sample", "/")!;
const FACILITATOR = process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
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

const routes: any = {
  [`GET ${sample.split("?")[0]}`]: {
    description: `${lane} via GlassBox402`,
    accepts: { scheme: "exact", network: "hedera:testnet", payTo, price: priceForCtx, maxTimeoutSeconds: 180 },
  },
  "GET /*": {
    description: `${lane} via GlassBox402`,
    accepts: { scheme: "exact", network: "hedera:testnet", payTo, price: priceForCtx, maxTimeoutSeconds: 180 },
  },
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
  const url = upstreamBase.pathname !== "/" ? upstreamBase : new URL(c.req.path + (c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : ""), upstream);
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.GRAPH_API_KEY) headers.authorization = `Bearer ${process.env.GRAPH_API_KEY}`;
  const up = await fetch(url, { method: c.req.method, headers });
  const body = await up.text();
  return new Response(body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
});

serve({ fetch: app.fetch, port }, async () => {
  await emit(gbe("lane_up", lane, crypto.randomUUID(), { upstream, price: priceHbar, payTo, owner: payTo, port, sample }));
  console.log(`💰 ${lane} is x402 (real, blocky402→Hedera):  http://localhost:${port}  →  ${upstream}   (${priceHbar} HBAR/call → ${payTo})`);
});

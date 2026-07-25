// x402ify — the one command.
//
//   pnpm x402ify https://api.coingecko.com --price 0.01 --name coingecko --port 4030
//
// Puts an x402 paywall (sim rail, x402-compatible wire format: 402 quote body,
// X-PAYMENT / X-PAYMENT-RESPONSE headers) in front of any URL and emits every
// hop of every payment to the hub. Upstream API keys stay server-side
// (GRAPH_API_KEY → Authorization header) — the "reselling my access" model.

import { createServer } from "node:http";
import { emit, gbe, HUB_URL } from "./events.js";
import { hederaEnabled, hederaReceipt } from "./hedera.js";

// opt-in: mirror each cleared payment onto Hedera testnet as a real HCS receipt.
// async + fire-and-forget so it never slows or breaks the payment itself.
const HEDERA_LIVE = process.env.HEDERA_LIVE === "1" && hederaEnabled();

const argv = process.argv.slice(2);
const upstream = argv.find((a) => !a.startsWith("--"));
function flag(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}

if (!upstream) {
  console.error("usage: x402ify <upstream-url> [--price 0.01] [--pay-to addr] [--name lane] [--port 4030]");
  process.exit(1);
}

const price = Number(flag("price", "0.01"));
const payTo = flag("pay-to", "0xGLASSBOX_SELLER")!;
const lane = flag("name", new URL(upstream).hostname.replace(/^api\./, "").split(".")[0])!;
const port = Number(flag("port", "4030"));
const sample = flag("sample", "/")!; // a known-good path, used by the Lens "send test buyer" button

const quote = () => ({
  x402Version: 1,
  accepts: [{
    scheme: "exact",
    network: "glassbox-sim",
    asset: "USDC",
    price: String(price),
    payTo,
    resource: lane,
    description: `${lane} via GlassBox402`,
  }],
});

const server = createServer(async (req, res) => {
  const t0 = Date.now();
  const reqId = crypto.randomUUID();
  const path = req.url ?? "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders()); return res.end();
  }

  await emit(gbe("request_in", lane, reqId, { method: req.method, path }));

  const payment = req.headers["x-payment"];
  if (!payment) {
    await emit(gbe("quote_402", lane, reqId, { price, payTo }));
    res.writeHead(402, { "content-type": "application/json", ...corsHeaders() });
    return res.end(JSON.stringify(quote()));
  }

  // decode X-PAYMENT (base64 JSON: { from, amount })
  let from = "unknown";
  try {
    const decoded = JSON.parse(Buffer.from(String(payment), "base64").toString());
    from = decoded.from ?? "unknown";
  } catch {}
  await emit(gbe("payment_submitted", lane, reqId, { from, amount: price }));

  // verify + settle through the (sim) facilitator on the hub
  const settle = await fetch(`${HUB_URL}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, to: payTo, usd: price }),
  }).then((r) => r.json()).catch(() => ({ ok: false, reason: "facilitator_unreachable" }));

  if (!settle.ok) {
    await emit(gbe("verify_fail", lane, reqId, { from, amount: price, reason: settle.reason }));
    res.writeHead(402, { "content-type": "application/json", ...corsHeaders() });
    return res.end(JSON.stringify({ ...quote(), error: settle.reason }));
  }
  await emit(gbe("verify_ok", lane, reqId, { from, amount: price }));
  await emit(gbe("settled", lane, reqId, { from, amount: price, txHash: settle.txHash, payTo }));

  if (HEDERA_LIVE) {
    hederaReceipt(JSON.stringify({ lane, from, amount: price, payTo }))
      .then((r) => emit(gbe("hedera_receipt", lane, reqId, { hashscan: r.hashscan, topicId: r.topicId, txId: r.txId })))
      .catch((e) => console.error("hedera receipt failed:", String(e)));
  }

  // forward to the upstream API — our keys, never the buyer's
  // (single-endpoint upstreams, e.g. a Graph gateway URL with its own path, are used as-is)
  const upstreamBase = new URL(upstream);
  const upstreamUrl = upstreamBase.pathname !== "/" ? upstreamBase : new URL(path, upstream);
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.GRAPH_API_KEY) headers.authorization = `Bearer ${process.env.GRAPH_API_KEY}`;
  let body: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = Buffer.concat(chunks);
    headers["content-type"] = String(req.headers["content-type"] ?? "application/json");
  }

  try {
    const up = await fetch(upstreamUrl, { method: req.method, headers, body });
    const payload = Buffer.from(await up.arrayBuffer());
    await emit(gbe("response_out", lane, reqId, { status: up.status, ms: Date.now() - t0, bytes: payload.length }));
    res.writeHead(up.status, {
      "content-type": up.headers.get("content-type") ?? "application/json",
      "x-payment-response": Buffer.from(JSON.stringify({ txHash: settle.txHash, network: "glassbox-sim" })).toString("base64"),
      ...corsHeaders(),
    });
    res.end(payload);
  } catch (e) {
    await emit(gbe("response_out", lane, reqId, { status: 502, ms: Date.now() - t0, error: String(e) }));
    res.writeHead(502, corsHeaders());
    res.end(JSON.stringify({ error: "upstream_unreachable" }));
  }
});

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "x-payment, content-type",
    "access-control-expose-headers": "x-payment-response",
  };
}

server.listen(port, async () => {
  await emit(gbe("lane_up", lane, crypto.randomUUID(), { upstream, price, payTo, port, sample }));
  console.log(`💰 ${lane} is now a business:  http://localhost:${port}  →  ${upstream}   ($${price}/call → ${payTo})`);
});

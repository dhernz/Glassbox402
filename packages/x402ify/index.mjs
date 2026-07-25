#!/usr/bin/env node
// x402ify — wrap any API with x402 pay-per-call, in one command.
//
//   npx x402ify <api-url> --wallet <your-account> [--price 0.01] [--chain hedera|base|base-sepolia]
//
// Chain-agnostic: the x402 protocol is the same everywhere; only the facilitator
// + scheme change per chain. The server holds NO private key — the facilitator
// and the buyer's wallet do the signing/settlement. Add --hub <url> to stream
// every payment into a GlassBox402 dashboard.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";

const argv = process.argv.slice(2);
const upstream = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

if (!upstream || argv.includes("--help")) {
  console.log(`
x402ify — wrap any API with x402 pay-per-call.

  npx x402ify <api-url> --wallet <account> [options]

Options:
  --wallet <acct>     your payout account (Hedera 0.0.x, or EVM 0x… on Base)   [required]
  --price <n>         price per call (HBAR on hedera, USD on base/solana)        [0.01]
  --chain <name>      hedera | base | base-sepolia | solana                      [hedera]
  --name <label>      lane label                                    [derived from host]
  --port <n>          local port                                                 [4030]
  --sample <path>     a valid GET path on the API (used by dashboards)           [/]
  --hub <url>         stream payments into a GlassBox402 dashboard             [none]
  --facilitator <url> override the facilitator URL
  --network <id>      override the network id (e.g. hedera:testnet, eip155:8453)
`);
  process.exit(upstream ? 0 : 1);
}

// chain presets — a (facilitator, scheme, network, price-format) triple per chain.
const CHAINS = {
  hedera: {
    network: "hedera:testnet",
    facilitator: "https://api.testnet.blocky402.com",
    load: async () => (await import("@x402/hedera/exact/server")).ExactHederaScheme,
    register: "hedera:*",
    price: (n) => ({ amount: String(Math.round(n * 1e8)), asset: "0.0.0" }), // HBAR (tinybar)
  },
  base: {
    network: "eip155:8453",
    facilitator: "https://x402.org/facilitator",
    load: async () => (await import("@x402/evm/exact/server")).ExactEvmScheme,
    register: "eip155:*",
    price: (n) => `$${n}`, // USDC
  },
  "base-sepolia": {
    network: "eip155:84532",
    facilitator: "https://x402.org/facilitator",
    load: async () => (await import("@x402/evm/exact/server")).ExactEvmScheme,
    register: "eip155:*",
    price: (n) => `$${n}`,
  },
  solana: {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    facilitator: "https://x402.org/facilitator",
    load: async () => (await import("@x402/svm/exact/server")).ExactSvmScheme,
    register: "solana:*",
    price: (n) => `$${n}`,
  },
};

const chainName = flag("chain", "hedera");
const chain = CHAINS[chainName];
if (!chain) { console.error(`unknown --chain "${chainName}". try: ${Object.keys(CHAINS).join(", ")}`); process.exit(1); }

const amount = Number(flag("price", "0.01"));
const payTo = flag("wallet") ?? flag("pay-to");
if (!payTo) { console.error("--wallet <your payout account> is required"); process.exit(1); }
const lane = flag("name", new URL(upstream).hostname.replace(/^api\./, "").split(".")[0]);
const port = Number(flag("port", "4030"));
const sample = flag("sample", "/");
const facilitator = flag("facilitator", chain.facilitator);
const network = flag("network", chain.network);
const hub = flag("hub", process.env.GLASSBOX_HUB);

async function emit(type, data = {}, reqId) {
  if (!hub) return;
  try {
    await fetch(`${hub}/event`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), reqId: reqId ?? crypto.randomUUID(), lane, type, t: Date.now(), data }),
    });
  } catch {}
}

let Scheme;
try { Scheme = await chain.load(); }
catch { console.error(`chain "${chainName}" needs an extra package — install it, or use --chain hedera`); process.exit(1); }

const x402Server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitator })).register(chain.register, new Scheme());
const price = chain.price(amount);
const accepts = { scheme: "exact", network, payTo, price, maxTimeoutSeconds: 180 };
const routes = {
  [`GET ${sample.split("?")[0]}`]: { description: `${lane} via x402ify`, accepts },
  "GET /*": { description: `${lane} via x402ify`, accepts },
};

const app = new Hono();

app.use("*", async (c, next) => {
  const reqId = crypto.randomUUID();
  await emit("request_in", { method: c.req.method, path: c.req.path }, reqId);
  await next();
  if (c.res.status === 402) { await emit("quote_402", { price: amount, payTo }, reqId); return; }
  const h = c.res.headers.get("payment-response");
  if (c.res.status < 300 && h) {
    try {
      const s = decodePaymentResponseHeader(h);
      await emit("settled", { from: s.payer, amount, payTo, path: c.req.path, txHash: s.transaction, chain: chainName }, reqId);
      if (chainName === "hedera" && s.transaction) {
        const hs = `https://hashscan.io/testnet/transaction/${String(s.transaction).replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
        await emit("hedera_receipt", { hashscan: hs, txId: s.transaction }, reqId);
      }
    } catch {}
  }
});

app.use("*", paymentMiddleware(routes, x402Server));

app.all("*", async (c) => {
  const base = new URL(upstream);
  const url = base.pathname !== "/" ? base : new URL(c.req.path + (c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : ""), upstream);
  const up = await fetch(url, { method: c.req.method, headers: { accept: "application/json" } });
  const body = await up.text();
  return new Response(body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
});

serve({ fetch: app.fetch, port }, () => {
  emit("lane_up", { upstream, price: amount, payTo, owner: payTo, port, sample, chain: chainName });
  console.log(`💰 ${lane} is now x402 [${chainName}]:  http://localhost:${port}  →  ${upstream}   (${amount} → ${payTo})`);
  if (!hub) console.log(`   tip: add --hub http://localhost:4021 to stream payments into a GlassBox402 dashboard`);
});

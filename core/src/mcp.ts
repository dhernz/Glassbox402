// GlassBox402 MCP server — any AI agent becomes a paying customer.
//
// Two tools:
//   list_paid_apis  → what's for sale (from the hub's lane registry)
//   paid_fetch      → pay a lane over x402 and get the data, settled on Hedera
//
// Payments are REAL: the same x402 client the dashboard's test buyer uses
// (@x402/fetch + @x402/hedera, blocky402 as fee-payer), so each call returns a
// live HashScan transaction. Needs HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY in the
// environment — the buyer's signing account.
//
// Wire this into Claude (.mcp.json) and ask it a question that needs paid data:
// the payment lands on the dashboard mid-answer. That's The Graph's "MCPs,
// SKILLs, x402 payment tooling" — all three categories in one tool.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Claude launches this server itself, so it never inherits demo.sh's shell env.
// Load the repo .env (HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY = the buyer's
// signing account) before anything reads process.env. Must precede the
// ./paid-fetch.js import, which caches the signer on first use.
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const val = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
} catch {
  // no .env — fall back to whatever the environment already provides
}

const { getPaidFetch, paidFetchReady } = await import("./paid-fetch.js");
const { HUB_URL } = await import("./events.js");

type Lane = {
  name: string;
  upstream?: string;
  price?: number;
  port?: number;
  sample?: string;
  sampleMethod?: string;
  sampleBody?: unknown;
};

const hashscanFor = (tx: string) =>
  `https://hashscan.io/testnet/transaction/${tx.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;

async function lanes(): Promise<Lane[]> {
  const { lanes } = await fetch(`${HUB_URL}/lanes`).then((r) => r.json());
  return lanes ?? [];
}

const server = new McpServer({ name: "glassbox402", version: "0.1.0" });

server.tool(
  "list_paid_apis",
  "List the x402-monetized APIs currently for sale on GlassBox402: name, price per call in HBAR, the URL to call, and how to call it (method + sample request). Call this before paid_fetch.",
  {},
  async () => {
    const found = await lanes();
    if (!found.length) {
      return { content: [{ type: "text", text: "No APIs are for sale right now — the GlassBox402 hub has no live lanes. Start some with ./demo.sh." }] };
    }
    const menu = found.map((l) => ({
      name: l.name,
      price_hbar_per_call: l.price,
      url: `http://localhost:${l.port}${l.sample ?? "/"}`,
      method: l.sampleMethod ?? "GET",
      body: l.sampleBody,
      upstream: l.upstream,
    }));
    return { content: [{ type: "text", text: JSON.stringify(menu, null, 2) }] };
  },
);

server.tool(
  "paid_fetch",
  "Fetch data from an x402-paywalled GlassBox402 API, paying the per-call price from your Hedera wallet. Returns the API response plus the real Hedera transaction. Use list_paid_apis first to get the url/method/body.",
  {
    url: z.string().describe("Full lane URL from list_paid_apis, e.g. http://localhost:4095/?chainid=1&module=stats&action=ethprice"),
    method: z.string().optional().describe("HTTP method — GET (default) or POST for GraphQL APIs"),
    body: z.string().optional().describe("Request body for POST, e.g. a GraphQL query as JSON"),
  },
  async ({ url, method, body }) => {
    if (!paidFetchReady()) {
      return {
        content: [{ type: "text", text: "Cannot pay: no Hedera buyer account configured. Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in the environment." }],
        isError: true,
      };
    }
    try {
      const init: any = { headers: {} };
      if (method && method.toUpperCase() !== "GET") {
        init.method = method.toUpperCase();
        if (body != null) {
          init.body = body;
          init.headers["content-type"] = "application/json";
        }
      }
      const res = await getPaidFetch()(url, init);
      const text = (await res.text()).slice(0, 4000);

      let paid = "";
      const ph = res.headers.get("payment-response");
      if (ph) {
        try {
          const { decodePaymentResponseHeader } = await import("@x402/core/http");
          const s: any = decodePaymentResponseHeader(ph);
          if (s?.transaction) paid = `PAID — settled on Hedera, tx ${s.transaction}\n${hashscanFor(String(s.transaction))}\n\n`;
        } catch {}
      }
      return { content: [{ type: "text", text: `${paid}HTTP ${res.status}\n${text}` }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Payment or fetch failed: ${String(e).split("\n")[0]}` }],
        isError: true,
      };
    }
  },
);

await server.connect(new StdioServerTransport());

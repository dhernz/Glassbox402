// GlassBox402 MCP server — any AI agent becomes a paying customer.
//
// Two tools:
//   list_paid_apis  → what's for sale (from the hub's lane registry)
//   paid_fetch      → pay a lane and get the data (auto-faucets its sim wallet)
//
// Wire this into Claude (.mcp.json) and ask it a question that needs paid data:
// the ka-ching lands on the Lens mid-answer. That's The Graph's "MCPs, SKILLs,
// x402 payment tooling" — all three categories in one tool.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { paidFetch } from "./paid-fetch.js";
import { HUB_URL } from "./events.js";

const WALLET = process.env.MCP_WALLET ?? "0xCLAUDE";

async function ensureFunds() {
  const { balances } = await fetch(`${HUB_URL}/balances`).then((r) => r.json());
  if ((balances[WALLET] ?? 0) < 0.05) {
    await fetch(`${HUB_URL}/faucet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr: WALLET, usd: 0.5 }),
    });
  }
}

const server = new McpServer({ name: "glassbox402", version: "0.0.1" });

server.tool(
  "list_paid_apis",
  "List the x402-monetized APIs currently for sale on GlassBox402 (name, price per call, how to reach them).",
  {},
  async () => {
    const { lanes } = await fetch(`${HUB_URL}/lanes`).then((r) => r.json());
    return { content: [{ type: "text", text: JSON.stringify(lanes, null, 2) }] };
  },
);

server.tool(
  "paid_fetch",
  "Fetch data from an x402-paywalled GlassBox402 lane, paying per call from your agent wallet. Use list_paid_apis first; url = http://localhost:<lane port><path>.",
  { url: z.string().describe("Full lane URL, e.g. http://localhost:4030/api/v3/simple/price?ids=ethereum&vs_currencies=usd") },
  async ({ url }) => {
    await ensureFunds();
    const { res, paid, txHash } = await paidFetch(url, WALLET);
    const body = await res.text();
    return {
      content: [{
        type: "text",
        text: `PAID $${paid.toFixed(3)} (tx: ${txHash ?? "n/a"}) → HTTP ${res.status}\n${body.slice(0, 2000)}`,
      }],
    };
  },
);

await server.connect(new StdioServerTransport());

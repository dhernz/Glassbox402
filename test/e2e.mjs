// E2E: T1 golden path + T2 failure path, fully offline (local mock upstream).
// Boots hub + a mock API + x402ify, then plays buyer and broke-buyer.
// Asserts on HTTP results AND on the event chain recorded to the tape.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAPE = join(root, "e2e.tape.jsonl");
const HUB = "http://localhost:4021";
const LANE = "http://localhost:4890";
const procs = [];
let failures = 0;

function ok(name, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

function run(args) {
  const p = spawn("pnpm", args, { cwd: root, stdio: "ignore" });
  procs.push(p);
  return p;
}

async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function paidFetch(url, wallet) {
  const first = await fetch(url);
  if (first.status !== 402) return { res: first, paid: 0 };
  const quote = await first.json();
  const xp = Buffer.from(JSON.stringify({ from: wallet, amount: Number(quote.accepts[0].price) })).toString("base64");
  return { res: await fetch(url, { headers: { "x-payment": xp } }), paid: Number(quote.accepts[0].price) };
}

// ── boot ──────────────────────────────────────────────
rmSync(TAPE, { force: true });

const mockApi = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ethereum: { usd: 4242.42 }, mock: true }));
}).listen(4889);

run(["--filter", "@glassbox/core", "exec", "tsx", "src/hub.ts", "--tape", TAPE]);
await waitFor(HUB);
run(["--filter", "@glassbox/core", "exec", "tsx", "src/x402ify.ts", "http://localhost:4889", "--price", "0.01", "--name", "mockapi", "--port", "4890",
  // required since x402ify stopped hard-coding a payTo (85ad63e)
  "--wallet", "0x2403506eddcd48207ee982d7a8f86901365192ed"]);
await waitFor(`${LANE}/anything`).catch(() => {}); // lane answers 402 — that IS reachable
await new Promise((r) => setTimeout(r, 400));

// ── T1: golden path ───────────────────────────────────
console.log("\nT1 — golden path");
const unpaid = await fetch(`${LANE}/price`);
ok("unpaid request → 402", unpaid.status === 402);
const quote = await unpaid.json();
ok("402 carries x402 quote", quote.x402Version === 1 && quote.accepts?.[0]?.price === "0.01");

await fetch(`${HUB}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addr: "0xT1", usd: 5 }) });
const { res: paidRes, paid } = await paidFetch(`${LANE}/price`, "0xT1");
ok("paid request → 200", paidRes.status === 200);
ok("charged the quoted price", paid === 0.01);
const body = await paidRes.json();
ok("upstream data delivered", body.ethereum?.usd === 4242.42);
ok("receipt header present", paidRes.headers.get("x-payment-response") !== null);

// ── T2: failure path ──────────────────────────────────
console.log("\nT2 — broke wallet");
let rejected = false;
try {
  const { res } = await paidFetch(`${LANE}/price`, "0xBROKE_T2");
  rejected = res.status === 402;
} catch { rejected = true; }
ok("empty wallet → payment rejected", rejected);

// ── tape assertions ───────────────────────────────────
console.log("\nTape — the event chain");
await new Promise((r) => setTimeout(r, 300));
const events = readFileSync(TAPE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const types = events.map((e) => e.type);
for (const t of ["lane_up", "request_in", "quote_402", "payment_submitted", "verify_ok", "settled", "response_out"]) {
  ok(`tape contains ${t}`, types.includes(t));
}
const fail = events.find((e) => e.type === "verify_fail");
ok("verify_fail recorded with reason", fail?.data?.reason === "insufficient_funds", String(fail?.data?.reason));
const settled = events.find((e) => e.type === "settled");
ok("settled carries txHash", typeof settled?.data?.txHash === "string" && settled.data.txHash.startsWith("0x"));

const balances = await fetch(`${HUB}/balances`).then((r) => r.json());
ok("seller earned $0.01", Math.abs((balances.earnings["0xGLASSBOX_SELLER"] ?? 0) - 0.01) < 1e-9);

// ── done ──────────────────────────────────────────────
console.log(failures === 0 ? "\n🟢 ALL PASS" : `\n🔴 ${failures} FAILURES`);
mockApi.close();
for (const p of procs) p.kill("SIGKILL");
process.exit(failures === 0 ? 0 : 1);

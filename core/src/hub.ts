// The hub: one process that every engine and bot talks to.
//   - broadcasts GBEvents to the Lens over websocket (:4021)
//   - plays sim facilitator: wallet balances, faucet, settle
//   - records every event to the tape (JSONL)
//   - writes an HCS receipt per settled payment (the dashboard's numbers,
//     independently checkable on Hedera — see receiptFor below)
//   - `--replay <file.tape.jsonl>` streams a recorded session at original timing
//     (demo insurance: if the venue wifi dies, the tape still plays)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { loadEnv } from "./env.js";
import { HUB_PORT, gbe, type GBEvent } from "./events.js";
import { Analytics } from "./analytics.js";
import { verifyWorldProof, issueSessionToken, rpContext, worldLive, WORLD_MODE } from "./world.js";
import { hederaEnabled, ensureTopic, hederaReceipt } from "./hedera.js";

// ./hedera.js reads the operator credentials lazily, inside its functions, so
// loading them here — after the hoisted imports have run — is early enough.
loadEnv();

const args = process.argv.slice(2);
const replayFile = args.includes("--replay") ? args[args.indexOf("--replay") + 1] : null;
const tapeFile = args.includes("--tape") ? args[args.indexOf("--tape") + 1] : "tape.jsonl";

const balances = new Map<string, number>(); // wallet -> USD
const earnings = new Map<string, number>(); // payTo -> USD
const lanes = new Map<string, Record<string, unknown>>(); // lane -> lane_up data (MCP discovery)
const policies = new Map<string, Record<string, unknown>>(); // lane -> feature policy (dashboard toggles)
const ring: GBEvent[] = []; // last 500 events, replayed to fresh Lens connections
const RING_MAX = 500;

const wss = new WebSocketServer({ noServer: true });

const analytics = new Analytics();

// Every settled payment also gets an HCS receipt: one message on a public
// Hedera topic, consensus-ordered and timestamped by the network. The x402
// transaction proves the money moved; this proves what it was FOR — which lane,
// which buyer, which price — so the dashboard's income numbers can be audited
// against Hedera instead of trusted. Strictly fire-and-forget: if the operator
// has no Hedera credentials, or the network is slow, payments and the dashboard
// behave exactly as they did before.
let hcsTopic: string | null = null;

async function receiptFor(ev: GBEvent) {
  if (!hederaEnabled() || replayFile) return;
  try {
    const topic = await ensureTopic();
    hcsTopic = topic;
    const r = await hederaReceipt(JSON.stringify({
      glassbox: "x402-settlement",
      lane: ev.lane,
      from: ev.data.from,
      amount: ev.data.amount,
      payTo: ev.data.payTo,
      path: ev.data.path,
      tier: ev.data.tier,
      tx: ev.data.txHash, // ties the receipt back to the settlement transaction
      t: ev.t,
    }));
    broadcast(gbe("hcs_receipt", ev.lane, ev.reqId, {
      topicId: topic,
      hashscan: r.hashscan,
      topicUrl: `https://hashscan.io/testnet/topic/${topic}`,
      // the buyer playground has no reqId (it buys over HTTP, not the event
      // stream), so it matches its purchases to receipts by settlement tx
      tx: ev.data.txHash,
    }));
  } catch (e) {
    console.error("hcs receipt failed:", String(e).split("\n")[0]);
  }
}

function broadcast(ev: GBEvent, record = true) {
  if (ev.type === "lane_up") lanes.set(ev.lane, { name: ev.lane, ...ev.data });
  if (ev.type === "settled") { analytics.ingest(ev.lane, ev.data as any, ev.t); void receiptFor(ev); }
  ring.push(ev);
  if (ring.length > RING_MAX) ring.shift();
  if (record && !replayFile) {
    try {
      appendFileSync(tapeFile, JSON.stringify(ev) + "\n");
    } catch {}
  }
  const msg = JSON.stringify(ev);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// quick TCP liveness check for a lane's local port
function portAlive(port: number, timeout = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  // The dashboard can be served from a public origin (Vercel) while the hub runs
  // on the operator's own machine. Chrome's Private Network Access sends a
  // preflight for public→localhost and needs this header, or every /lanes,
  // /analytics and /testbuyer call from the deployed page is blocked.
  "access-control-allow-private-network": "true",
};
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://hub");
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); } // CORS preflight
  try {
    if (req.method === "POST" && url.pathname === "/event") {
      broadcast(await readBody(req));
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/faucet") {
      const { addr, usd } = await readBody(req);
      balances.set(addr, (balances.get(addr) ?? 0) + Number(usd));
      broadcast({
        id: crypto.randomUUID(), reqId: crypto.randomUUID(), lane: "faucet",
        type: "faucet", t: Date.now(), data: { addr, usd, balance: balances.get(addr) },
      });
      return json(res, 200, { ok: true, balance: balances.get(addr) });
    }
    if (req.method === "POST" && url.pathname === "/settle") {
      const { from, to, usd } = await readBody(req);
      const bal = balances.get(from) ?? 0;
      if (bal < usd) return json(res, 200, { ok: false, reason: "insufficient_funds", balance: bal });
      balances.set(from, bal - usd);
      earnings.set(to, (earnings.get(to) ?? 0) + usd);
      const txHash = "0xsim" + crypto.randomUUID().replaceAll("-", "").slice(0, 32);
      return json(res, 200, { ok: true, txHash, balance: balances.get(from) });
    }
    if (url.pathname === "/lanes") {
      // self-healing directory: only return lanes whose gateway is still listening,
      // and prune dead ones so a closed terminal / crash doesn't break the demo.
      const entries = [...lanes.entries()];
      const checks = await Promise.all(entries.map(async ([name, l]) => ({ name, l, alive: await portAlive(Number(l.port)) })));
      for (const c of checks) if (!c.alive) lanes.delete(c.name);
      return json(res, 200, { lanes: checks.filter((c) => c.alive).map((c) => c.l) });
    }
    if (url.pathname === "/analytics") {
      // Scoped to the lanes that are actually up: `lanes` is pruned by /lanes,
      // so a dead API drops out of analytics exactly as it drops out of the API
      // list — and history for a lane that no longer exists never resurfaces.
      return json(res, 200, analytics.snapshot([...lanes.keys()]));
    }
    // World ID: verify the buyer ONCE, then hand back a short-lived signed token
    // they present per request. The gateway checks the signature locally, so the
    // human tier can't be claimed by just setting a header.
    // What the IDKit widget needs to open a proof request: the legacy app_id plus
    // an rp_context signed here with the RP signer key (4.0 requires the relying
    // party to sign every request). Returns live:false when World isn't set up,
    // so the UI can say "simulated" instead of pretending.
    if (url.pathname === "/world/context") {
      const ctx = await rpContext();
      return json(res, 200, ctx ? { live: true, ...ctx } : { live: false, mode: WORLD_MODE });
    }
    if (req.method === "POST" && url.pathname === "/world/verify") {
      const { proof, wallet } = await readBody(req);
      if (worldLive()) {
        // Selfie Check is beta and the payload shape isn't pinned down in the
        // docs, so log what actually arrived — this is the only way to tell a
        // rejected proof from one we failed to parse.
        console.log("world: proof received, keys =", proof && Object.keys(proof),
          proof?.verification_level ? `| level=${proof.verification_level}` : "",
          Array.isArray(proof?.responses) ? `| responses=${proof.responses.map((r: any) => r.identifier).join(",")}` : "");
        const v = await verifyWorldProof(proof);
        if (!v.ok) return json(res, 200, { ok: false, error: v.error });
        return json(res, 200, { ok: true, token: issueSessionToken(v.nullifier!, false), simulated: false });
      }
      // Selfie Check beta not enabled on the app yet: mint a token anyway, but
      // mark it simulated so every surface can say so. The signature still holds.
      const pseudo = `sim_${String(wallet ?? "anon").toLowerCase()}`;
      return json(res, 200, { ok: true, token: issueSessionToken(pseudo, true), simulated: true, mode: WORLD_MODE });
    }
    if (req.method === "POST" && url.pathname === "/testbuyer") {
      const { url: target, verified, worldToken, method, body: sendBody } = await readBody(req);
      try {
        const { getPaidFetch } = await import("./paid-fetch.js");
        const init: any = { headers: {} };
        // the caller's real token — or, for the seller-side "send test payment"
        // button (no buyer UI to verify in), a simulated one minted right here.
        if (worldToken) init.headers["x-world-proof"] = worldToken;
        else if (verified) init.headers["x-world-proof"] = issueSessionToken("sim_testbuyer", !worldLive());
        if (method && method !== "GET") {
          init.method = method;
          if (sendBody != null) { init.body = typeof sendBody === "string" ? sendBody : JSON.stringify(sendBody); init.headers["content-type"] = "application/json"; }
        }
        const r = await getPaidFetch()(target, init);
        const body = (await r.text()).slice(0, 20000); // the real API response the buyer received
        let txHash: string | undefined, hashscan: string | undefined;
        const ph = r.headers.get("payment-response");
        if (ph) {
          try {
            const { decodePaymentResponseHeader } = await import("@x402/core/http");
            const s: any = decodePaymentResponseHeader(ph);
            txHash = s.transaction;
            if (txHash) hashscan = `https://hashscan.io/testnet/transaction/${String(txHash).replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
          } catch {}
        }
        return json(res, 200, { ok: r.ok, status: r.status, body, txHash, hashscan, verified: !!verified });
      } catch (e) {
        return json(res, 200, { ok: false, error: String(e).split("\n")[0] });
      }
    }
    if (url.pathname.startsWith("/policy/")) {
      const lane = url.pathname.slice("/policy/".length);
      if (req.method === "POST") {
        const body = await readBody(req);
        policies.set(lane, { ...(policies.get(lane) ?? {}), ...body });
        broadcast({ id: crypto.randomUUID(), reqId: crypto.randomUUID(), lane, type: "policy", t: Date.now(), data: policies.get(lane)! });
        return json(res, 200, { ok: true, policy: policies.get(lane) });
      }
      return json(res, 200, { policy: policies.get(lane) ?? {} });
    }
    if (url.pathname === "/balances") {
      return json(res, 200, {
        balances: Object.fromEntries(balances),
        earnings: Object.fromEntries(earnings),
      });
    }
    return json(res, 200, {
      ok: true, service: "glassbox-hub", mode: replayFile ? "replay" : "live",
      hcsTopic, hcsTopicUrl: hcsTopic ? `https://hashscan.io/testnet/topic/${hcsTopic}` : null,
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e) });
  }
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    // catch a fresh Lens up with recent history
    for (const ev of ring) ws.send(JSON.stringify(ev));
  });
});

server.listen(HUB_PORT, () => {
  console.log(`⚡ glassbox hub on :${HUB_PORT}  (tape: ${replayFile ? `REPLAY ${replayFile}` : tapeFile})`);
  if (replayFile) startReplay(replayFile);
  else hydrateFromTape();
  // Open the receipt topic now, so the first payment of the demo isn't the one
  // paying for topic creation.
  if (hederaEnabled() && !replayFile) {
    ensureTopic().then((t) => { hcsTopic = t; }).catch((e) =>
      console.error("hcs topic unavailable — receipts disabled:", String(e).split("\n")[0]));
  } else if (!replayFile) {
    console.log("🪵 no HEDERA_ACCOUNT_ID/HEDERA_PRIVATE_KEY — HCS receipts off");
  }
});

// Analytics and policies live in memory, so before this the dashboard opened
// blank after every restart and the seller's feature toggles silently reset to
// off — which quietly flattens the World ID price tiers mid-demo. The tape has
// the history; read it back at boot.
//
// Deliberately NOT routed through broadcast(): that would re-append every event
// to the tape, fire a live HCS receipt per historical payment, and push stale
// events into the ring that fresh dashboards replay. Hydration touches the two
// aggregates and nothing else. Lanes are filtered later, at /analytics, because
// gateways only register themselves after the hub is already up.
function hydrateFromTape() {
  if (!existsSync(tapeFile)) return;
  let payments = 0, policyEvents = 0;
  try {
    for (const line of readFileSync(tapeFile, "utf8").split("\n")) {
      if (!line) continue;
      let ev: GBEvent;
      try { ev = JSON.parse(line); } catch { continue } // a half-written last line is normal
      if (ev.type === "settled") { analytics.ingest(ev.lane, ev.data as any, ev.t); payments++; }
      else if (ev.type === "policy") { policies.set(ev.lane, ev.data); policyEvents++; }
    }
  } catch (e) {
    return console.error("tape hydrate failed:", String(e).split("\n")[0]);
  }
  if (payments || policyEvents) {
    console.log(`📊 hydrated ${payments} payments + ${policyEvents} policy changes from ${tapeFile}`);
  }
}

function startReplay(file: string) {
  const events: GBEvent[] = readFileSync(file, "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!events.length) return console.error("empty tape");
  console.log(`📼 replaying ${events.length} events at original timing…`);
  const t0 = events[0].t;
  const start = Date.now();
  for (const ev of events) {
    setTimeout(() => broadcast({ ...ev, t: Date.now() }, false), ev.t - t0);
  }
  const dur = events[events.length - 1].t - t0;
  setTimeout(() => console.log("📼 tape finished"), dur + 100);
}

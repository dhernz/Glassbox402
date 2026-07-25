// The hub: one process that every engine and bot talks to.
//   - broadcasts GBEvents to the Lens over websocket (:4021)
//   - plays sim facilitator: wallet balances, faucet, settle
//   - records every event to the tape (JSONL)
//   - `--replay <file.tape.jsonl>` streams a recorded session at original timing
//     (demo insurance: if the venue wifi dies, the tape still plays)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { appendFileSync, readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { HUB_PORT, type GBEvent } from "./events.js";
import { Analytics } from "./analytics.js";

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

function broadcast(ev: GBEvent, record = true) {
  if (ev.type === "lane_up") lanes.set(ev.lane, { name: ev.lane, ...ev.data });
  if (ev.type === "settled") analytics.ingest(ev.data as any);
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
      return json(res, 200, analytics.snapshot());
    }
    if (req.method === "POST" && url.pathname === "/testbuyer") {
      const { url: target, verified } = await readBody(req);
      try {
        const { getPaidFetch } = await import("./paid-fetch.js");
        const init = verified ? { headers: { "x-world-proof": "demo-verified" } } : undefined;
        const r = await getPaidFetch()(target, init as any);
        const body = (await r.text()).slice(0, 2000); // the real API response the buyer received
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
    return json(res, 200, { ok: true, service: "glassbox-hub", mode: replayFile ? "replay" : "live" });
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
});

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

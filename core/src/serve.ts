// serve.ts — the whole product as one process tree.
//
// Starts the hub, waits for it to actually answer, then starts one x402ify
// gateway per entry in lanes.json. This is what runs in production (one
// container, one public port) AND what ./demo.sh runs locally, so there is no
// "works on my laptop" gap between them.
//
// Three rules here are load-bearing; each fixes a failure that is silent:
//
//   1. Wait for the hub before starting lanes. A gateway announces itself with
//      exactly one `lane_up` event, fired in its listen callback, and emit()
//      swallows network errors by design. A lane that starts a moment too early
//      is therefore invisible for the entire session, with nothing logged.
//
//   2. Skip a lane whose ${VAR}s are unset. A gateway with no upstream key still
//      quotes a price, still takes the buyer's HBAR, and only then returns a 401
//      from upstream. Refusing to start is much better than selling a broken API.
//
//   3. If ANY child dies, exit. Do not restart children individually: the hub
//      learns which lanes exist only from `lane_up`, which is never re-sent, and
//      /analytics is scoped to the lanes it knows about. So a hub restarted
//      under living lanes serves an empty API list and all-zero analytics
//      forever. Taking the whole tree down lets the platform restart it clean.

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnv } from "./env.js";
import { HUB_PORT } from "./events.js";

loadEnv();

// Resolved from this module, not cwd — cwd is core/ under demo.sh and /app in
// the container.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Absolute, because cwd is the repo root here but used to be core/ (demo.sh ran
// these through `pnpm --filter`, which chdirs into the package).
const HUB_TS = resolve(ROOT, "core/src/hub.ts");
const X402IFY_TS = resolve(ROOT, "core/src/x402ify.ts");

// Run TypeScript by giving node tsx's hooks directly, rather than going through
// the `tsx` bin. That bin is a shell script that execs a node CLI which then
// spawns ANOTHER node — so every lane cost two extra processes, and a SIGTERM
// aimed at the wrapper orphaned the real one instead of stopping it. Resolved
// from core/, not hardcoded, so a tsx upgrade doesn't silently break the path.
const req = createRequire(resolve(ROOT, "core/"));
const TSX_DIR = dirname(req.resolve("tsx/package.json"));
const NODE_TSX_FLAGS = [
  "--require", resolve(TSX_DIR, "dist/preflight.cjs"),
  "--import", pathToFileURL(resolve(TSX_DIR, "dist/loader.mjs")).href,
];
const HUB_URL = `http://127.0.0.1:${HUB_PORT}`;

interface LaneSpec {
  name: string;
  upstream: string;
  price: number;
  port: number;
  sample?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

const children: ChildProcess[] = [];
let shuttingDown = false;

/** Replace ${VAR} from the environment. Returns null if any var is unset, so
 *  the caller can skip the lane instead of starting a broken one. */
function interpolate(s: string): string | null {
  let missing = false;
  const out = s.replace(/\$\{(\w+)\}/g, (_, k: string) => {
    const v = process.env[k];
    if (!v) { missing = true; return ""; }
    return v;
  });
  return missing ? null : out;
}

/** Spawn a child that inherits our stdio and brings the tree down when it dies. */
function child(label: string, args: string[], env: NodeJS.ProcessEnv = {}, nodeFlags: string[] = []): ChildProcess {
  const p = spawn(process.execPath, [...nodeFlags, ...NODE_TSX_FLAGS, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(p);
  p.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n💥 ${label} exited (code=${code} signal=${signal}) — bringing the stack down.`);
    shutdown(1);
  });
  p.on("error", (e) => {
    if (shuttingDown) return;
    console.error(`\n💥 ${label} failed to start: ${e.message}`);
    shutdown(1);
  });
  return p;
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of children) { try { p.kill("SIGTERM"); } catch {} }
  setTimeout(() => process.exit(code), 300);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { console.log(`\n${sig} — stopping.`); shutdown(0); });
}

/** Poll until the hub answers. Not a fixed sleep: cold tsx transpile plus the
 *  Hedera SDK import is slower in a container than on a laptop, and varies. */
async function waitForHub(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${HUB_URL}/status`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`hub did not answer on ${HUB_URL} within ${timeoutMs}ms`);
}

function laneArgs(lane: LaneSpec, wallet: string): string[] | null {
  const args = [X402IFY_TS, lane.upstream,
    "--name", lane.name,
    "--price", String(lane.price),
    "--port", String(lane.port),
    "--wallet", wallet];
  if (lane.sample) args.push("--sample", lane.sample);
  if (lane.method) args.push("--method", lane.method);
  if (lane.body) args.push("--body", lane.body);
  for (const [k, v] of Object.entries(lane.headers ?? {})) {
    const val = interpolate(v);
    if (val === null) return null;
    args.push("--header", `${k}: ${val}`);
  }
  for (const [k, v] of Object.entries(lane.query ?? {})) {
    const val = interpolate(v);
    if (val === null) return null;
    args.push("--query", `${k}=${val}`);
  }
  return args;
}

async function main() {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, "lanes.json"), "utf8")) as
    { wallet: string; lanes: LaneSpec[] };

  const wallet = interpolate(cfg.wallet);
  if (!wallet) {
    console.error("✖ WALLET is unset — every payment needs a payout address. Set it in .env (or Railway).");
    process.exit(1);
  }

  // The hub owns the public port and serves the dashboard. Everything else is
  // loopback-only behind it.
  const hubArgs = [HUB_TS];
  if (process.env.DEMO_REPLAY === "1") {
    // Kill switch: serve the recorded session instead of taking live payments.
    hubArgs.push("--replay", process.env.SEED_FILE ?? "core/seed.jsonl");
    console.log("📼 DEMO_REPLAY=1 — replaying the recorded tape, no live payments.");
  } else {
    hubArgs.push("--tape", process.env.TAPE_FILE ?? "tape.jsonl");
    if (process.env.SEED_FILE !== "") hubArgs.push("--seed", process.env.SEED_FILE ?? "core/seed.jsonl");
  }
  child("hub", hubArgs);

  await waitForHub();
  console.log(`✅ hub is up on :${HUB_PORT} — starting ${cfg.lanes.length} lane(s)`);

  let started = 0;
  for (const lane of cfg.lanes) {
    const args = laneArgs(lane, wallet);
    if (!args) {
      console.warn(`⏭️  skipping "${lane.name}" — its API key env var is unset`);
      continue;
    }
    // A lane is a thin proxy; capping its heap keeps the container's footprint
    // predictable as more APIs get added (each one is ~190MB unbounded).
    child(`lane:${lane.name}`, args, { GB_HUB: HUB_URL }, ["--max-old-space-size=192"]);
    started++;
    // Stagger slightly: four gateways importing the x402 stack at once is a
    // noticeable CPU spike on a small instance, and the hub is already up.
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!started) console.warn("⚠️  no lanes started — the dashboard will have nothing to sell.");
  console.log(`\n🚀 GlassBox402 is live on http://localhost:${HUB_PORT}\n`);
}

main().catch((e) => {
  console.error("serve failed:", e instanceof Error ? e.message : String(e));
  shutdown(1);
});

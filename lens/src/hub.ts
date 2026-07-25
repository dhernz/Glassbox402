// hub.ts — the Lens's view of the GlassBox402 backend.
// Types mirror core/src/events.ts + analytics.ts. All HTTP/WS talks to the
// hub, which serves this bundle too; the one external call allowed is the
// Hedera mirror node.

// Same origin, always. The hub serves lens/dist, so every API path is relative
// and the websocket follows the page's scheme — which is what makes this work
// on https without mixed-content blocking. `vite dev` gets there via the proxy
// in vite.config.ts, so dev, ./demo.sh and production are one code path and the
// wasm/MIME behaviour is identical in all three.
// The hub upgrades on any path, so /ws is purely so `vite dev` has something
// specific to proxy — connecting at "/" would collide with the page itself.
export const HUB = "";
export const HUB_WS = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
export const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

// A connected wallet, once the hub has told us what it is on Hedera.
//
// This used to be a hardcoded table mapping one demo address to one account id.
// It existed because that demo account was made with `setKeyWithoutAlias`, so it
// has no EVM alias and its 0x form genuinely doesn't resolve on the mirror node.
// Accounts that get lazy-created by a transfer — which is now every account we
// hand out — do resolve by their 0x address, so the table isn't needed and,
// worse, meant anyone else's wallet had no account id at all.
export interface Account {
  addr: string;              // the 0x address the user connected
  accountId: string | null;  // 0.0.x, once resolved
  balance: number | null;    // HBAR
  created: boolean;          // did connecting bring this account into existence?
}

/** Resolve a connected wallet to its Hedera account, creating it if Hedera has
 *  never seen it. The create costs the operator a little HBAR, so the hub
 *  memoizes per address. */
export async function resolveAccount(addr: string): Promise<Account> {
  try {
    const r = await fetch(`${HUB}/account`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr }),
    });
    const j = await r.json();
    if (!j?.ok) return { addr, accountId: null, balance: null, created: false };
    return { addr, accountId: j.accountId, balance: j.balance ?? null, created: !!j.created };
  } catch {
    return { addr, accountId: null, balance: null, created: false };
  }
}

// The stack labels a seller by EVM address in some places and by Hedera account
// id in others; both mean the same operator, so ownership checks accept either.
export function walletAliases(wallet: string, accountId?: string | null): string[] {
  return accountId ? [wallet, accountId] : [wallet];
}

// Public Hedera explorer. Judges verify balances + payments OUTSIDE our UI here.
export const HASHSCAN = "https://hashscan.io/testnet";
export function hashscanAccount(wallet: string, accountId?: string | null): string {
  // Prefer the canonical account id; HashScan resolves a 0x address too, but
  // only once the account actually exists.
  return `${HASHSCAN}/account/${accountId ?? wallet}`;
}

export interface GBEvent {
  id: string;
  reqId: string;
  lane: string;
  type: string;
  t: number;
  data: Record<string, any>;
}

export interface Lane {
  name: string;
  upstream: string;
  price: number;
  payTo: string;
  owner?: string;
  port: number;
  sample: string;
  chain?: string;         // settlement chain, default "hedera"
  sampleMethod?: string;  // e.g. "POST" for GraphQL lanes (default GET)
  sampleBody?: string;    // request body for POST/GraphQL lanes (e.g. a query)
}

// upstream URL → host, safely (e.g. https://api.chucknorris.io/x → api.chucknorris.io)
export function hostOf(upstream: string): string {
  try { return new URL(upstream).host; } catch { return upstream.replace(/^https?:\/\//, "").split("/")[0]; }
}

export type Tier = "human" | "bot" | "anon";

// One row in the payments tables — a settled or failed x402 flow, joined with
// its Hedera receipt by reqId.
export interface Payment {
  reqId: string;
  lane: string;
  from: string;
  amount: number;
  tier: Tier;
  verified: boolean;
  path: string;
  payTo?: string;
  status: "settled" | "failed";
  reason?: string;
  txHash?: string;
  hashscan?: string; // the settlement transaction on HashScan (from hedera_receipt)
  hcsUrl?: string; // the HCS receipt message for this payment (from hcs_receipt)
  hcsTopicUrl?: string; // the topic holding every receipt
  t: number;
}

export interface Policy {
  humanVerifiedOnly?: boolean;
  botMultiplier?: number;
  blockBots?: boolean;
  streaming?: boolean;
  streamRate?: number;
  dynamicPricing?: boolean;
  priceFloor?: number;
  priceCeiling?: number;
}

export interface Snapshot {
  totalIncome: number;
  totalRequests: number;
  avgPrice: number;
  byEndpoint: { key: string; value: number }[];
  byHour: number[];
  byCountry: { code: string; name: string; flag: string; value: number }[];
  byPayer: { payer: string; spend: number; calls: number }[];
}

// The top-level fields are the "All APIs" fold; byLane holds the same shape per
// API, keyed by lane name, for every lane that is currently live.
export interface Analytics extends Snapshot {
  byLane: Record<string, Snapshot>;
}

// Connect the judge's real MetaMask wallet. Returns the EVM address (which is
// also the Hedera account: settling HBAR to it lazy-creates the account, so the
// balance then resolves on the mirror node by this same 0x address).
export const HEDERA_TESTNET_PARAMS = {
  chainId: "0x128", // 296
  chainName: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: ["https://testnet.hashio.io/api"],
  blockExplorerUrls: ["https://hashscan.io/testnet"],
};
export async function connectMetaMask(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("no-metamask");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const addr = accounts?.[0];
  if (!addr) return null;
  try {
    await eth.request({ method: "wallet_addEthereumChain", params: [HEDERA_TESTNET_PARAMS] });
  } catch { /* user can decline the network add; identity still works */ }
  return addr;
}

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(`${HUB}${path}`);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  lanes: () => jget<{ lanes: Lane[] }>("/lanes").then((r) => r.lanes),
  analytics: () => jget<Analytics>("/analytics"),
  // the receipt topic exists before any payment does, so the link can be shown
  // from a cold start rather than only after the first settlement
  status: () => jget<{ hcsTopic: string | null; hcsTopicUrl: string | null }>("/status"),
  getPolicy: (lane: string) => jget<{ policy: Policy }>(`/policy/${encodeURIComponent(lane)}`).then((r) => r.policy ?? {}),
  setPolicy: async (lane: string, patch: Partial<Policy>) => {
    const r = await fetch(`${HUB}/policy/${encodeURIComponent(lane)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return (await r.json()).policy as Policy;
  },
  faucet: (addr: string, usd: number) =>
    fetch(`${HUB}/faucet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr, usd }),
    }).then((r) => r.json()),
};

// Drive a real x402 payment through a lane's proxy: fund a test buyer, hit the
// sample path, read the 402 quote, retry with an X-PAYMENT header. Every hop
// re-enters the hub as a GBEvent, so the dashboard lights up live.
// Real x402 payment needs a Hedera signature, which can't happen in the browser.
// So the button asks the backend to sign+pay as the demo buyer; blocky402 settles
// on Hedera and every hop streams back over the websocket. `verified` presents a
// World-ID proof so the human-verified pricing tier applies.
export async function sendTestBuyer(lane: Lane, verified = false): Promise<void> {
  await buyFromLane(lane, verified);
}

// A real signed purchase, with the upstream response + Hedera settlement link.
export interface BuyResult {
  ok: boolean;
  status: number;
  body?: string;      // the real upstream response the buyer received
  txHash?: string;
  hashscan?: string;  // Hedera testnet transaction link
  verified?: boolean;
  error?: string;
}

export const laneUrl = (lane: Lane) => `http://localhost:${lane.port}${lane.sample || "/"}`;

// Buyer Playground: ask the backend to make a REAL signed x402 purchase as the
// demo buyer — verified=World-ID human, or anonymous bot. Returns the upstream
// body and the on-chain settlement, so the buyer side is verifiably real.
// GraphQL/POST lanes (e.g. Tally) pass method="POST" + a body (the query); GET
// lanes leave them undefined so the backend does a plain GET.
export async function buyUrl(url: string, verified: boolean, method?: string, body?: string, worldToken?: string): Promise<BuyResult> {
  try {
    const r = await fetch(`${HUB}/testbuyer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, verified, worldToken, method, body }),
    });
    return (await r.json()) as BuyResult;
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

// World ID: verify once, get a short-lived signed token. The gateway checks that
// signature on every request, so presenting the token is what buys the human
// tier — claiming to be human no longer does anything.
// What the IDKit widget needs, signed by the hub (World ID 4.0 makes the relying
// party sign each proof request). live:false means World isn't configured, so the
// UI offers a clearly-labelled simulated session instead of pretending.
export interface WorldContext {
  live: boolean;
  app_id?: string;
  action?: string;
  credential?: string;
  rp_context?: Record<string, unknown>;
}
export async function worldContext(): Promise<WorldContext> {
  try {
    return (await fetch(`${HUB}/world/context`).then((r) => r.json())) as WorldContext;
  } catch {
    return { live: false };
  }
}

export interface WorldVerifyResult { ok: boolean; token?: string; simulated?: boolean; error?: string }
export async function worldVerify(wallet: string, proof?: unknown): Promise<WorldVerifyResult> {
  try {
    const r = await fetch(`${HUB}/world/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, proof }),
    });
    return (await r.json()) as WorldVerifyResult;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const buyFromLane = (lane: Lane, verified: boolean, worldToken?: string) =>
  buyUrl(laneUrl(lane), verified, lane.sampleMethod, lane.sampleBody, worldToken);

// Live testnet balance (HBAR) for the connected wallet, via the Hedera mirror
// node. Works with the 0x EVM alias. Returns HBAR (not tinybars), or null.
export async function fetchHbarBalance(addrOrAlias: string): Promise<number | null> {
  try {
    const r = await fetch(`${MIRROR}/accounts/${addrOrAlias}`);
    if (!r.ok) return null;
    const j = await r.json();
    const tinybars = Number(j?.balance?.balance);
    if (!Number.isFinite(tinybars)) return null;
    return tinybars / 1e8;
  } catch {
    return null;
  }
}

// ---- formatting helpers ----
export const sameAddr = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function shortAddr(a?: string): string {
  if (!a) return "unknown";
  if (!a.startsWith("0x") || a.length <= 13) return a; // agent names / short ids pass through
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// A stable gradient per payer, so avatars are recognizable across rows.
export function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 120 + (h % 80)) % 360;
  return `linear-gradient(135deg, oklch(0.62 0.20 ${a}), oklch(0.58 0.24 ${b}))`;
}

export function usd(n: number, dp = 2): string {
  return `$${n.toFixed(dp)}`;
}

export function ago(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

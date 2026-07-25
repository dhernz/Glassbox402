// hub.ts — the Lens's view of the GlassBox402 backend.
// Types mirror core/src/events.ts + analytics.ts. All HTTP/WS talks to the
// hub on :4021; the one external call allowed is the Hedera mirror node.

export const HUB = "http://localhost:4021";
export const HUB_WS = "ws://localhost:4021";
export const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

// Demo seller = Hedera account 0.0.9742887 (EVM address 0xcca7…dd55). Payments
// settle here and the balance grows on-chain. The connected-wallet identity is
// the EVM address (shown in the UI and the `--wallet` convert command); the
// mirror-node balance is fetched by account id, since this account has no EVM
// alias registered and its 0x form doesn't resolve on the mirror node.
export const DEFAULT_WALLET = "0xcca76e7c0b8b19351a83701517c5c2d18b83dd55";
export const DEFAULT_ACCOUNT_ID = "0.0.9742887";

// wallet (lowercased) → Hedera account id for the balance lookup.
const BALANCE_ACCOUNT: Record<string, string> = {
  [DEFAULT_WALLET]: DEFAULT_ACCOUNT_ID,
};
export function balanceAccountFor(wallet: string): string {
  return BALANCE_ACCOUNT[wallet.toLowerCase()] ?? wallet;
}

// Different components of the stack may label the seller by EVM address or by
// account id. Treat them as the same operator so payment scoping matches either.
const ALIASES: Record<string, string[]> = {
  [DEFAULT_WALLET]: [DEFAULT_WALLET, DEFAULT_ACCOUNT_ID],
  [DEFAULT_ACCOUNT_ID]: [DEFAULT_WALLET, DEFAULT_ACCOUNT_ID],
};
export function walletAliases(wallet: string): string[] {
  return ALIASES[wallet.toLowerCase()] ?? ALIASES[wallet] ?? [wallet];
}

// Public Hedera explorer. Judges verify balances + payments OUTSIDE our UI here.
export const HASHSCAN = "https://hashscan.io/testnet";
export function hashscanAccount(wallet: string): string {
  // balanceAccountFor gives the canonical account id when known (default demo
  // wallet), otherwise the 0x address, which HashScan also resolves.
  return `${HASHSCAN}/account/${balanceAccountFor(wallet)}`;
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
  chain?: string; // settlement chain, default "hedera"
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
  hashscan?: string; // real Hedera testnet receipt link (from hedera_receipt)
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

export interface Analytics {
  totalIncome: number;
  totalRequests: number;
  avgPrice: number;
  byEndpoint: { key: string; value: number }[];
  byHour: number[];
  byCountry: { code: string; name: string; flag: string; value: number }[];
  byPayer: { payer: string; spend: number; calls: number }[];
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
  await buyUrl(laneUrl(lane), verified);
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
export async function buyUrl(url: string, verified: boolean): Promise<BuyResult> {
  try {
    const r = await fetch(`${HUB}/testbuyer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, verified }),
    });
    return (await r.json()) as BuyResult;
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}
export const buyFromLane = (lane: Lane, verified: boolean) => buyUrl(laneUrl(lane), verified);

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

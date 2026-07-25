// The watcher — a bot with a wallet and a job.
// It buys a live ETH price every tick and pays per look. The Lens hero shows
// its wallet draining and the feed it's buying — and when the wallet hits $0,
// the feed FREEZES. That's the whole point of x402, made visceral.
//
//   pnpm watcher                         → funded, does its job
//   HERO_BUDGET=0.3 INTERVAL=1500 ...     → drains fast for the demo
//   BROKE=1 WALLET=0xBROKE pnpm watcher   → empty wallet, feed never starts

import { paidFetch } from "./paid-fetch.js";
import { emit, gbe, HUB_URL } from "./events.js";

const WALLET = process.env.WALLET ?? "0xWATCHER";
const BROKE = process.env.BROKE === "1";
const INTERVAL = Number(process.env.INTERVAL ?? 2500);
const BUDGET = Number(process.env.HERO_BUDGET ?? 5);
const LANE1 = process.env.LANE1 ?? "http://localhost:4030/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const LANE2 = process.env.LANE2 ?? "http://localhost:4031/v2/prices/ETH-USD/spot";
const GRAPHQL_LANE = process.env.GRAPHQL_LANE; // Uniswap v3 subgraph via The Graph gateway
const THRESHOLD = Number(process.env.THRESHOLD ?? 0.0005);

// prefer the on-chain subgraph as the hero feed source when available
const FEED = GRAPHQL_LANE
  ? { url: GRAPHQL_LANE, source: "uniswap-v3", graphql: true }
  : { url: LANE1, source: "coingecko", graphql: false };

let spent = 0, looks = 0;
let lastPrice: number | null = null;
let frozen = false;

async function balance(): Promise<number> {
  const { balances } = await fetch(`${HUB_URL}/balances`).then((r) => r.json()).catch(() => ({ balances: {} }));
  return balances[WALLET] ?? 0;
}

async function main() {
  if (!BROKE) {
    await fetch(`${HUB_URL}/faucet`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr: WALLET, usd: BUDGET }),
    });
    console.log(`👁  watcher ${WALLET} funded with $${BUDGET.toFixed(2)} — no API keys, no accounts, just a wallet`);
  } else {
    console.log(`💀 broke watcher ${WALLET} — empty wallet, the feed never starts`);
  }
  setInterval(tick, INTERVAL);
  tick();
}

async function tick() {
  let price: number | null = null;
  let paidThisTick = 0;
  try {
    const r = FEED.graphql ? await buyGraphql(FEED.url) : await buy(FEED.url);
    price = r.price; paidThisTick = r.paid;
  } catch (e) {
    if (String(e).includes("payment_rejected")) {
      if (!frozen) {
        frozen = true;
        console.log("🧊 FEED FROZEN — wallet empty, the data stops");
        await emit(gbe("feed_frozen", "watcher", crypto.randomUUID(), { wallet: WALLET, source: FEED.source }));
      }
      return;
    }
    console.log(`✗ ${String(e).replaceAll("Error: ", "")}`);
    return;
  }

  if (price == null) return;
  frozen = false;
  const bal = await balance();

  await emit(gbe("feed_tick", "watcher", crypto.randomUUID(), {
    source: FEED.source, value: price, unit: "ETH/USD",
    paid: paidThisTick, wallet: WALLET, balance: bal,
  }));

  if (lastPrice != null) {
    const move = Math.abs(price - lastPrice) / lastPrice;
    if (move >= THRESHOLD) {
      const msg = `ETH ${(move * 100).toFixed(3)}% → $${price.toFixed(2)} · this call cost $${spent.toFixed(3)} of paid data (${looks} looks)`;
      console.log(`📡 SIGNAL: ${msg}`);
      await emit(gbe("signal", "watcher", crypto.randomUUID(), { msg, price, move, spent, looks }));
      spent = 0; looks = 0;
    }
  }
  lastPrice = price;
}

async function buyGraphql(url: string) {
  const { res, paid } = await paidFetch(url, WALLET, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ bundle(id: "1") { ethPriceUSD } }` }),
  });
  spent += paid; looks++;
  const body = await res.json().catch(() => null);
  const price = Number(body?.data?.bundle?.ethPriceUSD ?? NaN);
  if (paid > 0) console.log(`  💸 $${paid.toFixed(3)} → uniswap-v3 subgraph${Number.isFinite(price) ? ` (ETH $${price.toFixed(2)} on-chain)` : ""}`);
  return { price: Number.isFinite(price) ? price : null, paid };
}

async function buy(url: string) {
  const { res, paid } = await paidFetch(url, WALLET);
  spent += paid; looks++;
  const body = await res.json().catch(() => null);
  const price = body?.ethereum?.usd ?? Number(body?.data?.amount ?? NaN);
  if (paid > 0) console.log(`  💸 $${paid.toFixed(3)} → ${new URL(url).host}${Number.isFinite(price) ? ` (ETH $${Number(price).toFixed(2)})` : ""}`);
  return { price: Number.isFinite(price) ? Number(price) : null, paid };
}

main();

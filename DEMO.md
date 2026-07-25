# GlassBox402 — demo script & pitch

## The one-liner

**Google Analytics for x402.** Wrap any API in one command, then watch it earn on Hedera.

## The problem (say this first)

The agent economy already runs on x402 — agents pay per request, no accounts, no keys. But if you're the one **selling**, you're flying blind: payments are base64 blobs in HTTP headers, and there is no Stripe dashboard for machine money. Meanwhile the APIs agents actually need (Tally, Etherscan, a paid subgraph) all require a signup an autonomous agent can't do.

## What GlassBox402 is

Two things:

1. **`x402ify`** — one published npm command that puts any API behind an x402 paywall. Your upstream key never leaves your machine.
2. **The dashboard** — connect your wallet and see every API you've wrapped, income per API, every settled payment with a HashScan receipt, analytics, and feature toggles.

---

## Setup before you present

```bash
./demo.sh          # hub + 4 real x402ified APIs + the dashboard
```

Two browser tabs, both already open:

- **Seller** — http://localhost:5173 (MetaMask **already connected**, so you never do wallet UI on stage)
- **Buyer** — http://localhost:5173?app=buyer

Third window: a terminal. Have the `npx x402ify` line below in your paste buffer.

> Payment settles in ~5s through the facilitator. Keep talking through it — the ka-ching lands while you speak.

---

## 2-minute demo script

**1. The seller's control tower — 25s.**
Open on the seller dashboard, **APIs** view. Four real APIs are listed with live income.
*"I'm an API operator. These are four real third-party APIs I've monetized — Tally for DAO data, a Uniswap v3 subgraph on The Graph, Etherscan, Alpha Vantage. Each one charges agents a cent a call. This is my income, live."*
Point at the HBAR balance on **Overview**. *"That's my actual wallet balance, on Hedera."*

**2. One command, live — 25s.**
Terminal:
```bash
npx x402ify https://api.etherscan.io/v2/api --price 0.01 --wallet 0xYourWallet \
  --query "apikey=$ETHERSCAN_KEY" --sample '/?chainid=1&module=stats&action=ethprice' \
  --hub http://localhost:4021
```
*"That's the whole integration. No code, no metering stack, and my Etherscan key stays here — the buyer never sees it."*
The new API **flashes into the dashboard** the moment it registers.

**3. An agent buys it — 30s.**
Switch to the **buyer playground**. *"Now the other side. This is an agent shopping the x402 market — it discovered these APIs, no signup anywhere."* Click **buy as anonymous bot** on Etherscan.
It shows: the price charged, the **real upstream response** (live ETH price), and a **HashScan link**.
*"Real data, real payment. And that link isn't ours."* Open the HashScan tx. *"That's Hedera testnet. Nothing on my dashboard has to be trusted — it all resolves on-chain."*

**4. The World beat: humans and bots pay different prices — 25s.**
Back on the seller: **Features** → toggle **Require human-verified callers**. *"As the operator I decide who my customers are. Prove you're a unique human with World ID, you pay my base price. Anonymous bot? 10×."*
Buyer tab: click **buy as verified human** and **buy as anonymous bot** on the same API side by side — **$0.01 vs $0.10**, both with real responses and real txs.
*"Same endpoint. Pricing by humanity, as a toggle."*

**5. Close — 15s.**
*"Any API becomes a machine-payable business in one command, the money settles on Hedera, and for the first time the seller can actually see it. `x402ify` is on npm — you can wrap your API before I leave the stage."*

---

## Per-partner pitches

**Hedera — AI & Agentic Payments.** Every payment settles on Hedera testnet through the **blocky402 facilitator** (the textbook Hedera x402 flow — no private key on the resource server). Real HBAR moves to the operator's payout account; each settlement decodes to a **real transaction with a public HashScan link**; HCS receipts give a permanent ordered record (`core/src/hedera.ts`). Network impact: a judge connects a **fresh MetaMask `0x` address and their Hedera account is lazy-created by their first payment** — every EVM-native operator we onboard is a new Hedera account plus a stream of settled txs. Validation: **four real APIs driven end to end**, evidence in [VALIDATION.md](./VALIDATION.md).

**World — human-verified pricing.** Access and price based on human-backed verification: World ID holders get base price, unverified bots pay a multiplier or are blocked entirely. It's a per-API operator toggle in **Features**, not a bolt-on — and it demos as two buttons with two different prices on the same endpoint.

**The Graph — reusable x402 payment tooling.** `x402ify` + the dashboard are drop-in x402 monetization and analytics for any API, and the demo monetizes a **real Uniswap v3 subgraph** (id `5zvR82Qo…VENFV`) at 0.02 HBAR per GraphQL query — agents get pay-per-query on-chain data with no Studio account, because the operator's Bearer key stays server-side.

## Anticipate: "is this staged?"

Three answers, in order:

1. **Open the HashScan tx** from any payment card. Public explorer, not our UI.
2. **Open the payout account** on HashScan — https://hashscan.io/testnet/account/0x2403506eddcd48207ee982d7a8f86901365192ed — every payment, accumulating.
3. **Switch MetaMask to Hedera Testnet** (chainId 296): the same `0x` address shows the HBAR balance growing per payment.

## What's real vs not (be honest at the booth)

- ✅ **Real:** `x402ify` (published, v0.3.0 on npm), the protocol layer (official `@x402` packages), Hedera settlement via blocky402 with HashScan txs, all four upstream APIs returning real data, the dashboard/analytics/income, human-vs-bot pricing tiers.
- 🟡 **Demo-grade:** World ID verification runs in demo-verify mode locally (real verification path is wired in `core/src/world.ts`); analytics **country** data is seeded with labeled synthetic origins because localhost has no real remote IPs.
- ❌ **Not in this build:** mainnet, streaming payments (a toggle in Features, roadmap), the MCP server (`core/src/mcp.ts` predates the real-x402 rewrite and is currently broken — don't demo it).

## Pocket answers

- *"API gateways already exist."* → "They do. None of them come with the instrument attached. The gateway is the on-ramp; the dashboard is the product — and no one shows the seller their machine revenue."
- *"How is this not BlockRun / agentic.market?"* → "Those are the buyer side — a curated marketplace where agents shop. We're the seller side: self-serve, any API, one command. They're the department store; we're Shopify plus the analytics."
- *"The block explorer already shows the payments."* → "It shows the settlement — a transfer with no context, and never the failures. What was bought, what 402'd, who the payer was, what it cost per endpoint — that lives in HTTP and vanishes. That's what we keep."
- *"What's the business model?"* → "The operator earns the per-request fee on whatever they wrap; that's their revenue. We take a small rate on settled volume plus paid features — human-verified pricing, streaming, alerting — for operators with real traffic."
- *"Why would anyone pay for a public API?"* → "They're paying for the call, not for premium access. And for keyed APIs — Tally, Etherscan, a paid subgraph — an agent literally cannot sign up. One command turns your access into per-call revenue."
- *"Who's the customer?"* → "Developers already selling data or compute who want agent revenue without building metering and billing. `x402ify` is the free wedge; the dashboard is why they stay."

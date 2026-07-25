# GlassBox402 — demo script & pitch

## The one-liner
**Stripe made card payments one snippet and a dashboard. GlassBox402 does it for machine payments: x402 in one command, with a screen.**

## The problem (say this first)
The agent economy already runs on x402 — 100M+ machine payments in six months. But it's **invisible**: payments are base64 blobs in HTTP headers, and every *failed* payment never even reaches a block explorer. Sellers can't see their API earning; developers debug blind.

## What GlassBox402 does
One command turns any API into a machine-payable business. A live screen — the Lens — shows the *consequence* of payment: a machine's wallet draining as it buys a live data feed, and the feed **freezing the instant the money runs out**.

---

## 90-second demo script

**1. The hero (consequence) — 30s.** Screen open on the Lens. An agent's wallet (`$0.50`) is draining in real cents as it buys a live ETH price from the **Uniswap v3 subgraph on The Graph** — paying per query, no API key. *"This agent is buying on-chain data, per look. Watch the wallet."* The wallet hits `$0` → the feed **FREEZES**. *"The data lives only as long as the machine keeps paying. That's x402."* Click **top up** → it revives.

**2. One command — 15s.** Terminal: `npx x402ify https://api.coingecko.com --price 0.01`. *"Any API. One command. Now it charges machines a cent per call and settles on Hedera."* A new lane appears on the Lens.

**3. Real settlement — 15s.** Click any payment card → **"ℏ settled on Hedera · HashScan ↗"** → open the real testnet transaction. *"Every payment is a real receipt on Hedera Consensus Service. A block explorer only sees this last step — the Lens shows all of it."*

**4. An AI pays for its own data (MCP) — 20s.** In a Claude/agent window: *"what's the ETH price? use glassbox402."* The agent calls the MCP server, discovers the lanes, pays a cent — and the **ka-ching lands on the Lens mid-answer**. *"Any AI agent is now a paying customer."*

**5. Close — 10s.** *"100 million machine payments happened this year and nobody could see one. GlassBox402: any API, one command, and the glass to watch the machines pay."*

---

## Per-booth pitches

**The Graph — Best AI Tooling ($3k).** GlassBox402 is reusable x402 payment tooling (gateway + Lens + MCP server) — all three of your named categories. The demo monetizes a **real Uniswap v3 subgraph**: agents pay per query for on-chain data, no Studio account. *A trading agent buying the liquidity data behind each decision.*

**Hedera — AI & Agentic Payments ($3k).** Every x402 payment settles on Hedera testnet with an **HCS receipt** (real transactions, HashScan links in the UI). The watcher is an autonomous agent executing payments. High-frequency micropayments are exactly Hedera's story.

**ENS (stretch).** Paid lanes are published as ENS text records; an agent discovers every payable API from just the parent name (no hard-coded URLs). *[status: discovery/resolution code done; 2LD registration on Sepolia pending via the ENS app]*

**0G (stretch).** The watcher's decision inference runs on 0G Compute (Router). *[status: needs pc.0g.ai key]*

---

## What's real vs pending (be honest at the booth)
- ✅ **Real:** the gateway, the Lens + consequence hero, The Graph subgraph payments, Hedera HCS settlement + HashScan links, the MCP server (any AI agent pays).
- ⏳ **Pending:** ENS 2LD registration (Sepolia contract mismatch — finish via ENS app), 0G Compute (needs API key).
- The demo's payment ledger is a local facilitator on the x402 wire format; **Hedera settlement is real on-chain**. Say this plainly if asked.

## Pocket answers
- *"Gateways exist."* → "They do — ours is the first with the instrument attached. The gateway is the on-ramp; the Lens is the product."
- *"How is this not BlockRun?"* → "BlockRun is a curated buyer-side aggregator of ~100 APIs. We're self-serve: any API, one command — how the other 50M join. And they have no observability."
- *"The explorer already shows payments."* → "It shows the settlement — a hex transfer with no context, and never the failures. The commerce (what was bought, what failed) lives in HTTP and vanishes. That's what we show."

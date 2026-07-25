# GlassBox402

> **Stripe made card payments one snippet and a dashboard.**
> **GlassBox402 does the same for machine payments: x402 in one command, with a screen.**

The agent economy already runs on [x402](https://x402.org), with 100M+ machine payments in six months. But it stays invisible: payments are base64 blobs in HTTP headers, and every failed payment never even reaches a block explorer. Sellers cannot see their API earning, and developers debug blind. GlassBox402 makes any API machine payable in one command, and gives you a live screen to watch, hear, and replay every payment.

Built at **ETHGlobal Lisbon 2026**.

## One command turns any API into a business

```bash
npx x402ify https://api.coingecko.com --price 0.01 --name coingecko
```

That API now charges machines a cent per call, settles on **Hedera testnet**, and streams every payment to the Lens.

## The Lens shows consequence, not mechanism

The hero of the screen is a machine's wallet draining in real cents as it buys a live data feed. When the wallet hits zero, the feed freezes on screen. Top it up and it comes back to life. The data lives only as long as the machine keeps paying. That is x402, made visceral.

## What is real

| Piece | Status |
|---|---|
| One command x402 gateway (`x402ify`) | done, any URL, per call pricing |
| The Lens, a live payment screen | done, consequence view plus replay |
| **The Graph**, pay per query Uniswap v3 subgraph | done, real gateway, keyless for the buyer |
| **Hedera**, settlement plus HCS receipts | done, real testnet tx, HashScan links |
| **MCP server**, any AI agent becomes a paying customer | done, `list_paid_apis` plus `paid_fetch` |
| Watcher bot, an agent that pays per look | done, real APIs, real spend |

## Run it

```bash
pnpm install
cp .env.example .env   # add your testnet keys
./demo.sh              # gateway lanes plus Lens at http://localhost:5173

# other terminals:
GRAPHQL_LANE=http://localhost:4032/ pnpm watcher   # the watcher goes to work
pnpm broke                                          # a broke agent, payments fail visibly
```

## Let an AI pay for its own data (MCP)

Add to your MCP client (`.mcp.json` included):

```json
{ "mcpServers": { "glassbox402": {
  "command": "pnpm", "args": ["--dir","glassbox402/core","exec","tsx","src/mcp.ts"] } } }
```

Then ask your agent "what's the ETH price? use glassbox402" and it discovers the lanes, pays a cent, and the payment lands on the Lens mid answer.

## Architecture

```
core/src/x402ify.ts    the one command, x402 paywall proxy for any URL
core/src/hub.ts        event broadcaster (ws :4021) plus facilitator plus tape
core/src/hedera.ts     real settlement plus HCS receipts on Hedera testnet
core/src/mcp.ts        MCP server, any AI agent pays for data
core/src/watcher.ts    demo buyer, a watcher with a wallet
lens/                  the screen, consequence hero, sound, replay
```

## Tests and rail checks

```bash
pnpm test:e2e     # golden path plus failure path, offline
pnpm verify       # Graph plus Hedera plus Sepolia connectivity
pnpm hedera:test  # land a real Hedera testnet receipt
```

## Bounty tracks

The Graph (Best AI Tooling), Hedera (AI and Agentic Payments), ENS (agent identity and discovery), 0G (Infra and Tooling).

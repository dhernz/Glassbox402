# GlassBox402

> **Convert any API into an x402. Track it all in one place.**

**Live: [glassbox402-production.up.railway.app](https://glassbox402-production.up.railway.app)** — connect any wallet. If Hedera has never seen the address, connecting creates the account for you.

Built at ETHGlobal Lisbon 2026.

**Docs:** [the pitch deck](./deck/index.html) · [Hedera, validation & business](./HEDERA.md) · [World ID Selfie Check](./WORLD-SELFIE-CHECK.md)

## The problem

APIs were built for humans, not AI agents.

If an AI wants to use Etherscan, a human has to create the key, configure it, and hand it to
the agent. **Machines cannot access this API directly.** There is a person in the middle of
every machine transaction.

And the other side is just as stuck. An API provider who wants to sell to agents has to
maintain keys, rate limits, billing and auth that all assume a human signed up — and adopting
[x402](https://x402.org) means writing payment logic, supporting each chain, and building
their own dashboards. Every provider ends up rebuilding the same tooling.

## The solution

GlassBox402 converts APIs into an x402. Three things:

1. **One npm package.** [`x402ify`](https://www.npmjs.com/package/x402ify) turns any existing
   API into an x402 API in minutes. No code, no metering stack, and your upstream key never
   leaves your machine.
2. **Hedera, Base and Solana.** One flag picks where it settles. No separate payment
   integration to build per chain.
3. **One dashboard.** Revenue across every API you have wrapped, which endpoints are called,
   payment and usage trends, and pricing policies — including charging agents and humans
   differently.

**Machines can pay for it directly.** No signup, no key, no human.

## Wrap any API in one command

```bash
npx x402ify https://api.chucknorris.io --price 0.01 --wallet 0xYourWallet --sample /jokes/random
```

That API now charges callers per request over the x402 protocol, settled on Hedera. No code,
and no private key on the server: the facilitator and the caller's wallet do the signing. Add
`--hub http://localhost:4021` to stream every payment into your GlassBox402 dashboard.

`x402ify` is chain-agnostic. Pick where it settles with `--chain hedera | base | base-sepolia | solana`.

## How it works

```
your API  ->  x402ify (wrap)  ->  @x402 paymentMiddleware  ->  blocky402 facilitator  ->  Hedera testnet
                   |
                   +-- events -->  GlassBox402 hub  -->  the dashboard (live + analytics)
```

- The convert layer is the standard `@x402` packages, so the protocol is chain-agnostic.
- Settlement runs through Hedera's blocky402 facilitator, the textbook Hedera x402 flow (the same one Hedera's own example uses).
- x402ify streams every hop to the hub, which the dashboard renders live and aggregates into analytics.

## The dashboard

Connect your wallet with MetaMask and you get a live control tower for your x402 APIs:

- **Overview** — total income, request count, and your live HBAR balance growing on-chain.
- **APIs** — which APIs you have x402ified, and the income of each.
- **Payments** — every payment as it settles, each with a real HashScan receipt link.
- **Analytics** — calls by endpoint, by hour, by country, and by payer.
- **Features** — require human-verified callers (World ID) so bots pay more, or stream payments.
- **Settings** — payout wallet, Hedera account, settlement network, facilitator.

Everything is scoped to your connected wallet. Payments settle to that wallet on Hedera testnet
and the balance grows on-chain, verifiable on HashScan. Connect a fresh MetaMask address and the
first payment lazy-creates your Hedera account automatically.

## Real APIs we x402ified

These are not mocks. Each is a live third-party service that requires a key an autonomous agent
cannot sign up for on its own. `x402ify` resells the operator's access per request, and the key
never leaves the operator's machine.

| API | What the buyer gets | Auth | How it settles |
| --- | --- | --- | --- |
| **Tally** | DAO governance data (chains, proposals) | GraphQL `POST` + `Api-Key` header | 0.01 HBAR / call → Hedera |
| **The Graph** | Uniswap v3 subgraph (pools, TVL) | GraphQL `POST` + Bearer key | 0.02 HBAR / call → Hedera |
| **Etherscan** | Ethereum on-chain data (V2 API) | `?apikey=` query param | 0.01 HBAR / call → Hedera |
| **Alpha Vantage** | Equity market data (quotes) | `?apikey=` query param | 0.01 HBAR / call → Hedera |

Every one of these was driven end to end: buyer pays over x402, gets the real upstream response,
and the payment lands in the operator's Hedera wallet with a HashScan transaction. See
[HEDERA.md](./HEDERA.md) for the evidence.

## Any AI agent as a paying customer (MCP)

The repo ships an MCP server (`core/src/mcp.ts`, wired in `.mcp.json`), so a Claude or GPT agent
can shop the x402 market on its own:

- `list_paid_apis` — what is for sale: name, price per call, the URL, and how to call it.
- `paid_fetch` — pay the per-call price and get the data back, with the real Hedera transaction.

Ask an agent something it cannot answer for free ("what is the TVL of the top Uniswap v3 pools?
use glassbox402") and it discovers the subgraph, pays 0.02 HBAR, and answers — while the payment
appears live on the dashboard. It signs with the same real x402 client the dashboard's test buyer
uses, so these are on-chain payments, not a simulation. Set `HEDERA_ACCOUNT_ID` /
`HEDERA_PRIVATE_KEY` in `.env` (the agent's buying wallet) and the server picks them up
automatically.

## Partners

- **Hedera** — every payment settles and is receipted on Hedera testnet, with real transactions and HashScan links. See [HEDERA.md](./HEDERA.md).
- **World** — human-verified pricing via **World ID Selfie Check**: a caller who proves a real, live person is behind them pays the base price; unverified bots pay 10× or are refused. Not a login — a per-request pricing and abuse-prevention signal, bound to the rp-scoped nullifier so one human means one session no matter how many wallets their agent rotates through. See [WORLD-SELFIE-CHECK.md](./WORLD-SELFIE-CHECK.md).
- **The Graph** — a monetized Graph subgraph as one of the demo APIs (pay-per-query on-chain data).

## Run it locally

```bash
pnpm install
cp .env.example .env    # add your Hedera testnet operator account + the API keys

# one command: hub + 4 real x402ified APIs + the dashboard
./demo.sh
```

That launches the hub, wraps all four real APIs (Tally, The Graph, Etherscan, Alpha Vantage),
and opens the dashboard on http://localhost:4021. Connect MetaMask and click "send test buyer"
on any API to drive a real payment, or open the buyer playground at
http://localhost:4021?app=buyer to shop the market as an agent.

Everything is one port: the hub serves the dashboard as well as the API and the websocket, so
local and production run the identical code path.

To wrap a single API by hand and stream it in:

```bash
# terminal 1 - the hub + the dashboard
pnpm --filter @glassbox/core exec tsx src/serve.ts   # http://localhost:4021

# terminal 2 - wrap any API and stream it into the dashboard
npx x402ify https://api.etherscan.io/v2/api --price 0.01 \
  --wallet 0xYourWallet --query "apikey=$ETHERSCAN_KEY" \
  --sample '/?chainid=1&module=stats&action=ethprice' --hub http://localhost:4021
```

## Sell another API

Add an entry to [`lanes.json`](./lanes.json) and put its key in `.env` (or in Railway).
`core/src/serve.ts` starts a gateway per entry, and the dashboard picks it up the moment it
registers. A lane whose key is missing is skipped with a warning rather than started — a gateway
with no upstream key would still take the buyer's HBAR and then fail.

## Deploy

```bash
railway up          # one container: hub + every lane in lanes.json
```

The `Dockerfile` builds the dashboard and hands off to `core/src/serve.ts`. Set the same
variables as `.env`, plus `WALLET` and `WORLD_TOKEN_SECRET` (without the latter the session-token
HMAC falls back to a public dev secret). Keep `HEDERA_TOPIC_ID` set or every redeploy opens a
fresh HCS receipt topic.

## Repo layout

```
packages/x402ify/   the published npm package (wrap any API)
core/               the hub (events, analytics, facilitator glue) and the gateway
lens/               the dashboard (React + the functor design system)
deck/               the pitch deck (open deck/index.html, arrow keys to navigate)
lanes.json          every API being sold — add one line to sell another
Dockerfile          one container: hub + all lanes, one public port
```

## License

MIT

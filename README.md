# GlassBox402

> **Google Analytics for x402.** Wrap any API in one command, then watch it earn on Hedera.

The agent economy runs on [x402](https://x402.org): APIs that charge AI agents tiny per-request payments in crypto, with no accounts and no API keys. GlassBox402 is two things:

1. **[`x402ify`](https://www.npmjs.com/package/x402ify)** (published on npm) a single command that wraps ANY API with x402 pay-per-call.
2. **The dashboard** the control tower where you connect your wallet, see which APIs you have x402ified, track the income of each, view analytics, and add features like human-verified pricing.

Built at ETHGlobal Lisbon 2026.

## Wrap any API in one command

```bash
npx x402ify https://api.chucknorris.io --price 0.01 --wallet 0xYourWallet --sample /jokes/random
```

That API now charges callers per request over the x402 protocol, settled on Hedera. No code, and no private key on the server: the facilitator and the caller's wallet do the signing. Add `--hub http://localhost:4021` to stream every payment into your GlassBox402 dashboard.

`x402ify` is chain-agnostic. Pick where it settles with `--chain hedera | base | base-sepolia | solana`.

## The dashboard (the product)

Connect your wallet with MetaMask and you get a live control tower for your x402 APIs:

- **APIs** which APIs you have x402ified, and the income of each.
- **Overview** total income, request count, and your live HBAR balance growing on-chain.
- **Payments** every payment as it settles, each with a real HashScan receipt link.
- **Analytics** calls by endpoint, by hour, by country, and by payer.
- **Features** require human-verified callers (World ID) so bots pay more, or stream payments.

Everything is scoped to your connected wallet. Payments settle to that wallet on Hedera testnet and the balance grows on-chain, verifiable on HashScan. Connect a fresh MetaMask address and the first payment lazy-creates your Hedera account automatically.

## How it works

```
your API  ->  x402ify (wrap)  ->  @x402 paymentMiddleware  ->  blocky402 facilitator  ->  Hedera testnet
                   |
                   +-- events -->  GlassBox402 hub  -->  the dashboard (live + analytics)
```

- The convert layer is the standard `@x402` packages, so the protocol is chain-agnostic.
- Settlement runs through Hedera's blocky402 facilitator, the textbook Hedera x402 flow (the same one Hedera's own example uses).
- x402ify streams every hop to the hub, which the dashboard renders live and aggregates into analytics.

## Partners

- **Hedera** every payment settles and is receipted on Hedera testnet, with real transactions and HashScan links.
- **World** human-verified pricing: callers who prove they are a real human (World ID) pay the base price, anonymous bots pay more.
- **The Graph** a monetized Graph subgraph as one of the demo APIs (pay-per-query on-chain data).

## Real APIs we x402ified

These are not mocks. Each is a live third-party service that requires a key an autonomous agent cannot sign up for on its own. `x402ify` resells the operator's access per request, and the key never leaves the operator's machine.

| API | What the buyer gets | Auth | How it settles |
| --- | --- | --- | --- |
| **Tally** | DAO governance data (chains, proposals) | GraphQL `POST` + `Api-Key` header | 0.01 HBAR / call → Hedera |
| **The Graph** | Uniswap v3 subgraph (pools, TVL) | GraphQL `POST` + Bearer key | 0.02 HBAR / call → Hedera |
| **Etherscan** | Ethereum on-chain data (V2 API) | `?apikey=` query param | 0.01 HBAR / call → Hedera |
| **Alpha Vantage** | Equity market data (quotes) | `?apikey=` query param | 0.01 HBAR / call → Hedera |

Every one of these was driven end to end: buyer pays over x402, gets the real upstream response, and the payment lands in the operator's Hedera wallet with a HashScan transaction. See [VALIDATION.md](./VALIDATION.md) for the evidence.

## Any AI agent as a paying customer (MCP)

The repo ships an MCP server (`core/src/mcp.ts`, wired in `.mcp.json`), so a Claude or GPT agent can shop the x402 market on its own:

- `list_paid_apis` — what is for sale: name, price per call, the URL, and how to call it.
- `paid_fetch` — pay the per-call price and get the data back, with the real Hedera transaction.

Ask an agent something it cannot answer for free ("what is the TVL of the top Uniswap v3 pools? use glassbox402") and it discovers the subgraph, pays 0.02 HBAR, and answers — while the payment appears live on the dashboard. It signs with the same real x402 client the dashboard's test buyer uses, so these are on-chain payments, not a simulation. Set `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` in `.env` (the agent's buying wallet) and the server picks them up automatically.

## Business model

**The operator earns the per-request x402 fee on whatever API they wrap.** That is the revenue, full stop. The buyer is not paying for "premium" access to a gated tier; they are paying the operator's per-call price to make the request at all.

Wrapping keyed APIs an agent cannot sign up for (Tally, Etherscan, a paid subgraph) is simply one compelling reason a buyer is willing to pay, but the business is the per-call charge itself. Any operator with an API and a wallet becomes a seller in the agent economy in one command; GlassBox402 is the dashboard that makes that income visible and controllable.

GlassBox402 monetizes as the control tower on top: a small take rate on settled volume, plus paid features (human-verified pricing, streaming, richer analytics, alerting) for operators running real traffic.

## Hedera services used

- **x402 settlement via the blocky402 facilitator** — the textbook Hedera x402 flow; every paid request is settled on Hedera testnet, no private key on the resource server.
- **HBAR transfers** — payments move real testnet HBAR to the operator's payout account.
- **Account lazy-create from a MetaMask address** — a judge connects a fresh `0x` EVM address; the first payment lazy-creates the matching Hedera account, resolvable on the mirror node.
- **HashScan explorer links** — each settlement decodes to a real transaction id with a public HashScan link, so nothing in the UI has to be trusted.
- **Mirror node** — used to resolve EVM addresses to Hedera accounts and read on-chain balances.
- **Hedera Consensus Service (HCS)** — every settled payment writes a receipt to a public HCS topic (`core/src/hub.ts` → `core/src/hedera.ts`): which lane, which buyer, which price, and the settlement transaction it belongs to. The transaction proves the money moved; the topic proves what it was *for*. That means the dashboard's income numbers are auditable against Hedera rather than trusted — read the topic straight off the mirror node and it has to agree with the UI.

## Network impact for Hedera

Every operator who runs `x402ify` turns an existing API into Hedera transaction volume, and every buyer is a new Hedera account and a stream of settled transactions. Because accounts lazy-create from MetaMask addresses, onboarding an EVM-native user to Hedera is a side effect of their first payment, not a separate step. The pattern scales linearly: more wrapped APIs and more agent calls both translate directly into Hedera account creation and TPS.

## Roadmap

- **Mainnet settlement** and a hosted `x402ify` so operators do not run their own process.
- **More auth patterns** out of the box (OAuth token refresh, signed requests, per-route pricing).
- **Payout routing** — split revenue between the API owner and the operator, or to a treasury.
- **Alerting and budgets** — notify on income spikes, anomalous callers, or a lane going down.
- **Marketplace listing** — publish x402ified APIs to a public directory agents can discover.

## Go to market

Start where the pain is sharpest: developers who already sell data or compute and want agent revenue without building a metering and billing stack. `x402ify` is the free, published wedge (`npx x402ify …`); the dashboard is the reason they stay. Land individual operators through the x402 and agent-tooling communities, then expand to teams running multiple monetized endpoints who need the analytics and controls.

## Run it locally

```bash
pnpm install
cp .env.example .env    # add your Hedera testnet operator account + the API keys

# one command: hub + 4 real x402ified APIs + the dashboard
./demo.sh
```

That launches the hub, wraps all four real APIs (Tally, The Graph, Etherscan, Alpha Vantage), and opens the dashboard on http://localhost:5173. Connect MetaMask and click "send test buyer" on any API to drive a real payment, or open the buyer playground at http://localhost:5173?app=buyer to shop the market as an agent.

To wrap a single API by hand and stream it in:

```bash
# terminal 1 - the hub + the dashboard
pnpm --filter @glassbox/core exec tsx src/hub.ts
pnpm --filter @glassbox/lens dev                 # http://localhost:5173

# terminal 2 - wrap any API and stream it into the dashboard
npx x402ify https://api.etherscan.io/v2/api --price 0.01 \
  --wallet 0xYourWallet --query "apikey=$ETHERSCAN_KEY" \
  --sample '/?chainid=1&module=stats&action=ethprice' --hub http://localhost:4021
```

## Repo layout

```
packages/x402ify/   the published npm package (wrap any API)
core/               the hub (events, analytics, facilitator glue) and the gateway
lens/               the dashboard (React + the functor design system)
```

## License

MIT

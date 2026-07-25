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

## Run it locally

```bash
pnpm install
cp .env.example .env    # add your Hedera testnet operator account (signs the demo buyer's payments)

# terminal 1 - the hub + the dashboard
pnpm --filter @glassbox/core exec tsx src/hub.ts
pnpm --filter @glassbox/lens dev                 # http://localhost:5173

# terminal 2 - wrap any API and stream it into the dashboard
npx x402ify https://api.coinbase.com --price 0.01 \
  --wallet 0xYourWallet --sample /v2/prices/ETH-USD/spot --hub http://localhost:4021
```

Open the dashboard, connect your wallet, and click "send test buyer" to drive a real payment.

## Repo layout

```
packages/x402ify/   the published npm package (wrap any API)
core/               the hub (events, analytics, facilitator glue) and the gateway
lens/               the dashboard (React + the functor design system)
```

## License

MIT

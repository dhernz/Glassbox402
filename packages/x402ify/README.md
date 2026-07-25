# x402ify

**Wrap any API with [x402](https://x402.org) pay-per-call. One command, no code.**

```bash
npx x402ify https://api.coingecko.com \
  --wallet 0.0.1234 \
  --price 0.01 \
  --sample "/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
```

That API now charges callers per request over the x402 protocol, settled on-chain.
The server holds **no private key** — the facilitator and the caller's wallet do the
signing and settlement. You just point it at an API and give a payout account.

## Chain-agnostic

The x402 protocol is the same everywhere; only the facilitator + scheme change per
chain. Pick one with `--chain`:

| `--chain` | settles on | payout wallet | price unit |
|---|---|---|---|
| `hedera` (default) | Hedera testnet (blocky402 facilitator) | `0.0.x` account | HBAR |
| `base` | Base | `0x…` address | USD (USDC) |
| `base-sepolia` | Base Sepolia | `0x…` address | USD (USDC) |
| `solana` | Solana | address | USD (USDC) |

```bash
npx x402ify https://api.example.com --wallet 0x1234… --price 0.01 --chain base
```

## Options

```
--wallet <acct>      your payout account                              [required]
--price <n>          price per call (chain's unit)                    [0.01]
--chain <name>       hedera | base | base-sepolia | solana            [hedera]
--name <label>       lane label                             [derived from host]
--port <n>           local port                                       [4030]
--sample <path>      a valid GET path on the API                      [/]
--hub <url>          stream payments into a GlassBox402 dashboard     [none]
--facilitator <url>  override the facilitator
--network <id>       override the network id
```

## Watch it earn

Add `--hub <url>` to stream every payment into a [GlassBox402](https://github.com/dhernz/Glassbox402)
dashboard — income, live payments, and analytics by endpoint, country, and payer.

## License

MIT

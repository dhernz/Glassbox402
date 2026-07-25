# Validation

Proof that GlassBox402 works against **real** APIs with **real** payments settling on **Hedera** — not mocks, not a simulator.

## What "validated" means here

For each API below we ran the full loop end to end:

1. `x402ify` wraps the real upstream API and puts it behind an x402 paywall.
2. A buyer requests it and gets **HTTP 402** with a Hedera price quote.
3. The buyer's wallet pays; the **blocky402 facilitator settles the payment on Hedera testnet**.
4. `x402ify` forwards the paid request upstream and returns the **real API response** to the buyer.
5. The payment lands in the operator's Hedera payout account, with a **public HashScan transaction**.

The operator's upstream API key never leaves their machine. The buyer never sees it.

## Four real APIs, wrapped and monetized

| API | Category | Auth pattern | Price | Verified response |
| --- | --- | --- | --- | --- |
| **Tally** | DAO governance | GraphQL `POST` + `Api-Key` header | 0.01 HBAR | real `chains` / proposal data |
| **The Graph** | On-chain analytics | GraphQL `POST` + Bearer key | 0.02 HBAR | real Uniswap v3 pools + TVL |
| **Etherscan** | Ethereum data (V2) | `?apikey=` query param | 0.01 HBAR | live ETH price, e.g. `$1864.83` |
| **Alpha Vantage** | Equity market data | `?apikey=` query param | 0.01 HBAR | live quote, e.g. IBM `$214.19` |

These four cover the three auth patterns real APIs actually use — header keys, Bearer tokens, and query-param keys — plus both REST (`GET`) and GraphQL (`POST`) shapes. Adding a new API is a one-line `x402ify` command, no code.

## On-chain evidence (Hedera testnet)

Sample settlements captured while validating, each a real transaction on Hedera's public explorer:

- **Etherscan call** → https://hashscan.io/testnet/transaction/0.0.7162784-1784996924-255223230
- **Alpha Vantage call** → https://hashscan.io/testnet/transaction/0.0.7162784-1784996926-639539966

Payments accumulate in the operator's payout account, viewable independently of our UI on HashScan:

- **Operator payout account** → https://hashscan.io/testnet/account/0x2403506eddcd48207ee982d7a8f86901365192ed

Because payments settle to the connected wallet's real Hedera account (lazy-created from its EVM address), a judge can also switch MetaMask to the Hedera Testnet network and watch the same address's HBAR balance grow per payment. Nothing in the dashboard has to be trusted — it all resolves to Hedera.

## How to reproduce

```bash
cp .env.example .env    # add HEDERA_ACCOUNT_ID/PRIVATE_KEY + the 4 API keys
./demo.sh               # hub + all 4 real APIs + the dashboard
```

Then in the dashboard (http://localhost:5173) connect MetaMask and click **send test buyer** on any API, or open the **buyer playground** (`?app=buyer`) and buy as an agent. Each buy shows the real response and a HashScan link for the settlement.

## Published traction

`x402ify` is published on npm — anyone can wrap their own API today:

- https://www.npmjs.com/package/x402ify

```bash
npx x402ify https://api.etherscan.io/v2/api --price 0.01 --wallet 0xYourWallet \
  --query "apikey=$ETHERSCAN_KEY" --sample '/?chainid=1&module=stats&action=ethprice'
```

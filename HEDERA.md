# GlassBox402 on Hedera

Every payment in GlassBox402 settles on **Hedera testnet**, and every settlement is
independently verifiable on Hedera's public infrastructure. This file covers how settlement
works, which Hedera services we use, the evidence that it is real, and where the project goes
next.

For what the product is and how to run it, see [README.md](./README.md).

## How settlement works

`x402ify` puts an API behind the standard `@x402` payment middleware and points it at the
**blocky402 facilitator** (`api.testnet.blocky402.com`) — the textbook Hedera x402 flow, the
same one Hedera's own example uses.

```
buyer  ──request──▶  x402ify gateway
       ◀── HTTP 402 + price quote in HBAR
       ──retry with X-PAYMENT──▶  @x402 paymentMiddleware
                                    └──▶ blocky402 facilitator ──▶ Hedera testnet transfer
       ◀── 200 + the real upstream response
```

**The resource server never holds a private key.** The facilitator and the buyer's wallet do
the signing, so an operator can monetize an API without custodying anything.

## Hedera services used

- **x402 settlement via the blocky402 facilitator** — every paid request is settled on Hedera
  testnet, with no private key on the resource server.
- **HBAR transfers** — payments move real testnet HBAR to the operator's payout account.
- **Account lazy-create from a MetaMask address** — a judge connects a fresh `0x` EVM address
  and the first payment lazy-creates the matching Hedera account, resolvable on the mirror node.
- **HashScan explorer links** — each settlement decodes to a real transaction id with a public
  HashScan link, so nothing in the UI has to be trusted.
- **Mirror node** — used to resolve EVM addresses to Hedera accounts and read on-chain balances.
- **Hedera Consensus Service (HCS)** — every settled payment writes a receipt to a public HCS
  topic (`core/src/hub.ts` → `core/src/hedera.ts`): which lane, which buyer, which price, and
  the settlement transaction it belongs to. The transaction proves the money moved; the topic
  proves what it was *for*. That means the dashboard's income numbers are auditable against
  Hedera rather than trusted — read the topic straight off the mirror node and it has to agree
  with the UI.

## Network impact for Hedera

Every operator who runs `x402ify` turns an existing API into Hedera transaction volume, and
every buyer is a new Hedera account and a stream of settled transactions. Because accounts
lazy-create from MetaMask addresses, onboarding an EVM-native user to Hedera is a side effect
of their first payment, not a separate step. The pattern scales linearly: more wrapped APIs
and more agent calls both translate directly into Hedera account creation and TPS.

---

# Validation

Proof that GlassBox402 works against **real** APIs with **real** payments settling on
**Hedera** — not mocks, not a simulator.

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

These four cover the three auth patterns real APIs actually use — header keys, Bearer tokens,
and query-param keys — plus both REST (`GET`) and GraphQL (`POST`) shapes. Adding a new API is
a one-line `x402ify` command, no code.

## On-chain evidence (Hedera testnet)

Sample settlements captured while validating, each a real transaction on Hedera's public explorer:

- **Etherscan call** → https://hashscan.io/testnet/transaction/0.0.7162784-1784996924-255223230
- **Alpha Vantage call** → https://hashscan.io/testnet/transaction/0.0.7162784-1784996926-639539966

Payments accumulate in the operator's payout account, viewable independently of our UI on HashScan:

- **Operator payout account** → https://hashscan.io/testnet/account/0x2403506eddcd48207ee982d7a8f86901365192ed

## The receipts are auditable, not just the transfers

Each settled payment also writes a message to a **Hedera Consensus Service topic** —
consensus-ordered and timestamped by the network — recording what the transfer was *for*.
A sample topic from a validation run:

- **Receipt topic** → https://hashscan.io/testnet/topic/0.0.9748512

```
seq 1 | {"glassbox":"x402-settlement","lane":"etherscan","from":"0.0.9695971","amount":0.01,
         "payTo":"0x2403…92ed","path":"/","tier":"anon","tx":"0.0.7162784@1785002106.167216477"}
seq 2 | {"glassbox":"x402-settlement","lane":"uniswap-data","from":"0.0.9695971","amount":0.02,
         "payTo":"0x2403…92ed","path":"/","tier":"anon","tx":"0.0.7162784@1785002171.641911172"}
```

Read straight from Hedera's public mirror node, with none of our code in the loop:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9748512/messages" \
  | python3 -c "import sys,json,base64;[print(base64.b64decode(m['message']).decode()) for m in json.load(sys.stdin)['messages']]"
```

Each `tx` field ties the receipt back to the settlement transaction above it, so the
dashboard's income figures can be reconciled against Hedera line by line. The hub prints the
topic id at startup and the dashboard links it from the **Payments** header. Receipts are
written fire-and-forget: an operator with no Hedera credentials still serves and settles
payments exactly as before, without receipts.

Because payments settle to the connected wallet's real Hedera account (lazy-created from its
EVM address), a judge can also switch MetaMask to the Hedera Testnet network (chainId 296) and
watch the same address's HBAR balance grow per payment. Nothing in the dashboard has to be
trusted — it all resolves to Hedera.

## How to reproduce

```bash
cp .env.example .env    # add HEDERA_ACCOUNT_ID/PRIVATE_KEY + the 4 API keys
./demo.sh               # hub + all 4 real APIs + the dashboard
```

Then in the dashboard (http://localhost:4021) connect MetaMask and click **send test buyer** on
any API, or open the **buyer playground** (`?app=buyer`) and buy as an agent. Each buy shows the
real response and a HashScan link for the settlement.

## Published traction

`x402ify` is published on npm — anyone can wrap their own API today:

- https://www.npmjs.com/package/x402ify

```bash
npx x402ify https://api.etherscan.io/v2/api --price 0.01 --wallet 0xYourWallet \
  --query "apikey=$ETHERSCAN_KEY" --sample '/?chainid=1&module=stats&action=ethprice'
```

---

# Business model

**The operator earns the per-request x402 fee on whatever API they wrap.** That is the revenue,
full stop. The buyer is not paying for "premium" access to a gated tier; they are paying the
operator's per-call price to make the request at all.

Wrapping keyed APIs an agent cannot sign up for (Tally, Etherscan, a paid subgraph) is simply
one compelling reason a buyer is willing to pay, but the business is the per-call charge
itself. Any operator with an API and a wallet becomes a seller in the agent economy in one
command; GlassBox402 is the dashboard that makes that income visible and controllable.

GlassBox402 monetizes as the control tower on top: a small take rate on settled volume, plus
paid features (human-verified pricing, streaming, richer analytics, alerting) for operators
running real traffic.

## Go to market

Start where the pain is sharpest: developers who already sell data or compute and want agent
revenue without building a metering and billing stack. `x402ify` is the free, published wedge
(`npx x402ify …`); the dashboard is the reason they stay. Land individual operators through the
x402 and agent-tooling communities, then expand to teams running multiple monetized endpoints
who need the analytics and controls.

## Roadmap

- **Mainnet settlement** and a hosted `x402ify` so operators do not run their own process.
- **More auth patterns** out of the box (OAuth token refresh, signed requests, per-route pricing).
- **Payout routing** — split revenue between the API owner and the operator, or to a treasury.
- **Alerting and budgets** — notify on income spikes, anomalous callers, or a lane going down.
- **Marketplace listing** — publish x402ified APIs to a public directory agents can discover.

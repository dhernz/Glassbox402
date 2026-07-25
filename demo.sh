#!/usr/bin/env bash
# GlassBox402 — the whole demo, one script.
# Starts: hub → 4 REAL x402ified APIs → the dashboard.
#
# Each API is a real service that needs a key an AI agent can't sign up for.
# x402ify resells your access per request: the caller pays HBAR over x402,
# blocky402 settles it on Hedera, and your key never leaves this machine.
#
# Requires a gitignored .env with:
#   HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY   (the test-buyer signs with these)
#   TALLY_API_KEY, GRAPH_API_KEY, ETHERSCAN_KEY, ALPHAVANTAGE_KEY
#   WALLET=0x...   (optional; your payout address — where every payment lands)
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT

if [ -f .env ]; then set -a; source .env; set +a; fi
WALLET="${WALLET:-0x2403506eddcd48207ee982d7a8f86901365192ed}"
HUB="http://localhost:4021"
x402ify() { pnpm --filter @glassbox/core exec tsx src/x402ify.ts "$@" --wallet "$WALLET" --hub "$HUB"; }

echo "⚡ starting hub…"
pnpm --filter @glassbox/core exec tsx src/hub.ts --tape demo.tape.jsonl &
sleep 1.5

echo "💰 x402ify Tally  (DAO governance, GraphQL, Api-Key header)…"
x402ify https://api.tally.xyz/query --price 0.01 --name tally --port 4097 \
  --header "Api-Key: $TALLY_API_KEY" --method POST \
  --body '{"query":"query { chains { id name } }"}' &
sleep 0.5

echo "💰 x402ify The Graph  (Uniswap v3 subgraph, GraphQL, Bearer)…"
x402ify "https://gateway.thegraph.com/api/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV" \
  --price 0.02 --name uniswap-data --port 4098 --method POST \
  --body '{"query":"{ pools(first:3, orderBy:totalValueLockedUSD, orderDirection:desc){ id totalValueLockedUSD } }"}' &
sleep 0.5

echo "💰 x402ify Etherscan  (Ethereum data, apikey query param)…"
x402ify https://api.etherscan.io/v2/api --price 0.01 --name etherscan --port 4095 \
  --query "apikey=$ETHERSCAN_KEY" --sample '/?chainid=1&module=stats&action=ethprice' &
sleep 0.5

echo "💰 x402ify Alpha Vantage  (market data, apikey query param)…"
x402ify https://www.alphavantage.co/query --price 0.01 --name alphavantage --port 4094 \
  --query "apikey=$ALPHAVANTAGE_KEY" --sample '/?function=GLOBAL_QUOTE&symbol=IBM' &
sleep 0.5

echo "🔍 opening the dashboard on http://localhost:5173 …"
pnpm --filter @glassbox/lens dev &
(sleep 3 && open http://localhost:5173) &

sleep 2
echo ""
echo "──────────────────────────────────────────────────"
echo "  GlassBox402 is live.  http://localhost:5173"
echo "    seller dashboard : http://localhost:5173"
echo "    buyer playground : http://localhost:5173?app=buyer"
echo ""
echo "  Connect MetaMask, then hit 'send test buyer' on any API,"
echo "  or open the buyer playground and shop the market as an agent."
echo "  Every payment is a real Hedera tx with a HashScan link."
echo ""
echo "  Session recorded to demo.tape.jsonl — replay later with:"
echo "    pnpm --filter @glassbox/core exec tsx src/hub.ts --replay demo.tape.jsonl"
echo "──────────────────────────────────────────────────"
wait

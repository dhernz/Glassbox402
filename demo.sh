#!/usr/bin/env bash
# GlassBox402 — the 8-step demo, one script.
# Starts: hub → CoinGecko lane → Coinbase lane → Lens.
# Then YOU run (separate terminals):
#   pnpm watcher     ← the funded watcher ($5, pays per look)
#   pnpm broke       ← the broke watcher (red cards)
set -e
cd "$(dirname "$0")"

trap 'kill 0' EXIT

echo "⚡ starting hub…"
pnpm --filter @glassbox/core exec tsx src/hub.ts --tape demo.tape.jsonl &
sleep 1

echo "💰 x402ify CoinGecko…"
pnpm --filter @glassbox/core exec tsx src/x402ify.ts https://api.coingecko.com \
  --price 0.01 --name coingecko --port 4030 --sample "/api/v3/ping" &
sleep 0.5

echo "💰 x402ify Coinbase spot…"
pnpm --filter @glassbox/core exec tsx src/x402ify.ts https://api.coinbase.com \
  --price 0.005 --name coinbase --port 4031 --sample "/v2/prices/ETH-USD/spot" &
sleep 0.5

if [ -f .env ]; then set -a; source .env; set +a; fi
if [ -n "$GRAPH_API_KEY" ]; then
  echo "💰 x402ify the Uniswap v3 subgraph (The Graph gateway)…"
  GRAPH_API_KEY=$GRAPH_API_KEY pnpm --filter @glassbox/core exec tsx src/x402ify.ts \
    "https://gateway.thegraph.com/api/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV" \
    --price 0.02 --name uniswap-data --port 4032 &
  sleep 0.5
fi

echo "🔍 opening the Lens on http://localhost:5173 …"
pnpm --filter @glassbox/lens dev &
(sleep 2.5 && open http://localhost:5173) &

sleep 2
echo ""
echo "──────────────────────────────────────────────────"
echo "  GlassBox402 is live.  http://localhost:5173"
echo ""
echo "  Now, in other terminals:"
echo "    GRAPHQL_LANE=http://localhost:4032/ pnpm watcher   → \$5 watcher, pays Uniswap subgraph too"
echo "    pnpm broke     → red cards on demand"
echo ""
echo "  Session recorded to demo.tape.jsonl — replay later with:"
echo "    pnpm --filter @glassbox/core exec tsx src/hub.ts --replay demo.tape.jsonl"
echo "──────────────────────────────────────────────────"
wait

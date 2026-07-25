#!/usr/bin/env bash
# GlassBox402 — the whole demo, one script, one port.
#
# Builds the dashboard, then hands off to core/src/serve.ts, which starts the
# hub and every API listed in lanes.json. The hub serves the dashboard itself,
# so this is byte-for-byte the same topology that runs in production — which
# means if World's IDKit works here, it works deployed.
#
# To sell another API: add it to lanes.json and put its key in .env. No edits here.
#
# Requires a gitignored .env with:
#   HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY   (the test-buyer signs with these)
#   TALLY_API_KEY, GRAPH_API_KEY, ETHERSCAN_KEY, ALPHAVANTAGE_KEY
#   WALLET=0x...   (your payout address — where every payment lands)
set -e
cd "$(dirname "$0")"

if [ -f .env ]; then set -a; source .env; set +a; fi
export WALLET="${WALLET:-0x2403506eddcd48207ee982d7a8f86901365192ed}"
export PORT="${PORT:-4021}"

# Built, not `vite dev`: the dev server mis-types .wasm as octet-stream, which
# breaks World's IDKit widget ("Something went wrong", no console error). The
# hub serves dist/ with the right content-type, so the World ID flow works here.
echo "🏗  building the dashboard…"
pnpm --filter @glassbox/lens exec vite build >/dev/null

echo ""
echo "──────────────────────────────────────────────────"
echo "  GlassBox402 → http://localhost:$PORT"
echo "    seller dashboard : http://localhost:$PORT"
echo "    buyer playground : http://localhost:$PORT?app=buyer"
echo ""
echo "  Connect MetaMask, then hit 'send test buyer' on any API,"
echo "  or open the buyer playground and shop the market as an agent."
echo "  Every payment is a real Hedera tx with a HashScan link."
echo "──────────────────────────────────────────────────"
echo ""

(sleep 6 && open "http://localhost:$PORT") &
exec core/node_modules/.bin/tsx core/src/serve.ts

// Proves the Hedera settlement rail for real:
//   pnpm hedera:test
// Creates an HCS receipt topic and submits one real payment receipt to
// Hedera testnet, then prints the HashScan links. Run before the event.

import { hederaEnabled, ensureTopic, hederaReceipt } from "../core/src/hedera.ts";

if (!hederaEnabled()) {
  console.error("❌ set HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY in .env");
  process.exit(1);
}

console.log("creating HCS receipt topic on Hedera testnet…");
const topic = await ensureTopic();

const memo = JSON.stringify({
  glassbox: "x402-settlement",
  lane: "uniswap-data",
  from: "0xWATCHER",
  amount: 0.02,
  asset: "USDC",
  at: "verify-run",
});
console.log("submitting a payment receipt…");
const r = await hederaReceipt(memo);

console.log("\n✅ real Hedera testnet transaction landed");
console.log(`   topic:  https://hashscan.io/testnet/topic/${topic}`);
console.log(`   tx:     ${r.hashscan}`);
process.exit(0);

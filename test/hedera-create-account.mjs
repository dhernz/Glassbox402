// One-off: create a fresh funded Hedera testnet account to act as the demo
// SELLER (the connected wallet). Payments then transfer from the operator
// (payer) to this account, so the operator watches their balance grow.
//   pnpm --filter @glassbox/core exec tsx ../test/hedera-create-account.mjs

import { Client, PrivateKey, AccountId, AccountCreateTransaction, Hbar } from "@hashgraph/sdk";

const id = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
let key;
try { key = PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY); }
catch { key = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY); }
const client = Client.forTestnet().setOperator(id, key);

const newKey = PrivateKey.generateECDSA();
const tx = await new AccountCreateTransaction()
  .setKeyWithoutAlias(newKey.publicKey)
  .setInitialBalance(new Hbar(2))
  .execute(client);
const receipt = await tx.getReceipt(client);
const acct = receipt.accountId.toString();
const evm = "0x" + newKey.publicKey.toEvmAddress();

console.log("HEDERA_SELLER_ACCOUNT=" + acct);
console.log("HEDERA_SELLER_KEY=" + newKey.toStringRaw());
console.log("HEDERA_SELLER_EVM=" + evm);
console.log("HashScan: https://hashscan.io/testnet/account/" + acct);
process.exit(0);

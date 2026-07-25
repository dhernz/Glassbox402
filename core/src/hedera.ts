// Real settlement on Hedera testnet.
//
// The x402 payment clears on the payment rail; here we mirror it onto Hedera as
// a real, on-chain financial operation + receipt:
//   - one HCS (Hedera Consensus Service) message per payment = the tamper-evident
//     receipt log (the move DIVE won ETHGlobal Cannes with)
//   - optional tiny HBAR transfer when a recipient account is set (unambiguous
//     "token transfer" for the Hedera bounty)
//
// Every receipt returns a HashScan URL — which becomes the final step of the
// Lens replay: "the explorer only ever sees this last step."

import {
  Client, PrivateKey, AccountId, Hbar,
  TopicCreateTransaction, TopicMessageSubmitTransaction, TransferTransaction,
} from "@hashgraph/sdk";

let client: Client | null = null;
let topicId: string | null = null;

export function hederaEnabled(): boolean {
  return !!(process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY);
}

export function initHedera(): Client {
  if (client) return client;
  const id = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!);
  const raw = process.env.HEDERA_PRIVATE_KEY!;
  // EVM-alias accounts use ECDSA keys; fall back to DER/ED25519 just in case.
  let key: PrivateKey;
  try { key = PrivateKey.fromStringECDSA(raw); }
  catch { key = PrivateKey.fromString(raw); }
  client = Client.forTestnet().setOperator(id, key);
  return client;
}

export async function ensureTopic(): Promise<string> {
  if (topicId) return topicId;
  // A restart would otherwise open a fresh topic and lose the receipt history —
  // set HEDERA_TOPIC_ID in .env to keep one durable topic across runs.
  if (process.env.HEDERA_TOPIC_ID) {
    topicId = process.env.HEDERA_TOPIC_ID;
    console.log(`🪵 HCS receipt topic ${topicId} (from HEDERA_TOPIC_ID)  https://hashscan.io/testnet/topic/${topicId}`);
    return topicId;
  }
  const c = initHedera();
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("GlassBox402 x402 receipts")
    .execute(c);
  const receipt = await tx.getReceipt(c);
  topicId = receipt.topicId!.toString();
  console.log(`🪵 HCS receipt topic ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
  console.log(`   ↳ add HEDERA_TOPIC_ID=${topicId} to .env to keep this topic across restarts`);
  return topicId;
}

const hashscanTx = (txId: string) =>
  // HashScan wants 0.0.x@sss.nnn as 0.0.x-sss-nnn
  `https://hashscan.io/testnet/transaction/${txId.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;

export interface HederaReceipt { txId: string; topicId: string; hashscan: string; }

export async function hederaReceipt(memo: string): Promise<HederaReceipt> {
  const c = initHedera();
  const topic = await ensureTopic();
  const submit = await new TopicMessageSubmitTransaction()
    .setTopicId(topic)
    .setMessage(memo)
    .execute(c);
  await submit.getReceipt(c);
  const txId = submit.transactionId!.toString();
  return { txId, topicId: topic, hashscan: hashscanTx(txId) };
}

// Real HBAR transfer to any recipient — an account id (0.0.x) OR a raw EVM
// address (0x…). Sending to a fresh EVM address lazy-creates the account, so a
// judge's freshly-connected MetaMask wallet just starts receiving HBAR.
export async function hederaTransfer(to: string, hbar = 0.001): Promise<HederaReceipt> {
  const c = initHedera();
  const from = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!);
  const toAccount = to.startsWith("0x") ? AccountId.fromEvmAddress(0, 0, to) : AccountId.fromString(to);
  const tx = await new TransferTransaction()
    .addHbarTransfer(from, new Hbar(-hbar))
    .addHbarTransfer(toAccount, new Hbar(hbar))
    .execute(c);
  await tx.getReceipt(c);
  const txId = tx.transactionId!.toString();
  return { txId, topicId: "", hashscan: hashscanTx(txId) };
}

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

export interface HederaAccount {
  accountId: string;   // 0.0.x
  evm: string | null;  // the 0x alias, when the account has one
  balance: number;     // HBAR
  created: boolean;    // did WE just bring this account into existence?
  hashscan: string;
}

async function lookup(addrOrId: string): Promise<HederaAccount | null> {
  try {
    const r = await fetch(`${MIRROR}/accounts/${addrOrId}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!j?.account) return null;
    return {
      accountId: j.account,
      evm: j.evm_address ?? null,
      balance: Number(j.balance?.balance ?? 0) / 1e8,
      created: false,
      hashscan: `https://hashscan.io/testnet/account/${j.account}`,
    };
  } catch {
    return null;
  }
}

/** Resolve a connected wallet to its Hedera account, creating it if it doesn't
 *  exist yet.
 *
 *  This is the "onboard an EVM user to Hedera" moment: a visitor connects a
 *  MetaMask address that Hedera has never seen, and transferring a little HBAR
 *  to it lazy-creates the matching account — no signup, no faucet, no extra
 *  step. Afterwards the address resolves on the mirror node by its 0x form,
 *  which is why the dashboard no longer needs a hardcoded account-id map.
 *
 *  Returns null if Hedera isn't configured, so callers can degrade rather than
 *  fail — the rest of the dashboard works fine without an account id. */
export async function resolveOrCreateAccount(addr: string): Promise<HederaAccount | null> {
  const existing = await lookup(addr);
  if (existing) return existing;
  // Only 0x addresses can be lazy-created; a 0.0.x that doesn't resolve is
  // simply wrong, and inventing one would be worse than reporting nothing.
  if (!addr.startsWith("0x") || !hederaEnabled()) return null;

  await hederaTransfer(addr, 0.1);

  // Consensus is fast but the mirror node lags it by a beat, so the account is
  // real before it's queryable. Poll rather than sleep a fixed amount.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const found = await lookup(addr);
    if (found) return { ...found, created: true };
  }
  return null;
}

// Settlement the operator can WATCH: real HBAR moves to the seller (the connected
// wallet), so their balance grows on-chain. hbar is scaled from the USD price so
// the growth is visible in the demo.
export async function hederaSettle(toAddr: string, usdAmount: number): Promise<HederaReceipt | null> {
  const seller = toAddr || process.env.HEDERA_SELLER_ACCOUNT;
  if (!seller) return null;
  const hbar = Math.max(0.02, usdAmount * 5); // $0.01 → 0.05ℏ, $0.10 → 0.5ℏ
  return hederaTransfer(seller, hbar);
}

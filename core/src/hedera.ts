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
  const c = initHedera();
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("GlassBox402 x402 receipts")
    .execute(c);
  const receipt = await tx.getReceipt(c);
  topicId = receipt.topicId!.toString();
  console.log(`🪵 HCS receipt topic ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
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

// Optional: an actual HBAR transfer (needs a real recipient account id).
export async function hederaTransfer(toAccountId: string, hbar = 0.001): Promise<HederaReceipt> {
  const c = initHedera();
  const from = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!);
  const tx = await new TransferTransaction()
    .addHbarTransfer(from, new Hbar(-hbar))
    .addHbarTransfer(AccountId.fromString(toAccountId), new Hbar(hbar))
    .execute(c);
  await tx.getReceipt(c);
  const txId = tx.transactionId!.toString();
  return { txId, topicId: "", hashscan: hashscanTx(txId) };
}

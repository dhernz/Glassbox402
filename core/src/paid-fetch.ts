// The buyer side — a real x402 client that signs Hedera payments.
// Used by the backend "send test buyer" and the watcher. Signs as a funded
// Hedera account (the demo buyer); blocky402 is the fee-payer and settles.

import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey as HPK } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { x402Client } from "@x402/core/client";

let paidFetchFn: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

export function paidFetchReady(): boolean {
  return !!(process.env.HEDERA_CLIENT_KEY ?? process.env.HEDERA_PRIVATE_KEY);
}

export function getPaidFetch() {
  if (paidFetchFn) return paidFetchFn;
  const rawKey = process.env.HEDERA_CLIENT_KEY ?? process.env.HEDERA_PRIVATE_KEY!;
  const acct = process.env.HEDERA_CLIENT_ID ?? process.env.HEDERA_ACCOUNT_ID!;
  const signer = createClientHederaSigner(acct, HPK.fromStringECDSA(rawKey.replace(/^0x/, "")), { network: "hedera:testnet" });
  const client = new x402Client().register("hedera:*", new ExactHederaScheme(signer) as any);
  paidFetchFn = wrapFetchWithPayment(fetch, client) as any;
  return paidFetchFn!;
}

// paidFetch — the buyer side of x402 in ~30 lines.
// fetch → 402 → read the quote → attach X-PAYMENT → retry once.
// (In the real rail this is @x402/fetch signing an EIP-3009 authorization;
// the sim rail keeps the exact same two-round-trip shape.)

export interface PaidResult {
  res: Response;
  paid: number; // USD spent on this call
  txHash?: string;
}

export async function paidFetch(
  url: string,
  wallet: string,
  init?: RequestInit,
): Promise<PaidResult> {
  const first = await fetch(url, init);
  if (first.status !== 402) return { res: first, paid: 0 };

  const quote = await first.json();
  const offer = quote.accepts?.[0];
  const amount = Number(offer?.price ?? 0);

  const xPayment = Buffer.from(
    JSON.stringify({ from: wallet, amount, scheme: offer?.scheme, network: offer?.network }),
  ).toString("base64");

  const second = await fetch(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), "x-payment": xPayment },
  });

  if (second.status === 402) {
    const err = await second.json().catch(() => ({}));
    throw new Error(`payment_rejected:${err.error ?? "unknown"}`);
  }

  let txHash: string | undefined;
  const receipt = second.headers.get("x-payment-response");
  if (receipt) {
    try { txHash = JSON.parse(Buffer.from(receipt, "base64").toString()).txHash; } catch {}
  }
  return { res: second, paid: amount, txHash };
}

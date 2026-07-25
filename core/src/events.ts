// GBEvent — the shared vocabulary of the whole system.
// Every hop of every payment becomes one of these, broadcast on the hub
// websocket and appended to the tape (JSONL). The Lens renders nothing
// that didn't arrive as a GBEvent, which is what makes tape replay
// pixel-identical to a live run.

export type GBEventType =
  | "lane_up" // a new x402ify proxy came online
  | "request_in" // request arrived at a lane
  | "quote_402" // lane answered 402 with a price quote
  | "payment_submitted" // client retried with X-PAYMENT attached
  | "verify_ok" // sim facilitator accepted the payment
  | "verify_fail" // rejected (reason in data.reason) — never reaches any chain
  | "settled" // funds moved, data.txHash
  | "response_out" // upstream response forwarded to the buyer
  | "hedera_receipt" // the settlement transaction itself, on HashScan (data.hashscan)
  | "hcs_receipt" // an HCS topic message recording this payment (data.topicId, data.hashscan)
  | "feed_tick" // hero: a paid data update — { source, value, unit, paid, wallet, balance }
  | "feed_frozen" // hero: the feed stopped because the wallet is empty — { wallet }
  | "signal" // the watcher acted on purchased data
  | "policy" // a lane's feature policy changed (dashboard toggle)
  | "faucet"; // a wallet got funded

export interface GBEvent {
  id: string;
  reqId: string; // groups all events of one payment flow
  lane: string;
  type: GBEventType;
  t: number; // epoch ms
  data: Record<string, unknown>;
}

export const HUB_PORT = 4021;
export const HUB_URL = process.env.GB_HUB ?? `http://localhost:${HUB_PORT}`;

export function gbe(
  type: GBEventType,
  lane: string,
  reqId: string,
  data: Record<string, unknown> = {},
): GBEvent {
  return { id: crypto.randomUUID(), reqId, lane, type, t: Date.now(), data };
}

export async function emit(ev: GBEvent): Promise<void> {
  try {
    await fetch(`${HUB_URL}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ev),
    });
  } catch {
    // hub down — engines keep serving; visibility degrades, payments don't.
  }
}

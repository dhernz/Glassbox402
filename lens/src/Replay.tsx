// "Let's go to the tape." — the slow-motion instant replay of one payment.
// This screen is the whole thesis: a spec turned into a spectacle.

import { useEffect, useState } from "react";
import type { Flow, GBEvent } from "./App";

const NARRATION: Record<string, { title: string; line: string }> = {
  request_in: { title: "1 · REQUEST", line: "A machine asks for the resource. No account, no API key — it doesn't have either." },
  quote_402: { title: "2 · 402 PAYMENT REQUIRED", line: "The wall answers with a price quote. This is the entire negotiation." },
  payment_submitted: { title: "3 · X-PAYMENT ATTACHED", line: "The buyer signs a payment authorization and retries — no gas, just a signature in a header." },
  verify_ok: { title: "4 · VERIFIED", line: "The facilitator checks the payment. Valid — funds can move." },
  verify_fail: { title: "4 · REJECTED", line: "The facilitator says no. This failure will never appear on any block explorer — without the glass, it's invisible." },
  settled: { title: "5 · SETTLED ON-CHAIN", line: "Money moves to the seller. A block explorer only ever sees THIS step — you just watched all the others." },
  response_out: { title: "6 · 200 OK", line: "Paid. Unlocked. Delivered. Two round trips, zero accounts — that's x402." },
  hedera_receipt: { title: "ℏ · RECEIPT ON HEDERA", line: "The payment is mirrored to Hedera Consensus Service — a real, tamper-evident receipt on testnet. This is the one step an explorer can show." },
};

export function Replay({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const steps = flow.steps;

  useEffect(() => {
    if (!playing) return;
    if (i >= steps.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setI((n) => n + 1), 1200);
    return () => clearTimeout(t);
  }, [i, playing, steps.length]);

  const ev: GBEvent | undefined = steps[i];
  if (!ev) return null;
  const n = NARRATION[ev.type] ?? { title: ev.type, line: "" };

  return (
    <div className="replay" onClick={onClose}>
      <div className="replay-box" onClick={(e) => e.stopPropagation()}>
        <div className="replay-head">
          <span className="rec">● REPLAY</span>
          <span className="replay-lane">{flow.lane} · ${flow.amount.toFixed(3)}</span>
          <button className="replay-close" onClick={onClose}>✕</button>
        </div>
        <div className="replay-title">{n.title}</div>
        <div className="replay-narration">{n.line}</div>
        <pre className="replay-json">{JSON.stringify({ type: ev.type, ...ev.data }, null, 2)}</pre>
        {ev.type === "hedera_receipt" && typeof ev.data.hashscan === "string" && (
          <a className="replay-hashscan" href={ev.data.hashscan} target="_blank" rel="noreferrer">ℏ view this transaction on HashScan ↗</a>
        )}
        <div className="replay-dots">
          {steps.map((s, k) => (
            <span key={s.id} className={k === i ? "rdot active" : k < i ? "rdot seen" : "rdot"}
              onClick={() => { setI(k); setPlaying(false); }} />
          ))}
        </div>
        <div className="replay-controls">
          <button onClick={() => { setI(0); setPlaying(true); }}>⟲ from the top</button>
          <button onClick={() => setPlaying(!playing)}>{playing ? "⏸ pause" : "▶ play"}</button>
        </div>
      </div>
    </div>
  );
}

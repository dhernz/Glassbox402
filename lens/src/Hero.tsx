// The hero — consequence, not mechanism.
// A machine's wallet drains in real cents as it buys a live feed. When the
// wallet hits $0 the feed FREEZES. Top it up → it comes back to life.
// This is the "aha": the data lives only as long as the machine keeps paying.

import { useEffect, useRef, useState } from "react";

const HUB = "http://localhost:4021";

export interface FeedState {
  value: number | null;
  balance: number;
  frozen: boolean;
  source: string;
  lastPaid: number;
  bumps: number; // increments each paid tick, to pulse the feed
}

export function Hero({ feed }: { feed: FeedState }) {
  const alive = !feed.frozen && feed.value != null;
  const shownBal = useTween(feed.balance);

  async function topUp() {
    await fetch(`${HUB}/faucet`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr: "0xWATCHER", usd: 1 }),
    });
  }

  return (
    <div className="hero">
      {/* the wallet — draining */}
      <div className={`wallet ${feed.balance <= 0 ? "empty" : ""}`}>
        <div className="wallet-label">AGENT WALLET</div>
        <div className="wallet-amount">${shownBal.toFixed(3)}</div>
        <div className="wallet-bar"><div className="wallet-fill" style={{ width: `${Math.min(100, (feed.balance / 0.5) * 100)}%` }} /></div>
        <div className="wallet-sub">
          {feed.lastPaid > 0 ? `−$${feed.lastPaid.toFixed(3)} per look` : "paying per look"}
          {feed.balance <= 0 && <span className="broke"> · OUT OF MONEY</span>}
        </div>
        <button className="topup" onClick={topUp}>+ top up $1</button>
      </div>

      <div className="flow-arrow">{alive ? "buys →" : "✕ can't pay"}</div>

      {/* the feed — alive only while paid */}
      <div className={`feed ${alive ? "alive" : "frozen"}`} key={feed.bumps}>
        <div className="feed-head">
          <span className={`pulse ${alive ? "on" : "off"}`} />
          <span className="feed-source">{feed.source} · live ETH price</span>
        </div>
        <div className="feed-value">
          {feed.value != null ? `$${feed.value.toFixed(2)}` : "—"}
        </div>
        {alive
          ? <div className="feed-state live">● streaming · paid</div>
          : <div className="feed-state dead">⏸ FROZEN — the machine stopped paying</div>}
      </div>
    </div>
  );
}

function useTween(target: number) {
  const [v, setV] = useState(target);
  const ref = useRef(target); ref.current = v;
  useEffect(() => {
    let raf = 0; const from = ref.current; const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 350);
      setV(from + (target - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

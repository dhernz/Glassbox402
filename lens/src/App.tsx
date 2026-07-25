import { useEffect, useMemo, useRef, useState } from "react";
import { Replay } from "./Replay";
import { Hero, type FeedState } from "./Hero";
import { coin, kaching, thud } from "./sound";

export interface GBEvent {
  id: string; reqId: string; lane: string; type: string; t: number;
  data: Record<string, any>;
}
export interface Flow {
  reqId: string; lane: string; steps: GBEvent[];
  status: "quoted" | "paying" | "paid" | "done" | "failed";
  amount: number; from?: string; txHash?: string; reason?: string;
  ms?: number; httpStatus?: number; path?: string; t: number; hashscan?: string;
}
interface Lane { name: string; upstream: string; price: number; payTo: string; port: number; sample: string; revenue: number; count: number; }

const HUB_WS = "ws://localhost:4021";
const HUB = "http://localhost:4021";

export default function App() {
  const [flows, setFlows] = useState<Map<string, Flow>>(new Map());
  const [lanes, setLanes] = useState<Map<string, Lane>>(new Map());
  const [signals, setSignals] = useState<GBEvent[]>([]);
  const [replay, setReplay] = useState<Flow | null>(null);
  const [sound, setSound] = useState(false);
  const [bursts, setBursts] = useState<number[]>([]);
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<FeedState>({ value: null, balance: 0, frozen: false, source: "feed", lastPaid: 0, bumps: 0 });
  const soundRef = useRef(sound); soundRef.current = sound;
  const connectedAt = useRef(0);

  useEffect(() => {
    let ws: WebSocket; let closed = false;
    const connect = () => {
      ws = new WebSocket(HUB_WS);
      ws.onopen = () => { setConnected(true); connectedAt.current = Date.now(); };
      ws.onclose = () => { setConnected(false); if (!closed) setTimeout(connect, 1000); };
      ws.onmessage = (m) => handle(JSON.parse(m.data));
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, []);

  function handle(ev: GBEvent) {
    const live = Date.now() - connectedAt.current > 1500; // no sound-storm on history catch-up

    if (ev.type === "lane_up") {
      setLanes((prev) => new Map(prev).set(ev.lane, {
        name: ev.lane, upstream: String(ev.data.upstream), price: Number(ev.data.price),
        payTo: String(ev.data.payTo), port: Number(ev.data.port),
        sample: String(ev.data.sample ?? "/"),
        revenue: prev.get(ev.lane)?.revenue ?? 0, count: prev.get(ev.lane)?.count ?? 0,
      }));
      return;
    }
    if (ev.type === "signal") { setSignals((s) => [ev, ...s].slice(0, 4)); return; }
    if (ev.type === "feed_tick") {
      setFeed((f) => ({
        value: Number(ev.data.value), balance: Number(ev.data.balance), frozen: false,
        source: String(ev.data.source), lastPaid: Number(ev.data.paid), bumps: f.bumps + 1,
      }));
      return;
    }
    if (ev.type === "feed_frozen") { setFeed((f) => ({ ...f, frozen: true, balance: 0 })); if (live && soundRef.current) thud(); return; }
    if (ev.type === "faucet") return;

    setFlows((prev) => {
      const next = new Map(prev);
      const f: Flow = next.get(ev.reqId) ?? {
        reqId: ev.reqId, lane: ev.lane, steps: [], status: "quoted", amount: 0, t: ev.t,
      };
      f.steps = [...f.steps, ev];
      if (ev.type === "request_in") f.path = String(ev.data.path ?? "");
      if (ev.type === "quote_402") { f.status = "quoted"; f.amount = Number(ev.data.price); }
      if (ev.type === "payment_submitted") { f.status = "paying"; f.from = String(ev.data.from); f.amount = Number(ev.data.amount); }
      if (ev.type === "verify_fail") { f.status = "failed"; f.reason = String(ev.data.reason); if (live && soundRef.current) thud(); }
      if (ev.type === "settled") {
        f.status = "paid"; f.txHash = String(ev.data.txHash); f.amount = Number(ev.data.amount);
        setLanes((ls) => {
          const nl = new Map(ls); const lane = nl.get(ev.lane);
          if (lane) nl.set(ev.lane, { ...lane, revenue: lane.revenue + Number(ev.data.amount), count: lane.count + 1 });
          return nl;
        });
        if (live && soundRef.current) {
          if (Number(ev.data.amount) >= 1) { kaching(); setBursts((b) => [...b, ev.t]); }
          else coin(Number(ev.data.amount));
        }
      }
      if (ev.type === "response_out") { if (f.status === "paid") f.status = "done"; f.ms = Number(ev.data.ms); f.httpStatus = Number(ev.data.status); }
      if (ev.type === "hedera_receipt") { f.hashscan = String(ev.data.hashscan); }
      next.set(ev.reqId, f);
      // keep the floor bounded
      if (next.size > 60) { const oldest = [...next.values()].sort((a, b) => a.t - b.t)[0]; next.delete(oldest.reqId); }
      return next;
    });
  }

  const floor = useMemo(
    () => [...flows.values()].sort((a, b) => b.t - a.t).slice(0, 14),
    [flows],
  );
  const totalEarned = useMemo(() => [...lanes.values()].reduce((s, l) => s + l.revenue, 0), [lanes]);
  const totalCount = useMemo(() => [...lanes.values()].reduce((s, l) => s + l.count, 0), [lanes]);

  async function testBuyer(lane: Lane) {
    const buyer = "0xLENS_BUYER";
    await fetch(`${HUB}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addr: buyer, usd: Math.max(0.25, lane.price * 2) }) });
    const url = `http://localhost:${lane.port}${lane.sample}`;
    const first = await fetch(url);
    if (first.status !== 402) return;
    const quote = await first.json();
    const xp = btoa(JSON.stringify({ from: buyer, amount: Number(quote.accepts?.[0]?.price ?? lane.price) }));
    await fetch(url, { headers: { "x-payment": xp } });
  }

  return (
    <div className="app">
      <TopBar earned={totalEarned} count={totalCount} sound={sound} setSound={setSound} connected={connected} />
      <Hero feed={feed} />
      {signals[0] && (
        <div className="signal" key={signals[0].id}>
          📡 <b>SIGNAL</b> {String(signals[0].data.msg)}
          {signals[0].data.model ? <span className="zerog"> 🧠 decided on 0G Compute · {String(signals[0].data.model)} · {String(signals[0].data.tokens)} tok</span> : null}
        </div>
      )}
      <div className="main">
        <div className="floor">
          <div className="floor-title">EVERY PAYMENT · click to replay</div>
          {floor.length === 0 && (
            <div className="empty">
              <div>Run <code>pnpm x402ify &lt;api-url&gt; --price 0.01</code>, then start the watcher.</div>
            </div>
          )}
          {floor.map((f) => <FlowCard key={f.reqId} f={f} onClick={() => setReplay(f)} />)}
        </div>
        <div className="rail">
          <div className="rail-title">MONETIZED APIS</div>
          {[...lanes.values()].map((l) => (
            <div className="lane" key={l.name}>
              <div className="lane-head">
                <span className="lane-name">{l.name}</span>
                <span className="lane-tag">reseller</span>
              </div>
              <div className="lane-upstream">{l.upstream}</div>
              <div className="lane-stats">
                <span className="lane-price">${l.price.toFixed(3)}/call</span>
                <span className="lane-rev">▲ ${l.revenue.toFixed(3)}</span>
                <span className="lane-count">{l.count}×</span>
              </div>
              <button className="test-buyer" onClick={() => testBuyer(l)}>send test buyer 🤖</button>
            </div>
          ))}
          {lanes.size === 0 && <div className="lane-none">no lanes yet</div>}
        </div>
      </div>
      {bursts.map((b) => <Confetti key={b} />)}
      {replay && <Replay flow={replay} onClose={() => setReplay(null)} />}
    </div>
  );
}

const STAGE_ICONS: Record<Flow["status"], string> = {
  quoted: "🧾", paying: "💳", paid: "✅", done: "✅", failed: "❌",
};

function FlowCard({ f, onClick }: { f: Flow; onClick: () => void }) {
  const cls = f.status === "failed" ? "card failed shake" : f.status === "done" || f.status === "paid" ? "card ok" : "card pending";
  return (
    <div className={cls} onClick={onClick} title="click to REPLAY">
      <div className="card-line">
        <span className="payer">{short(f.from) ?? "…"}</span>
        <span className="arrow">──►</span>
        <span className="path">{f.lane}{f.path?.split("?")[0] ?? ""}</span>
        <span className="wall">╢402╟</span>
        <span className="amount">${f.amount.toFixed(3)}</span>
        <span className="stage">{STAGE_ICONS[f.status]}</span>
        {f.status === "failed" && <span className="reason">{f.reason?.replaceAll("_", " ")}</span>}
        {f.status === "done" && <span className="ms">{f.ms}ms</span>}
      </div>
      {f.hashscan
        ? <a className="tx hedera" href={f.hashscan} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>ℏ settled on Hedera · view on HashScan ↗</a>
        : f.status === "done" || f.status === "paid" ? <div className="tx">✓ settled</div> : null}
    </div>
  );
}

function TopBar(props: { earned: number; count: number; sound: boolean; setSound: (b: boolean) => void; connected: boolean }) {
  const shown = useTween(props.earned);
  return (
    <div className="topbar">
      <div className="brand">GLASS<span className="brand-accent">BOX</span>402</div>
      <div className="odometer">earned <b>${shown.toFixed(3)}</b></div>
      <div className="paycount">{props.count} payments</div>
      <div className={props.connected ? "dot on" : "dot off"} title={props.connected ? "hub connected" : "hub offline"} />
      <button className="sound-toggle" onClick={() => props.setSound(!props.sound)}>{props.sound ? "🔊" : "🔇"}</button>
    </div>
  );
}

function useTween(target: number) {
  const [v, setV] = useState(target);
  useEffect(() => {
    let raf: number; const from = v; const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 400);
      setV(from + (target - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]); // eslint-disable-line
  return v;
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.3, char: ["💸", "🪙", "💰", "✨"][i % 4],
  })), []);
  return (
    <div className="confetti">
      {pieces.map((p, i) => (
        <span key={i} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s` }}>{p.char}</span>
      ))}
    </div>
  );
}

export function short(addr?: string) {
  if (!addr) return undefined;
  return addr.length > 12 ? `${addr.slice(0, 8)}…` : addr;
}

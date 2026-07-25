import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, sendTestBuyer, buyFromLane, buyUrl, fetchHbarBalance, balanceAccountFor, walletAliases,
  shortAddr, avatarGradient, hostOf, usd, ago, connectMetaMask, hashscanAccount,
  type GBEvent, type Lane, type Payment, type Policy, type Analytics, type Tier,
} from "./hub";
import { HUB_WS } from "./hub";
import {
  IconOverview, IconApis, IconPayments, IconAnalytics, IconFeatures, IconSettings,
  IconCopy, IconCheck, IconExternal, IconWallet, IconShield, IconBolt,
  IconTrend, IconInfo, IconExport, IconPlug,
} from "./icons";

const WALLET_KEY = "gb_wallet";
type ViewId = "overview" | "apis" | "payments" | "analytics" | "features" | "settings";

interface Toast { id: number; text: string; kind: "success" | "win"; }
interface ApiStat { lane: Lane; income: number; requests: number; lastT?: number; lastHashscan?: string; }

export default function App() {
  // Separate buyer page (the market from the agent's side) — no wallet gate.
  if (new URLSearchParams(location.search).get("app") === "buyer") return <BuyerPlayground />;
  return <SellerApp />;
}

function SellerApp() {
  const [wallet, setWallet] = useState<string | null>(() => {
    // deep link: ?wallet=0x… (or #wallet=) auto-connects and persists — handy for demos/sharing
    const q = new URLSearchParams(location.search).get("wallet")
      ?? new URLSearchParams(location.hash.replace(/^#/, "")).get("wallet");
    if (q) { localStorage.setItem(WALLET_KEY, q); return q; }
    return localStorage.getItem(WALLET_KEY);
  });

  const connect = useCallback((addr: string) => {
    const a = addr.trim();
    if (!a) return;
    localStorage.setItem(WALLET_KEY, a);
    setWallet(a);
  }, []);
  const disconnect = useCallback(() => {
    localStorage.removeItem(WALLET_KEY);
    setWallet(null);
  }, []);

  if (!wallet) return <ConnectGate onConnect={connect} />;
  return <Dashboard wallet={wallet} onDisconnect={disconnect} />;
}

/* ============================================================
   CONNECT WALLET — the login gate
   ============================================================ */
function ConnectGate({ onConnect }: { onConnect: (a: string) => void }) {
  const [addr, setAddr] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function metamask() {
    setErr(null); setConnecting(true);
    try {
      const a = await connectMetaMask();
      if (a) onConnect(a);
    } catch (e) {
      setErr((e as Error).message === "no-metamask"
        ? "MetaMask not found — install it, or paste an address below."
        : "Connection cancelled.");
      setShowPaste(true);
    } finally { setConnecting(false); }
  }

  return (
    <div className="gate">
      <div className="gate-inner view-fade">
        <div className="gb-mark gate-mark" />
        <div>
          <div className="gate-title">GlassBox<b>402</b></div>
          <div className="gate-sub" style={{ margin: "10px auto 0" }}>
            The glass storefront for your x402 API. Connect your wallet to watch it earn on Hedera.
          </div>
        </div>
        <div className="gate-card">
          <button className="btn btn-primary btn-lg" style={{ justifyContent: "center" }} disabled={connecting} onClick={metamask}>
            <IconWallet /> {connecting ? "Connecting…" : "Connect MetaMask"}
          </button>
          {err && <div className="helper" style={{ color: "var(--error-ink)" }}>{err}</div>}
          {!showPaste
            ? <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={() => setShowPaste(true)}>or paste an address</button>
            : (
              <div className="field" style={{ marginBottom: 4 }}>
                <span className="label">Payout wallet address</span>
                <input className="input mono" value={addr} spellCheck={false} autoFocus
                  onChange={(e) => setAddr(e.target.value)} placeholder="0x…"
                  onKeyDown={(e) => e.key === "Enter" && addr && onConnect(addr)} />
                <button className="btn btn-secondary btn-sm" style={{ justifyContent: "center", marginTop: 8 }} disabled={!addr} onClick={() => onConnect(addr)}>Use this address</button>
              </div>
            )}
          <div className="gate-bullets">
            <div className="gate-bullet"><IconPlug /> <span>Wrap any API with one command — no signups, no keys for callers.</span></div>
            <div className="gate-bullet"><IconShield /> <span>Charge verified humans one price, anonymous bots another.</span></div>
            <div className="gate-bullet"><IconCheck /> <span>Every payment settles to your wallet on Hedera testnet with a real receipt.</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   DASHBOARD SHELL
   ============================================================ */
function Dashboard({ wallet, onDisconnect }: { wallet: string; onDisconnect: () => void }) {
  const [view, setView] = useState<ViewId>(() => {
    const v = new URLSearchParams(location.search).get("view") as ViewId | null;
    return v && ["overview", "apis", "payments", "analytics", "features", "settings"].includes(v) ? v : "overview";
  });
  const [lanes, setLanes] = useState<Map<string, Lane>>(new Map());
  const [payments, setPayments] = useState<Map<string, Payment>>(new Map());
  const [policies, setPolicies] = useState<Map<string, Policy>>(new Map());
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [wsUp, setWsUp] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(Date.now());

  const connectedAt = useRef(0);
  const toastId = useRef(1);
  const freshTimers = useRef<Map<string, number>>(new Map());

  const pushToast = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = toastId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const markFresh = useCallback((reqId: string) => {
    setPayments((prev) => {
      const p = prev.get(reqId);
      if (!p) return prev;
      const next = new Map(prev);
      next.set(reqId, { ...p, fresh: true } as any);
      return next;
    });
    const old = freshTimers.current.get(reqId);
    if (old) clearTimeout(old);
    const h = window.setTimeout(() => {
      setPayments((prev) => {
        const p = prev.get(reqId);
        if (!p) return prev;
        const next = new Map(prev);
        next.set(reqId, { ...p, fresh: false } as any);
        return next;
      });
    }, 1300);
    freshTimers.current.set(reqId, h);
  }, []);

  /* ---- websocket: the live event stream ---- */
  const handle = useCallback((ev: GBEvent) => {
    const live = Date.now() - connectedAt.current > 1500; // suppress storm on history catch-up

    if (ev.type === "lane_up") {
      const lane: Lane = {
        name: ev.lane,
        upstream: String(ev.data.upstream ?? ""),
        price: Number(ev.data.price ?? 0),
        payTo: String(ev.data.payTo ?? ev.data.owner ?? ""),
        owner: String(ev.data.owner ?? ev.data.payTo ?? ""),
        port: Number(ev.data.port ?? 0),
        sample: String(ev.data.sample ?? "/"),
        chain: String(ev.data.chain ?? "hedera"),
      };
      setLanes((prev) => {
        const existed = prev.has(lane.name);
        const next = new Map(prev).set(lane.name, lane);
        const mineSet = new Set(walletAliases(wallet).map((a) => a.toLowerCase()));
        const mine = mineSet.has((lane.owner ?? "").toLowerCase()) || mineSet.has((lane.payTo ?? "").toLowerCase());
        if (mine && !existed && live) {
          pushToast(`✅ ${lane.name} connected — you're taking payments`, "win");
        }
        return next;
      });
      return;
    }

    if (ev.type === "policy") {
      setPolicies((prev) => new Map(prev).set(ev.lane, { ...(prev.get(ev.lane) ?? {}), ...(ev.data as Policy) }));
      return;
    }

    if (ev.type === "hedera_receipt") {
      const hashscan = String(ev.data.hashscan ?? "");
      setPayments((prev) => {
        const p = prev.get(ev.reqId);
        if (!p) return prev;
        return new Map(prev).set(ev.reqId, { ...p, hashscan });
      });
      return;
    }

    if (ev.type === "settled" || ev.type === "verify_fail") {
      const p: Payment = {
        reqId: ev.reqId,
        lane: ev.lane,
        from: String(ev.data.from ?? "unknown"),
        amount: Number(ev.data.amount ?? 0),
        tier: (ev.data.tier as Tier) ?? "anon",
        verified: Boolean(ev.data.verified),
        path: String(ev.data.path ?? ""),
        payTo: ev.data.payTo ? String(ev.data.payTo) : undefined,
        status: ev.type === "settled" ? "settled" : "failed",
        reason: ev.data.reason ? String(ev.data.reason) : undefined,
        txHash: ev.data.txHash ? String(ev.data.txHash) : undefined,
        t: ev.t,
      };
      setPayments((prev) => {
        const existing = prev.get(ev.reqId);
        const merged = existing ? { ...existing, ...p, hashscan: existing.hashscan } : p;
        const next = new Map(prev).set(ev.reqId, merged);
        // bound the map to the most recent 250 flows
        if (next.size > 250) {
          const oldest = [...next.values()].sort((a, b) => a.t - b.t)[0];
          next.delete(oldest.reqId);
        }
        return next;
      });
      if (live) markFresh(ev.reqId);
      return;
    }
    // request_in / quote_402 / payment_submitted / verify_ok / response_out /
    // feed_* / signal / faucet — not surfaced by the dashboard.
  }, [wallet, pushToast, markFresh]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const openWs = () => {
      ws = new WebSocket(HUB_WS);
      ws.onopen = () => { setWsUp(true); connectedAt.current = Date.now(); };
      ws.onclose = () => { setWsUp(false); if (!closed) setTimeout(openWs, 1200); };
      ws.onerror = () => ws?.close();
      ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch {} };
    };
    openWs();
    return () => { closed = true; ws?.close(); };
  }, [handle]);

  /* ---- initial fetch + polling: lanes, analytics ---- */
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const [ls, an] = await Promise.all([api.lanes().catch(() => []), api.analytics().catch(() => null)]);
      if (stop) return;
      if (ls.length) {
        setLanes((prev) => {
          const next = new Map(prev);
          for (const l of ls) if (!next.has(l.name)) next.set(l.name, { ...l, owner: l.owner ?? l.payTo });
          return next;
        });
      }
      if (an) setAnalytics(an);
    };
    pull();
    const iv = setInterval(pull, 2000);
    return () => { stop = true; clearInterval(iv); };
  }, []);

  /* ---- live testnet balance from the Hedera mirror node ---- */
  useEffect(() => {
    let stop = false;
    const account = balanceAccountFor(wallet);
    const pull = async () => {
      const b = await fetchHbarBalance(account);
      if (!stop && b != null) setBalance(b);
    };
    pull();
    const iv = setInterval(pull, 3000); // money-shot: balance grows as payments settle
    return () => { stop = true; clearInterval(iv); };
  }, [wallet]);

  /* ---- ticking clock for relative timestamps ---- */
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  /* ---- derived, scoped to the connected wallet (alias-aware: the seller may be
     labelled by EVM address or by Hedera account id across the stack) ---- */
  const aliases = useMemo(() => new Set(walletAliases(wallet).map((a) => a.toLowerCase())), [wallet]);
  const isMine = useCallback((addr?: string) => !!addr && aliases.has(addr.toLowerCase()), [aliases]);
  const myLanes = useMemo(
    () => [...lanes.values()].filter((l) => isMine(l.owner) || isMine(l.payTo)),
    [lanes, isMine],
  );
  const myLaneNames = useMemo(() => new Set(myLanes.map((l) => l.name)), [myLanes]);
  const myPayments = useMemo(
    () => [...payments.values()]
      .filter((p) => myLaneNames.has(p.lane) || isMine(p.payTo))
      .sort((a, b) => b.t - a.t),
    [payments, myLaneNames, isMine],
  );
  const settledMine = useMemo(() => myPayments.filter((p) => p.status === "settled"), [myPayments]);
  const income = useMemo(() => settledMine.reduce((s, p) => s + p.amount, 0), [settledMine]);
  const avgPrice = settledMine.length ? income / settledMine.length : 0;
  const hasApis = myLanes.length > 0;

  // per-API income/requests, sorted by income desc — "income of each x402ified API"
  const perApi = useMemo<ApiStat[]>(() => {
    const stats = myLanes.map((lane) => {
      const paid = settledMine.filter((p) => p.lane === lane.name);
      const last = paid.reduce<Payment | undefined>((m, p) => (!m || p.t > m.t ? p : m), undefined);
      return {
        lane,
        income: paid.reduce((s, p) => s + p.amount, 0),
        requests: paid.length,
        lastT: last?.t,
        lastHashscan: last?.hashscan,
      };
    });
    return stats.sort((a, b) => b.income - a.income);
  }, [myLanes, settledMine]);

  const setPolicyFor = useCallback(async (lane: string, patch: Partial<Policy>) => {
    setPolicies((prev) => new Map(prev).set(lane, { ...(prev.get(lane) ?? {}), ...patch }));
    try { await api.setPolicy(lane, patch); } catch {}
  }, []);

  const doTestBuyer = useCallback(async (lane?: Lane) => {
    const target = lane ?? myLanes[0];
    if (!target) return;
    await sendTestBuyer(target);
  }, [myLanes]);

  const titles: Record<ViewId, string> = {
    overview: "Overview", apis: "APIs", payments: "Payments", analytics: "Analytics", features: "Features", settings: "Settings",
  };

  return (
    <div className="app-root">
      <div className="shell">
        <Sidebar
          view={view} setView={setView}
          wallet={wallet} balance={balance}
          paymentCount={settledMine.length} apiCount={myLanes.length}
          onDisconnect={onDisconnect}
        />
        <main className="main">
          <div className="topbar">
            <div className="crumb">GlassBox402 <span className="crumb-sep">/</span> <strong>{titles[view]}</strong></div>
            <div className="topbar-r">
              <BalanceChip balance={balance} wallet={wallet} />
              <span className="net-chip">
                <span className={"net-dot " + (wsUp ? "live" : "off")} />
                {wsUp ? "Hub connected" : "Hub offline"}
              </span>
              <span className="net-chip"><span className="net-dot testnet" />Hedera Testnet</span>
            </div>
          </div>
          <div className="content">
            <div className="content-inner">
              {view === "overview" && (
                <Overview
                  wallet={wallet} hasApis={hasApis} myLanes={myLanes}
                  income={income} requests={settledMine.length} avgPrice={avgPrice}
                  recent={myPayments.slice(0, 6)} now={now}
                  onTestBuyer={doTestBuyer} goPayments={() => setView("payments")}
                />
              )}
              {view === "apis" && (
                <ApisView perApi={perApi} totalIncome={income} wallet={wallet} now={now} onTestBuyer={doTestBuyer} />
              )}
              {view === "payments" && (
                <Payments payments={myPayments} income={income} now={now} onTestBuyer={doTestBuyer} hasApis={hasApis} />
              )}
              {view === "analytics" && <AnalyticsView a={analytics} />}
              {view === "features" && (
                <Features myLanes={myLanes} policies={policies} setPolicyFor={setPolicyFor} goOverview={() => setView("overview")} />
              )}
              {view === "settings" && <Settings wallet={wallet} balance={balance} onDisconnect={onDisconnect} />}
            </div>
          </div>
        </main>
      </div>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.kind}>
            {t.kind === "win" ? null : <IconCheck />}{t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   SIDEBAR
   ============================================================ */
function Sidebar(props: {
  view: ViewId; setView: (v: ViewId) => void;
  wallet: string; balance: number | null;
  paymentCount: number; apiCount: number;
  onDisconnect: () => void;
}) {
  const items: { id: ViewId; label: string; Icon: any; count?: number }[] = [
    { id: "overview", label: "Overview", Icon: IconOverview },
    { id: "apis", label: "APIs", Icon: IconApis, count: props.apiCount },
    { id: "payments", label: "Payments", Icon: IconPayments, count: props.paymentCount },
    { id: "analytics", label: "Analytics", Icon: IconAnalytics },
    { id: "features", label: "Features", Icon: IconFeatures },
    { id: "settings", label: "Settings", Icon: IconSettings },
  ];
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="gb-mark" />
        <div className="gb-wordmark">GlassBox<b>402</b></div>
      </div>
      <div className="sb-section">Dashboard</div>
      <nav className="nav-group">
        {items.map(({ id, label, Icon, count }) => (
          <button key={id} className={"nav-item" + (props.view === id ? " active" : "")} onClick={() => props.setView(id)}>
            <Icon /> <span>{label}</span>
            {count ? <span className="nav-count">{count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="sb-foot">
        <div className="wallet-card">
          <div className="wallet-row">
            <div className="avatar" style={{ background: avatarGradient(props.wallet) }} />
            <div className="wallet-meta">
              <div className="wallet-label">Payout wallet</div>
              <div className="wallet-addr">{shortAddr(props.wallet)}</div>
            </div>
          </div>
          <div className="wallet-bal">
            <span className="wallet-bal-l">Testnet balance</span>
            <span className="wallet-bal-v">{props.balance == null ? "…" : `${props.balance.toFixed(2)} ℏ`}</span>
          </div>
          <div className="wallet-verify"><VerifyLink wallet={props.wallet} /></div>
          <div className="wallet-note">Live on Hedera Testnet · also in MetaMask</div>
          <button className="disconnect" onClick={props.onDisconnect}>Disconnect</button>
        </div>
      </div>
    </aside>
  );
}

/* Prominent live wallet balance — the money-shot. Pulses green each time it
   grows, and links to the wallet's HashScan account so anyone can verify the
   balance + every payment on Hedera's public explorer (anti-"staged"). */
function BalanceChip({ balance, wallet }: { balance: number | null; wallet: string }) {
  const [bumped, setBumped] = useState(false);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (balance != null && prev.current != null && balance > prev.current + 1e-9) {
      setBumped(true);
      const h = setTimeout(() => setBumped(false), 1100);
      prev.current = balance;
      return () => clearTimeout(h);
    }
    prev.current = balance;
  }, [balance]);
  return (
    <a className={"bal-chip" + (bumped ? " bump" : "")} href={hashscanAccount(wallet)} target="_blank" rel="noreferrer"
       title="Live testnet balance — verify it and every payment on Hedera's public explorer (HashScan)">
      <IconWallet />
      <b>{balance == null ? "…" : balance.toFixed(2)}</b>
      <span className="hbar">ℏ</span>
      <IconExternal />
    </a>
  );
}

/* Wallet-level HashScan link — lets judges verify OUTSIDE our UI. */
function VerifyLink({ wallet, label = "verify on HashScan" }: { wallet: string; label?: string }) {
  return (
    <a className="receipt-link" href={hashscanAccount(wallet)} target="_blank" rel="noreferrer"
       title="your balance and every payment, on Hedera's public explorer">
      {label} <IconExternal />
    </a>
  );
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function Overview(props: {
  wallet: string; hasApis: boolean; myLanes: Lane[];
  income: number; requests: number; avgPrice: number;
  recent: Payment[]; now: number;
  onTestBuyer: (l?: Lane) => void; goPayments: () => void;
}) {
  const { hasApis, myLanes, income, requests, avgPrice, recent, now } = props;
  return (
    <section className="view-fade">
      <div className="page-head">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-sub">
            {hasApis
              ? "Live traffic and income across your x402-metered endpoints."
              : "Connect your first API to start taking machine payments."}
          </div>
        </div>
        {hasApis && (
          <button className="btn btn-primary btn-sm" onClick={() => props.onTestBuyer()}>
            <IconBolt /> Send test payment
          </button>
        )}
      </div>

      {hasApis && (
        <div className="callout" style={{ marginBottom: 20 }}>
          <IconInfo />
          <span>
            Live on Hedera Testnet — your balance and every payment are public and verifiable. <VerifyLink wallet={props.wallet} /> · also visible in MetaMask (Hedera Testnet network).
          </span>
        </div>
      )}

      {hasApis && (
        <div className="hero-stats">
          <Stat label="Income" val={usd(income, 2)} foot="settled to your wallet" />
          <Stat label="Requests" val={requests.toLocaleString()} foot="paid calls served" />
          <Stat label="Avg price" val={usd(avgPrice, 4)} foot="per settled request" />
          <Stat label="Active APIs" val={String(myLanes.length)} foot={myLanes.length === 1 ? "on Hedera testnet" : "on Hedera testnet"} />
        </div>
      )}

      <ConnectApiCard wallet={props.wallet} hero={!hasApis} />

      {hasApis && (
        <>
          <div className="section-head">
            <div className="section-title">Recent payments</div>
            <button className="section-link" onClick={props.goPayments}>View all →</button>
          </div>
          {recent.length === 0 ? (
            <div className="empty-state">No payments yet. Hit <b>Send test payment</b> to see one flow through.</div>
          ) : (
            <PaymentsTable rows={recent} now={now} />
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, val, foot }: { label: string; val: string; foot: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-val">{val}</div>
      <div className="stat-foot">{foot}</div>
    </div>
  );
}

function ConnectApiCard({ wallet, hero }: { wallet: string; hero: boolean }) {
  const cmd = `npx x402ify https://your-api.com --price 0.01 --wallet ${wallet}`;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(cmd).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={"connect-card" + (hero ? " hero" : "")}>
      <div className="connect-top">
        <div>
          <div className="connect-title">{hero ? "Connect your API" : "Connect another API"}</div>
          <div className="connect-sub">
            Wrap any HTTP endpoint with x402 metering in one command. Payments settle to <span className="mono">{shortAddr(wallet)}</span> — no code changes.
          </div>
        </div>
        <span className="badge accent"><span className="bdot" />Gateway v2</span>
      </div>
      <div className="term">
        <span className="term-prompt">$</span>
        <div className="term-cmd">
          npx x402ify https://your-api.com <span className="flag">--price</span> <span className="val">0.01</span> <span className="flag">--wallet</span> <span className="wal">{shortAddr(wallet)}</span>
        </div>
        <button className="copy-btn" onClick={copy}>
          {copied ? <IconCheck /> : <IconCopy />}{copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="listen"><span className="pulse-dot" /> Listening for your gateway…&nbsp; the API appears here the moment it comes online.</div>
    </div>
  );
}

/* ============================================================
   APIS — which APIs you've x402ified, and the income of each
   ============================================================ */
function ApisView({ perApi, totalIncome, wallet, now, onTestBuyer }: {
  perApi: ApiStat[]; totalIncome: number; wallet: string; now: number; onTestBuyer: (l?: Lane) => void;
}) {
  if (perApi.length === 0) {
    return (
      <section className="view-fade">
        <div className="page-head"><div>
          <div className="page-title">Your x402 APIs</div>
          <div className="page-sub">The APIs you've monetized with x402 — and the income of each.</div>
        </div></div>
        <ConnectApiCard wallet={wallet} hero />
      </section>
    );
  }
  const totalReq = perApi.reduce((s, a) => s + a.requests, 0);
  return (
    <section className="view-fade">
      <div className="page-head">
        <div>
          <div className="page-title">Your x402 APIs</div>
          <div className="page-sub">The APIs you've monetized with x402 — and the income of each.</div>
        </div>
        <div className="api-total">
          <div className="api-total-l">Total income</div>
          <div className="api-total-v">{usd(totalIncome, 2)}</div>
          <div className="api-total-s">{perApi.length} API{perApi.length > 1 ? "s" : ""} · {totalReq.toLocaleString()} paid calls</div>
        </div>
      </div>
      <div className="gb-table">
        <div className="gb-scroll">
          <div className="gb-row head cols-api">
            <div>API</div><div>Chain</div><div style={{ textAlign: "right" }}>Price</div>
            <div style={{ textAlign: "right" }}>Requests</div><div style={{ textAlign: "right" }}>Income</div><div />
          </div>
          {perApi.map((a) => <ApiRow key={a.lane.name} a={a} now={now} onTestBuyer={onTestBuyer} />)}
        </div>
        <div className="table-foot">
          <span>{perApi.length} API{perApi.length > 1 ? "s" : ""} · <span className="muted">sorted by income</span></span>
          <span>Total&nbsp;<span className="tot">{usd(totalIncome, 2)}</span></span>
        </div>
      </div>
    </section>
  );
}

function ApiRow({ a, now, onTestBuyer }: { a: ApiStat; now: number; onTestBuyer: (l?: Lane) => void }) {
  const { lane } = a;
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try { await onTestBuyer(lane); } finally { setTimeout(() => setBusy(false), 1000); }
  };
  return (
    <div className="gb-row cols-api">
      <div className="api-id">
        <div className="gb-ava" style={{ background: avatarGradient(lane.name) }} />
        <div className="api-id-meta">
          <div className="api-name">{lane.name}</div>
          <div className="api-host mono">{hostOf(lane.upstream)}</div>
        </div>
      </div>
      <div><span className="chain-badge">{lane.chain ?? "hedera"}</span></div>
      <div className="amt">{usd(lane.price, 4)}</div>
      <div className="amt">{a.requests.toLocaleString()}</div>
      <div className="amt income-cell">{usd(a.income, 2)}</div>
      <div className="api-actions">
        {a.lastT ? <span className="api-last">{ago(a.lastT, now)}</span> : null}
        {a.lastHashscan
          ? <a className="receipt-link" href={a.lastHashscan} target="_blank" rel="noreferrer" title="most recent settlement on Hedera testnet">latest on Hedera <IconExternal /></a>
          : a.requests === 0 ? <span className="muted" style={{ fontSize: 13 }}>no calls yet</span> : null}
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={test}>
          <IconBolt /> {busy ? "sent" : "test buyer"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   PAYMENTS
   ============================================================ */
type PayFilter = "all" | "settled" | "failed" | "bot";
function Payments(props: { payments: Payment[]; income: number; now: number; onTestBuyer: () => void; hasApis: boolean }) {
  const [filter, setFilter] = useState<PayFilter>("all");
  const counts = useMemo(() => ({
    all: props.payments.length,
    settled: props.payments.filter((p) => p.status === "settled").length,
    failed: props.payments.filter((p) => p.status === "failed").length,
    bot: props.payments.filter((p) => p.tier === "bot").length,
  }), [props.payments]);
  const rows = useMemo(() => props.payments.filter((p) =>
    filter === "all" ? true : filter === "settled" ? p.status === "settled" : filter === "failed" ? p.status === "failed" : p.tier === "bot",
  ), [props.payments, filter]);

  return (
    <section className="view-fade">
      <div className="page-head">
        <div>
          <div className="page-title">Payments</div>
          <div className="page-sub">Every x402 settlement, with its on-chain receipt on Hedera.</div>
        </div>
        {props.hasApis && (
          <button className="btn btn-secondary btn-sm" onClick={props.onTestBuyer}><IconExport /> Send test payment</button>
        )}
      </div>

      <div className="chip-row" style={{ marginBottom: 16 }}>
        {(["all", "settled", "failed", "bot"] as PayFilter[]).map((f) => (
          <button key={f} className={"chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}&nbsp;&nbsp;{counts[f]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">No payments in this view yet.</div>
      ) : (
        <PaymentsTable rows={rows} now={props.now} foot={{ shown: rows.length, total: counts.all, income: props.income }} />
      )}
    </section>
  );
}

function PaymentsTable({ rows, now, foot }: { rows: Payment[]; now: number; foot?: { shown: number; total: number; income: number } }) {
  return (
    <div className="gb-table">
      <div className="gb-scroll">
        <div className="gb-row head cols-pay">
          <div>Payer</div><div>Endpoint</div><div style={{ textAlign: "right" }}>Amount</div><div>Tier</div><div>Receipt</div><div style={{ textAlign: "right" }}>Time</div>
        </div>
        {rows.map((p) => <PaymentRow key={p.reqId} p={p} now={now} />)}
      </div>
      {foot && (
        <div className="table-foot">
          <span>Showing {foot.shown} of {foot.total} · <span className="muted">live</span></span>
          <span>Settled&nbsp;<span className="tot">{usd(foot.income, 2)}</span></span>
        </div>
      )}
    </div>
  );
}

function PaymentRow({ p, now }: { p: Payment & { fresh?: boolean }; now: number }) {
  const isAgent = !p.from.startsWith("0x");
  return (
    <div className={"gb-row cols-pay" + (p.fresh ? " fresh" : "")}>
      <div className="gb-payer">
        <div className="gb-ava" style={{ background: avatarGradient(p.from) }} />
        <span className={"gb-payer-name" + (isAgent ? "" : " mono")}>{isAgent ? p.from : shortAddr(p.from)}</span>
      </div>
      <div className="ep">{(p.path || "/").split("?")[0]}</div>
      <div className="amt">{usd(p.amount, 4)}</div>
      <div>
        {p.status === "failed"
          ? <span className="badge error"><span className="bdot" />failed</span>
          : <span className={"tier-badge " + p.tier}>{p.tier === "human" ? "human ✓" : p.tier === "bot" ? "bot 10×" : "anon"}</span>}
      </div>
      <div>
        {p.status === "failed"
          ? <span className="receipt-none">{(p.reason ?? "rejected").replaceAll("_", " ")}</span>
          : p.hashscan
            ? <a className="receipt-link" href={p.hashscan} target="_blank" rel="noreferrer" title="settled on Hedera testnet">view on Hedera <IconExternal /></a>
            : <span className="receipt-pending"><span className="pulse-dot" />settling…</span>}
      </div>
      <div className="gb-time">{ago(p.t, now)}</div>
    </div>
  );
}

/* ============================================================
   ANALYTICS
   ============================================================ */
function AnalyticsView({ a }: { a: Analytics | null }) {
  const epMax = a ? Math.max(1, ...a.byEndpoint.map((e) => e.value)) : 1;
  const hourMax = a ? Math.max(1, ...a.byHour) : 1;
  const countryTotal = a ? a.byCountry.reduce((s, c) => s + c.value, 0) || 1 : 1;
  const epColors = ["", "a2", "a3"];
  return (
    <section className="view-fade">
      <div className="page-head">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">Who's calling your API, from where, and what they pay for.</div>
        </div>
        <span className="badge neutral"><span className="bdot" />live · refreshes every 2s</span>
      </div>

      {!a || a.totalRequests === 0 ? (
        <div className="empty-state">No traffic yet. Once payments settle, the distributions appear here.</div>
      ) : (
        <div className="analytics-grid">
          {/* Calls by endpoint */}
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Calls by endpoint</div><div className="panel-cap">{a.totalRequests.toLocaleString()} requests</div></div>
            {a.byEndpoint.slice(0, 6).map((e, i) => (
              <div className="hbar" key={e.key}>
                <div className="hbar-label" title={e.key}>{e.key}</div>
                <div className="hbar-track"><div className={"hbar-fill " + (epColors[i] ?? "")} style={{ width: `${(e.value / epMax) * 100}%` }} /></div>
                <div className="hbar-val">{Math.round((e.value / a.totalRequests) * 100)}%</div>
              </div>
            ))}
            <div className="hr" />
            <div className="row" style={{ justifyContent: "space-between", fontSize: 14, color: "var(--text-tertiary)" }}>
              <span>{a.totalRequests.toLocaleString()} requests total</span><span className="mono">{usd(a.totalIncome, 2)} earned</span>
            </div>
          </div>

          {/* Calls by hour */}
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Calls by hour of day</div><div className="panel-cap">UTC</div></div>
            <div className="vbars">
              {a.byHour.map((v, h) => (
                <div key={h} className={"vbar" + (v === hourMax && v > 0 ? " peak" : "")} style={{ height: `${Math.max(3, (v / hourMax) * 100)}%` }} title={`${String(h).padStart(2, "0")}:00 — ${v}`} />
              ))}
            </div>
            <div className="vaxis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
            <div className="hr" />
            <div className="row" style={{ justifyContent: "space-between", fontSize: 14, color: "var(--text-tertiary)" }}>
              <span>Peak {String(a.byHour.indexOf(hourMax)).padStart(2, "0")}:00 UTC</span><span className="mono">{hourMax} req/hr</span>
            </div>
          </div>

          {/* Top countries */}
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Top countries</div><div className="panel-cap">demo geo</div></div>
            {a.byCountry.slice(0, 6).map((c) => (
              <div className="brow" key={c.code}>
                <div>
                  <div className="brow-top"><span className="brow-flag">{c.flag}</span><span className="brow-name">{c.name}</span></div>
                  <div className="brow-track"><div className="brow-fill" style={{ width: `${(c.value / countryTotal) * 100}%` }} /></div>
                </div>
                <div className="brow-pct">{Math.round((c.value / countryTotal) * 100)}%</div>
              </div>
            ))}
          </div>

          {/* Top payers */}
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Top payers</div><div className="panel-cap">by spend</div></div>
            {a.byPayer.slice(0, 6).map((p) => {
              const agent = !p.payer.startsWith("0x");
              return (
                <div className="payer-row" key={p.payer}>
                  <div className="gb-ava" style={{ background: avatarGradient(p.payer) }} />
                  <div className="payer-meta">
                    <div className={"payer-name" + (agent ? "" : " mono")}>{agent ? p.payer : shortAddr(p.payer)}</div>
                    <div className="payer-calls">{p.calls.toLocaleString()} calls</div>
                  </div>
                  <div className="payer-spend">{usd(p.spend, 2)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================
   FEATURES
   ============================================================ */
function Features(props: {
  myLanes: Lane[];
  policies: Map<string, Policy>;
  setPolicyFor: (lane: string, patch: Partial<Policy>) => void;
  goOverview: () => void;
}) {
  const { myLanes, policies, setPolicyFor } = props;
  const [selected, setSelected] = useState<string>(myLanes[0]?.name ?? "");
  const laneName = myLanes.find((l) => l.name === selected)?.name ?? myLanes[0]?.name ?? "";

  // fetch current policy for the selected lane when it changes
  useEffect(() => {
    if (!laneName) return;
    api.getPolicy(laneName).then((p) => setPolicyFor(laneName, p)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneName]);

  if (myLanes.length === 0) {
    return (
      <section className="view-fade">
        <div className="page-head"><div><div className="page-title">Features</div><div className="page-sub">Pricing rules and access controls for callers of your API.</div></div></div>
        <div className="empty-state">Connect an API first — then its pricing rules live here. <button className="section-link" onClick={props.goOverview}>Go to Overview →</button></div>
      </section>
    );
  }

  const policy = policies.get(laneName) ?? {};
  const price = myLanes.find((l) => l.name === laneName)?.price ?? 0.01;
  const set = (patch: Partial<Policy>) => setPolicyFor(laneName, patch);

  return (
    <section className="view-fade">
      <div className="page-head">
        <div><div className="page-title">Features</div><div className="page-sub">Pricing rules and access controls — applied live to your API.</div></div>
      </div>

      {myLanes.length > 1 && (
        <div className="lane-select">
          <span className="section-label">Configuring</span>
          {myLanes.map((l) => (
            <button key={l.name} className={"chip" + (l.name === laneName ? " active" : "")} onClick={() => setSelected(l.name)}>{l.name}</button>
          ))}
        </div>
      )}

      {/* Human-verified callers (World ID) */}
      <div className="feature">
        <div className="feature-head">
          <div className="feature-main">
            <div className="feature-ic"><IconShield /></div>
            <div>
              <div className="feature-title">Require human-verified callers</div>
              <div className="feature-desc">Callers proving a unique human with <span className="worldid">World ID</span> get your base price. Unverified bots pay {policy.botMultiplier ?? 10}× or are blocked.</div>
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={!!policy.humanVerifiedOnly} onChange={(e) => set({ humanVerifiedOnly: e.target.checked, botMultiplier: policy.botMultiplier ?? 10 })} />
            <span className="slider" />
          </label>
        </div>
        <div className="tier-table">
          <div className="tier-tr"><div>Caller</div><div style={{ textAlign: "right" }}>Price</div></div>
          <div className="tier-tr">
            <div className="tier-name"><span className="tier-tag hum">World ID</span> Human-verified</div>
            <div className="tier-price">{usd(price, 2)}</div>
          </div>
          <div className="tier-tr">
            <div className="tier-name"><span className="tier-tag bot">Anon</span> Anonymous bot</div>
            <div className="tier-price">{usd(price * (policy.botMultiplier ?? 10), 2)}</div>
          </div>
        </div>
        {policy.humanVerifiedOnly && (
          <div className="feature-extra">
            <label className="row" style={{ cursor: "pointer", fontSize: 14, color: "var(--text-secondary)" }}>
              <label className="switch" style={{ width: 36, height: 22 }}>
                <input type="checkbox" checked={!!policy.blockBots} onChange={(e) => set({ blockBots: e.target.checked })} />
                <span className="slider" />
              </label>
              Block unverified bots entirely (402, no upsell)
            </label>
          </div>
        )}
      </div>

      {/* Stream payments */}
      <div className="feature">
        <div className="feature-head">
          <div className="feature-main">
            <div className="feature-ic"><IconBolt /></div>
            <div>
              <div className="feature-title">Stream payments</div>
              <div className="feature-desc">Charge continuously for long-running or websocket calls instead of per-request. Ideal for streaming inference and live data feeds.</div>
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={!!policy.streaming} onChange={(e) => set({ streaming: e.target.checked })} />
            <span className="slider" />
          </label>
        </div>
        {policy.streaming && (
          <div className="stream-note">
            <span className="badge neutral">pay-per-second</span>
            <span className="mono" style={{ color: "var(--text-primary)" }}>{usd(price / 25, 4)} / sec</span>
            <span className="muted">· settled every 60s</span>
          </div>
        )}
      </div>

      {/* Dynamic pricing */}
      <div className="feature">
        <div className="feature-head">
          <div className="feature-main">
            <div className="feature-ic"><IconTrend /></div>
            <div>
              <div className="feature-title">Dynamic pricing</div>
              <div className="feature-desc">Raise prices automatically when demand spikes, within your floor and ceiling.</div>
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={!!policy.dynamicPricing} onChange={(e) => set({ dynamicPricing: e.target.checked })} />
            <span className="slider" />
          </label>
        </div>
        {policy.dynamicPricing && (
          <div className="feature-extra">
            <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
              <div className="price-field">
                <span className="label" style={{ margin: 0 }}>Floor</span>
                <div className="row" style={{ gap: 4 }}><span className="muted mono">$</span>
                  <input className="input mono" defaultValue={(policy.priceFloor ?? price).toFixed(2)} onBlur={(e) => set({ priceFloor: Number(e.target.value) || price })} />
                </div>
              </div>
              <div className="price-field">
                <span className="label" style={{ margin: 0 }}>Ceiling</span>
                <div className="row" style={{ gap: 4 }}><span className="muted mono">$</span>
                  <input className="input mono" defaultValue={(policy.priceCeiling ?? price * 5).toFixed(2)} onBlur={(e) => set({ priceCeiling: Number(e.target.value) || price * 5 })} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="callout" style={{ marginTop: 16 }}>
        <IconInfo /> Changes POST to <span className="mono">/policy/{laneName}</span> and apply to new requests within ~10 seconds.
      </div>
    </section>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */
function Settings({ wallet, balance, onDisconnect }: { wallet: string; balance: number | null; onDisconnect: () => void }) {
  return (
    <section className="view-fade">
      <div className="page-head"><div><div className="page-title">Settings</div><div className="page-sub">Payout, network and API credentials for this workspace.</div></div></div>

      <div className="set-block">
        <div className="section-title" style={{ marginBottom: 6 }}>Payout</div>
        <div className="set-row">
          <div className="set-k">Settlement wallet<div className="sub">Where settled x402 payments are deposited</div></div>
          <div className="set-v"><span className="keyfield">{shortAddr(wallet)}</span><VerifyLink wallet={wallet} /><button className="disconnect" style={{ width: "auto", marginTop: 0, padding: "6px 12px" }} onClick={onDisconnect}>Disconnect</button></div>
        </div>
        <div className="set-row">
          <div className="set-k">Testnet balance<div className="sub">Live on Hedera Testnet — also visible in MetaMask (Hedera Testnet network)</div></div>
          <div className="set-v"><span className="keyfield">{balance == null ? "…" : `${balance.toFixed(4)} ℏ`}</span></div>
        </div>
        <div className="set-row">
          <div className="set-k">Payout token<div className="sub">Stablecoin used for settlement</div></div>
          <div className="set-v"><span className="badge neutral">USDC</span></div>
        </div>
      </div>

      <div className="set-block">
        <div className="section-title" style={{ marginBottom: 6 }}>Network</div>
        <div className="set-row">
          <div className="set-k">Settlement network<div className="sub">Receipts are anchored here</div></div>
          <div className="set-v"><span className="net-chip"><span className="net-dot testnet" />Hedera Testnet</span></div>
        </div>
        <div className="set-row">
          <div className="set-k">Facilitator<div className="sub">x402 payment facilitator endpoint</div></div>
          <div className="set-v"><span className="keyfield">localhost:4021</span></div>
        </div>
      </div>

      <div className="set-block">
        <div className="section-title" style={{ marginBottom: 6 }}>API credentials</div>
        <div className="set-row">
          <div className="set-k">Gateway command<div className="sub">Used by the x402ify CLI</div></div>
          <div className="set-v"><span className="keyfield">npx x402ify … --wallet {shortAddr(wallet)}</span></div>
        </div>
        <div className="set-row">
          <div className="set-k">Webhook<div className="sub">POST on every settlement</div></div>
          <div className="set-v"><span className="keyfield">—</span></div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   BUYER PLAYGROUND — the market from the agent's side (?app=buyer)
   Browse x402 APIs, buy as a verified human or an anonymous bot, and see the
   REAL upstream response + on-chain Hedera settlement. Proves the loop is real.
   ============================================================ */
interface Receipt {
  id: number; api: string; host: string;
  tier: "human" | "bot"; price: number;
  ok: boolean; status: number;
  value?: string; raw?: string; hashscan?: string; error?: string;
  t: number;
}

// Pull the meaningful field out of an upstream response for a clean receipt.
function extractResponse(body?: string): { value?: string; raw?: string } {
  if (!body) return {};
  try {
    const j = JSON.parse(body);
    if (j?.data?.amount && j?.data?.currency) {
      return { value: `${j.data.base ?? ""}${j.data.base ? " " : ""}${j.data.amount} ${j.data.currency}`.trim(), raw: JSON.stringify(j, null, 2) };
    }
    const pick = j.value ?? j.message ?? j.joke ?? j.text ?? j.price ?? j.result;
    if (pick != null && typeof pick !== "object") return { value: String(pick), raw: JSON.stringify(j, null, 2) };
    return { raw: JSON.stringify(j, null, 2) };
  } catch {
    return body.length <= 400 ? { value: body } : { raw: body };
  }
}

function BuyerPlayground() {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [policies, setPolicies] = useState<Record<string, Policy>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [customUrl, setCustomUrl] = useState("");
  const [customVerified, setCustomVerified] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const rid = useRef(1);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const ls = await api.lanes().catch(() => []);
      if (stop) return;
      setLanes(ls);
      const entries = await Promise.all(ls.map(async (l) => [l.name, await api.getPolicy(l.name).catch(() => ({}))] as const));
      if (!stop) setPolicies(Object.fromEntries(entries));
    };
    pull();
    const iv = setInterval(pull, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, []);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const priceFor = (lane: Lane, verified: boolean) => {
    const pol = policies[lane.name] ?? {};
    if (verified) return lane.price;
    return pol.humanVerifiedOnly ? lane.price * (pol.botMultiplier ?? 10) : lane.price;
  };

  const run = async (opts: { lane?: Lane; url?: string; verified: boolean; key: string; api: string; host: string; price: number }) => {
    setBusy(opts.key);
    try {
      const res = opts.lane ? await buyFromLane(opts.lane, opts.verified) : await buyUrl(opts.url!, opts.verified);
      const { value, raw } = extractResponse(res.body);
      setReceipts((r) => [{
        id: rid.current++, api: opts.api, host: opts.host,
        tier: opts.verified ? "human" : "bot", price: opts.price,
        ok: !!res.ok, status: res.status, value, raw, hashscan: res.hashscan, error: res.error,
        t: Date.now(),
      }, ...r].slice(0, 20));
    } finally { setBusy(null); }
  };

  const buyCustom = (verified: boolean) => {
    if (!customUrl.trim()) return;
    run({ url: customUrl.trim(), verified, key: `custom-${verified}`, api: hostOf(customUrl), host: customUrl.trim(), price: 0 });
  };

  return (
    <div className="buyer">
      <div className="buyer-head">
        <div className="buyer-brand">
          <div className="gb-mark" />
          <div>
            <div className="buyer-title">x402 Buyer Playground</div>
            <div className="buyer-sub">an agent shopping the x402 market — pay per call, get the data, settle on Hedera</div>
          </div>
        </div>
        <a className="net-chip" href="/" title="Back to the seller dashboard">← Seller dashboard</a>
      </div>

      <div className="buyer-main">
        <div>
          <div className="section-label" style={{ marginBottom: 12 }}>Directory · {lanes.length} API{lanes.length === 1 ? "" : "s"}</div>

          <div className="pay-any">
            <input className="input mono" placeholder="pay any x402 URL — http://localhost:4090/jokes/random"
              value={customUrl} spellCheck={false} onChange={(e) => setCustomUrl(e.target.value)} />
            <label className="pay-any-verified">
              <label className="switch" style={{ width: 36, height: 22 }}>
                <input type="checkbox" checked={customVerified} onChange={(e) => setCustomVerified(e.target.checked)} />
                <span className="slider" />
              </label>
              <span>World ID</span>
            </label>
            <button className="btn btn-secondary btn-sm" disabled={!customUrl.trim() || busy === `custom-${customVerified}`} onClick={() => buyCustom(customVerified)}>
              <IconBolt /> Pay
            </button>
          </div>

          {lanes.length === 0
            ? <div className="empty-state">No APIs online yet. Start one with <code>x402ify</code> and it appears here.</div>
            : lanes.map((lane) => {
              const humanKey = `${lane.name}-h`, botKey = `${lane.name}-b`;
              const botPrice = priceFor(lane, false);
              return (
                <div className="shop-card" key={lane.name}>
                  <div className="shop-head">
                    <div className="gb-ava" style={{ background: avatarGradient(lane.name) }} />
                    <div className="shop-id">
                      <div className="shop-name">{lane.name}</div>
                      <div className="shop-host mono">{hostOf(lane.upstream)}</div>
                    </div>
                    <span className="chain-badge">{lane.chain ?? "hedera"}</span>
                  </div>
                  <div className="shop-price">Base price <b>{usd(lane.price, 2)}</b> / call</div>
                  <div className="shop-buttons">
                    <button className="btn btn-primary btn-sm" disabled={busy === humanKey}
                      onClick={() => run({ lane, verified: true, key: humanKey, api: lane.name, host: hostOf(lane.upstream), price: priceFor(lane, true) })}>
                      <IconShield /> {busy === humanKey ? "buying…" : `Buy as verified human · ${usd(lane.price, 2)}`}
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={busy === botKey}
                      onClick={() => run({ lane, verified: false, key: botKey, api: lane.name, host: hostOf(lane.upstream), price: botPrice })}>
                      {busy === botKey ? "buying…" : `Buy as anonymous bot · ${usd(botPrice, 2)}`}
                    </button>
                  </div>
                  {botPrice > lane.price && <div className="shop-note">Unverified bots pay {Math.round(botPrice / lane.price)}× — World ID gets the base price.</div>}
                </div>
              );
            })}
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: 12 }}>Purchases · {receipts.length}</div>
          {receipts.length === 0
            ? <div className="empty-state">Buy from an API to see the real response and its Hedera receipt here.</div>
            : receipts.map((r) => (
              <div className={"receipt-card " + (r.ok ? "ok" : "fail")} key={r.id}>
                <div className="receipt-top">
                  <span className={"tier-badge " + r.tier}>{r.tier === "human" ? "human ✓ World ID" : "anonymous bot"}</span>
                  <span className="receipt-api">{r.api}</span>
                  <span className="spacer" />
                  {r.price > 0 && <span className="receipt-price mono">{usd(r.price, 2)}</span>}
                </div>
                <div className="receipt-body">
                  {r.ok
                    ? (r.value
                      ? <div className="receipt-val">{r.value}</div>
                      : <pre className="receipt-raw">{r.raw ?? "(no body)"}</pre>)
                    : <div className="receipt-err">purchase failed{r.error ? `: ${r.error}` : ` (status ${r.status})`}</div>}
                </div>
                <div className="receipt-foot">
                  {r.hashscan
                    ? <a className="receipt-link" href={r.hashscan} target="_blank" rel="noreferrer">view tx on Hedera <IconExternal /></a>
                    : <span className="muted" style={{ fontSize: 13 }}>{r.ok ? "settling…" : "not settled"}</span>}
                  <span className="muted" style={{ fontSize: 13 }}>{ago(r.t, now)}</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

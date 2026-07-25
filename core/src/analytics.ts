// Analytics aggregation — "Google Analytics for x402".
// Ingests settled payments and produces the distributions the dashboard shows:
// by endpoint, by hour-of-day, by country, by payer, plus running totals.
//
// Everything is bucketed PER LANE (per API). The dashboard lets the seller pick
// one API, and the "All APIs" total is folded from those same per-lane buckets
// rather than tracked separately — so the headline number can never disagree
// with the sum of what's on screen. It also means a lane whose gateway has died
// can simply be left out of the fold instead of being subtracted from a total.
//
// Geo note: localhost callers have no real remote IP, so country is derived
// deterministically from the payer address (stable + realistic-looking). The
// dashboard labels this "demo geo". In production this comes from the request IP.

const COUNTRIES = [
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function countryFor(payer: string) {
  // weight toward US/DE/SG so the distribution looks like a real product
  const weighted = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7];
  return COUNTRIES[weighted[hash(payer) % weighted.length]];
}

export interface Snapshot {
  totalIncome: number;
  totalRequests: number;
  avgPrice: number;
  byEndpoint: { key: string; value: number }[];
  byHour: number[]; // 24 buckets
  byCountry: { code: string; name: string; flag: string; value: number }[];
  byPayer: { payer: string; spend: number; calls: number }[];
}

export interface LaneSnapshot extends Snapshot {
  byLane: Record<string, Snapshot>;
}

export interface Settled {
  amount: number;
  path?: string;
  from?: string;
}

const bump = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by);

/** One API's counters. Also used as the accumulator for the "All APIs" fold. */
class Agg {
  private income = 0;
  private requests = 0;
  private endpoint = new Map<string, number>();
  private hour: number[] = new Array(24).fill(0);
  private country = new Map<string, number>();
  private payer = new Map<string, { spend: number; calls: number }>();

  // `t` is the EVENT timestamp, passed in explicitly: settled payloads carry
  // {from, amount, payTo, path, txHash} and no time of their own, so reading it
  // off the payload silently bucketed every payment into "now" — which flattens
  // the whole hour-of-day chart when replaying recorded history.
  add(d: Settled, t: number) {
    const amount = Number(d.amount) || 0;
    this.income += amount;
    this.requests += 1;

    bump(this.endpoint, (d.path ?? "/").split("?")[0], 1);
    this.hour[new Date(t).getUTCHours()] += 1;
    bump(this.country, countryFor(d.from ?? "anon").code, 1);

    const who = d.from ?? "anon";
    const p = this.payer.get(who) ?? { spend: 0, calls: 0 };
    p.spend += amount; p.calls += 1;
    this.payer.set(who, p);
  }

  merge(o: Agg) {
    this.income += o.income;
    this.requests += o.requests;
    for (const [k, v] of o.endpoint) bump(this.endpoint, k, v);
    for (let h = 0; h < 24; h++) this.hour[h] += o.hour[h];
    for (const [k, v] of o.country) bump(this.country, k, v);
    for (const [k, v] of o.payer) {
      const p = this.payer.get(k) ?? { spend: 0, calls: 0 };
      p.spend += v.spend; p.calls += v.calls;
      this.payer.set(k, p);
    }
  }

  snap(): Snapshot {
    const byEndpoint = [...this.endpoint.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
    const byCountry = [...this.country.entries()].map(([code, value]) => {
      const meta = COUNTRIES.find((c) => c.code === code)!;
      return { code, name: meta.name, flag: meta.flag, value };
    }).sort((a, b) => b.value - a.value);
    const byPayer = [...this.payer.entries()].map(([payer, v]) => ({ payer, ...v })).sort((a, b) => b.spend - a.spend).slice(0, 8);
    return {
      totalIncome: this.income,
      totalRequests: this.requests,
      avgPrice: this.requests ? this.income / this.requests : 0,
      byEndpoint,
      byHour: this.hour,
      byCountry,
      byPayer,
    };
  }
}

export class Analytics {
  private lanes = new Map<string, Agg>();

  ingest(lane: string, d: Settled, t: number) {
    let a = this.lanes.get(lane);
    if (!a) this.lanes.set(lane, (a = new Agg()));
    a.add(d, t);
  }

  /** `only` scopes the result to the lanes that are currently live, so an API
   *  whose gateway died disappears from analytics exactly as it disappears from
   *  the API list. Lanes with no traffic yet still get an empty snapshot, so the
   *  dashboard can say "no traffic on THIS api" rather than falling back to the
   *  combined numbers. */
  snapshot(only?: string[]): LaneSnapshot {
    const keys = only ?? [...this.lanes.keys()];
    const total = new Agg();
    const byLane: Record<string, Snapshot> = {};
    for (const k of keys) {
      const a = this.lanes.get(k) ?? new Agg();
      total.merge(a);
      byLane[k] = a.snap();
    }
    return { ...total.snap(), byLane };
  }
}

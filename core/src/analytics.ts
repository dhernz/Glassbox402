// Analytics aggregation — "Google Analytics for x402".
// Ingests settled payments and produces the distributions the dashboard shows:
// by endpoint, by hour-of-day, by country, by payer, plus running totals.
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

export class Analytics {
  private income = 0;
  private requests = 0;
  private endpoint = new Map<string, number>();
  private hour = new Array(24).fill(0);
  private country = new Map<string, number>();
  private payer = new Map<string, { spend: number; calls: number }>();

  ingest(d: { amount: number; path?: string; from?: string; t?: number }) {
    const amount = Number(d.amount) || 0;
    this.income += amount;
    this.requests += 1;

    const ep = (d.path ?? "/").split("?")[0];
    this.endpoint.set(ep, (this.endpoint.get(ep) ?? 0) + 1);

    const h = new Date(d.t ?? Date.now()).getUTCHours();
    this.hour[h] += 1;

    const c = countryFor(d.from ?? "anon").code;
    this.country.set(c, (this.country.get(c) ?? 0) + 1);

    const p = this.payer.get(d.from ?? "anon") ?? { spend: 0, calls: 0 };
    p.spend += amount; p.calls += 1;
    this.payer.set(d.from ?? "anon", p);
  }

  snapshot(): Snapshot {
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

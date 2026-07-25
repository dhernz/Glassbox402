// Rail connectivity checks — run before the event and again at minute one:
//   pnpm verify        (reads ../.env via node --env-file)
// Proves: Graph gateway key works, Hedera testnet account is live,
// Sepolia wallet is funded. Read-only; spends nothing.

const UNISWAP_V3_SUBGRAPH = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"; // Uniswap v3 (Ethereum) on the decentralized network
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};

// ── 1. The Graph gateway ─────────────────────────────────────────
const key = process.env.GRAPH_API_KEY;
const query = JSON.stringify({
  query: `{ pools(first: 3, orderBy: totalValueLockedUSD, orderDirection: desc) {
    token0 { symbol } token1 { symbol } totalValueLockedUSD } }`,
});
let graphOk = false, pools = [], form = "";
for (const [label, url, headers] of [
  ["auth-header", `https://gateway.thegraph.com/api/subgraphs/id/${UNISWAP_V3_SUBGRAPH}`, { authorization: `Bearer ${key}` }],
  ["key-in-path", `https://gateway.thegraph.com/api/${key}/subgraphs/id/${UNISWAP_V3_SUBGRAPH}`, {}],
]) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: query,
    });
    const j = await r.json();
    if (j.data?.pools?.length) { graphOk = true; pools = j.data.pools; form = label; break; }
  } catch {}
}
ok("Graph gateway: Uniswap v3 subgraph answers", graphOk,
  graphOk ? `${form}; top pool ${pools[0].token0.symbol}/${pools[0].token1.symbol} $${Number(pools[0].totalValueLockedUSD).toExponential(2)}` : "both URL forms failed");

// ── 2. Hedera testnet (EVM alias via hashio relay) ───────────────
async function evmBalance(rpc, addr) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
  });
  const j = await r.json();
  return Number(BigInt(j.result ?? "0x0")) / 1e18;
}
try {
  const hbar = await evmBalance("https://testnet.hashio.io/api", process.env.HEDERA_ADDRESS);
  ok("Hedera testnet: account live via relay", hbar > 0, `${hbar.toFixed(2)} HBAR`);
} catch (e) {
  ok("Hedera testnet: account live via relay", false, String(e));
}

// ── 3. Sepolia wallet ────────────────────────────────────────────
try {
  const eth = await evmBalance("https://ethereum-sepolia-rpc.publicnode.com", process.env.SEPOLIA_ADDRESS);
  ok("Sepolia: wallet funded", eth > 0, `${eth.toFixed(4)} ETH`);
} catch (e) {
  ok("Sepolia: wallet funded", false, String(e));
}

console.log(failures === 0 ? "\n🟢 ALL RAILS REACHABLE" : `\n🔴 ${failures} rail(s) need attention`);
process.exit(failures === 0 ? 0 : 1);

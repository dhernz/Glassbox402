// ENS integration — agent-readable identity + discovery for paid APIs.
//
// Each monetized lane is published as ENS text records under our name, so an
// agent given ONLY the parent name discovers every payable API by resolution —
// no hard-coded URLs (ENS's qualification requirement). Also resolves human
// names for the Lens (0x… → glassbox402.eth).
//
// Sepolia. Reads use viem's built-in ENS (robust); writes use setText on the
// name's resolver; registration uses the ETH Registrar Controller.

import { createPublicClient, createWalletClient, http, namehash, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
export const PARENT = process.env.ENS_PARENT ?? "glassbox402.eth";

export const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });

export function ensWalletReady(): boolean {
  return !!process.env.SEPOLIA_PRIVATE_KEY;
}
function wallet() {
  const pk = process.env.SEPOLIA_PRIVATE_KEY!;
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  return { account, client: createWalletClient({ account, chain: sepolia, transport: http(RPC) }) };
}

export interface DiscoveredLane { name: string; url: string; price: number; }

// READ — an agent discovers all payable lanes from just the parent name.
export async function discoverLanes(parent = PARENT): Promise<DiscoveredLane[]> {
  const index = await pub.getEnsText({ name: parent, key: "x402:lanes" });
  if (!index) return [];
  const out: DiscoveredLane[] = [];
  for (const label of index.split(",").map((s) => s.trim()).filter(Boolean)) {
    const rec = await pub.getEnsText({ name: parent, key: `x402:${label}` });
    if (!rec) continue;
    try { const j = JSON.parse(rec); out.push({ name: label, url: j.url, price: Number(j.price) }); } catch {}
  }
  return out;
}

// human name for an address, if any (Lens identity)
export async function nameFor(address: string): Promise<string | null> {
  try { return await pub.getEnsName({ address: address as `0x${string}` }); } catch { return null; }
}

// WRITE — publish one lane as text records on the parent (must own it + resolver set).
const RESOLVER_ABI = parseAbi(["function setText(bytes32 node, string key, string value) external"]);
export async function publishLane(label: string, url: string, price: number, parent = PARENT) {
  const { client } = wallet();
  const resolver = await pub.getEnsResolver({ name: parent });
  const node = namehash(parent);
  const cur = (await pub.getEnsText({ name: parent, key: "x402:lanes" })) ?? "";
  const labels = new Set(cur.split(",").map((s) => s.trim()).filter(Boolean));
  labels.add(label);
  const tx1 = await client.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "setText", args: [node, "x402:lanes", [...labels].join(",")] });
  await pub.waitForTransactionReceipt({ hash: tx1 });
  const tx2 = await client.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "setText", args: [node, `x402:${label}`, JSON.stringify({ url, price })] });
  await pub.waitForTransactionReceipt({ hash: tx2 });
  return { node, resolver, txs: [tx1, tx2] };
}

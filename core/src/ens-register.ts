// One-time: register our ENS parent name on Sepolia (commit → wait → register)
// using the current struct-based ETHRegistrarController, then set a text record.
//   SEPOLIA_PRIVATE_KEY=... pnpm ens:register [name]

import { createPublicClient, createWalletClient, http, parseAbi, namehash, encodeFunctionData, toFunctionSelector } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CONTROLLER = "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968" as const;
const PUBLIC_RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const label = (process.argv[2] ?? process.env.ENS_PARENT ?? "glassbox402").replace(/\.eth$/, "");
const DURATION = 31536000n;

const abi = parseAbi([
  "struct Registration { string label; address owner; uint256 duration; bytes32 secret; address resolver; bytes[] data; uint8 reverseRecord; bytes32 referrer; }",
  "function available(string name) view returns (bool)",
  "function rentPrice(string label, uint256 duration) view returns ((uint256 base, uint256 premium))",
  "function makeCommitment(Registration registration) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(Registration registration) payable",
  "function minCommitmentAge() view returns (uint256)",
  "error CommitmentNotFound(bytes32)",
  "error CommitmentTooNew(bytes32,uint256,uint256)",
  "error CommitmentTooOld(bytes32,uint256,uint256)",
  "error DurationTooShort(uint256)",
  "error InsufficientValue()",
  "error NameNotAvailable(string)",
  "error ResolverRequiredForReverseRecord()",
  "error ResolverRequiredWhenDataSupplied()",
  "error UnexpiredCommitmentExists(bytes32)",
]);
const resolverAbi = parseAbi(["function setText(bytes32 node, string key, string value)"]);
const registryAbi = parseAbi(["function setResolver(bytes32 node, address resolver)"]);

const pk = process.env.SEPOLIA_PRIVATE_KEY!;
if (!pk) { console.error("set SEPOLIA_PRIVATE_KEY"); process.exit(1); }
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`registering ${label}.eth → ${account.address} on Sepolia…`);
  if (!(await pub.readContract({ address: CONTROLLER, abi, functionName: "available", args: [label] }))) {
    console.log(`⚠️  ${label}.eth not available`); process.exit(1);
  }
  const price: any = await pub.readContract({ address: CONTROLLER, abi, functionName: "rentPrice", args: [label, DURATION] });
  const value = (price.base + price.premium) * 15n / 10n;
  const secret = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;

  const registration = {
    label, owner: account.address, duration: DURATION, secret,
    resolver: ZERO_ADDR, data: [] as `0x${string}`[], reverseRecord: 0, referrer: ZERO32,
  };

  const commitment = await pub.readContract({ address: CONTROLLER, abi, functionName: "makeCommitment", args: [registration] });
  console.log("→ commit()…");
  const c = await wallet.writeContract({ address: CONTROLLER, abi, functionName: "commit", args: [commitment as `0x${string}`] });
  await pub.waitForTransactionReceipt({ hash: c });

  const minAge = await pub.readContract({ address: CONTROLLER, abi, functionName: "minCommitmentAge" });
  const waitMs = Number(minAge) * 1000 + 15000;
  console.log(`→ waiting ${Math.round(waitMs / 1000)}s…`);
  await sleep(waitMs);

  console.log("→ register()…");
  const calldata = encodeFunctionData({ abi, functionName: "register", args: [registration] });
  try {
    await pub.call({ to: CONTROLLER, data: calldata, value, account: account.address });
  } catch (e: any) {
    const raw: string = e.walk?.((x: any) => typeof x?.data === "string" && x.data.startsWith("0x"))?.data ?? e.data ?? "";
    const sel = raw.slice(0, 10);
    const errNames = ["CommitmentNotFound(bytes32)","CommitmentTooNew(bytes32,uint256,uint256)","CommitmentTooOld(bytes32,uint256,uint256)","DurationTooShort(uint256)","InsufficientValue()","NameNotAvailable(string)","ResolverRequiredForReverseRecord()","ResolverRequiredWhenDataSupplied()","UnexpiredCommitmentExists(bytes32)"];
    const match = errNames.find((n) => toFunctionSelector(`function ${n}`) === sel);
    console.log(`   raw revert ${sel || raw || "(empty)"} → ${match ?? "UNKNOWN"}  value=${value}`);
    throw e;
  }
  const r = await wallet.writeContract({ address: CONTROLLER, abi, functionName: "register", args: [registration], value });
  await pub.waitForTransactionReceipt({ hash: r });
  console.log(`   ✅ registered  (tx ${r.slice(0, 14)}…)`);

  const node = namehash(`${label}.eth`);
  console.log("→ setResolver → public resolver…");
  const sr = await wallet.writeContract({ address: REGISTRY, abi: registryAbi, functionName: "setResolver", args: [node, PUBLIC_RESOLVER] });
  await pub.waitForTransactionReceipt({ hash: sr });
  console.log("→ setText x402:hello (proof of write)…");
  const st = await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: "setText", args: [node, "x402:hello", "glassbox402 lives on ENS"] });
  await pub.waitForTransactionReceipt({ hash: st });

  console.log(`\n✅ ${label}.eth registered + text record set`);
  console.log(`   https://sepolia.app.ens.domains/${label}.eth`);
}

main().catch((e) => { console.error("failed:", e.shortMessage ?? String(e).split("\n")[0]); process.exit(1); });

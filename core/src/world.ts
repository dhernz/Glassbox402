// World ID — is a real, unique human behind this caller?
//
// Two halves, deliberately split:
//
//   1. verifyWorldProof()  — async, network. Runs ONCE, in the hub, when the buyer
//      completes a World ID flow (Selfie Check). Talks to World's cloud verify.
//   2. verifySessionToken() — sync, local. Runs on EVERY request, in the gateway.
//
// Why the split: a World ID proof is per-action and single-use (the nullifier
// identifies the person), so a buyer can't produce a fresh proof for every API
// call, and calling World's cloud on every request would put a network hop in
// the payment path. So the hub verifies once and mints a short-lived HMAC token
// bound to the nullifier; the gateway checks that signature locally per request.
//
// The signature is the whole point: pricing used to trust the mere PRESENCE of
// an `x-world-proof` header, so `curl -H "x-world-proof: lol"` bought the human
// tier. A token can't be forged without the shared secret.

import { createHmac, timingSafeEqual } from "node:crypto";

const APP_ID = process.env.WORLD_APP_ID;            // app_xxx from developer.world.org
const ACTION = process.env.WORLD_ACTION ?? "x402-verify";
// "simulated" lets the hub mint tokens without a real World proof, for when the
// Selfie Check beta isn't enabled on the app yet. It does NOT weaken the gateway:
// tokens are still signed, so an unverified caller still can't mint one. The UI
// labels the tier as simulated whenever this is on.
export const WORLD_MODE = process.env.WORLD_MODE ?? (APP_ID ? "live" : "simulated");
export const worldLive = () => WORLD_MODE === "live" && !!APP_ID;

const TTL_MS = Number(process.env.WORLD_TOKEN_TTL_MS ?? 15 * 60 * 1000);

// Hub and gateway are separate processes, so they share this via .env. A dev
// fallback keeps `./demo.sh` working out of the box rather than silently
// dropping every buyer to the bot tier; it's announced, and it's local-only.
const DEV_SECRET = "glassbox402-dev-secret-not-for-production";
let warned = false;
function secret(): string {
  const s = process.env.WORLD_TOKEN_SECRET;
  if (s) return s;
  if (!warned) {
    warned = true;
    console.warn("⚠️  WORLD_TOKEN_SECRET unset — using the shared dev secret. Set it in .env for a real deployment.");
  }
  return DEV_SECRET;
}

const b64url = (b: Buffer) => b.toString("base64url");
const sign = (payload: string) => b64url(createHmac("sha256", secret()).update(payload).digest());

export interface WorldSession {
  ok: boolean;
  nullifier?: string;  // stable per human per action — the thing worth rate-limiting on
  simulated?: boolean;
  exp?: number;
}

/** Mint a session token for a verified human. `simulated` is carried in the token
 *  itself, so the gateway and the dashboard can label the tier honestly. */
export function issueSessionToken(nullifier: string, simulated = !worldLive()): string {
  const exp = Date.now() + TTL_MS;
  const payload = `v1.${nullifier}.${exp}.${simulated ? "s" : "l"}`;
  return `${payload}.${sign(payload)}`;
}

/** Verify a session token. Sync and allocation-cheap: this runs on every request. */
export function verifySessionToken(token: string | undefined | null): WorldSession {
  if (!token) return { ok: false };
  const i = token.lastIndexOf(".");
  if (i < 0) return { ok: false };
  const payload = token.slice(0, i);
  const got = token.slice(i + 1);
  const want = sign(payload);
  // constant-time compare, and only after a length check so Buffer.compare can't throw
  if (got.length !== want.length) return { ok: false };
  if (!timingSafeEqual(Buffer.from(got), Buffer.from(want))) return { ok: false };

  const [v, nullifier, expRaw, mode] = payload.split(".");
  if (v !== "v1" || !nullifier || !expRaw) return { ok: false };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false };
  return { ok: true, nullifier, simulated: mode === "s", exp };
}

/** Verify a World ID proof with the Developer Portal. Async, network — the hub
 *  calls this once per buyer, never the gateway. Returns the nullifier so the
 *  caller can mint a session token bound to that human. */
export async function verifyWorldProof(proof: any): Promise<{ ok: boolean; nullifier?: string; error?: string }> {
  if (!worldLive()) return { ok: false, error: "world_not_configured" };
  if (!proof?.nullifier_hash || !proof?.proof) return { ok: false, error: "malformed_proof" };
  try {
    const r = await fetch(`https://developer.worldcoin.org/api/v2/verify/${APP_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nullifier_hash: proof.nullifier_hash,
        merkle_root: proof.merkle_root,
        proof: proof.proof,
        verification_level: proof.verification_level,
        signal_hash: proof.signal_hash,
        action: proof.action ?? ACTION,
      }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j?.success === true) return { ok: true, nullifier: proof.nullifier_hash };
    return { ok: false, error: j?.code ?? j?.detail ?? `verify_failed_${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e).split("\n")[0] };
  }
}

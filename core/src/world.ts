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

// World ID 4.0 identifies the relying party by rp_id and has the RP's backend
// SIGN each proof request with a signer key. app_id is the legacy 3.0 handle,
// still needed by the widget.
const RP_ID = process.env.WORLD_RP_ID;              // rp_xxx from developer.world.org
const APP_ID = process.env.WORLD_APP_ID;            // app_xxx (legacy, for the widget)
const SIGNING_KEY = process.env.WORLD_RP_SIGNING_KEY; // hex signer key — server only, never shipped
const ACTION = process.env.WORLD_ACTION ?? "x402-verify";
// "simulated" lets the hub mint tokens without a real World proof, for when the
// Selfie Check beta isn't enabled on the app yet. It does NOT weaken the gateway:
// tokens are still signed, so an unverified caller still can't mint one. The UI
// labels the tier as simulated whenever this is on.
export const WORLD_MODE = process.env.WORLD_MODE ?? (RP_ID && SIGNING_KEY ? "live" : "simulated");
export const worldLive = () => WORLD_MODE === "live" && !!RP_ID && !!SIGNING_KEY;

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

/** The signed request context the IDKit widget needs. World ID 4.0 requires the
 *  RP's backend to sign every proof request, so this must never run in the
 *  browser — the signing key stays here. The widget also wants the legacy app_id. */
export async function rpContext(action = ACTION) {
  if (!worldLive()) return null;
  const { signRequest } = await import("@worldcoin/idkit-core/signing");
  const s: any = signRequest({ signingKeyHex: SIGNING_KEY!, action });
  return {
    app_id: APP_ID,
    action,
    // which credential the widget should ask for: selfie | orb | passport | human.
    // Selfie Check is the low-friction one and needs no Orb, but it's beta and
    // must be enabled on the app — hence a config switch, not a code change.
    credential: process.env.WORLD_CREDENTIAL ?? "selfie",
    rp_context: {
      rp_id: RP_ID,
      nonce: s.nonce,
      created_at: s.createdAt ?? s.created_at,
      expires_at: s.expiresAt ?? s.expires_at,
      signature: s.sig ?? s.signature,
    },
  };
}

/** Verify a World ID 4.0 proof with the Developer Portal. Async, network — the hub
 *  calls this once per buyer, never the gateway. Takes the whole IDKitResult and
 *  returns the rp-scoped nullifier, which is the stable per-human handle we bind
 *  the session token to. */
export async function verifyWorldProof(result: any): Promise<{ ok: boolean; nullifier?: string; error?: string }> {
  if (!worldLive()) return { ok: false, error: "world_not_configured" };

  // Despite the name, `selfieCheckLegacy` hands back a World ID *4.0* payload:
  // `responses[]` is present, and `responses[0].identifier` is "face". That string
  // is what tells a selfie credential apart from an Orb one, and World documents it
  // nowhere — we only learned it by logging a successful scan (WORLD-SELFIE-CHECK.md
  // §2.7). We assumed the opposite when writing this, hence the 3.0 branch below:
  // it is kept as a defensive fallback for other presets, NOT the Selfie Check path.
  // Unwrap common nestings too.
  const p = result?.responses || result?.merkle_root ? result
    : (result?.result ?? result?.payload ?? result?.proof_payload ?? result);
  const is40 = Array.isArray(p?.responses) && p.responses.length > 0;
  const is30 = !!(p?.proof && (p?.nullifier_hash || p?.merkle_root));
  if (!is40 && !is30) {
    console.error("world: unrecognised proof payload, keys =", p && Object.keys(p));
    return { ok: false, error: "malformed_proof" };
  }

  // The 4.0 endpoint verifies legacy 3.0 proofs too, so both go to the same place.
  const body = is40
    ? {
        protocol_version: p.protocol_version ?? "4.0",
        nonce: p.nonce,
        action: p.action ?? ACTION,
        environment: p.environment,
        responses: p.responses,
        user_presence_completed: p.user_presence_completed,
      }
    : {
        nullifier_hash: p.nullifier_hash,
        merkle_root: p.merkle_root,
        proof: p.proof,
        verification_level: p.verification_level,
        signal_hash: p.signal_hash,
        action: p.action ?? ACTION,
      };

  const attempts: Array<[string, any]> = [[`https://developer.world.org/api/v4/verify/${RP_ID}`, body]];
  // legacy fallback: the 3.0 endpoint is keyed by app_id, not rp_id
  if (is30 && APP_ID) attempts.push([`https://developer.worldcoin.org/api/v2/verify/${APP_ID}`, body]);

  let lastError = "verify_failed";
  for (const [url, payload] of attempts) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j: any = await r.json().catch(() => ({}));
      if (r.ok && j?.success === true) {
        return { ok: true, nullifier: j.nullifier ?? p.nullifier_hash ?? p.responses?.[0]?.nullifier };
      }
      lastError = j?.code ?? j?.detail ?? `verify_failed_${r.status}`;
      console.error("world: verify rejected by", url, "→", JSON.stringify(j).slice(0, 300));
    } catch (e) {
      lastError = String(e).split("\n")[0];
    }
  }
  return { ok: false, error: lastError };
}

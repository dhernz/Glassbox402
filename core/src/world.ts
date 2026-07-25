// World ID verification — is the caller a real, unique human (or their agent)?
// If WORLD_APP_ID is set, verify a World ID proof via World's cloud verify API.
// Otherwise (demo), a present `x-world-proof` header counts as verified.
// Used by the gateway's human-verified pricing tier.

const APP_ID = process.env.WORLD_APP_ID; // app_xxx from developer.worldcoin.org
const ACTION = process.env.WORLD_ACTION ?? "x402-verify";

export async function isHumanVerified(proofHeader: string | undefined): Promise<boolean> {
  if (!proofHeader) return false;
  if (!APP_ID) return true; // demo mode: presence of a proof = verified

  try {
    const proof = JSON.parse(Buffer.from(proofHeader, "base64").toString());
    const r = await fetch(`https://developer.worldcoin.org/api/v2/verify/${APP_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...proof, action: ACTION }),
    });
    const j: any = await r.json();
    return r.ok && j.success === true;
  } catch {
    return false;
  }
}

// 0G Compute — the watcher's brain runs on decentralized inference.
// OpenAI-compatible Compute Router (pc.0g.ai). When a price move happens, the
// watcher asks a 0G-hosted model to judge it, and the decision + model + token
// count show up on the Lens as proof of inference on 0G Compute.

const URL = process.env.ZG_ROUTER_URL ?? "https://router-api.0g.ai/v1";
const KEY = process.env.ZG_ROUTER_KEY;
const MODEL = process.env.ZG_MODEL ?? "0gm-1.0-35b-a3b"; // 0G Foundation's own model

export function zeroGReady(): boolean {
  return !!KEY;
}

export interface ZeroGDecision { decision: string; model: string; tokens: number; }

export async function zeroGDecide(prompt: string): Promise<ZeroGDecision | null> {
  if (!KEY) return null;
  try {
    const r = await fetch(`${URL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 16 }),
    });
    const j: any = await r.json();
    if (j.error) { console.log(`  ⚠️ 0G inference: ${j.error.message}`); return null; }
    const decision = j.choices?.[0]?.message?.content?.trim();
    if (!decision) return null;
    return { decision, model: j.model ?? MODEL, tokens: j.usage?.total_tokens ?? 0 };
  } catch (e) {
    console.log(`  ⚠️ 0G inference failed: ${String(e)}`);
    return null;
  }
}

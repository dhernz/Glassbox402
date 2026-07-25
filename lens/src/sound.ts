// The soul of the demo: money makes sound.
// Pure WebAudio, no assets. Chirp pitch scales with amount;
// >= $1 gets the whale KA-CHING; failures thud.

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.08, when = 0) {
  const a = ac();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + when);
  osc.stop(a.currentTime + when + dur + 0.05);
}

export function coin(amountUsd: number) {
  // $0.001 → ~700Hz · $0.01 → ~900Hz · $0.10 → ~1400Hz
  const f = 650 + Math.min(1200, Math.sqrt(amountUsd) * 2600);
  tone(f, 0.09, "square", 0.05);
  tone(f * 1.5, 0.12, "square", 0.04, 0.07); // the classic coin double-blip
}

export function kaching() {
  tone(523, 0.1, "triangle", 0.1);        // C5
  tone(659, 0.1, "triangle", 0.1, 0.09);  // E5
  tone(784, 0.22, "triangle", 0.12, 0.18); // G5
  tone(1047, 0.35, "triangle", 0.1, 0.28); // C6
}

export function thud() {
  tone(110, 0.18, "sawtooth", 0.09);
  tone(82, 0.25, "sawtooth", 0.07, 0.05);
}

export function heartbeat() {
  tone(70, 0.08, "sine", 0.12);
  tone(65, 0.1, "sine", 0.1, 0.14);
}

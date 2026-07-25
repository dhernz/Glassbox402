# Selfie Check (Beta) — integration + testing report

**Project:** GlassBox402 — x402 payment metering for APIs, with a seller dashboard.
**RP:** `rp_09da7b5675030ca0` · **action:** `x402-verify` · **credential:** Selfie Check (`selfieCheckLegacy`)
**Integration date:** 2026-07-25, ETHGlobal Lisbon.

---

## 1. How we use Selfie Check (and why it isn't login)

GlassBox402 turns any HTTP API into a pay-per-request x402 endpoint. The buyers are
autonomous AI agents. The seller sets the price.

**The problem Selfie Check solves for us: differential pricing as an abuse-prevention
signal.** An API operator wants a real person's agent to pay a fair rate, while an
unattended bot farm pays a deterrent multiple — or is refused. Before Selfie Check we had
no way to tell those apart, because both present the same thing: a wallet with money in it.
Wallets are free and infinite, so wallet-based rate limiting is security theatre.

Concretely, in `core/src/x402ify.ts` the price quoted in the HTTP 402 response is a function
of whether a human-backed session is present:

| caller | quoted price |
| --- | --- |
| holds a valid Selfie Check session | 0.01 HBAR (base) |
| no session / expired / forged | 0.10 HBAR (10×) |
| no session, and `blockBots` on | HTTP 403, no price offered |

There is **no account and no login anywhere in this product** — the seller authenticates
with a wallet, and the buyer is an agent that never logs in. Selfie Check is used purely as
a *pricing and eligibility signal at request time*, which is why "generic login" isn't a
thing we could do even if we wanted to.

**Why it's the right credential here.** Orb-grade proof of humanity is too high-friction for
"I want to buy 300 API calls" — the buyer would abandon. Selfie Check's low-friction
liveness is proportionate to the decision being made (a price tier, not a bank account),
which is exactly the "fairness / abuse-prevention" shape the track describes.

### Architecture note: verify once, enforce per request

A proof is per-action and single-use, but an agent makes hundreds of calls. So:

```
buyer ──selfie proof──▶ hub ──▶ World verify API
                         └── HMAC session token (nullifier + expiry, 15 min)
buyer ──token per request──▶ gateway ──▶ local signature check ──▶ price tier
```

The gateway never calls World on the request path (no added latency per payment), and the
token is bound to the rp-scoped nullifier, so one human = one session regardless of how
many wallets their agent rotates through. **That nullifier-per-human property is the part
that makes this an abuse signal rather than a checkbox.**

---

## 2. Developer feedback (SDK / API / docs)

Ordered by how much time each cost us.

### 2.1 🔴 Vite dev server + wasm MIME = a silent, undebuggable failure (cost: ~40 min)

**The single worst issue we hit.** Running under `vite dev`, the widget opened and
immediately showed:

> **Something went wrong** — We couldn't complete your request. Please try again.

With, and this is the painful part:
- **no console error** (we installed `window.onerror` + `unhandledrejection` hooks — nothing),
- **no network request to World at all** (verified in the network log — the failure is local),
- only an unrelated-looking warning: `` `WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back… ``.

That warning says "falling back", implying recovery, so it reads as benign. It isn't — the
fallback path then fails inside the widget and is reported as the generic error. Because
there's no network call, every diagnostic instinct points the wrong way: we suspected the RP
registration, then Selfie Check beta access, then our signature — and burned time proving
our signature was correct (it recovers to the registered signer address) before suspecting
the bundler.

**It works perfectly in a production build**, where `.wasm` is served correctly. Our fix was
to stop using the dev server (`demo.sh` now builds and serves the dashboard).

**Asks:**
1. Detect a wasm-instantiation failure and surface a *specific* message
   ("could not initialise cryptographic module — check your server's wasm MIME type"),
   not the generic one.
2. Say this in the docs. A one-line "known issue: Vite/webpack dev servers may serve .wasm
   with the wrong MIME type" would have saved the entire 40 minutes.
3. Consider not treating the streaming failure as recoverable if the fallback can't work.

### 2.2 🟠 One generic error UI for every failure class

Every failure — bad signature, unregistered RP, credential not enabled, wasm broken,
network down — renders the same "Something went wrong / Try Again" modal. As an integrator
you cannot tell "your config is wrong" from "our service is down" from "your bundler is
misconfigured". Even an error code in small print, or `console.debug` with a reason code,
would make self-service debugging possible.

### 2.3 🟠 Docs don't name the Selfie Check preset

`/world-id/credentials/11` describes Selfie Check and says "Use IDKit to integrate", but
gives no preset name, credential string, or code sample; the SDK reference is marked
"coming soon". We found `selfieCheckLegacy()` by grepping `.d.ts` files in
`@worldcoin/idkit`. The presets table at `/world-id/idkit/credentials` does list it — but
the credential page doesn't link there, and that's the page you land on from the overview.

### 2.4 🟠 `app_id` vs `rp_id` is easy to get wrong, and fails late

The overview's IDKit sample passes `app_id="app_xxxxx"`, and the legacy verify endpoint is
keyed by `app_id`. So we first implemented verification against
`developer.worldcoin.org/api/v2/verify/{app_id}` — which is wrong for a 4.0 app and would
have failed only at the final step, after a user had already done a selfie. Our portal
onboarding produced an `rp_` id, and the 4.0 endpoint is
`developer.world.org/api/v4/verify/{rp_id}`.

**Ask:** on the app's portal page, state plainly "this is a World ID 4.0 app: verify against
`/api/v4/verify/{rp_id}`; `app_id` is only for the widget." The two id formats sitting side
by side with different purposes is a trap.

### 2.5 🟡 `signRequest` output doesn't match `RpContext` field naming

`signRequest()` returns `{ sig, nonce, createdAt, expiresAt }` (camelCase) while `RpContext`
requires `{ signature, nonce, created_at, expires_at }` (snake_case). Mechanical, but it's a
silent mismatch: pass the object through and you get `undefined` timestamps and a failure
far downstream. A `toRpContext(sig, rp_id)` helper in `@worldcoin/idkit-core` would remove
the whole class of error.

### 2.6 🟡 `computeRpSignatureMessage` is undocumented in the guide

Only discoverable from types: `computeRpSignatureMessage(nonceBytes: Uint8Array, createdAt,
expiresAt, action?)` — positional, with the nonce as **bytes** while `signRequest` returns it
as a **hex string**. We needed it to prove our signature recovered to the registered signer.
Worth a documented example, since "is my signature right?" is the first question when the
widget fails.

### 2.7 🟡 The Selfie Check response identifier (`face`) is undocumented

Despite the `*Legacy` name, `selfieCheckLegacy` returns a **World ID 4.0** payload:

```
keys = [action, environment, nonce, protocol_version, responses, user_presence_completed]
responses[0].identifier = "face"
```

`face` is the string a relying party must branch on to know which credential it actually
received — and it appears nowhere in the documentation we could find. The verify reference
uses `proof_of_human` in every example, and the Selfie Check credential page gives no
identifier at all. We only learned it by logging the payload after a successful scan.

This matters for any RP accepting more than one credential: you cannot tell a selfie
verification from an Orb verification without knowing the identifier strings, and getting it
wrong means silently treating a low-assurance signal as a high-assurance one. **Please
publish the identifier for each credential next to its preset.** Relatedly, the `*Legacy`
suffix on a preset that returns a 4.0 payload is confusing — we assumed it implied a 3.0
response shape and wrote (unnecessary) compatibility handling for one.

### 2.8 🟡 Selfie Check beta access / sandbox is a hackathon blocker

`/world-id/sandbox/testing-selfie-check` requires access arranged "through your World point
of contact", and the credential is documented as "available to select partners". At a
hackathon where this is a public track, that's a hard stop unless someone is at the booth.
A self-serve toggle in the Developer Portal (even rate-limited) would remove it.

### 2.9 ✅ What worked well

- **`signRequest` is pure JS, no wasm server-side.** Dropped into a Node backend with zero
  friction and worked first try.
- **Managed vs Self-Managed** was a clear, well-explained choice; Managed removed on-chain
  registration entirely.
- **The verify API correctly rejected a forged proof** we submitted with a fabricated
  nullifier and a 5-element dummy array (`validation_error`) — we tested this deliberately
  and it failed closed, which is what you want.
- **The widget UI itself is polished** — QR, wording, and the World brand read as trustworthy
  to a first-time user.

---

## 3. User feedback (UX / comprehension / drop-off)

> Testing device: iPhone with World App, device-level verification (no Orb).
> Desktop browser + phone handoff via QR.

### 3.1 Observed on the desktop → phone handoff

- The modal reads **"Connect your World ID / Use phone camera to scan the QR code."** For a
  user who has never used World ID, "Connect your World ID" is ambiguous about what's about
  to happen — it doesn't say a selfie is coming. Naming the action ("Verify you're a real
  person with a quick selfie") would set expectations before the phone is picked up.
- There's no visible indication of *how long* the flow takes or *what data leaves the
  device*, which is the first thing a privacy-conscious user asks. A one-line
  "your selfie never leaves your phone" would likely reduce drop-off at the QR step, since
  that's the moment the user decides whether to commit.
- Desktop-to-phone handoff is inherently a drop-off cliff: the user must switch devices
  mid-flow. For our buyer-agent context this is acceptable (it's a one-time setup per
  session), but for a checkout-style flow it would be the dominant source of abandonment.

### 3.2 Selfie capture flow — the best part of the integration

**First attempt succeeded. No retries. Tester's own words: "such a seamless experience."**

Indoor venue lighting, handheld, iPhone, device-level World App account, first time using
Selfie Check. No framing corrections, no lighting warnings, no re-takes, and the tester
raised no complaint about any step of the capture itself.

This is worth stating plainly because it inverts the assumption we started with: we expected
the biometric capture to be the friction point and the setup to be trivial, and it was the
exact opposite. **Every minute we lost was on the developer side (§2); the user side worked
first try.** For a credential whose whole pitch is "low-friction liveness", that pitch held
up under a cold first-time test.

Not instrumented, and worth measuring properly in a longer study: wall-clock time from QR
scan to result, and behaviour under poor lighting or with glasses/hats. We recorded the
retry count (one attempt) but did not time the flow.

**Drop-off implication:** with capture this reliable, the abandonment risk in our flow sits
almost entirely at the *desktop→phone handoff* (§3.1), not at the selfie. If World wants to
reduce drop-off for RPs like us, the QR-screen wording is a higher-leverage target than the
capture UX.

### 3.3 Comprehension of the *result*

Once verified, our UI shows `Verified with World ID · expires in 15m`. The expiry is our
design, not World's, and in informal reading it raises "expires — then what?". We label the
consequence explicitly (unverified callers pay 10×) rather than leaving the user to infer it.

---

## 4. Working prototype

- **Buyer playground** (`http://localhost:5173?app=buyer`) — the agent-side market. Verify
  with World ID, then buy from a real API; each purchase shows the real upstream response
  and its Hedera settlement transaction.
- **Seller dashboard** (`http://localhost:5173`) — the operator toggles
  "Require human-verified callers" per API and sets the bot multiplier.
- **Run it:** `./demo.sh` (needs `.env` — see `.env.example` for the World variables).

### Verifying the enforcement is real, not decorative

```bash
U='http://localhost:4095/?chainid=1&module=stats&action=ethprice'
quote(){ curl -s -D- -o/dev/null "$@" | grep -i '^payment-required:' | sed 's/^[^:]*: //' | tr -d '\r' \
  | python3 -c "import sys,json,base64;print(int(json.loads(base64.b64decode(sys.stdin.read()))['accepts'][0]['amount'])/1e8,'HBAR')"; }

quote "$U"                          # 0.1  — no session
quote -H "x-world-proof: lol" "$U"  # 0.1  — claiming humanity does nothing
# with a real session token from the hub:
quote -H "x-world-proof: $TOKEN" "$U"     # 0.01
quote -H "x-world-proof: ${TOKEN%?}X" "$U" # 0.1 — one character tampered
```

Both tiers settle for the amount quoted, verifiable on HashScan — the dashboard cannot
report a number that didn't move on-chain.

### Failure modes we deliberately tested

| input | result |
| --- | --- |
| no proof | `malformed_proof`, no session issued |
| fabricated 4.0 proof | rejected by World's API (`validation_error`) |
| forged session token | quoted the bot price |
| tampered token (1 char) | quoted the bot price |
| expired token | falls back to the bot price |

---

## 5. Summary for the World team

Selfie Check fits agent-economy pricing better than Orb-grade proof: the decision being
gated is a price tier, so the friction should be proportionate — and the rp-scoped nullifier
gives exactly the "one human, many agents" primitive that wallet-based limits can't.

The integration itself is sound and the crypto worked first try. **The end-user experience
was excellent — one selfie attempt, no retries, described unprompted as "seamless" by a
first-time user.** The credential delivers on low-friction liveness.

**The cost was almost entirely developer-side and almost entirely diagnostic**: a
bundler-level wasm problem presented as an unexplained failure with no console output and no
network request, behind an error UI that says the same thing for every cause. Fix the error
specificity (§2.1, §2.2) and publish the credential identifiers (§2.7) and this becomes a
20-minute integration.

Ranked asks, if you only do three:
1. **Distinguish wasm-init failure from everything else in the error UI** (§2.1) — this alone
   was ~40 minutes and sent us investigating our RP registration and signature instead.
2. **Publish the response `identifier` per credential** (`face` for Selfie Check) (§2.7) — an
   RP accepting multiple credentials cannot currently tell them apart from the docs.
3. **Flag `rp_id` vs `app_id` on the app's portal page** (§2.4) — the wrong choice fails only
   after a real user has completed a real selfie, which is the worst possible place to fail.

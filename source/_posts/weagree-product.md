---
title: "WeAgree decentralized engineering: from legal dual-track logic to on-chain evidence anchoring"
date: 2026-04-29 00:00:00
tags:
  - web3
  - cryptography
categories:
  - product
  - architecture
---

> **Abstract**: WeAgree did not start as “blockchain for blockchain’s sake”. It started from a practical problem: in real relationships, **what someone agreed to, when they agreed, and whether they revoked it** is often hard to verify, replay, and audit. This post summarizes how we translated a dual-track legal idea—**contracts for transactions, intent for relationships**—into an executable product and engineering architecture, and shipped a pragmatic hybrid path: **off-chain business + on-chain anchoring**.

---

## 1. Origin: back to disputes, not narratives

WeAgree is driven by a concrete pain point: in complex relationships—commercial partnerships or personal ones—there is often **no evidence that is verifiable, replayable, and auditable** for **what was agreed, when it was agreed, and whether consent was withdrawn**.

That leads to a product stance:

- **Transactional contexts** emphasize contracts and a complete evidence chain.
- **Relationship contexts** emphasize expressing intent and the ability to revoke.
- **Consent** is not a one-off action but a dynamic process.

That is WeAgree’s grounding principle: **contracts for transactions, intent for relationships**. Engineering’s job is to turn these abstractions into a system that actually runs.

---

## 2. From legal logic to system model: dual tracks, not either-or

In architecture we did not force a choice between “evidence” and “intent”—we model both in parallel.

### 2.1 Proof rail (contract evidence)

Focus: tamper-resistance and auditability:

- agreement text and version identifiers
- signer identity and signature digests
- precise timestamps
- on-chain anchored hash

### 2.2 Consent rail (intent and autonomy)

Focus: whether “intent right now” was genuinely established:

- strong user identity confirmation
- stronger authentication before signing (optional Passkey enhancement)
- mandatory re-signing after version updates
- withdraw / restart flows during signing

So WeAgree is not a static “sign once and you’re done” system—it treats **the consent process** as a first-class concern.

---

## 3. Pragmatic decentralization: off-chain business + on-chain anchoring

WeAgree does not aim to put all data on-chain; it aims to make **disputed facts verifiable**. Hence a hybrid design:

1. **Off-chain business plaintext**: Supabase holds operational data and signing details.
2. **On-chain hash anchoring**: on Arbitrum Sepolia / EVM chains we anchor only `final_proof_hash`.
3. **Independent verification**: third parties can verify locally from an exported proof package, then check against the on-chain hash.

Engineering payoff:

- **Controlled cost**: avoid expensive full-text storage on-chain.
- **Controlled privacy**: sensitive content stays off-chain; only digest hashes are public.
- **Stronger trust anchor**: use on-chain time anchoring and immutability where it matters.

---

## 4. Key engineering practices

### 4.1 Account-level key provisioning

To lower the barrier to signing, we complete initialization automatically after login / signup callbacks:

- create the user profile
- if the user has no keypair, generate an Ed25519 keypair automatically
- encrypt the private key at rest with a server-side key (`USER_KEY_ENCRYPTION_KEY`)

### 4.2 Redefining the Passkey role

We define Passkey as **strong authentication evidence**, not the primary signing key—reducing cross-device verification complexity:

- **Primary signatures**: account-level Ed25519 keys
- **Strong auth proof**: Passkey assertion (optional or enforced by policy)

### 4.3 Versioned signing

Consent is not one-shot; each signature binds to a specific version:

- `agreement_versions` manages draft, pending-sign, and finalized states
- any text change creates a new version
- history stays auditable without silently overwriting newer versions

### 4.4 Richer evidence fields and honest anchoring UX

- **Complete evidence surface**: fields such as `signing_payload_hash`, `signature_hash`, `key_fingerprint` so each signature can be verified on its own
- **No fake success**: removed mock fallbacks; only successful anchoring sets `anchor_status = confirmed`, failures persist error details—avoiding “looks like it anchored” confusion

---

## 5. System boundaries and product responsibility

WeAgree does not replace legal judgment—it reduces factual uncertainty.

Where relationship contexts breed anxiety, the core issue is often **imbalanced evidence plus conflicting narratives**. WeAgree responds by:

- giving every signing event **verifiable evidence**
- making **when, what, and who confirmed** **replayable**
- giving version changes and re-signing a **clear trail**

**The system does not judge relationships; it narrows information asymmetry.**

---

## 6. Closing

WeAgree shows that the most valuable “decentralization” in the real world is not putting everything on a chain blindly—it is building **verifiable, auditable, traceable** evidence around what actually gets disputed.

When **contract logic in transactions** and **intent logic in relationships** are both reflected in the design, the technology gets closer to the true complexity of legal and ethical questions.

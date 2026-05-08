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

> **Abstract**: WeAgree didn’t start as “blockchain for blockchain’s sake”. It started from a practical dispute-resolution problem: in real relationships, **what someone agreed to, when they agreed, and whether they revoked it** is often hard to verify, replay, and audit. This post summarizes how we translated a dual-track legal idea—**contracts for transactions, intent for relationships**—into an executable product + engineering architecture, and shipped a pragmatic hybrid path: **off-chain business + on-chain anchoring**.

---

## 1. Origin: back to disputes, not narratives

WeAgree is driven by a real pain point: in complex relationships (business collaboration or personal relationships), evidence for:

- what exactly was agreed
- when it was agreed
- whether it was later revoked

is usually fragmented or unverifiable.

This led to a product judgment:
- **Transactional context** values contracts and complete evidence trails.
- **Relationship context** values intent expression and revocability.
- **Consent** is not a one-time action, but a dynamic process.

So the core principle became: **contracts for transactions, intent for relationships**. The engineering job is to turn this into a system people can actually use.

---

## 2. From legal logic to system model: dual tracks, not either-or

Architecturally, we didn’t choose between “evidence” and “intent”—we modeled both in parallel.

### 2.1 Proof rail (contract evidence)
Focused on tamper-resistance and auditability:
- agreement text + versioning
- signer identity + signature digest
- precise timestamps
- on-chain anchored hash

### 2.2 Consent rail (intent & autonomy)
Focused on whether “current intent” is legitimately established:
- strong identity confirmation
- optional stronger auth before signing (e.g., passkeys)
- forced re-signing after version updates
- revoke / restart signing flow

This means WeAgree treats **consent as a first-class process**, not a static “sign once and forget” event.

---

## 3. Pragmatic decentralization: off-chain business + on-chain anchoring

WeAgree does not aim to put everything on-chain. It aims to make **the disputed facts verifiable**. So we use a hybrid architecture:

1. **Off-chain stores business plaintext**: Supabase hosts business data and signing details.
2. **On-chain anchors only the hash**: on Arbitrum Sepolia / EVM chains, we anchor just `final_proof_hash`.
3. **Independently verifiable**: a third party can verify signatures locally from an exported proof package, then compare to the on-chain hash.

Engineering benefits:
- **Cost control**: avoid expensive on-chain full-text storage.
- **Privacy**: keep sensitive content off-chain while keeping verifiability.
- **Audit clarity**: on-chain is the immutable reference point; off-chain is the operational system.


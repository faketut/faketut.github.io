---
title: "Binding a signature to both a passkey and an Ed25519 keypair"
date: 2026-05-05 03:00:00
tags:
  - weagree
  - cryptography
  - security
categories:
  - engineering
  - web3
---

Most e-signing products give you one of two things:

1. A drawing of your name plus a hash. Pretty pictures, no real cryptography.
2. A document-signing key managed by the vendor. Real crypto, but the key isn't yours — it lives in the vendor's KMS and signs on your behalf.

WeAgree does a third thing: every signature is bound to **both** an Ed25519 keypair that's encrypted server-side **and** a WebAuthn passkey assertion from the signer's own device. This post explains why, and how the two pieces fit together.

## The threat model

The honest question to start with: **what attacks are we actually defending against?**

- **Forged signatures after a vendor breach.** If the signing key lives only on the server, anyone who gets the server can sign anything in the signer's name.
- **Signer repudiation.** "I never signed that" — without a hardware-attested action, it's hard to argue otherwise.
- **Tampering after the fact.** Easy to detect with hashing. Easy to ignore without anchoring (see [the next post](./03-onchain-anchoring.md)).

Single-key designs solve at most two of those.

## The shape of the solution

```mermaid
flowchart LR
    A[Signer hits "Sign"] --> B[Browser: WebAuthn assertion<br/>over signing_payload_hash]
    B --> C[Server verifies assertion<br/>+ checks credential is theirs]
    C --> D[Server loads encrypted<br/>Ed25519 private key]
    D --> E[Server decrypts with<br/>USER_KEY_ENCRYPTION_KEY]
    E --> F[Server signs<br/>canonical payload with Ed25519]
    F --> G[Insert signature row<br/>+ kmsKeyId='user-ed25519+passkey']
    G --> H[Persist passkey assertion<br/>alongside signature]
```

Two artifacts get persisted per signature:

- `signature_bytes_base64` — the Ed25519 signature over the canonicalized payload.
- `passkey_assertion` — the raw WebAuthn assertion (clientDataJSON, authenticatorData, signature).

A verifier can independently check **both**:

- "Does the Ed25519 signature validate against the signer's published public key?" — cryptographic integrity of the payload.
- "Does the WebAuthn assertion validate against the credential WeAgree had on file for this user?" — proof that the signer was physically present with their device.

## Why both, not one

You could pick a side:

**Passkey only** (the assertion _is_ the signature). The signed message would be the WebAuthn `clientDataJSON`, which is bounded by what the browser puts in there. We'd have to reconstruct intent ("user agreed to _this_ hash") from the challenge field, and our long-term verifier would need to keep WebAuthn library compatibility for years.

**Ed25519 only**. Clean cryptography, but now the server holds a key that can sign for the user. A vendor breach forges signatures.

The combination buys:

- **Replayability**: the Ed25519 signature over canonical JSON is small, language-neutral, and verifiable with 30 lines of Node — see [scripts/verify-proof.js](../scripts/verify-proof.js).
- **Liveness**: the passkey assertion proves the user was at their device _at signing time_, defeating an attacker who exfiltrates `USER_KEY_ENCRYPTION_KEY`.

The signature row records which mode was used via a string tag:

```ts
// in app/actions/agreements.ts
kmsKeyId: passkeyConfirmed ? "user-ed25519+passkey" : "user-ed25519";
```

That lets older signatures (created before passkey was required) keep verifying cleanly.

## Where the private key lives

This is where most "we did cryptography" stories quietly fail. WeAgree's Ed25519 private keys are:

1. Generated at user provisioning (`crypto.generateKeyPairSync("ed25519")`) — see [lib/signing/user-keypair.ts](../lib/signing/user-keypair.ts).
2. Encrypted with **AES-256-GCM** using a 32-byte server master key (`USER_KEY_ENCRYPTION_KEY`).
3. Stored as a JSON envelope: `{v:1, alg:"aes-256-gcm", iv, tag, ct}` — explicit version field so we can rotate.

```ts
export function encryptPrivateKeyPem(privateKeyPem: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(privateKeyPem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  });
}
```

This is not a substitute for a real HSM. It's a "raise the bar one level" decision: a database leak alone isn't enough to forge — the attacker also needs `USER_KEY_ENCRYPTION_KEY` (server env) **and** to bypass the passkey requirement on signing. The KMS adapter in [lib/signing/kms/](../lib/signing/kms/) is the on-ramp to swapping AES-GCM for AWS KMS without touching call sites; that story is [post #6](./06-kms-adapter.md).

## What's stored in the proof

The exported proof JSON contains, per signer:

| Field                    | Why it's there                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| `signing_payload`        | Canonical pre-hash bytes — verifier re-hashes to confirm integrity            |
| `signing_payload_hash`   | Convenience: cached SHA-256 of the canonical payload                          |
| `signature_bytes_base64` | The Ed25519 signature                                                         |
| `signer_public_key_pem`  | The public half of the user's keypair                                         |
| `signer_key_fingerprint` | SHA-256 of the public key PEM — so a wrong public key won't silently "verify" |
| `passkey_assertion`      | The full WebAuthn assertion                                                   |

The verifier script ([scripts/verify-proof.js](../scripts/verify-proof.js)) re-canonicalizes, re-hashes, and runs `crypto.verify(null, payloadBytes, publicKey, sigBytes)`. No special libraries. If it can be verified with the Node standard library, it can be verified anywhere.

## Trade-offs I'd revisit

- **Per-user envelope vs per-tenant KMS-managed data keys.** Right now there's one envelope key for everyone. For a multi-tenant deployment, I'd cut a KMS data key per tenant and let KMS audit the unwraps.
- **No passkey credential rotation flow yet.** Lose your device, you lose the ability to sign new things. The Ed25519 key can still verify old signatures — that's the point — but signing again needs a registered credential.
- **Passkey enforcement is a server-side flag.** Controlled by `AGREEMENT_PASSKEY_REQUIRED`. In dev I default it off; in production a launch checklist forces it on.

## The take-away

If the bar for "we did digital signatures properly" is "we cryptographically committed to the document hash _and_ proved the signer was at their device," you need two things, not one. They can be the same thing only if you're willing to make your verifier permanently depend on WebAuthn libraries — which I wasn't.

---
title: "Serializable OCC Transactions With a Bounded Commit Log"
date: 2026-05-02 15:00:00
tags:
  - minikv
  - lsm
  - go
  - distributed-systems
categories:
  - engineering
  - storage
---

> Optimistic concurrency control is "do the work, then ask
> permission". The interesting design question is what "ask
> permission" actually means when both readers and writers are
> running concurrently against an LSM tree.

MiniKV ships serializable transactions in
[`kv/txn.go`](../kv/txn.go). They are short, optimistic, and bounded.
This post is about why each of those words is there.

## The shape

```go
tx, _ := db.BeginTxn()                 // (1) capture snapshot + read seq
balance, _, _ := tx.Get([]byte("a"))   // (2) record read into ReadSet
tx.Put([]byte("a"), debit(balance, 5)) // (3) buffer into a Batch
err := tx.Commit()                     // (4) validate, then atomic apply
if errors.Is(err, kv.ErrTxnConflict) {
    // retry
}
```

Four steps, three pieces of state per transaction:

- a **snapshot** (the read view),
- a **read set** (keys we observed),
- a **write set** (a `kv.Batch` we'll apply on commit).

## The validation: a bounded commit log

The interesting code lives in
[`kv/txn.go`](../kv/txn.go):
`validateReadSetLocked`. The pseudocode:

```go
func (db *KV) validateReadSet(txReadSeq uint64, readSet [][]byte) error {
    for _, recent := range db.recentCommits {       // bounded ring buffer
        if recent.commitSeq <= txReadSeq { continue }
        for _, k := range readSet {
            if recent.touched(k) {
                return ErrTxnConflict
            }
        }
    }
    return nil
}
```

For every commit that happened *after* this transaction's snapshot,
check whether it touched any key in this transaction's read set. If
yes, abort. If no, the transaction's read view is still consistent
with the would-be commit point, and we proceed.

The bound is critical. The commit log is a fixed-size ring; if a
transaction's `readSeq` is older than the oldest entry still in the
ring, we can't *know* it's safe and have to conservatively abort:

```go
if txReadSeq < db.oldestCommitSeqLocked() {
    return ErrTxnConflict
}
```

This is the OCC equivalent of "snapshot too old". A long-running
transaction in a hot store will lose. That is the design.

## Why this works for serializability

Serializability requires the existence of *some* serial order
producing the same outcome. With this scheme:

- Each successful commit is assigned a fresh sequence number under
  the store mutex.
- A transaction T that commits at seq C "appears" to have run
  atomically at C, reading state at its snapshot seq R and applying
  its write set at C.
- The validation ensures **no committed transaction between R and C
  touched anything T read**. Therefore T's reads would have observed
  the same values had T run at C, so the serial order
  (..., committed_at_R+1, ..., T_at_C, ...) is consistent.

That's textbook OCC. The interesting part is the *bound* on history.

## What "bounded" buys you

A traditional MVCC store keeps every version of every key alive until
no transaction can still need it. That requires garbage collection
that tracks the oldest active read snapshot — fine, but it means a
forgotten transaction handle leaks unbounded disk space.

Bounded OCC inverts that:

- The store keeps O(ring_size) commit summaries.
- A transaction older than the ring just aborts.
- The system has a hard memory bound and a soft deadline for
  long-running transactions.

For a small embedded engine this trade is right. For a multi-tenant
OLTP database it would be wrong; you'd want true MVCC with a GC
horizon. Different problems, different answers.

## The atomic apply

If validation passes, the commit happens under the store mutex:

```go
db.mu.Lock()
if err := db.validateReadSet(...); err != nil {
    db.mu.Unlock()
    return err
}
commitSeq := db.nextSeq()
if err := db.writeBatchLocked(commitSeq, tx.writeSet); err != nil {
    db.mu.Unlock()
    return err
}
db.recordCommitLocked(commitSeq, tx.writeSet.touched())
db.mu.Unlock()
return nil
```

The `writeBatchLocked` is the same path as `KV.Write(b)` — a single
WAL append with a commit marker followed by MemTable inserts. Either
all of the writes are durable or none of them are; the commit marker
([`kv/wal.go`](../kv/wal.go)) is how recovery decides.

So the txn commit is exactly as atomic as a `Batch` write, which is
exactly as atomic as the WAL's commit marker. That's the chain of
trust.

## The retry contract

`Commit` returning `ErrTxnConflict` is the *only* expected failure
mode of an otherwise well-formed transaction. Callers should retry,
ideally with backoff. The transaction's read set may include keys
that don't exist (a `Get` returning not-found is still an observation
of "absent"), and those get validated too.

If you want stronger guarantees against starvation, that's a fair
critique — pure OCC can starve a write-heavy transaction against a
hot key. The mitigations (key locking, deterministic ordering,
priority bumps on retry) live one level up; the engine just reports
the conflict and lets the application decide.

## What's not in here

- No multi-version reads. Every read goes through a `Snapshot`, which
  pins SSTables but reads at one seq.
- No lock manager. There are no shared / exclusive locks held across
  user think time.
- No deadlock detection. There are no deadlocks: OCC can't deadlock.

That's a deliberately small surface. The transaction API is ~200
lines and the validation is the only "interesting" thinking.

---
title: "Designing a KV API Where Context, Batch, Snapshot, and Iterator All Coexist"
date: 2026-05-04 15:00:00
tags:
  - minikv
  - lsm
  - go
  - distributed-systems
categories:
  - engineering
  - storage
---

When MiniKV's public API grew from `Put/Get/Delete` to context,
batches, snapshots, iterators, and transactions, the challenge wasn't
implementing any one of them — it was keeping them orthogonal. Two
seams made that possible: one internal write path, and snapshots as
argument-shifts instead of second implementations.

## One write path

Every mutation in the system funnels into the same function:

```go
// internal
func (db *KV) writeBatchLocked(seq uint64, b *Batch) error {
    // 1. WAL append (one record per op, then a commit marker)
    // 2. MemTable inserts
}
```

- `Put` is a degenerate `Batch` with one op; `PutWithTTL` the same
  with an `ExpireAt` set; `Delete` a tombstone op.
- `Txn.Commit` is "validate, then submit a `Batch`" (see the
  [OCC post]({% post_link minikv-06-occ-transactions %})).
- An async replication event becomes a `Batch` via `ApplyReplica`;
  a raft `Apply` becomes a `Batch` via the FSM.

There is exactly one code path that touches the WAL and the
MemTable. New features add new producers in front of it; they do
not add new durability code.

The growth rule that protects this: each API addition is a *new
method*, not a *new parameter on an old method*. `PutCtx(ctx, key,
value)` instead of bolting `ctx` onto `Put` keeps every existing
caller compiling.

## Snapshots are argument shifts

`Snapshot` doesn't add a new read path. It captures
`(snapshot_seq, pinned_sstables)` and decorates the existing read
merge with "ignore entries with `seq > snapshot_seq`":

```go
func (s *Snapshot) Get(k []byte) ([]byte, bool, error) {
    return s.db.getAt(k, s.seq, s.pinned)
}
```

`db.Get(k)` is `db.getAt(k, db.currentSeq(), db.currentSSTables())`.
A snapshot just passes different arguments — no second
implementation. A "live" iterator is likewise a "snapshot iterator"
with `seq = currentSeq` and pinned files held until `Close`.

That's the whole composability story: one write funnel, one read
path with parameters. The public API's job is translating parameters
into internal calls.

## Context checked at boundaries

Context cancellation in a storage engine is awkward: most of the
work isn't cancellable — a 4 KiB block read takes microseconds, and
an fsync in progress can't be aborted. So the `Ctx` variants check
the context at boundaries:

```go
func (db *KV) PutCtx(ctx context.Context, k, v []byte) error {
    if err := ctx.Err(); err != nil { return err }   // pre-flight
    return db.Put(k, v)                              // body; not cancellable
}
```

We promise not to *start* work on a cancelled context. We don't
promise to abort an fsync in progress. For long-running work
(iterators, replication streams) the context is checked between
blocks or events — the natural cancellation points anyway.

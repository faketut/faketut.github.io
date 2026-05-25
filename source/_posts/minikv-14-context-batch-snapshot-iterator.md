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

> Each of these concepts is small on its own. The interesting design
> question is making them compose without each one needing to know
> about every other.

When MiniKV's public API grew from `Put/Get/Delete` to include
context, batches, snapshots, iterators, and transactions, the
challenge wasn't implementing any one of them — it was keeping them
orthogonal. This post is about the seams that made that possible.

## The starting point

The minimal API is four methods:

```go
Put(key, value []byte) error
Get(key []byte) ([]byte, bool, error)
Delete(key []byte) error
PutWithTTL(key, value []byte, ttl time.Duration) error
```

Single store, no batching, no cancellation, no consistency primitives.
Easy to write, easy to use.

The growth path matters. Each addition should be a *new method*, not
a *new parameter on an old method*. Adding a `ctx context.Context` to
`Put` would break every existing caller. Adding `PutCtx(ctx, key,
value)` is a clean superset.

## The current API surface

```go
// Basic
db.Put(k, v)
db.Get(k)
db.Delete(k)
db.PutWithTTL(k, v, ttl)

// Context-aware
db.PutCtx(ctx, k, v)
db.GetCtx(ctx, k)
db.DeleteCtx(ctx, k)
db.PutCtxWithTTL(ctx, k, v, ttl)

// Batched
b := kv.NewBatch()
b.Put(k, v); b.Delete(k2); b.PutWithTTL(k3, v, ttl)
db.Write(b)

// Snapshot
snap, _ := db.Snapshot()
snap.Get(k); snap.NewIterator(lo, hi)
snap.Close()

// Iterator
it, _ := db.NewIterator(lo, hi)
for it.Next() { ... }; it.Close()

// Transaction
tx, _ := db.BeginTxn()
tx.Get(k); tx.Put(k, v); tx.Commit()
```

Six concepts, all on the same store, none of which know about each
other.

## The seam: one internal write path

Every mutation in the system funnels into the same function:

```go
// internal
func (db *KV) writeBatchLocked(seq uint64, b *Batch) error {
    // 1. WAL append (one record per op, then a commit marker)
    // 2. MemTable inserts
}
```

- `Put` is a degenerate `Batch` with one op.
- `PutWithTTL` is the same with an `ExpireAt` set.
- `Delete` is a tombstone op.
- `Batch` is the user-visible version of the same struct.
- `Txn.Commit` is "validate, then submit a `Batch`".
- An async replication event becomes a `Batch` via `ApplyReplica`.
- A raft `Apply` becomes a `Batch` via the FSM.

This is the most important property of the design: there is
**exactly one** code path that touches the WAL and the MemTable. New
features add new producers in front of it; they do not add new
durability code.

## The seam: snapshots are read-only views

`Snapshot` doesn't add a new read path. It captures `(snapshot_seq,
pinned_sstables)` and decorates the existing read merge with a filter
"ignore entries with `seq > snapshot_seq`".

```go
func (s *Snapshot) Get(k []byte) ([]byte, bool, error) {
    return s.db.getAt(k, s.seq, s.pinned)
}
```

`db.Get(k)` is `db.getAt(k, db.currentSeq(), db.currentSSTables())`.
A snapshot just passes different arguments. No second implementation.

The same shape applies to iterators: a "live" iterator is exactly a
"snapshot iterator" with `seq = currentSeq` and pinned files held
until `Close`.

## The seam: context-aware variants

Context cancellation in storage engines is awkward because most of
the work is not cancellable: a 4 KiB block read takes microseconds,
fsync takes milliseconds-to-seconds and can't be aborted.

MiniKV's `Ctx` variants check the context at *boundaries*:

```go
func (db *KV) PutCtx(ctx context.Context, k, v []byte) error {
    if err := ctx.Err(); err != nil { return err }   // pre-flight
    return db.Put(k, v)                              // body; not cancellable
}
```

This is honest. We promise we won't *start* work if the context is
already cancelled. We don't promise we can abort an fsync in
progress.

For longer-running work (iterators, replication streams, snapshot
sends) the context is checked between blocks/events, which is the
natural cancellation point anyway.

## The seam: `Close` is the universal release

Anything that pins resources implements `Close()`:

- `Snapshot.Close()` — decrement SSTable refcounts.
- `Iterator.Close()` — release per-SSTable readers + snapshot.
- `Txn.Rollback()` — drop write set, decrement snapshot.
- `KV.Close()` — drain workers, close WAL, sync.

There is no finalizer-based reclaim. If you don't `Close`, you leak
SSTable files (deferred unlinks never fire) and eventually disk
space. The leaks are observable in `KV.Stats()` so debugging is
straightforward.

## What this composability buys

A user can write, for instance:

```go
snap, _ := db.Snapshot()
defer snap.Close()
it, _ := snap.NewIterator(start, end)
defer it.Close()

batch := kv.NewBatch()
for it.Next() {
    if shouldDelete(it.Key()) {
        batch.Delete(it.Key())
    }
}
db.Write(batch)
```

— a consistent scan that produces a delete batch — without any
"scan-and-delete" API. Because:

- The iterator is read at a fixed snapshot, so concurrent writes
  don't disturb the scan.
- The batch is written atomically, separately from the iteration.
- Nothing in `Snapshot`/`Iterator`/`Batch`/`Write` had to be designed
  with the others in mind. They compose because they share the
  internal seams above.

## The lesson

Don't grow your API by adding parameters to existing methods. Grow
it by adding new methods that share the *implementation* with the
old ones. The user-facing API can have ten variants of `Put`; the
internal write path should still be one function. The whole job of
the public API layer is to be the parameter-to-internal-call
translator.

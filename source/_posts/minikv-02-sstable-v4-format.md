---
title: "Anatomy of the SSTable v4 File Format"
date: 2026-05-01 15:00:00
tags:
  - minikv
  - lsm
  - go
  - distributed-systems
categories:
  - engineering
  - storage
---

> An SSTable is an immutable, sorted key-value file. Every detail of
> the layout exists to make one of three operations cheap: building
> the file once, looking up one key, or scanning a range.

MiniKV's SSTable lives in [`kv/sstable.go`](../kv/sstable.go) and is
on its fourth on-disk format ("v4"). This post is a tour from
outermost to innermost.

## Top-level layout

```mermaid
flowchart LR
    H[Header<br/>magic + version<br/>compression byte] --> D[Data blocks<br/>~4 KiB each]
    D --> B[Bloom filter]
    B --> I[Block index<br/>sparse: first key per block]
    I --> F[Footer<br/>offsets + magic]
```

The reader opens the file, reads the footer (fixed size, at a known
offset from EOF), and from the footer learns where the index and the
Bloom filter live. That is the only "scan back from EOF" step; from
then on every read is a single positioned `ReadAt`.

## A data block

Inside a block, keys are stored with **prefix compression and restart
points**:

```
+------------------+ \
| shared | unshared | non-shared | unshared bytes | value... |  } record
+------------------+ /
... more records ...
+------------------+
| restart offsets[] (uint32 each)
+------------------+
| num_restarts (uint32)
+------------------+
| CRC32C (uint32)
+------------------+
```

- **Prefix compression**: each record stores how many leading bytes it
  shares with the previous key, then the rest. For a workload with
  long common prefixes (paths, UUIDs, tenant-scoped keys) the win is
  large.
- **Restart points**: every K records (default 16) we "reset" the
  prefix compression and record the absolute offset. To seek inside a
  block we binary-search the restart array, then scan forward at most
  K-1 records.

A point lookup is therefore:

```
binary search index   → O(log B) where B = blocks in file
read one block        → ~4 KiB ReadAt + CRC + optional snappy decompress
binary search restarts → O(log R) where R ≈ block_size / restart_interval
linear scan ≤ K-1 records → O(K)
```

For 4 KiB blocks with 16-record restarts and 1 M-key files, that's
roughly `log2(1M/64) + log2(64) + 16` ≈ 36 string comparisons.

## The Bloom filter

A point lookup that returns "not found" still pays the index search +
block read above. For workloads that miss often — caches, dedup,
"have I seen this key?" — that wastes most of the work.

Each SSTable carries a file-level Bloom filter
([`kv/bloom.go`](../kv/bloom.go)) sized for ~1% false-positive rate.
The read path checks Bloom first; on "definitely not present", the
read returns immediately without touching the index or any block.

You can see the effect in the README benchmarks: `Get` miss is
sub-microsecond per call, because nothing past the filter ran.

## Compression

`Config.Compression` selects per-block snappy (`snappy`) or no
compression (`none`). The choice is per-block, not per-file, because:

- The block is the unit you decompress in the read path. Whole-file
  compression would force a full-file decompress to read one key.
- A per-block byte in the data section lets you mix uncompressed
  (already-tiny) blocks with compressed ones — though MiniKV currently
  doesn't bother and uses the file-level setting uniformly.

## CRC32C per block

Every block ends with a CRC32C over its bytes. A failing CRC turns
into a `kv.ErrCorrupt` from the read path. Per-block CRCs (as opposed
to per-file or per-record) hit a nice middle:

- Per-record: too many CRC computations on the write path.
- Per-file: detection only on full reads; can't isolate damage.
- Per-block: one CRC per ~4 KiB, which is also the unit of disk read.

## The footer

The footer is the file's table-of-contents:

```
+----------------+
| index offset   |
| index length   |
| bloom offset   |
| bloom length   |
| magic (8 bytes)|
+----------------+
```

Fixed size, at EOF. The reader fseek-s `EOF - footer_size`, validates
the magic, and now knows where to find every other section. This
makes opening a 1 GiB SSTable an O(1) operation (modulo loading the
index, which is small).

## Why "v4"?

The format has bumped versions for: introducing restart points
(v2-ish), adding the Bloom filter (v3), and adding per-block
compression metadata (v4). The header carries the version byte and
`LoadSSTableHandle` ([`kv/sstable.go`](../kv/sstable.go#L601))
rejects unknown versions with `ErrUnsupportedFormat`. There is no
in-place migration; you compact old files into new format files.

## What this layout buys you

| Operation | Cost |
|---|---|
| Open file | 1 ReadAt for footer + 1 for index |
| Point lookup (miss) | 1 Bloom check |
| Point lookup (hit) | 1 block ReadAt + decompress + scan |
| Range scan | sequential block reads, no random I/O |
| Build | single pass over sorted input, one fsync at end |

Those four lines are why every LSM engine in production looks roughly
the same on disk.

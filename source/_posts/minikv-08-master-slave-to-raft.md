---
title: "From Static Leader to Raft Without Throwing Away the Old Path"
date: 2026-05-03 03:00:00
tags:
  - minikv
  - lsm
  - go
  - distributed-systems
categories:
  - engineering
  - storage
---

When MiniKV grew a raft mode, the obvious refactor was to rip out the
old leader/follower path and FSM-ify everything. I didn't, because
the two replication paths solve different problems:

| Problem | Best tool |
|---|---|
| Automatic leader election, RPO=0 writes | Raft |
| Cross-region read replicas, geo-bootstrap, broadcast workloads | Async master-slave |

Raft is a heavy hammer for cross-region: every commit needs a
round-trip to a quorum, and if the secondary is across an ocean you
pay that round-trip on every write. Async replication is a light
hammer for HA: a leader failure loses whatever hasn't streamed yet.
Complementary, not substitutes.

## The one seam: `KV.ApplyReplica`

Both paths apply incoming events through the same function:

```go
// kv/replication.go
func (db *KV) ApplyReplica(seq uint64, ev Event) error { ... }
```

Async path: gRPC `Replicate` stream → `ApplyReplica` per event.
Raft path: `FSM.Apply` decodes a `Command` and calls into KV.

This is what makes both modes possible without duplicating the write
path's correctness logic (WAL, memtable, durability). `KV` doesn't
know which mode is in front of it; the CLI picks one at startup
based on flags.

## Where they diverge

| Concern | Async | Raft |
|---|---|---|
| Who is leader? | Operator picks | Raft elects |
| Leader crash | Manual failover; possible RPO > 0 | Auto-elect, RPO = 0 (modulo fsync) |
| "Applied" means | Follower's local WAL durable seq | Committed and applied by raft |
| Membership change | Edit config and restart | Online (`AddVoter`, `RemoveServer`) |

`kv/raftnode/` is small: `command.go` (wire format), `fsm.go`
(`raft.FSM` backed by `*kv.KV`), `node.go` (`Put`, `Get`,
`Delete`, `LinearizableGet`, `AddVoter`), `http.go` (control plane
plus follower→leader proxy). The FSM itself is a switch over
opcodes:

```go
case OpPut:    db.Put(cmd.Key, cmd.Value)            // or PutWithTTL
case OpDelete: db.Delete(cmd.Key)
case OpSetPeer: f.peers[cmd.Key] = cmd.Value          // control-plane
```

Everything else — log replication, elections, snapshots,
membership — is hashicorp/raft.

## The linearizable-read question

In the async path, "read your write" only works on the leader. In
the raft path, reads are still local by default (stale by up to one
applied entry), with an opt-in `LinearizableGet`:

```go
// kv/raftnode/node.go
func (n *Node) LinearizableGet(key []byte, timeout time.Duration) ([]byte, bool, error) {
    if !n.IsLeader() { return nil, false, ErrNotLeader }
    if err := n.raft.Barrier(timeout).Error(); err != nil { ... }
    return n.fsm.DB().Get(key)
}
```

`raft.Barrier` proposes a no-op and waits for it to commit, so the
FSM has applied every prior write; after that, a local read on the
leader is linearizable. Leader-lease schemes avoid the barrier
round-trip for hot reads, but we don't need them yet.

I also kept what the new mode *could* have replaced: the whole
`kv/grpcapi/Replicate` path, the `SyncReplicas` quorum mode for
"raft is overkill but RPO=0 is required," and the HTTP NDJSON
replicate stream as an ops tool. Cost of keeping them: a couple of
packages and one config knob.

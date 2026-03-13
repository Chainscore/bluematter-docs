# Overview

Bluematter is an independent Cardano full-node implementation in pure Python.
It implements the Ouroboros Praos consensus protocol, the Conway-era ledger
rules, Plutus script evaluation, and the full Ouroboros network stack.

---

## Module Map

```
bluematter/
  codec/        Wire format -  CBOR deserialization with byte preservation
  crypto/       Cryptographic primitives -  Ed25519, Blake2b, VRF, KES
  consensus/    Ouroboros Praos -  header validation, leader election, nonce, chain selection
  ledger/       State machine -  UTxO, validation rules, certificates, rewards, governance
    rules/        Phase-1 validation (UTxO, witnesses, certificates)
    plutus/       Phase-2 validation (Plutus CEK machine, script context)
  network/      Ouroboros mini-protocols -  mux, handshake, chainsync, blockfetch
  node/         Orchestration -  sync pipeline, server, forging, CLI
  storage/      Persistence -  ImmutableDB (SQLite), VolatileDB (memory), LedgerDB (checkpoints)
  mempool/      Transaction pool -  bounded FIFO, revalidation
  observability/ Metrics -  Prometheus counters/gauges, HTTP endpoint
  config/       Genesis file parsing
```

## Detailed Documentation

| Document | Covers |
|----------|--------|
| [codec.md](codec.md) | CBOR schema system, byte-preserving decode, block/header/tx types, security hardening |
| [crypto.md](crypto.md) | Hash functions, Ed25519, VRF (Elligator2), KES (Sum6KES), hash usage map |
| [consensus.md](consensus.md) | Header validation, leader election (VRF threshold), nonce evolution, chain selection, HFC |
| [ledger.md](ledger.md) | LedgerState, apply_block pipeline, UTxO/witness/cert rules, epoch boundary, rewards, governance, Plutus, snapshots |
| [network.md](network.md) | Multiplexer, handshake, ChainSync, BlockFetch, KeepAlive, TxSubmission2, peer management |
| [node.md](node.md) | CLI, config, sync pipeline, server mode, block forging, storage layer, mempool, observability |

---

## Core Data Flow

```
                        +-----------+
                        | TCP Peer  |
                        +-----+-----+
                              |
                    +---------v---------+
                    |    Multiplexer    |  8-byte frames, CBOR reassembly
                    | (network/mux.py) |
                    +---------+---------+
                              |
              +---------------+---------------+
              |               |               |
        +-----v-----+  +-----v-----+  +------v------+
        | ChainSync |  | BlockFetch|  | KeepAlive   |
        | (headers) |  | (blocks)  |  | (heartbeat) |
        +-----------+  +-----+-----+  +-------------+
                              |
                    +---------v---------+
                    |   decode_block()  |  CBOR → ConwayBlock
                    |  (codec/block.py) |  Byte-preserving decode
                    +---------+---------+
                              |
                    +---------v---------+
                    | validate_header() |  VRF proof, KES sig, leader check
                    |(consensus/header) |  Slot monotonicity, opcert
                    +---------+---------+
                              |
                    +---------v---------+
                    |   apply_block()   |  Phase-1 validate → apply_tx → Phase-2
                    | (ledger/block.py) |  UTxO update, certs, fees
                    +---------+---------+
                              |
              +---------------+---------------+
              |               |               |
        +-----v-----+  +-----v-----+  +------v------+
        | ImmutableDB|  | LedgerDB |  | VolatileDB  |
        | (finalized)|  |(checkpts)|  | (recent)    |
        +-----+-----+  +-----------+  +-------------+
              |
              v
         Epoch boundary? ──yes──> tick() → rewards, snapshots, governance
```

## Node Lifecycle

### 1. Startup
```
CLI parse args
  → load NodeConfig (YAML/JSON)
  → parse genesis files (Shelley + Alonzo + Conway)
  → derive ProtocolParameters
```

### 2. State Bootstrap
```
Priority chain:
  1. LedgerDB checkpoint (HMAC-verified pickle)
  2. Snapshot import (Amaru-format NewEpochState CBOR)
  3. Fresh LedgerState from genesis
```

### 3. Sync Loop (steady state)
```
connect(peer) → handshake(v13/v14) → find_intersect(checkpoint)
loop:
  header ← ChainSync.request_next()
  block  ← BlockFetch.fetch_range(point, point)
  validate_header(header, epoch_nonce, pool_dist)
  apply_block(state, block, protocol_params)
  store(ImmutableDB, VolatileDB)
  every 1000 blocks: save_checkpoint(LedgerDB)
  on epoch boundary: tick(state) → rewards, snapshots, governance
  on rollback: load_checkpoint_before(slot), replay blocks
  on disconnect: reconnect with exponential backoff
```

### 4. Server Mode (optional)
```
listen(addr:port)
  per connection:
    validate handshake (network magic)
    serve ChainSync (headers from chain tip)
    serve BlockFetch (blocks from ImmutableDB + VolatileDB)
    keepalive heartbeat
    30-min idle timeout, 20 connection limit
```

### 5. Block Forging (optional)
```
if is_slot_leader(slot, vrf_key, stake, epoch_nonce):
  txs ← mempool.snapshot()
  body_hash ← hash(tx_bodies || witnesses || aux_data || invalid_txs)
  header ← build_header(slot, prev_hash, body_hash, vrf_proof, kes_sig)
  broadcast block to peers
```



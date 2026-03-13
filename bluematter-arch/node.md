---
---
# Node

## Overview

The node module wires together networking, ledger validation, storage, mempool,
and observability into a running Cardano node. It handles startup, live chain sync,
block serving, block forging, crash recovery, and graceful shutdown.

**Package:** `bluematter.node`

## Files

| File | Purpose | Key Exports |
|---|---|---|
| `cli.py` | CLI entry points (`python -m bluematter`) | `main()`, subcommands: `sync`, `batch-sync`, `decode-block`, `info` |
| `config.py` | Node configuration from YAML/JSON | `NodeConfig`, `load_config()` |
| `sync.py` | Live sync pipeline (connect, stream headers, fetch+apply blocks) | `live_sync()`, `multi_peer_sync()`, `SyncPipeline`, `SyncResult` |
| `server.py` | Inbound relay server (serve blocks to downstream peers) | `RelayServer` |
| `forging.py` | Block forging (assemble + sign new blocks) | `forge_block()`, `check_leadership()`, `ForgeKeys`, `ForgedBlock` |

## CLI Entry Points (`cli.py`)

`python -m bluematter <command>`

### `sync` -- Live Chain Sync

```
python -m bluematter sync --network preprod
python -m bluematter sync --snapshot snap.cbor --genesis-dir ./genesis
python -m bluematter sync --peer host:port --max-blocks 100
```

**Arguments:**
- `--network` (`preprod` | `preview`): selects default peer and network magic
- `--peer host:port`: override the default peer
- `--snapshot`: path to `.cbor` or `.cbor.gz` snapshot for initial state
- `--genesis-dir`: directory containing `shelley-genesis.json`, `alonzo-genesis.json`, `conway-genesis.json`
- `--max-blocks`: stop after N blocks (None = run forever)
- `--data-dir`: directory for ImmutableDB and LedgerDB persistence
- `--checkpoint-interval`: save ledger checkpoint every N blocks (default 50)
- `--log-level`: `DEBUG` | `INFO` | `WARNING`

Default peers:
- preprod: `preprod-node.world.dev.cardano.org:30000`
- preview: `preview-node.play.dev.cardano.org:3001`

Handles SIGINT/SIGTERM for graceful shutdown (cancels all asyncio tasks).

### `batch-sync` -- Batch Sync with Auto-Reconnect

```
python -m bluematter batch-sync --network preprod --batch-size 200
```

Delegates to `scripts/batch_sync.py`. Arguments: `--snapshot`, `--batch-size`,
`--max-blocks`, `--max-retries`.

### `decode-block` -- Decode a Single Block File

```
python -m bluematter decode-block block.cbor
```

Reads a CBOR block file, decodes it via `decode_block_from_wire()`, and prints:
- For `ConwayBlock`: slot, block_number, transaction count, block_hash, body_size
- For `OpaqueBlock`: era name, block_hash, raw_size

### `info` -- Show Node Information

Prints version (`v0.1.0`), supported eras (Conway), supported protocols, and
crypto primitives.

## Node Configuration (`config.py`)

### NodeConfig

All configurable settings, stored as a dataclass with sensible defaults:

| Field | Type | Default | Description |
|---|---|---|---|
| `network` | str | `"preprod"` | Network name |
| `network_magic` | int | `1` | Network magic number |
| `peers` | list[tuple[str,int]] | `[]` | Static peer list |
| `listen_host` | str | `"0.0.0.0"` | Server listen address |
| `listen_port` | int | `3001` | Server listen port |
| `max_inbound_connections` | int | `20` | Maximum inbound connections |
| `data_dir` | str\|None | `None` | Storage directory (None = in-memory) |
| `checkpoint_interval` | int | `50` | Blocks between ledger checkpoints |
| `genesis_dir` | str\|None | `None` | Genesis JSON directory |
| `snapshot_path` | str\|None | `None` | Initial snapshot file |
| `mempool_max_count` | int | `10_000` | Maximum mempool transactions |
| `mempool_max_bytes` | int | `50_000_000` | Maximum mempool size (50 MB) |
| `max_blocks` | int\|None | `None` | Block limit (None = forever) |
| `security_param` | int | `2160` | Ouroboros security parameter (k) |
| `log_level` | str | `"INFO"` | Logging level |
| `log_format` | str | `"%(asctime)s ..."` | Log format string |
| `metrics_enabled` | bool | `False` | Enable Prometheus metrics HTTP server |
| `metrics_host` | str | `"0.0.0.0"` | Metrics server bind address |
| `metrics_port` | int | `9090` | Metrics server port |
| `server_enabled` | bool | `False` | Enable inbound relay server |

**`NodeConfig.defaults(network)`** -- factory that populates network_magic and default
peer list from built-in network definitions (preprod, preview, mainnet).

### `load_config(path)`

Loads from JSON or YAML file. YAML requires the optional `PyYAML` dependency; falls
back to JSON if not installed. Uses a whitelist of known field names (from dataclass
fields) -- unknown keys are logged as warnings and ignored. Supports hyphenated keys
(converted to underscores).

## Sync Pipeline -- The Core Loop (`sync.py`)

### `live_sync()`

The primary sync function. Connects to a single peer and follows the chain tip.

**Parameters:**
- `peer_host`, `peer_port`, `network_magic` -- connection target
- `initial_state` -- starting `LedgerState` (overrides snapshot/checkpoint)
- `snapshot_path` -- path to `.cbor`/`.cbor.gz` snapshot
- `genesis_dir` -- genesis file directory for protocol parameters
- `intersect_slot`, `intersect_hash` -- known chain point to start from
- `max_blocks` -- stop after N blocks (None = forever)
- `checkpoint_interval` -- save checkpoint every N blocks
- `data_dir` -- persistent storage directory (None = in-memory)

**Initialization sequence:**

1. Open `ImmutableDB` and `LedgerDB` (SQLite, or in-memory if no data_dir)
2. Create `VolatileDB` (always in-memory) and `NonceState`
3. Recover state, in priority order:
   a. Use `initial_state` if provided
   b. Load latest `LedgerDB` checkpoint (crash recovery)
   c. Load snapshot from file
   d. Create empty `LedgerState`
4. Load protocol parameters from genesis files if `genesis_dir` is provided and
   state has no protocol params

**Reconnect loop:**

Wraps `_sync_session()` in a retry loop with exponential backoff (1s initial,
doubling up to 60s, max 100 retries). Between retries, saves a checkpoint.
If `max_blocks` is set, does not retry on failure.

### `_sync_session()`

A single sync session against one peer. Returns `True` on clean exit, `False` to retry.

**Connection setup:**

1. TCP connect with 15s timeout
2. Create `Multiplexer` (initiator mode)
3. Register protocol buffers for Handshake, ChainSync, BlockFetch, KeepAlive
4. Start mux `read_loop()` as background task
5. Perform handshake (15s timeout)
6. Signal Antithesis setup_complete (if available)
7. Start keepalive background task (1s initial delay, 30s interval)

**Intersection finding:**

If `intersect_slot`/`intersect_hash` are provided, intersects there directly.
Otherwise, discovers the chain tip first (via `MsgFindIntersect` at origin), then
re-intersects at the discovered tip.

**Main sync loop:**

For each iteration until `max_blocks` is reached:

1. **Request next header** -- send `MsgRequestNext` on ChainSync
2. **Handle response:**
   - `MsgAwaitReply` (tag 1): log "at chain tip", continue waiting
   - `MsgRollBackward` (tag 3): rollback volatile DB, reload best LedgerDB
     checkpoint at or before the rollback slot, re-apply blocks between the
     checkpoint and the rollback point from volatile storage
   - `MsgRollForward` (tag 2): proceed to block processing
3. **Decode header** -- extract `(slot, block_hash, era_tag)` from the era-tagged
   header envelope. Skip non-Conway blocks (era_tag != 6).
4. **BlockFetch** -- fetch the block body via `fetch_range(pt, pt)` (single block)
5. **Decode block** -- `decode_block_from_wire(block_bytes)`
6. **Header validation** -- structural checks (slot ordering, block number).
   KES/VRF deferred.
7. **Apply block** -- `apply_block(state, block)` runs in asyncio executor to avoid
   blocking the event loop. On failure, halts the sync.
8. **Store in VolatileDB** -- add the block with slot, hash, prev_hash, raw bytes
9. **Nonce evolution** -- extract VRF output from header, compute tagged nonce,
   update `NonceState`
10. **Graduate old blocks** -- when volatile DB exceeds 100 blocks, graduate blocks
    older than `tip - 2000` slots to ImmutableDB
11. **Checkpoint** -- save LedgerDB checkpoint every `checkpoint_interval` blocks
12. **Progress logging** -- every 5 seconds: block number, slot, tx count, epoch,
    UTxO count, blocks/second

**Cleanup:**
Cancels keepalive and read_loop tasks, closes the mux and TCP writer.

### `multi_peer_sync()`

Sync from multiple peers with automatic failover. Uses `PeerSelector` for scoring.
Tries each peer up to 3 times. On failure, marks the peer's error and moves to the
next candidate.

### `SyncPipeline`

Legacy class interface (used by tests). Wraps a `ChainValidator` with async callbacks
for `on_roll_forward` and `on_roll_backward`, plus a block fetch queue.

### `SyncResult`

Stats from a sync session:
- `blocks_synced: int`
- `validation_errors: int`
- `negotiated_version: int`
- `elapsed_seconds: float`

## Server Mode (`server.py`)

### RelayServer

Accepts inbound TCP connections and serves as a Cardano relay node.

**Constructor parameters:**
- `network_magic` -- for handshake validation
- `host`, `port` -- listen address (default `0.0.0.0:3001`)
- `immutable_db`, `volatile_db` -- block storage for serving
- `chain_tip_slot`, `chain_tip_hash`, `chain_tip_block` -- current chain tip
- `max_inbound_connections` -- connection limit (default 20)

**Methods:**
- `start()` -- create asyncio TCP server
- `serve_forever()` -- start + serve until cancelled
- `stop()` -- close the server
- `update_tip(slot, block_hash, block_number)` -- update chain tip (called after
  each new block is applied)

**Inbound connection handling:**

1. Enforce max connection limit (reject with close if exceeded)
2. 30-minute idle timeout per connection
3. Create `Multiplexer` in responder mode
4. Register protocol buffers for Handshake, ChainSync, BlockFetch, KeepAlive
5. Run all protocol handlers concurrently via `asyncio.gather()`

**Handshake responder (`_respond_handshake`):**
- Receives `MsgProposeVersions`, finds best common version from NTN_VERSIONS
- Validates peer's network magic
- Sends `MsgAcceptVersion` or `MsgRefuse`

**ChainSync server (`_serve_chainsync`):**
- `MsgFindIntersect`: checks provided points against VolatileDB and ImmutableDB,
  returns `MsgIntersectFound` or `MsgIntersectNotFound`
- `MsgRequestNext`: responds with `MsgAwaitReply` (does not proactively push headers)
- 5-minute timeout between messages

**BlockFetch server (`_serve_blockfetch`):**
- `MsgRequestRange(from, to)`: fetches blocks from VolatileDB first, then ImmutableDB.
  Sends `MsgStartBatch` + `MsgBlock*` + `MsgBatchDone`, or `MsgNoBlocks` if empty.
- `MsgClientDone`: ends the protocol
- 5-minute timeout between messages

**KeepAlive server (`_serve_keepalive`):**
- Echoes back `MsgKeepAliveResponse` with the same cookie
- Exits on `MsgDone` (tag 2) or timeout

## Block Forging (`forging.py`)

### ForgeKeys

Cryptographic keys required for block production:
- `cold_sk` / `cold_vk` -- pool operator Ed25519 signing/verification keys
- `vrf_sk` / `vrf_vk` -- VRF secret/verification keys
- `kes_sk` / `kes_vk` -- KES signing/verification keys
- `opcert_counter` -- operational certificate sequence number
- `kes_period` -- KES period at which the key was issued

### `check_leadership(keys, slot, epoch_nonce, pool_sigma, active_slot_coeff=0.05)`

Delegates to `consensus.leader.is_slot_leader()`. Returns
`(is_leader, vrf_proof, vrf_output)`.

### `forge_block(keys, state, mempool, slot, block_number, prev_hash, vrf_proof, vrf_output, max_block_body_size=65536)`

Assembles a new Conway block:

1. **Select transactions** -- iterate mempool in FIFO order, accumulate up to
   `max_block_body_size` bytes
2. **Encode block body** -- CBOR-encode tx_bodies, tx_witnesses (empty, pre-validated),
   auxiliary_data (empty), invalid_txs (empty)
3. **Compute body hash** -- `blake2b_256(h1 + h2 + h3 + h4)` where each `h_i` is the
   blake2b_256 of the respective body component
4. **Build operational certificate** -- sign `(kes_vk || counter || kes_period)` with
   the cold key. `opcert = [kes_vk, counter, kes_period, signature]`
5. **Build header body** -- 10-element CBOR array:
   `[block_number, slot, prev_hash, cold_vk, vrf_vk, [vrf_output, vrf_proof],
    body_size, body_hash, opcert, [10, 0]]`
   (protocol version 10.0 = Conway)
6. **KES-sign header body** -- compute current KES period from slot, call
   `kes_sign(offset, kes_sk, header_body_cbor)`
7. **Assemble full block** -- `[header_body, kes_signature]` is the header;
   `[header, tx_bodies, tx_witnesses, {}, []]` is the inner block;
   wrap with Conway era tag 7 and tag-24 envelope

Returns `ForgedBlock(slot, block_number, vrf_proof, vrf_output, tx_count, raw)`.

## Storage Layer

### ImmutableDB (`storage/immutable.py`) -- SQLite

Append-only store for finalized blocks that will never be rolled back.

**Schema:**
```sql
blocks(slot INTEGER PRIMARY KEY, block_number INTEGER NOT NULL,
       block_hash BLOB NOT NULL, raw BLOB NOT NULL)
-- Index: idx_block_hash ON blocks(block_hash)
-- PRAGMA journal_mode=WAL
```

**Methods:**
- `append(slot, block_number, block_hash, raw)` -- insert a finalized block. Raises
  `ValueError` on duplicate slot.
- `get_by_slot(slot)` -- returns `(block_number, block_hash, raw)` or `None`
- `get_by_hash(block_hash)` -- returns `(slot, block_number, raw)` or `None`
- `tip()` -- returns the highest `(slot, block_number, block_hash)` or `None`
- `iter_blocks(from_slot, to_slot)` -- iterate blocks in slot order, yielding
  `(slot, block_number, block_hash, raw)`
- `count()` -- total block count
- `close()` -- close the SQLite connection

Supports both file-backed and in-memory (`:memory:`) modes. Uses WAL journal mode
for concurrent read/write performance.

### VolatileDB (`storage/volatile.py`) -- In-Memory

In-memory store for recent blocks within the security parameter (k=2160) that may
still be rolled back.

**VolatileBlock** (frozen dataclass): `slot`, `block_number`, `block_hash`, `prev_hash`, `raw`

**Indexing:** dual dict -- `_by_hash: dict[bytes, VolatileBlock]` and
`_by_slot: dict[int, list[bytes]]`. Supports multiple blocks per slot for fork handling.

**Methods:**
- `add(block)` -- store a block
- `get_by_hash(hash)` / `get_by_slot(slot)` -- lookup
- `get_all_at_slot(slot)` -- all blocks at a slot (fork support)
- `tip()` -- highest-slot block
- `rollback_to(slot)` -- remove all blocks with slot > given slot, returns removed
  blocks in descending order (for undo)
- `get_chain(tip_hash)` -- trace chain backward via prev_hash links, returns
  chronological order
- `graduate(up_to_slot)` -- remove and return blocks with slot <= cutoff (for
  promotion to ImmutableDB), ascending order
- `get_blocks_in_range(from_slot, to_slot)` -- raw bytes for replay after rollback
- `count()` / `all_blocks()` -- enumeration

### LedgerDB (`storage/ledger_db.py`) -- SQLite + Pickle

Persistent ledger state checkpoints for crash recovery.

**Schema:**
```sql
checkpoints(slot INTEGER PRIMARY KEY, epoch INTEGER NOT NULL,
            utxo_count INTEGER NOT NULL, data BLOB NOT NULL,
            data_hash TEXT)
-- PRAGMA journal_mode=WAL
```

**HMAC Authentication:**
Checkpoint data is pickle-serialized, then HMAC-SHA256 signed with a node-local
secret key. Key is sourced from (in order):
1. `BLUEMATTER_HMAC_KEY` environment variable (hex)
2. `~/.bluematter/hmac.key` file
3. Auto-generated 32-byte random key (persisted to disk)

Supports legacy SHA-256 hex digest checkpoints (old format) -- accepts with a
warning and re-signs on next save.

**Methods:**
- `save_checkpoint(state, slot=None)` -- serialize state with pickle, HMAC-sign,
  store as INSERT OR REPLACE
- `load_latest_checkpoint()` -- returns `(state, slot)` for the most recent checkpoint
- `load_checkpoint(slot)` -- load a specific checkpoint by slot
- `load_checkpoint_before(slot)` -- load the most recent checkpoint at or before the
  given slot (used for rollback recovery)
- `list_checkpoints()` -- returns `[(slot, epoch, utxo_count), ...]`
- `prune(keep_latest=3)` -- remove old checkpoints, keeping the N most recent
- `count()` / `close()` -- utility

### ChainValidator (`storage/chain.py`)

Sequential block validation pipeline that applies blocks to advance a `LedgerState`.

**Methods:**
- `from_snapshot(path, streaming=False)` -- factory from snapshot file
- `apply_raw_block(block_bytes)` -- decode wire-format block, apply to state
- `apply_decoded_block(block)` -- apply a decoded `ConwayBlock`
- `validate_from_immutable_db(db, from_slot, to_slot)` -- validate a range from ImmutableDB
- `validate_from_files(block_dir, pattern)` -- validate from a directory of CBOR files

Tracks: `blocks_applied`, `last_block_hash`, `last_slot`, `last_block_number`,
`current_epoch`, `utxo_count`.

## Mempool

### Mempool (`mempool/pool.py`)

Bounded transaction pool with FIFO eviction and thread-safe access.

**Design:**
- Backed by `OrderedDict[bytes, bytes]` (tx_id -> raw_cbor) for insertion-order
  preservation
- Thread-safe via `threading.Lock` (shared between network and validation threads)
- Bounded by `max_count` (default 10,000) and `max_bytes` (default 50 MB)
- FIFO eviction: when full, evicts oldest transactions until the new tx fits

**Methods:**
- `add(tx_id, tx_cbor)` -- add a tx; evicts oldest if at capacity. No-op if already
  present. Raises `MempoolFull` if a single tx exceeds the pool's byte limit.
- `remove(tx_id)` / `remove_confirmed(tx_ids)` -- remove individual or batch
- `get_tx_ids()` -- all IDs in insertion order
- `get_tx(tx_id)` -- raw CBOR by ID
- `has_tx(tx_id)` -- membership check
- `snapshot()` -- atomic copy of all `(tx_id, tx_cbor)` pairs
- `count` / `total_bytes` -- current size
- `clear()` -- remove all transactions

### Mempool Validation (`mempool/validation.py`)

Lightweight pre-admission checks (not full ledger validation):

**`validate_tx_for_mempool(tx, state, pp)`** -- returns list of error strings (empty = valid):
- All inputs exist in UTxO
- No duplicate inputs within the tx
- Fee >= min fee (if protocol params available): `min_fee_a * tx_size + min_fee_b`
- Tx size <= `max_tx_size` (if protocol params available)

**`revalidate_mempool(mempool_txs, state)`** -- after a new block is applied, checks
all mempool txs against the updated UTxO. Returns list of tx_ids that are now invalid
(inputs no longer in UTxO) and should be evicted.

## Observability (`observability/metrics.py`)

### Metric Types

- **Counter** -- monotonically increasing integer. Thread-safe via lock. Methods: `inc(amount)`, `reset()`.
- **Gauge** -- float value that can go up and down. Thread-safe. Methods: `set(value)`, `inc(amount)`, `dec(amount)`.

### NodeMetrics

Global metrics registry (`METRICS` singleton):

| Metric | Type | Description |
|---|---|---|
| `blocks_applied` | Counter | Total blocks applied to ledger |
| `blocks_failed` | Counter | Blocks that failed validation |
| `txs_processed` | Counter | Total transactions processed |
| `chain_tip_slot` | Gauge | Current chain tip slot |
| `chain_tip_block` | Gauge | Current chain tip block number |
| `current_epoch` | Gauge | Current epoch |
| `utxo_size` | Gauge | Number of UTxO entries |
| `peer_count` | Gauge | Number of connected peers |
| `headers_received` | Counter | Total headers received via ChainSync |
| `bytes_received` | Counter | Total bytes received from network |
| `mempool_tx_count` | Gauge | Transactions in mempool |
| `mempool_bytes` | Gauge | Total bytes in mempool |
| `sync_progress` | Gauge | Sync progress (0.0 to 1.0) |
| `blocks_per_second` | Gauge | Block processing rate |

Plus a computed `uptime_seconds` gauge.

**Output formats:**
- `to_prometheus()` -- Prometheus exposition format with `# HELP`, `# TYPE`, and
  metric lines prefixed with `bluematter_`
- `to_json()` -- JSON object with metric names as keys

### `serve_metrics(host, port)`

Simple asyncio HTTP server for Prometheus scraping:
- Listens on `host:port` (default `0.0.0.0:9090`)
- Serves only `GET /metrics` (returns 404 for all other paths)
- 5-second timeout on request reading
- 8 KB header limit to prevent abuse
- Returns `Content-Type: text/plain; version=0.0.4` (Prometheus format)

## Node Lifecycle Diagram

```
STARTUP
   |
   v
Load Config (NodeConfig / CLI args)
   |
   v
Initialize Storage
   +-- ImmutableDB (SQLite / in-memory)
   +-- LedgerDB (SQLite / in-memory)
   +-- VolatileDB (in-memory)
   |
   v
Recover Ledger State
   +-- 1. Use provided initial_state?
   +-- 2. Load LedgerDB checkpoint? (crash recovery)
   +-- 3. Load snapshot file?
   +-- 4. Create empty LedgerState
   |
   v
Load Protocol Params from Genesis
   |
   v
RECONNECT LOOP (up to 100 retries, exponential backoff)
   |
   v
TCP Connect + Handshake (15s timeout)
   |
   v
Register Protocol Buffers
   |
   v
Start Background Tasks
   +-- Mux read_loop
   +-- KeepAlive (1s delay, 30s interval)
   |
   v
Find Intersection (ChainSync)
   |
   v
MAIN SYNC LOOP
   |
   +---> Request Next Header (ChainSync)
   |        |
   |        +-- RollBackward? --> Rollback VolatileDB
   |        |                     Reload checkpoint
   |        |                     Re-apply blocks
   |        |
   |        +-- RollForward? --> Decode header
   |                             Skip non-Conway
   |                             |
   |                             v
   |                        Fetch Block Body (BlockFetch)
   |                             |
   |                             v
   |                        Decode + Validate + Apply Block
   |                         (in executor to avoid blocking)
   |                             |
   |                             v
   |                        Store in VolatileDB
   |                        Graduate old blocks --> ImmutableDB
   |                        Periodic checkpoint --> LedgerDB
   |                        Update nonce state
   |                             |
   +----<------------------------+
   |
   v
On disconnect: save checkpoint, retry
   |
   v
OPTIONAL: Server Mode (RelayServer)
   +-- Accept inbound connections
   +-- Serve ChainSync headers
   +-- Serve BlockFetch blocks
   +-- Respond KeepAlive
   |
   v
OPTIONAL: Block Forging
   +-- Check slot leadership (VRF)
   +-- Select txs from mempool
   +-- Assemble + sign block
   +-- Propagate to peers
   |
   v
SHUTDOWN (SIGINT/SIGTERM)
   +-- Cancel all tasks
   +-- Close mux + TCP
   +-- Close databases
```

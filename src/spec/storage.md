# 13 Storage

The Bluematter storage layer manages block persistence, ledger state
checkpointing, and transaction buffering across three tiers. Blocks
flow from the network into volatile storage, graduate to immutable
storage once finalized, while ledger state snapshots enable crash
recovery without full chain replay.

**Notation.** B = bytes, N = naturals, H = B_32 (Blake2b-256 hash),
sigma = LedgerState. SQL schemas follow SQLite syntax. Map and List
types are written M[K, V] and L[T] respectively.

---

## 13.1 Storage Architecture

### 13.1.1 Three-Tier Model

```
                        network
                          |
                          v
                    +-----------+
                    | VolatileDB|   in-memory, fork-aware
                    +-----------+
                          |
                   graduation (slot < tip - 2000)
                          |
                          v
                    +------------+
                    | ImmutableDB|   SQLite, append-only
                    +------------+

                    +-----------+
                    |  LedgerDB |   SQLite, HMAC-authenticated
                    +-----------+
                          |
                    sigma checkpoints
```

| Tier       | Medium    | Mutability    | Purpose                         |
|------------|-----------|---------------|---------------------------------|
| VolatileDB | Memory    | Mutable       | Recent blocks subject to rollback|
| ImmutableDB| SQLite    | Append-only   | Finalized blocks (permanent)    |
| LedgerDB   | SQLite    | Replace       | Ledger state checkpoints        |

### 13.1.2 Block Lifecycle

```
1. Block arrives from network (BlockFetch)
2. Decoded, validated, applied to sigma
3. Stored in VolatileDB (indexed by hash and slot)
4. When volatile_db.count() > 100:
     cutoff <- current_slot - 2000
     graduated <- volatile_db.graduate(cutoff)
     for each block in graduated:
       immutable_db.append(block)
5. Block is now permanently stored and removed from volatile memory
```

---

## 13.2 VolatileDB

In-memory store for recent blocks within the security parameter
window. Supports fork tracking via multiple blocks per slot.

### 13.2.1 Data Types

```
VolatileBlock:
  slot         : N
  block_number : N
  block_hash   : H          (B_32)
  prev_hash    : H | null   (B_32 or null for genesis successor)
  raw          : B           (wire-format block bytes)
```

### 13.2.2 State

```
VolatileDB:
  k        : N                     -- security parameter (default 2160)
  _by_hash : M[H, VolatileBlock]   -- primary index
  _by_slot : M[N, L[H]]            -- slot -> list of block hashes (fork support)
```

The `_by_slot` index maps each slot to a **list** of block hashes,
supporting the case where multiple blocks exist at the same slot due
to forks. The last element in the list is the most recently added.

### 13.2.3 Operations

**add(block : VolatileBlock):**
```
  _by_hash[block.block_hash] <- block
  if block.slot not in _by_slot:
    _by_slot[block.slot] <- []
  hashes <- _by_slot[block.slot]
  if block.block_hash not in hashes:
    hashes.append(block.block_hash)
```

**get_by_hash(h : H) -> VolatileBlock | null:**
```
  return _by_hash[h]      -- null if absent
```

**get_by_slot(s : N) -> VolatileBlock | null:**
```
  hashes <- _by_slot[s]
  if hashes = null or hashes = []: return null
  return _by_hash[hashes[-1]]    -- last-added block at this slot
```

**get_all_at_slot(s : N) -> L[VolatileBlock]:**
```
  hashes <- _by_slot.get(s, [])
  return [_by_hash[h] | h in hashes, h in _by_hash]
```

**tip() -> VolatileBlock | null:**
```
  if _by_slot = {}: return null
  max_slot <- max(keys(_by_slot))
  hashes <- _by_slot[max_slot]
  if hashes = []: return null
  return _by_hash[hashes[-1]]
```

**rollback_to(s : N) -> L[VolatileBlock]:**

Remove all blocks with slot strictly greater than s. Returns removed
blocks in descending slot order (suitable for undo operations).

```
  removed <- []
  slots_to_remove <- sort_descending([s' | s' in keys(_by_slot), s' > s])
  for s' in slots_to_remove:
    hashes <- _by_slot.remove(s')
    for h in hashes:
      block <- _by_hash.remove(h)
      if block != null:
        removed.append(block)
  return removed
```

**graduate(up_to_slot : N) -> L[VolatileBlock]:**

Remove and return all blocks with slot less than or equal to
up_to_slot, in ascending slot order. These blocks are considered
finalized and ready for transfer to ImmutableDB.

```
  graduated <- []
  slots_to_remove <- sort_ascending([s' | s' in keys(_by_slot), s' <= up_to_slot])
  for s' in slots_to_remove:
    hashes <- _by_slot.remove(s')
    for h in hashes:
      block <- _by_hash.remove(h)
      if block != null:
        graduated.append(block)
  return graduated
```

**get_chain(tip_hash : H) -> L[VolatileBlock]:**

Trace the chain backward from a given tip hash following prev_hash
links. Returns blocks in chronological order (oldest first).

```
  chain <- []
  current <- _by_hash[tip_hash]
  while current != null:
    chain.append(current)
    if current.prev_hash = null: break
    current <- _by_hash[current.prev_hash]
  reverse(chain)
  return chain
```

**get_blocks_in_range(from_slot : N, to_slot : N) -> L[B]:**

Return raw block bytes for blocks with `from_slot < slot <= to_slot`,
sorted by slot ascending. Used for re-applying blocks after rollback.

```
  result <- []
  for s in sort_ascending(keys(_by_slot)):
    if s <= from_slot: continue
    if s > to_slot: break
    for h in _by_slot[s]:
      block <- _by_hash[h]
      if block != null:
        result.append(block.raw)
  return result
```

**count() -> N:**
```
  return |_by_hash|
```

---

## 13.3 ImmutableDB

Append-only persistent store for finalized blocks. Uses SQLite with
WAL journaling for concurrent read access during writes.

### 13.3.1 SQL Schema

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS blocks (
  slot         INTEGER PRIMARY KEY,
  block_number INTEGER NOT NULL,
  block_hash   BLOB    NOT NULL,
  raw          BLOB    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_block_hash ON blocks(block_hash);
```

The primary key on `slot` enforces uniqueness (one finalized block per
slot). The `block_hash` index enables O(log n) lookup by hash.

### 13.3.2 Operations

**append(slot : N, block_number : N, block_hash : H, raw : B):**

```
  INSERT INTO blocks (slot, block_number, block_hash, raw)
  VALUES (?, ?, ?, ?);
  COMMIT;
  -- Raises ValueError if slot already exists (IntegrityError)
```

**get_by_slot(slot : N) -> (N, H, B) | null:**

```
  SELECT block_number, block_hash, raw
  FROM blocks WHERE slot = ?
  -- Returns (block_number, block_hash, raw) or null
```

**get_by_hash(block_hash : H) -> (N, N, B) | null:**

```
  SELECT slot, block_number, raw
  FROM blocks WHERE block_hash = ?
  -- Returns (slot, block_number, raw) or null
```

**tip() -> (N, N, H) | null:**

```
  SELECT slot, block_number, block_hash
  FROM blocks
  ORDER BY slot DESC LIMIT 1
  -- Returns (slot, block_number, block_hash) or null if empty
```

**iter_blocks(from_slot : N, to_slot : N | null) -> Iterator[(N, N, H, B)]:**

```
  if to_slot != null:
    SELECT slot, block_number, block_hash, raw
    FROM blocks
    WHERE slot >= ? AND slot <= ?
    ORDER BY slot
  else:
    SELECT slot, block_number, block_hash, raw
    FROM blocks
    WHERE slot >= ?
    ORDER BY slot
  -- Yields (slot, block_number, block_hash, raw) tuples
```

**count() -> N:**

```
  SELECT COUNT(*) FROM blocks
```

### 13.3.3 Initialization

On construction with a file path, the database opens the SQLite file
(creating it if absent), enables WAL journal mode, and ensures the
schema exists. When constructed with `path = null`, an in-memory
database is used (suitable for testing).

---

## 13.4 LedgerDB

Persistent ledger state checkpoint store. Periodically serializes
the full LedgerState to SQLite, authenticated with HMAC-SHA256 to
prevent tampered checkpoint injection.

### 13.4.1 SQL Schema

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS checkpoints (
  slot       INTEGER PRIMARY KEY,
  epoch      INTEGER NOT NULL,
  utxo_count INTEGER NOT NULL,
  data       BLOB    NOT NULL,
  data_hash  TEXT
);
```

The `data` column stores the pickle-serialized LedgerState. The
`data_hash` column stores the HMAC-SHA256 authentication tag (32 raw
bytes for current format, or hex SHA-256 digest for legacy format).

### 13.4.2 HMAC Key Management

```
Key resolution priority:
  1. BLUEMATTER_HMAC_KEY environment variable (hex-encoded)
  2. ~/.bluematter/hmac.key file (raw bytes)
  3. Generate: secrets.token_bytes(32), persist to ~/.bluematter/hmac.key

_get_hmac_key() -> B_32:
  if env[BLUEMATTER_HMAC_KEY] exists:
    return hex_decode(env[BLUEMATTER_HMAC_KEY])
  if ~/.bluematter/hmac.key exists:
    return read_file(~/.bluematter/hmac.key)
  key <- random_bytes(32)
  write_file(~/.bluematter/hmac.key, key)
  return key
```

### 13.4.3 Authentication

```
_hmac_sign(data : B) -> B_32:
  return HMAC-SHA256(_get_hmac_key(), data)

_hmac_verify(data : B, expected_mac : B_32) -> Bool:
  return constant_time_compare(_hmac_sign(data), expected_mac)
```

### 13.4.4 Serialization

```
serialize(sigma : LedgerState) -> B:
  return pickle.dumps(sigma, protocol=HIGHEST_PROTOCOL)

deserialize(data : B) -> LedgerState:
  return pickle.loads(data)
```

### 13.4.5 Operations

**save_checkpoint(sigma : LedgerState, slot : N | null):**

```
  s    <- slot if slot != null else sigma.slot
  data <- serialize(sigma)
  mac  <- _hmac_sign(data)

  INSERT OR REPLACE INTO checkpoints
    (slot, epoch, utxo_count, data, data_hash)
  VALUES (s, sigma.epoch, |sigma.utxo|, data, mac);
  COMMIT;
```

**load_latest_checkpoint() -> (LedgerState, N) | null:**

```
  SELECT slot, data, data_hash
  FROM checkpoints
  ORDER BY slot DESC LIMIT 1

  if no row: return null
  sigma <- _verify_and_load(data, data_hash, slot)
  return (sigma, slot)
```

**load_checkpoint(slot : N) -> LedgerState | null:**

```
  SELECT data, data_hash
  FROM checkpoints WHERE slot = ?

  if no row: return null
  return _verify_and_load(data, data_hash, slot)
```

**load_checkpoint_before(s : N) -> (LedgerState, N) | null:**

```
  SELECT slot, data, data_hash
  FROM checkpoints
  WHERE slot <= ?
  ORDER BY slot DESC LIMIT 1

  if no row: return null
  sigma <- _verify_and_load(data, data_hash, slot)
  return (sigma, slot)
```

**list_checkpoints() -> L[(N, N, N)]:**

```
  SELECT slot, epoch, utxo_count
  FROM checkpoints
  ORDER BY slot
  -- Returns [(slot, epoch, utxo_count), ...]
```

**prune(keep_latest : N = 3) -> N:**

Remove old checkpoints, retaining only the `keep_latest` most recent.

```
  all_slots <- SELECT slot FROM checkpoints ORDER BY slot DESC
  if |all_slots| <= keep_latest: return 0
  to_remove <- all_slots[keep_latest..]
  DELETE FROM checkpoints WHERE slot IN (to_remove)
  COMMIT
  return |to_remove|
```

### 13.4.6 Integrity Verification

The `_verify_and_load` function supports two authentication formats
for backward compatibility:

```
_verify_and_load(data : B, mac : B | String | null, slot : N) -> LedgerState:
  if mac != null:
    if mac is B and |mac| = 32:
      -- Current format: HMAC-SHA256
      require _hmac_verify(data, mac)
        else raise ValueError("HMAC mismatch at slot {slot}")
    else if mac is String:
      -- Legacy format: SHA-256 hex digest
      actual <- sha256_hex(data)
      require actual = mac
        else raise ValueError("SHA-256 mismatch at slot {slot}")
  return deserialize(data)
```

---

## 13.5 Chain Validator

Sequential block validation pipeline for catch-up from a snapshot or
ImmutableDB. Decodes blocks, applies them to an advancing ledger state,
and tracks validation progress.

### 13.5.1 State

```
ChainValidator:
  state            : LedgerState
  blocks_applied   : N = 0
  last_block_hash  : H | null = null
  last_slot        : N = state.slot
  last_block_number: N = 0
```

### 13.5.2 Construction

```
from_snapshot(path, streaming=false) -> ChainValidator:
  sigma <- load_snapshot(path, streaming)
  return ChainValidator(sigma)
```

### 13.5.3 Block Application

```
apply_raw_block(block_bytes : B) -> ConwayBlock:
  block <- decode_block_from_wire(block_bytes)
  require block is ConwayBlock
  return apply_decoded_block(block)

apply_decoded_block(block : ConwayBlock) -> ConwayBlock:
  state <- apply_block(state, block)    -- may raise BlockValidationError
  blocks_applied += 1
  last_block_hash  <- block.block_hash
  last_slot        <- block.slot
  last_block_number <- block.block_number
  return block
```

### 13.5.4 Bulk Validation from ImmutableDB

```
validate_from_immutable_db(db, from_slot, to_slot, progress_interval=1000) -> N:
  count <- 0
  for (slot, block_number, block_hash, raw) in db.iter_blocks(from_slot, to_slot):
    apply_raw_block(raw)
    count += 1
    if count mod progress_interval = 0:
      log("Validated {count} blocks (slot {slot}, block {block_number})")
  return count
```

### 13.5.5 Bulk Validation from Files

```
validate_from_files(block_dir, pattern="*.cbor") -> N:
  files <- sort(glob(block_dir / pattern))
  count <- 0
  for f in files:
    raw <- read_file(f)
    apply_raw_block(raw)
    count += 1
  return count
```

---

## 13.6 Crash Recovery

On node startup, the system attempts to recover the most recent
consistent state without requiring a full chain replay.

### 13.6.1 Recovery Sequence

```
initialize_state(initial_state, snapshot_path, genesis_dir, ledger_db):

  -- Priority 1: Caller-provided state
  if initial_state != null:
    sigma <- initial_state

  -- Priority 2: LedgerDB checkpoint (crash recovery)
  else:
    cp <- ledger_db.load_latest_checkpoint()
    if cp != null:
      (sigma, cp_slot) <- cp
      log("Resumed from checkpoint at slot {cp_slot}")

  -- Priority 3: Snapshot file
  else if snapshot_path != null:
    sigma <- load_snapshot(snapshot_path)
    log("Snapshot loaded: epoch={sigma.epoch}, UTxO={|sigma.utxo|}")

  -- Priority 4: Empty state with genesis params
  else:
    sigma <- LedgerState()
    if genesis_dir != null:
      sigma.protocol_params <- parse_protocol_params(
        genesis_dir/shelley-genesis.json,
        genesis_dir/alonzo-genesis.json,
        genesis_dir/conway-genesis.json
      )

  return sigma
```

### 13.6.2 Rollback Recovery

When a ChainSync MsgRollBackward is received during live sync:

```
handle_rollback(rb_slot):
  -- 1. Capture blocks that may need replay
  replay_blocks <- volatile_db.get_blocks_in_range(0, rb_slot)

  -- 2. Truncate volatile storage past the rollback point
  volatile_db.rollback_to(rb_slot)

  -- 3. Restore ledger state from closest checkpoint
  cp <- ledger_db.load_checkpoint_before(rb_slot)
  if cp != null:
    (sigma, cp_slot) <- cp

    -- 4. Re-apply blocks between checkpoint and rollback point
    for block_bytes in replay_blocks:
      block <- decode_block_from_wire(block_bytes)
      if block is ConwayBlock
         and block.slot > cp_slot
         and block.slot <= rb_slot:
        sigma <- apply_block(sigma, block)
```

### 13.6.3 Checkpoint Discipline

```
Checkpoint frequency: every checkpoint_interval blocks (default 50)

if blocks_synced mod checkpoint_interval = 0:
  ledger_db.save_checkpoint(sigma)

Before reconnection after error:
  if sigma.slot > 0:
    ledger_db.save_checkpoint(sigma)
```

---

## 13.7 Mempool

Bounded transaction pool holding unconfirmed transactions awaiting
inclusion in a block. Thread-safe for concurrent access from the
network layer and the block forging pipeline.

### 13.7.1 State

```
Mempool:
  max_count    : N = 10,000
  max_bytes    : N = 50,000,000    (50 MiB)
  _lock        : Mutex
  _txs         : OrderedDict[H, B]    -- tx_hash -> raw CBOR, insertion order
  _total_bytes : N = 0
```

The OrderedDict preserves insertion order for FIFO eviction semantics.

### 13.7.2 Admission Control

**add(tx_id : H, tx_cbor : B):**

```
  acquire _lock:
    if tx_id in _txs: return     -- idempotent

    tx_size <- |tx_cbor|

    -- Evict oldest until space is available
    while _total_bytes + tx_size > max_bytes
       or |_txs| >= max_count:
      if _txs = {}:
        raise MempoolFull("cannot fit {tx_size}B tx")
      (evicted_id, evicted_cbor) <- _txs.pop_first()     -- FIFO
      _total_bytes -= |evicted_cbor|

    _txs[tx_id] <- tx_cbor
    _total_bytes += tx_size
```

### 13.7.3 Removal

**remove(tx_id : H) -> Bool:**

```
  acquire _lock:
    if tx_id in _txs:
      _total_bytes -= |_txs[tx_id]|
      delete _txs[tx_id]
      return true
    return false
```

**remove_confirmed(tx_ids : Set[H]) -> N:**

Bulk removal of transactions confirmed in a newly applied block.

```
  removed <- 0
  acquire _lock:
    for tx_id in tx_ids:
      if tx_id in _txs:
        _total_bytes -= |_txs[tx_id]|
        delete _txs[tx_id]
        removed += 1
  return removed
```

### 13.7.4 Queries

**get_tx_ids() -> L[H]:**

```
  acquire _lock:
    return list(keys(_txs))    -- in insertion order
```

**get_tx(tx_id : H) -> B | null:**

```
  acquire _lock:
    return _txs[tx_id]         -- null if absent
```

**has_tx(tx_id : H) -> Bool:**

```
  acquire _lock:
    return tx_id in _txs
```

**count() -> N:**

```
  acquire _lock:
    return |_txs|
```

**total_bytes() -> N:**

```
  acquire _lock:
    return _total_bytes
```

**snapshot() -> L[(H, B)]:**

Returns a consistent snapshot of all transactions for external
consumers (e.g., block forging, TxSubmission2).

```
  acquire _lock:
    return list(items(_txs))    -- [(tx_id, tx_cbor), ...]
```

**clear():**

```
  acquire _lock:
    _txs.clear()
    _total_bytes <- 0
```

### 13.7.5 Revalidation

When the chain tip advances, mempool transactions whose inputs have
been consumed must be evicted:

```
revalidate(sigma : LedgerState):
  for (tx_id, tx_cbor) in snapshot():
    if any input of tx not in sigma.utxo:
      remove(tx_id)
```

### 13.7.6 Capacity Bounds

| Parameter | Value         |
|-----------|---------------|
| max_count | 10,000 txs    |
| max_bytes | 50,000,000 B  |
| Eviction  | FIFO (oldest) |

### 13.7.7 Thread Safety

All public operations acquire a threading.Lock before accessing shared
state. This ensures correctness when the mempool is accessed
concurrently from:

- Network threads (TxSubmission2 adding new transactions)
- Validation threads (block application removing confirmed transactions)
- Forging threads (snapshotting transactions for block assembly)

---

## 13.8 Summary of SQL Schemas

### ImmutableDB

```sql
CREATE TABLE blocks (
  slot         INTEGER PRIMARY KEY,
  block_number INTEGER NOT NULL,
  block_hash   BLOB    NOT NULL,
  raw          BLOB    NOT NULL
);
CREATE INDEX idx_block_hash ON blocks(block_hash);
```

### LedgerDB

```sql
CREATE TABLE checkpoints (
  slot       INTEGER PRIMARY KEY,
  epoch      INTEGER NOT NULL,
  utxo_count INTEGER NOT NULL,
  data       BLOB    NOT NULL,
  data_hash  TEXT
);
```

Both databases use `PRAGMA journal_mode = WAL` for write-ahead logging,
enabling concurrent readers during writes without blocking.

---
---
# Consensus

## Overview

The `consensus/` package implements the Ouroboros Praos consensus protocol for the Bluematter Cardano node. It is responsible for:

- **Header validation** -- verifying that incoming block headers satisfy slot monotonicity, hash chaining, VRF proofs, KES signatures, operational certificates, leader eligibility, and body integrity checks.
- **Leader election verification** -- determining whether a stake pool was legitimately elected as slot leader using VRF output and stake-proportional thresholds with exact arithmetic.
- **Nonce evolution** -- maintaining the evolving, candidate, and epoch nonces that drive the per-epoch leader schedule, including the stability window freeze and epoch boundary transition (TICKN rule).
- **Chain selection** -- choosing the best chain tip among competing candidates using highest-block-number preference with rollback depth limits bounded by the security parameter k.
- **Hard Fork Combinator (HFC)** -- era detection and dispatch for the multi-era Cardano chain, mapping wire-format era tags to the `CardanoEra` enum.

All cryptographic operations use pure-Python implementations: `crypto.vrf` (ECVRF-ED25519-SHA512-Elligator2, draft-03), `crypto.kes` (Sum6KES verify-only), `crypto.ed25519` (pynacl), and `crypto.hash` (Blake2b via hashlib).

---

## Files

### `consensus/__init__.py`

Empty package marker. No exports.

---

### `consensus/constants.py`

Named constants for Ouroboros consensus parameters.

| Constant | Value | Meaning |
|---|---|---|
| `SLOTS_PER_KES_PERIOD` | 129,600 | Slots per KES key period (mainnet) |
| `SECURITY_PARAM_K` | 2,160 | Security parameter k -- max rollback depth |
| `ACTIVE_SLOT_COEFF_DENOM` | 20 | Denominator for f = 1/20 = 0.05 |
| `EXPECTED_BLOCKS_FALLBACK` | 21,600 | floor(432000 / 20) -- expected blocks per epoch |

---

### `consensus/header.py`

Block header validation for Ouroboros Praos. Contains the central `validate_header()` function and helpers.

**Key functions:**

- `validate_header(header, prev_hash, prev_slot, prev_block_number, ...) -> list[str]` -- Header validation (see breakdown below).
- `_verify_operational_cert(opcert, issuer_vkey) -> list[str]` -- Verifies the Ed25519 cold-key signature over `hot_vkey || seq_no(8 bytes BE) || kes_period(8 bytes BE)`.
- `compute_pool_id(issuer_vkey: bytes) -> bytes` -- Returns `blake2b_224(issuer_vkey)`.
- `verify_block_hash(header: ConwayHeader) -> bool` -- Checks `header.block_hash == blake2b_256(header.raw)`.

---

### `consensus/leader.py`

VRF-based slot leader eligibility using exact `Fraction` arithmetic.

**Key functions:**

- `is_slot_leader(pool_vrf_sk, pool_sigma, slot, epoch_nonce, active_slot_coeff) -> tuple[bool, bytes, bytes]` -- Checks if a pool is leader for a slot (proving side). Returns `(is_leader, vrf_proof, vrf_output)`.
- `verify_slot_leader(pool_vrf_pk, pool_sigma, slot, epoch_nonce, vrf_proof, active_slot_coeff) -> bool` -- Verifies that a pool was legitimately the leader (verification side).
- `leader_threshold(sigma: float, f: float) -> float` -- Float-precision threshold computation for backward compatibility.
- `_leader_threshold_exact(sigma: Fraction, f: Fraction) -> Fraction` -- Exact-arithmetic threshold using Python `Decimal` with 200-digit precision (~660 bits), well beyond the 512-bit comparison boundary.

---

### `consensus/nonce.py`

Epoch nonce evolution implementing the UPDN and TICKN rules from the Shelley formal specification.

**Key types:**

- `NonceState` -- Dataclass tracking `evolving_nonce`, `candidate_nonce`, `epoch_nonce`, `extra_entropy`, `stability_window` (default 129,600), and `epoch_length` (default 432,000).

**Key functions:**

- `tagged_nonce_from_vrf_output(raw_vrf_output: bytes) -> bytes` -- Computes `blake2b_256(b"\x4e" + raw_vrf_output)` (the `"N"` prefix tag). Equivalent to `vrf_output_to_nonce` from `crypto.vrf`.
- `evolve_nonce(state: NonceState, vrf_nonce_output: bytes) -> bytes` -- Per-block update: `eta_v' = blake2b_256(eta_v || blake2b_256(tagged_value))`. The double-hash is the "range extension" step matching Amaru's implementation.
- `snapshot_candidate_nonce(state: NonceState) -> None` -- Sets `eta_c = eta_v`.
- `update_nonce_for_block(state, vrf_nonce_output, slot, epoch) -> None` -- Full UPDN rule: evolves eta_v, and conditionally updates eta_c based on whether the slot is before or after the stability window boundary.
- `tick_nonce(state, prev_block_hash, extra_entropy) -> None` -- TICKN rule at epoch boundary: `epoch_nonce' = blake2b_256(eta_c || eta_h || eta_e)`.
- `hash_nonce(a: bytes, b: bytes) -> bytes` -- Combines two nonces: `blake2b_256(a || b)`.
- `mk_nonce(seed: bytes) -> bytes` -- Creates a nonce from a seed: `blake2b_256(seed)`.

**Constant:**

- `NEUTRAL_NONCE = b"\x00" * 32` -- 32 zero bytes, used as default/absent nonce.

---

### `consensus/chain_selection.py`

Fork choice rule and intersect point computation for ChainSync.

**Key types:**

- `ChainCandidate` -- Frozen dataclass: `tip_hash`, `tip_block_number`, `tip_slot`, `peer_id`.
- `RollbackLimitExceeded` -- Exception raised when rollback exceeds security parameter k.

**Key functions:**

- `select_best_chain(candidates: list[ChainCandidate]) -> ChainCandidate | None` -- Returns the candidate with the highest `(block_number, slot)`. Returns `None` if empty.
- `should_switch(current, candidate, security_param, intersection_block_no) -> bool` -- Decides whether to adopt a candidate chain, with rollback depth bounded by k.
- `validate_rollback_depth(current_block_number, rollback_slot, rollback_block_number, security_param) -> None` -- Raises `RollbackLimitExceeded` if depth exceeds k.
- `compute_intersect_points(volatile_db: VolatileDB) -> list[Point]` -- Builds exponentially-spaced points `[tip, tip-1, tip-2, tip-4, tip-8, ..., origin]` for ChainSync FindIntersect.

---

### `consensus/hfc.py`

Hard Fork Combinator -- era detection and dispatch.

**Key types:**

- `CardanoEra(IntEnum)` -- BYRON=0, SHELLEY=1, ALLEGRA=2, MARY=3, ALONZO=4, BABBAGE=5, CONWAY=6.
- `EraTransition` -- Dataclass recording `from_era`, `to_era`, `at_slot`, `at_epoch`.
- `HardForkState` -- Tracks `current_era` and `transitions` history.

**Key methods on `HardForkState`:**

- `header_era(ns7_tag: int) -> CardanoEra` -- Maps ChainSync header ns7 tag to era.
- `block_era(wire_tag: int) -> CardanoEra` -- Maps block wire format tag to era.
- `is_conway(ns7_tag: int) -> bool` -- Returns `ns7_tag == 6`.
- `is_supported(ns7_tag: int) -> bool` -- Returns `ns7_tag == 6` (only Conway is fully validated; pre-Conway blocks accepted but not validated).
- `record_transition(from_era, to_era, slot, epoch) -> None` -- Logs and records an era transition.

**Constants:**

- `BLOCK_ERA_TAG` -- `{2: SHELLEY, 3: ALLEGRA, ..., 7: CONWAY}` (Byron has no era wrapper).
- `HEADER_ERA_TAG` -- `{0: BYRON, 1: SHELLEY, ..., 6: CONWAY}`.
- `PREPROD_ERA_BOUNDARIES` -- Known approximate slot numbers for each era on preprod.
- `MAINNET_ERA_BOUNDARIES` -- Known approximate slot numbers for each era on mainnet.

---

## Header Validation

`validate_header()` in `consensus/header.py` performs the following checks, returning a list of error strings (empty means valid):

```python
def validate_header(
    header: ConwayHeader,
    prev_hash: bytes | None,
    prev_slot: int,
    prev_block_number: int,
    pool_vrf_keys: dict[bytes, bytes] | None = None,
    epoch_nonce: bytes | None = None,
    slots_per_kes_period: int = 129_600,
    max_kes_evolutions: int = 62,
    last_opcert_sequence: dict[bytes, int] | None = None,
    pool_sigmas: dict[bytes, float] | None = None,
    active_slot_coeff: float | None = None,
    actual_body_size: int | None = None,
    actual_body_hash: bytes | None = None,
    max_major_protocol_version: int | None = None,
) -> list[str]
```

### Check 1: Slot Monotonicity

Verifies `header_body.slot > prev_slot`. Rejects blocks that do not advance the slot counter.

### Check 2: Block Number Monotonicity

Verifies `header_body.block_number == prev_block_number + 1`. Ensures contiguous block numbering.

### Check 3: Previous Hash Chain

When `prev_hash` is provided, verifies `header_body.prev_hash == prev_hash`. Maintains the hash chain linking each block to its predecessor.

### Check 4: Operational Certificate Verification

Delegates to `_verify_operational_cert(opcert, issuer_vkey)` which:
- Validates the opcert is an `OperationalCert` instance.
- Reconstructs the signed message: `hot_vkey || sequence_number(8-byte BE) || kes_period(8-byte BE)`.
- Verifies the Ed25519 signature (`opcert.sigma`) using the pool's cold key (`issuer_vkey`).

### Check 5: Issuer Pool Registration and VRF Key Match

When `pool_vrf_keys` is provided:
- Computes `pool_id = blake2b_224(issuer_vkey)`.
- Checks the pool ID exists in the registered pool set.
- Verifies the header's `vrf_vkey` matches the pool's registered VRF key.

### Check 6: VRF Proof Verification and Leader Eligibility

When `epoch_nonce` is provided:
- Computes VRF input: `alpha = blake2b_256(slot_as_8_byte_BE || epoch_nonce)`.
- Calls `vrf_verify(vrf_vkey, vrf_proof, alpha)` to verify the VRF proof and recover `beta`.
- Checks the declared VRF output in the header matches the computed `beta`.
- **Leader eligibility (CON-C4)**: When `pool_sigmas` and `active_slot_coeff` are provided:
  - Computes `leader_output = vrf_output_to_leader(beta)` (tagged: `blake2b_256("L" || beta)`).
  - Computes `vrf_value = int(leader_output) / 2^256` as a `Fraction`.
  - Computes threshold via `_leader_threshold_exact(sigma, f)`.
  - Rejects if `vrf_value >= threshold`.

### Check 7: KES Signature Verification

When `slots_per_kes_period > 0` and the body signature is present:
- Computes `slot_kes_period = slot // slots_per_kes_period`.
- Computes `kes_period_offset = slot_kes_period - opcert.kes_period`.
- Rejects if offset is negative or `>= max_kes_evolutions` (62 on mainnet).
- Calls `kes_verify(kes_period_offset, opcert.hot_vkey, header_body.raw, body_signature)`.
- **Opcert sequence number (CON-H1)**: When `last_opcert_sequence` is provided, rejects replay (sequence number < last seen for that pool). Gaps are allowed; only strict replay is rejected.

### Check 8: Body Size Cross-Check (CON-H4)

When `actual_body_size` is provided, verifies `header_body.block_body_size == actual_body_size`.

### Check 9: Body Hash Cross-Check (CON-H4)

When `actual_body_hash` is provided, verifies `header_body.block_body_hash == actual_body_hash`.

### Check 10: Protocol Version Check (CON-M5)

When `max_major_protocol_version` is provided, rejects headers whose `protocol_version[0]` exceeds the maximum allowed major version.

---

## Leader Election

Ouroboros Praos leader election is a private lottery: each stake pool independently evaluates a VRF to determine if it is the slot leader.

### VRF Input Construction

```
alpha = blake2b_256(slot.to_bytes(8, "big") + epoch_nonce)
```

The slot is encoded as an 8-byte big-endian integer, concatenated with the 32-byte epoch nonce, then hashed with Blake2b-256 to produce the 32-byte VRF input. This follows the Praos specification and matches Amaru's `vrf/mod.rs Input::new`.

### VRF Output to Leader Value

The raw VRF output (`beta`, 64 bytes) is converted to a 32-byte leader value using a tagged hash:

```
leader_value = blake2b_256(b"L" + beta)
```

This is implemented in `crypto.vrf.vrf_output_to_leader()`. The `"L"` prefix distinguishes leader derivation from nonce derivation (which uses `"N"`).

### Threshold Computation

The Praos leader threshold determines the probability that a pool with relative stake `sigma` is elected in a given slot:

```
threshold = 1 - (1 - f)^sigma
```

Where:
- `f` = active slot coefficient (e.g., 0.05 on mainnet, meaning ~5% of slots produce blocks)
- `sigma` = pool's stake fraction (pool_stake / total_active_stake), clamped to [0, 1]

A pool is the slot leader if:

```
int.from_bytes(leader_value, "big") / 2^256 < threshold
```

### Exact Arithmetic

The threshold comparison uses Python's `Fraction` type to avoid floating-point precision loss at the decision boundary. The `_leader_threshold_exact()` function internally uses `Decimal` with 200-digit precision (~660 bits) to compute `(1 - f)^sigma` for fractional `sigma`, then converts back to `Fraction` with a denominator limit of `2^520`.

```python
def _leader_threshold_exact(sigma: Fraction, f: Fraction) -> Fraction:
    # Uses Decimal with 200-digit precision for (1-f)^sigma
    # Returns Fraction for exact comparison with VRF value
```

### Key Functions

**Proving side** (`is_slot_leader`):
```python
def is_slot_leader(
    pool_vrf_sk: bytes,       # VRF signing key
    pool_sigma: float,         # Pool's relative stake
    slot: int,                 # Slot number
    epoch_nonce: bytes,        # Current epoch nonce (32 bytes)
    active_slot_coeff: float = 0.05,
) -> tuple[bool, bytes, bytes]:  # (is_leader, vrf_proof, raw_beta)
```

**Verification side** (`verify_slot_leader`):
```python
def verify_slot_leader(
    pool_vrf_pk: bytes,        # VRF verification key
    pool_sigma: float,         # Pool's relative stake
    slot: int,                 # Slot number
    epoch_nonce: bytes,        # Current epoch nonce (32 bytes)
    vrf_proof: bytes,          # VRF proof from the block header
    active_slot_coeff: float = 0.05,
) -> bool:
```

---

## Nonce Evolution

The nonce system ensures that each epoch's leader schedule is unpredictable before the epoch begins but deterministic once the epoch nonce is established.

### NonceState

```python
@dataclass
class NonceState:
    evolving_nonce: bytes       # eta_v -- updated every block
    candidate_nonce: bytes      # eta_c -- freezes at stability window
    epoch_nonce: bytes          # drives current epoch's leader schedule
    extra_entropy: bytes | None # from protocol parameter updates
    stability_window: int       # default 129,600 (= 3k/f on mainnet)
    epoch_length: int           # default 432,000 slots
```

### Per-Block Update (UPDN Rule)

For each new block, `update_nonce_for_block()` applies:

1. Compute the tagged nonce value from the VRF output: `tagged = blake2b_256("N" || raw_beta)`.
2. "Range extension" hash: `vrf_hash = blake2b_256(tagged)`.
3. Evolve: `eta_v' = blake2b_256(eta_v || vrf_hash)`.
4. If the slot is **before** the stability window boundary: `eta_c = eta_v'` (candidate tracks evolving).
5. If the slot is **after** the stability window boundary: `eta_c` remains frozen.

The stability boundary is computed as:

```
stability_boundary = epoch_start + epoch_length - stability_window
```

Where `epoch_start = epoch * epoch_length`.

### Epoch Boundary (TICKN Rule)

At each epoch transition, `tick_nonce()` computes the new epoch nonce:

```
epoch_nonce' = blake2b_256(eta_c || eta_h || eta_e)
```

Where:
- `eta_c` = candidate nonce (frozen since the stability window)
- `eta_h` = hash of the last block in the previous epoch (or `NEUTRAL_NONCE` if absent)
- `eta_e` = extra entropy from protocol parameters (or `NEUTRAL_NONCE` if absent)

The evolving and candidate nonces are **not** reset at the epoch boundary -- they continue accumulating across epochs per the Shelley formal specification.

### Tagged Derivation Functions

Two distinct 32-byte values are derived from the raw 64-byte VRF beta:

| Purpose | Tag | Function |
|---|---|---|
| Leader election | `"L"` (0x4c) | `vrf_output_to_leader(beta) = blake2b_256(b"L" + beta)` |
| Nonce evolution | `"N"` (0x4e) | `tagged_nonce_from_vrf_output(beta) = blake2b_256(b"\x4e" + beta)` |

---

## Chain Selection

Bluematter implements basic Praos chain selection (longest chain wins). Full Ouroboros Genesis density-based selection is noted as future work.

### `select_best_chain`

```python
def select_best_chain(candidates: list[ChainCandidate]) -> ChainCandidate | None
```

Returns the candidate with the highest `(tip_block_number, tip_slot)`. Ties are broken by highest slot, then first seen (stable sort via `max`). Returns `None` for empty input.

### `should_switch`

```python
def should_switch(
    current: ChainCandidate | None,
    candidate: ChainCandidate,
    security_param: int = 2160,
    intersection_block_no: int | None = None,
) -> bool
```

Decision rules:
1. If `current` is `None` (no chain), always switch.
2. If `candidate.tip_block_number <= current.tip_block_number`, do not switch.
3. If `intersection_block_no` is provided, compute rollback depth = `current.tip_block_number - intersection_block_no`. Reject if depth exceeds `security_param` (k=2160).

### `compute_intersect_points`

```python
def compute_intersect_points(volatile_db: VolatileDB) -> list[Point]
```

Builds exponentially-spaced intersect points from the volatile database for ChainSync FindIntersect:

```
[tip, tip-1, tip-2, tip-4, tip-8, tip-16, ..., origin]
```

This logarithmic spacing allows efficient intersection discovery with O(log n) points regardless of chain length.

### `validate_rollback_depth`

```python
def validate_rollback_depth(
    current_block_number: int,
    rollback_slot: int,
    rollback_block_number: int,
    security_param: int = 2160,
) -> None  # Raises RollbackLimitExceeded
```

---

## Hard Fork Combinator

The HFC manages Cardano's multi-era chain. Bluematter starts from a Conway-era snapshot and only fully validates Conway blocks. Pre-Conway blocks are accepted as opaque data.

### Era Tag Mapping

**Block wire format** (outer CBOR array `[era_tag, block_data]`):

| Era | Wire Tag |
|---|---|
| Byron | bare (no wrapper) |
| Shelley | 2 |
| Allegra | 3 |
| Mary | 4 |
| Alonzo | 5 |
| Babbage | 6 |
| Conway | 7 |

**ChainSync header ns7** (`[ns7_tag, header_data]`):

| Era | ns7 Tag |
|---|---|
| Byron | 0 |
| Shelley | 1 |
| Allegra | 2 |
| Mary | 3 |
| Alonzo | 4 |
| Babbage | 5 |
| Conway | 6 |

Note the offset: Byron blocks have no era wrapper in the block format but use tag 0 in the header format. Shelley is tag 2 in blocks but tag 1 in headers.

### Known Era Boundaries

**Preprod:**

| Era | Start Slot |
|---|---|
| Byron | 0 |
| Shelley | 84,844 |
| Allegra | 518,400 |
| Mary | 950,400 |
| Alonzo | 16,588,800 |
| Babbage | 62,510,400 |
| Conway | 70,416,000 |

**Mainnet:**

| Era | Start Slot |
|---|---|
| Byron | 0 |
| Shelley | 4,492,800 |
| Allegra | 16,588,800 |
| Mary | 23,068,800 |
| Alonzo | 39,916,975 |
| Babbage | 72,316,896 |
| Conway | 107,654,400 |

---

## Diagram: Nonce Lifecycle

```
Epoch N (epoch_length = 432,000 slots, stability_window = 129,600 slots):
+================================================================+
|                                                                |
|  Slot 0          stability_boundary         epoch_length       |
|  |                    |                          |             |
|  v                    v                          v             |
|  +--------------------+--------------------------+             |
|  | BEFORE stability   | AFTER stability window   |             |
|  | window             | (last 129,600 slots)     |             |
|  |                    |                          |             |
|  | eta_v evolves      | eta_v evolves            |             |
|  | eta_c = eta_v      | eta_c FROZEN             |             |
|  +--------------------+--------------------------+             |
|                                                                |
|  stability_boundary = epoch_start + 432,000 - 129,600          |
|                     = epoch_start + 302,400                    |
+================================================================+

Per-block nonce update (UPDN rule):
  1. tagged_nonce = blake2b_256("N" || raw_vrf_beta)   [32 bytes]
  2. vrf_hash     = blake2b_256(tagged_nonce)           [range extension]
  3. eta_v'       = blake2b_256(eta_v || vrf_hash)      [evolve]
  4. if slot < stability_boundary:
       eta_c = eta_v'                                   [candidate tracks]

Epoch N -> N+1 boundary (TICKN rule):
  epoch_nonce' = blake2b_256(eta_c || last_block_hash || extra_entropy)

  Note: eta_v and eta_c are NOT reset -- they carry across boundaries.
  The new epoch_nonce is used for leader election in epoch N+1.

Leader election uses epoch_nonce:
  alpha       = blake2b_256(slot_BE64 || epoch_nonce)
  (ok, proof) = vrf_prove(sk, alpha)
  beta        = vrf_proof_to_hash(proof)              [64 bytes]
  leader_val  = blake2b_256("L" || beta)              [32 bytes]
  nonce_val   = blake2b_256("N" || beta)              [32 bytes]

  Pool is leader if: leader_val / 2^256 < 1 - (1-f)^sigma
```

---
---
# Consensus

This section specifies the Ouroboros Praos consensus layer as implemented
by Bluematter. It covers slot leader election, epoch nonce evolution,
block header validation, chain selection, and KES key lifecycle.

## Notation

| Symbol | Meaning |
|--------|---------|
| H_256(x) | Blake2b-256 hash of x |
| H_224(x) | Blake2b-224 hash of x |
| B_n | Byte string of exactly n bytes |
| N | Natural number |
| f | Active slot coefficient (mainnet: 0.05) |
| k | Security parameter (mainnet: 2160) |
| sigma | Pool relative stake (pool_stake / total_active_stake) |
| eta | Nonce state tuple |
| s | Slot number |
| epsilon | Epoch number |
| VRF_prove(sk, alpha) | ECVRF prove under secret key sk on input alpha |
| VRF_verify(pk, pi, alpha) | ECVRF verify proof pi under public key pk |
| Ed25519_Verify(vk, sig, msg) | Ed25519 signature verification |
| KES_verify(pk, period, msg, sig) | Sum6KES signature verification |

---

## 10.1 Praos Leader Election

### 10.1.1 VRF Ciphersuite

Cardano uses **ECVRF-ED25519-SHA512-Elligator2** with suite string `0x03`
(IETF draft-irtf-cfrg-vrf-03). This is distinct from draft-06 (`0x04`).
The choice of draft-03 is a protocol-level constant and cannot be changed
without a hard fork.

```
SUITE_STRING = 0x03
```

The VRF operates over the Ed25519 curve with:
- Prime: p = 2^255 - 19
- Group order: q = 2^252 + 27742317777372353535851937790883648493
- Cofactor: h = 8

**Security properties.** Small-order points (those in the torsion subgroup,
where 8*P = identity) are rejected on decode. Proof scalars s >= q are
rejected. These checks prevent related-key attacks and proof malleability.

### 10.1.2 VRF Input Construction

The VRF input binds the slot number to the epoch nonce, producing a
unique unpredictable challenge for each slot:

```
alpha(s, eta_0) = H_256(s_BE64 || eta_0)
```

where `s_BE64` is the slot number encoded as an 8-byte big-endian integer,
and `eta_0` is the current epoch nonce (32 bytes).

### 10.1.3 VRF Evaluation

Given a pool's VRF secret key `vrf_sk` and the alpha input:

```
(beta, pi) = VRF_prove(vrf_sk, alpha)
```

where:
- `pi` in B_80 is the proof (gamma point + challenge + scalar)
- `beta` in B_64 is the raw VRF output: SHA-512(SUITE_STRING || 0x03 || encode(h * gamma))

The proof structure is:
```
pi = encode_point(gamma) || c_LE128 || s_LE256
```
where gamma is 32 bytes (compressed Edwards point), c is 16 bytes (little-endian),
and s is 32 bytes (little-endian).

### 10.1.4 Tagged Derivations

Cardano does not use the raw 64-byte VRF output directly. Instead, it
derives two domain-separated 32-byte values:

```
leader_value(beta) = H_256(0x4c || beta)     -- "L" = 0x4c
nonce_value(beta)  = H_256(0x4e || beta)     -- "N" = 0x4e
```

The tag byte is the ASCII encoding of "L" and "N" respectively. Both
derivations produce 32-byte (256-bit) values.

**Rationale.** Domain separation ensures the leader-check value and
the nonce-evolution value are cryptographically independent. Even if
an adversary could bias one, it would not affect the other.

### 10.1.5 Leader Threshold

The Praos leader threshold function maps a pool's relative stake
to a probability of being elected leader in any given slot:

```
phi_f(sigma) = 1 - (1 - f)^sigma
```

where:
- `f` is the active slot coefficient (probability that a slot has at least one leader)
- `sigma` = pool_stake / total_active_stake, clamped to [0, 1]

**Properties:**
- `phi_f(0) = 0` (no stake, never elected)
- `phi_f(1) = f` (all stake, elected with probability f)
- `phi_f` is monotonically increasing and concave
- The expected number of leaders per slot across all pools is approximately f

### 10.1.6 Leader Eligibility

A pool is the slot leader if and only if its tagged leader value falls
below the threshold:

```
is_leader(s, pool) <=> int_BE(leader_value(beta)) / 2^256 < phi_f(sigma_pool)
```

where `int_BE` interprets the 32-byte leader value as a big-endian
unsigned integer.

**Why this works.** The VRF makes leader election private: no one can
determine who the leader is until the leader reveals the VRF proof in
the block header. The VRF output is uniformly distributed over [0, 2^256),
so dividing by 2^256 yields a uniform value in [0, 1). The threshold
`phi_f(sigma)` ensures the probability of election is proportional to
stake, and the total expected number of leaders per slot equals f.

**Implementation note.** The comparison uses exact arithmetic (Python
`Fraction` with `Decimal` intermediate at 200-digit precision) to avoid
floating-point rounding at the threshold boundary. The result is
converted to a `Fraction` with denominator limit 2^520, providing
precision well beyond the 256-bit comparison.

```python
# Exact threshold computation
def leader_threshold_exact(sigma: Fraction, f: Fraction) -> Fraction:
    # Uses Decimal with 200-digit precision (~660 bits)
    d_result = 1 - (1 - d_f) ** d_sigma
    return Fraction(d_result).limit_denominator(2**520)
```

### 10.1.7 VRF Verification (Block Consumer)

A node verifying a received block performs:

```
verify_slot_leader(vrf_pk, sigma, s, eta_0, pi):
  alpha = H_256(s_BE64 || eta_0)
  (valid, beta) = VRF_verify(vrf_pk, pi, alpha)
  if not valid: return False
  lv = H_256(0x4c || beta)
  return int_BE(lv) / 2^256 < phi_f(sigma)
```

---

## 10.2 Nonce Evolution

The epoch nonce drives VRF-based leader eligibility. It evolves
block-by-block and stabilizes before each epoch boundary to ensure
the leader schedule for the next epoch is determined in advance.

### 10.2.1 Nonce State

```
eta = (eta_0, eta_v, eta_c, eta_e)
```

| Component | Description |
|-----------|-------------|
| eta_0 | Epoch nonce: fixed for the current epoch, used in VRF input |
| eta_v | Evolving nonce: updated every block |
| eta_c | Candidate nonce: tracks eta_v, freezes at stability window |
| eta_e | Extra entropy: from protocol parameter update, usually 0^32 |

Initial state (neutral): all components = `0x00 * 32`.

### 10.2.2 Per-Block Update (UPDN Rule)

Given a new block at slot s in epoch epsilon with raw VRF output beta:

```
UPDN(eta, beta, s, epsilon):
  -- Step 1: Tagged nonce derivation
  tagged = H_256(0x4e || beta)                    -- "N"-tagged, 32 bytes

  -- Step 2: Range extension
  extended = H_256(tagged)                         -- 32 bytes

  -- Step 3: Evolve
  eta_v' = H_256(eta_v || extended)

  -- Step 4: Stability window check
  stability_slot = epsilon * epoch_length + (epoch_length - stability_window)

  if s < stability_slot:
    eta_c' = eta_v'                                -- candidate tracks evolving
  else:
    eta_c' = eta_c                                 -- candidate frozen

  return (eta_0, eta_v', eta_c', eta_e)
```

The **stability window** is the last `k * 3 / f` slots of each epoch
(mainnet: `2160 * 3 / 0.05 = 129,600` slots). Once slot s reaches
`epoch_start + epoch_length - stability_window`, the candidate nonce
freezes. This ensures the next epoch's nonce is determined `k` blocks
before the epoch ends, preventing adversarial nonce grinding.

**The double hash** (hashing the already-tagged 32-byte value again)
is the "range extension" step. It matches the Amaru reference
implementation's `evolve()` function.

### 10.2.3 Epoch Boundary (TICKN Rule)

At the transition from epoch epsilon to epoch epsilon + 1:

```
TICKN(eta, eta_h):
  eta_0' = H_256(eta_c || eta_h || eta_e)
```

where:
- `eta_c` is the candidate nonce (frozen at the stability window)
- `eta_h` is the hash of the previous epoch's last block header (or `0^32` if no blocks)
- `eta_e` is extra entropy from protocol parameters (or `0^32` = neutral nonce)

**Note.** The evolving nonce `eta_v` and candidate nonce
`eta_c` are **not** reset at epoch boundaries. They continue accumulating
across epochs. Only `eta_0` (the epoch nonce used in VRF inputs) is
recomputed.

```
After TICKN:
  eta_v unchanged (continues evolving in new epoch)
  eta_c unchanged (continues tracking in new epoch)
  eta_0 = H_256(eta_c || eta_h || eta_e)
  eta_e unchanged (until next protocol parameter update)
```

### 10.2.4 Nonce Utility Functions

```
hash_nonce(a, b) = H_256(a || b)           -- combine two nonces
mk_nonce(seed) = H_256(seed)               -- create nonce from seed
```

---

## 10.3 Header Validation

A Conway block header has the structure:

```
header = [header_body, body_signature]

header_body = [
  block_number    : N,               -- [0]
  slot            : N,               -- [1]
  prev_hash       : H? ,             -- [2] None for genesis successor
  issuer_vkey     : B_32,            -- [3] cold verification key
  vrf_vkey        : B_32,            -- [4] VRF verification key
  vrf_result      : [B_64, B_80],    -- [5] [output, proof]
  block_body_size : N,               -- [6]
  block_body_hash : H,               -- [7]
  operational_cert: OpCert,          -- [8]
  protocol_version: [N, N],          -- [9] [major, minor]
]

operational_cert = [
  hot_vkey        : B_32,            -- KES verification key
  sequence_number : N,
  kes_period      : N,
  sigma           : B_64,            -- Ed25519 signature
]
```

### 10.3.1 Validation Predicate

```
validate_header(h, prev_hash, prev_slot, prev_block_no,
                pool_vrf_keys, epoch_nonce, slots_per_kes_period,
                max_kes_evolutions, last_opcert_seq, pool_sigmas,
                active_slot_coeff, actual_body_size, actual_body_hash,
                max_major_pv) -> errors
```

The header is valid if and only if all of the following hold:

**Rule 1 - Slot monotonicity:**
```
h.slot > prev_slot
```
Slots must strictly increase along the chain. This prevents
equivocation (two blocks at the same slot from the same issuer).

**Rule 2 - Block number continuity:**
```
h.block_number = prev_block_no + 1
```
Block numbers form a gapless sequence.

**Rule 3 - Chain linkage:**
```
h.prev_hash = prev_hash
```
where `prev_hash` is the Blake2b-256 hash of the previous block's
header CBOR encoding. For the genesis successor, `prev_hash` may
be None.

**Rule 4 - Operational certificate signature:**
```
message = h.opcert.hot_vkey || h.opcert.sequence_number_BE64
          || h.opcert.kes_period_BE64

Ed25519_Verify(h.issuer_vkey, h.opcert.sigma, message)
```
The cold key (issuer_vkey) signs the delegation to the hot KES key.
The sequence number and KES starting period are included to prevent
replay.

**Rule 5 - VRF key registration:**
```
pool_id = H_224(h.issuer_vkey)
pool_vrf_keys[pool_id] = h.vrf_vkey
```
The VRF key in the header must match the one registered on-chain
for this pool.

**Rule 6 - VRF proof validity:**
```
alpha = H_256(h.slot_BE64 || epoch_nonce)
(valid, beta) = VRF_verify(h.vrf_vkey, h.vrf_result[1], alpha)
valid = True
h.vrf_result[0] = beta
```
The declared VRF output in the header must equal the output computed
from the proof.

**Rule 7 - Leader eligibility:**
```
leader_output = H_256(0x4c || beta)
int_BE(leader_output) / 2^256 < phi_f(pool_sigmas[pool_id])
```
The pool must be a legitimate leader for this slot given its relative
stake.

**Rule 8 - KES signature:**
```
slot_kes_period = h.slot / slots_per_kes_period
kes_period_offset = slot_kes_period - h.opcert.kes_period

0 <= kes_period_offset < max_kes_evolutions

KES_verify(h.opcert.hot_vkey, kes_period_offset, h.header_body_raw, h.body_signature)
```
The KES period must be within the valid range, and the KES signature
over the raw header body CBOR must verify.

**Rule 9 - OpCert sequence (anti-replay):**
```
h.opcert.sequence_number >= last_opcert_seq[pool_id]
```
The sequence number must not decrease. Gaps are allowed (a pool may
skip sequence numbers when rotating keys). Strict less-than is a
replay.

**Rule 10 - Body size integrity:**
```
h.block_body_size = actual_body_size
```
The declared body size in the header must match the actual serialized
body size.

**Rule 11 - Body hash integrity:**
```
h.block_body_hash = H_256(actual_body_bytes)
```
The declared body hash must match the actual body hash.

**Rule 12 - Protocol version bound:**
```
h.protocol_version[0] <= max_major_pv
```
The major protocol version must not exceed the maximum allowed by
current protocol parameters.

### 10.3.2 Block Hash

The block hash is the Blake2b-256 hash of the full header CBOR
(header body + body signature, as a single CBOR array):

```
block_hash(h) = H_256(h.raw)
```

### 10.3.3 Pool Identification

A pool is identified by the Blake2b-224 hash of its cold verification key:

```
pool_id(h) = H_224(h.issuer_vkey)
```

---

## 10.4 Chain Selection

### 10.4.1 Longest Chain Rule

Bluematter implements the Praos longest-chain rule. Given a set of
candidate chain tips, prefer the one with the highest block number:

```
select_best_chain(candidates) =
  argmax_{c in candidates} (c.tip_block_number, c.tip_slot)
```

Ties on block number are broken by slot number (higher slot preferred),
then by arrival order (first seen preferred).

### 10.4.2 Fork Choice with Rollback Bound

When deciding whether to switch from the current chain to a candidate:

```
should_switch(current, candidate, k, intersection_block_no):
  -- Rule 1: No current chain => always switch
  if current = null: return True

  -- Rule 2: Candidate must be strictly longer
  if candidate.tip_block_no <= current.tip_block_no: return False

  -- Rule 3: Rollback depth bound
  if intersection_block_no is not None:
    rollback_depth = current.tip_block_no - intersection_block_no
    if rollback_depth > k: return False

  return True
```

The security parameter `k` (mainnet: 2160) bounds how far back a
chain reorganization can reach. Any fork deeper than k blocks is
rejected outright, regardless of length.

**Rationale.** The k-block rollback limit provides settlement finality:
after k blocks, a transaction is considered irreversible (under the
honest-majority assumption). Without this bound, an adversary who
accumulates a private chain could reorganize arbitrarily deep.

### 10.4.3 Rollback Validation

```
validate_rollback_depth(current_block_no, rollback_block_no, k):
  depth = current_block_no - rollback_block_no
  if depth > k:
    raise RollbackLimitExceeded
```

### 10.4.4 Intersect Point Computation

For ChainSync protocol negotiation, intersect points are computed
using exponential spacing from the tip:

```
compute_intersect_points(blocks):
  points = []
  i = len(blocks) - 1       -- start at tip
  step = 1
  while i >= 0:
    points.append(Point(blocks[i].slot, blocks[i].hash))
    i -= step
    step *= 2               -- exponential backoff
  points.append(Point.origin())
  return points
```

This produces O(log n) intersect points: `[tip, tip-1, tip-2, tip-4,
tip-8, ...]`, allowing efficient intersection finding with peers.

### 10.4.5 Genesis Chain Selection (Deferred)

Full Ouroboros Genesis density-based chain selection is not yet
implemented. Genesis selection considers chain density within a
sliding window after the intersection point, preferring denser
chains even if shorter. This provides stronger security guarantees
during long-range attacks and is required for bootstrapping from
genesis without checkpoints.

---

## 10.5 KES (Key Evolving Signatures)

### 10.5.1 Sum6KES Construction

Cardano uses Sum6KES, a 6-depth binary Merkle tree of Ed25519 keys:

```
Depth:          d = 6
Total periods:  2^d = 64
Signature size: 64 + d * 64 = 448 bytes
Public key:     H_256(Merkle root) = 32 bytes
```

Each period corresponds to one Ed25519 leaf key. The Merkle tree
structure allows verification without knowing which leaf was used,
via a Merkle authentication path.

### 10.5.2 Signature Layout

```
KES signature (448 bytes):
  [0..64)   : Ed25519 signature (over message, under leaf vkey)
  [64..128) : Level 0 pair: [vk_L (32), vk_R (32)]   -- leaf level
  [128..192): Level 1 pair: [vk_L (32), vk_R (32)]
  [192..256): Level 2 pair: [vk_L (32), vk_R (32)]
  [256..320): Level 3 pair: [vk_L (32), vk_R (32)]
  [320..384): Level 4 pair: [vk_L (32), vk_R (32)]
  [384..448): Level 5 pair: [vk_L (32), vk_R (32)]   -- root level
```

### 10.5.3 Verification

```
kes_verify(period, pk, msg, sig):
  -- Parse signature
  ed_sig = sig[0:64]
  path = [(sig[64+i*64 : 64+i*64+32],          -- vk_L
           sig[64+i*64+32 : 64+i*64+64])        -- vk_R
          for i in 0..5]

  -- Select leaf by period bit
  bit_0 = period & 1
  leaf_vk = path[0][bit_0]

  -- Verify Ed25519 signature under leaf key
  if not Ed25519_Verify(leaf_vk, ed_sig, msg): return False

  -- Walk up Merkle tree
  node = leaf_vk
  for level in 0..5:
    (vk_L, vk_R) = path[level]
    bit = (period >> level) & 1
    if bit = 0 and node != vk_L: return False
    if bit = 1 and node != vk_R: return False
    node = H_256(vk_L || vk_R)

  -- Root must match public key
  return node = pk
```

### 10.5.4 KES Period Calculation

```
kes_period(slot) = slot / slots_per_kes_period
```

Mainnet constants:
```
slots_per_kes_period = 129,600        (1.5 days at 1 slot/second)
max_kes_evolutions   = 62             (operational limit, not 64)
total_kes_lifetime   = 62 * 129,600 = 8,035,200 slots ~ 93 days
```

The operational certificate records the starting KES period. The
period offset is:

```
kes_period_offset = kes_period(slot) - opcert.kes_period
```

This offset must satisfy: `0 <= kes_period_offset < max_kes_evolutions`.

### 10.5.5 Key Evolution (Forward Security)

After signing at period t, the pool operator **must** evolve the key:

```
kes_evolve(secret_key, old_period):
  secure_zero(secret_key.leaves[old_period].seed)
  secret_key.leaves[old_period].seed = 0^32
```

After evolution, the key material for `old_period` is destroyed.
This provides **forward security**: even if the current key is
compromised, past signatures cannot be forged.

**Implementation note.** Python's immutable `bytes` type makes true
secure zeroing impossible. Bluematter copies the seed into a mutable
ctypes buffer and zeros that, as a best-effort measure.

### 10.5.6 Key Generation

```
kes_keygen(seed):
  -- Generate 64 leaf keypairs
  for i in 0..63:
    leaf_seed_i = H_256("kes-leaf-" || seed || i_BE32)
    (sk_i, vk_i) = Ed25519_Keygen(leaf_seed_i)

  -- Build Merkle tree bottom-up
  current_vks = [vk_0, vk_1, ..., vk_63]
  for level in 0..5:
    pairs = []
    next_vks = []
    for j in 0, 2, 4, ...:
      pairs.append((current_vks[j], current_vks[j+1]))
      next_vks.append(H_256(current_vks[j] || current_vks[j+1]))
    tree_levels[level] = pairs
    current_vks = next_vks

  root_pk = current_vks[0]
  return (leaves, tree_levels), root_pk
```

---

## 10.6 Hard Fork Combinator

The Hard Fork Combinator (HFC) manages the multi-era chain. Blocks
and headers carry era tags that indicate their era.

### 10.6.1 Block Wire Format Era Tags

```
Era       | Wire Tag | Notes
----------|----------|------
Byron     | (bare)   | Detected by structure, no integer tag
Shelley   | 2        | [2, block]
Allegra   | 3        | [3, block]
Mary      | 4        | [4, block]
Alonzo    | 5        | [5, block]
Babbage   | 6        | [6, block]
Conway    | 7        | [7, block]
```

### 10.6.2 ChainSync Header Era Tags (NS7)

```
Era       | NS7 Tag | Encoding
----------|---------|----------------------------------
Byron     | 0       | [0, [variant, #6.24(header)]]
Shelley   | 1       | [1, #6.24(header)]
Allegra   | 2       | [2, #6.24(header)]
Mary      | 3       | [3, #6.24(header)]
Alonzo    | 4       | [4, #6.24(header)]
Babbage   | 5       | [5, #6.24(header)]
Conway    | 6       | [6, #6.24(header)]
```

### 10.6.3 Era Boundaries

Known era boundary slots (approximate):

**Preprod:**
```
Byron:   0          Shelley: 84,844       Allegra: 518,400
Mary:    950,400    Alonzo:  16,588,800   Babbage: 62,510,400
Conway:  70,416,000
```

**Mainnet:**
```
Byron:   0            Shelley: 4,492,800    Allegra: 16,588,800
Mary:    23,068,800   Alonzo:  39,916,975   Babbage: 72,316,896
Conway:  107,654,400
```

Bluematter operates in Conway-only mode: pre-Conway blocks are accepted
as opaque blobs but not validated. Full multi-era validation requires
era-specific ledger rules not yet implemented.

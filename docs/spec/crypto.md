# Cryptography

Cardano's Ouroboros Praos consensus relies on four cryptographic
primitives: collision-resistant hashing, digital signatures, verifiable
random functions, and key-evolving signatures. Each serves a distinct
role in the protocol -- hashing provides binding commitments, signatures
authenticate transactions and delegation, VRFs enable private leader
election, and KES provides forward-secure block signing.

This chapter specifies each primitive as used in Bluematter, with
references to the source modules that implement them.

---

## 1.1 Hash Functions

**Source:** `crypto/hash.py`

Two members of the Blake2b family are used, differing only in output
length:

```
H_256 : B -> B_32       Blake2b-256 (32-byte digest)
H_224 : B -> B_28       Blake2b-224 (28-byte digest)
```

Both use the Blake2b core with no key, salt, or personalization
parameters. The implementation delegates to Python's `hashlib.blake2b`
with `digest_size` set to 32 or 28 respectively.

### 1.1.1 Why Two Lengths

The 256-bit hash provides standard collision resistance (2^128 security)
and is used wherever a full-strength binding commitment is needed: block
hashes, transaction IDs, Merkle nodes. The 224-bit hash provides a
shorter identifier (2^112 security) used for addresses and pool IDs,
where the reduced length saves space in the UTxO set without
meaningfully weakening security.

### 1.1.2 Usage Table

| Hash | Input | Output Name | Purpose |
|------|-------|-------------|---------|
| `H_256` | CBOR-encoded header | Block hash | Identifies a block in the chain; prev-hash linkage |
| `H_256` | CBOR-encoded tx body | Transaction ID | Uniquely identifies a transaction |
| `H_256` | `vk_L \|\| vk_R` | KES tree node | Internal nodes of the Sum6KES Merkle tree |
| `H_256` | `slot_be64 \|\| eta_0` | VRF input alpha | Slot-specific VRF challenge |
| `H_256` | `"L" \|\| beta_vrf` | Leader VRF value | Tagged derivation for leader eligibility check |
| `H_256` | `"N" \|\| beta_vrf` | Nonce VRF value | Tagged derivation for epoch nonce evolution |
| `H_256` | `eta_v \|\| vrf_hash` | Evolved nonce | Per-block evolving nonce update |
| `H_256` | `eta_c \|\| eta_h \|\| eta_e` | Epoch nonce | TICKN rule at epoch boundary |
| `H_256` | `h1 \|\| h2 \|\| h3 \|\| h4` | Body hash | Block body integrity (hash of four component hashes) |
| `H_256` | CBOR-encoded datum | Datum hash | Identifies Plutus datums in witness sets |
| `H_256` | Auxiliary data CBOR | Aux data hash | Transaction metadata integrity |
| `H_256` | Redeemers + datums + lang views | Script data hash | Plutus script integrity |
| `H_224` | `issuer_vkey` | Pool ID | Identifies a stake pool (28 bytes) |
| `H_224` | `vkey` | Key hash | Payment/staking credential in addresses |
| `H_224` | `version_prefix \|\| flat_bytes` | Script hash | Identifies a Plutus or native script |

The body hash deserves elaboration. A Conway block body consists of four
CBOR-encoded arrays: transaction bodies, transaction witness sets,
auxiliary data, and invalid transaction indices. The body hash is
computed as:

```
body_hash = H_256( H_256(tx_bodies_cbor)
                || H_256(witnesses_cbor)
                || H_256(aux_data_cbor)
                || H_256(invalid_txs_cbor) )
```

This two-level hashing allows a node to verify each component
independently before computing the aggregate.

---

## 1.2 Ed25519 Digital Signatures

**Source:** `crypto/ed25519.py`

Ed25519 is the twisted Edwards curve digital signature algorithm
specified in RFC 8032. It provides 128-bit security with compact keys
and signatures.

### 1.2.1 Interface

```
KeyGen()           -> (sk, vk)     where sk : B_64, vk : B_32
Sign(sk, m)        -> sig           where sig : B_64
Verify(vk, m, sig) -> Bool
```

The implementation delegates to PyNaCl (libsodium bindings). Only
verification is exposed in the public API -- key generation and signing
are handled by external tooling (cardano-cli) or by the KES subsystem
for block production.

The `Verify` function returns `False` for any failure (malformed key,
wrong length, invalid signature, or internal error). It never raises
exceptions to callers:

```python
def verify(public_key: bytes, signature: bytes, message: bytes) -> bool:
    try:
        vk = VerifyKey(public_key)
        vk.verify(message, signature)
        return True
    except Exception:
        return False
```

### 1.2.2 Where Ed25519 Is Used

Ed25519 signatures appear in four distinct roles:

1. **Transaction witnesses.** Each transaction input must be authorized
   by a signature from the key whose hash appears in the input's
   address. The witness set contains `(vkey, sig)` pairs where
   `sig = Sign(sk, H_256(tx_body_cbor))`. Verification checks:
   ```
   Verify(vkey, H_256(tx_body_cbor), sig) = True
   ```
   and `H_224(vkey) in required_key_hashes`.

2. **Operational certificates.** A stake pool operator signs a
   delegation from their cold key to a hot (KES) key. See Section 1.5.

3. **KES leaf signing.** At the bottom of the KES Merkle tree, each
   leaf is an Ed25519 key that signs the block header body. This
   signature is embedded within the 448-byte KES signature structure.

4. **Genesis delegation.** In the genesis block, delegation certificates
   are signed by genesis keys. These are verified during bootstrap but
   not during steady-state operation.

---

## 1.3 Verifiable Random Function (VRF)

**Source:** `crypto/vrf.py`

The VRF enables private leader election: a pool can prove it was
selected to produce a block for a given slot without revealing its
secret key, and any verifier can check the proof deterministically.

### 1.3.1 Ciphersuite

Bluematter implements **ECVRF-ED25519-SHA512-Elligator2** per
`draft-irtf-cfrg-vrf-03`. The critical detail: Cardano uses suite byte
`0x03` (draft-03), not `0x04` (draft-06). The vendored implementation
originates from nccgroup's draft-06 reference, adapted to the draft-03
suite string.

**Curve parameters:**

| Parameter | Value |
|-----------|-------|
| Curve | Edwards25519 |
| Prime `p` | `2^255 - 19` |
| Group order `ell` | `2^252 + 27742317777372353535851937790883648493` |
| Cofactor `h` | 8 |
| Montgomery parameter `A` | 486662 |
| Hash function | SHA-512 |
| Suite string | `0x03` |

### 1.3.2 Interface

```
VRF_prove(sk, alpha)       -> (Bool, pi)
    where sk : B_32, alpha : B, pi : B_80

VRF_verify(vk, pi, alpha)  -> (Bool, beta)
    where vk : B_32, pi : B_80, alpha : B, beta : B_64

VRF_proof_to_hash(pi)      -> (Bool, beta)
    where pi : B_80, beta : B_64

VRF_get_public_key(sk)     -> vk
    where sk : B_32, vk : B_32
```

All functions return a `(Bool, bytes)` tuple. The boolean indicates
success; on failure, the bytes value is empty. This convention avoids
exceptions in the hot verification path.

### 1.3.3 Proof Structure

A VRF proof `pi` is 80 bytes, encoding three values:

```
pi = Gamma_enc || c_enc || s_enc
     [32 bytes]  [16 bytes] [32 bytes]
```

where:
- `Gamma` is an Edwards curve point (the VRF "pre-output")
- `c` is a 128-bit Schnorr challenge
- `s` is a 256-bit Schnorr response scalar

Decoding extracts the triple `(Gamma, c, s)`:

```
Gamma = decode_point(pi[0:32])
c     = int_from_le(pi[32:48])
s     = int_from_le(pi[48:80])
```

Two structural checks are applied during decoding:

- **Scalar range (CRY-C2):** `s < ell`. A proof with `s >= ell` is
  rejected, preventing malleability.
- **Small-order rejection (CRY-C1/C3):** `Gamma` must not be a
  small-order point. The check computes `h * Gamma` and rejects if the
  result is the identity point `O = (0, 1)`. This catches all eight
  torsion points (orders 1, 2, 4, 8) on Edwards25519.

### 1.3.4 Verification Algorithm

Given public key `vk`, proof `pi`, and input `alpha`:

**Step 1. Decode the proof.**

```
(Gamma, c, s) = decode_proof(pi)
```

Reject if decoding fails (malformed point, `s >= ell`, or small-order
`Gamma`).

**Step 2. Hash to curve.**

Map the input `alpha` to a curve point `H` using Elligator2:

```
hash_input = SHA512(suite_string || 0x01 || vk || alpha)
r = int_from_le(hash_input[0:32]) with top bit cleared
u = (-A) * inverse(1 + 2*r^2) mod p
w = u * (u^2 + A*u + 1) mod p
e = Legendre(w)               -- i.e., w^((p-1)/2) mod p
u_final = e*u + (e-1)*A/2 mod p
y_coord = (u_final - 1) * inverse(u_final + 1) mod p
H_prelim = decode_point(encode_le(y_coord))
H = h * H_prelim              -- clear cofactor
```

The Elligator2 mapping converts a uniform hash output into a curve
point. The cofactor clearing ensures `H` lies in the prime-order
subgroup.

**Step 3. Decode the public key.**

```
Y = decode_point(vk)
```

Reject if `Y` is not on the curve or is small-order.

**Step 4. Compute verification equations.**

```
U = s*B - c*Y
V = s*H - c*Gamma
```

where `B` is the Ed25519 base point. These are the standard Schnorr
verification equations: if the prover knew `x` such that `Y = x*B` and
`Gamma = x*H`, then `U` and `V` will be consistent with the challenge
`c`.

Point negation on twisted Edwards: `-(x, y) = (p - x, y)`.

**Step 5. Recompute the challenge.**

```
c' = hash_points(suite_string, H, Gamma, U, V)
   = int_from_le( SHA512(suite_string || 0x02
                         || encode(H) || encode(Gamma)
                         || encode(U) || encode(V))[0:16] )
```

The challenge is the first 128 bits (16 bytes) of the SHA-512 hash of
the suite string, a domain separator byte `0x02`, and the four encoded
points.

**Step 6. Check equality.**

```
valid = (c == c')
```

**Step 7. Compute the output.**

If valid, the VRF output `beta` is:

```
beta = SHA512(suite_string || 0x03 || encode(h * Gamma))
```

The cofactor multiplication `h * Gamma` ensures the output is canonical
regardless of the representative chosen for `Gamma` in the coset.

The output `beta` is 64 bytes (the full SHA-512 digest).

### 1.3.5 Tagged Output Derivation

Cardano does not use the raw 64-byte VRF output directly. Instead, two
domain-separated 32-byte values are derived:

```
leader(beta) = H_256("L" || beta)    : B_32
nonce(beta)  = H_256("N" || beta)    : B_32
```

where `"L" = 0x4c` and `"N" = 0x4e` are single ASCII bytes.

The **leader value** determines slot leader eligibility. A pool with
relative stake `sigma_pool` is the leader for a slot if:

```
leader(beta) / 2^256  <  1 - (1 - f)^{sigma_pool}
```

where `f` is the active slot coefficient. This comparison is performed
with exact rational arithmetic (not floating point) to avoid
disagreements between nodes at the threshold boundary.

The **nonce value** feeds into the evolving epoch nonce. Each block's
VRF nonce output is folded into the running nonce state via two rounds
of hashing (the "range extension" step):

```
vrf_hash = H_256(nonce(beta))
eta_v'   = H_256(eta_v || vrf_hash)
```

The double hash (hashing the already-tagged 32-byte value again before
combining) matches the Haskell and Amaru implementations.

### 1.3.6 VRF Input Construction

The VRF input `alpha` for a given slot is:

```
alpha = H_256( slot_be64 || eta_0 )
```

where `slot_be64` is the slot number as an 8-byte big-endian integer
and `eta_0` is the current epoch nonce (32 bytes). This binds the VRF
evaluation to both the specific slot and the current epoch's randomness.

---

## 1.4 Key-Evolving Signatures (KES)

**Source:** `crypto/kes.py`

KES provides **forward security** for block signing. A pool operator
generates a KES key pair; the secret key can sign for a bounded number
of time periods. After each period, the key is evolved: the old secret
material is erased, making it infeasible to forge signatures for past
periods even if the current key is compromised.

### 1.4.1 Construction: Sum6KES

Bluematter implements **Sum6KES** over Ed25519 and Blake2b-256. This is
a binary Merkle tree of depth 6, yielding `2^6 = 64` time periods.

```
KES_keygen(seed)       -> (sk_0, vk)
    where seed : B_32, sk_0 : KesSecretKey, vk : B_32

KES_sign(sk_t, t, m)   -> sig_t
    where t : N, m : B, sig_t : B_448

KES_verify(vk, t, m, sig_t) -> Bool
    where vk : B_32, t : N (0 <= t < 64), sig_t : B_448

KES_evolve(sk_t, t)    -> sk_{t+1}
    (old key material securely erased)
```

The public key `vk` is the 32-byte Blake2b-256 Merkle root of the tree.
It remains constant across all 64 periods; only the secret key changes.

### 1.4.2 Key Generation

From a 32-byte seed, 64 Ed25519 leaf key pairs are derived by
domain-separated hashing:

```
For i in [0, 64):
    leaf_seed_i = H_256("kes-leaf-" || seed || i_be32)
    (sk_i, vk_i) = Ed25519_KeyGen(leaf_seed_i)
```

The Merkle tree is built bottom-up. At each level, adjacent verification
keys are paired and hashed:

```
Level 0: pairs of leaf vkeys
    node_{0,j} = (vk_{2j}, vk_{2j+1})
    parent_{0,j} = H_256(vk_{2j} || vk_{2j+1})

Level l (1 <= l < 6): pairs of level-(l-1) parents
    parent_{l,j} = H_256(parent_{l-1, 2j} || parent_{l-1, 2j+1})

Root: vk = parent_{5, 0}
```

### 1.4.3 Signature Structure

A Sum6KES signature is **448 bytes**, structured as:

```
sig_t = ed25519_sig || path_0 || path_1 || ... || path_5
        [64 bytes]    [64 bytes each, 6 levels = 384 bytes]
```

Total: `64 + 6 * 64 = 448` bytes.

Each `path_i` contains both sibling verification keys at level `i`:

```
path_i = (vk_L_i || vk_R_i)
         [32 bytes] [32 bytes]
```

The path encodes the full Merkle authentication path from the signing
leaf to the root. Both siblings are included at each level (rather than
just the co-path sibling) so that the verifier can reconstruct every
parent hash.

### 1.4.4 Signing

To sign message `m` at period `t`:

1. Select leaf `t` from the secret key tree.
2. Compute `ed25519_sig = Ed25519_Sign(sk_t, m)`.
3. Build the Merkle path: at each level `l`, include the pair
   `(vk_L, vk_R)` for the node containing period `t`'s ancestor.

```
sig = ed25519_sig
idx = t
For level in [0, 6):
    pair_idx = idx / 2     (integer division)
    sig = sig || vk_L_{level, pair_idx} || vk_R_{level, pair_idx}
    idx = pair_idx
```

### 1.4.5 Verification

Given public key `vk`, period `t`, message `m`, and signature `sig_t`:

**Step 1. Parse the signature.**

Extract the Ed25519 signature and the six `(vk_L, vk_R)` pairs:

```
ed_sig = sig_t[0:64]
For i in [0, 6):
    vk_L_i = sig_t[64 + 64*i     : 64 + 64*i + 32]
    vk_R_i = sig_t[64 + 64*i + 32 : 64 + 64*i + 64]
```

**Step 2. Identify the leaf key.**

The period `t`'s least significant bit selects left or right at
level 0:

```
bit_0 = t & 1
leaf_vk = if bit_0 == 0 then vk_L_0 else vk_R_0
```

**Step 3. Verify the Ed25519 signature.**

```
Ed25519_Verify(leaf_vk, m, ed_sig) = True
```

If this fails, reject immediately.

**Step 4. Reconstruct the Merkle root.**

Walk up the tree from the leaf, verifying consistency at each level and
computing parent hashes:

```
node = leaf_vk
For level in [0, 6):
    bit = (t >> level) & 1
    if bit == 0:
        assert node == vk_L_{level}
    else:
        assert node == vk_R_{level}
    node = H_256(vk_L_{level} || vk_R_{level})
```

**Step 5. Compare roots.**

```
valid = (node == vk)
```

The final `node` after six levels of hashing must equal the known
public key (the Merkle root).

### 1.4.6 Key Evolution

Evolution erases the secret material for the old period:

```
KES_evolve(sk, t):
    secure_zero(sk.leaves[t].seed)
    sk.leaves[t].seed = 0x00 * 32
    return sk
```

The `secure_zero` operation is best-effort in Python: the seed bytes
are copied to a mutable ctypes buffer and overwritten with zeros. The
original Python bytes object may persist in memory until garbage
collection, but the explicit zeroing reduces the window of exposure.

After evolution, the key can no longer sign for period `t`. Attempting
to sign with zeroed-out key material will produce an invalid signature.

### 1.4.7 KES Period Calculation

A block at slot `s` uses KES period:

```
slot_kes_period = s / slots_per_kes_period      (integer division)
kes_period_offset = slot_kes_period - opcert.kes_period
```

where `slots_per_kes_period` is a protocol parameter (mainnet: 129,600
slots, approximately 1.5 days). The offset must satisfy:

```
0 <= kes_period_offset < max_kes_evolutions
```

where `max_kes_evolutions` is 62 on mainnet (leaving 2 periods of
headroom from the 64-period maximum).

---

## 1.5 Operational Certificates

**Source:** `codec/header.py`, `consensus/header.py`

An operational certificate (opcert) delegates block-signing authority
from a pool's **cold key** (kept offline) to a **hot key** (the KES
key, kept on the block-producing node). This separation limits the
damage from a compromised online key: the attacker gains at most the
ability to sign blocks for the current KES key's remaining periods, not
the permanent ability to act as the pool.

### 1.5.1 Structure

```
OpCert = (hot_vk, sequence_number, kes_period, sigma)
```

| Field | Type | Meaning |
|-------|------|---------|
| `hot_vk` | `B_32` | KES verification key (Merkle root of Sum6KES tree) |
| `sequence_number` | `N` | Monotonically increasing counter (anti-replay) |
| `kes_period` | `N` | KES period at which this certificate becomes valid |
| `sigma` | `B_64` | Ed25519 signature by the cold key |

The certificate is serialized as a 4-element CBOR array.

### 1.5.2 Signing

The cold key signs over the concatenation of the hot key and two
8-byte big-endian integers:

```
message = hot_vk || sequence_number_be64 || kes_period_be64
sigma   = Ed25519_Sign(cold_sk, message)
```

Note that the signed message uses fixed-width 8-byte encodings of the
integers, not variable-length CBOR. This matches the Haskell
implementation's `serialiseSignableRepresentation`.

### 1.5.3 Verification

Given a block header with `issuer_vkey` (the cold verification key)
and an embedded opcert:

```
message = opcert.hot_vk
       || opcert.sequence_number as B_8 (big-endian)
       || opcert.kes_period as B_8 (big-endian)

valid = Ed25519_Verify(issuer_vkey, message, opcert.sigma)
```

### 1.5.4 Sequence Number Anti-Replay

Each pool maintains a counter of the last-seen opcert sequence number.
A new block's opcert must have:

```
opcert.sequence_number >= last_seen_sequence
```

Gaps are allowed (a pool may skip sequence numbers), but replaying an
older sequence number is rejected. This prevents an attacker who
compromises an old KES key from reusing an expired certificate.

### 1.5.5 Block Signing Chain

The full signing chain for a block header is:

```
cold_sk  --[Ed25519]--> opcert.sigma    (signs hot_vk delegation)
kes_sk_t --[Sum6KES]--> body_signature  (signs header body CBOR)
```

Verification proceeds in reverse:

1. Verify `opcert.sigma` under `issuer_vkey` (the cold key).
2. Extract `hot_vk` from the opcert (this is the KES Merkle root).
3. Compute `kes_period_offset = slot / slots_per_kes_period - opcert.kes_period`.
4. Verify `body_signature` under `hot_vk` at period `kes_period_offset`.

If both verifications succeed and the KES period is within bounds, the
header is authentic: it was produced by someone who controls both the
pool's cold key (for the opcert) and the current KES key (for the block
signature).

---

## 1.6 Summary of Cryptographic Sizes

| Primitive | Key Size | Signature/Proof Size | Output Size |
|-----------|----------|---------------------|-------------|
| Blake2b-256 | -- | -- | 32 bytes |
| Blake2b-224 | -- | -- | 28 bytes |
| Ed25519 | sk: 64B, vk: 32B | 64 bytes | -- |
| VRF (ECVRF-ED25519-SHA512-Elligator2) | sk: 32B, vk: 32B | proof: 80 bytes | beta: 64 bytes |
| Sum6KES | vk: 32B (Merkle root) | 448 bytes | -- |

---

## 1.7 Security Assumptions

The correctness of Ouroboros Praos depends on the following assumptions
about these primitives:

1. **Collision resistance of Blake2b.** No adversary can find distinct
   inputs `x != y` such that `H(x) = H(y)` in feasible time. This
   ensures transaction IDs, block hashes, and Merkle tree nodes are
   binding.

2. **Unforgeability of Ed25519.** No adversary can produce a valid
   signature for a message without knowledge of the secret key (EUF-CMA
   security). This authenticates transactions and operational
   certificates.

3. **Uniqueness and pseudorandomness of the VRF.** For any public key
   and input, there is exactly one valid output (uniqueness). The output
   is computationally indistinguishable from random to anyone who does
   not hold the secret key (pseudorandomness). Together, these
   properties ensure that leader election is unpredictable and
   non-manipulable.

4. **Forward security of KES.** After key evolution, an adversary who
   compromises the current key cannot forge signatures for past periods.
   This limits the damage from key compromise to the remaining KES
   periods, not the pool's entire history.

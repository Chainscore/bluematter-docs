# Crypto Module -- Cryptographic Primitives

## Overview

The crypto module (`src/bluematter/crypto/`) provides pure-Python implementations of all cryptographic primitives required by the Cardano Ouroboros Praos protocol: hash functions (Blake2b), digital signatures (Ed25519 via PyNaCl), verifiable random functions (ECVRF-ED25519-SHA512-Elligator2), and key-evolving signatures (Sum6KES). These primitives underpin block validation, transaction verification, leader election, nonce evolution, and forward-secure block signing. The module is verification-focused -- it can verify all proofs and signatures produced by any Cardano node, and also supports key generation and signing for block production.

## Files

### `__init__.py`
Empty package marker.

### `hash.py` (13 lines)
Blake2b hash functions used throughout the codebase.

- **`blake2b_256(data: bytes) -> bytes`** (line 6): Blake2b with 32-byte (256-bit) output. Used for block hashes, transaction IDs, body hashes, nonce evolution, KES Merkle tree nodes.
- **`blake2b_224(data: bytes) -> bytes`** (line 11): Blake2b with 28-byte (224-bit) output. Used for key hashes, address hashes, script hashes.

### `ed25519.py` (13 lines)
Ed25519 signature verification via the PyNaCl library.

- **`verify(public_key: bytes, signature: bytes, message: bytes) -> bool`** (line 6): Verify an Ed25519 signature. Returns `True` if valid, `False` otherwise (catches all exceptions internally).

### `vrf.py` (329 lines)
ECVRF-ED25519-SHA512-Elligator2 implementation for Cardano's slot leader eligibility and nonce evolution. Vendored from nccgroup/draft-irtf-cfrg-vrf-06 (MIT license), adapted to use the draft-03 suite string required by Cardano.

- **`vrf_verify(pk: bytes, pi: bytes, alpha: bytes) -> tuple[bool, bytes]`** (line 189): Verify a VRF proof. Returns `(valid, beta)` where `beta` is the 64-byte VRF output, or `(False, b"")` on failure.
- **`vrf_prove(sk: bytes, alpha: bytes) -> tuple[bool, bytes]`** (line 241): Generate a VRF proof. Returns `(valid, pi)` where `pi` is the 80-byte proof. WARNING: uses variable-time scalar multiplication -- safe for verification-only nodes, not for production block producers.
- **`vrf_proof_to_hash(pi: bytes) -> tuple[bool, bytes]`** (line 278): Extract the 64-byte VRF output (beta) from a proof without verifying it.
- **`vrf_get_public_key(sk: bytes) -> bytes`** (line 296): Derive the 32-byte VRF public key from a secret key.
- **`vrf_output_to_leader(beta: bytes) -> bytes`** (line 317): Derive the leader-check VRF value: `blake2b_256("L" || beta)`.
- **`vrf_output_to_nonce(beta: bytes) -> bytes`** (line 324): Derive the nonce-evolution VRF value: `blake2b_256("N" || beta)`.

### `kes.py` (228 lines)
Sum6KES (Key Evolving Signature) for Cardano's forward-secure block signing.

- **`kes_verify(period: int, pk: bytes, msg: bytes, sig: bytes) -> bool`** (line 47): Verify a Sum6KES signature. Checks the Ed25519 leaf signature, walks the Merkle path, and compares the recomputed root against the known public key.
- **`kes_keygen(seed: bytes) -> tuple[KesSecretKey, bytes]`** (line 110): Generate a Sum6KES key pair from a 32-byte seed. Returns `(secret_key, public_key)` where public_key is the 32-byte Merkle root.
- **`kes_sign(period: int, secret_key: KesSecretKey, msg: bytes) -> bytes`** (line 156): Sign a message at a given KES period. Returns a 448-byte signature.
- **`kes_evolve(secret_key: KesSecretKey, old_period: int) -> KesSecretKey`** (line 212): Evolve the KES key by erasing the old period's secret. Provides forward security -- past keys cannot be recovered.
- **`_secure_zero(data: bytes) -> None`** (line 195): Best-effort zeroing of bytes object memory via ctypes. Called during key evolution to erase old key material.

## Hash Functions

### `blake2b_256(data) -> bytes` (32-byte output)

The primary hash function in Cardano. Used for:

- **Block hash**: `blake2b_256(raw_header_cbor)` -- the canonical identifier of a block, computed over the full header (body + KES signature) in its original wire encoding.
- **Transaction ID**: `blake2b_256(raw_tx_body_cbor)` -- computed over the raw CBOR map of the transaction body.
- **Block body hash**: Hash of the serialized block body components (transaction bodies, witnesses, auxiliary data, invalid tx indices).
- **KES Merkle tree**: Each internal node is `blake2b_256(vk_left || vk_right)`.
- **Nonce evolution**: `blake2b_256(eta_v || vrf_hash)` combines the evolving nonce with VRF output.
- **Tagged VRF output**: `blake2b_256("L" || beta)` for leader check, `blake2b_256("N" || beta)` for nonce.
- **Epoch nonce**: `blake2b_256(eta_c || eta_h || eta_e)` at epoch boundaries.
- **Script hashing**: `blake2b_256(version_prefix || flat_bytes)` for native scripts (when applicable).

### `blake2b_224(data) -> bytes` (28-byte output)

Used for shorter hashes where 224-bit security suffices:

- **Key hashes**: `blake2b_224(vkey)` -- pool IDs, stake key hashes, payment key hashes.
- **Script hashes**: `blake2b_224(version_prefix || flat_bytes)` for Plutus script hashes.
- **Address derivation**: Payment and staking credential hashes in Shelley-era addresses.

Both functions use Python's built-in `hashlib.blake2b` with the appropriate `digest_size` parameter. No external dependencies.

## Ed25519 Signatures

### `verify(public_key, signature, message) -> bool`

Wraps PyNaCl's `nacl.signing.VerifyKey` for Ed25519 signature verification. The function:

1. Constructs a `VerifyKey` from the 32-byte public key.
2. Calls `vk.verify(message, signature)` which checks the 64-byte signature.
3. Returns `True` on success, `False` on any exception (including malformed keys, wrong-length signatures, or invalid signatures).

Ed25519 is used in Cardano for:
- **Transaction witness signatures**: Spending keys sign the transaction body hash.
- **Operational certificate signatures**: The cold key signs the KES hot key.
- **KES leaf signatures**: Each leaf in the Sum6KES tree is an Ed25519 key that signs the block header body.
- **Required signers**: Additional signatures required by Plutus scripts.

The catch-all exception handling ensures that malformed cryptographic material never causes crashes -- it simply fails verification.

## VRF (Verifiable Random Function)

### Algorithm: ECVRF-ED25519-SHA512-Elligator2

The VRF implementation follows the IETF draft-irtf-cfrg-vrf specification, specifically using **draft-03** with suite string `0x03`. This is critical -- Cardano uses the draft-03 suite byte, not draft-06 (which uses `0x04`). Using the wrong suite string produces different hash-to-curve outputs and all verification fails.

The implementation is vendored from nccgroup's reference code (MIT license) with the suite string adapted.

### Key Functions

**`vrf_verify(pk, pi, alpha) -> (bool, beta)`**: The core verification operation. Given a 32-byte public key, 80-byte proof, and arbitrary-length input alpha:

1. Decode the proof into `(gamma, c, s)` -- a curve point and two scalars.
2. Hash the input to a curve point via Elligator2.
3. Compute `U = s*B - c*Y` and `V = s*H - c*Gamma`.
4. Check `c == hash_points(H, Gamma, U, V)`.
5. Compute `beta = SHA-512(suite || 0x03 || encode(cofactor * gamma))`.

**`vrf_prove(sk, alpha) -> (bool, pi)`**: Proof generation. Derives the secret scalar, hashes to curve, computes gamma, generates nonce via RFC 8032, and produces the Schnorr-like proof. WARNING: variable-time scalar multiplication -- not safe for production block producers.

**`vrf_output_to_leader(beta) -> bytes`**: Derives the 32-byte leader-check value: `blake2b_256(b"\x4c" + beta)`. The tag byte `0x4c` is ASCII "L".

**`vrf_output_to_nonce(beta) -> bytes`**: Derives the 32-byte nonce-evolution value: `blake2b_256(b"\x4e" + beta)`. The tag byte `0x4e` is ASCII "N".

### How VRF is Used in Cardano

**Leader Election**: Each slot, a stake pool evaluates `vrf_prove(sk, slot_nonce || slot)` and checks whether the output falls below a threshold proportional to their stake. This is verifiable by anyone using `vrf_verify` on the proof in the block header.

**Nonce Evolution**: The VRF output from each block is tagged with "N" (`vrf_output_to_nonce`) and fed into the epoch nonce accumulator. This ensures the randomness for the next epoch's leader schedule is unpredictable until each block is actually produced. See `consensus/nonce.py` for the full nonce evolution logic including the UPDN rule and stability window.

### Security: Small-Order Point Rejection

**CRY-C1 / CRY-C3** (vrf.py lines 98-120): The `_decode_point` function rejects small-order (torsion) points by multiplying by the cofactor 8 and checking if the result is the identity point. This prevents attacks where an adversary uses a point of order 1, 2, 4, or 8 to create trivially valid proofs.

**CRY-C2** (vrf.py line 181): The `_ecvrf_decode_proof` function rejects proofs where the scalar `s >= ORDER`. This prevents malleability -- without this check, multiple distinct proofs could verify for the same input.

## KES (Key Evolving Signature)

### Sum6KES: 64 Periods, Merkle Tree Structure

KES provides **forward security** for block signing. A block producer generates a KES key that is valid for 64 periods (each period is typically 129,600 slots = 1.5 days on mainnet). After each period, the old signing key is securely erased, so even if a node is compromised, the attacker cannot forge blocks for past periods.

The structure is a 6-depth binary Merkle tree of Ed25519 keys:

```
                    Root (32-byte blake2b_256 hash = public key)
                   /                                            \
             Level 5                                       Level 5
            /       \                                     /       \
         ...         ...                               ...         ...
        /   \       /   \                             /   \       /   \
      L0    L1    L2    L3   ...                   L60   L61   L62   L63
      (Ed25519 leaf keys, each 32 bytes)
```

### Signature Layout (448 bytes)

```
[Ed25519 signature: 64 bytes]
[Level 0: vk_left (32) || vk_right (32)]  -- leaf level
[Level 1: vk_left (32) || vk_right (32)]
[Level 2: vk_left (32) || vk_right (32)]
[Level 3: vk_left (32) || vk_right (32)]
[Level 4: vk_left (32) || vk_right (32)]
[Level 5: vk_left (32) || vk_right (32)]  -- root level
```

Total: 64 + (6 * 64) = 448 bytes.

### Key Functions

**`kes_verify(period, pk, msg, sig) -> bool`**: Verification proceeds in three steps:

1. **Leaf selection**: The `period` (0-63) determines which leaf key was used. The period's bits select left/right at each tree level.
2. **Ed25519 check**: The 64-byte Ed25519 signature is verified under the selected leaf verification key extracted from the Merkle path.
3. **Merkle walk**: Starting from the leaf, walk up 6 levels recomputing `blake2b_256(vk_left || vk_right)` at each level. The final root must match `pk`.

**`kes_keygen(seed) -> (secret_key, public_key)`**: Generates all 64 leaf Ed25519 keys from domain-separated derivation (`blake2b_256("kes-leaf-" || seed || index)`), builds the Merkle tree bottom-up, and returns the tree structure plus the 32-byte root hash.

**`kes_sign(period, secret_key, msg) -> bytes`**: Signs with the Ed25519 leaf key for the given period and attaches the Merkle path (sibling pairs at each level).

**`kes_evolve(secret_key, old_period) -> KesSecretKey`**: Erases the old period's secret key material by replacing it with zero bytes. Calls `_secure_zero` for best-effort memory clearing before replacement.

### Forward Security: `_secure_zero`

(kes.py line 195): Since Python `bytes` objects are immutable, true secure erasure is impossible at the language level. `_secure_zero` copies the bytes into a mutable `ctypes` buffer and zeros it via `ctypes.memset`. This is best-effort -- the original bytes object may still reside in memory until garbage collected. For production block producers, a C/Rust extension with guaranteed secure memory handling would be preferable.

### How KES is Used in Cardano

1. A stake pool operator generates a KES key pair and registers the public key (Merkle root) in their operational certificate.
2. The cold key signs the operational certificate, binding the KES key to the pool.
3. For each block, the node signs the header body with `kes_sign(current_period, sk, header_body_cbor)`.
4. Validators verify with `kes_verify(period, kes_pk, header_body_cbor, sig)`.
5. After each KES period, the node calls `kes_evolve` to erase the old period's key.
6. When all 64 periods are exhausted, the operator must generate a new KES key and issue a new operational certificate.

## Hash Usage Map

| Hash Function | Usage | Input | Output Size |
|---|---|---|---|
| `blake2b_256` | Block hash | Raw header CBOR (header body + KES signature) | 32 bytes |
| `blake2b_256` | Transaction ID | Raw tx body CBOR map | 32 bytes |
| `blake2b_256` | Block body hash | Serialized body components | 32 bytes |
| `blake2b_256` | KES Merkle node | `vk_left \|\| vk_right` (64 bytes) | 32 bytes |
| `blake2b_256` | VRF leader output | `"L" \|\| vrf_beta` (65 bytes) | 32 bytes |
| `blake2b_256` | VRF nonce output | `"N" \|\| vrf_beta` (65 bytes) | 32 bytes |
| `blake2b_256` | Nonce evolution | `eta_v \|\| blake2b_256(tagged_nonce)` (64 bytes) | 32 bytes |
| `blake2b_256` | Epoch nonce (TICKN) | `eta_c \|\| prev_block_hash \|\| extra_entropy` (96 bytes) | 32 bytes |
| `blake2b_256` | KES leaf derivation | `"kes-leaf-" \|\| seed \|\| index` | 32 bytes (used as Ed25519 seed) |
| `blake2b_256` | Auxiliary data hash | Raw CBOR of auxiliary/metadata | 32 bytes |
| `blake2b_256` | Script data hash | Redeemers + datums + cost model encoding | 32 bytes |
| `blake2b_224` | Pool ID (issuer hash) | Pool operator verification key (32 bytes) | 28 bytes |
| `blake2b_224` | Payment key hash | Ed25519 payment verification key | 28 bytes |
| `blake2b_224` | Stake key hash | Ed25519 staking verification key | 28 bytes |
| `blake2b_224` | Plutus script hash | `version_prefix \|\| flat_bytes` | 28 bytes |
| `blake2b_224` | Native script hash | Serialized script CBOR | 28 bytes |
| SHA-512 | VRF internal | Hash-to-curve, nonce generation, proof-to-hash | 64 bytes (internal to VRF) |
| Ed25519 | Tx witness | Signs `blake2b_256(tx_body_raw)` | 64-byte signature |
| Ed25519 | Operational cert | Cold key signs KES hot key binding | 64-byte signature |
| Ed25519 | KES leaf | Leaf key signs raw header body CBOR | 64-byte signature (inside 448-byte KES sig) |

Note: SHA-512 is used only internally within the VRF implementation (hash-to-curve via Elligator2, nonce generation per RFC 8032, and proof-to-hash conversion). It is never called directly by application code.

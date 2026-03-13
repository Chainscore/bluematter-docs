# Serialization

Cardano has no canonical CBOR encoding. The same logical value may be encoded
in multiple valid byte representations that differ in integer widths, map key
ordering, and use of definite vs. indefinite length containers. Since
cryptographic hashes are computed over the raw wire bytes, the serialization
layer must preserve the original encoding exactly. This section specifies the
wire format, the byte-preservation architecture, and the hash computations.

---

## 3.1 CBOR Encoding and Byte Preservation

### 3.1.1 The Preservation Principle

Every hash in the system is computed on the original wire bytes as received
from the network. Bytes are never re-encoded through a CBOR library for
hashing purposes.

The schema system achieves this through three mechanisms:

1. **Raw byte slicing.** The `@cbor_array` and `@cbor_map` decorators on
   frozen dataclasses produce `from_cbor(data: bytes) -> T` class methods
   that slice child elements directly from the parent buffer. Each decoded
   type retains a `raw: bytes` field containing its original wire bytes.

2. **Offset-based walking.** The function `cbor_item_length(data, offset)`
   walks a CBOR structure to determine the byte boundary of an item without
   decoding its value. It handles all seven major types, indefinite-length
   containers, and nested tags, using offset arithmetic to avoid quadratic
   copying.

3. **Identity round-trip.** The `to_cbor()` method returns `self.raw`
   verbatim. No re-serialization ever occurs:
   ```
   cert = OperationalCert.from_cbor(wire_bytes)
   assert cert.to_cbor() == wire_bytes     -- always holds
   ```

### 3.1.2 Walking Primitives

Two primitives slice CBOR containers into their raw child elements:

```
_walk_array_items(data) -> List[B]
```

Given the raw CBOR encoding of an array (major type 4), returns a list of raw
byte slices, one per element. For definite-length arrays, the head declares the
count `n` and the function walks `n` items using `cbor_item_length`. For
indefinite-length arrays (info byte 31), it walks until the break byte `0xFF`.

```
_walk_map_values(data) -> Map[Any, B]
```

Given the raw CBOR encoding of a map (major type 5), returns a mapping from
decoded keys (typically small integers) to raw value byte slices. Duplicate
keys are rejected.

### 3.1.3 Field Decoding Dispatch

The `_decode_field(item_raw, annotation)` dispatcher routes raw bytes to the
appropriate decoder based on the Python type annotation:

| Annotation | Action |
|---|---|
| `bytes` | `cbor2.loads` then coerce to `bytes` |
| `int`, `str` | `cbor2.loads` |
| Schema type (has `from_cbor`) | `annotation.from_cbor(item_raw)` |
| `list[SchemaType]` | Walk array, call `from_cbor` on each element |
| `T \| None` | Unwrap optional, recurse on inner type |
| `set`, `list`, other | `cbor2.loads` fallback |

The CBOR null byte `0xF6` always maps to `None`.

### 3.1.4 Schema Decorators

**`@cbor_array`.** For types serialized as CBOR arrays. Fields map
positionally to array elements. The last field must be `raw: bytes`.

```
@cbor_array
@dataclass(frozen=True, slots=True)
class OperationalCert:
    hot_vkey: bytes            -- position 0
    sequence_number: int       -- position 1
    kes_period: int            -- position 2
    sigma: bytes               -- position 3
    raw: bytes                 -- original wire bytes (not a CBOR element)
```

**`@cbor_map`.** For types serialized as CBOR maps. Each field is declared
with `map_field(key, optional=...)` to bind it to an integer map key.

```
@cbor_map
@dataclass(frozen=True, slots=True)
class ConwayTxBody:
    inputs:  set         = map_field(0)
    outputs: list[TxOut] = map_field(1)
    fee:     int         = map_field(2)
    ttl:     int | None  = map_field(3, optional=True)
    ...
    raw: bytes
```

When `_strict_keys = True` is set on the class, unknown map keys trigger
an error. This is enabled for `ConwayTxBody`.

---

## 3.2 Block Wire Format

### 3.2.1 Envelope Structure

Blocks arrive from the BlockFetch mini-protocol wrapped in CBOR tag 24:

```
wire_block = #6.24(CBOR_encode(cardanoBlock))
```

The tag-24 wrapper contains a byte string whose contents are themselves valid
CBOR. Unwrapping extracts the inner byte string.

### 3.2.2 Era Tagging

```
cardanoBlock =
    byronBlock                   -- bare (no era wrapper)
  | [2, shelleyBlock]            -- Shelley
  | [3, allegraBlock]            -- Allegra
  | [4, maryBlock]               -- Mary
  | [5, alonzoBlock]             -- Alonzo
  | [6, babbageBlock]            -- Babbage
  | [7, conwayBlock]             -- Conway
```

Byron blocks have no era wrapper; they are distinguished by the structure of
their first element (a complex value rather than a small integer).

### 3.2.3 Conway Block Internal Structure

```
conwayBlock = [header, txBodies, witnesses, auxData, invalidTxs]
```

Each of the five elements is byte-sliced from the block data buffer using
`_walk_array_items`. The elements are never decoded and re-encoded. In
particular:

- `txBodies` is a CBOR array of CBOR maps (one per transaction body).
- `witnesses` is a CBOR array of CBOR maps (one per witness set).
- `auxData` is a CBOR map from transaction index to auxiliary data.
- `invalidTxs` is a CBOR array of unsigned integers (Phase-2 failed indices).

### 3.2.4 Header Wire Format

The header is a 2-element CBOR array:

```
header = [headerBody, kesSig]
```

The header body is a 10-element CBOR array:

```
headerBody = [
    blockNo,
    slot,
    prevHash,
    issuerVKey,
    vrfVKey,
    [vrfOutput, vrfProof],
    bodySize,
    bodyHash,
    [hotVKey, seqNo, kesPeriod, sigma],
    [major, minor]
]
```

---

## 3.3 Hash Computations

All hashes use Blake2b with the indicated digest size.

### 3.3.1 Block Hash

```
blockHash = blake2b_256(header_raw)
```

where `header_raw` is the raw CBOR bytes of the full header (both body and KES
signature), sliced from the block buffer.

### 3.3.2 Transaction Identifier

```
txId = blake2b_256(txBody_raw)
```

where `txBody_raw` is the raw CBOR map bytes of the transaction body, sliced
from the block's `txBodies` array.

### 3.3.3 Block Body Hash

The block body hash links the header to the block contents. It is computed as
a Merkle-like construction over the four body components:

```
h1 = blake2b_256(txBodies_array_raw)
h2 = blake2b_256(witnesses_array_raw)
h3 = blake2b_256(auxData_raw)
h4 = blake2b_256(invalidTxs_raw)

bodyHash = blake2b_256(h1 || h2 || h3 || h4)
```

Each `h_i` is 32 bytes, so the concatenation is exactly 128 bytes. The
computed hash is verified against `header.headerBody.blockBodyHash` during
block validation.

### 3.3.4 Pool Identifier

```
poolId = blake2b_224(issuer_vkey)
```

where `issuer_vkey` is the 32-byte cold verification key of the stake pool
operator.

### 3.3.5 Auxiliary Data Hash

```
auxDataHash = blake2b_256(auxData_raw)
```

Verified against `txBody.auxiliary_data_hash` (map key 7) when present.

### 3.3.6 Script Data Hash

The script data hash binds redeemers, datums, and cost models to the
transaction body:

```
scriptDataHash = blake2b_256(redeemers_raw || datums_raw || langViews)
```

where:

- `redeemers_raw` is the raw CBOR of witness key 5 (empty bytes if absent).
- `datums_raw` is the raw CBOR of witness key 4 (empty bytes if absent).
- `langViews` is the deterministic CBOR encoding of cost model arrays
  per Plutus language version used in the transaction.

**PlutusV1 language view quirk.** For language 0 (PlutusV1), the cost model
parameter list is first CBOR-encoded as an integer array, then that encoding
is wrapped as a CBOR byte string value in the outer map. For languages 1
(PlutusV2) and 2 (PlutusV3), cost model arrays are stored directly as CBOR
arrays. This asymmetry is mandated by the Shelley formal specification.

### 3.3.7 Script Hashing

Plutus scripts are identified by their hash:

```
scriptHash = blake2b_224(version_prefix || flat_bytes)
```

where `version_prefix` is a single byte: `0x01` for PlutusV1, `0x02` for
PlutusV2, `0x03` for PlutusV3. The `flat_bytes` are the `flat`-serialized
UPLC program (not CBOR).

---

## 3.4 Security Measures

The codec layer implements the following hardening measures against malformed
or adversarial CBOR input.

**COD-C1: Container count guard.** Before walking a CBOR array or map, the
declared item count is checked against the available data length. A container
claiming `n` items in only `k < n` bytes is rejected immediately, preventing
allocation of oversized buffers from a single crafted header byte.

**COD-M: Duplicate map key rejection.** `_walk_map_values` tracks seen keys
and rejects any CBOR map containing duplicate keys. This prevents ambiguity in
field resolution and potential double-counting attacks.

**COD-H2: NonEmpty container validation.** Transaction body fields at map keys
4, 5, 9, 13, 14, 19, 20 carry a NonEmpty constraint. If the field is present,
the container must have at least one element. Empty containers at these keys
are rejected during `ConwayTxBody.__post_init__`.

**COD-H3: Block structure count.** A Conway block must have exactly 5 array
elements. Any other count is rejected.

**COD-H4: Witness alignment.** The number of transaction bodies must equal the
number of witness sets. A mismatch is rejected.

**COD-M: Field size validation.** Header fields are checked for correct byte
lengths during construction: `issuer_vkey` (32), `vrf_vkey` (32),
`block_body_hash` (32), `vrf_result` (2 elements), `hot_vkey` (32 or 448),
`sigma` (64). Invalid sizes are rejected.

**COD-M: Semantic range checks.** Transaction body values are validated for
semantic correctness: `fee >= 0`, `donation > 0` when present,
`network_id in {0, 1}` when present. Invalid transaction indices in
`invalid_txs` are checked against the transaction count.

**COD-M: Block size limit.** The block envelope is rejected if it exceeds
256 KB (approximately 3x the mainnet maximum of ~90 KB).

**COD-L: Nesting depth limit.** CBOR walking functions enforce a maximum
nesting depth of 128 levels. The `cbor_item_length` function independently
enforces the same 128-level limit. Deeply nested structures (potential
stack-overflow vectors) are rejected.

**COD-M: Strict map keys.** When `_strict_keys = True` is set on a
`@cbor_map` class (as with `ConwayTxBody`), any map key not declared in the
schema triggers an error. This prevents silent acceptance of unknown fields.

---

## 3.5 Decoding Pipeline Summary

The full decode path from network bytes to typed structures:

```
wire_bytes
  -> unwrap_tag24 -> envelope_cbor
  -> _walk_array_items -> [era_tag_raw, block_data_raw]
```

For Conway (`era_tag = 7`):

```
block_data_raw
  -> _walk_array_items -> [header_raw, txBodies_raw, witnesses_raw, auxData_raw, invalidTxs_raw]
```

```
header_raw -> ConwayHeader.from_cbor -> ConwayHeader
```

```
txBodies_raw
  -> _walk_array_items -> [tb_0, ..., tb_n]
  -> ConwayTxBody.from_cbor each -> [ConwayTxBody_0, ..., ConwayTxBody_n]
```

At every step, the output retains a `.raw` field pointing into the original
buffer. No intermediate re-encoding occurs.

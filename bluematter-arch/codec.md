---
---
# Codec

## Overview

The codec module (`src/bluematter/codec/`) handles CBOR deserialization of Cardano blocks, headers, and transactions with strict byte preservation. Cardano has no canonical CBOR serialization -- the original bytes must be preserved verbatim because block hashes, transaction IDs, and body hashes are computed over the raw wire bytes. Re-encoding through a CBOR library would produce different bytes for non-canonical encodings, breaking all cryptographic verification. Every decoded type carries a `raw: bytes` field containing the exact wire bytes it was decoded from.

## Files

### `__init__.py`
Empty package marker.

### `cbor.py` (158 lines)
Low-level CBOR utilities: encoding, decoding, tag-24 unwrapping, and the critical `cbor_item_length` function.

- **`ensure_bytes(v)`** (line 15): Coerce `bytes | bytearray | memoryview` to plain `bytes`.
- **`decode(data)`** (line 20): Decode a CBOR byte string via `cbor2.loads`.
- **`decode_with_remainder(data)`** (line 25): Decode one CBOR item from the front of a buffer, returning `(value, remaining_bytes)`. Uses `cbor_item_length` to find the boundary since cbor2's C extension eagerly reads the entire buffer.
- **`encode(obj)`** (line 36): Encode a Python object to CBOR via `cbor2.dumps`.
- **`unwrap_tag24(data)`** (line 41): Unwrap `#6.24(bstr)` -- the standard envelope for blocks and headers on the wire. Raises `ValueError` if the input is not a tag-24 wrapper.
- **`cbor_item_length(data, offset=0, _depth=0)`** (line 55): Return the number of bytes consumed by the CBOR item at `offset`. This is the foundational primitive for byte-walking -- it handles all 8 major types, indefinite-length containers, nested structures (up to 128 levels), and provides extensive truncation detection. Uses offset-based access internally to avoid quadratic slicing.

### `schema.py` (437 lines)
Declarative CBOR schema system with `@cbor_array` and `@cbor_map` decorators for frozen dataclasses.

- **`_parse_cbor_head(data, offset=0)`** (line 44): Parse the head byte of a CBOR item, returning `(major_type, count_or_value, header_length)`.
- **`_walk_array_items(data, _depth=0)`** (line 89): Slice a CBOR array into a `list[bytes]` of raw element byte-strings. Each element is sliced directly from the input buffer.
- **`_walk_map_entries(data, _depth=0)`** (line 127): Slice a CBOR map into `list[tuple[bytes, bytes]]` of raw `(key, value)` byte-string pairs.
- **`_walk_map_values(data, _depth=0)`** (line 169): Slice a CBOR map into `{decoded_key: raw_value_bytes}`. Keys are decoded (typically small integers), values remain as raw byte slices. Rejects duplicate map keys (COD-M).
- **`_decode_field(item_raw, annotation)`** (line 222): Type-guided field decoder. Dispatches on annotation type: `bytes`, `int`, `str`, `Optional[X]`, schema types (calls `from_cbor`), `list[SchemaType]` (walks array and decodes each element), `set`, and generic fallback via `cbor2.loads`.
- **`map_field(key, *, optional=False)`** (line 269): Declare a CBOR map field with its integer key. Returns a `dataclasses.field` with metadata for `@cbor_map` to consume.
- **`cbor_array(cls)`** (line 293): Decorator that adds `from_cbor(data) -> Self` and `to_cbor() -> bytes` to a frozen dataclass. Fields map positionally to CBOR array elements. The class must have a `raw: bytes` field.
- **`cbor_map(cls)`** (line 354): Decorator for CBOR map-encoded types. Fields must use `map_field(key)`. Supports `_strict_keys = True` to reject unknown map keys.
- **`_resolve_hints(cls)`** (line 429): Resolve type hints for a class, handling forward references across modules.

### `block.py` (223 lines)
Block decoding: era detection, Conway full decode, pre-Conway opaque storage.

- **`MAX_BLOCK_SIZE`** (line 36): 256 KB size guard (approximately 3x actual mainnet max of ~90 KB).
- **`OpaqueBlock`** (line 38): Dataclass for pre-Conway blocks. Fields: `era`, `block_hash`, `raw`. Block hash is computable for chaining but internals are not parsed.
- **`ConwayBlock`** (line 50): Fully decoded Conway block. Fields: `header`, `transactions`, `tx_bodies_raw`, `tx_witnesses_raw`, `auxiliary_data_raw`, `invalid_txs`, `raw`, `tx_bodies_array_raw`, `tx_witnesses_array_raw`, `invalid_txs_raw`. Properties: `block_hash`, `slot`, `block_number`.
- **`Block`** (line 80): Type alias `ConwayBlock | OpaqueBlock`.
- **`decode_block(envelope_cbor)`** (line 83): Main entry point. Walks the `[era_tag, block_data]` envelope, detects era, returns `ConwayBlock` for era 7 or `OpaqueBlock` for everything else.
- **`_decode_conway_block(block_data_raw, envelope_cbor)`** (line 139): Internal Conway decode. Walks the 5-element block array `[header, tx_bodies, tx_witnesses, auxiliary_data, invalid_txs]`, validates structural properties, decodes all components from byte-sliced raw data.
- **`decode_block_from_wire(wire_bytes)`** (line 209): Entry point for bytes received from blockfetch. Unwraps tag-24 envelope, then calls `decode_block`.

### `header.py` (120 lines)
Conway block header types: `OperationalCert`, `ConwayHeaderBody`, `ConwayHeader`.

- **`OperationalCert`** (line 33): `@cbor_array` dataclass. Fields: `hot_vkey` (32 bytes, KES verification key), `sequence_number`, `kes_period`, `sigma` (64 bytes, Ed25519 signature), `raw`. Post-init validates field sizes.
- **`ConwayHeaderBody`** (line 59): `@cbor_array` dataclass. The 10-element header body array. Fields: `block_number`, `slot`, `prev_hash` (None for genesis), `issuer_vkey` (32 bytes), `vrf_vkey` (32 bytes), `vrf_result` (`[vrf_output, vrf_proof]`), `block_body_size`, `block_body_hash` (32 bytes), `operational_cert` (nested schema type), `protocol_version` (`[major, minor]`), `raw`. Post-init validates all field sizes and structural constraints.
- **`ConwayHeader`** (line 98): `@cbor_array` dataclass. `[header_body, body_signature]`. Properties: `block_hash` (blake2b_256 of `self.raw`), `slot`, `block_number`, `prev_hash`.

### `transaction.py` (283 lines)
Conway transaction types: `TxIn`, `TxOut`, `ConwayTxBody`.

- **`TxIn`** (line 51): `@cbor_array` dataclass. Fields: `tx_hash` (32 bytes), `output_index`, `raw`.
- **`TxOut`** (line 59): Custom `from_cbor` (not decorator-based) handling both legacy array format `[address, amount, ?datum_hash]` and post-Alonzo map format `{0: address, 1: amount, 2: datum_option, 3: script_ref}`. Fields: `address`, `amount` (Value type), `datum_hash`, `inline_datum` (raw CBOR of inline datum), `script_ref` (raw CBOR of script reference), `raw`. Includes `__getstate__`/`__setstate__` for pickle backward compatibility across 5-field and 6-field formats.
- **`ConwayTxBody`** (line 228): `@cbor_map` dataclass with `_strict_keys = True`. 3 required fields (inputs key 0, outputs key 1, fee key 2) and 17 optional fields (keys 3-22). Post-init validates: non-negative fee, positive donation, valid network_id (0 or 1), and non-empty container constraint for keys 4, 5, 9, 13, 14, 19, 20. Property: `tx_id` = `blake2b_256(self.raw)`.

### `era.py` (35 lines)
Era enumeration and wire-format tag mappings.

- **`Era`** (line 16): IntEnum with values BYRON=0 through CONWAY=6.
- **`_BLOCK_TAG_TO_ERA`** (line 28): Maps block-envelope wire tags (2-7) to `Era` values. Byron blocks have no era wrapper on the wire.
- Documents the two different era-tag schemes: block envelope (Byron=bare, Shelley=2..Conway=7) vs header envelope in chainsync (Byron=0, Shelley=1..Conway=6).

## Core Design: Byte-Preserving CBOR Schema

### How It Works

The schema system uses byte-walking rather than decode-reencode. The process is:

1. **`cbor_item_length(data, offset)`** calculates the exact byte length of a CBOR item at a given offset by parsing CBOR headers and recursively walking nested structures. It never decodes values -- it only counts bytes.

2. **`_walk_array_items(data)`** uses `cbor_item_length` to slice a CBOR array into individual element byte strings. For an array `[A, B, C]`, it returns `[raw_bytes_of_A, raw_bytes_of_B, raw_bytes_of_C]` where each slice is taken directly from the input buffer.

3. **`_walk_map_values(data)`** does the same for maps, returning `{decoded_key: raw_value_bytes}`.

4. The `@cbor_array` decorator generates a `from_cbor(data)` classmethod that:
   - Calls `_walk_array_items` to get raw byte slices for each positional element
   - Calls `_decode_field` on each slice, guided by the field's type annotation
   - For nested schema types (e.g., `OperationalCert`), `_decode_field` calls `annotation.from_cbor(raw_slice)` recursively
   - Stores the entire input as `self.raw`

5. The `@cbor_map` decorator does the same but matches by integer key rather than position.

6. `to_cbor()` simply returns `self.raw` -- the original wire bytes.

### Why It Matters

Cardano computes cryptographic hashes over original CBOR bytes:
- **Block hash** = `blake2b_256(raw header CBOR)`
- **Transaction ID** = `blake2b_256(raw tx body CBOR)`
- **Block body hash** = `blake2b_256(raw body components)`

CBOR allows multiple valid encodings for the same value (e.g., different integer widths, definite vs. indefinite length containers). If a decoder round-trips through `cbor2.loads` + `cbor2.dumps`, the re-encoded bytes may differ from the original, producing wrong hashes. The byte-walking approach guarantees hash fidelity.

### How to Define a New Schema Type

```python
from dataclasses import dataclass, field
from bluematter.codec.schema import cbor_array, cbor_map, map_field

# Array-encoded type (positional fields):
@cbor_array
@dataclass(frozen=True, slots=True)
class MyArrayType:
    first_field: int
    second_field: bytes
    nested_field: OperationalCert  # nested schema type decoded via from_cbor
    raw: bytes = field(default=b"", repr=False, compare=False)

# Map-encoded type (keyed fields):
@cbor_map
@dataclass(frozen=True, slots=True)
class MyMapType:
    required_field: int    = map_field(0)
    optional_field: bytes | None = map_field(3, optional=True)
    raw: bytes = field(default=b"", repr=False, compare=False)
```

Rules:
- Apply `@cbor_array` or `@cbor_map` **outside** `@dataclass(frozen=True, slots=True)`.
- Always include a `raw: bytes` field (with default `b""`) as the last field.
- For `@cbor_map`, every non-raw field must use `map_field(key)`.
- Type annotations drive decoding: `bytes`, `int`, `str` are decoded directly; schema types call `from_cbor`; `list[SchemaType]` walks the array and decodes each element; `Optional[X]` unwraps and decodes as `X`.

## Data Flow

How raw block bytes flow through the codec:

```
Network (blockfetch)
    |
    v
wire_bytes: #6.24(bytes .cbor [era_tag, block_data])
    |
    | decode_block_from_wire()
    v
unwrap_tag24() --> envelope_cbor: [era_tag, block_data]
    |
    | decode_block()
    v
_walk_array_items(envelope_cbor) --> [era_tag_raw, block_data_raw]
    |
    | cbor2.loads(era_tag_raw) --> era detection
    v
era != 7: OpaqueBlock(era, block_hash, raw)
era == 7: _decode_conway_block(block_data_raw, envelope_cbor)
    |
    v
_walk_array_items(block_data_raw)
    --> [header_raw, tx_bodies_raw, witnesses_raw, aux_raw, invalid_raw]
    |
    | ConwayHeader.from_cbor(header_raw)
    |   --> _walk_array_items --> [header_body_raw, body_sig_raw]
    |       --> ConwayHeaderBody.from_cbor(header_body_raw)
    |           --> 10 fields decoded positionally
    |           --> OperationalCert.from_cbor(cert_raw) [nested]
    |
    | _walk_array_items(tx_bodies_raw) --> per-tx raw bytes
    |   --> ConwayTxBody.from_cbor(tx_raw) for each
    |       --> _walk_map_values --> {0: inputs_raw, 1: outputs_raw, 2: fee_raw, ...}
    |       --> _decode_field on each value
    |       --> TxOut.from_cbor for outputs (array or map format)
    |
    v
ConwayBlock(header, transactions, tx_bodies_raw, ...)
```

At every level, raw bytes are sliced from the parent buffer via `_walk_array_items` or `_walk_map_values`. No intermediate re-encoding ever occurs.

## Key Types

### `ConwayBlock`
The top-level decoded block. Contains the fully decoded `header` and `transactions`, plus raw byte arrays for each block component (needed for body hash verification and witness processing). The `block_hash` and `slot` are convenience properties delegating to the header.

### `ConwayHeader`
A 2-element array `[header_body, body_signature]`. The `block_hash` property computes `blake2b_256(self.raw)` -- the hash is always over the original wire bytes of the full header (body + signature together).

### `ConwayHeaderBody`
A 10-element array containing all header metadata: block number, slot, previous block hash, issuer verification key, VRF key, VRF result (output + proof), block body size, block body hash, operational certificate, and protocol version.

### `ConwayTxBody`
A CBOR map with 3 required keys (inputs, outputs, fee) and 17 optional keys covering the full Conway transaction body specification. The `tx_id` property computes `blake2b_256(self.raw)`. Strict key mode (`_strict_keys = True`) rejects any unknown map keys.

### `TxOut`
A transaction output with custom decoding to handle both the legacy array format (pre-Babbage) and the post-Alonzo map format. Supports datum-by-hash (key 2, variant 0), inline datum (key 2, variant 1 with tag-24 wrapper), and script references (key 3).

### `TxIn`
A transaction input: `[tx_hash, output_index]` referencing a previous output.

### `OperationalCert`
The block producer's operational certificate: `[hot_vkey, sequence_number, kes_period, sigma]`. The hot verification key is the KES key; sigma is the cold key's Ed25519 signature over the hot key.

## Security Hardening

### CBOR Count Guard (DoS Prevention)
**COD-C1** (cbor.py lines 127-132, schema.py lines 115-119): Before iterating over a CBOR array or map, the declared item count is checked against the total data size. Since each CBOR item is at least 1 byte, a container claiming more items than bytes available is immediately rejected. This prevents amplification attacks where a tiny payload claims billions of items.

### Nesting Depth Limit
(cbor.py line 62-63, schema.py line 98-99): CBOR nesting is limited to 128 levels (`_depth > 128`). Deeply nested structures that could cause stack overflow are rejected.

### Offset-Based Walking (No Quadratic Slicing)
`cbor_item_length` and all `_walk_*` functions use absolute offset tracking internally (`pos` variable) rather than creating new `data[n:]` slices at each step. This prevents O(n^2) memory behavior on large containers.

### Duplicate Map Key Detection
**COD-M** (schema.py lines 179-182): `_walk_map_values` maintains a `seen_keys` set and raises `ValueError` on any duplicate raw key bytes. This prevents ambiguous decoding and potential logic bugs from maps with repeated keys.

### NonEmpty Field Validation
**COD-H2** (transaction.py lines 206-207, 270-278): Transaction body fields that are constrained to be non-empty when present (certificates, withdrawals, mint, collateral, required_signers, voting_procedures, proposal_procedures) are validated in `__post_init__`. An empty container for these keys raises `ValueError`.

### Field Size Validation
(header.py lines 42-54, 74-93): `OperationalCert.__post_init__` validates that `hot_vkey` is 32 bytes (or 448 for composite KES) and `sigma` is 64 bytes. `ConwayHeaderBody.__post_init__` validates `issuer_vkey` (32), `vrf_vkey` (32), `block_body_hash` (32), `vrf_result` length (2), and `protocol_version` length (2).

### Strict Map Keys
(schema.py lines 384-397, transaction.py line 223): `ConwayTxBody` sets `_strict_keys = True`, causing the `@cbor_map` decoder to reject any map key not declared in the schema. This prevents unexpected data from silently passing through.

### Block Size Limit
(block.py lines 34-36, 94-97): `MAX_BLOCK_SIZE = 256 * 1024` bytes. Both `decode_block` and `decode_block_from_wire` reject inputs exceeding this limit before any parsing begins.

### Invalid Transaction Index Bounds Check
**COD-M** (block.py lines 187-193): After decoding the `invalid_txs` list, each index is checked against the actual number of transactions in the block. Out-of-range indices raise `ValueError`.

### Transaction Body Requirements
(transaction.py lines 256-278): `ConwayTxBody.__post_init__` validates: fee is non-negative, donation is positive when present, network_id is 0 or 1 when present, and non-empty container constraints.

### Body/Witness Count Alignment
**COD-H4** (block.py lines 169-174): The number of transaction bodies must equal the number of witness sets in a block. A mismatch raises `ValueError`.

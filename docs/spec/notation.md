# Notation

This chapter establishes the notation, type conventions, and inference rule
format used throughout this specification. We aim for precision without
sacrificing readability: every symbol is defined exactly once, and we prefer
short names that remain unambiguous in context.

---

## 0.1 Type Notation

We write types in a lightweight algebraic style. Primitive types are single
uppercase letters; composite types are built from them with standard
constructors.

| Symbol | Meaning |
|--------|---------|
| `B` | Byte string of arbitrary length |
| `B_n` | Byte string of exactly *n* bytes |
| `N` | Natural numbers (non-negative integers, `{0, 1, 2, ...}`) |
| `Z` | Integers (`{..., -2, -1, 0, 1, 2, ...}`) |
| `Bool` | Boolean (`True` or `False`) |
| `H` | 32-byte hash digest (Blake2b-256 output), equivalent to `B_32` |
| `H_28` | 28-byte hash digest (Blake2b-224 output), equivalent to `B_28` |

Composite type constructors:

| Constructor | Meaning | Example |
|-------------|---------|---------|
| `S[T]` | Finite set of elements of type *T* | `S[TxIn]` -- a set of transaction inputs |
| `M[K, V]` | Finite map from keys *K* to values *V* | `M[TxIn, TxOut]` -- the UTxO map |
| `L[T]` | Ordered list (sequence) of elements of type *T* | `L[Tx]` -- list of transactions in a block |
| `T?` | Optional: either a value of type *T* or absent (`bottom`) | `H?` -- an optional hash |
| `(A, B)` | Ordered pair (2-tuple) | `(N, H)` -- a slot-hash pair (a "point") |
| `(A, B, C)` | Ordered triple, and so on for larger tuples | `(B_32, N, N)` -- an operational cert triple |

When a type appears as a subscript, it constrains the enclosing value. For
instance, `sigma : M[TxIn, TxOut]` declares that `sigma` is a map from
transaction inputs to transaction outputs.

**Unit and Bottom.** We write `()` for the unit type (a type with one
value, carrying no information) and `bottom` for the absence of a value.
`T?` is syntactic sugar for `T | bottom`.

---

## 0.2 Common Symbols

The following symbols appear throughout the specification. Where a symbol
carries subscripts, its family of variants is listed.

### State and Structure

| Symbol | Type | Meaning |
|--------|------|---------|
| `sigma` | `LedgerState` | The ledger state (UTxO set, accounts, pools, etc.) |
| `beta` | `Block` | A block (header + body) |
| `tau` | `Tx` | A transaction |
| `pi` | `ProtocolParams` | Protocol parameters |
| `epsilon` | `N` | Epoch number |
| `s` | `N` | Slot number |
| `Delta` | -- | Change/delta (used as prefix: `Delta_r` = change in reserves) |

### Consensus

| Symbol | Type | Meaning |
|--------|------|---------|
| `eta` | `H` | Nonce (32-byte hash) |
| `eta_0` | `H` | Epoch nonce (drives the leader schedule for the current epoch) |
| `eta_v` | `H` | Evolving nonce (updated every block from VRF output) |
| `eta_c` | `H` | Candidate nonce (tracks `eta_v` then freezes at stability window) |
| `eta_h` | `H` | Previous epoch's last block hash (anchors epoch transition) |
| `eta_e` | `H` | Extra entropy (from protocol parameter update, or neutral nonce) |
| `f` | `Fraction` | Active slot coefficient (probability a slot has a leader) |
| `k` | `N` | Security parameter (chain stability depth) |
| `sigma_pool` | `Fraction` | Pool's relative stake (fraction of active stake) |

### Cryptographic Values

| Symbol | Type | Meaning |
|--------|------|---------|
| `vk` | `B_32` | Ed25519 verification (public) key |
| `sk` | `B_64` | Ed25519 signing (secret) key |
| `sig` | `B_64` | Ed25519 signature |
| `vk_vrf` | `B_32` | VRF verification key |
| `pi_vrf` | `B_80` | VRF proof |
| `beta_vrf` | `B_64` | VRF output (raw) |
| `vk_kes` | `B_32` | KES verification key (Merkle root) |
| `sig_kes` | `B_448` | KES signature (Sum6KES) |

---

## 0.3 Functions and Operators

### Hash Functions

```
H_256 : B -> B_32       Blake2b-256 (32-byte digest)
H_224 : B -> B_28       Blake2b-224 (28-byte digest)
```

Both are instances of the Blake2b family with the digest size as the only
parameter. No key, salt, or personalization is used.

### Binary Operators

| Notation | Meaning |
|----------|---------|
| `a \|\| b` | Byte concatenation of `a` and `b` |
| `a + b` | Arithmetic addition (on `N`, `Z`, or multi-asset values) |
| `a - b` | Arithmetic subtraction |
| `S_1 union S_2` | Set union |
| `S_1 intersect S_2` | Set intersection |
| `S_1 \ S_2` | Set difference (`S_1` minus elements in `S_2`) |
| `M_1 union_left M_2` | Left-biased map union (keys in `M_1` take precedence) |
| `M restrict S` | Map domain restriction (`M` restricted to keys in `S`) |
| `M exclude S` | Map domain exclusion (`M` with keys in `S` removed) |

### Numeric Functions

| Notation | Meaning |
|----------|---------|
| `ceil(x)` | Ceiling: smallest integer >= `x` |
| `floor(x)` | Floor: largest integer <= `x` |
| `min(a, b)` | Minimum of `a` and `b` |
| `max(a, b)` | Maximum of `a` and `b` |
| `abs(x)` | Absolute value of `x` |

### Collection Functions

| Notation | Meaning |
|----------|---------|
| `\|S\|` | Cardinality (number of elements) of set or list `S` |
| `dom(M)` | Domain (set of keys) of map `M` |
| `rng(M)` | Range (set of values) of map `M` |
| `M(k)` | Lookup: value associated with key `k` in map `M` |
| `M{k -> v}` | Map update: `M` with key `k` mapped to value `v` |

---

## 0.4 State Transition Notation

The specification defines the Cardano ledger as a state machine. State
transitions are expressed as inference rules in natural-deduction style.

### Block-Level Transition

```
sigma ->_beta sigma'
```

Read: "Ledger state `sigma` transitions to `sigma'` when block `beta` is
applied." This is the top-level rule; it decomposes into per-transaction
rules.

### Transaction-Level Transition

```
Gamma |- sigma ->_tau sigma'
```

Read: "Under environment `Gamma`, ledger state `sigma` transitions to
`sigma'` via transaction `tau`." The environment `Gamma` carries read-only
context (protocol parameters, slot number, epoch) that the transaction
rules consult but do not modify.

### Inference Rules

Rules are written as inference rules with premises above a horizontal
line and the conclusion below:

```
    premise_1    premise_2    ...    premise_n
  ------------------------------------------------- [RULE-NAME]
                    conclusion
```

Each premise is either a predicate (a boolean condition that must hold),
a sub-transition (invoking another rule), or a binding (defining an
intermediate value). The rule name in brackets serves as a reference label.

**Example.** A simplified UTxO consumption rule:

```
    txIn in dom(sigma.utxo)
    txOut = sigma.utxo(txIn)
  ---------------------------------------- [UTXO-INPUT]
    sigma' = sigma { utxo = sigma.utxo exclude {txIn} }
```

This reads: "If `txIn` exists in the UTxO set, look up its output `txOut`,
and produce a new state `sigma'` identical to `sigma` except that `txIn`
is removed from the UTxO map."

### Environment Structure

The environment `Gamma` is an immutable record:

```
Gamma = {
    slot       : N,                -- current slot number
    epoch      : N,                -- current epoch number
    pp         : ProtocolParams,   -- active protocol parameters
    genDelegs  : M[H_28, H_28],   -- genesis delegation map
    poolParams : M[H_28, PoolParams]  -- registered pool parameters
}
```

### Sequencing

When a block contains multiple transactions `[tau_0, tau_1, ..., tau_n]`,
they are applied sequentially, threading the state:

```
    Gamma |- sigma_0 ->_{tau_0} sigma_1
    Gamma |- sigma_1 ->_{tau_1} sigma_2
    ...
    Gamma |- sigma_{n-1} ->_{tau_n} sigma_n
  ------------------------------------------------- [BLOCK-TXS]
    sigma_0 ->_{[tau_0,...,tau_n]} sigma_n
```

If any individual transaction fails validation, the block is invalid and
the entire state transition is rejected (no partial application).

---

## 0.5 Serialization Conventions

All on-chain data is serialized as CBOR (Concise Binary Object
Representation, RFC 8949). We write `CBOR(x)` for the canonical CBOR
encoding of value `x`. Key conventions:

- **Transaction ID**: `H_256(CBOR(tx_body))` -- the hash of the CBOR-encoded
  transaction body, not the full transaction.
- **Block hash**: `H_256(CBOR(header))` -- the hash of the CBOR-encoded
  full header (body + KES signature).
- **Pool ID**: `H_224(issuer_vkey)` -- the 28-byte hash of the pool
  operator's cold verification key.
- **Script hash**: `H_224(version_prefix || flat_bytes)` -- the 28-byte
  hash of a version byte concatenated with the Plutus flat-encoded script.

CBOR maps use integer keys (not string keys) for all transaction body
fields, following the Shelley-era CDDL specification.

---

## 0.6 Numeric Precision

Lovelace quantities are natural numbers (`N`). One ADA = 1,000,000
lovelace. The maximum supply is 45 * 10^15 lovelace, which fits in a
64-bit unsigned integer.

Fractional computations (leader threshold, reward calculations) use
exact rational arithmetic (`Fraction` in the implementation) to avoid
floating-point precision loss at decision boundaries. The leader
eligibility threshold, for instance, requires precision beyond 2^-256.

---

## 0.7 Naming Conventions

Where this specification uses Greek letters, the implementation uses
descriptive English names. The mapping is:

| Spec Symbol | Implementation Name | Module |
|-------------|-------------------|--------|
| `sigma` | `LedgerState` | `ledger/state.py` |
| `tau` | `ConwayTx` | `codec/transaction.py` |
| `beta` | `ConwayBlock` | `codec/block.py` |
| `pi` | `ProtocolParameters` | `ledger/protocol_params.py` |
| `eta_v` | `NonceState.evolving_nonce` | `consensus/nonce.py` |
| `eta_c` | `NonceState.candidate_nonce` | `consensus/nonce.py` |
| `eta_0` | `NonceState.epoch_nonce` | `consensus/nonce.py` |
| `f` | `active_slot_coeff` | `consensus/leader.py` |
| `k` | `security_param` | `config/genesis.py` |

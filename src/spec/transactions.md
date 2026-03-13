# 5. Transaction Validation

This chapter defines the two phases of transaction validation: Phase-1
(structural UTxO rules) and Phase-1W (witness rules).  Phase-2 (Plutus
script evaluation) is covered in Chapter 7.  All predicates correspond
to `bluematter/ledger/rules/utxo.py` and `bluematter/ledger/rules/utxow.py`.

The validation function signatures are:

```
validate_utxo  : (pi, sigma, tau, s) -> L[str]      -- returns [] on success
validate_witnesses : (tau, W, U, aux?, raw?, pi?) -> L[str]
```

where `pi` is `ProtocolParameters`, `sigma` is `LedgerState`, `tau` is
`ConwayTxBody`, `s` is the current slot, `W` is the decoded witness map,
`U` is the UTxO set, `aux` is optional auxiliary data raw bytes, and
`raw` is the raw witness CBOR.

---

## 5.1 Phase-1 Validation (UTxO Rules)

The following rules are checked by `validate_utxo(pi, sigma, tau, s)`.
Each rule is stated as a predicate that must hold; violation produces an
error string in the returned list.

### Rule 1 -- Non-empty inputs

```
tau.inputs != emptyset
```

A transaction must consume at least one input.

### Rule 2 -- Inputs exist in UTxO

```
forall inp in tau.inputs:
  input_key(inp) in dom(sigma.utxo)
```

Every declared input must reference an existing unspent output.

### Rule 3 -- Minimum fee

```
tau.fee >= min_fee(pi, tau, sigma)
```

where

```
min_fee(pi, tau, sigma) =
  pi.min_fee_a * |tau.raw| + pi.min_fee_b
  + ref_script_fee(pi, tau, sigma)
  + script_exec_fee(pi, tau)
```

The **reference script fee** (Conway CIP-69) is:

```
ref_script_fee(pi, tau, sigma) =
  if tau.reference_inputs = None: 0
  else:
    let (num, den) = pi.min_fee_ref_script_per_byte
        ref_size = sum { |sigma.utxo[input_key(inp)].script_ref|
                       | inp in tau.reference_inputs,
                         input_key(inp) in dom(sigma.utxo),
                         sigma.utxo[input_key(inp)].script_ref != None }
    in  ref_size * num / den        -- integer division
```

The **script execution fee** is:

```
script_exec_fee(pi, tau) =
  if pi.price_mem = None: 0
  else:
    let (total_mem, total_steps) = sum_redeemer_ex_units(tau)
        (mem_num, mem_den) = pi.price_mem
        (step_num, step_den) = pi.price_step
    in  ceil( (mem_num * total_mem * step_den + step_num * total_steps * mem_den)
              / (mem_den * step_den) )
```

The ceiling function is:

```
ceil(n, d) = (n + d - 1) / d       -- integer division, d > 0
```

**Implementation note.** In the current implementation, `_sum_redeemer_ex_units`
returns `(0, 0)` during Phase-1 validation because the witness set is not
directly accessible from the UTXO validator.  Actual execution unit
enforcement occurs during Phase-2 script evaluation.

### Rule 4 -- ExUnit budget

```
if pi.max_tx_ex_units != None:
  let (total_mem, total_steps) = sum_redeemer_ex_units(tau)
      (max_mem, max_steps) = pi.max_tx_ex_units
  in  total_mem <= max_mem AND total_steps <= max_steps
```

### Rule 5 -- No ADA minting

```
if tau.mint != None:
  b"" not in dom(tau.mint)  AND  bytes(28) not in dom(tau.mint)
```

The empty policy ID and the zero-filled 28-byte policy ID both represent
the ADA pseudo-policy.  Minting or burning ADA is prohibited.

### Rule 6 -- Value conservation

```
consumed(sigma, tau) = produced(tau, pi, sigma)
```

where

```
consumed(sigma, tau) =
  balance_inputs(sigma.utxo, tau)
  + sum_withdrawals(tau)
  + mint_value(tau)

produced(tau, pi, sigma) =
  balance_outputs(tau)
  + tau.fee
  + deposits(pi, tau, sigma)
  + proposal_deposits(tau)
  + coalesce(tau.treasury, 0)
  + coalesce(tau.donation, 0)
```

The component functions are:

```
balance_inputs(U, tau) = value_add over { extract_value(U[input_key(inp)])
                                        | inp in tau.inputs,
                                          input_key(inp) in dom(U) }

balance_outputs(tau) = value_add over { extract_value(out) | out in tau.outputs }

sum_withdrawals(tau) =
  if tau.withdrawals = None: 0
  else: sum { amt | (_, amt) in tau.withdrawals }

mint_value(tau) =
  if tau.mint = None: 0
  else: [0, tau.mint]                -- lovelace = 0, multi-asset = mint map

proposal_deposits(tau) =
  if tau.proposal_procedures = None: 0
  else: sum { p[0] | p in tau.proposal_procedures,
              p is list/tuple, |p| >= 1, p[0] in N }
```

The `deposits` function is defined in Section 4.8.1.

Conservation is checked by computing `value_sub(consumed, produced)` and
verifying the result is zero.  If `value_sub` raises (any component goes
negative), conservation fails.

### Rule 7 -- TTL (validity upper bound)

```
if tau.ttl != None:
  s <= tau.ttl
```

The current slot must not exceed the transaction's time-to-live.

### Rule 8 -- Validity start (lower bound)

```
if tau.validity_start != None:
  s >= tau.validity_start
```

The current slot must be at or past the declared validity start.

### Rule 9 -- Output minimum UTxO value

```
forall i in 0..|tau.outputs|-1:
  lovelace(tau.outputs[i].amount) >= min_utxo(pi, tau.outputs[i])
```

where

```
min_utxo(pi, out) = (|out.raw| + 160) * pi.lovelace_per_utxo_byte
```

The 160-byte overhead accounts for UTxO entry metadata (key bytes, map
structure).  `|out.raw|` is the serialised size of the output CBOR.

### Rule 10 -- Maximum transaction size

```
|tau.raw| <= pi.max_tx_size
```

### Rule 11 -- Transaction network ID

```
if tau.network_id != None AND sigma.network_id != None:
  tau.network_id = sigma.network_id
```

### Rule 12 -- Maximum value size per output

```
forall i in 0..|tau.outputs|-1:
  cbor_size(tau.outputs[i].amount) <= pi.max_value_size
```

where `cbor_size(v)` is the length of `cbor2.dumps(v)`.

### Rule 13 -- Per-output address network ID

```
if sigma.network_id != None:
  forall i in 0..|tau.outputs|-1:
    let addr = tau.outputs[i].address
    if |addr| > 0 AND (addr[0] >> 4) < 8:        -- Shelley address types 0-7
      addr[0] AND 0x0F = sigma.network_id
```

Byron addresses (header type >= 8) are exempt from this check.

### Rule 14 -- Collateral return output validation

```
if tau.collateral_return != None:
  let cr = tau.collateral_return
  -- min UTxO check
  lovelace(extract_value(cr)) >= min_utxo(pi, cr)
  -- max value size check
  cbor_size(extract_value(cr)) <= pi.max_value_size
```

The collateral return output is subject to the same minimum UTxO and
maximum value size constraints as regular outputs.

### Rule 15 -- Reference inputs exist

```
if tau.reference_inputs != None:
  forall inp in tau.reference_inputs:
    input_key(inp) in dom(sigma.utxo)
```

Reference inputs must exist but are not consumed.  Reference inputs
*may* overlap with spend inputs (Babbage specification).

### Rule 16 -- Maximum collateral inputs

```
if tau.collateral != None:
  |tau.collateral| <= pi.max_collateral_inputs
```

### Rule 17 -- Collateral address constraints

```
if tau.collateral != None:
  forall inp in tau.collateral:
    let k = input_key(inp)
    -- Must exist
    k in dom(sigma.utxo)
    -- Must be at a Shelley VKey address (not Byron, not script)
    let addr = sigma.utxo[k].address
    let header_type = (addr[0] >> 4) AND 0x0F
    header_type < 8                               -- not Byron
    (addr[0] AND 0x10) = 0                        -- not script (bit 4 = 0)
```

Collateral inputs must reside at Shelley verification-key addresses.
Byron bootstrap addresses and script-locked addresses are rejected.

### Rule 18 -- Collateral sufficiency

```
if tau.collateral != None:
  -- Compute net collateral
  let coll_total = value_add over { extract_value(sigma.utxo[input_key(inp)])
                                  | inp in tau.collateral,
                                    input_key(inp) in dom(sigma.utxo) }
  let net = if tau.collateral_return != None
            then value_sub(coll_total, extract_value(tau.collateral_return))
            else coll_total

  -- ADA-only constraint: net collateral must contain no multi-assets
  multiasset(net) = {}

  -- Minimum collateral
  let min_coll = ceil(tau.fee * pi.collateral_percentage, 100)
  let actual = if tau.total_collateral != None
               then tau.total_collateral
               else lovelace(net)
  actual >= min_coll
```

The ceiling division is `ceil(n, d) = (n + d - 1) / d`.

**Note on `total_collateral`.** When the transaction declares an explicit
`total_collateral` field (key 17), that declared value is used for the
sufficiency check rather than the computed net.  This allows the
transaction builder to over-collateralise and route the excess via the
collateral return output.

### Rule 19 -- Withdrawal amount correctness

```
if tau.withdrawals != None:
  forall (reward_addr, wdrl_amount) in tau.withdrawals:
    let cred = reward_addr[1:29]
    -- Credential must be registered
    cred in dom(sigma.accounts)
    -- Withdrawal must drain the full reward balance
    wdrl_amount = sigma.accounts[cred].rewards
```

Partial withdrawals are not permitted.  The declared withdrawal amount
must exactly equal the account's current reward balance.

---

## 5.2 Witness Validation (UTxOW Rules)

Witness validation is performed by `validate_witnesses(tau, W, U, aux?, raw?, pi?)`.
The decoded witness set `W` is a map with integer keys:

| Key | Name | Type |
|-----|------|------|
| 0 | `vkey_witnesses` | `L[(B_32, B_64)]` -- (vkey, signature) pairs |
| 1 | `native_scripts` | `L[B]` |
| 2 | `bootstrap_witnesses` | `L[...]` |
| 3 | `plutus_v1_scripts` | `L[B]` |
| 4 | `plutus_data` | `L[PlutusData]` |
| 5 | `redeemers` | redeemer structure |
| 6 | `plutus_v2_scripts` | `L[B]` |
| 7 | `plutus_v3_scripts` | `L[B]` |

### 5.2.1 VKey Signature Verification

```
verified_keys : S[B_28] = {}
forall (vk, sig) in W[0]:
  if Ed25519_Verify(vk, tau.tx_id, sig):
    verified_keys = verified_keys U { H_224(vk) }
  else:
    ERROR("Invalid VKey signature")
```

Each verification key witness `(vk, sig)` is verified against the
transaction body hash `tau.tx_id = H_256(tau.raw)`.  The key hash
`H_224(vk)` is recorded for subsequent required-signer checks.

### 5.2.2 Required Key Hashes

The set of key hashes that must have valid witnesses is:

```
required(tau, U) = input_keys(tau, U)
                 U withdrawal_keys(tau)
                 U cert_keys(tau)
                 U explicit_required(tau)
                 U collateral_keys(tau, U)
```

Each component is defined below.

**Input keys.** For each spend input, extract the payment credential from
the UTxO output's address.  Only verification-key credentials (bit 4 of
header byte = 0) require witnesses.

```
input_keys(tau, U) =
  { payment_cred(U[input_key(inp)].address)
  | inp in tau.inputs,
    input_key(inp) in dom(U),
    is_vkey_cred(U[input_key(inp)].address) }
```

**Payment credential extraction:**

```
payment_cred(addr) =
  if |addr| < 29: None
  let header_type = (addr[0] >> 4) AND 0x0F
  if header_type > 7: None               -- Byron or reward address
  let cred = addr[1:29]
  let is_key = (addr[0] AND 0x10) = 0
  return (cred, is_key)
```

**Withdrawal keys.** For each withdrawal, the staking credential from the
reward address requires a witness if it is a verification-key credential.

```
withdrawal_keys(tau) =
  { addr[1:29]
  | (addr, _) in tau.withdrawals,
    |addr| >= 29,
    (addr[0] AND 0x10) = 0 }             -- bit 4 = 0 means key hash
```

**Certificate keys.** Certain certificate types require witnesses from
the credential or pool operator.

```
cert_keys(tau) = U { cert_witness(c) | c in tau.certificates }

cert_witness(c) =
  | extract_key_cred(c[1])              if c[0] in {1,2,8,9,10,11,12,13}
  | c[1]                                if c[0] = 4    (pool retire -> operator)
  | c[1][0]                             if c[0] = 3    (pool reg -> operator)
  | emptyset                            otherwise
```

The `extract_key_cred` function parses the credential pair
`[cred_type, cred_hash]`:

```
extract_key_cred(cred) =
  if cred is [0, hash]: hash             -- key hash credential
  if cred is [1, _]:    None             -- script hash, no VKey witness needed
  if cred is bytes:     cred             -- raw bytes, assume key hash
```

**Explicit required signers.**

```
explicit_required(tau) =
  if tau.required_signers = None: emptyset
  else: { bytes(s) | s in tau.required_signers }
```

**Collateral keys.** Same extraction as input keys but over collateral inputs.

```
collateral_keys(tau, U) =
  { payment_cred(U[input_key(inp)].address)
  | inp in tau.collateral,
    input_key(inp) in dom(U),
    is_vkey_cred(U[input_key(inp)].address) }
```

### 5.2.3 Witness Completeness Check

```
forall h in required(tau, U):
  h in verified_keys
```

Every required key hash must have a corresponding verified signature in
the witness set.  Missing signers produce an error.

### 5.2.4 Script Completeness (Phase-1)

When redeemers are present (`5 in W`), every script-hash input must have
a matching script available (from the witness set or via a reference
input) and a datum available (inline or in the witness set).

**Available scripts:**

```
available_scripts =
  { H_224(bytes([v]) || script)
  | (witness_key, v) in {(3,1), (6,2), (7,3)},
    script in W[witness_key] }
  U
  { script_ref_hash(U[input_key(inp)].script_ref)
  | inp in tau.reference_inputs,
    input_key(inp) in dom(U),
    U[input_key(inp)].script_ref != None }
```

Script hashes are computed as `H_224(version_prefix || flat_bytes)` where
`version_prefix` is `\x01` (V1), `\x02` (V2), or `\x03` (V3).

**Available datums:**

```
available_datums = { H_256(cbor_encode(d)) | d in W[4] }
```

**Per script-hash input:**

```
forall inp in tau.inputs:
  let out = U[input_key(inp)]
  let addr = out.address
  if |addr| >= 29 AND (addr[0] AND 0x10) != 0:     -- script address
    let script_hash = addr[1:29]
    -- Script must be available
    script_hash in available_scripts
    -- Datum must be available (for spending scripts)
    if out.inline_datum = None AND out.datum_hash != None:
      out.datum_hash in available_datums
```

### 5.2.5 Script Data Hash

The `script_data_hash` field (tx body key 11) commits to the redeemers,
datums, and cost model language views used by the transaction.

```
if tau.script_data_hash != None AND raw != None AND pi != None:
  let kv = walk_map_values(raw)
  let redeemers_raw = kv.get(5, b"")           -- raw CBOR of redeemers
  let datums_raw    = kv.get(4, b"")           -- raw CBOR of datums
  let lang_views    = build_language_views(pi)  -- deterministic CBOR

  H_256(redeemers_raw || datums_raw || lang_views) = tau.script_data_hash
```

**Language views encoding.**  The language views map is a CBOR map from
language ID to cost model encoding.  A critical encoding quirk applies:

```
build_language_views(pi) -> B:
  result = {}
  for (key, lang_id) in [("PlutusV1", 0), ("PlutusV2", 1), ("PlutusV3", 2)]:
    if key in pi.cost_models:
      let values = sorted_values(pi.cost_models[key])
      if lang_id = 0:
        -- PlutusV1 QUIRK: cost model array is CBOR-encoded, then stored as a bytestring
        result[0] = cbor_encode(values)                -- type = bstr
      else:
        -- PlutusV2, PlutusV3: cost model array stored directly
        result[lang_id] = values                       -- type = array
  return cbor_encode(result)
```

The PlutusV1 double-encoding (CBOR integer list encoded to bytes, then
the bytes stored as a CBOR bytestring value) is mandated by the Shelley
formal specification and is required for correct `script_data_hash`
computation across all node implementations.

### 5.2.6 Auxiliary Data Hash

```
if tau.auxiliary_data_hash != None AND aux != None:
  H_256(aux) = tau.auxiliary_data_hash
```

The auxiliary data hash is verified against the raw CBOR bytes of the
per-transaction auxiliary data extracted from the block's auxiliary data
map (see Section 4.2.3).

---

## 5.3 ConwayTxBody Field Reference

For completeness, the full transaction body field map as decoded from the
CBOR wire format:

| Key | Field | Type | Required |
|-----|-------|------|----------|
| 0 | `inputs` | `S[L[B_32, N]]` | yes |
| 1 | `outputs` | `L[TxOut]` | yes |
| 2 | `fee` | `N` | yes |
| 3 | `ttl` | `N?` | no |
| 4 | `certificates` | `L[L[...]]?` | no (non-empty when present) |
| 5 | `withdrawals` | `M[B, N]?` | no (non-empty when present) |
| 7 | `auxiliary_data_hash` | `B_32?` | no |
| 8 | `validity_start` | `N?` | no |
| 9 | `mint` | `M[B_28, M[B, Z]]?` | no (non-empty when present) |
| 11 | `script_data_hash` | `B_32?` | no |
| 13 | `collateral` | `L[L[B_32, N]]?` | no (non-empty when present) |
| 14 | `required_signers` | `L[B_28]?` | no (non-empty when present) |
| 15 | `network_id` | `{0,1}?` | no |
| 16 | `collateral_return` | `TxOut?` | no |
| 17 | `total_collateral` | `N?` | no |
| 18 | `reference_inputs` | `L[L[B_32, N]]?` | no |
| 19 | `voting_procedures` | `M[..., M[..., ...]]?` | no (non-empty when present) |
| 20 | `proposal_procedures` | `L[L[...]]?` | no (non-empty when present) |
| 21 | `treasury` | `N?` | no |
| 22 | `donation` | `N?` | no (must be > 0 when present) |

**Structural invariants** (`__post_init__`):
- `fee >= 0`
- `donation > 0` when present (PositiveCoin)
- `network_id in {0, 1}` when present
- Keys 4, 5, 9, 13, 14, 19, 20 must be non-empty when present (NonEmpty constraint)

The transaction ID is `tx_id = H_256(raw)` where `raw` is the original
CBOR bytes of the transaction body map, byte-sliced from the block
envelope to preserve non-canonical CBOR for correct hashing.

---

## 5.4 TxOut Structure

A transaction output has two wire representations:

**Legacy array format** (pre-Alonzo):
```
[address, amount]                           -- 2-element
[address, amount, datum_hash]               -- 3-element (Alonzo)
```

**Post-Alonzo map format** (Conway):
```
{ 0: address,                               -- B (required)
  1: amount,                                -- Value (required)
  2: datum_option,                          -- [0, B_32] | [1, #6.24(B)] (optional)
  3: script_ref }                           -- B (optional, raw CBOR)
```

The datum option (key 2) has two variants:
- `[0, datum_hash]` : datum by hash reference (stored in `datum_hash`)
- `[1, #6.24(datum_cbor)]` : inline datum (stored in `inline_datum` as raw CBOR)

The decoded `TxOut` type is:

```
TxOut = { address     : B,
          amount      : Value,
          datum_hash  : B_32?,
          inline_datum : B?,
          script_ref  : B?,
          raw         : B }
```

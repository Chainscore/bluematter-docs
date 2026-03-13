---
---
# Scripts

This chapter specifies the Plutus smart contract execution model as implemented
by the Bluematter node. Cardano's scripting layer uses a two-phase validation
architecture introduced in the Alonzo era, where deterministic structural checks
precede nondeterministic script evaluation. The Conway era extends the scripting
model with PlutusV3, governance-aware script contexts, and refined cost model
semantics.

---

## 6.1 Two-Phase Validation

Every transaction that invokes Plutus scripts undergoes validation in two
strictly ordered phases. This separation ensures that even if script evaluation
is expensive or fails, the ledger can account for consumed resources.

**Phase 1 (Structural / Deterministic).** The UTxO and witness rules
(Chapters 4 and 5) run first. Phase 1 checks are bounded, deterministic, and
independent of the CEK machine:

- All inputs exist in the UTxO set.
- The fee is sufficient: `fee(tau) >= min_fee(pi, tau)`.
- Value is conserved.
- TTL and validity intervals are respected.
- All required witnesses (VKey signatures, scripts, datums) are present.
- Script data hash matches the witness set encoding.

If any Phase 1 check fails, the transaction is **rejected entirely** -- it does
not appear on chain and no collateral is consumed.

**Phase 2 (Script Evaluation).** Each Plutus script referenced by the
transaction's redeemers is executed on the CEK machine within its declared
execution budget. Phase 2 outcomes:

| Outcome | `is_valid` | Effect |
|---|---|---|
| All scripts pass | `True` | Transaction applied normally |
| Any script fails | `False` | Collateral consumed, no other effects |
| Scripts pass but `is_valid = False` | -- | **Reject**: cross-check failure |
| Scripts fail but `is_valid = True` | -- | **Reject**: cross-check failure |

The block producer sets the `is_valid` flag in the block body. The verifier
re-evaluates all scripts and cross-checks the declared outcome:

```
cross_check(is_valid, any_failed):
  if is_valid  and any_failed    => ERROR "is_valid=True but script failed"
  if !is_valid and !any_failed   => ERROR "is_valid=False but all scripts passed"
```

When `is_valid = False`, the transaction body is still serialized in the block
(for auditability), but only collateral inputs are consumed and their value
minus the collateral return (if any) is collected as fees.

---

## 6.2 Script Resolution

For each redeemer `(tag, index)` in the witness set, the verifier must locate
the corresponding script. The resolution procedure depends on the redeemer tag.

**Definition.** Let `tau` be the transaction body and `sigma` the current UTxO
state. Define the following sorted sequences:

```
sorted_inputs       = sort([(tx_hash, output_index) | inp <- tau.inputs])
sorted_policy_ids   = sort([ensure_bytes(p) | p <- dom(tau.mint)])
sorted_withdrawals  = sort([ensure_bytes(a) | a <- dom(tau.withdrawals)])
```

Sorting is lexicographic on raw bytes, with `(tx_hash, output_index)` compared
component-wise (bytes then integer).

**Resolution rules:**

```
resolve_script_hash(tag, index, tau, sigma):

  SPEND (tag=0):
    key = sorted_inputs[index]
    out = sigma.utxo[key]
    addr = out.address
    REQUIRE |addr| >= 29
    REQUIRE addr[0] & 0x10 != 0          -- script-hash address
    RETURN addr[1:29]                     -- the 28-byte script hash

  MINT (tag=1):
    RETURN sorted_policy_ids[index]       -- policy ID is the script hash

  CERT (tag=2):
    cert = tau.certificates[index]
    cred = cert[1]                        -- [cred_type, cred_hash]
    RETURN ensure_bytes(cred[1])          -- credential hash

  REWARD (tag=3):
    addr = sorted_withdrawals[index]
    REQUIRE |addr| >= 29
    REQUIRE addr[0] & 0x10 != 0          -- script credential
    RETURN addr[1:29]
```

**Script collection.** The available script pool is the union of witness scripts
and reference scripts:

```
available_scripts = witness_scripts(tau) UNION reference_scripts(tau, sigma)

witness_scripts(tau):
  FOR witness_key IN {3: PlutusV1, 6: PlutusV2, 7: PlutusV3}:
    FOR script_cbor IN witnesses[witness_key]:
      flat_bytes = unwrap_cbor(script_cbor)
      h = blake2b_224(version_prefix || flat_bytes)
      YIELD (h, version, flat_bytes)

reference_scripts(tau, sigma):
  FOR inp IN (tau.inputs UNION tau.reference_inputs):
    out = sigma.utxo[input_key(inp)]
    IF out.script_ref != None:
      (h, version, flat_bytes) = parse_script_ref(out.script_ref)
      YIELD (h, version, flat_bytes)
```

The script hash must exist in the available pool:

```
REQUIRE script_hash IN dom(available_scripts)
```

---

## 6.3 Script Hashing

A Plutus script is identified by the 28-byte Blake2b-224 hash of its
version-tagged flat encoding:

```
script_hash : B_flat -> H_28
script_hash(flat_bytes, version) = blake2b_224(version_byte || flat_bytes)

  where version_byte:
    PlutusV1 => 0x01
    PlutusV2 => 0x02
    PlutusV3 => 0x03
```

The `flat_bytes` are the Flat-encoded Untyped Plutus Core (UPLC) program. The
version byte is **not** part of the Flat encoding itself; it is prepended solely
for hashing.

---

## 6.4 Script Context Construction

The script context is the data structure passed to the Plutus validator as an
argument. It encodes the transaction being validated, the purpose of the script
invocation, and (for V3) the redeemer itself. Each Plutus language version
defines a different `TxInfo` shape.

### 6.4.1 PlutusData Primitives

All context structures are encoded as PlutusData, a sum type with five
constructors:

```
PlutusData =
  | Constr(tag : N, fields : L[PlutusData])
  | Map(entries : L[(PlutusData, PlutusData)])
  | List(items : L[PlutusData])
  | Integer(n : Z)
  | ByteString(b : B)
```

Cardano-specific types are encoded as `Constr` applications:

```
Credential:
  PubKeyCredential(key_hash)   = Constr(0, [ByteString(key_hash)])
  ScriptCredential(script_hash) = Constr(1, [ByteString(script_hash)])

Address = Constr(0, [Credential, Maybe StakingCredential])

StakingCredential:
  StakingHash(Credential)  = Constr(0, [Credential])
  StakingPtr(...)          = Constr(1, [...])

TxOutRef = Constr(0, [TxId, Integer(index)])
TxId     = Constr(0, [ByteString(tx_hash)])

Value = Map(CurrencySymbol -> Map(TokenName -> Integer))
  where CurrencySymbol = ByteString (b"" for ADA)
        TokenName      = ByteString (b"" for lovelace)

Maybe a:
  Just(x)  = Constr(0, [x])
  Nothing  = Constr(1, [])
```

### 6.4.2 V1 TxInfo (10 fields)

PlutusV1 TxInfo captures the pre-Babbage transaction model. Notable constraints:
no reference inputs, no inline datums, 3-field TxOut, list-of-pairs for
withdrawals and datums.

```
TxInfo_V1 = Constr(0, [
  inputs       : List[TxInInfo_V1],         -- sorted by (tx_hash, index)
  outputs      : List[TxOut_V1],            -- in transaction order
  fee          : Value,                      -- as Value (not plain Coin)
  mint         : Value,                      -- includes zero-ADA sentinel entry
  dcerts       : List[DCert_V1V2],
  withdrawals  : List[Pair],                 -- list of (StakingCred, Coin) pairs
  valid_range  : POSIXTimeRange,
  signatories  : List[PubKeyHash],
  data         : List[Pair],                 -- list of (DatumHash, Datum) pairs
  tx_id        : TxId,
])

TxInInfo_V1 = Constr(0, [TxOutRef, TxOut_V1])

TxOut_V1 = Constr(0, [Address, Value, Maybe DatumHash])
  -- 3 fields: no datum_option/script_ref distinction
```

V1-specific encoding rules:

- **Fee** is encoded as a `Value` map (not a plain integer).
- **Mint** includes a zero-lovelace sentinel: `{b"": {b"": 0}, ...policy entries}`.
  If no minting, mint is `value_to_data(0)`.
- **Withdrawals** are a `List` of constructor-wrapped pairs, not a `Map`.
  Each pair: `Constr(0, [StakingCredential, Integer(amount)])`.
- **Data** (datums) are a `List` of constructor-wrapped pairs.
  Each pair: `Constr(0, [ByteString(datum_hash), datum])`.

### 6.4.3 V2 TxInfo (12 fields)

PlutusV2 adds reference inputs, a redeemers map, and switches withdrawals and
datums to `Map` encoding. TxOut gains a fourth field.

```
TxInfo_V2 = Constr(0, [
  inputs       : List[TxInInfo],            -- 4-field TxOut
  ref_inputs   : List[TxInInfo],            -- new: reference inputs
  outputs      : List[TxOut_V2],
  fee          : Value,                      -- still as Value
  mint         : Value,
  dcerts       : List[DCert_V1V2],
  withdrawals  : Map[StakingCred, Integer],  -- Map, not list-of-pairs
  valid_range  : POSIXTimeRange,
  signatories  : List[PubKeyHash],
  redeemers    : Map[ScriptPurpose, Redeemer], -- new
  data         : Map[DatumHash, Datum],      -- Map, not list-of-pairs
  tx_id        : TxId,
])

TxOut_V2 = Constr(0, [Address, Value, DatumOption, Maybe ScriptHash])

DatumOption:
  NoOutputDatum     = Constr(0, [])
  OutputDatumHash(h) = Constr(1, [ByteString(h)])
  OutputDatum(d)     = Constr(2, [d])        -- inline datum
```

### 6.4.4 V3 TxInfo (16 fields)

PlutusV3 (Conway) extends TxInfo with governance fields and changes several
encoding conventions.

```
TxInfo_V3 = Constr(0, [
  inputs             : List[TxInInfo],
  ref_inputs         : List[TxInInfo],
  outputs            : List[TxOut_V2],
  fee                : Integer,              -- CHANGED: Lovelace, not Value
  mint               : Value,                -- empty = Map{}, not Value(0)
  certs              : List[TxCert_V3],      -- CHANGED: Conway cert format
  withdrawals        : Map[Credential, Integer],  -- CHANGED: Credential, not StakingCred
  valid_range        : POSIXTimeRange,
  signatories        : List[PubKeyHash],
  redeemers          : Map[ScriptPurpose, Redeemer],
  data               : Map[DatumHash, Datum],
  tx_id              : TxId,
  voting_procedures  : Map[Voter, Map[GovernanceActionId, Vote]],  -- new
  proposal_procedures : List[ProposalProcedure],                    -- new
  current_treasury   : Maybe Lovelace,                              -- new
  treasury_donation  : Maybe Lovelace,                              -- new
])
```

V3-specific encoding differences from V2:

| Field | V2 | V3 |
|---|---|---|
| `fee` | `Value` (Map) | `Integer` (plain lovelace) |
| `mint` (empty) | `value_to_data(0)` | `Map{}` (empty PlutusMap) |
| `certs` | `DCert_V1V2` | `TxCert_V3` (see Section 6.4.5) |
| `withdrawals` key | `StakingCredential` | `Credential` (unwrapped) |

### 6.4.5 V3 TxCert Encoding

Conway certificates are mapped from their CBOR wire types to Plutus V3
constructors. The mapping is **not** identity -- CBOR type numbers differ from
Plutus constructor tags.

```
CBOR wire type  ->  Plutus V3 TxCert constructor

 0 (StakeReg)         ->  0: TxCertRegStaking(Credential, Maybe Lovelace)
 1 (StakeUnreg)       ->  1: TxCertUnRegStaking(Credential, Maybe Lovelace)
 2 (StakeDeleg)       ->  2: TxCertDelegStaking(Credential, Delegatee)
 3 (PoolReg)          ->  7: TxCertPoolRegister(PoolId, PoolVRF)
 4 (PoolRetire)       ->  8: TxCertPoolRetire(PoolId, Integer)
 7 (RegCert)          ->  0: TxCertRegStaking(Credential, Maybe Lovelace)
 8 (UnregCert)        ->  1: TxCertUnRegStaking(Credential, Maybe Lovelace)
 9 (VoteDeleg)        ->  2: TxCertDelegStaking(Credential, Delegatee)
10 (StakeVoteDeleg)   ->  2: TxCertDelegStaking(Credential, Delegatee)
11 (StakeRegDeleg)    ->  3: TxCertRegDeleg(Credential, Delegatee, Lovelace)
12 (VoteRegDeleg)     ->  3: TxCertRegDeleg(Credential, Delegatee, Lovelace)
13 (StakeVoteRegDeleg)->  3: TxCertRegDeleg(Credential, Delegatee, Lovelace)
14 (AuthCommitteeHot) ->  9: TxCertAuthHotCommittee(ColdCred, HotCred)
15 (ResignCommittee)  -> 10: TxCertResignColdCommittee(ColdCred)
16 (RegDRep)          ->  4: TxCertRegDRep(DRepCredential, Lovelace)
17 (UnRegDRep)        ->  6: TxCertUnRegDRep(DRepCredential, Lovelace)
18 (UpdateDRep)       ->  5: TxCertUpdateDRep(DRepCredential)
```

The `Delegatee` type encodes the delegation target:

```
Delegatee:
  DelegStake(pool_id)     = Constr(0, [ByteString(pool_id)])
  DelegVote(drep_cred)    = Constr(1, [Credential])
  DelegStakeVote(pool, d) = Constr(2, [ByteString(pool_id), Credential])
```

### 6.4.6 V1/V2 DCert Encoding

V1/V2 scripts receive certificates in the legacy DCert format:

```
DCert_V1V2:
  DCertDelegRegKey(cred)      = Constr(0, [StakingCredential])
  DCertDelegDeRegKey(cred)    = Constr(1, [StakingCredential])
  DCertDelegDelegate(cred, p) = Constr(2, [StakingCredential, ByteString(pool)])
  DCertPoolRegister(op, vrf)  = Constr(3, [ByteString(operator), ByteString(vrf)])
  DCertPoolRetire(pool, epoch)= Constr(4, [ByteString(pool), Integer(epoch)])
  DCertGenesis                = Constr(5, [...])    -- unused
  DCertMir                    = Constr(6, [...])    -- unused in Conway
```

Conway certificate types 7 and 8 are projected back to DCert constructors 0 and
1 respectively (RegCert -> StakeRegistration, UnregCert -> StakeDeregistration).
Types 9-18 have no V1/V2 representation and are omitted from the DCert list.

---

## 6.5 ScriptPurpose vs ScriptInfo

The script invocation context differs between V1/V2 and V3.

### 6.5.1 V1/V2 ScriptPurpose

```
ScriptPurpose:
  Minting(policy_id)        = Constr(0, [ByteString(H_28)])
  Spending(tx_out_ref)      = Constr(1, [TxOutRef])
  Rewarding(staking_cred)   = Constr(2, [StakingCredential])
  Certifying(dcert)         = Constr(3, [DCert])           -- NO index
```

Note that `Certifying` in V1/V2 takes only the DCert itself, not an index.

### 6.5.2 V3 ScriptInfo

V3 redefines the purpose as `ScriptInfo` with **different constructor tags** and
two additional governance variants:

```
ScriptInfo:
  SpendingScript(ref, datum)   = Constr(0, [TxOutRef, Maybe Datum])
  MintingScript(policy_id)     = Constr(1, [ByteString(H_28)])
  CertifyingScript(idx, cert)  = Constr(2, [Integer, TxCert])
  RewardingScript(cred)        = Constr(3, [Credential])        -- NOT StakingCred
  VotingScript(voter)          = Constr(4, [Voter])
  ProposingScript(idx, prop)   = Constr(5, [Integer, ProposalProcedure])
```

Key differences from V1/V2:

| Aspect | V1/V2 ScriptPurpose | V3 ScriptInfo |
|---|---|---|
| Spending tag | `Constr(1, ...)` | `Constr(0, ...)` |
| Minting tag | `Constr(0, ...)` | `Constr(1, ...)` |
| Spending fields | `[TxOutRef]` | `[TxOutRef, Maybe Datum]` |
| Certifying fields | `[DCert]` | `[Integer, TxCert]` (indexed) |
| Rewarding credential | `StakingCredential` | `Credential` (unwrapped) |
| Governance | absent | `VotingScript`, `ProposingScript` |

The tag swap between Spending and Minting is a deliberate design choice in CIP-69
and must be handled correctly.

---

## 6.6 Script Execution

### 6.6.1 Argument Application

The CEK machine evaluates a UPLC program applied to its arguments. The number
and shape of arguments differ by version and purpose.

```
eval_script(flat_bytes, version, args, budget):

  1. program = unflatten(flat_bytes)           -- Flat decode to UPLC AST
  2. term = program.term
  3. FOR arg IN args:
       term = Apply(f=term, x=arg)            -- left-fold application
  4. applied = Program(version=program.version, term=term)
  5. (ccm, bcm) = get_cost_models(version, pi)
  6. machine = Machine(Budget(budget.steps, budget.mem), ccm, bcm)
  7. result = machine.eval(applied)
  8. RETURN check_result(result, version)
```

**Arguments by version and purpose:**

```
V1/V2 Spending:
  args = [datum, redeemer, ScriptContext(TxInfo, ScriptPurpose)]

V1/V2 Minting | Certifying | Rewarding:
  args = [redeemer, ScriptContext(TxInfo, ScriptPurpose)]

V3 (all purposes):
  args = [ScriptContext(TxInfo, Redeemer, ScriptInfo)]
```

Where the `ScriptContext` structures are:

```
ScriptContext_V1V2 = Constr(0, [TxInfo, ScriptPurpose])   -- 2 fields
ScriptContext_V3   = Constr(0, [TxInfo, Redeemer, ScriptInfo])  -- 3 fields
```

### 6.6.2 Datum Resolution

For V1/V2 spending scripts, a datum is **required**. The resolution order is:

```
resolve_datum(spend_index, sorted_inputs, sigma, witnesses):
  key = sorted_inputs[spend_index]
  out = sigma.utxo[key]

  1. IF out.inline_datum != None:
       RETURN cbor_to_plutus_data(out.inline_datum)

  2. IF out.datum_hash != None:
       FOR d IN witnesses[4]:               -- witness set datums
         IF blake2b_256(cbor_encode(d)) == out.datum_hash:
           RETURN cbor_to_plutus_data(cbor_encode(d))

  3. RETURN None                             -- ERROR: datum not found
```

If no datum can be resolved for a V1/V2 spending script, the script evaluation
fails with a Phase 2 error.

### 6.6.3 Success Criteria

```
check_result(result, version):
  IF result.result IS RuntimeError:
    RETURN False

  IF version == 3:
    RETURN result.result IS BuiltinUnit     -- V3 requires unit return

  RETURN True                                -- V1/V2: any non-error result
```

### 6.6.4 Cost Models

The CEK machine requires two cost model objects: the machine step costs and the
builtin function costs. These are loaded from protocol parameters when available.

```
get_cost_models(version, pi):
  version_key = {1: "PlutusV1", 2: "PlutusV2", 3: "PlutusV3"}[version]

  IF version_key IN pi.cost_models:
    model = pi.cost_models[version_key]
    TRY:
      RETURN parse_on_chain_cost_model(model, version)
    CATCH:
      -- fall through to defaults

  RETURN default_cost_models(version)
```

On-chain cost models may be stored as either:
- A `dict[str, int]` with named parameter keys (from genesis JSON).
- A `list[int]` of values in canonical alphabetical parameter order.
- A `dict[int, int]` with integer keys, extracted sorted by key.

All three formats are normalized to named parameters before constructing the
cost model objects.

---

## 6.7 Script Data Hash

The `script_data_hash` field in the transaction body commits to the
redeemers, datums, and cost models used by the transaction. It provides
integrity protection against witness-set tampering.

### 6.7.1 Computation

```
script_data_hash = blake2b_256(redeemers_cbor || datums_cbor || language_views)
```

Where:

- `redeemers_cbor` is the **raw CBOR bytes** of the redeemers field (witness
  key 5), extracted directly from the serialized witness set. Not re-encoded.
- `datums_cbor` is the **raw CBOR bytes** of the datums field (witness key 4).
  If no datums are present, this is the empty byte string `b""`.
- `language_views` is the deterministically encoded cost model map (see below).

### 6.7.2 Language Views Encoding

The language views map includes only the Plutus versions **used by the
transaction's scripts** (though the current implementation includes all versions
present in protocol parameters for simplicity).

```
language_views = cbor_encode(M[language_id -> cost_model_encoding])

  language_id:
    PlutusV1 = 0
    PlutusV2 = 1
    PlutusV3 = 2
```

**Critical encoding quirk for PlutusV1:**

The cost model values for language ID 0 (PlutusV1) are first CBOR-encoded as an
integer list, then that encoding is stored as a **CBOR bytestring** value in the
map. This double-encoding is mandated by the Shelley formal specification.

```
build_language_views(pi):
  result = {}

  IF "PlutusV1" IN pi.cost_models:
    values = sorted_values(pi.cost_models["PlutusV1"])
    result[0] = cbor_encode_as_bytes(cbor_encode(values))   -- bytestring!

  IF "PlutusV2" IN pi.cost_models:
    values = sorted_values(pi.cost_models["PlutusV2"])
    result[1] = values                                       -- integer list

  IF "PlutusV3" IN pi.cost_models:
    values = sorted_values(pi.cost_models["PlutusV3"])
    result[2] = values                                       -- integer list

  RETURN cbor_encode(result)
```

When the cost model is provided as a `dict`, values are extracted in sorted key
order to produce a canonical integer list.

### 6.7.3 Redeemer Formats

Two redeemer encodings exist on the wire:

**Conway format (map):**
```
{ [tag, index] : [data, [mem, steps]], ... }
```

**Babbage format (list):**
```
[ [tag, index, data, [mem, steps]], ... ]
```

Both formats are decoded into a uniform representation:

```
redeemers : M[(tag : N, index : N) -> (data_cbor : B, mem : N, steps : N)]
```

The redeemer tags are:

| Tag | Purpose |
|---|---|
| 0 | `SPEND` -- validates spending of a script-locked UTxO |
| 1 | `MINT` -- validates minting under a policy |
| 2 | `CERT` -- validates a certificate involving a script credential |
| 3 | `REWARD` -- validates a withdrawal from a script reward address |

---

## 6.8 Evaluation Pipeline

The complete Phase 2 evaluation pipeline, as implemented in `eval_scripts`:

```
eval_scripts(tau, witnesses, sigma, slot, pi, is_valid):
  IF pi.cost_models = {} :  RETURN []       -- backward compat: no Plutus
  IF 5 not in witnesses  :  RETURN []       -- no redeemers

  redeemers = decode_redeemers(witnesses[5])
  IF redeemers = {}      :  RETURN []

  available = collect_scripts(witnesses)
              UNION collect_reference_scripts(tau, sigma)

  sorted_inputs      = sort(input_keys(tau))
  sorted_policies    = sort(policy_ids(tau))
  sorted_withdrawals = sort(withdrawal_keys(tau))

  errors = []
  any_failed = False

  FOR (tag, index), (data_cbor, mem, steps) IN redeemers:

    -- 1. Resolve script hash
    h = resolve_script_hash(tag, index, ...)
    IF h = None:
      errors += ["Cannot resolve script hash"]
      any_failed = True
      CONTINUE

    -- 2. Find script bytes
    IF h not in available:
      errors += ["Script not found: " || hex(h)]
      any_failed = True
      CONTINUE

    (version, flat_bytes) = available[h]

    -- 3. Build arguments
    redeemer = cbor_to_plutus_data(data_cbor)
    purpose  = build_purpose(tag, index, ..., version)
    tx_info  = get_tx_info(version)          -- cached per version

    IF version >= 3:
      ctx = Constr(0, [tx_info, redeemer, purpose])
      args = [ctx]
    ELSE:
      ctx = Constr(0, [tx_info, purpose])
      IF tag = SPEND:
        datum = resolve_datum(index, ...)
        IF datum = None:
          errors += ["Datum not found"]
          any_failed = True
          CONTINUE
        args = [datum, redeemer, ctx]
      ELSE:
        args = [redeemer, ctx]

    -- 4. Execute
    success = run_script(flat_bytes, args, version, mem, steps, pi)
    IF NOT success:
      any_failed = True
      IF is_valid:
        errors += ["Script failed: " || hex(h)]

  -- 5. Cross-check
  IF NOT is_valid AND NOT any_failed:
    errors += ["is_valid=False but all scripts passed"]

  RETURN errors
```

The `tx_info` is constructed lazily and cached per Plutus version, since a
transaction may contain scripts of different versions. The cache avoids
rebuilding the (potentially expensive) TxInfo for each script.

---

## 6.9 Implementation Notes

**Source files:**

| Module | Path | Responsibility |
|---|---|---|
| `evaluate.py` | `ledger/plutus/evaluate.py` | Evaluation driver, redeemer decoding |
| `script_context.py` | `ledger/plutus/script_context.py` | TxInfo and ScriptContext builders |
| `data.py` | `ledger/plutus/data.py` | PlutusData construction helpers |
| `script_resolution.py` | `ledger/plutus/script_resolution.py` | Script lookup and hash resolution |
| `cert_encoding.py` | `ledger/plutus/cert_encoding.py` | Certificate -> DCert/TxCert encoding |
| `cost_models.py` | `ledger/plutus/cost_models.py` | Cost model loading and parsing |
| `utxow.py` | `ledger/rules/utxow.py` | Script data hash validation |

**Dependencies:**

- The `uplc` library (>= 1.0.0) provides the CEK machine, Flat decoder, and
  PlutusData AST types.
- `uplc.ast.data_from_cbor` converts CBOR bytes to PlutusData nodes.
- `uplc.tools.unflatten` decodes Flat-encoded UPLC programs.
- `uplc.machine.Machine` executes UPLC on a budget.
- Cost model defaults are obtained from `uplc.tools.default_*_cost_model_*`.
- On-chain cost model updates use `uplc.cost_model.updated_*_from_network_config`.

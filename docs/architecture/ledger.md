# Ledger

## Overview

The `ledger/` package is the heart of Bluematter. It maintains the UTxO set, validates transactions against the formal Shelley/Conway specification rules, processes certificates, computes staking rewards, handles Conway governance (CIP-1694), and evaluates Plutus scripts. Together these modules implement the BBODY, UTXO, UTXOW, CERTS, RUPD, TICK, and NEWEPOCH rules from the formal specification.

The ledger operates as a pure state machine: `LedgerState -> apply_block(block) -> LedgerState`. Block application is deterministic, mutation-based (in-place for performance), and produces identical results regardless of execution environment -- a property critical for consensus.

---

## Files

### `__init__.py`
Empty package marker (re-exports nothing).

### `state.py`
Defines the core ledger state types.
- `Pots` -- protocol-level ADA pots (treasury, reserves, fees, deposited)
- `Account` -- stake account (deposit, pool delegation, rewards)
- `PoolParams` -- pool registration parameters (operator, VRF keyhash, pledge, cost, margin, reward_account, owners, retiring_epoch, deposit_paid)
- `LedgerState` -- the full mutable state (UTxO, pots, protocol params, accounts, pools, epoch, slot, governance, snapshot rotation, block counts)
- `LedgerState.compute_utxo_hash()` -- deterministic blake2b_256 of the UTxO set for cross-node consistency checks
- `LedgerState.summary()` -- compact dict for logging
- `LedgerState.__setstate__()` -- pickle backward compatibility for checkpoint evolution

### `apply.py`
Single-transaction state-update logic (no validation).
- `input_key(inp)` -- normalize CBOR-decoded input to `(tx_hash, output_index)` tuple
- `apply_tx(state, tx, pp)` -- apply one transaction to the ledger state (certs -> governance -> consume inputs -> produce outputs -> collect fees -> debit withdrawals)

### `block.py`
Full block application (BBODY rule).
- `apply_block(state, block)` -- the top-level entry point; validates and applies every transaction
- `_verify_block_body_hash(block)` -- 4-component hash check (tx_bodies, witnesses, aux_data, invalid_txs)
- `_verify_block_body_size(block)` -- body size matches header claim
- `_parse_auxiliary_data_map(aux_raw)` -- extract per-tx auxiliary data blobs
- `_validate_tx(state, pp, tx, ...)` -- run phase-1 UTXO + witness validation
- `_validate_phase2(state, pp, tx, ...)` -- run phase-2 Plutus script evaluation
- `_apply_invalid_tx(state, block, idx)` -- consume collateral for failed transactions

### `value.py`
Multi-asset value arithmetic.
- `Value` type alias: `int | list[int | dict[bytes, dict[bytes, int]]]`
- `lovelace_of(v)`, `multiasset_of(v)` -- extract components
- `value_add(a, b)`, `value_sub(a, b)` -- component-wise addition/subtraction
- `value_geq(a, b)`, `value_eq(a, b)` -- component-wise comparison
- `value_is_zero(v)`, `value_non_negative(v)` -- predicates
- `value_size(v)` -- estimated serialized byte size

### `protocol_params.py`
Conway-era protocol parameters merged from three genesis files.
- `ProtocolParameters` -- frozen dataclass with ~30 fields grouped by origin (Shelley, Alonzo, Conway)
- `parse_protocol_params(shelley_path, alonzo_path, conway_path)` -- parse and merge three genesis JSON files
- `_to_rational(value)` -- convert float/dict to `(numerator, denominator)` tuple

### `rules/utxo.py`
Phase-1 UTXO validation (structural checks, no script execution).
- `validate_utxo(pp, state, tx, slot)` -- returns list of error strings
- `_sum_inputs_value()`, `_sum_outputs_value()`, `_sum_withdrawals()`, `_mint_value()` -- value aggregation
- `_total_deposits(pp, tx, state)` -- compute net deposit change from certificates
- `_min_utxo_value(pp, out)` -- `(output_size + 160) * lovelace_per_utxo_byte`
- `_value_cbor_size(v)` -- CBOR-serialized byte count for max_value_size check

### `rules/utxow.py`
Witness validation (signature and completeness checks).
- `decode_witnesses(witness_raw)` -- CBOR map keys 0-7 into decoded Python objects
- `validate_witnesses(tx_body, witnesses, utxo, ...)` -- VKey sig check, required signers, script completeness, script_data_hash, auxiliary_data_hash
- `required_key_hashes(tx_body, utxo)` -- collect all key hashes that must sign
- `payment_credential(addr_bytes)` -- extract `(cred_hash, is_key)` from Shelley address
- `_check_script_completeness(...)` -- every script-hash input has matching script + datum
- `_validate_script_data_hash(...)` -- `blake2b_256(redeemers_raw ++ datums_raw ++ language_views_cbor)`
- `_build_language_views(pp)` -- PlutusV1 quirk: cost model CBOR-encoded as bytestring

### `rules/certs.py`
Certificate processing for Conway era (types 0-18).
- `process_certificates(state, certificates, pp)` -- dispatch loop, returns errors
- Per-type handlers: `_stake_reg`, `_stake_unreg`, `_stake_deleg`, `_pool_reg`, `_pool_retire`, `_reg_cert`, `_unreg_cert`, `_stake_deleg_vote`, `_reg_and_deleg`, `_auth_committee_hot`, `_resign_committee`, `_drep_reg`, `_drep_unreg`

### `epoch.py`
Epoch boundary transitions (TICK / NEWEPOCH rules).
- `slot_to_epoch(slot, epoch_length)` -- integer division
- `tick(state, new_slot)` -- detect and apply epoch transitions (handles multi-epoch jumps)
- `_apply_epoch_transition(state, new_epoch)` -- rewards, snapshot rotation, pool retirements, governance enactment, block count rotation, fee reset
- `_compute_current_stake_dist(state)` -- build `{credential: lovelace}` from accounts + UTxO
- `_retire_pools(state, epoch)` -- refund deposits, clear delegations

### `rewards.py`
Reward calculation (Shelley formal spec Section 5.5, RUPD rule).
- `RewardUpdate` -- dataclass: delta_treasury, delta_reserves, rewards dict, delta_fees
- `compute_reward_update(state, blocks_made, active_stake)` -- the `createRUpd` function
- `apply_reward_update(state, update)` -- credit treasury, reserves, individual rewards
- `_max_pool(r_avail, sigma, p_r, a0, k)` -- pledge-adjusted desirability function
- `_mk_apparent_performance(sigma_a, n_blocks, total_blocks)` -- `beta / sigma_a`
- `_r_operator(pool_r, cost, margin, s, sigma)` -- leader reward split
- `_r_member(pool_r, cost, margin, t, sigma)` -- member reward split

### `governance.py`
Conway governance enactment (CIP-1694).
- `GovActionType` enum -- ParameterChange, HardForkInitiation, TreasuryWithdrawals, NoConfidence, UpdateCommittee, NewConstitution, InfoAction
- `VoteChoice` enum -- No(0), Yes(1), Abstain(2)
- `GovState` -- proposals, votes, committee, constitution_hash, dreps, enacted history
- `process_voting_procedures(gov_state, voting_procedures)` -- record votes with eligibility checks
- `process_proposal_procedures(gov_state, proposals, tx_hash, epoch, pp)` -- register new proposals
- `enact_governance(state, gov_state, epoch)` -- ratify and enact at epoch boundary
- `_is_ratified(proposal, votes, state, pp)` -- stake-weighted CC/DRep/SPO threshold checks
- Enactment handlers: `_enact_treasury_withdrawals`, `_enact_parameter_change`, `_enact_no_confidence`, `_enact_update_committee`, `_enact_new_constitution`

### `stake_snapshot.py`
Stake snapshot rotation (mark / set / go, 3-epoch delay).
- `StakeSnapshot` -- per-pool stake, per-credential stake, total active stake, epoch
- `SnapshotRotation` -- mark/set_/go triple
- `rotate_snapshots(rotation, new_mark)` -- `go <- set, set <- mark, mark <- new`
- `compute_stake_snapshot(state)` -- scan accounts + UTxO for delegated stake

### `snapshot.py`
Import Amaru-format NewEpochState CBOR to bootstrap a LedgerState.
- `load_snapshot(path, streaming)` -- auto-detect gzip, dispatch to standard or streaming parser
- `parse_new_epoch_state(data)` -- full CBOR decode (OK for preprod ~1.5M UTxO)
- `parse_new_epoch_state_streaming(data)` -- incremental byte-walking for mainnet (~15M UTxO)
- `_parse_pools`, `_parse_accounts`, `_parse_utxo`, `_parse_txout` -- sub-parsers
- `_parse_protocol_params_from_cbor(pp_array)` -- 31-element on-chain protocol params array
- `_parse_account(acct_data)` -- Conway UMap format: `[StrictMaybe<(rewards, deposit)>, pointers, pool_deleg, drep_deleg]`

### `plutus/data.py`
PlutusData construction helpers (Cardano ledger types to Plutus AST).
- `make_constr(tag, fields)`, `bytes_data(b)`, `int_data(n)`, `list_data(items)`, `map_data(pairs)`
- `value_to_data(v)` -- `Map<CurrencySymbol, Map<TokenName, Integer>>` with ADA under `b""`
- `credential_to_data(cred_hash, is_key)` -- `PubKeyCredential = Constr(0, ...)` / `ScriptCredential = Constr(1, ...)`
- `addr_to_data(addr_bytes)` -- Shelley address to Plutus Address (payment + staking credential)
- `txin_to_data(tx_hash, idx)` -- `TxOutRef = Constr(0, [TxId, Integer])`
- `txout_to_data(out)` -- V2 format: `Constr(0, [address, value, datum_option, maybe_script_hash])`

### `plutus/script_context.py`
ScriptContext construction for V1, V2, and V3 Plutus validators.
- `build_tx_info_v1(tx, witnesses, utxo, slot)` -- 10-field TxInfo (no ref_inputs, no redeemers, 3-field TxOut)
- `build_tx_info_v2(tx, witnesses, utxo, slot)` -- 12-field TxInfo (ref_inputs, redeemers, 4-field TxOut)
- `build_tx_info_v3(tx, witnesses, utxo, slot)` -- 16-field TxInfo (adds voting, proposals, treasury, donation)
- `build_script_context_v2(tx_info, purpose)` -- `Constr(0, [TxInfo, ScriptPurpose])`
- `build_script_context_v3(tx_info, redeemer, purpose)` -- `Constr(0, [TxInfo, Redeemer, ScriptInfo])`
- `cert_to_data_v1v2(cert)` / `cert_to_data_v3(cert)` -- DCert/TxCert encoding with wire-to-Plutus tag mapping
- Purpose constructors: `spending_purpose`, `minting_purpose`, `rewarding_purpose`, `certifying_purpose_v1v2`
- V3 ScriptInfo constructors: `spending_script_info`, `minting_script_info`, `rewarding_script_info`, `certifying_script_info`

### `plutus/evaluate.py`
Plutus script evaluation driver.
- `eval_scripts(tx, witnesses, utxo, slot, pp, is_valid)` -- evaluate all scripts, cross-check is_valid flag
- `_decode_redeemers(raw)` -- Conway map format `{[tag, idx]: [data, [mem, steps]]}` and Babbage list format
- `_collect_scripts(witnesses)` -- hash and index PlutusV1/V2/V3 scripts from witness set keys 3/6/7
- `_collect_reference_scripts(tx, utxo)` -- scripts from reference inputs and regular spend inputs
- `_resolve_script_hash(tag, index, ...)` -- find script hash for SPEND/MINT/CERT/REWARD redeemer
- `_resolve_datum(spend_index, ...)` -- inline datum or datum hash lookup
- `_run_script(flat_bytes, args, version, ex_mem, ex_steps, pp)` -- unflatten, apply args, run CEK machine
- `_get_cost_models(version, pp)` -- on-chain cost models from protocol params with uplc fallback
- `get_script_languages(tx, witnesses, utxo)` -- determine which Plutus versions are used

### `utils.py`
Shared helpers used across ledger modules.
- `to_bytes(x)` -- coerce to `bytes`
- `extract_address(out)` -- get address bytes from TxOut or raw list
- `parse_script_ref(raw)` -- unwrap reference-script CBOR: `[version_tag, script_body]`
- `script_ref_hash(raw)` -- parse + compute `blake2b_224(version_prefix + flat_bytes)`

### `constants.py`
Named constants for address parsing and protocol defaults.
- `PAYMENT_CRED_START=1`, `PAYMENT_CRED_END=29`, `STAKING_CRED_START=29`, `STAKING_CRED_END=57`, `MIN_BASE_ADDR_LEN=57`
- `DEFAULT_POOL_DEPOSIT=500_000_000`

### `errors.py`
Custom exception types.
- `BlockValidationError` -- block-level failures (body hash, size, slot regression)
- `TxValidationError` -- transaction-level failures (UTXO, witness, phase-2)

---

## Core Data Types

### LedgerState

The central mutable state object, passed through the entire block-application pipeline.

| Field | Type | Description |
|-------|------|-------------|
| `utxo` | `dict[tuple[bytes, int], TxOut]` | Unspent transaction outputs. Key = `(tx_hash, output_index)`. |
| `pots` | `Pots` | Protocol-level ADA accounting (treasury, reserves, fees, deposited). |
| `protocol_params` | `ProtocolParameters \| None` | Current protocol parameters. `None` = validation disabled (test mode). |
| `accounts` | `dict[bytes, Account]` | Registered stake accounts. Key = 28-byte credential hash. |
| `pools` | `dict[bytes, PoolParams]` | Registered stake pools. Key = 28-byte pool operator hash. |
| `epoch` | `int` | Current epoch number. |
| `slot` | `int` | Slot of the most recently applied block. |
| `network_id` | `int \| None` | 0 = testnet, 1 = mainnet. |
| `epoch_length` | `int` | Slots per epoch (default 432,000 for mainnet). |
| `blocks_made` | `dict[bytes, int]` | Current-epoch block production count per pool. |
| `gov_state` | `GovState \| None` | Conway governance state (proposals, votes, committee). |
| `_go_blocks_made` | `dict[bytes, int]` | Block counts from 2 epochs ago (used by RUPD). |
| `_prev_blocks_made` | `dict[bytes, int]` | Block counts from 1 epoch ago. |
| `_fee_ss` | `int \| None` | Fee snapshot for reward calculation. |
| `_reward_computation_failed` | `bool` | If True, fees go to treasury on next epoch boundary. |
| `_snapshot_rotation` | `SnapshotRotation \| None` | Mark/set/go rotation for leader schedule. |
| `_go_stake_dist` | `dict[bytes, int] \| None` | Frozen stake distribution (2 epochs old). |
| `_set_stake_dist` | `dict[bytes, int] \| None` | Frozen stake distribution (1 epoch old). |
| `_mark_stake_dist` | `dict[bytes, int] \| None` | Frozen stake distribution (current snapshot). |

### Pots

| Field | Type | Description |
|-------|------|-------------|
| `treasury` | `int` | Treasury balance in lovelace. |
| `reserves` | `int` | Reserves balance (uncirculated ADA). |
| `fees` | `int` | Accumulated transaction fees in the current epoch. |
| `deposited` | `int` | Cumulative outstanding deposits (stake keys + pools). |

### Account

| Field | Type | Description |
|-------|------|-------------|
| `deposit` | `int` | Deposit locked for this stake credential registration. |
| `pool` | `bytes \| None` | Pool ID this account delegates to (None = not delegated). |
| `rewards` | `int` | Accumulated reward balance in lovelace. |

### PoolParams

| Field | Type | Description |
|-------|------|-------------|
| `operator` | `bytes` | Pool operator key hash (28 bytes). |
| `vrf_keyhash` | `bytes` | VRF verification key hash. |
| `pledge` | `int` | Declared pledge in lovelace. |
| `cost` | `int` | Fixed cost per epoch in lovelace. |
| `margin` | `tuple[int, int]` | Margin as rational `(numerator, denominator)`. |
| `reward_account` | `bytes` | Reward address for operator rewards (29 bytes). |
| `owners` | `set[bytes]` | Pool owner key hashes (for pledge verification). |
| `retiring_epoch` | `int \| None` | Epoch at which pool retires (None = active). |
| `deposit_paid` | `int` | Actual deposit paid at registration time. |

### ProtocolParameters

Frozen dataclass (~30 fields) merged from three genesis JSON files:

**Fee parameters** (from Shelley genesis):
`min_fee_a`, `min_fee_b` -- linear fee formula: `fee >= min_fee_a * tx_size + min_fee_b`

**Size limits** (Shelley):
`max_block_body_size`, `max_tx_size`, `max_block_header_size`, `max_value_size`

**Deposit parameters** (Shelley):
`stake_credential_deposit`, `stake_pool_deposit`

**Pool parameters** (Shelley):
`pool_retirement_max_epoch`, `optimal_pool_count` (k), `pledge_influence` (a0), `min_pool_cost`

**Economic parameters** (Shelley):
`monetary_expansion` (rho), `treasury_expansion` (tau)

**Plutus parameters** (from Alonzo genesis):
`lovelace_per_utxo_byte`, `collateral_percentage`, `max_collateral_inputs`, `max_tx_ex_units`, `max_block_ex_units`, `cost_models`, `price_mem`, `price_step`

**Governance parameters** (from Conway genesis):
`pool_voting_thresholds`, `drep_voting_thresholds`, `committee_min_size`, `committee_max_term_length`, `gov_action_lifetime`, `gov_action_deposit`, `drep_deposit`, `drep_activity`, `min_fee_ref_script_per_byte`

### Value

Cardano's multi-asset value type:

```
Value = int                                        # pure lovelace
       | list[int, dict[bytes, dict[bytes, int]]]  # [coin, {policy: {asset: qty}}]
```

The list form comes directly from CBOR decoding. All arithmetic operates component-wise.

**Key functions:**
- `lovelace_of(v)` -- extract lovelace (ADA) component
- `multiasset_of(v)` -- extract multi-asset map (empty dict if pure lovelace)
- `value_add(a, b)` -- add component-wise; returns `int` if result has no multi-assets
- `value_sub(a, b)` -- subtract component-wise; raises `ValueError` on negative
- `value_geq(a, b)` -- True if `a >= b` in every component
- `value_eq(a, b)` -- True if equal in every component (handles zero entries)
- `value_non_negative(v)` -- True if all components >= 0
- `value_is_zero(v)` -- True if lovelace is 0 and all assets are 0
- `value_size(v)` -- estimated serialized size for max_value_size checks

---

## Block Application Pipeline

The entry point is `apply_block(state, block)` in `block.py`. Here is the step-by-step flow:

### 1. Slot advancement check
```
if block.slot <= state.slot and state.slot > 0:
    raise BlockValidationError
```
Block slot must strictly increase (except at genesis).

### 2. Epoch boundary transition (TICK rule)
```python
tick(state, block.slot)
```
If the block's slot is in a new epoch, `tick()` fires `_apply_epoch_transition()` for each intermediate epoch. This runs rewards, snapshot rotation, pool retirements, and governance enactment **before** any transactions are processed.

### 3. Block body verification (when protocol_params set)
- **Body hash**: blake2b_256 of each of the 4 component arrays (tx_bodies, witnesses, aux_data, invalid_txs), concatenated into 128 bytes, then hashed again. Must match header claim.
- **Body size**: sum of the 4 component array lengths must match header claim.

### 4. Parse auxiliary data map
Extract per-transaction auxiliary data blobs from the block-level CBOR map.

### 5. For each transaction (indexed by position):

**If the transaction index is in the `invalid_set` (phase-2 failures):**
1. Run phase-2 validation (best-effort, non-fatal)
2. `_apply_invalid_tx()`: consume collateral inputs, produce collateral_return output, add total_collateral (or net collateral) to fee pot.

**If the transaction is valid:**
1. **Phase-1 validation** (`_validate_tx`):
   - `validate_utxo(pp, state, tx, slot)` -- all structural checks
   - `decode_witnesses(witness_raw)` + `validate_witnesses(tx, witnesses, utxo, ...)` -- signature and completeness checks
2. **Phase-2 validation** (`_validate_phase2`):
   - Skip if no redeemers (witness key 5) or no cost_models
   - `eval_scripts(tx, witnesses, utxo, slot, pp, is_valid=True)` -- run Plutus CEK machine
3. **Apply** (`apply_tx(state, tx, pp)`):
   - Process certificates (CERTS rule)
   - Process governance (GOV rule -- voting + proposals)
   - Remove consumed inputs from UTxO
   - Add new outputs to UTxO (keyed by `(tx_id, output_index)`)
   - Add `tx.fee` to `pots.fees`
   - Zero out withdrawal account balances

### 6. Post-transaction updates
- `state.slot = block.slot`
- `state.blocks_made[pool_id] += 1` where `pool_id = blake2b_224(issuer_vkey)`

---

## Validation Rules

### UTxO Rules (Phase 1)

All checks are in `validate_utxo()`. Each returns an error string on failure.

| # | Rule | Description |
|---|------|-------------|
| 1 | Input set non-empty | Transaction must spend at least one input. |
| 2 | All inputs exist in UTxO | Every input reference must be present in the current UTxO set. |
| 3 | Fee >= min_fee | `min_fee = min_fee_a * tx_size + min_fee_b + ref_script_surcharge + script_ex_fee`. Reference script surcharge uses `min_fee_ref_script_per_byte` (CIP-69). |
| 4 | Value conservation | `consumed == produced` where consumed = sum(inputs) + withdrawals + mint, produced = sum(outputs) + fee + deposits + proposal_deposits + treasury + donation. Full multi-asset check. |
| 5 | TTL not expired | If `tx.ttl` is set, `slot <= tx.ttl`. |
| 6 | Validity start | If `tx.validity_start` is set, `slot >= tx.validity_start`. |
| 7 | Output min UTxO | Each output must hold `>= (output_size + 160) * lovelace_per_utxo_byte` lovelace. |
| 8 | Max tx size | `len(tx.raw) <= max_tx_size`. |
| 9 | Network ID check | If tx declares a network ID, it must match `state.network_id`. |
| 10 | Max value size | CBOR-serialized size of each output's value must be `<= max_value_size`. |
| 11 | Output address network | For Shelley addresses (types 0-7), the address network nibble must match `state.network_id`. |
| 12 | Collateral return checks | Min UTxO and max value size on collateral_return output. |
| 13 | Reference input existence | All reference inputs must exist in UTxO. |
| 14 | Max collateral inputs | `len(collateral) <= max_collateral_inputs`. |
| 15 | Collateral at VKey addresses | Collateral inputs must be at Shelley VKey addresses (no Byron, no script addresses). |
| 16 | Collateral balance | Net collateral must be ADA-only and `>= tx.fee * collateral_percentage / 100`. |
| 17 | Withdrawal amount match | Each withdrawal amount must exactly equal the account's reward balance. Credential must be registered. |
| 18 | No ADA minting | Empty policy ID (b"") is forbidden in the mint field. |
| 19 | Max tx execution units | Total redeemer ExUnits must not exceed `max_tx_ex_units` (enforced at phase-2). |

### Witness Rules

Implemented in `validate_witnesses()`:

**1. VKey signature verification:**
For each `[vkey, signature]` pair in witness key 0, verify `ed25519.verify(vkey, signature, tx_body_hash)`. Track `blake2b_224(vkey)` of successful verifications.

**2. Required key hashes** (`required_key_hashes()`):
The set of key hashes that must have valid signatures is the union of:
- Explicit `required_signers` field
- Payment credentials from input addresses (UTxO lookup, Shelley key-hash addresses only)
- Staking credentials from withdrawal addresses (key-hash only)
- Certificate credentials: deregistration (1), delegation (2), Conway unreg (8), vote/stake deleg (9-13)
- Pool retirement (4): pool operator key hash
- Pool registration (3): operator key hash
- Collateral input payment credentials (key-hash only)

Every required hash must appear in the verified set.

**3. Script completeness:**
When redeemers are present (witness key 5): for every script-hash input, a matching script must exist in the witness set (keys 3/6/7) or via reference inputs. A datum must be available (inline or in witness key 4).

**4. Script data hash:**
If `tx.script_data_hash` is set: `blake2b_256(redeemers_raw ++ datums_raw ++ language_views_cbor)` must match. Language views have a PlutusV1 quirk: cost model values are CBOR-encoded as an integer list, then that encoding is wrapped as a CBOR bytestring.

**5. Auxiliary data hash:**
If `tx.auxiliary_data_hash` is set and auxiliary data is present, `blake2b_256(auxiliary_data_raw)` must match.

### Certificate Processing

Implemented in `rules/certs.py`. Each certificate type modifies ledger state:

| Type | Name | State Change |
|------|------|-------------|
| 0 | StakeRegistration | Create `Account(deposit=keyDeposit)` in `state.accounts`. Error if already registered. |
| 1 | StakeDeregistration | Remove account from `state.accounts`. Requires zero reward balance. |
| 2 | StakeDelegation | Set `account.pool = pool_id`. Must be registered. |
| 3 | PoolRegistration | Create/update `PoolParams` in `state.pools` (operator, VRF, pledge, cost, margin, reward_account, owners). Validates `cost >= min_pool_cost`. |
| 4 | PoolRetire | Set `pool.retiring_epoch`. Validates retirement epoch is after current and within `current + eMax`. |
| 7 | RegCert (Conway) | Register with explicit deposit amount. |
| 8 | UnregCert (Conway) | Deregister with explicit refund. Requires zero rewards. |
| 9 | VoteDeleg | Delegate voting to DRep (no registration required). |
| 10 | StakeVoteDeleg | Delegate stake + voting simultaneously. |
| 11 | StakeRegDeleg | Register + delegate stake in one cert (deposit is last field). |
| 12 | VoteRegDeleg | Register + delegate voting (deposit is last field). |
| 13 | StakeVoteRegDeleg | Register + delegate both (deposit is last field). |
| 14 | AuthCommitteeHot | Authorize CC hot key; marks cold credential active in `gov_state.committee`. |
| 15 | ResignCommitteeCold | Remove cold credential from `gov_state.committee`. |
| 16 | DRepRegistration | Add DRep to `gov_state.dreps` with deposit. |
| 17 | DRepDeregistration | Remove DRep from `gov_state.dreps`. |
| 18 | DRepUpdate | No-op (metadata-only, no state change). |

---

## Epoch Boundary

When a block crosses an epoch boundary, `tick()` fires `_apply_epoch_transition()` for each intermediate epoch. The transition performs the following steps in order:

### 1. Fee snapshot capture
The current accumulated fees become the fee snapshot for the **next** epoch's reward computation. Captured **before** rewards consume the old snapshot.

### 2. Reward computation and distribution (`_apply_rewards`)
Uses the "go" stake distribution (2 epochs delayed) and "go" block counts (also 2 epochs delayed). Calls `compute_reward_update()` then `apply_reward_update()`. If computation fails, fees go to treasury instead.

### 3. Stake snapshot rotation (`_rotate_snapshots`)
Maintains the `SnapshotRotation` object for leader schedule lookups. Computes a fresh mark snapshot from current state.

### 4. Pool retirement (`_retire_pools`)
For each pool with `retiring_epoch <= new_epoch`:
- Refund `deposit_paid` to the pool's reward account credential (or treasury if credential not registered)
- Remove pool from `state.pools`
- Clear all delegations pointing to the retired pool (`account.pool = None`)

### 5. Governance enactment (`_enact_governance`)
Calls `enact_governance(state, gov_state, new_epoch)` to ratify and enact proposals that meet voting thresholds. Expired proposals have their deposits refunded.

### 6. Block count rotation (3-way)
```
_go_blocks_made  <- _prev_blocks_made
_prev_blocks_made <- blocks_made
blocks_made <- {}
```
The spec uses "go" blocks (2 epochs back) for reward calculation.

### 7. Fee reset
If reward computation succeeded, `pots.fees = 0`. If failed, `pots.treasury += pots.fees; pots.fees = 0`.

### 8. Stake distribution rotation
```
_go_stake_dist  <- _set_stake_dist
_set_stake_dist <- _mark_stake_dist
_mark_stake_dist <- _compute_current_stake_dist(state)
```

### 9. Epoch counter update
`state.epoch = new_epoch`

---

## Reward Calculation

The `compute_reward_update()` function in `rewards.py` implements the `createRUpd` rule from the Shelley formal spec (Section 5.5). The algorithm:

### Step 1: Compute eta (block production efficiency)
```
expected_blocks = epoch_length / ACTIVE_SLOT_COEFF_DENOM   # 1/20 = 5%
eta = min(1, total_blocks / expected_blocks)
```
In Conway, `d = 0` always, so eta is always the block ratio.

### Step 2: Monetary expansion
```
delta_r1 = floor(eta * rho * reserves)
```
This is the new ADA minted from reserves this epoch.

### Step 3: Reward pot
```
rewardPot = feeSS + delta_r1
```
The fee snapshot (from the previous epoch) plus the newly minted ADA.

### Step 4: Treasury cut
```
delta_t1 = floor(tau * rewardPot)
```

### Step 5: Available rewards
```
R = rewardPot - delta_t1
```

### Step 6: Per-pool reward computation

For each pool that produced blocks:

**Pool-level parameters:**
```
sigma   = pool_stake / circulation          # for maxPool and leader/member split
sigma_a = pool_stake / total_active_stake   # for apparent performance
p_r     = pledge / circulation              # relative pledge
```

**Pledge enforcement:**
If `owner_stake < pool.pledge`, the pool receives zero rewards.

**maxPool** (pledge-adjusted desirability):
```
z0 = 1/k
sigma' = min(sigma, z0)
p'     = min(p_r, z0)
maxPool = floor(R / (1+a0) * (sigma' + p'*a0 * (sigma' - p'*(z0-sigma')/z0) / z0))
```

**Apparent performance:**
```
beta = n_blocks / max(1, total_blocks)
appPerf = beta / sigma_a
```

**Pool reward:**
```
pool_r = floor(appPerf * maxPool)
```

**Leader / member split:**
```
r_operator = cost + floor((pool_r - cost) * (margin + (1-margin) * s/sigma))  if pool_r > cost
r_member   = floor((pool_r - cost) * (1-margin) * t/sigma)                    if pool_r > cost
```
Where `s` = owner relative stake, `t` = member relative stake. Rounding dust goes to the leader.

### Step 7: Residual
```
delta_r2 = R - sum(distributed_rewards)
```
Undistributed rewards return to reserves.

### Application
`apply_reward_update()` credits `delta_treasury` to treasury, `delta_reserves` to reserves, `delta_fees` to fees, and individual reward amounts to `account.rewards` (or treasury if credential is not registered).

---

## Plutus Evaluation

### Script Context Building

Three versions of TxInfo are supported, each with increasing field counts:

| Version | Fields | Key Additions |
|---------|--------|--------------|
| V1 | 10 | 3-field TxOut (no datum_option / script_ref), list-of-pairs withdrawals, no ref_inputs or redeemers |
| V2 | 12 | 4-field TxOut, ref_inputs, redeemers map, datum option (NoOutputDatum/OutputDatumHash/OutputDatum) |
| V3 | 16 | Adds voting procedures, proposal procedures, current_treasury, treasury_donation |

**V3 DCert encoding** maps CBOR wire types to Plutus V3 constructor tags (they differ). For example, wire type 3 (PoolRegistration) maps to Plutus V3 tag 7 (TxCertPoolRegister).

### eval_scripts() Driver

The evaluation loop in `evaluate.py`:

1. **Decode redeemers** -- supports both Conway map format `{[tag, idx]: [data, [mem, steps]]}` and Babbage list format.
2. **Collect scripts** -- from witness set (keys 3/6/7) and reference inputs. Script hash = `blake2b_224(version_prefix + flat_bytes)`.
3. **For each redeemer `(tag, index)`**:
   a. Resolve the script hash via sorted input/policy/withdrawal index lookup.
   b. Find the script bytes (witness or reference).
   c. Build arguments:
      - **V3**: single arg = `ScriptContext(TxInfo, Redeemer, ScriptInfo)`
      - **V1/V2 spending**: 3 args = `(datum, redeemer, ScriptContext)`
      - **V1/V2 minting/cert/reward**: 2 args = `(redeemer, ScriptContext)`
   d. Run the CEK machine: `unflatten(flat_bytes)` -> `Apply(f=term, x=arg)` for each arg -> `Machine(Budget(steps, mem), cek_model, builtin_model).eval(program)`.
   e. Check result: `RuntimeError` = failure; V3 requires `BuiltinUnit`; V1/V2 accepts any non-error.
4. **is_valid cross-check**: if `is_valid=False` but all scripts passed, that is an error.

### Cost Model Resolution

On-chain cost models from `pp.cost_models` are preferred (via `uplc.cost_model.updated_*_from_network_config()`). Supports both dict-format (named string keys from genesis JSON) and list-format (integer arrays from on-chain updates). Falls back to uplc default cost models on parse failure.

---

## Governance

Conway governance (CIP-1694) is implemented in `governance.py`.

### Proposal Lifecycle

```
submit (in tx) --> active proposal --> vote --> ratify (epoch boundary) --> enact / expire
```

1. **Submit**: `process_proposal_procedures()` registers proposals in `gov_state.proposals` with deposit, return address, action type, and expiry (`epoch + gov_action_lifetime`).
2. **Vote**: `process_voting_procedures()` records `GovVote` entries in `gov_state.votes`. Voter eligibility is checked (CC members, registered DReps, registered pools).
3. **Ratify** (at epoch boundary): `_is_ratified()` checks stake-weighted voting thresholds. CC uses head-count. DRep and SPO use stake-weighted tallies.
4. **Enact/Expire**: Enacted proposals have their effects applied and deposits refunded. Expired proposals only get deposits refunded.

### Action Types and Enactment

| Action | Enactment Effect |
|--------|------------------|
| ParameterChange | `dataclasses.replace(protocol_params, **overrides)` via `_PARAM_KEY_MAP` (CBOR key -> field name mapping). Handles rational conversion for keys 9, 10, 11, 19, 20, 34. |
| HardForkInitiation | No ledger-level effect (handled by consensus layer). |
| TreasuryWithdrawals | Transfer lovelace from treasury to specified reward accounts. |
| NoConfidence | Dissolve the constitutional committee (`gov_state.committee = {}`). |
| UpdateCommittee | Add/remove committee members with expiry epochs. |
| NewConstitution | Update `gov_state.constitution_hash`. |
| InfoAction | Always ratified, no on-chain effect. |

### Stake-Weighted Voting

Three voter groups with per-action-type requirements:

| Action | CC Required | DRep Required | SPO Required |
|--------|------------|---------------|-------------|
| ParameterChange | Yes | Yes | No |
| HardForkInitiation | Yes | Yes | Yes |
| TreasuryWithdrawals | Yes | Yes | No |
| NoConfidence | No | Yes | Yes |
| UpdateCommittee | No | Yes | Yes |
| NewConstitution | Yes | Yes | No |
| InfoAction | No | No | No |

Thresholds are looked up from `pp.pool_voting_thresholds` and `pp.drep_voting_thresholds` with fallback defaults of 50%. CC uses simple majority by head count. DRep/SPO voting is stake-weighted: DRep stake is the DRep's deposit (or their own account balance as fallback); SPO stake is the pool's total delegated stake.

---

## Snapshot Import

`load_snapshot()` in `snapshot.py` bootstraps a `LedgerState` from an Amaru-format NewEpochState CBOR file (produced by `amaru convert-ledger-state`).

### Data Extracted

| Snapshot Field | State Field | Description |
|---------------|-------------|-------------|
| `root[0]` | `epoch` | Current epoch number |
| `root[1]` (nesBprev) | `_go_blocks_made` | Previous-epoch block counts |
| `root[2]` (nesBcur) | `_prev_blocks_made` | Current-epoch block counts |
| `epoch_state[0]` | `pots.treasury`, `pots.reserves` | AccountState |
| `cert_state[1]` | `pools` | PoolState (params + retirements) |
| `deleg_state[0][0]` | `accounts` | Conway UMap format accounts |
| `utxo_state[0]` | `utxo` | Full UTxO map |
| `epoch_state[2]` | `_mark/_set/_go_stake_dist`, `_fee_ss` | Stake snapshots + fee snapshot |
| `utxo_state[3][3]` | `protocol_params` | On-chain protocol parameters (31-element array) |

### Conway UMap Account Format

```
entry = [StrictMaybe<(rewards, deposit)>, set_pointers, StrictMaybe<pool_id>, StrictMaybe<DRep>]
```

- `v[0] = [[rewards, deposit]]` -- rewards first, deposit second (NOT key-value pairs)
- `v[1]` -- cert pointers (always empty in Conway)
- `v[2] = [pool_id_bytes]` -- pool delegation
- `v[3]` -- DRep delegation variant

### Streaming Parser

For mainnet (~15M UTxO), `parse_new_epoch_state_streaming()` walks the CBOR byte-by-byte using `_walk_array_items` and `_walk_map_entries` from the schema library, decoding each UTxO entry individually rather than loading the entire decoded map into memory.

### TxOut Reconstruction

The snapshot parser preserves `datum_hash`, `inline_datum`, and `script_ref` from dict-format UTxO entries (post-Alonzo map keys 2 and 3). Inline datums wrapped in CBOR tag 24 are unwrapped to raw bytes. Script references are stored as CBOR-encoded blobs.

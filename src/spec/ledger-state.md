# 4. Ledger State and Block Application

This chapter defines the ledger state type, the block and transaction
application rules, and the multi-asset value algebra that underlies ADA
accounting.  All definitions correspond directly to the implementation in
`bluematter/ledger/`.

---

## 4.1 State Type

The ledger state is the tuple

```
sigma = ( U, P, pi, A, Pools, e, s, net, bm, G, R )
```

| Symbol | Type | Field | Description |
|--------|------|-------|-------------|
| `U` | `M[(B_32 x N), TxOut]` | `utxo` | Unspent transaction outputs. Key = `(tx_hash, output_index)`. |
| `P` | `Pots` | `pots` | Protocol-level ADA accounting (see below). |
| `pi` | `ProtocolParameters?` | `protocol_params` | Active protocol parameters; `None` in legacy mode. |
| `A` | `M[B_28, Account]` | `accounts` | Stake accounts keyed by credential hash. |
| `Pools` | `M[B_28, PoolParams]` | `pools` | Registered stake pools keyed by operator key hash. |
| `e` | `N` | `epoch` | Current epoch number. |
| `s` | `N` | `slot` | Slot of the most recently applied block. |
| `net` | `{0,1}?` | `network_id` | `0` = testnet, `1` = mainnet, `None` = unconstrained. |
| `bm` | `M[B_28, N]` | `blocks_made` | Per-pool block production count for the current epoch. |
| `G` | `GovState?` | `gov_state` | Governance state (proposals, votes, committee). |
| `R` | internal | epoch rotation | Snapshot and fee rotation state (see Section 4.7). |

### 4.1.1 Pots

```
Pots = { treasury : Z,  reserves : Z,  fees : Z,  deposited : Z }
```

All fields are in lovelace.  `deposited` tracks the cumulative outstanding
deposit balance.  The ADA conservation law requires at all times:

```
treasury + reserves + fees + deposited + sum(lovelace(U[k]) for k in dom(U))
    + sum(A[c].rewards + A[c].deposit for c in dom(A))
    = MAX_SUPPLY
```

where `MAX_SUPPLY = 45 * 10^15` lovelace.

### 4.1.2 Account

```
Account = { deposit : N,  pool : B_28?,  rewards : N }
```

`deposit` is the lovelace locked at registration.  `pool` is the pool to
which this credential delegates (or `None`).  `rewards` accumulates
distribution proceeds.

### 4.1.3 PoolParams

```
PoolParams = { operator     : B_28,
               vrf_keyhash  : B_32,
               pledge       : N,
               cost         : N,
               margin       : (N, N),       -- rational (numerator, denominator)
               reward_account : B,
               owners       : S[B_28],
               retiring_epoch : N?,
               deposit_paid : N }
```

`margin` is a non-negative rational in `[0, 1]`.  `retiring_epoch`, when
set, marks the epoch at which the pool will be retired by the `TICK` rule.

---

## 4.2 Block Application Rule (BBODY)

A Conway block is the 5-tuple

```
beta = ( header, txs, witnesses, auxiliary_data, invalid_txs )
```

with convenience projections `slot(beta)`, `pool_id(beta)`, `body_hash(beta)`,
`body_size(beta)`, and `issuer_vkey(beta)` derived from the header body.

**Block application** `apply_block(sigma, beta) -> sigma'` implements the
BBODY rule.  The inference rule is:

```
  TICK:     tick(sigma, slot(beta))                                [epoch boundary]
  HASH:     body_hash_valid(beta)                                  [4.2.1]
  SIZE:     body_size_valid(beta)                                  [4.2.2]
  SLOT:     slot(beta) > sigma.slot  OR  sigma.slot = 0            [slot monotonicity]
  VALID:    forall i in {0..|txs|-1} \ invalid(beta):
              validate_utxo(pi, sigma_i, txs[i], slot(beta)) = []
              AND validate_witnesses(txs[i], witnesses[i], sigma_i.utxo, ...) = []
              AND validate_phase2(sigma_i, pi, txs[i], ...) passes
              AND sigma_{i+1} = apply_tx(sigma_i, txs[i], pi)
  INVALID:  forall j in invalid(beta):
              sigma' = apply_invalid(sigma, beta, j)               [4.4]
  ────────────────────────────────────────────────────────────────────────
  sigma ->_beta sigma'
    where  sigma'.slot = slot(beta)
           sigma'.blocks_made[pool_id(beta)] += 1
           pool_id(beta) = H_224(issuer_vkey(beta))
```

Valid and invalid transactions are processed in index order: each valid
transaction sees the state produced by all preceding transactions (both
valid and invalid).  The `pool_id` is the Blake2b-224 hash of the block
issuer's verification key.

### 4.2.1 Body Hash Verification

```
body_hash_valid(beta) iff
  let h1 = H_256(beta.tx_bodies_array_raw)
      h2 = H_256(beta.tx_witnesses_array_raw)
      h3 = H_256(beta.auxiliary_data_raw)
      h4 = H_256(beta.invalid_txs_raw)
  in  H_256(h1 || h2 || h3 || h4) = beta.header.header_body.block_body_hash
```

Each of the four component arrays is hashed individually to produce a
32-byte digest.  The four digests are concatenated into a 128-byte preimage,
which is hashed once more to obtain the block body hash.

### 4.2.2 Body Size Verification

```
body_size_valid(beta) iff
  |beta.tx_bodies_array_raw|
  + |beta.tx_witnesses_array_raw|
  + |beta.auxiliary_data_raw|
  + |beta.invalid_txs_raw|
  = beta.header.header_body.block_body_size
```

### 4.2.3 Auxiliary Data Map

The block-level auxiliary data field is a CBOR map `{tx_index : aux_data}`.
For each transaction index `i`, if `i` is a key in this map, the
corresponding raw bytes are passed to witness validation for auxiliary
data hash verification.

---

## 4.3 Transaction Application Rule

Transaction application `apply_tx(sigma, tau, pi) -> sigma'` mutates
the state in place.  The ordering follows the formal specification:
certificates, then governance, then UTxO state changes.

**Precondition.** The caller must have already verified all validation
rules (UTXO, UTXOW, Phase-2).  `apply_tx` does not validate; it only
applies the state transition.

```
  CERTS:  certs_ok = process_certificates(sigma, tau.certificates, pi)     [if tau.certificates != None]
  GOV:    process_voting_procedures(sigma.gov_state, tau.voting_procedures) [if present]
          process_proposal_procedures(sigma.gov_state, tau.proposal_procedures, tau.tx_id, sigma.epoch, pi)
  ─────────────────────────────────────────────────────────────────────
  sigma ->_tau sigma'
    where
      -- 1. Remove consumed inputs
      sigma'.utxo = sigma.utxo \ { k -> _ | k in keys(tau) }
        where keys(tau) = { input_key(inp) | inp in tau.inputs }

      -- 2. Add new outputs
      sigma'.utxo = sigma'.utxo  U  { (tau.tx_id, i) -> tau.outputs[i] | i in 0..|tau.outputs|-1 }

      -- 3. Collect fees
      sigma'.pots.fees = sigma.pots.fees + tau.fee

      -- 4. Debit withdrawal accounts
      forall (reward_addr, amount) in tau.withdrawals:
        let cred = reward_addr[1:29]
        in  sigma'.accounts[cred].rewards = 0
```

The `input_key` function normalises CBOR-decoded inputs:

```
input_key(inp) =
  | (bytes(inp.tx_hash), inp.output_index)   if inp is TxIn
  | (bytes(inp[0]), inp[1])                  if inp is list/tuple
```

The transaction identifier is defined as:

```
tau.tx_id = H_256(tau.raw)
```

where `tau.raw` is the original CBOR encoding of the transaction body map,
byte-sliced from the block (never re-encoded).

---

## 4.4 Invalid Transaction Processing

An invalid transaction is one whose index appears in `beta.invalid_txs`
(the block's phase-2 failure list).  For invalid transactions, collateral
is consumed instead of regular inputs.

```
apply_invalid(sigma, beta, j):
  let tau = beta.transactions[j]

  -- Compute collateral input value
  collateral_value = sum { lovelace(sigma.utxo[input_key(inp)])
                         | inp in tau.collateral,
                           input_key(inp) in dom(sigma.utxo) }

  -- Consume collateral inputs
  sigma'.utxo = sigma.utxo \ { input_key(inp) -> _ | inp in tau.collateral }

  -- Produce collateral return output (if declared)
  return_value = 0
  if tau.collateral_return != None:
    let idx_ret = |tau.outputs|
    sigma'.utxo[(tau.tx_id, idx_ret)] = tau.collateral_return
    return_value = lovelace(tau.collateral_return.amount)

  -- Collect fees
  if tau.total_collateral != None:
    sigma'.pots.fees += tau.total_collateral
  else:
    let net = collateral_value - return_value
    if net > 0:
      sigma'.pots.fees += net
```

The collateral return output is indexed at `|tau.outputs|`, i.e. one past
the last regular output index, per the Alonzo specification.

---

## 4.5 Value Arithmetic

Cardano values are either pure lovelace (a non-negative integer) or a
multi-asset bundle:

```
Value = N                                       -- pure lovelace
      | [N, M[B_28, M[B, Z]]]                  -- [lovelace, {policy_id: {asset_name: quantity}}]
```

The multi-asset map uses 28-byte policy IDs as outer keys and arbitrary
byte-string asset names as inner keys.  Quantities are signed integers
(minting can be negative for burns).

### 4.5.1 Projection

```
lovelace(v) =
  | v       if v in N
  | v[0]    if v is list and |v| >= 1
  | 0       otherwise

multiasset(v) =
  | {}      if v in N
  | v[1]    if v is list and |v| >= 2
  | {}      otherwise
```

### 4.5.2 Addition

```
value_add(a, b) =
  let l = lovelace(a) + lovelace(b)
      m = merge(multiasset(a), multiasset(b))
  in  if m = {} then l else [l, m]

merge(ma, mb) =
  let r = copy(ma)
  forall (p, assets) in mb:
    forall (a, q) in assets:
      r[p][a] = r[p].get(a, 0) + q
  return clean(r)
```

### 4.5.3 Subtraction

```
value_sub(a, b) =
  let l = lovelace(a) - lovelace(b)
  if l < 0: raise ValueError
  let r = copy(multiasset(a))
  forall (p, assets) in multiasset(b):
    forall (a, q) in assets:
      let c = r[p].get(a, 0) - q
      if c < 0: raise ValueError
      r[p][a] = c
  return if clean(r) = {} then l else [l, clean(r)]
```

### 4.5.4 Comparison

```
value_geq(a, b) =
  lovelace(a) >= lovelace(b)
  AND forall (p, assets) in multiasset(b):
    forall (a, q) in assets:
      multiasset(a).get(p, {}).get(a, 0) >= q
```

### 4.5.5 Zero Test

```
value_is_zero(v) =
  lovelace(v) = 0
  AND forall (p, assets) in multiasset(v):
    forall (a, q) in assets: q = 0
```

### 4.5.6 Equality

```
value_eq(a, b) =
  lovelace(a) = lovelace(b)
  AND forall p in dom(multiasset(a)) U dom(multiasset(b)):
    forall a in dom(multiasset(a).get(p,{})) U dom(multiasset(b).get(p,{})):
      multiasset(a).get(p,{}).get(a,0) = multiasset(b).get(p,{}).get(a,0)
```

### 4.5.7 Cleaning

```
clean(ma) = { p -> { a -> q | (a,q) in assets, q != 0 }
            | (p, assets) in ma,
              { a -> q | (a,q) in assets, q != 0 } != {} }
```

Zero-quantity entries and empty policy maps are removed after every
arithmetic operation to maintain a canonical representation.

---

## 4.6 Epoch Boundary (TICK Rule)

The TICK rule fires when a block's slot falls in a new epoch.  It is
applied *before* the block's transactions are processed.

```
tick(sigma, new_slot):
  let e_new = new_slot / sigma.epoch_length    -- integer division
  while sigma.epoch < e_new:
    apply_epoch_transition(sigma, sigma.epoch + 1)
```

When multiple epoch boundaries are crossed (e.g. empty epochs), each
intermediate transition is applied individually.

### 4.6.1 Epoch Transition

```
apply_epoch_transition(sigma, e_new):
  -- 1. Capture fee snapshot for NEXT epoch's reward computation
  fee_ss_new = sigma.pots.fees

  -- 2. Compute and apply rewards (RUPD rule)
  apply_rewards(sigma)
    using sigma._go_blocks_made       -- blocks from 2 epochs ago
    using sigma._go_stake_dist        -- stake distribution from 2 epochs ago
    using sigma._fee_ss               -- fee snapshot from previous epoch

  -- 3. Rotate stake snapshots (mark/set/go for leader schedule)
  rotate_snapshots(sigma)

  -- 4. Execute pool retirements
  forall pool_id in { p | sigma.pools[p].retiring_epoch <= e_new }:
    refund(sigma, pool_id)            -- deposit to reward account
    del sigma.pools[pool_id]
    forall acct in sigma.accounts.values():
      if acct.pool = pool_id: acct.pool = None

  -- 5. Enact ratified governance proposals
  enact_governance(sigma, sigma.gov_state, e_new)

  -- 6. Rotate block production counts (3-way pipeline)
  sigma._go_blocks_made  = sigma._prev_blocks_made
  sigma._prev_blocks_made = sigma.blocks_made
  sigma.blocks_made = {}

  -- 7. Set fee snapshot; reset fee pot
  sigma._fee_ss = fee_ss_new
  if NOT sigma._reward_computation_failed:
    sigma.pots.fees = 0
  else:
    sigma.pots.treasury += sigma.pots.fees
    sigma.pots.fees = 0
    sigma._reward_computation_failed = false

  -- 8. Rotate stake distribution snapshots
  sigma._go_stake_dist  = sigma._set_stake_dist
  sigma._set_stake_dist = sigma._mark_stake_dist
  sigma._mark_stake_dist = compute_current_stake_dist(sigma)

  -- 9. Advance epoch
  sigma.epoch = e_new
```

### 4.6.2 Pool Retirement Refund

```
refund(sigma, pool_id):
  let pool = sigma.pools[pool_id]
  let cred = pool.reward_account[1:29]
  if cred in dom(sigma.accounts):
    sigma.accounts[cred].rewards += pool.deposit_paid
  else:
    sigma.pots.treasury += pool.deposit_paid
```

The actual deposit paid at registration time (`deposit_paid`) is refunded,
not the current protocol parameter value.

### 4.6.3 Stake Distribution Computation

```
compute_current_stake_dist(sigma) -> M[B_28, N]:
  dist = {}
  -- Delegated account balances
  forall (cred, acct) in sigma.accounts:
    if acct.pool != None AND acct.pool in dom(sigma.pools):
      dist[cred] = acct.deposit + acct.rewards

  -- UTxO stake at base addresses (types 0-3)
  forall out in sigma.utxo.values():
    let addr = out.address
    if |addr| >= 57 AND (addr[0] >> 4) <= 3:
      let staking_cred = addr[29:57]
      if staking_cred in dom(dist):
        dist[staking_cred] += lovelace(out.amount)

  return dist
```

---

## 4.7 Epoch Rotation State

The implementation maintains internal rotation state for the reward
computation pipeline.  These fields are not visible to external consumers
but are critical for correctness.

| Field | Type | Description |
|-------|------|-------------|
| `_go_blocks_made` | `M[B_28, N]` | Block counts from 2 epochs ago (used by RUPD). |
| `_prev_blocks_made` | `M[B_28, N]` | Block counts from 1 epoch ago. |
| `_fee_ss` | `N?` | Fee snapshot for the current epoch's reward computation. |
| `_reward_computation_failed` | `bool` | If true, fees go to treasury at next boundary. |
| `_go_stake_dist` | `M[B_28, N]?` | Stake distribution from 2 epochs ago. |
| `_set_stake_dist` | `M[B_28, N]?` | Stake distribution from 1 epoch ago. |
| `_mark_stake_dist` | `M[B_28, N]?` | Stake distribution snapshot from current epoch. |
| `_snapshot_rotation` | `SnapshotRotation?` | Leader schedule snapshot state. |

The three-stage pipeline (`mark -> set -> go`) ensures that reward
calculations use stake distributions and block counts that are two full
epochs old, preventing manipulation of the reward function by strategic
delegation timing.

---

## 4.8 Certificate Processing (CERTS Rule)

Certificates are processed before UTxO state changes, per the formal
specification ordering.  Each certificate type modifies the ledger state
as follows.

| Type | Name | State Change |
|------|------|--------------|
| 0 | StakeReg | `sigma.accounts[cred] = Account(deposit=pi.stake_credential_deposit)` |
| 1 | StakeUnreg | `del sigma.accounts[cred]` (requires `rewards = 0`) |
| 2 | StakeDeleg | `sigma.accounts[cred].pool = pool_id` |
| 3 | PoolReg | `sigma.pools[operator] = PoolParams(...)` |
| 4 | PoolRetire | `sigma.pools[pool_id].retiring_epoch = e_retire` |
| 7 | RegCert | `sigma.accounts[cred] = Account(deposit=explicit_deposit)` |
| 8 | UnregCert | `del sigma.accounts[cred]` (requires `rewards = 0`) |
| 9 | VoteDeleg | Delegate vote to DRep (no registration). |
| 10 | StakeVoteDeleg | `sigma.accounts[cred].pool = pool_id` + vote delegation. |
| 11 | StakeRegDeleg | Register + `sigma.accounts[cred].pool = pool_id`. |
| 12 | VoteRegDeleg | Register + vote delegation. |
| 13 | StakeVoteRegDeleg | Register + stake + vote delegation. |
| 14 | AuthCommitteeHot | Authorize CC hot key in `sigma.gov_state`. |
| 15 | ResignCommitteeCold | Remove CC member from `sigma.gov_state`. |
| 16 | DRepReg | `sigma.gov_state.dreps[cred] = deposit`. |
| 17 | DRepUnreg | `del sigma.gov_state.dreps[cred]`. |
| 18 | DRepUpdate | No state change. |

### 4.8.1 Deposit Accounting

The `_total_deposits` function computes the net deposit change for value
conservation:

```
deposits(pi, tau, sigma) =
  sum over cert in tau.certificates:
    | +pi.stake_credential_deposit         if cert.type = 0
    | -pi.stake_credential_deposit         if cert.type = 1
    | +pi.stake_pool_deposit               if cert.type = 3 AND operator not in dom(sigma.pools)
    |  0                                   if cert.type = 3 AND operator in dom(sigma.pools)  [re-registration]
    | +cert.explicit_deposit               if cert.type in {7, 11, 12, 13, 16}
    | -cert.explicit_refund                if cert.type in {8, 17}
    |  0                                   otherwise
```

Pool re-registrations (type 3 where the operator is already registered)
do not require an additional deposit.

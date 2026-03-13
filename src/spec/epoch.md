# 8 Epoch Boundary Transitions

This chapter specifies the TICK and NEWEPOCH rules that govern state changes
at epoch boundaries. These transitions control reward distribution, stake
snapshot rotation, pool retirements, governance enactment, and bookkeeping
resets.

**Source modules:**
- `ledger/epoch.py` - epoch detection, transition orchestration
- `ledger/stake_snapshot.py` - StakeSnapshot, SnapshotRotation
- `ledger/snapshot.py` - Amaru NewEpochState CBOR import

---

## 8.1 Epoch Boundary Detection

### Definitions

```
epoch_length : N                          -- slots per epoch (mainnet = 432,000)

epoch : Slot → N
epoch(s) = ⌊s / epoch_length⌋
```

### TICK Rule

The TICK rule fires before processing each block. If the block's slot falls
in a new epoch, it triggers the epoch transition. When multiple epochs are
skipped (e.g., after a long outage), each intermediate boundary is processed
sequentially.

```
tick : (σ, Slot) → σ
tick(σ, s):
  ε' ← epoch(s)
  while σ.epoch < ε':
    σ ← epoch_transition(σ, σ.epoch + 1)
  return σ
```

**Invariant:** Intermediate epoch boundaries are never skipped. Pool
retirements, rewards, and governance enactment fire at their scheduled epoch,
not deferred to the next observed block.

---

## 8.2 Epoch Transition

The transition is a 9-step atomic state update. Each step mutates `σ` in
place and is specified as a formal state update.

```
epoch_transition : (σ, N) → σ
epoch_transition(σ, ε'):
```

### Step 1 - Capture Fee Snapshot

Capture the current fee pot *before* reward application consumes the previous
snapshot. This value becomes the fee input to the *next* epoch's reward
computation.

```
  fee_ss ← σ.pots.fees
```

### Step 2 - Compute and Apply Rewards

Reward computation uses data frozen two epochs ago (the "go" snapshot) per
the Shelley formal specification. See Chapter 9 for the full reward formula.

```
  blocks ← σ._go_blocks_made          -- blocks from 2 epochs ago
  if blocks = ∅:
    blocks ← σ._prev_blocks_made      -- fallback: 1 epoch ago
  if blocks = ∅:
    blocks ← σ.blocks_made            -- fallback: current

  stake ← σ._go_stake_dist            -- stake snapshot from 2 epochs ago
  if stake = ⊥:
    stake ← compute_current_stake_dist(σ)

  fees_for_rupd ← σ._fee_ss  if σ._fee_ss ≠ ⊥  else  σ.pots.fees

  R ← compute_reward_update(σ, blocks, stake, fees_for_rupd)
  apply_reward_update(σ, R)
```

If reward computation fails (exception), set `σ._reward_computation_failed ← true`.
This causes Step 7 to redirect accumulated fees to treasury rather than
resetting them to zero (a safety measure to prevent ADA loss).

### Step 3 - Rotate Stake Snapshots (SnapshotRotation)

The SnapshotRotation object tracks per-pool and per-credential stake for
leader schedule lookups. This is a structural rotation only; the raw
stake distributions used by rewards are rotated separately in Step 8.

```
  mark_new ← compute_stake_snapshot(σ)    -- fresh snapshot from current state

  σ._snapshot_rotation.go  ← σ._snapshot_rotation.set
  σ._snapshot_rotation.set ← σ._snapshot_rotation.mark
  σ._snapshot_rotation.mark ← mark_new
```

Where `compute_stake_snapshot` produces a `StakeSnapshot` containing:

```
StakeSnapshot = {
  pool_stake       : M[H_224, Coin],       -- per-pool total stake
  credential_stake : M[H_224, Coin],       -- per-credential stake
  total_active_stake : Coin,               -- sum of all delegated stake
  epoch            : N                      -- epoch at which snapshot was taken
}
```

### Step 4 - Retire Pools

For each pool `p ∈ dom(σ.pools)` where `p.retiring_epoch ≤ ε'`:

```
  refund ← p.deposit_paid                 -- actual deposit, not current param

  cred ← p.reward_account[1:29]           -- extract payment credential
  if cred ∈ dom(σ.accounts):
    σ.accounts[cred].rewards += refund
  else:
    σ.pots.treasury += refund              -- unregistered → treasury

  delete σ.pools[p]

  ∀ acct ∈ σ.accounts where acct.pool = p:
    acct.pool ← ⊥                         -- clear delegation
```

### Step 5 - Enact Governance

Process all pending governance proposals:

```
  ∀ (key, proposal) ∈ σ.gov_state.proposals:
    if proposal.expires_epoch < ε':
      -- Expired: refund deposit, remove proposal
      refund_deposit(σ, proposal)
      delete σ.gov_state.proposals[key]
    elif is_ratified(proposal, σ.gov_state.votes[key], σ, π):
      -- Ratified: enact effect, refund deposit, archive
      enact(proposal, σ)
      refund_deposit(σ, proposal)
      σ.gov_state.enacted ← σ.gov_state.enacted ++ [(ε', proposal)]
      delete σ.gov_state.proposals[key]
```

Governance action types and their effects:

| Action Type           | Effect                                        |
|-----------------------|-----------------------------------------------|
| ParameterChange       | `dataclasses.replace(σ.protocol_params, ...)` |
| TreasuryWithdrawals   | Transfer from treasury to reward accounts     |
| NoConfidence          | `σ.gov_state.committee ← ∅`                  |
| UpdateCommittee       | Add/remove committee members                  |
| NewConstitution       | Update constitution hash                      |
| HardForkInitiation    | No ledger-level effect                        |
| InfoAction            | No ledger-level effect (always ratified)      |

Ratification requires voting thresholds per action type across three voter
groups: Constitutional Committee (head-count), DReps (stake-weighted), and
SPOs (stake-weighted). See `governance.py` for threshold tables.

### Step 6 - Rotate Block Counts

Block production history uses a 3-way rotation (current → prev → go) so
that reward computation always uses data from two epochs prior.

```
  σ._go_blocks_made   ← σ._prev_blocks_made
  σ._prev_blocks_made ← σ.blocks_made
  σ.blocks_made        ← ∅
```

### Step 7 - Reset Fee Pot

Install the fee snapshot captured in Step 1 and reset the accumulator.

```
  σ._fee_ss ← fee_ss

  if ¬ σ._reward_computation_failed:
    σ.pots.fees ← 0
  else:
    σ.pots.treasury += σ.pots.fees         -- safety: fees → treasury
    σ.pots.fees ← 0
    σ._reward_computation_failed ← false
```

### Step 8 - Rotate Stake Distributions

The raw stake distributions (`M[Credential, Coin]`) used by reward
computation follow the same 3-way rotation as block counts.

```
  σ._go_stake_dist   ← σ._set_stake_dist
  σ._set_stake_dist  ← σ._mark_stake_dist
  σ._mark_stake_dist ← compute_current_stake_dist(σ)
```

### Step 9 - Advance Epoch

```
  σ.epoch ← ε'
```

---

## 8.3 Stake Distribution Computation

The "mark" stake distribution is computed fresh from the current ledger
state at each epoch boundary. It aggregates account-level stake (deposit +
rewards) and UTxO-level stake for all credentials delegated to active pools.

```
compute_current_stake_dist : σ → M[B_28, Coin]
compute_current_stake_dist(σ):

  dist ← {}
  delegated ← ∅

  -- Phase 1: Account-level stake for delegated credentials
  ∀ (cred, acct) ∈ σ.accounts
    where acct.pool ≠ ⊥ ∧ acct.pool ∈ dom(σ.pools):
      dist[cred] ← acct.deposit + acct.rewards
      delegated ← delegated ∪ {cred}

  if delegated = ∅:
    return dist

  -- Phase 2: UTxO-level stake for base addresses (types 0–3)
  ∀ (_, out) ∈ σ.utxo:
    addr ← out.address
    if |addr| < 57:  continue                     -- not a base address
    if addr[0] >> 4 > 3:  continue                -- not address type 0–3

    staking_cred ← addr[29:57]                    -- 28-byte staking credential
    if staking_cred ∈ delegated:
      dist[staking_cred] += lovelace_of(out.amount)

  return dist
```

**Address layout (base addresses, types 0–3):**

```
  [header(1)] [payment_credential(28)] [staking_credential(28)]
   byte 0       bytes 1–28               bytes 29–56
```

The header nibble `addr[0] >> 4` encodes the address type:
- 0: key-hash payment, key-hash staking
- 1: script-hash payment, key-hash staking
- 2: key-hash payment, script-hash staking
- 3: script-hash payment, script-hash staking

Types 4–7 (pointer, enterprise, bootstrap) carry no staking credential and
are excluded from the stake distribution.

---

## 8.4 Full Stake Snapshot (Leader Schedule)

The `compute_stake_snapshot` function produces a richer `StakeSnapshot` used
for leader schedule lookups via the "go" snapshot. It differs from
`compute_current_stake_dist` by also aggregating per-pool totals.

```
compute_stake_snapshot : σ → StakeSnapshot
compute_stake_snapshot(σ):

  pool_stake       ← {}    : M[H_224, Coin]
  credential_stake ← {}    : M[H_224, Coin]
  total            ← 0     : Coin

  -- Phase 1: Account-level stake
  ∀ (cred, acct) ∈ σ.accounts
    where acct.pool ≠ ⊥ ∧ acct.pool ∈ dom(σ.pools):
      s ← acct.deposit + acct.rewards
      if s ≤ 0:  continue
      credential_stake[cred] += s
      pool_stake[acct.pool]  += s
      total += s

  -- Phase 2: UTxO-level stake (base addresses, types 0–3)
  ∀ (_, out) ∈ σ.utxo:
    staking_cred ← extract_staking_cred(out.address)
    if staking_cred ∈ dom(σ.accounts):
      pool_id ← σ.accounts[staking_cred].pool
      if pool_id ∈ dom(σ.pools):
        amt ← lovelace_of(out.amount)
        credential_stake[staking_cred] += amt
        pool_stake[pool_id]            += amt
        total += amt

  return StakeSnapshot(pool_stake, credential_stake, total, σ.epoch)
```

The 3-way rotation ensures a 2-epoch delay:

```
SnapshotRotation = {
  mark : StakeSnapshot,     -- current epoch boundary snapshot
  set  : StakeSnapshot,     -- 1 epoch old
  go   : StakeSnapshot      -- 2 epochs old (active for leader schedule)
}

rotate_snapshots(rot, new_mark):
  rot.go   ← rot.set
  rot.set  ← rot.mark
  rot.mark ← new_mark

get_leader_schedule_stake(rot) → StakeSnapshot:
  return rot.go
```

---

## 8.5 Snapshot Import (NewEpochState CBOR)

Bluematter can bootstrap from a Haskell node / Amaru NewEpochState CBOR
snapshot rather than syncing from genesis. This section specifies the
snapshot format and parsing.

### 8.5.1 Top-Level Structure

```
NewEpochState = [
  epoch_no          : N,                   -- [0] current epoch
  nesBprev          : M[H_224, N],         -- [1] blocks made in previous epoch
  nesBcur           : M[H_224, N],         -- [2] blocks made in current epoch
  EpochState        : [                    -- [3]
    AccountState    : [N, N],              --   [0] (treasury, reserves)
    LedgerState     : [                    --   [1]
      CertState     : [                    --     [0]
        VotingState,                       --       [0] (dreps, cc, dormant)
        PoolState    : [pools, updates, retirements],  -- [1]
        deposits,                          --       [2]
        DelegState   : [UMap, ...]         --       [3]
      ],
      UTxOState     : [                    --     [1]
        utxo_map    : M[TxIn, TxOut],      --       [0] (can be 10–20M entries)
        deposited   : N,                   --       [1]
        fees        : Z,                   --       [2]
        GovState    : [...]                --       [3]
      ]
    ],
    SnapShots       : [mark, set, go, feeSS],  -- [2]
    non_myopic      : ...                  -- [3]
  ],
  rewards_update    : ...                  -- [4]
]
```

### 8.5.2 Initialization from Snapshot

After parsing, the ledger state is initialized as:

```
  σ.epoch              ← root[0]
  σ.pots.treasury      ← EpochState[0][0]
  σ.pots.reserves      ← EpochState[0][1]
  σ.pots.fees          ← 0
  σ.pools              ← parse_pools(PoolState[0], PoolState[2])
  σ.accounts           ← parse_accounts(UMap)
  σ.utxo               ← parse_utxo(UTxOState[0])
  σ.blocks_made        ← ∅
  σ._go_blocks_made    ← nesBprev          -- for first RUPD
  σ._prev_blocks_made  ← nesBcur           -- for second RUPD

  -- Stake distribution snapshots
  σ._mark_stake_dist   ← parse_snapshot_dist(SnapShots[0])
  σ._set_stake_dist    ← parse_snapshot_dist(SnapShots[1])
  σ._go_stake_dist     ← parse_snapshot_dist(SnapShots[2])
  σ._fee_ss            ← SnapShots[3]      -- fee snapshot for reward calc
```

### 8.5.3 UMap Entry Format (Conway)

The Conway Unified Map (UMap) encodes stake account state in a compact
array. Each entry maps a credential key to a 4-element value:

```
UMap entry = [
  v[0] : StrictMaybe<(rewards, deposit)>,
  v[1] : Set<Pointer>,                     -- cert pointers (always ∅ in Conway)
  v[2] : StrictMaybe<PoolId>,
  v[3] : StrictMaybe<DRep>
]
```

Where `StrictMaybe<T>` is encoded as:
- `[]`      - absent (SNothing)
- `[value]` - present (SJust value)

Concrete decoding:

```
v[0]:  []            → rewards = 0, deposit = 0
       [[r, d]]      → rewards = r, deposit = d

v[2]:  []            → pool = ⊥  (not delegated)
       [pool_id]     → pool = pool_id  (28 bytes)

v[3]:  []            → no DRep delegation
       [[0, hash]]   → DRep key credential
       [[1, hash]]   → DRep script credential
       [[2]]         → Abstain
       [[3]]         → NoConfidence
```

**Critical note:** In `v[0]`, the tuple ordering is `(rewards, deposit)`  - 
rewards first, deposit second. This was verified against the Amaru Rust
implementation (`account.rs`).

### 8.5.4 Pool Parameters

```
PoolParams = [
  operator       : H_224,                 -- [0]
  vrf_keyhash    : H_256,                 -- [1]
  pledge         : Coin,                  -- [2]
  cost           : Coin,                  -- [3]
  margin         : Rational,              -- [4] (Tag 30 or [num, den])
  reward_account : B,                     -- [5]
  owners         : S[H_224],              -- [6]
  relays         : L[Relay],              -- [7]
  metadata       : PoolMetadata?          -- [8]
]
```

### 8.5.5 Streaming Parser

For mainnet snapshots with 15M+ UTxO entries, a streaming parser is
available that walks the CBOR byte stream incrementally using
`cbor_item_length` to skip past unneeded top-level elements and decodes
the UTxO map entry-by-entry. This avoids materializing the entire decoded
structure in memory (which would require 30+ GB for mainnet).

```
load_snapshot(path, streaming=False) → σ
  -- streaming=True activates incremental CBOR parsing
  -- Auto-detects gzip compression (magic bytes 0x1F 0x8B)
```

---

## 8.6 Antithesis Assertions

At each epoch boundary, the following invariants are checked when running
under the Antithesis testing framework:

```
always:   σ.pots.treasury ≥ 0     -- treasury never goes negative
always:   σ.pots.reserves ≥ 0     -- reserves never go negative
sometimes: epoch boundary crossed  -- liveness: epochs do advance
```

---

## 8.7 State Summary

The complete epoch-boundary rotation state within `σ`:

| Field                    | Type              | Description                              |
|--------------------------|-------------------|------------------------------------------|
| `σ.epoch`                | `N`               | Current epoch number                     |
| `σ.blocks_made`          | `M[H_224, N]`     | Blocks produced in current epoch         |
| `σ._prev_blocks_made`    | `M[H_224, N]`     | Blocks from 1 epoch ago                  |
| `σ._go_blocks_made`      | `M[H_224, N]`     | Blocks from 2 epochs ago (used by RUPD)  |
| `σ._fee_ss`              | `Coin?`           | Fee snapshot for next RUPD               |
| `σ._mark_stake_dist`     | `M[B_28, Coin]?`  | Mark stake distribution (current)        |
| `σ._set_stake_dist`      | `M[B_28, Coin]?`  | Set stake distribution (1 epoch old)     |
| `σ._go_stake_dist`       | `M[B_28, Coin]?`  | Go stake distribution (2 epochs old)     |
| `σ._snapshot_rotation`   | `SnapshotRotation?` | Full snapshot for leader schedule      |
| `σ._reward_computation_failed` | `Bool`      | Fee-safety flag                          |

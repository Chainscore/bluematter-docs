# Formal Ledger Specs

This document is a comprehensive reference for the Cardano formal ledger specifications, extracted from the official `.tex` source files in the `cardano-ledger` repository, supplemented with web research on the Conway era. It covers all eras from Shelley through Conway.

---

## Table of Contents

1. [The STS Framework](#1-the-sts-framework)
2. [Cryptographic Primitives](#2-cryptographic-primitives)
3. [Shelley Ledger Specification](#3-shelley-ledger-specification)
   - [UTxO Rules (UTXO, UTXOW)](#31-utxo-rules)
   - [Delegation Rules (DELEG, POOL, DELEGS)](#32-delegation-rules)
   - [Ledger Rules (LEDGER, LEDGERS)](#33-ledger-rules)
   - [Epoch Boundary Rules (SNAP, POOLREAP, EPOCH, NEWEPOCH)](#34-epoch-boundary-rules)
   - [Chain Rules (CHAIN, TICK, BBODY, PRTCL, TICKN)](#35-chain-rules)
   - [Reward Calculation](#36-reward-calculation)
4. [Alonzo Additions](#4-alonzo-additions)
5. [Babbage Additions](#5-babbage-additions)
6. [Conway Additions](#6-conway-additions)
7. [CDDL Wire Format](#7-cddl-wire-format)

---

## 1. The STS Framework

**Source**: `docs/small-step-semantics/small-step-semantics.tex`

The entire Cardano ledger is specified using **Structured Transition Systems (STS)**, also called "small-step semantics." An STS is a 5-tuple `(S, T, Sigma, R, Gamma)`:

| Component | Meaning |
|-----------|---------|
| **S** | Set of states (not necessarily valid) |
| **Sigma** | Set of signals that trigger transitions |
| **Gamma** | Set of environment values (read-only context, never modified) |
| **T** | Set of transitions: `T <= P(Gamma x S x Sigma x S)` |
| **R** | Set of derivation rules, each with an antecedent (premises) and a consequent (conclusion) |

### Notation

A transition is written:

```
Gamma |- s --[RULE_NAME / signal]--> s'
```

A derivation rule is written with premises above a horizontal line and the conclusion below:

```
    premise_1    premise_2    ...    premise_n
    ─────────────────────────────────────────── [Rule-Name]
    Gamma |- s --[rule]{signal}--> s'
```

All premises must hold (conjunction) for the rule to fire. Let-bindings (`x := f(y)`) introduce intermediate variables. Sub-rule invocations appear as transitions in the premises.

### Validity

A state `s` is valid if it is either:
- A base state (consequent of a rule whose antecedent has no state/signal variables), or
- Reachable from a valid state via a valid transition.

### Composition

STS rules compose hierarchically. A rule's antecedent may invoke another STS's transition, creating a tree of sub-rules. The top-level rule is **CHAIN**. Recursive rules (LEDGERS, DELEGS) process sequences via self-loops.

### Rule Dependency Graph (Shelley)

```
CHAIN
  |-- TICK
  |     |-- RUPD (reward update calculation)
  |     |-- NEWEPOCH
  |           |-- MIR (move instantaneous rewards)
  |           |-- EPOCH
  |                 |-- SNAP (snapshot)
  |                 |-- POOLREAP (pool retirement)
  |                 |-- NEWPP (new protocol parameters)
  |-- PRTCL (protocol, header validation)
  |     |-- OVERLAY / PRAOS (leader check)
  |     |-- UPDN (nonce update)
  |     |-- OCERT (operational certificate)
  |-- BBODY (block body)
        |-- LEDGERS (sequence of transactions)
              |-- LEDGER (single transaction)
                    |-- DELEGS (certificate sequence)
                    |     |-- DELPL
                    |           |-- DELEG (delegation certs)
                    |           |-- POOL (pool certs)
                    |-- UTXOW (witnessed UTxO)
                          |-- UTXO (unwitnessed UTxO)
                                |-- PPUP (protocol parameter updates)
```

---

## 2. Cryptographic Primitives

**Source**: `eras/shelley/formal-spec/crypto-primitives.tex`

### Key Types

| Type | Description |
|------|-------------|
| `SKey` | Private signing key |
| `VKey` | Public verification key |
| `KeyHash` | Blake2b-224 hash of a verification key |
| `Sig` | Signature |
| `Ser` | Serialized representation of data |
| `Script` | Multi-signature script |
| `HashScr` | Hash of a script |
| `KeyPair` | `(SKey, VKey)` pair |

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `hashKey` | `VKey -> KeyHash` | Hash a verification key |
| `verify` | `P(VKey x Ser x Sig)` | Verification relation |
| `sign` | `SKey -> Ser -> Sig` | Signing function |
| `hashScript` | `Script -> HashScr` | Hash a script |

**Constraint**: `sign(sk, d) = sigma => (vk, d, sigma) in verify` for all `(sk, vk) in KeyPair`.

### KES (Key Evolving Signatures)

KES provides forward cryptographic security. The private key evolves incrementally through KES periods. The public key stays constant.

| Function | Signature |
|----------|-----------|
| `sign_ev` | `(N -> SKeyEv) -> N -> Ser -> Sig` |
| `verify_ev` | `P(VKeyEv x N x Ser x Sig)` |

The evolution step `n` is `slot / SlotsPerKESPeriod`.

### VRF (Verifiable Random Functions)

VRFs allow key-pair owners to evaluate a pseudorandom function provably.

| Type | Description |
|------|-------------|
| `Seed` | Pseudorandom seed |
| `Proof` | VRF proof |

| Function | Signature | Description |
|----------|-----------|-------------|
| `seedOp` | `Seed -> Seed -> Seed` | Binary seed operation (XOR) |
| `vrf_T` | `SKey -> Seed -> (Proof, T)` | VRF evaluation |
| `verifyVrf_T` | `VKey -> Seed -> (Proof, T) -> Bool` | VRF proof verification |

Constants: `0_seed` (neutral element), `Seed_L` (leader seed constant "L"), `Seed_e` (nonce seed constant "N").

`PoolDistr = KeyHash_pool -> ([0,1] x KeyHash_vrf)` -- maps pool hashes to (relative stake, VRF key hash).

### Multi-Signature Scripts (Shelley native)

```
MSig = RequireSig KeyHash
     | RequireAllOf [Script]
     | RequireAnyOf [Script]
     | RequireMOf N [Script]
```

Evaluated by `evalMultiSigScript : MSig -> P(KeyHash) -> Bool`.

---

## 3. Shelley Ledger Specification

### 3.1 UTxO Rules

**Source**: `eras/shelley/formal-spec/utxo.tex`

#### 3.1.1 UTXO Transition

**Environment** (`UTxOEnv`):

| Field | Type | Description |
|-------|------|-------------|
| `slot` | `Slot` | Current slot |
| `pp` | `PParams` | Protocol parameters |
| `poolParams` | `KeyHash_pool -> PoolParam` | Registered stake pools |
| `genDelegs` | `GenesisDelegation` | Genesis key delegations |

**State** (`UTxOState`):

| Field | Type | Description |
|-------|------|-------------|
| `utxo` | `UTxO` | Current UTxO set |
| `deposited` | `Coin` | Total deposits pot |
| `fees` | `Coin` | Fee pot |
| `ppup` | `PPUpdateState` | Proposed parameter updates |

**Signal**: A transaction `Tx`.

#### Key Functions

| Function | Formula | Description |
|----------|---------|-------------|
| `outs(tx)` | `{(txid(tx), ix) -> txout | ix -> txout in txouts(tx)}` | Transaction outputs as UTxO entries |
| `ubalance(utxo)` | Sum of all coin in UTxO | UTxO balance |
| `wbalance(ws)` | Sum of all withdrawal amounts | Withdrawal balance |
| `consumed(pp, utxo, tx)` | `ubalance(txins(tx) <| utxo) + wbalance(txwdrls(tx)) + keyRefunds(pp, tx)` | Value consumed by tx |
| `produced(pp, poolParams, tx)` | `ubalance(outs(tx)) + txfee(tx) + totalDeposits(pp, poolParams, txcerts(tx))` | Value produced by tx |

#### Preservation of Value

**The fundamental accounting property**: `consumed(pp, utxo, tx) = produced(pp, poolParams, tx)`.

This ensures value is only moved between outputs, reward accounts, the fee pot, and the deposit pot -- never created or destroyed.

#### Rule: UTxO-inductive (10 predicates)

```
    txb := txbody(tx)
    txttl(txb) >= slot                              -- (1) tx is live (TTL check)
    txins(txb) != {}                                -- (2) non-empty inputs (replay prevention)
    minfee(pp, tx) <= txfee(txb)                    -- (3) sufficient fee
    txins(txb) <= dom(utxo)                         -- (4) all inputs exist in UTxO
    consumed(pp, utxo, txb) = produced(pp, poolParams, txb)  -- (5) value conservation
    slot, pp, genDelegs |- ppup --[PPUP / txup(tx)]--> ppup' -- (6) valid update proposals
    forall (_, (_, c)) in txouts(txb): c >= minUTxOValue(pp)  -- (7) min UTxO value
    forall (_, (a, _)) in txouts(txb): bootstrapAttrsSize(a) <= 64  -- (8) bootstrap attrs size
    forall (_, (a, _)) in txouts(txb): netId(a) = NetworkId  -- (9) output network ID
    forall (a -> _) in txwdrls(txb): netId(a) = NetworkId    -- (10) withdrawal network ID
    txsize(tx) <= maxTxSize(pp)                     -- (11) max transaction size
    ─────────────────────────────────────────────────────────
    utxo' = (txins(txb) </| utxo) U outs(txb)      -- remove spent, add new
    deposited' = deposited + depositChange          -- update deposit pot
    fees' = fees + txfee(txb)                       -- collect fee
    ppup' = (from PPUP transition)
```

**Predicate failures** (10 total):
1. `BadInput` -- input not in UTxO
2. `Expired` -- current slot > TTL
3. `MaxTxSize` -- transaction too large
4. `InputSetEmpty` -- no inputs (replay risk)
5. `FeeTooSmall` -- fee below minimum
6. `ValueNotConserved` -- balance does not hold
7. `WrongNetwork` -- output address wrong network
8. `WrongNetworkWithdrawal` -- withdrawal address wrong network
9. `OutputTooSmall` -- output below minimum value
10. `OutputBootAddrAttrsTooBig` -- bootstrap address attributes > 64 bytes

#### Deposits and Refunds

```
totalDeposits(pp, poolParams, certs) =
    keyDeposit(pp) * |certs intersect DCertRegKey|
  + poolDeposit(pp) * |{cwitness(c) | c in newPools}|
  where newPools = {c | c in certs intersect DCertRegPool, cwitness(c) not in poolParams}

keyRefunds(pp, tx) = keyDeposit(pp) * |txcerts(tx) intersect DCertDeRegKey|
```

Note: Re-registering a pool does NOT require a new deposit. Only new pool registrations do. Refunds use CURRENT protocol parameters (not the parameters at deposit time).

#### 3.1.2 UTXOW Transition (Witnesses)

**Rule: UTxO-wit (6 predicates)**

```
    witsKeyHashes := {hashKey(vk) | vk in dom(txwitsVKey(tx))}
    -- (1) All signatures valid
    forall vk -> sigma in txwitsVKey(tx): V_vk(hash(txbody(tx)))_sigma
    -- (2) Required key hashes present
    witsVKeyNeeded(utxo, tx, genDelegs) <= witsKeyHashes
    -- (3) All multisig scripts valid
    forall hs -> validator in txwitsScript(tx):
        hashScript(validator) = hs AND validateScript(validator, tx)
    -- (4) Required scripts present
    scriptsNeeded(utxo, tx) = dom(txwitsScript(tx))
    -- (5) MIR quorum
    {c in txcerts(tx) intersect DCertMir} != {} => |genSig| >= Quorum
    -- (6) Metadata hash
    (mdh = Nothing AND md = Nothing) OR (mdh = hashMD(md))
    -- then delegate to UTXO
    ─────────────────────────────────────────────
    utxoSt --[UTXO / tx]--> utxoSt'
```

**`witsVKeyNeeded(utxo, tx, genDelegs)`** gathers all required key hashes:
- Payment keys for spent inputs (from VKey addresses only)
- Stake credentials for reward withdrawals
- Certificate witnesses (for DELEG/POOL certs, NOT for RegKey or MIR)
- Genesis delegates for update proposals
- Pool owners for pool registration certificates

**`scriptsNeeded(utxo, tx)`** gathers required script hashes:
- Validator hashes for script-locked inputs
- Stake credentials for script reward withdrawals
- Script credentials in delegation/deregistration certificates

**Predicate failures** (8 total):
1. `InvalidWitnesses` -- incorrect signature
2. `MissingVKeyWitnesses` -- missing required key
3. `MissingScriptWitnesses` -- missing script
4. `ScriptWitnessNotValidating` -- script evaluates to false
5. `MIRInsufficientGenesisSigs` -- not enough genesis sigs for MIR
6. `MissingTxBodyMetadataHash` -- metadata present but no hash in body
7. `MissingTxMetadata` -- hash present but no metadata
8. `ConflictingMetadataHash` -- hash mismatch

---

### 3.2 Delegation Rules

**Source**: `eras/shelley/formal-spec/delegation.tex`

#### Certificate Types (Shelley)

| Certificate | Type ID | Description |
|-------------|---------|-------------|
| `DCertRegKey` | 0 | Stake credential registration |
| `DCertDeRegKey` | 1 | Stake credential deregistration |
| `DCertDeleg` | 2 | Stake delegation to a pool |
| `DCertRegPool` | 3 | Pool registration |
| `DCertRetirePool` | 4 | Pool retirement |
| `DCertGen` | 5 | Genesis key delegation |
| `DCertMir` | 6 | Move instantaneous rewards |

#### PoolParam Fields

| Field | Type | Description |
|-------|------|-------------|
| `poolOwners` | `P(KeyHash)` | Set of pool owner key hashes |
| `poolCost` | `Coin` | Fixed cost deducted from rewards |
| `poolMargin` | `[0,1]` | Margin (fraction of remaining rewards) |
| `poolPledge` | `Coin` | Pool pledge amount |
| `poolRAcnt` | `AddrRWD` | Reward account for the pool |
| `poolVRF` | `KeyHash_vrf` | VRF verification key hash |
| `relays` | `[URL]` | Pool relay addresses |
| `metadata` | `PoolMD?` | Optional pool metadata (url + hash) |

#### States

**DState** (delegation state):

| Field | Type | Description |
|-------|------|-------------|
| `rewards` | `StakeCredential -> Coin` | Reward accounts |
| `delegations` | `StakeCredential -> KeyHash_pool` | Delegation map |
| `ptrs` | `Ptr -> StakeCredential` | Pointer map |
| `fGenDelegs` | `FutGenesisDelegation` | Future genesis delegations |
| `genDelegs` | `GenesisDelegation` | Current genesis delegations |
| `i_rwd` | `InstantaneousRewards` | MIR maps (reserves, treasury) |

**PState** (pool state):

| Field | Type | Description |
|-------|------|-------------|
| `poolParams` | `KeyHash_pool -> PoolParam` | Active pool parameters |
| `fPoolParams` | `KeyHash_pool -> PoolParam` | Future (staged) pool parameters |
| `retiring` | `KeyHash_pool -> Epoch` | Pools scheduled for retirement |

#### 3.2.1 DELEG Rules

**Rule: Deleg-Reg** (stake registration)
- Preconditions: cert is DCertRegKey; credential NOT already in rewards
- State change: `rewards' = rewards U {hk -> 0}`; `ptrs' = ptrs U {ptr -> hk}`

**Rule: Deleg-Dereg** (stake deregistration)
- Preconditions: cert is DCertDeRegKey; credential maps to 0 in rewards (balance must be zero)
- State change: remove from rewards, delegations, ptrs

**Rule: Deleg-Deleg** (delegation)
- Preconditions: cert is DCertDeleg; credential in dom(rewards) (must be registered)
- State change: `delegations' = delegations |>> {hk -> dpool(c)}`

**Rule: Deleg-Gen** (genesis key delegation)
- Preconditions: cert is DCertGen; genesis key in dom(genDelegs)
- State change: `fGenDelegs' = fGenDelegs |>> {(slot + StabilityWindow, gkh) -> (vkh, vrf)}`
- Note: Delayed by StabilityWindow slots for header validation safety

**Rule: Deleg-Mir** (move instantaneous rewards)
- Preconditions: slot < firstSlot(epoch(slot) + 1) - StabilityWindow; sufficient funds in pot
- State change: updates i_rwd with the new reward allocations

**DELEG predicate failures** (10):
`StakeKeyAlreadyRegistered`, `StakeKeyNotRegistered`, `StakeKeyNonZeroAccountBalance`, `StakeDelegationImpossible`, `WrongCertificateType`, `GenesisKeyNotInMapping`, `DuplicateGenesisDelegate`, `InsufficientForInstantaneousRewards`, `MIRCertificateTooLateinEpoch`, `DuplicateGenesisVRF`

#### 3.2.2 POOL Rules

**Rule: Pool-Reg** (new pool registration)
- Preconditions: cert is DCertRegPool; hk NOT in dom(poolParams); poolCost >= minPoolCost(pp)
- State change: `poolParams' = poolParams U {hk -> pool}`

**Rule: Pool-reReg** (pool re-registration / parameter update)
- Preconditions: cert is DCertRegPool; hk IN dom(poolParams); poolCost >= minPoolCost(pp)
- State change: `fPoolParams' = fPoolParams |>> {hk -> pool}`; remove from retiring
- Note: Parameters staged for next epoch, not immediate. This gives delegators time to react.

**Rule: Pool-Retire**
- Preconditions: cert is DCertRetirePool; hk in dom(poolParams); cepoch < e <= cepoch + emax(pp)
- State change: `retiring' = retiring |>> {hk -> e}`

**POOL predicate failures** (4): `StakePoolCostTooLow`, `StakePoolNotRegisteredOnKey`, `StakePoolRetirementWrongEpoch`, `WrongCertificateType`

#### 3.2.3 DELEGS (Certificate Sequence Processing)

The DELEGS rule processes the entire list of certificates in a transaction. It is defined recursively:

**Base case** (`Seq-delg-base`): When the certificate list is empty:
- Precondition: all withdrawals in the transaction must match reward accounts (`wdrls <= rewards`)
- State change: set reward accounts to zero for withdrawn accounts

**Inductive case** (`Seq-delg-ind`): Process one certificate, then recurse:
- Additional check: if cert is DCertDeleg, the target pool must exist in poolParams
- Constructs certificate pointer from (slot, txIx, length of remaining certs)
- Calls DELPL (which dispatches to DELEG or POOL based on cert type)

**DELEGS predicate failures** (2): `DelegateeNotRegistered`, `WithdrawalsNotInRewards`

---

### 3.3 Ledger Rules

**Source**: `eras/shelley/formal-spec/ledger.tex`

#### LEDGER Transition

**Environment** (`LEnv`):

| Field | Type |
|-------|------|
| `slot` | `Slot` |
| `txIx` | `Ix` (transaction index within block) |
| `pp` | `PParams` |
| `acnt` | `Acnt` (treasury, reserves) |

**State** (`LState`):

| Field | Type |
|-------|------|
| `utxoSt` | `UTxOState` |
| `dpstate` | `DPState` (DState x PState) |

**Rule: ledger** -- Single rule that:
1. First calls DELEGS on the certificate list
2. Then calls UTXOW on the transaction

Important: DELEGS runs first because UTXOW needs the updated `poolParams` and `genDelegs` from delegation processing.

#### LEDGERS Transition

Iterates LEDGER over a sequence of transactions:
- **Base case**: empty list, no change
- **Inductive case**: process prefix via LEDGERS, then apply LEDGER to the last transaction

---

### 3.4 Epoch Boundary Rules

**Source**: `eras/shelley/formal-spec/epoch.tex`

#### Overview of the Reward Cycle

For epoch `e_i`, rewards involve two surrounding epochs:

```
Timeline: e_{i-1}         e_i              e_{i+1}
          |-------|--------|--------|--------|
          A   B   C        D   E   F   G

(A) Stake snapshot taken at start of e_{i-1}  -> "mark"
(B) Randomness for leader election fixed during e_{i-1}
(C) Epoch e_i begins
(D) Epoch e_i ends. Snapshot of pool performance + fee pot taken.
(E) Snapshots from (D) are stable; reward calculation begins.
(F) Reward calculation finishes; update ready.
(G) Rewards distributed.
```

Three snapshots are maintained: **mark** (newest), **set** (middle), **go** (oldest, used for reward calculation).

#### Accounting Fields (`Acnt`)

| Field | Type | Description |
|-------|------|-------------|
| `treasury` | `Coin` | Treasury pot |
| `reserves` | `Coin` | Reserve pot |

#### Stake Distribution (`stakeDistr`)

```
stakeDistr(utxo, dstate, pstate) = (activeDelegs <| aggregate+(stakeRelation), delegations, poolParams)
where
    stakeRelation = (stakeCred_b^{-1} U (addrPtr . ptr)^{-1}) . range(utxo) U rewards
    activeDelegs = dom(rewards) <| delegations |> dom(poolParams)
```

Stake includes:
- Coin at base addresses (via `stakeCred_b`)
- Coin at pointer addresses (via `addrPtr . ptr`)
- Reward account balances

Only stake that is both registered AND delegated to an active pool is counted.

#### 3.4.1 SNAP (Snapshot Transition)

No preconditions. State change:
```
pstake_go'   = pstake_set
pstake_set'  = pstake_mark
pstake_mark' = stakeDistr(utxo, dstate, pstate)
feeSS'       = fees (from current UTxO state)
```

#### 3.4.2 POOLREAP (Pool Retirement)

Processes pools scheduled to retire in the current epoch:

1. For each retiring pool, compute pool deposit refund
2. Refund goes to the pool's registered reward account (if the account exists)
3. If the reward account does not exist, the refund goes to the treasury
4. Remove all delegations to retiring pools
5. Remove retiring pools from poolParams, fPoolParams, retiring

#### 3.4.3 EPOCH Transition

Calls sub-rules in order:
1. **SNAP** -- take new snapshot
2. **POOLREAP** -- retire pools
3. **NEWPP** -- apply any parameter updates that have reached quorum

Also handles:
- Applying staged future pool parameters: `poolParams' = poolParams |>> fPoolParams`
- Resetting fPoolParams to empty
- Activating future genesis delegations that have matured

#### 3.4.4 NEWEPOCH Transition

**NewEpochState**:

| Field | Type | Description |
|-------|------|-------------|
| `e_l` | `Epoch` | Last epoch number |
| `b_prev` | `BlocksMade` | Blocks made in previous epoch |
| `b_cur` | `BlocksMade` | Blocks made in current epoch |
| `es` | `EpochState` | Full epoch state |
| `ru` | `RewardUpdate?` | Pending reward update |
| `pd` | `PoolDistr` | Pool stake distribution |

**Rule: New-Epoch** (epoch boundary, `e = e_l + 1`):
1. Verify reward update is net-neutral: `delta_t + delta_r + sum(rs) + delta_f = 0`
2. Apply reward update to epoch state
3. Call MIR transition
4. Call EPOCH transition
5. Reset blocks_made: `b_prev' = b_cur; b_cur' = {}`
6. Calculate new pool distribution from "go" snapshot
7. Set `ru' = Nothing`

#### 3.4.5 MIR Transition

Processes instantaneous rewards at epoch boundary:
- Distributes accumulated MIR rewards from both reserves and treasury
- Only pays to registered reward accounts
- Resets both MIR maps to empty
- If pots are insufficient, no rewards are distributed (but maps still reset)

---

### 3.5 Chain Rules

**Source**: `eras/shelley/formal-spec/chain.tex`

#### Block Structure

**Operational Certificate** (`OCert`):

| Field | Type | Description |
|-------|------|-------------|
| `vk_hot` | `VKeyEv` | Operational (hot) KES key |
| `n` | `N` | Certificate issue number |
| `c_0` | `KESPeriod` | Start KES period |
| `sigma` | `Sig` | Cold key signature of (vk_hot, n, c_0) |

**Block Header Body** (`BHBody`):

| Field | Type | Description |
|-------|------|-------------|
| `prev` | `HashHeader?` | Hash of previous block header |
| `vk` | `VKey` | Block issuer (cold key) |
| `vrfVk` | `VKey` | VRF verification key |
| `blockno` | `BlockNo` | Block number |
| `slot` | `Slot` | Block slot |
| `eta` | `Seed` | Nonce VRF output |
| `prf_eta` | `Proof` | Nonce VRF proof |
| `l` | `[0,1]` | Leader election VRF value |
| `prf_l` | `Proof` | Leader election VRF proof |
| `bsize` | `N` | Block body size |
| `bhash` | `HashBBody` | Block body hash |
| `oc` | `OCert` | Operational certificate |
| `pv` | `ProtVer` | Protocol version |

`Block = BHeader x [Tx]` where `BHeader = BHBody x Sig`.

#### CHAIN Transition

The top-level rule. Calls:
1. **TICK** -- epoch boundary + reward update
2. **PRTCL** -- protocol/header validation (leader check, nonce, opcert)
3. **BBODY** -- block body validation

#### TICK Transition

Invoked at every block to check for epoch boundaries:
1. If new epoch: call **NEWEPOCH** transition
2. Call **RUPD** (reward update calculation if in the right window)

#### RUPD (Reward Update)

The reward update is calculated during a specific window in each epoch (after StabilityWindow slots into the epoch). It produces a `RewardUpdate`:

| Field | Type | Description |
|-------|------|-------------|
| `delta_t` | `Coin` | Change to treasury |
| `delta_r` | `Coin` | Change to reserves |
| `rs` | `StakeCredential -> Coin` | Per-credential rewards |
| `delta_f` | `Coin` | Change to fee pot (negative) |

Constraint: `delta_t + delta_r + sum(rs) + delta_f = 0` (zero-sum).

#### BBODY (Block Body)

Validates the block body:
1. Block body hash matches header
2. Block body size matches header
3. Calls LEDGERS to process all transactions

---

### 3.6 Reward Calculation

**Source**: `eras/shelley/formal-spec/epoch.tex` (sections on reward distribution)

The reward calculation `createRUpd` uses the "go" snapshot (the oldest of the three):

#### Key Formula

1. **Monetary expansion**: `delta_r1 = rho * reserves` where `rho` is the monetary expansion rate.

2. **Reward pot**: `rewardPot = feeSS + delta_r1`

3. **Treasury cut**: `delta_t1 = tau * rewardPot` where `tau` is the treasury cut ratio.

4. **Available rewards**: `R = rewardPot - delta_t1`

5. **Per-pool reward**: Uses the `maxPool` desirability function from the design doc:

```
maxPool(R, sigma, pledge_rel, pool_params) based on:
  - sigma = pool_stake / total_stake (actual relative stake)
  - sigma_a = pool_stake / active_stake
  - s = pledge / total_stake (relative pledge)
  - a0 = pledge influence factor (protocol parameter)
```

6. **Apparent performance**: `beta = blocks_made_by_pool / expected_blocks_for_pool`

7. **Pool reward**: `poolR = maxPool * beta` (capped by apparent performance)

8. **Operator reward**: `r_operator = poolCost + poolMargin * (poolR - poolCost)` (if poolR > poolCost)

9. **Member reward**: For each member `m` with stake `t` in pool with total member stake `s_total`:
   `r_member(m) = (poolR - r_operator) * (t / s_total)` (if poolR > poolCost, else 0)

10. **Pledge enforcement**: If the total stake from pool owners < pledge, the pool receives NO rewards (entire pool reward = 0).

11. **Circulation**: `circulation = maxLovelaceSupply - reserves` (NOT active_stake).

#### RewardUpdate Assembly

```
delta_f = -feeSS
delta_r = -delta_r1 + unclaimed_rewards
delta_t = delta_t1 + unclaimed_from_unregistered_MIR
rs = {credential -> reward for each active delegator}
```

---

## 4. Alonzo Additions

**Source**: `eras/alonzo/formal-spec/`

The Alonzo era introduced Plutus smart contracts via two-phase validation.

### 4.1 New Transaction Fields

| Field | Type | Description |
|-------|------|-------------|
| `collateral` | `P(TxIn)` | Collateral inputs (for failed scripts) |
| `reqSignerHashes` | `P(KeyHash)` | Extra required signatories (for scripts) |
| `scriptIntegrityHash` | `ScriptIntegrityHash?` | Hash of script-related data |
| `txnetworkid` | `Network?` | Transaction network ID |

**TxOut** extended: `Addr x Value x DataHash?` (optional datum hash)

**IsValid**: A `Bool` tag on the transaction indicating whether all phase-2 scripts validate. Set by the block producer.

**Validity interval**: Changed from `TTL` to `ValidityInterval = Slot? x Slot?` (both bounds optional).

### 4.2 New Witness Fields

| Field | Type | Description |
|-------|------|-------------|
| `txscripts` | `ScriptHash -> Script` | All scripts (phase-1 and phase-2) |
| `txdats` | `DataHash -> Datum` | Datum objects |
| `txrdmrs` | `RdmrPtr -> (Redeemer x ExUnits)` | Redeemers with execution budgets |

**RdmrPtr** = `Tag x Ix` where `Tag in {Spend, Mint, Cert, Rewrd}`.

### 4.3 Two-Phase Validation

**Phase 1** (ledger rules): All non-script validation. If phase 1 fails, the transaction is completely rejected (no fees collected).

**Phase 2** (script execution): Run Plutus scripts. If phase 2 fails, collateral is collected but the transaction's main effects are not applied.

### 4.4 UTXOS Transition (New)

Two rules based on the `isValid` tag:

**Rule: Scripts-Yes** (`isValid = True`):
- Standard UTxO state update (same as Shelley: remove inputs, add outputs, collect fees)
- Verify: `isValid(tx) = evalScripts(tx, sLst) = True`

**Rule: Scripts-No** (`isValid = False`):
- UTxO state change: only remove collateral inputs, add collateral amount to fee pot
- Nothing else changes (deposits, updates, etc. are not applied)
- Verify: `isValid(tx) = evalScripts(tx, sLst) = False`

### 4.5 Collateral Mechanism

`feesOK(pp, tx, utxo)` checks:
1. `minfee(pp, tx) <= txfee(txb)` -- sufficient declared fee
2. If tx has redeemers (uses phase-2 scripts):
   - Collateral inputs must use VKey addresses only
   - Collateral UTxOs must contain Ada only (no multi-asset)
   - `collateral_balance * 100 >= txfee * collateralPercent(pp)`
   - Collateral set must be non-empty

### 4.6 Script Data Hash (Integrity Hash)

```
hashScriptIntegrity(pp, langs, rdmrs, dats) =
    Nothing                                          if rdmrs = {} AND langs = {} AND dats = {}
    hash(rdmrs, dats, {getLanguageView(pp, l) | l in langs})  otherwise
```

This hash is included in the transaction body, binding the script-execution-relevant data to the body so signatures cover it.

### 4.7 Minimum Fee with Script Costs

```
minfee(pp, tx) = a * txSize(tx) + b + txscriptfee(prices(pp), totExunits(txbody(tx)))

txscriptfee((pr_mem, pr_steps), (mem, steps)) = ceiling(pr_mem * mem + pr_steps * steps)
```

### 4.8 ExUnits and Cost Models

| Type | Description |
|------|-------------|
| `ExUnits` | `(mem: N, steps: N)` -- execution budget (memory, CPU steps) |
| `CostMod` | Language-specific cost model for script execution |
| `Prices` | `(pr_mem: Rational, pr_steps: Rational)` -- price per unit |

### 4.9 Script Purpose and Indexing

`ScriptPurpose = PolicyID | TxIn | AddrRWD | DCert`

Scripts are indexed via `RdmrPtr`:
- `Spend`: index in sorted set of spend inputs
- `Mint`: index in sorted set of minting policy IDs
- `Cert`: index in certificate list
- `Rewrd`: index in sorted withdrawal map

### 4.10 UTXOW Changes

Additional UTXOW predicates for Alonzo:
1. Phase-1 scripts must all validate
2. Scripts provided = scripts needed (exact match)
3. All datum hashes for phase-2 script inputs have corresponding datums in witnesses
4. Datum hashes in witnesses are subset of (input datums U output datums)
5. Every phase-2 script has a redeemer entry
6. No extraneous redeemer entries
7. `reqSignerHashes` keys have signed the transaction
8. `scriptIntegrityHash` matches computed hash

### 4.11 TxInfo (V1 Script Context)

The `txInfo` function builds a `TxInfo` with 10 fields:

1. **inputs**: `[(TxOutRef, TxOut)]` -- realized inputs (3-field TxOut: addr, value, datumHash)
2. **outputs**: `[TxOut]` -- transaction outputs
3. **fee**: `Value` -- fee as a Value
4. **mint**: `Value` -- minted value
5. **dcerts**: `[DCert]` -- certificates (translated)
6. **wdrl**: `[(StakingCredential, Integer)]` -- withdrawals as list of pairs
7. **validRange**: `POSIXTimeRange` -- validity interval in POSIX time
8. **signatories**: `[PubKeyHash]` -- required signers
9. **data**: `[(DatumHash, Datum)]` -- datum map as list of pairs
10. **txId**: `TxId` -- transaction hash

**Time translation**: Slot numbers are converted to POSIX time via `epochInfoSlotToUTCTime`. This is why scripts see time ranges, not slot numbers.

**V1 spending scripts take 3 args**: datum, redeemer, ScriptContext(TxInfo, ScriptPurpose).
**V1 minting/reward scripts take 2 args**: redeemer, ScriptContext.

---

## 5. Babbage Additions

**Source**: `eras/babbage/formal-spec/`

### 5.1 Reference Inputs (CIP-31)

New transaction field: `refInputs : P(TxIn)` -- reference inputs.

Reference inputs:
- Are NOT spent (not removed from UTxO)
- Do NOT require witnesses
- MUST exist in the UTxO
- ARE visible to Plutus scripts via TxInfo
- Cannot be used with PlutusV1 (which has no reference input field)

Regular inputs renamed to `spendInputs`, collateral to `collInputs`.

### 5.2 Inline Datums (CIP-32)

**TxOut** changed to: `Addr x Value x (Datum | DataHash)? x Script?`

The third field can now be either:
- A `DataHash` (hash reference, as in Alonzo)
- A `Datum` directly (inline datum, new in Babbage)

Inline datums:
- Do not need to be included in the transaction witness set
- Are passed directly to scripts via `getDatum`
- Cannot be used with PlutusV1

### 5.3 Reference Scripts (CIP-33)

**TxOut** now has an optional fourth field: `Script?`

Reference scripts:
- Scripts stored in UTxO outputs
- Can be referenced by transactions without including the script in witnesses
- `txscripts(tx, utxo) = txwitscripts(tx) U refScripts(tx, utxo)`
- `refScripts` collects scripts from outputs of both spend and reference inputs
- Cannot be used with PlutusV1

### 5.4 Collateral Return Output

New fields:
- `collRet : TxOut?` -- collateral return output (created on script failure)
- `txcoll : Coin?` -- declared total collateral amount

On script failure (Scripts-No):
```
utxo' = (collInputs(txb) </| utxo) U collOuts(txb)
fees' = fees + collateralFees
```
where `collOuts` creates a return output at index `|txouts(txb)|`.

### 5.5 Min UTxO Change

Changed from `coinsPerUTxOWord` to `coinsPerUTxOByte`:
```
minUTxO = (serSize(txout) + 160) * coinsPerUTxOByte(pp)
```
The 160 bytes account for the TxIn key overhead in the UTxO map.

### 5.6 Language Restrictions

Transactions involving PlutusV1 scripts cannot use:
- Reference inputs
- Inline datums
- Reference scripts

The `allowedLanguages` function enforces this:
```
allowedLanguages(tx, utxo) =
    {}              if any output has bootstrap address
    {PlutusV2}      if any output has inline datum/script, or refInputs != {}
    {PlutusV1, V2}  otherwise
```

### 5.7 TxInfo V2 (PlutusV2 Script Context)

V2 TxInfo adds:
- **referenceInputs**: `[(TxOutRef, TxOut)]` -- reference inputs with their UTxO entries
- **redeemers**: `[(ScriptPurpose, Redeemer)]` -- all redeemers (without ExUnits)
- **TxOut** now has 4 fields: `(Address, Value, OutputDatum, Maybe ScriptHash)`

---

## 6. Conway Additions

**Sources**: [CIP-1694](https://cips.cardano.org/cip/CIP-1694), [Conway Formal Spec (Agda)](https://intersectmbo.github.io/formal-ledger-specifications/conway-ledger.pdf)

The Conway era implements CIP-1694 on-chain governance. The formal spec for Conway is written in literate Agda (not LaTeX like previous eras).

### 6.1 Governance Bodies

Three governance bodies:

| Body | Description | Voting Power |
|------|-------------|-------------|
| **Constitutional Committee (CC)** | Small group ensuring constitutional compliance | 1 vote per member |
| **DReps** (Delegated Representatives) | Stake-weighted representatives | Proportional to delegated stake |
| **SPOs** (Stake Pool Operators) | Block producers | Proportional to delegated stake |

### 6.2 Governance Actions (7 types)

| Action | CC Required | DRep Required | SPO Required |
|--------|------------|---------------|--------------|
| Motion of No-Confidence | -- | Yes | Yes |
| New Constitutional Committee | -- | Yes | Yes |
| Constitution Update | Yes | Yes | -- |
| Hard Fork Initiation | Yes | Yes | Yes |
| Protocol Parameter Changes | Yes | Yes | Yes* |
| Treasury Withdrawals | Yes | Yes | -- |
| Info | -- | Yes | Yes |

\* SPOs required only for security-relevant parameters.

Each governance action has:
- A **deposit** (returned when the action is enacted or expires)
- A **return address** for the deposit
- A **lifetime** (expires if not ratified within this many epochs)
- A **previous action ID** (for chaining, except Info actions)

### 6.3 New Transition Systems

#### GOV Transition

Processes governance proposals and votes within transactions:
- Validates proposal deposits
- Checks proposal procedure validity
- Records votes (Yes/No/Abstain) from CC members, DReps, and SPOs

#### RATIFY Transition

Runs at the epoch boundary:
- Loops over all active (unratified, unexpired) governance actions
- Checks ratification thresholds per action type
- Uses stake snapshots for vote weight calculation
- Ratified actions are staged for enactment

Vote thresholds vary by action type and governance body. Each threshold is a percentage of active voting stake.

#### ENACT Transition

Called after RATIFY at the epoch boundary:
- Enacts ratified governance actions in priority order
- Priority: NoConfidence > NewCommittee > Constitution > HardFork > PPUpdate > TreasuryWdrl > Info
- Actions that overlap (modify the same state) are checked for conflicts

**EnactState** contains:
- Current committee
- Current constitution (hash + optional guardrail script)
- Current protocol parameters
- Current protocol version
- Treasury and withdrawal tracking

#### GOVCERT Transition

Handles the new Conway certificate types:
- DRep registration/deregistration/update
- Constitutional committee hot key authorization
- Constitutional committee member resignation

### 6.4 New Certificate Types (Conway)

| Cert | ID | Description |
|------|----|-------------|
| `RegDRepCert` | 16 | DRep registration |
| `UnRegDRepCert` | 17 | DRep deregistration |
| `UpdateDRepCert` | 18 | DRep update (metadata) |
| `AuthCommitteeHotCert` | 14 | CC hot key authorization |
| `ResignCommitteeColdCert` | 15 | CC member resignation |
| `RegCert` | 7 | Stake reg (with deposit) |
| `UnRegCert` | 8 | Stake unreg (with refund) |
| `VoteDelegCert` | 9 | Vote delegation to DRep |
| `StakeVoteDelegCert` | 10 | Combined stake+vote delegation |
| `StakeRegDelegCert` | 11 | Register + delegate stake |
| `VoteRegDelegCert` | 12 | Register + delegate vote |
| `StakeVoteRegDelegCert` | 13 | Register + delegate both |

### 6.5 DRep Delegation

Stake holders can delegate their voting power to DReps via `VoteDelegCert`. Special DReps:
- **AlwaysAbstain** -- stake does not count in active voting stake
- **AlwaysNoConfidence** -- counts as a Yes vote for NoConfidence motions, No for everything else

### 6.6 Vote Thresholds and Tallying

For each governance action, ratification requires meeting thresholds from the relevant governance bodies. The threshold depends on:
- Action type
- Protocol parameters (threshold values are protocol parameters themselves)
- Whether the CC is in a state of no-confidence

Active voting stake = lovelace in UTxOs with registered credentials delegated to registered DReps (excluding AlwaysAbstain).

Threshold is met when: `sum(Yes_stake) / active_voting_stake >= threshold_percentage`

### 6.7 PlutusV3

PlutusV3 scripts receive a single argument (not 2 or 3):
- `ScriptContext` containing: `TxInfo`, `Redeemer`, `ScriptInfo`

`ScriptInfo` variants:
- `MintingScript PolicyID`
- `SpendingScript TxOutRef (Maybe Datum)`
- `RewardingScript Credential`
- `CertifyingScript Int TxCert`
- `VotingScript Voter`
- `ProposingScript Int ProposalProcedure`

V3 TxInfo includes:
- All V2 fields
- `txInfoVotes` -- governance votes
- `txInfoProposalProcedures` -- governance proposals
- `txInfoCurrentTreasuryAmount` -- current treasury balance (if queried)
- `txInfoTreasuryDonation` -- treasury donation from this tx

V3 certificates use a different encoding than V1/V2 (`TxCert` with Conway cert types).

### 6.8 Other Conway Changes

- **Protocol parameter update mechanism**: Replaced with governance actions (no more genesis key-based updates)
- **MIR certificates**: Removed (replaced by treasury withdrawal governance actions)
- **Genesis delegations**: Removed
- **Proposal policy**: Optional guardrail script attached to the constitution, checked against parameter changes
- **Treasury donations**: New tx body field allowing voluntary treasury contributions
- **DRep expiry**: DReps have an activity epoch; if they don't vote for too long, they become inactive

---

## 7. CDDL Wire Format

**Source**: `node/docs/blueprint/src/codecs/` and `node/docs/blueprint/src/network/`

### 7.1 Base Types (`base.cddl`)

```cddl
blockNo = word64
epochNo = word64
slotNo  = word64
coin    = word64
rational = [int, int]
keyhash = bstr .size 28
hash    = bstr .size 32

word8  = uint .size 1
word16 = uint .size 2
word32 = uint .size 4
word64 = uint .size 8
```

### 7.2 Block Encoding (`block.cddl`)

Blocks are era-tagged:
```cddl
cardanoBlock = byron.block          -- era tag implicit
             / [2, shelley.block]
             / [3, allegra.block]
             / [4, mary.block]
             / [5, alonzo.block]
             / [6, babbage.block]
             / [7, conway.block]
```

Blocks are wrapped in CBOR tag 24 (embedded CBOR):
```cddl
serialisedCardanoBlock = #6.24(bytes .cbor cardanoBlock)
```

### 7.3 Header Encoding (`header.cddl`)

Headers use the same era-namespace tagging:
```cddl
header = ns7<byronHeader, shelleyHeader, ..., conwayHeader>

ns7<byron, shelley, allegra, mary, alonzo, babbage, conway>
  = [6, conway] / [5, babbage] / [4, alonzo] / [3, mary]
  / [2, allegra] / [1, shelley] / [0, byron]

serialisedShelleyHeader<era> = #6.24(bytes .cbor era)
```

Byron headers have additional complexity with boundary/regular block distinction.

### 7.4 ChainSync Protocol (`chainsync/messages.cddl`)

```cddl
chainSyncMessage
    = [0]                           -- MsgRequestNext
    / [1]                           -- MsgAwaitReply
    / [2, header, tip]              -- MsgRollForward
    / [3, point, tip]               -- MsgRollBackward
    / [4, [* point]]                -- MsgFindIntersect
    / [5, point, tip]               -- MsgIntersectFound
    / [6, tip]                      -- MsgIntersectNotFound
    / [7]                           -- MsgDone

tip   = [point, blockNo]
point = []                          -- genesis
      / [slotNo, hash]              -- (slot, block hash)
```

### 7.5 BlockFetch Protocol (`blockfetch/messages.cddl`)

```cddl
blockFetchMessage
     = [0, point, point]            -- MsgRequestRange (start, end)
     / [1]                          -- MsgClientDone
     / [2]                          -- MsgStartBatch
     / [3]                          -- MsgNoBlocks
     / [4, block]                   -- MsgBlock (serialised block)
     / [5]                          -- MsgBatchDone
```

### 7.6 Handshake Protocol (`handshake/messages.cddl`)

```cddl
handshakeMessage
    = [0, versionTable]                        -- MsgProposeVersions
    / [1, versionNumber, nodeToNodeVersionData] -- MsgAcceptVersion
    / [2, refuseReason]                        -- MsgRefuse
    / [3, versionTable]                        -- MsgQueryReply

versionNumber = 13 / 14                       -- NTN v13 and v14 only
nodeToNodeVersionData = [networkMagic, initiatorOnlyDiffusionMode, peerSharing, query]
networkMagic = 0..4294967295
```

### 7.7 TxSubmission2 Protocol (`txsubmission2/messages.cddl`)

```cddl
txSubmission2Message
    = [6]                                      -- MsgInit
    / [0, blocking, txCount, txCount]          -- MsgRequestTxIds
    / [1, txIdsAndSizes]                       -- MsgReplyTxIds
    / [2, txIdList]                            -- MsgRequestTxs
    / [3, txList]                              -- MsgReplyTxs
    / [4]                                      -- MsgDone
```

### 7.8 Multiplexer

All mini-protocols share a TCP connection via a multiplexer with an 8-byte header:
```
[4 bytes: transmission time][2 bytes: protocol ID][2 bytes: payload length]
```

Protocol IDs (NTN):
- 0: Handshake
- 2: ChainSync
- 3: BlockFetch
- 4: TxSubmission2
- 8: KeepAlive

Initiator uses the protocol ID as-is; responder adds `0x8000` (bit 15 set).

---

## Appendix A: Complete STS Rule Index

### Shelley Rules

| Rule | Signal | Description |
|------|--------|-------------|
| **CHAIN** | Block | Top-level chain extension |
| **TICK** | Slot | Epoch boundary check + reward update |
| **TICKN** | -- | Nonce evolution |
| **NEWEPOCH** | Epoch | New epoch processing |
| **MIR** | -- | Move instantaneous rewards |
| **EPOCH** | Epoch | Epoch boundary (snap + poolreap + newpp) |
| **SNAP** | -- | Take stake distribution snapshot |
| **POOLREAP** | Epoch | Retire scheduled pools |
| **NEWPP** | -- | Apply protocol parameter updates |
| **RUPD** | Slot | Reward update calculation |
| **PRTCL** | BHeader | Protocol/header validation |
| **OVERLAY** | BHeader | Leader schedule (overlay + Praos) |
| **UPDN** | Seed | Nonce update |
| **OCERT** | BHeader | Operational certificate validation |
| **BBODY** | Block | Block body validation |
| **LEDGERS** | [Tx] | Process transaction sequence |
| **LEDGER** | Tx | Process single transaction |
| **UTXOW** | Tx | UTxO with witnesses |
| **UTXO** | Tx | UTxO accounting |
| **PPUP** | Update? | Protocol parameter update proposals |
| **DELEGS** | [DCert] | Certificate sequence |
| **DELPL** | DCert | Dispatch cert to DELEG or POOL |
| **DELEG** | DCert | Delegation/registration/MIR certs |
| **POOL** | DCert | Pool registration/retirement certs |

### Alonzo Additions

| Rule | Description |
|------|-------------|
| **UTXOS** | Script execution state update (Scripts-Yes / Scripts-No) |

### Conway Additions

| Rule | Description |
|------|-------------|
| **GOV** | Governance proposal and vote processing |
| **RATIFY** | Governance action ratification (epoch boundary) |
| **ENACT** | Governance action enactment |
| **GOVCERT** | DRep and committee certificate processing |
| **CERT** | Extended certificate processing (DELEG + POOL + GOVCERT) |
| **CERTS** | Certificate sequence (replaces DELEGS) |

---

## Appendix B: Protocol Parameters (Shelley through Conway)

### Shelley Parameters

| Parameter | Description |
|-----------|-------------|
| `a`, `b` | Min fee coefficients: `fee >= a * size + b` |
| `maxBlockBodySize` | Maximum block body size (bytes) |
| `maxTxSize` | Maximum transaction size (bytes) |
| `maxBlockHeaderSize` | Maximum block header size |
| `keyDeposit` | Stake key registration deposit |
| `poolDeposit` | Pool registration deposit |
| `emax` | Maximum pool retirement epoch offset |
| `nOpt` | Desired number of pools (k) |
| `a0` | Pool pledge influence factor |
| `rho` | Monetary expansion rate |
| `tau` | Treasury cut |
| `d` | Decentralization parameter (0 = fully decentralized) |
| `extraEntropy` | Extra nonce |
| `protocolVersion` | (major, minor) |
| `minUTxOValue` | Minimum UTxO output value |
| `minPoolCost` | Minimum pool fixed cost |

### Alonzo Additions

| Parameter | Description |
|-----------|-------------|
| `coinsPerUTxOWord` | Min UTxO calculation basis |
| `costmdls` | Language -> CostModel mapping |
| `prices` | (prMem, prSteps) script execution prices |
| `maxTxExUnits` | Max ExUnits per transaction |
| `maxBlockExUnits` | Max ExUnits per block |
| `maxValSize` | Max serialized Value size (bytes) |
| `collateralPercent` | Collateral percentage (e.g., 150 = 150%) |
| `maxCollateralInputs` | Max collateral inputs per tx |

### Babbage Changes

| Parameter | Description |
|-----------|-------------|
| `coinsPerUTxOByte` | Replaces coinsPerUTxOWord |

### Conway Additions

| Parameter | Description |
|-----------|-------------|
| `drepDeposit` | DRep registration deposit |
| `drepActivity` | DRep activity period (epochs) |
| `govActionDeposit` | Governance action deposit |
| `govActionLifetime` | Max epochs before expiry |
| `committeeMinSize` | Minimum committee size |
| `committeeMaxTermLength` | Max committee member term |
| `ccThreshold` | Constitutional Committee threshold |
| Various DRep/SPO thresholds | Per-action-type vote thresholds |

---

## Appendix C: Key References

- Shelley Formal Spec: `eras/shelley/formal-spec/shelley-ledger.tex`
- Alonzo Formal Spec: `eras/alonzo/formal-spec/alonzo-ledger.tex`
- Babbage Formal Spec: `eras/babbage/formal-spec/babbage-ledger.tex`
- Conway Formal Spec (Agda): https://intersectmbo.github.io/formal-ledger-specifications/conway-ledger.pdf
- CIP-1694 Governance: https://cips.cardano.org/cip/CIP-1694
- Cardano Ledger GitHub: https://github.com/IntersectMBO/cardano-ledger
- Small-Step Semantics: `docs/small-step-semantics/small-step-semantics.tex`
- Reward Calculation Doc: `docs/reward-calculation/`
- CDDL Base Types: `node/docs/blueprint/src/codecs/base.cddl`
- Network Protocol CDDL: `node/docs/blueprint/src/network/node-to-node/`

# Rewards

This chapter specifies the Ouroboros Praos reward distribution mechanism,
implementing the RUPD (Reward Update) rule from the Shelley formal
specification (Section 5.5, `epoch.tex` lines 1077–1463). The formulas are
cross-verified against the Amaru Rust implementation (`rewards.rs`).

**Source modules:**
- `ledger/rewards.py` - reward update computation, pool iteration, application
- `ledger/rewards_math.py` - pure math functions (maxPool, apparent performance, operator/member split)

---

## 9.1 Reward Update Computation (createRUpd)

The reward update is computed once per epoch boundary (Step 2 of the epoch
transition, Section 8.2) and produces a `RewardUpdate` that is then applied
to the ledger state.

### Types

```
RewardUpdate = {
  delta_treasury  : Z,                     -- change to treasury (positive = increase)
  delta_reserves  : Z,                     -- change to reserves (negative = drawdown)
  rewards         : M[B_28, Coin]?,        -- per-credential reward amounts
  delta_fees      : Z                      -- fee pot adjustment (= -fees consumed)
}
```

### Algorithm

```
compute_reward_update : (σ, M[H_224, N], M[B_28, Coin]?) → RewardUpdate
compute_reward_update(σ, blocks_made, active_stake):

  π ← σ.protocol_params
  if π = ⊥:  return RewardUpdate()         -- no params → no rewards

  ρ ← π.monetary_expansion                 -- as Fraction(num, den)
  τ ← π.treasury_expansion                 -- as Fraction(num, den)
  fees ← σ.pots.fees
```

**Step 1 - Performance ratio (η):**

```
  total_blocks ← Σ blocks_made[p]  ∀ p ∈ dom(blocks_made)

  f ← 1 / ACTIVE_SLOT_COEFF_DENOM         -- active slot coefficient = 1/20

  expected_blocks ← ⌊epoch_length / ACTIVE_SLOT_COEFF_DENOM⌋
                                            -- mainnet: ⌊432,000 / 20⌋ = 21,600
  if expected_blocks = 0:
    expected_blocks ← 21,600                -- fallback

  if total_blocks = 0:
    η ← 0
  else:
    η ← min(1, total_blocks / expected_blocks)
```

`η` measures block production efficiency: the ratio of actual blocks
produced to expected blocks. It is capped at 1 to prevent over-rewarding
in case of transient block surges.

**Step 2 - Monetary expansion (Δr₁):**

```
  Δr₁ ← ⌊η × ρ × σ.pots.reserves⌋
```

This draws new ADA from reserves proportional to the expansion rate and
production efficiency. When `η = 1` and `ρ = 3/1000` (mainnet), about
0.3% of reserves enter circulation per epoch.

**Step 3 - Reward pot:**

```
  rewardPot ← fees + Δr₁
```

The reward pot combines transaction fees accumulated during the epoch with
the freshly minted expansion ADA.

**Step 4 - Treasury cut (Δt₁):**

```
  Δt₁ ← ⌊τ × rewardPot⌋
```

The treasury receives its cut *from the reward pot*, not from reserves
directly. With `τ = 1/5` (mainnet), 20% of the reward pot goes to treasury.

**Step 5 - Distributable rewards (R):**

```
  R ← rewardPot - Δt₁
```

**Early exit:**

```
  if total_blocks = 0 ∨ R ≤ 0:
    return RewardUpdate(
      delta_treasury  = Δt₁,
      delta_reserves  = -Δr₁ + R,
      delta_fees      = -fees
    )
```

**Step 6 - Circulation:**

```
  maxSupply ← 45,000,000,000,000,000       -- 45 billion ADA in lovelace
  circulation ← maxSupply - σ.pots.reserves
```

Circulation is defined as all ADA not in reserves. This includes ADA in
the UTxO set, treasury, fee pot, and deposit pot.

**Step 7 - Per-pool rewards:**

```
  total_active ← Σ active_stake[c]  ∀ c ∈ dom(active_stake)
  rewards ← {}

  ∀ (pool_id, pool) ∈ σ.pools:
    n ← blocks_made[pool_id]  (default 0)
    if n = 0:  continue

    pool_stake ← Σ active_stake[c]
                   ∀ c where σ.accounts[c].pool = pool_id

    if pool_stake ≤ 0:  continue

    σ_pool ← pool_stake / circulation       -- relative pool size
    σ_a    ← pool_stake / total_active      -- pool share of active stake

    reward_one_pool(π, R, n, total_blocks, pool, pool_id,
                    pool_stake, σ_pool, σ_a, circulation,
                    σ, active_stake, rewards)
```

**Step 8 - Residual:**

```
  distributed ← Σ rewards[c]  ∀ c ∈ dom(rewards)
  Δr₂ ← R - distributed                    -- undistributed → reserves
```

Rounding and pools that fail the pledge check cause `distributed < R`.
The residual `Δr₂` returns to reserves, preserving ADA conservation.

**Return:**

```
  return RewardUpdate(
    delta_treasury  = Δt₁,
    delta_reserves  = -Δr₁ + Δr₂,
    rewards         = rewards,
    delta_fees      = -fees
  )
```

### ADA Conservation

The total ADA change across all pots must sum to zero:

```
  Δt₁ + (-Δr₁ + Δr₂) + distributed + (-fees) = 0
  Δt₁ + distributed = R = rewardPot - Δt₁ = fees + Δr₁ - Δt₁

  Δt₁ + distributed + (-Δr₁ + Δr₂) + (-fees)
  = Δt₁ + distributed - Δr₁ + (R - distributed) - fees
  = Δt₁ + R - Δr₁ - fees
  = Δt₁ + (fees + Δr₁ - Δt₁) - Δr₁ - fees
  = 0  ✓
```

---

## 9.2 Per-Pool Reward (rewardOnePool)

For each pool that produced at least one block, compute the operator
(leader) reward and each delegator (member) reward.

### Parameters

```
  R            : Coin      -- total distributable rewards
  n            : N         -- blocks made by this pool
  total_blocks : N         -- total blocks made by all pools
  pool         : PoolParams
  pool_stake   : Coin      -- total lovelace delegated to this pool
  σ_pool       : Q         -- pool_stake / circulation
  σ_a          : Q         -- pool_stake / total_active_stake
  circulation  : Coin      -- maxSupply - reserves
  a₀           : Q         -- π.pledge_influence
  k            : N         -- π.optimal_pool_count
```

### Step 1 - Pledge Check

```
  owners ← pool.owners  (if ∅, fallback to {pool.operator})
  owner_stake ← Σ active_stake[o]  ∀ o ∈ owners

  if owner_stake < pool.pledge:
    return                                  -- pool receives 0 reward
```

This is the pledge enforcement mechanism. A pool whose owners' combined
delegated stake falls below the declared pledge forfeits all rewards for
the epoch. The forfeited amount becomes part of the residual `Δr₂` and
returns to reserves.

### Step 2 - Maximum Pool Reward (maxPool / Desirability)

```
  z₀ ← 1 / k                               -- saturation point
  σ' ← min(σ_pool, z₀)                     -- capped relative stake
  p' ← min(p_r, z₀)                        -- capped relative pledge
  where p_r ← pool.pledge / circulation

  if a₀ = 0:
    maxPool ← ⌊R × σ'⌋                     -- no pledge influence

  else:
    inner ← σ' - p' × (z₀ - σ') / z₀
    pledge_term ← p' × a₀ × inner / z₀
    maxPool ← ⌊R / (1 + a₀) × (σ' + pledge_term)⌋
```

The full formula expanded:

```
  maxPool(R, σ, p_r, a₀, k) =
    ⌊ R / (1 + a₀) × (σ' + p' × a₀ × (σ' - p' × (z₀ - σ') / z₀) / z₀) ⌋
```

**Properties of maxPool:**
- Monotonically increasing in both σ_pool and pledge (up to saturation)
- A fully-saturated pool with maximum pledge achieves `maxPool ≈ R/k`
- Pools beyond saturation (`σ_pool > 1/k`) receive no additional reward
- Higher `a₀` amplifies the benefit of pledge relative to stake

### Step 3 - Apparent Performance (mkApparentPerformance)

In Conway (decentralization parameter `d = 0`), the actual performance
branch is always used:

```
  β ← n / max(1, total_blocks)              -- this pool's block share
  appPerf ← β / σ_a                         -- relative to expected share
```

A pool producing its expected share of blocks (`n/total_blocks ≈ σ_a`)
achieves `appPerf ≈ 1`. Over-performing pools earn proportionally more;
under-performing pools earn less.

**Note:** In pre-Shelley or high-decentralization regimes (`d ≥ 0.8`),
`appPerf = 1` for all pools (uniform performance assumption). This branch
is not applicable in Conway.

### Step 4 - Pool Total Reward

```
  pool_R ← ⌊appPerf × maxPool⌋
```

### Step 5 - Operator (Leader) Reward

The operator receives the fixed cost plus a margin of the remainder,
plus a share proportional to their own stake:

```
  c ← pool.cost                             -- fixed cost (lovelace)
  m ← pool.margin                           -- Fraction(num, den)
  s ← owner_stake / circulation             -- relative owner stake

  if pool_R ≤ c:
    r_operator ← pool_R                     -- pool earns less than cost

  else:
    leader_share ← m + (1 - m) × s / σ_pool
    r_operator ← c + ⌊(pool_R - c) × leader_share⌋
```

The formula decomposes as:
1. **Fixed cost** `c`: guaranteed to the operator (up to pool_R)
2. **Margin** `m × (pool_R - c)`: the operator's percentage cut
3. **Stake share** `(1 - m) × s / σ_pool × (pool_R - c)`: operator's share as a delegator

The operator reward is credited to `pool.reward_account[1:29]` (the
payment credential extracted from the reward address).

### Step 6 - Member (Delegator) Rewards

For each delegator `d` who is not a pool owner:

```
  remaining ← pool_R - r_operator

  ∀ (cred, member_stake) ∈ delegators(pool_id)
    where cred ∉ owners:

    t ← member_stake / circulation           -- relative member stake

    if pool_R ≤ c:
      r_member ← 0                           -- no surplus to distribute

    else:
      member_share ← (1 - m) × t / σ_pool
      r_member ← ⌊(pool_R - c) × member_share⌋

    if r_member > 0 ∧ cred ∈ dom(σ.accounts):
      rewards[cred] += r_member
```

**Rounding dust:** Any difference between `remaining` and the sum of all
member rewards (from floor rounding) is credited to the operator:

```
  dust ← remaining - Σ r_member
  if dust > 0:
    rewards[operator_cred] += dust
```

---

## 9.3 Reward Application

The computed `RewardUpdate` is applied to the ledger state atomically:

```
apply_reward_update : (σ, RewardUpdate) → ()
apply_reward_update(σ, R):

  -- Update protocol pots
  σ.pots.treasury += R.delta_treasury
  σ.pots.reserves += R.delta_reserves
  σ.pots.fees     += R.delta_fees            -- typically = -fees (resets to 0)

  -- Distribute individual rewards
  if R.rewards ≠ ⊥:
    ∀ (cred, amount) ∈ R.rewards:
      if cred ∈ dom(σ.accounts):
        σ.accounts[cred].rewards += amount
      else:
        σ.pots.treasury += amount            -- unregistered credential → treasury
```

The fallback to treasury for unregistered credentials ensures no ADA is
lost when a stake key is deregistered between the snapshot epoch and the
reward distribution epoch.

---

## 9.4 Stake Computation Helpers

### Total Active Stake

```
compute_total_active_stake : (σ, M[B_28, Coin]?) → Coin
compute_total_active_stake(σ, snapshot):

  if snapshot ≠ ⊥:
    return Σ snapshot[c]  ∀ c ∈ dom(snapshot)

  -- Fallback: compute from current state
  delegated ← {c | (c, a) ∈ σ.accounts, a.pool ≠ ⊥, a.pool ∈ dom(σ.pools)}
  total ← Σ (σ.accounts[c].deposit + σ.accounts[c].rewards)  ∀ c ∈ delegated
  total += Σ scan_utxo_stake(σ.utxo, delegated)[c]  ∀ c
  return total
```

### Pool Stake

```
compute_pool_stake : (σ, H_224, M[B_28, Coin]?) → Coin
compute_pool_stake(σ, pool_id, snapshot):

  if snapshot ≠ ⊥:
    return Σ snapshot[c]
             ∀ c where σ.accounts[c].pool = pool_id

  -- Fallback: compute from current state
  pool_creds ← {c | (c, a) ∈ σ.accounts, a.pool = pool_id}
  total ← Σ (a.deposit + a.rewards)  ∀ (c, a) where c ∈ pool_creds
  total += Σ scan_utxo_stake(σ.utxo, pool_creds)
  return total
```

### Owner Stake

```
compute_owner_stake : (σ, PoolParams, M[B_28, Coin]?) → Coin
compute_owner_stake(σ, pool, snapshot):

  owners ← pool.owners  (if ∅, fallback to {pool.operator})
  total ← 0

  ∀ o ∈ owners:
    if snapshot ≠ ⊥ ∧ o ∈ dom(snapshot):
      total += snapshot[o]
    elif o ∈ dom(σ.accounts):
      total += σ.accounts[o].deposit + σ.accounts[o].rewards
      total += Σ scan_utxo_stake(σ.utxo, {o})

  return total
```

### UTxO Stake Scan

```
scan_utxo_stake : (UTxO, S[B_28]?) → M[B_28, Coin]
scan_utxo_stake(utxo, credentials):

  result ← {}
  ∀ out ∈ utxo.values():
    addr ← out.address
    if |addr| < 57:              continue    -- not base address
    if addr[0] >> 4 > 3:        continue    -- not type 0–3

    staking_cred ← addr[29:57]

    if credentials ≠ ⊥ ∧ staking_cred ∉ credentials:
      continue

    amt ← lovelace_of(out.amount)
    if amt > 0:
      result[staking_cred] += amt

  return result
```

---

## 9.5 Key Parameters

Protocol parameters governing reward distribution, with mainnet reference
values:

| Symbol | Parameter                | Field                      | Mainnet Value | Description                                   |
|--------|--------------------------|----------------------------|---------------|-----------------------------------------------|
| ρ      | Monetary expansion       | `monetary_expansion`       | 3/1000        | Fraction of reserves minted per epoch         |
| τ      | Treasury expansion       | `treasury_expansion`       | 1/5           | Fraction of reward pot directed to treasury   |
| a₀     | Pledge influence         | `pledge_influence`         | 3/10          | Weight of pledge in desirability function     |
| k      | Optimal pool count       | `optimal_pool_count`       | 500           | Target number of pools (saturation = 1/k)     |
| -      | Min pool cost            | `min_pool_cost`            | 170,000,000   | Minimum fixed cost per pool (170 ADA)         |
| f      | Active slot coefficient  | `ACTIVE_SLOT_COEFF_DENOM`  | 1/20          | Probability a slot has a block                |
| -      | Max lovelace supply      | `MAX_LOVELACE_SUPPLY`      | 45 × 10¹⁵    | 45 billion ADA                                |
| -      | Epoch length             | `epoch_length`             | 432,000       | Slots per epoch (mainnet)                     |
| -      | Expected blocks          | `expected_blocks`          | 21,600        | ⌊epoch_length × f⌋                           |

### Rational Encoding

All fractional parameters (ρ, τ, a₀, margin, prices) are stored as
`(numerator, denominator)` tuples and computed using Python's
`fractions.Fraction` for exact arithmetic. Floor rounding (`int()` on a
Fraction) is applied only at the final step of each formula to match the
Haskell node's `floor` semantics.

---

## 9.6 Worked Example

Consider a simplified epoch with:

```
  reserves      = 14,000,000,000,000,000    (14B ADA)
  fees          = 50,000,000,000            (50,000 ADA)
  ρ             = 3/1000
  τ             = 1/5
  k             = 500
  a₀            = 3/10
  epoch_length  = 432,000
  total_blocks  = 21,600                    (η = 1.0)
```

**Step 1:** `η = min(1, 21600/21600) = 1`

**Step 2:** `Δr₁ = ⌊1 × 3/1000 × 14,000,000,000,000,000⌋ = 42,000,000,000,000 (42M ADA)`

**Step 3:** `rewardPot = 50,000,000,000 + 42,000,000,000,000 = 42,050,000,000,000`

**Step 4:** `Δt₁ = ⌊1/5 × 42,050,000,000,000⌋ = 8,410,000,000,000 (8.41M ADA)`

**Step 5:** `R = 42,050,000,000,000 - 8,410,000,000,000 = 33,640,000,000,000 (33.64M ADA)`

For a single pool with:
- `pool_stake = 64,000,000,000,000` (64M ADA)
- `circulation = 31,000,000,000,000,000` (31B ADA)
- `pledge = 1,000,000,000,000` (1M ADA), `owner_stake ≥ pledge`
- `cost = 170,000,000` (170 ADA), `margin = 1/100`
- `σ_pool = 64T / 31,000T ≈ 0.00206`, `z₀ = 1/500 = 0.002`

Since `σ_pool > z₀`, the pool is slightly oversaturated:
- `σ' = min(0.00206, 0.002) = 0.002`

The maxPool calculation proceeds with the capped `σ'`, limiting the pool's
reward to the saturation level regardless of additional stake.

---

## 9.7 Implementation Notes

1. **Exact arithmetic:** All intermediate computations use `Fraction` to
   avoid floating-point drift. `int(fraction_value)` applies floor rounding
   only at result boundaries.

2. **Snapshot timing:** Rewards use the "go" stake distribution (frozen 2
   epochs ago) and "go" block counts (also 2 epochs ago). This ensures
   determinism: the reward computation inputs are fixed before the epoch
   begins.

3. **Fee snapshot:** The fee input to RUPD is `σ._fee_ss` (captured at the
   *previous* epoch boundary), not the current `σ.pots.fees`. This aligns
   with the Shelley spec's `feeSS` field in the EpochState snapshots.

4. **Unregistered credentials:** If a credential earns rewards but has been
   deregistered by the time rewards are applied, the amount goes to treasury.
   No ADA is lost.

5. **Owner set:** Pool owners are tracked as a set of credential hashes
   (`pool.owners`). For backward compatibility with early checkpoints that
   lack this field, the implementation falls back to `{pool.operator}`.

6. **Preprod verification:** The reward formula was verified by full preprod
   sync and epoch-by-epoch comparison of treasury/reserves against the Koios API.

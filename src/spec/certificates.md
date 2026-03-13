# 7. Certificates

This chapter specifies the certificate processing rules for the Conway era.
Certificates are the mechanism by which participants register stake credentials,
delegate to pools and DReps, manage pool lifecycle, and participate in
constitutional governance. Each certificate type carries preconditions on the
ledger state, deterministic postconditions, and witness requirements.

---

## 7.1 Certificate Types

A certificate is a CBOR array whose first element is the type tag. The Conway
era defines 19 certificate types (tags 0-4 and 7-18; tags 5-6 are reserved
for the deprecated Genesis and MIR certificates which are never emitted in
Conway).

### 7.1.1 Stake Registration and Deregistration

**Type 0 -- StakeReg**

Registers a new stake credential, creating a stake account with a deposit
determined by protocol parameters.

```
Wire:  [0, credential]
       credential = [0, key_hash] | [1, script_hash]

Pre:   cred not in dom(sigma.accounts)

Post:  sigma.accounts[cred] = Account {
         deposit  = pi.stake_credential_deposit,
         pool     = None,
         rewards  = 0,
       }

Deposit: +pi.stake_credential_deposit
```

**Type 1 -- StakeUnreg**

Deregisters a stake credential, refunding the original deposit. The account
must have zero outstanding rewards.

```
Wire:  [1, credential]

Pre:   cred in dom(sigma.accounts)
       sigma.accounts[cred].rewards = 0

Post:  delete sigma.accounts[cred]

Refund: -pi.stake_credential_deposit
```

The zero-rewards precondition (LR-C3) prevents loss of unclaimed rewards. The
holder must issue a withdrawal transaction before deregistering.

**Type 7 -- RegCert (Conway)**

Conway-style registration with an explicit deposit amount in the certificate
body. This allows the deposit to be specified independently of the current
protocol parameter value.

```
Wire:  [7, credential, deposit]

Pre:   cred not in dom(sigma.accounts)

Post:  sigma.accounts[cred] = Account {
         deposit  = deposit,       -- explicit, not from pi
         pool     = None,
         rewards  = 0,
       }

Deposit: +deposit
```

**Type 8 -- UnregCert (Conway)**

Conway-style deregistration with explicit refund. Preconditions mirror Type 1.

```
Wire:  [8, credential, deposit]

Pre:   cred in dom(sigma.accounts)
       sigma.accounts[cred].rewards = 0

Post:  delete sigma.accounts[cred]

Refund: -deposit (from certificate body, not from stored account deposit)
```

### 7.1.2 Stake Delegation

**Type 2 -- StakeDeleg**

Delegates a registered stake credential to a stake pool.

```
Wire:  [2, credential, pool_id]
       pool_id : H_28               -- pool operator key hash

Pre:   cred in dom(sigma.accounts)

Post:  sigma.accounts[cred].pool = pool_id
```

**Type 9 -- VoteDeleg**

Delegates voting power to a DRep without affecting stake delegation.

```
Wire:  [9, credential, drep]
       drep = [0, key_hash]         -- DRep key credential
            | [1, script_hash]      -- DRep script credential
            | [2]                   -- AlwaysAbstain
            | [3]                   -- AlwaysNoConfidence

Pre:   (none -- silently accepted even if cred not registered)

Post:  (DRep delegation recorded in governance state; no pool change)
```

The Conway specification accepts VoteDeleg even for unregistered credentials
(the delegation is effectively a no-op until the credential registers).

**Type 10 -- StakeVoteDeleg**

Combined stake and vote delegation in a single certificate.

```
Wire:  [10, credential, pool_id, drep]

Pre:   (none -- silently accepted)

Post:  IF cred in dom(sigma.accounts):
         sigma.accounts[cred].pool = pool_id
       (DRep delegation recorded in governance state)
```

### 7.1.3 Combined Registration and Delegation

These Conway certificate types atomically register a credential and delegate
in a single certificate, avoiding the two-transaction pattern required by
Types 0+2.

**Type 11 -- StakeRegDeleg**

Register a stake credential and immediately delegate to a pool.

```
Wire:  [11, credential, pool_id, deposit]

Pre:   (none -- creates account if absent, updates deposit if present)

Post:  IF cred not in dom(sigma.accounts):
         sigma.accounts[cred] = Account { deposit = deposit, rewards = 0 }
       ELSE:
         sigma.accounts[cred].deposit = deposit
       sigma.accounts[cred].pool = pool_id

Deposit: +deposit (if newly registered)
```

**Type 12 -- VoteRegDeleg**

Register a stake credential and delegate voting power to a DRep.

```
Wire:  [12, credential, drep, deposit]

Pre:   (none)

Post:  IF cred not in dom(sigma.accounts):
         sigma.accounts[cred] = Account { deposit = deposit, rewards = 0 }
       ELSE:
         sigma.accounts[cred].deposit = deposit
       (DRep delegation recorded in governance state)

Deposit: +deposit (if newly registered)
```

**Type 13 -- StakeVoteRegDeleg**

Register, delegate stake, and delegate voting all in one certificate.

```
Wire:  [13, credential, pool_id, drep, deposit]

Pre:   (none)

Post:  IF cred not in dom(sigma.accounts):
         sigma.accounts[cred] = Account { deposit = deposit, rewards = 0 }
       ELSE:
         sigma.accounts[cred].deposit = deposit
       sigma.accounts[cred].pool = pool_id
       (DRep delegation recorded in governance state)

Deposit: +deposit (if newly registered)
```

For Types 11-13, the deposit is always the **last element** of the certificate
array. The pool ID, when present, is at index 2.

### 7.1.4 Pool Registration and Retirement

**Type 3 -- PoolReg**

Registers a new stake pool or updates an existing pool's parameters.

```
Wire:  [3, pool_params]
       pool_params = [operator, vrf_keyhash, pledge, cost, margin,
                      reward_account, pool_owners?, relays?, metadata?]
       margin = tag(30, [numerator, denominator]) | [numerator, denominator]

Pre:   pool_params.cost >= pi.min_pool_cost         (LR-H8)

Post:  sigma.pools[operator] = PoolParams {
         operator       = pool_params[0],
         vrf_keyhash    = pool_params[1],
         pledge         = pool_params[2],
         cost           = pool_params[3],
         margin         = (pool_params[4][0], pool_params[4][1]),
         reward_account = pool_params[5],
         deposit_paid   = pi.stake_pool_deposit,   -- current param at reg time
         retiring_epoch = None,
       }

Deposit: +pi.stake_pool_deposit (only if operator not already in dom(sigma.pools))
```

If the pool operator already exists in `sigma.pools`, this is an **update** --
no additional deposit is collected, and the existing deposit amount is
preserved.

The `margin` field is encoded as either a CBOR tag 30 rational or a two-element
array `[numerator, denominator]`.

**Type 4 -- PoolRetire**

Schedules a pool for retirement at a future epoch boundary.

```
Wire:  [4, pool_id, epoch]
       pool_id : H_28
       epoch   : N                  -- target retirement epoch

Pre:   pool_id in dom(sigma.pools)                   (pool must exist)
       sigma.epoch < epoch                            (must be future; LR-H9)
       epoch <= sigma.epoch + pi.pool_retirement_max_epoch  (bounded; LR-H9)

Post:  sigma.pools[pool_id].retiring_epoch = epoch
```

The actual pool removal occurs at the epoch boundary when `sigma.epoch = epoch`
(see Chapter 8, Epoch Transitions).

### 7.1.5 Governance Certificates

**Type 14 -- AuthCommitteeHot**

Authorizes a hot credential to act on behalf of a constitutional committee
cold key.

```
Wire:  [14, cold_credential, hot_credential]

Pre:   (none)

Post:  sigma.gov_state.committee[cold_cred] = 0    -- mark as active
```

**Type 15 -- ResignCommitteeCold**

A constitutional committee member resigns.

```
Wire:  [15, cold_credential, anchor?]
       anchor = [url, metadata_hash] | None

Pre:   (none)

Post:  delete sigma.gov_state.committee[cold_cred]
```

**Type 16 -- DRepReg**

Registers a new delegated representative.

```
Wire:  [16, credential, deposit, anchor?]
       anchor = [url, metadata_hash] | None

Pre:   (none -- idempotent registration)

Post:  sigma.gov_state.dreps[cred] = deposit

Deposit: +deposit
```

**Type 17 -- DRepUnreg**

Deregisters a delegated representative and refunds the deposit.

```
Wire:  [17, credential, deposit]

Pre:   cred in dom(sigma.gov_state.dreps)

Post:  delete sigma.gov_state.dreps[cred]

Refund: -deposit
```

**Type 18 -- DRepUpdate**

Updates a DRep's metadata anchor. No deposit change, no state mutation beyond
the anchor update.

```
Wire:  [18, credential, anchor?]

Pre:   (none)

Post:  (no state change -- metadata anchor is off-chain)
```

---

## 7.2 Deposit Accounting

Deposits are a mechanism to prevent resource exhaustion of the ledger state.
Each registration locks a deposit that is refunded upon deregistration.

### 7.2.1 Net Deposit Calculation

For a transaction `tau` with certificates `tau.certificates`, the net deposit
change is:

```
net_deposits(pi, tau, sigma) = total_new_deposits - total_refunds

total_new_deposits = sum([
  deposit_for(c, pi, sigma)
  for c in tau.certificates
])

total_refunds = sum([
  refund_for(c, pi, sigma)
  for c in tau.certificates
])
```

**Deposit amounts by certificate type:**

| Type | Certificate | Deposit Amount |
|---|---|---|
| 0 | StakeReg | `pi.stake_credential_deposit` |
| 3 | PoolReg (new) | `pi.stake_pool_deposit` |
| 3 | PoolReg (update) | 0 (no additional deposit) |
| 7 | RegCert | explicit `deposit` from cert body |
| 11 | StakeRegDeleg | explicit `deposit` (last element) |
| 12 | VoteRegDeleg | explicit `deposit` (last element) |
| 13 | StakeVoteRegDeleg | explicit `deposit` (last element) |
| 16 | DRepReg | explicit `deposit` from cert body |

**Refund amounts by certificate type:**

| Type | Certificate | Refund Amount |
|---|---|---|
| 1 | StakeUnreg | `pi.stake_credential_deposit` |
| 8 | UnregCert | explicit `deposit` from cert body |
| 17 | DRepUnreg | explicit `deposit` from cert body |

For pool retirement (Type 4), the deposit is refunded at the epoch boundary
when the pool is actually removed, not at the time the retirement certificate
is submitted.

### 7.2.2 Value Conservation with Deposits

The UTxO value conservation equation (Chapter 4) accounts for deposits:

```
sum(consumed_inputs) + withdrawals
  = sum(produced_outputs) + fee + net_deposits(pi, tau, sigma)
```

A positive `net_deposits` means the transaction locks additional funds. A
negative value means the transaction receives a net refund.

### 7.2.3 Deposit Tracking in State

The cumulative deposit balance is tracked in `sigma.pots.deposited`:

```
sigma'.pots.deposited = sigma.pots.deposited + net_deposits(pi, tau, sigma)
```

Individual account deposits are tracked in `sigma.accounts[cred].deposit` and
pool deposits in `sigma.pools[operator].deposit_paid`.

---

## 7.3 Certificate Witness Requirements

Every certificate that modifies the ledger state must be authorized by an
appropriate witness. The witness requirement depends on the certificate type
and the credential type (key hash vs. script hash).

### 7.3.1 Witness Derivation Rules

```
cert_witnesses(tau) = UNION { witness_needed(c) | c in tau.certificates }

witness_needed(c):

  Type 0 (StakeReg):
    -- No witness required (anyone can register a credential)
    RETURN {}

  Type 1 (StakeUnreg):
    IF c.credential.type = 0:         -- key hash
      RETURN { c.credential.hash }
    RETURN {}                          -- script: handled by redeemer

  Type 2 (StakeDeleg):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}

  Type 3 (PoolReg):
    RETURN { c.pool_params.operator }

  Type 4 (PoolRetire):
    RETURN { c.pool_id }

  Type 7 (RegCert):
    -- No witness required (like Type 0)
    RETURN {}

  Type 8 (UnregCert):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}

  Type 9 (VoteDeleg):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}

  Type 10 (StakeVoteDeleg):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}

  Type 11 (StakeRegDeleg):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}

  Type 12 (VoteRegDeleg):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}

  Type 13 (StakeVoteRegDeleg):
    IF c.credential.type = 0:
      RETURN { c.credential.hash }
    RETURN {}
```

### 7.3.2 Script Credential Witnesses

When a certificate's credential is a **script hash** (credential type 1), the
witness is not a VKey signature but a Plutus script execution. The script is
identified by the credential hash and must be present in the witness set or
as a reference script. The redeemer for the script uses tag `CERT = 2` with
the certificate's index in the transaction's certificate list.

```
IF c.credential.type = 1:        -- script hash
  REQUIRE redeemer (CERT, index) exists in tau.witnesses[5]
  REQUIRE script_hash = c.credential.hash in available_scripts
  -- Script execution handles authorization (Phase 2)
```

### 7.3.3 Pool Registration Witnesses

Pool registration (Type 3) requires a VKey signature from the pool operator.
The operator key hash is the first element of the `pool_params` array.

```
required_signers(PoolReg) = { pool_params[0] }  -- operator key hash
```

The Haskell specification additionally requires witnesses from all pool owners
listed in the registration certificate. The current implementation requires
only the operator witness.

### 7.3.4 Collateral Input Witnesses

Although not a certificate rule per se, collateral inputs also require
witnesses. Every collateral input whose UTxO address has a key-hash payment
credential must be signed by that key:

```
FOR coll_input IN tau.collateral:
  out = sigma.utxo[input_key(coll_input)]
  (cred, is_key) = payment_credential(out.address)
  IF is_key:
    REQUIRE cred in verified_key_hashes
```

---

## 7.4 Certificate Processing Pipeline

Certificates are processed sequentially within a transaction, in the order
they appear in `tau.certificates`. This ordering matters because later
certificates may depend on state changes made by earlier ones (e.g., a
StakeRegDeleg followed by a StakeDeleg to a different pool).

```
process_certificates(sigma, tau.certificates, pi):
  errors = []
  FOR cert IN tau.certificates:
    cert_type = cert[0]
    cert_errors = process_one_cert(sigma, cert_type, cert, pi)
    errors.extend(cert_errors)
  RETURN errors
```

All certificate processing is performed **in-place** on the mutable ledger
state. If any certificate produces errors, those errors are collected but
processing continues for subsequent certificates (fail-open within a
transaction; the transaction itself is rejected if any errors occur).

---

## 7.5 Credential Encoding

The credential field in certificates follows the CBOR convention:

```
credential = [cred_type, cred_hash]

  cred_type:
    0 = key hash     (H_28 -- blake2b_224 of an Ed25519 verification key)
    1 = script hash  (H_28 -- blake2b_224 of version_byte || flat_bytes)

  cred_hash : B_28
```

The credential key extraction in the implementation:

```
credential_key(cert) -> B_28:
  cred = cert[1]
  IF cred is [cred_type, cred_hash]:
    RETURN ensure_bytes(cred_hash)
  ELSE:
    RETURN ensure_bytes(cred)         -- raw bytes fallback
```

---

## 7.6 Summary Table

| Type | Name | Wire Format | Pre | Post | Witness | Deposit |
|---|---|---|---|---|---|---|
| 0 | StakeReg | `[0, cred]` | cred fresh | create account | none | +`pi.scd` |
| 1 | StakeUnreg | `[1, cred]` | registered, rewards=0 | delete account | cred key | -`pi.scd` |
| 2 | StakeDeleg | `[2, cred, pool]` | registered | set pool | cred key | 0 |
| 3 | PoolReg | `[3, params]` | cost >= min | create/update pool | operator | +`pi.spd` (new) |
| 4 | PoolRetire | `[4, pool, epoch]` | pool exists, epoch valid | mark retiring | pool key | 0 |
| 7 | RegCert | `[7, cred, dep]` | cred fresh | create account | none | +dep |
| 8 | UnregCert | `[8, cred, dep]` | registered, rewards=0 | delete account | cred key | -dep |
| 9 | VoteDeleg | `[9, cred, drep]` | -- | delegate vote | cred key | 0 |
| 10 | StakeVoteDeleg | `[10, cred, pool, drep]` | -- | delegate both | cred key | 0 |
| 11 | StakeRegDeleg | `[11, cred, pool, dep]` | -- | reg + delegate | cred key | +dep |
| 12 | VoteRegDeleg | `[12, cred, drep, dep]` | -- | reg + vote deleg | cred key | +dep |
| 13 | StakeVoteRegDeleg | `[13, cred, pool, drep, dep]` | -- | reg + both deleg | cred key | +dep |
| 14 | AuthCommitteeHot | `[14, cold, hot]` | -- | authorize hot key | cold key | 0 |
| 15 | ResignCommittee | `[15, cold, anchor?]` | -- | remove from committee | cold key | 0 |
| 16 | DRepReg | `[16, cred, dep, anchor?]` | -- | register DRep | cred key | +dep |
| 17 | DRepUnreg | `[17, cred, dep]` | DRep registered | remove DRep | cred key | -dep |
| 18 | DRepUpdate | `[18, cred, anchor?]` | -- | (metadata only) | cred key | 0 |

Where `pi.scd = pi.stake_credential_deposit` and `pi.spd = pi.stake_pool_deposit`.

---

## 7.7 Implementation Notes

**Source file:** `/Users/prasad/projects/cardano/bluematter/src/bluematter/ledger/rules/certs.py`

The implementation dispatches on certificate type through `_process_one_cert`,
which maps each type tag to a handler function. State types are defined in
`ledger/state.py`:

- `Account` -- stake account with `deposit`, `pool`, and `rewards` fields.
- `PoolParams` -- pool registration parameters with `operator`, `vrf_keyhash`,
  `pledge`, `cost`, `margin`, `reward_account`, `owners`, `retiring_epoch`,
  and `deposit_paid`.
- `LedgerState` -- contains `accounts : M[B_28, Account]` and
  `pools : M[B_28, PoolParams]`.

Governance state (Types 14-18) is managed through the `GovState` object
attached to `LedgerState.gov_state`, which tracks `committee : M[B_28, int]`
and `dreps : M[B_28, int]`.

Witness validation for certificates is performed in
`ledger/rules/utxow.py : required_key_hashes()`, which unions the witness
requirements from certificates with those from inputs, withdrawals, collateral,
and explicit required signers.

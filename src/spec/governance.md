# 11. Conway Governance

This section specifies the CIP-1694 on-chain governance framework as
implemented in the Conway era. It covers the three governance bodies,
seven action types, the proposal lifecycle, stake-weighted voting,
enactment effects, and governance-related certificates.

## Notation

| Symbol | Meaning |
|--------|---------|
| sigma | Ledger state |
| pi | Protocol parameters |
| epsilon | Current epoch |
| tau | Transaction |
| G | Governance state (sigma.gov_state) |
| P | Proposals map: M[(H, N), GovProposal] |
| V | Votes map: M[(H, N), L[GovVote]] |
| C | Committee map: M[B_28, N] (credential -> expiry epoch) |
| D | DRep registry: M[B_28, N] (credential -> deposit) |
| cred(addr) | Extract 28-byte credential from a 29-byte reward address: addr[1:29] |

---

## 11.1 Governance Bodies

Conway governance is a tricameral system. Every governance action
requires approval from a subset of three bodies, each with its own
voting mechanism:

### 11.1.1 Constitutional Committee (CC)

```
CC = { (cold_cred, expiry_epoch) | cold_cred in C }
```

A fixed-size committee of elected members, identified by cold
credentials (key hash or script hash). Each member has an expiry
epoch; after expiry, the member can no longer vote. CC votes are
counted by **head count** (one member, one vote), not by stake.

CC members delegate operational authority via hot keys
(AuthCommitteeHot certificates). The committee can be dissolved
by a NoConfidence action.

### 11.1.2 Delegated Representatives (DReps)

```
DReps = { (cred, deposit) | cred in D }
```

Any ADA holder may register as a DRep by posting a deposit.
Stake holders delegate their voting power to DReps via VoteDeleg
certificates. DRep votes are **stake-weighted**: a DRep's voting
power equals the total ADA delegated to them.

### 11.1.3 Stake Pool Operators (SPOs)

```
SPOs = { pool_id | pool_id in sigma.pools }
```

Registered stake pool operators vote with their pool's total
delegated stake. SPO votes are **stake-weighted** by pool stake.

### 11.1.4 Voter Requirements by Action Type

```
Action Type            | CC  | DRep | SPO
-----------------------|-----|------|----
ParameterChange        | YES | YES  | --
HardForkInitiation     | YES | YES  | YES
TreasuryWithdrawals    | YES | YES  | --
NoConfidence           | --  | YES  | YES
UpdateCommittee        | --  | YES  | YES
NewConstitution        | YES | YES  | --
InfoAction             | --  | --   | --
```

"YES" means the body must reach its threshold for the action to be
ratified. "--" means the body's votes are not required.

---

## 11.2 Governance Actions

There are seven governance action types, identified by CBOR tag 0-6
in the `proposal_procedures` transaction field.

### 11.2.1 ParameterChange (tag 0)

**Purpose.** Update one or more protocol parameters.

**Payload.** `[prev_action_id, parameter_update_map]`

The parameter update map uses CBOR integer keys corresponding to
the Conway `ProtParamUpdate` CDDL:

```
Key | Parameter                    | Rational?
----|------------------------------|----------
 0  | min_fee_a                    | No
 1  | min_fee_b                    | No
 2  | max_block_body_size          | No
 3  | max_tx_size                  | No
 4  | max_block_header_size        | No
 5  | stake_credential_deposit     | No
 6  | stake_pool_deposit           | No
 7  | pool_retirement_max_epoch    | No
 8  | optimal_pool_count           | No
 9  | pledge_influence             | Yes
10  | monetary_expansion           | Yes
11  | treasury_expansion           | Yes
16  | min_pool_cost                | No
17  | lovelace_per_utxo_byte       | No
19  | price_mem                    | Yes
20  | price_step                   | Yes
23  | max_value_size               | No
24  | collateral_percentage        | No
25  | max_collateral_inputs        | No
28  | committee_min_size           | No
29  | committee_max_term_length    | No
30  | gov_action_lifetime          | No
31  | gov_action_deposit           | No
32  | drep_deposit                 | No
33  | drep_activity                | No
34  | min_fee_ref_script_per_byte  | Yes
```

Rational parameters are encoded as `[numerator, denominator]` pairs.

**Required voters.** CC + DRep.

### 11.2.2 HardForkInitiation (tag 1)

**Purpose.** Signal readiness to transition to a new protocol version.

**Payload.** `[prev_action_id, [major, minor]]`

**Required voters.** CC + DRep + SPO.

**Enactment effect.** None at the ledger level. The hard fork
combinator handles the actual era transition.

### 11.2.3 TreasuryWithdrawals (tag 2)

**Purpose.** Transfer ADA from the treasury to specified reward accounts.

**Payload.** `[prev_action_id, {reward_addr: amount, ...}]`

**Required voters.** CC + DRep.

### 11.2.4 NoConfidence (tag 3)

**Purpose.** Dissolve the constitutional committee (vote of no confidence).

**Payload.** `[prev_action_id]`

**Required voters.** DRep + SPO.

### 11.2.5 UpdateCommittee (tag 4)

**Purpose.** Add or remove constitutional committee members and
update the quorum threshold.

**Payload.** `[prev_action_id, members_to_remove, members_to_add, new_threshold]`

where:
- `members_to_remove`: set of credentials to remove
- `members_to_add`: `{credential: expiry_epoch, ...}`
- `new_threshold`: rational number

**Required voters.** DRep + SPO.

### 11.2.6 NewConstitution (tag 5)

**Purpose.** Adopt a new constitution (update the constitution hash).

**Payload.** `[prev_action_id, [anchor, script_hash?]]`

**Required voters.** CC + DRep.

### 11.2.7 InfoAction (tag 6)

**Purpose.** Non-binding informational signal. Always ratified.

**Payload.** `[tag_6]`

**Required voters.** None. InfoActions are always considered ratified
upon submission. They serve as a signaling mechanism with no on-chain
effect.

---

## 11.3 Proposal Lifecycle

### 11.3.1 Submission

Proposals are submitted as part of a transaction's `proposal_procedures`
field (CBOR map key 20 in the transaction body).

```
submit(G, tau.proposal_procedures, tau.hash, epsilon, pi):
  for idx, proposal_raw in enumerate(tau.proposal_procedures):
    -- Parse: [deposit, return_addr, action, anchor]
    deposit   = int(proposal_raw[0])
    return_addr = proposal_raw[1]        -- B_29 reward address
    action    = proposal_raw[2]          -- [tag, ...]
    anchor    = proposal_raw[3]          -- off-chain metadata

    action_type = classify(action[0])    -- tag 0-6 -> GovActionType
    action_id   = (tau.hash, idx)

    proposal = GovProposal {
      action_id    = action_id,
      action_type  = action_type,
      deposit      = deposit,
      return_addr  = return_addr,
      anchor       = anchor,
      expires_epoch = epsilon + pi.gov_action_lifetime,
      payload      = action,
    }

    G.proposals[action_id] = proposal
```

The deposit must satisfy `deposit >= pi.gov_action_deposit`. The
deposit is locked until the proposal is either enacted or expires.

### 11.3.2 Voting

Votes are submitted via the `voting_procedures` field (CBOR map key 19
in the transaction body).

```
vote(G, tau.voting_procedures, sigma):
  for voter, actions in tau.voting_procedures:
    (voter_type, voter_cred) = parse_voter(voter)
    -- voter_type: "cc" (tag 0), "drep" (tag 1), "spo" (tag 2)

    -- Eligibility check
    if voter_type = "cc"   and voter_cred not in G.committee: skip
    if voter_type = "drep"  and voter_cred not in G.dreps:     skip
    if voter_type = "spo"   and voter_cred not in sigma.pools: skip

    for action_id, vote_choice in actions:
      -- vote_choice: 0 = No, 1 = Yes, 2 = Abstain
      G.votes[action_id].append(GovVote {
        voter_type, voter_cred, action_id, choice
      })
```

### 11.3.3 Epoch Boundary Processing

At each epoch boundary, proposals are checked for ratification and
expiry:

```
process_governance(sigma, G, epsilon):
  enacted = []
  to_remove = []

  for (key, proposal) in G.proposals:

    -- Check expiry
    if proposal.expires_epoch is not None and epsilon > proposal.expires_epoch:
      to_remove.append(key)
      -- Refund deposit to return address
      cred = cred(proposal.return_addr)
      if cred in sigma.accounts:
        sigma.accounts[cred].rewards += proposal.deposit
      else:
        sigma.pots.treasury += proposal.deposit     -- unclaimed goes to treasury
      continue

    -- Check ratification
    votes = G.votes.get(key, [])
    if is_ratified(proposal, votes, sigma, pi):
      enact(proposal, sigma)
      enacted.append(proposal)
      proposal.enacted_epoch = epsilon
      G.enacted.append((epsilon, proposal))

      -- Refund deposit to proposer
      cred = cred(proposal.return_addr)
      if cred in sigma.accounts:
        sigma.accounts[cred].rewards += proposal.deposit

      to_remove.append(key)

  -- Clean up
  for key in to_remove:
    delete G.proposals[key]
    delete G.votes[key]

  return enacted
```

**Deposit handling.** Enacted proposals refund the deposit to the
proposer's reward account. Expired proposals also refund to the
reward account if the credential is registered; otherwise the deposit
goes to the treasury.

---

## 11.4 Stake-Weighted Voting

### 11.4.1 Ratification Predicate

```
is_ratified(proposal, votes, sigma, pi):
  -- InfoAction: always ratified
  if proposal.action_type = InfoAction: return True
  if votes is empty: return False

  -- Tally votes
  (cc_yes, cc_no) = (0, 0)
  (drep_yes_stake, drep_total_stake) = (0, 0)
  (spo_yes_stake, spo_total_stake) = (0, 0)

  for vote in votes:
    if vote.choice = Abstain: continue

    match vote.voter_type:
      "cc":
        if vote.choice = Yes: cc_yes += 1
        if vote.choice = No:  cc_no  += 1

      "drep":
        stake = drep_delegated_stake(sigma, vote.voter_cred)
        drep_total_stake += stake
        if vote.choice = Yes: drep_yes_stake += stake

      "spo":
        stake = pool_total_stake(sigma, vote.voter_cred)
        spo_total_stake += stake
        if vote.choice = Yes: spo_yes_stake += stake

  -- Check thresholds (strict: must exceed, not just meet)
  cc_threshold  = get_cc_threshold(proposal.action_type, pi)
  drep_threshold = get_drep_threshold(proposal.action_type, pi)
  spo_threshold  = get_spo_threshold(proposal.action_type, pi)

  if cc_threshold is not None and cc_yes + cc_no > 0:
    if cc_yes / (cc_yes + cc_no) <= cc_threshold: return False

  if drep_threshold is not None:
    if drep_total_stake > 0:
      if drep_yes_stake / drep_total_stake <= drep_threshold: return False
    elif drep_threshold > 0:
      return False               -- threshold required but no votes

  if spo_threshold is not None:
    if spo_total_stake > 0:
      if spo_yes_stake / spo_total_stake <= spo_threshold: return False
    elif spo_threshold > 0:
      return False               -- threshold required but no votes

  -- Must have at least one YES vote from some body
  return cc_yes > 0 or drep_yes_stake > 0 or spo_yes_stake > 0
```

### 11.4.2 Threshold Lookup

Thresholds are per-action-type and come from protocol parameters.
Default threshold is 1/2 (simple majority) when not specified.

**DRep thresholds** (from `pi.drep_voting_thresholds`):

```
Action Type            | Parameter Key
-----------------------|----------------------------
NoConfidence           | dvtMotionNoConfidence
UpdateCommittee        | dvtCommitteeNormal
NewConstitution        | dvtUpdateToConstitution
HardForkInitiation     | dvtHardForkInitiation
ParameterChange        | dvtPPGovGroup
TreasuryWithdrawals    | dvtTreasuryWithdrawal
```

**SPO thresholds** (from `pi.pool_voting_thresholds`):

```
Action Type            | Parameter Key
-----------------------|----------------------------
NoConfidence           | pvtMotionNoConfidence
UpdateCommittee        | pvtCommitteeNormal
HardForkInitiation     | pvtHardForkInitiation
```

**CC threshold:** Currently a fixed default of 1/2. Future protocol
parameter updates will make this configurable per-action-type.

### 11.4.3 Stake Computation

**DRep stake.** A DRep's voting power is the total stake delegated to
them by all delegators. In the current implementation, this is
approximated by the DRep's deposit plus delegator stake:

```
drep_delegated_stake(sigma, drep_cred):
  if drep_cred in G.dreps and G.dreps[drep_cred] > 0:
    return G.dreps[drep_cred]       -- deposit as proxy
  if drep_cred in sigma.accounts:
    acct = sigma.accounts[drep_cred]
    return acct.deposit + acct.rewards
  return 1                           -- minimum weight
```

**SPO stake.** A pool's voting power is the sum of all delegated stake:

```
pool_total_stake(sigma, pool_id):
  total = sum(acct.deposit + acct.rewards
              for cred, acct in sigma.accounts
              if acct.pool = pool_id)
  return max(total, 1)               -- minimum weight
```

---

## 11.5 Enactment Effects

When a proposal is ratified, its effects are applied to the ledger state.
Each action type has a specific enactment function.

### 11.5.1 ParameterChange

```
enact_parameter_change(sigma, payload):
  -- payload = [prev_action_id, update_map]
  update_map = payload[1]

  overrides = {}
  for (cbor_key, value) in update_map:
    (field_name, is_rational) = PARAM_KEY_MAP[cbor_key]
    if is_rational and value is [num, denom]:
      value = (num, denom)
    overrides[field_name] = value

  sigma.protocol_params = sigma.protocol_params with overrides
```

Protocol parameters are immutable (frozen dataclass); updates create
a new instance via `dataclasses.replace()`.

### 11.5.2 TreasuryWithdrawals

```
enact_treasury_withdrawals(sigma, payload):
  -- payload = [prev_action_id, {reward_addr: amount, ...}]
  withdrawals = payload[1]

  for (reward_addr, amount) in withdrawals:
    cred = cred(reward_addr)
    if amount > 0 and sigma.pots.treasury >= amount:
      sigma.pots.treasury -= amount
      if cred in sigma.accounts:
        sigma.accounts[cred].rewards += amount
```

**Conservation law.** Treasury withdrawals preserve total ADA:
the treasury decreases by exactly the amount credited to reward
accounts. Withdrawals to unregistered credentials are silently
ignored (treasury is not debited).

### 11.5.3 NoConfidence

```
enact_no_confidence(sigma):
  sigma.gov_state.committee = {}
```

Dissolves the entire constitutional committee. All member credentials
are removed. This is irreversible without a subsequent UpdateCommittee
action.

### 11.5.4 UpdateCommittee

```
enact_update_committee(sigma, payload):
  -- payload = [prev_action_id, to_remove, to_add, new_threshold]
  to_remove = payload[1]      -- set of credentials
  to_add    = payload[2]      -- {credential: expiry_epoch}

  for cred in to_remove:
    delete sigma.gov_state.committee[cred]

  for (cred, expiry) in to_add:
    sigma.gov_state.committee[cred] = expiry
```

### 11.5.5 NewConstitution

```
enact_new_constitution(sigma, payload):
  -- payload = [prev_action_id, [anchor, script_hash?]]
  constitution = payload[1]

  if constitution has script_hash at index 1:
    sigma.gov_state.constitution_hash = constitution[1]
```

The constitution anchor (URL and hash of off-chain document) is
recorded. If a guardrails script hash is provided, it becomes the
new constitution script.

### 11.5.6 HardForkInitiation

```
enact_hard_fork(sigma, payload):
  -- No ledger-level effect
  -- The HFC handles the actual era transition
  pass
```

### 11.5.7 InfoAction

```
enact_info(sigma, payload):
  -- No effect (non-binding signal)
  pass
```

---

## 11.6 Governance Certificates

Conway introduces certificate types 7-18, of which types 14-18 are
governance-specific.

### 11.6.1 Certificate Type Summary

```
Type | Name                | CBOR Layout                        | Effect
-----|---------------------|------------------------------------|----------------------------------
  0  | StakeReg            | [0, cred]                          | Register stake credential
  1  | StakeUnreg          | [1, cred]                          | Deregister, refund deposit
  2  | StakeDeleg          | [2, cred, pool_id]                 | Delegate stake to pool
  3  | PoolReg             | [3, pool_params]                   | Register/update pool
  4  | PoolRetire          | [4, pool_id, epoch]                | Schedule pool retirement
  7  | RegCert             | [7, cred, deposit]                 | Conway registration (explicit deposit)
  8  | UnregCert           | [8, cred, deposit]                 | Conway deregistration (explicit refund)
  9  | VoteDeleg           | [9, cred, drep]                    | Delegate voting to DRep
 10  | StakeVoteDeleg      | [10, cred, pool_id, drep]          | Delegate stake + voting
 11  | StakeRegDeleg       | [11, cred, pool_id, deposit]       | Register + delegate stake
 12  | VoteRegDeleg        | [12, cred, drep, deposit]          | Register + delegate voting
 13  | StakeVoteRegDeleg   | [13, cred, pool_id, drep, deposit] | Register + delegate both
 14  | AuthCommitteeHot    | [14, cold_cred, hot_cred]          | CC hot key authorization
 15  | ResignCommitteeCold | [15, cold_cred, anchor?]           | CC member resignation
 16  | DRepReg             | [16, cred, deposit, anchor?]       | Register as DRep
 17  | DRepUnreg           | [17, cred, deposit]                | Deregister DRep
 18  | DRepUpdate          | [18, cred, anchor?]                | Update DRep metadata
```

Credentials are encoded as `[cred_type, cred_hash]` where
`cred_type = 0` for key hash and `cred_type = 1` for script hash.
The `cred_hash` is always B_28 (Blake2b-224).

### 11.6.2 AuthCommitteeHot (Type 14)

```
process_auth_committee_hot(sigma, [14, cold_cred, hot_cred]):
  cred = extract_key(cold_cred)
  sigma.gov_state.committee[cred] = 0     -- mark as active
```

Delegates the CC cold key's voting authority to a hot key. The hot
key can then be used for online voting without exposing the cold key.

### 11.6.3 ResignCommitteeCold (Type 15)

```
process_resign_committee(sigma, [15, cold_cred, anchor?]):
  cred = extract_key(cold_cred)
  delete sigma.gov_state.committee[cred]
```

A CC member voluntarily resigns. The credential is removed from the
committee. The optional anchor provides metadata about the resignation.

### 11.6.4 DRepReg (Type 16)

```
process_drep_reg(sigma, [16, cred, deposit, anchor?]):
  key = extract_key(cred)
  sigma.gov_state.dreps[key] = deposit
```

Registers a new DRep. The deposit is locked and refunded upon
deregistration. The optional anchor points to off-chain metadata
(name, platform, etc.).

### 11.6.5 DRepUnreg (Type 17)

```
process_drep_unreg(sigma, [17, cred, deposit]):
  key = extract_key(cred)
  delete sigma.gov_state.dreps[key]
```

Deregisters a DRep. The deposit specified in the certificate is
refunded. All delegations to this DRep become inactive.

### 11.6.6 DRepUpdate (Type 18)

```
process_drep_update(sigma, [18, cred, anchor?]):
  -- No state change required
  -- The anchor update is recorded off-chain
  pass
```

Updates DRep metadata. No on-chain state change; the new anchor
is visible in transaction history.

---

## 11.7 Governance State

The governance state is maintained as part of the ledger state:

```
GovState = {
  proposals        : M[(H, N), GovProposal],     -- active proposals
  votes            : M[(H, N), L[GovVote]],       -- votes per proposal
  committee        : M[B_28, N],                   -- CC members: cred -> expiry
  constitution_hash: H?,                           -- current constitution
  dreps            : M[B_28, N],                   -- DRep registry: cred -> deposit
  enacted          : L[(N, GovProposal)],          -- history: (epoch, proposal)
}
```

where the proposal/vote key `(H, N)` is `(tx_hash, proposal_index)`.

### 11.7.1 GovProposal

```
GovProposal = {
  action_id     : (H, N),           -- (tx_hash, index)
  action_type   : GovActionType,    -- enum 0-6
  deposit       : N,                -- lovelace deposited
  return_addr   : B_29,             -- reward address for deposit refund
  anchor        : B?,               -- off-chain metadata reference
  enacted_epoch : N?,               -- epoch when enacted (None if pending)
  expires_epoch : N?,               -- epoch when proposal expires
  payload       : Any,              -- action-specific CBOR data
}
```

### 11.7.2 GovVote

```
GovVote = {
  voter_type       : {"cc", "drep", "spo"},
  voter_credential : B_28,
  action_id        : (H, N),
  choice           : {No = 0, Yes = 1, Abstain = 2},
  anchor           : B?,            -- optional vote rationale
}
```

### 11.7.3 Vote Choice Encoding

```
CBOR value | Choice
-----------|--------
    0      | No
    1      | Yes
    2      | Abstain
```

Unrecognized values default to Abstain.

### 11.7.4 Voter Type Encoding

```
CBOR tag | Voter Type
---------|----------
   0     | CC (Constitutional Committee)
   1     | DRep (Delegated Representative)
   2     | SPO (Stake Pool Operator)
```

---

## 11.8 Governance Action Chaining

Several governance action types include a `prev_action_id` field
that references a previous governance action of the same type. This
creates a chain of related actions:

```
ParameterChange:     prev must be ParameterChange or null
HardForkInitiation:  prev must be HardForkInitiation or null
TreasuryWithdrawals: prev must be TreasuryWithdrawals or null
NoConfidence:        prev must be NoConfidence or UpdateCommittee or null
UpdateCommittee:     prev must be UpdateCommittee or NoConfidence or null
NewConstitution:     prev must be NewConstitution or null
InfoAction:          no chaining
```

A null `prev_action_id` indicates the action is the first of its kind
or does not depend on a previous action. The chaining mechanism ensures
that conflicting governance actions are ordered and only one path
through the action chain is enacted.

---

## 11.9 Invariants

The governance system maintains the following invariants:

**I1 — Deposit conservation.** For every proposal, exactly one of:
(a) the deposit is refunded to the return address upon enactment,
(b) the deposit is refunded upon expiry, or
(c) the deposit goes to the treasury if the credential is unregistered.

**I2 — Single ratification.** Each proposal is ratified at most once.
Once enacted, it is removed from the active proposals set.

**I3 — Monotonic enacted history.** The enacted list is append-only
and ordered by epoch.

**I4 — Committee consistency.** After NoConfidence, the committee is
empty. AuthCommitteeHot adds members. ResignCommitteeCold removes them.
These are the only operations that modify the committee set.

**I5 — DRep registry consistency.** DRepReg adds entries. DRepUnreg
removes them. No other operations modify the DRep registry.

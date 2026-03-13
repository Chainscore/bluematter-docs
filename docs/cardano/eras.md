# Era Evolution

> Comprehensive reference for all Cardano eras, hard forks, protocol versions, and
> ledger rule changes. Accurate as of March 2026.

---

## Table of Contents

1. [Overview: Development Phases vs Ledger Eras](#overview-development-phases-vs-ledger-eras)
2. [Hard Fork Combinator (HFC)](#hard-fork-combinator-hfc)
3. [Protocol Version Map](#protocol-version-map)
4. [Era 1: Byron (2017-2020)](#era-1-byron-20172020)
5. [Era 2: Shelley (2020)](#era-2-shelley-2020)
6. [Era 3: Allegra (2020)](#era-3-allegra-2020)
7. [Era 4: Mary (2021)](#era-4-mary-2021)
8. [Era 5: Alonzo (2021)](#era-5-alonzo-2021)
9. [Era 6: Babbage (2022-2024)](#era-6-babbage-20222024)
10. [Era 7: Conway (2024-present)](#era-7-conway-2024present)
11. [Future: Dijkstra Era and Beyond](#future-dijkstra-era-and-beyond)
12. [Consensus Protocol Evolution](#consensus-protocol-evolution)
13. [Complete Hard Fork Timeline](#complete-hard-fork-timeline)
14. [Key CIPs by Era](#key-cips-by-era)

---

## Overview: Development Phases vs Ledger Eras

Cardano's evolution is described along two orthogonal axes:

**Development Phases** (named after poets/scientists, describe the *vision*):
- **Byron** -- Foundation (basic transactions, federated network)
- **Shelley** -- Decentralization (staking, delegation, rewards)
- **Goguen** -- Smart Contracts (native tokens, Plutus, EUTxO)
- **Basho** -- Scaling (performance, throughput, reference scripts)
- **Voltaire** -- Governance (on-chain voting, treasury, DReps)

**Ledger Eras** (describe the *code* -- each era is a distinct set of ledger rules):
- Byron, Shelley, Allegra, Mary, Alonzo, Babbage, Conway

The mapping is not 1:1. For example, Allegra, Mary, and Alonzo are all part of the
Goguen development phase. The Babbage era corresponds to the Basho phase. The Conway
era corresponds to the Voltaire phase.

Era names follow a convention:
- **Byron**: George Gordon Byron, poet
- **Shelley**: Percy Bysshe Shelley, poet
- **Allegra**: Allegra Byron (Byron's daughter, connection to Shelley)
- **Mary**: Mary Shelley (Shelley's wife, author of Frankenstein)
- **Alonzo**: Alonzo Church, mathematician (inventor of lambda calculus)
- **Babbage**: Charles Babbage, mathematician (father of computing)
- **Conway**: John Horton Conway, mathematician

Starting with Alonzo, eras are named alphabetically (A, B, C...) after
mathematicians and computer scientists.

---

## Hard Fork Combinator (HFC)

The **Hard Fork Combinator** is Cardano's mechanism for seamless protocol upgrades. It
is one of Cardano's most distinctive technical innovations.

### How It Works

1. **Protocol combination**: The HFC merges pre-fork and post-fork protocols into a
   single unified ledger. Byron blocks, Shelley blocks, Allegra blocks, etc. all
   appear as one continuous chain.

2. **History preservation**: All previous blocks are automatically preserved. The new
   protocol combines original blocks (old rules) with new blocks (new rules) without
   "radical interference to the chain."

3. **Gradual node transition**: Unlike traditional hard forks, not all nodes must
   upgrade simultaneously. The HFC allows a transition period where some nodes
   process new-era blocks while others still run pre-fork software.

4. **On-chain triggering**: Hard forks are initiated by on-chain governance (protocol
   update proposals or governance actions), not by node operators restarting software.
   The node watches the ledger state and transitions automatically when the protocol
   version is bumped.

5. **No downtime**: The first use of the HFC (Byron to Shelley, July 2020) completed
   without any downtime or chain split.

### Intra-Era Hard Forks

The HFC also supports "intra-era" hard forks -- bumping the major protocol version
without creating a new ledger era. These are small, focused semantic changes. Examples:
- Alonzo: protocol version 5 -> 6
- Babbage: protocol version 7 -> 8 (Valentine/SECP)
- Conway: protocol version 9 -> 10 (Plomin)

---

## Protocol Version Map

Each major protocol version corresponds to a ledger era or intra-era upgrade:

| Major Version | Era / Description              | Consensus Protocol    |
|:---:|----------------------------------------|-----------------------|
| 0   | Byron (Ouroboros Classic)              | Ouroboros Classic     |
| 1   | Byron (Ouroboros BFT)                  | Ouroboros BFT         |
| 2   | Shelley                                | TPraos                |
| 3   | Allegra                                | TPraos                |
| 4   | Mary                                   | TPraos                |
| 5   | Alonzo                                 | TPraos                |
| 6   | Alonzo (intra-era hard fork)           | TPraos                |
| 7   | Babbage                                | Praos                 |
| 8   | Babbage (intra-era: Valentine/SECP)    | Praos                 |
| 9   | Conway (bootstrap phase)               | Praos                 |
| 10  | Conway (full governance: Plomin)       | Praos                 |
| 11  | Conway (intra-era: van Rossem)         | Praos                 |
| 12  | Dijkstra (future era)                  | TBD (Leios?)         |

**Minor version rules**: If the current protocol has minor version > 0, it must be
reset to 0 when the major version is bumped. Major version can only increment by
exactly 1.

---

## Era 1: Byron (2017-2020)

### Mainnet Launch
- **Date**: September 29, 2017
- **Epoch**: 0
- **Protocol version**: 0.0
- **Consensus**: Ouroboros Classic
- **Development phase**: Byron (Foundation)

### What Was Introduced
- First proof-of-stake blockchain based on peer-reviewed academic research
- ADA cryptocurrency (named after Ada Lovelace)
- Ouroboros Classic consensus protocol
- Federated block production (7 federated nodes controlled by IOHK, Emurgo, Cardano Foundation)
- Daedalus wallet (full-node desktop wallet by IOHK)
- Yoroi wallet (light wallet by Emurgo)
- UTXO accounting model

### Token Distribution
- 25.9 billion ADA distributed via public token sale (September 2015 - January 2017)
- 5.2 billion ADA to founding entities after genesis block
- Maximum supply: 45 billion ADA

### Byron Reboot (OBFT Hard Fork)
- **Date**: February 20, 2020, 21:44:51 UTC
- **Epoch**: 176
- **Protocol version**: 0.0 -> 1.0
- **Consensus**: Ouroboros Classic -> Ouroboros BFT

This was a *traditional* hard fork (not yet using the HFC, which was developed for the
Shelley transition). It was a "Byron Reboot" -- a complete reimplementation of the Byron
codebase that:
- Switched from Ouroboros Classic to Ouroboros BFT
- Provided a simpler migration pathway toward Ouroboros Praos (Shelley)
- Required node upgrade to Cardano 1.6.0 / Daedalus 0.15.1
- The OBFT protocol served as a bridge: federated but simpler, preparing for
  decentralization

### Ledger Rules (Byron)
- Simple UTXO model (no scripts, no metadata)
- Transactions: inputs, outputs, ADA-only values
- Block format: Byron-specific headers, EBBs (Epoch Boundary Blocks)
- No staking, no delegation, no rewards

### Wire Format
- Byron blocks use a distinct CBOR encoding from Shelley+ blocks
- EBBs (Epoch Boundary Blocks) are special zero-transaction marker blocks at epoch
  boundaries (Byron only, discontinued in Shelley)
- Block header contains: protocol magic, previous hash, body proof, consensus data,
  extra data

---

## Era 2: Shelley (2020)

### Hard Fork Details
- **Date**: July 29, 2020, 21:44:51 UTC
- **Epoch**: 208
- **Protocol version**: 2.0
- **Consensus**: TPraos (Transitional Praos)
- **Development phase**: Shelley (Decentralization)
- **Node version**: cardano-node 1.18.0+

This was the first use of the Hard Fork Combinator, transitioning from Byron ledger
rules to Shelley ledger rules without downtime.

### What Was Introduced
- **Decentralization**: Transition from 7 federated nodes to community stake pools
- **Staking and delegation**: ADA holders can delegate to stake pools to earn rewards
- **Stake pools**: Anyone can register and operate a stake pool
- **Reward mechanism**: Monetary expansion from reserves + transaction fees
- **Protocol parameters**: ~20 updatable on-chain parameters
- **MultiSig scripts**: Simple multi-signature native scripts (m-of-n)
- **Certificates**: Stake registration, delegation, pool registration, pool retirement
- **Metadata**: Transaction metadata (auxiliary data)
- **Address format**: New Shelley-era base/enterprise/reward addresses (Bech32)

### Decentralization Parameter (d)
The `d` parameter controlled the ratio of federated vs. community block production:
- Epoch 208: d = 1.0 (100% federated)
- Gradually decreased over subsequent epochs
- Epoch 234: `nOpt` (k) changed from 150 to 500
- March 31, 2021 (epoch 257): d = 0.0 (100% decentralized, "D-Day")

### Key Protocol Parameters (Shelley)
- `nOpt` (k): Target number of pools (initially 150, then 500)
- `a0`: Pledge influence factor
- `rho`: Monetary expansion rate (reserves -> rewards)
- `tau`: Treasury cut (fraction of rewards to treasury)
- `minFeeA`, `minFeeB`: Linear fee model: fee = minFeeA * size + minFeeB
- `minPoolCost`: Minimum fixed cost per pool per epoch (340 ADA)
- `decentralisationParam` (d): Federated block ratio
- `maxBlockBodySize`, `maxBlockHeaderSize`, `maxTxSize`

### Ledger Rule Changes
- UTXO model extended with: multi-sig scripts, certificates, withdrawals, metadata
- New address types: base (payment + staking), enterprise (payment only), reward
- Epoch-based reward calculation: reserves -> reward pot -> pools -> delegators
- Pool saturation mechanism (k parameter)
- Key deposit (2 ADA) and pool deposit (500 ADA)

### Wire Format Changes
- Shelley blocks use a completely different CBOR structure from Byron
- Block = [header, body, witnesses, metadata]
- Header contains: slot, block number, issuer VKey, VRF output, block body hash, opcert, KES signature
- Transaction body is a CBOR map with integer keys
- No more EBBs

### Key CIPs
- CIP-2: Coin selection algorithms
- CIP-5: Common Bech32 prefixes
- CIP-9: Protocol Parameters (Shelley Era)
- CIP-11: Staking key derivation

### Impact on Node Implementation
- Full reimplementation of ledger from Byron
- HFC infrastructure: nodes must handle both Byron and Shelley block formats
- New consensus layer: TPraos (VRF for leader election, KES for signing)
- Reward calculation engine (non-trivial: pool desirability, apparent performance, etc.)

---

## Era 3: Allegra (2020)

### Hard Fork Details
- **Date**: December 16, 2020, 21:44:51 UTC
- **Epoch**: 236
- **Protocol version**: 3.0
- **Consensus**: TPraos (unchanged)
- **Development phase**: Goguen (Smart Contracts) -- first step

### What Was Introduced
- **Timelock scripts**: Extension of Shelley's MultiSig scripts with validity intervals
  - `RequireTimeExpire` (valid before slot X)
  - `RequireTimeStart` (valid after slot X)
- **Token locking**: Ability to lock tokens until a specific time/slot (preparation for
  on-chain voting and native tokens)

### Ledger Rule Changes
- MultiSig script language extended to `Timelock` (strictly backwards compatible)
- Same `scriptPrefixTag` as MultiSig (backwards compatible encoding)
- Transaction validity intervals interact with timelock conditions
- No new protocol parameters added or removed

### Wire Format Changes
- Minimal: script type extended to include time-based constructors
- CDDL updated for Allegra and Mary timelock scripts
- Transaction body unchanged

### Key CIPs
- No major standalone CIPs; Allegra was primarily an infrastructure upgrade for Mary

### Impact on Node Implementation
- Script evaluation must check slot-based validity conditions
- Relatively small change: timelock is a straightforward extension of MultiSig

---

## Era 4: Mary (2021)

### Hard Fork Details
- **Date**: March 1, 2021, 21:44:51 UTC
- **Epoch**: 251
- **Protocol version**: 4.0
- **Consensus**: TPraos (unchanged)
- **Development phase**: Goguen

### What Was Introduced
- **Native tokens (multi-asset support)**: Users can create, mint, and transfer custom
  tokens directly on the ledger, without smart contracts
- **Minting policies**: Timelock scripts control who can mint/burn tokens and when
- **NFTs**: Non-fungible tokens (unique asset names under a policy ID)
- **Multi-asset values**: Transaction outputs carry ADA + arbitrary native tokens
- Cardano became a **multi-asset ledger**

### How Native Tokens Work
- Tokens are identified by: `PolicyID` (hash of minting policy script) + `AssetName`
  (up to 32 bytes)
- Minting/burning requires the policy script to validate
- Tokens are "first-class citizens" -- tracked directly by the ledger, not via smart
  contracts (unlike Ethereum ERC-20)
- Sending tokens costs the same as sending ADA (no smart contract gas)
- Minimum UTXO value: outputs carrying tokens must meet a minimum ADA threshold
  (prevents dust attacks)

### Ledger Rule Changes
- `Value` type changed from `Coin` (just lovelace) to `Value` (lovelace + multi-asset map)
- UTXO rules updated for value conservation with multi-asset
- `Mint` field added to transaction body
- `ValueNotConservedUTxO` predicate failure updated for multi-asset
- Minimum UTXO size calculation accounts for token bundle size

### Wire Format Changes
- Transaction outputs: `[address, value]` where value can be either:
  - `coin` (just lovelace, for ADA-only outputs)
  - `[coin, multiasset]` (lovelace + token map)
- `multiasset = { policy_id => { asset_name => quantity } }`
- Mint field in transaction body: `multiasset` map
- CDDL updated significantly for Mary

### Key CIPs
- CIP-25: Media Token Metadata Standard (NFT metadata -- adopted widely by community)

### Impact on Node Implementation
- Value arithmetic must handle multi-asset maps (add, subtract, compare)
- Minting policy script evaluation on every mint/burn
- UTXO storage grows significantly (token bundles can be large)
- Fee calculation accounts for multi-asset output sizes

---

## Era 5: Alonzo (2021)

### Hard Fork Details
- **Date**: September 12, 2021, 21:44:51 UTC
- **Epoch**: 290
- **Protocol version**: 5.0
- **Consensus**: TPraos (unchanged)
- **Development phase**: Goguen

### What Was Introduced
- **Smart contracts**: Plutus V1 scripts on the ledger
- **Extended UTXO (EUTxO) model**: Outputs can carry datums; spending requires a
  redeemer; scripts have full transaction context
- **Plutus V1**: On-chain script language (compiled Haskell via Plutus Core / UPLC)
- **Two-phase validation**: Phase 1 (structural) and Phase 2 (script execution)
- **Collateral**: Failed Phase-2 transactions forfeit collateral (ADA-only UTXOs)
- **Cost model**: Execution budget (CPU steps + memory units) with on-chain cost model
  parameters
- **Script data hash**: Commitment to datums + redeemers + cost models in tx body

### EUTxO Model
- Transaction outputs can carry a **datum hash** (pointer to off-chain data)
- Spending a script-locked output requires:
  - **Datum**: The data attached to the output
  - **Redeemer**: The argument provided by the spender
  - **Script Context**: Full transaction context (inputs, outputs, mint, etc.)
- Plutus validators are functions: `datum -> redeemer -> scriptContext -> Bool`
- Validity of a transaction can be checked **off-chain** before submission (determinism)

### Two-Phase Validation
- **Phase 1**: Structural checks (fees, sizes, format, signatures, native scripts)
- **Phase 2**: Plutus script execution (may fail; collateral consumed if it does)
- The `isValid` flag in the transaction indicates expected Phase-2 outcome
- If `isValid = False`, only collateral is consumed (outputs are NOT created)

### Ledger Rule Changes
- New script types: PlutusV1 (in addition to native/timelock scripts)
- Datum hashes on transaction outputs
- Redeemers indexed by (purpose, index) in witness set
- Collateral inputs field in transaction body
- Execution units (ExUnits) budgets per redeemer
- `scriptDataHash` field in transaction body
- `maxTxExUnits`, `maxBlockExUnits` protocol parameters
- `collateralPercentage`, `maxCollateralInputs` protocol parameters
- Cost model parameters (166 integers for PlutusV1)

### Alonzo Intra-Era Hard Fork
- **Protocol version**: 5.0 -> 6.0
- Bumped major version within the Alonzo era
- Focused semantic changes without creating a new ledger era

### Wire Format Changes
- Transaction body gains new map keys:
  - 13: Collateral inputs
  - 11: Script data hash
  - 5: Certificates (updated for script witnesses)
- Witness set gains:
  - Plutus V1 scripts (tag 3)
  - Plutus data / datums (tag 4)
  - Redeemers (tag 5)
- Transaction output: `[address, value, datum_hash?]`

### Key CIPs
- CIP-28: Protocol Parameters (Alonzo Era)
- CIP-29: Phase-2 validation failure reporting
- CIP-30: Cardano dApp-Wallet Web Bridge (enabling dApp interaction)
- CIP-40: Explicit collateral output (later, for Babbage)

### Impact on Node Implementation
- Plutus interpreter integration (CEK machine for UPLC evaluation)
- Cost model application and budget tracking
- Two-phase validation pipeline
- Script data hash computation (complex: involves cost model CBOR encoding)
- Collateral handling (separate path for failed Phase-2 transactions)
- PlutusV1 scripts are *immutable forever* -- the language semantics cannot change

---

## Era 6: Babbage (2022-2024)

### Vasil Hard Fork
- **Date**: September 22, 2022, 21:44:51 UTC
- **Epoch**: 365
- **Protocol version**: 7.0
- **Consensus**: Praos (replaced TPraos -- dropped the transitional system)
- **Development phase**: Basho (Scaling)
- **Named after**: Vasil Dabov, late Bulgarian mathematician and Cardano ambassador

Note: Plutus V2 cost model became available on September 27 at the start of epoch 366.

### What Was Introduced
- **Plutus V2**: New ledger language with improved capabilities
- **Reference inputs** (CIP-31): Read UTXO data without spending it
- **Inline datums** (CIP-32): Store datums directly in outputs (not just hashes)
- **Reference scripts** (CIP-33): Store scripts in UTXOs, reference them by hash
- **Explicit collateral output** (CIP-40): Change address for collateral
- **Improved Plutus cost model**: Reduced script execution costs

### CIP-31: Reference Inputs
- Problem: Previously, accessing datum data required *spending* the output
- Solution: A new transaction input type that *references* an output without spending it
- The spending conditions on referenced outputs are not checked
- Enables "oracle-like" UTXOs that provide data to multiple transactions

### CIP-32: Inline Datums
- Problem: Datums were stored as hashes; full data had to be supplied in witness set
- Solution: Datums can be stored directly ("inline") in transaction outputs
- Combined with CIP-31, enables efficient data sharing on-chain
- Particularly useful for small, frequently-read data

### CIP-33: Reference Scripts
- Problem: Plutus scripts had to be included in every spending transaction (large tx size)
- Solution: Scripts stored in UTXOs can be referenced by other transactions
- Dramatically reduces transaction size and fees for script-heavy applications
- Multiple transactions can share the same script without re-including it

### CIP-40: Explicit Collateral Output
- Problem: In Alonzo, if Phase-2 validation failed, ALL collateral was consumed
- Solution: Transactions can specify a collateral return output (change address)
- Only the required collateral percentage is consumed on failure

### Plutus V2 Improvements
- `TxOut` in script context now has 4 fields: address, value, datum (hash/inline/none),
  reference script
- `TxInInfo` contains resolved output data
- More efficient serialization
- New built-in functions

### Ledger Rule Changes
- Reference inputs field in transaction body
- Inline datum support in transaction outputs
- Reference script field in transaction outputs
- Collateral return output field in transaction body
- Total collateral field in transaction body
- Script context (V2) provides richer information

### Wire Format Changes
- Transaction output becomes a CBOR map (post-Alonzo format):
  - Key 0: address
  - Key 1: value
  - Key 2: datum option (0=hash, 1=inline datum)
  - Key 3: script reference
- New transaction body fields:
  - 18: Reference inputs
  - 16: Collateral return
  - 17: Total collateral

### Valentine (SECP) Intra-Era Hard Fork
- **Date**: February 14, 2023, 21:44:51 UTC
- **Epoch**: 394 (absolute slot ~84844800)
- **Protocol version**: 7.0 -> 8.0
- **Named after**: Valentine's Day (February 14)
- **CIP-49**: ECDSA and Schnorr signatures over SECP256k1 curve

This intra-era hard fork added new Plutus built-in functions:
- `verifyEcdsaSecp256k1Signature`: ECDSA verification on secp256k1
- `verifySchnorrSecp256k1Signature`: Schnorr verification on secp256k1

**Why it matters**: Bitcoin and many other blockchains use SECP256k1. Without native
built-ins, implementing these in Plutus would be prohibitively expensive and insecure.
This enables:
- Cross-chain bridges (Wanchain, Renbridge)
- Bitcoin signature verification on Cardano
- MuSig2 and Frost threshold signature verification
- Broader DeFi interoperability

### Key CIPs (Babbage Era)
- CIP-31: Reference inputs
- CIP-32: Inline datums
- CIP-33: Reference scripts
- CIP-40: Explicit collateral output
- CIP-49: ECDSA and Schnorr in Plutus Core (Valentine)
- CIP-55: Protocol Parameters (Babbage Era)

### Impact on Node Implementation
- Consensus layer change: TPraos -> Praos (simpler, no transitional mechanism)
- Reference input resolution during validation
- Inline datum handling in UTXO storage
- Reference script resolution during Phase-2 validation
- SECP256k1 crypto library integration (for Valentine)
- Plutus V2 cost model (separate from V1)

---

## Era 7: Conway (2024-present)

The Conway era implements the Voltaire development phase -- full on-chain governance.
It was delivered in two hard forks: **Chang** (bootstrap) and **Plomin** (full).

### Chang Hard Fork (#1)
- **Date**: September 1, 2024, 21:44:51 UTC
- **Epoch**: 507
- **Block**: 10,764,778
- **Protocol version**: 9.0
- **Consensus**: Praos (unchanged)
- **Development phase**: Voltaire (Governance)
- **Named after**: Phil Chang, who pioneered Cardano governance at IOG (passed away 2022)
- **Node version**: cardano-node 9.0.0+

### What Chang Introduced (Bootstrap Phase)
- **CIP-1694 governance framework** (initial implementation)
- **Delegated Representatives (DReps)**: Registration and delegation enabled
- **Interim Constitutional Committee (ICC)**: Oversight body for constitutionality
- **Interim constitution**: Temporary safeguards with technical guardrails script
- **PlutusV3**: New ledger language with major improvements
- **Genesis key burning**: The 7 Cardano genesis keys were burned permanently
- **Limited governance actions**: Parameter changes, hard forks, and "Info" actions only
- During bootstrap: only SPOs and ICC can vote (DReps can register but not yet vote)

### PlutusV3 Features
- **BLS12-381 primitives** (CIP-381): 17 built-ins for cryptographic pairings,
  enabling zero-knowledge proofs, sidechain bridges, Mithril integration
- **Blake2b-224**: On-chain public-key hash computation
- **Keccak-256**: Ethereum-compatible hashing (cross-chain)
- **Bitwise primitives** (CIP-58): `integerToByteString`, `byteStringToInteger`
- **Sums of Products (SOPs)**: More efficient data type encoding in Plutus Core
- **Script signature unification** (CIP-69): All scripts take 1 argument (ScriptContext).
  Removes the separate datum argument for spending scripts. Datums are accessed via
  ScriptContext. Enables multi-purpose scripts.
- **Observe script type** (CIP-112): Arbitrary validation logic decoupled from ledger
  actions. New field: `txInfoObservations` in TxInfo.

### Plomin Hard Fork (#2)
- **Date**: January 29, 2025, 21:45 UTC
- **Epoch**: ~530
- **Protocol version**: 9.0 -> 10.0
- **Named after**: Matthew Plomin, Cardano community member and USDM stablecoin
  co-founder (passed away late 2024)
- **First community-enacted hard fork**: Governance action submitted on-chain, ratified
  by SPOs (>78% adoption) and ICC (5-of-7 approval)

### What Plomin Introduced (Full Governance)
- **All 7 governance actions enabled** (completing CIP-1694):
  1. Motion of No-Confidence
  2. New Constitutional Committee / threshold / terms
  3. Update to Constitution or Proposal Policy
  4. Hard Fork Initiation
  5. Protocol Parameter Changes
  6. Treasury Withdrawals
  7. Info actions
- **DRep voting activated**: Full delegated representative participation
- **Treasury withdrawals enabled**: Community can fund projects from the on-chain
  treasury (~$1.5 billion at the time)
- **Staking reward withdrawal restriction**: Must delegate to a DRep to withdraw rewards
  (rewards continue to accrue regardless)
- **SPO governance role**: SPOs vote on hard forks and certain actions
- **"One lovelace, one vote"**: Voting power proportional to ADA stake

### CIP-1694 Governance Structure

Three governance bodies:
1. **Constitutional Committee (CC)**: Votes on constitutionality of governance actions
   (each member has one vote). Two states: normal (confidence) and no-confidence.
2. **Delegated Representatives (DReps)**: Represent ADA holders. Vote on all governance
   action types. Holders delegate via: specific DRep, "Abstain" (opt out), or
   "No Confidence" (auto-yes on no-confidence actions).
3. **Stake Pool Operators (SPOs)**: Vote on hard forks and committee changes.

### Constitutional Convention (December 2024)
- Held simultaneously in Buenos Aires, Argentina and Nairobi, Kenya
- December 4-6, 2024
- 63 workshops across 51 countries preceded the event
- 95% of elected delegates approved the draft constitution
- Constitution formally submitted for on-chain ratification post-Plomin (January 30, 2025)

### Ledger Rule Changes (Conway)
- Governance actions as on-chain transactions
- DRep registration/delegation certificates
- Vote transactions
- Treasury withdrawal mechanism
- Guardrails script enforcement on parameter changes and treasury withdrawals
- New certificate types: DRep registration (7), DRep deregistration (8),
  vote delegation, combined registration+delegation
- Constitution hash stored on-chain
- Proposal deposits and return mechanism

### Wire Format Changes (Conway)
- New transaction body fields:
  - Voting procedures
  - Proposal procedures
  - Treasury donation
  - Current treasury value
- New certificate types (Conway-specific encodings)
- Governance state in epoch boundary processing

### van Rossem Hard Fork (Protocol Version 11) -- UPCOMING
- **Target date**: March 2026
- **Protocol version**: 10.0 -> 11.0
- **Type**: Intra-era hard fork (remains in Conway era)
- **Named after**: Max van Rossem (contributions to hard fork working group)
- **Node version**: cardano-node 10.7.0

This is a focused upgrade within Conway:
- **Plutus built-in unification**: All built-in functions made available across V1, V2,
  and V3 (expanding legacy script capabilities)
- **Case expressions for built-in types**: Bool, Integer, Data in UPLC
- **Improved script performance**: Reduced execution costs
- **New cryptographic features**: Enhanced ZK-proof support
- **Ledger consistency fixes**: No transaction shape changes

### Key CIPs (Conway Era)
- CIP-1694: On-chain decentralized governance (the foundational governance CIP)
- CIP-69: Script signature unification
- CIP-112: Observe script type
- CIP-58: Bitwise primitives
- CIP-381: BLS12-381 pairings in Plutus
- CIP-95: Web-Wallet Bridge (Conway era)
- CIP-105: Conway era key chains for HD wallets

### Impact on Node Implementation
- Full governance engine: proposal lifecycle, voting tallies, ratification thresholds
- DRep stake tracking and delegation
- Constitutional committee management
- Treasury withdrawal processing
- Guardrails script evaluation
- PlutusV3 interpreter with new built-ins (BLS, bitwise, etc.)
- Epoch boundary processing: governance enactment, DRep expiry
- 1-argument script interface for V3 (ScriptContext only)

---

## Future: Dijkstra Era and Beyond

### Dijkstra Era (Protocol Version 12)
- **Named after**: Edsger W. Dijkstra, computer scientist
- **Status**: Foundational work begun in node codebase
- **Expected**: After Leios deployment

### Ouroboros Leios (Major Consensus Upgrade)
- **Target**: Mainnet deployment in 2026 (originally slated for 2028, accelerated)
- **Status as of March 2026**: CIP ~67% complete, active development in specs,
  simulations, and code implementation
- **What it does**: Parallel block creation for massive throughput increase
  - **Input blocks**: Created independently by SPOs in parallel
  - **Endorsement blocks**: Aggregate and endorse input blocks
  - **Ranking blocks**: Determine final transaction ordering
- **Performance targets**: 30-50x throughput increase (from ~5 TPS to 100-1,000+ TPS)
- **Deployment**: Single hard fork, preceded by dedicated Leios testnet
- **Parameters**: Initially conservative, gradually increased as ecosystem adapts

### Ouroboros Peras (Faster Finality)
- Complements Leios by reducing finality from ~12 hours to ~2 minutes
- Optimistic acceleration under favorable network conditions

### Other Planned Technologies
- **Hydra (Layer 2)**: Head protocol for near-instant micro-transactions
- **Mithril**: Lightweight cryptographic proofs for fast sync without full node
- **Midgard**: First optimistic rollup framework for Cardano (EUTxO-native)
- **Midnight**: Privacy-focused partner chain (confidential smart contracts)

### Community Governance Milestones (2025-2026)
- August 2025: Community approved $71M treasury allocation for 12-month core development
- October 2025: Node 1.0.0 release + Hydra stress test (>1M TPS demonstrated)
- November 2025: Mainnet chain partition (serialization bug) -- Ouroboros self-healed
  without intervention, validating protocol resilience
- March 2026: van Rossem hard fork (protocol version 11)
- 2026: Ouroboros Leios mainnet deployment (hard fork to protocol version 12?)

---

## Consensus Protocol Evolution

| Period | Protocol | Description |
|--------|----------|-------------|
| 2017-2020 | Ouroboros Classic | Original PoS, federated, susceptible to attacks |
| Feb 2020 | Ouroboros BFT | Byzantine Fault Tolerant, bridge to Praos |
| Jul 2020-Sep 2022 | TPraos | Transitional Praos: VRF leader election + KES signing, with transition mechanism from BFT |
| Sep 2022-present | Praos | Full Praos: dropped transitional system, cleaner implementation |
| Future | Leios | Parallel block production, 30-50x throughput |

**VRF (Verifiable Random Function)**: Used for slot leader election since Shelley.
Each pool evaluates VRF with their key + slot + epoch nonce. If output < threshold
(based on relative stake), they are the slot leader.

**KES (Key Evolving Signature)**: Forward-secure signatures. Keys evolve each KES
period (~1.5 days). Old keys are securely deleted, preventing retrospective forgery.
Cardano uses Sum6KES (6-level Merkle tree of Ed25519 keys).

**Operational Certificate (OpCert)**: Signed by the pool's cold key, delegates
authority to the current KES key. Contains KES period counter and KES verification key.

---

## Complete Hard Fork Timeline

| # | Name | Date | Epoch | Proto Ver | Era | Phase | Type |
|:---:|------|------|:-----:|:---------:|-----|-------|------|
| 1 | Byron Launch | 2017-09-29 | 0 | 0.0 | Byron | Byron | Genesis |
| 2 | Byron Reboot (OBFT) | 2020-02-20 | 176 | 1.0 | Byron | Byron | Traditional HF |
| 3 | Shelley | 2020-07-29 | 208 | 2.0 | Shelley | Shelley | HFC event |
| 4 | Allegra | 2020-12-16 | 236 | 3.0 | Allegra | Goguen | HFC event |
| 5 | Mary | 2021-03-01 | 251 | 4.0 | Mary | Goguen | HFC event |
| 6 | Alonzo | 2021-09-12 | 290 | 5.0 | Alonzo | Goguen | HFC event |
| 7 | Alonzo intra-era | ~2021 | -- | 6.0 | Alonzo | Goguen | Intra-era HF |
| 8 | Vasil (Babbage) | 2022-09-22 | 365 | 7.0 | Babbage | Basho | HFC event |
| 9 | Valentine (SECP) | 2023-02-14 | 394 | 8.0 | Babbage | Basho | Intra-era HF |
| 10 | Chang (Conway) | 2024-09-01 | 507 | 9.0 | Conway | Voltaire | HFC event |
| 11 | Plomin | 2025-01-29 | ~530 | 10.0 | Conway | Voltaire | Intra-era HF |
| 12 | van Rossem | 2026-03 (target) | TBD | 11.0 | Conway | Voltaire | Intra-era HF |

All HFC events occurred at 21:44:51 UTC (the epoch boundary time), which is the
moment when one epoch ends and the next begins. This is approximately 21:45 UTC.

---

## Key CIPs by Era

### Shelley
| CIP | Title |
|-----|-------|
| CIP-2 | Coin selection algorithms |
| CIP-5 | Common Bech32 prefixes |
| CIP-9 | Protocol Parameters (Shelley Era) |
| CIP-11 | Staking key derivation |

### Allegra
| CIP | Title |
|-----|-------|
| -- | Timelock script extension (part of ledger spec, no separate CIP) |

### Mary
| CIP | Title |
|-----|-------|
| CIP-25 | Media Token Metadata Standard (NFTs) |

### Alonzo
| CIP | Title |
|-----|-------|
| CIP-28 | Protocol Parameters (Alonzo Era) |
| CIP-29 | Phase-2 validation failure reporting |
| CIP-30 | Cardano dApp-Wallet Web Bridge |

### Babbage (Vasil)
| CIP | Title |
|-----|-------|
| CIP-31 | Reference inputs |
| CIP-32 | Inline datums |
| CIP-33 | Reference scripts |
| CIP-40 | Explicit collateral output |
| CIP-55 | Protocol Parameters (Babbage Era) |

### Babbage (Valentine)
| CIP | Title |
|-----|-------|
| CIP-49 | ECDSA and Schnorr signatures in Plutus Core |

### Conway (Chang + Plomin)
| CIP | Title |
|-----|-------|
| CIP-1694 | On-chain decentralized governance |
| CIP-58 | Bitwise primitives |
| CIP-69 | Script signature unification |
| CIP-95 | Web-Wallet Bridge (Conway era) |
| CIP-105 | Conway era key chains for HD wallets |
| CIP-112 | Observe script type |
| CIP-381 | BLS12-381 pairings in Plutus |

---

## Sources

- [Which hard forks have occurred? -- cardano.org](https://cardano.org/hardforks/)
- [Development phases and eras -- Cardano Docs](https://docs.cardano.org/about-cardano/evolution/eras-and-phases)
- [CIP-59: Terminology Surrounding Core Features](https://cips.cardano.org/cip/CIP-59)
- [CIP-84: Cardano Ledger Evolution](https://cips.cardano.org/cip/CIP-84)
- [CIP-1694: On-Chain Decentralized Governance](https://cips.cardano.org/cip/CIP-1694)
- [Chang upgrade -- Cardano Docs](https://docs.cardano.org/about-cardano/evolution/upgrades/chang)
- [Valentine (SECP) -- Cardano Docs](https://docs.cardano.org/about-cardano/evolution/upgrades/valentine)
- [Alonzo -- Cardano Docs](https://docs.cardano.org/about-cardano/evolution/upgrades/alonzo)
- [Chang upgrade completed -- Plomin hard fork achieved!](https://cardano.org/news/2025-01-30-chang-upgrade-completed/)
- [Explainer: The Plomin Hard Fork](https://cardano.org/news/2025-01-23-explainer-the-plomin-hard-fork/)
- [Proposed Intra-Era Hard Fork to Protocol Version 11](https://www.intersectmbo.org/news/proposed-intra-era-hard-fork-to-protocol-version-11)
- [Ouroboros Leios](https://leios.cardano-scaling.org/)
- [About hard forks -- Cardano Docs](https://docs.cardano.org/learn/about-hard-forks/)
- [2025 Proposed Cardano Roadmap](https://committees.docs.intersectmbo.org/intersect-product-committee/committee-outcomes/2025-cardanos-roadmap/2025-proposed-cardano-roadmap)
- [OBFT hard fork announcement -- IOHK Support](https://iohk.zendesk.com/hc/en-us/articles/900000232386-Announcement-19th-February-2020-OBFT-hard-fork-on-the-Byron-mainnet)
- [Unlocking more opportunities with PlutusV3 -- IOG Blog](https://iohk.io/en/blog/posts/2024/02/12/unlocking-more-opportunities-with-plutus-v3/)
- [CIP-49: ECDSA and Schnorr in Plutus Core](https://cips.cardano.org/cip/CIP-49)
- [CIP-31: Reference inputs](https://cips.cardano.org/cip/CIP-31)
- [CIP-32: Inline datums](https://cips.cardano.org/cip/CIP-32)
- [CIP-33: Reference scripts](https://cips.cardano.org/cip/CIP-33)

# Bluematter Security & Correctness Audit — 2026-03-12

## Methodology
8 parallel deep-review agents each read every source file in their scope, compared against the Shelley/Alonzo/Babbage/Conway formal specs (.tex), the CDDL wire specs, the Amaru Rust reference, and the Haskell cardano-node. This report consolidates all findings.

**Codebase**: 68 source files, ~11,600 lines
**Tests**: 1,073 tests, ~13,500 lines
**Scope**: All modules — codec, crypto, ledger, plutus, consensus, network, storage, node

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 21 | Consensus failures, value leaks, RCE, forged proofs |
| **HIGH** | 38 | Missing spec checks, protocol violations, DoS vectors |
| **MEDIUM** | 48 | Correctness gaps, edge cases, wrong computation |
| **LOW** | 40 | Code quality, minor deviations, dead code |
| **Total** | **147** | |

---

## CRITICAL Issues (21)

### Consensus — Nonce & Leader Election (5 CRITICAL)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| CON-C1 | consensus/nonce | **Nonce evolution uses raw VRF output instead of tagged derivation** | sync.py passes raw 64-byte `vrf_result[0]` to `evolve_nonce`. Spec requires `blake2b_256("N" \|\| beta)` (32-byte tagged nonce). The entire nonce chain is wrong. |
| CON-C2 | consensus/nonce | **UPDN rule wrong — eta_c updated past stability window** | On first block past stability window, eta_v is evolved then eta_c is set = eta_v, incorporating that block's nonce. Spec says eta_c should freeze BEFORE that block's update. |
| CON-C3 | consensus/nonce | **Epoch nonce misses extra_entropy and uses wrong anchor** | `tick_nonce` computes `hash(eta_c + anchor)` but spec requires `hash(eta_c + eta_h + eta_e)` — three inputs including previous epoch header hash and extra entropy. |
| CON-C4 | consensus/header | **Leader eligibility check (checkLeaderVal) never called** | VRF proofs are verified, but threshold comparison `vrf_value < 1-(1-f)^sigma` is never applied. Any registered pool can produce blocks in any slot. |
| CON-C5 | node/sync | **VRF+KES validation disabled in production sync** | `slots_per_kes_period=0` hardcoded; header validation errors silently caught with `except Exception: pass`. Node trusts peers completely. |

### Crypto — VRF (3 CRITICAL)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| CRY-C1 | crypto/vrf | **No small-order point rejection in VRF verify** | Identity point `[0,1]` and 7 other torsion points pass `_decode_point`. Attacker could forge VRF proofs using small-order public keys. |
| CRY-C2 | crypto/vrf | **No scalar range check on proof `s` value** | Decoded `s` from proof bytes could be >= ORDER, violating full-uniqueness property. Two distinct proofs could verify identically. |
| CRY-C3 | crypto/vrf | **Public key not checked for non-identity** | `vrf_verify` accepts identity point as public key, collapsing the verification equation. |

### Ledger Rules (5 CRITICAL)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| LR-C1 | rules/utxo | **Collateral check gated on `total_collateral is not None`** | Alonzo requires collateral ≥ fee×collateralPercent whenever scripts are present. Without `total_collateral` field set, the check is entirely skipped. |
| LR-C2 | rules/utxo | **Collateral minimum uses `min_fee` instead of `tx.fee`** | Spec says `balance ≥ txfee × collateralPercent / 100`. Using min_fee instead of the (higher) declared tx.fee is less strict. |
| LR-C3 | rules/certs | **Stake deregistration allows non-zero reward balance** | Spec requires `rewards[hk] == 0` before deregistration. Code just deletes the account, silently destroying unclaimed rewards. |
| LR-C4 | rules/utxo | **Byron addresses can pass as valid collateral addresses** | Bit-4 check (`addr[0] & 0x10`) is meaningful for types 0-7 but produces meaningless result for Byron header byte `0x80`. |
| LR-C5 | ledger/state | **Missing `deposited` pot** | No tracking of cumulative deposits. Preservation of value (`maxSupply = utxo + deposited + fees + treasury + reserves + rewards`) unverifiable. |

### Plutus (2 CRITICAL)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| PLU-C1 | plutus/script_context | **V1 TxInInfo uses V2 TxOut format (4 fields vs 3)** | `_txin_info_to_data` calls V2 `txout_to_data` for inputs. V1 scripts expect 3-field TxOut `(addr, value, maybe_datum_hash)`. Every V1 spending script breaks. |
| PLU-C2 | plutus/script_context | **V1/V2 Certifying ScriptPurpose includes integer index** | Spec: `Certifying = Constr(3, [DCert])`. Code: `Constr(3, [Integer, DCert])`. V1/V2 certifying scripts get wrong structure. |

### Network & Storage (3 CRITICAL)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| NET-C1 | storage/ledger_db | **Pickle deserialization = arbitrary code execution** | `pickle.loads()` on SQLite checkpoint data. SHA-256 integrity check is in same row — attacker who modifies data can update hash too. |
| NET-C2 | network/types | **Handshake proposes deprecated versions 11-12** | `NTN_VERSIONS = [11,12,13,14]` but v11/12 have different `nodeToNodeVersionData` format. Protocol desync if peer negotiates v11/12. |
| NET-C3 | node/server | **Server handshake does not validate peer network magic** | Mainnet node could connect to preprod server. Wrong-network blocks would be served. |

### Codec (1 CRITICAL)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| COD-C1 | codec/cbor | **Unbounded loop via crafted CBOR array count** | CBOR array declaring `count = 2^64` causes millions of iterations in `cbor_item_length`. Trivial DoS via single crafted payload. |

### Forging (2 CRITICAL — block production)

| # | Module | Issue | Detail |
|---|--------|-------|--------|
| FRG-C1 | node/forging | **Forged blocks have broken witness structure** | tx_cbor decoded as full transaction but put into tx_bodies; witnesses set to empty `{}`. Forged blocks fail validation on any peer. |
| FRG-C2 | node/forging | **Body hash calculation non-standard** | `blake2b_256(h1+h2+h3+h4)` doesn't match spec. Uses cbor2 re-encoding (loses deterministic encoding). |

---

## HIGH Issues (38)

### Ledger Rules

| # | Issue | Detail |
|---|-------|--------|
| LR-H1 | **No execution unit budget check** | `totExunits(tx) <= maxTxExUnits(pp)` missing entirely. Allows unbounded script execution budgets. |
| LR-H2 | **Min fee omits script execution fee component** | Alonzo: `minfee = a*txSize + b + txscriptfee(prices, exunits)`. Script fee component missing. |
| LR-H3 | **Missing certificate witness requirements** | No witness check for delegation, deregistration, pool retirement, pool owner sigs, collateral input keys. Anyone can submit certs for any credential. |
| LR-H4 | **No native script validation** | Multisig/timelock scripts are never evaluated. Multisig-locked UTxOs can be spent without satisfying conditions. |
| LR-H5 | **No bootstrap (Byron) witness handling** | Byron-era addresses can't be properly validated. Witness set key 2 never decoded. |
| LR-H6 | **Reference script fee uses linear model, not tiered** | Conway CIP requires exponential growth for large reference scripts. |
| LR-H7 | **No ADA minting check** | `adaID ∉ supp(mint(tx))` not enforced. Empty policy ID in mint map = ADA from nothing. |
| LR-H8 | **No minPoolCost validation** | Pool registration doesn't check `poolCost >= minPoolCost(pp)`. |
| LR-H9 | **No pool retirement epoch validation** | No check that `cepoch < e <= cepoch + emax`. Accepts retroactive or unbounded-future retirement. |

### Plutus

| # | Issue | Detail |
|---|-------|--------|
| PLU-H1 | **V3 ScriptInfo uses V1/V2 ScriptPurpose tags** | V3 constructor ordering differs (Spending=0, Minting=1 vs V1/V2 Minting=0, Spending=1). All V3 scripts get wrong tags. |
| PLU-H2 | **Reference scripts only collected from reference_inputs** | Spec: `refScripts(spendInputs ∪ refInputs)`. Missing scripts from spend inputs. |
| PLU-H3 | **Language views includes ALL cost models, not just tx-used** | Hash preimage includes extra languages → wrong script_data_hash. |
| PLU-H4 | **V3 TxCert uses raw CBOR cert type as Constr tag** | CBOR cert types don't match Plutus V3 TxCert constructor ordering. |
| PLU-H5 | **V3 SpendingScript purpose missing Maybe Datum field** | V3: `SpendingScript(TxOutRef, Maybe Datum)`. Code omits datum. |
| PLU-H6 | **Missing datum for V1/V2 spending = 2 args instead of 3** | When datum resolve fails, script called with (redeemer, context) only. |

### Consensus

| # | Issue | Detail |
|---|-------|--------|
| CON-H1 | **Opcert sequence gap = hard rejection** | Spec allows any `n >= m`. Code rejects `n > m+1`. Legitimate key rotations rejected. |
| CON-H2 | **Chain selection rollback depth always zero** | `depth = tip - min(tip, candidate_tip) = 0` when candidate > current. k-parameter check useless. |
| CON-H3 | **evolve_nonce double-hashes input** | Compounds with CON-C1 to produce completely wrong nonce chain. |
| CON-H4 | **Header body size and body hash not validated** | `bBodySize` and `bbodyhash` from header are never compared to actual block body. |
| CON-H5 | **tick_nonce resets evolving nonce to epoch nonce** | Spec: evolving nonce continues across epochs. Code resets it, breaking the nonce chain. |

### Crypto

| # | Issue | Detail |
|---|-------|--------|
| CRY-H1 | **Timing side channels in VRF scalar multiply** | `vrf_prove()` uses variable-time scalar multiply with secret scalar. Timing leaks secret key. |
| CRY-H2 | **Ed25519 verify catches only BadSignatureError** | Malformed key → unhandled ValueError/TypeError → crash in validation pipeline → DoS. |
| CRY-H3 | **KES key erasure not cryptographically secure** | Python GC doesn't zero old bytes objects. Forward-security guarantee undermined. |
| CRY-H4 | **No cross-validation against known mainnet VRF vectors** | All VRF tests are self-referential. Could silently diverge from Cardano network. |

### Network & Node

| # | Issue | Detail |
|---|-------|--------|
| NET-H1 | **recv_message hangs forever on closed connection** | When mux closes, ProtocolBuffer waits on event that never fires (or waits full timeout). Zombie connections. |
| NET-H2 | **Rollback loads latest checkpoint, not best before rollback slot** | If latest checkpoint is past rollback point, state isn't properly reverted. |
| NET-H3 | **TxSubmission protocol direction inverted** | Client sends server-agency messages (MsgRequestTxIds/MsgRequestTxs). Protocol completely broken. |
| NET-H4 | **Server has no connection limit** | `max_inbound_connections=20` exists but never enforced. Trivial DoS via thousands of connections. |
| NET-H5 | **No timeout on server protocol loops** | Attacker holds connection forever by sending one message every 299s. |
| NET-H6 | **VolatileDB: one hash per slot loses blocks on fork** | `_by_slot: dict[int, bytes]` overwrites. Fork rollback permanently loses original block. |
| NET-H7 | **Metrics HTTP server: no request validation** | Binds 0.0.0.0, no method/path check, no header size limit. |

### Codec

| # | Issue | Detail |
|---|-------|--------|
| COD-H1 | **Quadratic memory from data[pos:] slicing** | cbor_item_length and _walk_array_items copy remaining buffer on each recursive call. O(N × len) byte copies. |
| COD-H2 | **Empty sets/maps accepted for NonEmpty fields** | Conway requires certificates, withdrawals, mint, collateral etc. to be non-empty when present. Consensus divergence. |
| COD-H3 | **Block element count check is `< 4` not `== 5`** | Accepts 4-element blocks (missing invalid_txs) and ignores extra elements. |
| COD-H4 | **tx_bodies/witnesses count mismatch not checked** | Different array lengths accepted at decode time → index errors later. |

### Ledger Core

| # | Issue | Detail |
|---|-------|--------|
| LC-H1 | **Block slot non-strict-increase accepted** | `>=` instead of `>`. Same-slot block replay accepted. |
| LC-H2 | **Reference input/spend input disjointness check rejects valid txs** | Babbage spec does NOT require disjointness. This falsely rejects CIP-31 transactions. |

### Rewards

| # | Issue | Detail |
|---|-------|--------|
| RW-H1 | **Pool stake uses current delegation with snapshot amounts** | Should use frozen snapshot delegations, not current `state.accounts[cred].pool`. |
| RW-H2 | **Owner stake ignores UTxO-based stake** | Only counts `deposit + rewards`, missing base address UTxO. Under-counts for pledge check. |
| RW-H3 | **Fee snapshot captured after rewards drain fee pot** | `_fee_ss` set after `apply_reward_update` zeroes fees. Next epoch's reward pot gets wrong fee input. |
| RW-H4 | **Governance: vote counting instead of stake-weighted voting** | Simple head-count majority across all groups. No per-action thresholds, no stake weighting. Single DRep YES vote ratifies anything. |

---

## MEDIUM Issues (48)

### Ledger Rules (10)
- Collateral return output not checked for min UTxO or max value size
- Missing per-output/per-withdrawal address network ID check
- Minting policy scripts not verified (silent `pass`)
- Script data hash: language views include ALL languages, not just tx-used; empty datums use `b""` not `0x80`
- `_value_cbor_size` re-encodes via cbor2 (may differ from original)
- Withdrawal from unregistered account silently passes
- Bootstrap output attributes size check missing
- Silent accept of delegation for unregistered credentials
- DRep re-registration overwrites existing deposit
- Duplicate DRep registration allowed

### Plutus (5)
- `map_data()` uses `dict()` losing duplicate keys
- V3 empty mint uses `value_to_data(0)` instead of empty map
- Slot-to-POSIX hardcodes mainnet parameters; V2 never passes era_history
- Byron addresses return dummy data instead of Nothing
- Proposal procedure field ordering unverified

### Consensus (7)
- HFC defaults unknown era tags to Conway instead of rejecting
- `compute_intersect_points` assumes VolatileDB sorted by slot
- `leader_threshold` float precision issues at boundary
- Missing protocol version check (MaxMajorPV)
- NonceState defaults assume mainnet
- Epoch calculation uses simple division (ignores Byron epoch length)
- `_leader_threshold_exact` Fraction conversion may lose precision

### Rewards & Epoch (10)
- Streaming snapshot parser skips nesBprev blocks and stake distributions
- Governance param keys 9,10,11 (monetary/treasury expansion, pledge influence) missing from `_PARAM_KEY_MAP`
- No voter eligibility validation
- Treasury withdrawal doesn't check total sum
- Rational parameter values not converted during governance updates
- No fPoolParams (future pool params) processing at epoch boundary
- Unknown governance action types auto-ratified as InfoAction
- Enacted proposal deposit lost when credential not in accounts
- Pre-filtering unregistered credentials during reward computation (Babbage errata)
- Pool owners not tracked (single-operator approximation)

### Codec (14)
- Duplicate map keys accepted silently
- No decode-stack depth limit in schema
- MAX_BLOCK_SIZE 55x higher than protocol limit
- `inputs: set` loses type information
- vrf_result, protocol_version, OperationalCert fields unvalidated structure
- issuer_vkey, vrf_vkey, block_body_hash, prev_hash no size validation
- Byron block hash computation wrong
- invalid_txs indices not bounds-checked
- tx_hash, auxiliary_data_hash, script_data_hash no size validation
- Duplicate CBOR head parsing logic

### Ledger Core (8)
- `lovelace_per_utxo_byte` derivation may be wrong
- Fragile pool operator parsing in deposit calc
- UTxO hash ignores output values
- Phase-2 silently skipped when cost_models empty
- Block body size may be off by header bytes
- Certificate/UTxO ordering causes deposit calc issues
- Withdrawal applies without checking declared amount
- No guard against negative asset quantities in outputs

### Network & Node (12)
- Handshake size limit not enforced
- ChainSync: no state machine transition tracking
- BlockFetch: no limit on blocks per batch
- `_sync_session` uses `locals().get()` for cleanup
- ImmutableDB single-writer bottleneck
- `config.py` loads arbitrary keys via `setattr`
- Mempool FIFO eviction punishes honest submitters
- Peer scoring can go infinitely negative
- Server `_find_intersect` always matches origin
- Forging KES period hardcoded
- No mempool re-validation on new block
- Block serving has no rate limiting

### Crypto (4)
- VRF hash_to_curve edge case when r=0
- VRF hash_points uses module-level suite string instead of parameter
- KES keygen uses simple concatenation instead of proper KDF
- Leader value comparison uses Decimal without explicit error analysis

---

## LOW Issues (40)

*(Omitted for brevity — includes: code quality, dead code, minor type safety, documentation, unused imports, pickle backward-compat complexity, missing pointer address stake, Prometheus counter reset, missing `writer.wait_closed()`, etc.)*

---

## Priority Fix Order

### Tier 1 — Consensus & Security (blocks 1-2 weeks)
These are "the node is wrong on-chain" or "attacker can exploit" issues.

1. **CON-C1..C5 + H3,H5**: Fix entire nonce evolution pipeline (tagged VRF input, UPDN rule, tick_nonce, stability window, no reset)
2. **CON-C4**: Wire `verify_slot_leader()` into header validation
3. **CRY-C1..C3**: Add small-order rejection + scalar range check in VRF
4. **LR-C3**: Require zero rewards before stake deregistration
5. **LR-H7**: Add ADA minting prohibition check
6. **LR-H3**: Add certificate/pool-owner/collateral witness requirements
7. **LR-C1,C2**: Fix collateral validation (always check when scripts present, use tx.fee)
8. **NET-C1**: Replace pickle with safe serialization (CBOR/JSON)

### Tier 2 — Spec Compliance (blocks 2-3 weeks)
Missing ledger rules that cause spec divergence.

9. **LR-H1,H2**: Add execution unit budget check + script fee in min_fee
10. **LR-H4**: Implement native script validation
11. **PLU-C1,C2,H1..H6**: Fix all V1/V2/V3 script context issues (TxOut format, ScriptPurpose tags, TxCert tags, reference scripts)
12. **CON-H4**: Validate body size and body hash from header
13. **COD-H2,H3,H4**: Fix block/tx structure validation (element count, NonEmpty, body/witness alignment)
14. **LC-H2**: Remove false disjointness check on reference inputs
15. **RW-H1..H3**: Fix reward pipeline (snapshot delegations, UTxO stake, fee snapshot timing)

### Tier 3 — Hardening & Network (blocks 3-4 weeks)
DoS prevention and protocol correctness.

16. **COD-C1,H1**: Fix CBOR parsing (count guard, offset-based walking)
17. **NET-C2,C3**: Fix handshake (remove v11/12, validate magic on server)
18. **NET-H3**: Fix TxSubmission protocol direction
19. **NET-H4,H5**: Add connection limits and idle timeouts
20. **CRY-H2**: Broaden Ed25519 exception handling
21. **RW-H4**: Implement stake-weighted governance voting

### Tier 4 — Polish (ongoing)
Correctness improvements, simplification, remaining MEDIUM/LOW items.

22. Fix remaining MEDIUM items (per-output network ID, bootstrap witnesses, governance params, etc.)
23. Remove overengineering (dead SnapshotRotation code, pickle compat, duplicate CBOR parsing)
24. Add golden test vectors from mainnet/preprod for VRF, KES, nonce chain
25. Implement missing governance enactment (NoConfidence, UpdateCommittee, NewConstitution, HardFork)

---

## Positive Findings

The audit also confirmed significant areas of correctness:

- **Block/header/tx hashing**: All match Amaru reference (blake2b_256 of original bytes)
- **VRF suite string**: Correctly `0x03` (draft-03)
- **VRF cofactor handling**: Correct (cofactor multiply on Gamma before hash)
- **VRF tagged output**: Correct (`blake2b_256("L"|"N" + beta)`)
- **KES Sum6KES verification**: Validated against Amaru golden vector
- **Block body hash**: Correctly `blake2b_256(H(tx) || H(wit) || H(aux) || H(inv))`
- **Reward formula**: Correct maxPool/desirability with sigma/sigma_a after 8-bug fix pass
- **Full preprod sync**: 1.5M blocks, 106 epochs, ADA conservation verified to 0.000036%
- **CBOR schema library**: Elegant byte-walking preserves original bytes for hashing
- **Value arithmetic**: Correct multi-asset add/sub/geq with clean-up of zero entries

---
---
# Call Flows

Every function call in the main sync path, traced from CLI entry to disk write.
Shows exact arguments, return values, and where each call happens.

---

## 1. Entry Point: CLI → live_sync

```
User runs: python -m bluematter sync --network preprod --snapshot snap.cbor --genesis-dir ./genesis

main()                                          # cli.py:19
  parser.parse_args() → args
  _cmd_sync(args)                               # cli.py:67
    magic = PREPROD_MAGIC (1)                    # types.py:69
    host = "preprod-node.world.dev.cardano.org"
    port = 30000
    loop.run_until_complete(
      live_sync(                                 # sync.py:56
        peer_host="preprod-node...",
        peer_port=30000,
        network_magic=1,
        snapshot_path="snap.cbor",
        genesis_dir="./genesis",
        max_blocks=None,
        checkpoint_interval=50,
        data_dir=None,
      )
    )
```

## 2. State Bootstrap: live_sync()

```
live_sync()                                      # sync.py:56
  │
  ├── ImmutableDB(path)                          # immutable.py -  SQLite append-only store
  ├── LedgerDB(path)                             # ledger_db.py -  HMAC-authenticated checkpoints
  ├── VolatileDB()                               # volatile.py -  in-memory recent blocks
  ├── NonceState()                               # nonce.py:25 -  epoch_nonce, evolving, candidate
  │
  ├── # Priority 1: Crash recovery
  │   ledger_db.load_latest_checkpoint()         # ledger_db.py:130
  │     → (LedgerState, slot) or None
  │     # Reads SQLite: SELECT data, data_hash FROM checkpoints ORDER BY slot DESC LIMIT 1
  │     # _verify_and_load(data, hash) checks HMAC-SHA256 with node-local key
  │     # pickle.loads(data) → LedgerState
  │
  ├── # Priority 2: Snapshot import
  │   load_snapshot(snapshot_path)               # snapshot.py:27
  │     → LedgerState
  │     # Reads Amaru-format NewEpochState CBOR (.cbor or .cbor.gz)
  │     # Extracts: epoch, treasury, reserves, fees, pools, accounts, UTxO
  │     # Parses UMap: [StrictMaybe<(rewards,deposit)>, ptrs, StrictMaybe<pool>, StrictMaybe<DRep>]
  │     # Parses pool params: operator, vrf, pledge, cost, margin, reward_acct, owners
  │
  ├── # Priority 3: Empty state
  │   LedgerState()                              # state.py:60 -  empty UTxO, zero pots
  │
  ├── # Load protocol params from genesis
  │   parse_protocol_params(                     # protocol_params.py:71
  │     shelley="./genesis/shelley-genesis.json",
  │     alonzo="./genesis/alonzo-genesis.json",
  │     conway="./genesis/conway-genesis.json",
  │   ) → ProtocolParameters
  │   # Merges 3 genesis files into one dataclass:
  │   #   Shelley: min_fee_a, min_fee_b, max_tx_size, stake_pool_deposit, ...
  │   #   Alonzo: lovelace_per_utxo_byte, cost_models, price_mem, price_step, ...
  │   #   Conway: pool_voting_thresholds, drep_deposit, gov_action_lifetime, ...
  │
  └── # Reconnect loop (up to 100 retries, exponential backoff 1s→60s)
      SyncSession(...).run()                     # sync_session.py:159
```

## 3. TCP Connect + Handshake

```
SyncSession.run()                                # sync_session.py:159
  │
  ├── asyncio.open_connection(host, port)        # TCP connect, 15s timeout
  │     → (reader: StreamReader, writer: StreamWriter)
  │
  ├── Multiplexer(reader, writer, is_initiator=True)  # mux.py:126
  │   # Creates the mux layer that frames all mini-protocols
  │   # 8-byte header: [timestamp:4][mode+proto_id:2][length:2]
  │
  ├── ProtocolBuffer() × 4                       # mux.py:44 -  one per mini-protocol
  │   mux.register_protocol(PROTO_HANDSHAKE, hs_buf)   # proto_id = 0
  │   mux.register_protocol(PROTO_CHAIN_SYNC, cs_buf)  # proto_id = 2
  │   mux.register_protocol(PROTO_BLOCK_FETCH, bf_buf)  # proto_id = 3
  │   mux.register_protocol(PROTO_KEEP_ALIVE, ka_buf)   # proto_id = 8
  │
  ├── read_task = asyncio.create_task(mux.read_loop())  # mux.py:155
  │   # Background task: reads 8-byte headers from TCP, routes payload to correct ProtocolBuffer
  │   # Loop: read_header → extract proto_id → read payload → buffer.append(payload)
  │   #   ProtocolBuffer reassembles CBOR: uses cbor_item_length to detect complete messages
  │
  └── perform_handshake(                         # handshake.py:24
        mux,                                     # Multiplexer to send/recv on
        hs_buf,                                  # ProtocolBuffer for handshake proto
        network_magic=1,                         # preprod
        timeout=10.0,
      ) → version: int (13 or 14)
      │
      ├── # Build proposal: {13: [1, False, 0, False], 14: [1, False, 0, False]}
      │   #   [magic, initiator_only, peer_sharing, query]
      │   mux.send(PROTO_HANDSHAKE, cbor2.dumps([0, version_table]))
      │   # Sends MsgProposeVersions through the mux
      │
      ├── hs_buf.recv_message(timeout=10.0)      # mux.py:74
      │   # Waits for complete CBOR message on handshake buffer
      │   # Returns raw bytes of MsgAcceptVersion or MsgRefuse
      │
      └── # Parse reply:
          #   [1, 14, [1, False, 0, False]] → MsgAcceptVersion, version=14
          #   Verify version in NTN_VERSIONS [13, 14]
          #   Verify peer_magic == our magic (1)
          #   Return 14
```

## 4. ChainSync: Find Intersection

```
SyncSession.run() continued                      # sync_session.py:199
  │
  ├── # If we have a known slot/hash (from checkpoint):
  │   intersect_points = [[slot, hash], []]      # Specific point + origin fallback
  │
  ├── # If no known point -  discover tip first:
  │   mux.send(PROTO_CHAIN_SYNC, cbor2.dumps([4, [[]]]))  # MsgFindIntersect with origin
  │   reply = cbor2.loads(cs_buf.recv_message(timeout=15.0))
  │   # reply[0]==5 → MsgIntersectFound: tip = reply[2]
  │   # reply[0]==6 → MsgIntersectNotFound: tip = reply[1]
  │   # tip = [[slot, hash], block_number]
  │   intersect_points = [[tip_slot, tip_hash], []]
  │
  └── mux.send(PROTO_CHAIN_SYNC, cbor2.dumps([4, intersect_points]))
      # MsgFindIntersect: "I know block at (slot, hash), start from there"
      reply = cbor2.loads(cs_buf.recv_message())
      # IntersectFound (tag 5) → we share this point, sync starts here
      # IntersectNotFound (tag 6) → peer doesn't have this block
```

## 5. Main Sync Loop (per block)

```
while blocks_synced < max_blocks:                # sync_session.py:243
  │
  │ ┌─────────── STEP 1: Request Next Header ───────────┐
  │ │                                                     │
  │ │  mux.send(PROTO_CHAIN_SYNC, cbor2.dumps([0]))      │
  │ │  # MsgRequestNext: "give me the next header"       │
  │ │                                                     │
  │ │  raw = cs_buf.recv_message(timeout=120.0)           │
  │ │  msg = cbor2.loads(raw)                             │
  │ │                                                     │
  │ │  msg[0] == 1 → MsgAwaitReply: at tip, wait...      │
  │ │  msg[0] == 3 → MsgRollBackward: handle rollback    │
  │ │  msg[0] == 2 → MsgRollForward:                     │
  │ │    header_data = msg[1]  # [era_tag, #6.24(cbor)]  │
  │ │    tip_data = msg[2]     # [[slot, hash], block_no] │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 2: Decode Header ─────────────────┐
  │ │                                                     │
  │ │  _decode_header_point(header_data)                  │
  │ │    # sync_session.py:51                             │
  │ │    # header_data = [6, #6.24(header_cbor)]          │
  │ │    # era_tag = 6 (Conway)                           │
  │ │    # Extract raw header bytes from tag-24 wrapper   │
  │ │    # block_hash = blake2b_256(header_raw)           │
  │ │    # ConwayHeader.from_cbor(header_raw)             │
  │ │    #   → hdr.header_body.slot                       │
  │ │    → (slot, block_hash, era_tag=6)                  │
  │ │                                                     │
  │ │  Skip if era_tag != 6 (non-Conway)                  │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 3: Fetch Block Body ──────────────┐
  │ │                                                     │
  │ │  bf = BlockFetchClient(mux, bf_buf)                 │
  │ │  bf.fetch_range(                                    │
  │ │    start=Point(slot, block_hash),                   │
  │ │    end=Point(slot, block_hash),  # same = 1 block   │
  │ │  ) → list[bytes]                 # blockfetch.py:38 │
  │ │                                                     │
  │ │  # Sends MsgRequestRange [0, [slot, hash], [slot, hash]]
  │ │  # Receives MsgStartBatch [2]                       │
  │ │  # Loop: MsgBlock [3, #6.24(block_cbor)] → extract  │
  │ │  # Until: MsgBatchDone [4]                          │
  │ │  # Returns [block_bytes, ...]                       │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 4: Decode Block ──────────────────┐
  │ │                                                     │
  │ │  decode_block_from_wire(block_bytes)                 │
  │ │    # block.py:179                                   │
  │ │    # Unwrap mux tag-24 wrapper                      │
  │ │    # CBOR decode outer: [era_tag, block_cbor]       │
  │ │    # era_tag=7 → Conway                             │
  │ │    # decode_block(block_cbor)                       │
  │ │    #   _walk_array_items(block_cbor) → 5 items      │
  │ │    #   ConwayHeader.from_cbor(items[0])             │
  │ │    #   _walk_array_items(items[1]) → tx bodies      │
  │ │    #   ConwayTxBody.from_cbor(body) per tx          │
  │ │    #   tx_witnesses_raw = items[2] slices           │
  │ │    #   auxiliary_data_raw = items[3]                 │
  │ │    #   invalid_txs from items[4]                    │
  │ │    → ConwayBlock                                    │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 5: Header Validation ─────────────┐
  │ │                                                     │
  │ │  validate_header(                                   │
  │ │    block.header,                # ConwayHeader      │
  │ │    prev_hash=volatile_tip.hash, # from VolatileDB   │
  │ │    prev_slot=state.slot,        # from LedgerState  │
  │ │    prev_block_number=tip.block_number,              │
  │ │    slots_per_kes_period=0,      # skip KES for now  │
  │ │  ) → list[str]  # errors        # header.py:33     │
  │ │                                                     │
  │ │  Checks (when params provided):                     │
  │ │  1. slot > prev_slot                                │
  │ │  2. block_number == prev + 1                        │
  │ │  3. prev_hash matches                               │
  │ │  4. VRF proof verifies (vrf_verify)                 │
  │ │  5. Leader eligible (vrf_value < threshold)         │
  │ │  6. KES signature valid (kes_verify)                │
  │ │  7. Opcert valid (ed25519 verify)                   │
  │ │  8. Body size matches header claim                  │
  │ │  9. Body hash matches header claim                  │
  │ │  10. Protocol version <= max                        │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 6: Apply Block ───────────────────┐
  │ │                                                     │
  │ │  Runs in executor (not blocking asyncio):           │
  │ │  loop.run_in_executor(None, apply_block, state, block)
  │ │  → LedgerState                   # block.py:25     │
  │ │                                                     │
  │ │  See DETAILED FLOW in Section 6 below               │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 7: Store ─────────────────────────┐
  │ │                                                     │
  │ │  volatile_db.add(VolatileBlock(                     │
  │ │    slot, block_number, block_hash, prev_hash, raw   │
  │ │  ))                              # volatile.py:48   │
  │ │  # _by_hash[block_hash] = block                     │
  │ │  # _by_slot[slot].append(block_hash)                │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 8: Nonce Evolution ───────────────┐
  │ │                                                     │
  │ │  vrf_output = block.header.header_body.vrf_result[0]│
  │ │  # Raw 64-byte VRF beta from wire                   │
  │ │                                                     │
  │ │  vrf_nonce = tagged_nonce_from_vrf_output(vrf_output)
  │ │  # nonce.py:49                                      │
  │ │  # blake2b_256(b"N" + raw_64_bytes) → 32 bytes     │
  │ │                                                     │
  │ │  update_nonce_for_block(                            │
  │ │    nonce_state,     # NonceState                    │
  │ │    vrf_nonce,       # 32-byte tagged nonce          │
  │ │    block.slot,      # current slot                  │
  │ │    state.epoch,     # current epoch                 │
  │ │  )                               # nonce.py:118    │
  │ │  # new_eta_v = evolve_nonce(eta_v, vrf_nonce)       │
  │ │  #   = blake2b_256(eta_v + blake2b_256(vrf_nonce))  │
  │ │  # state.evolving_nonce = new_eta_v                 │
  │ │  # if before stability window:                      │
  │ │  #   state.candidate_nonce = new_eta_v              │
  │ └─────────────────────────────────────────────────────┘
  │
  │ ┌─────────── STEP 9: Graduate + Checkpoint ─────────┐
  │ │                                                     │
  │ │  # Graduate old volatile blocks to immutable        │
  │ │  if volatile_db.count() > 100:                      │
  │ │    volatile_db.graduate(cutoff_slot)                 │
  │ │    # Returns blocks older than cutoff               │
  │ │    # Removes from _by_hash and _by_slot             │
  │ │    for g in graduated:                              │
  │ │      immutable_db.append(slot, block_no, hash, raw) │
  │ │      # INSERT INTO blocks (slot, block_number,      │
  │ │      #   block_hash, raw) VALUES (?,?,?,?)          │
  │ │                                                     │
  │ │  # Periodic checkpoint                              │
  │ │  if blocks_synced % 50 == 0:                        │
  │ │    ledger_db.save_checkpoint(state)                  │
  │ │    # pickle.dumps(state) → data                     │
  │ │    # _hmac_sign(data) → hmac_hex                    │
  │ │    # INSERT INTO checkpoints (slot, data, data_hash)│
  │ └─────────────────────────────────────────────────────┘
```

## 6. apply_block() - Internal Flow

```
apply_block(state, block)                        # block.py:25
  │
  ├── # Strict slot check
  │   if block.slot <= state.slot and state.slot > 0:
  │     raise BlockValidationError(...)
  │
  ├── # TICK: epoch boundary transition
  │   tick(state, block.slot)                    # epoch.py:31
  │   │
  │   │  new_epoch = slot // epoch_length
  │   │  if new_epoch > state.epoch:
  │   │    _apply_epoch_transition(state, new_epoch)  # epoch.py:42
  │   │    │
  │   │    ├── new_fee_ss = state.pots.fees      # Capture BEFORE rewards
  │   │    │
  │   │    ├── _apply_rewards(state)             # epoch.py:119
  │   │    │   compute_reward_update(state, blocks, active_stake) → RewardUpdate
  │   │    │     # rewards.py:83
  │   │    │     # eta = sum(blocks_made) / expected_blocks
  │   │    │     # delta_r1 = floor(reserves * rho) -  monetary expansion
  │   │    │     # rewardPot = fees + delta_r1
  │   │    │     # delta_t1 = floor(tau * rewardPot) -  treasury cut
  │   │    │     # R = rewardPot - delta_t1 -  distributable rewards
  │   │    │     # For each pool:
  │   │    │     #   _reward_one_pool(pp, R, pool, state, circulation, active_stake)
  │   │    │     #     maxPool = (R / (1 + a0)) * (sigma + s*a0*((sigma - s*(z-sigma)/z) / z))
  │   │    │     #     appPerf = beta / sigma_a  (if d < 0.8, else 1)
  │   │    │     #     pool_R = min(maxPool, maxPool * appPerf)
  │   │    │     #     r_operator = pool_R * (cost + margin * (pool_R - cost))
  │   │    │     #     r_member = pool_R * (1 - margin) * member_stake / pool_stake
  │   │    │   apply_reward_update(state, update)
  │   │    │     # For each (cred, amount) in rewards:
  │   │    │     #   state.accounts[cred].rewards += amount
  │   │    │     # state.pots.treasury += delta_treasury
  │   │    │     # state.pots.reserves += delta_reserves
  │   │    │
  │   │    ├── _rotate_snapshots(state)          # SnapshotRotation for leader schedule
  │   │    │
  │   │    ├── _retire_pools(state, new_epoch)   # epoch.py:223
  │   │    │   # For each pool where retiring_epoch <= new_epoch:
  │   │    │   #   refund deposit to reward account
  │   │    │   #   remove pool from state.pools
  │   │    │   #   clear delegations pointing to this pool
  │   │    │
  │   │    ├── _enact_governance(state, new_epoch)  # epoch.py:188
  │   │    │   # For each ratified proposal:
  │   │    │   #   _enact_parameter_change / _enact_treasury_withdrawals / etc.
  │   │    │   # Expire old proposals (epoch > expires_epoch)
  │   │    │
  │   │    ├── # Rotate block counts: blocks_made → _prev → _go
  │   │    ├── state._fee_ss = new_fee_ss        # Fee snapshot for next epoch
  │   │    ├── state.pots.fees = 0               # Reset fee pot
  │   │    ├── # Rotate stake dists: _mark → _set → _go
  │   │    └── state.epoch = new_epoch
  │
  ├── # BBODY: process each transaction
  │   pp = state.protocol_params
  │   invalid_set = set(block.invalid_txs)       # Indices of phase-2-failed txs
  │   aux_data_map = _parse_auxiliary_data_map(block.auxiliary_data_raw)
  │
  │   for idx, tx in enumerate(block.transactions):
  │     │
  │     ├── if idx in invalid_set:
  │     │     # Phase-2 failed transaction -  consume collateral only
  │     │     _apply_invalid_tx(state, block, idx)     # block.py:228
  │     │       # Delete collateral inputs from UTxO
  │     │       # Add collateral_return output to UTxO
  │     │       # Collect total_collateral (or net) as fees
  │     │
  │     └── else:  # Valid transaction
  │           │
  │           ├── _validate_tx(state, pp, tx, slot, witnesses_raw, idx, aux)
  │           │     # block.py:185
  │           │     │
  │           │     ├── validate_utxo(pp, state, tx, slot)  # utxo.py:28
  │           │     │     → list[str] errors
  │           │     │     # 19 checks:
  │           │     │     #  1. Inputs non-empty
  │           │     │     #  2. All inputs exist in UTxO
  │           │     │     #  3. Fee >= 0
  │           │     │     #  4. min_fee = pp.a * tx_size + pp.b + script_fee + ref_script_fee
  │           │     │     #  5. Fee >= min_fee
  │           │     │     #  6. Value conservation: consumed == produced
  │           │     │     #     consumed = inputs + withdrawals + mint
  │           │     │     #     produced = outputs + fee + deposits + treasury + donation
  │           │     │     #  7. ExUnit budget <= maxTxExUnits
  │           │     │     #  8. ADA minting prohibited (empty policy ID)
  │           │     │     #  9. TTL check (slot <= ttl)
  │           │     │     # 10. Validity start (slot >= validity_start)
  │           │     │     # 11. Output min UTxO value
  │           │     │     # 12. Output max value size
  │           │     │     # 13. Max tx size
  │           │     │     # 14. Per-output network ID matches state
  │           │     │     # 15. Collateral return min UTxO + max value size
  │           │     │     # 16. Reference inputs exist in UTxO
  │           │     │     # 17. Collateral address checks (VKey, not Byron/script)
  │           │     │     # 18. Collateral balance >= fee * collateralPercent / 100
  │           │     │     # 19. Withdrawal amounts match account balances
  │           │     │
  │           │     └── validate_witnesses(pp, state, tx, witnesses_raw, slot, aux)
  │           │           # utxow.py:34
  │           │           → list[str] errors
  │           │           │
  │           │           ├── decode_witnesses(witnesses_raw[idx])  # utxow.py:148
  │           │           │     # CBOR map: {0: vkey_witnesses, 1: native_scripts,
  │           │           │     #            3: plutusV1, 4: datums, 5: redeemers,
  │           │           │     #            6: plutusV2, 7: plutusV3}
  │           │           │     → dict[int, object]
  │           │           │
  │           │           ├── required_key_hashes(tx, state.utxo)  # utxow.py:172
  │           │           │     # Collects ALL key hashes that must sign:
  │           │           │     # 1. Payment credentials from each input's address
  │           │           │     # 2. Staking credentials from each withdrawal
  │           │           │     # 3. required_signers from tx body (key 14)
  │           │           │     # 4. Certificate witnesses (deleg, retire, pool owner)
  │           │           │     # 5. Collateral input payment credentials
  │           │           │     → set[bytes]
  │           │           │
  │           │           ├── # For each vkey_witness [vkey, signature]:
  │           │           │     ed25519.verify(vkey, signature, tx_body_hash)
  │           │           │     # crypto/ed25519.py:5
  │           │           │     # nacl.signing.VerifyKey(vkey).verify(body_hash, sig)
  │           │           │     # catch Exception → False
  │           │           │
  │           │           ├── # Check: provided_key_hashes ⊇ required_key_hashes
  │           │           │
  │           │           ├── # Script data hash verification:
  │           │           │     _validate_script_data_hash(tx, witnesses, pp)
  │           │           │     # Recompute: blake2b_256(redeemers || datums || language_views)
  │           │           │     # Compare against tx.script_data_hash (key 11)
  │           │           │
  │           │           └── # Auxiliary data hash:
  │           │                 blake2b_256(aux_data_raw) == tx.auxiliary_data_hash
  │           │
  │           ├── _validate_phase2(state, pp, tx, slot, witnesses_raw, idx, is_valid=True)
  │           │     # block.py:275
  │           │     │
  │           │     └── eval_scripts(tx, witnesses, utxo, slot, pp, is_valid)
  │           │           # evaluate.py:43
  │           │           │
  │           │           ├── _decode_redeemers(witnesses[5])  # evaluate.py:177
  │           │           │     → {(tag, index): (data_cbor, mem, steps)}
  │           │           │     # tag: 0=SPEND, 1=MINT, 2=CERT, 3=REWARD
  │           │           │
  │           │           ├── _collect_scripts(witnesses)  # Both witness + reference
  │           │           │   + _collect_reference_scripts(tx, utxo)
  │           │           │     → {script_hash: (version, flat_bytes)}
  │           │           │
  │           │           ├── For each (tag, index) in redeemers:
  │           │           │     │
  │           │           │     ├── _resolve_script_hash(tag, index, ...) → hash
  │           │           │     │     # Determines WHICH script to run:
  │           │           │     │     #   SPEND → script_hash from input's address
  │           │           │     │     #   MINT  → policy_id from sorted minting policies
  │           │           │     │     #   CERT  → credential hash from certificate
  │           │           │     │     #   REWARD → credential hash from withdrawal
  │           │           │     │
  │           │           │     ├── _build_purpose(tag, index, ..., plutus_version)
  │           │           │     │     # V1/V2: ScriptPurpose (Minting=0, Spending=1, ...)
  │           │           │     │     # V3: ScriptInfo (Spending=0, Minting=1, ...)
  │           │           │     │
  │           │           │     ├── _get_tx_info(version)
  │           │           │     │     # Lazy-builds TxInfo (cached per version):
  │           │           │     │     # V1: build_tx_info_v1() -  10 fields, 3-field TxOut
  │           │           │     │     # V2: build_tx_info_v2() -  12 fields, 4-field TxOut
  │           │           │     │     # V3: build_tx_info_v3() -  16 fields, governance
  │           │           │     │
  │           │           │     ├── # Build args:
  │           │           │     │   V1/V2 SPEND: [datum, redeemer, ScriptContext]
  │           │           │     │   V1/V2 MINT:  [redeemer, ScriptContext]
  │           │           │     │   V3 (all):    [ScriptContext(TxInfo, Redeemer, ScriptInfo)]
  │           │           │     │
  │           │           │     └── _run_script(flat_bytes, args, version, mem, steps, pp)
  │           │           │           # evaluate.py:392
  │           │           │           # unflatten(flat_bytes) → Program
  │           │           │           # Apply args: Apply(f=term, x=arg) for each arg
  │           │           │           # Machine(Budget(steps, mem), cek_cost_model(), builtin_cost_model())
  │           │           │           # result = machine.eval(applied_term)
  │           │           │           # Success if result.result is not RuntimeError
  │           │           │
  │           │           └── # Cross-check: is_valid must match actual outcomes
  │           │
  │           └── apply_tx(state, tx, pp)        # apply.py:37
  │                 │
  │                 ├── process_certificates(state, tx.certificates, pp)
  │                 │     # certs.py:35
  │                 │     # For each [cert_type, ...]:
  │                 │     #   0: _stake_reg → state.accounts[cred] = Account(deposit=pp.stake_cred_deposit)
  │                 │     #   1: _stake_unreg → del state.accounts[cred] (if rewards==0)
  │                 │     #   2: _stake_deleg → state.accounts[cred].pool = pool_id
  │                 │     #   3: _pool_reg → state.pools[operator] = PoolParams(...)
  │                 │     #   4: _pool_retire → pool.retiring_epoch = epoch
  │                 │     #   7-8: Conway reg/unreg with explicit deposit
  │                 │     #   9-13: Conway delegation combos
  │                 │     #   14-18: DRep/committee certs
  │                 │
  │                 ├── process_voting_procedures(gov_state, tx.voting_procedures)
  │                 ├── process_proposal_procedures(gov_state, tx.proposals, ...)
  │                 │
  │                 ├── # Remove consumed inputs
  │                 │   for inp in tx.inputs:
  │                 │     key = input_key(inp) → (tx_hash, output_index)
  │                 │     del state.utxo[key]
  │                 │
  │                 ├── # Add new outputs
  │                 │   for idx, output in enumerate(tx.outputs):
  │                 │     state.utxo[(tx.tx_id, idx)] = output
  │                 │
  │                 ├── state.pots.fees += tx.fee
  │                 │
  │                 └── # Debit withdrawals
  │                     for addr, amount in tx.withdrawals:
  │                       cred = addr[1:29]
  │                       state.accounts[cred].rewards = 0
  │
  ├── state.slot = block.slot
  │
  └── # Track block production
      pool_id = blake2b_224(block.header.header_body.issuer_vkey)
      state.blocks_made[pool_id] += 1
```

## 7. Rollback Flow

```
ChainSync sends MsgRollBackward [3, [rb_slot, rb_hash], tip]:
  │
  ├── volatile_db.get_blocks_in_range(0, rb_slot)  → blocks to replay
  │
  ├── volatile_db.rollback_to(rb_slot)              # Remove blocks after rb_slot
  │
  ├── ledger_db.load_checkpoint_before(rb_slot)     # ledger_db.py:149
  │     → (LedgerState, checkpoint_slot)
  │     # SQL: SELECT ... WHERE slot <= ? ORDER BY slot DESC LIMIT 1
  │
  └── # Replay blocks from checkpoint_slot to rb_slot:
      for blk_data in replay_blocks:
        blk = decode_block_from_wire(blk_data)
        if blk.slot > checkpoint_slot and blk.slot <= rb_slot:
          state = apply_block(state, blk)
```

## 8. Epoch Boundary Flow

```
tick(state, block_slot)                          # epoch.py:31
  │  new_epoch = block_slot // state.epoch_length
  │  if new_epoch <= state.epoch: return         # No boundary crossed
  │
  └── _apply_epoch_transition(state, new_epoch)  # epoch.py:42
        │
        ├── 1. Capture fee snapshot (BEFORE rewards)
        │     new_fee_ss = state.pots.fees
        │
        ├── 2. Compute + apply rewards
        │     active_stake = state._go_stake_dist      # Frozen 2 epochs ago
        │     blocks = state._go_blocks_made           # Frozen 2 epochs ago
        │     compute_reward_update(state, blocks, active_stake) → RewardUpdate
        │     apply_reward_update(state, update)
        │       treasury += delta_treasury
        │       reserves += delta_reserves
        │       for (cred, amt): accounts[cred].rewards += amt
        │
        ├── 3. Rotate SnapshotRotation (for leader schedule)
        │
        ├── 4. Retire pools scheduled for this epoch
        │     Refund deposits, clear delegations
        │
        ├── 5. Enact ratified governance proposals
        │     Parameter changes, treasury withdrawals, committee updates
        │
        ├── 6. Rotate block counts: blocks_made → _prev → _go
        │
        ├── 7. Set fee snapshot: state._fee_ss = new_fee_ss; fees = 0
        │
        ├── 8. Rotate stake distributions: _mark → _set → _go
        │     New _mark = fresh computation from current UTxO + accounts
        │
        └── 9. state.epoch = new_epoch
```

## 9. Background Tasks

```
Running concurrently during sync:

  ┌── read_task: mux.read_loop()                 # mux.py:155
  │   # Continuously reads TCP → routes to ProtocolBuffers
  │   while not closed:
  │     header = reader.readexactly(8)
  │     proto_id = (header[4] << 8 | header[5]) & 0x7FFF
  │     length = header[6] << 8 | header[7]
  │     payload = reader.readexactly(length)
  │     buffers[proto_id].append(payload)
  │     buffers[proto_id]._data_available.set()
  │
  └── ka_task: _keepalive_loop(mux, ka_buf)      # sync_session.py:107
      # Every 30 seconds:
      mux.send(PROTO_KEEP_ALIVE, cbor2.dumps([0, cookie]))
      reply = ka_buf.recv_message(timeout=60.0)
      # [1, cookie] → MsgKeepAliveResponse
      cookie = (cookie + 1) & 0xFFFF
```

## 10. Key Data Types Flowing Through

```
ConwayBlock                                      # codec/block.py
  .header: ConwayHeader
    .header_body: ConwayHeaderBody
      .slot: int
      .block_number: int
      .prev_hash: bytes (32)
      .issuer_vkey: bytes (32)
      .vrf_vkey: bytes (32)
      .vrf_result: [bytes(64), bytes(80)]  # [output, proof]
      .block_body_size: int
      .block_body_hash: bytes (32)
      .protocol_version: [int, int]
    .body_signature: bytes                 # KES signature
    .block_hash: bytes (32)                # blake2b_256(raw header)
    .prev_hash: bytes (32)
  .transactions: list[ConwayTxBody]
  .tx_witnesses_raw: list[bytes]           # Per-tx witness CBOR
  .auxiliary_data_raw: bytes               # Block-level aux data map
  .invalid_txs: list[int]                  # Indices of phase-2 failures

ConwayTxBody                                     # codec/transaction.py
  .raw: bytes                              # Original CBOR (for hashing)
  .tx_id: bytes (32)                       # blake2b_256(raw)
  .inputs: set                             # [{tx_hash, output_index}, ...]
  .outputs: list[TxOut]
  .fee: int
  .ttl: int | None
  .certificates: list | None
  .withdrawals: dict | None                # {reward_addr: amount}
  .mint: dict | None                       # {policy_id: {asset: qty}}
  .collateral: list | None
  .required_signers: list | None
  .script_data_hash: bytes | None
  .reference_inputs: list | None
  .voting_procedures: dict | None
  .proposal_procedures: list | None
  .total_collateral: int | None
  .collateral_return: TxOut | None
  .treasury: int | None
  .donation: int | None

TxOut                                            # codec/transaction.py
  .address: bytes
  .amount: int | [int, {policy: {asset: qty}}]
  .datum_hash: bytes | None
  .script_ref: bytes | None
  .inline_datum: bytes | None
  .raw: bytes

LedgerState                                      # ledger/state.py
  .utxo: dict[(bytes, int), TxOut]         # The UTxO set
  .pots: Pots(treasury, reserves, fees, deposited)
  .accounts: dict[bytes, Account]          # Stake accounts
  .pools: dict[bytes, PoolParams]          # Registered pools
  .epoch: int
  .slot: int
  .blocks_made: dict[bytes, int]           # Pool → block count
  .gov_state: GovState | None              # Conway governance
  ._go_stake_dist: dict[bytes, int] | None # Frozen 2 epochs ago
  ._fee_ss: int | None                    # Fee snapshot
```

# 2. Data Types

This section defines the core data types of the Bluematter ledger. All types
are given in terms of the notation established in Section 0: B for
byte strings, B_n for byte strings of exactly n bytes,
H for 32-byte Blake2b-256 digests, H_28 for 28-byte
Blake2b-224 digests, N for natural numbers, Z for
integers, Set[T] for sets, Map[K,V] for maps, List[T]
for ordered lists, and T? for optional values.

---

## 2.1 Addresses

A Cardano address is a variable-length byte string whose first byte encodes the
address type and network discriminant.

**Header byte layout:**

```
  7   6   5   4   3   2   1   0
 +---+---+---+---+---+---+---+---+
 |    type[7:4]   |  network[3:0] |
 +---+---+---+---+---+---+---+---+
```

**Defined address types:**

| Type | Name             | Structure                                    | Length   |
|------|------------------|----------------------------------------------|----------|
| 0    | Base (key/key)   | `header \|\| pay_cred(28) \|\| stake_cred(28)` | 57 bytes |
| 1    | Base (script/key)| `header \|\| pay_cred(28) \|\| stake_cred(28)` | 57 bytes |
| 2    | Base (key/script)| `header \|\| pay_cred(28) \|\| stake_cred(28)` | 57 bytes |
| 3    | Base (script/script)| `header \|\| pay_cred(28) \|\| stake_cred(28)` | 57 bytes |
| 4    | Pointer (key)    | `header \|\| pay_cred(28) \|\| pointer(var)` | variable |
| 5    | Pointer (script) | `header \|\| pay_cred(28) \|\| pointer(var)` | variable |
| 6    | Enterprise (key) | `header \|\| pay_cred(28)`                   | 29 bytes |
| 7    | Enterprise (script)| `header \|\| pay_cred(28)`                 | 29 bytes |
| 8-9  | Byron bootstrap  | legacy variable-length encoding              | variable |
| 14   | Reward (key)     | `header \|\| stake_cred(28)`                 | 29 bytes |
| 15   | Reward (script)  | `header \|\| stake_cred(28)`                 | 29 bytes |

**Credential discrimination.** Bit 4 of the header byte determines the payment
credential type: 0 = verification key hash, 1 = script hash. The network nibble
(bits 3..0) encodes: 0 = testnet, 1 = mainnet.

Formally:

```
Credential = H_28
```

```
RewardAddr = B_29    -- header byte + 28-byte staking credential
```

---

## 2.2 Values

Cardano values represent quantities of ADA (lovelace) and optionally
native tokens (multi-assets).

```
Coin = N             -- lovelace, where 1 ADA = 10^6 lovelace
```

```
PolicyId  = B_28
AssetName = B         -- 0 <= len(AssetName) <= 32
```

```
MultiAsset = Map[PolicyId, Map[AssetName, Z]]
```

```
Value = Coin | (Coin, MultiAsset)
```

**Operations on values.** Let a, b : Value.

```
lovelace(v) =
  if v is Coin:      v
  if v is (v0, _):   v0
```

```
multiasset(v) =
  if v is Coin:      {}
  if v is (_, v1):   v1
```

**Addition.** Component-wise on both lovelace and every (policy, asset) pair:

```
value_add(a, b) = ( lovelace(a) + lovelace(b),
                    multiasset(a) (+) multiasset(b) )
```

where (+) denotes pointwise addition of quantities across all policies and
asset names, with zero-quantity entries removed.

**Subtraction.** Component-wise; raises an error if any component would go
negative:

```
value_sub(a, b) = ( lovelace(a) - lovelace(b),
                    multiasset(a) (-) multiasset(b) )
```

```
for all p, n:  (multiasset(a) (-) multiasset(b))(p)(n) >= 0
```

**Ordering.** Defined component-wise:

```
value_geq(a, b) =
    lovelace(a) >= lovelace(b)
    AND for all p, n:  multiasset(a)(p)(n) >= multiasset(b)(p)(n)
```

---

## 2.3 Transaction Input

A transaction input is a reference to a previously created, unspent output.

```
TxIn = (TxHash, OutputIndex)
```

where:

```
TxHash      = H        -- Blake2b-256 digest (32 bytes)
OutputIndex = N
```

The transaction hash is the Blake2b-256 digest of the raw CBOR-encoded
transaction body that created the output.

---

## 2.4 Transaction Output

A transaction output locks value at an address, optionally carrying datum
information and a script reference.

```
TxOut = {
  address       : B          -- raw address bytes
  amount        : Value
  datum_hash    : H?         -- Alonzo: hash pointer to datum
  inline_datum  : B?         -- Babbage: datum stored inline (raw CBOR)
  script_ref    : B?         -- Babbage: reference script (raw CBOR)
}
```

**Wire formats.** Two CBOR representations are accepted:

1. **Legacy array** (Shelley-Alonzo): `[address, amount]` or
   `[address, amount, datum_hash]`.

2. **Post-Alonzo map** (Babbage-Conway):
   ```
   { 0: address, 1: amount, 2?: datum_option, 3?: script_ref }
   ```
   where `datum_option` is a two-element array:
   - `[0, datum_hash]` -- datum by hash reference
   - `[1, #6.24(datum_cbor)]` -- inline datum wrapped in CBOR tag 24

---

## 2.5 Transaction Body (Conway)

The Conway transaction body is a CBOR map keyed by unsigned integers. There
are 3 required fields and 17 optional fields (20 total).

```
TxBody = {
  0  inputs              : Set[TxIn]                             -- required, non-empty
  1  outputs             : List[TxOut]                           -- required, non-empty
  2  fee                 : Coin                                  -- required, >= 0
  3  ttl                 : N?                                    -- validity upper bound (slot)
  4  certificates        : List[Certificate]?                    -- non-empty when present
  5  withdrawals         : Map[RewardAddr, Coin]?                -- non-empty when present
  7  auxiliary_data_hash : H?
  8  validity_start      : N?                                    -- validity lower bound (slot)
  9  mint                : MultiAsset?                           -- non-empty when present
  11 script_data_hash    : H?
  13 collateral          : Set[TxIn]?                            -- non-empty when present
  14 required_signers    : Set[H_28]?                            -- non-empty when present
  15 network_id          : {0, 1}?
  16 collateral_return   : TxOut?
  17 total_collateral    : Coin?
  18 reference_inputs    : Set[TxIn]?
  19 voting_procedures   : Map[Voter, Map[GovActionId, VotingProcedure]]?
  20 proposal_procedures : List[ProposalProcedure]?              -- non-empty when present
  21 treasury            : Coin?
  22 donation            : Coin?                                 -- must be > 0 (PositiveCoin)
}
```

**Note:** Map key 6 is unassigned. Keys 4, 5, 9, 13, 14, 19, 20 carry a
**NonEmpty** constraint: if the field is present, the container must contain
at least one element.

**Transaction identifier:**

```
txId(body) = blake2b_256(body.raw)
```

where `body.raw` is the original wire bytes of the CBOR map, never re-encoded.

---

## 2.6 Block Header

```
Header = (HeaderBody, KES_Signature)
```

where KES_Signature : B is the Sum6KES signature over the
header body.

```
HeaderBody = {
  block_number     : N
  slot             : N
  prev_hash        : H?          -- None for genesis
  issuer_vkey      : B_32
  vrf_vkey         : B_32
  vrf_result       : (B_64, B_80)    -- (output, proof)
  block_body_size  : N
  block_body_hash  : H
  operational_cert : OpCert
  protocol_version : (N, N)          -- (major, minor)
}
```

**Operational certificate:**

```
OpCert = {
  hot_vkey        : B_32
  sequence_number : N
  kes_period      : N
  sigma           : B_64         -- Ed25519 signature
}
```

**Block hash:**

```
blockHash(header) = blake2b_256(header.raw)
```

The hash is computed over the raw CBOR of the entire header (body + KES
signature), not just the header body.

---

## 2.7 Block

A Conway-era block is a five-element structure:

```
Block = (
  header              : Header,
  tx_bodies           : List[TxBody],
  witnesses           : List[WitnessSet],
  auxiliary_data      : AuxData,
  invalid_tx_indices  : List[N]
)
```

**Properties:**

```
len(tx_bodies) = len(witnesses)
```

```
for all i in invalid_tx_indices:  0 <= i < len(tx_bodies)
```

**Era tagging.** On the wire, blocks are era-tagged:

| Era tag | Era     |
|---------|---------|
| (bare)  | Byron   |
| 2       | Shelley |
| 3       | Allegra |
| 4       | Mary    |
| 5       | Alonzo  |
| 6       | Babbage |
| 7       | Conway  |

Pre-Conway blocks are stored as opaque byte strings (`OpaqueBlock`), with only
the block hash extracted from the header for chain linking.

---

## 2.8 Witness Set

The witness set is a CBOR map keyed by unsigned integers. Each key
corresponds to a distinct category of witness data.

```
WitnessSet = Map[N, Any]
```

| Key | Type | Description |
|-----|------|-------------|
| 0 | `List[(B_32, B_64)]` | VKey witnesses: (verification key, Ed25519 signature) |
| 1 | `List[NativeScript]` | Native (timelock) scripts |
| 3 | `List[B]` | PlutusV1 scripts (flat-encoded UPLC) |
| 4 | `List[PlutusData]` | Datums (arbitrary CBOR data) |
| 5 | `Redeemers` | Redeemers with execution budgets |
| 6 | `List[B]` | PlutusV2 scripts (flat-encoded UPLC) |
| 7 | `List[B]` | PlutusV3 scripts (flat-encoded UPLC) |

**Note:** Key 2 is unassigned. Keys 3, 6, 7 contain Plutus scripts in the
`flat` serialization format (not CBOR).

**Redeemers** have two valid encodings:

- **Map form:** `Map[(Tag, Index), (Data, ExUnits)]`
- **List form:** `List[(Tag, Index, Data, ExUnits)]`

where:

```
ExUnits = (mem : N, steps : N)
Tag     = { 0=spend, 1=mint, 2=cert, 3=reward, 4=vote, 5=propose }
```

---

## 2.9 Ledger State

The ledger state (denoted sigma) is the complete mutable state that evolves with each
applied block.

```
LedgerState = {
  utxo            : Map[TxIn, TxOut]
  pots            : Pots
  accounts        : Map[Credential, Account]
  pools           : Map[PoolId, PoolParams]
  epoch           : N
  slot            : N
  network_id      : {0, 1}?
  epoch_length    : N           -- slots per epoch; mainnet default: 432,000
  blocks_made     : Map[PoolId, N]
  gov_state       : GovState?
  protocol_params : ProtocolParameters?
}
```

where `PoolId = H_28`.

**Pots.** The protocol-level ADA accounting pots:

```
Pots = {
  treasury  : Coin
  reserves  : Coin
  fees      : Coin
  deposited : Coin    -- cumulative outstanding deposits
}
```

**Account.** A registered stake credential account:

```
Account = {
  rewards : Coin
  deposit : Coin
  pool    : PoolId?   -- delegation target
}
```

**PoolParams.** Stake pool registration parameters:

```
PoolParams = {
  operator        : H_28          -- pool operator key hash
  vrf_keyhash     : H_32
  pledge          : Coin
  cost            : Coin
  margin          : (N, N)        -- (numerator, denominator)
  reward_account  : B_29
  owners          : Set[H_28]     -- pool owner key hashes
  retiring_epoch  : N?
  deposit_paid    : Coin
}
```

**GovState.** Conway governance state:

```
GovState = {
  proposals          : Map[GovActionId, GovProposal]
  votes              : Map[GovActionId, List[GovVote]]
  committee          : Map[Credential, N]       -- credential -> expiry epoch
  constitution_hash  : H?
  dreps              : Map[Credential, Coin]    -- credential -> deposit
  enacted            : List[(N, GovProposal)]
}
```

where `GovActionId = (TxHash, N)`.

---

## 2.10 Preservation of Value

The fundamental conservation law of the Cardano ledger. For any valid state
sigma:

```
maxSupply = lovelace(sigma.utxo)
          + sigma.pots.deposited
          + sigma.pots.fees
          + sigma.pots.treasury
          + sigma.pots.reserves
          + sum(a.rewards for a in sigma.accounts)
```

```
maxSupply = 45 * 10^15 lovelace = 45 billion ADA
```

where:

```
lovelace(sigma.utxo) = sum( lovelace(out.amount) for (_, out) in sigma.utxo )
```

This property holds across all state transitions: block application, epoch
boundary processing (reward distribution, treasury donations, pool retirements),
and governance enactment. Any violation indicates a bug in the ledger rules.

**Value conservation per transaction.** For each valid transaction tx
applied to state sigma:

```
consumed(sigma, tx) = produced(sigma, tx)
```

where:

```
consumed = sum( sigma.utxo[inp].amount for inp in tx.inputs )
         + sum( c for (_, c) in tx.withdrawals )
         + mint(tx)
```

```
produced = sum( out.amount for out in tx.outputs )
         + tx.fee
         + deposits(tx)
         + tx.treasury (if present)
         + tx.donation (if present)
```

Both equations hold over the full Value type (lovelace and all native
tokens), not just lovelace.

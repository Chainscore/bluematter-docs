# 2. Data Types

This section defines the core data types of the Bluematter ledger. All types
are given in terms of the notation established in Section 0: \\(\mathbb{B}\\) for
byte strings, \\(\mathbb{B}_n\\) for byte strings of exactly \\(n\\) bytes,
\\(\mathcal{H}\\) for 32-byte Blake2b-256 digests, \\(\mathcal{H}_{28}\\) for 28-byte
Blake2b-224 digests, \\(\mathbb{N}\\) for natural numbers, \\(\mathbb{Z}\\) for
integers, \\(\mathcal{S}[T]\\) for sets, \\(\mathcal{M}[K,V]\\) for maps, \\(\mathcal{L}[T]\\)
for ordered lists, and \\(T?\\) for optional values.

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

| Type | Name             | Structure                                                  | Length   |
|------|------------------|------------------------------------------------------------|----------|
| 0    | Base (key/key)   | \\(\textit{header} \Vert \textit{pay\_cred}(28) \Vert \textit{stake\_cred}(28)\\) | 57 bytes |
| 1    | Base (script/key)| \\(\textit{header} \Vert \textit{pay\_cred}(28) \Vert \textit{stake\_cred}(28)\\) | 57 bytes |
| 2    | Base (key/script)| \\(\textit{header} \Vert \textit{pay\_cred}(28) \Vert \textit{stake\_cred}(28)\\) | 57 bytes |
| 3    | Base (script/script)| \\(\textit{header} \Vert \textit{pay\_cred}(28) \Vert \textit{stake\_cred}(28)\\) | 57 bytes |
| 4    | Pointer (key)    | \\(\textit{header} \Vert \textit{pay\_cred}(28) \Vert \textit{pointer}(\text{var})\\) | variable |
| 5    | Pointer (script) | \\(\textit{header} \Vert \textit{pay\_cred}(28) \Vert \textit{pointer}(\text{var})\\) | variable |
| 6    | Enterprise (key) | \\(\textit{header} \Vert \textit{pay\_cred}(28)\\)             | 29 bytes |
| 7    | Enterprise (script)| \\(\textit{header} \Vert \textit{pay\_cred}(28)\\)           | 29 bytes |
| 8-9  | Byron bootstrap  | legacy variable-length encoding                            | variable |
| 14   | Reward (key)     | \\(\textit{header} \Vert \textit{stake\_cred}(28)\\)           | 29 bytes |
| 15   | Reward (script)  | \\(\textit{header} \Vert \textit{stake\_cred}(28)\\)           | 29 bytes |

**Credential discrimination.** Bit 4 of the header byte determines the payment
credential type: 0 = verification key hash, 1 = script hash. The network nibble
(bits 3..0) encodes: 0 = testnet, 1 = mainnet.

Formally:

\\[
\text{Credential} = \mathcal{H}_{28}
\\]
\\[
\text{RewardAddr} = \mathbb{B}_{29} \quad \text{(header byte + 28-byte staking credential)}
\\]

---

## 2.2 Values

Cardano values represent quantities of ADA (lovelace) and optionally
native tokens (multi-assets).

\\[
\text{Coin} = \mathbb{N} \qquad \text{(lovelace, where } 1 \text{ ADA} = 10^6 \text{ lovelace)}
\\]

\\[
\text{PolicyId} = \mathbb{B}_{28} \qquad \text{AssetName} = \mathbb{B} \quad (0 \leq |\text{AssetName}| \leq 32)
\\]

\\[
\text{MultiAsset} = \mathcal{M}[\text{PolicyId},\; \mathcal{M}[\text{AssetName},\; \mathbb{Z}]]
\\]

\\[
\text{Value} = \text{Coin} \;\big|\; (\text{Coin},\; \text{MultiAsset})
\\]

**Operations on values.** Let \\(a, b : \text{Value}\\).

\\[
\text{lovelace}(v) = \begin{cases}
  v & \text{if } v : \text{Coin} \\
  v_0 & \text{if } v = (v_0, \_)
\end{cases}
\\]

\\[
\text{multiasset}(v) = \begin{cases}
  \emptyset & \text{if } v : \text{Coin} \\
  v_1 & \text{if } v = (\_, v_1)
\end{cases}
\\]

**Addition.** Component-wise on both lovelace and every (policy, asset) pair:

\\[
\text{value\_add}(a, b) = \big(\text{lovelace}(a) + \text{lovelace}(b),\; \text{multiasset}(a) \oplus \text{multiasset}(b)\big)
\\]

where \\(\oplus\\) denotes pointwise addition of quantities across all policies and
asset names, with zero-quantity entries removed.

**Subtraction.** Component-wise; raises an error if any component would go
negative:

\\[
\text{value\_sub}(a, b) = \big(\text{lovelace}(a) - \text{lovelace}(b),\; \text{multiasset}(a) \ominus \text{multiasset}(b)\big)
\\]

\\[
\forall\, p, n:\; (\text{multiasset}(a) \ominus \text{multiasset}(b))(p)(n) \geq 0
\\]

**Ordering.** Defined component-wise:

\\[
\text{value\_geq}(a, b) \iff \text{lovelace}(a) \geq \text{lovelace}(b) \;\wedge\; \forall\, p, n:\; \text{multiasset}(a)(p)(n) \geq \text{multiasset}(b)(p)(n)
\\]

---

## 2.3 Transaction Input

A transaction input is a reference to a previously created, unspent output.

\\[
\text{TxIn} = (\text{TxHash},\; \text{OutputIndex})
\\]

where:

\\[
\text{TxHash} = \mathcal{H} \qquad \text{OutputIndex} = \mathbb{N}
\\]

The transaction hash is the Blake2b-256 digest of the raw CBOR-encoded
transaction body that created the output.

---

## 2.4 Transaction Output

A transaction output locks value at an address, optionally carrying datum
information and a script reference.

\\[
\text{TxOut} = \left\{
\begin{array}{lcl}
  \text{address}      &:& \mathbb{B} \\
  \text{amount}       &:& \text{Value} \\
  \text{datum\_hash}  &:& \mathcal{H}? \quad \text{-- Alonzo: hash pointer to datum} \\
  \text{inline\_datum}&:& \mathbb{B}? \quad \text{-- Babbage: datum stored inline (raw CBOR)} \\
  \text{script\_ref}  &:& \mathbb{B}? \quad \text{-- Babbage: reference script (raw CBOR)} \\
\end{array}
\right\}
\\]

**Wire formats.** Two CBOR representations are accepted:

1. **Legacy array** (Shelley--Alonzo): `[address, amount]` or
   `[address, amount, datum_hash]`.

2. **Post-Alonzo map** (Babbage--Conway):
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

\\[
\text{TxBody} = \left\{
\begin{array}{rclcl}
  0  & \text{inputs}              &:& \mathcal{S}[\text{TxIn}]                             & \text{-- required, non-empty} \\
  1  & \text{outputs}             &:& \mathcal{L}[\text{TxOut}]                             & \text{-- required, non-empty} \\
  2  & \text{fee}                 &:& \text{Coin}                                           & \text{-- required, } \geq 0 \\
  3  & \text{ttl}                 &:& \mathbb{N}?                                           & \text{-- validity upper bound (slot)} \\
  4  & \text{certificates}        &:& \mathcal{L}[\text{Certificate}]?                      & \text{-- non-empty when present} \\
  5  & \text{withdrawals}         &:& \mathcal{M}[\text{RewardAddr}, \text{Coin}]?          & \text{-- non-empty when present} \\
  7  & \text{auxiliary\_data\_hash}&:& \mathcal{H}?                                         & \\
  8  & \text{validity\_start}     &:& \mathbb{N}?                                           & \text{-- validity lower bound (slot)} \\
  9  & \text{mint}                &:& \text{MultiAsset}?                                    & \text{-- non-empty when present} \\
  11 & \text{script\_data\_hash}  &:& \mathcal{H}?                                          & \\
  13 & \text{collateral}          &:& \mathcal{S}[\text{TxIn}]?                             & \text{-- non-empty when present} \\
  14 & \text{required\_signers}   &:& \mathcal{S}[\mathcal{H}_{28}]?                       & \text{-- non-empty when present} \\
  15 & \text{network\_id}         &:& \{0, 1\}?                                             & \\
  16 & \text{collateral\_return}  &:& \text{TxOut}?                                         & \\
  17 & \text{total\_collateral}   &:& \text{Coin}?                                          & \\
  18 & \text{reference\_inputs}   &:& \mathcal{S}[\text{TxIn}]?                             & \\
  19 & \text{voting\_procedures}  &:& \mathcal{M}[\text{Voter}, \mathcal{M}[\text{GovActionId}, \text{VotingProcedure}]]? & \\
  20 & \text{proposal\_procedures}&:& \mathcal{L}[\text{ProposalProcedure}]?                & \text{-- non-empty when present} \\
  21 & \text{treasury}            &:& \text{Coin}?                                          & \\
  22 & \text{donation}            &:& \text{Coin}?                                          & \text{-- must be } > 0 \text{ (PositiveCoin)} \\
\end{array}
\right\}
\\]

**Note:** Map key 6 is unassigned. Keys 4, 5, 9, 13, 14, 19, 20 carry a
**NonEmpty** constraint: if the field is present, the container must contain
at least one element.

**Transaction identifier:**

\\[
\text{txId}(\text{body}) = \text{blake2b\_256}(\text{body.raw})
\\]

where `body.raw` is the original wire bytes of the CBOR map, never re-encoded.

---

## 2.6 Block Header

\\[
\text{Header} = (\text{HeaderBody},\; \text{KES\_Signature})
\\]

where \\(\text{KES\_Signature} : \mathbb{B}\\) is the Sum\\(_6\\)KES signature over the
header body.

\\[
\text{HeaderBody} = \left\{
\begin{array}{lcl}
  \text{block\_number}     &:& \mathbb{N} \\
  \text{slot}              &:& \mathbb{N} \\
  \text{prev\_hash}        &:& \mathcal{H}? \quad \text{(None for genesis)} \\
  \text{issuer\_vkey}      &:& \mathbb{B}_{32} \\
  \text{vrf\_vkey}         &:& \mathbb{B}_{32} \\
  \text{vrf\_result}       &:& (\mathbb{B}_{64}, \mathbb{B}_{80}) \quad \text{(output, proof)} \\
  \text{block\_body\_size} &:& \mathbb{N} \\
  \text{block\_body\_hash} &:& \mathcal{H} \\
  \text{operational\_cert} &:& \text{OpCert} \\
  \text{protocol\_version} &:& (\mathbb{N}, \mathbb{N}) \quad \text{(major, minor)} \\
\end{array}
\right\}
\\]

**Operational certificate:**

\\[
\text{OpCert} = \left\{
\begin{array}{lcl}
  \text{hot\_vkey}        &:& \mathbb{B}_{32} \\
  \text{sequence\_number} &:& \mathbb{N} \\
  \text{kes\_period}      &:& \mathbb{N} \\
  \text{sigma}            &:& \mathbb{B}_{64} \quad \text{(Ed25519 signature)} \\
\end{array}
\right\}
\\]

**Block hash:**

\\[
\text{blockHash}(\text{header}) = \text{blake2b\_256}(\text{header.raw})
\\]

The hash is computed over the raw CBOR of the entire header (body + KES
signature), not just the header body.

---

## 2.7 Block

A Conway-era block is a five-element structure:

\\[
\text{Block} = \left(
\underbrace{\text{Header}}_{\text{header}},\;
\underbrace{\mathcal{L}[\text{TxBody}]}_{\text{tx\_bodies}},\;
\underbrace{\mathcal{L}[\text{WitnessSet}]}_{\text{witnesses}},\;
\underbrace{\text{AuxData}}_{\text{auxiliary\_data}},\;
\underbrace{\mathcal{L}[\mathbb{N}]}_{\text{invalid\_tx\_indices}}
\right)
\\]

**Invariants:**

\\[
|\text{tx\_bodies}| = |\text{witnesses}|
\\]
\\[
\forall\, i \in \text{invalid\_tx\_indices}:\; 0 \leq i < |\text{tx\_bodies}|
\\]

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

\\[
\text{WitnessSet} = \mathcal{M}[\mathbb{N},\; \text{Any}]
\\]

| Key | Type | Description |
|-----|------|-------------|
| 0 | \\(\mathcal{L}[(\mathbb{B}_{32},\; \mathbb{B}_{64})]\\) | VKey witnesses: (verification key, Ed25519 signature) |
| 1 | \\(\mathcal{L}[\text{NativeScript}]\\) | Native (timelock) scripts |
| 3 | \\(\mathcal{L}[\mathbb{B}]\\) | PlutusV1 scripts (flat-encoded UPLC) |
| 4 | \\(\mathcal{L}[\text{PlutusData}]\\) | Datums (arbitrary CBOR data) |
| 5 | \\(\text{Redeemers}\\) | Redeemers with execution budgets |
| 6 | \\(\mathcal{L}[\mathbb{B}]\\) | PlutusV2 scripts (flat-encoded UPLC) |
| 7 | \\(\mathcal{L}[\mathbb{B}]\\) | PlutusV3 scripts (flat-encoded UPLC) |

**Note:** Key 2 is unassigned. Keys 3, 6, 7 contain Plutus scripts in the
`flat` serialization format (not CBOR).

**Redeemers** have two valid encodings:

- **Map form:** \\(\mathcal{M}[(\text{Tag}, \text{Index}),\; (\text{Data}, \text{ExUnits})]\\)
- **List form:** \\(\mathcal{L}[(\text{Tag}, \text{Index}, \text{Data}, \text{ExUnits})]\\)

where \\(\text{ExUnits} = (\text{mem} : \mathbb{N},\; \text{steps} : \mathbb{N})\\)
and \\(\text{Tag} \in \{0\text{ (spend)},\; 1\text{ (mint)},\; 2\text{ (cert)},\;
3\text{ (reward)},\; 4\text{ (vote)},\; 5\text{ (propose)}\}\\).

---

## 2.9 Ledger State

The ledger state \\(\sigma\\) is the complete mutable state that evolves with each
applied block.

\\[
\sigma = \left\{
\begin{array}{lcl}
  \text{utxo}       &:& \mathcal{M}[\text{TxIn},\; \text{TxOut}] \\
  \text{pots}       &:& \text{Pots} \\
  \text{accounts}   &:& \mathcal{M}[\text{Credential},\; \text{Account}] \\
  \text{pools}      &:& \mathcal{M}[\text{PoolId},\; \text{PoolParams}] \\
  \text{epoch}      &:& \mathbb{N} \\
  \text{slot}       &:& \mathbb{N} \\
  \text{network\_id}&:& \{0, 1\}? \\
  \text{epoch\_length}&:& \mathbb{N} \quad \text{(slots per epoch; mainnet default: 432{,}000)} \\
  \text{blocks\_made}&:& \mathcal{M}[\text{PoolId},\; \mathbb{N}] \\
  \text{gov\_state} &:& \text{GovState}? \\
  \text{protocol\_params} &:& \text{ProtocolParameters}? \\
\end{array}
\right\}
\\]

where \\(\text{PoolId} = \mathcal{H}_{28}\\).

**Pots.** The protocol-level ADA accounting pots:

\\[
\text{Pots} = \left\{
\begin{array}{lcl}
  \text{treasury}  &:& \text{Coin} \\
  \text{reserves}  &:& \text{Coin} \\
  \text{fees}      &:& \text{Coin} \\
  \text{deposited} &:& \text{Coin} \quad \text{(cumulative outstanding deposits)} \\
\end{array}
\right\}
\\]

**Account.** A registered stake credential account:

\\[
\text{Account} = \left\{
\begin{array}{lcl}
  \text{rewards} &:& \text{Coin} \\
  \text{deposit} &:& \text{Coin} \\
  \text{pool}    &:& \text{PoolId}? \quad \text{(delegation target)} \\
\end{array}
\right\}
\\]

**PoolParams.** Stake pool registration parameters:

\\[
\text{PoolParams} = \left\{
\begin{array}{lcl}
  \text{operator}       &:& \mathcal{H}_{28} \quad \text{(pool operator key hash)} \\
  \text{vrf\_keyhash}   &:& \mathcal{H}_{32} \\
  \text{pledge}         &:& \text{Coin} \\
  \text{cost}           &:& \text{Coin} \\
  \text{margin}         &:& (\mathbb{N}, \mathbb{N}) \quad \text{(numerator, denominator)} \\
  \text{reward\_account}&:& \mathbb{B}_{29} \\
  \text{owners}         &:& \mathcal{S}[\mathcal{H}_{28}] \quad \text{(pool owner key hashes)} \\
  \text{retiring\_epoch}&:& \mathbb{N}? \\
  \text{deposit\_paid}  &:& \text{Coin} \\
\end{array}
\right\}
\\]

**GovState.** Conway governance state:

\\[
\text{GovState} = \left\{
\begin{array}{lcl}
  \text{proposals}          &:& \mathcal{M}[\text{GovActionId},\; \text{GovProposal}] \\
  \text{votes}              &:& \mathcal{M}[\text{GovActionId},\; \mathcal{L}[\text{GovVote}]] \\
  \text{committee}          &:& \mathcal{M}[\text{Credential},\; \mathbb{N}] \quad \text{(credential} \to \text{expiry epoch)} \\
  \text{constitution\_hash} &:& \mathcal{H}? \\
  \text{dreps}              &:& \mathcal{M}[\text{Credential},\; \text{Coin}] \quad \text{(credential} \to \text{deposit)} \\
  \text{enacted}            &:& \mathcal{L}[(\mathbb{N}, \text{GovProposal})] \\
\end{array}
\right\}
\\]

where \\(\text{GovActionId} = (\text{TxHash}, \mathbb{N})\\).

---

## 2.10 Preservation of Value

The fundamental conservation law of the Cardano ledger. For any valid state
\\(\sigma\\):

\\[
\boxed{
\text{maxSupply} = \text{lovelace}(\sigma.\text{utxo}) + \sigma.\text{pots.deposited} + \sigma.\text{pots.fees} + \sigma.\text{pots.treasury} + \sigma.\text{pots.reserves} + \sum_{a \in \sigma.\text{accounts}} a.\text{rewards}
}
\\]

\\[
\text{maxSupply} = 45 \times 10^{15} \text{ lovelace} = 45 \times 10^{9} \text{ ADA}
\\]

where \\(\text{lovelace}(\sigma.\text{utxo}) = \sum_{(\_, \text{out}) \in \sigma.\text{utxo}} \text{lovelace}(\text{out.amount})\\).

This invariant holds across all state transitions: block application, epoch
boundary processing (reward distribution, treasury donations, pool retirements),
and governance enactment. Any violation indicates a bug in the ledger rules.

**Value conservation per transaction.** For each valid transaction \\(\text{tx}\\)
applied to state \\(\sigma\\):

\\[
\text{consumed}(\sigma, \text{tx}) = \text{produced}(\sigma, \text{tx})
\\]

where:

\\[
\text{consumed} = \sum_{\text{inp} \in \text{tx.inputs}} \sigma.\text{utxo}[\text{inp}].\text{amount} \;+\; \sum_{(\_,c) \in \text{tx.withdrawals}} c \;+\; \text{mint}(\text{tx})
\\]

\\[
\text{produced} = \sum_{\text{out} \in \text{tx.outputs}} \text{out.amount} \;+\; \text{tx.fee} \;+\; \text{deposits}(\text{tx}) \;+\; \text{tx.treasury}? \;+\; \text{tx.donation}?
\\]

Both equations hold over the full \\(\text{Value}\\) type (lovelace and all native
tokens), not just lovelace.

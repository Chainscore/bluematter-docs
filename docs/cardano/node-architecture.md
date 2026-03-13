# Haskell Node Architecture

This document provides a detailed technical reference of the Cardano Haskell node
(`cardano-node`) architecture, intended for implementers building alternative node
implementations. It covers the four major layers (consensus, ledger, networking,
storage), how they interact, and the node orchestration that ties them together.

Primary sources include the [Cardano Blueprint](https://cardano-scaling.github.io/cardano-blueprint/consensus/),
the [Ouroboros Consensus Technical Report](https://ouroboros-consensus.cardano.intersectmbo.org/pdfs/report.pdf)
by Edsko de Vries et al., the [Ouroboros Network Specification](https://ouroboros-network.cardano.intersectmbo.org/pdfs/network-spec/network-spec.pdf),
and the source code of `ouroboros-consensus`, `ouroboros-network`, `cardano-ledger`,
and `cardano-node` itself.

---

## Table of Contents

1. [Overall Architecture](#1-overall-architecture)
2. [Consensus Layer](#2-consensus-layer)
3. [Ledger Layer](#3-ledger-layer)
4. [Networking Layer](#4-networking-layer)
5. [Storage Layer](#5-storage-layer)
6. [Node Orchestration](#6-node-orchestration)
7. [Key Parameters and Constants](#7-key-parameters-and-constants)
8. [References](#8-references)

---

## 1. Overall Architecture

### 1.1 Component Separation

The Haskell `cardano-node` is **not** a monolithic implementation. It is a thin
orchestration layer that composes four large external components:

| Repository               | Role                                         |
|:------------------------|:---------------------------------------------|
| `ouroboros-consensus`    | Consensus engine, hard fork combinator, storage |
| `ouroboros-network`      | P2P networking, typed protocols, multiplexing |
| `cardano-ledger`         | Ledger rules for every era (Byron-Conway)     |
| `cardano-api`            | High-level API for tx building, node interaction |

Each component lives in its own repository with its own release cadence, test
suites, and maintainers. `cardano-node` itself wires them together, handles
configuration, manages tracing/monitoring, and exposes the executables that
operators run.

### 1.2 Data Flow Overview

```
                  Upstream Peers
                       |
           +-----------+-----------+
           |           |           |
      ChainSync   BlockFetch  TxSubmission2
      (headers)   (bodies)    (transactions)
           |           |           |
           +-----------+-----------+
                       |
                  [Consensus]
                   /      \
            [Ledger]    [Storage]
               |            |
          apply_block   ImmutableDB
          apply_tx      VolatileDB
               |        LedgerDB
            [Mempool]
               |
          TxSubmission2 (downstream)
```

The Consensus layer receives block headers from ChainSync and block bodies from
BlockFetch. It invokes the Ledger layer to validate chains and applies blocks
to update the ledger state. Validated blocks are persisted in the Storage layer.
The Mempool holds unconfirmed transactions, validated against the current ledger
tip, and provides them for block forging and downstream TxSubmission2 diffusion.

### 1.3 The Typed-Protocols Approach

All Cardano mini-protocols (ChainSync, BlockFetch, TxSubmission2, KeepAlive,
Handshake, PeerSharing) are defined as **state machines with typed agency**.
Each protocol state specifies which party (initiator or responder) has
*agency* -- the right to send the next message. This eliminates entire classes
of protocol bugs at the type level in Haskell. For alternative implementations,
the key insight is: **implement the state machine faithfully** and the protocol
will be correct.

---

## 2. Consensus Layer

The consensus layer (`ouroboros-consensus`) has three main responsibilities:

1. **Chain validity checking** -- is this chain of blocks valid?
2. **Chain selection** -- which of the competing chains is best?
3. **Leadership check and block forging** -- should this node produce a block?

### 2.1 Protocols by Era

| Era         | Protocol                     | Notes                                     |
|:-----------|:-----------------------------|:------------------------------------------|
| Byron       | Ouroboros Classic             | Federated, 7 core nodes                   |
| Byron (re-impl) | Ouroboros BFT / PBFT     | Simplified, still federated               |
| Shelley     | Ouroboros TPraos              | Transitional Praos (Sec 12, Shelley spec) |
| Allegra     | Ouroboros TPraos              |                                           |
| Mary        | Ouroboros TPraos              |                                           |
| Alonzo      | Ouroboros TPraos              |                                           |
| Babbage     | Ouroboros Praos               | Full Praos                                |
| Conway      | Ouroboros Praos               | Current mainnet era                       |

### 2.2 Header/Body Split

A fundamental design principle: **block headers** contain all cryptographic
consensus evidence (VRF proofs, KES signatures, opcert, issuer VKey, slot,
block number, previous hash, body hash). **Block bodies** contain only ledger
data (transactions). This separation enables:

- **Fast chain comparison**: ChainSync transmits only headers. Chain selection
  examines header chains without downloading bodies.
- **Bandwidth efficiency**: BlockFetch downloads each body once, from one peer.
- **Parallel validation**: headers can be validated independently from bodies.

This is why ChainSync and BlockFetch are **separate protocols**.

### 2.3 Chain Selection

#### 2.3.1 The `k` Security Parameter

Both Ouroboros Classic and Praos impose a **maximum rollback** of `k` blocks
(mainnet: `k = 2160`). Alternative chains that fork more than `k` blocks deep
are never considered. This divides the chain into:

- **Immutable prefix**: blocks older than `k` from the tip. Guaranteed stable.
- **Volatile suffix**: the most recent `k` blocks. Subject to rollback.

The consensus layer keeps `k+1` ledger states in memory (for the volatile
chain plus the immutable tip) to evaluate candidate chains efficiently.

#### 2.3.2 Longest Chain Rule (Praos)

The basic Praos rule: **longer chains are preferred over shorter ones**. Ties
are broken in favor of the currently selected chain.

#### 2.3.3 Tie Breakers (Conway Refinements)

When two competing chains have equal length:

1. If tips are from the **same pool**: prefer higher `opcert_counter` (can
   increase by at most 1 per block).
2. If tips are from **different pools**: prefer lower VRF value. Starting in
   Conway, this comparison only applies if the blocks differ by at most `n`
   slots (prevents incentive to withhold blocks for a better VRF).

#### 2.3.4 Ouroboros Genesis (Syncing Nodes)

When a node is syncing (not caught up), it uses the **density rule** instead
of length:

- For **shallow forks** (within `k`): use the standard longest-chain rule.
- For **deep forks**: compare block density in a **Genesis window** of
  `3k/f` slots immediately after the fork point. The honest chain will have
  higher density.

Key mechanisms:
- **Limit on Eagerness (LoE)**: prevents committing to a chain before seeing
  enough of the Genesis window.
- **Limit on Patience (LoP)**: prevents servers from indefinitely stalling.
- **Genesis Density Disconnection (GDD)**: disconnects peers serving lower-
  density chains.

Once synced, the node disables LoE/GDD/LoP and reverts to pure Praos behavior.

### 2.4 Chain Validity

A block is valid in three dimensions:

1. **Envelope** (consensus responsibility): block number monotonicity, slot
   monotonicity, previous hash matches, protocol version not too new, header
   size within limits, body size within limits. Ledger-independent.

2. **Header** (protocol-specific): cryptographic checks vary by protocol:
   - **BFT/PBFT**: signature of slot + block, issuer delegation from genesis,
     signing limit checks.
   - **Praos**: VRF proof verification (leader eligibility), KES signature
     verification, opcert chain validation, issuer VKey verification.

3. **Body** (ledger responsibility): transaction validity, value conservation,
   script execution. Delegated entirely to the Ledger layer.

Trusted blocks (e.g., during chain replay from local storage) can skip all
validation checks -- only the state transition is applied. This is a major
performance optimization.

### 2.5 Leadership Check (Ouroboros Praos)

Every slot, a node with forging credentials evaluates:

```
y = VRF_eval(sk_vrf, slot || epoch_nonce || "TEST")
```

The node is elected leader if:

```
y < phi_f(alpha) = 1 - (1 - f)^alpha
```

Where:
- `f` = active slot coefficient (mainnet: `0.05`, meaning 1 block per 20 slots)
- `alpha` = relative stake of the pool
- `epoch_nonce` = randomness for this epoch (derived from VRF outputs)

Properties:
- Multiple leaders possible per slot (independent random events) -> "slot battles"
- Empty slots possible (no leader elected)
- Leadership is **private** -- only the leader knows it was elected
- The VRF proof is published in the block header for others to verify

A second VRF evaluation with `"NONCE"` instead of `"TEST"` produces a value
that contributes to the **next epoch's nonce**.

### 2.6 Epoch Nonce Evolution

The epoch nonce for epoch `e` is derived from:

1. The **VRF nonce outputs** from the first `2/3` of epoch `e-1` (specifically,
   the first `16k` slots). Blocks in the last `1/3` do not contribute to
   avoid adversarial grinding.
2. The **previous epoch nonce** from epoch `e-1`.
3. An **extra entropy** value (if set via on-chain governance, otherwise 0).

These are concatenated and hashed:
```
nonce_e = hash(nonce_{e-1} || concat(rho_values_first_2/3) || extra_entropy)
```

In practice, this is computed incrementally: each block's VRF nonce output
(`rho`) is folded into a running hash, and the nonce is "snapshotted" at the
`2/3` boundary.

### 2.7 Stake Distribution and Forecasting

The stake distribution used for leader election in epoch `e` is the distribution
from the **last block of epoch `e-2`** (two epochs ago). This two-epoch lag
ensures:

1. The distribution is fully determined and stable.
2. No adversary can manipulate stake right before using it for election.

The **forecast range** is `3k/f = 129,600` slots (3 stability windows). Within
this range, the consensus layer can predict the ledger view (stake distribution)
needed for header validation without having the actual chain. This is critical
for validating candidate chains that fork from the current selection.

### 2.8 The Hard Fork Combinator (HFC)

The HFC allows a single node binary to understand every historical era
simultaneously. It provides:

- **Type-safe era boundaries**: impossible to apply the wrong era's rules.
- **Cross-era forecasting**: `crossEraForecastAcrossShelley` projects ledger
  views across hard fork boundaries.
- **Era translation**: blocks, transactions, and ledger states can be
  translated between eras.
- **On-chain governance**: era transitions are enacted through special
  transactions, not software updates.

The HFC wraps per-era blocks into a `HardForkBlock` sum type. The consensus
layer pattern-matches on the era tag to dispatch to the correct protocol and
ledger rules.

### 2.9 Block Forging Interface

The `BlockForging` interface (in Haskell, a record of functions) provides:

1. **`canBeLeader`**: check credentials are present.
2. **`checkIsLeader`**: evaluate VRF for current slot. Returns proof if elected.
3. **`forgeBlock`**: given leader proof + mempool snapshot + ledger state,
   construct a new block:
   - Pull validated transactions from the Mempool (respecting `txInBlockSize`
     to stay within max block body size).
   - Construct the block body.
   - Produce the block header (VRF proofs, KES signature, opcert).
   - Submit to ChainDB via `addBlockAsync`.

After forging, the block is fed back into chain selection. If the node's own
block is invalid (should never happen), all its transactions are purged from
the Mempool as a safety measure.

### 2.10 Key-Evolving Signatures (KES)

Ouroboros Praos uses KES for **forward security**. The signing key evolves at
regular intervals (every `KESPeriod` = 129,600 slots on mainnet). After
evolution, the old key is securely erased. This means:

- An adversary who compromises a key cannot sign blocks for past slots.
- The operational certificate (`opcert`) binds a KES verification key to a
  cold key with a counter and expiry.
- The KES scheme used is **Sum6KES** (a 6-level Merkle-tree based scheme),
  providing 2^6 = 64 KES periods per key.

---

## 3. Ledger Layer

The ledger layer (`cardano-ledger`) defines what is stored inside blocks and
how the ledger state evolves.

### 3.1 The STS (Structured Transition System) Framework

The Cardano ledger is specified using **small-step operational semantics**. Each
rule is a state transition:

```
Environment, State --[Signal]--> State'
```

Where:
- **Environment**: read-only context (protocol parameters, current slot, etc.)
- **State**: the current ledger state (UTxO set, stake distribution, etc.)
- **Signal**: what drives evolution (block body, transaction, or tick)

A transaction is **valid** if the transition function succeeds (all predicates
hold), yielding a new valid state.

### 3.2 Rule Hierarchy (Conway Era)

The rules compose hierarchically. Here is the full Conway-era hierarchy as
implemented in `cardano-ledger`:

```
BBODY (block body)
  |
  +-- conwayBbodyTransition
  |     +-- totalScriptRefSize <= maxRefScriptSizePerBlock
  |
  +-- alonzoBbodyTransition
        +-- LEDGERS (process all transactions)
        |     +-- shelleyLedgersTransition
        |           +-- LEDGER (per transaction, repeated)
        |                 +-- [if mempool] MEMPOOL (Conway-specific checks)
        |                 +-- UTXOW (witness validation)
        |                 |     +-- validateVerifiedWits (Ed25519 signatures)
        |                 |     +-- validateNeededWitnesses
        |                 |     +-- babbageMissingScripts
        |                 |     +-- missingRequiredDatums
        |                 |     +-- hasExactSetOfRedeemers
        |                 |     +-- ppViewHashesMatch (script_data_hash)
        |                 |     +-- UTXO (UTxO validation)
        |                 |           +-- disjointRefInputs
        |                 |           +-- validateOutsideValidityInterval
        |                 |           +-- validateBadInputsUTxO
        |                 |           +-- validateValueNotConservedUTxO
        |                 |           +-- feesOk (min fee + script fees)
        |                 |           +-- validateOutputTooSmallUTxO
        |                 |           +-- validateOutputTooBigUTxO
        |                 |           +-- validateMaxTxSizeUTxO
        |                 |           +-- validateExUnitsTooBigUTxO
        |                 |           +-- validateTooManyCollateralInputs
        |                 |           +-- UTXOS (script evaluation)
        |                 |                 +-- [if isValid=True] evalScripts: pass
        |                 |                 +-- [if isValid=False] evalScripts: fail, take collateral
        |                 +-- CERTS (certificate processing)
        |                 |     +-- CERT (per certificate)
        |                 |           +-- DELEG (stake delegation)
        |                 |           +-- POOL (pool registration/retirement)
        |                 |           +-- GOVCERT (DRep reg/unreg, committee auth)
        |                 +-- GOV (governance proposals and votes)
        |
        +-- txTotalExUnits <= ppMaxExUnits
```

Note how Conway reuses rules from earlier eras:
- `EraRule "LEDGERS" Conway` delegates to `EraRule "LEDGERS" Shelley`
- `EraRule "POOL" Conway` delegates to `EraRule "POOL" Shelley`
- UTXO checks reference Shelley, Allegra, Alonzo-era validators by name

### 3.3 Three Signals

The ledger state responds to three types of signals:

1. **Block body**: the main signal. Applies all transactions in the block,
   processes certificates, governance actions, etc.

2. **Transaction**: used by the Mempool to validate individual transactions
   against the current tip state before inclusion in a block.

3. **Tick**: time passing. Handles epoch boundary processing:
   - Reward calculation and distribution
   - Stake snapshot rotation (mark -> set -> go)
   - Pool retirement processing
   - Protocol parameter updates
   - Governance enactment
   - Nonce evolution

Ticks must always succeed -- if time cannot advance validly, the chain is
corrupted.

### 3.4 Multi-Phase Validity (Alonzo and Later)

Since Alonzo, transaction validity is split into two phases:

**Phase 1** (bounded work, no fees on failure):
- Input existence, fee adequacy, size limits, validity interval, signatures,
  native scripts, collateral adequacy.
- Failure: transaction is rejected entirely (not placed on chain).

**Phase 2** (unbounded work, fees on failure):
- Plutus script execution.
- Failure: transaction IS placed on chain, but its effects are rolled back.
  Collateral is consumed and donated to the fee pot. The `isValid` flag in
  the transaction is set to `False`.

This design prevents asymmetric resource attacks: even failed Plutus scripts
pay fees (via collateral).

### 3.5 Static vs Dynamic Checks

- **Static checks**: depend only on the transaction and its resolved inputs.
  Examples: cryptographic signatures, native scripts, Plutus scripts.
  Only need to be run once.
- **Dynamic checks**: depend on the ledger state. Examples: input existence,
  validity interval, fee adequacy against current params.
  Must be re-run when the state changes (e.g., mempool revalidation after
  a new block).

This distinction is critical for performance: when revalidating mempool
transactions after adopting a new block, only dynamic checks need re-running.

### 3.6 Era Type System

The Haskell ledger uses an elaborate type class hierarchy for code sharing:

```
Era (base: era name, predecessor, protocol version range)
  |
  +-- EraTxOut -> EraTxBody -> EraTx -> EraSegWits
  +-- EraScript -> EraTxWits
  +-- EraPParams
  +-- EraAuxiliaryData
  +-- EraTxCert

ShelleyBasedEra (everything from Shelley onwards)

Per-era extensions:
  AlonzoEraTxBody -> BabbageEraTxBody -> ConwayEraTxBody
  AlonzoEraTx (adds isValid field)
  AlonzoEraScript (adds Plutus)
```

The critical mechanism is `EraRule`:
```haskell
type family EraRule (rule :: Symbol) era

-- Conway overrides LEDGER, UTXO, CERTS, GOV
type instance EraRule "LEDGER" ConwayEra = ConwayLEDGER ConwayEra
-- Conway inherits POOL from Shelley
type instance EraRule "POOL" ConwayEra = ShelleyPOOL ShelleyEra
```

Each era can **override specific rules** while **inheriting unchanged ones**
from earlier eras.

### 3.7 Formal Specifications

The source of truth for ledger semantics is the
[Formal Specification](https://intersectmbo.github.io/formal-ledger-specifications/),
now being written in Agda. Historical eras have LaTeX specifications. The
CDDL files in `cardano-ledger` define the wire format for blocks and
transactions per era.

---

## 4. Networking Layer

The networking layer (`ouroboros-network`) handles peer-to-peer communication.

### 4.1 Multiplexer Design

All mini-protocols share a single TCP connection via a **multiplexer**. The
multiplexer:

- Splits mini-protocol output into **segments** (max 65,535 bytes payload).
- Adds an 8-byte header to each segment.
- Reassembles segments at the receiver into per-protocol byte streams.
- Is completely **agnostic** to the structure of multiplexed data.

#### Segment Data Unit (SDU) Format

```
Offset  Size  Field
0       4     Transmission time (lower 32 bits of monotonic clock, microseconds)
4       1 bit Mode (0=initiator, 1=responder)
4.1     15 bit Mini-protocol ID
6       2     Payload length N (bytes)
8       N     Payload
```

All fields are big-endian. Maximum SDU size for node-to-node: **12,288 bytes**.

#### Mini-Protocol IDs (Node-to-Node)

| ID | Protocol       |
|:---|:--------------|
| 0  | Handshake      |
| 2  | ChainSync      |
| 3  | BlockFetch     |
| 4  | TxSubmission2  |
| 8  | KeepAlive      |
| 10 | PeerSharing    |

#### Flow Control

Each mini-protocol implements its own flow control (via the state machine
agency mechanism). The demultiplexer has a fixed-size buffer per protocol.
If a peer overflows this buffer (violating the protocol), the connection is
terminated.

#### Fairness

The multiplexer uses **round-robin scheduling** of mini-protocols. When
presented with equal demand, it delivers equal service in terms of SDU
data rates. No mini-protocol can starve another.

### 4.2 Handshake Protocol

**Mini-protocol 0.** Runs before the multiplexer is fully initialized.
Messages must fit in a single SDU (max 5,760 bytes).

State machine:
```
StPropose --(MsgProposeVersions)--> StConfirm --(MsgAcceptVersion|MsgRefuse)--> End
```

The initiator proposes a set of version numbers with parameters. The responder
selects the highest mutually acceptable version. Current NTN versions: **11-14**
(with 13-14 preferred). Timeout: **10 seconds**.

Version parameters include: `networkMagic`, `initiatorOnlyDiffusionMode`,
`peerSharing`, `query` flag.

#### TCP Simultaneous Open

In rare cases where both sides connect simultaneously (TCP simultaneous open),
both send `MsgProposeVersions`. The protocol handles this by treating the
received proposal as a `MsgReplyVersion`.

### 4.3 ChainSync Protocol

**Mini-protocol 2.** Pull-based, transmits chains of **headers** (not full
blocks).

State machine:
```
StIdle --(MsgFindIntersect [point])--> StIntersect
StIntersect --(MsgIntersectFound point tip | MsgIntersectNotFound tip)--> StIdle
StIdle --(MsgRequestNext)--> StCanAwait
StCanAwait --(MsgRollForward header tip | MsgRollBackward point tip)--> StIdle
StCanAwait --(MsgAwaitReply)--> StMustReply
StMustReply --(MsgRollForward header tip | MsgRollBackward point tip)--> StIdle
StIdle --(MsgDone)--> End
```

Key points:
- One ChainSync client per upstream peer. Chain state tracked independently.
- `MsgFindIntersect` sends a list of known points (typically: tip, tip-1,
  tip-2, tip-4, tip-8, ..., genesis -- exponential backoff). The server
  finds the best intersection.
- `MsgAwaitReply` is sent when the server has no new headers (client is at
  tip). The client then waits in `StMustReply` until the server has new data.
- Connection terminated on: invalid header, fork deeper than `k`, protocol
  violation.

#### Pipelined Diffusion

The server can transmit a **tentative header** on top of its selected chain
before fully validating it. If the header turns out invalid, the server
announces this promptly. This optimization reduces diffusion latency -- nodes
announce blocks **before** full validation, not after.

Constraints:
- Only **one** tentative header at a time.
- Must be directly on top of the current selection.

### 4.4 BlockFetch Protocol

**Mini-protocol 3.** Pull-based, transmits block **bodies**.

State machine:
```
StIdle --(MsgRequestRange range)--> StBusy
StBusy --(MsgStartBatch)--> StStreaming
StStreaming --(MsgBlock body)--> StStreaming
StStreaming --(MsgBatchDone)--> StIdle
StBusy --(MsgNoBlocks)--> StIdle
StIdle --(MsgClientDone)--> End
```

Key points:
- One BlockFetch client per peer, but orchestrated by a **central decision
  component** that minimizes bandwidth by fetching each block from only one
  peer.
- Requests are for sequential ranges of blocks.
- Connection terminated on: unrequested blocks, header/body mismatch, invalid
  body, protocol violation.

### 4.5 TxSubmission2 Protocol

**Mini-protocol 4.** Pull-based. Transactions flow **opposite** to blocks:
from edge nodes toward block producers.

State machine:
```
StInit --(MsgInit)--> StIdle
StIdle --(MsgRequestTxIds{Blocking|NonBlocking} ack req)--> StTxIds{Blocking|NonBlocking}
StTxIds* --(MsgReplyTxIds [(id, size)])--> StIdle
StIdle --(MsgRequestTxs [id])--> StTxs
StTxs --(MsgReplyTxs [tx])--> StIdle
StTxIdsBlocking --(MsgDone)--> End
```

Note: agency is **inverted** compared to ChainSync/BlockFetch. The
"server" (responder) requests transaction IDs and bodies from the "client"
(initiator). This pull-based design provides natural **back-pressure**.

The `ack` parameter acknowledges previously received transaction IDs,
enabling flow control.

### 4.6 KeepAlive Protocol

**Mini-protocol 8.** Simple ping/pong for connection liveness and latency
measurement.

```
StClient --(MsgKeepAlive cookie)--> StServer --(MsgKeepAliveResponse cookie)--> StClient
StClient --(MsgDone)--> End
```

The cookie is echoed back for RTT measurement.

### 4.7 Peer Selection (P2P Governor)

The P2P Governor manages outbound connections, classifying peers into three
temperature tiers:

| Tier | Description | Activity |
|:-----|:-----------|:---------|
| **Cold** | Known but no connection | Discovery only |
| **Warm** | Connected, bearer active | Network measurements, no consensus |
| **Hot**  | Active consensus protocols | ChainSync, BlockFetch, TxSubmission2 |

Target valencies (configurable):
- Hot peers: ~20 for a relay
- Warm peers: ~20
- Cold peers: unlimited (known peer pool)

Peer sources:
- **Local root peers**: explicitly configured, always maintained.
- **Public root peers**: well-known bootstrap entry points.
- **Ledger peers**: discovered from on-chain stake pool registration data.
- **Bootstrap peers**: used during initial sync before ledger peers are available.
- **Peer sharing**: peers discovered via the PeerSharing mini-protocol.

The governor continuously promotes cold->warm->hot and demotes hot->warm->cold
to maintain target valencies and respond to peer quality metrics.

### 4.8 Connection Manager

The Connection Manager handles:
- Opening sockets and acquiring OS resources.
- Running the Handshake mini-protocol for version negotiation.
- Spawning the multiplexer thread.
- Managing uni- and bi-directional connections.
- Exception classification and propagation.
- Connection reuse for bidirectional connections (avoid duplicate connections
  between the same pair of nodes).

It operates in three modes: `InitiatorMode`, `ResponderMode`, and
`InitiatorResponderMode` (full duplex, used for node-to-node).

---

## 5. Storage Layer

The storage layer persists blocks and ledger state on behalf of the consensus
layer.

### 5.1 ChainDB Structure

The ChainDB is the central on-disk storage, organized into three subdirectories:

```
db/
  protocolMagicId    -- NetworkMagic marker file (prevents wrong-network usage)
  immutable/
    00000.chunk      -- Block data
    00000.primary    -- Slot-to-secondary-offset index
    00000.secondary  -- Block metadata (hash, offset, size)
    00001.chunk
    ...
  volatile/
    blocks-0.dat     -- Recent blocks (hash-indexed)
    ...
  ledger/
    164021355/
      state          -- CBOR-encoded LedgerState (minus UTxO)
      tables/
        tvar         -- UTxO set (V2InMemory backend)
      meta           -- Backend identifier + checksum
```

### 5.2 ImmutableDB

The ImmutableDB stores blocks that are **permanently part of the chain** --
blocks older than `k` from the tip that can never be rolled back.

#### Chunk Organization

Blocks are grouped into **chunks** (historically corresponding to epochs, but
the chunk size is configurable). Each chunk consists of three files:

1. **`.chunk` file**: raw serialized block data, concatenated sequentially.

2. **`.primary` index**: maps relative slot numbers to offsets in the secondary
   index. Format:
   - Starts with a version number.
   - Followed by `Word32` offsets, one per slot in the chunk.
   - Empty slots are indicated by repeating the previous offset.
   - Example for slots 0,1,_,_,4 filled: `[0, x, y, y, y, z]` where x,y,z
     are multiples of the secondary entry size.

3. **`.secondary` index**: stores per-block metadata:
   - `headerOffset` (offset within chunk to header start)
   - `headerSize`
   - `headerHash`
   - `blockOrEBB` (stored as `Word64`: either EpochNo for EBBs or SlotNo)

#### Backfilling

When slots are skipped (no block produced), the primary index is **backfilled**
with repeated offsets. Before starting a new chunk, the current chunk's primary
index is backfilled for all remaining empty slots.

#### Append-Only Semantics

Blocks are only ever appended. The `intCopyToImmutableDB` function copies
blocks from the VolatileDB to the ImmutableDB when they become immutable
(older than `k` from tip).

### 5.3 VolatileDB

The VolatileDB stores recent blocks that have not yet become immutable. Unlike
the ImmutableDB (ordered by slot), the VolatileDB is **hash-indexed** because
multiple competing forks may exist simultaneously.

Key operations:
- **`putBlock`**: store a block by its hash.
- **`getBlockComponent`**: retrieve a block by hash.
- **`filterByPredecessor`**: returns a successor map, enabling the chain
  selection algorithm to construct all possible chains from the immutable tip.
- **Garbage collection**: blocks are garbage-collected after a configurable
  delay (`cdbGcDelay`) following their copy to the ImmutableDB.

The VolatileDB stores blocks in `.dat` files with an in-memory index.

### 5.4 LedgerDB

The LedgerDB manages the ledger state -- the result of applying all blocks to
the initial (genesis) state. It stores:

- The current ledger state at the chain tip.
- Past `k` ledger states for rollback support.
- Periodic snapshots to enable fast restart.

#### Backends

Three implementations exist:

| Backend      | UTxO Storage | Memory Usage | Notes |
|:------------|:-------------|:-------------|:------|
| V2InMemory   | All in RAM    | ~24 GB (mainnet) | Default historically |
| V1LMDB       | LMDB on disk  | ~4-8 GB          | New in node 10.4.1 |
| V1InMemory   | In RAM        | N/A              | Not for production |

The **V1LMDB** backend uses LMDB (Lightning Memory-mapped Database) to store
UTxO diffs on disk. Rather than holding the full UTxO set in RAM, it maintains
a sliding window of recent changes and reads older state from disk via
memory-mapped files.

Configuration parameters:
- `FlushFrequency`: number of immutable blocks before flushing diffs to disk
  (default: 100).
- `MapSize`: LMDB database size (default: 16 GB; on Linux, file grows
  progressively; on Windows, allocated immediately).

#### Snapshots

Snapshots are taken periodically at immutable block tips. Each snapshot
consists of:
- `<slotno>/state`: CBOR-encoded LedgerState (minus UTxO)
- `<slotno>/tables/`: UTxO data (format depends on backend)
- `<slotno>/meta`: backend identifier and checksum

#### Forker Interface

The LedgerDB exposes a `Forker` and `ReadOnlyForker` interface for evaluating
forks -- allowing the consensus layer to speculatively apply blocks on
alternative chains without modifying the main state.

#### Future: LSM-Tree Backend

An LSM-tree (Log-Structured Merge Tree) backend is under development as the
next-generation on-disk storage, replacing LMDB.

### 5.5 Chain Diffusion and Storage

Storage serves data to the networking layer for chain diffusion:

- **Immutable blocks**: served via sequential iterators for ChainSync/
  BlockFetch to syncing peers.
- **Volatile blocks**: served for the current selection to caught-up peers.
- Blocks becoming immutable must be handled transparently -- a BlockFetch
  iterator that was reading from volatile storage may need to follow a block
  to immutable storage.

### 5.6 ACID Properties

The storage layer does **not** need full ACID durability. If data is lost,
upstream peers can always resupply blocks. This simplifies the implementation
considerably.

### 5.7 Tooling

- **`db-analyser`**: analyze ChainDB contents, produce ledger snapshots.
- **`db-synthesizer`**: generate synthetic chains for benchmarking.
- **`db-truncater`**: truncate an ImmutableDB.
- **`db-immutaliser`**: convert volatile suffix to immutable.
- **`immdb-server`**: serve ImmutableDB via ChainSync/BlockFetch without
  running a full node.
- **`snapshot-converter`**: convert between snapshot formats (legacy, V2InMemory,
  V1LMDB).

---

## 6. Node Orchestration

### 6.1 NodeKernel

The `NodeKernel` is the central coordination point, initialized by
`initNodeKernel`. It owns:

- The **ChainDB** (ImmutableDB + VolatileDB + LedgerDB).
- The **Mempool**.
- The **block forging thread** (if forging credentials are configured).
- References to all running mini-protocol instances.

### 6.2 Block Flow: Network to Ledger to Storage

The complete flow of a block through the system:

1. **ChainSync** client receives a new header from an upstream peer.
2. **Consensus** validates the header (envelope + protocol checks) using the
   chain state at the intersection point.
3. If the candidate chain (with new header) is better than the current
   selection, **BlockFetch** is directed to download the block body.
4. BlockFetch retrieves the body and submits it to the **ChainDB** via
   `addBlockAsync`.
5. The ChainDB's block processing thread:
   a. Stores the block in the **VolatileDB**.
   b. Runs **chain selection** considering all known blocks.
   c. If a new best chain is found, invokes the **Ledger** to validate and
      apply the block(s) (BBODY -> LEDGERS -> ... rule hierarchy).
   d. Updates the **LedgerDB** with the new ledger state.
   e. If blocks have become immutable (chain grew past `k`), copies them to
      the **ImmutableDB** and garbage-collects them from VolatileDB.
6. The **Mempool** is notified of the new chain tip. Transactions included in
   the new block are removed. Remaining transactions are revalidated against
   the new ledger state (dynamic checks only).
7. **ChainSync** servers announce the new tip to downstream peers.
8. **BlockFetch** servers make the new block available for download.
9. **TxSubmission2** may remove announced transaction IDs that are now in blocks.

### 6.3 Block Forging Pipeline

Every slot, the forging thread:

1. Checks if the node is a slot leader (VRF evaluation).
2. If elected:
   a. Gets a **snapshot** of validated transactions from the Mempool.
   b. Selects transactions that fit within the max block body size
      (`txInBlockSize` estimation).
   c. Constructs the block body.
   d. Produces the block header (previous hash, VRF proofs, KES signature,
      opcert, body hash).
   e. Submits the forged block to ChainDB via `addBlockAsync`.
   f. Waits for `blockProcessed` confirmation.
3. If the forged block is adopted: success.
4. If the forged block is rejected: all its transactions are purged from the
   Mempool (safety measure against mempool/forge validation inconsistency).

### 6.4 Mempool Integration

The Mempool stores transactions valid on top of the current chain tip's ledger
state. Key properties:

- **Snapshot acquisition** must be fast (critical path for block forging).
- **Cursor-like access** for TxSubmission2 diffusion.
- **Revalidation** on chain tip change: discard transactions that became
  invalid on the new selection.
- **Back-pressure**: limits on total byte size, CPU execution units, and
  memory execution units prevent resource exhaustion.
- **Transaction translation**: the Ledger can translate older-era transactions
  to the current era for validation, but the original bytes are forwarded
  to peers (no re-serialization).

When a node shuts down, the Haskell implementation discards pending
transactions. Alternative implementations may choose to persist them.

### 6.5 Startup and Recovery

On startup, `cardano-node`:

1. Reads the configuration file (node config, topology, genesis files).
2. Verifies the `NetworkMagic` marker in the database directory.
3. Opens the **ImmutableDB** (validates chunk files if needed).
4. Opens the **VolatileDB** (indexes all stored blocks).
5. Loads the most recent **LedgerDB snapshot**.
6. Replays blocks from the snapshot slot to the current tip (applying them
   without full validation, since they are trusted local blocks).
7. Initializes the **NodeKernel** (Mempool, forging thread, etc.).
8. Starts the **connection manager** and **P2P governor**.
9. Begins ChainSync/BlockFetch with peers.

If the snapshot is old, replay can take significant time. The `db-analyser`
tool can produce fresh snapshots offline.

### 6.6 Graceful Shutdown

On SIGINT/SIGTERM:

1. Stop accepting new connections.
2. Signal all mini-protocol threads to terminate.
3. Flush any pending LedgerDB snapshot.
4. Close ChainDB (ImmutableDB, VolatileDB, LedgerDB) cleanly.
5. Exit.

---

## 7. Key Parameters and Constants

| Parameter | Value (Mainnet) | Description |
|:----------|:---------------|:------------|
| `k`       | 2160 blocks     | Security parameter (max rollback) |
| `f`       | 0.05            | Active slot coefficient |
| Slot duration | 1 second    | Time per slot |
| Epoch length | 432,000 slots | 5 days |
| KES period | 129,600 slots  | ~36 hours |
| Forecast range | `3k/f` = 129,600 slots | How far ahead ledger view can predict |
| Genesis window | `3k/f` = 129,600 slots | Density comparison window |
| Max SDU payload | 65,535 bytes | Multiplexer segment limit |
| NtN SDU limit | 12,288 bytes  | Cardano node SDU size |
| Handshake limit | 5,760 bytes | Max handshake message size |
| Handshake timeout | 10 seconds | Max handshake wait time |
| NtN versions | 11-14         | Supported protocol versions |
| Network magic (mainnet) | 764824073 | Network identifier |
| Network magic (preprod) | 1         | Preprod testnet |
| Network magic (preview) | 2         | Preview testnet |

---

## 8. References

### Primary Sources

- [Cardano Blueprint: Consensus](https://cardano-scaling.github.io/cardano-blueprint/consensus/)
  -- Implementation-agnostic reference for the consensus layer.
- [Cardano Blueprint: Ledger](https://cardano-scaling.github.io/cardano-blueprint/ledger/)
  -- Ledger rules and block validation.
- [Cardano Blueprint: Network](https://cardano-scaling.github.io/cardano-blueprint/network/)
  -- Mini-protocol specifications.
- [Cardano Blueprint: Storage](https://cardano-scaling.github.io/cardano-blueprint/storage/)
  -- ChainDB format and requirements.
- [Cardano Blueprint: Mempool](https://cardano-scaling.github.io/cardano-blueprint/mempool/)
  -- Mempool requirements and design.

### Technical Reports

- [The Cardano Consensus and Storage Layer](https://ouroboros-consensus.cardano.intersectmbo.org/pdfs/report.pdf)
  -- Edsko de Vries, Thomas Winant, Duncan Coutts (IOHK, 2020). Deep design
  choices and non-trivial lemmas.
- [Ouroboros Network Specification](https://ouroboros-network.cardano.intersectmbo.org/pdfs/network-spec/network-spec.pdf)
  -- Duncan Coutts, Neil Davies, Marc Fontaine. Mini-protocol definitions,
  multiplexer design.
- [Data Diffusion and Network Design](https://ouroboros-network.cardano.intersectmbo.org/pdfs/network-design/network-design.pdf)
  -- Original P2P network protocol design document.

### Research Papers

- [Ouroboros Classic](https://iohk.io/en/research/library/papers/ouroboros-a-provably-secure-proof-of-stake-blockchain-protocol/)
  -- Original proof-of-stake protocol.
- [Ouroboros BFT](https://iohk.io/en/research/library/papers/ouroboros-bft-a-simple-byzantine-fault-tolerant-consensus-protocol/)
  -- Byzantine fault tolerant variant.
- [Ouroboros Praos](https://iohk.io/en/research/library/papers/ouroboros-praos-an-adaptively-secure-semi-synchronous-proof-of-stake-protocol/)
  -- Adaptive security, VRF-based leader election.
- [Ouroboros Genesis](https://iohk.io/en/research/library/papers/ouroboros-genesis-composable-proof-of-stake-blockchains-with-dynamic-availability/)
  -- Density-based chain selection for syncing nodes.

### Repositories

- [IntersectMBO/ouroboros-consensus](https://github.com/IntersectMBO/ouroboros-consensus)
  -- Consensus layer implementation.
- [IntersectMBO/ouroboros-network](https://github.com/IntersectMBO/ouroboros-network)
  -- Networking layer implementation.
- [IntersectMBO/cardano-ledger](https://github.com/IntersectMBO/cardano-ledger)
  -- Ledger rules for all eras.
- [IntersectMBO/cardano-node](https://github.com/IntersectMBO/cardano-node)
  -- Node orchestration binary.
- [IntersectMBO/formal-ledger-specifications](https://github.com/IntersectMBO/formal-ledger-specifications)
  -- Agda formal specifications.

### Documentation Sites

- [ouroboros-consensus documentation](https://ouroboros-consensus.cardano.intersectmbo.org/)
  -- Developer articles and Haddock docs.
- [cardano-ledger Haddock](https://cardano-ledger.cardano.intersectmbo.org/)
  -- API documentation for all ledger packages.
- [Cardano Docs: Architecture](https://docs.cardano.org/about-cardano/explore-more/cardano-architecture)
  -- High-level architecture overview.
- [Cardano Docs: Networking Protocol](https://docs.cardano.org/about-cardano/explore-more/cardano-network/networking-protocol)
  -- Multiplexer and protocol overview.
- [CIP-0084: Cardano Ledger Evolution](https://cips.cardano.org/cip/CIP-0084)
  -- Standards for ledger STS specifications.

### Blog Posts

- [The Abstract Nature of the Cardano Consensus Layer](https://well-typed.com/blog/2020/05/the-abstract-nature-of-the-cardano-consensus-layer/)
  -- Well-Typed blog on the type-level abstractions in consensus.
- [Ouroboros Genesis Design Update](https://www.iog.io/news/ouroboros-genesis-design-update)
  -- Genesis implementation details.
- [Inside cardano-node](https://www.sandstone.io/blog/inside-cardano-node)
  -- Deep dive into the node software.

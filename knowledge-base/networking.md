---
---
# Networking

Reference for the Ouroboros network layer used in Cardano.
Based on the [Ouroboros Network Specification](https://ouroboros-network.cardano.intersectmbo.org/pdfs/network-spec/network-spec.pdf),
the [Cardano Blueprint](https://cardano-scaling.github.io/cardano-blueprint/network/index.html),
and the [ouroboros-network repository](https://github.com/IntersectMBO/ouroboros-network).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Typed-Protocols Framework](#2-typed-protocols-framework)
3. [Multiplexer (MUX)](#3-multiplexer-mux)
4. [Node-to-Node vs Node-to-Client](#4-node-to-node-vs-node-to-client)
5. [Handshake Protocol](#5-handshake-protocol)
6. [ChainSync Protocol](#6-chainsync-protocol)
7. [BlockFetch Protocol](#7-blockfetch-protocol)
8. [TxSubmission2 Protocol](#8-txsubmission2-protocol)
9. [KeepAlive Protocol](#9-keepalive-protocol)
10. [PeerSharing Protocol](#10-peersharing-protocol)
11. [Peer Selection Governor](#11-peer-selection-governor)
12. [Wire Format Reference](#12-wire-format-reference)

---

## 1. Architecture Overview

The Ouroboros network layer is the **diffusion layer** of the Cardano Node. It
manages all peer-to-peer communication using a set of **mini-protocols** that
run over a **multiplexer** sharing a single TCP connection per peer.

```
+-------------------------------------------------------------------+
|                        Cardano Node                               |
|                                                                   |
|  +------------+  +-----------+  +-----------+  +----------+      |
|  | ChainSync  |  | BlockFetch|  | TxSubmit2 |  | KeepAlive|  ... |
|  +-----+------+  +-----+-----+  +-----+-----+  +----+-----+     |
|        |              |              |              |              |
|  +-----+--------------+--------------+--------------+------+      |
|  |              Multiplexer (MUX/DEMUX)                    |      |
|  +----------------------------+----------------------------+      |
|                               |                                   |
+-------------------------------+-----------------------------------+
                                |
                          TCP Connection
                                |
+-------------------------------+-----------------------------------+
|                               |                                   |
|  +----------------------------+----------------------------+      |
|  |              Multiplexer (MUX/DEMUX)                    |      |
|  +-----+--------------+--------------+--------------+------+      |
|        |              |              |              |              |
|  +-----+------+  +-----+-----+  +-----+-----+  +----+-----+     |
|  | ChainSync  |  | BlockFetch|  | TxSubmit2 |  | KeepAlive|  ... |
|  +------------+  +-----------+  +-----------+  +----------+      |
|                                                                   |
|                        Cardano Node                               |
+-------------------------------------------------------------------+
```

The handshake mini-protocol runs **before** the multiplexer is fully
initialized. All other mini-protocols run concurrently over the mux once
the handshake succeeds.

---

## 2. Typed-Protocols Framework

### Agency Model

Every mini-protocol is defined as a **state machine** where each state has
exactly one party with **agency** -- the right to send the next message. The
two parties are:

- **Initiator** (client): the side that opened the connection
- **Responder** (server): the side that accepted the connection

Agency alternates between parties as messages are exchanged. The framework
**guarantees at the type level** (in Haskell via GADTs / session types) that:

1. Only the party with agency can send a message
2. Messages are valid only for the current state
3. The protocol terminates correctly

### Peer Roles

```
  Initiator                         Responder
  =========                         =========

  Has agency first.                 Waits for initiator.
  Sends requests.                   Sends responses.
  Drives the protocol.              Reacts to requests.

  In NtN: the node that             In NtN: the node that
  opened the TCP connection.        accepted the connection.
```

For **TxSubmission2**, the roles are intentionally reversed: the responder
(server) drives the protocol by requesting transaction IDs and bodies from
the initiator (client). This is because transactions flow **upstream**
(toward block producers), opposite to blocks.

### Protocol Pipelining

The typed-protocols framework supports **pipelining**: sending multiple
requests before collecting responses. This is tracked by a type-level
natural number `n` counting outstanding (uncollected) responses.

- `SendMsgRequestNextPipelined` -- send without waiting (increments `n`)
- `CollectResponse` -- collect one response (decrements `n`)
- Non-pipelined operations (`MsgFindIntersect`, `MsgDone`) require `n = 0`

Pipelining is critical for ChainSync performance during initial sync, where
round-trip latency would otherwise dominate.

---

## 3. Multiplexer (MUX)

### Overview

The multiplexer provides:
- **Multiplexing** of multiple mini-protocols over a single TCP bearer
- **Framing and segmentation** of messages within the byte stream
- **Timing information** for latency measurement

### SDU (Segment Data Unit) Format

Each segment has an **8-byte header** followed by a variable-length payload:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Transmission Time (32-bit)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|M|     Mini-Protocol ID (15-bit)     |    Payload Length (16-bit)|
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                                 |
|                        Payload (N bytes)                        |
|                                                                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field              | Bits  | Description                                        |
|:-------------------|:------|:---------------------------------------------------|
| Transmission time  | 32    | Monotonic timestamp in microseconds (lowest 32 bits) |
| M (Mode)           | 1     | 0 = from initiator, 1 = from responder             |
| Mini-protocol ID   | 15    | Identifies which mini-protocol this segment belongs to |
| Payload length     | 16    | Segment payload size in bytes (0..65535)            |
| Payload            | N * 8 | Raw payload data                                   |

All header fields are **big-endian** (network byte order).

### Encoding/Decoding (Python)

```python
import struct, time

MUX_HEADER_SIZE = 8
MODE_BIT = 0x8000

def encode_header(proto_id: int, payload_length: int, is_responder: bool) -> bytes:
    timestamp = int(time.monotonic() * 1_000_000) & 0xFFFFFFFF
    id_field = proto_id | (MODE_BIT if is_responder else 0)
    return struct.pack(">IHH", timestamp, id_field, payload_length)

def decode_header(data: bytes) -> tuple[int, int, bool, int]:
    timestamp, id_field, length = struct.unpack(">IHH", data)
    is_responder = bool(id_field & MODE_BIT)
    proto_id = id_field & 0x7FFF
    return timestamp, proto_id, is_responder, length
```

### Segmentation

Messages larger than the maximum segment payload (65535 bytes for the wire
format, but Cardano Node uses **12,288 bytes** for NtN) are split into
multiple segments. The receiver reassembles them by concatenating payloads
with the same protocol ID until a complete CBOR item is formed.

There is **no explicit "start of message" flag** or segment counter in the
wire format. Message boundaries are determined entirely by CBOR framing:
the receiver parses accumulated bytes and extracts complete CBOR items.

### Flow Control

The multiplexer provides **no explicit flow control**. Each mini-protocol
is responsible for its own flow control via the state machine (agency
rules ensure at most one outstanding request at a time, unless pipelining
is used).

A fixed-size buffer sits between the demultiplexer egress and each
mini-protocol's ingress. If a peer sends data that overflows this buffer
(violating the protocol), the connection is terminated.

### Mini-Protocol IDs

| ID  | Protocol (NtN)     | ID  | Protocol (NtC)     |
|:---:|:-------------------|:---:|:-------------------|
| 0   | Handshake          | 0   | Handshake          |
| 2   | ChainSync (headers)| 5   | ChainSync (blocks) |
| 3   | BlockFetch         | 6   | LocalTxSubmission   |
| 4   | TxSubmission2      | 7   | LocalStateQuery     |
| 8   | KeepAlive          | 9   | LocalTxMonitor      |
| 10  | PeerSharing        |     |                     |

---

## 4. Node-to-Node vs Node-to-Client

### Node-to-Node (NtN)

Used for inter-node communication over TCP across the Internet. The current
protocol version is **v14**.

Mini-protocols: Handshake, ChainSync (headers only), BlockFetch,
TxSubmission2, KeepAlive, PeerSharing.

### Node-to-Client (NtC)

Used for local communication over Unix domain sockets (or named pipes on
Windows) between the node and local clients (wallets, CLI tools, db-sync).

Mini-protocols: Handshake, ChainSync (full blocks), LocalTxSubmission,
LocalStateQuery, LocalTxMonitor.

### Key Differences

| Aspect             | NtN                           | NtC                            |
|:-------------------|:------------------------------|:-------------------------------|
| Transport          | TCP                           | Unix domain socket / named pipe|
| ChainSync          | Block headers only            | Full blocks (no BlockFetch needed) |
| BlockFetch         | Yes                           | No                             |
| TxSubmission       | TxSubmission2 (pull-based, trustless) | LocalTxSubmission (request/response) |
| State queries      | No                            | LocalStateQuery                |
| Mempool monitor    | No                            | LocalTxMonitor                 |
| KeepAlive          | Yes                           | No                             |
| PeerSharing        | Yes                           | No                             |
| Max SDU payload    | 12,288 bytes                  | 12,288 bytes (24,576 on Windows) |

---

## 5. Handshake Protocol

**Mini-protocol number: 0**

The handshake runs before the multiplexer is fully initialized. Each
handshake message must fit in a **single mux segment** (max 5,760 bytes).

### State Machine

```
                        +------------------+
                        |    StPropose     |  <-- Initiator has agency
                        +--------+---------+
                                 |
                    MsgProposeVersions(versionTable)
                                 |
                                 v
                        +------------------+
                        |    StConfirm     |  <-- Responder has agency
                        +--+------+-----+--+
                           |      |     |
         MsgAcceptVersion  |      |     |  MsgRefuse(reason)
         (version, data)   |      |     |
                           v      |     v
                         [End]    |   [End]
                                  |
                     MsgReplyVersion(versionTable)
                                  |    (TCP simultaneous open case)
                                  v
                                [End]
```

### Agency Table

| State      | Agency    |
|:-----------|:----------|
| StPropose  | Initiator |
| StConfirm  | Responder |

### Messages

| From       | Message              | Parameters                       | To    |
|:-----------|:---------------------|:---------------------------------|:------|
| StPropose  | MsgProposeVersions   | `versionTable`                   | StConfirm |
| StConfirm  | MsgAcceptVersion     | `(versionNumber, versionData)`   | End   |
| StConfirm  | MsgReplyVersion      | `versionTable`                   | End   |
| StConfirm  | MsgRefuse            | `reason`                         | End   |

### CDDL

```cddl
; NodeToNode Handshake (>=v13)

handshakeMessage
    = msgProposeVersions
    / msgAcceptVersion
    / msgRefuse
    / msgQueryReply

msgProposeVersions = [0, versionTable]
msgAcceptVersion   = [1, versionNumber, nodeToNodeVersionData]
msgRefuse          = [2, refuseReason]
msgQueryReply      = [3, versionTable]

versionTable = { * versionNumber => nodeToNodeVersionData }

versionNumber = 13 / 14

nodeToNodeVersionData = [ networkMagic,
                          initiatorOnlyDiffusionMode,
                          peerSharing,
                          query ]

; range between 0 and 0xffffffff
networkMagic = 0..4294967295
initiatorOnlyDiffusionMode = bool
; 0 = disabled, 1 = enabled
peerSharing = 0..1
query = bool

refuseReason
    = refuseReasonVersionMismatch
    / refuseReasonHandshakeDecodeError
    / refuseReasonRefused

refuseReasonVersionMismatch      = [0, [ *versionNumber ] ]
refuseReasonHandshakeDecodeError = [1, versionNumber, tstr]
refuseReasonRefused              = [2, versionNumber, tstr]
```

### Version Data Fields

| Field                       | Type   | Description |
|:----------------------------|:-------|:------------|
| `networkMagic`              | uint32 | Network identifier (764824073=mainnet, 1=preprod, 2=preview) |
| `initiatorOnlyDiffusionMode`| bool   | `true` = initiator-only mode (no server), `false` = initiator+responder |
| `peerSharing`               | 0..1   | 0 = peer sharing disabled, 1 = peer sharing enabled |
| `query`                     | bool   | `true` = query mode (handshake only, then disconnect) |

### Version History

| Version | Introduced With | Key Features |
|:--------|:---------------|:-------------|
| v7      | Pre-Alonzo     | Full duplex connections |
| v11     | Conway         | Conway era support |
| v13     | Post-Chang     | Current minimum supported version |
| v14     | Current        | Latest NtN version |

Versions below v13 have been removed from the Haskell reference
implementation. Nodes that cannot cross the Chang hard fork are no longer
supported.

### Negotiation Algorithm

1. Initiator sends `MsgProposeVersions` with a map of all versions it supports.
2. Responder computes the **intersection** of proposed and locally supported versions.
3. If the intersection is non-empty, responder picks the **highest** common version and replies with `MsgAcceptVersion`.
4. If empty, responder replies with `MsgRefuse(VersionMismatch, [supported_versions])`.

### TCP Simultaneous Open

In the rare case where both sides try to connect simultaneously, TCP may
produce a single socket where both sides think they are the initiator.
Both send `MsgProposeVersions`. When a node in `StConfirm` receives a
propose message, it treats it as `MsgReplyVersion` and performs version
negotiation as the responder would.

### Timeouts

The maximum time to wait for a response is **10 seconds**. After this, the
connection is torn down.

---

## 6. ChainSync Protocol

**Mini-protocol number: 2**

ChainSync is a pull-based protocol for synchronizing the chain of block
headers. The client follows the server's selected chain. There is typically
**one ChainSync client per peer**.

### Purpose

- Acquire and validate headers from the server's selected chain
- If the server's chain is better, direct BlockFetch to download the blocks
- Track each peer's chain state independently

### State Machine

```
                  +-------------------+
           +----->|      StIdle       |<---------+--------+
           |      | (Initiator agency)|          |        |
           |      +--+------+-----+--+          |        |
           |         |      |     |              |        |
           |  MsgReq |  MsgFind  |  MsgDone     |        |
           |  Next   |  Intersect|     |         |        |
           |         v      v     v    v         |        |
           |   +----------+ +----------+  [End]  |        |
           |   |StCanAwait| |StIntersect|        |        |
           |   |(Responder)| |(Responder)|        |        |
           |   +--+--+----+ +----+-----+        |        |
           |      |  |           |     |         |        |
           |   Roll  MsgAwait  Found NotFound    |        |
           |   Fwd/  Reply       |     |         |        |
           |   Back    |         +-----+---------+        |
           |      |    v                                   |
           |      | +------------+                         |
           |      | |StMustReply |                         |
           |      | |(Responder) |                         |
           |      | +--+--+-----+                         |
           |      |    |  |                                |
           |      | RollFwd RollBack                       |
           +------+----+--+-------------------------------+
```

### Agency Table

| State        | Agency    |
|:-------------|:----------|
| StIdle       | Initiator |
| StCanAwait   | Responder |
| StMustReply  | Responder |
| StIntersect  | Responder |

### Message Table

| From         | Message              | Parameters                 | To           |
|:-------------|:---------------------|:---------------------------|:-------------|
| StIdle       | MsgRequestNext       | --                         | StCanAwait   |
| StIdle       | MsgFindIntersect     | `[point]`                  | StIntersect  |
| StIdle       | MsgDone              | --                         | End          |
| StCanAwait   | MsgAwaitReply        | --                         | StMustReply  |
| StCanAwait   | MsgRollForward       | `header`, `tip`            | StIdle       |
| StCanAwait   | MsgRollBackward      | `point`, `tip`             | StIdle       |
| StMustReply  | MsgRollForward       | `header`, `tip`            | StIdle       |
| StMustReply  | MsgRollBackward      | `point`, `tip`             | StIdle       |
| StIntersect  | MsgIntersectFound    | `point`, `tip`             | StIdle       |
| StIntersect  | MsgIntersectNotFound | `tip`                      | StIdle       |

### Protocol Flow

**Finding Intersection (initial sync):**

```
Client                                     Server
  |                                          |
  |---MsgFindIntersect([pt_a, pt_b, ...])-->|
  |                                          |
  |<---MsgIntersectFound(pt_b, tip)----------|  (common point found)
  |                                          |
  |---MsgRequestNext----------------------->|
  |                                          |
  |<---MsgRollForward(header_1, tip)---------|
  |                                          |
  |---MsgRequestNext----------------------->|
  |                                          |
  |<---MsgRollForward(header_2, tip)---------|
  |            ... continues ...             |
```

**At the tip (caught up):**

```
Client                                     Server
  |                                          |
  |---MsgRequestNext----------------------->|
  |                                          |
  |<---MsgAwaitReply-------------------------| (no new block yet)
  |                                          |
  |          ... time passes ...             |
  |                                          |
  |<---MsgRollForward(header_N, tip)---------| (new block arrives)
  |                                          |
```

**Rollback:**

```
Client                                     Server
  |                                          |
  |---MsgRequestNext----------------------->|
  |                                          |
  |<---MsgRollBackward(pt_old, tip)----------| (chain switched)
  |                                          |
  |---MsgRequestNext----------------------->|
  |                                          |
  |<---MsgRollForward(header_new, tip)-------| (new chain head)
  |                                          |
```

### CDDL

```cddl
chainSyncMessage
    = msgRequestNext
    / msgAwaitReply
    / msgRollForward
    / msgRollBackward
    / msgFindIntersect
    / msgIntersectFound
    / msgIntersectNotFound
    / chainSyncMsgDone

msgRequestNext         = [0]
msgAwaitReply          = [1]
msgRollForward         = [2, header, tip]
msgRollBackward        = [3, point, tip]
msgFindIntersect       = [4, [* point]]
msgIntersectFound      = [5, point, tip]
msgIntersectNotFound   = [6, tip]
chainSyncMsgDone       = [7]

tip = [ point, blockNo ]

point = []                         ; the genesis point
      / [ slotNo, hash ]          ; specific point (slot + block hash)
```

### Header Encoding (NtN)

Headers are era-tagged and wrapped in CBOR-in-CBOR (`#6.24`):

```cddl
header
 = ns7<byronHeader,
       serialisedShelleyHeader<shelley.header>,
       serialisedShelleyHeader<allegra.header>,
       serialisedShelleyHeader<mary.header>,
       serialisedShelleyHeader<alonzo.header>,
       serialisedShelleyHeader<babbage.header>,
       serialisedShelleyHeader<conway.header>>

; Era tag encoding: [era_index, era_specific_data]
; ns7<a,b,c,d,e,f,g> = [6, g] / [5, f] / [4, e] / [3, d]
;                     / [2, c] / [1, b] / [0, a]

; Byron has two sub-variants:
byronHeader = [byronRegularIdx, #6.24(bytes .cbor byron.blockhead)]
            / [byronBoundaryIdx, #6.24(bytes .cbor byron.ebbhead)]

byronBoundaryIdx = [0, word32]
byronRegularIdx  = [1, word32]

; Post-Byron headers are CBOR-in-CBOR:
serialisedShelleyHeader<era> = #6.24(bytes .cbor era)
```

For example, a Conway header on the wire: `[6, #6.24(<cbor-encoded-conway-header>)]`

### ChainSync Pipelining (Block Diffusion Pipelining)

Not to be confused with *protocol pipelining* (sending multiple requests).
**Block diffusion pipelining** allows a server to announce a **tentative**
header -- a header for a block that has not yet been fully validated. This
shortens diffusion latency because nodes do not wait for full validation
before announcing.

Rules:
- At most **one** tentative header can be pipelined, and it must be the tip
- If the pipelined block turns out invalid, the server announces the
  rollback promptly
- The client may optimistically request the block body via BlockFetch

### Misbehavior Detection

The connection is terminated if the peer:
- Violates the state machine
- Sends an invalid header
- Announces a fork deeper than `k` blocks from the client's current selection

---

## 7. BlockFetch Protocol

**Mini-protocol number: 3**

BlockFetch downloads block bodies in ranges. It is pull-based: the client
decides which blocks to fetch based on headers received via ChainSync.

A **central BlockFetch decision component** orchestrates fetching across all
peers to minimize redundant downloads.

### State Machine

```
              +------------------+
       +----->|     StIdle       |<-------+
       |      | (Initiator)      |        |
       |      +--+----------+---+        |
       |         |          |             |
       |   MsgRequest  MsgClient         |
       |   Range        Done             |
       |         |          |             |
       |         v          v             |
       |   +----------+  [End]           |
       |   |  StBusy   |                  |
       |   | (Responder)|                  |
       |   +--+-----+--+                  |
       |      |     |                     |
       |  MsgNo  MsgStart                |
       |  Blocks  Batch                  |
       |      |     |                     |
       |      |     v                     |
       |      | +-------------+           |
       |      | | StStreaming  |           |
       |      | | (Responder)  |           |
       |      | +--+-------+--+           |
       |      |    |       |              |
       |      | MsgBlock MsgBatch        |
       |      |    |   (loop) Done        |
       |      |    +---+   |              |
       +------+---------+--+--------------+
```

### Agency Table

| State       | Agency    |
|:------------|:----------|
| StIdle      | Initiator |
| StBusy      | Responder |
| StStreaming  | Responder |

### Message Table

| From        | Message         | Parameters              | To          |
|:------------|:----------------|:------------------------|:------------|
| StIdle      | MsgRequestRange | `(point_from, point_to)`| StBusy      |
| StIdle      | MsgClientDone   | --                      | End         |
| StBusy      | MsgStartBatch   | --                      | StStreaming  |
| StBusy      | MsgNoBlocks     | --                      | StIdle      |
| StStreaming  | MsgBlock        | `block`                 | StStreaming  |
| StStreaming  | MsgBatchDone    | --                      | StIdle      |

### Protocol Flow

```
Client                                     Server
  |                                          |
  |---MsgRequestRange(pt_from, pt_to)------>|
  |                                          |
  |<---MsgStartBatch------------------------|
  |                                          |
  |<---MsgBlock(block_1)--------------------|
  |<---MsgBlock(block_2)--------------------|
  |<---MsgBlock(block_3)--------------------|
  |                                          |
  |<---MsgBatchDone--------------------------|
  |                                          |
  |---MsgRequestRange(...)----------------->|  (next range)
  |            ... or ...                    |
  |---MsgClientDone------------------------>|
```

**When the range is unavailable:**

```
Client                                     Server
  |                                          |
  |---MsgRequestRange(pt_from, pt_to)------>|
  |                                          |
  |<---MsgNoBlocks--------------------------|
  |                                          |
```

### CDDL

```cddl
blockFetchMessage
     = msgRequestRange
     / msgClientDone
     / msgStartBatch
     / msgNoBlocks
     / msgBlock
     / msgBatchDone

msgRequestRange = [0, point, point]
msgClientDone   = [1]
msgStartBatch   = [2]
msgNoBlocks     = [3]
msgBlock        = [4, block]
msgBatchDone    = [5]

point = []                         ; the genesis point
      / [ slotNo, hash ]
```

### Block Encoding

Blocks are era-tagged and wrapped in CBOR-in-CBOR:

```cddl
serialisedCardanoBlock = #6.24(bytes .cbor cardanoBlock)

cardanoBlock = byron.block          ; tag 0 (EBB) or tag 1 (regular)
             / [2, shelley.block]
             / [3, allegra.block]
             / [4, mary.block]
             / [5, alonzo.block]
             / [6, babbage.block]
             / [7, conway.block]
```

### Interaction with ChainSync

The typical flow is:

1. **ChainSync** streams headers from each peer
2. The **chain selection** logic determines which chain is best
3. The **BlockFetch decision logic** computes which block ranges to fetch
   and from which peer (minimizing redundancy)
4. **BlockFetch** downloads the ranges
5. Downloaded blocks are validated and applied to the ledger state

### Misbehavior Detection

The connection is terminated if the peer:
- Violates the state machine
- Sends blocks that were not requested
- Sends a block whose body does not match its header
- Sends a block with a valid header but invalid body

---

## 8. TxSubmission2 Protocol

**Mini-protocol number: 4**

TxSubmission2 diffuses pending transactions through the network. It is
**pull-based** with a twist: the roles are **reversed** from the usual
pattern. The **responder** (server) has agency in StIdle and drives the
protocol by requesting transaction IDs and bodies from the **initiator**
(client).

This reversal reflects that transactions flow **upstream** (toward block
producers), opposite to blocks.

### State Machine

```
                      +------------------+
                      |     StInit       |
                      | (Initiator)      |
                      +--------+---------+
                               |
                          MsgInit
                               |
                               v
           +--+--------+------+--------+---------+--+
           |  |        |    StIdle     |         |  |
           |  |        | (Responder)   |         |  |
           |  |        +--+---+---+----+         |  |
           |  |           |   |   |              |  |
           |  |  MsgReq   | MsgReq | MsgReq      |  |
           |  |  TxIds    | TxIds  | Txs         |  |
           |  |  NonBlock | Block  |              |  |
           |  |     |     |   |    |              |  |
           |  |     v     |   v    v              |  |
           |  | +------+  | +------+ +------+    |  |
           |  | |StTxIds|  | |StTxIds| |StTxs |   |  |
           |  | |NonBlk |  | |Block | |(Init)|   |  |
           |  | |(Init) |  | |(Init)| +--+---+   |  |
           |  | +--+---+  | +--+---+    |        |  |
           |  |    |       |    |   |    |        |  |
           |  | MsgReply   | Reply Done Reply     |  |
           |  | TxIds      | TxIds  |   Txs      |  |
           |  |    |       |    |   |    |        |  |
           +--+----+-------+---+   |    +---------+--+
                                   v
                                 [End]
```

### Agency Table

| State              | Agency    |
|:-------------------|:----------|
| StInit             | Initiator |
| StIdle             | Responder |
| StTxs              | Initiator |
| StTxIdsBlocking    | Initiator |
| StTxIdsNonBlocking | Initiator |

### Message Table

| From               | Message                  | Parameters       | To                 |
|:-------------------|:-------------------------|:-----------------|:-------------------|
| StInit             | MsgInit                  | --               | StIdle             |
| StIdle             | MsgRequestTxIds (blocking)   | `ack`, `req` | StTxIdsBlocking    |
| StIdle             | MsgRequestTxIds (non-blocking)| `ack`, `req`| StTxIdsNonBlocking |
| StIdle             | MsgRequestTxs            | `[txId]`         | StTxs              |
| StTxIdsBlocking    | MsgReplyTxIds            | `[(txId, size)]` | StIdle             |
| StTxIdsBlocking    | MsgDone                  | --               | End                |
| StTxIdsNonBlocking | MsgReplyTxIds            | `[(txId, size)]` | StIdle             |
| StTxs              | MsgReplyTxs              | `[tx]`           | StIdle             |

### Blocking vs Non-Blocking

- **Non-blocking** (`MsgRequestTxIds` with `blocking=false`): The client
  responds immediately with whatever transaction IDs it has (may be empty).
  Used for initial polling.

- **Blocking** (`MsgRequestTxIds` with `blocking=true`): The client must
  respond with **at least one** transaction ID, blocking until one is
  available. The client can also send `MsgDone` to terminate.

### Acknowledgment and Flow Control

The `ack` parameter acknowledges previously sent transaction IDs, allowing
the server to remove them from its tracking window. The `req` parameter
requests up to that many new transaction IDs.

This creates a sliding-window flow control:
1. Server requests N tx IDs (non-blocking for initial batch)
2. Client replies with up to N tx IDs and their sizes
3. Server may request some of those transactions (`MsgRequestTxs`)
4. Server sends next `MsgRequestTxIds` with ack count + new request count

### Protocol Flow

```
Client (Initiator)                       Server (Responder)
  |                                        |
  |---MsgInit----------------------------->|
  |                                        |
  |<---MsgRequestTxIds(blocking=F,ack=0,req=3)---|
  |                                        |
  |---MsgReplyTxIds([(txA,200),(txB,150)])->|
  |                                        |
  |<---MsgRequestTxs([txA])----------------|
  |                                        |
  |---MsgReplyTxs([tx_body_A])------------>|
  |                                        |
  |<---MsgRequestTxIds(blocking=T,ack=1,req=2)---|
  |                                        |
  |  ... blocks until new tx available ... |
  |                                        |
  |---MsgReplyTxIds([(txC,300)])---------->|
  |                                        |
```

### CDDL

```cddl
txSubmission2Message
    = msgInit
    / msgRequestTxIds
    / msgReplyTxIds
    / msgRequestTxs
    / msgReplyTxs
    / tsMsgDone

msgInit         = [6]
msgRequestTxIds = [0, tsBlocking, txCount, txCount]
msgReplyTxIds   = [1, txIdsAndSizes ]
msgRequestTxs   = [2, txIdList ]
msgReplyTxs     = [3, txList ]
tsMsgDone       = [4]

tsBlocking      = false / true
txCount         = word16
txIdList        = [ *txId ]          ; indefinite-length list
txList          = [ *tx ]
txIdAndSize     = [txId, txSizeInBytes]
txIdsAndSizes   = [ *txIdAndSize ]   ; definite-length list
txSizeInBytes   = word32
```

### Transaction Encoding

Transactions are era-tagged like blocks:

```cddl
tx = ns7<byron.tx,
         serialisedShelleyTx<shelley.transaction>,
         serialisedShelleyTx<allegra.transaction>,
         serialisedShelleyTx<mary.transaction>,
         serialisedShelleyTx<alonzo.transaction>,
         serialisedShelleyTx<babbage.transaction>,
         serialisedShelleyTx<conway.transaction>>

serialisedShelleyTx<era> = #6.24(bytes .cbor era)
```

### Transaction ID Encoding

```cddl
txId = ns7<byronTxId,
           shelley.transaction_id,
           allegra.transaction_id,
           mary.transaction_id,
           alonzo.transaction_id,
           conway.transaction_id,
           babbage.transaction_id>

byronTxId = [0, byron.txid]
          / [1, byron.certificateid]
          / [2, byron.updid]
          / [3, byron.voteid]
```

---

## 9. KeepAlive Protocol

**Mini-protocol number: 8**

KeepAlive is a simple cookie-based heartbeat protocol to detect dead
connections and measure round-trip latency.

### State Machine

```
                +-------------------+
         +----->|     StClient      |------+
         |      | (Initiator)       |      |
         |      +--------+----------+      |
         |               |                MsgDone
         |     MsgKeepAlive(cookie)        |
         |               |                v
         |               v              [End]
         |      +-------------------+
         |      |     StServer      |
         |      | (Responder)       |
         |      +--------+----------+
         |               |
         |   MsgKeepAliveResponse(cookie)
         +---------------+
```

### Agency Table

| State    | Agency    |
|:---------|:----------|
| StClient | Initiator |
| StServer | Responder |

### Message Table

| From     | Message               | Parameters | To       |
|:---------|:----------------------|:-----------|:---------|
| StClient | MsgKeepAlive          | `cookie`   | StServer |
| StClient | MsgDone               | --         | End      |
| StServer | MsgKeepAliveResponse  | `cookie`   | StClient |

### CDDL

```cddl
keepAliveMessage = msgKeepAlive
                 / msgKeepAliveResponse
                 / msgDone

msgKeepAlive         = [ 0, word16 ]
msgKeepAliveResponse = [ 1, word16 ]
msgDone              = [ 2 ]
```

### Protocol Behavior

1. The client sends `MsgKeepAlive` with a random 16-bit cookie
2. The server echoes the cookie back in `MsgKeepAliveResponse`
3. The client verifies the cookie matches
4. Round-trip time is measured from send to receive
5. This repeats periodically (typically every few seconds)

The cookie prevents a misbehaving server from pre-computing responses.
A mismatched cookie indicates a protocol violation.

---

## 10. PeerSharing Protocol

**Mini-protocol number: 10**

PeerSharing enables discovery of new peers on the network. A node requests
peer addresses from its established peers, which respond with addresses
from their own known-peer set.

### State Machine

```
                +-------------------+
         +----->|     StIdle        |------+
         |      | (Initiator)       |      |
         |      +--------+----------+      |
         |               |                MsgDone
         |  MsgShareRequest(amount)        |
         |               |                v
         |               v              [End]
         |      +-------------------+
         |      |     StBusy        |
         |      | (Responder)       |
         |      +--------+----------+
         |               |
         |   MsgSharePeers([peerAddr])
         +---------------+
```

### Agency Table

| State  | Agency    |
|:-------|:----------|
| StIdle | Initiator |
| StBusy | Responder |

### Message Table

| From   | Message         | Parameters       | To     |
|:-------|:----------------|:-----------------|:-------|
| StIdle | MsgShareRequest | `amount` (byte)  | StBusy |
| StIdle | MsgDone         | --               | End    |
| StBusy | MsgSharePeers   | `[peerAddress]`  | StIdle |

### CDDL

```cddl
peerSharingMessage = msgShareRequest
                   / msgSharePeers
                   / msgDone

msgShareRequest = [0, byte]           ; max peers to request
msgSharePeers   = [1, peerAddresses]
msgDone         = [2]

peerAddresses = [ * peerAddress ]

peerAddress = [0, word32, portNumber]               ; IPv4
            / [1, word32, word32, word32, word32, portNumber]  ; IPv6

portNumber = word16
```

### Configuration

Peer sharing participation is negotiated during the handshake via the
`peerSharing` field in `nodeToNodeVersionData`:
- `0` = peer sharing disabled (do NOT run PeerSharing protocol)
- `1` = peer sharing enabled (run PeerSharing protocol)

Constraints:
- Only addresses from previously successful connections are shared
- Manually configured (local root) addresses may optionally be shared
- Addresses known to be ledger peers are not shared
- The `amount` is a `Word8`, limiting requests to 255 peers per round

---

## 11. Peer Selection Governor

The **Peer Selection Governor (PSG)**, also called the **Outbound Governor**,
manages outbound connections. It classifies peers into three temperature
levels and promotes/demotes them to maintain target counts.

### Peer Temperature Levels

```
  +------------------+     promote      +------------------+
  |                  |  (establish TCP) |                  |
  |   Cold Peers     |---------------->|   Warm Peers      |
  |  (known, no      |                 |  (connected,      |
  |   connection)    |<----------------|   no consensus     |
  |                  |     demote       |   protocols)       |
  +------------------+  (close TCP)    +------------------+
                                             |        ^
                                   promote   |        |  demote
                                 (activate   |        | (deactivate
                                  consensus) |        |  consensus)
                                             v        |
                                       +------------------+
                                       |   Hot Peers       |
                                       |  (active, running |
                                       |   all consensus   |
                                       |   protocols)       |
                                       +------------------+
```

| Level | Connection | Protocols Running | Purpose |
|:------|:-----------|:------------------|:--------|
| Cold  | None       | None              | Known addresses, potential peers |
| Warm  | TCP established | KeepAlive only | Measured peers, ready to promote |
| Hot   | TCP established | ChainSync + BlockFetch + TxSubmission2 + KeepAlive | Active consensus participation |

### Promotion and Demotion

**Cold -> Warm**: Establish a TCP connection and run the handshake.

**Warm -> Hot**: Activate the full set of consensus mini-protocols
(ChainSync, BlockFetch, TxSubmission2).

**Hot -> Warm**: Deactivate consensus protocols. Triggered when:
- There are too many hot peers (above target)
- The peer is underperforming (rarely first to provide headers)
- The peer misbehaves

**Warm -> Cold**: Close the TCP connection. Triggered when:
- There are too many warm peers (above target)
- The peer has been warm for too long without promotion

**Immediate demotion** (any level -> cold): In case of adversarial behavior
or protocol violations.

### Peer Sources

```
                    +---------------------------+
                    |     Known Peers Set        |
                    |                           |
                    |  +----------+  +--------+ |
                    |  |Local Roots|  |Ledger  | |
                    |  |(config)  |  |Peers   | |
                    |  +----------+  +--------+ |
                    |                           |
                    |  +----------+  +--------+ |
                    |  |Public    |  |Peer    | |
                    |  |Roots     |  |Sharing | |
                    |  |(config)  |  |(learned)| |
                    |  +----------+  +--------+ |
                    +---------------------------+
```

| Source        | Description |
|:------------- |:------------|
| **Local Roots** | Static configuration for organizational peering (e.g., stake pool relays). Guaranteed connections. |
| **Public Roots** | Publicly known bootstrap nodes (e.g., IOG relays). Opportunistic connections. |
| **Ledger Peers** | Peers drawn from the ledger's stake pool registration data, weighted by stake. |
| **Big Ledger Peers** | Subset of ledger peers representing 90% of largest stake. Separate targets. |
| **Peer Sharing** | Peers discovered dynamically via the PeerSharing protocol. |

### Target Configuration

| Target                         | Typical Value | Description |
|:-------------------------------|:------------- |:------------|
| TargetNumberOfRootPeers        | 60            | Minimum known peers from root sources |
| TargetNumberOfKnownPeers       | 100           | Total known peers (including discovered) |
| TargetNumberOfEstablishedPeers | 40            | Warm + Hot peers |
| TargetNumberOfActivePeers      | 15            | Hot peers |

Root peer target is one-sided (from below only). All others are
two-sided: the governor grows or shrinks sets to hit the targets.

### Peer Churn Governor (PCG)

The PCG periodically adjusts targets to churn the peer set:
- Drops the **bottom 20%** of performing peers periodically
- Promotes new warm peers to replace them
- Helps the network recover from partitions and resist eclipse attacks
- Maintains diversity in hop distances across the network graph

---

## 12. Wire Format Reference

### Complete CDDL Base Types

These base types are used across all mini-protocol CDDL definitions:

```cddl
blockNo = word64
epochNo = word64
slotNo  = word64

coin = word64

rational = [int, int]

keyhash = bstr .size 28
hash    = bstr .size 32

relativeTime = int

; Word sizes
word8  = uint .size 1
word16 = uint .size 2
word32 = uint .size 4
word64 = uint .size 8
```

### Era Tag Encoding (ns7)

The Cardano hard-fork combinator wraps era-specific data with an era
index tag:

```cddl
ns7<byron, shelley, allegra, mary, alonzo, babbage, conway>
  = [6, conway]
  / [5, babbage]
  / [4, alonzo]
  / [3, mary]
  / [2, allegra]
  / [1, shelley]
  / [0, byron]
```

The telescope encoding (used in some consensus contexts) encodes the full
era history:

```cddl
telescope7<byron, shelley, allegra, mary, alonzo, babbage, conway>
  = [pastEra, pastEra, pastEra, pastEra, pastEra, pastEra, currentEra<conway>]
  / [pastEra, pastEra, pastEra, pastEra, pastEra, currentEra<babbage>]
  / [pastEra, pastEra, pastEra, pastEra, currentEra<alonzo>]
  / [pastEra, pastEra, pastEra, currentEra<mary>]
  / [pastEra, pastEra, currentEra<allegra>]
  / [pastEra, currentEra<shelley>]
  / [currentEra<byron>]
```

### CBOR-in-CBOR

Many protocol messages use **CBOR-in-CBOR** wrapping, denoted `#6.24(bstr)`.
This means the inner data is first CBOR-encoded to a byte string, then that
byte string is wrapped in a CBOR tag 24 (embedded CBOR). This allows
implementations to pass through opaque era-specific data without
decoding it.

### Message CBOR Tag Summary

All mini-protocol messages are CBOR arrays with a leading integer tag:

| Protocol      | Tag | Message                  |
|:------------- |:---:|:-------------------------|
| **Handshake** |  0  | MsgProposeVersions       |
|               |  1  | MsgAcceptVersion         |
|               |  2  | MsgRefuse                |
|               |  3  | MsgQueryReply            |
| **ChainSync** |  0  | MsgRequestNext           |
|               |  1  | MsgAwaitReply            |
|               |  2  | MsgRollForward           |
|               |  3  | MsgRollBackward          |
|               |  4  | MsgFindIntersect         |
|               |  5  | MsgIntersectFound        |
|               |  6  | MsgIntersectNotFound     |
|               |  7  | MsgDone                  |
| **BlockFetch**|  0  | MsgRequestRange          |
|               |  1  | MsgClientDone            |
|               |  2  | MsgStartBatch            |
|               |  3  | MsgNoBlocks              |
|               |  4  | MsgBlock                 |
|               |  5  | MsgBatchDone             |
| **TxSubmission2** | 6 | MsgInit                |
|               |  0  | MsgRequestTxIds          |
|               |  1  | MsgReplyTxIds            |
|               |  2  | MsgRequestTxs            |
|               |  3  | MsgReplyTxs              |
|               |  4  | MsgDone                  |
| **KeepAlive** |  0  | MsgKeepAlive             |
|               |  1  | MsgKeepAliveResponse     |
|               |  2  | MsgDone                  |
| **PeerSharing** | 0 | MsgShareRequest          |
|               |  1  | MsgSharePeers            |
|               |  2  | MsgDone                  |

Note: Message tags are **per-protocol**, not globally unique. The mux
protocol ID determines which protocol the segment belongs to.

### Timeouts

| Context                   | Timeout |
|:--------------------------|:--------|
| Handshake (any state)     | 10s     |
| All other NtN protocols   | 30s     |
| All NtC protocols         | 30s     |

---

## Appendix A: Network Magic Values

| Network | Magic       |
|:--------|:------------|
| Mainnet | 764824073   |
| Preprod | 1           |
| Preview | 2           |

## Appendix B: Quick Reference -- Connecting to a Cardano Node

```
1. Open TCP connection to peer
2. Send mux segment:
     Header: proto_id=0 (Handshake), mode=0 (initiator)
     Payload: CBOR([0, {14: [magic, false, 1, false]}])
              MsgProposeVersions with version 14
3. Receive mux segment:
     Header: proto_id=0, mode=1 (responder)
     Payload: CBOR([1, 14, [magic, false, 1, false]])
              MsgAcceptVersion
4. Multiplexer is now running. Start mini-protocols:
   - ChainSync on proto_id=2
   - BlockFetch on proto_id=3
   - TxSubmission2 on proto_id=4
   - KeepAlive on proto_id=8
5. Find chain intersection:
     Send: CBOR([4, [[slot, hash], [], ...]])  (MsgFindIntersect)
     Recv: CBOR([5, [slot, hash], tip])        (MsgIntersectFound)
6. Stream headers:
     Send: CBOR([0])                           (MsgRequestNext)
     Recv: CBOR([2, header, tip])              (MsgRollForward)
7. Fetch blocks:
     Send: CBOR([0, [slot1, hash1], [slot2, hash2]])  (MsgRequestRange)
     Recv: CBOR([2])                                   (MsgStartBatch)
     Recv: CBOR([4, block])                            (MsgBlock) x N
     Recv: CBOR([5])                                   (MsgBatchDone)
```

---

## Sources

- [Ouroboros Network Specification (PDF)](https://ouroboros-network.cardano.intersectmbo.org/pdfs/network-spec/network-spec.pdf)
- [Cardano Blueprint - Network](https://cardano-scaling.github.io/cardano-blueprint/network/index.html)
- [ouroboros-network GitHub](https://github.com/IntersectMBO/ouroboros-network)
- [Networking Protocol Design Overview (Cardano Docs)](https://docs.cardano.org/about-cardano/explore-more/cardano-network/networking-protocol)
- [P2P Networking (Cardano Docs)](https://docs.cardano.org/about-cardano/explore-more/cardano-network/p2p-networking)
- [Peer Sharing Implementation Plan (Wiki)](https://github.com/IntersectMBO/ouroboros-network/wiki/Peer-Sharing-Implementation-Plan)
- [ChainSync ClientPipelined (Haddock)](https://ouroboros-network.cardano.intersectmbo.org/ouroboros-network-protocols/Ouroboros-Network-Protocol-ChainSync-ClientPipelined.html)
- [gOuroboros - Go Implementation](https://github.com/blinklabs-io/gouroboros)
- [Technical Report: Data Diffusion and Network](https://ouroboros-network.cardano.intersectmbo.org/pdfs/network-design/network-design.pdf)
- [Block Diffusion Pipelining Blog](https://iohk.io/en/blog/posts/2022/02/01/introducing-pipelining-cardanos-consensus-layer-scaling-solution/)

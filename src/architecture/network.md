# Network Module -- Ouroboros Mini-Protocols

## Overview

Asyncio-based implementation of the Ouroboros network multiplexer and mini-protocols
required for Cardano node-to-node (NTN) communication. The stack handles TCP framing,
protocol version negotiation, chain-header streaming, block download, heartbeat
keep-alive, and transaction relay -- all running as concurrent asyncio tasks over a
single multiplexed TCP connection.

**Package:** `bluematter.network`

## Files

| File | Purpose | Key Exports |
|---|---|---|
| `types.py` | Shared data types and protocol constants | `Point`, `Tip`, protocol IDs, network magic constants, `NTN_VERSIONS` |
| `errors.py` | Exception hierarchy for all mini-protocols | `HandshakeError`, `ChainSyncError`, `BlockFetchError`, `PeerConnectionError`, `TxSubmissionError` |
| `mux.py` | TCP multiplexer (frame encode/decode, per-protocol demux) | `Multiplexer`, `ProtocolBuffer`, `encode_header`, `decode_header` |
| `handshake.py` | NTN handshake version negotiation | `perform_handshake()` |
| `chainsync.py` | ChainSync client (header streaming + rollback) | `ChainSyncClient`, `build_intersect_points()` |
| `blockfetch.py` | BlockFetch client (block body download) | `BlockFetchClient` |
| `keepalive.py` | KeepAlive heartbeat client | `KeepAliveClient` |
| `txsubmission.py` | TxSubmission2 client (transaction relay to server) | `TxSubmissionClient` |
| `peer.py` | Single-peer connection lifecycle | `PeerConnection`, `PeerAddress` |
| `peer_selection.py` | Multi-peer scoring and outbound governor | `PeerSelector`, `PeerInfo`, `PeerStatus` |

## Shared Types (`types.py`)

### Point

A chain point identified by `(slot, block_hash)`. The origin point has `block_hash=None`.

- `Point.origin()` -- create the genesis/origin point
- `to_cbor()` / `from_cbor()` -- wire encoding: `[]` for origin, `[slot, hash]` for specific

### Tip

A chain tip: `Point` plus a `block_number`. Encodes as `[[slot, hash], block_number]`.

### Constants

| Constant | Value | Description |
|---|---|---|
| `PROTO_HANDSHAKE` | 0 | Handshake mini-protocol ID |
| `PROTO_CHAIN_SYNC` | 2 | ChainSync mini-protocol ID |
| `PROTO_BLOCK_FETCH` | 3 | BlockFetch mini-protocol ID |
| `PROTO_TX_SUBMISSION` | 4 | TxSubmission mini-protocol ID |
| `PROTO_KEEP_ALIVE` | 8 | KeepAlive mini-protocol ID |
| `MAINNET_MAGIC` | 764824073 | Mainnet network magic |
| `PREPROD_MAGIC` | 1 | Preprod network magic |
| `PREVIEW_MAGIC` | 2 | Preview network magic |
| `NTN_VERSIONS` | [13, 14] | Supported NTN protocol versions |

## Multiplexer (`mux.py`)

The multiplexer manages a single TCP connection, demultiplexing inbound segments to
per-protocol reassembly buffers and serializing outbound sends from concurrent
protocol coroutines.

### Wire Format

Each mux segment has an 8-byte header (big-endian):

```
Bytes 0-3:  u32  timestamp (microseconds, lowest 32 bits of monotonic clock)
Bytes 4-5:  u16  protocol_id (bit 15 = mode: 0=initiator, 1=responder)
Bytes 6-7:  u16  payload_length (0..65535)
Bytes 8..:  [payload_length bytes]
```

Constants:
- `MUX_HEADER_SIZE = 8`
- `MAX_SEGMENT_PAYLOAD = 65535`
- `MODE_BIT = 0x8000` (bit 15 of the protocol_id field)

### Functions

- **`encode_header(proto_id, payload_length, is_responder)`** -- pack an 8-byte segment header.
  Timestamp is derived from `time.monotonic()`. The responder mode bit is ORed into the
  protocol ID field.
- **`decode_header(data)`** -- unpack 8 bytes into `(timestamp, proto_id, is_responder, payload_length)`.
  Strips the mode bit from the protocol ID.

### ProtocolBuffer

Per-protocol reassembly buffer for CBOR messages. Accumulates raw bytes from mux
segments and extracts complete CBOR items using `cbor_item_length()` (the codec's
byte-walking primitive).

- **`feed(data)`** -- append received bytes. Enforces a 4 MB limit per protocol to
  prevent memory exhaustion.
- **`recv_message(timeout)`** -- async wait for one complete CBOR message. Uses
  `cbor_item_length()` to detect item boundaries without full decode. Returns the
  raw CBOR bytes. Raises `TimeoutError` on timeout, `ConnectionError` if the mux
  read loop has ended.
- **`set_mux(mux)`** -- associate with a `Multiplexer` for closed-connection detection.
- **`has_data()`** -- check if the buffer has any pending bytes.

### Multiplexer

Manages a single TCP connection with per-protocol demuxing. Created with an asyncio
`StreamReader`/`StreamWriter` pair and an `is_initiator` flag.

- **`register_protocol(proto_id, buffer)`** -- register a `ProtocolBuffer` for inbound
  segment routing. Calls `buffer.set_mux(self)` for closed-mux detection.
- **`send(proto_id, payload)`** -- send a payload, segmenting into chunks of up to
  65535 bytes. Uses an asyncio write lock for safe concurrent sends from multiple
  protocol coroutines. Handles the empty-payload case (sends zero-length segment).
- **`read_loop()`** -- the main read loop (run as an asyncio task). Reads 8-byte headers,
  then reads the payload, and routes it to the registered protocol buffer. On
  connection close or error, sets `_closed = True` and wakes all waiting protocol
  buffers so they raise `ConnectionError`.
- **`close()`** -- set closed flag and close the writer.

### Segmentation

Outbound payloads larger than 65535 bytes are split into multiple segments. Each
segment carries its own 8-byte header with the same protocol ID. The receiving
`ProtocolBuffer` reassembles them transparently since it operates on a byte stream
and only returns data when a complete CBOR item is available.

## Mini-Protocols

### Handshake (`handshake.py`)

Negotiates a protocol version with the peer before any other protocol starts.

**Wire messages:**
```
MsgProposeVersions = [0, {version: [magic, init_only, peer_sharing, query], ...}]
MsgAcceptVersion   = [1, version, [magic, init_only, peer_sharing, query]]
MsgRefuse          = [2, reason]
MsgQueryReply      = [3, ...]
```

**Function: `perform_handshake(mux, buffer, network_magic, timeout=10.0)`**

1. Builds a `MsgProposeVersions` with versions 13 and 14, each carrying
   `[network_magic, False, 0, False]` (no initiation-only, no peer sharing, no query).
2. Sends via the mux on protocol ID 0.
3. Waits for reply with a 10-second timeout.
4. Enforces the 5760-byte spec limit on handshake messages.
5. On `MsgAcceptVersion` (tag 1): verifies the accepted version was one we proposed,
   verifies the peer's network magic matches ours, returns the negotiated version.
6. On `MsgRefuse` (tag 2): raises `HandshakeError` with the refusal reason.
7. On `MsgQueryReply` (tag 3): returns the reported version.

**Supported versions:** NTN 13 and 14. These have a compatible `nodeToNodeVersionData`
format with the 4-element parameter tuple.

### ChainSync (`chainsync.py`)

Receives block headers from a peer and tracks the chain tip. Handles intersection
finding for initial sync and rollback events.

**Wire messages:**
```
MsgRequestNext       = [0]
MsgAwaitReply        = [1]
MsgRollForward       = [2, header, tip]
MsgRollBackward      = [3, point, tip]
MsgFindIntersect     = [4, [point, ...]]
MsgIntersectFound    = [5, point, tip]
MsgIntersectNotFound = [6, tip]
MsgDone              = [7]
```

Conway headers arrive era-tagged (ns7 format): `[6, #6.24(header_cbor)]`.

**State machine:**

```
     IDLE -----RequestNext----> NEXT
     IDLE ---FindIntersect----> INTERSECT
     NEXT <---RollForward------ (server)
     NEXT <---RollBackward----- (server)
     NEXT <---AwaitReply------- (server, re-waits)
     INTERSECT <-IntersectFound (server)
     INTERSECT <-NotFound------ (server)
     any ------MsgDone--------> DONE
```

**Class: `ChainSyncClient`**

- **Constructor** accepts `on_roll_forward(era_tag, header_cbor, raw_header, tip)` and
  `on_roll_backward(point, tip)` callbacks. Callbacks may be sync or async (handled
  via `_maybe_await()`).
- **`find_intersect(points)`** -- sends `MsgFindIntersect`, returns `(intersect_point, tip)`.
  `intersect_point` is `None` if no intersection was found.
- **`request_next()`** -- sends `MsgRequestNext`, returns `('roll_forward', (era_tag, header_cbor), tip)`
  or `('roll_backward', point, tip)`. Transparently handles `MsgAwaitReply` by looping.
- **`run(intersect_points)`** -- main loop: finds intersection, then streams headers
  indefinitely, calling the registered callbacks.
- **`_recv_msg(timeout=120.0)`** -- receive loop that transparently skips `MsgAwaitReply`
  (tag 1) and raises on `MsgDone` (tag 7).

**Helper: `_decode_header_envelope(header_data)`**

Decodes the ns7 era-tagged header envelope. Conway: `[6, #6.24(header_bytes)]` yields
`(6, raw_header_bytes)`. Handles both `CBORTag(24, ...)` wrapping and bare bytes.

**Helper: `build_intersect_points(tip_slot, tip_hash, volatile_slots)`**

Builds exponentially-spaced intersect points following the Ouroboros convention:
`[tip, tip-1, tip-2, tip-4, tip-8, ..., origin]`. If `volatile_slots` (actual chain
points) are provided, uses those; otherwise falls back to just the tip. Always
appends origin as a final fallback.

### BlockFetch (`blockfetch.py`)

Fetches block bodies from a peer by requesting a range of blocks identified by their
`(slot, hash)` points.

**Wire messages:**
```
MsgRequestRange = [0, from_point, to_point]
MsgClientDone   = [1]
MsgStartBatch   = [2]
MsgNoBlocks     = [3]
MsgBlock        = [4, #6.24(block_cbor)]
MsgBatchDone    = [5]
```

**Class: `BlockFetchClient`**

- **`fetch_range(from_point, to_point)`** -- request a range of blocks (inclusive).
  Returns `list[bytes]` of raw block data (tag-24 wrapped for `decode_block_from_wire()`).
  Returns empty list on `MsgNoBlocks`. Enforces a batch limit of 2000 blocks.
  Protocol flow:
  1. Send `MsgRequestRange(from_point, to_point)`
  2. Wait for `MsgStartBatch` or `MsgNoBlocks`
  3. Collect `MsgBlock` messages until `MsgBatchDone`
- **`send_done()`** -- send `MsgClientDone` to cleanly close the protocol.

**Helper: `_extract_block_bytes(block_payload)`**

Extracts raw block bytes from the `MsgBlock` payload. The payload is
`#6.24(bstr .cbor cardanoBlock)`. Returns tag-24-wrapped bytes so
`decode_block_from_wire()` can process them directly.

### KeepAlive (`keepalive.py`)

Sends periodic heartbeat pings to detect dead connections.

**Wire messages:**
```
MsgKeepAlive         = [0, cookie_u16]
MsgKeepAliveResponse = [1, cookie_u16]
MsgDone              = [2]
```

**Class: `KeepAliveClient`**

- **Constructor** parameters: `initial_delay=1.0s`, `interval=30.0s`, `timeout=60.0s`.
- **`run()`** -- main loop: waits `initial_delay`, then sends pings every `interval`.
  Cookie is a 16-bit wrapping counter (`(cookie + 1) & 0xFFFF`).
- **`ping(cookie)`** -- send `MsgKeepAlive(cookie)`, wait for `MsgKeepAliveResponse(cookie)`.
  Raises `KeepAliveError` on timeout (60s) or cookie mismatch.

### TxSubmission2 (`txsubmission.py`)

Bidirectional transaction relay. The initiator (client) provides transactions to the
server on demand. After `MsgInit`, the server holds agency and requests tx IDs and
tx bodies; the client responds from its local mempool.

**Wire messages:**
```
MsgInit           = [6]
MsgRequestTxIds   = [0, blocking, ack_count, req_count]
MsgReplyTxIds     = [1, [[tx_id, tx_size], ...]]
MsgRequestTxs     = [2, [tx_id, ...]]
MsgReplyTxs       = [3, [tx_cbor, ...]]
MsgDone           = [4]
```

**Class: `TxSubmissionClient`**

- Takes a `Mempool` reference for sourcing transactions.
- **`run()`** -- sends `MsgInit`, then loops handling server requests:
  - **`MsgRequestTxIds`**: acknowledges previously-sent IDs (`ack_count`), then gathers
    up to `req_count` new tx IDs from the mempool (excluding already-outstanding ones).
    Responds with `MsgReplyTxIds` containing `[[tx_id, size], ...]` pairs.
  - **`MsgRequestTxs`**: looks up each requested tx ID in the mempool, responds with
    `MsgReplyTxs` containing the raw CBOR bodies.
  - **`MsgDone`**: server terminates the protocol.
- Tracks outstanding (advertised but not yet acknowledged) tx IDs internally.

## Peer Management

### PeerAddress (`peer.py`)

Simple frozen dataclass: `host: str`, `port: int`. Formats as `"host:port"`.

### PeerConnection (`peer.py`)

Manages the full lifecycle of one peer connection.

**Lifecycle:**

1. **`connect()`** -- opens TCP connection via `asyncio.open_connection()`, creates a
   `Multiplexer`, registers handshake buffer, starts the mux read loop, performs
   handshake, then registers protocol buffers for ChainSync, BlockFetch, and
   KeepAlive. Instantiates `ChainSyncClient`, `BlockFetchClient`, `KeepAliveClient`.
2. **`run_protocols(intersect_points)`** -- runs ChainSync, KeepAlive, and the mux
   read loop concurrently using `asyncio.wait(FIRST_EXCEPTION)`. Any exception from
   any task propagates up. On exit, cancels all tasks and closes the mux.
3. **`disconnect()`** -- gracefully closes the connection.

**Attributes after connect:**
- `chainsync: ChainSyncClient` -- for header streaming
- `blockfetch: BlockFetchClient` -- for block download
- `_negotiated_version: int` -- agreed protocol version

### PeerSelector (`peer_selection.py`)

Outbound governor -- manages a pool of known peers, tracks quality, and selects the
best peers for active connections.

**Peer states:**

```
COLD ----connect----> ACTIVE
ACTIVE --disconnect-> WARM
ACTIVE --errors-----> BANNED (after max_errors_before_ban)
BANNED --expires----> COLD
WARM ----connect----> ACTIVE
```

**PeerInfo fields:**
- `host`, `port`, `status` (PeerStatus enum)
- Quality metrics: `latency_ms`, `blocks_served`, `error_count`
- Timestamps: `last_connected`, `last_error`, `ban_until`
- Connection tracking: `connect_attempts`, `successful_connections`

**Score formula:**
```
score = latency_ms + (error_count * 1000) - (blocks_served * 0.1)
floor = -10000
```
Lower score = better peer.

**PeerSelector configuration:**
- `max_active = 5` -- maximum simultaneous active connections
- `max_warm = 10` -- maximum warm (recently-disconnected) peers
- `ban_duration = 300.0` -- ban duration in seconds (5 minutes)
- `max_errors_before_ban = 5` -- error threshold for banning

**Key methods:**
- `add_peer(host, port)` / `remove_peer(host, port)` -- manage known peer set
- `select_for_connection(count)` -- return the best `count` peers to connect to
  (excludes banned and already-active peers, sorted by score then latency)
- `mark_connected(host, port, latency_ms)` -- record successful connection
- `mark_disconnected(host, port)` -- move to WARM status
- `mark_error(host, port, error)` -- increment error count, may ban
- `mark_block_served(host, port)` -- improve peer score

## Connection Flow Diagram

```
  Node                                          Peer
   |                                             |
   |-- TCP connect (asyncio.open_connection) --->|
   |                                             |
   |-- MsgProposeVersions [13,14] ------------->|
   |<- MsgAcceptVersion [14, magic] ------------|
   |                                             |
   |   [register ChainSync, BlockFetch,          |
   |    KeepAlive protocol buffers]              |
   |                                             |
   |   --- CONCURRENT PROTOCOLS ---              |
   |                                             |
   |-- MsgFindIntersect [points] -------------->|
   |<- MsgIntersectFound [point, tip] ----------|
   |                                             |
   |   loop:                                     |
   |-- MsgRequestNext --------- ChainSync ----->|
   |<- MsgRollForward [header, tip] ------------|
   |                                             |
   |-- MsgRequestRange [pt, pt]- BlockFetch --->|
   |<- MsgStartBatch + MsgBlock* + BatchDone ---|
   |                                             |
   |-- MsgKeepAlive [cookie] --- KeepAlive ---->|
   |<- MsgKeepAliveResponse [cookie] -----------|
   |                                             |
   |-- MsgInit --------- TxSubmission2 -------->|
   |<- MsgRequestTxIds ----- (server agency) ---|
   |-- MsgReplyTxIds [[(id,sz),...]] ---------->|
   |<- MsgRequestTxs [[id,...]] ----------------|
   |-- MsgReplyTxs [[cbor,...]] --------------->|
```

All protocols share the same TCP connection through the multiplexer. Each protocol
has its own `ProtocolBuffer` for inbound reassembly. Outbound sends are serialized
via the mux's async write lock. The mux `read_loop()` runs as a background task,
routing inbound segments to the appropriate protocol buffer based on the protocol
ID in the 8-byte segment header.

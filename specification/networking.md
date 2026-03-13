---
---
# Networking

The Bluematter networking layer implements the Ouroboros family of
mini-protocols over a single multiplexed TCP connection. Every peer
connection carries several concurrent mini-protocols, each identified
by a 15-bit protocol ID and managed by an independent state machine.

**Notation.** B = bytes, N = naturals, N_k = k-bit unsigned integer,
H = B_32 (Blake2b-256 hash). CBOR encoding follows RFC 8949. All
multi-byte wire integers are big-endian.

---

## 12.1 Multiplexer

The multiplexer manages a single TCP stream, demultiplexing inbound
segments to per-protocol reassembly buffers and serializing outbound
sends from concurrent protocol coroutines under a write lock.

### 12.1.1 Frame Format

Each multiplexer segment consists of an 8-byte header followed by a
variable-length payload:

```
Segment = Header || Payload

Header (8 bytes, big-endian):
  +-------+-------+-------+-------+-------+-------+-------+-------+
  | timestamp (4 bytes, N_32)     | id_field (2 bytes) | length (2)|
  +-------+-------+-------+-------+-------+-------+-------+-------+

  timestamp    : N_32  = monotonic_clock_us mod 2^32
  id_field     : N_16  = mode_bit || protocol_id
    mode_bit   : bit 15 = 0 (initiator -> responder)
                          1 (responder -> initiator)
    protocol_id: bits 14..0 (15-bit mini-protocol identifier)
  length       : N_16  = |Payload| in bytes

Payload : B_{length}

Constants:
  MUX_HEADER_SIZE    = 8
  MAX_SEGMENT_PAYLOAD = 65535   (2^16 - 1)
  MODE_BIT           = 0x8000
```

Encoding:

```
encode_header(proto_id, payload_length, is_responder) -> B_8
  timestamp  <- monotonic_time_us() & 0xFFFFFFFF
  id_field   <- proto_id | (0x8000 if is_responder else 0)
  return pack_be(">IHH", timestamp, id_field, payload_length)
```

Decoding:

```
decode_header(data : B_8) -> (N_32, N_15, Bool, N_16)
  (timestamp, id_field, length) <- unpack_be(">IHH", data)
  is_responder <- (id_field & 0x8000) != 0
  proto_id     <- id_field & 0x7FFF
  return (timestamp, proto_id, is_responder, length)
```

### 12.1.2 Protocol Identifiers

```
  PROTO_HANDSHAKE     = 0
  PROTO_CHAIN_SYNC    = 2
  PROTO_BLOCK_FETCH   = 3
  PROTO_TX_SUBMISSION = 4
  PROTO_KEEP_ALIVE    = 8
```

### 12.1.3 Segmentation

Messages exceeding MAX_SEGMENT_PAYLOAD are split into multiple segments.
Each segment carries the same protocol_id and mode_bit. The payload
bytes are partitioned at 65535-byte boundaries:

```
send(proto_id, payload):
  offset <- 0
  while offset < |payload|:
    chunk <- payload[offset .. offset + MAX_SEGMENT_PAYLOAD)
    header <- encode_header(proto_id, |chunk|, is_responder)
    write_locked(header || chunk)
    offset <- offset + |chunk|
  if |payload| = 0:
    write_locked(encode_header(proto_id, 0, is_responder))
```

### 12.1.4 Reassembly

Each registered protocol has a ProtocolBuffer that accumulates received
bytes and extracts complete CBOR items:

```
ProtocolBuffer:
  _buf       : mutable B
  MAX_SIZE   = 4 * 1024 * 1024   (4 MiB per protocol)

  feed(data : B):
    require |_buf| + |data| <= MAX_SIZE
    _buf <- _buf || data

  recv_message(timeout) -> B:
    loop:
      if |_buf| > 0:
        n <- cbor_item_length(_buf)    -- total CBOR item size, or bottom
        if n != bottom and n <= |_buf|:
          msg <- _buf[0..n)
          _buf <- _buf[n..]
          return msg
      if mux.closed and |_buf| = 0:
        raise ConnectionError
      wait(data_available, timeout)
```

CBOR boundary detection uses `cbor_item_length(buffer)`, which parses
the CBOR major type and additional information bytes to compute the
total encoded item length without fully decoding the value. Returns
bottom if the buffer is too short to determine the length.

### 12.1.5 Read Loop

The multiplexer runs a single read loop that routes inbound segments:

```
read_loop():
  while not closed:
    header_bytes <- read_exactly(8)
    (_, proto_id, _, length) <- decode_header(header_bytes)
    payload <- read_exactly(length) if length > 0 else empty
    buf <- _protocols[proto_id]
    if buf != bottom:
      buf.feed(payload)
  on termination:
    closed <- true
    wake all protocol buffers
```

---

## 12.2 Handshake Protocol

Mini-protocol ID 0. Negotiates a protocol version and validates
network identity before any other protocol messages are exchanged.

### 12.2.1 State Machine

```
          MsgProposeVersions
  StPropose ──────────────────> StConfirm
                                   |
                     MsgAcceptVersion / MsgRefuse / MsgQueryReply
                                   |
                                   v
                                StDone
```

Agency: Initiator has agency in StPropose. Responder has agency in StConfirm.

### 12.2.2 Message Encoding

```
MsgProposeVersions = [0, VersionTable]
  VersionTable : Map{N -> [N, Bool, N, Bool]}
    key   : version number (N)
    value : [network_magic, initiator_only_diffusion_mode,
             peer_sharing, query]

MsgAcceptVersion = [1, version : N, params : [N, Bool, N, Bool]]

MsgRefuse = [2, reason]

MsgQueryReply = [3, version : N]   (response to query mode)
```

### 12.2.3 Supported Versions

```
NTN_VERSIONS = {13, 14}
```

Only Node-to-Node versions 13 and 14 are supported. These versions
use the `nodeToNodeVersionData` format with four parameters:
`[network_magic, initiator_only_diffusion_mode, peer_sharing, query]`.

### 12.2.4 Protocol Execution

```
perform_handshake(mux, buffer, network_magic, timeout=10.0) -> N:

  -- Build proposal
  version_table <- { v : [network_magic, false, 0, false]
                     | v in NTN_VERSIONS }
  send(PROTO_HANDSHAKE, cbor([0, version_table]))

  -- Await response
  reply_bytes <- buffer.recv_message(timeout)
  require |reply_bytes| <= 5760      -- spec message size limit

  reply <- cbor_decode(reply_bytes)
  tag <- reply[0]

  if tag = 1:  -- MsgAcceptVersion
    version    <- reply[1]
    peer_magic <- reply[2][0]
    require version in NTN_VERSIONS       -- we proposed this version
    require peer_magic = network_magic    -- same network
    return version

  if tag = 2:  -- MsgRefuse
    raise HandshakeError(reply[1])

  if tag = 3:  -- MsgQueryReply
    return reply[1]

  raise HandshakeError("unexpected tag")
```

### 12.2.5 Network Magic Constants

```
  MAINNET_MAGIC = 764824073
  PREPROD_MAGIC = 1
  PREVIEW_MAGIC = 2
```

### 12.2.6 Constraints

| Property             | Value   |
|----------------------|---------|
| Max message size     | 5760 B  |
| Handshake timeout    | 10 s    |
| Supported versions   | 13, 14  |

---

## 12.3 ChainSync Protocol

Mini-protocol ID 2. The initiator (client) requests block headers
from the responder (server) and tracks the remote chain tip.

### 12.3.1 State Machine

```
                MsgRequestNext
  StIdle ────────────────────────> StCanAwait
    |                                 |
    |                     +-----------+-----------+
    |                     |           |           |
    |              MsgRollForward  MsgRollBackward  MsgAwaitReply
    |              (header, tip)  (point, tip)      |
    |                     |           |           |
    |                     v           v           v
    |                  StIdle      StIdle     StMustReply
    |                                            |
    |                              +-------------+-------------+
    |                              |                           |
    |                       MsgRollForward             MsgRollBackward
    |                       (header, tip)              (point, tip)
    |                              |                           |
    |                              v                           v
    |                           StIdle                      StIdle
    |
    |       MsgFindIntersect(points)
    +──────────────────────────────> StIntersect
                                       |
                           +-----------+-----------+
                           |                       |
                   MsgIntersectFound       MsgIntersectNotFound
                   (point, tip)            (tip)
                           |                       |
                           v                       v
                        StIdle                  StIdle

  Any state ──MsgDone──> StDone  (terminal)
```

**Agency:** The initiator has agency in StIdle. The responder has
agency in StCanAwait, StMustReply, and StIntersect.

### 12.3.2 Message Tags

```
  MsgRequestNext        = 0
  MsgAwaitReply         = 1
  MsgRollForward        = 2
  MsgRollBackward       = 3
  MsgFindIntersect      = 4
  MsgIntersectFound     = 5
  MsgIntersectNotFound  = 6
  MsgDone               = 7
```

### 12.3.3 Message Encoding

```
MsgRequestNext            = [0]
MsgAwaitReply             = [1]
MsgRollForward            = [2, header_envelope, tip]
MsgRollBackward           = [3, point, tip]
MsgFindIntersect          = [4, [point, ...]]
MsgIntersectFound         = [5, point, tip]
MsgIntersectNotFound      = [6, tip]
MsgDone                   = [7]
```

### 12.3.4 Wire Types

**Point** (chain position):

```
Point = [slot : N, block_hash : B_32]    -- specific block
      | []                                -- origin (genesis)

Point.to_cbor():
  if is_origin: return []
  return [slot, block_hash]

Point.from_cbor(data):
  if data = []: return Origin
  return Point(slot=data[0], block_hash=data[1])
```

**Tip** (chain tip with block number):

```
Tip = [point : Point, block_number : N]

Tip.from_cbor(data):
  return Tip(point=Point.from_cbor(data[0]), block_number=data[1])
```

### 12.3.5 Header Envelope

Headers arrive era-tagged in the ns7 envelope format:

```
HeaderEnvelope = [era_tag : N, #6.24(header_cbor : B)]

Era tags:
  0 = Byron
  1 = Shelley
  2 = Allegra
  3 = Mary
  4 = Alonzo
  5 = Babbage
  6 = Conway

decode_header_envelope(header_data) -> (N, B):
  era_tag     <- header_data[0]
  payload     <- header_data[1]
  if payload is CBORTag(24):
    header_cbor <- payload.value
  else if payload is B:
    header_cbor <- payload
  return (era_tag, header_cbor)
```

### 12.3.6 Intersection Finding

The initiator computes exponentially-spaced intersect points to
efficiently locate the common chain prefix with the responder:

```
build_intersect_points(tip_slot, tip_hash, volatile_slots) -> [Point]:
  points <- []
  if volatile_slots != empty:
    sorted <- sort_descending(volatile_slots)
    step <- 1; i <- 0
    while i < |sorted|:
      (slot, hash) <- sorted[i]
      points.append(Point(slot, hash))
      i <- i + step
      step <- step * 2
  else:
    points.append(Point(tip_slot, tip_hash))
  points.append(Point.origin())
  return points
```

This produces a sequence like: `[tip, tip-1, tip-2, tip-4, tip-8, ..., origin]`.

### 12.3.7 Receive Logic

The client handles MsgAwaitReply transparently, looping until a
substantive message arrives:

```
recv_msg(timeout=120.0) -> [Any]:
  loop:
    raw <- buffer.recv_message(timeout)
    reply <- cbor_decode(raw)
    if reply[0] = 1:  continue  -- MsgAwaitReply: keep waiting
    if reply[0] = 7:  raise ChainSyncError("MsgDone")
    return reply
```

### 12.3.8 Constraints

| Property           | Value  |
|--------------------|--------|
| Receive timeout    | 120 s  |
| Protocol ID        | 2      |

---

## 12.4 BlockFetch Protocol

Mini-protocol ID 3. The initiator requests a range of blocks by
their (slot, hash) endpoints. The responder streams them back.

### 12.4.1 State Machine

```
             MsgRequestRange(from, to)
  StIdle ─────────────────────────────> StBusy
    ^                                     |
    |                           +---------+---------+
    |                           |                   |
    |                     MsgStartBatch        MsgNoBlocks
    |                           |                   |
    |                           v                   |
    |                      StStreaming              |
    |                           |                   |
    |            +--------------+----------+        |
    |            |                         |        |
    |      MsgBlock(block)          MsgBatchDone    |
    |            |                         |        |
    |            v                         |        |
    |       StStreaming                    |        |
    |       (repeat)                       |        |
    +--------------------------------------+--------+

  StIdle ──MsgClientDone──> StDone  (terminal)
```

**Agency:** The initiator has agency in StIdle. The responder has
agency in StBusy and StStreaming.

### 12.4.2 Message Tags

```
  MsgRequestRange = 0
  MsgClientDone   = 1
  MsgStartBatch   = 2
  MsgNoBlocks     = 3
  MsgBlock        = 4
  MsgBatchDone    = 5
```

### 12.4.3 Message Encoding

```
MsgRequestRange = [0, from_point, to_point]
  from_point, to_point : Point = [slot, block_hash]

MsgClientDone   = [1]
MsgStartBatch   = [2]
MsgNoBlocks     = [3]
MsgBlock        = [4, block_envelope]
MsgBatchDone    = [5]
```

### 12.4.4 Block Envelope

Blocks arrive in the ns7 era-tagged format with CBOR tag 24 wrapping:

```
block_envelope = #6.24(block_cbor : B)

extract_block_bytes(payload) -> B:
  if payload is CBORTag(24):
    inner <- payload.value
    return cbor_encode(CBORTag(24, inner))   -- re-wrap for decoder
  if payload is B:
    return cbor_encode(CBORTag(24, payload))
  raise BlockFetchError
```

The extracted bytes retain the tag-24 envelope so that
`decode_block_from_wire()` can process them uniformly.

### 12.4.5 Fetch Operation

```
fetch_range(from_point, to_point) -> [B]:
  send(PROTO_BLOCK_FETCH, cbor([0, from_point.to_cbor(), to_point.to_cbor()]))
  reply <- recv_msg()

  if reply[0] = 3:  return []     -- MsgNoBlocks
  require reply[0] = 2            -- MsgStartBatch

  blocks <- []
  loop:
    reply <- recv_msg()
    if reply[0] = 4:              -- MsgBlock
      blocks.append(extract_block_bytes(reply[1]))
      require |blocks| <= MAX_BLOCKS_PER_BATCH
    else if reply[0] = 5:         -- MsgBatchDone
      break
    else:
      raise BlockFetchError

  return blocks
```

### 12.4.6 Constraints

| Property               | Value   |
|------------------------|---------|
| Max blocks per batch   | 2000    |
| Receive timeout        | 120 s   |
| Protocol ID            | 3       |

---

## 12.5 TxSubmission2 Protocol

Mini-protocol ID 4. Bidirectional transaction relay. After
initialization, the **server** (responder) drives the protocol by
requesting transaction IDs and bodies. The **client** (initiator)
provides them from the local mempool.

### 12.5.1 State Machine

```
             MsgInit
  StInit ──────────────> StIdle(server)
                            |
              +-------------+-------------+
              |                           |
    MsgRequestTxIds              MsgRequestTxs
    (blocking, ack, req)         ([tx_id, ...])
              |                           |
              v                           v
           StTxIds                     StTxs
              |                           |
       MsgReplyTxIds              MsgReplyTxs
       ([(tx_id,size)])           ([tx_cbor])
              |                           |
              v                           v
        StIdle(server)             StIdle(server)

  StIdle ──MsgDone──> StDone  (terminal, server-initiated)
```

**Agency:** After MsgInit, the server holds agency in StIdle. The
client holds agency in StTxIds and StTxs.

### 12.5.2 Message Tags

```
  MsgRequestTxIds = 0
  MsgReplyTxIds   = 1
  MsgRequestTxs   = 2
  MsgReplyTxs     = 3
  MsgDone         = 4
  MsgInit         = 6
```

### 12.5.3 Message Encoding

```
MsgInit              = [6]
MsgRequestTxIds      = [0, blocking : N, ack_count : N, req_count : N]
MsgReplyTxIds        = [1, [[tx_id : B_32, tx_size : N], ...]]
MsgRequestTxs        = [2, [tx_id : B_32, ...]]
MsgReplyTxs          = [3, [tx_cbor : B, ...]]
MsgDone              = [4]
```

### 12.5.4 Client Logic

The client maintains a list of outstanding (advertised but
unacknowledged) transaction IDs.

```
State:
  _outstanding : [(tx_id : B_32, tx_size : N)]

run():
  send(PROTO_TX_SUBMISSION, cbor([6]))   -- MsgInit
  loop:
    msg <- recv_msg(timeout=120.0)
    match msg[0]:
      0 -> handle_request_tx_ids(msg)
      2 -> handle_request_txs(msg)
      4 -> break  -- MsgDone

handle_request_tx_ids([0, blocking, ack_count, req_count]):
  _outstanding <- _outstanding[ack_count ..]   -- remove acknowledged
  all_ids <- mempool.get_tx_ids()
  outstanding_set <- { tid | (tid, _) in _outstanding }
  new_ids <- [ tid | tid in all_ids, tid not in outstanding_set ][:req_count]

  pairs <- []
  for tid in new_ids:
    tx_cbor <- mempool.get_tx(tid)
    if tx_cbor != bottom:
      pairs.append([tid, |tx_cbor|])
      _outstanding.append((tid, |tx_cbor|))

  send(PROTO_TX_SUBMISSION, cbor([1, pairs]))

handle_request_txs([2, requested_ids]):
  txs <- []
  for tid in requested_ids:
    tx_cbor <- mempool.get_tx(tid)
    if tx_cbor != bottom:
      txs.append(tx_cbor)
  send(PROTO_TX_SUBMISSION, cbor([3, txs]))
```

### 12.5.5 Constraints

| Property           | Value  |
|--------------------|--------|
| Receive timeout    | 120 s  |
| Protocol ID        | 4      |

---

## 12.6 KeepAlive Protocol

Mini-protocol ID 8. Sends periodic heartbeat pings to detect dead
connections. The responder must echo the cookie value unchanged.

### 12.6.1 Message Encoding

```
MsgKeepAlive         = [0, cookie : N_16]
MsgKeepAliveResponse = [1, cookie : N_16]
MsgDone              = [2]
```

### 12.6.2 Client Logic

```
State:
  cookie : N_16 = 0

run():
  sleep(initial_delay)      -- 1.0 s
  loop:
    ping(cookie)
    cookie <- (cookie + 1) mod 2^16
    sleep(interval)         -- 30.0 s

ping(cookie):
  send(PROTO_KEEP_ALIVE, cbor([0, cookie]))
  reply_bytes <- recv_message(timeout=60.0)
  reply <- cbor_decode(reply_bytes)
  require reply[0] = 1
  require reply[1] = cookie     -- cookie mismatch => KeepAliveError
```

### 12.6.3 Timing Parameters

| Parameter       | Value  |
|-----------------|--------|
| Initial delay   | 1 s    |
| Ping interval   | 30 s   |
| Response timeout| 60 s   |
| Protocol ID     | 8      |

---

## 12.7 Peer Connection Lifecycle

A PeerConnection orchestrates the full TCP session with a single
remote peer, managing protocol registration, handshake, and
concurrent protocol execution.

### 12.7.1 PeerAddress

```
PeerAddress = (host : String, port : N_16)
```

### 12.7.2 Connection Sequence

```
connect():
  (reader, writer) <- tcp_connect(host, port)
  mux <- Multiplexer(reader, writer, is_initiator=true)

  -- Phase 1: Handshake
  hs_buffer <- ProtocolBuffer()
  mux.register_protocol(PROTO_HANDSHAKE, hs_buffer)
  read_task <- spawn(mux.read_loop())
  negotiated_version <- perform_handshake(mux, hs_buffer, network_magic)

  -- Phase 2: Register remaining protocols
  cs_buffer <- ProtocolBuffer()
  bf_buffer <- ProtocolBuffer()
  ka_buffer <- ProtocolBuffer()
  mux.register_protocol(PROTO_CHAIN_SYNC, cs_buffer)
  mux.register_protocol(PROTO_BLOCK_FETCH, bf_buffer)
  mux.register_protocol(PROTO_KEEP_ALIVE, ka_buffer)

  chainsync  <- ChainSyncClient(mux, cs_buffer, ...)
  blockfetch <- BlockFetchClient(mux, bf_buffer)
  keepalive  <- KeepAliveClient(mux, ka_buffer)
```

### 12.7.3 Concurrent Execution

```
run_protocols(intersect_points):
  tasks <- { chainsync.run(intersect_points),
             keepalive.run(),
             read_task }
  (done, pending) <- wait(tasks, FIRST_EXCEPTION)
  for t in done:
    if t.exception != bottom:
      raise t.exception
  finally:
    cancel all tasks
    mux.close()
```

### 12.7.4 Disconnect

```
disconnect():
  mux.close()    -- sets _closed, closes writer
```

---

## 12.8 Peer Selection

The outbound governor manages a pool of known peers, tracks quality
metrics, and selects the best peers for active connections.

### 12.8.1 Peer States

```
PeerStatus in {COLD, WARM, ACTIVE, BANNED}

State transitions:
  COLD   --connect_success--> ACTIVE
  ACTIVE --disconnect------> WARM
  WARM   --connect_success--> ACTIVE
  *      --too_many_errors--> BANNED
  BANNED --ban_expires------> COLD
```

### 12.8.2 PeerInfo

```
PeerInfo:
  host                  : String
  port                  : N_16
  status                : PeerStatus  (default COLD)
  latency_ms            : Float       (default 0.0)
  blocks_served         : N           (default 0)
  error_count           : N           (default 0)
  last_connected        : Float       (Unix timestamp)
  last_error            : Float       (Unix timestamp)
  ban_until             : Float       (Unix timestamp; 0 = not banned)
  connect_attempts      : N           (default 0)
  successful_connections: N           (default 0)
```

### 12.8.3 Scoring Function

```
score(peer) : Float
  raw <- peer.latency_ms + peer.error_count * 1000
                         - peer.blocks_served * 0.1
  return max(raw, -10000.0)
```

Lower score indicates a better peer. The floor of -10000 prevents
score from diverging negatively for peers that have served many blocks.

### 12.8.4 Selection

```
select_for_connection(count : N) -> [PeerInfo]:
  now <- current_time()
  candidates <- []
  for peer in _peers.values():
    if peer.status = BANNED:
      if now < peer.ban_until: continue
      peer.status <- COLD
      peer.error_count <- 0
    if peer.status = ACTIVE: continue
    candidates.append(peer)

  sort candidates by (score ascending, latency_ms ascending)
  return candidates[..count]
```

### 12.8.5 Peer Lifecycle Operations

```
mark_connected(host, port, latency_ms):
  peer <- add_peer(host, port)
  peer.status <- ACTIVE
  peer.latency_ms <- latency_ms
  peer.last_connected <- now()
  peer.connect_attempts += 1
  peer.successful_connections += 1

mark_disconnected(host, port):
  peer.status <- WARM

mark_error(host, port, error):
  peer.error_count += 1
  peer.last_error <- now()
  peer.connect_attempts += 1
  if peer.error_count >= max_errors_before_ban:
    peer.status <- BANNED
    peer.ban_until <- now() + ban_duration

mark_block_served(host, port):
  peer.blocks_served += 1
```

### 12.8.6 Selector Parameters

| Parameter              | Default |
|------------------------|---------|
| max_active             | 5       |
| max_warm               | 10      |
| ban_duration           | 300 s   |
| max_errors_before_ban  | 5       |

---

## 12.9 Sync Pipeline

The sync pipeline connects all networking components into a live
chain-following flow, with crash recovery and automatic reconnection.

### 12.9.1 Session Architecture

```
SyncSession(peer_host, peer_port, network_magic, state, ...):

  1. TCP connect (timeout 15 s)
  2. Multiplexer + protocol buffer registration
  3. Handshake (timeout 15 s)
  4. Spawn keepalive background task
  5. ChainSync: find intersection from known point or discover tip
  6. Main loop:
     a. MsgRequestNext
     b. Receive (handle AwaitReply transparently)
     c. On MsgRollForward:
        i.   Decode header envelope -> (slot, hash, era_tag)
        ii.  Skip non-Conway blocks (era_tag != 6)
        iii. BlockFetch: fetch_range(point, point) for single block
        iv.  Decode block, apply_block(state, block) in executor
        v.   Store in VolatileDB
        vi.  Nonce evolution from VRF output
        vii. Graduate blocks older than 2000 slots to ImmutableDB
        viii.Periodic LedgerDB checkpoint
     d. On MsgRollBackward:
        i.   VolatileDB.rollback_to(slot)
        ii.  LedgerDB.load_checkpoint_before(slot)
        iii. Re-apply blocks between checkpoint and rollback point
```

### 12.9.2 Reconnection

```
live_sync:
  max_retries <- 100
  retry_delay <- 1.0

  for attempt in 0..max_retries:
    if attempt > 0:
      sleep(retry_delay)
      retry_delay <- min(retry_delay * 2, 60.0)   -- exponential backoff

    try:
      session.run()
    catch:
      ledger_db.save_checkpoint(state)
      continue
```

### 12.9.3 State Initialization Priority

```
1. LedgerDB checkpoint  (crash recovery)
2. Snapshot file         (--snapshot flag)
3. Genesis files         (--genesis-dir flag)
4. Empty LedgerState     (fallback)
```

### 12.9.4 Graduation Condition

```
if volatile_db.count() > 100:
  cutoff <- current_slot - 2000
  for block in volatile_db.graduate(cutoff):
    immutable_db.append(block.slot, block.block_number,
                        block.block_hash, block.raw)
```

### 12.9.5 Multi-Peer Sync

```
multi_peer_sync(peers, ...):
  selector <- PeerSelector()
  for (host, port) in peers:
    selector.add_peer(host, port)

  for attempt in 0..|peers|*3:
    candidates <- selector.select_for_connection(1)
    if candidates = []: break
    peer <- candidates[0]
    try:
      result <- live_sync(peer.host, peer.port, ...)
      selector.mark_connected(peer.host, peer.port)
      break
    catch:
      selector.mark_error(peer.host, peer.port, error)
```

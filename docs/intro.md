---
sidebar_position: 1
---

# Bluematter

> **An independent Cardano full-node implementation in pure Python.**

Bluematter implements the complete Cardano Conway-era protocol stack: Ouroboros Praos consensus, the extended UTxO ledger with multi-asset support, Plutus smart contract evaluation (V1/V2/V3), and the full Ouroboros network mini-protocol suite. It has successfully synced the entire Cardano preprod chain - 1.5 million blocks with zero validation errors.

This book is the complete technical reference: protocol theory, formal specification, and implementation architecture.

---

## Project at a Glance

| | |
|---|---|
| **Supported era** | Conway (protocol version 9+) |
| **Consensus** | Ouroboros Praos with VRF leader election |
| **Smart contracts** | Plutus V1, V2, V3 via OpShin CEK machine |
| **Networking** | ChainSync, BlockFetch, TxSubmission2, KeepAlive |
| **Preprod sync** | 1,518,765 blocks, 106 epochs |
| **ADA conservation** | Verified against Koios API epoch-by-epoch |

---

## What This Book Covers

### Part I - Cardano Protocol (Chapters 1–6)

The theoretical and historical foundation. Start here if you're new to Cardano.

| Chapter | What You'll Learn |
|---------|-------------------|
| **1. Research & Foundations** | All 9 Ouroboros papers, the EUTXO model, the academic peer-review methodology behind Cardano |
| **2. Era Evolution & Hard Forks** | Every hard fork from Byron (2017) through Conway (2024), with dates, epochs, protocol versions, and what each changed |
| **3. Node Architecture** | How the Haskell reference node works internally - consensus, ledger, networking, storage layers |
| **4. Formal Ledger Specs** | The STS transition rules that define Cardano: UTXO, UTXOW, DELEG, LEDGER, EPOCH, CHAIN |
| **5. Networking Protocols** | Mini-protocol state machines, multiplexer wire format, CDDL message definitions |
| **6. Current State & Roadmap** | Where Cardano is today (2026): governance, Genesis, Leios, UTxO-HD, alternative nodes |

### Part II - Formal Specification (Chapters 7–20)

The Gray Paper. Precise equations defining every data type, validation rule, and state transition. **Someone could reimplement the entire node from Part II alone.**

| Chapter | What It Specifies |
|---------|-------------------|
| **7. Notation** | Type system (B, H, N, S, M, L), symbols (σ, τ, π, η), state transition notation |
| **8. Cryptographic Primitives** | Blake2b-224/256, Ed25519, VRF (Elligator2 + leader/nonce derivation), KES (Sum6KES) |
| **9. Data Types** | Addresses (10 types), Values (multi-asset), TxBody (20 fields), Header, Block, LedgerState |
| **10. Serialization** | CBOR byte-preservation, wire format, 7 hash computation formulas, 9 security measures |
| **11. Ledger State Machine** | Block application (BBODY), transaction application, invalid tx collateral, epoch boundary |
| **12. Transaction Validation** | All 19 UTxO rules as formal predicates, witness validation, script data hash |
| **13. Plutus Scripts** | Two-phase model, script resolution, V1/V2/V3 TxInfo, ScriptPurpose vs ScriptInfo, CEK execution |
| **14. Certificates** | All 19 certificate types (0–18) with preconditions, postconditions, deposit accounting |
| **15. Epoch Boundary** | 9-step transition: fee snapshot, rewards, pool retirement, governance, snapshot rotation |
| **16. Reward Calculation** | Full Shelley formula: monetary expansion, maxPool desirability, operator/member split |
| **17. Consensus** | Praos leader election, nonce evolution (UPDN + TICKN), header validation (12 checks) |
| **18. Governance** | CIP-1694: 3 voting bodies, 7 action types, stake-weighted ratification, enactment effects |
| **19. Networking** | Multiplexer framing, 5 mini-protocol state machines, peer selection governor |
| **20. Storage** | VolatileDB (fork-aware), ImmutableDB (SQLite), LedgerDB (HMAC checkpoints), crash recovery |

### Part III - Bluematter Architecture (Chapters 21–28)

How the Python implementation maps to the spec. The **Call Flows** chapter is the most important - it traces every function call from CLI entry through TCP handshake, block decode, validation, ledger update, all the way to disk write.

| Chapter | What It Documents |
|---------|-------------------|
| **21. Overview** | Module map, data flow diagram (ASCII), 5-phase node lifecycle |
| **22. Call Flows** | Function-by-function trace with exact args, return values, and call stack depth |
| **23. Codec** | `@cbor_array`/`@cbor_map` schema system, byte-preserving decode |
| **24. Crypto** | VRF Elligator2, KES Sum6KES Merkle tree, 17-entry hash usage map |
| **25. Consensus** | `validate_header` 10 checks, nonce lifecycle diagram, leader threshold math |
| **26. Ledger** | `apply_block` pipeline, 19 UTxO rules, reward formula, Plutus V1/V2/V3 |
| **27. Network** | Mux, ChainSync, BlockFetch, TxSubmission2, peer scoring |
| **28. Node** | CLI, sync pipeline, server mode, block forging, 3 storage tiers, mempool, metrics |

---

## Architecture Overview

```text
                          ┌──────────────┐
                          │  TCP Peer    │
                          └──────┬───────┘
                                 │
                     ┌───────────▼───────────┐
                     │     Multiplexer       │  8-byte frames
                     │    (network/mux)      │  CBOR reassembly
                     └───────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
     ┌────────▼────────┐  ┌─────▼──────┐   ┌───────▼───────┐
     │   ChainSync     │  │ BlockFetch │   │  KeepAlive    │
     │   (headers)     │  │  (blocks)  │   │  (heartbeat)  │
     └────────┬────────┘  └─────┬──────┘   └───────────────┘
              │                  │
     ┌────────▼──────────────────▼──────────┐
     │          decode_block()              │  CBOR → ConwayBlock
     │         (codec/block)                │  Byte-preserving
     └─────────────────┬────────────────────┘
                       │
     ┌─────────────────▼────────────────────┐
     │        validate_header()             │  VRF proof
     │       (consensus/header)             │  KES sig
     └─────────────────┬────────────────────┘  Leader check
                       │
     ┌─────────────────▼────────────────────┐
     │         apply_block()                │  19 UTxO rules
     │        (ledger/block)                │  Witness verify
     └─────────────────┬────────────────────┘  Plutus eval
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼─────┐ ┌─────▼─────┐ ┌────▼────────┐
    │Immutable │ │ LedgerDB  │ │ VolatileDB  │
    │   DB     │ │(checkpts) │ │  (recent)   │
    └──────────┘ └───────────┘ └─────────────┘
                       │
                       ▼
              Epoch boundary?
                  yes → tick() → rewards, snapshots, governance
```

---

## Quick Links

- [Call Flows - the most detailed chapter](./architecture/call-flows.md) - every function call traced
- [Transaction Validation Rules](./spec/transactions.md) - all 19 UTxO predicates
- [Reward Calculation Formula](./spec/rewards.md) - the complete Shelley incentive math
- [Nonce Evolution Lifecycle](./spec/consensus.md) - UPDN + TICKN rules

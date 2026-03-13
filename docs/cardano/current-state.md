# Current State

*Last updated: 2026-03-12*

This document provides a overview of the Cardano ecosystem as of March 2026,
covering the current network state, governance, consensus research, scaling solutions,
alternative node implementations, and the forward-looking roadmap.

---

## Table of Contents

1. [Current Network State](#1-current-network-state)
2. [Conway/Voltaire Governance](#2-conwayvoltaire-governance)
3. [Ouroboros Genesis](#3-ouroboros-genesis)
4. [Ouroboros Leios](#4-ouroboros-leios)
5. [UTxO-HD](#5-utxo-hd)
6. [Alternative Node Implementations](#6-alternative-node-implementations)
7. [Ecosystem Tools and Scaling](#7-ecosystem-tools-and-scaling)
8. [Upcoming Roadmap (2026-2027)](#8-upcoming-roadmap-2026-2027)
9. [Notable Events](#9-notable-events)

---

## 1. Current Network State

### Node Version

- **Latest release**: cardano-node **v10.6.2** (February 2026)
  - Removes legacy networking stack entirely
  - Enhanced tracing system for observability and diagnostics
  - Foundational work for Protocol Version 11 (intra-era hard fork) and Protocol Version 12 (Dijkstra era)
- **Upcoming release**: cardano-node **v10.7.0** (hard fork candidate)
  - Capable of the Protocol Version 11 hard fork
  - Pending successful testnet deployments and formal benchmarking
  - Will first activate on Preview and PreProd before mainnet

### Protocol Version and Era

| Property | Value |
|---|---|
| **Current era** | Conway |
| **Current protocol version** | 10 |
| **Next protocol version** | 11 (intra-era hard fork, slated ~March 2026) |
| **Future era** | Dijkstra (protocol version 12) |

The Conway era was activated in two stages:
- **Chang #1** (September 1, 2024, epoch 507): bootstrapping phase, introduced PlutusV3, DReps, Interim Constitutional Committee, genesis keys burned
- **Chang #2 / Plomin hard fork** (January 29, 2025): full governance activation, complete CIP-1694 implementation

### Network Statistics (approximate, early 2026)

| Metric | Value |
|---|---|
| **Stake pools** | ~3,000 active |
| **Staking addresses** | ~1.3 million |
| **Unique wallets** | ~4.83 million |
| **Daily active addresses** | ~110,000 |
| **Daily transactions** | ~2.6 million |
| **Base layer TPS** | ~0.41 real-time, ~11.62 max observed, ~18 theoretical cap |
| **Total transactions (all time)** | >450 million |
| **Staking yield** | ~2-4% annually |
| **Treasury balance** | ~1.7 billion ADA (~25.92M ADA monthly inflow) |
| **Market cap** | ~$20 billion+ (late 2025) |
| **Smart contracts** | ~129,637 (6,949 V1, 120,494 V2, 2,194+ V3) |

---

## 2. Conway/Voltaire Governance

### CIP-1694 Implementation Status: DEPLOYED

CIP-1694 defines Cardano's on-chain governance framework, the core of the Voltaire era. It
implements a tripartite governance model:

1. **Delegated Representatives (DReps)**: ADA holders delegate voting power; one lovelace = one vote
2. **Constitutional Committee (CC)**: Votes on constitutionality of governance actions
3. **Stake Pool Operators (SPOs)**: Vote on technical/protocol changes

### DRep Statistics (early 2026)

| Metric | Value |
|---|---|
| **Total registered DReps** | ~1,532 |
| **Active DReps** | ~1,021 |
| **Total delegated voting power** | ~11.73 billion ADA |
| **Delegated to Abstain** | ~6.23 billion ADA (105,400 people) |
| **Delegated to No Confidence** | ~173 million ADA (5,200 people) |
| **Active autonomous delegation** | ~14% of circulating ADA |
| **Top 14 DReps** | Hold >50% of voting power |

Key DRep participants include the Cardano Foundation (100% voting record in 2025), EMURGO,
and wallet providers (Yoroi, Eternl). The Cardano Foundation delegated 140M ADA to seven
community DReps and later 220M ADA to eleven more.

### Cardano Constitution

- **Constitutional Convention**: December 4-6, 2024, held simultaneously in Buenos Aires and Nairobi
  - 63 workshops across 51 countries preceded it
  - 95% of elected delegates approved the draft
- **On-chain DRep vote**: Constitution submitted January 30, 2025; achieved overwhelming support by February 23, 2025
- **Constitution v2.4**: Enacted January 24, 2026, with stricter requirements for immutable metadata

### Key Governance Actions Enacted (2025-2026)

| Action | Details | Status |
|---|---|---|
| **Constitution ratification** | v2.4 enacted Jan 24, 2026 | ENACTED |
| **$71M treasury withdrawal** | 96M ADA for IOG 12-month development (Leios, Hydra, Mithril) | ENACTED (Aug 2025, 74% approval) |
| **Net Change Limit (NCL)** | 350M ADA cap on treasury withdrawals per budget cycle | ENACTED |
| **NCL extension** | 8-epoch extension to prevent spending cliff (83.8% DRep support) | ENACTED |
| **Critical Integrations Budget** | 70M ADA for stablecoins, custody, bridges, oracles, analytics | ENACTED |
| **CC snap election** | Replacement member elected Dec 2025 after resignation | ENACTED |
| **Community roadmap 2025** | Approved with 63.81% DRep support | ENACTED |
| **Cardano 2030 Vision** | Long-term strategic plan | ENACTED |
| **2026 Budget Process Framework** | Standardized templates, structured review stages | IN PROGRESS |

### Governance Infrastructure

- **GovTool**: Web interface for DRep registration and governance action voting
- **Budget Process Framework 2026**: Data-driven approach with standardized templates
- **Net Change Limit**: 350M ADA for 2026 budget cycle
- **Governance action deposit**: 100,000 ADA (refundable)

---

## 3. Ouroboros Genesis

### What It Solves

Ouroboros Genesis addresses the fundamental problem of **trustless bootstrapping**: how can a
node safely join the network from scratch (or after prolonged absence) without relying on
trusted checkpoints or centralized bootstrap peers?

Currently, new nodes use "bootstrap peers" -- a set of ~20 trusted relays operated by IOG and
EMURGO. Genesis replaces this centralized mechanism with a trustless protocol where a syncing
node can safely include untrustworthy peers, as long as at least one peer is honest.

### How It Changes Chain Selection

Genesis extends Praos with a novel chain selection rule that:
- Allows nodes to distinguish between honest and adversarial chains during bootstrap
- Uses the **Limit on Eagerness (LoE)**, **Genesis Density Disconnect (GDD)**, and **Limit on Patience (LoP)** mechanisms
- Once synced, behavior is externally indistinguishable from standard Praos

### Deployment Status: DEPLOYED ON TESTNETS, OPTIONAL ON MAINNET

| Milestone | Node Version | Status |
|---|---|---|
| Experimental feature (disabled by default) | 10.2 - 10.4 | DEPLOYED |
| Default on Preview & PreProd testnets | 10.5.0 | DEPLOYED |
| Optional on mainnet (PraosMode still default) | 10.6.0 | DEPLOYED |
| Expected mainnet default | 10.7 (2026) | PLANNED |

**Current mainnet config**: `ConsensusMode: PraosMode` (Genesis available via `GenesisMode`)

When Genesis becomes the mainnet default (possibly node 10.7), a peer snapshot file will be
mandatory and the node will fail to start without it. Operators can already opt in by setting
`ConsensusMode: GenesisMode` in their config.

### Known Issues

- A bug in Genesis as of 10.2-10.4 releases made caught-up nodes susceptible to a kind of eclipse attack (fixed in later releases)
- Lightweight checkpoints were not integrated in early releases
- Genesis mode and bootstrap peers are mutually exclusive; enabling one disables the other

---

## 4. Ouroboros Leios

### What It Is

Ouroboros Leios is a major redesign of Cardano's consensus protocol that introduces **parallel
block processing** through a three-tier block architecture. It extends (rather than replaces)
Ouroboros Praos.

### Three Block Types

```
  Input Blocks (IBs)         Endorsement Blocks (EBs)      Ranking Blocks (RBs)
  ==================         ========================      ====================
  - Contain transactions     - Reference one or more IBs   - Praos-style blocks
  - Produced frequently      - Undergo voting/cert process - ~20 second interval
  - Parallel production      - Validate IBs in parallel    - Establish final tx order
  - Won via IB sortition     - Won via EB sortition        - Contains certificates
  - Pending until endorsed   - Endorsement = validation    - Main blockchain
```

**Analogy**: In Praos, one worker builds a block every 20 seconds. In Leios, dozens of workers
create IBs continuously, others check them with EBs, and a supervisor (RB) approves the batch
every 20 seconds.

### Expected Performance

| Metric | Current (Praos) | Leios Target |
|---|---|---|
| **Throughput** | ~4.5 TxkB/s | 140-300 TxkB/s (30-50x improvement) |
| **TPS** | 5-15 TPS | 300-1,000+ TPS (peaks to 10,000) |
| **Confirmation latency** | ~20 seconds | 45-60 seconds (CIP approach) |
| **Block interval** | 20 seconds | 20 seconds (RBs unchanged) |

The CIP specification strikes a balance between throughput gains and ecosystem compatibility,
choosing modest latency increases (45-60s vs 20s) over the research paper's approach (which
achieves higher throughput but requires 2-3 minute confirmations and extensive ecosystem changes).

### Deployment Status: IN DEVELOPMENT

| Milestone | Status |
|---|---|
| Research paper published | COMPLETE |
| CIP specification | ~67% complete (Jan 2026) |
| Specifications | IN PROGRESS |
| Simulations | IN PROGRESS |
| Code implementation | IN PROGRESS |
| Testnet deployment | PLANNED (2026) |
| Mainnet deployment | PLANNED (2026, originally 2028 -- accelerated) |

**Funding**: Part of the community-approved $71M 12-month upgrade roadmap (August 2025).

**Leios Lite**: The practical deployment approach extends Praos by introducing parallel block
processing through input and endorsement blocks while preserving a single linear chain of
ranking blocks. Estimated 1-1.5 year deployment timeline from CIP finalization.

---

## 5. UTxO-HD

### What It Is

UTxO-HD is a rework of the Consensus layer that allows the UTxO set to be stored either fully
in-memory (as before) or on external storage (SSD/HD). This addresses the growing memory
requirements as the UTxO set expands.

### Two Backends

| Backend | Status | Use Case |
|---|---|---|
| **V2InMemory** | PRODUCTION READY | Block producers, relays (recommended) |
| **V1LMDB** (on-disk) | EXPERIMENTAL | Edge nodes, wallets, explorers, exchanges |

### Deployment Status: DEPLOYED (IN-MEMORY), EXPERIMENTAL (LMDB)

- **Node 10.4.1**: First integration of UTxO-HD into Cardano node
- **In-memory backend**: Mainnet ready, recommended for production
- **LMDB on-disk backend**: Fully functional but with performance regression; not recommended for block producers
- **Benchmarking** (Q3 2025): Internal performance benchmarking comparing disk-based LMDB with in-memory solutions; challenges with GHC memory management and direct SSD requirements

### Roadmap

The long-term plan has three phases:
1. Move UTxO set on-disk using LMDB (CURRENT)
2. Migrate to a **custom LSM tree library** (being developed by Well-Typed) for better on-disk performance
3. Identify other ledger state components to migrate

The LSM tree approach aims to allow Cardano to scale to potentially billions of users and
significantly larger UTxO sets while enabling nodes to run on optimized hardware.

---

## 6. Alternative Node Implementations

### Amaru (Rust) -- PRAGMA

**Status**: IN DEVELOPMENT (relay functional, block production not yet)

| Property | Details |
|---|---|
| **Language** | Rust |
| **Organization** | PRAGMA (Cardano Foundation, Blink Labs, DC Spark, Sundae Labs, TxPipe) |
| **Repository** | github.com/pragma-org/amaru |
| **Funding** | 1.5M ADA from Cardano treasury (2025) |
| **First release target** | September 2025 |

**Current capabilities**:
- Functions as a Cardano relay node (externally indistinguishable from Haskell relay)
- On-disk ledger storage (UTxO, stake pools, rewards, delegations)
- Snapshot bootstrapping
- gRPC interfaces
- Multi-platform (ARM, WASM, RISC-V)
- Trace forwarding mini-protocol implemented in native Rust

**Roadmap**:
- Simple mempool: Q2 2025
- Block forging: Q3 2025
- Complex mempool: Q4 2025
- Conformance testing suite
- Leios compatibility (critical for 2026 mainnet deployment)

**Why it matters**: Alternative implementations improve spec quality (bugs found via conformance
testing), documentation, and network resilience. Amaru has already identified discrepancies in
the original Haskell implementation through its development process.

### Dolos (Rust) -- TxPipe

**Status**: APPROACHING 1.0 (v1.0.0-rc.10 as of Feb 2026)

| Property | Details |
|---|---|
| **Language** | Rust |
| **Organization** | TxPipe |
| **Repository** | github.com/txpipe/dolos |
| **Role** | Data node (not a full consensus node) |

**Key features**:
- Optimized for keeping an updated ledger and responding to queries
- Fraction of the resources of a full node
- Rich API surface: REST, gRPC, HTTP, JSON-RPC, Ouroboros protocols
- Flexible storage: ledger-only, sliding window, or full archive
- Phase-1 transaction validation (everything except Plutus script execution)
- Pluggable storage backends (Redb v3 or Fjall LSM-tree)
- Connects via Ouroboros N2N mini-protocols (via Pallas library)

**Recent releases**:
- v1.0.0-rc.10 (Feb 17, 2026): Mempool support, OTLP integration
- v1.0.0-rc.8 (Feb 7, 2026): Byron address parsing, memory caches, mainnet genesis support

### Pallas (Rust Library) -- TxPipe

A foundational Rust library providing building blocks for Cardano:
- Ouroboros mini-protocol implementations
- CBOR codec for Cardano data types
- Used by 36+ projects (including Amaru and Dolos)
- Repository: github.com/txpipe/pallas (188 stars, 89 forks)

### Comparison

| Feature | Haskell (cardano-node) | Amaru | Dolos |
|---|---|---|---|
| **Language** | Haskell | Rust | Rust |
| **Consensus participation** | Full | Not yet | No (by design) |
| **Block production** | Yes | Planned Q3 2025 | No |
| **Relay mode** | Yes | Yes | Yes (data relay) |
| **Ledger storage** | In-memory + LMDB | On-disk | On-disk (Redb/Fjall) |
| **Memory footprint** | High (~16GB+) | Lower | Minimal |
| **API** | Ouroboros mini-protocols | gRPC + Ouroboros | REST, gRPC, HTTP, JSON-RPC |
| **Maturity** | Production | Exploratory/Beta | RC (approaching 1.0) |

---

## 7. Ecosystem Tools and Scaling

### Mithril -- Stake-Based Threshold Signatures

**Status**: DEPLOYED, actively advancing toward SNARK-based proofs

**What it does**: Provides certified snapshots of blockchain state using stake-based
multi-signatures. Primary use case: fast node bootstrapping without processing entire chain
history.

**Key developments (2025-2026)**:
- **SNARK-based proofs**: Halo2 circuit achieves 4 kB certificate size, 7ms verification, 6 min generation
- **ALBA proof circuit**: Same 4 kB size but only 1.5 min generation time
- **Distribution 2603.1** (Feb 2026): Decentralized message queue protocol, Blockfrost API integration
- **Signer authentication**: SNARK verification keys, precision calibration for lottery computation
- **Decentralization**: Draft CIP for signature diffusion through Cardano network under review
- **Security**: IOG-owned key signs ledger state snapshots to prevent tampering; mitigation for snapshot inconsistency advisory

**Future**: On-chain certificate verification (target <16 kB, achieved 4 kB), fully decentralized signature orchestration.

### Hydra -- Layer-2 State Channels

**Status**: PRODUCTION READY (v1, October 2025)

**Architecture**: Off-chain "Hydra Heads" process transactions with near-instant finality,
settle final state on Layer 1. Isomorphic design supports native tokens, NFTs, and Plutus
smart contracts.

**Performance**:
- Stress test: sustained 650,000 TPS, peaked over 1,000,000 TPS, processed 14 billion total transactions
- Near-instant settlement within heads
- Each new Hydra Head adds additional capacity (linear scalability)

**Real-world usage**:
- Hydra vending machine demos at Rare Evo (Las Vegas) and TOKEN2049 (Singapore)
- Midnight NIGHT token generation event (Q3 2025)
- **Echo** by Pondora: first non-custodial DEX built on Hydra
- **Hydrozoa**: community-driven protocol for lightweight, flexible Hydra Heads with dynamic membership

**Roadmap**: Multi-head interconnection protocols, improved developer APIs, monitoring tools.

### Midnight -- Privacy Sidechain (Partner Chain)

**Status**: FEDERATED MAINNET launching late March 2026

**What it is**: Privacy-focused partner chain using zero-knowledge proofs for "rational privacy" --
protecting sensitive data while maintaining regulatory compliance. Dual-state architecture
separates public and private data.

**Token (NIGHT)**:
- Launched December 4, 2025 on Cardano
- "Glacier Drop": 3.5B tokens claimed, 170K+ eligible wallets across 8 chains
- "Scavenger Mine": 1B tokens claimed by 8M+ unique wallets (industry record)
- Market: near $1B valuation, listed on OKX, Bybit, MEXC

**Phased rollout**:
1. **Kukolu** (current): Federated Mainnet, late March 2026 (secured by Google Cloud, Blockdaemon)
2. **Mohalu** (Q2-Q3 2026): Open to Cardano SPOs, DUST Capacity Exchange
3. **Hua** (late 2026): LayerZero integration, universal privacy-as-a-service for Ethereum, Solana, etc.

**Partnerships**: 100+ including Google Cloud, Brave, Bitcoin.com, AlphaTON Capital (Telegram integration).

### Plutus V3 and Smart Contract Ecosystem

**Status**: DEPLOYED (since Chang #1, September 2024)

**Key capabilities**:
- **BLS12-381 curve pairing**: 17 primitives for ZK proof verification
- **Blake2b-224 and Keccak-256**: Additional hash functions
- **Sums of Products (SOPs)**: ~30% faster script execution, smaller scripts
- **Bitwise primitives**: CIP-58 low-level bit manipulation
- **Governance integration**: Script context includes CIP-1694 governance entities
- **Zero-knowledge proofs**: First ZK smart contract (Halo2) verified on mainnet

**Developer tooling**:
- **Plinth**: Property-based testing tool for Plutus contracts (IOG + MLabs)
- **Aiken**: Popular alternative smart contract language
- **OpShin**: Python-to-Plutus compiler

**Growth**: ~129,637 total smart contracts on Cardano (early 2025), with V3 seeing 5x growth rate.

---

## 8. Upcoming Roadmap (2026-2027)

### Protocol Version 11 -- Intra-Era Hard Fork (March 2026)

**Status**: IMMINENT (node 10.7.0 is the hard fork candidate)

Named the "van Rossem Hard Fork" by the Hard Fork Working Group.

Key changes:
- VRF uniqueness enforcement for stake pools
- Unified built-in Plutus functions
- Native BLS12-381 and multi-scalar multiplication (MSM) for ZK proof acceleration
- Expanded Plutus built-in functionality
- Stability improvements (networking, mempool)
- ARM64 support for release artifacts and OCI images
- Will NOT change transaction shape (minimal ecosystem upgrade effort)

### Protocol Version 12 -- Dijkstra Era

**Status**: IN DEVELOPMENT

Major features under implementation:
- **CIP-118 (Nested Transactions)**: Sub-transactions within transactions; full binary format defined, ledger rules structured
- **CIP-159 (Account Address Enhancement)**: Enables micropayments in ADA
- **CIP-165 (Canonical Ledger State)**: Structural foundation for standardized ledger state representation
- **CIP-167 (Remove isValid)**: Accepted and fully implemented in Ledger
- **Plutus V4**: Next-generation smart contract capabilities

### Ouroboros Leios Mainnet (2026)

- 30-50x throughput improvement
- Parallel block processing via Input/Endorsement/Ranking blocks
- Currently ~67% CIP completion
- Accelerated from 2028 to 2026 timeline

### Ouroboros Genesis Mainnet Default (2026)

- Expected with node 10.7
- Trustless node bootstrapping replaces centralized bootstrap peers
- Peer snapshot file becomes mandatory

### Scaling Roadmap Summary

```
2024  Chang #1 (PlutusV3, DReps, ICC)
 |
2025  Plomin hard fork (full governance)
 |    Hydra v1 (production)
 |    Mithril SNARK proofs
 |    UTxO-HD (in-memory production, LMDB experimental)
 |    $71M treasury-funded development approved
 |
2026  Protocol Version 11 (intra-era, ~March 2026)
 |    Ouroboros Genesis mainnet default (~2026)
 |    Midnight federated mainnet (March 2026)
 |    Ouroboros Leios mainnet deployment (2026)
 |    Dijkstra era development continues
 |    UTxO-HD LSM tree backend development
 |    Amaru relay + block production
 |
2027  Dijkstra era (Protocol Version 12, Plutus V4)
 |    Midnight fully decentralized (LayerZero integration)
 |    UTxO-HD LSM tree production
 |    Leios ecosystem maturation
 |
2030  Cardano 2030 Vision (approved by governance)
```

### Organizational Coordination

The **Pentad** was established in late 2025 as a formal coordination framework between:
- Input Output Global (IOG)
- EMURGO
- Cardano Foundation
- Intersect (member-based organization)
- Midnight Foundation

This coalition coordinates on commercial strategy, development priorities, and governance.

### Key CIPs in Pipeline

| CIP | Title | Status | Target |
|---|---|---|---|
| CIP-118 | Nested Transactions | Implementation in progress | Dijkstra era |
| CIP-159 | Account Address Enhancement | Implementation started | Dijkstra era |
| CIP-165 | Canonical Ledger State | 3 namespaces implemented | Dijkstra era |
| CIP-167 | Remove isValid from Transactions | Fully implemented | Dijkstra era |
| Leios CIP | Ouroboros Leios specification | ~67% complete | 2026 |
| Mithril CIP | Signature diffusion through Cardano | Draft under review | 2026 |

---

## 9. Notable Events

### November 2025 Mainnet Chain Split

On November 21, 2025, the Cardano mainnet experienced its first major consensus-level
disruption in eight years:

- **Cause**: A deliberately crafted delegation transaction exploited a deserialization bug that had existed since 2022
- **Effect**: Network split into two competing chains for ~14.5 hours
- **Impact**: Exchanges paused deposits/withdrawals, DeFi settlement times ballooned, ADA dropped ~16%
- **Resolution**: Patched node (v10.5.3) released within ~3 hours; SPOs upgraded; longest chain won
- **Aftermath**: FBI notified (Hoskinson characterized it as attack); one IOG engineer resigned over concerns about legal risks for security testing; no user funds compromised

The Ouroboros protocol's self-healing design successfully resolved the partition without
central intervention, as analyzed by Professor Aggelos Kiayias in a December 2025 blog post.

The incident underscored the importance of:
- Node version consistency across the network
- Robust bug disclosure pathways (attacker used mainnet instead of bug bounty)
- The value of client diversity (analogous to Ethereum's client diversity concerns)

### First Treasury-Funded Core Development (August 2025)

The community's approval of $71M for core protocol development marked the first time Cardano's
infrastructure funding was directly approved through on-chain governance, a milestone for
decentralized protocol sustainability.

### Constitutional Committee Elections (2025)

The transition from the Interim Constitutional Committee (ICC) to a fully community-elected
Constitutional Committee of seven members demonstrated the practical functioning of CIP-1694's
governance model. A snap election in December 2025 (after a resignation) further tested the
system's responsiveness.

---

## Sources

### Official Documentation and Updates
- [Cardano Docs - Development Phases and Eras](https://docs.cardano.org/about-cardano/evolution/eras-and-phases)
- [Cardano Weekly Development Report (Feb 20, 2026)](https://cardano.org/news/2026-02-20-weekly-development-report/)
- [Essential Cardano Weekly Report (Feb 20, 2026)](https://www.essentialcardano.io/development-update/weekly-development-report-as-of-2026-02-20)
- [Cardano Node Releases (GitHub)](https://github.com/intersectmbo/cardano-node/releases)
- [Cardano Release Notes](https://docs.cardano.org/developer-resources/release-notes/release-notes)
- [Ouroboros Consensus - UTxO-HD Overview](https://ouroboros-consensus.cardano.intersectmbo.org/docs/for-developers/utxo-hd/Overview/)

### Governance
- [CIP-1694 Full Text](https://cips.cardano.org/cip/CIP-1694)
- [Cardano Foundation - Reflecting on Governance in 2025](https://cardanofoundation.org/blog/reflecting-cardano-governance-2025)
- [Intersect - Recent Governance Actions](https://intersectmbo.org/news/recent-cardano-governance-actions)
- [Intersect - Evolution of Cardano Governance](https://www.intersectmbo.org/news/the-evolution-of-cardano-governance-a-brief-history)
- [Chang Upgrade Documentation](https://docs.cardano.org/about-cardano/evolution/upgrades/chang)
- [How Decentralized is Cardano Governance? (cexplorer)](https://cexplorer.io/article/how-decentralized-is-cardano-governance)

### Consensus and Scaling
- [IOG - Ouroboros Genesis Enhanced Security](https://www.iog.io/news/ouroboros-genesis-enhanced-security-in-a-dynamic-environment)
- [IOG - Advancing Ouroboros: Leios](https://www.iog.io/news/advancing-ouroboros-leios-as-the-next-leap-in-scalability)
- [Ouroboros Leios Documentation](https://leios.cardano-scaling.org/)
- [Ouroboros Leios FAQ](https://leios.cardano-scaling.org/docs/faq/)
- [IOG - Scaling Cardano Applications with Hydra](https://www.iog.io/news/scaling-cardano-applications-with-hydra)
- [Hydra Head Protocol Documentation](https://hydra.family/head-protocol/)
- [Mithril Documentation](https://docs.cardano.org/developer-resources/scalability-solutions/mithril)

### Alternative Implementations
- [Amaru (GitHub)](https://github.com/pragma-org/amaru)
- [PRAGMA - Amaru Project](https://pragma.builders/projects/amaru/)
- [Amaru Documentation](https://amaru.global/about/)
- [Dolos (GitHub)](https://github.com/txpipe/dolos)
- [Pallas (GitHub)](https://github.com/txpipe/pallas)
- [TxPipe Documentation](https://docs.txpipe.io/)

### Midnight and Partner Chains
- [Midnight Network](https://midnight.network/night)
- [Midnight State of the Network (Dec 2025)](https://midnight.network/blog/state-of-the-network-december-2025)
- [CoinDesk - Midnight NIGHT Goes Live](https://www.coindesk.com/markets/2025/12/11/cardano-ecosystem-gets-a-privacy-boost-as-midnight-s-night-goes-live)

### November 2025 Incident
- [Cardano Foundation - November 2025 Incident](https://cardanofoundation.org/blog/november-2025-cardano-shows-resilience)
- [Intersect - Incident Report](https://intersectmbo.org/news/incident-report-network-partition-analysis-and-resolution-strategy)
- [CoinDesk - Cardano Splits After AI-Generated Exploit](https://www.coindesk.com/markets/2025/11/23/cardano-temporarily-splits-into-two-chains-after-attacker-uses-ai-generated-script-to-exploit-a-known-bug)
- [Ouroboros Self-Healing Analysis](https://cardano.org/news/2025-12-03-ouroboros-self-healing/)

### Network Statistics
- [PoolTool.io](https://pooltool.io/)
- [CardanoScan](https://cardanoscan.io/)
- [cexplorer.io](https://cexplorer.io/)
- [IOG - Q3 2025 Progress Report](https://iohk.io/blog/posts/2025/10/29/strengthening-cardanos-foundations-q3-2025-progress-report)

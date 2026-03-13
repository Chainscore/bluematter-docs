---
---
# Research

Reference covering the academic research that underpins the Cardano
blockchain, from the founding vision through the Ouroboros consensus protocol family,
the Extended UTXO model, formal ledger specifications, and scaling research.

---

## Table of Contents

1. [Founding Vision and Philosophy](#1-founding-vision-and-philosophy)
2. [The "Why Cardano" Essay (2017)](#2-the-why-cardano-essay-2017)
3. [The Ouroboros Consensus Protocol Family](#3-the-ouroboros-consensus-protocol-family)
   - 3.1 [Ouroboros Classic (CRYPTO 2017)](#31-ouroboros-classic--a-provably-secure-proof-of-stake-blockchain-protocol)
   - 3.2 [Ouroboros BFT (2018)](#32-ouroboros-bft--a-simple-byzantine-fault-tolerant-consensus-protocol)
   - 3.3 [Ouroboros Praos (EUROCRYPT 2018)](#33-ouroboros-praos--an-adaptively-secure-semi-synchronous-proof-of-stake-blockchain)
   - 3.4 [Ouroboros Genesis (CCS 2018)](#34-ouroboros-genesis--composable-proof-of-stake-blockchains-with-dynamic-availability)
   - 3.5 [Ouroboros Crypsinous (IEEE S&P 2019)](#35-ouroboros-crypsinous--privacy-preserving-proof-of-stake)
   - 3.6 [Ouroboros Chronos (EUROCRYPT 2021)](#36-ouroboros-chronos--permissionless-clock-synchronization-via-proof-of-stake)
   - 3.7 [Ouroboros Leios / "High-Throughput Permissionless Blockchain Consensus" (CRYPTO 2025)](#37-ouroboros-leios--high-throughput-permissionless-blockchain-consensus)
   - 3.8 [Ouroboros Peras (2025)](#38-ouroboros-peras--fast-settlement)
   - 3.9 [Ouroboros Omega (Long-term Vision)](#39-ouroboros-omega--the-final-form)
4. [The Extended UTXO Model](#4-the-extended-utxo-model)
   - 4.1 [The Extended UTXO Model (FC 2020)](#41-the-extended-utxo-model)
   - 4.2 [Native Custom Tokens in the Extended UTXO Model (ISoLA 2020)](#42-native-custom-tokens-in-the-extended-utxo-model)
5. [Stake Delegation, Incentives, and Account Management](#5-stake-delegation-incentives-and-account-management)
6. [Scaling: Hydra and Mithril](#6-scaling-hydra-and-mithril)
   - 6.1 [Hydra: Fast Isomorphic State Channels (2021)](#61-hydra-fast-isomorphic-state-channels)
   - 6.2 [Mithril: Stake-based Threshold Multisignatures (2021)](#62-mithril-stake-based-threshold-multisignatures)
7. [Formal Ledger Specifications](#7-formal-ledger-specifications)
8. [Cardano's Layered Architecture](#8-cardanos-layered-architecture)
9. [The Research Library at Scale](#9-the-research-library-at-scale)
10. [Summary: From Paper to Running Network](#10-summary-from-paper-to-running-network)

---

## 1. Founding Vision and Philosophy

### The People

**Charles Hoskinson** (born November 5, 1987, Maui, Hawaii) co-founded Ethereum in
late 2013 alongside Vitalik Buterin, serving as its first CEO. He departed Ethereum
in 2014 after a dispute over whether the project should be a commercial entity or a
nonprofit. In **March 2015**, Hoskinson and **Jeremy Wood** (former Ethereum colleague,
Chief Strategy Officer) founded **Input Output Hong Kong (IOHK)** -- a technology
company committed to using peer-to-peer innovations to provide financial services to
the three billion people who lack them.

The Cardano project itself began in 2015 when a client proposed building a "Japanese
version of Ethereum." Hoskinson raised $62 million in a 2017 ICO and launched Cardano
in September 2017, targeting the Japanese market initially before global expansion.
Hoskinson deliberately declined venture capital, saying it ran counter to blockchain
principles.

In **October 2016**, **Professor Aggelos Kiayias** joined IOHK as Chief Scientist. He
holds the Chair in Cybersecurity and Privacy at the University of Edinburgh and had
already written one of the most-cited papers in blockchain history ("The Bitcoin
Backbone Protocol: Analysis and Applications," with Juan Garay and Nikos Leonardos,
1,800+ Google Scholar citations). From the start, Kiayias was determined to build
Cardano from scratch while incorporating the best minds and ideas from academic
cryptography.

### The Three Founding Entities

Cardano's governance was deliberately split across three independent legal entities:

| Entity | Role | Headquarters |
|--------|------|--------------|
| **IOHK** (now IOG -- Input Output Global) | Engineering, R&D, building and maintaining the blockchain | Hong Kong / Wyoming |
| **Cardano Foundation** | Governance, community growth, promotion, regulatory engagement | Zug, Switzerland |
| **Emurgo** | Commercial adoption, business development, investment, incubation | Japan / Singapore |

### The Research-First Principle

Cardano is unique among blockchain projects in its unwavering commitment to academic
rigor. Instead of starting from a single whitepaper and iterating through code, the
project:

1. **Begins with formal research** -- problems are defined mathematically, solutions
   are proposed and proven.
2. **Submits to peer review** -- papers are submitted to top-tier conferences (CRYPTO,
   EUROCRYPT, CCS, IEEE S&P, Financial Cryptography) and subjected to blind review by
   independent cryptographers and computer scientists.
3. **Publishes openly** -- all research and specifications are publicly available.
4. **Implements from specifications** -- code is written against formal mathematical
   specifications, not ad hoc designs.
5. **Verifies formally** -- the Agda proof assistant is used to mechanically verify
   that specifications are consistent and that implementations conform.

This approach has produced, as of 2025, **over 250 peer-reviewed papers**, with
**300+ contributing authors**, **15+ leading research partners** (University of
Edinburgh, Stanford, University of Connecticut, Purdue, Tokyo Institute of Technology,
University of Wyoming, and others), and **10,000+ industry paper citations**.

University partnerships include the $4.5M blockchain research hub at Stanford
University and a long-running collaboration with the University of Edinburgh's
Blockchain Technology Laboratory.

---

## 2. The "Why Cardano" Essay (2017)

- **Published**: July 10, 2017
- **Author**: Charles Hoskinson
- **URL**: [why.cardano.org](https://why.cardano.org/)
- **Translations**: Japanese, Chinese, Korean

### Content and Significance

"Why Cardano" is not a traditional whitepaper but a philosophical essay explaining the
motivations, design principles, and engineering approach behind the project. Key themes
include:

- **The problem with first-generation blockchains**: Bitcoin solved digital scarcity
  but cannot scale, lacks programmability, and has no governance mechanism. Ethereum
  added programmability but introduced an account model with complex state and
  unbounded execution.

- **A third-generation vision**: Cardano would address scalability (transactions per
  second), interoperability (cross-chain communication), and sustainability
  (governance and treasury systems).

- **Scientific philosophy**: Rather than "move fast and break things," Cardano would
  adopt the methods of aerospace and banking -- formal methods, peer review, and
  high-assurance engineering.

- **Separation of concerns**: The accounting of value should be separated from the
  computation that motivates value transfer (the CSL/CCL layered architecture).

- **Cardano as a social technology**: Not merely a financial tool, but infrastructure
  for digital identity, financial inclusion, and verifiable governance.

The essay was accompanied by the "Cardano Whiteboard" video, a long-form walkthrough
by Hoskinson covering the same material in lecture format.

---

## 3. The Ouroboros Consensus Protocol Family

Ouroboros (from the Greek, meaning "tail-devouring" -- the ancient symbol of a serpent
eating its own tail, representing eternity) is the family of proof-of-stake consensus
protocols that power the Cardano network. Each iteration addresses a specific
limitation of its predecessor.

### 3.1 Ouroboros Classic -- A Provably Secure Proof-of-Stake Blockchain Protocol

| | |
|---|---|
| **Authors** | Aggelos Kiayias, Alexander Russell, Bernardo David, Roman Oliynykov |
| **Published** | CRYPTO 2017 (37th Annual International Cryptology Conference), Santa Barbara, CA, August 20-24, 2017 |
| **Venue** | Advances in Cryptology -- CRYPTO 2017, LNCS vol. 10401, pp. 357-388, Springer |
| **ePrint** | [eprint.iacr.org/2016/889](https://eprint.iacr.org/2016/889) |
| **DOI** | [10.1007/978-3-319-63688-7_12](https://doi.org/10.1007/978-3-319-63688-7_12) |

**Core contribution**: The first blockchain protocol based on proof of stake with
**rigorous security guarantees** comparable to those achieved by Bitcoin's proof of
work. At the time, generating a single Bitcoin block required hashing operations
exceeding 2^60, with energy demands comparable to a small country.

**Key innovations**:

- **Formal security model**: Defines a robust transaction ledger via two properties:
  **persistence** (once a node considers a transaction "stable" at depth k, all honest
  nodes agree) and **liveness** (transactions from honest parties are eventually
  adopted).

- **Epoch-based slot leader election**: Time is divided into epochs; within each
  epoch, slots are assigned to stakeholders proportional to their stake via a
  multi-party coin-tossing protocol.

- **Novel reward mechanism**: Proves that honest behavior is an approximate Nash
  equilibrium, neutralizing selfish-mining attacks in the PoS setting.

- **Energy efficiency**: Eliminates proof-of-work entirely while maintaining formal
  security parity.

**Relation to the running network**: Ouroboros Classic was the consensus protocol for
Cardano's **Byron era** (federated launch, September 2017 -- July 2020). It operated
in a federated setting with a fixed set of block producers controlled by IOHK, the
Cardano Foundation, and Emurgo.

**Conference acceptance**: Of 311 papers submitted to CRYPTO 2017, only 72 were
accepted. Ouroboros was among them -- the first blockchain consensus paper at a
top-tier cryptography conference.

---

### 3.2 Ouroboros BFT -- A Simple Byzantine Fault Tolerant Consensus Protocol

| | |
|---|---|
| **Authors** | Aggelos Kiayias, Alexander Russell |
| **Published** | October 2018, IACR Cryptology ePrint Archive, Report 2018/1049 |
| **ePrint** | [eprint.iacr.org/2018/1049](https://eprint.iacr.org/2018/1049) |

**Core contribution**: A simple BFT consensus protocol for distributed ledgers that
tolerates up to 1/3 of nodes being faulty. Provides instant confirmation and
settlement at network speed in the common case.

**Key innovations**:

- **Round-robin block production**: Servers extend a blockchain in each round with
  lower communication complexity than classical PBFT.
- **Covert adversarial model**: Byzantine resilience increases to t < n/2 when safety
  is considered under restored synchrony.
- **Persistence and liveness**: Satisfies both with a liveness parameter of 5t + 2.

**Relation to the running network**: Ouroboros BFT served as a **bridge protocol**
during the Byron-to-Shelley transition (the "Byron Reboot" hard fork). It operated in
a federated setting, providing a deterministic consensus mechanism while the network
prepared for full decentralization under Praos.

---

### 3.3 Ouroboros Praos -- An Adaptively-Secure, Semi-synchronous Proof-of-Stake Blockchain

| | |
|---|---|
| **Authors** | Bernardo David, Peter Gazi, Aggelos Kiayias, Alexander Russell |
| **Published** | EUROCRYPT 2018, Tel Aviv, Israel |
| **Venue** | Advances in Cryptology -- EUROCRYPT 2018, LNCS vol. 10821, pp. 66-98, Springer |
| **ePrint** | [eprint.iacr.org/2017/573](https://eprint.iacr.org/2017/573) |
| **DOI** | [10.1007/978-3-319-78375-8_3](https://doi.org/10.1007/978-3-319-78375-8_3) |

**Core contribution**: The first provably secure PoS protocol that achieves security
against **fully-adaptive corruption** in the **semi-synchronous setting**. The
adversary can corrupt any participant at any moment (as long as honest majority of
stake is maintained), and the protocol tolerates adversarially-controlled message
delays unknown to participants.

**Key innovations**:

- **Private slot leader election via VRF**: Each stakeholder locally evaluates a
  Verifiable Random Function (VRF) to determine if they are eligible to produce a
  block. This eliminates the "grinding" attack possible in Classic, where an adversary
  could influence the randomness beacon.

- **VRF with unpredictability under malicious key generation**: A novel UC
  formalization ensuring VRF outputs remain unpredictable even if key generation is
  subverted. Efficiently realized under the Computational Diffie-Hellman (CDH)
  assumption.

- **Forward-secure digital signatures (KES)**: Key-Evolving Signatures ensure that
  compromise of a current key does not allow forging blocks for past slots, providing
  forward security against adaptive corruption.

- **Semi-synchronous network model**: No assumption on known message delivery bounds;
  the protocol works as long as honest messages are eventually delivered.

- **General combinatorial framework**: A novel framework for analyzing
  semi-synchronous blockchains, potentially of independent interest.

**Relation to the running network**: Ouroboros Praos is the **current consensus
protocol** powering Cardano mainnet since the **Shelley hard fork** (July 29, 2020).
It is what all Cardano stake pool operators run today. The transition from Byron's
federated model to Praos's fully decentralized model was one of the most significant
events in Cardano's history.

Every Cardano block produced since Shelley contains a VRF proof (ECVRF-ED25519-SHA512-
Elligator2, draft-03) and a KES signature (Sum6KES), exactly as specified in this
paper.

---

### 3.4 Ouroboros Genesis -- Composable Proof-of-Stake Blockchains with Dynamic Availability

| | |
|---|---|
| **Authors** | Christian Badertscher, Peter Gazi, Aggelos Kiayias, Alexander Russell, Vassilis Zikas |
| **Published** | ACM CCS 2018 (Conference on Computer and Communications Security), pp. 913-930 |
| **ePrint** | [eprint.iacr.org/2018/378](https://eprint.iacr.org/2018/378) |
| **DOI** | [10.1145/3243734.3243848](https://doi.org/10.1145/3243734.3243848) |

**Core contribution**: Solves the **bootstrapping problem** for proof-of-stake
blockchains. Prior PoS protocols required new nodes to obtain a trusted "checkpoint"
upon joining and to be frequently online. Genesis enables parties to safely join or
rejoin using **only the genesis block**, exactly like Bitcoin.

**Key innovations**:

- **Genesis chain selection rule**: A novel instantiation of the "maxvalid" procedure
  that allows joining parties to identify a chain whose prefix was part of a recent
  honest chain, using only genesis block knowledge.

- **Dynamic availability**: The first GUC (Globally Universally Composable) treatment
  of PoS blockchains in a setting with arbitrary numbers of parties that may not be
  fully operational (network problems, reboots, updates).

- **Novel martingale technique**: A new proof technique for analyzing blockchain
  security against adaptive adversaries, potentially of independent interest.

- **Full adaptive security**: Proved secure against a fully adaptive adversary
  controlling less than half of total stake under the strict Global Random Oracle.

**Relation to the running network**: Ouroboros Genesis is being integrated into the
Cardano node implementation. Its chain selection rule is critical for new nodes joining
the network -- without Genesis, a new node connecting to the Cardano network cannot
securely determine which chain is valid by merely downloading from genesis. The
Haskell cardano-node implementation has been progressively incorporating Genesis
features.

---

### 3.5 Ouroboros Crypsinous -- Privacy-Preserving Proof-of-Stake

| | |
|---|---|
| **Authors** | Thomas Kerber, Aggelos Kiayias, Markulf Kohlweiss, Vassilis Zikas |
| **Published** | IEEE Symposium on Security and Privacy (S&P) 2019, pp. 157-174 |
| **ePrint** | [eprint.iacr.org/2018/1132](https://eprint.iacr.org/2018/1132) |
| **DOI** | [10.1109/SP.2019.00063](https://doi.org/10.1109/SP.2019.00063) |

**Core contribution**: The first **formally analyzed privacy-preserving** proof-of-stake
blockchain protocol. Combines Ouroboros-style PoS with Zerocash-style private
transactions.

**Key innovations**:

- **SNARK-based coin evolution**: A novel technique where parties hold Zerocash-style
  coins; each coin is separately considered for leadership via NIZK proofs that a
  pseudorandom value meets the leadership target and the coin is unspent.

- **Key-private forward-secure encryption**: Ensures privacy is maintained even
  against adaptive attacks over time.

- **GUC treatment of private ledgers**: A formalization of private ledger
  security in the Generalized Universal Composability setting.

**Relation to the running network**: Crypsinous is not deployed on Cardano mainnet but
represents foundational research for privacy-preserving features. Its techniques
inform the design of **Midnight**, IOG's privacy-focused blockchain project announced
in 2022.

---

### 3.6 Ouroboros Chronos -- Permissionless Clock Synchronization via Proof-of-Stake

| | |
|---|---|
| **Authors** | Christian Badertscher, Peter Gazi, Aggelos Kiayias, Alexander Russell, Vassilis Zikas |
| **Published** | EUROCRYPT 2021 |
| **ePrint** | [eprint.iacr.org/2019/838](https://eprint.iacr.org/2019/838) |

**Core contribution**: Solves the **global clock synchronization problem** using proof
of stake. All previous Ouroboros variants assumed parties have access to a loosely
synchronized global clock. Chronos removes this assumption, requiring only that local
clocks advance at approximately the same speed.

**Key innovations**:

- **Blockchain-era synchronizer**: A novel mechanism that enables joining parties --
  even if their local time is off by an arbitrary amount -- to quickly calibrate their
  local clocks to show approximately the same time.

- **Permissionless global clock**: Since the blockchain can be joined by any party,
  Chronos provides a permissionless implementation of a global clock usable by
  higher-level protocols.

- **No single point of failure**: Eliminates the vulnerability of externally hosted
  time sources (NTP servers) that telecommunications, transport, and financial
  infrastructure rely on.

- **Worst-case corruption tolerance**: Tolerates worst-case corruption and dynamically
  fluctuating participation while relying only on local clocks.

**Relation to the running network**: Chronos represents future research for Cardano.
Its principles could eliminate Cardano's current dependency on NTP for slot timing,
making the network self-sufficient for time synchronization. This is particularly
relevant for deployment scenarios where NTP infrastructure is unreliable.

---

### 3.7 Ouroboros Leios -- High-Throughput Permissionless Blockchain Consensus

| | |
|---|---|
| **Authors** | Sandro Coretti, Matthias Fitzi, Aggelos Kiayias, Giorgos Panagiotakos, Alexander Russell |
| **Published** | May 31, 2024 (ePrint); accepted at CRYPTO 2025 |
| **ePrint** | [eprint.iacr.org/2025/1115](https://eprint.iacr.org/2025/1115) |
| **Full Title** | "High-Throughput Permissionless Blockchain Consensus under Realistic Network Assumptions" |

**Core contribution**: Transforms any low-throughput permissionless base protocol
(PoW or PoS) into a high-throughput system achieving a **(1 - delta)-fraction of
network capacity** -- near-optimal throughput -- while affecting latency only by a
constant factor.

**Key innovations**:

- **Three block types**: Input Blocks (IBs) carry transactions; Endorser Blocks (EBs)
  reference and endorse IBs with data availability proofs; Ranking Blocks (RBs) order
  blocks as part of the consensus mechanism.

- **Pipelined architecture**: Uninterrupted concurrent processing across all three
  block types, decoupling transaction inclusion from consensus ordering.

- **Freshest-first diffusion (F_FFD)**: A new network model with VRF-based timestamps
  for message prioritization, addressing adversarial burst attacks.

- **Equivocation proofs**: Limits malicious double-signing spam in PoS settings.

- **30-50x throughput increase**: From approximately 4.5 TxkB/s to 140-300 TxkB/s,
  with modest latency increase (45-60 seconds vs. 20 seconds).

**Relation to the running network**: Leios is under active development for Cardano
mainnet deployment. A CIP (Cardano Improvement Proposal) has been formally submitted.
A July 2025 stress test demonstrated 1,000 TPS with non-Plutus transactions. The
deployment timeline is estimated at 1-1.5 years. Resource requirements (4 vCPU, 10
Mb/s bandwidth) ensure small operators can continue to participate.

---

### 3.8 Ouroboros Peras -- Fast Settlement

| | |
|---|---|
| **Status** | Active research and engineering, 2024-2025 |
| **Documentation** | [peras.cardano-scaling.org](https://peras.cardano-scaling.org/) |

**Core contribution**: Reduces Cardano's transaction settlement time from minutes-to-
hours (under Praos) to approximately **two minutes** via stake-based voting.

**Key innovations**:

- **Stake-based block certification**: SPOs vote to certify blocks at designated
  intervals. Certified blocks carry additional weight in chain selection.

- **Heaviest-chain selection**: Modifies the chain selection rule from longest-chain
  to heaviest-chain, where certified blocks contribute extra weight.

- **Self-healing**: If an adversary temporarily reaches a quorum, they can only take
  over if they maintain superiority over time; otherwise, honest parties recover.

- **Graceful degradation**: In the event of a cooldown (insufficient voting
  participation), Peras reverts seamlessly to Praos behavior without compromising
  security.

**Relation to the running network**: Peras has progressed toward formal proofs of
safety, liveness, and self-healing. Engineering evidence confirms integration with
Praos is feasible with minimal disruption. It is expected to be deployed before Leios.

---

### 3.9 Ouroboros Omega -- The Final Form

Ouroboros Omega is the long-term vision for Cardano's consensus protocol, unifying
Peras, Leios, and other innovations into a single adaptive system.

**Core design principles**:

- **Optimistic multi-path execution**: When the network shows high uptime and reliable
  connectivity, the protocol accelerates to near-centralized-like performance. When
  conditions degrade, it falls back to a safe, decentralized mode.

- **Dynamic performance adaptation**: Throughput and settlement automatically adjust
  to network conditions.

- **Proof**: Aims to either find practical solutions or rigorously prove
  what is and is not possible without sacrificing security.

Combining Leios with the EUTXO model could theoretically support throughput of up to
**one million transactions per second**.

---

## 4. The Extended UTXO Model

### 4.1 The Extended UTXO Model

| | |
|---|---|
| **Authors** | Manuel M.T. Chakravarty, James Chapman, Kenneth MacKenzie, Orestis Melkonian, Michael Peyton Jones, Philip Wadler |
| **Published** | Workshop on Trusted Smart Contracts, Financial Cryptography 2020, February 2020 |
| **Venue** | FC 2020, LNCS vol. 12063, pp. 525-539, Springer |
| **PDF** | [omelkonian.github.io/data/publications/eutxo.pdf](https://omelkonian.github.io/data/publications/eutxo.pdf) |
| **DOI** | [10.1007/978-3-030-54455-3_37](https://doi.org/10.1007/978-3-030-54455-3_37) |

**Core contribution**: Extends Bitcoin's UTXO model to support **substantially more
expressive validation scripts**, including scripts that implement general state machines
and enforce properties across entire transaction chains -- while preserving the semantic
simplicity that makes UTXO attractive for concurrent and distributed computing.

**Key innovations**:

- **Script-based addresses**: Instead of restricting locks to public keys and keys to
  signatures, addresses can contain arbitrary logic in the form of validator scripts.

- **Datum**: Transaction outputs carry (almost) arbitrary data in addition to an
  address and value, enabling scripts to carry state information.

- **Redeemer**: Transactions provide a "redeemer" argument to scripts, enabling
  parameterized validation logic.

- **Constraint Emitting Machines (CEMs)**: A form of state machine (based on Mealy
  machines) suitable for on-chain execution. The authors formalize CEMs, show how to
  compile them to EUTXO, and prove a weak bisimulation between the two systems.

**Why EUTXO over accounts?**: Bitcoin chose UTXO for semantic simplicity in concurrent
settings; Ethereum chose accounts for expressiveness. EUTXO achieves both:
expressiveness comparable to accounts with the deterministic, parallel-friendly
semantics of UTXO. A transaction's effects are fully determined before submission --
there are no "surprises" from concurrent state changes.

**Relation to the running network**: EUTXO is the **ledger model of Cardano** since the
Alonzo hard fork (September 12, 2021). Every Plutus smart contract on Cardano operates
within this model. The four components of EUTXO interaction are: Contract (the
validator script), Redeemer (the spending argument), Datum (the state carried on the
output), and Context (the transaction being validated).

---

### 4.2 Native Custom Tokens in the Extended UTXO Model

| | |
|---|---|
| **Authors** | Manuel M.T. Chakravarty et al. |
| **Published** | ISoLA 2020 (9th International Symposium on Leveraging Applications of Formal Methods), Rhodes, Greece, October 2020 |
| **Venue** | ISoLA 2020, LNCS vol. 12478, pp. 89-111, Springer |
| **IOHK Library** | [iohk.io/en/research/library/papers/native-custom-tokens-in-the-extended-utxo-model/](https://iohk.io/en/research/library/papers/native-custom-tokens-in-the-extended-utxo-model/) |

**Core contribution**: Generalizes EUTXO transaction outputs from locking a single
cryptocurrency to locking **entire token bundles** including custom tokens whose
forging is controlled by **minting policy scripts**.

**Key innovations**:

- **Token bundles**: Each output locks a structured collection of multiple token types
  in arbitrary quantities, enabling multi-asset transfers in single transactions.

- **Forging policy scripts**: Define the conditions under which tokens can be minted
  or burned, providing programmable monetary policy per token.

- **Formal verification in Agda**: A complete formalization of the multi-asset EUTXO
  ledger, proving that it is strictly more expressive than the single-currency EUTXO
  ledger.

- **Transfer result**: An inductive and temporal property transfer from state machines
  to the multi-asset EUTXO ledger.

**Why "native"?**: Unlike Ethereum's ERC-20 tokens (which are smart contract state,
not ledger primitives), Cardano's native tokens are first-class citizens of the ledger.
They are carried in transaction outputs alongside ADA, do not require custom contract
code for basic transfers, and benefit from the same security guarantees as ADA itself.

**Relation to the running network**: Native multi-asset support has been live on
Cardano since the **Mary hard fork** (March 1, 2021). As of 2025, there are millions
of native tokens (fungible and non-fungible) on Cardano, all operating within this
formally verified framework.

---

## 5. Stake Delegation, Incentives, and Account Management

### Account Management in Proof of Stake Ledgers

| | |
|---|---|
| **Authors** | Dimitris Karakostas et al. (with contributions from Lars Brunjes and others) |
| **Published** | 2020 |
| **ePrint** | [eprint.iacr.org/2020/525](https://eprint.iacr.org/2020/525) |

**Core contribution**: Explores mechanisms to maximize stakeholder participation in
network maintenance by enabling proper account management, stake delegation, and
incentivized participation.

**Key innovations**:

- **Separation of payment and staking keys**: Stake delegation does not require use
  of the payment key, which is reserved only for transferring funds. Compromising the
  staking operation does not compromise payment functionality.

- **Certificate-based delegation**: Stakeholders commission stake pools via on-chain
  certificates, with replay attack protection through address whitelisting.

- **Master key derivation**: A single master key (or seed) generates all account
  management information (payment keys, staking keys, etc.).

### Reward Sharing Schemes (Shelley Design Specification)

The reward-sharing scheme, described in the **Shelley Delegation and Incentives Design
Specification (SL-D5)**, describes how to properly incentivize stake pool operators
and delegators. Key properties:

- **Nash equilibrium**: Honest participation is the rational strategy for all actors.
- **Sybil resistance via pledging**: The pledge mechanism greatly disincentivizes
  formation of multiple pools controlled by a single entity.
- **Desirability function**: Steers the network toward a target number of pools
  (the k parameter), promoting decentralization.
- **Reward formula**: `rewards = fees + monetary_expansion`; split between treasury
  (tau), pool operators (cost + margin), and delegators (proportional to stake).

**Relation to the running network**: This reward mechanism has governed Cardano's
economic incentives since Shelley. The ~3,000+ active stake pools on mainnet, the
pledge dynamics, and the ~70% staking participation rate are all direct consequences
of this design.

---

## 6. Scaling: Hydra and Mithril

### 6.1 Hydra: Fast Isomorphic State Channels

| | |
|---|---|
| **Authors** | Manuel M.T. Chakravarty et al. |
| **Published** | March 2021 |
| **ePrint** | [eprint.iacr.org/2020/299](https://eprint.iacr.org/2020/299) |
| **IOHK Library** | [iohk.io/en/research/library/papers/hydrafast-isomorphic-state-channels/](https://iohk.io/en/research/library/papers/hydrafast-isomorphic-state-channels/) |

**Core contribution**: An **isomorphic** multi-party state channel protocol that
reuses the Layer 1 ledger representation for off-chain processing, enabling the same
smart contract code to run identically on- and off-chain.

**Key innovations**:

- **Isomorphic design**: Hydra "Heads" are off-chain ledger siblings that support
  native assets, NFTs, and Plutus scripts identically to the main chain.

- **3-round asynchronous confirmation**: In the optimistic case, transactions are
  confirmed in 3 asynchronous rounds, independently of each other, without a leader.

- **State machine lifecycle**: Four states (initial, open, closed, final) manage
  locking mainchain UTxOs, off-chain evolution, and settlement.

- **Contestation and dispute resolution**: Parties can decommit the current head state
  back to the blockchain at any time.

- **Nested Heads**: The long-term vision includes running Hydra Head protocol inside
  Hydra Heads ("Virtual Heads"), leveraging isomorphism for theoretically limitless
  scalability.

**Relation to the running network**: Hydra Head is live on Cardano mainnet as a Layer
2 solution. Use cases include payment channels, auction systems, and high-frequency
DApp interactions.

---

### 6.2 Mithril: Stake-based Threshold Multisignatures

| | |
|---|---|
| **Authors** | IOG Research |
| **Published** | 2021 |
| **ePrint** | [eprint.iacr.org/2021/916](https://eprint.iacr.org/2021/916) |
| **IOHK Library** | [iohk.io/en/research/library/papers/mithril-stake-based-threshold-multisignatures/](https://iohk.io/en/research/library/papers/mithril-stake-based-threshold-multisignatures/) |

**Core contribution**: A new cryptographic primitive -- **Stake-based Threshold
Multisignatures (STM)** -- enabling aggregation of individual signatures into a
compact multisignature provided the supporting stake exceeds a threshold.

**Key innovations**:

- **Pseudorandom subset sampling**: For each message, a pseudorandomly sampled subset
  of participants is eligible to sign, ensuring scalability of signing, aggregation,
  and verification.

- **Lightweight bootstrapping**: Instead of replaying the entire blockchain, new nodes
  verify STM-signed checkpoints at regular intervals, reducing sync from days to
  under two hours.

- **UC formalization**: The primitive is formalized in the Universal Composability
  setting.

- **Mithril 2 and ALBAs**: The follow-up paper introduces "Approximate Lower Bound
  Arguments" (ALBAs), enabling proof of possessing a large dataset without disclosing
  it entirely.

**Relation to the running network**: Mithril is live on Cardano mainnet (beta). Its
architecture (aggregator, signer, client) enables SPOs to produce signed snapshots of
the Cardano state, allowing new nodes and light clients to bootstrap rapidly. This is
critical for mobile wallets, bridges, and Layer 2 solutions.

---

## 7. Formal Ledger Specifications

Cardano is distinguished by its commitment to formal specifications -- mathematical
documents that define every ledger rule precisely, independent of any programming
language.

### Repositories

- **[IntersectMBO/cardano-ledger](https://github.com/IntersectMBO/cardano-ledger)**: The ledger implementation (Haskell) and LaTeX specifications for all eras.
- **[IntersectMBO/formal-ledger-specifications](https://github.com/IntersectMBO/formal-ledger-specifications)**: Machine-verified Agda formalizations.

### Specification Documents by Era

**Byron Era**:
- `eras/byron/ledger/formal-spec` -- Ledger rules for the Byron release

**Shelley Era** (July 2020):
- **A Formal Specification of the Cardano Ledger** -- Complete ledger rules including
  delegation and incentives
- **Engineering Design Specification for Delegation and Incentives in Cardano-Shelley
  (SL-D5)** -- Requirements and design for delegation and reward mechanisms
- **A Specification of the Non-Integral Calculations in the Ledger** -- Unambiguous
  definitions for non-integral calculations (e.g., reward formulas) ensuring identical
  results across architectures and programming languages
- **Stake pool ranking specification** -- Robust pool ranking mechanism
- **Small-step-semantics framework guide** -- Notation and style used throughout

**Allegra/Mary Eras** (December 2020 / March 2021):
- **Multi-asset formal specification** -- Formal addition of native multi-asset
  support to the Shelley-era ledger rules

**Alonzo Era** (September 2021):
- **Plutus integration formal specification** -- Formal addition of Plutus script
  validation to the ledger rules, building on the multi-asset specification

**Conway Era** (September 2024):
- **Formal Specification of the Cardano Ledger for the Conway Era** -- The most
  complete specification, with full Agda formalization
- Key changes: individual deposit tracking, GovState queue semantics, removal of
  pointer addresses, genesis delegations, and MIR certificates
- Reference script cost model for minfee calculation

### Formal Verification

The primary formal verification effort uses **Agda** (a dependently-typed proof
assistant). The Conway-era Agda formalization is complete; previous eras are being
progressively formalized. There is also a parallel formalization effort in
**Isabelle/HOL**.

The goal is a fully machine-verified specification that can serve as an unambiguous
reference for any implementation in any programming language -- including Bluematter.

---

## 8. Cardano's Layered Architecture

Cardano's architecture, described in the "Why Cardano" essay and refined through
subsequent research, separates concerns into distinct layers:

### Primary Layers

1. **Cardano Settlement Layer (CSL)**: Handles ADA transactions. Uses Ouroboros for
   consensus. Provides the immutable ledger foundation. Defines fundamental Cardano
   objects (addresses, UTxOs, blocks) and validation rules.

2. **Cardano Computation Layer (CCL)**: Executes smart contracts and decentralized
   applications via the Plutus platform. Can be upgraded independently of the
   settlement layer. Uses Untyped Plutus Core (UPLC) -- a lambda calculus variant --
   as its on-chain execution language.

### Granular Layer Breakdown

The Cardano Foundation describes four functional layers:

| Layer | Function |
|-------|----------|
| **Networking** | Customized peer-to-peer system for PoS blockchains (multiplexed mini-protocols) |
| **Consensus** | Ouroboros protocol family (slot leader election, chain selection, block validation) |
| **Settlement** | Ledger function (UTxO rules, multi-asset accounting, fee calculation) |
| **Scripting** | Plutus platform (UPLC execution, script validation, cost model enforcement) |

### The Plutus Platform

The smart contract compilation pipeline:
1. **Haskell source** (or Aiken, or other front-end languages)
2. **Plutus IR** (Intermediate Representation) -- optimization pass
3. **Typed Plutus Core** -- type-checked low-level representation
4. **Untyped Plutus Core (UPLC)** -- the on-chain execution format (lambda calculus)
5. **Flat encoding** -- binary serialization for on-chain storage

Scripts interact with the ledger through the EUTXO model: each script receives a
**datum** (state), **redeemer** (action), and **script context** (transaction details)
and returns success or failure.

---

## 9. The Research Library at Scale

### Quantitative Summary (as of early 2026)

| Metric | Value |
|--------|-------|
| Total peer-reviewed papers | 250+ |
| Contributing authors | 300+ |
| Research partners / universities | 15+ |
| Industry paper citations | 10,000+ |
| Google Scholar profiles at IOHK/IOG | 39 |
| Papers at Edinburgh lab alone | 100+ accepted at conferences |

### Key Venues Where Cardano Research Has Been Published

- **CRYPTO** (International Cryptology Conference) -- Ouroboros Classic, Leios
- **EUROCRYPT** (European Cryptology Conference) -- Praos, Chronos
- **ACM CCS** (Computer and Communications Security) -- Genesis
- **IEEE S&P** (Symposium on Security and Privacy) -- Crypsinous
- **Financial Cryptography (FC)** -- EUTXO model
- **ISoLA** (Leveraging Applications of Formal Methods) -- Native tokens
- **AFT** (Advances in Financial Technologies)

### Research Topics Beyond Consensus

The IOG research library covers far more than consensus protocols:

- **Sidechains** (proof-of-stake sidechains, merged mining)
- **Voting and governance** (treasury systems, liquid democracy)
- **Zero-knowledge proofs** (SNARKs, recursive composition)
- **Game theory** (incentive mechanisms, mechanism design)
- **Formal methods** (Agda formalizations, property-based testing)
- **Programming languages** (Plutus core, UPLC semantics)
- **Network protocols** (peer-to-peer, gossip, diffusion)
- **Central bank digital currencies** (CBDC design)
- **Proof of useful work**
- **Functional encryption** (consistency properties)

The complete, searchable library is available at:
- [iohk.io/en/research/library/](https://iohk.io/en/research/library/)
- [iog.io/papers](https://www.iog.io/papers)

---

## 10. Summary: From Paper to Running Network

The following table maps each major research paper to its deployment on the Cardano
mainnet:

| Paper | Conference/Year | Deployed As | Hard Fork / Era |
|-------|-----------------|-------------|-----------------|
| Ouroboros Classic | CRYPTO 2017 | Byron consensus | Byron (Sep 2017) |
| Ouroboros BFT | ePrint 2018 | Byron-Shelley bridge | Byron Reboot (Mar 2020) |
| Ouroboros Praos | EUROCRYPT 2018 | Current mainnet consensus | Shelley (Jul 2020) |
| Ouroboros Genesis | CCS 2018 | Node bootstrapping (in progress) | Incremental integration |
| EUTXO Model | FC 2020 | Cardano ledger model | Shelley onwards |
| Native Custom Tokens | ISoLA 2020 | Multi-asset ledger | Mary (Mar 2021) |
| Plutus Integration Spec | Formal spec | Smart contract platform | Alonzo (Sep 2021) |
| Hydra | ePrint 2021 | Layer 2 state channels | Mainnet (2023+) |
| Mithril | ePrint 2021 | Fast bootstrapping protocol | Mainnet beta (2023+) |
| Ouroboros Peras | Research 2024-25 | Fast settlement (planned) | Future hard fork |
| Ouroboros Leios | CRYPTO 2025 | High throughput (planned) | Future hard fork |
| Ouroboros Chronos | EUROCRYPT 2021 | Self-sovereign time (research) | Future |
| Ouroboros Crypsinous | IEEE S&P 2019 | Privacy research (Midnight) | Separate chain |

### The Cardano Development Eras

Cardano's development is organized into five named eras, each building on the
research foundations described above:

1. **Byron** (Foundation, 2017-2020): Ouroboros Classic/BFT, federated network, basic
   value transfer.
2. **Shelley** (Decentralization, 2020): Ouroboros Praos, stake delegation, reward
   sharing, full decentralization.
3. **Goguen** (Smart Contracts, 2020-2021): EUTXO model, Plutus platform, native
   multi-asset support (Allegra, Mary, Alonzo hard forks).
4. **Basho** (Scaling, 2022+): Hydra, Mithril, pipelining, input endorsers (Leios).
5. **Voltaire** (Governance, 2024+): On-chain governance, treasury system, CIP-1694,
   Conway hard fork.

---

### Closing Note

Cardano represents a unique experiment in the blockchain space: the systematic
application of academic research methods to the design, implementation, and evolution
of a decentralized system. Every component of the running network -- from the
consensus protocol to the ledger rules to the smart contract platform -- traces its
lineage to a formally specified, peer-reviewed research paper. This document serves as
an index to that research foundation, providing the context needed to understand not
just *what* Cardano does, but *why* it works the way it does.

---

*Last updated: 2026-03-12*

*Sources: IOG Research Library, IACR ePrint Archive, ACM Digital Library, IEEE Xplore,
Springer, Cardano documentation, University of Edinburgh Research Explorer*

import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import {
  Cpu,
  Shield,
  Zap,
  Globe,
  BookOpen,
  ArrowRight,
  Terminal,
  GitBranch,
} from 'lucide-react';
import styles from './index.module.css';

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <p className={styles.heroTag}>CARDANO NODE IMPLEMENTATION</p>
        <h1 className={styles.heroTitle}>
          Bluematter
        </h1>
        <p className={styles.heroSub}>
          A pure Python implementation of the full Cardano protocol stack.
          Ouroboros Praos. Conway ledger. Plutus V1/V2/V3. Live on preprod.
        </p>
        <div className={styles.heroButtons}>
          <Link className={styles.btnPrimary} to="/bluematter-docs/docs/intro">
            <BookOpen size={20} />
            Read the Specification
            <ArrowRight size={18} />
          </Link>
          <Link
            className={styles.btnGhost}
            href="https://github.com/Chainscore/bluematter-docs"
          >
            <GitBranch size={20} />
            GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}

const capabilities = [
  {
    icon: <Cpu size={28} strokeWidth={1.5} />,
    title: 'Ouroboros Praos',
    desc: 'VRF leader election, KES signatures, epoch nonce evolution, header validation with 12 checks.',
    num: '01',
  },
  {
    icon: <Shield size={28} strokeWidth={1.5} />,
    title: 'Conway Ledger',
    desc: '19 UTxO validation rules, multi-asset arithmetic, certificate processing, on-chain governance.',
    num: '02',
  },
  {
    icon: <Zap size={28} strokeWidth={1.5} />,
    title: 'Plutus Scripts',
    desc: 'V1, V2, V3 evaluation via CEK machine. Correct ScriptContext, ScriptInfo, and TxCert encoding.',
    num: '03',
  },
  {
    icon: <Globe size={28} strokeWidth={1.5} />,
    title: 'Full Networking',
    desc: 'ChainSync, BlockFetch, TxSubmission2, KeepAlive over multiplexed TCP. Live preprod sync.',
    num: '04',
  },
];

function Capabilities() {
  return (
    <section className={styles.caps}>
      <div className={styles.capsInner}>
        <p className={styles.capsTag}>WHAT IT DOES</p>
        <h2 className={styles.capsTitle}>
          Where <em>research</em> meets implementation.
        </h2>
        <div className={styles.capsGrid}>
          {capabilities.map((c) => (
            <div key={c.title} className={styles.capCard}>
              <div className={styles.capIcon}>{c.icon}</div>
              <h3 className={styles.capName}>{c.title}</h3>
              <p className={styles.capDesc}>{c.desc}</p>
              <span className={styles.capNum}>{c.num}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Explore() {
  return (
    <section className={styles.explore}>
      <div className={styles.exploreInner}>
        <Link className={styles.exploreCard} to="/bluematter-docs/docs/cardano/research">
          <Terminal size={24} strokeWidth={1.5} />
          <div>
            <h3>Cardano Protocol</h3>
            <p>Ouroboros papers, era evolution, Haskell node architecture</p>
          </div>
          <ArrowRight size={20} />
        </Link>
        <Link className={styles.exploreCard} to="/bluematter-docs/docs/spec/notation">
          <BookOpen size={24} strokeWidth={1.5} />
          <div>
            <h3>Formal Specification</h3>
            <p>14 chapters defining every type, rule, and transition</p>
          </div>
          <ArrowRight size={20} />
        </Link>
        <Link className={styles.exploreCard} to="/bluematter-docs/docs/architecture/overview">
          <Cpu size={24} strokeWidth={1.5} />
          <div>
            <h3>Architecture</h3>
            <p>Module map, function-by-function call flows, storage tiers</p>
          </div>
          <ArrowRight size={20} />
        </Link>
      </div>
    </section>
  );
}

export default function Home(): React.ReactNode {
  return (
    <Layout
      title="Independent Cardano Full-Node"
      description="Bluematter - Pure Python Cardano node implementation"
    >
      <main className={styles.page}>
        <Hero />
        <Capabilities />
        <Explore />
      </main>
    </Layout>
  );
}

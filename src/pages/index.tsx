import React from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import {
  Cpu,
  Shield,
  Zap,
  Globe,
  BookOpen,
  ArrowRight,
  GitBranch,
} from 'lucide-react';
import styles from './index.module.css';

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.grain} />
      <div className={styles.heroInner}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Live on Preprod
        </div>
        <h1 className={styles.title}>
          <span className={styles.titleLine}>Blue</span>
          <span className={styles.titleLine}>matter</span>
        </h1>
        <p className={styles.sub}>
          Independent Cardano full-node.
          <br />
          Pure Python. Open source.
        </p>
        <div className={styles.ctas}>
          <Link className={styles.btnWhite} to="/bluematter-docs/docs/intro">
            <BookOpen size={18} />
            Specification
            <ArrowRight size={16} />
          </Link>
          <Link className={styles.btnOutline} href="https://github.com/Chainscore/bluematter-docs">
            <GitBranch size={18} />
            Source
          </Link>
        </div>
      </div>
      <div className={styles.scrollHint}>
        <span />
      </div>
    </section>
  );
}

const items = [
  {
    icon: <Cpu size={22} strokeWidth={1.5} />,
    label: 'Ouroboros Praos',
    detail: 'VRF leader election, KES forward-secure signatures, nonce evolution',
  },
  {
    icon: <Shield size={22} strokeWidth={1.5} />,
    label: 'Conway Ledger',
    detail: '19 UTxO rules, multi-asset, certificates, governance',
  },
  {
    icon: <Zap size={22} strokeWidth={1.5} />,
    label: 'Plutus V1/V2/V3',
    detail: 'CEK machine evaluation with correct ScriptContext encoding',
  },
  {
    icon: <Globe size={22} strokeWidth={1.5} />,
    label: 'Network Stack',
    detail: 'ChainSync, BlockFetch, TxSubmission2 over muxed TCP',
  },
];

function Stack() {
  return (
    <section className={styles.stack}>
      <div className={styles.stackInner}>
        <div className={styles.stackLeft}>
          <p className={styles.tag}>PROTOCOL STACK</p>
          <h2 className={styles.stackTitle}>
            Every layer.<br />Implemented.
          </h2>
        </div>
        <div className={styles.stackRight}>
          {items.map((item, i) => (
            <div key={item.label} className={styles.stackItem}>
              <div className={styles.stackIcon}>{item.icon}</div>
              <div>
                <h3>{item.label}</h3>
                <p>{item.detail}</p>
              </div>
              <span className={styles.stackNum}>0{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Docs() {
  return (
    <section className={styles.docs}>
      <div className={styles.docsInner}>
        <Link className={styles.docCard} to="/bluematter-docs/docs/cardano/research">
          <span className={styles.docNum}>I</span>
          <div>
            <h3>Cardano Protocol</h3>
            <p>Research papers, era history, Haskell node architecture</p>
          </div>
          <ArrowRight size={20} className={styles.docArrow} />
        </Link>
        <Link className={styles.docCard} to="/bluematter-docs/docs/spec/notation">
          <span className={styles.docNum}>II</span>
          <div>
            <h3>Formal Specification</h3>
            <p>14 chapters. Every type, rule, and state transition.</p>
          </div>
          <ArrowRight size={20} className={styles.docArrow} />
        </Link>
        <Link className={styles.docCard} to="/bluematter-docs/docs/architecture/overview">
          <span className={styles.docNum}>III</span>
          <div>
            <h3>Architecture</h3>
            <p>Call flows, module map, storage, networking internals</p>
          </div>
          <ArrowRight size={20} className={styles.docArrow} />
        </Link>
      </div>
    </section>
  );
}

export default function Home(): React.ReactNode {
  return (
    <>
      <Head>
        <title>Bluematter</title>
        <meta name="description" content="Independent Cardano full-node implementation in pure Python" />
        <html data-theme="dark" className="landing-page" />
      </Head>
      <main className={styles.page}>
        <Hero />
        <Stack />
        <Docs />
        <footer className={styles.foot}>
          <span>Bluematter</span>
          <span className={styles.footDot} />
          <span>Chainscore Labs</span>
        </footer>
      </main>
    </>
  );
}

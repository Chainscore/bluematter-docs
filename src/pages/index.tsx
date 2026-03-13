import React from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  Cpu,
  Shield,
  Zap,
  Globe,
  BookOpen,
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Github,
  Twitter,
} from 'lucide-react';
import styles from './index.module.css';

/* ── NAV ──────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav className={styles.nav}>
      <Link to={useBaseUrl('/')} className={styles.navLogo}>
        BlueMatter
      </Link>
      <div className={styles.navLinks}>
        <Link to={useBaseUrl('/docs/intro')} className={styles.navLink}>Docs</Link>
        <Link to={useBaseUrl('/docs/spec/notation')} className={styles.navLink}>Spec</Link>
        <Link
          className={styles.navBtn}
          href="https://github.com/Chainscore/BlueMatter-docs"
        >
          GitHub
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </nav>
  );
}

/* ── HERO ─────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.grain} />
      <div className={styles.blob1} />
      <div className={styles.blob2} />
      <div className={styles.blob3} />
      <div className={styles.heroInner}>
        <p className={styles.kicker}>Independent Cardano Full-Node</p>
        <h1 className={styles.title}>BlueMatter</h1>
        <p className={styles.sub}>
          C performance. Python clarity.
          <br />
          One Cardano node.
        </p>
        <div className={styles.ctas}>
          <Link className={styles.btnWhite} to={useBaseUrl('/docs/intro')}>
            <BookOpen size={18} />
            Read the Spec
            <ArrowRight size={16} />
          </Link>
          <Link className={styles.btnGhost} href="https://github.com/Chainscore/BlueMatter-docs">
            <GitBranch size={18} />
            Source
          </Link>
        </div>
      </div>
      <div className={styles.scrollLine}><span /></div>
    </section>
  );
}

/* ── STACK ────────────────────────────────────────────────────── */

const stack = [
  { icon: <Cpu size={22} strokeWidth={1.5} />, label: 'C-backed Crypto', desc: 'libsodium Ed25519, Blake2b, VRF, and KES via PyNaCl and hashlib. Native speed where it matters.' },
  { icon: <Shield size={22} strokeWidth={1.5} />, label: 'Python Ledger', desc: 'Readable, auditable UTxO validation. 19 rules, multi-asset arithmetic, certificates, governance.' },
  { icon: <Zap size={22} strokeWidth={1.5} />, label: 'Plutus V1/V2/V3', desc: 'Script evaluation via uplc CEK machine. Correct ScriptContext, ScriptInfo, and TxCert encoding.' },
  { icon: <Globe size={22} strokeWidth={1.5} />, label: 'Async Networking', desc: 'asyncio-native ChainSync, BlockFetch, TxSubmission2 over multiplexed TCP. Zero blocking.' },
];

function Stack() {
  return (
    <section className={styles.stack}>
      <div className={styles.stackInner}>
        <div className={styles.stackLeft}>
          <p className={styles.tag}>WHY C + PYTHON</p>
          <h2 className={styles.stackH}>Fast where it <em>counts</em>.<br />Clear everywhere else.</h2>
        </div>
        <div className={styles.stackRight}>
          {stack.map((s, i) => (
            <div key={s.label} className={styles.sItem}>
              <div className={styles.sIcon}>{s.icon}</div>
              <div className={styles.sText}>
                <h3>{s.label}</h3>
                <p>{s.desc}</p>
              </div>
              <span className={styles.sNum}>0{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── DOCS ─────────────────────────────────────────────────────── */

function Docs() {
  return (
    <section className={styles.docs}>
      <div className={styles.docsInner}>
        <p className={styles.tag}>DOCUMENTATION</p>
        <div className={styles.docsGrid}>
          <Link className={styles.dCard} to={useBaseUrl('/docs/cardano/research')}>
            <span className={styles.dLabel}>01</span>
            <h3>Cardano Protocol</h3>
            <p>Ouroboros papers, hard fork history, Haskell node internals, networking protocols</p>
            <span className={styles.dLink}>Explore <ArrowRight size={14} /></span>
          </Link>
          <Link className={styles.dCard} to={useBaseUrl('/docs/spec/notation')}>
            <span className={styles.dLabel}>02</span>
            <h3>Formal Specification</h3>
            <p>14 chapters defining every data type, validation rule, and state transition</p>
            <span className={styles.dLink}>Explore <ArrowRight size={14} /></span>
          </Link>
          <Link className={styles.dCard} to={useBaseUrl('/docs/architecture/overview')}>
            <span className={styles.dLabel}>03</span>
            <h3>Architecture</h3>
            <p>Function-by-function call flows, module map, storage tiers, sync pipeline</p>
            <span className={styles.dLink}>Explore <ArrowRight size={14} /></span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── PIPELINE ─────────────────────────────────────────────────── */

const pipeline = [
  { color: '#081020', accent: '#1a3060', label: 'Network', sub: 'TCP + Mux', link: '/docs/architecture/network' },
  { color: '#0a1630', accent: '#1e3d70', label: 'ChainSync', sub: 'Headers', link: '/docs/spec/networking' },
  { color: '#0d1d40', accent: '#224a80', label: 'BlockFetch', sub: 'Bodies', link: '/docs/spec/networking' },
  { color: '#102550', accent: '#285890', label: 'Decode', sub: 'CBOR', link: '/docs/architecture/codec' },
  { color: '#132d60', accent: '#2e66a0', label: 'Consensus', sub: 'VRF + KES', link: '/docs/spec/consensus' },
  { color: '#163670', accent: '#3574b0', label: 'Validate', sub: '19 Rules', link: '/docs/spec/transactions' },
  { color: '#1a3f80', accent: '#3c82c0', label: 'Plutus', sub: 'CEK Machine', link: '/docs/spec/scripts' },
  { color: '#1e4890', accent: '#4490d0', label: 'Apply', sub: 'State Update', link: '/docs/spec/ledger-state' },
  { color: '#2252a0', accent: '#4c9ee0', label: 'Epoch', sub: 'Rewards', link: '/docs/spec/epoch' },
  { color: '#265cb0', accent: '#55acf0', label: 'Storage', sub: 'Persist', link: '/docs/spec/storage' },
];

function Pipeline() {
  const [active, setActive] = React.useState<number | null>(null);
  return (
    <section className={styles.pipeline}>
      <div className={styles.strip}>
        {pipeline.map((p, i) => (
          <Link
            key={p.label}
            to={useBaseUrl(p.link)}
            className={`${styles.cell} ${active === i ? styles.cellActive : ''} ${active !== null && active !== i ? styles.cellDim : ''}`}
            style={{
              '--cell-bg': p.color,
              '--cell-accent': p.accent,
            } as React.CSSProperties}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <div className={styles.cellContent}>
              <span className={styles.cellNum}>{String(i + 1).padStart(2, '0')}</span>
              <span className={styles.cellName}>{p.label}</span>
              <span className={styles.cellSub}>{p.sub}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── FOOTER ───────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footInner}>
        <div className={styles.footLeft}>
          <span className={styles.footLogo}>BlueMatter</span>
          <p className={styles.footDesc}>
            Cardano full-node combining C-backed cryptography with Python's readability. By Chainscore Labs.
          </p>
        </div>
        <div className={styles.footCol}>
          <h4>Documentation</h4>
          <Link to={useBaseUrl('/docs/intro')}>Introduction</Link>
          <Link to={useBaseUrl('/docs/spec/notation')}>Specification</Link>
          <Link to={useBaseUrl('/docs/architecture/overview')}>Architecture</Link>
        </div>
        <div className={styles.footCol}>
          <h4>Links</h4>
          <Link href="https://github.com/Chainscore/BlueMatter-docs">GitHub</Link>
          <Link href="https://chainscore.xyz">Chainscore Labs</Link>
        </div>
      </div>
      <div className={styles.footBottom}>
        <span>Chainscore Labs</span>
        <div className={styles.footSocials}>
          <Link href="https://github.com/Chainscore" aria-label="GitHub">
            <Github size={16} />
          </Link>
          <Link href="https://x.com/chainscorelabs" aria-label="X">
            <Twitter size={16} />
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ── PAGE ─────────────────────────────────────────────────────── */

export default function Home(): React.ReactNode {
  return (
    <>
      <Head>
        <title>Bluematter</title>
        <meta name="description" content="Independent Cardano full-node. C performance meets Python clarity." />
        <html data-theme="dark" className="landing-page" />
      </Head>
      <div className={styles.page}>
        <Nav />
        <main>
          <Hero />
          <Stack />
          <Pipeline />
          <Docs />
        </main>
        <Footer />
      </div>
    </>
  );
}

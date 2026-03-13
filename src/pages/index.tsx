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
        bluematter
      </Link>
      <div className={styles.navLinks}>
        <Link to={useBaseUrl('/docs/intro')} className={styles.navLink}>Docs</Link>
        <Link to={useBaseUrl('/docs/spec/notation')} className={styles.navLink}>Spec</Link>
        <Link
          className={styles.navBtn}
          href="https://github.com/Chainscore/bluematter-docs"
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
      <div className={styles.heroGlow} />
      <div className={styles.heroInner}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Cardano Full-Node
        </div>
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
          <Link className={styles.btnGhost} href="https://github.com/Chainscore/bluematter-docs">
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
        <Link className={styles.dCard} to={useBaseUrl('/docs/cardano/research')}>
          <span className={styles.dNum}>I</span>
          <div><h3>Cardano Protocol</h3><p>Research papers, eras, Haskell node</p></div>
          <ArrowRight size={20} className={styles.dArrow} />
        </Link>
        <Link className={styles.dCard} to={useBaseUrl('/docs/spec/notation')}>
          <span className={styles.dNum}>II</span>
          <div><h3>Formal Specification</h3><p>Every type, rule, and transition</p></div>
          <ArrowRight size={20} className={styles.dArrow} />
        </Link>
        <Link className={styles.dCard} to={useBaseUrl('/docs/architecture/overview')}>
          <span className={styles.dNum}>III</span>
          <div><h3>Architecture</h3><p>Call flows, modules, storage</p></div>
          <ArrowRight size={20} className={styles.dArrow} />
        </Link>
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
          <span className={styles.footLogo}>bluematter</span>
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
          <Link href="https://github.com/Chainscore/bluematter-docs">GitHub</Link>
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
          <Docs />
        </main>
        <Footer />
      </div>
    </>
  );
}

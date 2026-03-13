import React, {useState, useEffect} from 'react';
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
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.6);
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`${styles.nav} ${show ? styles.navVisible : styles.navHidden}`}>
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
  { color: '#0a1628', label: 'Network', detail: 'TCP connect, mux framing, handshake v13/v14', link: '/docs/architecture/network' },
  { color: '#0c1f3d', label: 'ChainSync', detail: 'Header streaming, intersection, rollback handling', link: '/docs/spec/networking' },
  { color: '#0e2854', label: 'BlockFetch', detail: 'Range requests, batch retrieval, era-tagged blocks', link: '/docs/spec/networking' },
  { color: '#10326b', label: 'Decode', detail: 'CBOR schema, byte-preserving walk, ConwayBlock', link: '/docs/architecture/codec' },
  { color: '#133d82', label: 'Consensus', detail: 'VRF proof, KES sig, leader check, nonce evolution', link: '/docs/spec/consensus' },
  { color: '#164899', label: 'Validate', detail: '19 UTxO rules, witness sigs, script data hash', link: '/docs/spec/transactions' },
  { color: '#1953b0', label: 'Plutus', detail: 'V1/V2/V3 CEK eval, ScriptContext, cost models', link: '/docs/spec/scripts' },
  { color: '#1c5ec7', label: 'Apply', detail: 'Consume inputs, add outputs, collect fees, certs', link: '/docs/spec/ledger-state' },
  { color: '#2069de', label: 'Epoch', detail: 'Rewards, pool retirement, snapshot rotation', link: '/docs/spec/epoch' },
  { color: '#2575f5', label: 'Storage', detail: 'VolatileDB, ImmutableDB, LedgerDB checkpoints', link: '/docs/spec/storage' },
];

function Pipeline() {
  const [active, setActive] = React.useState<number | null>(null);
  return (
    <section className={styles.pipeline}>
      <div className={styles.pipeInner}>
        <p className={styles.tag}>BLOCK PIPELINE</p>
        <h2 className={styles.pipeTitle}>From TCP byte to ledger state.</h2>
        <p className={styles.pipeSub}>Every block flows through 10 stages. Hover to explore each module.</p>
      </div>
      <div className={styles.strip}>
        {pipeline.map((p, i) => (
          <Link
            key={p.label}
            to={useBaseUrl(p.link)}
            className={`${styles.cell} ${active === i ? styles.cellActive : ''}`}
            style={{ background: p.color }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className={styles.cellLabel}>{p.label}</span>
          </Link>
        ))}
      </div>
      <div className={styles.pipeDetail}>
        {active !== null ? (
          <>
            <span className={styles.pipeDetailNum}>0{active + 1}</span>
            <h3>{pipeline[active].label}</h3>
            <p>{pipeline[active].detail}</p>
          </>
        ) : (
          <p className={styles.pipeHint}>Hover a stage above</p>
        )}
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

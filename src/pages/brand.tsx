import React from 'react';
import Head from '@docusaurus/Head';

const fonts = [
  { name: 'Rock Salt', family: "'Rock Salt', cursive", note: 'Raw scratchy signature' },
  { name: 'Permanent Marker', family: "'Permanent Marker', cursive", note: 'Bold marker pen' },
  { name: 'Sedgwick Ave Display', family: "'Sedgwick Ave Display', cursive", note: 'Loose brush hand' },
  { name: 'Finger Paint', family: "'Finger Paint', cursive", note: 'Thick finger-painted' },
  { name: 'Rubik Wet Paint', family: "'Rubik Wet Paint', system-ui", note: 'Dripping wet paint' },
  { name: 'Rubik Distressed', family: "'Rubik Distressed', system-ui", note: 'Rough distressed' },
  { name: 'Londrina Sketch', family: "'Londrina Sketch', cursive", note: 'Sketched outline' },
  { name: 'Zeyada', family: "'Zeyada', cursive", note: 'Fast scribble' },
  { name: 'Caveat', family: "'Caveat', cursive", note: 'Clean handwritten' },
];

export default function Brand(): React.ReactNode {
  return (
    <>
      <Head>
        <title>BlueMatter Brand</title>
        <html data-theme="dark" className="landing-page" />
      </Head>
      <div style={{
        background: '#000',
        color: '#fff',
        minHeight: '100vh',
        padding: '4rem 3rem',
        fontFamily: 'Inter, sans-serif',
      }}>
        <p style={{
          fontSize: '0.7rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase' as const,
          color: 'rgba(255,255,255,0.3)',
          marginBottom: '1rem',
        }}>LOGO EXPLORATION</p>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          marginBottom: '4rem',
        }}>Pick the one that hits.</h1>

        {fonts.map((f) => (
          <div key={f.name} style={{
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            padding: '3rem 0',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>{f.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)' }}>{f.note}</span>
            </div>

            {/* White on black */}
            <div style={{
              fontFamily: f.family,
              fontSize: 'clamp(3rem, 8vw, 6rem)',
              lineHeight: 1,
              color: '#fff',
              marginBottom: '1.5rem',
            }}>
              BlueMatter
            </div>

            {/* With gradient */}
            <div style={{
              fontFamily: f.family,
              fontSize: 'clamp(3rem, 8vw, 6rem)',
              lineHeight: 1,
              background: 'linear-gradient(135deg, #fff 0%, #4d8bff 60%, #1a3a8a 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: '1.5rem',
            }}>
              BlueMatter
            </div>

            {/* Black on white card */}
            <div style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '2rem 2.5rem',
              display: 'inline-block',
            }}>
              <div style={{
                fontFamily: f.family,
                fontSize: 'clamp(2rem, 5vw, 3.5rem)',
                lineHeight: 1,
                color: '#000',
              }}>
                BlueMatter
              </div>
            </div>

            {/* Small / navbar size */}
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '3rem', alignItems: 'center' }}>
              <span style={{
                fontFamily: f.family,
                fontSize: '1.4rem',
                color: '#fff',
              }}>BlueMatter</span>
              <span style={{
                fontFamily: f.family,
                fontSize: '1.4rem',
                color: '#000',
                background: '#fff',
                padding: '0.3rem 1rem',
                borderRadius: '6px',
              }}>BlueMatter</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

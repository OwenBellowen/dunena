'use client';

import { useEffect, useRef } from 'react';

export default function ApiExplorer() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const configScript = document.createElement('script');
    configScript.id = 'api-reference';
    configScript.dataset.url = '/docs/openapi.yaml';
    configScript.dataset.configuration = JSON.stringify({
      layout: 'modern',
      hideDownloadButton: false,
      darkMode: document.documentElement.getAttribute('data-theme') !== 'light',
    });
    hostRef.current.appendChild(configScript);

    const scalarScript = document.createElement('script');
    scalarScript.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
    scalarScript.defer = true;
    document.body.appendChild(scalarScript);

    return () => {
      scalarScript.remove();
    };
  }, []);

  return (
    <>
      <aside className="sidebar"></aside>
      <div className="main" style={{padding: '1.2rem 1.2rem 2rem'}}>
        <div style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: 'var(--shadow-sm)', overflow: 'hidden'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', padding: '0.8rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface2)'}}>
            <span style={{fontSize: '0.78rem', color: 'var(--dim)', fontWeight: 600, letterSpacing: '0.01em'}}>API Explorer</span>
            <span style={{display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border2)', background: 'var(--surface3)', color: 'var(--text)', borderRadius: '999px', padding: '0.2rem 0.65rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em'}}>Scalar</span>
            <span style={{marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--mono)'}}>spec: /openapi.yaml</span>
          </div>
          <div id="scalar-host" ref={hostRef} aria-label="Scalar explorer" style={{minHeight: '70vh', background: 'var(--surface)'}}></div>
        </div>
      </div>
    </>
  );
}

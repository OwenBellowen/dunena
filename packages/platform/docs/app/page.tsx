import Link from 'next/link';

export const metadata = {
  title: 'Dunena — High-Performance Cache Engine',
  description: 'Dunena is a high-performance in-memory cache engine built on Zig and Bun with O(1) operations, bloom filter, WebSocket streaming, and Prometheus metrics.',
};

export default function Home() {
  return (
    <>
      {/* Hero */}
      <div className="hero" style={{marginTop: 'var(--header-h)'}}>
        <h1><img className="hero-logo" src="/docs/logo.svg" alt="Dunena logo" />Dunena</h1>
        <p className="tagline">A high-performance in-memory cache engine built on Zig &amp; Bun</p>
        <p className="sub">O(1) operations · native LRU eviction · bloom filter · real-time WebSocket streaming · Prometheus metrics</p>
        <div className="hero-buttons">
          <Link href="/getting-started" className="btn btn-primary">Get Started →</Link>
          <Link href="/api" className="btn btn-secondary">API Reference</Link>
        </div>
      </div>

      {/* Quick Start */}
      <div className="install-block">
        <pre><div dangerouslySetInnerHTML={{__html: `<code><span style="color:#8b949e"># Clone and start</span>
git clone https://github.com/owenbellowen/dunena.git
cd dunena
bun run build:zig
bun run start

<span style="color:#8b949e"># Set a value</span>
curl -X POST http://localhost:3000/cache/hello \\
  -H "Content-Type: application/json" \\
  -d '{"value": "world"}'

<span style="color:#8b949e"># Get it back</span>
curl http://localhost:3000/cache/hello</code>`}} /></pre>
      </div>

      {/* Features */}
      <div className="features">
        <div className="feature-card">
          <div className="icon">⚡</div>
          <h3>Zig-Powered Core</h3>
          <p>Native O(1) cache operations via hash map + doubly-linked list LRU. Called through Bun&apos;s zero-cost FFI bridge.</p>
        </div>
        <div className="feature-card">
          <div className="icon">🔑</div>
          <h3>Full CRUD + Batch</h3>
          <p>GET, SET, DELETE with namespace isolation. Batch mget/mset for efficient multi-key operations.</p>
        </div>
        <div className="feature-card">
          <div className="icon">🌸</div>
          <h3>Bloom Filter</h3>
          <p>Probabilistic membership test eliminates unnecessary hash lookups on cache misses. Configurable false-positive rate.</p>
        </div>
        <div className="feature-card">
          <div className="icon">⏱️</div>
          <h3>TTL Expiry</h3>
          <p>Per-key time-to-live with automatic cleanup. Set a default TTL or override per request.</p>
        </div>
        <div className="feature-card">
          <div className="icon">📡</div>
          <h3>Real-Time WebSocket</h3>
          <p>Subscribe to cache events. Run get/set/del/mget/mset over WebSocket with namespace and TTL support.</p>
        </div>
        <div className="feature-card">
          <div className="icon">📊</div>
          <h3>Prometheus Metrics</h3>
          <p>/metrics endpoint with hits, misses, evictions, hit rate, latency percentiles, and uptime.</p>
        </div>
        <div className="feature-card">
          <div className="icon">🖥️</div>
          <h3>Admin Dashboard</h3>
          <p>Built-in web dashboard with live stats, cache operations panel, key scanner, and event log.</p>
        </div>
        <div className="feature-card">
          <div className="icon">🔧</div>
          <h3>CLI Tool</h3>
          <p>Full-featured command-line client: get, set, del, mget, mset, keys, stats, bench — with namespace support.</p>
        </div>
        <div className="feature-card">
          <div className="icon">🗜️</div>
          <h3>Transparent Compression</h3>
          <p>Auto-compress large values using native Zig RLE. Configured via threshold — zero-change reads.</p>
        </div>
      </div>

      {/* Architecture */}
      <div className="arch-section">
        <h2>Architecture</h2>
        <div className="arch-diagram">
          <span>Client</span> ──HTTP/WS──▶ <span>Bun Server</span> ──FFI──▶ <span>Zig Cache Core</span><br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│<br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── Router → Middleware (CORS, Auth, Rate Limit)<br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── CacheService → NativeCache (LRU, Bloom, Compression)<br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── PubSub → WebSocket Broadcast<br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── Analytics → Stats, Latency, Prometheus
        </div>
      </div>

      {/* Footer */}
      <footer className="site-footer">
        Dunena v0.3.1 — Zig + Bun/TypeScript cache engine
      </footer>
    </>
  );
}

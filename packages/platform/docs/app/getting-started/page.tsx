import Sidebar from '../Sidebar';

export const metadata = {
  title: 'Getting Started — Dunena Docs',
};

export default function GettingStarted() {
  return (
    <>
      <Sidebar />
      <div className="main">
    <h1>Getting Started</h1>
    <p>Dunena is a high-performance in-memory cache engine with a Zig core and a TypeScript/Bun API layer. This guide walks you through installation and basic usage.</p>

    <h2 id="prerequisites">Prerequisites</h2>

    <h3>Choose Your Install Method</h3>
    <table>
      <thead><tr><th>Method</th><th>Best For</th><th>Prerequisites</th></tr></thead>
      <tbody>
        <tr><td>🐳 <strong>Docker</strong></td><td>Quick trial, deployment</td><td>Docker only</td></tr>
        <tr><td>📦 <strong>GitHub Release</strong></td><td>Standalone server (Linux)</td><td>Bun only</td></tr>
        <tr><td>🔧 <strong>Source Build</strong></td><td>Development, all platforms</td><td>Bun + Zig</td></tr>
      </tbody>
    </table>
    <p>See the full <a href="https://github.com/OwenBellowen/dunena/blob/main/INSTALL.md">INSTALL.md</a> for detailed instructions per method.</p>

    <h3>Docker Quickstart (No Zig/Bun needed)</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># From the repo root:
docker compose -f deploy/docker-compose.yml up -d

# Verify it's running
curl http://localhost:3000/health

# Try it
curl -X POST http://localhost:3000/cache/hello \\
  -H "Content-Type: application/json" \\
  -d '{"value": "world"}'

curl http://localhost:3000/cache/hello</code></pre>`}} />

    <h3>Source Build Prerequisites</h3>
    <ul>
      <li><a href="https://bun.sh">Bun</a> v1.0 or later</li>
      <li><a href="https://ziglang.org/download/">Zig</a> v0.15.2 or later (for building the native library)</li>
    </ul>

    <h2 id="installation">Installation</h2>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># Clone the repository
git clone https://github.com/owenbellowen/dunena.git
cd dunena

# Install TypeScript dependencies
bun install

# Build the native Zig cache library
bun run build:zig</code></pre>`}} />

    <p>The Zig build compiles the native cache, bloom filter, compression, and statistics modules into a shared library that Bun calls via FFI.</p>

    <div dangerouslySetInnerHTML={{__html: `<pre><code># Run the sanity checker
bun run cli -- doctor</code></pre>`}} />

    <h2 id="quick-start">Quick Start</h2>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># Start the server
bun run start</code></pre>`}} />

    <h3>Run the CLI from monorepo root</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>bun run cli -- stats
bun run cli -- get greeting</code></pre>`}} />

    <p>By default, Dunena starts on <code>http://localhost:3000</code> with:</p>
    <ul>
      <li>WebSocket at <code>ws://localhost:3000/ws</code></li>
      <li>Dashboard at <code>http://localhost:3000/dashboard</code></li>
      <li>Documentation at <code>http://localhost:3000/docs</code></li>
    </ul>

    <h2 id="first-requests">Your First Requests</h2>

    <h3>Store a value</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>curl -X POST http://localhost:3000/cache/greeting \\
  -H "Content-Type: application/json" \\
  -d '{"value": "Hello, Dunena!"}'</code></pre>`}} />
    <div dangerouslySetInnerHTML={{__html: `<pre><code>{"ok": true}</code></pre>`}} />

    <h3>Read it back</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>curl http://localhost:3000/cache/greeting</code></pre>`}} />
    <div dangerouslySetInnerHTML={{__html: `<pre><code>{"key": "greeting", "value": "Hello, Dunena!"}</code></pre>`}} />

    <h3>Delete it</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>curl -X DELETE http://localhost:3000/cache/greeting</code></pre>`}} />
    <div dangerouslySetInnerHTML={{__html: `<pre><code>{"deleted": true}</code></pre>`}} />

    <h3>Batch operations</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># Store multiple keys
curl -X POST http://localhost:3000/cache \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "mset",
    "entries": [
      {"key": "user:1", "value": "Alice"},
      {"key": "user:2", "value": "Bob"},
      {"key": "user:3", "value": "Charlie"}
    ]
  }'

# Fetch multiple keys
curl -X POST http://localhost:3000/cache \\
  -H "Content-Type: application/json" \\
  -d '{"action": "mget", "keys": ["user:1", "user:2", "user:99"]}'</code></pre>`}} />
    <div dangerouslySetInnerHTML={{__html: `<pre><code>{"result": {"user:1": "Alice", "user:2": "Bob", "user:99": null}}</code></pre>`}} />

    <h2 id="namespaces">Namespaces</h2>
    <p>Namespaces let you isolate groups of keys. Keys in one namespace are completely invisible to other namespaces.</p>

    <div dangerouslySetInnerHTML={{__html: `<pre><code># Store in namespace "sessions"
curl -X POST "http://localhost:3000/cache/token-abc?ns=sessions" \\
  -H "Content-Type: application/json" \\
  -d '{"value": "user-42"}'

# Read from the same namespace
curl "http://localhost:3000/cache/token-abc?ns=sessions"
# → {"key": "token-abc", "value": "user-42"}

# Without namespace — not found
curl "http://localhost:3000/cache/token-abc"
# → 404 {"error": "Key not found"}</code></pre>`}} />

    <h2 id="ttl">TTL (Time-To-Live)</h2>
    <p>Set a TTL in milliseconds to automatically expire keys.</p>

    <div dangerouslySetInnerHTML={{__html: `<pre><code># Expire after 30 seconds
curl -X POST http://localhost:3000/cache/temp-data \\
  -H "Content-Type: application/json" \\
  -d '{"value": "short-lived", "ttl": 30000}'</code></pre>`}} />

    <p>After 30 seconds the key is automatically deleted and a <code>expired</code> event is published to WebSocket subscribers.</p>

    <blockquote>You can also set a global default TTL via the <code>DUNENA_DEFAULT_TTL</code> environment variable. Per-key TTL always overrides the default.</blockquote>

    <h2 id="scan">Scanning Keys</h2>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># List all keys
curl "http://localhost:3000/keys"

# Filter by pattern
curl "http://localhost:3000/keys?pattern=user-*"

# Filter by namespace
curl "http://localhost:3000/keys?pattern=*&ns=sessions"</code></pre>`}} />

    <h2 id="next-steps">Next Steps</h2>
    <ul>
      <li><a href="/api">API Reference</a> — Full endpoint documentation</li>
      <li><a href="/websocket">WebSocket</a> — Real-time cache operations</li>
      <li><a href="/cli">CLI Tool</a> — Command-line client</li>
      <li><a href="/configuration">Configuration</a> — All environment variables</li>
    </ul>

  </div>
    </>
  );
}

import Link from 'next/link';
import Sidebar from '../Sidebar';

export const metadata = {
  title: 'Configuration — Dunena Docs',
};

export default function Configuration() {
  return (
    <>
      <Sidebar />
      <div className="main">
    <h1>Configuration Reference</h1>
    <p>Dunena is configured entirely through environment variables. All settings have sensible defaults for development.</p>

    <blockquote>💡 Create a <code>.env</code> file in the project root. Bun automatically loads it.</blockquote>

    <div dangerouslySetInnerHTML={{__html: `<pre><code># Example .env file (repo root)
DUNENA_PORT=3000
DUNENA_HOST=127.0.0.1
DUNENA_MAX_ENTRIES=100000
DUNENA_AUTH_TOKEN=my-secret-token
DUNENA_LOG_LEVEL=info</code></pre>`}} />

    
    <h2 id="cache">Cache Options</h2>
    <table>
      <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>
        <tr>
          <td><code>DUNENA_MAX_ENTRIES</code></td>
          <td><code>100000</code></td>
          <td>Maximum number of entries in the cache. When exceeded, the least recently used entry is evicted.</td>
        </tr>
        <tr>
          <td><code>DUNENA_DEFAULT_TTL</code></td>
          <td><code>0</code></td>
          <td>Default time-to-live in milliseconds for all entries. <code>0</code> = no expiry. Per-key TTL overrides this.</td>
        </tr>
        <tr>
          <td><code>DUNENA_BLOOM_FILTER</code></td>
          <td><code>true</code></td>
          <td>Enable the bloom filter for fast negative cache lookups. Reduces unnecessary hash map probes.</td>
        </tr>
        <tr>
          <td><code>DUNENA_BLOOM_SIZE</code></td>
          <td><code>1000000</code></td>
          <td>Number of bits in the bloom filter. Larger = lower false-positive rate but more memory.</td>
        </tr>
        <tr>
          <td><code>DUNENA_BLOOM_HASHES</code></td>
          <td><code>7</code></td>
          <td>Number of hash functions for the bloom filter. More hashes = lower false positives but slower inserts.</td>
        </tr>
        <tr>
          <td><code>DUNENA_COMPRESSION_THRESHOLD</code></td>
          <td><code>0</code></td>
          <td>Auto-compress values larger than this (bytes). <code>0</code> = disabled. Example: <code>1024</code> compresses values ≥ 1 KB.</td>
        </tr>
      </tbody>
    </table>

    
    <h2 id="server">Server Options</h2>
    <table>
      <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>
        <tr>
          <td><code>DUNENA_PORT</code></td>
          <td><code>3000</code></td>
          <td>HTTP server port</td>
        </tr>
        <tr>
          <td><code>DUNENA_HOST</code></td>
          <td><code>127.0.0.1</code></td>
          <td>Bind address. Use <code>0.0.0.0</code> to listen on all interfaces.</td>
        </tr>
        <tr>
          <td><code>DUNENA_WS</code></td>
          <td><code>true</code></td>
          <td>Enable the WebSocket endpoint at <code>/ws</code></td>
        </tr>
        <tr>
          <td><code>DUNENA_DASHBOARD</code></td>
          <td><code>true</code></td>
          <td>Enable the built-in web dashboard at <code>/dashboard</code></td>
        </tr>
        <tr>
          <td><code>DUNENA_CORS_ORIGINS</code></td>
          <td><code>*</code></td>
          <td>Comma-separated list of allowed CORS origins. Example: <code>https://app.example.com,https://admin.example.com</code></td>
        </tr>
        <tr>
          <td><code>DUNENA_RATE_WINDOW</code></td>
          <td><code>60000</code></td>
          <td>Rate limit window in milliseconds</td>
        </tr>
        <tr>
          <td><code>DUNENA_RATE_MAX</code></td>
          <td><code>1000</code></td>
          <td>Maximum requests per IP within the rate limit window</td>
        </tr>
      </tbody>
    </table>

    
    <h2 id="auth">Authentication</h2>
    <table>
      <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>
        <tr>
          <td><code>DUNENA_AUTH_TOKEN</code></td>
          <td>—</td>
          <td>Bearer token for API authentication. When set, all requests (except <code>/health</code>) require <code>Authorization: Bearer &lt;token&gt;</code> header.</td>
        </tr>
      </tbody>
    </table>

    <div dangerouslySetInnerHTML={{__html: `<pre><code># With authentication enabled
curl -H "Authorization: Bearer my-secret-token" \\
  http://localhost:3000/cache/mykey</code></pre>`}} />

    <blockquote>When no token is configured, authentication is disabled and all endpoints are open.</blockquote>

    
    <h2 id="logging">Logging</h2>
    <table>
      <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>
        <tr>
          <td><code>DUNENA_LOG_LEVEL</code></td>
          <td><code>info</code></td>
          <td>Log verbosity: <code>debug</code>, <code>info</code>, <code>warn</code>, <code>error</code></td>
        </tr>
        <tr>
          <td><code>DUNENA_LOG_FORMAT</code></td>
          <td><code>text</code></td>
          <td>Log format: <code>text</code> (colored console) or <code>json</code> (structured, machine-readable)</td>
        </tr>
      </tbody>
    </table>

    <h3>Text format (default)</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>[10:23:45.123] INFO  [dunena:http] POST /cache/hello 201 {"ms":2.1}</code></pre>`}} />

    <h3>JSON format</h3>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>{"ts":"2026-03-12T10:23:45.123Z","level":"info","msg":"POST /cache/hello 201","ms":2.1}</code></pre>`}} />

    <blockquote>Use <code>json</code> format in production for log aggregation tools (ELK, Datadog, etc).</blockquote>

    
    <h2 id="persistence">Persistence</h2>
    <p>Dunena can periodically snapshot the entire cache to disk as a JSON file and restore it on startup.</p>
    <table>
      <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>
        <tr>
          <td><code>DUNENA_PERSIST</code></td>
          <td><code>false</code></td>
          <td>Enable disk persistence. When enabled, snapshots are written to <code>DUNENA_PERSIST_PATH</code>.</td>
        </tr>
        <tr>
          <td><code>DUNENA_PERSIST_PATH</code></td>
          <td><code>./data/dunena-snapshot.json</code></td>
          <td>File path for the snapshot. Directories are created automatically.</td>
        </tr>
        <tr>
          <td><code>DUNENA_PERSIST_INTERVAL</code></td>
          <td><code>300000</code></td>
          <td>Auto-save interval in milliseconds. <code>0</code> = auto-save disabled (manual via <code>POST /snapshot</code> only).</td>
        </tr>
        <tr>
          <td><code>DUNENA_PERSIST_ON_SHUTDOWN</code></td>
          <td><code>true</code></td>
          <td>Save a snapshot when the server receives SIGINT/SIGTERM.</td>
        </tr>
      </tbody>
    </table>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># Enable persistence with 60-second auto-save
DUNENA_PERSIST=true
DUNENA_PERSIST_INTERVAL=60000
DUNENA_PERSIST_PATH=./data/cache.json</code></pre>`}} />
    <blockquote>Snapshots are written atomically (temp file + rename) to prevent corruption. Note: TTL timers are <em>not</em> persisted — only key/value data is saved.</blockquote>

    
    <h2 id="production">Production Example</h2>
    <div dangerouslySetInnerHTML={{__html: `<pre><code># .env.production
DUNENA_PORT=8080
DUNENA_HOST=0.0.0.0
DUNENA_MAX_ENTRIES=500000
DUNENA_DEFAULT_TTL=3600000
DUNENA_BLOOM_FILTER=true
DUNENA_BLOOM_SIZE=5000000
DUNENA_COMPRESSION_THRESHOLD=1024
DUNENA_AUTH_TOKEN=your-strong-secret-here
DUNENA_CORS_ORIGINS=https://app.example.com
DUNENA_RATE_WINDOW=60000
DUNENA_RATE_MAX=500
DUNENA_LOG_LEVEL=warn
DUNENA_LOG_FORMAT=json
DUNENA_DASHBOARD=false
DUNENA_PERSIST=true
DUNENA_PERSIST_INTERVAL=60000
DUNENA_PERSIST_ON_SHUTDOWN=true</code></pre>`}} />

    <h2 id="programmatic">Programmatic Configuration</h2>
    <p>When embedding Dunena in your own Bun application, pass an <code>AppConfig</code> object directly:</p>
    <div dangerouslySetInnerHTML={{__html: `<pre><code>import { createApp } from "@dunena/platform/server";

const app = createApp({
  cache: {
    maxEntries: 50_000,
    enableBloomFilter: true,
    bloomFilterSize: 1_000_000,
    bloomFilterHashes: 7,
    compressionThreshold: 2048,
  },
  server: {
    port: 4000,
    host: "127.0.0.1",
    enableWebSocket: true,
    enableDashboard: true,
    rateLimit: { windowMs: 60_000, maxRequests: 500 },
    cors: { origins: ["*"], methods: ["GET", "POST", "DELETE"] },
  },
  persistence: {
    enabled: true,
    filePath: "./data/snapshot.json",
    intervalMs: 300_000,
    saveOnShutdown: true,
  },
  log: { level: "info", format: "text" },
});</code></pre>`}} />

  </div>
    </>
  );
}

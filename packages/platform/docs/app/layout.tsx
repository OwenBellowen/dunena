import './globals.css';
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';

export const metadata = {
  title: 'Dunena Documentation',
  description: 'High-performance cache engine with a Zig core and Bun/TypeScript control layer',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        {/* Scroll Progress */}
        <div id="scroll-progress"></div>

        {/* Header */}
        <header className="site-header">
          <Link href="/" className="logo">
            <img src="/docs/logo.svg" alt="Dunena logo" />
            <span className="wordmark">Dunena</span>
          </Link>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/getting-started">Guide</Link>
            <Link href="/api">API</Link>
            <Link href="/api-explorer">Explorer</Link>
            <Link href="/websocket">WebSocket</Link>
            <Link href="/cli">CLI</Link>
            <Link href="/configuration">Config</Link>
            <Link href="/architecture">Architecture</Link>
            <ThemeToggle />
          </nav>
        </header>
        
        {children}
        
      </body>
    </html>
  );
}

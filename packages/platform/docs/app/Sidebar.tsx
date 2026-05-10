'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarSection {
  heading: string;
  links: { label: string; href: string }[];
}

const sections: SidebarSection[] = [
  {
    heading: 'Getting Started',
    links: [
      { label: 'Installation', href: '/getting-started' },
      { label: 'Quick Start', href: '/getting-started#quick-start' },
      { label: 'First Requests', href: '/getting-started#first-requests' },
      { label: 'Namespaces', href: '/getting-started#namespaces' },
      { label: 'TTL Expiry', href: '/getting-started#ttl' },
    ],
  },
  {
    heading: 'REST API',
    links: [
      { label: 'Overview', href: '/api' },
      { label: 'Health Check', href: '/api#health' },
      { label: 'GET /cache/:key', href: '/api#get-key' },
      { label: 'POST /cache/:key', href: '/api#set-key' },
      { label: 'DELETE /cache/:key', href: '/api#delete-key' },
      { label: 'Batch Operations', href: '/api#batch' },
      { label: 'Key Scanning', href: '/api#keys' },
      { label: 'Stats & Info', href: '/api#stats' },
      { label: 'Prometheus Metrics', href: '/api#metrics' },
      { label: 'Flush', href: '/api#flush' },
      { label: 'Snapshot', href: '/api#snapshot' },
      { label: 'SQLite Database', href: '/api#database' },
      { label: 'Query Cache', href: '/api#query-cache' },
      { label: 'Database Proxy', href: '/api#db-proxy' },
    ],
  },
  {
    heading: 'WebSocket',
    links: [
      { label: 'Connecting', href: '/websocket' },
      { label: 'Message Types', href: '/websocket#messages' },
      { label: 'Event Streaming', href: '/websocket#events' },
    ],
  },
  {
    heading: 'CLI',
    links: [
      { label: 'Overview', href: '/cli' },
      { label: 'Commands', href: '/cli#commands' },
      { label: 'Flags', href: '/cli#flags' },
      { label: 'Benchmarking', href: '/cli#benchmark' },
    ],
  },
  {
    heading: 'Configuration',
    links: [
      { label: 'Environment Variables', href: '/configuration' },
      { label: 'Cache Options', href: '/configuration#cache' },
      { label: 'Server Options', href: '/configuration#server' },
      { label: 'Authentication', href: '/configuration#auth' },
      { label: 'Logging', href: '/configuration#logging' },
      { label: 'Persistence', href: '/configuration#persistence' },
      { label: 'Production Example', href: '/configuration#production' },
    ],
  },
  {
    heading: 'Architecture',
    links: [
      { label: 'Overview', href: '/architecture' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {sections.map((section) => (
        <div key={section.heading}>
          <h4>{section.heading}</h4>
          {section.links.map((link) => {
            const basePath = link.href.split('#')[0];
            const isActive = pathname === basePath;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? 'active' : ''}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

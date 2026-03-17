import React from 'react'
import { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: React.createElement('span', {
    style: { fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.02em' }
  }, '⚡ Dunena'),
  project: {
    link: 'https://github.com/OwenBellowen/dunena',
  },
  docsRepositoryBase: 'https://github.com/OwenBellowen/dunena/blob/main/apps/docs',
  footer: {
    text: 'Dunena v0.2.0 — Zig + Bun/TypeScript cache engine',
  },
  darkMode: true,
  primaryHue: 230,
  primarySaturation: 70,
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Dunena Docs',
    }
  },
  head: React.createElement(React.Fragment, null,
    React.createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }),
    React.createElement('meta', { name: 'description', content: 'Dunena — High-performance in-memory cache engine built on Zig & Bun' })
  ),
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  toc: {
    backToTop: true,
  },
}

export default config

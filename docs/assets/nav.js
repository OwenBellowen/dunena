// Shared layout for documentation pages
(function() {
  // ── Theme System ─────────────────────────────────────
  function getTheme() {
    return localStorage.getItem('dunena-theme') || 'dark';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dunena-theme', theme);
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
  applyTheme(getTheme());

  // ── Scroll Progress Bar ───────────────────────────────
  const progressBar = document.createElement('div');
  progressBar.id = 'scroll-progress';
  document.body.prepend(progressBar);
  function updateProgress() {
    const el = document.documentElement;
    const scrolled = el.scrollTop || document.body.scrollTop;
    const total = el.scrollHeight - el.clientHeight;
    progressBar.style.width = total > 0 ? (scrolled / total * 100) + '%' : '0%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // ── Back-to-Top Button ───────────────────────────────
  const btt = document.createElement('button');
  btt.id = 'back-to-top';
  btt.title = 'Back to top';
  btt.innerHTML = '↑';
  btt.setAttribute('aria-label', 'Back to top');
  document.body.appendChild(btt);
  window.addEventListener('scroll', () => {
    btt.classList.toggle('visible', (document.documentElement.scrollTop || document.body.scrollTop) > 320);
  }, { passive: true });
  btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ── Sidebar Navigation ───────────────────────────────
  const pages = [
    { title: 'Getting Started', items: [
      { href: 'getting-started.html', text: 'Installation' },
      { href: 'getting-started.html#quick-start', text: 'Quick Start' },
      { href: 'getting-started.html#first-requests', text: 'First Requests' },
      { href: 'getting-started.html#namespaces', text: 'Namespaces' },
      { href: 'getting-started.html#ttl', text: 'TTL Expiry' },
    ]},
    { title: 'REST API', items: [
      { href: 'api.html', text: 'Overview' },
      { href: 'api.html#health', text: 'Health Check' },
      { href: 'api.html#get-key', text: 'GET /cache/:key' },
      { href: 'api.html#set-key', text: 'POST /cache/:key' },
      { href: 'api.html#delete-key', text: 'DELETE /cache/:key' },
      { href: 'api.html#batch', text: 'Batch Operations' },
      { href: 'api.html#keys', text: 'Key Scanning' },
      { href: 'api.html#stats', text: 'Stats & Info' },
      { href: 'api.html#metrics', text: 'Prometheus Metrics' },
      { href: 'api.html#flush', text: 'Flush' },
      { href: 'api.html#snapshot', text: 'Snapshot' },
      { href: 'api.html#database', text: 'SQLite Database' },
      { href: 'api.html#query-cache', text: 'Query Cache' },
      { href: 'api.html#db-proxy', text: 'Database Proxy' },
    ]},
    { title: 'WebSocket', items: [
      { href: 'websocket.html', text: 'Connecting' },
      { href: 'websocket.html#messages', text: 'Message Types' },
      { href: 'websocket.html#events', text: 'Event Streaming' },
    ]},
    { title: 'CLI', items: [
      { href: 'cli.html', text: 'Overview' },
      { href: 'cli.html#commands', text: 'Commands' },
      { href: 'cli.html#flags', text: 'Flags' },
      { href: 'cli.html#benchmark', text: 'Benchmarking' },
    ]},
    { title: 'Configuration', items: [
      { href: 'configuration.html', text: 'Environment Variables' },
      { href: 'configuration.html#cache', text: 'Cache Options' },
      { href: 'configuration.html#server', text: 'Server Options' },
      { href: 'configuration.html#auth', text: 'Authentication' },
      { href: 'configuration.html#logging', text: 'Logging' },
    ]},
  ];

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const parseHref = (href) => {
    const [file, hash = ''] = href.split('#');
    return {
      file: file && file.length ? file : 'index.html',
      hash: hash ? `#${hash}` : '',
    };
  };

  const current = (() => {
    const raw = location.pathname.split('/').pop();
    return raw && raw.length ? raw : 'index.html';
  })();
  let html = '';
  for (const section of pages) {
    html += `<h4>${section.title}</h4>`;
    for (const item of section.items) {
      const target = parseHref(item.href);
      const cls =
        (!target.hash && target.file === current && !location.hash) ||
        (target.file === current && target.hash === location.hash)
          ? ' class="active"'
          : '';
      html += `<a href="${item.href}"${cls}>${item.text}</a>`;
    }
  }
  sidebar.innerHTML = html;

  const links = Array.from(sidebar.querySelectorAll('a'));

  function setActiveByHref(href) {
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === href));
  }

  function basePageHref() {
    const pageLink = links.find((a) => {
      const href = a.getAttribute('href') || '';
      const target = parseHref(href);
      return !target.hash && target.file === current;
    });
    return pageLink ? pageLink.getAttribute('href') : null;
  }

  function activeFromLocation() {
    const exact = links.find((a) => {
      const href = a.getAttribute('href') || '';
      const target = parseHref(href);
      return target.file === current && target.hash === location.hash;
    });
    if (exact) {
      setActiveByHref(exact.getAttribute('href'));
      return;
    }
    const base = basePageHref();
    if (base) setActiveByHref(base);
  }

  // Scrollspy: sync sidebar to the section currently in view.
  function initScrollSpy() {
    const pageLinks = links.filter((a) => {
      const href = a.getAttribute('href') || '';
      const target = parseHref(href);
      return target.file === current && !!target.hash;
    });

    if (!pageLinks.length) {
      activeFromLocation();
      return;
    }

    const sectionLinks = pageLinks
      .map((a) => {
        const href = a.getAttribute('href') || '';
        const target = parseHref(href);
        const id = decodeURIComponent(target.hash.slice(1));
        const el = id ? document.getElementById(id) : null;
        return el ? { a, el } : null;
      })
      .filter(Boolean);

    if (!sectionLinks.length) {
      activeFromLocation();
      return;
    }

    const byId = new Map(sectionLinks.map((s) => [s.el.id, s.a.getAttribute('href')]));
    const headerOffset = 72;
    let currentActive = null;

    const applyActive = (href) => {
      if (!href || href === currentActive) return;
      currentActive = href;
      setActiveByHref(href);

      const activeEl = links.find((a) => a.getAttribute('href') === href);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    const updateFromScroll = () => {
      let best = null;
      for (const { el, a } of sectionLinks) {
        const top = el.getBoundingClientRect().top;
        if (top - headerOffset <= 0) {
          best = a.getAttribute('href');
        } else {
          break;
        }
      }

      if (best) {
        applyActive(best);
      } else {
        const base = basePageHref();
        if (base) applyActive(base);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length) {
          const id = visible[0].target.id;
          const href = byId.get(id);
          if (href) applyActive(href);
        } else {
          updateFromScroll();
        }
      },
      {
        root: null,
        rootMargin: '-80px 0px -60% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 1],
      }
    );

    sectionLinks.forEach(({ el }) => observer.observe(el));
    window.addEventListener('scroll', updateFromScroll, { passive: true });
    window.addEventListener('hashchange', activeFromLocation);

    activeFromLocation();
    updateFromScroll();
  }

  initScrollSpy();

  // ── Copy-to-Clipboard on <pre> blocks ───────────────
  function initCopyButtons() {
    document.querySelectorAll('pre').forEach((pre) => {
      // Wrap code in a header with dots + copy button
      const code = pre.querySelector('code');
      if (!code) return;

      // Build header
      const header = document.createElement('div');
      header.className = 'pre-header';

      const dots = document.createElement('div');
      dots.className = 'pre-dots';
      dots.innerHTML = '<span></span><span></span><span></span>';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('aria-label', 'Copy code');

      copyBtn.addEventListener('click', async () => {
        const text = code.innerText || code.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = '✓ Copied';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch {
          // Fallback for older browsers
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = '✓ Copied';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        }
      });

      header.appendChild(dots);
      header.appendChild(copyBtn);
      pre.insertBefore(header, code);
    });
  }

  // ── Heading Anchor Links ─────────────────────────────
  function initHeadingAnchors() {
    const main = document.querySelector('.main');
    if (!main) return;
    main.querySelectorAll('h2[id], h3[id]').forEach((h) => {
      const a = document.createElement('a');
      a.className = 'anchor';
      a.href = '#' + h.id;
      a.innerHTML = '#';
      a.setAttribute('aria-label', 'Link to this section');
      h.appendChild(a);
    });
  }

  // ── Wrap tables for horizontal scroll ───────────────
  function wrapTables() {
    const main = document.querySelector('.main');
    if (!main) return;
    main.querySelectorAll('table').forEach((t) => {
      if (t.parentElement.classList.contains('table-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });
  }

  // ── Inject footer links ──────────────────────────────
  function enhanceFooter() {
    const footer = document.querySelector('.site-footer');
    if (!footer || footer.querySelector('.footer-links')) return;
    const links = document.createElement('div');
    links.className = 'footer-links';
    links.innerHTML = `
      <a href="index.html">Docs</a>
      <a href="https://github.com/owenbellowen/dunena" target="_blank" rel="noopener">GitHub</a>
      <a href="https://github.com/owenbellowen/dunena/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>
      <a href="https://github.com/owenbellowen/dunena/issues" target="_blank" rel="noopener">Issues</a>
    `;
    footer.appendChild(links);
  }

  // ── Header Search ─────────────────────────────────────
  function initHeaderSearch() {
    const nav = document.querySelector('.site-header nav');
    if (!nav || nav.querySelector('.docs-search')) return;

    const searchData = [];
    const seen = new Set();
    pages.forEach((group) => {
      group.items.forEach((item) => {
        if (seen.has(item.href)) return;
        seen.add(item.href);
        searchData.push({
          href: item.href,
          title: item.text,
          section: group.title,
          searchable: `${group.title} ${item.text} ${item.href}`.toLowerCase(),
        });
      });
    });

    const searchEl = document.createElement('div');
    searchEl.className = 'docs-search';
    searchEl.innerHTML = `
      <span class="docs-search-icon">⌕</span>
      <input class="docs-search-input" type="search" placeholder="Search docs" aria-label="Search docs" autocomplete="off" />
      <span class="docs-search-hint">/</span>
      <div class="docs-search-results hidden" role="listbox" aria-label="Search results"></div>
    `;

    const input = searchEl.querySelector('.docs-search-input');
    const resultsEl = searchEl.querySelector('.docs-search-results');
    let activeIndex = -1;
    let latestResults = [];

    function renderResults(query) {
      const q = query.trim().toLowerCase();
      const tokens = q.length ? q.split(/\s+/).filter(Boolean) : [];
      let matches = searchData;
      if (tokens.length) {
        matches = searchData.filter((entry) => tokens.every((t) => entry.searchable.includes(t)));
      }

      latestResults = matches.slice(0, 10);
      activeIndex = -1;

      if (!latestResults.length) {
        resultsEl.innerHTML = '<div class="docs-search-empty">No matching sections</div>';
        resultsEl.classList.remove('hidden');
        return;
      }

      resultsEl.innerHTML = '';
      latestResults.forEach((entry, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'docs-search-item';
        btn.setAttribute('role', 'option');
        btn.dataset.index = String(idx);
        btn.innerHTML = `
          <span class="docs-search-item-title"></span>
          <span class="docs-search-item-meta"></span>
        `;
        btn.querySelector('.docs-search-item-title').textContent = entry.title;
        btn.querySelector('.docs-search-item-meta').textContent = `${entry.section} • ${entry.href}`;
        btn.addEventListener('click', () => {
          window.location.href = entry.href;
        });
        btn.addEventListener('mousemove', () => {
          setActive(idx);
        });
        resultsEl.appendChild(btn);
      });
      resultsEl.classList.remove('hidden');
    }

    function setActive(index) {
      activeIndex = index;
      const items = Array.from(resultsEl.querySelectorAll('.docs-search-item'));
      items.forEach((item, i) => item.classList.toggle('active', i === index));
      if (items[index]) {
        items[index].scrollIntoView({ block: 'nearest' });
      }
    }

    function closeResults() {
      resultsEl.classList.add('hidden');
      activeIndex = -1;
    }

    input.addEventListener('input', () => {
      renderResults(input.value);
    });

    input.addEventListener('focus', () => {
      renderResults(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!latestResults.length) return;
        setActive(Math.min(activeIndex + 1, latestResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!latestResults.length) return;
        setActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && latestResults[activeIndex]) {
          window.location.href = latestResults[activeIndex].href;
        } else if (latestResults[0]) {
          window.location.href = latestResults[0].href;
        }
      } else if (e.key === 'Escape') {
        closeResults();
        input.blur();
      }
    });

    document.addEventListener('click', (e) => {
      if (!searchEl.contains(e.target)) {
        closeResults();
      }
    });

    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const isTypingContext = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
      const slashShortcut = e.key === '/' && !isTypingContext;
      const cmdkShortcut = (e.key.toLowerCase() === 'k') && (e.metaKey || e.ctrlKey);
      if (slashShortcut || cmdkShortcut) {
        e.preventDefault();
        input.focus();
        input.select();
        renderResults(input.value);
      }
    });

    const themeBtn = nav.querySelector('.theme-toggle');
    if (themeBtn) {
      nav.insertBefore(searchEl, themeBtn);
    } else {
      nav.appendChild(searchEl);
    }
  }

  // Inject theme toggle into header nav if not present
  const nav = document.querySelector('.site-header nav');
  if (nav && !nav.querySelector('.theme-toggle')) {
    const btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.title = 'Toggle theme';
    btn.textContent = getTheme() === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
    nav.appendChild(btn);
  }

  initHeaderSearch();

  initCopyButtons();
  initHeadingAnchors();
  wrapTables();
  enhanceFooter();
})();

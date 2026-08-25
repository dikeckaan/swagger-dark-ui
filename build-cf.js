#!/usr/bin/env node
/* Builds dist-cf/ — the OASForge edition of the site for Cloudflare Workers
   static hosting (oasforge.dev). The GitHub Pages site is untouched; this
   script copies the app, rebrands the visible strings to OASForge, injects
   the SEO head (canonical, Open Graph, JSON-LD), appends a crawlable footer,
   and generates the static content pages (/guide/, /faq/, landing pages),
   sitemap.xml, robots.txt, 404 page and cache headers.
   Zero dependencies; run with:  node build-cf.js  */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist-cf');
const BASE = 'https://oasforge.dev';
const { PAGES, FAQ } = require('./site-cf/pages.js');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readDist = f => fs.readFileSync(path.join(DIST, f), 'utf8');
const writeDist = (f, s) => {
  const p = path.join(DIST, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
// Replace that throws when the needle is missing — a silent no-op here would
// ship a half-branded site.
const mustReplace = (s, from, to, what) => {
  if (!s.includes(typeof from === 'string' ? from : '') && typeof from === 'string') {
    throw new Error('rebrand anchor not found: ' + what);
  }
  const out = s.replace(from, to);
  if (out === s) throw new Error('rebrand replacement changed nothing: ' + what);
  return out;
};

/* ── 1. Fresh copy of the app under /app/ ──────────────────────────────── */
// SEO-first layout: the root URL is a fully crawlable landing page; the
// interactive workbench lives at /app/ (its own PWA scope).
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const entry of ['index.html', 'manifest.webmanifest', 'sw.js', 'LICENSE',
                     'css', 'js', 'vendor', 'specs', 'icons']) {
  fs.cpSync(path.join(ROOT, entry), path.join(DIST, 'app', entry), { recursive: true });
}

/* ── 2. Rebrand the copies to OASForge ─────────────────────────────────── */
let index = readDist('app/index.html');
// The mirror's cross-domain canonical would duplicate the one injected below.
index = index
  .replace(/^\s*<!-- The canonical home[\s\S]*?-->\n/m, '')
  .replace(/^\s*<link rel="canonical"[^>]*\/>\n/m, '');
index = mustReplace(index,
  '<title>Swagger Dark UI — Full OpenAPI Showcase</title>',
  '<title>OASForge — Free Online OpenAPI Editor, Validator &amp; Mock Server</title>',
  'index title');
index = mustReplace(index,
  /<meta name="description" content="[^"]*" \/>/,
  '<meta name="description" content="Free online OpenAPI editor with dark mode: ' +
  'live Swagger UI preview, version-aware validation with quick fixes, in-browser ' +
  'mock server, Postman import and Swagger 2.0 conversion. No signup — nothing ' +
  'leaves your browser." />',
  'index meta description');
index = mustReplace(index,
  '<span class="sdui-title">Swagger Dark UI</span>',
  '<span class="sdui-title">OASForge</span>',
  'header title');
index = mustReplace(index,
  '<span class="sdui-subtitle">OpenAPI 3.1 full-feature showcase</span>',
  '<span class="sdui-subtitle">The dark OpenAPI workbench</span>',
  'header subtitle');
writeDist('app/index.html', index);

let appjs = readDist('app/js/app.js');
appjs = appjs.split("' · Swagger Dark UI'").join("' · OASForge'");
if (appjs.includes('Swagger Dark UI\'')) throw new Error('app.js still sets a Swagger Dark UI title');
writeDist('app/js/app.js', appjs);

let guidejs = readDist('app/js/guide.js').split('Swagger Dark UI').join('OASForge');
guidejs = mustReplace(guidejs,
  'OASForge is designed, built and maintained by',
  'OASForge — formerly <em>Swagger Dark UI</em> — is designed, built and maintained by',
  'guide about "formerly" note');
writeDist('app/js/guide.js', guidejs);

writeDist('app/manifest.webmanifest', JSON.stringify({
  ...JSON.parse(readDist('app/manifest.webmanifest')),
  name: 'OASForge',
  short_name: 'OASForge',
  description: 'The dark OpenAPI workbench: editor, validation, mock server, import/export — fully offline.'
}, null, 2) + '\n');

/* ── 3. Single-file offline build from the rebranded copy ──────────────── */
execFileSync(process.execPath, [
  path.join(ROOT, 'build-standalone.js'),
  '--root', path.join(DIST, 'app'), '--out', path.join(DIST, 'standalone.html')
], { stdio: 'inherit' });
// The download artifact should not compete with the homepage in search.
writeDist('standalone.html',
  readDist('standalone.html').replace('</title>', '</title>\n  <meta name="robots" content="noindex" />'));

/* ── 4. SEO head + crawlable footer on the app page ────────────────────── */
const DESCRIPTION = 'Free online OpenAPI editor with dark mode: live Swagger UI preview, ' +
  'version-aware validation with quick fixes, in-browser mock server, Postman import ' +
  'and Swagger 2.0 conversion.';

const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person', '@id': BASE + '/#person',
      name: 'Kaan Dikeç', url: 'https://kaandikec.com',
      sameAs: ['https://github.com/dikeckaan']
    },
    {
      '@type': 'WebSite', '@id': BASE + '/#website',
      url: BASE + '/', name: 'OASForge',
      description: DESCRIPTION,
      publisher: { '@id': BASE + '/#person' }
    },
    {
      '@type': 'WebApplication', '@id': BASE + '/#app',
      name: 'OASForge',
      alternateName: 'Swagger Dark UI',
      url: BASE + '/app/',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@id': BASE + '/#person' },
      image: BASE + '/og-image.png',
      license: 'https://github.com/dikeckaan/swagger-dark-ui/blob/main/LICENSE',
      featureList: [
        'OpenAPI 3.0 / 3.1 / 3.2 editor with live Swagger UI preview',
        'Version-aware validation with one-click quick fixes',
        'Stateful in-browser mock server',
        'Postman Collection to OpenAPI 3 converter',
        'Swagger 2.0 to OpenAPI 3 converter',
        'Context-aware autocomplete and structure insert menu',
        'Version history with diff, export to Postman and standalone HTML docs',
        'Works fully offline (PWA and single-file build)'
      ]
    }
  ]
};

const ogTags = (title, desc, url) =>
  '  <link rel="canonical" href="' + url + '" />\n' +
  '  <meta property="og:type" content="website" />\n' +
  '  <meta property="og:site_name" content="OASForge" />\n' +
  '  <meta property="og:title" content="' + title + '" />\n' +
  '  <meta property="og:description" content="' + desc + '" />\n' +
  '  <meta property="og:url" content="' + url + '" />\n' +
  '  <meta property="og:image" content="' + BASE + '/og-image.png" />\n' +
  '  <meta property="og:image:width" content="1200" />\n' +
  '  <meta property="og:image:height" content="630" />\n' +
  '  <meta name="twitter:card" content="summary_large_image" />\n' +
  '  <meta name="twitter:title" content="' + title + '" />\n' +
  '  <meta name="twitter:description" content="' + desc + '" />\n' +
  '  <meta name="twitter:image" content="' + BASE + '/og-image.png" />\n';

const jsonLdTag = data =>
  '  <script type="application/ld+json">' + JSON.stringify(data) + '</script>\n';

const FOOTER_CSS =
  '  <style>\n' +
  '    .sdui-seo-footer { border-top: 1px solid var(--border, #30363d); background: var(--panel, #161b22);\n' +
  '      color: #8b949e; font-size: 13.5px; padding: 26px 24px; line-height: 1.7; }\n' +
  '    .sdui-seo-footer .cols { max-width: 1080px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 22px 52px; }\n' +
  '    .sdui-seo-footer h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; margin: 0 0 8px; color: #c9d1d9; }\n' +
  '    .sdui-seo-footer ul { list-style: none; margin: 0; padding: 0; }\n' +
  '    .sdui-seo-footer a { color: #8b949e; text-decoration: none; }\n' +
  '    .sdui-seo-footer a:hover { color: #c9d1d9; text-decoration: underline; }\n' +
  '    .sdui-seo-footer .legal { max-width: 1080px; margin: 18px auto 0; border-top: 1px solid var(--border, #30363d); padding-top: 12px; }\n' +
  '  </style>\n';

const FOOTER_HTML =
  '  <footer class="sdui-seo-footer">\n' +
  '    <div class="cols">\n' +
  '      <div>\n' +
  '        <h2>OASForge</h2>\n' +
  '        <ul>\n' +
  '          <li><a href="/">Home</a></li>\n' +
  '          <li><a href="/app/">Open the editor</a></li>\n' +
  '          <li><a href="/guide/">User guide</a></li>\n' +
  '          <li><a href="/faq/">FAQ</a></li>\n' +
  '          <li><a href="/standalone.html">Offline single-file app</a></li>\n' +
  '        </ul>\n' +
  '      </div>\n' +
  '      <div>\n' +
  '        <h2>Learn more</h2>\n' +
  '        <ul>\n' +
  '          <li><a href="/openapi-editor/">Online OpenAPI editor</a></li>\n' +
  '          <li><a href="/openapi-validator/">OpenAPI validator</a></li>\n' +
  '          <li><a href="/openapi-mock-server/">In-browser mock server</a></li>\n' +
  '          <li><a href="/postman-to-openapi/">Postman to OpenAPI converter</a></li>\n' +
  '          <li><a href="/swagger-editor-alternative/">Swagger Editor alternative</a></li>\n' +
  '        </ul>\n' +
  '      </div>\n' +
  '      <div>\n' +
  '        <h2>Project</h2>\n' +
  '        <ul>\n' +
  '          <li><a href="https://github.com/dikeckaan/swagger-dark-ui" rel="noopener">Source on GitHub</a></li>\n' +
  '          <li><a href="https://github.com/dikeckaan/swagger-dark-ui/issues" rel="noopener">Feedback &amp; issues</a></li>\n' +
  '          <li><a href="https://github.com/dikeckaan/swagger-dark-ui/blob/main/LICENSE" rel="noopener">License (ELv2)</a></li>\n' +
  '        </ul>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '    <div class="legal">© 2026 <a href="https://kaandikec.com" rel="noopener">Kaan Dikeç</a> · ' +
  'OASForge — formerly Swagger Dark UI — is an independent open-source project.</div>\n' +
  '  </footer>\n';

index = readDist('app/index.html');
index = mustReplace(index, '</title>',
  '</title>\n' +
  ogTags('OASForge Editor — The OpenAPI Workbench in Your Browser',
    'The OASForge workbench: write, validate, preview and mock OpenAPI documents in your browser.',
    BASE + '/app/') +
  FOOTER_CSS,
  'app head injection');
index = mustReplace(index, /(<\/main>)/, '$1\n' + FOOTER_HTML, 'app footer injection');
writeDist('app/index.html', index);

/* ── 5. Static content pages ───────────────────────────────────────────── */
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site-cf/seo.css'), path.join(DIST, 'assets/seo.css'));
fs.copyFileSync(path.join(ROOT, 'site-cf/og-image.png'), path.join(DIST, 'og-image.png'));
fs.copyFileSync(path.join(ROOT, 'site-cf/app-screenshot.jpg'), path.join(DIST, 'assets/app-screenshot.jpg'));
fs.copyFileSync(path.join(ROOT, 'icons/logo.svg'), path.join(DIST, 'assets/logo.svg'));

const LOGO_SVG = read('icons/logo.svg')
  .replace(/<\?xml[^?]*\?>\s*/, '')
  .replace('<svg ', '<svg width="28" height="28" aria-hidden="true" ');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAV_LINKS =
  '<nav aria-label="Site">' +
  '<a href="/guide/">Guide</a>' +
  '<a href="/faq/">FAQ</a>' +
  '<a href="https://github.com/dikeckaan/swagger-dark-ui" rel="noopener">GitHub</a>' +
  '<a class="cta" href="/app/">Open the editor</a>' +
  '</nav>';

const PAGE_FOOTER = FOOTER_HTML
  .replace('class="sdui-seo-footer"', 'class="site-footer"')
  .replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>');

function layout(p) {
  const url = BASE + '/' + p.slug + '/';
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'OASForge', item: BASE + '/' },
      { '@type': 'ListItem', position: 2, name: p.h1, item: url }
    ]
  };
  return '<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '  <title>' + esc(p.title) + '</title>\n' +
    '  <meta name="description" content="' + esc(p.description) + '" />\n' +
    ogTags(esc(p.title), esc(p.description), url) +
    jsonLdTag(crumbs) +
    (p.jsonLd ? jsonLdTag(p.jsonLd) : '') +
    '  <link rel="icon" href="/assets/logo.svg" type="image/svg+xml" />\n' +
    '  <link rel="stylesheet" href="/assets/seo.css" />\n' +
    '</head>\n<body>\n' +
    '  <header class="site-header">\n' +
    '    <a class="brand" href="/">' + LOGO_SVG + '<span><span style="color:#58a6ff">OAS</span>Forge</span></a>\n' +
    '    ' + NAV_LINKS + '\n' +
    '  </header>\n' +
    '  <main class="content">\n' +
    '    <h1>' + p.h1 + '</h1>\n' +
    p.body + '\n' +
    '    <div class="cta-block">\n' +
    '      <p>No signup, no install — the editor runs entirely in your browser.</p>\n' +
    '      <a class="button" href="/app/">Open the OASForge editor</a>\n' +
    '    </div>\n' +
    '  </main>\n' +
    PAGE_FOOTER +
    '</body>\n</html>\n';
}

for (const p of PAGES) writeDist(p.slug + '/index.html', layout(p));

/* FAQ page — with FAQPage structured data. */
writeDist('faq/index.html', layout({
  slug: 'faq',
  title: 'OASForge FAQ — Privacy, Offline Use, Versions and Licensing',
  description: 'Answers about OASForge: is it free, does your spec stay in the browser, ' +
    'which OpenAPI versions are supported, offline use, Postman import and commercial licensing.',
  h1: 'Frequently asked questions',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  },
  body: FAQ.map(f =>
    '<div class="faq-item"><h2>' + esc(f.q) + '</h2><p>' + esc(f.a) + '</p></div>').join('\n')
}));

/* Guide page — generated from the same SECTIONS the in-app guide renders,
   so the two can never drift apart. */
const guideSrc = readDist('app/js/guide.js');
const m = guideSrc.match(/var SECTIONS = (\[[\s\S]*?\n {2}\]);/);
if (!m) throw new Error('could not extract SECTIONS from js/guide.js');
const kbd = keys => keys.split(' ').map(k => '<kbd>' + k + '</kbd>').join(' + '); // eslint-disable-line
const SECTIONS = eval(m[1]); // trusted local source; kbd() is in scope

writeDist('guide/index.html', layout({
  slug: 'guide',
  title: 'OASForge User Guide — OpenAPI Editor Reference Manual',
  description: 'The complete OASForge reference: workspace, documents, insert menu, autocomplete, ' +
    'validation and quick fixes, search, mock server, importing, history, exporting and shortcuts.',
  h1: 'User guide',
  body:
    '<p>Everything the workbench does, in the order you will meet it. The same guide is available ' +
    'inside the app — press <kbd>F1</kbd> or use the “?” button in the header.</p>' +
    '<ul class="guide-toc">' +
    SECTIONS.map((s, i) =>
      '<li><a href="#' + s.id + '"><span class="num">' + String(i + 1).padStart(2, '0') + '</span>' +
      s.title + '</a></li>').join('') +
    '</ul>' +
    SECTIONS.map((s, i) =>
      '<section class="g-section" id="' + s.id + '"><h2><span class="g-num">' +
      String(i + 1).padStart(2, '0') + '</span>' + s.title + '</h2>' +
      '<div class="table-wrap">' + s.html + '</div></section>').join('\n')
}));

/* ── 6. Landing page at the root ───────────────────────────────────────── */
const HERO_FEATURES = [
  ['Live preview', 'YAML on the left, rendered Swagger UI on the right — updated as you type, with the dark theme the ecosystem never shipped.'],
  ['Version-aware validation', 'Errors and warnings tuned to Swagger 2.0, OpenAPI 3.0, 3.1 and 3.2 — clickable, explained, and most with a one-click Fix.'],
  ['Stateful mock server', 'Try it out without a backend: POST creates records in the page, GET lists them back, schemas become realistic examples.'],
  ['Insert menu', 'A CRUD resource, endpoint, parameter, response, schema or security scheme — inserted correctly indented, in the right section.'],
  ['Context autocomplete', 'Only the keys valid at the cursor, plus live $ref targets and security-scheme names read from your own document.'],
  ['Postman import', 'Drop a collection export and get clean OpenAPI 3: auth mapped, saved responses kept as named examples, noise headers removed.'],
  ['Converters and exports', 'Swagger 2.0 → OpenAPI 3 in one click; export Postman collections or a self-contained HTML docs file.'],
  ['Offline and private', 'No account, no backend — documents stay in your browser. Installable as a PWA, or a single HTML file that runs from disk.']
];

const LEARN_LINKS = [
  ['/openapi-editor/', 'Online OpenAPI editor', 'The writing experience: insert menu, autocomplete, inline rules and search.'],
  ['/openapi-validator/', 'OpenAPI validator', 'What the linter catches and how quick fixes repair a document.'],
  ['/openapi-mock-server/', 'In-browser mock server', 'Stateful Try-it-out with forced status codes and simulated latency.'],
  ['/postman-to-openapi/', 'Postman to OpenAPI', 'How collections become clean OpenAPI 3 — auth, examples, headers.'],
  ['/swagger-editor-alternative/', 'Swagger Editor alternative', 'An honest side-by-side with the original editor.'],
  ['/guide/', 'User guide', 'The complete reference manual, section by section.'],
  ['/faq/', 'FAQ', 'Privacy, versions, offline use and licensing, answered.']
];

const landingTitle = 'OASForge — Free Online OpenAPI Editor, Validator &amp; Mock Server';
writeDist('index.html', '<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head>\n' +
  '  <meta charset="UTF-8" />\n' +
  '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
  '  <title>' + landingTitle + '</title>\n' +
  '  <meta name="description" content="' + esc(DESCRIPTION) + ' Free and open source — no signup, nothing leaves your browser." />\n' +
  ogTags(landingTitle, DESCRIPTION, BASE + '/') +
  jsonLdTag(homeJsonLd) +
  '  <link rel="icon" href="/assets/logo.svg" type="image/svg+xml" />\n' +
  '  <link rel="stylesheet" href="/assets/seo.css" />\n' +
  '</head>\n<body>\n' +
  '  <header class="site-header">\n' +
  '    <a class="brand" href="/">' + LOGO_SVG + '<span><span style="color:#58a6ff">OAS</span>Forge</span></a>\n' +
  '    ' + NAV_LINKS + '\n' +
  '  </header>\n' +
  '  <main class="content landing">\n' +
  '    <section class="hero">\n' +
  '      <h1>The free online OpenAPI editor,<br>validator and mock server — in dark mode</h1>\n' +
  '      <p class="lede">OASForge is a complete OpenAPI workbench that runs entirely in your browser: ' +
  'write YAML beside a live Swagger&nbsp;UI preview, validate with one-click fixes, exercise your API ' +
  'against a built-in mock server, import Postman collections and export documentation — with no ' +
  'account and no backend.</p>\n' +
  '      <div class="hero-ctas">\n' +
  '        <a class="button" href="/app/">Open the editor</a>\n' +
  '        <a class="button ghost" href="/guide/">Read the guide</a>\n' +
  '      </div>\n' +
  '      <p class="hero-note">Free &amp; open source · Nothing leaves your browser · Swagger 2.0, OpenAPI 3.0 / 3.1 / 3.2</p>\n' +
  '    </section>\n' +
  '    <figure class="shot">\n' +
  '      <a href="/app/"><img src="/assets/app-screenshot.jpg" width="2160" height="1320" ' +
  'alt="OASForge workbench: the demo API rendered in dark-mode Swagger UI with operation search" loading="eager" /></a>\n' +
  '    </figure>\n' +
  '    <section>\n' +
  '      <h2>Everything a spec needs, in one tab</h2>\n' +
  '      <div class="feature-grid">\n' +
  HERO_FEATURES.map(f =>
    '        <div class="feature"><h3>' + f[0] + '</h3><p>' + f[1] + '</p></div>').join('\n') + '\n' +
  '      </div>\n' +
  '    </section>\n' +
  '    <section>\n' +
  '      <h2>From blank page to documented API</h2>\n' +
  '      <ol class="steps">\n' +
  '        <li><strong>Bring a document in.</strong> Start from the template, paste YAML or JSON, open a file, ' +
  'fetch a URL, or drop a Postman collection — Swagger 2.0 gets a one-click upgrade to OpenAPI 3.</li>\n' +
  '        <li><strong>Shape it fast.</strong> The insert menu writes correct structure, autocomplete offers only ' +
  'valid keys, and the validator explains every issue with a fix attached.</li>\n' +
  '        <li><strong>Try it and ship it.</strong> Exercise the API against the in-page mock server, then export ' +
  'a Postman collection, standalone HTML docs, or a share link.</li>\n' +
  '      </ol>\n' +
  '    </section>\n' +
  '    <section>\n' +
  '      <h2>Dig deeper</h2>\n' +
  '      <ul class="learn-list">\n' +
  LEARN_LINKS.map(l =>
    '        <li><a href="' + l[0] + '">' + l[1] + '</a><span>' + l[2] + '</span></li>').join('\n') + '\n' +
  '      </ul>\n' +
  '    </section>\n' +
  '    <section>\n' +
  '      <h2>Questions, answered</h2>\n' +
  FAQ.slice(0, 4).map(f =>
    '      <div class="faq-item"><h3>' + esc(f.q) + '</h3><p>' + esc(f.a) + '</p></div>').join('\n') + '\n' +
  '      <p><a href="/faq/">All questions →</a></p>\n' +
  '    </section>\n' +
  '    <div class="cta-block">\n' +
  '      <p>No signup, no install — the editor runs entirely in your browser.</p>\n' +
  '      <a class="button" href="/app/">Open the OASForge editor</a>\n' +
  '    </div>\n' +
  '  </main>\n' +
  PAGE_FOOTER +
  '</body>\n</html>\n');

// Earlier deploys served the app (and registered its service worker) at the
// root scope. This replacement worker cleans those clients up: it drops the
// old caches, unregisters itself and reloads, so visitors get the landing
// page instead of a cached copy of the app.
writeDist('sw.js',
  "'use strict';\n" +
  "self.addEventListener('install', function () { self.skipWaiting(); });\n" +
  "self.addEventListener('activate', function (event) {\n" +
  '  event.waitUntil(caches.keys().then(function (keys) {\n' +
  "    return Promise.all(keys.filter(function (k) { return k.indexOf('sdui-') === 0; })\n" +
  '      .map(function (k) { return caches.delete(k); }));\n' +
  '  }).then(function () {\n' +
  '    return self.registration.unregister();\n' +
  "  }).then(function () {\n" +
  "    return self.clients.matchAll({ type: 'window' });\n" +
  '  }).then(function (clients) {\n' +
  '    clients.forEach(function (c) { c.navigate(c.url); });\n' +
  '  }));\n' +
  '});\n');

/* ── 7. Crawler plumbing ───────────────────────────────────────────────── */
const urls = ['/', '/app/', '/guide/', '/faq/'].concat(PAGES.map(p => '/' + p.slug + '/'));
const today = new Date().toISOString().slice(0, 10);
writeDist('sitemap.xml',
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u =>
    '  <url><loc>' + BASE + u + '</loc><lastmod>' + today + '</lastmod></url>').join('\n') +
  '\n</urlset>\n');

writeDist('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + BASE + '/sitemap.xml\n');

writeDist('404.html', layout({
  slug: '404',
  title: 'Page not found — OASForge',
  description: 'This page does not exist.',
  h1: 'Page not found',
  body: '<p>There is nothing at this address. The editor is at <a href="/">oasforge.dev</a>; ' +
    'the <a href="/guide/">user guide</a> and <a href="/faq/">FAQ</a> may also help.</p>'
}).replace('<head>\n', '<head>\n  <meta name="robots" content="noindex" />\n'));

/* Cache and security headers (Workers static assets honors _headers). */
writeDist('_headers',
  '/app/vendor/*\n  Cache-Control: public, max-age=31536000, immutable\n' +
  '/app/icons/*\n  Cache-Control: public, max-age=86400\n' +
  '/og-image.png\n  Cache-Control: public, max-age=86400\n' +
  '/assets/*\n  Cache-Control: public, max-age=86400\n' +
  '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');

const count = fs.readdirSync(DIST, { recursive: true }).length;
console.log('dist-cf built:', count, 'entries,', urls.length, 'sitemap URLs');

/* OASForge — Cloudflare edition: static SEO content pages.
   Each page becomes /<slug>/index.html in the built dist, wrapped in the
   shared layout by build-cf.js. Content is genuine, feature-accurate prose —
   search engines reward substance, not keyword stuffing. */
'use strict';

const PAGES = [
  {
    slug: 'openapi-editor',
    title: 'Free Online OpenAPI Editor with Dark Mode — OASForge',
    description:
      'Write OpenAPI 3.0, 3.1 and 3.2 specs in a free online editor with live Swagger UI preview, ' +
      'validation, autocomplete and quick fixes. Dark theme, no signup, nothing leaves your browser.',
    h1: 'A free online OpenAPI editor that respects your spec — and your privacy',
    body: `
<p><strong>OASForge</strong> is a browser-based OpenAPI editor with a live, dark-themed
Swagger&nbsp;UI preview beside the code. You write YAML (or JSON) on the left and watch the
rendered documentation update on the right — with validation, context-aware autocomplete and
one-click structure insertion doing the heavy lifting.</p>

<h2>Built for writing specs, not fighting them</h2>
<ul>
  <li><strong>Insert menu</strong> — add a complete CRUD resource, an endpoint, a parameter,
      a request body, a response, a schema or a security scheme with one click. Everything lands
      in the right section with correct indentation, and the placeholder name arrives pre-selected
      so you can type the real one immediately.</li>
  <li><strong>Context-aware autocomplete</strong> — press <kbd>Ctrl</kbd>+<kbd>Space</kbd> and get
      only the keys that are valid at the cursor: operation keys inside <code>get:</code>, schema
      keywords under <code>schema:</code>, media types under <code>content:</code>, and live
      <code>$ref</code> targets read from your own document.</li>
  <li><strong>Inline rule menu</strong> — put the cursor on a property and a small
      “+&nbsp;rule” pill offers the validation keywords that fit its type
      (<code>minLength</code>, <code>pattern</code>, <code>enum</code>, <code>required</code>, …).</li>
  <li><strong>Find and filter</strong> — <kbd>Ctrl</kbd>+<kbd>F</kbd> searches the code; the preview
      has a full-text operation search across paths, parameters, schema properties and status codes.</li>
</ul>

<h2>Every keystroke stays on your machine</h2>
<p>There is no backend and no account. Documents live in your browser’s local storage, snapshots
included. That makes OASForge safe for specs you cannot paste into cloud tools — internal APIs,
pre-release contracts, client work. It even runs from a
<a href="/standalone.html">single offline HTML file</a> with no web server at all.</p>

<h2>All OpenAPI versions, one editor</h2>
<p>OASForge understands Swagger&nbsp;2.0 (with a one-click converter to OpenAPI&nbsp;3),
OpenAPI&nbsp;3.0, 3.1 and 3.2 — and its validation messages are version-aware, so a key that is
valid in 3.1 but unknown in 3.0 is explained rather than just flagged.</p>`
  },
  {
    slug: 'openapi-validator',
    title: 'OpenAPI Validator Online — Version-Aware Linting with Quick Fixes | OASForge',
    description:
      'Validate OpenAPI and Swagger specs in the browser: version-aware errors for 2.0, 3.0, 3.1 ' +
      'and 3.2, clickable issues that jump to the line, and one-click quick fixes.',
    h1: 'Validate OpenAPI documents the way an editor should',
    body: `
<p>Paste or open a spec and OASForge lints it continuously — like Swagger Editor, but with
messages that explain <em>why</em> something is wrong for <em>your</em> spec version, and with
one-click fixes for the common mistakes.</p>

<h2>What the validator catches</h2>
<ul>
  <li>Misplaced and unknown properties, with hints when a key belongs to a different OpenAPI
      version (a Swagger 2.0 key used in 3.x, a 3.1-only keyword in 3.0, and so on)</li>
  <li>Wrong value types — the classic <code>version: 1.0</code> that should be a quoted string</li>
  <li>Security requirements that reference schemes which don’t exist in
      <code>components.securitySchemes</code></li>
  <li>Unresolved <code>$ref</code>s, invalid status codes, <code>example</code>/<code>examples</code>
      conflicts, duplicate server URLs, ignored fixed headers in parameter lists</li>
  <li>Version-specific schema rules: <code>nullable</code> in 3.1+, JSON Schema 2020-12 keywords in
      3.0, <code>exclusiveMinimum</code>/<code>Maximum</code> shape differences between versions</li>
</ul>

<h2>Issues you can act on</h2>
<p>Every issue is clickable and jumps to the offending line. Most carry a <strong>Fix</strong>
button: quote the value, create the missing security scheme, remove the offending property, add the
missing <code>description</code> or <code>responses</code> block. Warnings can be dismissed —
and restored — so noisy-but-known issues don’t bury real ones.</p>

<h2>Versions covered</h2>
<p>Swagger 2.0, OpenAPI 3.0.x, 3.1.x and 3.2.x are all recognized, each validated against its own
allowed keys. Documents with a newer minor version than the editor knows are handled permissively
with an informational note instead of a wall of false errors.</p>`
  },
  {
    slug: 'swagger-editor-alternative',
    title: 'Swagger Editor Alternative — Offline, Dark, with a Mock Server | OASForge',
    description:
      'Looking for a Swagger Editor alternative? OASForge adds a dark theme, an in-browser mock ' +
      'server, Postman import, quick fixes and full offline support — free and open source.',
    h1: 'A modern alternative to Swagger Editor',
    body: `
<p>Swagger Editor defined the category. OASForge keeps what made it great — code on the left,
live rendered docs on the right — and rebuilds the rest for how specs are written today.</p>

<h2>Side by side</h2>
<table>
  <thead><tr><th>Capability</th><th>OASForge</th><th>Swagger Editor</th></tr></thead>
  <tbody>
    <tr><td>Dark theme</td><td>Native, four palettes</td><td>No</td></tr>
    <tr><td>Works fully offline</td><td>Yes — PWA and a single-file build</td><td>Partially</td></tr>
    <tr><td>“Try it out” without a backend</td><td>Yes — built-in stateful mock server</td><td>No</td></tr>
    <tr><td>Quick fixes on validation issues</td><td>Yes, one click</td><td>No</td></tr>
    <tr><td>Postman collection import</td><td>Yes, automatic</td><td>No</td></tr>
    <tr><td>Insert menu for OpenAPI structure</td><td>Yes</td><td>No</td></tr>
    <tr><td>Version history with diff</td><td>Yes, in local storage</td><td>No</td></tr>
    <tr><td>OpenAPI 3.2 awareness</td><td>Yes</td><td>Depends on version</td></tr>
    <tr><td>Account required</td><td>Never</td><td>No</td></tr>
  </tbody>
</table>

<h2>The mock server changes how you demo</h2>
<p>The default server in the preview is an in-browser mock: <code>POST</code> really creates
records (kept in memory), <code>GET</code> lists them back, <code>PUT</code>/<code>PATCH</code>/<code>DELETE</code>
update and remove. Endpoints without stored data answer with schema-derived examples. You can demo
a realistic API flow from a laptop with no network at all.</p>

<h2>Honest limits</h2>
<p>OASForge is a client-side workbench: it does not generate server stubs or client SDKs the way
swagger-codegen integrations do, and very large multi-file specs must be bundled into one document
first. For writing, validating, mocking and sharing a spec, it does more — with nothing to install.</p>`
  },
  {
    slug: 'postman-to-openapi',
    title: 'Convert Postman Collection to OpenAPI 3 Online — Free | OASForge',
    description:
      'Drop a Postman Collection (v2 / v2.1) export into OASForge and get clean OpenAPI 3.0: auth ' +
      'schemes mapped, saved responses converted to named examples, noise headers removed.',
    h1: 'Postman Collection → OpenAPI 3, done properly',
    body: `
<p>Export your collection from Postman (v2 or v2.1), then use <em>Open file</em> or
<em>Load&nbsp;URL</em> in OASForge. The converter detects the collection automatically and produces
an OpenAPI&nbsp;3.0.3 document you can immediately validate, edit and preview.</p>

<h2>What the conversion gets right</h2>
<ul>
  <li><strong>Auth becomes securitySchemes</strong> — Bearer, Basic, API key and OAuth2 (each
      grant type mapped to its OpenAPI flow), with request-level auth taking precedence over
      collection-level, and raw <code>Authorization</code> headers recognized too.</li>
  <li><strong>Saved responses become named examples</strong> — every saved response is kept:
      grouped by status code and media type, single responses as <code>example</code>, multiple as
      named <code>examples</code> entries, so nothing you saved in Postman is lost.</li>
  <li><strong>Noise is removed at the source</strong> — <code>Content-Type</code>,
      <code>Accept</code> and transport headers that OpenAPI ignores are dropped instead of being
      emitted as broken parameters, while meaningful response headers are preserved as
      <code>headers</code> definitions.</li>
  <li><strong>Postman variables survive</strong> — <code>{{baseUrl}}</code>-style variables become
      server variables and path parameters where they belong.</li>
</ul>

<h2>Then keep working in the same tab</h2>
<p>The converted document opens in the editor with validation on: leftover issues surface
immediately, most with one-click fixes. From there you can preview it in Swagger&nbsp;UI, exercise
it against the built-in mock server, or export it back out — including as a self-contained HTML
documentation file.</p>

<p>The conversion runs entirely in your browser: your collection — often full of internal URLs
and tokens — is never uploaded anywhere.</p>`
  },
  {
    slug: 'openapi-mock-server',
    title: 'In-Browser OpenAPI Mock Server — Try It Out Offline | OASForge',
    description:
      'OASForge ships a stateful mock server that runs inside the browser: POST creates records, ' +
      'GET lists them, responses derive from your schemas. No install, no network, no backend.',
    h1: 'A mock server that lives inside the page',
    body: `
<p>Most OpenAPI tools render “Try it out” buttons that fail without a real backend. In OASForge the
default server is a mock implemented in the page itself — requests from Swagger&nbsp;UI are answered
locally, instantly, offline.</p>

<h2>Stateful, not canned</h2>
<ul>
  <li><code>POST</code> to a collection path really creates a record, kept in memory</li>
  <li><code>GET</code> lists what you created; <code>GET /thing/{id}</code> returns that record</li>
  <li><code>PUT</code>/<code>PATCH</code> merge updates; <code>DELETE</code> removes — and a later
      <code>GET</code> honestly 404s</li>
  <li>Endpoints without stored data answer with examples derived from your response schemas
      (<code>$ref</code>s resolved, formats respected)</li>
  <li>Everything else echoes the request back, httpbin-style, so you can inspect what was sent</li>
</ul>

<h2>Testing error paths</h2>
<p>Two request headers steer the mock: <code>X-Mock-Status</code> forces any status code documented
on the operation (test your 400s and 502s without breaking anything), and <code>X-Mock-Delay</code>
adds artificial latency for spinner and timeout testing.</p>

<h2>Why in-browser matters</h2>
<p>Nothing to install, nothing to run, nothing to secure. Spec reviews, client demos, workshops and
interviews all work from a single browser tab — or from the
<a href="/standalone.html">offline single-file build</a> on a machine with no internet at all.
A live httpbin.org server stays selectable when you want to hit something real.</p>`
  }
];

const FAQ = [
  {
    q: 'Is OASForge free?',
    a: 'Yes. The editor, validator, mock server, converters and exporters are all free to use, with no account and no usage limits. The source code is available on GitHub under the Elastic License 2.0.'
  },
  {
    q: 'Does my API spec leave my browser?',
    a: 'No. There is no backend: documents, version history and settings are stored in your browser’s local storage, and the mock server answers requests inside the page. The only network requests are ones you ask for, such as “Load URL” or the live Petstore view.'
  },
  {
    q: 'Which OpenAPI versions are supported?',
    a: 'Swagger 2.0 (with a one-click converter to OpenAPI 3), OpenAPI 3.0.x, 3.1.x and 3.2.x. Validation is version-aware: each document is checked against the keys and rules of its own declared version.'
  },
  {
    q: 'Can I use OASForge offline?',
    a: 'Yes, two ways. The site is an installable PWA that precaches itself and works fully offline after the first visit. There is also standalone.html — the entire app in one file that runs from a double-click, with no web server.'
  },
  {
    q: 'Can I import a Postman collection?',
    a: 'Yes. Open a Postman Collection v2 / v2.1 export via “Open file” or “Load URL” and it is converted to OpenAPI 3.0.3 automatically — auth schemes mapped, saved responses preserved as named examples, transport headers cleaned up.'
  },
  {
    q: 'How is this different from Swagger Editor?',
    a: 'OASForge adds a native dark theme, a stateful in-browser mock server, one-click quick fixes, a structure insert menu, Postman import, local version history with diff, and full offline support — while keeping the familiar code-plus-preview layout.'
  },
  {
    q: 'Can I use it commercially?',
    a: 'Yes — internal tools, client work and embedding are all allowed under the Elastic License 2.0. What is not allowed is offering OASForge itself to third parties as a hosted or managed service, removing the notices, or circumventing license keys.'
  },
  {
    q: 'Who builds OASForge?',
    a: 'OASForge — formerly Swagger Dark UI — is designed, built and maintained by Kaan Dikeç. It is an independent project, not affiliated with SmartBear or the OpenAPI Initiative.'
  }
];

module.exports = { PAGES, FAQ };

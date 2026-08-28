/* OASForge — Cloudflare edition: static SEO content pages.
   Each page becomes /<slug>/index.html in the built dist, wrapped in the
   shared layout by build-cf.js. Content is genuine, feature-accurate prose —
   search engines reward substance, not keyword stuffing. */
'use strict';

const PAGES = [
  {
    slug: 'openapi-editor',
    related: ['openapi-validator', 'openapi-example', 'swagger-ui-dark-theme'],
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
<a href="/standalone.html" download="oasforge-standalone.html">single offline HTML file</a> with no web server at all.</p>

<h2>All OpenAPI versions, one editor</h2>
<p>OASForge understands Swagger&nbsp;2.0 (with a one-click converter to OpenAPI&nbsp;3),
OpenAPI&nbsp;3.0, 3.1 and 3.2 — and its validation messages are version-aware, so a key that is
valid in 3.1 but unknown in 3.0 is explained rather than just flagged.</p>`
  },
  {
    slug: 'openapi-validator',
    related: ['openapi-editor', 'openapi-3-1-vs-3-0', 'swagger-2-to-openapi-3'],
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
    related: ['swagger-ui-dark-theme', 'openapi-mock-server', 'openapi-editor'],
    title: 'Swagger Editor Alternative — Offline, Dark, with a Mock Server | OASForge',
    description:
      'Looking for a Swagger Editor alternative? OASForge adds a dark theme, an in-browser mock ' +
      'server, Postman import, quick fixes and full offline support — free, with public source code.',
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
    related: ['swagger-2-to-openapi-3', 'openapi-editor', 'openapi-mock-server'],
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
    related: ['openapi-editor', 'openapi-example', 'swagger-editor-alternative'],
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
<a href="/standalone.html" download="oasforge-standalone.html">offline single-file build</a> on a machine with no internet at all.
A live httpbin.org server stays selectable when you want to hit something real.</p>`
  },
  {
    slug: 'swagger-ui-dark-theme',
    title: 'Swagger UI Dark Theme — Ready-Made Dark Mode for API Docs | OASForge',
    description:
      'A polished dark theme for Swagger UI with four color palettes, built as CSS design tokens ' +
      'over Swagger UI 5. Use it live in OASForge or take the open-source stylesheet.',
    h1: 'A dark theme Swagger UI never shipped',
    date: '2026-08-27',
    related: ['swagger-editor-alternative', 'openapi-editor', 'openapi-example'],
    body: `
<p>Swagger UI is the de-facto renderer for OpenAPI documentation — and it still has no official
dark mode. OASForge started life as exactly that: a carefully engineered <strong>dark theme for
Swagger&nbsp;UI&nbsp;5</strong>, and grew into a full workbench around it.</p>

<h2>Not a color-inverted hack</h2>
<p>Most dark Swagger themes invert colors or slap a filter on the page, which breaks method badges,
code samples and syntax highlighting. OASForge's theme is built as a
<strong>token-based stylesheet</strong>: every color in Swagger UI's rendering — operation blocks,
schema trees, models, code snippets, "Try it out" forms — maps to a design token, so the dark
palette stays readable and the method colors (GET, POST, DELETE…) keep their meaning.</p>

<h2>Four palettes, light mode included</h2>
<p>The default dark palette follows the GitHub-dark family; <strong>Nord</strong>,
<strong>Dracula</strong> and <strong>Catppuccin</strong> palettes ship alongside it, plus a light
mode toggle. Your choice persists in the browser.</p>

<h2>Use it two ways</h2>
<ul>
  <li><strong>In OASForge:</strong> paste your OpenAPI description into the editor and the preview
      renders in the dark theme immediately — nothing to install.</li>
  <li><strong>In your own docs:</strong> the theme is a plain CSS file
      (<code>css/theme.css</code>) in the
      <a href="https://github.com/dikeckaan/swagger-dark-ui" rel="noopener">source repository</a>,
      written for Swagger UI 5.x and source-available under ELv2 — free to use in your products.</li>
</ul>
<p>The exported standalone HTML docs use the same styling, so documentation you hand to a customer
looks the way it does in the editor.</p>`
  },
  {
    slug: 'openapi-example',
    title: 'OpenAPI Example — Minimal Spec and a Full-Feature 3.1 Demo | OASForge',
    description:
      'A minimal OpenAPI example you can copy, plus a full-feature OpenAPI 3.1 demo spec covering ' +
      'auth, callbacks, webhooks, oneOf/allOf and more — all editable live in the browser.',
    h1: 'OpenAPI examples: a minimal spec and a full-feature demo',
    date: '2026-08-27',
    related: ['openapi-editor', 'openapi-3-1-vs-3-0', 'openapi-validator'],
    body: `
<p>The fastest way to learn OpenAPI is to read working documents. Here is the smallest useful
one — a single <code>GET</code> endpoint returning JSON:</p>

<pre><code>openapi: 3.0.3
info:
  title: My API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /hello:
    get:
      summary: Say hello
      parameters:
        - name: name
          in: query
          schema:
            type: string
      responses:
        '200':
          description: A friendly greeting
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string</code></pre>

<p>Paste it into the <a href="/editor/">OASForge editor</a> and it renders as interactive
documentation instantly — "Try it out" even works, answered by the built-in mock server.</p>

<h2>A full-feature OpenAPI 3.1 example</h2>
<p>For everything past hello-world, OASForge ships a deliberately exhaustive demo: a fictional
e-commerce API written to exercise every construct Swagger UI can render:</p>
<ul>
  <li>All HTTP methods, deprecated operations, external docs</li>
  <li>Path, query, header and cookie parameters with styles (<code>deepObject</code>, <code>pipeDelimited</code>)</li>
  <li>JSON bodies with named examples, form-urlencoded, multipart file upload, XML, plain text</li>
  <li><code>oneOf</code> / <code>anyOf</code> / <code>allOf</code> with discriminators, recursive schemas, <code>readOnly</code>/<code>writeOnly</code></li>
  <li>Callbacks and OpenAPI 3.1 webhooks</li>
  <li>API key, HTTP Basic, Bearer JWT, OAuth 2.0 flows and OpenID Connect security schemes</li>
</ul>
<p>Open the <a href="/app/">demo in the preview</a>, then use <em>Edit a copy</em> to turn it into
your own editable document — the ready-made spec doubles as a starting template.</p>`
  },
  {
    slug: 'openapi-3-1-vs-3-0',
    title: 'OpenAPI 3.1 vs 3.0 — What Changed and How to Migrate | OASForge',
    description:
      'The practical differences between OpenAPI 3.0 and 3.1: JSON Schema 2020-12 alignment, the ' +
      'end of nullable, numeric exclusiveMinimum, webhooks — and how a version-aware validator helps.',
    h1: 'OpenAPI 3.1 vs 3.0: what actually changed',
    date: '2026-08-27',
    related: ['openapi-validator', 'openapi-3-2', 'openapi-example'],
    body: `
<p>OpenAPI 3.1 looks like a minor bump but is the biggest schema change in the specification's
history: the Schema Object became a <strong>full JSON Schema 2020-12 vocabulary</strong> instead of
a modified subset. The differences that bite in practice:</p>

<h2>The changes that matter</h2>
<div class="table-wrap"><table>
  <thead><tr><th>Topic</th><th>OpenAPI 3.0</th><th>OpenAPI 3.1</th></tr></thead>
  <tbody>
    <tr><td>Nullable values</td><td><code>type: string</code> + <code>nullable: true</code></td><td><code>type: [string, "null"]</code> — <code>nullable</code> is gone</td></tr>
    <tr><td>Exclusive bounds</td><td><code>exclusiveMinimum: true</code> (boolean modifier)</td><td><code>exclusiveMinimum: 5</code> (a number itself)</td></tr>
    <tr><td>JSON Schema keywords</td><td>Subset (<code>const</code>, <code>if/then</code>… unavailable)</td><td>Full 2020-12: <code>const</code>, <code>prefixItems</code>, <code>patternProperties</code>, conditionals</td></tr>
    <tr><td>Webhooks</td><td>—</td><td>Top-level <code>webhooks</code> for calls your API makes out</td></tr>
    <tr><td>Root requirements</td><td><code>paths</code> required</td><td>Any of <code>paths</code>, <code>components</code> or <code>webhooks</code> suffices</td></tr>
    <tr><td>License</td><td><code>url</code></td><td><code>identifier</code> (SPDX) as an alternative</td></tr>
  </tbody>
</table></div>

<h2>Migration gotchas</h2>
<p>Tools that "support 3.1" sometimes just relax validation. The classic mistakes when bumping the
version line: leaving <code>nullable</code> in place (ignored in 3.1), keeping boolean
<code>exclusiveMinimum</code>, and assuming every renderer understands 2020-12 keywords.</p>
<p>This is exactly what a version-aware validator is for: OASForge lints the document against the
rules of its <em>declared</em> version — <code>nullable</code> in a 3.1 file gets a warning with
the type-array replacement, a 3.1-only keyword in a 3.0 file offers a one-click version bump, and
the exclusive-bounds shape is checked both ways. Try it by pasting your spec into the
<a href="/editor/">editor</a>.</p>`
  },
  {
    slug: 'openapi-3-2',
    title: 'OpenAPI 3.2 — New Features and Editor Support | OASForge',
    description:
      'OpenAPI 3.2 highlights — $self, the QUERY HTTP method, additionalOperations — and an online ' +
      'editor that validates 3.2 documents today.',
    h1: 'OpenAPI 3.2: the headline changes, supported today',
    date: '2026-08-27',
    related: ['openapi-3-1-vs-3-0', 'openapi-validator', 'openapi-editor'],
    body: `
<p>OpenAPI 3.2 continues the 3.1 line — same JSON Schema 2020-12 foundation — and adds
long-requested expressiveness. The changes you will actually meet in documents:</p>

<h2>What 3.2 adds</h2>
<ul>
  <li><strong><code>$self</code></strong> — a root-level identity URI for the document, making
      cross-document references unambiguous.</li>
  <li><strong>The <code>query</code> HTTP method</strong> — first-class support for the emerging
      QUERY method (safe, idempotent requests with a body), next to <code>get</code>,
      <code>post</code> and friends on a Path Item.</li>
  <li><strong><code>additionalOperations</code></strong> — describe operations for HTTP methods
      beyond the fixed set, keyed by method name.</li>
</ul>
<p>Alongside these come further refinements to tags and media type handling — see the
<a href="https://spec.openapis.org/oas/latest.html" rel="noopener">official specification</a> for
the complete list.</p>

<h2>Editing 3.2 in the browser</h2>
<p>Most online editors still reject <code>openapi: 3.2.0</code> outright. OASForge recognizes it:
the validator accepts <code>$self</code>, <code>query</code> operations and
<code>additionalOperations</code> where they belong, flags them as errors in 3.0/3.1 documents
(with a one-click version bump), and treats unknown future minor versions permissively with an
informational note instead of a wall of false errors. Paste a 3.2 document into the
<a href="/editor/">editor</a> and see.</p>`
  },
  {
    slug: 'swagger-2-to-openapi-3',
    title: 'Convert Swagger 2.0 to OpenAPI 3 Online — Free, In-Browser | OASForge',
    description:
      'Paste a Swagger 2.0 document and convert it to OpenAPI 3 in one click: servers, requestBody, ' +
      'response content, components and $refs all rewritten — entirely in your browser.',
    h1: 'Swagger 2.0 → OpenAPI 3, in one click',
    date: '2026-08-27',
    related: ['postman-to-openapi', 'openapi-validator', 'openapi-3-1-vs-3-0'],
    body: `
<p>Plenty of production APIs still describe themselves in Swagger 2.0. Paste one into OASForge and
a banner offers the conversion; one click later you have an OpenAPI 3 document, converted entirely
client-side — the spec never leaves your browser.</p>

<h2>What the converter rewrites</h2>
<div class="table-wrap"><table>
  <thead><tr><th>Swagger 2.0</th><th>OpenAPI 3</th></tr></thead>
  <tbody>
    <tr><td><code>host</code> + <code>basePath</code> + <code>schemes</code></td><td><code>servers</code> array</td></tr>
    <tr><td><code>in: body</code> parameter</td><td><code>requestBody</code> with media-type content</td></tr>
    <tr><td><code>in: formData</code> parameters</td><td><code>requestBody</code> as form-urlencoded / multipart schema</td></tr>
    <tr><td><code>produces</code> / <code>consumes</code></td><td>Per-response and per-request <code>content</code> maps</td></tr>
    <tr><td><code>definitions</code></td><td><code>components.schemas</code></td></tr>
    <tr><td><code>securityDefinitions</code></td><td><code>components.securitySchemes</code></td></tr>
    <tr><td><code>#/definitions/*</code> refs</td><td>Rewritten to <code>#/components/schemas/*</code></td></tr>
  </tbody>
</table></div>

<h2>Then fix what the converter can't guess</h2>
<p>Conversion is mechanical; intent isn't. After converting, the version-aware validator points out
what needs a human: leftover 2.0-isms are flagged with their modern replacements, and most issues
carry a one-click fix. When you're done, preview the result in Swagger UI, exercise it against the
in-browser mock server, or export it. Start in the <a href="/editor/">editor</a>.</p>`
  },
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
    a: 'OASForge — formerly Swagger Dark UI — is designed, built and maintained by Kaan Dikeç as an independent open-source project.'
  }
];

module.exports = { PAGES, FAQ };

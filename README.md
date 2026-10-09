<div align="center">
  <img src="icons/logo.svg" width="112" alt="OASForge — braces wrapping method-colored API routes" />
  <h1>OASForge</h1>
  <p><strong>The dark-themed OpenAPI workbench — editor, validator, mock server,<br>converters and exporters in a single static page.</strong></p>
  <p>
    Crafted and maintained by <a href="https://kaandikec.com"><strong>Kaan Dikeç</strong></a>
    · <a href="https://github.com/dikeckaan">@dikeckaan</a>
  </p>
  <p>
    <a href="https://oasforge.dev/"><strong>oasforge.dev</strong></a>
    &nbsp;·&nbsp;
    <a href="https://kaandikec.com/swagger-dark-ui/">GitHub Pages mirror</a>
    &nbsp;·&nbsp;
    <a href="https://kaandikec.com/swagger-dark-ui/standalone.html">Single-file offline app</a>
    &nbsp;·&nbsp;
    <a href="#license">License (ELv2)</a>
  </p>
  <p><sub>Formerly <em>Swagger Dark UI</em> — the repository keeps its original name.</sub></p>
</div>

---

**OASForge** (formerly *Swagger Dark UI*) is a dark-themed OpenAPI workbench —
editor, validator, mock server, converters and exporters in a single static
site, deployed to both Cloudflare and GitHub Pages from one build.

## Features

- 🌗 **Dark theme by default**, with a light-mode toggle and four color palettes (Default, Nord, Dracula, Catppuccin) — all persisted in `localStorage`
- 🔀 **Spec switcher** — flip between the full-feature demo API and the live Swagger Petstore (shareable via `?spec=` URL parameter)
- ✏️ **Bring your own APIs** — a built-in split-pane YAML editor with live preview: multiple named specs, open local files, fetch from a URL (CORS required), download, JSON↔YAML conversion, `Cmd/Ctrl+S` to save and `Cmd/Ctrl+Enter` to render
- ➕ **Insert menu** — build a spec without memorizing OpenAPI structure (`js/snippets.js`): one click inserts a full CRUD resource, a new endpoint (GET/POST/PUT/PATCH/DELETE), an operation on the path under the cursor, parameters, request bodies, responses, schemas, security schemes, servers or tags — indentation-aware, placed in the right section, with the placeholder name pre-selected for renaming
- 🔍 **Search everywhere** — `Ctrl/Cmd+F` opens an in-editor find bar (`js/findbar.js`: live highlights, i/N counter, Enter/Shift+Enter cycling), and the preview's old tag-only filter is replaced by a full-text operation search (`js/opsearch.js`) that indexes the parsed spec — paths, methods, summaries, descriptions, parameter names, schema property names and enum values ($refs resolved), status codes, security scheme names — and filters the rendered operations live with AND terms
- 🎛️ **Inline rule menu** — put the cursor on a schema property, component schema, or parameter and a "＋ rule" pill appears (`js/constraints.js`): it offers the validation keywords that fit the value's type (`minLength`, `pattern`, `minimum`, `enum`, `required`, …) and inserts them in the right place — `required` lands in the parent schema's list, parameter rules go into its `schema:` (created on demand)
- 🩺 **OpenAPI validation with quick fixes** — the editor lints your document like Swagger Editor does (`js/validate.js`): misplaced/unknown properties, wrong value types (`version: 1.0` vs `"1.0"`), security requirements without a matching scheme, unresolved `$ref`s, invalid status codes, `example`/`examples` conflicts and more — each issue is clickable and jumps to the offending line, while the preview keeps rendering. Most issues carry a one-click **Fix** button (`js/quickfix.js`): quote the value, create the missing security scheme, remove the offending property, add the missing `description`/`responses`, …
- ⌨️ **Context-aware autocomplete** (`js/autocomplete.js`) — type (or press `Ctrl+Space`) and get the OpenAPI keys valid *right there*: operation keys inside `get:`, parameter keys inside a `- name:` item, schema keywords under `schema:`, media types under `content:`, quoted status codes under `responses:`, plus value completions for `in:`/`type:`/`format:`/`style:` and live `$ref:` targets and security-scheme names read from your own document
- 🧪 **Example generator** — one Insert-menu click derives an `example:` block from the schema under the cursor ($refs resolved), reusing the mock server's schema→example engine
- 🔁 **Swagger 2.0 → OpenAPI 3 converter** (`js/convert20.js`) — paste a 2.0 document and a banner offers one-click conversion: servers from `host`/`basePath`/`schemes`, `body`/`formData` parameters → `requestBody`, `produces` → response `content`, `definitions`/`securityDefinitions` → `components`, full `$ref` rewrite
- 🕒 **Version history** (`js/history.js`) — automatic (rate-limited) and manual snapshots per spec, stored compressed in `localStorage`; restore any snapshot or view a color-coded line diff against the current text
- 📤 **Export** (`js/export.js`) — download the current spec as a **Postman Collection v2.1** (folders per tag, path/query/header params, example request bodies, auth mapping) or as **standalone HTML docs**: a single self-contained file with Swagger UI inlined that opens offline from disk
- 🔥 **JMeter scenario generator** (`js/jmeter.js`, `js/jmeter-wizard.js`, `js/apigee.js`) — a six-step wizard turns the spec into a ready-to-run **Apache JMeter 5.4.3** plan that *grades itself*. Tell it what limits the API — paste an **Apigee Edge Quota / SpikeArrest policy** as-is (count, window type, identifier, Distributed/Synchronous accuracy, message processors and fault codes are read from the XML), state a limit you know, ask it to find one, or just load — and it derives the scenarios worth proving: walk up to the quota and over it, another caller is not affected, wait for the window and prove it resets, hold a rate under/over the quota, spike-arrest bursts and paced runs, a staircase. Each scenario is its own thread group, run one after another; the token is fetched **once** in a setUp group (OAuth 2 `tokenUrl` pre-filled, Basic client credentials, `expires_in` honoured) and a tearDown group writes one `VERDICT` line per scenario — PASS or FAIL against the configuration — on the console and in the `.jtl`
- 🔌 **Fully offline** — all third-party assets are vendored (`vendor/`, hash-verified against the previously pinned SRI values), so the site, the Docker image and exported docs work with no internet at all
- 📋 **Edit a copy** — one click turns the demo API or Petstore into an editable copy in the editor (converted to tidy YAML), so the ready-made specs double as starting templates
- 📮 **Postman import** — drop a Postman Collection (v2 / v2.1+) export into *Open file* or *Load URL* and it is converted to OpenAPI 3 automatically (`js/postman.js`)
- 🔗 **Share specs by link** — the *Share* button packs the current spec into a compressed URL hash (lz-string); no backend involved
- ⚡ **"Try it out" really works — offline and stateful** — the default server is an in-browser mock (`js/mock.js`): `POST` really creates records (kept in memory), `GET` lists them, `PUT`/`PATCH`/`DELETE` update and remove; endpoints without stored data return schema-derived examples, the rest echo the request httpbin-style. `X-Mock-Status` forces a documented status code, `X-Mock-Delay` simulates latency. A live [httpbin.org](https://httpbin.org) server stays selectable, and Petstore runs against the live `petstore3.swagger.io` server
- 🧾 **Request snippets** — every operation shows ready-to-copy cURL (bash/PowerShell/CMD), JavaScript `fetch`, and Python `requests` code
- 📲 **Installable app (PWA)** — a web app manifest plus a service worker make the site installable from the browser; the installed app runs in its own window and works fully offline (the whole app is precached on first visit and silently refreshed on later loads)
- 📦 **Zero build step** — plain HTML/CSS/JS; third-party libraries are pinned, hash-verified copies in `vendor/` (see `vendor/README.md`)

## What the demo spec covers

The custom [`specs/demo-api.yaml`](specs/demo-api.yaml) (OpenAPI 3.1) exercises
everything Swagger UI knows how to render:

| Area | Features |
| --- | --- |
| Operations | GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, deprecated operations, external docs |
| Parameters | path / query / header / cookie; `form`, `pipeDelimited`, `deepObject` styles |
| Request bodies | JSON with named examples, form-urlencoded, multipart file upload, XML, plain text |
| Schemas | `oneOf` / `anyOf` / `allOf` + discriminator, recursion, `readOnly` / `writeOnly`, 3.1 nullable types, `const`, `additionalProperties` |
| Responses | Multiple status codes, response headers, content negotiation, links, binary downloads |
| Async | Callbacks and OpenAPI 3.1 webhooks |
| Security | API key (header/query/cookie), HTTP Basic, Bearer JWT, OAuth 2.0 flows, OpenID Connect |
| Extras | Server variables, rich Markdown descriptions, tag external docs |

## Run locally

No dependencies — any static file server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Single-file offline app (no server at all)

Download **[standalone.html](https://kaandikec.com/swagger-dark-ui/standalone.html)**
— the entire app in one file. Double-click it and it runs from `file://`:
no web server, no network, nothing else to install. Every script, style,
vendored library and the demo spec are inlined; the in-browser mock keeps
"Try it out" working. The file is rebuilt by the Pages workflow on every
deploy (`build-standalone.js`), so the download is always current with the
mirror.

### Run with Docker

```bash
docker compose up          # → http://localhost:8080
# or without compose:
docker build -t swagger-dark-ui .
docker run --rm -p 8080:80 swagger-dark-ui
```

The container serves the site with nginx and works **fully offline** — all
third-party assets (Swagger UI, CodeMirror, js-yaml, lz-string) are vendored
in `vendor/`, so no internet access is needed on either side. Only the
optional live Petstore spec view requires connectivity.

## Project structure

```
├─ index.html                    # Shell: header, spec selector, theme toggle
├─ css/theme.css                 # Token-based dark/light theme for Swagger UI 5.x
├─ js/app.js                     # Swagger UI init, spec switcher, theme persistence
├─ js/validate.js                # OpenAPI linter for the YAML editor (issues panel)
├─ js/quickfix.js                # One-click fixes for linter issues
├─ js/constraints.js             # Inline "+ rule" menu for the field under the cursor
├─ js/snippets.js                # "+ Insert" menu: OpenAPI building-block templates
├─ js/autocomplete.js            # Context-aware OpenAPI autocomplete ($ref picker incl.)
├─ js/convert20.js               # Swagger 2.0 → OpenAPI 3.0 converter
├─ js/history.js                 # Snapshot history with restore + line diff
├─ js/export.js                  # Postman collection & standalone-HTML exporters
├─ js/apigee.js                  # Apigee Edge Quota / SpikeArrest policy reader
├─ js/jmeter.js                  # JMeter scenario model + self-grading .jmx builder
├─ js/jmeter-wizard.js           # The six-step JMeter scenario wizard
├─ vendor/                       # Vendored Swagger UI / CodeMirror / js-yaml / lz-string
├─ Dockerfile / docker-compose.yml  # Optional: serve the site locally with nginx (offline)
├─ specs/demo-api.yaml           # Comprehensive OpenAPI 3.1 demo spec
├─ .github/workflows/build.yml   # Same build on every branch → checked, kept as artifacts
├─ .github/workflows/deploy-cf.yml  # oasforge.dev (Cloudflare) — main only
└─ .github/workflows/deploy.yml  # GitHub Pages mirror — the branch you choose
```

## Deployment

Both deployments publish the **same build** (`build-cf.js`: landing page at
the root, the app at `/app/`, static `/guide/`, `/faq/` and landing pages,
`sitemap.xml`, `robots.txt`, cache headers and the single-file
`standalone.html`), from different branches:

- **Cloudflare** ([oasforge.dev](https://oasforge.dev/)) — **`main` only.**
  The [Cloudflare workflow](.github/workflows/deploy-cf.yml) builds `dist-cf/`
  on every push to `main` and deploys it with Wrangler as an **assets-only
  Worker** (static asset requests are free and unmetered on every Workers
  plan). No other branch ever touches the Worker. A no-op until the
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are
  set (or connect the repo to Cloudflare Workers Builds instead).
- **GitHub Pages mirror** (`kaandikec.com/swagger-dark-ui`) — **the branch
  you choose, built like oasforge.dev.** The
  [Pages workflow](.github/workflows/deploy.yml) runs the same script with
  `--base /swagger-dark-ui --out dist-pages` so internal links carry the
  sub-path prefix, and force-pushes the result (landing page at the root,
  the app under `/app/`, guides, `standalone.html`) to the `gh-pages`
  branch as one orphan commit; GitHub publishes that branch. Pages must
  therefore be set to *Deploy from a branch → gh-pages / (root)* — the
  workflow sets this itself when its token may, and tells you in the job
  summary otherwise. (Serving a source branch directly shows the bare app
  with no landing page.) Pick the branch with *Actions → Deploy to GitHub
  Pages → Run workflow* (the branch in the dropdown, or the `branch`
  input): it is built at once and its name is written to `.source-branch`
  on `gh-pages`, so every later push to that branch redeploys the mirror
  until another branch is chosen. With no choice made the mirror
  follows `main`; pushes to any other branch leave it alone. Canonical URLs
  point at oasforge.dev, so search signals consolidate on the primary
  domain.
- **Every branch** — the [build workflow](.github/workflows/build.yml)
  runs both of the builds above on each push (and on pull requests), checks
  the output, and keeps `dist-cf/`, `dist-pages/` and `standalone.html` as
  workflow artifacts for 7 days. It deploys nothing.

## Author

**OASForge** — formerly *Swagger Dark UI* — is designed, built and maintained by
**[Kaan Dikeç](https://kaandikec.com)** ([@dikeckaan](https://github.com/dikeckaan)) —
from the dark theme and the demo spec to the in-browser validator, mock server
and converters. Feedback, ideas and bug reports are always welcome via
[issues](https://github.com/dikeckaan/swagger-dark-ui/issues).

<p align="center">
  <img src="icons/logo.svg" width="40" alt="" /><br>
  <sub>© 2026 Kaan Dikeç · <a href="https://kaandikec.com">kaandikec.com</a></sub>
</p>

## License

[Elastic License 2.0](LICENSE) (ELv2) — free to use, copy, modify, distribute
and **use commercially** (internal tools, client projects, embedding in your
own products), with three limitations:

1. you may **not offer the software itself to third parties as a hosted or
   managed service** (e.g. selling access to this editor as a SaaS),
2. you may not circumvent any license-key functionality,
3. you may not remove or obscure the licensing/copyright notices.

Third-party assets in [`vendor/`](vendor/README.md) keep their own upstream
licenses (Apache-2.0 / MIT) and are not covered by ELv2.

<div align="center">
  <img src="icons/logo.svg" width="112" alt="Swagger Dark UI — braces wrapping method-colored API routes" />
  <h1>Swagger Dark UI</h1>
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
  <p><sub>The hosted edition is <strong>OASForge</strong> — this repository is its source.</sub></p>
</div>

---

A polished, **dark-themed Swagger UI showcase** that demonstrates every feature
Swagger UI can render — deployed as a fully static site on GitHub Pages, and
grown into a complete OpenAPI authoring environment.

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
push to `main` (`build-standalone.js`), so the download is always current
with the live site.

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
├─ vendor/                       # Vendored Swagger UI / CodeMirror / js-yaml / lz-string
├─ Dockerfile / docker-compose.yml  # Optional: serve the site locally with nginx (offline)
├─ specs/demo-api.yaml           # Comprehensive OpenAPI 3.1 demo spec
└─ .github/workflows/deploy.yml  # GitHub Pages deployment
```

## Deployment

Two deployments run from the same source, both on every push to `main`:

- **GitHub Pages** — the [Pages workflow](.github/workflows/deploy.yml) publishes
  the repository root (plus the freshly built `standalone.html`) to
  `kaandikec.com/swagger-dark-ui`.
- **OASForge on Cloudflare** ([oasforge.dev](https://oasforge.dev/)) — the
  [Cloudflare workflow](.github/workflows/deploy-cf.yml) runs `build-cf.js`,
  which produces `dist-cf/`: the same app rebranded to OASForge with an
  SEO-optimized shell — canonical/Open Graph/JSON-LD metadata, static
  `/guide/`, `/faq/` and landing pages, `sitemap.xml`, `robots.txt` and cache
  headers — and deploys it with Wrangler as an **assets-only Worker**
  (static asset requests are free and unmetered on every Workers plan).
  The workflow is a no-op until the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` repository secrets are set; the custom-domain
  routes live in [`wrangler.jsonc`](wrangler.jsonc).

## Author

**Swagger Dark UI** is designed, built and maintained by
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

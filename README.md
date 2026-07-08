# 🌙 Swagger Dark UI

A polished, **dark-themed Swagger UI showcase** that demonstrates every feature
Swagger UI can render — deployed as a fully static site on GitHub Pages.

**Live demo → https://kaandikec.com/swagger-dark-ui/**

## Features

- 🌗 **Dark theme by default**, with a light-mode toggle and four color palettes (Default, Nord, Dracula, Catppuccin) — all persisted in `localStorage`
- 🔀 **Spec switcher** — flip between the full-feature demo API and the live Swagger Petstore (shareable via `?spec=` URL parameter)
- ✏️ **Bring your own APIs** — a built-in split-pane YAML editor with live preview: multiple named specs, open local files, fetch from a URL (CORS required), download, JSON↔YAML conversion, `Cmd/Ctrl+S` to save and `Cmd/Ctrl+Enter` to render
- 📋 **Edit a copy** — one click turns the demo API or Petstore into an editable copy in the editor (converted to tidy YAML), so the ready-made specs double as starting templates
- 📮 **Postman import** — drop a Postman Collection (v2 / v2.1+) export into *Open file* or *Load URL* and it is converted to OpenAPI 3 automatically (`js/postman.js`)
- 🔗 **Share specs by link** — the *Share* button packs the current spec into a compressed URL hash (lz-string); no backend involved
- ⚡ **"Try it out" really works — offline and stateful** — the default server is an in-browser mock (`js/mock.js`): `POST` really creates records (kept in memory), `GET` lists them, `PUT`/`PATCH`/`DELETE` update and remove; endpoints without stored data return schema-derived examples, the rest echo the request httpbin-style. `X-Mock-Status` forces a documented status code, `X-Mock-Delay` simulates latency. A live [httpbin.org](https://httpbin.org) server stays selectable, and Petstore runs against the live `petstore3.swagger.io` server
- 🧾 **Request snippets** — every operation shows ready-to-copy cURL (bash/PowerShell/CMD), JavaScript `fetch`, and Python `requests` code
- 📦 **Zero build step** — plain HTML/CSS/JS with pinned, SRI-verified CDN assets

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

## Project structure

```
├─ index.html                    # Shell: header, spec selector, theme toggle
├─ css/theme.css                 # Token-based dark/light theme for Swagger UI 5.x
├─ js/app.js                     # Swagger UI init, spec switcher, theme persistence
├─ specs/demo-api.yaml           # Comprehensive OpenAPI 3.1 demo spec
└─ .github/workflows/deploy.yml  # GitHub Pages deployment
```

## Deployment

Every push to `main` triggers the [Pages workflow](.github/workflows/deploy.yml),
which publishes the repository root as a static site.

## License

MIT

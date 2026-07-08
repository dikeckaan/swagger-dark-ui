# 🌙 Swagger Dark UI

A polished, **dark-themed Swagger UI showcase** that demonstrates every feature
Swagger UI can render — deployed as a fully static site on GitHub Pages.

**Live demo → https://kaandikec.com/swagger-dark-ui/**

## Features

- 🌗 **Dark theme by default**, with a light-mode toggle (preference persisted in `localStorage`)
- 🔀 **Spec switcher** — flip between the full-feature demo API and the live Swagger Petstore (shareable via `?spec=` URL parameter)
- ✏️ **Bring your own API** — a built-in split-pane YAML editor with live preview: paste or type a spec, open a local file, fetch one from a URL (CORS required), download your work; edits persist in `localStorage`
- ⚡ **"Try it out" really works — offline** — the default server is an in-browser mock (`js/mock.js`) that answers requests locally: operations with documented response schemas return schema-derived examples, the rest echo the request httpbin-style. A live [httpbin.org](https://httpbin.org) server stays selectable in the Servers dropdown, and Petstore runs against the live `petstore3.swagger.io` server
- 📦 **Zero build step** — plain HTML/CSS/JS with a pinned, SRI-verified `swagger-ui-dist` from CDN

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

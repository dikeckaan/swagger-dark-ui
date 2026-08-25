#!/usr/bin/env node
/* Builds standalone.html — the whole app in ONE file that runs from file://
   with no web server: every stylesheet and script is inlined, and the files
   the app fetches at runtime (demo spec, example payloads, vendor assets used
   by the standalone-docs exporter) are embedded behind a fetch shim.
   Zero dependencies; run with:  node build-standalone.js  */
'use strict';

const fs = require('fs');
const path = require('path');

// Optional overrides so other builds (e.g. build-cf.js) can run this against
// a prepared copy of the site:  node build-standalone.js --root DIR --out FILE
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? path.resolve(argv[i + 1]) : dflt;
};
const ROOT = opt('--root', __dirname);
const OUT = opt('--out', path.join(ROOT, 'standalone.html'));

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Two sequences break inline <script> content: "</script" ends the tag, and
// "<!--" switches the HTML parser into the script-data-escaped state (where a
// later "<script" makes it swallow the real closing tag). Both escapes are
// identity escapes — valid inside JS strings AND regexes alike.
const js = s => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = read('index.html');

// The PWA pieces don't apply to a single local file.
html = html
  .replace(/^\s*<!-- The canonical home[\s\S]*?-->\n/m, '')
  .replace(/^\s*<link rel="canonical"[^>]*\/>\n/m, '')
  .replace(/^\s*<link rel="manifest"[^>]*\/>\n/m, '')
  .replace(/^\s*<link rel="apple-touch-icon"[^>]*\/>\n/m, '')
  .replace(/  <script>\n    \/\/ Installable app[\s\S]*?<\/script>\n/, '');

// Inline every stylesheet and script the page references.
html = html.replace(/^(\s*)<link rel="stylesheet" href="([^"]+)" \/>$/gm,
  (m, indent, href) => indent + '<style>\n' + read(href) + '\n' + indent + '</style>');
html = html.replace(/^(\s*)<script src="([^"]+)"><\/script>$/gm,
  (m, indent, src) => indent + '<script>\n' + js(read(src)) + '\n' + indent + '</script>');

// Runtime-fetched files, served from memory by a fetch shim. Installed
// before mock.js loads, so the mock's captured "real fetch" delegates here.
const EMBED = [
  'specs/demo-api.yaml',
  'specs/examples/openid-configuration.json',
  'specs/examples/user-external.json',
  'vendor/swagger-ui.css',        // used by the standalone-docs exporter
  'vendor/swagger-ui-bundle.js'
];
const files = {};
for (const f of EMBED) files[f] = read(f);

const shim =
  '  <script>\n' +
  '    // Standalone build: serve runtime-fetched files from memory so the\n' +
  '    // app works from file:// without a web server.\n' +
  '    (function () {\n' +
  '      var FILES = ' + js(JSON.stringify(files)) + ';\n' +
  '      var real = window.fetch.bind(window);\n' +
  '      window.fetch = function (input, init) {\n' +
  "        var url = (typeof input === 'string' ? input : (input && input.url) || '').split('?')[0];\n" +
  '        for (var key in FILES) {\n' +
  "          if (url === key || url === './' + key || url.slice(-key.length - 1) === '/' + key) {\n" +
  '            return Promise.resolve(new Response(FILES[key], {\n' +
  "              status: 200, headers: { 'Content-Type': 'text/plain' }\n" +
  '            }));\n' +
  '          }\n' +
  '        }\n' +
  '        return real(input, init);\n' +
  '      };\n' +
  '    })();\n' +
  '  </script>\n';

// The shim must precede the app's own modules (mock.js wraps fetch on load).
// Function replacement — the embedded code is full of "$'"/"$`" sequences
// that a string replacement would expand into copies of the document.
html = html.replace(/^\s*<script>\n\/\* Swagger Dark UI — lightweight OpenAPI linter/m,
  match => shim + match);
if (html.indexOf('FILES = ') === -1) {
  throw new Error('failed to inject the fetch shim before the app scripts');
}

const stamp = (process.env.GITHUB_SHA || 'local').slice(0, 12);
html = html.replace('</title>', ' (standalone)</title>');
html += '<!-- standalone build ' + stamp + ' ' + new Date().toISOString() + ' -->\n';

fs.writeFileSync(OUT, html);
console.log('standalone.html written:', (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'MB');

/* Swagger Dark UI — exporters for the YAML editor.
   "Export" dropdown: the current OpenAPI 3 document as a Postman
   Collection v2.1 (folders per tag, auth mapping, example bodies, saved
   responses rebuilt from response examples), or as a standalone single-file
   HTML documentation page with Swagger UI inlined from the vendored assets.
   Documents that were imported from a Postman collection can alternatively
   be MERGED back into the original collection: spec edits are applied to
   the matching requests while Postman-only data the spec cannot represent
   (scripts, settings, extra variables) is preserved. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  var STATUS_TEXT = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 409: 'Conflict', 410: 'Gone', 415: 'Unsupported Media Type',
    422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function deref(doc, node) {
    if (isObj(node) && typeof node.$ref === 'string' && node.$ref.slice(0, 2) === '#/') {
      var cur = doc;
      var parts = node.$ref.slice(2).split('/');
      for (var i = 0; i < parts.length && cur; i++) {
        cur = cur[parts[i].replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      return cur || {};
    }
    return node;
  }

  function exampleFor(doc, schema) {
    if (!schema) return undefined;
    if (window.SduiMock && SduiMock.exampleFromSchema) {
      return SduiMock.exampleFromSchema(schema, doc);
    }
    return undefined;
  }

  /* ----- Postman Collection v2.1 ----- */

  /* Maps an OpenAPI security requirement list (doc.security or op.security)
     to a Postman auth block. An explicit empty list means "no auth". */
  function authFor(doc, security) {
    if (!Array.isArray(security)) return null;
    if (!security.length) return { type: 'noauth' };
    var schemes = (doc.components && doc.components.securitySchemes) || {};
    var name = Object.keys(security[0] || {})[0];
    var scheme = name && deref(doc, schemes[name]);
    if (!isObj(scheme)) return null;

    if (scheme.type === 'http' && scheme.scheme === 'basic') {
      return { type: 'basic', basic: [] };
    }
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      return { type: 'bearer', bearer: [{ key: 'token', value: '{{bearerToken}}', type: 'string' }] };
    }
    if (scheme.type === 'apiKey') {
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: scheme.name || 'X-API-Key', type: 'string' },
          { key: 'value', value: '{{apiKey}}', type: 'string' },
          { key: 'in', value: scheme.in === 'query' ? 'query' : 'header', type: 'string' }
        ]
      };
    }
    if (scheme.type === 'oauth2' && isObj(scheme.flows)) {
      var flows = scheme.flows;
      var flowName = Object.keys(flows)[0];
      var flow = flows[flowName] || {};
      var GRANTS = {
        authorizationCode: 'authorization_code',
        clientCredentials: 'client_credentials',
        password: 'password_credentials',
        implicit: 'implicit'
      };
      var fields = [{ key: 'grant_type', value: GRANTS[flowName] || 'authorization_code', type: 'string' }];
      if (flow.tokenUrl) fields.push({ key: 'accessTokenUrl', value: flow.tokenUrl, type: 'string' });
      if (flow.authorizationUrl) fields.push({ key: 'authUrl', value: flow.authorizationUrl, type: 'string' });
      var reqScopes = Array.isArray((security[0] || {})[name]) && (security[0] || {})[name].length
        ? (security[0] || {})[name] : Object.keys(flow.scopes || {});
      if (reqScopes.length) fields.push({ key: 'scope', value: reqScopes.join(' '), type: 'string' });
      return { type: 'oauth2', oauth2: fields };
    }
    return null;
  }

  function postmanBody(doc, requestBody) {
    var rb = deref(doc, requestBody);
    if (!isObj(rb) || !isObj(rb.content)) return null;
    var mimes = Object.keys(rb.content);
    var jsonMime = mimes.filter(function (m) { return /json/.test(m); })[0];
    var mime = jsonMime || mimes[0];
    if (!mime) return null;
    var mt = rb.content[mime] || {};
    var schema = mt.schema && deref(doc, mt.schema);
    var example = mt.example !== undefined ? mt.example
      : (isObj(mt.examples) && Object.keys(mt.examples).length
        ? (deref(doc, mt.examples[Object.keys(mt.examples)[0]]) || {}).value
        : exampleFor(doc, mt.schema));

    if (/x-www-form-urlencoded/.test(mime)) {
      var fields = [];
      var props = (schema && schema.properties) || {};
      Object.keys(props).forEach(function (k) {
        var v = exampleFor(doc, props[k]);
        fields.push({ key: k, value: v === undefined ? '' : String(v), type: 'text' });
      });
      return { mode: 'urlencoded', urlencoded: fields };
    }
    if (/multipart/.test(mime)) {
      var formdata = [];
      var mprops = (schema && schema.properties) || {};
      Object.keys(mprops).forEach(function (k) {
        var prop = deref(doc, mprops[k]) || {};
        formdata.push(prop.format === 'binary'
          ? { key: k, type: 'file', src: [] }
          : { key: k, value: String(exampleFor(doc, prop) || ''), type: 'text' });
      });
      return { mode: 'formdata', formdata: formdata };
    }
    return {
      mode: 'raw',
      raw: example === undefined ? '{}' : JSON.stringify(example, null, 2),
      options: { raw: { language: jsonMime ? 'json' : 'text' } }
    };
  }

  function bodyString(value) {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  /* Rebuilds Postman saved responses from the operation's response examples
     (single `example` values and named `examples` alike), so a collection
     that was imported with saved responses round-trips with them intact. */
  function savedResponses(doc, op, request) {
    var out = [];
    var responses = isObj(op.responses) ? op.responses : {};
    Object.keys(responses).forEach(function (codeKey) {
      var resp = deref(doc, responses[codeKey]);
      if (!isObj(resp)) return;
      var code = /^\d+$/.test(codeKey) ? parseInt(codeKey, 10) : 200;
      var status = (resp.description && resp.description !== STATUS_TEXT[code] ? resp.description : null)
        || STATUS_TEXT[code] || 'OK';
      var headers = [];
      Object.keys(resp.headers || {}).forEach(function (h) {
        var hd = deref(doc, resp.headers[h]) || {};
        var v = hd.example !== undefined ? hd.example
          : (hd.schema && hd.schema.example !== undefined ? hd.schema.example : '');
        headers.push({ key: h, value: String(v) });
      });
      Object.keys(resp.content || {}).forEach(function (mime) {
        var mt = resp.content[mime] || {};
        var lang = /json/.test(mime) ? 'json' : (/xml|html/.test(mime) ? 'xml' : 'text');
        var mimeHeader = [{ key: 'Content-Type', value: mime }].concat(headers);
        if (isObj(mt.examples)) {
          Object.keys(mt.examples).forEach(function (exName) {
            var ex = deref(doc, mt.examples[exName]) || {};
            if (ex.value === undefined) return;
            out.push({
              name: ex.summary || exName,
              originalRequest: clone(request),
              status: String(status), code: code,
              _postman_previewlanguage: lang,
              header: mimeHeader, cookie: [],
              body: bodyString(ex.value)
            });
          });
        } else if (mt.example !== undefined) {
          out.push({
            name: codeKey + ' ' + (STATUS_TEXT[code] || ''),
            originalRequest: clone(request),
            status: String(status), code: code,
            _postman_previewlanguage: lang,
            header: mimeHeader, cookie: [],
            body: bodyString(mt.example)
          });
        }
      });
    });
    return out;
  }

  function postmanRequest(doc, pathName, method, op, sharedParams) {
    var params = (sharedParams || []).concat(Array.isArray(op.parameters) ? op.parameters : [])
      .map(function (p) { return deref(doc, p); })
      .filter(isObj);

    var headers = [];
    var query = [];
    var variables = [];
    params.forEach(function (p) {
      var value = p.example !== undefined ? p.example : exampleFor(doc, p.schema);
      var str = value === undefined ? '' : String(value);
      if (p.in === 'header') headers.push({ key: p.name, value: str, description: p.description || undefined });
      if (p.in === 'query') query.push({ key: p.name, value: str, description: p.description || undefined, disabled: p.required !== true });
      if (p.in === 'path') variables.push({ key: p.name, value: str, description: p.description || undefined });
    });

    var segments = pathName.split('/').filter(Boolean).map(function (seg) {
      var m = seg.match(/^\{(.+)\}$/);
      return m ? ':' + m[1] : seg;
    });

    var url = {
      raw: '{{baseUrl}}/' + segments.join('/'),
      host: ['{{baseUrl}}'],
      path: segments
    };
    if (query.length) {
      url.query = query;
      url.raw += '?' + query.map(function (q) { return q.key + '=' + q.value; }).join('&');
    }
    if (variables.length) url.variable = variables;

    var request = {
      method: method.toUpperCase(),
      header: headers,
      url: url
    };
    if (op.description || op.summary) request.description = op.description || op.summary;
    var body = op.requestBody && postmanBody(doc, op.requestBody);
    if (body) {
      request.body = body;
      if (body.mode === 'raw' && body.options.raw.language === 'json') {
        request.header = headers.concat([{ key: 'Content-Type', value: 'application/json' }]);
      }
    }
    var auth = authFor(doc, op.security);
    if (auth) request.auth = auth;

    var item = {
      name: op.summary || op.operationId || method.toUpperCase() + ' ' + pathName,
      request: request
    };
    var responses = savedResponses(doc, op, request);
    if (responses.length) item.response = responses;
    return item;
  }

  function toPostman(doc) {
    if (!isObj(doc) || !isObj(doc.paths)) throw new Error('the document has no paths');
    var server = Array.isArray(doc.servers) && doc.servers[0] && doc.servers[0].url
      ? doc.servers[0].url.replace(/\/$/, '') : 'http://localhost';
    var folders = {}; // tag -> items
    var rootItems = [];

    Object.keys(doc.paths).forEach(function (pathName) {
      var item = doc.paths[pathName];
      if (!isObj(item)) return;
      var shared = Array.isArray(item.parameters) ? item.parameters : [];
      METHODS.forEach(function (method) {
        var op = item[method];
        if (!isObj(op)) return;
        var reqItem = postmanRequest(doc, pathName, method, op, shared);
        var tag = Array.isArray(op.tags) && op.tags.length ? String(op.tags[0]) : null;
        if (tag) {
          (folders[tag] = folders[tag] || []).push(reqItem);
        } else {
          rootItems.push(reqItem);
        }
      });
    });

    var items = Object.keys(folders).map(function (tag) {
      return { name: tag, item: folders[tag] };
    }).concat(rootItems);

    var variables = [{ key: 'baseUrl', value: server, type: 'string' }];
    var serverVars = (Array.isArray(doc.servers) && doc.servers[0] && doc.servers[0].variables) || {};
    Object.keys(serverVars).forEach(function (k) {
      var v = serverVars[k] || {};
      variables.push({ key: k, value: v.default !== undefined ? String(v.default) : '', type: 'string' });
    });

    var collection = {
      info: {
        name: (doc.info && doc.info.title) || 'API',
        description: (doc.info && doc.info.description) || undefined,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: items,
      variable: variables
    };
    var auth = authFor(doc, doc.security);
    if (auth) collection.auth = auth;
    return collection;
  }

  /* ----- merge back into an imported Postman collection ----- */

  /* Match key for a request: METHOD + path with template segments unified,
     ignoring the host part ({{baseUrl}} etc.). */
  function requestKey(method, urlish) {
    var path = '';
    if (typeof urlish === 'string') {
      path = urlish.replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/^\{\{[^}]+\}\}/, '').split('?')[0];
    } else if (isObj(urlish) && Array.isArray(urlish.path)) {
      path = '/' + urlish.path.join('/');
    }
    var norm = path.split('/').filter(Boolean).map(function (seg) {
      if (/^:/.test(seg) || /^\{\{?[^}]+\}?\}$/.test(seg)) return '{}';
      return seg;
    }).join('/');
    return String(method || '').toUpperCase() + ' /' + norm;
  }

  function indexGenerated(collection) {
    var map = {};
    (function walk(items, tag) {
      (items || []).forEach(function (it) {
        if (it.item) { walk(it.item, it.name); return; }
        if (!it.request) return;
        map[requestKey(it.request.method, it.request.url)] = { item: it, tag: tag || null };
      });
    })(collection.item, null);
    return map;
  }

  /* Applies the current document's edits onto a clone of the ORIGINAL
     collection: matched requests get their spec-representable fields
     replaced, while Postman-only data (scripts/events, settings, saved
     responses with their full transport detail, unmatched requests and
     extra variables) is left exactly as the user had it. */
  function mergeIntoCollection(doc, original) {
    var generated = toPostman(doc);
    var genIndex = indexGenerated(generated);
    var merged = clone(original);
    var matchedKeys = {};

    (function walk(items) {
      (items || []).forEach(function (it) {
        if (it.item) { walk(it.item); return; }
        if (!it.request) return;
        var key = requestKey(it.request.method, it.request.url);
        var gen = genIndex[key];
        if (!gen) return; // request no longer in the spec — keep it untouched
        matchedKeys[key] = true;
        var g = gen.item;
        it.name = g.name;
        var keepAuth = it.request.auth;
        var keepResponses = it.response;
        it.request = clone(g.request);
        if (!it.request.auth && keepAuth) it.request.auth = keepAuth;
        // Original saved responses carry transport detail (headers, cookies,
        // timings) the spec cannot express — prefer them when present.
        if (Array.isArray(keepResponses) && keepResponses.length) {
          it.response = keepResponses;
        } else if (Array.isArray(g.response) && g.response.length) {
          it.response = clone(g.response);
        }
      });
    })(merged.item);

    // Endpoints added to the spec after the import land in a matching tag
    // folder when one exists, else in a dedicated folder.
    var additions = [];
    Object.keys(genIndex).forEach(function (key) {
      if (!matchedKeys[key]) additions.push(genIndex[key]);
    });
    if (additions.length) {
      var foldersByName = {};
      (merged.item || []).forEach(function (it) {
        if (it.item) foldersByName[it.name] = it;
      });
      var newFolder = null;
      additions.forEach(function (add) {
        var target = add.tag && foldersByName[add.tag];
        if (target) {
          target.item.push(clone(add.item));
        } else {
          if (!newFolder) {
            newFolder = { name: 'Added from spec', item: [] };
            merged.item = merged.item || [];
            merged.item.push(newFolder);
          }
          newFolder.item.push(clone(add.item));
        }
      });
    }

    // Spec-representable collection fields follow the document.
    merged.info = merged.info || {};
    merged.info.name = generated.info.name;
    if (generated.info.description !== undefined) merged.info.description = generated.info.description;
    if (generated.auth) merged.auth = generated.auth;

    var haveVars = {};
    merged.variable = merged.variable || [];
    merged.variable.forEach(function (v) { haveVars[v.key] = true; });
    (generated.variable || []).forEach(function (v) {
      if (!haveVars[v.key]) merged.variable.push(v);
    });
    return merged;
  }

  /* ----- standalone HTML documentation ----- */

  function escapeInline(s) {
    // "</script>" inside inlined JS/JSON must not close our tag.
    return s.replace(/<\/script/gi, '<\\/script');
  }

  function standaloneHtml(doc, cssText, bundleJs) {
    var title = ((doc.info && doc.info.title) || 'API') + ' — API documentation';
    var specJson = JSON.stringify(doc).replace(/</g, '\\u003c');
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<title>' + title.replace(/</g, '&lt;') + '</title>',
      '<style>' + cssText.replace(/<\//g, '<\\/') + '</style>',
      '<style>body{margin:0;background:#fafafa}.topbar{display:none}</style>',
      '</head>',
      '<body>',
      '<div id="swagger-ui"></div>',
      '<script>' + escapeInline(bundleJs) + '</script>',
      '<script>',
      'window.ui = SwaggerUIBundle({',
      '  spec: ' + specJson + ',',
      '  dom_id: "#swagger-ui",',
      '  presets: [SwaggerUIBundle.presets.apis],',
      '  deepLinking: true,',
      '  defaultModelsExpandDepth: 1,',
      '  supportedSubmitMethods: []', // docs page: hide "try it out" execution
      '});',
      '</script>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  /* ----- UI ----- */

  function slug(doc) {
    return (((doc || {}).info || {}).title || 'openapi')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'openapi';
  }

  function download(name, mime, content) {
    var blob = new Blob([content], { type: mime });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* Two-option dialog shown when the document came from a Postman import:
     rebuild from the spec alone, or merge the edits into the original. */
  function chooseExportMode(onChoice) {
    var overlay = document.createElement('div');
    overlay.className = 'sdui-modal-overlay';
    overlay.id = 'export-choice-overlay';
    overlay.innerHTML =
      '<div class="sdui-modal sdui-export-choice" role="dialog" aria-modal="true" aria-label="Export Postman collection">' +
      '  <div class="sdui-modal-head">' +
      '    <div class="g-title">Export Postman collection</div>' +
      '    <button type="button" class="sdui-tool-btn" data-choice="cancel">Cancel</button>' +
      '  </div>' +
      '  <div class="sdui-export-choice-body">' +
      '    <p>This document was imported from a Postman collection. How should the export be built?</p>' +
      '    <button type="button" class="sdui-export-option" data-choice="merge">' +
      '      <strong>Merge into my collection</strong>' +
      '      <span>Applies your spec changes to the original collection — scripts, settings, saved responses and extra variables are kept.</span>' +
      '    </button>' +
      '    <button type="button" class="sdui-export-option" data-choice="fresh">' +
      '      <strong>Generate from the spec only</strong>' +
      '      <span>A clean collection rebuilt purely from the OpenAPI document, ignoring the original import.</span>' +
      '    </button>' +
      '  </div>' +
      '</div>';
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); return; }
      var btn = e.target.closest('[data-choice]');
      if (!btn) return;
      close();
      if (btn.dataset.choice !== 'cancel') onChoice(btn.dataset.choice);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  function init(opts) {
    var button = opts.button;
    var menu = opts.menu;
    var getPostmanSource = opts.getPostmanSource || function () { return null; };

    function currentDoc() {
      var doc = jsyaml.load(opts.getText());
      if (!doc || typeof doc !== 'object') throw new Error('the document is empty');
      return doc;
    }

    function downloadCollection(doc, collection, note) {
      download(slug(doc) + '.postman_collection.json', 'application/json',
        JSON.stringify(collection, null, 2));
      opts.setStatus('ok', note);
    }

    var ACTIONS = [
      {
        label: 'Postman collection (.json)',
        run: function () {
          var doc = currentDoc();
          if (doc.swagger) throw new Error('convert the document to OpenAPI 3 first');
          var source = getPostmanSource();
          if (source) {
            chooseExportMode(function (choice) {
              try {
                if (choice === 'merge') {
                  downloadCollection(doc, mergeIntoCollection(doc, source),
                    'Merged collection downloaded — your spec edits applied, Postman-only data kept');
                } else {
                  downloadCollection(doc, toPostman(doc),
                    'Postman collection downloaded — rebuilt from the spec');
                }
              } catch (err) {
                opts.setStatus('err', 'Export failed: ' + err.message);
              }
            });
            return null; // status set after the dialog choice
          }
          downloadCollection(doc, toPostman(doc),
            'Postman collection downloaded — import it via File → Import in Postman');
          return null;
        }
      },
      {
        label: 'Standalone HTML docs (.html)',
        run: function () {
          var doc = currentDoc();
          return Promise.all([
            fetch('vendor/swagger-ui.css').then(function (r) { return r.text(); }),
            fetch('vendor/swagger-ui-bundle.js').then(function (r) { return r.text(); })
          ]).then(function (assets) {
            download(slug(doc) + '-docs.html', 'text/html',
              standaloneHtml(doc, assets[0], assets[1]));
            return 'Standalone docs downloaded — the file works offline, no server needed';
          });
        }
      }
    ];

    ACTIONS.forEach(function (action) {
      var el = document.createElement('div');
      el.className = 'sdui-menu-item';
      var label = document.createElement('div');
      label.className = 'sdui-menu-label';
      label.textContent = action.label;
      el.appendChild(label);
      label.addEventListener('click', function () {
        menu.hidden = true;
        try {
          Promise.resolve(action.run()).then(function (msg) {
            if (msg) opts.setStatus('ok', msg);
          }).catch(function (err) {
            opts.setStatus('err', 'Export failed: ' + err.message);
          });
        } catch (err) {
          opts.setStatus('err', 'Export failed: ' + (err.reason || err.message));
        }
      });
      menu.appendChild(el);
    });

    button.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== button) menu.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') menu.hidden = true;
    });
  }

  window.SduiExport = {
    init: init,
    toPostman: toPostman,
    mergeIntoCollection: mergeIntoCollection,
    standaloneHtml: standaloneHtml
  };
})();

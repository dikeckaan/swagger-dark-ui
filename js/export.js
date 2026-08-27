/* Swagger Dark UI — exporters for the YAML editor.
   "Export" dropdown: the current OpenAPI 3 document as a Postman
   Collection v2.1 (folders per tag, auth mapping, example bodies), or as a
   standalone single-file HTML documentation page with Swagger UI inlined
   from the vendored assets — it opens from disk, no server or network. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

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

  function postmanAuth(doc) {
    var req = Array.isArray(doc.security) && doc.security.length ? doc.security[0] : null;
    var schemes = doc.components && doc.components.securitySchemes;
    if (!req || !isObj(schemes)) return null;
    var name = Object.keys(req)[0];
    var scheme = schemes[name];
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
    return {
      name: op.summary || op.operationId || method.toUpperCase() + ' ' + pathName,
      request: request
    };
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

    var collection = {
      info: {
        name: (doc.info && doc.info.title) || 'API',
        description: (doc.info && doc.info.description) || undefined,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: items,
      variable: [{ key: 'baseUrl', value: server, type: 'string' }]
    };
    var auth = postmanAuth(doc);
    if (auth) collection.auth = auth;
    return collection;
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

  function init(opts) {
    var button = opts.button;
    var menu = opts.menu;

    function currentDoc() {
      var doc = jsyaml.load(opts.getText());
      if (!doc || typeof doc !== 'object') throw new Error('the document is empty');
      return doc;
    }

    var ACTIONS = [
      {
        label: 'Postman collection (.json)',
        run: function () {
          var doc = currentDoc();
          if (doc.swagger) throw new Error('convert the document to OpenAPI 3 first');
          var collection = toPostman(doc);
          download(slug(doc) + '.postman_collection.json', 'application/json',
            JSON.stringify(collection, null, 2));
          return 'Postman collection downloaded — import it via File → Import in Postman';
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
            opts.setStatus('ok', msg);
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

  window.SduiExport = { init: init, toPostman: toPostman, standaloneHtml: standaloneHtml };
})();

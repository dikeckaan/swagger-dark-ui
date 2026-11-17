/* Swagger Dark UI — exporters for the YAML editor.
   "Export" dropdown: the current OpenAPI 3 document as a Postman
   Collection v2.1 (folders per tag, auth mapping, example bodies), or as a
   standalone single-file HTML documentation page with Swagger UI inlined
   from the vendored assets — it opens from disk, no server or network.
   The JMeter entry hands over to js/jmeter.js, which asks what the test
   should do before writing a .jmx. */
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

  function responseExample(doc, op) {
    var responses = op.responses || {};
    var codes = Object.keys(responses).sort(function (a, b) {
      return (String(a).charAt(0) === '2' ? -1 : 0) - (String(b).charAt(0) === '2' ? -1 : 0);
    });
    for (var i = 0; i < codes.length; i++) {
      var response = deref(doc, responses[codes[i]]) || {};
      var content = response.content || {};
      var mimes = Object.keys(content).filter(function (m) { return /json/i.test(m); });
      for (var j = 0; j < mimes.length; j++) {
        var media = content[mimes[j]] || {};
        if (media.example !== undefined) return media.example;
        if (media.examples) {
          var names = Object.keys(media.examples);
          if (names.length) return (deref(doc, media.examples[names[0]]) || {}).value;
        }
      }
    }
    return undefined;
  }

  function responsePaths(example) {
    var paths = [];
    function visit(value, path, depth) {
      if (depth > 5 || paths.length >= 120) return;
      if (value === null || typeof value !== 'object') {
        if (path && !paths.includes(path)) paths.push(path);
        return;
      }
      if (Array.isArray(value)) {
        if (value.length) visit(value[0], path + '[0]', depth + 1);
      } else {
        Object.keys(value).forEach(function (key) {
          if (/^[a-zA-Z_$][\w$]*$/.test(key)) visit(value[key], path ? path + '.' + key : key, depth + 1);
          else visit(value[key], path + '[' + JSON.stringify(key) + ']', depth + 1);
        });
      }
    }
    if (example !== undefined) visit(example, '', 0);
    return paths;
  }

  function operations(doc) {
    var result = [];
    Object.keys(doc.paths || {}).forEach(function (path) {
      var entry = doc.paths[path] || {};
      METHODS.forEach(function (method) {
        if (!isObj(entry[method])) return;
        var op = entry[method];
        result.push({
          id: method.toUpperCase() + ' ' + path,
          label: method.toUpperCase() + ' ' + path + (op.summary ? ' — ' + op.summary : ''),
          paths: responsePaths(responseExample(doc, op))
        });
      });
    });
    return result;
  }

  function parseResponsePath(path) {
    // Accept dotted keys and numeric/quoted brackets, not executable expressions.
    var parts = [];
    var input = String(path || '').trim().replace(/^\$\.?/, '');
    var token = /(?:^|\.)([a-zA-Z_$][\w$]*)|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g;
    var match, end = 0;
    while ((match = token.exec(input))) {
      if (match.index !== end) throw new Error('Invalid response field path');
      parts.push(match[1] !== undefined ? match[1]
        : /^\d+$/.test(match[2]) ? Number(match[2])
          : match[2][0] === '"' ? JSON.parse(match[2]) : match[2].slice(1, -1));
      end = token.lastIndex;
    }
    if (!parts.length || end !== input.length) throw new Error('Enter a response field like data.accessToken');
    return parts;
  }

  function tokenCaptureScript(variableName, path, scope) {
    var parts = parseResponsePath(path);
    var accessor = parts.map(function (part) { return '[' + JSON.stringify(part) + ']'; }).join('');
    var target = scope === 'external' ? 'pm.environment' : 'pm.collectionVariables';
    return [
      'if (pm.response.code >= 200 && pm.response.code < 300) {',
      '  try {',
      '    var body = pm.response.json();',
      '    var value = body' + accessor + ';',
      '    if (value !== undefined && value !== null && value !== "") {',
      '      ' + target + '.set(' + JSON.stringify(variableName) + ', String(value));',
      '    }',
      '  } catch (e) { console.warn("Token capture skipped:", e.message); }',
      '}'
    ].join('\n');
  }

  function toPostman(doc, options) {
    if (!isObj(doc) || !isObj(doc.paths)) throw new Error('the document has no paths');
    options = options || {};
    var scope = options.environmentSource === 'external' ? 'external' : 'collection';
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
      variable: scope === 'collection' ? [{ key: 'baseUrl', value: server, type: 'string' }] : []
    };
    var auth = postmanAuth(doc);
    if (auth) collection.auth = auth;
    if (scope === 'collection') {
      if (auth && auth.type === 'bearer') collection.variable.push({ key: 'bearerToken', value: '', type: 'string' });
      if (auth && auth.type === 'apikey') collection.variable.push({ key: 'apiKey', value: '', type: 'string' });
      if (options.captureToken && !collection.variable.some(function (v) { return v.key === options.variableName; })) {
        collection.variable.push({ key: options.variableName, value: '', type: 'string' });
      }
    }
    if (options.captureToken) {
      var found = false;
      function attach(items) {
        items.forEach(function (item) {
          if (item.item) return attach(item.item);
          var raw = item.request && item.request.url && item.request.url.raw || '';
          var path = raw.split('?')[0].replace(/^\{\{baseUrl\}\}/, '')
            .replace(/:([^/]+)/g, '{$1}');
          var id = item.request.method + ' ' + (path || '/');
          if (id !== options.captureRequest || found) return;
          item.event = [{
            listen: 'test',
            script: {
              type: 'text/javascript',
              exec: tokenCaptureScript(options.variableName || 'bearerToken', options.responsePath, scope).split('\n')
            }
          }];
          found = true;
        });
      }
      attach(collection.item);
      if (!found) throw new Error('The selected token API could not be found');
    }
    return collection;
  }

  function toPostmanEnvironment(doc, options) {
    options = options || {};
    var server = Array.isArray(doc.servers) && doc.servers[0] && doc.servers[0].url
      ? doc.servers[0].url.replace(/\/$/, '') : 'http://localhost';
    var values = [{ key: 'baseUrl', value: server, type: 'default', enabled: true }];
    var auth = postmanAuth(doc);
    if (auth && auth.type === 'bearer') values.push({ key: 'bearerToken', value: '', type: 'secret', enabled: true });
    if (auth && auth.type === 'apikey') values.push({ key: 'apiKey', value: '', type: 'secret', enabled: true });
    if (options.captureToken && !values.some(function (v) { return v.key === options.variableName; })) {
      values.push({ key: options.variableName, value: '', type: 'secret', enabled: true });
    }
    return {
      name: ((doc.info && doc.info.title) || 'API') + ' Environment',
      values: values,
      _postman_variable_scope: 'environment',
      _postman_exported_using: 'Swagger Dark UI'
    };
  }

  function openPostmanWizard(doc, status) {
    var operationsList = operations(doc);
    var overlay = document.createElement('div');
    overlay.className = 'sdui-postman-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px';
    var panel = document.createElement('form');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Postman export settings');
    panel.style.cssText = 'width:min(550px,100%);max-height:90vh;overflow:auto;background:#161b25;color:#e5e7eb;border:1px solid #424a59;border-radius:12px;padding:22px;box-shadow:0 20px 80px #0008;font:14px system-ui';
    function element(tag, text, parent) {
      var e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      (parent || panel).appendChild(e);
      return e;
    }
    function field(title, control) {
      var label = element('label', title);
      label.style.cssText = 'display:block;margin:14px 0 6px;font-weight:600';
      if (control) label.htmlFor = control.id;
    }
    function select(id, items) {
      var el = element('select');
      el.id = id;
      el.style.cssText = 'width:100%;padding:10px;border-radius:7px;background:#252d3c;color:inherit;border:1px solid #535c6e';
      items.forEach(function (entry) {
        var option = document.createElement('option');
        option.value = entry.value;
        option.textContent = entry.label;
        el.appendChild(option);
      });
      return el;
    }
    function input(id, value, list) {
      var el = element('input');
      el.id = id;
      el.value = value;
      el.type = 'text';
      if (list) el.setAttribute('list', list);
      el.style.cssText = 'width:100%;box-sizing:border-box;padding:10px;border-radius:7px;background:#252d3c;color:inherit;border:1px solid #535c6e';
      return el;
    }
    var title = element('h2', 'Postman export settings');
    title.style.margin = '0 0 8px';
    element('p', 'Choose the variable source and optionally capture a token from an API response.');
    field('Variable source');
    var source = select('sdui-postman-source', [
      { value: 'collection', label: 'Collection variables (embedded)' },
      { value: 'external', label: 'External Postman environment (.json)' }
    ]);
    var note = element('p');
    note.style.cssText = 'font-size:12px;opacity:.8;margin-top:7px';
    var checkLabel = element('label');
    checkLabel.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:18px;font-weight:600';
    var enabled = document.createElement('input');
    enabled.type = 'checkbox';
    checkLabel.appendChild(enabled);
    checkLabel.appendChild(document.createTextNode('Save token / response field to variables'));
    var capture = element('div');
    field('API whose response provides the value');
    var request = select('sdui-postman-request', operationsList.map(function (op) {
      return { value: op.id, label: op.label };
    }));
    field('Response field (JSON path)');
    var path = input('sdui-postman-path', '', 'sdui-postman-response-paths');
    var datalist = element('datalist');
    datalist.id = 'sdui-postman-response-paths';
    field('Variable name');
    var variable = input('sdui-postman-variable', 'bearerToken');
    var help = element('p', 'Pick a field suggested from OpenAPI response examples or type a path, e.g. data.accessToken.');
    help.style.cssText = 'font-size:12px;opacity:.8';
    while (capture.nextSibling) capture.appendChild(capture.nextSibling);
    function updatePaths() {
      var selected = operationsList.filter(function (op) { return op.id === request.value; })[0];
      var paths = selected ? selected.paths : [];
      datalist.replaceChildren();
      paths.forEach(function (p) {
        var item = document.createElement('option');
        item.value = p;
        datalist.appendChild(item);
      });
      path.value = paths.filter(function (p) { return /(?:^|\.)(?:access_token|accessToken|token|jwt)$/i.test(p); })[0]
        || paths[0] || '';
    }
    function update() {
      capture.hidden = !enabled.checked;
      note.textContent = source.value === 'external'
        ? 'Downloads a collection and a separate environment file. Import both and select the environment in Postman.'
        : 'Variables are stored in the collection; no separate environment is required.';
    }
    source.addEventListener('change', update);
    enabled.addEventListener('change', update);
    request.addEventListener('change', updatePaths);
    updatePaths();
    update();
    var actions = element('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:20px';
    var cancel = element('button', 'Cancel', actions);
    cancel.type = 'button';
    var submit = element('button', 'Export', actions);
    submit.type = 'submit';
    [cancel, submit].forEach(function (b) { b.style.cssText = 'padding:10px 18px;border-radius:7px;cursor:pointer'; });
    function close() { document.removeEventListener('keydown', onKey); overlay.remove(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    panel.addEventListener('submit', function (event) {
      event.preventDefault();
      try {
        var options = {
          environmentSource: source.value,
          captureToken: enabled.checked,
          captureRequest: request.value,
          responsePath: path.value,
          variableName: variable.value.trim()
        };
        if (options.captureToken && (!options.variableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.variableName))) {
          throw new Error('Enter a valid variable name (letters, digits, underscore)');
        }
        var collection = toPostman(doc, options);
        download(slug(doc) + '.postman_collection.json', 'application/json', JSON.stringify(collection, null, 2));
        if (source.value === 'external') {
          download(slug(doc) + '.postman_environment.json', 'application/json',
            JSON.stringify(toPostmanEnvironment(doc, options), null, 2));
        }
        status('ok', source.value === 'external'
          ? 'Postman collection and environment downloaded — import both and select the environment'
          : 'Postman collection downloaded with embedded variables');
        close();
      } catch (error) {
        status('err', 'Postman export failed: ' + error.message);
      }
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    source.focus();
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
          openPostmanWizard(doc, opts.setStatus);
          return '';
        }
      },
      {
        // The plan depends on answers the document cannot give — which limiter
        // is under test, where the token comes from, how hard and how long —
        // so this one opens the wizard instead of exporting blind.
        label: 'JMeter test plan (.jmx)…',
        run: function () {
          var doc = currentDoc();
          if (doc.swagger) throw new Error('convert the document to OpenAPI 3 first');
          if (!window.SduiJMeter) throw new Error('the JMeter module is not loaded');
          SduiJMeter.open({ doc: doc, download: download, setStatus: opts.setStatus });
          return '';
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

    // Shared with js/jmeter.js, which reads the same document the same way.
  window.SduiExport = {
    init: init,
    toPostman: toPostman,
    toPostmanEnvironment: toPostmanEnvironment,
    parseResponsePath: parseResponsePath,
    standaloneHtml: standaloneHtml,
    util: { isObj: isObj, deref: deref, exampleFor: exampleFor, slug: slug, download: download }
  };
})();

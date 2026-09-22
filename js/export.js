/* Swagger Dark UI — exporters for the YAML editor.
   "Export" dropdown: the current OpenAPI 3 document as a Postman
   Collection v2.1 (folders per tag, auth mapping, example bodies), as an
   Apache JMeter 5.4.3 test plan (.jmx) for load and rate-limit runs, or as a
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

  /* ----- Apache JMeter test plan (.jmx) -----
     Targeted at JMeter 5.4.3: only long-standing core elements are emitted
     (thread group, HTTP defaults/samplers, header/cookie/auth managers,
     constant throughput timer, response assertion, result collectors), so the
     plan opens unchanged in 5.4.3 and in every later 5.x. Load knobs are
     JMeter properties — threads, rampup, duration, rpm, protocol, host, port,
     basePath and the credentials — so one plan covers a smoke run and a
     rate-limit run: jmeter -n -t plan.jmx -Jthreads=50 -Jrpm=3000 */

  // Idempotent verbs run by default; anything that writes ships disabled so a
  // stray load test cannot hammer a real API with POST/DELETE traffic.
  var JMX_SAFE = { get: true, head: true, options: true, trace: true };

  // Variable names the plan defines itself — a path parameter with one of
  // these names gets a p_ prefix instead of silently shadowing it.
  var JMX_RESERVED = {
    protocol: 1, host: 1, port: 1, basePath: 1,
    token: 1, apiKey: 1, username: 1, password: 1, uploadFile: 1
  };

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control characters XML 1.0 cannot carry at all: JMeter's parser aborts
      // on them, so they never reach the file.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  /* Tiny indent-aware XML writer — the .jmx format is deeply nested and stays
     far more readable (and diffable) with real indentation. */
  function Jmx() { this.out = []; this.depth = 0; }
  Jmx.prototype.line = function (s) {
    var pad = '';
    for (var i = 0; i < this.depth; i++) pad += '  ';
    this.out.push(pad + s);
    return this;
  };
  Jmx.prototype.open = function (s) { this.line(s); this.depth++; return this; };
  Jmx.prototype.close = function (s) { this.depth--; return this.line(s); };
  Jmx.prototype.sp = function (name, value) {
    return this.line('<stringProp name="' + name + '">' +
      xmlEsc(value === undefined || value === null ? '' : value) + '</stringProp>');
  };
  Jmx.prototype.bp = function (name, value) {
    return this.line('<boolProp name="' + name + '">' + (value ? 'true' : 'false') + '</boolProp>');
  };
  Jmx.prototype.ip = function (name, value) {
    return this.line('<intProp name="' + name + '">' + value + '</intProp>');
  };
  Jmx.prototype.leaf = function () { return this.line('<hashTree/>'); };
  Jmx.prototype.text = function () { return this.out.join('\n') + '\n'; };

  function jmxOpen(w, tag, guiclass, testclass, testname, enabled) {
    return w.open('<' + tag + ' guiclass="' + guiclass + '" testclass="' + testclass +
      '" testname="' + xmlEsc(testname) + '" enabled="' + (enabled === false ? 'false' : 'true') + '">');
  }

  function jmxVarName(name) {
    var clean = String(name).replace(/[^A-Za-z0-9_]/g, '_') || 'param';
    // The p_ prefix keeps a path parameter from shadowing a variable the plan
    // defines itself — and keeps "__proto__" out of the plain-object bookkeeping.
    return (Object.prototype.hasOwnProperty.call(JMX_RESERVED, clean) || clean === '__proto__')
      ? 'p_' + clean : clean;
  }

  /* Only scalars can go into a URL, a header or a variable; an array of
     scalars becomes the comma-separated form JMeter sends for repeated
     values. */
  function jmxScalar(value, fallback) {
    if (Array.isArray(value)) {
      var flat = value.filter(function (v) { return v !== null && typeof v !== 'object'; });
      return flat.length ? flat.join(',') : fallback;
    }
    if (value === undefined || value === null || typeof value === 'object') return fallback;
    return String(value).replace(/[\r\n\t]+/g, ' ');
  }

  function jmxPlaceholder(schema) {
    var type = (schema && schema.type) || 'string';
    if (type === 'integer' || type === 'number') return '1';
    if (type === 'boolean') return 'true';
    return 'value';
  }

  function jmxParamValue(doc, p) {
    var schema = p.schema && deref(doc, p.schema);
    var value = p.example !== undefined ? p.example
      : (schema && schema.example !== undefined ? schema.example
        : (schema && schema.default !== undefined ? schema.default : exampleFor(doc, p.schema)));
    return jmxScalar(value, jmxPlaceholder(schema));
  }

  /* servers[0] -> protocol / host / port / basePath, server variables resolved
     from their defaults. A relative server URL ("/v1") keeps localhost. */
  function jmxServer(doc) {
    var server = Array.isArray(doc.servers) && isObj(doc.servers[0]) ? doc.servers[0] : null;
    var url = (server && typeof server.url === 'string' && server.url) || 'http://localhost';
    if (server && isObj(server.variables)) {
      url = url.replace(/\{([^}]+)\}/g, function (match, key) {
        var v = deref(doc, server.variables[key]);
        return isObj(v) && v.default !== undefined ? String(v.default) : match;
      });
    }
    var m = url.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?([^?#]*)/i);
    if (!m) {
      return {
        protocol: 'http', host: 'localhost', port: '8080',
        basePath: (url.charAt(0) === '/' ? url : '').replace(/\/+$/, '')
      };
    }
    var protocol = m[1].toLowerCase();
    return {
      protocol: protocol,
      host: m[2],
      port: m[3] || (protocol === 'https' ? '443' : '80'),
      basePath: (m[4] || '').replace(/\/+$/, '')
    };
  }

  /* Security scheme -> the managers/variables the plan needs. */
  function jmxAuth(doc) {
    var req = Array.isArray(doc.security) && doc.security.length ? doc.security[0] : null;
    var schemes = doc.components && doc.components.securitySchemes;
    if (!req || !isObj(schemes)) return null;
    var scheme = deref(doc, schemes[Object.keys(req)[0]]);
    if (!isObj(scheme)) return null;
    var httpScheme = String(scheme.scheme || '').toLowerCase();
    if (scheme.type === 'http' && httpScheme === 'basic') return { kind: 'basic' };
    if (scheme.type === 'http' && httpScheme === 'bearer') return { kind: 'header', name: 'Authorization', value: 'Bearer ${token}', vars: ['token'] };
    if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') return { kind: 'header', name: 'Authorization', value: 'Bearer ${token}', vars: ['token'] };
    if (scheme.type === 'apiKey' && scheme.in === 'query') return { kind: 'query', name: scheme.name || 'api_key', value: '${apiKey}', vars: ['apiKey'] };
    if (scheme.type === 'apiKey') return { kind: 'header', name: scheme.name || 'X-API-Key', value: '${apiKey}', vars: ['apiKey'] };
    return null;
  }

  function jmxBody(doc, requestBody) {
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
        var prop = deref(doc, props[k]) || {};
        fields.push({ name: k, value: jmxScalar(exampleFor(doc, props[k]), jmxPlaceholder(prop)) });
      });
      return { mime: mime, args: fields };
    }
    if (/multipart/.test(mime)) {
      var form = [];
      var files = [];
      var mprops = (schema && schema.properties) || {};
      Object.keys(mprops).forEach(function (k) {
        var prop = deref(doc, mprops[k]) || {};
        if (prop.format === 'binary') {
          files.push({ path: '${uploadFile}', param: k, mime: 'application/octet-stream' });
        } else {
          form.push({ name: k, value: jmxScalar(exampleFor(doc, mprops[k]), jmxPlaceholder(prop)) });
        }
      });
      return { mime: mime, args: form, files: files, multipart: true };
    }
    return {
      mime: mime,
      raw: example === undefined ? '{}' : (jsonMime ? JSON.stringify(example, null, 2) : String(example))
    };
  }

  function jmxRequest(doc, pathName, method, op, sharedParams, ctx) {
    var params = (sharedParams || []).concat(Array.isArray(op.parameters) ? op.parameters : [])
      .map(function (p) { return deref(doc, p); })
      .filter(isObj);

    var query = [];
    var headers = [];
    params.forEach(function (p) {
      var value = jmxParamValue(doc, p);
      if (p.in === 'path') {
        ctx.pathVars[jmxVarName(p.name)] = value;
      } else if (p.in === 'query') {
        // Required parameters plus anything the spec gives a concrete value
        // for — guessed values for optional filters only add noise.
        if (p.required === true || p.example !== undefined) query.push({ name: p.name, value: value });
      } else if (p.in === 'header' && !/^(authorization|content-type|accept)$/i.test(p.name)) {
        headers.push({ name: p.name, value: value });
      }
    });

    // Template the path parameters only — the ${basePath} prefix is added
    // afterwards so its own braces are left alone.
    var path = '${basePath}' + pathName.replace(/\{([^}]+)\}/g, function (match, name) {
      return '${' + jmxVarName(name) + '}';
    });

    var sampler = {
      name: method.toUpperCase() + ' ' + pathName,
      comment: op.summary || op.description || '',
      method: method.toUpperCase(),
      path: path,
      enabled: JMX_SAFE[method] === true,
      args: query,
      headers: headers,
      files: null,
      raw: null,
      multipart: false
    };

    var body = op.requestBody && jmxBody(doc, op.requestBody);
    if (body) {
      // JMeter builds the multipart Content-Type itself — it carries the part
      // boundary, so a hand-written header would corrupt the request.
      if (!body.multipart) headers.push({ name: 'Content-Type', value: body.mime });
      if (body.raw !== undefined && body.raw !== null) {
        sampler.raw = body.raw;
        // A raw body takes the argument list over, so query parameters have to
        // travel in the path instead.
        if (query.length) {
          sampler.path += '?' + query.map(function (q) {
            return encodeURIComponent(q.name) + '=' + encodeURIComponent(q.value);
          }).join('&');
          sampler.args = [];
        }
      } else {
        sampler.args = query.concat(body.args || []);
        sampler.multipart = !!body.multipart;
        if (body.files && body.files.length) {
          sampler.files = body.files;
          ctx.needUpload = true;
        }
      }
    }
    return sampler;
  }

  /* ----- .jmx elements ----- */

  function jmxArguments(w, args) {
    w.open('<elementProp name="HTTPsampler.Arguments" elementType="Arguments" ' +
      'guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">');
    if (!args.length) {
      w.line('<collectionProp name="Arguments.arguments"/>');
    } else {
      w.open('<collectionProp name="Arguments.arguments">');
      args.forEach(function (a) {
        w.open('<elementProp name="' + xmlEsc(a.name || '') + '" elementType="HTTPArgument">');
        w.bp('HTTPArgument.always_encode', a.name ? true : false);
        w.sp('Argument.value', a.value);
        w.sp('Argument.metadata', '=');
        w.bp('HTTPArgument.use_equals', true);
        if (a.name) w.sp('Argument.name', a.name);
        w.close('</elementProp>');
      });
      w.close('</collectionProp>');
    }
    w.close('</elementProp>');
  }

  function jmxUserVars(w, propName, testname, vars) {
    w.open('<elementProp name="' + propName + '" elementType="Arguments" ' +
      'guiclass="ArgumentsPanel" testclass="Arguments" testname="' + xmlEsc(testname) + '" enabled="true">');
    w.open('<collectionProp name="Arguments.arguments">');
    vars.forEach(function (v) {
      w.open('<elementProp name="' + xmlEsc(v.name) + '" elementType="Argument">');
      w.sp('Argument.name', v.name);
      w.sp('Argument.value', v.value);
      w.sp('Argument.metadata', '=');
      w.close('</elementProp>');
    });
    w.close('</collectionProp>');
    w.close('</elementProp>');
  }

  function jmxHeaderManager(w, testname, headers) {
    jmxOpen(w, 'HeaderManager', 'HeaderPanel', 'HeaderManager', testname, true);
    w.open('<collectionProp name="HeaderManager.headers">');
    headers.forEach(function (h) {
      w.open('<elementProp name="' + xmlEsc(h.name) + '" elementType="Header">');
      w.sp('Header.name', h.name);
      w.sp('Header.value', h.value);
      w.close('</elementProp>');
    });
    w.close('</collectionProp>');
    w.close('</HeaderManager>');
    w.leaf();
  }

  function jmxSampler(w, s) {
    jmxOpen(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy', s.name, s.enabled);
    if (s.raw !== null) {
      w.bp('HTTPSampler.postBodyRaw', true);
      jmxArguments(w, [{ name: '', value: s.raw }]);
    } else {
      jmxArguments(w, s.args);
    }
    if (s.files && s.files.length) {
      w.open('<elementProp name="HTTPsampler.Files" elementType="HTTPFileArgs">');
      w.open('<collectionProp name="HTTPFileArgs.files">');
      s.files.forEach(function (f) {
        w.open('<elementProp name="' + xmlEsc(f.path) + '" elementType="HTTPFileArg">');
        w.sp('File.path', f.path);
        w.sp('File.paramname', f.param);
        w.sp('File.mimetype', f.mime);
        w.close('</elementProp>');
      });
      w.close('</collectionProp>');
      w.close('</elementProp>');
    }
    w.sp('HTTPSampler.domain', '');
    w.sp('HTTPSampler.port', '');
    w.sp('HTTPSampler.protocol', '');
    w.sp('HTTPSampler.contentEncoding', '');
    w.sp('HTTPSampler.path', s.path);
    w.sp('HTTPSampler.method', s.method);
    w.bp('HTTPSampler.follow_redirects', true);
    w.bp('HTTPSampler.auto_redirects', false);
    w.bp('HTTPSampler.use_keepalive', true);
    w.bp('HTTPSampler.DO_MULTIPART_POST', s.multipart);
    w.sp('HTTPSampler.embedded_url_re', '');
    w.sp('HTTPSampler.connect_timeout', '');
    w.sp('HTTPSampler.response_timeout', '');
    if (s.comment) w.sp('TestPlan.comments', s.comment);
    w.close('</HTTPSamplerProxy>');
    if (s.headers.length) {
      w.open('<hashTree>');
      jmxHeaderManager(w, 'HTTP Header Manager', s.headers);
      w.close('</hashTree>');
    } else {
      w.leaf();
    }
  }

  function jmxListener(w, guiclass, testname, enabled) {
    jmxOpen(w, 'ResultCollector', guiclass, 'ResultCollector', testname, enabled);
    w.bp('ResultCollector.error_logging', false);
    w.open('<objProp>');
    w.line('<name>saveConfig</name>');
    w.open('<value class="SampleSaveConfiguration">');
    [['time', 1], ['latency', 1], ['timestamp', 1], ['success', 1], ['label', 1], ['code', 1],
     ['message', 1], ['threadName', 1], ['dataType', 1], ['encoding', 0], ['assertions', 1],
     ['subresults', 1], ['responseData', 0], ['samplerData', 0], ['xml', 0], ['fieldNames', 1],
     ['responseHeaders', 0], ['requestHeaders', 0], ['responseDataOnError', 0],
     ['saveAssertionResultsFailureMessage', 1], ['bytes', 1], ['sentBytes', 1], ['url', 1],
     ['threadCounts', 1], ['idleTime', 1], ['connectTime', 1]].forEach(function (f) {
      w.line('<' + f[0] + '>' + (f[1] ? 'true' : 'false') + '</' + f[0] + '>');
    });
    w.line('<assertionsResultsToSave>0</assertionsResultsToSave>');
    w.close('</value>');
    w.close('</objProp>');
    w.sp('filename', '');
    w.close('</ResultCollector>');
    w.leaf();
  }

  function toJmx(doc) {
    if (!isObj(doc) || !isObj(doc.paths)) throw new Error('the document has no paths');
    var srv = jmxServer(doc);
    var auth = jmxAuth(doc);
    var ctx = { pathVars: {}, needUpload: false };
    var groups = {};
    var order = [];
    var samplers = 0;
    var disabled = 0;

    Object.keys(doc.paths).forEach(function (pathName) {
      var item = deref(doc, doc.paths[pathName]);
      if (!isObj(item)) return;
      var shared = Array.isArray(item.parameters) ? item.parameters : [];
      METHODS.forEach(function (method) {
        var op = item[method];
        if (!isObj(op)) return;
        var sampler = jmxRequest(doc, pathName, method, op, shared, ctx);
        samplers++;
        if (!sampler.enabled) disabled++;
        var tag = Array.isArray(op.tags) && op.tags.length ? String(op.tags[0]) : 'default';
        if (!groups[tag]) { groups[tag] = []; order.push(tag); }
        groups[tag].push(sampler);
      });
    });
    if (!samplers) throw new Error('the document has no operations');

    // Every knob is a JMeter property, so the same file serves a smoke run and
    // a rate-limit run without being edited: -Jrpm=6000 -Jthreads=200 ...
    // An empty __P default is not usable — JMeter substitutes "1" for it — so a
    // knob with nothing to default to stays a plain (still editable) variable.
    function knob(name, dflt) {
      return dflt === '' ? '' : '${__P(' + name + ',' + dflt + ')}';
    }
    var vars = [
      { name: 'protocol', value: knob('protocol', srv.protocol) },
      { name: 'host', value: knob('host', srv.host) },
      { name: 'port', value: knob('port', srv.port) },
      { name: 'basePath', value: knob('basePath', srv.basePath) }
    ];
    if (auth && auth.kind === 'basic') {
      vars.push({ name: 'username', value: knob('username', 'user') });
      vars.push({ name: 'password', value: knob('password', 'pass') });
    } else if (auth && auth.vars) {
      auth.vars.forEach(function (name) {
        vars.push({ name: name, value: knob(name, 'CHANGEME') });
      });
    }
    if (ctx.needUpload) vars.push({ name: 'uploadFile', value: knob('uploadFile', '/path/to/upload.bin') });
    Object.keys(ctx.pathVars).sort().forEach(function (name) {
      vars.push({ name: name, value: ctx.pathVars[name] });
    });

    var info = doc.info || {};
    var title = (info.title || 'API') + (info.version ? ' ' + info.version : '') + ' — load test';
    var comments = [
      'Generated from the OpenAPI document by Swagger Dark UI. Built for Apache JMeter 5.4.3.',
      '',
      'Run it headless:',
      '  jmeter -n -t ' + slug(doc) + '.jmx -l results.jtl',
      'Rate-limit run (override any knob with -J):',
      '  jmeter -n -t ' + slug(doc) + '.jmx -Jthreads=50 -Jrampup=10 -Jduration=300 -Jrpm=6000 -l results.jtl',
      'Add -e -o report for the HTML dashboard — under Java 17+ that step needs',
      'JMeter 5.5 or newer; the test run itself is fine on 5.4.3.',
      '',
      'Knobs: threads (10), rampup (10 s), duration (60 s), rpm (600 requests per minute',
      'across the whole thread group, enforced by the Constant Throughput Timer),',
      'protocol/host/port/basePath' + (auth ? ' and the credential variables' : '') + '.',
      '',
      'The response assertion accepts 2xx and 429, so throttled responses show up in the',
      'report as rate limiting instead of drowning the run in failures.',
      disabled ? 'Write operations (POST/PUT/PATCH/DELETE) are disabled — enable the ones you mean to run.' : ''
    ].join('\n');

    var w = new Jmx();
    w.line('<?xml version="1.0" encoding="UTF-8"?>');
    w.open('<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.4.3">');
    w.open('<hashTree>');

    jmxOpen(w, 'TestPlan', 'TestPlanGui', 'TestPlan', title, true);
    w.sp('TestPlan.comments', comments);
    w.bp('TestPlan.functional_mode', false);
    w.bp('TestPlan.tearDown_on_shutdown', true);
    w.bp('TestPlan.serialize_threadgroups', false);
    jmxUserVars(w, 'TestPlan.user_defined_variables', 'User Defined Variables', vars);
    w.sp('TestPlan.user_define_classpath', '');
    w.close('</TestPlan>');
    w.open('<hashTree>');

    /* HTTP Request Defaults */
    jmxOpen(w, 'ConfigTestElement', 'HttpDefaultsGui', 'ConfigTestElement', 'HTTP Request Defaults', true);
    jmxArguments(w, auth && auth.kind === 'query' ? [{ name: auth.name, value: auth.value }] : []);
    w.sp('HTTPSampler.domain', '${host}');
    w.sp('HTTPSampler.port', '${port}');
    w.sp('HTTPSampler.protocol', '${protocol}');
    w.sp('HTTPSampler.contentEncoding', 'UTF-8');
    w.sp('HTTPSampler.path', '');
    w.sp('HTTPSampler.implementation', 'HttpClient4');
    w.sp('HTTPSampler.connect_timeout', '10000');
    w.sp('HTTPSampler.response_timeout', '30000');
    w.close('</ConfigTestElement>');
    w.leaf();

    /* Plan-wide headers */
    var planHeaders = [{ name: 'Accept', value: 'application/json' }];
    if (auth && auth.kind === 'header') planHeaders.push({ name: auth.name, value: auth.value });
    jmxHeaderManager(w, 'HTTP Header Manager', planHeaders);

    /* Cookie manager — sessions and sticky load balancers */
    jmxOpen(w, 'CookieManager', 'CookiePanel', 'CookieManager', 'HTTP Cookie Manager', true);
    w.line('<collectionProp name="CookieManager.cookies"/>');
    w.bp('CookieManager.clearEachIteration', false);
    w.bp('CookieManager.controlledByThreadGroup', false);
    w.sp('CookieManager.policy', 'standard');
    w.close('</CookieManager>');
    w.leaf();

    if (auth && auth.kind === 'basic') {
      jmxOpen(w, 'AuthManager', 'AuthPanel', 'AuthManager', 'HTTP Authorization Manager', true);
      w.open('<collectionProp name="AuthManager.auth_list">');
      w.open('<elementProp name="" elementType="Authorization">');
      w.sp('Authorization.url', '${protocol}://${host}:${port}');
      w.sp('Authorization.username', '${username}');
      w.sp('Authorization.password', '${password}');
      w.sp('Authorization.domain', '');
      w.sp('Authorization.realm', '');
      w.sp('Authorization.mechanism', 'BASIC');
      w.close('</elementProp>');
      w.close('</collectionProp>');
      w.bp('AuthManager.controlledByThreadGroup', false);
      w.close('</AuthManager>');
      w.leaf();
    }

    /* Thread group */
    jmxOpen(w, 'ThreadGroup', 'ThreadGroupGui', 'ThreadGroup', 'Load — ' + (info.title || 'API'), true);
    w.sp('ThreadGroup.on_sample_error', 'continue');
    w.open('<elementProp name="ThreadGroup.main_controller" elementType="LoopController" ' +
      'guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">');
    w.bp('LoopController.continue_forever', false);
    w.sp('LoopController.loops', '-1');
    w.close('</elementProp>');
    w.sp('ThreadGroup.num_threads', '${__P(threads,10)}');
    w.sp('ThreadGroup.ramp_time', '${__P(rampup,10)}');
    w.bp('ThreadGroup.scheduler', true);
    w.sp('ThreadGroup.duration', '${__P(duration,60)}');
    w.sp('ThreadGroup.delay', '0');
    w.bp('ThreadGroup.same_user_on_next_iteration', true);
    w.close('</ThreadGroup>');
    w.open('<hashTree>');

    /* Constant Throughput Timer — the rate limiter of the test itself. */
    jmxOpen(w, 'ConstantThroughputTimer', 'TestBeanGUI', 'ConstantThroughputTimer',
      'Constant Throughput Timer (${__P(rpm,600)} req/min)', true);
    // 2 = the throughput applies to all active threads in this thread group.
    w.ip('calcMode', 2);
    w.sp('throughput', '${__P(rpm,600)}');
    w.close('</ConstantThroughputTimer>');
    w.leaf();

    /* 429 is a valid outcome of a rate-limit test, not a failure. JMeter marks
       every non-2xx/3xx sample failed on its own and a passing assertion does
       not undo that, so "Ignore status" (assume_success) resets the result
       before the pattern decides: 2xx and 429 pass, everything else fails. */
    jmxOpen(w, 'ResponseAssertion', 'AssertionGui', 'ResponseAssertion',
      'Status is 2xx or 429 (rate limited)', true);
    w.open('<collectionProp name="Asserion.test_strings">');
    w.sp('0', '^(2\\d\\d|429)$');
    w.close('</collectionProp>');
    w.sp('Assertion.custom_message', 'Unexpected response code');
    w.sp('Assertion.test_field', 'Assertion.response_code');
    w.bp('Assertion.assume_success', true);
    w.ip('Assertion.test_type', 1);
    w.close('</ResponseAssertion>');
    w.leaf();

    order.forEach(function (tag) {
      jmxOpen(w, 'GenericController', 'LogicControllerGui', 'GenericController', tag, true);
      w.close('</GenericController>');
      w.open('<hashTree>');
      groups[tag].forEach(function (s) { jmxSampler(w, s); });
      w.close('</hashTree>');
    });

    w.close('</hashTree>');  // thread group

    jmxListener(w, 'SummaryReport', 'Summary Report', true);
    jmxListener(w, 'StatVisualizer', 'Aggregate Report', true);
    jmxListener(w, 'ViewResultsFullVisualizer', 'View Results Tree', false);

    w.close('</hashTree>');  // test plan
    w.close('</hashTree>');
    w.close('</jmeterTestPlan>');

    return { xml: w.text(), samplers: samplers, disabled: disabled };
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
        label: 'JMeter test plan (.jmx)',
        run: function () {
          var doc = currentDoc();
          if (doc.swagger) throw new Error('convert the document to OpenAPI 3 first');
          var plan = toJmx(doc);
          var name = slug(doc) + '.jmx';
          download(name, 'application/xml', plan.xml);
          return 'JMeter 5.4.3 plan downloaded — ' + plan.samplers + ' samplers' +
            (plan.disabled ? ' (' + plan.disabled + ' write request' +
              (plan.disabled === 1 ? '' : 's') + ' left disabled)' : '') +
            ' · jmeter -n -t ' + name + ' -Jthreads=50 -Jrpm=6000 -l results.jtl';
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

  window.SduiExport = { init: init, toPostman: toPostman, toJmx: toJmx, standaloneHtml: standaloneHtml };
})();

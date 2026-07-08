/* Swagger Dark UI — in-browser mock backend.
   Wraps window.fetch: requests to MOCK_ORIGIN never reach the network.
   Responses are generated from the active OpenAPI document — the example
   (or schema-derived example) of the operation's success response when one
   is defined, otherwise an httpbin-style echo of the request. */
(function () {
  'use strict';

  var MOCK_ORIGIN = 'https://mock.local';
  var MOCK_DELAY_MS = 150;
  var MAX_DEPTH = 6;

  var activeSpec = null;

  /* ----- $ref resolution & example generation ----- */

  function resolveRef(node) {
    if (node && node.$ref && activeSpec && node.$ref.charAt(0) === '#') {
      var parts = node.$ref.slice(2).split('/');
      var cur = activeSpec;
      for (var i = 0; i < parts.length && cur; i++) {
        cur = cur[parts[i].replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      return cur || {};
    }
    return node;
  }

  function stringExample(schema) {
    switch (schema.format) {
      case 'date-time': return '2026-07-08T12:00:00Z';
      case 'date': return '2026-07-08';
      case 'uuid': return '3f8b0f1e-4a4e-4a3b-9a3e-2f6c7d8e9f00';
      case 'email': return 'user@example.com';
      case 'uri': case 'url': return 'https://example.com/resource';
      case 'hostname': return 'example.com';
      case 'ipv4': return '192.0.2.1';
      case 'byte': return 'bW9jaw==';
      case 'binary': return 'binary-data';
      case 'password': return '********';
      default: return 'string';
    }
  }

  function exampleFromSchema(schema, depth, seen) {
    schema = resolveRef(schema);
    if (!schema || depth > MAX_DEPTH || seen.indexOf(schema) !== -1) return undefined;
    seen = seen.concat([schema]);

    if (schema.const !== undefined) return schema.const;
    if (Object.prototype.toString.call(schema.examples) === '[object Array]' && schema.examples.length) {
      return schema.examples[0];
    }
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (schema.enum && schema.enum.length) return schema.enum[0];

    if (schema.allOf) {
      var merged = {};
      schema.allOf.forEach(function (sub) {
        var v = exampleFromSchema(sub, depth + 1, seen);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          Object.keys(v).forEach(function (k) { merged[k] = v[k]; });
        }
      });
      return merged;
    }
    if (schema.oneOf && schema.oneOf.length) return exampleFromSchema(schema.oneOf[0], depth + 1, seen);
    if (schema.anyOf && schema.anyOf.length) return exampleFromSchema(schema.anyOf[0], depth + 1, seen);

    var type = schema.type;
    if (Array.isArray(type)) {
      type = type.filter(function (t) { return t !== 'null'; })[0];
    }
    if (!type && schema.properties) type = 'object';

    switch (type) {
      case 'object': {
        var obj = {};
        var props = schema.properties || {};
        Object.keys(props).forEach(function (key) {
          var propSchema = resolveRef(props[key]);
          if (propSchema && propSchema.writeOnly) return;
          var v = exampleFromSchema(propSchema, depth + 1, seen);
          if (v !== undefined) obj[key] = v;
        });
        return obj;
      }
      case 'array': {
        var item = exampleFromSchema(schema.items || {}, depth + 1, seen);
        return item === undefined ? [] : [item];
      }
      case 'string': return stringExample(schema);
      case 'integer': return schema.minimum !== undefined ? schema.minimum : 42;
      case 'number': return schema.minimum !== undefined ? schema.minimum : 3.14;
      case 'boolean': return true;
      default: return undefined;
    }
  }

  /* ----- request matching ----- */

  function matchOperation(method, pathname) {
    if (!activeSpec || !activeSpec.paths) return null;
    var paths = Object.keys(activeSpec.paths);
    for (var i = 0; i < paths.length; i++) {
      var template = paths[i];
      var pattern = '^' + template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\{[^}]+\\\}/g, '[^/]+') + '/?$';
      if (new RegExp(pattern).test(pathname)) {
        var item = activeSpec.paths[template];
        var op = item[method.toLowerCase()];
        if (op) return { op: op, template: template };
      }
    }
    return null;
  }

  function pickStatus(op, forced) {
    var responses = op.responses || {};
    var codes = Object.keys(responses);
    if (forced && responses[forced]) return forced;
    var success = codes.filter(function (c) { return /^2/.test(c); }).sort();
    if (success.length) return success[0];
    if (responses['default']) return 'default';
    return null;
  }

  /* ----- response body construction ----- */

  function toXml(name, value) {
    if (Array.isArray(value)) {
      return value.map(function (v) { return toXml(name, v); }).join('');
    }
    if (value && typeof value === 'object') {
      var inner = Object.keys(value).map(function (k) { return toXml(k, value[k]); }).join('');
      return '<' + name + '>' + inner + '</' + name + '>';
    }
    var text = String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<' + name + '>' + text + '</' + name + '>';
  }

  function bodyFromResponse(response) {
    var content = response.content;
    if (!content) return null;
    var mediaTypes = Object.keys(content);
    if (!mediaTypes.length) return null;
    var mediaType = content['application/json'] ? 'application/json' : mediaTypes[0];
    var media = content[mediaType];

    var value;
    if (media.example !== undefined) {
      value = media.example;
    } else if (media.examples) {
      var first = Object.keys(media.examples)[0];
      if (first) {
        var ex = resolveRef(media.examples[first]);
        if (ex && ex.value !== undefined) value = ex.value;
      }
    }
    if (value === undefined && media.schema) {
      value = exampleFromSchema(media.schema, 0, []);
    }
    if (value === undefined) return null;

    if (mediaType.indexOf('json') !== -1) {
      return { contentType: mediaType, text: JSON.stringify(value, null, 2) };
    }
    if (mediaType.indexOf('xml') !== -1) {
      return {
        contentType: mediaType,
        text: '<?xml version="1.0" encoding="UTF-8"?>' + toXml('response', value)
      };
    }
    if (typeof value === 'object') {
      return { contentType: 'application/json', text: JSON.stringify(value, null, 2) };
    }
    return { contentType: mediaType, text: String(value) };
  }

  function headersFromResponse(response) {
    var headers = { 'X-Powered-By': 'swagger-dark-ui-mock' };
    var defs = response.headers || {};
    Object.keys(defs).forEach(function (name) {
      var def = resolveRef(defs[name]);
      var v = def.example !== undefined
        ? def.example
        : (def.schema ? exampleFromSchema(def.schema, 0, []) : undefined);
      if (v !== undefined) headers[name] = String(v);
    });
    return headers;
  }

  /* ----- request introspection (for echo responses) ----- */

  function headersToObject(headers) {
    var out = {};
    if (!headers) return out;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      headers.forEach(function (v, k) { out[k] = v; });
    } else {
      Object.keys(headers).forEach(function (k) { out[k] = String(headers[k]); });
    }
    return out;
  }

  function describeBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var form = {};
      body.forEach(function (v, k) {
        form[k] = (typeof File !== 'undefined' && v instanceof File)
          ? { filename: v.name, size: v.size, type: v.type }
          : String(v);
      });
      return { formData: form };
    }
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (e) { return body.slice(0, 4096); }
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      var params = {};
      body.forEach(function (v, k) { params[k] = v; });
      return { form: params };
    }
    return '[unsupported body type]';
  }

  function echoBody(method, urlObj, requestHeaders, body) {
    var query = {};
    urlObj.searchParams.forEach(function (v, k) { query[k] = v; });
    return JSON.stringify({
      mock: 'This response was generated in your browser — the request never left the page.',
      method: method,
      path: urlObj.pathname,
      query: query,
      headers: requestHeaders,
      body: describeBody(body)
    }, null, 2);
  }

  /* ----- the mock fetch ----- */

  function jsonResponse(status, obj, extraHeaders) {
    var headers = { 'Content-Type': 'application/json', 'X-Powered-By': 'swagger-dark-ui-mock' };
    Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });
    return new Response(JSON.stringify(obj, null, 2), { status: status, headers: headers });
  }

  function handleMockRequest(url, init) {
    var method = ((init && init.method) || 'GET').toUpperCase();
    var requestHeaders = headersToObject(init && init.headers);
    var urlObj = new URL(url);

    if (!activeSpec) {
      return jsonResponse(501, { error: 'No OpenAPI document is active for the in-browser mock.' });
    }
    var match = matchOperation(method, urlObj.pathname);
    if (!match) {
      return jsonResponse(404, {
        error: 'No operation matches ' + method + ' ' + urlObj.pathname + ' in the active OpenAPI document.'
      });
    }

    var forced = requestHeaders['x-mock-status'] || requestHeaders['X-Mock-Status'];
    var statusKey = pickStatus(match.op, forced);
    var response = statusKey ? resolveRef(match.op.responses[statusKey]) : {};
    var status = (!statusKey || statusKey === 'default') ? 200 : parseInt(statusKey, 10);

    var headers = headersFromResponse(response);
    if (status === 204 || status === 304 || method === 'HEAD') {
      return new Response(null, { status: status, headers: headers });
    }

    var body = bodyFromResponse(response);
    if (body) {
      headers['Content-Type'] = body.contentType;
      return new Response(body.text, { status: status, headers: headers });
    }
    headers['Content-Type'] = 'application/json';
    return new Response(echoBody(method, urlObj, requestHeaders, init && init.body),
      { status: status, headers: headers });
  }

  /* ----- install ----- */

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    if (url && url.indexOf(MOCK_ORIGIN) === 0) {
      if (typeof Request !== 'undefined' && input instanceof Request && !init) {
        // Swagger UI passes (url, init); handle Request objects defensively.
        return input.text().then(function (text) {
          return new Promise(function (resolve) {
            setTimeout(function () {
              resolve(handleMockRequest(url, {
                method: input.method,
                headers: input.headers,
                body: text || undefined
              }));
            }, MOCK_DELAY_MS);
          });
        });
      }
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(handleMockRequest(url, init)); }, MOCK_DELAY_MS);
      });
    }
    return realFetch(input, init);
  };

  window.SduiMock = {
    ORIGIN: MOCK_ORIGIN,
    setSpec: function (spec) { activeSpec = spec || null; }
  };
})();

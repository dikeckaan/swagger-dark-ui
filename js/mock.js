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

  /* In-memory CRUD store: collectionPath -> { byId, order, counter }.
     Intentionally not persisted — refreshing the page resets the data. */
  var store = {};

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

  /* ----- stateful CRUD ----- */

  function parseJsonBody(body) {
    if (typeof body !== 'string' || !body.length) return undefined;
    try {
      var v = JSON.parse(body);
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : undefined;
    } catch (e) { return undefined; }
  }

  function successResponseSchema(op) {
    var statusKey = pickStatus(op, null);
    if (!statusKey) return null;
    var response = resolveRef(op.responses[statusKey]);
    var content = response && response.content;
    if (!content) return null;
    var mt = content['application/json'] || content[Object.keys(content)[0]];
    return mt && mt.schema ? resolveRef(mt.schema) : null;
  }

  /* Schema of a single item: the success schema itself, or — for list
     envelopes like UserPage — the object-typed items of an array property.
     An array of scalars (e.g. a tags list on the item itself) is not an
     envelope, so its items are ignored. */
  function itemSchemaOf(schema) {
    if (!schema) return null;
    if (schema.type === 'array') return resolveRef(schema.items || {});
    var props = schema.properties || {};
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var p = resolveRef(props[keys[i]]);
      if (p && p.type === 'array') {
        var items = resolveRef(p.items || {});
        if (items && (items.type === 'object' || items.properties)) return items;
      }
    }
    return schema.properties ? schema : null;
  }

  function collectionOf(template) {
    // "/users/{userId}" -> { collection: "/users", isItem: true }
    var m = template.match(/^(.*)\/\{[^}]+\}$/);
    if (m) return { collection: m[1] || '/', isItem: true };
    return { collection: template, isItem: false };
  }

  function bucketFor(collection, create) {
    if (!store[collection] && create) {
      store[collection] = { byId: {}, order: [], counter: 100 };
    }
    return store[collection] || null;
  }

  function generateId(itemSchema, bucket) {
    var idSchema = itemSchema && itemSchema.properties && resolveRef(itemSchema.properties.id);
    if (idSchema && idSchema.type === 'integer') return ++bucket.counter;
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + (++bucket.counter);
  }

  function stampTimestamps(item, itemSchema) {
    var props = (itemSchema && itemSchema.properties) || {};
    ['createdAt', 'updatedAt'].forEach(function (key) {
      var p = props[key] && resolveRef(props[key]);
      if (p && p.format === 'date-time' && item[key] === undefined) {
        item[key] = new Date().toISOString();
      }
    });
  }

  function notFoundResponse(op) {
    var def = op.responses && op.responses['404'] && resolveRef(op.responses['404']);
    if (def) {
      var body = bodyFromResponse(def);
      if (body) {
        return new Response(body.text, {
          status: 404,
          headers: { 'Content-Type': body.contentType, 'X-Powered-By': 'swagger-dark-ui-mock' }
        });
      }
    }
    return jsonResponse(404, { error: 'No stored item with that id in the in-browser mock.' });
  }

  /* Returns a Response when the stateful CRUD heuristics apply, else null
     (caller falls back to the example/echo behavior). */
  function statefulResponse(method, match, urlObj, body) {
    var route = collectionOf(match.template);
    var op = match.op;

    if (!route.isItem) {
      if (method === 'POST') {
        var payload = parseJsonBody(body);
        if (!payload) return null;
        var itemSchema = itemSchemaOf(successResponseSchema(op)) || {};
        var bucket = bucketFor(route.collection, true);
        var item = {};
        Object.keys(payload).forEach(function (k) { item[k] = payload[k]; });
        if (item.id === undefined) item.id = generateId(itemSchema, bucket);
        stampTimestamps(item, itemSchema);
        var id = String(item.id);
        if (!bucket.byId[id]) bucket.order.push(id);
        bucket.byId[id] = item;
        var statusKey = pickStatus(op, null);
        return jsonResponse(statusKey && statusKey !== 'default' ? parseInt(statusKey, 10) : 201, item);
      }
      if (method === 'GET') {
        var listBucket = bucketFor(route.collection, false);
        if (!listBucket || !listBucket.order.length) return null; // untouched → showcase example
        var items = listBucket.order.map(function (id) { return listBucket.byId[id]; });
        var schema = successResponseSchema(op);
        if (schema && schema.type !== 'array' && schema.properties) {
          var envelope = exampleFromSchema(schema, 0, []) || {};
          var props = schema.properties;
          Object.keys(props).forEach(function (k) {
            var p = resolveRef(props[k]);
            if (p && p.type === 'array') envelope[k] = items;
          });
          if (props.total) envelope.total = items.length;
          if (props.page) envelope.page = 1;
          if (props.pageSize) envelope.pageSize = items.length;
          return jsonResponse(200, envelope);
        }
        return jsonResponse(200, items);
      }
      return null;
    }

    // item routes: /collection/{id}
    var itemBucket = bucketFor(route.collection, false);
    if (!itemBucket) return null; // nothing stored yet → default behavior
    var itemId = decodeURIComponent(urlObj.pathname.replace(/\/$/, '').split('/').pop());
    var existing = itemBucket.byId[itemId];

    if (method === 'GET') {
      return existing ? jsonResponse(200, existing) : notFoundResponse(op);
    }
    if (method === 'PUT' || method === 'PATCH') {
      var update = parseJsonBody(body);
      if (!update) return existing ? null : notFoundResponse(op);
      if (!existing) return notFoundResponse(op);
      var next = method === 'PUT' ? { id: existing.id } : Object.assign({}, existing);
      Object.keys(update).forEach(function (k) { next[k] = update[k]; });
      next.id = existing.id;
      if (existing.createdAt && next.createdAt === undefined) next.createdAt = existing.createdAt;
      itemBucket.byId[itemId] = next;
      return jsonResponse(200, next);
    }
    if (method === 'DELETE') {
      if (!existing) return notFoundResponse(op);
      delete itemBucket.byId[itemId];
      itemBucket.order = itemBucket.order.filter(function (id) { return id !== itemId; });
      return new Response(null, { status: 204, headers: { 'X-Powered-By': 'swagger-dark-ui-mock' } });
    }
    return null;
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

    if (!forced) {
      var stateful = statefulResponse(method, match, urlObj, init && init.body);
      if (stateful) return stateful;
    }

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

  function delayFor(init) {
    var h = headersToObject(init && init.headers);
    var d = parseInt(h['x-mock-delay'] || h['X-Mock-Delay'], 10);
    if (isNaN(d)) return MOCK_DELAY_MS;
    return Math.max(0, Math.min(5000, d));
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    if (url && url.indexOf(MOCK_ORIGIN) === 0) {
      if (typeof Request !== 'undefined' && input instanceof Request && !init) {
        // Swagger UI passes (url, init); handle Request objects defensively.
        return input.text().then(function (text) {
          var reqInit = { method: input.method, headers: input.headers, body: text || undefined };
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(handleMockRequest(url, reqInit)); }, delayFor(reqInit));
          });
        });
      }
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(handleMockRequest(url, init)); }, delayFor(init));
      });
    }
    return realFetch(input, init);
  };

  var lastPathsSignature = null;
  window.SduiMock = {
    ORIGIN: MOCK_ORIGIN,
    setSpec: function (spec) {
      activeSpec = spec || null;
      // Reset stored data only when the set of paths actually changes —
      // the editor re-sets the spec on every keystroke.
      var sig = spec && spec.paths ? Object.keys(spec.paths).sort().join('|') : '';
      if (sig !== lastPathsSignature) {
        store = {};
        lastPathsSignature = sig;
      }
    }
  };
})();

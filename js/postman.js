/* Swagger Dark UI — Postman Collection (v2 / v2.1+) to OpenAPI 3 converter.
   Best-effort, in-browser: folders become tags, requests become operations,
   saved responses become response examples, collection/request auth becomes
   security schemes. Postman {{variables}} and :path segments are mapped to
   OpenAPI {placeholders}. */
(function () {
  'use strict';

  /* Returns 'v2' for convertible collections, 'v1' for legacy exports we
     cannot convert, null for anything that is not a Postman collection.
     Accepts either a parsed object or raw JSON text. */
  function detect(input) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return null; }
    }
    if (!obj || typeof obj !== 'object') return null;

    var schema = String((obj.info && (obj.info.schema || obj.info._postman_schema)) || '');
    if (obj.info && Array.isArray(obj.item)) {
      if (/collection\/v2|#2\./.test(schema)) return 'v2';
      // Schema-less but v2-shaped: folders/requests under `item` entries.
      if (!schema && obj.info.name &&
          obj.item.some(function (it) { return it && (it.request || Array.isArray(it.item)); })) {
        return 'v2';
      }
    }
    // v1 exports have no `item` tree; requests live in flat arrays.
    if (obj.name && (Array.isArray(obj.requests) || Array.isArray(obj.order) || Array.isArray(obj.folders)) &&
        !Array.isArray(obj.item)) {
      return 'v1';
    }
    return null;
  }

  function isPostmanCollection(obj) {
    return detect(obj) === 'v2';
  }

  function descriptionText(d) {
    if (!d) return undefined;
    if (typeof d === 'string') return d;
    if (typeof d.content === 'string') return d.content;
    return undefined;
  }

  function slug(name) {
    return String(name || 'operation')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'operation';
  }

  /* {{var}} → {var}, :var → {var} */
  function normalizeSegment(seg) {
    return String(seg)
      .replace(/\{\{([^}]+)\}\}/g, function (m, v) { return '{' + slug(v) + '}'; })
      .replace(/^:(.+)$/, '{$1}');
  }

  function parseUrl(url) {
    if (!url) return { path: '/', query: [], variables: [] };
    if (typeof url === 'string') url = { raw: url };

    var segments;
    if (Array.isArray(url.path)) {
      segments = url.path.slice();
    } else {
      var raw = String(url.raw || '/');
      raw = raw.split('?')[0].split('#')[0];
      raw = raw.replace(/^https?:\/\/[^/]+/i, '').replace(/^\{\{[^}]+\}\}/, '');
      segments = raw.split('/').filter(Boolean);
    }
    var path = '/' + segments.map(normalizeSegment).filter(Boolean).join('/');
    if (path === '/' && segments.length === 0) path = '/';
    return {
      path: path,
      query: Array.isArray(url.query) ? url.query : [],
      variables: Array.isArray(url.variable) ? url.variable : []
    };
  }

  function authValue(auth, type, key) {
    var section = auth[type];
    if (Array.isArray(section)) {
      for (var i = 0; i < section.length; i++) {
        if (section[i] && section[i].key === key) return section[i].value;
      }
      return undefined;
    }
    return section ? section[key] : undefined;
  }

  /* Returns { schemeName, scheme } or null. */
  function authToScheme(auth) {
    if (!auth || !auth.type || auth.type === 'noauth') return null;
    switch (auth.type) {
      case 'bearer':
        return { name: 'BearerAuth', scheme: { type: 'http', scheme: 'bearer' } };
      case 'basic':
        return { name: 'BasicAuth', scheme: { type: 'http', scheme: 'basic' } };
      case 'apikey': {
        var where = authValue(auth, 'apikey', 'in') === 'query' ? 'query' : 'header';
        return {
          name: 'ApiKeyAuth',
          scheme: {
            type: 'apiKey',
            name: authValue(auth, 'apikey', 'key') || 'X-API-Key',
            in: where
          }
        };
      }
      case 'oauth2': {
        // Postman {{variable}} URLs are placeholders, not real endpoints —
        // swap them for example URLs the user can fill in.
        var urlOr = function (value, fallback) {
          value = value === undefined || value === null ? '' : String(value);
          return value && value.indexOf('{{') === -1 ? value : fallback;
        };
        var grant = String(authValue(auth, 'oauth2', 'grant_type') || 'authorization_code');
        var flowKey = grant.indexOf('client_credentials') !== -1 ? 'clientCredentials'
          : grant.indexOf('password') !== -1 ? 'password'
            : grant === 'implicit' ? 'implicit' : 'authorizationCode';
        var scopes = {};
        String(authValue(auth, 'oauth2', 'scope') || '').split(/\s+/).forEach(function (s) {
          if (s) scopes[s] = '';
        });
        var flow = { scopes: scopes };
        if (flowKey !== 'implicit') {
          flow.tokenUrl = urlOr(authValue(auth, 'oauth2', 'accessTokenUrl'), 'https://auth.example.com/oauth/token');
        }
        if (flowKey === 'authorizationCode' || flowKey === 'implicit') {
          flow.authorizationUrl = urlOr(authValue(auth, 'oauth2', 'authUrl'), 'https://auth.example.com/oauth/authorize');
        }
        var flows = {};
        flows[flowKey] = flow;
        return { name: 'OAuth2', scheme: { type: 'oauth2', flows: flows } };
      }
      default:
        return null; // oauth1/digest/ntlm etc. — not mapped
    }
  }

  function tryParseJson(text) {
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }

  function bodyToRequestBody(body) {
    if (!body || !body.mode) return undefined;
    if (body.mode === 'raw') {
      var lang = body.options && body.options.raw && body.options.raw.language;
      var raw = body.raw || '';
      var parsed = tryParseJson(raw);
      if (parsed !== undefined && (lang === 'json' || lang === undefined)) {
        return { content: { 'application/json': { schema: { type: typeof parsed === 'object' ? (Array.isArray(parsed) ? 'array' : 'object') : 'string' }, example: parsed } } };
      }
      var mediaType = lang === 'xml' ? 'application/xml' : 'text/plain';
      return { content: (function () { var c = {}; c[mediaType] = { schema: { type: 'string' }, example: raw }; return c; })() };
    }
    if (body.mode === 'urlencoded' || body.mode === 'formdata') {
      var props = {};
      var required = [];
      (body[body.mode] || []).forEach(function (f) {
        if (!f || f.disabled) return;
        props[f.key] = f.type === 'file'
          ? { type: 'string', format: 'binary' }
          : { type: 'string', example: f.value || undefined, description: descriptionText(f.description) };
        required.push(f.key);
      });
      var mt = body.mode === 'formdata' ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
      var content = {};
      content[mt] = { schema: { type: 'object', properties: props, required: required.length ? required : undefined } };
      return { content: content };
    }
    if (body.mode === 'graphql') {
      var g = body.graphql || {};
      return { content: { 'application/json': { schema: { type: 'object' }, example: { query: g.query || '', variables: tryParseJson(g.variables) || {} } } } };
    }
    return undefined;
  }

  /* Transport/noise headers that would clutter a response's documented
     headers (Content-Type is already the media type key). */
  var NOISE_HEADERS = /^(content-type|content-length|content-encoding|date|connection|server|transfer-encoding|keep-alive|vary|etag|age|x-powered-by|access-control-|cf-|set-cookie|strict-transport-security|alt-svc|nel|report-to|x-content-type-options|x-frame-options|x-xss-protection)/i;

  function responsesFromSaved(saved) {
    // Group by status code, then media type: several saved responses can
    // document VARIANTS of the same status — those become OpenAPI's named
    // "examples" map (rendered as a dropdown), a single one stays a plain
    // "example". Meaningful response headers are kept as response headers.
    var byCode = {};
    (saved || []).forEach(function (res) {
      if (!res) return;
      var code = String(res.code || 200);
      var mediaType = 'application/json';
      (res.header || []).forEach(function (h) {
        if (h && /^content-type$/i.test(h.key)) mediaType = String(h.value).split(';')[0].trim();
      });
      var entry = byCode[code] || (byCode[code] = { names: [], status: undefined, media: {}, headers: {} });
      entry.names.push(res.name);
      if (res.status && !entry.status) entry.status = res.status;
      (res.header || []).forEach(function (h) {
        if (!h || !h.key || NOISE_HEADERS.test(h.key) || entry.headers[h.key]) return;
        entry.headers[h.key] = {
          schema: { type: 'string' },
          example: h.value || undefined
        };
      });
      var body = res.body;
      if (body === undefined || body === null || body === '') return;
      var example = mediaType.indexOf('json') !== -1 && tryParseJson(body) !== undefined
        ? tryParseJson(body) : body;
      (entry.media[mediaType] = entry.media[mediaType] || []).push({ name: res.name, example: example });
    });

    var responses = {};
    Object.keys(byCode).forEach(function (code) {
      var e = byCode[code];
      var single = e.names.length === 1;
      var out = { description: (single && e.names[0]) || e.status || 'Response' };
      Object.keys(e.media).forEach(function (mt) {
        var list = e.media[mt];
        out.content = out.content || {};
        if (list.length === 1) {
          out.content[mt] = { example: list[0].example };
        } else {
          var examples = {};
          var used = {};
          list.forEach(function (item, i) {
            var name = item.name || 'Example ' + (i + 1);
            if (used[name]) name += ' (' + (++used[name]) + ')';
            else used[name] = 1;
            examples[name] = { value: item.example };
          });
          out.content[mt] = { examples: examples };
        }
      });
      if (Object.keys(e.headers).length) out.headers = e.headers;
      responses[code] = out;
    });
    if (!Object.keys(responses).length) {
      responses['200'] = { description: 'Successful response' };
    }
    return responses;
  }

  function convert(collection) {
    var oas = {
      openapi: '3.0.3',
      info: {
        title: (collection.info && collection.info.name) || 'Imported Postman Collection',
        version: (collection.info && collection.info.version &&
          (collection.info.version.string || collection.info.version)) || '1.0.0',
        description: descriptionText(collection.info && collection.info.description)
      },
      servers: [],
      tags: [],
      paths: {},
      components: { securitySchemes: {} }
    };

    var baseUrl = 'https://api.example.com';
    (collection.variable || []).forEach(function (v) {
      if (v && (v.key === 'baseUrl' || v.key === 'base_url' || v.key === 'host') && v.value) {
        baseUrl = v.value;
      }
    });
    oas.servers.push({ url: baseUrl });

    var collectionAuth = authToScheme(collection.auth);
    if (collectionAuth) oas.components.securitySchemes[collectionAuth.name] = collectionAuth.scheme;

    var usedOperationIds = {};

    function addRequest(item, tag) {
      var request = item.request;
      if (typeof request === 'string') request = { url: request, method: 'GET' };
      if (!request) return;

      var method = String(request.method || 'GET').toLowerCase();
      var parsedUrl = parseUrl(request.url);
      var op = {
        summary: item.name,
        description: descriptionText(request.description),
        responses: responsesFromSaved(item.response)
      };
      if (tag) op.tags = [tag];

      var opId = slug(item.name);
      if (usedOperationIds[opId]) opId += '-' + (++usedOperationIds[opId]);
      else usedOperationIds[opId] = 1;
      op.operationId = opId;

      var params = [];
      parsedUrl.variables.forEach(function (v) {
        if (!v || !v.key) return;
        params.push({
          name: v.key, in: 'path', required: true,
          description: descriptionText(v.description),
          schema: { type: 'string', example: v.value || undefined }
        });
      });
      // path template placeholders that came from :segments / {{vars}}
      (parsedUrl.path.match(/\{([^}]+)\}/g) || []).forEach(function (m) {
        var name = m.slice(1, -1);
        if (!params.some(function (p) { return p.in === 'path' && p.name === name; })) {
          params.push({ name: name, in: 'path', required: true, schema: { type: 'string' } });
        }
      });
      parsedUrl.query.forEach(function (q) {
        if (!q || !q.key || q.disabled) return;
        params.push({
          name: q.key, in: 'query',
          description: descriptionText(q.description),
          schema: { type: 'string', example: q.value || undefined }
        });
      });
      var sawAuthorizationHeader = false;
      (request.header || []).forEach(function (h) {
        if (!h || !h.key || h.disabled) return;
        // OpenAPI ignores header parameters named Content-Type, Accept and
        // Authorization — the first two are implied by requestBody/response
        // "content", the last belongs in securitySchemes. Emitting them
        // would only trip the linter, so they are dropped here (a raw
        // Authorization header still becomes a bearer security scheme).
        if (/^(content-type|accept)$/i.test(h.key)) return;
        if (/^authorization$/i.test(h.key)) {
          sawAuthorizationHeader = true;
          return;
        }
        params.push({
          name: h.key, in: 'header',
          description: descriptionText(h.description),
          schema: { type: 'string', example: h.value || undefined }
        });
      });
      if (params.length) op.parameters = params;

      var requestBody = bodyToRequestBody(request.body);
      if (requestBody) op.requestBody = requestBody;

      var auth = authToScheme(request.auth) || collectionAuth;
      if (!auth && sawAuthorizationHeader) {
        auth = { name: 'BearerAuth', scheme: { type: 'http', scheme: 'bearer' } };
      }
      if (auth) {
        oas.components.securitySchemes[auth.name] = auth.scheme;
        var sec = {};
        sec[auth.name] = [];
        op.security = [sec];
      }

      if (!oas.paths[parsedUrl.path]) oas.paths[parsedUrl.path] = {};
      oas.paths[parsedUrl.path][method] = op;
    }

    function walk(items, tag) {
      (items || []).forEach(function (item) {
        if (!item) return;
        if (Array.isArray(item.item)) {
          var childTag = tag || item.name;
          if (!tag && item.name && !oas.tags.some(function (t) { return t.name === item.name; })) {
            oas.tags.push({ name: item.name, description: descriptionText(item.description) });
          }
          walk(item.item, childTag);
        } else if (item.request) {
          addRequest(item, tag);
        }
      });
    }
    walk(collection.item, null);

    if (!oas.tags.length) delete oas.tags;
    if (!Object.keys(oas.components.securitySchemes).length) delete oas.components;
    if (!oas.info.description) delete oas.info.description;

    return oas;
  }

  /* Public API.
     detect(textOrObject) -> 'v2' | 'v1' | null
     tryConvert(text) -> { name, yaml } for v2+ collections, else null. */
  window.SduiPostman = {
    detect: detect,
    tryConvert: function (text) {
      var obj;
      try { obj = JSON.parse(text); } catch (e) { return null; }
      if (!isPostmanCollection(obj)) return null;
      var oas = convert(obj);
      return {
        name: oas.info.title,
        yaml: jsyaml.dump(oas, { lineWidth: 110, noRefs: true, skipInvalid: true })
      };
    }
  };
})();

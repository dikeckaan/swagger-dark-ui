/* Swagger Dark UI — context-aware OpenAPI autocomplete for the YAML editor.
   Walks the document's indentation to figure out where the cursor is
   (operation? parameter? schema?) and offers the keys valid there, plus
   value completions for enums ("in:", "type:", "format:", …), media types,
   response codes, defined security-scheme names and $ref targets.
   Requires the CodeMirror show-hint addon. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  var KEYS = {
    root: ['openapi', 'info', 'servers', 'paths', 'components', 'security', 'tags',
      'externalDocs', 'webhooks', 'jsonSchemaDialect'],
    info: ['title', 'version', 'summary', 'description', 'termsOfService', 'contact', 'license'],
    contact: ['name', 'url', 'email'],
    license: ['name', 'identifier', 'url'],
    pathItem: METHODS.concat(['summary', 'description', 'parameters', 'servers', '$ref']),
    operation: ['tags', 'summary', 'description', 'operationId', 'parameters', 'requestBody',
      'responses', 'security', 'deprecated', 'servers', 'callbacks', 'externalDocs'],
    parameter: ['name', 'in', 'description', 'required', 'schema', 'example', 'examples',
      'deprecated', 'style', 'explode', 'allowEmptyValue', 'allowReserved', 'content', '$ref'],
    header: ['description', 'required', 'schema', 'example', 'examples', 'deprecated',
      'style', 'explode', 'content', '$ref'],
    requestBody: ['description', 'content', 'required', '$ref'],
    response: ['description', 'headers', 'content', 'links', '$ref'],
    mediaType: ['schema', 'example', 'examples', 'encoding'],
    schema: ['type', 'format', 'description', 'properties', 'items', 'required', 'enum',
      'example', 'default', '$ref', 'nullable', 'allOf', 'oneOf', 'anyOf', 'not',
      'additionalProperties', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
      'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
      'readOnly', 'writeOnly', 'deprecated', 'discriminator', 'title', 'const'],
    components: ['schemas', 'responses', 'parameters', 'examples', 'requestBodies',
      'headers', 'securitySchemes', 'links', 'callbacks', 'pathItems'],
    securityScheme: ['type', 'description', 'name', 'in', 'scheme', 'bearerFormat',
      'flows', 'openIdConnectUrl'],
    flows: ['implicit', 'password', 'clientCredentials', 'authorizationCode'],
    flow: ['authorizationUrl', 'tokenUrl', 'refreshUrl', 'scopes'],
    server: ['url', 'description', 'variables'],
    serverVariable: ['default', 'description', 'enum'],
    tag: ['name', 'description', 'externalDocs'],
    externalDocs: ['description', 'url'],
    exampleObj: ['summary', 'description', 'value', 'externalValue'],
    link: ['operationRef', 'operationId', 'parameters', 'requestBody', 'description', 'server'],
    encodingItem: ['contentType', 'headers', 'style', 'explode', 'allowReserved']
  };

  var VALUES = {
    'in': ['query', 'header', 'path', 'cookie'],
    type: ['string', 'integer', 'number', 'boolean', 'array', 'object'],
    format: ['int32', 'int64', 'float', 'double', 'byte', 'binary', 'date', 'date-time',
      'password', 'uuid', 'email', 'uri', 'hostname', 'ipv4', 'ipv6'],
    style: ['form', 'simple', 'label', 'matrix', 'spaceDelimited', 'pipeDelimited', 'deepObject'],
    scheme: ['basic', 'bearer', 'digest'],
    openapi: ['3.0.3', '3.1.0'],
    required: ['true', 'false'],
    deprecated: ['true', 'false'],
    explode: ['true', 'false'],
    nullable: ['true', 'false'],
    readOnly: ['true', 'false'],
    writeOnly: ['true', 'false'],
    uniqueItems: ['true', 'false'],
    allowEmptyValue: ['true', 'false'],
    allowReserved: ['true', 'false']
  };
  var SCHEME_TYPES = ['apiKey', 'http', 'oauth2', 'openIdConnect', 'mutualTLS'];

  var MEDIA_TYPES = ['application/json', 'application/xml', 'application/x-www-form-urlencoded',
    'multipart/form-data', 'text/plain', 'application/octet-stream', 'text/html', 'image/png'];
  var STATUS_CODES = ['200', '201', '202', '204', '301', '302', '304', '400', '401', '403',
    '404', '405', '409', '422', '429', '500', '502', '503', 'default'];

  function indentOf(line) { return (line.match(/^ */) || [''])[0].length; }
  function isBlank(line) { var t = line.trim(); return !t || t.charAt(0) === '#'; }

  /* Stack of enclosing mapping keys above the cursor. List items appear as
     the pseudo-key '[]', so ['paths','/a','get','parameters','[]'] means
     "inside one entry of the parameters list". */
  function stackAt(cm, lineNo, effIndent) {
    var stack = [];
    for (var i = 0; i < lineNo; i++) {
      var line = cm.getLine(i);
      if (isBlank(line)) continue;
      var ind = indentOf(line);
      var text = line.slice(ind);
      while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
      if (/^-(\s|$)/.test(text)) {
        stack.push({ indent: ind, key: '[]' });
        text = text.replace(/^-\s*/, '');
        ind = line.length - text.length;
      }
      var m = text.match(/^["']?([^"'#]*?)["']?\s*:(\s|$)/);
      if (m && stack.length < 40) stack.push({ indent: ind, key: m[1] });
    }
    while (stack.length && stack[stack.length - 1].indent >= effIndent) stack.pop();
    return stack.map(function (e) { return e.key; });
  }

  function endsWith(stack, tail) {
    if (stack.length < tail.length) return false;
    for (var i = 0; i < tail.length; i++) {
      var want = tail[tail.length - 1 - i];
      var got = stack[stack.length - 1 - i];
      if (want === '*') continue;
      if (want !== got) return false;
    }
    return true;
  }

  function isMime(key) { return /^[\w.+-]+\/[\w.+*-]+$/.test(key); }

  /* Which keys are valid inside the mapping the cursor is in. */
  function keysFor(stack, doc) {
    if (!stack.length) return { list: KEYS.root };
    var top = stack[stack.length - 1];

    // Schema contexts (deepest checks first).
    if (top === 'properties' || top === 'patternProperties' || top === 'scopes' ||
        top === 'variables' || top === 'headers' || top === 'callbacks' ||
        top === 'webhooks' || top === 'paths' || top === 'definitions' || top === '$defs') {
      if (top === 'paths') return { list: [], hint: '/' };
      if (top === 'headers') return { list: [] };
      if (top === 'variables') return { list: [] };
      return { list: [] }; // free-form names
    }
    if (top === 'schema' || top === 'items' || top === 'additionalProperties' || top === 'not' ||
        endsWith(stack, ['properties', '*']) || endsWith(stack, ['patternProperties', '*']) ||
        endsWith(stack, ['allOf', '[]']) || endsWith(stack, ['anyOf', '[]']) ||
        endsWith(stack, ['oneOf', '[]']) || endsWith(stack, ['prefixItems', '[]']) ||
        endsWith(stack, ['components', 'schemas', '*']) ||
        endsWith(stack, ['definitions', '*']) || endsWith(stack, ['$defs', '*'])) {
      return { list: KEYS.schema };
    }

    if (top === 'info') return { list: KEYS.info };
    if (top === 'contact') return { list: KEYS.contact };
    if (top === 'license') return { list: KEYS.license };
    if (top === 'components') return { list: KEYS.components };
    if (top === 'requestBody') return { list: KEYS.requestBody };
    if (top === 'content') return { list: MEDIA_TYPES, quoteless: true };
    if (isMime(top) && stack[stack.length - 2] === 'content') return { list: KEYS.mediaType };
    if (top === 'responses') return { list: STATUS_CODES, quote: true };
    if (endsWith(stack, ['responses', '*'])) return { list: KEYS.response };
    if (endsWith(stack, ['parameters', '[]'])) return { list: KEYS.parameter };
    if (endsWith(stack, ['headers', '*'])) return { list: KEYS.header };
    if (top === 'flows') return { list: KEYS.flows };
    if (endsWith(stack, ['flows', '*'])) return { list: KEYS.flow };
    if (top === 'securitySchemes') return { list: [] };
    if (endsWith(stack, ['securitySchemes', '*'])) return { list: KEYS.securityScheme };
    if (endsWith(stack, ['security', '[]'])) {
      var schemes = doc && doc.components && doc.components.securitySchemes;
      return { list: schemes ? Object.keys(schemes) : [] };
    }
    if (endsWith(stack, ['servers', '[]'])) return { list: KEYS.server };
    if (endsWith(stack, ['variables', '*'])) return { list: KEYS.serverVariable };
    if (endsWith(stack, ['tags', '[]'])) return { list: KEYS.tag };
    if (top === 'externalDocs') return { list: KEYS.externalDocs };
    if (endsWith(stack, ['examples', '*'])) return { list: KEYS.exampleObj };
    if (endsWith(stack, ['links', '*'])) return { list: KEYS.link };
    if (endsWith(stack, ['encoding', '*'])) return { list: KEYS.encodingItem };
    if (endsWith(stack, ['components', 'requestBodies', '*'])) return { list: KEYS.requestBody };
    if (endsWith(stack, ['components', 'responses', '*'])) return { list: KEYS.response };
    if (endsWith(stack, ['components', 'parameters', '*'])) return { list: KEYS.parameter };
    if (METHODS.indexOf(top) !== -1 && stack.length >= 2) return { list: KEYS.operation };
    if (stack.length >= 2 && stack[stack.length - 2] === 'paths') return { list: KEYS.pathItem };
    if (stack.length >= 2 && stack[stack.length - 2] === 'webhooks') return { list: KEYS.pathItem };
    return null;
  }

  /* Completions for the VALUE after "key: ". */
  function valuesFor(key, stack, doc) {
    if (key === '$ref') {
      var refs = [];
      var c = doc && doc.components;
      if (c) {
        ['schemas', 'responses', 'parameters', 'requestBodies', 'headers', 'examples', 'links'].forEach(function (sec) {
          if (c[sec] && typeof c[sec] === 'object') {
            Object.keys(c[sec]).forEach(function (n) {
              refs.push("'#/components/" + sec + '/' + n + "'");
            });
          }
        });
      }
      return refs;
    }
    if (key === 'type') {
      if (endsWith(stack, ['securitySchemes', '*'])) return SCHEME_TYPES;
      return VALUES.type;
    }
    if (key === 'required' && !endsWith(stack, ['parameters', '[]']) &&
        !endsWith(stack, ['headers', '*']) && stack[stack.length - 1] !== 'requestBody') {
      return null; // in schemas "required" is an array of names, not a boolean
    }
    return VALUES[key] || null;
  }

  function hint(cm) {
    var cur = cm.getCursor();
    var line = cm.getLine(cur.line);
    var before = line.slice(0, cur.ch);

    var doc = null;
    function parsedDoc() {
      if (doc !== null) return doc;
      try {
        doc = jsyaml.load(cm.getValue()) || {};
      } catch (e) {
        // The half-typed current line often breaks the parse (e.g. an
        // unclosed quote) — blank it out and try again.
        var all = cm.getValue().split('\n');
        all[cur.line] = '';
        try { doc = jsyaml.load(all.join('\n')) || {}; } catch (e2) { doc = {}; }
      }
      return doc;
    }

    // VALUE position: "  key: par|"
    var vm = before.match(/^(\s*(?:-\s+)?)["']?([\w$./{}-]+)["']?\s*:\s+(.*)$/);
    if (vm) {
      var word = vm[3];
      var effIndent = vm[1].length;
      var stack = stackAt(cm, cur.line, effIndent);
      if (/^-\s+/.test(vm[1])) stack.push('[]');
      var options = valuesFor(vm[2], stack, parsedDoc());
      if (!options || !options.length) return null;
      var lower = word.toLowerCase().replace(/^['"]/, '');
      var list = options.filter(function (v) {
        return v.toLowerCase().replace(/^['"]/, '').indexOf(lower) === 0 && v !== word;
      });
      if (!list.length) return null;
      return {
        list: list,
        from: { line: cur.line, ch: cur.ch - word.length },
        to: { line: cur.line, ch: cur.ch }
      };
    }

    // KEY position: "    par|" (no colon yet before the cursor)
    var km = before.match(/^(\s*)(-\s+)?["']?([\w$./{}-]*)$/);
    if (!km) return null;
    var prefix = km[3];
    var effIndent2 = km[1].length + (km[2] ? km[2].length : 0);
    var stack2 = stackAt(cm, cur.line, km[1].length);
    if (km[2]) stack2.push('[]');
    var ctx = keysFor(stack2, parsedDoc());
    if (!ctx || !ctx.list.length) return null;
    var lowerP = prefix.toLowerCase();
    var list2 = ctx.list.filter(function (k) {
      return k.toLowerCase().indexOf(lowerP) === 0;
    }).map(function (k) {
      if (ctx.quote) return "'" + k + "':" + ' ';
      return k + ': ';
    });
    if (!list2.length) return null;
    return {
      list: list2,
      from: { line: cur.line, ch: cur.ch - prefix.length },
      to: { line: cur.line, ch: cur.ch }
    };
  }

  function init(cm) {
    cm.setOption('extraKeys', Object.assign({}, cm.getOption('extraKeys'), {
      'Ctrl-Space': function (c) { c.showHint({ hint: hint, completeSingle: false }); }
    }));
    cm.on('inputRead', function (c, change) {
      if (c.state.completionActive) return;
      var text = change.text && change.text[0];
      if (!text || !/^[\w$/#'-]$/.test(text)) return;
      c.showHint({ hint: hint, completeSingle: false });
    });
  }

  window.SduiComplete = { init: init, hint: hint, _stackAt: stackAt, _keysFor: keysFor, _valuesFor: valuesFor };
})();

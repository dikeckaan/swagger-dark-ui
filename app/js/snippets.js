/* Swagger Dark UI — "Insert" menu for the YAML editor.
   Inserts ready-made OpenAPI building blocks (endpoints, operations,
   parameters, responses, schemas, security schemes…) into the right spot
   of the document by walking its indentation, so users don't have to
   remember the spec's structure. Text-splicing only — comments and
   formatting elsewhere in the document are untouched. */
(function () {
  'use strict';

  var METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  /* ================= text helpers ================= */

  function indentOf(line) { return (line.match(/^ */) || [''])[0].length; }
  function isBlank(line) { var t = line.trim(); return !t || t.charAt(0) === '#'; }
  function pad(n) { return new Array(n + 1).join(' '); }

  function blockEnd(lines, start, parentIndent) {
    for (var i = start; i < lines.length; i++) {
      if (!isBlank(lines[i]) && indentOf(lines[i]) <= parentIndent) return i;
    }
    return lines.length;
  }

  /* Index just after the last non-blank line in [start, end) — the natural
     append position for a block (keeps trailing blank lines below it). */
  function appendAt(lines, start, end) {
    for (var i = end - 1; i >= start; i--) {
      if (!isBlank(lines[i]) || lines[i].trim().charAt(0) === '#') {
        if (lines[i].trim()) return i + 1;
      }
    }
    return start;
  }

  function keyRegex(key) {
    var esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^["\']?' + esc + '["\']?\\s*:');
  }

  /* First direct-child indent of the mapping under keyLine (default +2). */
  function childIndent(lines, keyLine, end) {
    var parent = indentOf(lines[keyLine]);
    for (var i = keyLine + 1; i < end; i++) {
      if (!isBlank(lines[i]) && indentOf(lines[i]) > parent) return indentOf(lines[i]);
    }
    return parent + 2;
  }

  /* Find key as a direct child of the region: first match at the region's
     child indent (or any indent > parentIndent if the block is ragged). */
  function findChild(lines, key, start, end, parentIndent) {
    var re = keyRegex(key);
    var want = -1;
    for (var i = start; i < end; i++) {
      if (isBlank(lines[i])) continue;
      var ind = indentOf(lines[i]);
      if (ind <= parentIndent) break;
      if (want === -1) want = ind; // first child sets the expected indent
      if (ind === want && re.test(lines[i].slice(ind))) return i;
    }
    return -1;
  }

  /* Classify what follows "key:" on a section line. Block-style sections can
     take appended children; empty flow values ({} / []) can be cleared to
     make room; anything else means the section can't be extended by lines. */
  function sectionValue(line) {
    var m = line.match(/:\s*(.*)$/);
    var rest = m ? m[1].trim() : '';
    if (!rest || rest.charAt(0) === '#') return 'block';
    if (/^\{\s*\}\s*(#.*)?$/.test(rest) || /^\[\s*\]\s*(#.*)?$/.test(rest)) return 'emptyFlow';
    return 'flow';
  }

  function stripEmptyFlow(line) {
    return line.replace(/:\s*(\{\s*\}|\[\s*\])\s*(#.*)?$/, ':');
  }

  /* Walk (and create, in `header`) a chain of mapping keys from the root,
     e.g. ['components', 'schemas']. Returns where new content goes:
     { at, indent, header: [lines-to-prepend], edits: [{at, text}] }
     — or { error } when a section is written in non-empty flow style. */
  function ensureChain(lines, keys) {
    var start = 0;
    var end = lines.length;
    var parentIndent = -1;
    var indent = 0;
    var edits = [];
    for (var k = 0; k < keys.length; k++) {
      var found = parentIndent === -1
        ? findTopKey(lines, keys[k])
        : findChild(lines, keys[k], start, end, parentIndent);
      if (found === -1) {
        var at = appendAt(lines, start, end);
        var header = [];
        for (var j = k; j < keys.length; j++) {
          header.push(pad(indent) + keys[j] + ':');
          indent += 2;
        }
        return { at: at, indent: indent, header: header, edits: edits };
      }
      var kind = sectionValue(lines[found]);
      if (kind === 'flow') {
        return { error: '"' + keys[k] + '" is written in YAML flow style (on one line) — expand it to indented lines first' };
      }
      parentIndent = indentOf(lines[found]);
      start = found + 1;
      end = blockEnd(lines, start, parentIndent);
      if (kind === 'emptyFlow') {
        // "paths: {}" → "paths:" so block children can be appended.
        edits.push({ at: found, text: stripEmptyFlow(lines[found]) });
        indent = parentIndent + 2;
      } else {
        indent = childIndent(lines, found, end);
      }
    }
    return { at: appendAt(lines, start, end), indent: indent, header: [], edits: edits };
  }

  function findTopKey(lines, key) {
    var re = keyRegex(key);
    for (var i = 0; i < lines.length; i++) {
      if (!isBlank(lines[i]) && indentOf(lines[i]) === 0 && re.test(lines[i])) return i;
    }
    return -1;
  }

  /* Templates below are written with 2-space indentation; re-indent them
     to the insertion point (base) keeping their relative depth. */
  function reindent(template, base) {
    var out = [];
    template.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var n = indentOf(line);
      out.push(pad(base + n) + line.slice(n));
    });
    return out;
  }

  /* ================= document context ================= */

  /* The `paths` child block (one endpoint) containing the cursor line. */
  function pathAtCursor(lines, cursorLine) {
    var top = findTopKey(lines, 'paths');
    if (top === -1) return null;
    var end = blockEnd(lines, top + 1, 0);
    if (cursorLine <= top || cursorLine >= end) return null;
    var want = -1;
    for (var i = top + 1; i < end; i++) {
      if (isBlank(lines[i])) continue;
      var ind = indentOf(lines[i]);
      if (want === -1) want = ind;
      if (ind !== want) continue;
      var m = lines[i].slice(ind).match(/^["']?(.+?)["']?\s*:/);
      if (!m) continue;
      var itemEnd = blockEnd(lines, i + 1, ind);
      if (cursorLine >= i && cursorLine < itemEnd) {
        return { name: m[1], line: i, end: itemEnd, indent: ind };
      }
    }
    return null;
  }

  /* The operation (method) block containing the cursor, within a path. */
  function operationAtCursor(lines, cursorLine) {
    var p = pathAtCursor(lines, cursorLine);
    if (!p) return null;
    for (var i = p.line + 1; i < p.end; i++) {
      if (isBlank(lines[i])) continue;
      var ind = indentOf(lines[i]);
      var m = lines[i].slice(ind).match(/^(get|put|post|delete|options|head|patch|trace)\s*:/);
      if (!m) continue;
      var opEnd = blockEnd(lines, i + 1, ind);
      if (cursorLine >= i && cursorLine < opEnd) {
        return { path: p, method: m[1], line: i, end: opEnd, indent: ind };
      }
    }
    return null;
  }

  /* ================= uniqueness ================= */

  function uniqueName(base, taken, sep) {
    if (!taken(base)) return base;
    for (var n = 2; ; n++) {
      var name = base + (sep || '') + n;
      if (!taken(name)) return name;
    }
  }

  function collectOperationIds(doc) {
    var ids = {};
    if (!doc || typeof doc.paths !== 'object' || doc.paths === null) return ids;
    Object.keys(doc.paths).forEach(function (p) {
      var item = doc.paths[p];
      if (!item || typeof item !== 'object') return;
      METHODS.concat(['options', 'head', 'trace']).forEach(function (m) {
        if (item[m] && typeof item[m].operationId === 'string') ids[item[m].operationId] = true;
      });
    });
    return ids;
  }

  function uniqueOpId(doc, base) {
    var ids = collectOperationIds(doc);
    return uniqueName(base, function (n) { return !!ids[n]; });
  }

  /* ================= templates ================= */

  var JSON_OK =
    "content:\n" +
    "  application/json:\n" +
    "    schema:\n" +
    "      type: object\n" +
    "      properties:\n" +
    "        message:\n" +
    "          type: string\n" +
    "          example: Hello\n";

  var JSON_ERROR =
    "content:\n" +
    "  application/json:\n" +
    "    schema:\n" +
    "      type: object\n" +
    "      properties:\n" +
    "        error:\n" +
    "          type: string\n";

  function indentBlock(text, by) {
    return text.split('\n').map(function (l) { return l.trim() ? pad(by) + l : l; }).join('\n');
  }

  function operationTemplate(method, opId) {
    var t = method + ':\n' +
      '  summary: ' + { get: 'Get', post: 'Create', put: 'Replace', patch: 'Update', delete: 'Delete' }[method] + ' something\n' +
      '  operationId: ' + opId + '\n';
    if (method === 'post' || method === 'put' || method === 'patch') {
      t += '  requestBody:\n' +
        '    required: true\n' +
        '    content:\n' +
        '      application/json:\n' +
        '        schema:\n' +
        '          type: object\n' +
        '          required:\n' +
        '            - name\n' +
        '          properties:\n' +
        '            name:\n' +
        '              type: string\n' +
        '              example: example\n';
    }
    t += '  responses:\n';
    if (method === 'delete') {
      t += "    '204':\n      description: Deleted\n";
    } else if (method === 'post') {
      t += "    '201':\n      description: Created\n" + indentBlock(JSON_OK, 6);
    } else {
      t += "    '200':\n      description: OK\n" + indentBlock(JSON_OK, 6);
    }
    return t;
  }

  var RESPONSE_TEMPLATES = {
    '200': "'200':\n  description: OK\n" + indentBlock(JSON_OK, 2),
    '201': "'201':\n  description: Created\n" + indentBlock(JSON_OK, 2),
    '204': "'204':\n  description: No content\n",
    '400': "'400':\n  description: Bad request\n" + indentBlock(JSON_ERROR, 2),
    '401': "'401':\n  description: Unauthorized\n" + indentBlock(JSON_ERROR, 2),
    '404': "'404':\n  description: Not found\n" + indentBlock(JSON_ERROR, 2),
    'default': 'default:\n  description: Unexpected error\n' + indentBlock(JSON_ERROR, 2)
  };

  function parameterTemplate(loc) {
    return '- name: newParam\n' +
      '  in: ' + loc + '\n' +
      '  description: What this parameter does\n' +
      (loc === 'path' ? '  required: true\n' : '  required: false\n') +
      '  schema:\n' +
      '    type: string\n';
  }

  var REQUEST_BODY_TEMPLATE =
    'requestBody:\n' +
    '  required: true\n' +
    '  content:\n' +
    '    application/json:\n' +
    '      schema:\n' +
    '        type: object\n' +
    '        properties:\n' +
    '          name:\n' +
    '            type: string\n' +
    '            example: example\n';

  function schemaTemplate(name) {
    return name + ':\n' +
      '  type: object\n' +
      '  required:\n' +
      '    - id\n' +
      '  properties:\n' +
      '    id:\n' +
      '      type: integer\n' +
      '      format: int64\n' +
      '      example: 1\n' +
      '    name:\n' +
      '      type: string\n' +
      '      example: example\n';
  }

  var SECURITY_TEMPLATES = {
    apiKey: { name: 'ApiKeyAuth', yaml: 'ApiKeyAuth:\n  type: apiKey\n  in: header\n  name: X-API-Key\n' },
    bearer: { name: 'BearerAuth', yaml: 'BearerAuth:\n  type: http\n  scheme: bearer\n  bearerFormat: JWT\n' },
    basic: { name: 'BasicAuth', yaml: 'BasicAuth:\n  type: http\n  scheme: basic\n' },
    oauth2: {
      name: 'OAuth2',
      yaml: 'OAuth2:\n  type: oauth2\n  flows:\n    clientCredentials:\n' +
        '      tokenUrl: https://auth.example.com/oauth/token\n      scopes:\n        read: Read access\n'
    }
  };

  var SERVER_TEMPLATE = '- url: https://api.example.com/v1\n  description: New server\n';
  var TAG_TEMPLATE = '- name: newTag\n  description: What this tag groups\n';

  /* ================= actions =================
     Each action inspects the current text and returns either
     { insertions: [{at, lines}], select, message } or { error }. */

  function newEndpoint(lines, doc, method) {
    var taken = function (p) { return doc.paths && Object.prototype.hasOwnProperty.call(doc.paths, p); };
    var pathName = uniqueName('/new-endpoint', taken, '-');
    var opId = uniqueOpId(doc, method + 'NewEndpoint');
    var spot = ensureChain(lines, ['paths']);
    if (spot.error) return spot;
    var content = reindent(pathName + ':\n' + indentBlock(operationTemplate(method, opId), 2), spot.indent);
    return {
      edits: spot.edits,
      insertions: [{ at: spot.at, lines: spot.header.concat(content) }],
      select: pathName,
      message: 'Inserted ' + method.toUpperCase() + ' ' + pathName + ' — type to rename the path'
    };
  }

  function operationHere(lines, doc, method, cursorLine) {
    var p = pathAtCursor(lines, cursorLine);
    if (!p) return newEndpoint(lines, doc, method); // nothing under the cursor — make a new path
    var item = doc.paths && doc.paths[p.name];
    if (item && typeof item === 'object' && item[method]) {
      return { error: p.name + ' already has ' + method.toUpperCase() };
    }
    var kind = sectionValue(lines[p.line]);
    if (kind === 'flow') {
      return { error: p.name + ' is written in YAML flow style (on one line) — expand it to indented lines first' };
    }
    var edits = kind === 'emptyFlow' ? [{ at: p.line, text: stripEmptyFlow(lines[p.line]) }] : [];
    var opId = uniqueOpId(doc, method + p.name.replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])?/g, function (_, c) {
      return c ? c.toUpperCase() : '';
    }));
    var content = reindent(operationTemplate(method, opId), childIndent(lines, p.line, p.end));
    return {
      edits: edits,
      insertions: [{ at: appendAt(lines, p.line + 1, p.end), lines: content }],
      select: opId,
      message: 'Inserted ' + method.toUpperCase() + ' into ' + p.name
    };
  }

  function addToOperation(lines, doc, cursorLine, sectionKey, build, opts) {
    var op = operationAtCursor(lines, cursorLine);
    if (!op) {
      return { error: 'place the cursor inside an operation (get/post/…) first' };
    }
    var opDoc = doc.paths && doc.paths[op.path.name] && doc.paths[op.path.name][op.method];
    var check = opts && opts.check && opts.check(opDoc, op);
    if (check) return { error: check };
    var opKind = sectionValue(lines[op.line]);
    if (opKind === 'flow') {
      return { error: 'this operation is written in YAML flow style (on one line) — expand it to indented lines first' };
    }
    var edits = opKind === 'emptyFlow' ? [{ at: op.line, text: stripEmptyFlow(lines[op.line]) }] : [];
    var section = findChild(lines, sectionKey, op.line + 1, op.end, op.indent);
    var opChild = childIndent(lines, op.line, op.end);
    if (section === -1) {
      // No such section on this operation yet — create it right below the
      // method line, content indented one step deeper.
      var created = [pad(opChild) + sectionKey + ':'].concat(reindent(build(), opChild + 2));
      if (opts && opts.bare) created = reindent(build(), opChild); // build() includes the section key
      return {
        edits: edits,
        insertions: [{ at: op.line + 1, lines: created }],
        select: opts && opts.select,
        message: opts.message(op)
      };
    }
    if (opts && opts.bare) return { error: op.method.toUpperCase() + ' ' + op.path.name + ' already has ' + sectionKey };
    var secKind = sectionValue(lines[section]);
    if (secKind === 'flow') {
      return { error: '"' + sectionKey + '" is written in YAML flow style (on one line) — expand it to indented lines first' };
    }
    if (secKind === 'emptyFlow') edits.push({ at: section, text: stripEmptyFlow(lines[section]) });
    var secEnd = blockEnd(lines, section + 1, indentOf(lines[section]));
    var secIndent = secKind === 'emptyFlow'
      ? indentOf(lines[section]) + 2
      : childIndent(lines, section, secEnd);
    return {
      edits: edits,
      insertions: [{ at: appendAt(lines, section + 1, secEnd), lines: reindent(build(), secIndent) }],
      select: opts && opts.select,
      message: opts.message(op)
    };
  }

  function addParameter(lines, doc, loc, cursorLine) {
    return addToOperation(lines, doc, cursorLine, 'parameters', function () { return parameterTemplate(loc); }, {
      select: 'newParam',
      message: function (op) {
        return 'Inserted a ' + loc + ' parameter into ' + op.method.toUpperCase() + ' ' + op.path.name +
          (loc === 'path' ? ' — remember to add {newParam} to the path template' : '');
      }
    });
  }

  function addRequestBody(lines, doc, cursorLine) {
    return addToOperation(lines, doc, cursorLine, 'requestBody', function () { return REQUEST_BODY_TEMPLATE; }, {
      bare: true,
      check: function (opDoc) {
        if (opDoc && opDoc.requestBody) return 'this operation already has a requestBody';
        return null;
      },
      message: function (op) { return 'Inserted a JSON request body into ' + op.method.toUpperCase() + ' ' + op.path.name; }
    });
  }

  function addResponse(lines, doc, code, cursorLine) {
    return addToOperation(lines, doc, cursorLine, 'responses', function () { return RESPONSE_TEMPLATES[code]; }, {
      check: function (opDoc) {
        if (opDoc && opDoc.responses && Object.prototype.hasOwnProperty.call(opDoc.responses, code)) {
          return 'this operation already has a ' + code + ' response';
        }
        return null;
      },
      message: function (op) { return 'Inserted a ' + code + ' response into ' + op.method.toUpperCase() + ' ' + op.path.name; }
    });
  }

  function addSchema(lines, doc) {
    var schemas = doc.components && doc.components.schemas;
    var name = uniqueName('NewSchema', function (n) {
      return schemas && Object.prototype.hasOwnProperty.call(schemas, n);
    });
    var spot = ensureChain(lines, ['components', 'schemas']);
    if (spot.error) return spot;
    return {
      edits: spot.edits,
      insertions: [{ at: spot.at, lines: spot.header.concat(reindent(schemaTemplate(name), spot.indent)) }],
      select: name,
      message: 'Inserted components.schemas.' + name +
        " — reference it with $ref: '#/components/schemas/" + name + "'"
    };
  }

  function addSecurityScheme(lines, doc, kind) {
    var tpl = SECURITY_TEMPLATES[kind];
    var existing = doc.components && doc.components.securitySchemes;
    var name = uniqueName(tpl.name, function (n) {
      return existing && Object.prototype.hasOwnProperty.call(existing, n);
    });
    var yaml = name === tpl.name ? tpl.yaml : tpl.yaml.replace(tpl.name + ':', name + ':');
    var spot = ensureChain(lines, ['components', 'securitySchemes']);
    if (spot.error) return spot;
    return {
      edits: spot.edits,
      insertions: [{ at: spot.at, lines: spot.header.concat(reindent(yaml, spot.indent)) }],
      select: name,
      message: 'Inserted security scheme "' + name + '" — enable it with "security: [' + name + ': []]"' +
        ' at the root or on an operation'
    };
  }

  function addListItem(lines, doc, key, template, select, message) {
    var spot;
    var top = findTopKey(lines, key);
    if (top === -1) {
      // Create the section near the top (after the info block) so the
      // document keeps its conventional order.
      var info = findTopKey(lines, 'info');
      var at = info === -1 ? appendAt(lines, 0, lines.length) : blockEnd(lines, info + 1, 0);
      spot = { at: at, indent: 2, header: [key + ':'], edits: [] };
    } else {
      var kind = sectionValue(lines[top]);
      if (kind === 'flow') {
        return { error: '"' + key + '" is written in YAML flow style (on one line) — expand it to indented lines first' };
      }
      var end = blockEnd(lines, top + 1, 0);
      spot = {
        at: appendAt(lines, top + 1, end),
        indent: kind === 'emptyFlow' ? 2 : childIndent(lines, top, end),
        header: [],
        edits: kind === 'emptyFlow' ? [{ at: top, text: stripEmptyFlow(lines[top]) }] : []
      };
    }
    return {
      edits: spot.edits,
      insertions: [{ at: spot.at, lines: spot.header.concat(reindent(template, spot.indent)) }],
      select: select,
      message: message
    };
  }

  function crudResource(lines, doc) {
    var takenPath = function (p) { return doc.paths && Object.prototype.hasOwnProperty.call(doc.paths, p); };
    var schemas = doc.components && doc.components.schemas;
    var suffix = '';
    for (var n = 1; ; n++) {
      suffix = n === 1 ? '' : String(n);
      var clash = takenPath('/widgets' + suffix) || takenPath('/widgets' + suffix + '/{id}') ||
        (schemas && Object.prototype.hasOwnProperty.call(schemas, 'Widget' + suffix));
      if (!clash) break;
    }
    var S = 'Widget' + suffix;
    var base = '/widgets' + suffix;
    var ref = "$ref: '#/components/schemas/" + S + "'";
    var pathsYaml =
      base + ':\n' +
      '  get:\n' +
      '    summary: List widgets\n' +
      '    operationId: ' + uniqueOpId(doc, 'listWidgets' + suffix) + '\n' +
      '    parameters:\n' +
      '      - name: limit\n        in: query\n        schema:\n          type: integer\n          default: 20\n' +
      '    responses:\n' +
      "      '200':\n        description: OK\n        content:\n          application/json:\n" +
      '            schema:\n              type: array\n              items:\n                ' + ref + '\n' +
      '  post:\n' +
      '    summary: Create a widget\n' +
      '    operationId: ' + uniqueOpId(doc, 'createWidget' + suffix) + '\n' +
      '    requestBody:\n      required: true\n      content:\n        application/json:\n          schema:\n            ' + ref + '\n' +
      '    responses:\n' +
      "      '201':\n        description: Created\n        content:\n          application/json:\n            schema:\n              " + ref + '\n' +
      base + '/{id}:\n' +
      '  parameters:\n' +
      '    - name: id\n      in: path\n      required: true\n      schema:\n        type: integer\n        format: int64\n' +
      '  get:\n' +
      '    summary: Get a widget\n' +
      '    operationId: ' + uniqueOpId(doc, 'getWidget' + suffix) + '\n' +
      '    responses:\n' +
      "      '200':\n        description: OK\n        content:\n          application/json:\n            schema:\n              " + ref + '\n' +
      "      '404':\n        description: Not found\n" +
      '  put:\n' +
      '    summary: Replace a widget\n' +
      '    operationId: ' + uniqueOpId(doc, 'updateWidget' + suffix) + '\n' +
      '    requestBody:\n      required: true\n      content:\n        application/json:\n          schema:\n            ' + ref + '\n' +
      '    responses:\n' +
      "      '200':\n        description: OK\n        content:\n          application/json:\n            schema:\n              " + ref + '\n' +
      '  delete:\n' +
      '    summary: Delete a widget\n' +
      '    operationId: ' + uniqueOpId(doc, 'deleteWidget' + suffix) + '\n' +
      '    responses:\n' +
      "      '204':\n        description: Deleted\n";

    var pathsSpot = ensureChain(lines, ['paths']);
    if (pathsSpot.error) return pathsSpot;
    var schemaSpot = ensureChain(lines, ['components', 'schemas']);
    if (schemaSpot.error) return schemaSpot;
    return {
      edits: pathsSpot.edits.concat(schemaSpot.edits),
      insertions: [
        { at: pathsSpot.at, lines: pathsSpot.header.concat(reindent(pathsYaml, pathsSpot.indent)) },
        { at: schemaSpot.at, lines: schemaSpot.header.concat(reindent(schemaTemplate(S), schemaSpot.indent)) }
      ],
      select: base,
      message: 'Inserted full CRUD for ' + base + ' with the ' + S + ' schema — rename them to your resource'
    };
  }

  /* ----- "example from schema": derive an example for the media type or
     parameter under the cursor, using the mock's schema->example logic ----- */

  function collectExampleTargets(doc) {
    var out = [];
    function fromContent(node, base) {
      if (!node || typeof node !== 'object' || !node.content || typeof node.content !== 'object') return;
      Object.keys(node.content).forEach(function (mime) {
        var mt = node.content[mime];
        if (mt && typeof mt === 'object') out.push({ path: base.concat('content', mime), node: mt });
      });
    }
    function fromParams(list, base) {
      if (!Array.isArray(list)) return;
      list.forEach(function (p, i) {
        if (p && typeof p === 'object' && p.schema) out.push({ path: base.concat(i), node: p });
      });
    }
    if (doc.paths && typeof doc.paths === 'object') {
      Object.keys(doc.paths).forEach(function (p) {
        var item = doc.paths[p];
        if (!item || typeof item !== 'object') return;
        fromParams(item.parameters, ['paths', p, 'parameters']);
        METHODS.concat(['options', 'head', 'trace']).forEach(function (m) {
          var op = item[m];
          if (!op || typeof op !== 'object') return;
          fromParams(op.parameters, ['paths', p, m, 'parameters']);
          fromContent(op.requestBody, ['paths', p, m, 'requestBody']);
          if (op.responses && typeof op.responses === 'object') {
            Object.keys(op.responses).forEach(function (code) {
              fromContent(op.responses[code], ['paths', p, m, 'responses', code]);
            });
          }
        });
      });
    }
    var c = doc.components || {};
    ['requestBodies', 'responses'].forEach(function (sec) {
      if (c[sec] && typeof c[sec] === 'object') {
        Object.keys(c[sec]).forEach(function (n) {
          fromContent(c[sec][n], ['components', sec, n]);
        });
      }
    });
    return out;
  }

  function generateExample(lines, doc, cursorLine, text) {
    if (!window.SduiValidate || !window.SduiMock) return { error: 'example generation is unavailable' };
    var best = null;
    collectExampleTargets(doc).forEach(function (t) {
      var line = SduiValidate.locate(text, t.path);
      if (line === -1) return;
      var end = blockEnd(lines, line + 1, indentOf(lines[line]));
      if (cursorLine >= line && cursorLine < end && (!best || line > best.line)) {
        best = { line: line, end: end, node: t.node };
      }
    });
    if (!best) {
      return { error: 'place the cursor inside a media type (under "content:") or a parameter with a schema' };
    }
    if (best.node.example !== undefined || best.node.examples !== undefined) {
      return { error: 'this block already has an example' };
    }
    if (!best.node.schema) return { error: 'no "schema" here to derive an example from' };
    var value = SduiMock.exampleFromSchema(best.node.schema, doc);
    if (value === undefined) {
      return { error: 'could not derive an example from this schema (add "type" or "properties")' };
    }
    var yamlText = jsyaml.dump({ example: value }, { lineWidth: 100, noRefs: true });
    return {
      insertions: [{
        at: appendAt(lines, best.line + 1, best.end),
        lines: reindent(yamlText, childIndent(lines, best.line, best.end))
      }],
      message: 'Inserted an example derived from the schema'
    };
  }

  /* ================= planning entry point ================= */

  function plan(text, cursorLine, actionId) {
    if (/^\s*\{/.test(text)) {
      return { error: 'the Insert menu edits YAML — click "To JSON" to switch back to YAML first' };
    }
    var doc;
    try { doc = jsyaml.load(text); } catch (e) {
      return { error: 'fix the YAML syntax error first' };
    }
    if (!doc || typeof doc !== 'object') doc = {};
    if (doc.swagger) {
      return { error: 'these templates target OpenAPI 3 — this document is Swagger ' + doc.swagger };
    }
    var lines = text.split('\n');
    var parts = actionId.split(':');
    switch (parts[0]) {
      case 'path': return newEndpoint(lines, doc, parts[1]);
      case 'op': return operationHere(lines, doc, parts[1], cursorLine);
      case 'param': return addParameter(lines, doc, parts[1], cursorLine);
      case 'requestBody': return addRequestBody(lines, doc, cursorLine);
      case 'response': return addResponse(lines, doc, parts[1], cursorLine);
      case 'schema': return addSchema(lines, doc);
      case 'security': return addSecurityScheme(lines, doc, parts[1]);
      case 'server': return addListItem(lines, doc, 'servers', SERVER_TEMPLATE, 'https://api.example.com/v1', 'Inserted a server — replace the URL with yours');
      case 'tag': return addListItem(lines, doc, 'tags', TAG_TEMPLATE, 'newTag', 'Inserted a tag — reference it from operations with "tags: [newTag]"');
      case 'crud': return crudResource(lines, doc);
      case 'genExample': return generateExample(lines, doc, cursorLine, text);
      default: return { error: 'unknown insert action' };
    }
  }

  /* ================= menu definition ================= */

  var upper = function (m) { return m.toUpperCase(); };
  var MENU = [
    { label: 'CRUD resource (list + create + get + update + delete)', id: 'crud' },
    { label: 'New endpoint (path)', sub: METHODS.map(function (m) { return { label: upper(m), id: 'path:' + m }; }) },
    { label: 'Operation on the path under the cursor', sub: METHODS.map(function (m) { return { label: upper(m), id: 'op:' + m }; }) },
    { label: 'Parameter (into the operation under the cursor)', sub: ['query', 'path', 'header', 'cookie'].map(function (l) { return { label: l, id: 'param:' + l }; }) },
    { label: 'Request body (JSON)', id: 'requestBody' },
    { label: 'Response (into the operation under the cursor)', sub: ['200', '201', '204', '400', '401', '404', 'default'].map(function (c) { return { label: c, id: 'response:' + c }; }) },
    { label: 'Schema (components.schemas)', id: 'schema' },
    { label: 'Example from the schema under the cursor', id: 'genExample' },
    {
      label: 'Security scheme',
      sub: [
        { label: 'API key (header)', id: 'security:apiKey' },
        { label: 'Bearer JWT', id: 'security:bearer' },
        { label: 'HTTP Basic', id: 'security:basic' },
        { label: 'OAuth2 (client credentials)', id: 'security:oauth2' }
      ]
    },
    { label: 'Server', id: 'server' },
    { label: 'Tag', id: 'tag' }
  ];

  /* ================= UI wiring ================= */

  function init(opts) {
    var button = opts.button;
    var menu = opts.menu;

    MENU.forEach(function (item) {
      var el = document.createElement('div');
      el.className = 'sdui-menu-item' + (item.sub ? ' has-sub' : '');
      var label = document.createElement('div');
      label.className = 'sdui-menu-label';
      label.textContent = item.label;
      el.appendChild(label);
      if (item.sub) {
        var caret = document.createElement('span');
        caret.className = 'sdui-menu-caret';
        caret.textContent = '▸';
        label.appendChild(caret);
        var subEl = document.createElement('div');
        subEl.className = 'sdui-menu-sub';
        item.sub.forEach(function (subItem) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sdui-menu-sub-item';
          btn.textContent = subItem.label;
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            pick(subItem.id);
          });
          subEl.appendChild(btn);
        });
        el.appendChild(subEl);
        label.addEventListener('click', function () {
          var open = el.classList.contains('open');
          closeSubs();
          el.classList.toggle('open', !open);
        });
      } else {
        label.addEventListener('click', function () { pick(item.id); });
      }
      menu.appendChild(el);
    });

    function closeSubs() {
      var open = menu.querySelectorAll('.sdui-menu-item.open');
      for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
    }

    function closeMenu() { menu.hidden = true; closeSubs(); }

    button.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== button) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });

    function pick(actionId) {
      closeMenu();
      var cm = opts.getEditor();
      if (!cm) return;
      var result = plan(cm.getValue(), cm.getCursor().line, actionId);
      if (result.error) {
        opts.setStatus('err', 'Cannot insert: ' + result.error);
        return;
      }
      // Single-line edits first ("paths: {}" → "paths:") — replacements
      // don't shift line numbers, so insertion positions stay valid.
      (result.edits || []).forEach(function (edit) {
        cm.replaceRange(edit.text, { line: edit.at, ch: 0 }, { line: edit.at, ch: cm.getLine(edit.at).length });
      });
      // Apply bottom-most first so earlier line numbers stay valid. Ties
      // apply the LATER insertion first, so equal-`at` blocks keep their
      // intended document order (e.g. new paths above a new components).
      var insertions = result.insertions.map(function (ins, i) {
        return { at: ins.at, lines: ins.lines, i: i };
      }).sort(function (a, b) { return (b.at - a.at) || (b.i - a.i); });
      insertions.forEach(function (ins) {
        var text = ins.lines.join('\n') + '\n';
        if (ins.at >= cm.lineCount()) {
          var lastLine = cm.lineCount() - 1;
          var lastLen = cm.getLine(lastLine).length;
          cm.replaceRange((lastLen ? '\n' : '') + text.slice(0, -1) + (lastLen ? '' : '\n'), { line: lastLine, ch: lastLen });
        } else {
          cm.replaceRange(text, { line: ins.at, ch: 0 });
        }
      });
      // Flash the insertion point first, THEN select the placeholder —
      // the flash helper moves the cursor, which would drop the selection.
      var firstAt = result.insertions[0].at;
      if (opts.onInserted) opts.onInserted(firstAt);
      if (result.select) {
        var line = -1, ch = -1;
        for (var i = firstAt; i < cm.lineCount(); i++) {
          var idx = cm.getLine(i).indexOf(result.select);
          if (idx !== -1) { line = i; ch = idx; break; }
        }
        if (line !== -1) {
          cm.setSelection({ line: line, ch: ch }, { line: line, ch: ch + result.select.length });
          cm.scrollIntoView({ line: line, ch: 0 }, 120);
        }
      }
      cm.focus();
      opts.setStatus('ok', result.message);
    }
  }

  window.SduiSnippets = {
    init: init,
    plan: plan,
    MENU: MENU,
    // Low-level text helpers, shared with the quick-fix and exporter modules.
    util: {
      indentOf: indentOf, isBlank: isBlank, pad: pad, blockEnd: blockEnd,
      appendAt: appendAt, childIndent: childIndent, ensureChain: ensureChain,
      reindent: reindent, findTopKey: findTopKey, sectionValue: sectionValue,
      stripEmptyFlow: stripEmptyFlow
    }
  };
})();

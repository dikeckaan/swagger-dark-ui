/* Swagger Dark UI — one-click fixes for validation issues.
   fixFor(issue, text) inspects an issue produced by js/validate.js (via its
   machine-readable `code`) and, when the repair is unambiguous, returns
   { label, apply() -> newText }. Fixes are plain text edits located through
   the same indentation walk the linter uses, so the rest of the document —
   comments included — is untouched. */
(function () {
  'use strict';

  function U() { return window.SduiSnippets.util; }
  function locate(text, path) { return window.SduiValidate.locate(text, path); }

  function lineOps(text) {
    var lines = text.split('\n');
    return {
      lines: lines,
      done: function () { return lines.join('\n'); }
    };
  }

  /* The block owned by the key at `line`: [line+1, end). */
  function ownBlockEnd(lines, line) {
    return U().blockEnd(lines, line + 1, U().indentOf(lines[line]));
  }

  /* Effective indent of the mapping the located line's children live in. */
  function childIndentAt(lines, line) {
    return U().childIndent(lines, line, ownBlockEnd(lines, line));
  }

  /* Find `key` as a DIRECT child (at exactly `indent`) — never a nested
     occurrence inside a sub-block (a schema's own "required:", say). */
  function findInBlock(lines, key, start, end, indent) {
    var re = new RegExp('^(?:- +)?["\']?' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']?\\s*:');
    for (var i = start; i < end; i++) {
      var line = lines[i];
      if (U().isBlank(line)) continue;
      var ind = U().indentOf(line);
      if (ind !== indent) continue;
      if (re.test(line.slice(ind))) return i;
    }
    return -1;
  }

  /* Insert `content` (template with 2-space indents) as a child of the
     mapping at `line`. Returns the new text. */
  function insertChild(text, line, content) {
    var lines = text.split('\n');
    var indent = childIndentAt(lines, line);
    var end = ownBlockEnd(lines, line);
    var at = U().appendAt(lines, line + 1, end);
    // "key: {}" needs the flow value cleared before block children fit.
    if (U().sectionValue(lines[line]) === 'emptyFlow') {
      lines[line] = U().stripEmptyFlow(lines[line]);
      indent = U().indentOf(lines[line]) + 2;
      at = line + 1;
    }
    var insert = U().reindent(content, indent);
    Array.prototype.splice.apply(lines, [at, 0].concat(insert));
    return lines.join('\n');
  }

  function guessScheme(name) {
    if (/basic/i.test(name)) return name + ':\n  type: http\n  scheme: basic\n';
    if (/oauth/i.test(name)) {
      return name + ':\n  type: oauth2\n  flows:\n    clientCredentials:\n' +
        '      tokenUrl: https://auth.example.com/oauth/token\n      scopes:\n        read: Read access\n';
    }
    if (/key/i.test(name)) return name + ':\n  type: apiKey\n  in: header\n  name: X-API-Key\n';
    return name + ':\n  type: http\n  scheme: bearer\n  bearerFormat: JWT\n';
  }

  var FIXES = {
    'quote-value': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Quote the value',
        apply: function () {
          var ops = lineOps(text);
          ops.lines[line] = ops.lines[line].replace(/:\s*([^#'"].*?)\s*$/, ": '$1'");
          return ops.done();
        }
      };
    },

    'missing-info': function (issue, text) {
      return {
        label: 'Add an info block',
        apply: function () {
          var lines = text.split('\n');
          var verLine = U().findTopKey(lines, 'openapi');
          var at = verLine === -1 ? 0 : verLine + 1;
          Array.prototype.splice.apply(lines, [at, 0].concat(['info:', '  title: My API', "  version: '1.0.0'"]));
          return lines.join('\n');
        }
      };
    },

    'missing-title': function (issue, text) {
      var line = locate(text, ['info']);
      if (line === -1) return null;
      return { label: 'Add a title', apply: function () { return insertChild(text, line, 'title: My API\n'); } };
    },

    'missing-version': function (issue, text) {
      var line = locate(text, ['info']);
      if (line === -1) return null;
      return { label: 'Add a version', apply: function () { return insertChild(text, line, "version: '1.0.0'\n"); } };
    },

    'security-undefined': function (issue, text) {
      var name = issue.data && issue.data.name;
      if (!name || !/^[\w.-]+$/.test(name)) return null;
      return {
        label: 'Create scheme "' + name + '"',
        apply: function () {
          var lines = text.split('\n');
          var spot = U().ensureChain(lines, ['components', 'securitySchemes']);
          if (spot.error) return text;
          (spot.edits || []).forEach(function (e) { lines[e.at] = e.text; });
          var insert = spot.header.concat(U().reindent(guessScheme(name), spot.indent));
          Array.prototype.splice.apply(lines, [spot.at, 0].concat(insert));
          return lines.join('\n');
        }
      };
    },

    'missing-description': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Add a description',
        apply: function () { return insertChild(text, line, 'description: OK\n'); }
      };
    },

    'path-param-required': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Set required: true',
        apply: function () {
          var lines = text.split('\n');
          // The located line is the parameter's first line ("- name: id").
          var itemIndent = U().indentOf(lines[line]);
          var end = U().blockEnd(lines, line + 1, itemIndent);
          // Keys of a "- name: x" item live two columns right of the dash
          // (and "required" on the dash line itself is matched via slice).
          var existing = findInBlock(lines, 'required', line, end, itemIndent + 2);
          if (existing === -1) existing = findInBlock(lines, 'required', line, line + 1, itemIndent);
          if (existing !== -1) {
            lines[existing] = lines[existing].replace(/:\s*.*$/, ': true');
          } else {
            lines.splice(line + 1, 0, U().pad(itemIndent + 2) + 'required: true');
          }
          return lines.join('\n');
        }
      };
    },

    'additional-prop': function (issue, text) {
      var key = issue.data && issue.data.key;
      var line = locate(text, issue.path);
      if (line === -1 || !key) return null;
      return {
        label: 'Remove "' + key + '"',
        apply: function () {
          var lines = text.split('\n');
          var end = ownBlockEnd(lines, line);
          lines.splice(line, end - line);
          return lines.join('\n');
        }
      };
    },

    'missing-responses': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Add responses',
        apply: function () {
          return insertChild(text, line, "responses:\n  '200':\n    description: OK\n");
        }
      };
    },

    'path-no-slash': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Add the leading slash',
        apply: function () {
          var ops = lineOps(text);
          ops.lines[line] = ops.lines[line].replace(/^(\s*["']?)/, '$1/');
          return ops.done();
        }
      };
    },

    'empty-media-type': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Add a schema',
        apply: function () {
          return insertChild(text, line, 'schema:\n  type: object\n');
        }
      };
    },

    'example-conflict': function (issue, text) {
      var line = locate(text, issue.path);
      if (line === -1) return null;
      return {
        label: 'Remove "example"',
        apply: function () {
          var lines = text.split('\n');
          var end = ownBlockEnd(lines, line);
          var ex = findInBlock(lines, 'example', line + 1, end, childIndentAt(lines, line));
          if (ex === -1) return text;
          lines.splice(ex, U().blockEnd(lines, ex + 1, U().indentOf(lines[ex])) - ex);
          return lines.join('\n');
        }
      };
    }
  };

  function fixFor(issue, text) {
    var make = issue.code && FIXES[issue.code];
    if (!make) return null;
    try { return make(issue, text); } catch (e) { return null; }
  }

  window.SduiQuickfix = { fixFor: fixFor };
})();

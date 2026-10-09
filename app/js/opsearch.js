/* Swagger Dark UI — full-text operation search for the preview pane.
   Replaces Swagger UI's tag-name-only filter: every operation is indexed
   from the PARSED spec — path, method, operationId, summary, descriptions,
   tags, parameter names, request/response media types and status codes,
   schema property names and enum values ($refs resolved) — and the rendered
   operation blocks are filtered live as you type. Terms are ANDed. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'];
  var DEPTH = 3;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function resolvePointer(doc, ref) {
    if (typeof ref !== 'string' || ref.slice(0, 2) !== '#/') return null;
    var node = doc;
    var parts = ref.slice(2).split('/');
    for (var i = 0; i < parts.length; i++) {
      var key = decodeURIComponent(parts[i]).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!node || typeof node !== 'object') return null;
      node = node[key];
    }
    return node;
  }

  function schemaWords(doc, schema, out, depth, seen) {
    if (!schema || typeof schema !== 'object' || depth > DEPTH || seen.indexOf(schema) !== -1) return;
    seen.push(schema);
    if (typeof schema.$ref === 'string') {
      out.push(schema.$ref.split('/').pop());
      schemaWords(doc, resolvePointer(doc, schema.$ref), out, depth + 1, seen);
      return;
    }
    if (schema.title) out.push(schema.title);
    if (schema.description) out.push(schema.description);
    if (Array.isArray(schema.enum)) schema.enum.forEach(function (v) { out.push(String(v)); });
    if (isObj(schema.properties)) {
      Object.keys(schema.properties).forEach(function (k) {
        out.push(k);
        schemaWords(doc, schema.properties[k], out, depth + 1, seen);
      });
    }
    if (schema.items) schemaWords(doc, schema.items, out, depth + 1, seen);
    ['allOf', 'anyOf', 'oneOf'].forEach(function (k) {
      if (Array.isArray(schema[k])) {
        schema[k].forEach(function (sub) { schemaWords(doc, sub, out, depth + 1, seen); });
      }
    });
  }

  function contentWords(doc, content, words) {
    if (!isObj(content)) return;
    Object.keys(content).forEach(function (mt) {
      words.push(mt);
      var schema = content[mt] && content[mt].schema;
      if (schema) schemaWords(doc, schema, words, 0, []);
    });
  }

  function buildIndex(doc) {
    var index = {};
    if (!isObj(doc) || !isObj(doc.paths)) return index;
    Object.keys(doc.paths).forEach(function (p) {
      var item = doc.paths[p];
      if (!isObj(item)) return;
      METHODS.forEach(function (m) {
        var op = item[m];
        if (!isObj(op)) return;
        var words = [p, m, op.operationId, op.summary, op.description, (op.tags || []).join(' ')];
        (item.parameters || []).concat(op.parameters || []).forEach(function (prm) {
          if (!isObj(prm)) return;
          if (prm.$ref) prm = resolvePointer(doc, prm.$ref) || {};
          words.push(prm.name, prm.in, prm.description);
          if (prm.schema) schemaWords(doc, prm.schema, words, 0, []);
        });
        var rb = op.requestBody;
        if (isObj(rb)) {
          if (rb.$ref) rb = resolvePointer(doc, rb.$ref) || {};
          words.push(rb.description);
          contentWords(doc, rb.content, words);
        }
        if (isObj(op.responses)) {
          Object.keys(op.responses).forEach(function (code) {
            var res = op.responses[code];
            words.push(code);
            if (!isObj(res)) return;
            if (res.$ref) res = resolvePointer(doc, res.$ref) || {};
            words.push(res.description);
            contentWords(doc, res.content, words);
          });
        }
        (op.security || []).forEach(function (req) {
          if (isObj(req)) Object.keys(req).forEach(function (n) { words.push(n); });
        });
        index[m + ' ' + p] = words.filter(Boolean).join(' ').toLowerCase();
      });
    });
    return index;
  }

  var state = { index: {}, query: '', input: null, count: null };

  function apply() {
    var container = document.getElementById('swagger-ui');
    if (!container) return;
    var terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    var blocks = container.querySelectorAll('.opblock');
    var shown = 0;
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var ok = true;
      if (terms.length) {
        var pathEl = block.querySelector('.opblock-summary-path, .opblock-summary-path__deprecated');
        var mm = block.className.match(/opblock-(get|put|post|delete|options|head|patch|trace|query)/);
        var path = pathEl ? (pathEl.getAttribute('data-path') || pathEl.textContent.trim()) : '';
        var hay = state.index[(mm ? mm[1] : '') + ' ' + path];
        // Fallback (spec not indexed yet): match against the block's own text.
        if (hay === undefined) hay = (path + ' ' + block.textContent).toLowerCase();
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) { ok = false; break; }
        }
      }
      block.style.display = ok ? '' : 'none';
      if (ok) shown++;
    }
    // Collapse tag sections whose operations are all filtered out.
    var sections = container.querySelectorAll('.opblock-tag-section');
    for (var s = 0; s < sections.length; s++) {
      var anyVisible = false;
      var ops = sections[s].querySelectorAll('.opblock');
      for (var o = 0; o < ops.length; o++) {
        if (ops[o].style.display !== 'none') { anyVisible = true; break; }
      }
      sections[s].style.display = terms.length && !anyVisible ? 'none' : '';
    }
    if (state.count) {
      state.count.textContent = terms.length ? shown + '/' + blocks.length : '';
      state.count.classList.toggle('none', terms.length > 0 && shown === 0);
    }
  }

  var applyTimer = null;
  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(apply, 150);
  }

  function init(opts) {
    state.input = opts.input;
    state.count = opts.count;
    opts.input.addEventListener('input', function () {
      state.query = opts.input.value;
      scheduleApply();
    });
    opts.input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        opts.input.value = '';
        state.query = '';
        apply();
      }
    });
    // Swagger UI re-renders wipe our display tweaks — re-apply after any
    // structural change while a query is active.
    var container = document.getElementById('swagger-ui');
    if (typeof MutationObserver !== 'undefined' && container) {
      new MutationObserver(function () {
        if (state.query) scheduleApply();
      }).observe(container, { childList: true, subtree: true });
    }
  }

  function setSpec(doc) {
    state.index = buildIndex(doc);
    if (state.query) scheduleApply();
  }

  window.SduiOpSearch = { init: init, setSpec: setSpec, apply: apply, _buildIndex: buildIndex };
})();

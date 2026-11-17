/* Swagger Dark UI — inline constraint menu for the YAML editor.
   When the cursor sits on a schema property, a component schema, or a
   parameter, a small "+ rule" pill appears at the end of that line. It
   opens a menu of the validation keywords that apply to the value's type
   (minLength, pattern, minimum, required, enum, …) and inserts the chosen
   one in the right place with a sensible placeholder value pre-selected.
   Pure text splicing via SduiSnippets.util — comments stay untouched. */
(function () {
  'use strict';

  var U = null; // SduiSnippets.util, bound lazily so script order doesn't matter
  function util() { return U || (U = window.SduiSnippets && window.SduiSnippets.util); }

  /* ----- constraint catalog -----
     types: which declared schema types the keyword makes sense for
     ('*' = any). v: single-line placeholder value; items: block list value. */
  var CATALOG = [
    { key: 'required', label: 'required', special: 'required' },
    { key: 'minLength', v: '1', types: ['string'] },
    { key: 'maxLength', v: '255', types: ['string'] },
    { key: 'pattern', v: "'^[A-Za-z0-9]+$'", types: ['string'] },
    { key: 'format', v: 'date-time', types: ['string', 'integer', 'number'] },
    { key: 'enum', items: ['value1', 'value2'], types: ['string', 'integer', 'number'] },
    { key: 'minimum', v: '0', types: ['integer', 'number'] },
    { key: 'maximum', v: '100', types: ['integer', 'number'] },
    { key: 'exclusiveMinimum', v: '0', types: ['integer', 'number'] },
    { key: 'exclusiveMaximum', v: '100', types: ['integer', 'number'] },
    { key: 'multipleOf', v: '1', types: ['integer', 'number'] },
    { key: 'minItems', v: '1', types: ['array'] },
    { key: 'maxItems', v: '10', types: ['array'] },
    { key: 'uniqueItems', v: 'true', types: ['array'] },
    { key: 'minProperties', v: '1', types: ['object'] },
    { key: 'maxProperties', v: '10', types: ['object'] },
    { key: 'default', v: 'value', types: '*' },
    { key: 'example', v: 'value', types: '*' },
    { key: 'description', v: 'What this field means', types: '*' },
    { key: 'nullable', v: 'true', types: '*', only30: true },
    { key: 'deprecated', v: 'true', types: '*' },
    { key: 'readOnly', v: 'true', types: '*' },
    { key: 'writeOnly', v: 'true', types: '*' }
  ];

  /* ----- cursor context detection ----- */

  /* Indented-key stack down to (and including) the cursor line, with line
     numbers. List items appear as pseudo-key '[]' at the dash indent. */
  function stackTo(lines, cursorLine) {
    var stack = [];
    for (var i = 0; i <= cursorLine && i < lines.length; i++) {
      var line = lines[i];
      if (util().isBlank(line)) continue;
      var ind = util().indentOf(line);
      var text = line.slice(ind);
      while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
      if (/^-(\s|$)/.test(text)) {
        stack.push({ indent: ind, key: '[]', line: i });
        text = text.replace(/^-\s*/, '');
        ind = line.length - text.length;
      }
      var m = text.match(/^["']?([^"'#]*?)["']?\s*:(\s|$)/);
      if (m && stack.length < 40) stack.push({ indent: ind, key: m[1], line: i });
    }
    return stack;
  }

  function blockOf(lines, entry) {
    return { line: entry.line, indent: entry.indent, end: util().blockEnd(lines, entry.line + 1, entry.indent) };
  }

  function findChildLine(lines, block, key) {
    var esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('^(?:- +)?["\']?' + esc + '["\']?\\s*:');
    for (var i = block.line + (lines[block.line] && /^\s*-/.test(lines[block.line]) ? 0 : 1); i < block.end; i++) {
      if (util().isBlank(lines[i])) continue;
      var ind = util().indentOf(lines[i]);
      if (i > block.line && ind <= block.indent) break;
      if (re.test(lines[i].slice(ind))) return i;
    }
    return -1;
  }

  function typeIn(lines, block) {
    var t = findChildLine(lines, block, 'type');
    if (t === -1) return null;
    var m = lines[t].match(/type\s*:\s*["']?([\w]+)/);
    return m ? m[1] : null;
  }

  function presentKeys(lines, block) {
    var present = {};
    for (var i = block.line + 1; i < block.end; i++) {
      if (util().isBlank(lines[i])) continue;
      var ind = util().indentOf(lines[i]);
      if (ind <= block.indent) break;
      var m = lines[i].slice(ind).replace(/^-\s*/, '').match(/^["']?([\w$-]+)["']?\s*:/);
      if (m && ind === util().childIndent(lines, block.line, block.end)) present[m[1]] = i;
    }
    return present;
  }

  /* What "variable" is the cursor on? Deepest match wins. */
  function detect(text, cursorLine) {
    if (!util()) return null;
    var lines = text.split('\n');
    if (cursorLine >= lines.length) return null;
    var stack = stackTo(lines, cursorLine);
    if (!stack.length) return null;

    var best = null;
    for (var i = stack.length - 1; i >= 0 && !best; i--) {
      var e = stack[i];
      // schema property:  ... properties: <name>:
      if (i > 0 && stack[i - 1].key === 'properties' && e.key !== '[]') {
        var parent = i >= 2 ? blockOf(lines, stack[i - 2]) : null;
        best = { kind: 'property', name: e.key, target: blockOf(lines, e), parentSchema: parent };
      } else if (e.key === '[]' && i > 0 && stack[i - 1].key === 'parameters') {
        // parameter list item — the item block runs to the next dash or dedent
        var item = { line: e.line, indent: e.indent, end: util().blockEnd(lines, e.line + 1, e.indent) };
        for (var j = e.line + 1; j < item.end; j++) {
          if (!util().isBlank(lines[j]) && util().indentOf(lines[j]) === e.indent &&
              lines[j].charAt(e.indent) === '-') { item.end = j; break; }
        }
        var nameLn = findChildLine(lines, item, 'name');
        var nm = nameLn !== -1 ? (lines[nameLn].match(/name\s*:\s*["']?([^"'#\n]+?)["']?\s*$/) || [])[1] : null;
        best = { kind: 'parameter', name: nm || 'parameter', target: item };
      } else if (i >= 2 && stack[i - 2].key === 'components' && stack[i - 1].key === 'schemas' && e.key !== '[]') {
        best = { kind: 'schemaRoot', name: e.key, target: blockOf(lines, e) };
      }
    }
    if (!best) return null;

    // Constraints land in the schema block: the property/schema itself, or
    // the parameter's "schema:" child (created on demand).
    if (best.kind === 'parameter') {
      var sLn = findChildLine(lines, best.target, 'schema');
      best.schemaBlock = sLn === -1 ? null : blockOf(lines, { line: sLn, indent: util().indentOf(lines[sLn]) });
    } else {
      if (util().sectionValue(lines[best.target.line]) === 'flow') return null; // inline {} value
      best.schemaBlock = best.target;
    }
    var typeBlock = best.schemaBlock || best.target;
    best.type = best.schemaBlock ? typeIn(lines, best.schemaBlock) : null;
    best.present = best.schemaBlock ? presentKeys(lines, best.schemaBlock) : {};
    void typeBlock;
    return best;
  }

  /* Menu entries applicable to the detected target. */
  function optionsFor(ctx, doc) {
    var is30 = doc && typeof doc.openapi === 'string' && /^3\.0/.test(doc.openapi);
    return CATALOG.filter(function (c) {
      if (c.special === 'required') {
        if (ctx.kind === 'schemaRoot') return false;   // means "list of required props" there
        return !ctx.requiredAlready;
      }
      if (c.only30 && !is30) return false;
      if (ctx.present[c.key] !== undefined) return false;
      if (!ctx.type || c.types === '*') return true;
      return c.types.indexOf(ctx.type) !== -1;
    });
  }

  /* ----- insertion planning (pure, testable) ----- */

  function plan(text, cursorLine, key) {
    var ctx = detect(text, cursorLine);
    if (!ctx) return { error: 'place the cursor on a property, schema, or parameter first' };
    var lines = text.split('\n');
    var item = null;
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].key === key) item = CATALOG[i];
    if (!item) return { error: 'unknown constraint' };

    if (item.special === 'required') return planRequired(lines, ctx);

    var block = ctx.schemaBlock;
    var edits = [];
    var indent;
    var at;
    if (!block) {
      // Parameter without "schema:" — create it and put the keyword inside.
      var pIndent = util().childIndent(lines, ctx.target.line, ctx.target.end);
      var lead = [util().pad(pIndent) + 'schema:'];
      indent = pIndent + 2;
      at = util().appendAt(lines, ctx.target.line + 1, ctx.target.end);
      return finish(lines, ctx, item, at, indent, lead, edits);
    }
    var kind = util().sectionValue(lines[block.line]);
    if (kind === 'flow') return { error: '"' + ctx.name + '" uses YAML flow style — expand it to indented lines first' };
    if (kind === 'emptyFlow') edits.push({ at: block.line, text: util().stripEmptyFlow(lines[block.line]) });
    indent = kind === 'emptyFlow' ? block.indent + 2 : util().childIndent(lines, block.line, block.end);
    at = util().appendAt(lines, block.line + 1, block.end);
    return finish(lines, ctx, item, at, indent, [], edits);
  }

  function finish(lines, ctx, item, at, indent, lead, edits) {
    var out;
    var select;
    if (item.items) {
      out = lead.concat([util().pad(indent) + item.key + ':']);
      item.items.forEach(function (v) { out.push(util().pad(indent + 2) + '- ' + v); });
      select = item.items[0];
    } else {
      out = lead.concat([util().pad(indent) + item.key + ': ' + item.v]);
      select = item.v;
    }
    return {
      edits: edits,
      insertions: [{ at: at, lines: out }],
      select: select,
      message: 'Added ' + item.key + ' to "' + ctx.name + '" — type to change the value'
    };
  }

  function planRequired(lines, ctx) {
    if (ctx.kind === 'parameter') {
      var reqLn = findChildLine(lines, ctx.target, 'required');
      if (reqLn !== -1) {
        if (/required\s*:\s*true/.test(lines[reqLn])) return { error: '"' + ctx.name + '" is already required' };
        return {
          edits: [{ at: reqLn, text: lines[reqLn].replace(/required\s*:.*$/, 'required: true') }],
          insertions: [],
          message: '"' + ctx.name + '" is now required'
        };
      }
      var ind = util().childIndent(lines, ctx.target.line, ctx.target.end);
      return {
        edits: [],
        insertions: [{ at: util().appendAt(lines, ctx.target.line + 1, ctx.target.end), lines: [util().pad(ind) + 'required: true'] }],
        message: '"' + ctx.name + '" is now required'
      };
    }
    // property: add the name to the parent schema's "required" list
    var parent = ctx.parentSchema;
    if (!parent) return { error: 'cannot find the schema that owns "' + ctx.name + '"' };
    var rLn = findChildLine(lines, parent, 'required');
    var esc = ctx.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (rLn !== -1) {
      var v = util().sectionValue(lines[rLn]);
      var rEnd = util().blockEnd(lines, rLn + 1, util().indentOf(lines[rLn]));
      var listed = new RegExp('[\\[,\\s-]["\']?' + esc + '["\']?\\s*[\\],\\s]');
      for (var i = rLn; i < rEnd; i++) {
        if (listed.test(lines[i] + ' ')) return { error: '"' + ctx.name + '" is already required' };
      }
      if (v === 'flow') {
        // required: [a, b]  →  required: [a, b, name]
        return {
          edits: [{ at: rLn, text: lines[rLn].replace(/\]\s*$/, ', ' + ctx.name + ']') }],
          insertions: [],
          message: '"' + ctx.name + '" added to required'
        };
      }
      var edits2 = v === 'emptyFlow' ? [{ at: rLn, text: util().stripEmptyFlow(lines[rLn]) }] : [];
      var itemInd = v === 'emptyFlow'
        ? util().indentOf(lines[rLn]) + 2
        : util().childIndent(lines, rLn, rEnd);
      return {
        edits: edits2,
        insertions: [{ at: util().appendAt(lines, rLn + 1, rEnd), lines: [util().pad(itemInd) + '- ' + ctx.name] }],
        message: '"' + ctx.name + '" added to required'
      };
    }
    // No "required" list yet — create it right above "properties".
    var propsLn = findChildLine(lines, parent, 'properties');
    var indent2 = util().childIndent(lines, parent.line, parent.end);
    var at2 = propsLn !== -1 ? propsLn : util().appendAt(lines, parent.line + 1, parent.end);
    return {
      edits: [],
      insertions: [{ at: at2, lines: [util().pad(indent2) + 'required:', util().pad(indent2 + 2) + '- ' + ctx.name] }],
      message: '"' + ctx.name + '" added to required'
    };
  }

  /* required-already detection for menu filtering */
  function requiredAlready(text, ctx) {
    var lines = text.split('\n');
    if (ctx.kind === 'parameter') {
      var reqLn = findChildLine(lines, ctx.target, 'required');
      return reqLn !== -1 && /required\s*:\s*true/.test(lines[reqLn]);
    }
    if (!ctx.parentSchema) return true;
    var rLn = findChildLine(lines, ctx.parentSchema, 'required');
    if (rLn === -1) return false;
    var rEnd = util().blockEnd(lines, rLn + 1, util().indentOf(lines[rLn]));
    var esc = ctx.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var listed = new RegExp('[\\[,\\s-]["\']?' + esc + '["\']?\\s*[\\],\\s]');
    for (var i = rLn; i < rEnd; i++) {
      if (listed.test(lines[i] + ' ')) return true;
    }
    return false;
  }

  /* ----- UI: floating "+ rule" pill and its menu ----- */

  function init(opts) {
    var cm = opts.editor;
    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'sdui-rule-pill';
    pill.textContent = '＋ rule';
    pill.title = 'Add a validation rule to this field (minLength, pattern, required, …)';
    var menu = document.createElement('div');
    menu.className = 'sdui-menu sdui-rule-menu';
    menu.hidden = true;
    var current = null;
    var timer = null;

    function removeWidgets() {
      if (pill.parentNode) pill.parentNode.removeChild(pill);
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      menu.hidden = true;
    }

    function refresh() {
      var cur = cm.getCursor();
      var text = cm.getValue();
      current = detect(text, cur.line);
      if (!current) { removeWidgets(); return; }
      current.requiredAlready = requiredAlready(text, current);
      var doc = null;
      try { doc = jsyaml.load(text); } catch (e) { /* menu still works from text */ }
      var options = optionsFor(current, doc);
      if (!options.length) { removeWidgets(); return; }
      current.options = options;
      var keyLine = current.target.line;
      var len = cm.getLine(keyLine).length;
      if (!menu.hidden) return; // don't move things while the menu is open
      cm.addWidget({ line: keyLine, ch: len }, pill, false);
    }

    function scheduleRefresh() {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    }

    pill.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pill.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!current || !current.options) return;
      menu.innerHTML = '';
      var title = document.createElement('div');
      title.className = 'sdui-rule-title';
      title.textContent = current.kind === 'parameter'
        ? 'Rules for parameter "' + current.name + '"'
        : 'Rules for "' + current.name + '"' + (current.type ? ' (' + current.type + ')' : '');
      menu.appendChild(title);
      var wrap = document.createElement('div');
      wrap.className = 'sdui-menu-sub sdui-rule-chips';
      current.options.forEach(function (o) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sdui-menu-sub-item';
        b.textContent = o.label || o.key;
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          pick(o.key);
        });
        wrap.appendChild(b);
      });
      menu.appendChild(wrap);
      var keyLine = current.target.line;
      cm.addWidget({ line: keyLine, ch: cm.getLine(keyLine).length }, menu, false);
      menu.hidden = false;
    });

    function pick(key) {
      menu.hidden = true;
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      var result = plan(cm.getValue(), cm.getCursor().line, key);
      if (result.error) {
        opts.setStatus('err', 'Cannot add rule: ' + result.error);
        return;
      }
      (result.edits || []).forEach(function (edit) {
        cm.replaceRange(edit.text, { line: edit.at, ch: 0 }, { line: edit.at, ch: cm.getLine(edit.at).length });
      });
      (result.insertions || []).slice().sort(function (a, b) { return b.at - a.at; })
        .forEach(function (ins) {
          cm.replaceRange(ins.lines.join('\n') + '\n', { line: ins.at, ch: 0 });
        });
      if (result.select && result.insertions.length) {
        var from = result.insertions[0].at;
        for (var i = from; i < cm.lineCount(); i++) {
          var idx = cm.getLine(i).indexOf(result.select);
          if (idx !== -1) {
            cm.setSelection({ line: i, ch: idx }, { line: i, ch: idx + result.select.length });
            break;
          }
        }
      }
      cm.focus();
      opts.setStatus('ok', result.message);
    }

    cm.on('cursorActivity', scheduleRefresh);
    cm.on('blur', function () {
      // Let clicks on the pill/menu land before tearing them down.
      setTimeout(function () {
        if (!menu.contains(document.activeElement) && document.activeElement !== pill) {
          if (menu.hidden) removeWidgets();
        }
      }, 150);
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== pill) {
        menu.hidden = true;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      }
    });
  }

  window.SduiConstraints = { init: init, plan: plan, detect: detect, CATALOG: CATALOG };
})();

/* Swagger Dark UI — in-editor find bar (Ctrl/Cmd+F).
   Highlights every match of the query in the YAML editor, cycles through
   them with Enter/Shift+Enter or the arrow buttons, shows an i/N counter,
   and closes with Esc. Uses the CodeMirror searchcursor addon. */
(function () {
  'use strict';

  var MATCH_LIMIT = 5000;

  function init(opts) {
    var cm = opts.editor;
    var bar = document.getElementById('editor-findbar');
    var input = document.getElementById('findbar-input');
    var count = document.getElementById('findbar-count');
    var marks = [];
    var matches = [];
    var current = -1;
    var timer = null;

    function clearMarks() {
      marks.forEach(function (m) { m.clear(); });
      marks = [];
      matches = [];
      current = -1;
      count.textContent = '';
      count.classList.remove('none');
    }

    function posLE(a, b) {
      return a.line < b.line || (a.line === b.line && a.ch <= b.ch);
    }

    function goTo(i, scroll) {
      if (!matches.length) return;
      current = ((i % matches.length) + matches.length) % matches.length;
      var m = matches[current];
      if (scroll !== false) cm.scrollIntoView({ from: m.from, to: m.to }, 80);
      cm.setSelection(m.from, m.to);
      count.textContent = (current + 1) + '/' + matches.length;
    }

    function search() {
      clearMarks();
      var q = input.value;
      if (!q) return;
      var cursor = cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: true });
      while (cursor.findNext() && matches.length < MATCH_LIMIT) {
        matches.push({ from: cursor.from(), to: cursor.to() });
      }
      matches.forEach(function (m) {
        marks.push(cm.markText(m.from, m.to, { className: 'cm-find-match' }));
      });
      if (!matches.length) {
        count.textContent = '0 results';
        count.classList.add('none');
        return;
      }
      // Start from the first match at or after the cursor.
      var here = cm.getCursor('from');
      var start = 0;
      for (var i = 0; i < matches.length; i++) {
        if (posLE(here, matches[i].from)) { start = i; break; }
      }
      goTo(start);
    }

    function open() {
      var selection = cm.getSelection();
      bar.hidden = false;
      if (selection && selection.indexOf('\n') === -1 && selection.length < 200) {
        input.value = selection;
      }
      input.focus();
      input.select();
      search();
    }

    function close() {
      clearMarks();
      bar.hidden = true;
      cm.focus();
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(search, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        goTo(current + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.getElementById('findbar-prev').addEventListener('click', function () { goTo(current - 1); });
    document.getElementById('findbar-next').addEventListener('click', function () { goTo(current + 1); });
    document.getElementById('findbar-close').addEventListener('click', close);

    return { open: open, close: close };
  }

  window.SduiFindbar = { init: init };
})();

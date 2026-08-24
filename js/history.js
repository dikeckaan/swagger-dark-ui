/* Swagger Dark UI — version history for the YAML editor.
   Keeps LZString-compressed snapshots of each saved spec in localStorage:
   automatic ones as you edit (rate-limited) plus manual "Snapshot now".
   The History dropdown lists them with Restore and a line-diff view against
   the current editor content. Everything stays in this browser. */
(function () {
  'use strict';

  var STORE_KEY = 'sdui-history';
  var MAX_PER_DOC = 20;
  var AUTO_INTERVAL_MS = 5 * 60 * 1000; // at most one automatic snapshot per 5 min

  function loadAll() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return d && typeof d === 'object' ? d : {};
    } catch (e) { return {}; }
  }

  function saveAll(all) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
      return true;
    } catch (e) {
      // Quota — drop the oldest snapshot anywhere and retry once.
      var oldest = null;
      Object.keys(all).forEach(function (id) {
        var list = all[id];
        if (list.length && (!oldest || list[list.length - 1].t < oldest.t)) {
          oldest = { id: id, t: list[list.length - 1].t };
        }
      });
      if (!oldest) return false;
      all[oldest.id].pop();
      if (!all[oldest.id].length) delete all[oldest.id];
      try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); return true; }
      catch (e2) { return false; }
    }
  }

  function record(docId, text, force) {
    if (!docId || typeof text !== 'string' || !text.trim()) return false;
    var all = loadAll();
    var list = all[docId] || (all[docId] = []);
    var z = LZString.compressToUTF16(text);
    if (list.length) {
      if (list[0].z === z) return false; // unchanged
      if (!force && Date.now() - list[0].t < AUTO_INTERVAL_MS) return false;
    }
    list.unshift({ t: Date.now(), z: z, n: text.split('\n').length });
    if (list.length > MAX_PER_DOC) list.length = MAX_PER_DOC;
    return saveAll(all);
  }

  function list(docId) {
    return (loadAll()[docId] || []).map(function (s, i) {
      return { index: i, t: s.t, lines: s.n };
    });
  }

  function get(docId, index) {
    var s = (loadAll()[docId] || [])[index];
    return s ? LZString.decompressFromUTF16(s.z) : null;
  }

  /* Drop history of deleted docs. */
  function prune(existingIds) {
    var all = loadAll();
    var changed = false;
    Object.keys(all).forEach(function (id) {
      if (existingIds.indexOf(id) === -1) { delete all[id]; changed = true; }
    });
    if (changed) saveAll(all);
  }

  /* ----- line diff (trimmed LCS with a size guard) ----- */

  function diff(oldText, newText) {
    var a = oldText.split('\n');
    var b = newText.split('\n');
    var start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    var endA = a.length;
    var endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    var out = [];
    var i;
    for (i = Math.max(0, start - 2); i < start; i++) out.push({ type: 'same', text: a[i] });

    var midA = a.slice(start, endA);
    var midB = b.slice(start, endB);
    if (midA.length * midB.length > 500000) {
      // Too big for LCS — plain replace view.
      midA.forEach(function (l) { out.push({ type: 'del', text: l }); });
      midB.forEach(function (l) { out.push({ type: 'add', text: l }); });
    } else {
      // Classic LCS table over the changed middle.
      var m = midA.length;
      var n = midB.length;
      var table = new Array((m + 1) * (n + 1)).fill(0);
      for (i = m - 1; i >= 0; i--) {
        for (var j = n - 1; j >= 0; j--) {
          table[i * (n + 1) + j] = midA[i] === midB[j]
            ? table[(i + 1) * (n + 1) + j + 1] + 1
            : Math.max(table[(i + 1) * (n + 1) + j], table[i * (n + 1) + j + 1]);
        }
      }
      var x = 0;
      var y = 0;
      while (x < m && y < n) {
        if (midA[x] === midB[y]) { out.push({ type: 'same', text: midA[x] }); x++; y++; }
        else if (table[(x + 1) * (n + 1) + y] >= table[x * (n + 1) + y + 1]) {
          out.push({ type: 'del', text: midA[x] }); x++;
        } else {
          out.push({ type: 'add', text: midB[y] }); y++;
        }
      }
      while (x < m) { out.push({ type: 'del', text: midA[x] }); x++; }
      while (y < n) { out.push({ type: 'add', text: midB[y] }); y++; }
    }

    for (i = endA; i < Math.min(a.length, endA + 2); i++) out.push({ type: 'same', text: a[i] });
    return out;
  }

  /* ----- UI ----- */

  function fmtTime(t) {
    var d = new Date(t);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return sameDay ? hm : d.toISOString().slice(0, 10) + ' ' + hm;
  }

  function showDiffModal(entries, title) {
    var overlay = document.createElement('div');
    overlay.className = 'sdui-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'sdui-modal';
    var head = document.createElement('div');
    head.className = 'sdui-modal-head';
    var caption = document.createElement('span');
    caption.textContent = title;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sdui-tool-btn';
    close.textContent = 'Close';
    head.appendChild(caption);
    head.appendChild(close);
    var body = document.createElement('pre');
    body.className = 'sdui-diff';
    var changed = 0;
    entries.forEach(function (e) {
      var lineEl = document.createElement('div');
      lineEl.className = 'sdui-diff-' + e.type;
      lineEl.textContent = (e.type === 'add' ? '+ ' : e.type === 'del' ? '- ' : '  ') + e.text;
      body.appendChild(lineEl);
      if (e.type !== 'same') changed++;
    });
    if (!changed) {
      var none = document.createElement('div');
      none.className = 'sdui-diff-same';
      none.textContent = '(no differences)';
      body.insertBefore(none, body.firstChild);
    }
    modal.appendChild(head);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    function dismiss() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);
  }

  function init(opts) {
    var button = opts.button;
    var menu = opts.menu;

    function rebuild() {
      menu.innerHTML = '';
      var snapBtn = document.createElement('div');
      snapBtn.className = 'sdui-menu-item';
      var snapLabel = document.createElement('div');
      snapLabel.className = 'sdui-menu-label';
      snapLabel.textContent = '📸 Snapshot now';
      snapBtn.appendChild(snapLabel);
      snapLabel.addEventListener('click', function () {
        var saved = record(opts.getDocId(), opts.getText(), true);
        opts.setStatus('ok', saved ? 'Snapshot saved' : 'Nothing new to snapshot');
        closeMenu();
      });
      menu.appendChild(snapBtn);

      var entries = list(opts.getDocId());
      if (!entries.length) {
        var empty = document.createElement('div');
        empty.className = 'sdui-menu-empty';
        empty.textContent = 'No snapshots yet — they are taken automatically as you edit.';
        menu.appendChild(empty);
        return;
      }
      entries.forEach(function (s) {
        var row = document.createElement('div');
        row.className = 'sdui-menu-item sdui-history-row';
        var label = document.createElement('span');
        label.className = 'sdui-history-when';
        label.textContent = fmtTime(s.t) + ' · ' + s.lines + ' lines';
        var actions = document.createElement('span');
        actions.className = 'sdui-history-actions';
        var diffBtn = document.createElement('button');
        diffBtn.type = 'button';
        diffBtn.className = 'sdui-menu-sub-item';
        diffBtn.textContent = 'Diff';
        diffBtn.addEventListener('click', function () {
          closeMenu();
          var old = get(opts.getDocId(), s.index);
          if (old !== null) {
            showDiffModal(diff(old, opts.getText()),
              'Changes since ' + fmtTime(s.t) + ' (− snapshot, + current)');
          }
        });
        var restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'sdui-menu-sub-item';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', function () {
          closeMenu();
          var old = get(opts.getDocId(), s.index);
          if (old === null) return;
          record(opts.getDocId(), opts.getText(), true); // keep the current state reachable
          opts.setText(old);
          opts.setStatus('ok', 'Restored the snapshot from ' + fmtTime(s.t) +
            ' — the previous state was snapshotted too');
        });
        actions.appendChild(diffBtn);
        actions.appendChild(restoreBtn);
        row.appendChild(label);
        row.appendChild(actions);
        menu.appendChild(row);
      });
    }

    function closeMenu() { menu.hidden = true; }

    button.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) rebuild();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== button) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  }

  window.SduiHistory = { init: init, record: record, list: list, get: get, prune: prune, diff: diff };
})();

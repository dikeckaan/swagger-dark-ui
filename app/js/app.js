/* Swagger Dark UI — app bootstrap: spec selector, theme toggle, custom-spec
   YAML editor with live preview, Swagger UI init. */
(function () {
  'use strict';

  var SPECS = {
    demo: {
      url: 'specs/demo-api.yaml',
      label: 'Demo API — full feature showcase',
      copyName: 'Demo API (copy)',
      mock: true // parse the document so the in-browser mock can answer requests
    },
    petstore: {
      url: 'https://petstore3.swagger.io/api/v3/openapi.json',
      label: 'Swagger Petstore (live)',
      copyName: 'Petstore (copy)',
      // The Petstore spec declares a relative server (/api/v3), which would
      // resolve against this site's origin — send those calls to the live
      // Petstore host instead.
      requestInterceptor: function (req) {
        var apiPath = req.url.indexOf('/api/v3');
        if (req.url.indexOf(window.location.origin) === 0 && apiPath !== -1) {
          req.url = 'https://petstore3.swagger.io' + req.url.slice(apiPath);
        }
        return req;
      }
    },
    custom: {
      label: 'My API — YAML editor'
    }
  };
  // The standalone build overrides this to 'custom' so the downloaded file
  // opens straight into the editor's split view, like the site's CTAs do.
  var DEFAULT_SPEC = window.SDUI_DEFAULT_SPEC || 'demo';
  var THEME_KEY = 'sdui-theme';
  var SPEC_KEY = 'sdui-spec';
  var CUSTOM_SPEC_KEY = 'sdui-custom-spec'; // legacy single-doc slot, migrated below
  var DOCS_KEY = 'sdui-custom-specs';
  var ACTIVE_DOC_KEY = 'sdui-custom-active';
  var LAYOUT_KEY = 'sdui-layout';
  var LAYOUTS = ['editor', 'split', 'preview'];
  var RENDER_DEBOUNCE_MS = 700;

  var CUSTOM_TEMPLATE = [
    'openapi: 3.0.3',
    'info:',
    '  title: My API',
    '  version: 1.0.0',
    '  description: |',
    '    Paste your own OpenAPI document here — it renders live on the right.',
    '',
    '    Your edits are saved in this browser automatically. Use **Load URL**',
    '    to fetch a spec from your own server (it must allow CORS), **Open file**',
    '    to load a local YAML/JSON file, and **Download** to save your work.',
    '',
    '    Try it out works instantly: an **in-browser mock** server is added as the',
    '    default, so requests are answered locally from your schemas and examples.',
    '    Your own servers below stay selectable in the Servers dropdown.',
    'servers:',
    '  - url: https://api.example.com/v1',
    'paths:',
    '  /hello:',
    '    get:',
    '      summary: Say hello',
    '      operationId: sayHello',
    '      parameters:',
    '        - name: name',
    '          in: query',
    '          schema:',
    '            type: string',
    '            default: world',
    '      responses:',
    "        '200':",
    '          description: A friendly greeting',
    '          content:',
    '            application/json:',
    '              schema:',
    '                type: object',
    '                properties:',
    '                  message:',
    '                    type: string',
    ''
  ].join('\n');

  var specSelect = document.getElementById('spec-select');
  var themeToggle = document.getElementById('theme-toggle');
  var editorPane = document.getElementById('editor-pane');
  var editorStatus = document.getElementById('editor-status');
  var editorIssues = document.getElementById('editor-issues');
  var issuesHandle = document.getElementById('issues-handle');
  var fileInput = document.getElementById('editor-file-input');

  var editor = null;        // CodeMirror instance, created lazily
  var renderTimer = null;
  var lastRenderedText = null;

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  /* ----- saved custom specs (multi-document store) ----- */

  function newDocId() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function loadDocs() {
    try {
      var d = JSON.parse(storageGet(DOCS_KEY) || 'null');
      if (d && typeof d === 'object' && Object.keys(d).length) return d;
    } catch (e) { /* corrupted — start over */ }
    return null;
  }

  var docs = loadDocs();
  if (!docs) {
    // First run (or migration from the old single-spec slot).
    docs = {};
    var migrated = newDocId();
    docs[migrated] = {
      name: 'My API',
      text: storageGet(CUSTOM_SPEC_KEY) || CUSTOM_TEMPLATE,
      updatedAt: Date.now()
    };
    storageSet(ACTIVE_DOC_KEY, migrated);
  }

  function saveDocs() { storageSet(DOCS_KEY, JSON.stringify(docs)); }
  saveDocs();

  function activeDocId() {
    var id = storageGet(ACTIVE_DOC_KEY);
    if (id && docs[id]) return id;
    id = Object.keys(docs)[0];
    storageSet(ACTIVE_DOC_KEY, id);
    return id;
  }

  function addDoc(name, text) {
    var id = newDocId();
    docs[id] = { name: name, text: text, updatedAt: Date.now() };
    saveDocs();
    storageSet(ACTIVE_DOC_KEY, id);
    return id;
  }

  /* ----- header height (the bar wraps to two rows on small screens) ----- */

  var headerEl = document.querySelector('.sdui-header');
  function syncHeaderHeight() {
    document.documentElement.style.setProperty('--header-h', headerEl.offsetHeight + 'px');
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncHeaderHeight).observe(headerEl);
  } else {
    window.addEventListener('resize', syncHeaderHeight);
  }
  syncHeaderHeight();

  /* ----- theme ----- */

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    storageSet(THEME_KEY, theme);
  }

  themeToggle.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ----- color palette ----- */

  var paletteSelect = document.getElementById('palette-select');
  paletteSelect.value = document.documentElement.getAttribute('data-palette') || 'default';
  paletteSelect.addEventListener('change', function () {
    document.documentElement.setAttribute('data-palette', paletteSelect.value);
    storageSet('sdui-palette', paletteSelect.value);
  });

  /* ----- full screen ----- */

  var fullscreenToggle = document.getElementById('fullscreen-toggle');
  fullscreenToggle.addEventListener('click', function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(function () { /* unsupported */ });
    }
  });
  document.addEventListener('fullscreenchange', function () {
    document.documentElement.classList.toggle('is-fullscreen', !!document.fullscreenElement);
  });

  /* ----- editor layout (editor / split / preview) ----- */

  var layoutSwitch = document.getElementById('layout-switch');
  var layoutButtons = layoutSwitch.querySelectorAll('button');

  function applyLayout(layout) {
    if (LAYOUTS.indexOf(layout) === -1) layout = 'split';
    document.body.setAttribute('data-layout', layout);
    storageSet(LAYOUT_KEY, layout);
    for (var i = 0; i < layoutButtons.length; i++) {
      layoutButtons[i].classList.toggle('active',
        layoutButtons[i].getAttribute('data-layout') === layout);
    }
    // CodeMirror must re-measure after its pane is resized or unhidden.
    if (editor && layout !== 'preview') {
      setTimeout(function () { editor.refresh(); }, 0);
    }
  }

  layoutSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-layout]');
    if (btn) applyLayout(btn.getAttribute('data-layout'));
  });

  /* ----- request code snippets ----- */

  function snippetParts(request) {
    var headers = request.get('headers');
    return {
      url: request.get('url'),
      method: (request.get('method') || 'GET').toUpperCase(),
      headers: headers && headers.toJS ? headers.toJS() : (headers || {}),
      body: request.get('body')
    };
  }

  var SnippetsPlugin = {
    fn: {
      requestSnippetGenerator_js_fetch: function (request) {
        var r = snippetParts(request);
        var lines = ['const response = await fetch(' + JSON.stringify(r.url) + ', {'];
        lines.push('  method: ' + JSON.stringify(r.method) + ',');
        if (Object.keys(r.headers).length) {
          lines.push('  headers: ' + JSON.stringify(r.headers, null, 2).replace(/\n/g, '\n  ') + ',');
        }
        if (typeof r.body === 'string' && r.body.length) {
          lines.push('  body: ' + JSON.stringify(r.body) + ',');
        } else if (r.body && typeof FormData !== 'undefined' && r.body instanceof FormData) {
          lines.push('  body: formData, // build a FormData with your file/fields');
        }
        lines.push('});');
        lines.push('');
        lines.push('const data = await response.json();');
        lines.push('console.log(response.status, data);');
        return lines.join('\n');
      },
      requestSnippetGenerator_python: function (request) {
        var r = snippetParts(request);
        var lines = ['import requests', ''];
        lines.push('response = requests.request(');
        lines.push('    ' + JSON.stringify(r.method) + ',');
        lines.push('    ' + JSON.stringify(r.url) + ',');
        if (Object.keys(r.headers).length) {
          lines.push('    headers=' + JSON.stringify(r.headers) + ',');
        }
        if (typeof r.body === 'string' && r.body.length) {
          lines.push("    data=r'''" + r.body.replace(/'''/g, "\\'\\'\\'") + "''',");
        } else if (r.body && typeof FormData !== 'undefined' && r.body instanceof FormData) {
          lines.push("    files={'file': open('path/to/file', 'rb')},  # multipart body");
        }
        lines.push(')');
        lines.push('');
        lines.push('print(response.status_code)');
        lines.push('print(response.text)');
        return lines.join('\n');
      }
    }
  };

  /* ----- swagger ui ----- */

  function baseConfig() {
    return {
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      deepLinking: true,
      filter: false, // replaced by the full-text operation search (js/opsearch.js)
      displayRequestDuration: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      displayOperationId: false,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      showExtensions: true,
      showCommonExtensions: true,
      queryConfigEnabled: false,
      validatorUrl: null,
      plugins: [SnippetsPlugin],
      requestSnippetsEnabled: true,
      requestSnippets: {
        generators: {
          curl_bash: { title: 'cURL (bash)', syntax: 'bash' },
          curl_powershell: { title: 'cURL (PowerShell)', syntax: 'powershell' },
          curl_cmd: { title: 'cURL (CMD)', syntax: 'bash' },
          js_fetch: { title: 'JavaScript (fetch)', syntax: 'javascript' },
          python: { title: 'Python (requests)', syntax: 'python' }
        },
        defaultExpanded: true,
        languages: null
      }
    };
  }

  function renderFromUrl(specId) {
    var config = baseConfig();
    config.url = SPECS[specId].url;
    config.requestInterceptor = SPECS[specId].requestInterceptor;
    config.onComplete = function () {
      document.title = SPECS[specId].label + ' · OASForge';
    };
    window.ui = SwaggerUIBundle(config);

    // Feed the parsed document to the in-browser mock (so it can answer
    // requests) and to the operation search (so it can index the spec).
    window.SduiMock.setSpec(null);
    if (window.SduiOpSearch) SduiOpSearch.setSpec(null);
    fetch(SPECS[specId].url)
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var parsedSpec = jsyaml.load(text);
        if (SPECS[specId].mock) window.SduiMock.setSpec(parsedSpec);
        if (window.SduiOpSearch) SduiOpSearch.setSpec(parsedSpec);
      })
      .catch(function () { /* mock/search stay disabled; live servers still work */ });
  }

  function renderFromObject(specObject) {
    var config = baseConfig();
    config.spec = specObject;
    window.ui = SwaggerUIBundle(config);
    if (window.SduiOpSearch) SduiOpSearch.setSpec(specObject);
    document.title = SPECS.custom.label + ' · OASForge';
  }

  /* ----- custom spec editor ----- */

  function setEditorStatus(kind, message) {
    editorStatus.className = kind;
    editorStatus.textContent = message;
  }

  /* ----- OpenAPI validation issues (panel under the editor) ----- */

  var issueMarks = []; // CodeMirror line handles carrying issue backgrounds

  function clearIssues() {
    issueMarks.forEach(function (mark) {
      editor.removeLineClass(mark.handle, 'background', mark.cls);
    });
    issueMarks = [];
    editorIssues.innerHTML = '';
    editorIssues.hidden = true;
    issuesHandle.hidden = true;
    document.getElementById('editor-convert20').hidden = true;
  }

  /* Dismissed warnings are remembered per saved document (persisted with
     it), keyed by a stable path+message signature — not by line number,
     so they survive edits elsewhere in the file. */
  function issueSig(issue) {
    return issue.path.join('.') + '|' + issue.message;
  }

  function dismissWarning(issue) {
    var doc = docs[activeDocId()];
    doc.dismissed = (doc.dismissed || []).concat([issueSig(issue)]);
    saveDocs();
    renderNow();
  }

  function restoreWarnings() {
    docs[activeDocId()].dismissed = [];
    saveDocs();
    renderNow();
  }

  function showIssues(issues, text, hiddenCount) {
    clearIssues();
    if (!issues.length && !hiddenCount) return;
    editorIssues.hidden = false;
    issuesHandle.hidden = false;
    issues.forEach(function (issue) {
      var line = window.SduiValidate ? SduiValidate.locate(text, issue.path) : -1;
      var li = document.createElement('li');
      li.className = 'sdui-issue ' + issue.severity;
      li.title = issue.path.join('.') || '(document root)';

      var badge = document.createElement('span');
      badge.className = 'sdui-issue-badge';
      badge.textContent = issue.severity === 'error' ? 'error' : 'warn';
      li.appendChild(badge);

      var msg = document.createElement('span');
      msg.className = 'sdui-issue-msg';
      msg.textContent = issue.message;
      li.appendChild(msg);

      var fix = window.SduiQuickfix ? SduiQuickfix.fixFor(issue, text) : null;
      if (fix) {
        var fixBtn = document.createElement('button');
        fixBtn.type = 'button';
        fixBtn.className = 'sdui-issue-fix';
        fixBtn.textContent = 'Fix: ' + fix.label;
        fixBtn.addEventListener('click', function (e) {
          e.stopPropagation(); // don't also jump the cursor
          var fixed = fix.apply();
          if (fixed && fixed !== text) {
            editor.setValue(fixed); // one undoable operation
            renderNow(); // re-validates, so the status and issue list update
          }
        });
        li.appendChild(fixBtn);
      }

      var where = document.createElement('span');
      where.className = 'sdui-issue-where';
      where.textContent = line !== -1 ? 'line ' + (line + 1) : (issue.path.join('.') || 'document');
      li.appendChild(where);

      if (issue.severity === 'warning') {
        var dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'sdui-issue-dismiss';
        dismissBtn.title = 'Hide this warning (restorable below)';
        dismissBtn.textContent = '×';
        dismissBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          dismissWarning(issue);
        });
        li.appendChild(dismissBtn);
      }

      if (line !== -1) {
        li.addEventListener('click', function () { flashEditorLine(line); });
        var cls = issue.severity === 'error' ? 'cm-issue-error' : 'cm-issue-warn';
        issueMarks.push({ handle: editor.addLineClass(line, 'background', cls), cls: cls });
      }
      editorIssues.appendChild(li);
    });

    if (hiddenCount) {
      var restoreRow = document.createElement('li');
      restoreRow.className = 'sdui-issue-restore';
      restoreRow.textContent = hiddenCount + ' hidden warning' + (hiddenCount === 1 ? '' : 's') + ' — ';
      var restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.textContent = 'show ' + (hiddenCount === 1 ? 'it' : 'them') + ' again';
      restoreBtn.addEventListener('click', restoreWarnings);
      restoreRow.appendChild(restoreBtn);
      editorIssues.appendChild(restoreRow);
    }
  }

  function renderEditorContent() {
    var text = editor.getValue();
    var doc = docs[activeDocId()];
    doc.text = text;
    doc.updatedAt = Date.now();
    saveDocs();
    updateConvertLabel();

    var parsed;
    try {
      parsed = jsyaml.load(text);
    } catch (err) {
      var where = err.mark ? ' (line ' + (err.mark.line + 1) + ')' : '';
      clearIssues();
      setEditorStatus('err', 'YAML error' + where + ': ' + err.reason);
      return; // keep the last good render on the right
    }
    if (!parsed || typeof parsed !== 'object') {
      clearIssues();
      setEditorStatus('err', 'Document is empty — start with "openapi: 3.0.3"');
      return;
    }
    if (!parsed.openapi && !parsed.swagger) {
      // Pasted Postman collections are converted in place.
      var postmanKind = window.SduiPostman && SduiPostman.detect(parsed);
      if (postmanKind === 'v2') {
        try {
          var converted = SduiPostman.tryConvert(text);
          if (converted) {
            editor.setValue(converted.yaml); // change event re-renders
            setEditorStatus('ok', 'Postman collection detected — converted to OpenAPI 3');
            return;
          }
        } catch (convErr) {
          clearIssues(); // also hides a stale Swagger-2.0 banner
          setEditorStatus('err', 'Postman conversion failed: ' + convErr.message);
          return;
        }
      }
      if (postmanKind === 'v1') {
        clearIssues();
        setEditorStatus('err', 'This is a Postman Collection v1 export — in Postman choose Export → Collection v2.1 and try again');
        return;
      }
      clearIssues();
      if (parsed.swaggerVersion) {
        setEditorStatus('err', 'This is a Swagger 1.x document (swaggerVersion: ' + parsed.swaggerVersion +
          ') — 1.x is not supported; export it as Swagger 2.0 or OpenAPI 3 from your API tool');
        return;
      }
      // Offer the one-click default rather than just complaining.
      showIssues([{
        severity: 'error',
        path: [],
        message: 'Missing "openapi" (or "swagger") version field',
        code: 'add-openapi'
      }], text, 0);
      setEditorStatus('err', 'Missing "openapi" (or "swagger") version field');
      return;
    }

    // Lint the document the way Swagger Editor would; issues are listed in a
    // panel under the editor but never block the preview (Swagger UI renders
    // what it can, so the user still sees the effect of the mistake).
    var issues = [];
    if (window.SduiValidate) {
      try { issues = SduiValidate.validate(parsed); }
      catch (lintErr) { /* a linter bug must not block rendering */ }
    }
    // Hide warnings the user dismissed for this document; prune signatures
    // that no longer fire so the stored list can't grow without bound.
    var dismissed = doc.dismissed || [];
    if (dismissed.length) {
      var firing = {};
      issues.forEach(function (issue) { firing[issueSig(issue)] = true; });
      var pruned = dismissed.filter(function (sig) { return firing[sig]; });
      if (pruned.length !== dismissed.length) {
        doc.dismissed = pruned;
        saveDocs();
      }
      dismissed = pruned;
    }
    var visible = issues.filter(function (issue) {
      return issue.severity !== 'warning' || dismissed.indexOf(issueSig(issue)) === -1;
    });
    var hiddenCount = issues.length - visible.length;

    showIssues(visible, text, hiddenCount);
    // Accept the unquoted "swagger: 2.0" too — YAML parses it as the number 2.
    document.getElementById('editor-convert20').hidden =
      parsed.swagger === undefined || !/^2(\.|$)/.test(String(parsed.swagger));
    var errorCount = 0;
    var warningCount = 0;
    visible.forEach(function (issue) {
      if (issue.severity === 'error') errorCount++; else warningCount++;
    });
    var hiddenNote = hiddenCount ? ' (' + hiddenCount + ' hidden)' : '';
    if (errorCount) {
      setEditorStatus('err', errorCount + ' error' + (errorCount === 1 ? '' : 's') +
        (warningCount ? ', ' + warningCount + ' warning' + (warningCount === 1 ? '' : 's') : '') +
        hiddenNote + ' — still rendering; click an issue to jump to its line');
    } else if (warningCount) {
      setEditorStatus('warn', warningCount + ' warning' + (warningCount === 1 ? '' : 's') +
        hiddenNote + ' — rendering live; click an issue to jump to its line');
    } else {
      setEditorStatus('ok', 'Valid — rendering live' + hiddenNote);
    }

    if (text === lastRenderedText) return;
    lastRenderedText = text;

    // Rate-limited automatic snapshot for the History dropdown.
    if (window.SduiHistory) SduiHistory.record(activeDocId(), text);

    // Make the in-browser mock the default server and offer a free-text
    // "your own server" entry; the user's own servers stay selectable.
    // Render-time only — the editor text and downloads are untouched.
    var withMock = Object.assign({}, parsed);
    withMock.servers = [{
      url: window.SduiMock.ORIGIN,
      description: 'In-browser mock (default) — requests never leave this page'
    }].concat(parsed.servers || []).concat([{
      url: '{server}',
      description: 'Your own server — type any base URL below (localhost works too; the API must allow CORS)',
      variables: {
        server: {
          'default': 'http://localhost:3000',
          description: 'Base URL of your API, e.g. http://localhost:3000'
        }
      }
    }]);
    window.SduiMock.setSpec(withMock);

    renderFromObject(withMock);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderEditorContent, RENDER_DEBOUNCE_MS);
  }

  function ensureEditor() {
    if (editor) return;
    editor = CodeMirror(document.getElementById('editor-host'), {
      value: docs[activeDocId()].text,
      mode: 'yaml',
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      viewportMargin: 20,
      extraKeys: {
        Tab: function (cm) { cm.replaceSelection('  ', 'end'); },
        'Cmd-S': downloadSpec,
        'Ctrl-S': downloadSpec,
        'Cmd-Enter': renderNow,
        'Ctrl-Enter': renderNow
      }
    });
    editor.on('change', scheduleRender);
    wireDocControls();
    refreshDocSelect();
    updateConvertLabel();

    if (window.SduiComplete && CodeMirror.showHint) {
      SduiComplete.init(editor);
    }

    if (window.SduiConstraints) {
      SduiConstraints.init({ editor: editor, setStatus: setEditorStatus });
    }

    if (window.SduiFindbar && editor.getSearchCursor) {
      var findbar = SduiFindbar.init({ editor: editor });
      document.getElementById('editor-find').addEventListener('click', function () {
        findbar.open();
      });
      // Ctrl/Cmd+F opens the in-code find bar whenever the editor pane is
      // visible; plain preview pages keep the browser's native find.
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
            (e.key === 'f' || e.key === 'F')) {
          if (!document.body.classList.contains('editor-active')) return;
          if (document.body.getAttribute('data-layout') === 'preview') return;
          e.preventDefault();
          findbar.open();
        }
      });
    }

    /* ----- drag-to-resize: editor/preview split + issues panel ----- */

    function initDrag(handle, opts) {
      var refreshTimer = null;
      handle.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('dragging');
        function onMove(ev) {
          opts.move(ev);
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(function () { editor.refresh(); }, 80);
        }
        function onUp() {
          handle.classList.remove('dragging');
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          editor.refresh();
        }
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
      handle.addEventListener('dblclick', function () {
        opts.reset();
        editor.refresh();
      });
    }

    var workspace = document.getElementById('workspace');
    var savedSplit = parseInt(storageGet('sdui-split-w'), 10);
    if (savedSplit) workspace.style.setProperty('--split-w', savedSplit + 'px');
    initDrag(document.getElementById('split-handle'), {
      move: function (e) {
        var rect = workspace.getBoundingClientRect();
        var w = Math.min(Math.max(e.clientX - rect.left, 300), Math.max(rect.width - 360, 300));
        workspace.style.setProperty('--split-w', w + 'px');
        storageSet('sdui-split-w', String(Math.round(w)));
      },
      reset: function () {
        workspace.style.removeProperty('--split-w');
        try { localStorage.removeItem('sdui-split-w'); } catch (e) { /* ignore */ }
      }
    });

    function applyIssuesHeight(h) {
      editorIssues.style.setProperty('--issues-h', h + 'px');
      editorIssues.classList.add('resized');
    }
    var savedIssuesH = parseInt(storageGet('sdui-issues-h'), 10);
    if (savedIssuesH) applyIssuesHeight(savedIssuesH);
    initDrag(issuesHandle, {
      move: function (e) {
        var rect = editorIssues.getBoundingClientRect();
        var paneRect = editorPane.getBoundingClientRect();
        var h = Math.min(Math.max(rect.bottom - e.clientY, 48), paneRect.height - 160);
        applyIssuesHeight(h);
        storageSet('sdui-issues-h', String(Math.round(h)));
      },
      reset: function () {
        editorIssues.classList.remove('resized');
        editorIssues.style.removeProperty('--issues-h');
        try { localStorage.removeItem('sdui-issues-h'); } catch (e) { /* ignore */ }
      }
    });

    var undoBtn = document.getElementById('editor-undo');
    var redoBtn = document.getElementById('editor-redo');
    function syncHistoryButtons() {
      var h = editor.historySize();
      undoBtn.disabled = !h.undo;
      redoBtn.disabled = !h.redo;
    }
    undoBtn.addEventListener('click', function () {
      editor.undo();
      editor.focus();
    });
    redoBtn.addEventListener('click', function () {
      editor.redo();
      editor.focus();
    });
    editor.on('change', function () { setTimeout(syncHistoryButtons, 0); });
    syncHistoryButtons();
    document.getElementById('editor-copy').addEventListener('click', function () {
      copyText(editor.getValue()).then(function () {
        setEditorStatus('ok', 'Spec copied to the clipboard');
      }).catch(function () {
        setEditorStatus('err', 'Could not copy to the clipboard');
      });
    });

    if (window.SduiExport) {
      SduiExport.init({
        button: document.getElementById('editor-export'),
        menu: document.getElementById('editor-export-menu'),
        getText: function () { return editor.getValue(); },
        setStatus: setEditorStatus
      });
    }

    if (window.SduiHistory) {
      SduiHistory.init({
        button: document.getElementById('doc-history'),
        menu: document.getElementById('doc-history-menu'),
        getDocId: activeDocId,
        getText: function () { return editor.getValue(); },
        setText: function (text) { editor.setValue(text); renderNow(); },
        setStatus: setEditorStatus
      });
    }

    document.getElementById('editor-convert20-go').addEventListener('click', function () {
      try {
        // Re-check at click time: the banner can lag behind fast edits, so
        // never trust it — verify the CURRENT text really is Swagger 2.0.
        var current = jsyaml.load(editor.getValue());
        if (!current || typeof current !== 'object' ||
            current.swagger === undefined || !/^2(\.|$)/.test(String(current.swagger))) {
          document.getElementById('editor-convert20').hidden = true;
          setEditorStatus('err', 'The document is not (or no longer) Swagger 2.0 — nothing to convert');
          return;
        }
        var converted = SduiConvert20.toYaml(current);
        editor.setValue(converted); // single undo step brings 2.0 back
        renderNow();
        setEditorStatus('ok', 'Converted to OpenAPI 3.0 — review the result (Ctrl/Cmd+Z restores the original)');
      } catch (convErr) {
        setEditorStatus('err', 'Conversion failed: ' + (convErr.reason || convErr.message));
      }
    });

    if (window.SduiSnippets) {
      SduiSnippets.init({
        button: document.getElementById('editor-insert'),
        menu: document.getElementById('editor-insert-menu'),
        getEditor: function () { return editor; },
        setStatus: setEditorStatus,
        onInserted: function (line) { flashEditorLine(line); }
      });
    }

    var urlRow = document.getElementById('editor-url-row');
    var urlInput = document.getElementById('editor-url-input');
    document.getElementById('editor-load-url').addEventListener('click', function () {
      urlRow.hidden = !urlRow.hidden;
      if (!urlRow.hidden) urlInput.focus();
    });
    document.getElementById('editor-url-cancel').addEventListener('click', function () {
      urlRow.hidden = true;
    });
    document.getElementById('editor-url-go').addEventListener('click', loadFromUrl);
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loadFromUrl();
    });

    document.getElementById('editor-open-file').addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', openLocalFile);
    document.getElementById('editor-download').addEventListener('click', downloadSpec);

    var resetBtn = document.getElementById('editor-reset');
    var resetArmedUntil = 0;
    resetBtn.addEventListener('click', function () {
      // Two-step reset instead of a blocking confirm() dialog.
      if (Date.now() < resetArmedUntil) {
        editor.setValue(CUSTOM_TEMPLATE);
        resetBtn.textContent = 'Reset';
        resetArmedUntil = 0;
      } else {
        resetArmedUntil = Date.now() + 3000;
        resetBtn.textContent = 'Sure?';
        setTimeout(function () {
          if (Date.now() >= resetArmedUntil) resetBtn.textContent = 'Reset';
        }, 3100);
      }
    });
  }

  function renderNow() {
    clearTimeout(renderTimer);
    renderEditorContent();
  }

  function refreshDocSelect() {
    var select = document.getElementById('doc-select');
    select.innerHTML = '';
    Object.keys(docs).forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = docs[id].name;
      select.appendChild(opt);
    });
    select.value = activeDocId();
  }

  function switchDoc(id) {
    if (!docs[id]) return;
    storageSet(ACTIVE_DOC_KEY, id);
    lastRenderedText = null;
    editor.setValue(docs[id].text); // change event persists + re-renders
    renderNow();
  }

  function updateConvertLabel() {
    document.getElementById('editor-convert').textContent =
      /^\s*\{/.test(editor.getValue()) ? 'To YAML' : 'To JSON';
  }

  function toggleFormat() {
    var text = editor.getValue();
    try {
      var parsed = jsyaml.load(text);
      if (/^\s*\{/.test(text)) {
        editor.setValue(jsyaml.dump(parsed, { lineWidth: 100, noRefs: true }));
      } else {
        editor.setValue(JSON.stringify(parsed, null, 2));
      }
      renderNow();
    } catch (err) {
      setEditorStatus('err', 'Cannot convert: ' + (err.reason || err.message));
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function shareSpec() {
    if (!/^https?:$/.test(window.location.protocol)) {
      setEditorStatus('err', 'Share links need the hosted version of the site — this copy runs from a local file');
      return;
    }
    var data = LZString.compressToEncodedURIComponent(editor.getValue());
    var link = window.location.origin + window.location.pathname + '?spec=custom#s=' + data;
    copyText(link).then(function () {
      setEditorStatus('ok', link.length > 8000
        ? 'Share link copied — but it is very long (' + link.length + ' chars); some apps truncate long URLs'
        : 'Share link copied to clipboard (' + link.length + ' chars)');
    }).catch(function () {
      setEditorStatus('err', 'Could not copy the link to the clipboard');
    });
  }

  function wireDocControls() {
    var select = document.getElementById('doc-select');
    var renameInput = document.getElementById('doc-rename-input');
    var renameBtn = document.getElementById('doc-rename');
    var deleteBtn = document.getElementById('doc-delete');

    select.addEventListener('change', function () { switchDoc(select.value); });

    document.getElementById('doc-new').addEventListener('click', function () {
      var n = Object.keys(docs).length + 1;
      addDoc('Untitled ' + n, CUSTOM_TEMPLATE);
      refreshDocSelect();
      switchDoc(activeDocId());
    });

    function commitRename() {
      var name = renameInput.value.trim();
      if (name) {
        docs[activeDocId()].name = name;
        saveDocs();
      }
      renameInput.hidden = true;
      select.hidden = false;
      refreshDocSelect();
    }
    renameBtn.addEventListener('click', function () {
      if (renameInput.hidden) {
        renameInput.value = docs[activeDocId()].name;
        select.hidden = true;
        renameInput.hidden = false;
        renameInput.focus();
        renameInput.select();
      } else {
        commitRename();
      }
    });
    renameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') commitRename();
      if (e.key === 'Escape') { renameInput.hidden = true; select.hidden = false; }
    });
    renameInput.addEventListener('blur', commitRename);

    var deleteArmedUntil = 0;
    deleteBtn.addEventListener('click', function () {
      if (Date.now() < deleteArmedUntil) {
        delete docs[activeDocId()];
        if (!Object.keys(docs).length) addDoc('My API', CUSTOM_TEMPLATE);
        saveDocs();
        if (window.SduiHistory) SduiHistory.prune(Object.keys(docs));
        storageSet(ACTIVE_DOC_KEY, Object.keys(docs)[0]);
        refreshDocSelect();
        switchDoc(activeDocId());
        deleteBtn.textContent = 'Delete';
        deleteArmedUntil = 0;
      } else {
        deleteArmedUntil = Date.now() + 3000;
        deleteBtn.textContent = 'Sure?';
        setTimeout(function () {
          if (Date.now() >= deleteArmedUntil) deleteBtn.textContent = 'Delete';
        }, 3100);
      }
    });

    document.getElementById('editor-share').addEventListener('click', shareSpec);
    document.getElementById('editor-convert').addEventListener('click', toggleFormat);
  }

  function loadFromUrl() {
    var urlRow = document.getElementById('editor-url-row');
    var url = document.getElementById('editor-url-input').value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setEditorStatus('err', 'Only http(s) URLs are supported');
      return;
    }
    setEditorStatus('busy', 'Fetching ' + url + ' …');
    urlRow.hidden = true;
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        importText(text);
      })
      .catch(function (err) {
        setEditorStatus('err', 'Fetch failed: ' + err.message +
          ' — the server may not allow cross-origin requests');
      });
  }

  /* Imported text may be a Postman collection — convert it to OpenAPI and
     keep it as a NEW saved spec (conversion is lossy, so the current spec
     is never overwritten). Plain OpenAPI text replaces the editor content. */
  function importText(text) {
    var converted = null;
    try {
      converted = window.SduiPostman && SduiPostman.tryConvert(text);
    } catch (err) {
      setEditorStatus('err', 'Postman conversion failed: ' + err.message);
      return;
    }
    if (converted) {
      addDoc(converted.name, converted.yaml);
      refreshDocSelect();
      switchDoc(activeDocId());
      setEditorStatus('ok', 'Postman collection converted to OpenAPI and saved as "' + converted.name + '"');
      return;
    }
    editor.setValue(text);
    renderNow();
  }

  function openLocalFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { importText(String(reader.result)); };
    reader.onerror = function () { setEditorStatus('err', 'Could not read ' + file.name); };
    reader.readAsText(file);
    fileInput.value = '';
  }

  function downloadSpec() {
    var blob = new Blob([editor.getValue()], { type: 'application/yaml' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'openapi.yaml';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* ----- preview -> editor sync (click an operation/model, see its source) ----- */

  function flashEditorLine(line) {
    editor.scrollIntoView({ line: line, ch: 0 }, 120);
    editor.setCursor({ line: line, ch: 0 });
    editor.addLineClass(line, 'background', 'cm-target-line');
    setTimeout(function () {
      editor.removeLineClass(line, 'background', 'cm-target-line');
    }, 1600);
  }

  function findLine(regex, fromLine) {
    for (var i = fromLine || 0; i < editor.lineCount(); i++) {
      if (regex.test(editor.getLine(i))) return i;
    }
    return -1;
  }

  function keyRegex(name) {
    var esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^\\s*["\']?' + esc + '["\']?\\s*:');
  }

  function highlightOperation(path, method) {
    var pathLine = findLine(keyRegex(path));
    if (pathLine === -1) return;
    var target = pathLine;
    if (method) {
      var methodRe = keyRegex(method);
      var pathIndent = (editor.getLine(pathLine).match(/^\s*/) || [''])[0].length;
      for (var i = pathLine + 1; i < editor.lineCount(); i++) {
        var line = editor.getLine(i);
        var indent = (line.match(/^\s*/) || [''])[0].length;
        if (line.trim() && indent <= pathIndent) break; // left this path's block
        if (methodRe.test(line)) { target = i; break; }
      }
    }
    flashEditorLine(target);
  }

  function highlightSchema(name) {
    var schemasLine = findLine(keyRegex('schemas'));
    var target = findLine(keyRegex(name), schemasLine === -1 ? 0 : schemasLine);
    if (target !== -1) flashEditorLine(target);
  }

  document.getElementById('swagger-ui').addEventListener('click', function (e) {
    if (specSelect.value !== 'custom' || !editor) return;

    var summary = e.target.closest('.opblock-summary');
    if (summary) {
      var block = summary.closest('.opblock');
      var pathEl = summary.querySelector('.opblock-summary-path, .opblock-summary-path__deprecated');
      var m = block && block.className.match(/opblock-(get|post|put|patch|delete|head|options|trace)/);
      if (pathEl) {
        highlightOperation(pathEl.getAttribute('data-path') || pathEl.textContent.trim(), m && m[1]);
      }
      return;
    }

    var model = e.target.closest('.model-container');
    if (model && model.id && model.id.indexOf('model-') === 0) {
      highlightSchema(model.id.slice('model-'.length));
    }
  });

  /* ----- spec selection ----- */

  function currentSpecId() {
    var fromQuery = new URLSearchParams(window.location.search).get('spec');
    if (fromQuery && SPECS[fromQuery]) return fromQuery;
    var saved = storageGet(SPEC_KEY);
    if (saved && SPECS[saved]) return saved;
    return DEFAULT_SPEC;
  }

  function renderSpec(specId) {
    storageSet(SPEC_KEY, specId);
    specSelect.value = specId;

    var params = new URLSearchParams(window.location.search);
    params.set('spec', specId);
    // Keep deep-link hashes (#/Tag/operationId); drop only consumed share payloads.
    var hash = window.location.hash.indexOf('#s=') === 0 ? '' : window.location.hash;
    try {
      history.replaceState(null, '', window.location.pathname + '?' + params.toString() + hash);
    } catch (e) {
      // Opaque origins (Android content://, sandboxed viewers) refuse URL
      // rewrites — the app must keep working without deep-linkable URLs.
    }

    var isCustom = specId === 'custom';
    editorPane.hidden = !isCustom;
    document.body.classList.toggle('editor-active', isCustom);
    layoutSwitch.hidden = !isCustom;
    document.getElementById('edit-spec').hidden = isCustom;

    if (isCustom) {
      ensureEditor();
      applyLayout(storageGet(LAYOUT_KEY) || 'split');
      editor.refresh();
      lastRenderedText = null; // force a fresh render when entering the editor
      renderEditorContent();
    } else {
      document.body.removeAttribute('data-layout');
      renderFromUrl(specId);
    }
  }

  specSelect.addEventListener('change', function () {
    renderSpec(specSelect.value);
  });

  /* ----- "edit a copy": bring a ready-made spec into the editor ----- */

  var editSpecBtn = document.getElementById('edit-spec');
  editSpecBtn.addEventListener('click', function () {
    var src = SPECS[specSelect.value];
    if (!src || !src.url) return;
    editSpecBtn.disabled = true;
    fetch(src.url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        // Minified JSON specs (like Petstore's) become tidy YAML in the copy.
        if (/^\s*\{/.test(text)) {
          try { text = jsyaml.dump(jsyaml.load(text), { lineWidth: 110, noRefs: true, skipInvalid: true }); }
          catch (e) { /* keep the original text */ }
        }
        // Enter editor mode first (it re-renders the currently active doc),
        // THEN create and switch to the copy so its content isn't clobbered.
        renderSpec('custom');
        addDoc(src.copyName || (src.label + ' (copy)'), text);
        refreshDocSelect();
        switchDoc(activeDocId());
        setEditorStatus('ok', 'Editable copy created — the original spec is untouched');
      })
      .catch(function (err) {
        setEditorStatus('err', 'Could not load the spec: ' + err.message);
      })
      .then(function () { editSpecBtn.disabled = false; });
  });

  if (window.SduiGuide) SduiGuide.init();

  if (window.SduiOpSearch) {
    SduiOpSearch.init({
      input: document.getElementById('opsearch-input'),
      count: document.getElementById('opsearch-count')
    });
  }

  if (typeof window.SwaggerUIBundle === 'undefined') {
    var el = document.getElementById('swagger-ui');
    el.innerHTML = '<div class="sdui-load-error"><h2>Failed to load Swagger UI</h2>' +
      '<p>The Swagger UI bundle could not be loaded from the CDN. ' +
      'Check your network connection and refresh the page.</p></div>';
    return;
  }

  // A shared spec arriving via the URL hash (#s=<lz-string data>) becomes a
  // new saved document — existing specs are never overwritten.
  var sharedText = null;
  if (window.location.hash.indexOf('#s=') === 0) {
    try {
      sharedText = LZString.decompressFromEncodedURIComponent(window.location.hash.slice(3)) || null;
    } catch (e) { /* malformed hash — ignore */ }
  }
  if (sharedText) {
    // Shared Postman collections get converted on arrival, like file imports.
    var sharedConv = window.SduiPostman && SduiPostman.tryConvert(sharedText);
    if (sharedConv) {
      addDoc(sharedConv.name, sharedConv.yaml);
    } else {
      addDoc('Shared ' + new Date().toISOString().slice(0, 10), sharedText);
    }
    renderSpec('custom'); // replaceState in renderSpec also drops the hash
  } else {
    renderSpec(currentSpecId());
  }
})();

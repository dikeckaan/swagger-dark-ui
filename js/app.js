/* Swagger Dark UI — app bootstrap: spec selector, theme toggle, custom-spec
   YAML editor with live preview, Swagger UI init. */
(function () {
  'use strict';

  var SPECS = {
    demo: {
      url: 'specs/demo-api.yaml',
      label: 'Demo API — full feature showcase'
    },
    petstore: {
      url: 'https://petstore3.swagger.io/api/v3/openapi.json',
      label: 'Swagger Petstore (live)',
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
  var DEFAULT_SPEC = 'demo';
  var THEME_KEY = 'sdui-theme';
  var SPEC_KEY = 'sdui-spec';
  var CUSTOM_SPEC_KEY = 'sdui-custom-spec';
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

  /* ----- theme ----- */

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    storageSet(THEME_KEY, theme);
  }

  themeToggle.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ----- swagger ui ----- */

  function baseConfig() {
    return {
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      deepLinking: true,
      filter: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      displayOperationId: false,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      showExtensions: true,
      showCommonExtensions: true,
      queryConfigEnabled: false,
      validatorUrl: null
    };
  }

  function renderFromUrl(specId) {
    var config = baseConfig();
    config.url = SPECS[specId].url;
    config.requestInterceptor = SPECS[specId].requestInterceptor;
    config.onComplete = function () {
      document.title = SPECS[specId].label + ' · Swagger Dark UI';
    };
    window.ui = SwaggerUIBundle(config);
  }

  function renderFromObject(specObject) {
    var config = baseConfig();
    config.spec = specObject;
    window.ui = SwaggerUIBundle(config);
    document.title = SPECS.custom.label + ' · Swagger Dark UI';
  }

  /* ----- custom spec editor ----- */

  function setEditorStatus(kind, message) {
    editorStatus.className = kind;
    editorStatus.textContent = message;
  }

  function renderEditorContent() {
    var text = editor.getValue();
    storageSet(CUSTOM_SPEC_KEY, text);

    var parsed;
    try {
      parsed = jsyaml.load(text);
    } catch (err) {
      var where = err.mark ? ' (line ' + (err.mark.line + 1) + ')' : '';
      setEditorStatus('err', 'YAML error' + where + ': ' + err.reason);
      return; // keep the last good render on the right
    }
    if (!parsed || typeof parsed !== 'object') {
      setEditorStatus('err', 'Document is empty — start with "openapi: 3.0.3"');
      return;
    }
    if (!parsed.openapi && !parsed.swagger) {
      setEditorStatus('err', 'Missing "openapi" (or "swagger") version field');
      return;
    }

    if (text === lastRenderedText) return;
    lastRenderedText = text;
    renderFromObject(parsed);
    setEditorStatus('ok', 'Valid — rendering live');
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderEditorContent, RENDER_DEBOUNCE_MS);
  }

  function ensureEditor() {
    if (editor) return;
    editor = CodeMirror(document.getElementById('editor-host'), {
      value: storageGet(CUSTOM_SPEC_KEY) || CUSTOM_TEMPLATE,
      mode: 'yaml',
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      viewportMargin: 20,
      extraKeys: {
        Tab: function (cm) { cm.replaceSelection('  ', 'end'); }
      }
    });
    editor.on('change', scheduleRender);

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
        editor.setValue(text);
        setEditorStatus('ok', 'Loaded — rendering live');
      })
      .catch(function (err) {
        setEditorStatus('err', 'Fetch failed: ' + err.message +
          ' — the server may not allow cross-origin requests');
      });
  }

  function openLocalFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { editor.setValue(String(reader.result)); };
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
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());

    var isCustom = specId === 'custom';
    editorPane.hidden = !isCustom;
    document.body.classList.toggle('editor-active', isCustom);

    if (isCustom) {
      ensureEditor();
      editor.refresh();
      lastRenderedText = null; // force a fresh render when entering the editor
      renderEditorContent();
    } else {
      renderFromUrl(specId);
    }
  }

  specSelect.addEventListener('change', function () {
    renderSpec(specSelect.value);
  });

  if (typeof window.SwaggerUIBundle === 'undefined') {
    var el = document.getElementById('swagger-ui');
    el.innerHTML = '<div class="sdui-load-error"><h2>Failed to load Swagger UI</h2>' +
      '<p>The Swagger UI bundle could not be loaded from the CDN. ' +
      'Check your network connection and refresh the page.</p></div>';
    return;
  }

  renderSpec(currentSpecId());
})();

/* Swagger Dark UI — app bootstrap: spec selector, theme toggle, Swagger UI init. */
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
    }
  };
  var DEFAULT_SPEC = 'demo';
  var THEME_KEY = 'sdui-theme';
  var SPEC_KEY = 'sdui-spec';

  var specSelect = document.getElementById('spec-select');
  var themeToggle = document.getElementById('theme-toggle');

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

    window.ui = SwaggerUIBundle({
      url: SPECS[specId].url,
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
      validatorUrl: null,
      requestInterceptor: SPECS[specId].requestInterceptor,
      onComplete: function () {
        document.title = SPECS[specId].label + ' · Swagger Dark UI';
      }
    });
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

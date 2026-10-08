/* OASForge — JMeter scenario wizard (the UI over js/jmeter.js).
   Six short steps: where the API is, what limits it (an Apigee Edge policy
   pasted as-is, a limit you know, one you want to find, or nothing), which
   scenarios to run, which requests, which credential, and a review that
   shows the timeline and the plan tree before anything is downloaded.
   Answers are remembered per document (secrets excluded), so the next
   export starts where the last one ended. */
(function () {
  'use strict';

  var J = window.SduiJMeter;
  var A = window.SduiApigee;
  var STORE_PREFIX = 'sdui-jmeter-wizard:';
  var STEPS = [
    { id: 'target', title: 'Target' },
    { id: 'limiter', title: 'Limiter' },
    { id: 'scenarios', title: 'Scenarios' },
    { id: 'requests', title: 'Requests' },
    { id: 'auth', title: 'Credential' },
    { id: 'review', title: 'Review' }
  ];

  /* ----- tiny DOM helpers ----- */

  function elem(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function field(parent, label, control, hint) {
    var wrap = elem('div', 'sdui-wz-field');
    wrap.appendChild(elem('label', null, label));
    wrap.appendChild(control);
    if (hint) wrap.appendChild(elem('small', null, hint));
    parent.appendChild(wrap);
    return control;
  }
  function textBox(value, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.spellcheck = false;
    i.value = value === undefined || value === null ? '' : String(value);
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  function numberBox(value, min, step) {
    var i = document.createElement('input');
    i.type = 'number';
    i.min = min === undefined ? '1' : String(min);
    if (step) i.step = String(step);
    i.value = value === undefined || value === null ? '' : String(value);
    return i;
  }
  function textArea(value, rows) {
    var t = document.createElement('textarea');
    t.rows = rows || 4;
    t.spellcheck = false;
    t.value = value || '';
    return t;
  }
  function dropdown(items, value) {
    var s = document.createElement('select');
    items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.label;
      if (it.value === value) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }
  function checkbox(parent, label, checked, onChange, hint) {
    var wrap = elem('label', 'sdui-wz-check');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!checked;
    wrap.appendChild(box);
    var text = elem('span');
    text.appendChild(elem('strong', null, label));
    if (hint) text.appendChild(elem('small', null, hint));
    wrap.appendChild(text);
    box.addEventListener('change', function () { onChange(box.checked); });
    parent.appendChild(wrap);
    return box;
  }
  function grid(parent, cls) {
    var g = elem('div', 'sdui-wz-grid' + (cls ? ' ' + cls : ''));
    parent.appendChild(g);
    return g;
  }
  function section(parent, title, hint) {
    var s = elem('section', 'sdui-wz-step');
    if (title) s.appendChild(elem('h4', null, title));
    if (hint) s.appendChild(elem('p', 'sdui-wz-hint', hint));
    parent.appendChild(s);
    return s;
  }
  function choiceCards(parent, group, items, value, onPick) {
    var wrap = elem('div', 'sdui-wz-choices');
    items.forEach(function (it) {
      var card = elem('label', 'sdui-wz-choice' + (it.value === value ? ' is-on' : ''));
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = group;
      radio.checked = it.value === value;
      var text = elem('div');
      text.appendChild(elem('strong', null, it.title));
      text.appendChild(elem('span', null, it.desc));
      card.appendChild(radio);
      card.appendChild(text);
      radio.addEventListener('change', function () { onPick(it.value); });
      wrap.appendChild(card);
    });
    parent.appendChild(wrap);
    return wrap;
  }
  function linkButton(parent, label, onClick) {
    var b = elem('button', 'sdui-wz-link', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }
  function num(value, min) {
    var n = parseFloat(value);
    if (isNaN(n)) return min;
    return n < min ? min : n;
  }
  function bind(input, fn, evt) {
    input.addEventListener(evt || 'input', function () { fn(input.value); });
    return input;
  }

  /* ----- remembered answers ----- */

  function storeKey(doc) {
    var title = (doc.info && doc.info.title) || 'api';
    return STORE_PREFIX + String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  function remember(doc, cfg) {
    try {
      var copy = JSON.parse(JSON.stringify(cfg));
      copy.auth.value = '';
      copy.auth.value2 = '';
      ['login', 'login2'].forEach(function (k) {
        if (copy.auth[k]) {
          if (copy.auth[k].basic) copy.auth[k].basic.secret = '';
          if (/secret|password/i.test(copy.auth[k].body || '')) copy.auth[k].body = '';
        }
      });
      copy.requests = copy.requests.map(function (r) { return { id: r.id, on: r.on, weight: r.weight, custom: r.custom, url: r.url, method: r.method }; });
      localStorage.setItem(storeKey(doc), JSON.stringify(copy));
    } catch (e) { /* storage full or disabled — the wizard still works */ }
  }
  function recall(doc) {
    try {
      var raw = localStorage.getItem(storeKey(doc));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ==================================================================
     The wizard
     ================================================================== */

  function open(opts) {
    var doc = opts.doc;
    var ops = J.read.operations(doc);
    if (!ops.length) throw new Error('the document has no operations to test');

    var servers = J.read.servers(doc);
    var authInfo = J.read.auth(doc);
    var loginOp = J.read.guessLogin(ops);
    var targetOp = J.read.guessTarget(ops, loginOp);
    var saved = recall(doc);

    var cfg = {
      target: { url: servers[0] || '' },
      limiter: {
        kind: 'apigee',
        apigee: { text: '', values: {}, mps: 1 },
        known: { count: 100, interval: 1, unit: 'minute', type: 'default', per: authInfo.secured ? 'credential' : 'ip', name: '', exact: true },
        identifier: { value: 'oasforge-a', other: 'oasforge-b' },
        limitCodes: '429'
      },
      scenarios: [],
      requests: ops.map(function (o) {
        var req = J.read.request(doc, o);
        req.on = !!(targetOp && o.id === targetOp.id);
        return req;
      }),
      mix: 'sequence',
      think: { delay: 0, range: 0 },
      auth: {
        kind: authInfo.oauth || loginOp ? 'login' : (authInfo.secured ? 'static' : 'none'),
        header: authInfo.header,
        prefix: authInfo.prefix,
        value: '',
        value2: '',
        refresh: 'once',
        ttlMinutes: 30,
        csv: { file: 'credentials.csv', variable: 'apiKey' },
        login: J.read.loginDefaults(doc, authInfo, authInfo.oauth ? null : loginOp),
        login2: null
      },
      checks: { allow3xx: false, extraCodes: '', maxMs: 0, connectMs: 10000, timeoutMs: 30000, rateHeader: '' },
      cookies: false
    };
    cfg.auth.login2 = JSON.parse(JSON.stringify(cfg.auth.login));

    if (saved) {
      // What was answered last time, on top of what the document says now.
      if (saved.target && saved.target.url) cfg.target.url = saved.target.url;
      if (saved.limiter) {
        cfg.limiter.kind = saved.limiter.kind || cfg.limiter.kind;
        if (saved.limiter.apigee) cfg.limiter.apigee = Object.assign(cfg.limiter.apigee, saved.limiter.apigee);
        if (saved.limiter.known) cfg.limiter.known = Object.assign(cfg.limiter.known, saved.limiter.known);
        if (saved.limiter.identifier) cfg.limiter.identifier = Object.assign(cfg.limiter.identifier, saved.limiter.identifier);
        if (saved.limiter.limitCodes) cfg.limiter.limitCodes = saved.limiter.limitCodes;
      }
      if (Array.isArray(saved.scenarios)) cfg.scenarios = saved.scenarios;
      if (saved.mix) cfg.mix = saved.mix;
      if (saved.think) cfg.think = saved.think;
      if (saved.checks) cfg.checks = Object.assign(cfg.checks, saved.checks);
      if (saved.cookies !== undefined) cfg.cookies = saved.cookies;
      if (saved.auth) {
        var sa = saved.auth;
        ['kind', 'header', 'prefix', 'refresh', 'ttlMinutes'].forEach(function (k) { if (sa[k] !== undefined) cfg.auth[k] = sa[k]; });
        if (sa.csv) cfg.auth.csv = Object.assign(cfg.auth.csv, sa.csv);
        if (sa.login) cfg.auth.login = Object.assign(cfg.auth.login, sa.login, { body: sa.login.body || cfg.auth.login.body });
        if (sa.login2) cfg.auth.login2 = Object.assign(cfg.auth.login2, sa.login2, { body: sa.login2.body || cfg.auth.login2.body });
      }
      if (Array.isArray(saved.requests)) {
        var anyOn = false;
        saved.requests.forEach(function (s) {
          if (s.custom) {
            var c = J.read.custom(s.url);
            c.method = s.method || 'GET';
            c.label = c.method + ' ' + c.url;
            c.on = !!s.on;
            c.weight = s.weight || 1;
            cfg.requests.push(c);
            anyOn = anyOn || c.on;
            return;
          }
          cfg.requests.forEach(function (r) {
            if (r.id === s.id) { r.on = !!s.on; r.weight = s.weight || 1; anyOn = anyOn || r.on; }
          });
        });
        if (!anyOn && targetOp) cfg.requests.forEach(function (r) { if (r.id === targetOp.id) r.on = true; });
      }
    }
    if (!cfg.limiter.kind) cfg.limiter.kind = 'apigee';
    syncScenarios();

    /* Scenario defaults follow the limiter; the user's switches and numbers
       survive as long as the scenario kind is still on offer. */
    function syncScenarios() {
      var limits = J.resolveLimits(cfg);
      var fresh = J.suggestScenarios(limits);
      var old = cfg.scenarios || [];
      cfg.scenarios = fresh.map(function (f) {
        var prev = null;
        old.forEach(function (o) { if (o.kind === f.kind) prev = o; });
        if (!prev) return f;
        return { kind: f.kind, on: prev.on, params: Object.assign({}, f.params, prev.params || {}), touched: prev.touched };
      });
    }

    /* ----- shell ----- */
    var overlay = elem('div', 'sdui-modal-overlay');
    var modal = elem('div', 'sdui-modal sdui-wizard');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'JMeter scenario');
    var head = elem('div', 'sdui-modal-head');
    head.appendChild(elem('span', null, 'JMeter scenario — ' + ((doc.info && doc.info.title) || 'API')));
    var closeBtn = elem('button', 'sdui-tool-btn', 'Close');
    closeBtn.type = 'button';
    head.appendChild(closeBtn);
    var nav = elem('ol', 'sdui-wz-nav');
    var body = elem('div', 'sdui-wizard-body');
    var foot = elem('div', 'sdui-wz-foot');
    var note = elem('div', 'sdui-wz-note', '');
    var actions = elem('div', 'sdui-wz-actions');
    foot.appendChild(note);
    foot.appendChild(actions);
    modal.appendChild(head);
    modal.appendChild(nav);
    modal.appendChild(body);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var stepIndex = 0;
    var downloaded = null;

    function dismiss() {
      remember(doc, cfg);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    closeBtn.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);

    function goto(i) {
      stepIndex = Math.max(0, Math.min(STEPS.length - 1, i));
      remember(doc, cfg);
      render();
      body.scrollTop = 0;
    }

    function renderNav() {
      nav.innerHTML = '';
      var est = J.estimate(cfg);
      STEPS.forEach(function (s, i) {
        var li = elem('li', 'sdui-wz-navstep' + (i === stepIndex ? ' is-current' : '') + (i < stepIndex ? ' is-done' : ''));
        var b = elem('button', null);
        b.type = 'button';
        b.appendChild(elem('span', 'sdui-wz-navnum', String(i + 1)));
        b.appendChild(elem('span', 'sdui-wz-navtitle', s.title));
        var sub = stepSubtitle(s.id, est);
        if (sub) b.appendChild(elem('span', 'sdui-wz-navsub', sub));
        b.addEventListener('click', function () { goto(i); });
        li.appendChild(b);
        nav.appendChild(li);
      });
    }

    function stepSubtitle(id, est) {
      if (id === 'target') { var t = J.read.parseBase(cfg.target.url); return t ? t.host : 'not set'; }
      if (id === 'limiter') {
        if (cfg.limiter.kind === 'apigee') return est.limits.quota || est.limits.spike ? [est.limits.quota && 'quota', est.limits.spike && 'spike arrest'].filter(Boolean).join(' + ') : 'paste a policy';
        if (cfg.limiter.kind === 'known') return est.limits.quota ? est.limits.quota.requestsAllowed + ' / ' + est.limits.quota.interval + ' ' + est.limits.quota.unit : 'known limit';
        if (cfg.limiter.kind === 'unknown') return 'find it';
        return 'none';
      }
      if (id === 'scenarios') return est.scenarios.length + ' on · ' + J.fmtSeconds(est.seconds);
      if (id === 'requests') { var n = cfg.requests.filter(function (r) { return r.on; }).length; return n + ' selected'; }
      if (id === 'auth') return { login: 'token fetched once', static: 'pasted token', csv: 'CSV', none: 'none' }[cfg.auth.kind] + (cfg.auth.kind === 'login' && cfg.auth.refresh !== 'once' ? ' + refresh' : '');
      if (id === 'review') return est.problems.length ? est.problems.length + ' to fix' : 'ready';
      return '';
    }

    function renderFoot() {
      actions.innerHTML = '';
      var est = J.estimate(cfg);
      note.textContent = stepIndex === STEPS.length - 1 ? (est.problems[0] || '') : '';
      if (downloaded) return;
      if (stepIndex > 0) {
        var back = elem('button', 'sdui-tool-btn', 'Back');
        back.type = 'button';
        back.addEventListener('click', function () { goto(stepIndex - 1); });
        actions.appendChild(back);
      }
      if (stepIndex < STEPS.length - 1) {
        var next = elem('button', 'sdui-tool-btn sdui-wz-primary', 'Next — ' + STEPS[stepIndex + 1].title);
        next.type = 'button';
        next.addEventListener('click', function () { goto(stepIndex + 1); });
        actions.appendChild(next);
      } else {
        var gen = elem('button', 'sdui-tool-btn sdui-wz-primary', 'Download .jmx');
        gen.type = 'button';
        gen.disabled = !!est.problems.length;
        gen.addEventListener('click', generate);
        actions.appendChild(gen);
      }
    }

    function render() {
      renderNav();
      body.innerHTML = '';
      var id = STEPS[stepIndex].id;
      if (id === 'target') renderTarget();
      else if (id === 'limiter') renderLimiter();
      else if (id === 'scenarios') renderScenarios();
      else if (id === 'requests') renderRequests();
      else if (id === 'auth') renderAuth();
      else renderReview();
      renderFoot();
    }

    /* ----- 1. target ----- */
    function renderTarget() {
      var s = section(body, 'Which host is under test?',
        servers.length
          ? 'Taken from the document. Change it to point the same scenarios at staging or production — the plan also takes -Jhost / -Jport / -Jprotocol at run time.'
          : 'This document does not say where the API lives, so nothing is assumed: type the base URL you want to hit.');
      if (servers.length > 1) {
        var ssel = dropdown(servers.map(function (u) { return { value: u, label: u }; }).concat([{ value: '', label: 'Another URL…' }]),
          servers.indexOf(cfg.target.url) === -1 ? '' : cfg.target.url);
        field(s, 'Server from the document', ssel);
        ssel.addEventListener('change', function () { if (ssel.value) { cfg.target.url = ssel.value; render(); } });
      }
      var urlBox = field(s, 'Base URL', textBox(cfg.target.url, 'https://api.example.com/v1'),
        'Scheme, host, optional port and the common path prefix. Requests from the document are appended to it.');
      bind(urlBox, function (v) {
        cfg.target.url = v.trim();
        urlBox.className = J.read.parseBase(cfg.target.url) || !cfg.target.url ? '' : 'sdui-wz-bad';
        renderNav();
        renderFoot();
      });
      var p = section(body, 'What this wizard produces');
      var ul = elem('ul', 'sdui-wz-list');
      [
        'One .jmx for Apache JMeter 5.4.3 (and later 5.x) that runs as downloaded — no plugins, no Groovy, nothing to edit.',
        'Every scenario is its own thread group and they run one after another; a token is fetched once, in a setUp group, before any load starts.',
        'The plan grades itself: a tearDown group writes one VERDICT line per scenario (PASS / FAIL against what the limiter config says), on the console and in the results file.'
      ].forEach(function (t) { ul.appendChild(elem('li', null, t)); });
      p.appendChild(ul);
    }

    /* ----- 2. limiter ----- */
    function renderLimiter() {
      var s = section(body, 'What limits this API?',
        'The scenarios are derived from this. The closer it is to the real configuration, the sharper the verdicts.');
      choiceCards(s, 'sdui-wz-limiter', [
        { value: 'apigee', title: 'Apigee Edge policy', desc: 'Paste the Quota and/or SpikeArrest policy XML (or the API product JSON). The window, the counter and the fault are read from it.' },
        { value: 'known', title: 'A limit I know', desc: 'N requests per window, counted per key, header, IP or for the whole API.' },
        { value: 'unknown', title: 'Find the limit', desc: 'Climb the rate step by step until the limiter answers.' },
        { value: 'none', title: 'No limiter — just load', desc: 'A steady rate or bursts, graded on errors only.' }
      ], cfg.limiter.kind, function (v) { cfg.limiter.kind = v; syncScenarios(); render(); });

      if (cfg.limiter.kind === 'apigee') renderApigee();
      if (cfg.limiter.kind === 'known') renderKnown();

      if (cfg.limiter.kind !== 'none') {
        var g = grid(section(body, 'When a limit is hit'));
        var codes = field(g, 'Status returned by the limiter', textBox(cfg.limiter.limitCodes, '429'),
          'Apigee Edge answers 429 when features.isHTTPStatusTooManyRequestEnabled is on; otherwise it is 500. Several codes: "429 500".');
        bind(codes, function (v) { cfg.limiter.limitCodes = v; syncScenarios(); renderNav(); });
      }
    }

    function renderApigee() {
      var s = section(body, 'The policy', 'One or more policies, or a whole proxy bundle: every <Quota> and <SpikeArrest> in the text is read. The ref="…" values a policy reads at run time are asked for below.');
      var ta = textArea(cfg.limiter.apigee.text, 8);
      ta.placeholder = '<Quota name="Quota-1" type="calendar">\n  <Allow count="1000"/>\n  <Interval>1</Interval>\n  <TimeUnit>hour</TimeUnit>\n  <Identifier ref="client_id"/>\n  <Distributed>true</Distributed>\n  <Synchronous>true</Synchronous>\n</Quota>';
      field(s, 'Quota / SpikeArrest XML — or the API product JSON', ta);
      var parsedHost = elem('div', 'sdui-wz-policies');
      s.appendChild(parsedHost);
      bind(ta, function (v) { cfg.limiter.apigee.text = v; syncScenarios(); renderParsed(); renderNav(); });
      renderParsed();

      function renderParsed() {
        parsedHost.innerHTML = '';
        var parsed = A.parse(cfg.limiter.apigee.text);
        if (!cfg.limiter.apigee.text.trim()) return;
        parsed.errors.forEach(function (e) { parsedHost.appendChild(elem('div', 'sdui-wz-warn', 'Could not read the XML: ' + e)); });
        parsed.warnings.forEach(function (w) { parsedHost.appendChild(elem('div', 'sdui-wz-warn', w)); });
        parsed.policies.forEach(function (p, i) {
          if (p.kind === 'concurrent') return;
          var card = elem('div', 'sdui-wz-policy');
          var values = cfg.limiter.apigee.values[i] || (cfg.limiter.apigee.values[i] = {});
          var head = elem('div', 'sdui-wz-policy-head');
          head.appendChild(elem('span', 'sdui-wz-badge', p.kind === 'quota' ? 'Quota' : 'Spike Arrest'));
          head.appendChild(elem('strong', null, p.displayName));
          card.appendChild(head);
          var desc = elem('p', 'sdui-wz-policy-desc');
          card.appendChild(desc);
          var ask = A.unresolved(p);
          var g = ask.length ? grid(card) : null;
          ask.forEach(function (u) {
            var ctl;
            if (u.type === 'unit') ctl = dropdown(['second', 'minute', 'hour', 'day', 'week', 'month'].map(function (x) { return { value: x, label: x }; }), values[u.key] || 'minute');
            else if (u.type === 'rate') ctl = textBox(values[u.key] || '', u.fallback || '30ps');
            else ctl = numberBox(values[u.key] !== undefined ? values[u.key] : (u.fallback !== undefined ? u.fallback : ''), 1);
            field(g, u.label, ctl, u.hint);
            bind(ctl, function (v) { values[u.key] = v; syncScenarios(); refresh(); renderNav(); }, ctl.tagName === 'SELECT' ? 'change' : 'input');
          });
          parsedHost.appendChild(card);
          function refresh() { desc.textContent = A.describe(A.resolve(p, values, { mps: cfg.limiter.apigee.mps })); }
          refresh();
          card.refresh = refresh;
        });

        var g2 = grid(parsedHost);
        var mps = field(g2, 'Message processors', numberBox(cfg.limiter.apigee.mps, 1),
          'Spike arrest without UseEffectiveCount, and a quota with Distributed=false, are enforced per message processor — the real limit is multiplied by this.');
        bind(mps, function (v) {
          cfg.limiter.apigee.mps = Math.max(1, Math.round(num(v, 1)));
          syncScenarios();
          Array.prototype.forEach.call(parsedHost.querySelectorAll('.sdui-wz-policy'), function (c) { if (c.refresh) c.refresh(); });
          renderNav();
        });
        renderIdentifier(parsedHost);
      }
    }

    function renderKnown() {
      var k = cfg.limiter.known;
      var s = section(body, 'The limit');
      var g = grid(s);
      var c = field(g, 'Requests allowed', numberBox(k.count, 1));
      var iv = field(g, 'Per interval of', numberBox(k.interval, 1));
      var u = field(g, 'Unit', dropdown(['second', 'minute', 'hour', 'day'].map(function (x) { return { value: x, label: x }; }), k.unit));
      var t = field(g, 'Window', dropdown([
        { value: 'default', label: 'Fixed — resets at the top of the unit' },
        { value: 'rolling', label: 'Rolling — looks back one interval' },
        { value: 'flexi', label: 'Starts at the first request' }
      ], k.type), 'Decides how long the reset scenario waits.');
      bind(c, function (v) { k.count = num(v, 1); syncScenarios(); renderNav(); });
      bind(iv, function (v) { k.interval = num(v, 1); syncScenarios(); renderNav(); });
      bind(u, function (v) { k.unit = v; syncScenarios(); renderNav(); }, 'change');
      bind(t, function (v) { k.type = v; syncScenarios(); }, 'change');
      var g2 = grid(s);
      var per = field(g2, 'Counted per', dropdown([
        { value: 'credential', label: 'credential (token / API key)' },
        { value: 'header', label: 'a request header' },
        { value: 'query', label: 'a query parameter' },
        { value: 'ip', label: 'client IP' },
        { value: 'proxy', label: 'the whole API' }
      ], k.per));
      bind(per, function (v) { k.per = v; syncScenarios(); render(); }, 'change');
      if (k.per === 'header' || k.per === 'query') {
        var nm = field(g2, k.per === 'header' ? 'Header name' : 'Parameter name', textBox(k.name, k.per === 'header' ? 'X-Client-Id' : 'client_id'));
        bind(nm, function (v) { k.name = v.trim(); syncScenarios(); });
      }
      checkbox(s, 'The counter is exact', k.exact, function (v) { k.exact = v; syncScenarios(); },
        'Off when the limiter is eventually consistent (several nodes, asynchronous sync): the verdicts then allow a 5% margin.');
      renderIdentifier(s);
    }

    function renderIdentifier(parent) {
      var limits = J.resolveLimits(cfg);
      var ident = limits.identifier;
      if (ident.kind !== 'header' && ident.kind !== 'query') return;
      var s = section(parent, 'The identity the test sends',
        'The counter is per ' + ident.label.replace(/^the /, '') + '. The plan sends the first value with every request; the "another caller" scenario sends the second.');
      var g = grid(s);
      var a = field(g, ident.name + ' — this run', textBox(cfg.limiter.identifier.value));
      var b = field(g, ident.name + ' — the other caller', textBox(cfg.limiter.identifier.other));
      bind(a, function (v) { cfg.limiter.identifier.value = v.trim(); });
      bind(b, function (v) { cfg.limiter.identifier.other = v.trim(); renderNav(); });
    }

    /* ----- 3. scenarios ----- */
    function renderScenarios() {
      var est = J.estimate(cfg);
      var limits = est.limits;
      section(body, 'What should the plan prove?',
        limits.quota || limits.spike
          ? 'Each scenario is a thread group with its own verdict. They run in this order — the ones that depend on an exhausted quota come right after the one that exhausts it.'
          : cfg.limiter.kind === 'unknown' ? 'A staircase: the first step with refusals is the limit.' : 'Plain load; the verdict only checks for errors.');
      if (cfg.limiter.kind === 'apigee' && !limits.quota && !limits.spike) {
        body.appendChild(elem('div', 'sdui-wz-warn', 'No usable policy yet — go back to Limiter and paste a Quota or SpikeArrest policy.'));
      }
      est.warnings.forEach(function (w) { body.appendChild(elem('div', 'sdui-wz-warn', w)); });

      var list = elem('div', 'sdui-wz-cards');
      body.appendChild(list);
      cfg.scenarios.forEach(function (scn) {
        var info = J.kindInfo(scn.kind);
        var card = elem('div', 'sdui-wz-card' + (scn.on ? ' is-on' : ''));
        var headRow = elem('label', 'sdui-wz-card-head');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = scn.on;
        headRow.appendChild(box);
        var titleWrap = elem('div');
        titleWrap.appendChild(elem('strong', null, info.title));
        titleWrap.appendChild(elem('span', 'sdui-wz-card-why', info.why));
        headRow.appendChild(titleWrap);
        card.appendChild(headRow);
        var detail = elem('div', 'sdui-wz-card-body');
        detail.hidden = !scn.on;
        card.appendChild(detail);
        box.addEventListener('change', function () {
          scn.on = box.checked;
          card.className = 'sdui-wz-card' + (scn.on ? ' is-on' : '');
          detail.hidden = !scn.on;
          refreshExpect();
          renderNav();
        });
        var expect = elem('div', 'sdui-wz-expect');
        detail.appendChild(expect);
        var g = grid(detail, 'sdui-wz-grid-tight');
        scenarioFields(g, scn, limits, function () { refreshExpect(); renderNav(); });
        list.appendChild(card);

        function refreshExpect() {
          var e = J.estimate(cfg);
          var mine = null;
          e.scenarios.forEach(function (p) { if (p.kind === scn.kind) mine = p; });
          expect.innerHTML = '';
          if (!mine) { expect.appendChild(elem('span', null, scn.on ? 'Not available with this limiter.' : 'Off.')); return; }
          expect.appendChild(elem('strong', null, mine.key + ' · ' + J.fmtSeconds(mine.seconds) + ' · ' + mine.requests + ' requests'));
          expect.appendChild(elem('span', null, mine.expectText));
          mine.notes.forEach(function (n) { expect.appendChild(elem('span', 'sdui-wz-warn', n)); });
        }
        refreshExpect();
      });

      if (cfg.limiter.kind !== 'apigee' || limits.quota || limits.spike) {
        var adv = section(body, 'Pacing');
        var ga = grid(adv);
        var think = field(ga, 'Think time between requests (ms)', numberBox(cfg.think.delay, 0), 'Zero keeps the rate purely in the pacing timer. Not applied to bursts.');
        var jitter = field(ga, 'Random extra (ms)', numberBox(cfg.think.range, 0), 'Added at random on top, so threads do not march in lockstep.');
        bind(think, function (v) { cfg.think.delay = Math.round(num(v, 0)); });
        bind(jitter, function (v) { cfg.think.range = Math.round(num(v, 0)); });
      }
    }

    function scenarioFields(g, scn, limits, changed) {
      var p = scn.params;
      function nf(label, key, min, hint, step) {
        var ctl = field(g, label, numberBox(p[key], min, step), hint);
        bind(ctl, function (v) { p[key] = num(v, min); scn.touched = true; changed(); });
        return ctl;
      }
      function cb(label, key, hint) {
        checkbox(g, label, p[key], function (v) { p[key] = v; changed(); }, hint);
      }
      var k = scn.kind;
      if (k === 'quota-edge') {
        nf('Requests over the limit', 'overshoot', 1, 'Sent after the allowed number; all of them must be refused.');
        nf('Rate (req/min)', 'rpm', 1, 'Fast enough to finish well inside one window.');
        nf('Virtual users', 'users', 1, 'More users carry a higher rate; ordering gets fuzzier with each one.');
        nf('Tolerance (%)', 'tolerancePct', 0, 'Slack on the exact count — for counters that sync asynchronously.', 0.5);
        cb('Wait for a fresh window first', 'freshWindow', 'On when something may already have used part of this window.');
        if (p.freshWindow) nf('Grace after the reset (s)', 'graceSeconds', 0);
      } else if (k === 'quota-reset') {
        nf('Requests after the reset', 'requests', 1);
        nf('Grace after the reset (s)', 'graceSeconds', 0, 'Extra seconds past the computed boundary — clock skew and counter sync.');
      } else if (k === 'quota-isolation') {
        nf('Requests as the other caller', 'requests', 1);
        var ik = limits.identifier.kind;
        g.appendChild(elem('p', 'sdui-wz-hint', ik === 'credential'
          ? 'The other caller is a second credential — set it in the Credential step.'
          : 'The other caller sends the second ' + (limits.identifier.name || 'identifier') + ' value from the Limiter step.'));
      } else if (k === 'quota-under' || k === 'quota-over') {
        nf('Share of the quota', 'factor', 0.01, k === 'quota-under' ? '0.9 = 90% of the allowed rate.' : '1.5 = 150% of the allowed rate.', 0.05);
        nf('Windows to hold it for', 'windows', 1, 'A quota is only proven across a whole window.', 1);
        nf('Virtual users', 'users', 1);
        cb('Wait for a fresh window first', 'freshWindow', 'Needed when an earlier scenario used the quota up.');
        if (p.freshWindow) nf('Grace after the reset (s)', 'graceSeconds', 0);
      } else if (k === 'spike-burst') {
        nf('Requests per burst', 'size', 2, 'Well above the burst allowance, so the cut-off is visible.');
        nf('Bursts', 'bursts', 1);
        nf('Seconds between bursts', 'gapSeconds', 0, 'Long enough for the bucket to refill.');
      } else if (k === 'spike-paced' || k === 'spike-over') {
        nf('Multiple of the rate', 'factor', 0.01, k === 'spike-paced' ? '0.75 leaves room for timing jitter; smoothing refuses anything that arrives early.' : '2 = twice the configured rate.', 0.1);
        nf('Seconds', 'seconds', 5);
        if (k === 'spike-paced') nf('Refusals tolerated (%)', 'tolerancePct', 0, '', 0.5);
      } else if (k === 'staircase') {
        nf('Start at (req/min)', 'startRpm', 1);
        nf('Add per step (req/min)', 'stepRpm', 0);
        nf('Steps', 'steps', 1);
        nf('Seconds per step', 'stepSeconds', 5);
        nf('Virtual users', 'users', 1, 'Enough to carry the highest step.');
      } else if (k === 'steady') {
        nf('Requests per minute', 'rpm', 1, 'For the whole group, not per user.');
        nf('Minutes', 'minutes', 0.1, '', 0.5);
        nf('Virtual users', 'users', 1);
        nf('Ramp-up (s)', 'rampup', 1);
      } else if (k === 'burst') {
        nf('Requests per burst', 'size', 1);
        nf('Bursts', 'bursts', 1);
        nf('Seconds between bursts', 'gapSeconds', 0);
      }
    }

    /* ----- 4. requests ----- */
    function renderRequests() {
      var s = section(body, 'Which requests take part?',
        'Every scenario sends the ticked requests. One endpoint is the cleanest way to measure a limit; several — or a request to another API by URL — when the scenario is a journey.');
      choiceCards(s, 'sdui-wz-mix', [
        { value: 'sequence', title: 'In order', desc: 'Every iteration walks the ticked requests top to bottom.' },
        { value: 'weighted', title: 'By share', desc: 'Each request gets a share of the traffic (Throughput Controllers).' }
      ], cfg.mix, function (v) { cfg.mix = v; render(); });

      var tools = elem('div', 'sdui-wz-reqtools');
      var filter = textBox('', 'filter…');
      filter.className = 'sdui-wz-filter';
      tools.appendChild(filter);
      linkButton(tools, 'select all', function () { cfg.requests.forEach(function (r) { if (!r.hidden) r.on = true; }); draw(); });
      linkButton(tools, 'select none', function () { cfg.requests.forEach(function (r) { r.on = false; }); draw(); });
      linkButton(tools, '+ request from another API', function () { cfg.requests.push(J.read.custom('')); draw(); });
      s.appendChild(tools);
      var host = elem('div', 'sdui-wz-reqs');
      s.appendChild(host);
      bind(filter, function (v) {
        var q = v.trim().toLowerCase();
        cfg.requests.forEach(function (r) { r.hidden = !!q && (r.label + ' ' + r.summary + ' ' + (r.tags || []).join(' ')).toLowerCase().indexOf(q) === -1; });
        draw();
      });
      draw();

      function draw() {
        host.innerHTML = '';
        cfg.requests.forEach(function (req) {
          if (req.hidden) return;
          var row = elem('div', 'sdui-wz-req' + (req.on ? ' is-on' : ''));
          var rowHead = elem('div', 'sdui-wz-req-head');
          var label = elem('label', 'sdui-wz-req-label');
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = req.on;
          label.appendChild(box);
          var method = elem('span', 'sdui-wz-method sdui-wz-method-' + req.method.toLowerCase(), req.method);
          label.appendChild(method);
          var name = elem('span', 'sdui-wz-req-name', req.custom ? (req.url || 'full URL…') : req.path);
          label.appendChild(name);
          if (req.summary) label.appendChild(elem('span', 'sdui-wz-req-sum', req.summary));
          if (req.deprecated) label.appendChild(elem('span', 'sdui-wz-badge', 'deprecated'));
          rowHead.appendChild(label);
          box.addEventListener('change', function () { req.on = box.checked; row.className = 'sdui-wz-req' + (req.on ? ' is-on' : ''); renderNav(); });

          if (cfg.mix === 'weighted') {
            var weight = numberBox(req.weight, 0);
            weight.className = 'sdui-wz-weight';
            weight.title = 'Share of the traffic';
            bind(weight, function (v) { req.weight = num(v, 0); });
            rowHead.appendChild(weight);
          }
          var detail = elem('div', 'sdui-wz-req-body');
          detail.hidden = true;
          linkButton(rowHead, 'values', function () { detail.hidden = !detail.hidden; });
          if (req.custom) {
            linkButton(rowHead, 'remove', function () {
              cfg.requests = cfg.requests.filter(function (r) { return r !== req; });
              draw();
              renderNav();
            });
          }
          row.appendChild(rowHead);

          if (req.custom) {
            var cg = grid(detail);
            var mSel = field(cg, 'Method', dropdown(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(function (m) { return { value: m, label: m }; }), req.method));
            var uBox = field(cg, 'Full URL', textBox(req.url, 'https://another-api.example.com/v2/things'));
            bind(mSel, function (v) { req.method = v; req.label = req.method + ' ' + req.url; method.textContent = v; method.className = 'sdui-wz-method sdui-wz-method-' + v.toLowerCase(); }, 'change');
            bind(uBox, function (v) { req.url = v.trim(); req.label = req.method + ' ' + req.url; name.textContent = req.url || 'full URL…'; });
            var cta = field(detail, 'Body (JSON, leave empty for none)', textArea(req.body ? req.body.text : '', 3));
            bind(cta, function (v) { req.body = v ? { contentType: 'application/json', text: v } : null; });
            detail.hidden = !req.url;
          } else {
            if (req.pathParams.length || req.query.length) {
              var vg = grid(detail);
              req.pathParams.forEach(function (p) { bind(field(vg, 'Path · ' + p.name, textBox(p.value)), function (v) { p.value = v; }); });
              req.query.forEach(function (q) { bind(field(vg, 'Query · ' + q.name, textBox(q.value)), function (v) { q.value = v; }); });
            }
            if (req.body) {
              var ta = field(detail, 'Body (' + req.body.contentType + ')', textArea(req.body.text, 4),
                /multipart/.test(req.body.contentType) ? 'Each key becomes a form field; file uploads have to be added in JMeter.' : 'Sent exactly as written.');
              bind(ta, function (v) { req.body.text = v; });
            }
            if (!req.pathParams.length && !req.query.length && !req.body) detail.appendChild(elem('p', 'sdui-wz-hint', 'This request takes no values.'));
          }
          row.appendChild(detail);
          host.appendChild(row);
        });
      }
    }

    /* ----- 5. credential ----- */
    function renderAuth() {
      var est = J.estimate(cfg);
      var needsOther = est.scenarios.some(function (s) { return s.kind === 'quota-isolation'; }) && est.limits.identifier.kind === 'credential';
      var s = section(body, 'What credential do the requests carry?',
        'Limits are counted per credential, so this decides whose limit is measured.' +
        (authInfo.oauth ? ' The document declares OAuth 2 with a token endpoint, so fetching a token is pre-filled.' : ''));
      choiceCards(s, 'sdui-wz-auth', [
        { value: 'login', title: 'Fetch a token once', desc: 'A setUp thread group calls the token endpoint before any load; every request reuses the token.' },
        { value: 'static', title: 'I have one', desc: 'Paste a token or API key; -Jtoken overrides it at run time.' },
        { value: 'csv', title: 'Many keys from a CSV', desc: 'Each iteration takes the next line — spreads a per-key limit over many keys.' },
        { value: 'none', title: 'None', desc: 'Open endpoint, or the limiter counts by IP.' }
      ], cfg.auth.kind, function (v) { cfg.auth.kind = v; render(); });

      if (cfg.auth.kind !== 'none' && !(cfg.auth.kind === 'static' && authInfo.apiKeyIn === 'query')) {
        var gh = grid(s);
        bind(field(gh, 'Header', textBox(cfg.auth.header)), function (v) { cfg.auth.header = v; });
        bind(field(gh, 'Value prefix', textBox(cfg.auth.prefix), 'Empty for a bare API key.'), function (v) { cfg.auth.prefix = v; });
      }
      if (cfg.auth.kind === 'static') {
        var gs = grid(s);
        bind(field(gs, authInfo.apiKeyIn === 'query' ? 'API key (sent as ?' + authInfo.queryName + '=)' : 'Token / key', textBox(cfg.auth.value), 'Override at run time with -Jtoken=…'), function (v) { cfg.auth.value = v; });
        if (needsOther) bind(field(gs, 'A second key — the other caller', textBox(cfg.auth.value2), '-Jtoken2 overrides it.'), function (v) { cfg.auth.value2 = v; renderNav(); renderFoot(); });
      }
      if (cfg.auth.kind === 'csv') {
        var gc = grid(s);
        bind(field(gc, 'CSV file next to the .jmx', textBox(cfg.auth.csv.file), 'One credential per line; shared by all threads and recycled.'), function (v) { cfg.auth.csv.file = v.trim(); renderNav(); });
        bind(field(gc, 'Column name', textBox(cfg.auth.csv.variable)), function (v) { cfg.auth.csv.variable = v.trim() || 'apiKey'; });
        linkButton(s, 'download a template CSV', function () {
          opts.download(cfg.auth.csv.file || 'credentials.csv', 'text/csv', 'FIRST_KEY\nSECOND_KEY\nTHIRD_KEY\n');
        });
      }
      if (cfg.auth.kind === 'login') {
        renderLogin(s, cfg.auth.login, false);
        var gt = grid(s);
        bind(field(gt, 'Token lifetime (minutes)', numberBox(cfg.auth.ttlMinutes, 1), 'Used only when the response has no expires_in.'), function (v) { cfg.auth.ttlMinutes = num(v, 1); });
        var rsel = field(gt, 'When is it fetched?', dropdown([
          { value: 'once', label: 'Once, before the run (setUp)' },
          { value: 'expiry', label: 'Again when it expires' },
          { value: 'iteration', label: 'Before every iteration' }
        ], cfg.auth.refresh), refreshHint(cfg.auth.refresh));
        bind(rsel, function (v) { cfg.auth.refresh = v; render(); }, 'change');
        if (needsOther) {
          var s2 = section(body, 'The other caller', 'The "another caller is not affected" scenario needs a token for a second app. Same endpoint, different credentials.');
          renderLogin(s2, cfg.auth.login2, true);
        }
      }

      /* pass / fail rules */
      var c = section(body, 'What counts as a pass?', 'A limited answer (the status from the Limiter step) is a result, not an error; 2xx is a pass; everything else fails.');
      checkbox(c, 'Redirects (3xx) pass too', cfg.checks.allow3xx, function (v) { cfg.checks.allow3xx = v; });
      checkbox(c, 'Send and keep cookies', cfg.cookies, function (v) { cfg.cookies = v; }, 'Needed when the API hands out a session or sits behind a sticky load balancer.');
      var g5 = grid(c);
      bind(field(g5, 'Other codes that pass', textBox(cfg.checks.extraCodes, 'e.g. 404 403')), function (v) { cfg.checks.extraCodes = v; });
      bind(field(g5, 'Fail slower than (ms, 0 = off)', numberBox(cfg.checks.maxMs, 0)), function (v) { cfg.checks.maxMs = Math.round(num(v, 0)); });
      bind(field(g5, 'Connect timeout (ms)', numberBox(cfg.checks.connectMs, 100)), function (v) { cfg.checks.connectMs = Math.round(num(v, 100)); });
      bind(field(g5, 'Response timeout (ms)', numberBox(cfg.checks.timeoutMs, 100)), function (v) { cfg.checks.timeoutMs = Math.round(num(v, 100)); });
      bind(field(g5, 'Rate-limit header to record (optional)', textBox(cfg.checks.rateHeader, 'X-RateLimit-Remaining'),
        'Read from every response into a variable; run with -Jsample_variables=rateHeader to get it as a column in the .jtl.'), function (v) { cfg.checks.rateHeader = v.trim(); });
    }

    function refreshHint(mode) {
      if (mode === 'iteration') return 'The token endpoint then carries the same load as the API — that is a test of its own limit.';
      if (mode === 'expiry') return 'One thread refreshes at a time (Critical Section Controller); the others keep using the current token.';
      return 'The right choice for a rate-limit test: one token, fetched before the load, so the token endpoint never gets in the way.';
    }

    function renderLogin(parent, lg, second) {
      var sources = [];
      if (authInfo.oauth) sources.push({ value: 'oauth', label: 'OAuth 2 ' + authInfo.oauth.flow + ' — ' + authInfo.oauth.tokenUrl });
      ops.forEach(function (o) { sources.push({ value: o.id, label: o.method.toUpperCase() + ' ' + o.path + (o.summary ? '  —  ' + o.summary : '') }); });
      sources.push({ value: 'custom', label: 'Another URL — not in this document' });
      if (!second) {
        var lsel = field(parent, 'Token endpoint', dropdown(sources, lg.source));
        bind(lsel, function (v) {
          var entry = null;
          ops.forEach(function (o) { if (o.id === v) entry = o; });
          var fresh = J.read.loginDefaults(doc, v === 'oauth' ? authInfo : { oauth: null }, entry);
          fresh.source = v;
          cfg.auth.login = fresh;
          cfg.auth.login2 = JSON.parse(JSON.stringify(fresh));
          render();
        }, 'change');
      }
      var gl = grid(parent);
      if (!second) {
        bind(field(gl, 'URL or path', textBox(lg.url), 'A path uses the host above; a full https:// URL calls its own host.'), function (v) { lg.url = v.trim(); cfg.auth.login2.url = lg.url; renderNav(); renderFoot(); });
        bind(field(gl, 'Method', dropdown(['POST', 'GET', 'PUT'].map(function (m) { return { value: m, label: m }; }), lg.method)), function (v) { lg.method = v; cfg.auth.login2.method = v; }, 'change');
        var lc = field(gl, 'Content type', dropdown([
          { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' },
          { value: 'application/json', label: 'application/json' }
        ], lg.contentType));
        bind(lc, function (v) {
          lg.contentType = v;
          lg.body = /x-www-form-urlencoded/.test(v) ? J.asForm(lg.body) : J.asJson(lg.body);
          cfg.auth.login2.contentType = v;
          cfg.auth.login2.body = /x-www-form-urlencoded/.test(v) ? J.asForm(cfg.auth.login2.body) : J.asJson(cfg.auth.login2.body);
          render();
        }, 'change');
        bind(field(gl, 'Token field in the response', textBox(lg.jsonPath), 'JSON path — $.access_token, $.data.token …'), function (v) { lg.jsonPath = v.trim(); cfg.auth.login2.jsonPath = lg.jsonPath; });
        bind(field(gl, 'Lifetime field (optional)', textBox(lg.expiresPath), '$.expires_in — seconds; read when present.'), function (v) { lg.expiresPath = v.trim(); cfg.auth.login2.expiresPath = lg.expiresPath; });
      }
      var basicWrap = elem('div');
      parent.appendChild(basicWrap);
      checkbox(basicWrap, 'Client id and secret go in a Basic Authorization header', lg.basic.on, function (v) { lg.basic.on = v; drawBasic(); },
        'How Apigee\'s OAuthV2 token endpoints expect client credentials. Off = they are in the body below.');
      var basicGrid = grid(basicWrap);
      function drawBasic() {
        basicGrid.innerHTML = '';
        basicGrid.hidden = !lg.basic.on;
        if (!lg.basic.on) return;
        bind(field(basicGrid, 'Client id', textBox(lg.basic.id)), function (v) { lg.basic.id = v.trim(); });
        var sec = field(basicGrid, 'Client secret', textBox(lg.basic.secret), 'Kept out of the remembered answers; it is written into the .jmx.');
        sec.type = 'password';
        bind(sec, function (v) { lg.basic.secret = v; });
      }
      drawBasic();
      bind(field(parent, second ? 'Body sent to the token endpoint (other app)' : 'Body sent to the token endpoint', textArea(lg.body, 3),
        /x-www-form-urlencoded/.test(lg.contentType) ? 'Form fields as a=b&c=d.' : 'Sent exactly as written.'), function (v) { lg.body = v; renderNav(); renderFoot(); });
    }

    /* ----- 6. review ----- */
    function renderReview() {
      var est = J.estimate(cfg);
      if (est.problems.length) {
        var pr = section(body, 'Before the plan can be written');
        var ul = elem('ul', 'sdui-wz-list sdui-wz-problems');
        est.problems.forEach(function (p) { ul.appendChild(elem('li', null, p)); });
        pr.appendChild(ul);
      }
      var s = section(body, 'What will run');
      var sum = elem('div', 'sdui-wz-summary');
      sum.appendChild(elem('div', null, est.limits.policies.length
        ? est.limits.policies.map(function (p) { return A.describe(p); }).join(' ')
        : est.limits.quota ? 'Limit: ' + est.limits.quota.requestsAllowed + ' requests per ' + J.fmtSeconds(est.limits.quota.windowSeconds) + ' for ' + est.limits.quota.identifier.label + '.'
          : cfg.limiter.kind === 'unknown' ? 'The limit is not known; the staircase finds it.' : 'No limiter: plain load.'));
      sum.appendChild(elem('div', null, describeAuthShort()));
      sum.appendChild(elem('div', null, 'About ' + est.requests + ' requests in roughly ' + J.fmtSeconds(est.seconds) + ', against ' +
        cfg.requests.filter(function (r) { return r.on; }).map(function (r) { return r.label; }).join(', ') + '.'));
      s.appendChild(sum);
      est.warnings.forEach(function (w) { s.appendChild(elem('div', 'sdui-wz-warn', w)); });

      var tl = section(body, 'Timeline');
      var table = elem('table', 'sdui-wz-timeline');
      var thead = elem('thead');
      var hr = elem('tr');
      ['#', 'Scenario', 'Passes when', 'Time', 'Requests'].forEach(function (h) { hr.appendChild(elem('th', null, h)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = elem('tbody');
      if (cfg.auth.kind === 'login' && cfg.auth.refresh !== 'iteration') {
        var tr0 = elem('tr', 'sdui-wz-tl-aux');
        tr0.appendChild(elem('td', null, 'setUp'));
        tr0.appendChild(elem('td', null, 'Fetch the token'));
        tr0.appendChild(elem('td', null, cfg.auth.login.method + ' ' + cfg.auth.login.url + ' → ' + cfg.auth.login.jsonPath));
        tr0.appendChild(elem('td', null, '~1 s'));
        tr0.appendChild(elem('td', null, est.scenarios.some(function (x) { return x.kind === 'quota-isolation'; }) && est.limits.identifier.kind === 'credential' ? '2' : '1'));
        tb.appendChild(tr0);
      }
      est.scenarios.forEach(function (p) {
        var tr = elem('tr');
        tr.appendChild(elem('td', null, p.key));
        tr.appendChild(elem('td', null, p.title));
        tr.appendChild(elem('td', null, p.expectText));
        tr.appendChild(elem('td', null, J.fmtSeconds(p.seconds)));
        tr.appendChild(elem('td', null, String(p.requests)));
        tb.appendChild(tr);
      });
      var trz = elem('tr', 'sdui-wz-tl-aux');
      trz.appendChild(elem('td', null, 'tearDown'));
      trz.appendChild(elem('td', null, 'Verdicts'));
      trz.appendChild(elem('td', null, 'One VERDICT sample per scenario: PASS or FAIL, with the counts.'));
      trz.appendChild(elem('td', null, '~0 s'));
      trz.appendChild(elem('td', null, '0'));
      tb.appendChild(trz);
      table.appendChild(tb);
      tl.appendChild(table);

      var tree = section(body, 'Plan tree');
      tree.appendChild(elem('pre', 'sdui-wz-tree', planTree(est)));
    }

    function describeAuthShort() {
      var a = cfg.auth;
      if (a.kind === 'none') return 'No credential is sent.';
      if (a.kind === 'csv') return 'Credentials come one per iteration from ' + a.csv.file + '.';
      if (a.kind === 'static') return 'Every request carries the ' + a.header + ' header you pasted.';
      return 'A token is fetched ' + (a.refresh === 'once' ? 'once, before the load,' : a.refresh === 'expiry' ? 'once and again on expiry,' : 'before every iteration,') +
        ' from ' + a.login.method + ' ' + a.login.url + ' and sent as ' + a.header + '.';
    }

    function planTree(est) {
      var lines = [];
      var active = cfg.requests.filter(function (r) { return r.on; });
      lines.push('Test plan — ' + ((doc.info && doc.info.title) || 'API') + '  (thread groups run one after another)');
      lines.push('├─ HTTP defaults → ' + (J.read.parseBase(cfg.target.url) || { host: '?' }).host + '  (-Jhost / -Jport / -Jprotocol)');
      if (cfg.cookies) lines.push('├─ Cookie manager');
      if (cfg.auth.kind === 'csv') lines.push('├─ CSV data set → ' + cfg.auth.csv.file);
      if (cfg.auth.kind === 'login' && cfg.auth.refresh !== 'iteration') {
        lines.push('├─ setUp thread group — fetch the token once');
        lines.push('│    └─ TOKEN ' + cfg.auth.login.method + ' ' + cfg.auth.login.url + '  → JSON extractor → property sduiToken');
      }
      est.scenarios.forEach(function (p) {
        p.groups.forEach(function (g) {
          var how = g.mode === 'burst' ? g.threads + ' threads released together × ' + g.loops
            : (g.threads + ' thread' + (g.threads === 1 ? '' : 's') + (g.duration ? ' for ' + J.fmtSeconds(g.duration) : ' × ' + g.loops) + (g.rpm ? ' at ' + g.rpm + ' req/min' : ''));
          lines.push('├─ ' + g.name + '  [' + how + ']');
          lines.push('│    ├─ Headers: Accept' + (cfg.auth.kind !== 'none' ? ', ' + cfg.auth.header : '') + (est.limits.identifier.kind === 'header' ? ', ' + est.limits.identifier.name : ''));
          if (g.wait) lines.push('│    ├─ Start-up delay until a fresh window (≤ ' + J.fmtSeconds(g.wait.seconds) + ')');
          lines.push('│    ├─ ' + (g.mode === 'burst' ? 'Synchronizing timer' : g.mode === 'paced' ? 'Constant throughput timer' : 'no timer'));
          lines.push('│    ├─ Response assertion (pass or limited) · counter post-processor');
          if (cfg.auth.kind === 'login' && cfg.auth.refresh !== 'once' && g.identity !== 'other') lines.push('│    ├─ ' + (cfg.auth.refresh === 'expiry' ? 'If expired → TOKEN (one thread at a time)' : 'TOKEN every iteration'));
          active.forEach(function (r, i) {
            lines.push('│    ' + (i === active.length - 1 ? '└─ ' : '├─ ') + (cfg.mix === 'weighted' && active.length > 1 ? r.weight + '× ' : '') + '[' + (g.step ? p.key + '.' + g.step : p.key) + '] ' + r.label);
          });
        });
      });
      lines.push('├─ tearDown thread group — verdicts');
      est.scenarios.forEach(function (p, i) {
        lines.push('│    ' + (i === est.scenarios.length - 1 ? '└─ ' : '├─ ') + 'VERDICT ' + p.key + ' — ' + p.title);
      });
      lines.push('└─ Summary report · Aggregate report');
      return lines.join('\n');
    }

    /* ----- download ----- */
    function generate() {
      var est = J.estimate(cfg);
      if (est.problems.length) { note.textContent = est.problems[0]; return; }
      try {
        var plan = J.build(doc, cfg);
        opts.download(plan.file, 'application/xml', plan.xml);
        opts.setStatus('ok', 'JMeter plan downloaded — ' + plan.file);
        remember(doc, cfg);
        downloaded = plan;
        showResult(plan);
      } catch (err) {
        note.textContent = 'Could not build the plan: ' + (err.message || err);
      }
    }

    function showResult(plan) {
      nav.innerHTML = '';
      body.innerHTML = '';
      var done = section(body, '✔ Downloaded — ' + plan.file);
      done.appendChild(elem('div', 'sdui-wz-summary', 'About ' + plan.estimate.requests + ' requests in roughly ' + J.fmtSeconds(plan.estimate.seconds) + '. ' + plan.estimate.scenarios.length + ' scenario' + (plan.estimate.scenarios.length === 1 ? '' : 's') + ', each with its own verdict.'));

      var run = section(body, '1. Run it');
      run.appendChild(elem('pre', 'sdui-wz-cmd', plan.commands[0]));
      run.appendChild(elem('p', 'sdui-wz-hint', 'Non-GUI mode, with the HTML dashboard written to ./report. Or open the file in the JMeter GUI and press Start — nothing needs editing first.' +
        (cfg.auth.kind === 'csv' ? ' Put ' + cfg.auth.csv.file + ' next to the .jmx before you start.' : '') +
        ' Overrides: ' + plan.knobs.join(' · ')));

      var read = section(body, '2. Read the verdicts');
      read.appendChild(elem('pre', 'sdui-wz-cmd', plan.commands[1]));
      var ul = elem('ul', 'sdui-wz-list');
      ul.appendChild(elem('li', null, 'Each scenario prints one line on the console as it finishes — VERDICT S1 PASS … — with the pass / limited / other counts and where the first refusal came.'));
      ul.appendChild(elem('li', null, 'The same lines are in results.jtl as samples labelled VERDICT, response code PASS or FAIL, so a CI job can fail on them.'));
      plan.estimate.scenarios.forEach(function (p) { ul.appendChild(elem('li', null, p.key + ' — ' + p.title + ': ' + p.expectText)); });
      if (plan.estimate.limits.policies.length) ul.appendChild(elem('li', null, 'A limited answer whose body does not carry the policy\'s fault code (QuotaViolation / SpikeArrestViolation) is reported as coming from another limiter.'));
      read.appendChild(ul);

      actions.innerHTML = '';
      var copy = elem('button', 'sdui-tool-btn', 'Copy commands');
      copy.type = 'button';
      copy.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plan.commands.join('\n')).then(function () { copy.textContent = 'Copied'; }, function () {});
        }
      });
      var again = elem('button', 'sdui-tool-btn', 'Change and rebuild');
      again.type = 'button';
      again.addEventListener('click', function () { downloaded = null; goto(STEPS.length - 1); });
      var ok = elem('button', 'sdui-tool-btn sdui-wz-primary', 'Done');
      ok.type = 'button';
      ok.addEventListener('click', dismiss);
      actions.appendChild(copy);
      actions.appendChild(again);
      actions.appendChild(ok);
      note.textContent = '';
    }

    render();
  }

  J.open = open;
})();

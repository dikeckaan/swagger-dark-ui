/* OASForge — JMeter scenario builder.
   Turns the wizard's answers (js/jmeter-wizard.js) into an Apache JMeter
   5.4.3 plan that runs as downloaded and *grades itself*: every scenario is
   its own thread group, run one after another; a post-processor sorts every
   response into pass / limited / other (and, for Apigee, reads which policy
   fired from the fault body); a tearDown group then writes one VERDICT
   sample per scenario — PASS or FAIL against what the limiter config says
   should have happened — so the answer is one grep away.

   Only long-standing core elements and BeanShell are used (no Groovy, no
   plugins), so the plan opens on JMeter 5.4.3 under any Java it supports and
   on later 5.x releases alike. Everything that depends on the deployment
   (host, port, token, rates) stays overridable with -J properties. */
(function (root) {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  var TOKEN_HINT = /token|login|signin|sign-in|oauth|authenticate|authorize|session|connect/;
  var UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 };

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function deref(doc, node) {
    if (isObj(node) && typeof node.$ref === 'string' && node.$ref.slice(0, 2) === '#/') {
      var cur = doc;
      var parts = node.$ref.slice(2).split('/');
      for (var i = 0; i < parts.length && cur; i++) {
        cur = cur[parts[i].replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      return cur || {};
    }
    return node;
  }

  function exampleFor(doc, schema) {
    if (!schema) return undefined;
    var mock = root.SduiMock;
    if (mock && mock.exampleFromSchema) return mock.exampleFromSchema(schema, doc);
    return undefined;
  }

  function slug(doc) {
    var title = (doc && doc.info && doc.info.title) || 'api';
    return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'api';
  }

  /* ==================================================================
     1. Reading the document
     ================================================================== */

  function operations(doc) {
    var out = [];
    if (!isObj(doc) || !isObj(doc.paths)) return out;
    Object.keys(doc.paths).forEach(function (path) {
      var item = deref(doc, doc.paths[path]);
      if (!isObj(item)) return;
      var shared = Array.isArray(item.parameters) ? item.parameters : [];
      METHODS.forEach(function (method) {
        var op = item[method];
        if (!isObj(op)) return;
        out.push({
          id: method + ' ' + path,
          path: path,
          method: method,
          op: op,
          shared: shared,
          tags: Array.isArray(op.tags) ? op.tags : [],
          summary: op.summary || op.operationId || '',
          deprecated: op.deprecated === true,
          tokenish: TOKEN_HINT.test(path + ' ' + (op.operationId || '') + ' ' + (op.summary || ''))
        });
      });
    });
    return out;
  }

  function guessLogin(ops) {
    var posts = ops.filter(function (o) { return o.tokenish && o.method === 'post'; });
    return posts[0] || ops.filter(function (o) { return o.tokenish; })[0] || null;
  }

  function guessTarget(ops, login) {
    var plain = ops.filter(function (o) { return o !== login && !o.tokenish && !o.deprecated; });
    var read = plain.filter(function (o) { return o.method === 'get' && !/\{/.test(o.path); });
    return read[0] || plain.filter(function (o) { return o.method === 'get'; })[0] || plain[0] || ops[0] || null;
  }

  function serverUrls(doc) {
    if (!isObj(doc) || !Array.isArray(doc.servers)) return [];
    var out = [];
    doc.servers.forEach(function (server) {
      if (!isObj(server) || typeof server.url !== 'string' || !server.url) return;
      var url = server.url;
      if (isObj(server.variables)) {
        url = url.replace(/\{([^}]+)\}/g, function (match, key) {
          var v = deref(doc, server.variables[key]);
          return isObj(v) && v.default !== undefined ? String(v.default) : match;
        });
      }
      if (/^https?:\/\//i.test(url) && !/\{|\}/.test(url)) out.push(url.replace(/\/+$/, ''));
    });
    return out;
  }

  function parseBase(url) {
    var m = String(url || '').trim().match(/^(https?):\/\/([^/:?#\s]+)(?::(\d+))?([^?#\s]*)/i);
    if (!m) return null;
    var protocol = m[1].toLowerCase();
    return {
      protocol: protocol,
      host: m[2],
      port: m[3] || (protocol === 'https' ? '443' : '80'),
      basePath: (m[4] || '').replace(/\/+$/, '')
    };
  }

  /* The security scheme the document leans on, read into "which header
     carries the credential" plus — for OAuth 2 — the token endpoint. */
  function authOf(doc) {
    var schemes = isObj(doc) && doc.components && doc.components.securitySchemes;
    var out = { header: 'Authorization', prefix: 'Bearer ', secured: false, scheme: null, oauth: null, apiKeyIn: null };
    if (!isObj(schemes)) return out;
    var names = Object.keys(schemes);
    var preferred = [];
    if (Array.isArray(doc.security)) {
      doc.security.forEach(function (req) { if (isObj(req)) preferred = preferred.concat(Object.keys(req)); });
    }
    if (isObj(doc.paths)) {
      Object.keys(doc.paths).forEach(function (p) {
        var item = doc.paths[p];
        if (!isObj(item)) return;
        METHODS.forEach(function (m) {
          var op = item[m];
          if (isObj(op) && Array.isArray(op.security)) {
            op.security.forEach(function (req) { if (isObj(req)) preferred = preferred.concat(Object.keys(req)); });
          }
        });
      });
    }
    var order = preferred.concat(names).filter(function (n, i, a) { return names.indexOf(n) !== -1 && a.indexOf(n) === i; });
    // OAuth 2 wins when it is used anywhere: it is the one with a token endpoint.
    var oauthName = order.filter(function (n) { var s = deref(doc, schemes[n]); return isObj(s) && s.type === 'oauth2'; })[0];
    var name = oauthName || order[0];
    var scheme = deref(doc, schemes[name]);
    if (!isObj(scheme)) return out;
    out.secured = true;
    out.scheme = name;
    if (scheme.type === 'apiKey') {
      out.apiKeyIn = scheme.in || 'header';
      if (scheme.in === 'header' || !scheme.in) { out.header = scheme.name || 'X-API-Key'; out.prefix = ''; }
      else if (scheme.in === 'query') { out.header = 'Authorization'; out.prefix = ''; out.queryName = scheme.name; }
    } else if (scheme.type === 'http' && /^basic$/i.test(scheme.scheme || '')) {
      out.prefix = 'Basic ';
    } else if (scheme.type === 'oauth2' && isObj(scheme.flows)) {
      var flows = scheme.flows;
      var pick = ['clientCredentials', 'password', 'authorizationCode', 'implicit'].filter(function (f) {
        return isObj(flows[f]) && typeof flows[f].tokenUrl === 'string';
      })[0];
      if (pick) {
        var flow = flows[pick];
        out.oauth = {
          flow: pick,
          tokenUrl: flow.tokenUrl,
          scopes: isObj(flow.scopes) ? Object.keys(flow.scopes) : []
        };
      }
    }
    return out;
  }

  function scalar(value, fallback) {
    if (Array.isArray(value)) {
      var flat = value.filter(function (v) { return v !== null && typeof v !== 'object'; });
      return flat.length ? flat.join(',') : fallback;
    }
    if (value === undefined || value === null || typeof value === 'object') return fallback;
    return String(value).replace(/[\r\n\t]+/g, ' ');
  }

  function placeholder(schema) {
    var type = (schema && schema.type) || 'string';
    if (type === 'integer' || type === 'number') return '1';
    if (type === 'boolean') return 'true';
    return 'value';
  }

  function paramValue(doc, p) {
    var schema = p.schema && deref(doc, p.schema);
    var value = p.example !== undefined ? p.example
      : (schema && schema.example !== undefined ? schema.example
        : (schema && schema.default !== undefined ? schema.default : exampleFor(doc, p.schema)));
    return scalar(value, placeholder(schema));
  }

  function asForm(text) {
    try {
      var o = JSON.parse(text);
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return Object.keys(o).map(function (k) {
          var v = o[k];
          return encodeURIComponent(k) + '=' + encodeURIComponent(v === null || typeof v === 'object' ? '' : v);
        }).join('&');
      }
    } catch (e) { /* already form text */ }
    return text;
  }

  function asJson(text) {
    if (/^\s*[[{]/.test(text)) return text;
    var o = {};
    String(text).split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      try {
        o[decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq))] = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
      } catch (e) { o[pair] = ''; }
    });
    return JSON.stringify(o, null, 2);
  }

  function bodyFor(doc, requestBody) {
    var rb = deref(doc, requestBody);
    if (!isObj(rb) || !isObj(rb.content)) return null;
    var mimes = Object.keys(rb.content);
    var jsonMime = mimes.filter(function (m) { return /json/.test(m); })[0];
    var mime = jsonMime || mimes[0];
    if (!mime) return null;
    var mt = rb.content[mime] || {};
    var example = mt.example !== undefined ? mt.example
      : (isObj(mt.examples) && Object.keys(mt.examples).length
        ? (deref(doc, mt.examples[Object.keys(mt.examples)[0]]) || {}).value
        : exampleFor(doc, mt.schema));
    if (example === undefined) example = {};
    var text = typeof example === 'string' ? example : JSON.stringify(example, null, 2);
    return { contentType: mime, text: /x-www-form-urlencoded/.test(mime) ? asForm(text) : text };
  }

  function requestFor(doc, entry) {
    var params = entry.shared.concat(Array.isArray(entry.op.parameters) ? entry.op.parameters : [])
      .map(function (p) { return deref(doc, p); })
      .filter(isObj);
    var req = {
      id: entry.id,
      on: false,
      weight: 1,
      method: entry.method.toUpperCase(),
      path: entry.path,
      url: '',
      label: entry.method.toUpperCase() + ' ' + entry.path,
      summary: entry.summary,
      tags: entry.tags,
      deprecated: entry.deprecated,
      pathParams: [],
      query: [],
      headers: [],
      body: null
    };
    params.forEach(function (p) {
      var value = paramValue(doc, p);
      if (p.in === 'path') req.pathParams.push({ name: p.name, value: value });
      else if (p.in === 'query') { if (p.required === true || p.example !== undefined) req.query.push({ name: p.name, value: value }); }
      else if (p.in === 'header' && !/^(authorization|content-type|accept)$/i.test(p.name)) req.headers.push({ name: p.name, value: value });
    });
    req.body = bodyFor(doc, entry.op.requestBody);
    return req;
  }

  function customRequest(url) {
    return {
      id: 'custom-' + Math.random().toString(36).slice(2, 8),
      on: true, custom: true, weight: 1,
      method: 'GET', path: '', url: url || '',
      label: 'GET ' + (url || ''), summary: '', tags: [],
      pathParams: [], query: [], headers: [], body: null
    };
  }

  /* ==================================================================
     2. Limits — one shape whatever the source (Apigee XML, a known limit)
     ================================================================== */

  /* cfg.limiter → { quota, spike, codes, identifier, signatureFor } */
  function resolveLimits(cfg) {
    var lim = cfg.limiter || { kind: 'none' };
    var out = {
      kind: lim.kind || 'none',
      quota: null,
      spike: null,
      policies: [],
      identifier: { kind: 'proxy', name: null, label: 'the whole proxy' },
      limitCodes: codesToRegex(lim.limitCodes || '429', '429'),
      warnings: []
    };
    var apigee = root.SduiApigee;
    if (lim.kind === 'apigee' && apigee) {
      var parsed = apigee.parse(lim.apigee && lim.apigee.text);
      out.warnings = parsed.warnings.slice();
      parsed.policies.forEach(function (p, i) {
        if (p.enabled === false) return;
        var values = (lim.apigee && lim.apigee.values && lim.apigee.values[i]) || {};
        var r = apigee.resolve(p, values, { mps: lim.apigee && lim.apigee.mps });
        out.policies.push(r);
        if (r.kind === 'quota' && r.complete && !out.quota) out.quota = r;
        else if (r.kind === 'spike' && r.complete && !out.spike) out.spike = r;
      });
      var withId = out.quota || out.spike;
      if (withId) out.identifier = withId.identifier;
    } else if (lim.kind === 'known' && lim.known) {
      var k = lim.known;
      var unit = (k.unit || 'minute').toLowerCase();
      var interval = Math.max(1, Math.round(num(k.interval, 1)));
      var count = Math.max(1, Math.round(num(k.count, 1)));
      out.quota = {
        kind: 'quota',
        policy: { displayName: 'Documented limit', distributed: true, synchronous: k.exact !== false, startTime: null },
        complete: true,
        allow: count,
        requestsAllowed: count,
        effectiveAllowed: count,
        copies: 1,
        interval: interval,
        unit: unit,
        windowSeconds: interval * (UNIT_SECONDS[unit] || 60),
        type: k.type === 'rolling' ? 'rollingwindow' : (k.type === 'flexi' ? 'flexi' : 'default'),
        startMs: null,
        exact: k.exact !== false,
        identifier: knownIdentifier(k),
        faultSignature: '',
        mps: 1
      };
      out.identifier = out.quota.identifier;
    }
    return out;
  }

  function knownIdentifier(k) {
    var per = k.per || 'credential';
    if (per === 'header') return { kind: 'header', name: k.name || 'X-Client-Id', label: 'the ' + (k.name || 'X-Client-Id') + ' request header' };
    if (per === 'query') return { kind: 'query', name: k.name || 'client_id', label: 'the ' + (k.name || 'client_id') + ' query parameter' };
    if (per === 'ip') return { kind: 'ip', name: null, label: 'the client IP' };
    if (per === 'proxy') return { kind: 'proxy', name: null, label: 'the whole API (one shared counter)' };
    return { kind: 'credential', name: null, label: 'the calling credential' };
  }

  function codesToRegex(text, fallback) {
    var parts = [];
    String(text || '').split(/[\s,;]+/).forEach(function (c) {
      c = c.trim().toLowerCase();
      if (!c) return;
      if (/^\d{3}$/.test(c)) parts.push(c);
      else if (/^[1-5]xx$/.test(c)) parts.push(c.charAt(0) + '\\d\\d');
    });
    if (!parts.length && fallback) parts.push(fallback);
    return parts.filter(function (p, i, a) { return a.indexOf(p) === i; });
  }

  function passRegexParts(checks) {
    var parts = ['2\\d\\d'];
    if (checks && checks.allow3xx) parts.push('3\\d\\d');
    codesToRegex(checks && checks.extraCodes, '').forEach(function (p) { if (parts.indexOf(p) === -1) parts.push(p); });
    return parts;
  }

  /* ==================================================================
     3. Scenarios — what the limiter config says is worth proving
     ================================================================== */

  function num(v, dflt) {
    var n = parseFloat(v);
    return isNaN(n) ? dflt : n;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function usersFor(rpm) { return clamp(Math.ceil(rpm / 60 * 0.5), 1, 100); }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* Default parameters for every scenario kind the limits make possible, in
     the order they should run. The wizard keeps the user's edits where the
     kind survives a change of limiter. */
  function suggestScenarios(limits) {
    var list = [];
    var q = limits.quota;
    var s = limits.spike;
    var ident = limits.identifier;
    // With a spike arrest in front of the quota, every quota scenario has to
    // stay under the smoothed rate or it measures the wrong policy.
    var cap = s ? Math.max(1, Math.floor(s.effectivePerSecond * 60 * 0.5)) : Infinity;

    if (s) {
      var bucket = s.bucket * s.copies;
      var size = clamp(bucket * 4 + 10, 20, 500);
      var refill = Math.ceil(bucket * s.gapMs / 1000) + 1;
      list.push(scenario('spike-burst', { size: size, bursts: 3, gapSeconds: refill }, true));
      var secs = Math.max(30, Math.ceil(20 / Math.max(0.01, s.effectivePerSecond)));
      list.push(scenario('spike-paced', { factor: 0.75, seconds: secs, tolerancePct: 10 }, true));
      list.push(scenario('spike-over', { factor: 2, seconds: secs }, !q));
    }
    if (q) {
      var allowed = q.effectiveAllowed;
      var longWindow = q.windowSeconds > 3600;
      var overshoot = Math.max(5, Math.ceil(allowed * 0.1));
      var total = allowed + overshoot;
      // Finish inside a quarter of the window so the counter cannot reset underneath the run.
      var rpm = Math.min(cap, clamp(Math.ceil(total / Math.max(10, q.windowSeconds / 4) * 60), 60, 6000));
      var tol = q.exact ? 1 : 5;
      // Start in a fresh window whenever waiting for one is affordable: the
      // count only proves anything when nothing else used the window first.
      list.push(scenario('quota-edge', {
        overshoot: overshoot, rpm: rpm, users: usersFor(rpm), tolerancePct: tol,
        freshWindow: q.windowSeconds <= 3600, graceSeconds: q.exact ? 3 : 15
      }, true));
      if (ident.kind === 'header' || ident.kind === 'query' || ident.kind === 'credential') {
        list.push(scenario('quota-isolation', { requests: 3 }, true));
      }
      list.push(scenario('quota-reset', { requests: 3, graceSeconds: q.exact ? 3 : 15 }, !longWindow));
      var underRpm = Math.max(1, Math.floor(allowed / q.windowSeconds * 60 * 0.9));
      list.push(scenario('quota-under', {
        factor: 0.9, windows: 1, users: usersFor(underRpm), freshWindow: true, graceSeconds: q.exact ? 3 : 15
      }, !longWindow && q.windowSeconds <= 3600 && underRpm <= cap));
      var overRpm = Math.max(2, Math.ceil(allowed / q.windowSeconds * 60 * 1.5));
      list.push(scenario('quota-over', {
        factor: 1.5, windows: 1, users: usersFor(overRpm), freshWindow: true, graceSeconds: q.exact ? 3 : 15
      }, false));
    }
    if (limits.kind === 'unknown') {
      list.push(scenario('staircase', { startRpm: 60, stepRpm: 60, steps: 10, stepSeconds: 30, users: 10 }, true));
    }
    if (limits.kind === 'none' || !list.length) {
      list.push(scenario('steady', { rpm: 600, minutes: 5, users: 10, rampup: 10 }, limits.kind === 'none'));
      list.push(scenario('burst', { size: 50, bursts: 3, gapSeconds: 30 }, false));
    }
    return list;
  }

  function scenario(kind, params, on) {
    return { kind: kind, on: on !== false, params: params };
  }

  var KINDS = {
    'quota-edge': {
      title: 'Walk up to the quota and over it',
      why: 'Sends exactly the allowed number of requests plus a few more, fast enough to stay inside one window. The first N must pass and everything after must be refused — this is the proof that the quota is the number the policy says.'
    },
    'quota-reset': {
      title: 'Wait for the window and prove it resets',
      why: 'Runs after the quota is exhausted: waits until the window turns over, then sends a few requests that must all pass again. Proves the reset happens when the policy type says it does.'
    },
    'quota-isolation': {
      title: 'Another caller is not affected',
      why: 'Right after the quota is exhausted for one identity, a different identity sends a few requests. They must pass — the counter is per caller, not shared.'
    },
    'quota-under': {
      title: 'Hold a rate just under the quota',
      why: 'A steady rate that would use 90% of the quota over a full window. Nothing may be refused; a 429 here means the limit is lower than documented, or the counter is shared with other traffic.'
    },
    'quota-over': {
      title: 'Hold a rate over the quota',
      why: 'A steady rate 1.5× the quota for a full window: the policy must start refusing once the count is used up and let roughly the allowed number through.'
    },
    'spike-burst': {
      title: 'Burst — everything at the same instant',
      why: 'All threads are released together by a Synchronizing Timer. Spike arrest smooths traffic, so only the burst allowance passes and the rest must be refused — repeated a few times with a pause for the bucket to refill.'
    },
    'spike-paced': {
      title: 'Paced under the rate',
      why: 'Requests spaced evenly at 75% of the configured rate. Spike arrest must let them through (a few refusals are timing jitter — smoothing rejects anything that arrives early); many refusals mean the real rate is lower, e.g. fewer message processors than assumed.'
    },
    'spike-over': {
      title: 'Paced at twice the rate',
      why: 'Evenly spaced requests at 2× the rate: about half must be refused. Shows the smoothing in action, not just the burst cut-off.'
    },
    'staircase': {
      title: 'Climb the rate until the limiter answers',
      why: 'One thread group per step, each holding a higher rate than the last. The first step with refusals is the limit — this is how to find a limit nobody wrote down.'
    },
    'steady': {
      title: 'Steady rate',
      why: 'A constant rate held for a set time by a Constant Throughput Timer. The baseline load test.'
    },
    'burst': {
      title: 'Bursts',
      why: 'A number of requests released at the same instant, repeated with a pause between bursts.'
    }
  };

  function kindInfo(kind) { return KINDS[kind] || { title: kind, why: '' }; }

  /* The scenario with everything the builder needs worked out: thread
     counts, loops, rates, the wait before it starts, and the verdict rule. */
  function planScenario(scn, limits, index, checks) {
    var p = scn.params || {};
    var q = limits.quota;
    var s = limits.spike;
    var key = 'S' + (index + 1);
    var info = kindInfo(scn.kind);
    var out = {
      key: key, kind: scn.kind, title: info.title, why: info.why,
      groups: [], seconds: 0, requests: 0, expect: null, expectText: '', notes: []
    };

    function quotaWait(grace) {
      if (!q) return null;
      return { kind: 'window', seconds: q.windowSeconds + grace, expr: windowWaitExpr(q, grace) };
    }
    // The rate a few probing requests are sent at: slow, and under any spike
    // arrest in front of the quota, so they measure the quota and nothing else.
    var spikeCap = s ? Math.max(1, Math.floor(s.effectivePerSecond * 60 * 0.5)) : Infinity;
    var probeRpm = Math.min(60, spikeCap);
    function spikeNote(rpm) {
      if (s && rpm > spikeCap) {
        out.notes.push(rpm + ' req/min is above half the spike-arrest rate (' + s.text + '): refusals would come from ' +
          s.policy.displayName + ', not from the quota. Keep it at or under ' + spikeCap + ' req/min.');
      }
    }

    if (scn.kind === 'quota-edge' && q) {
      var overshoot = Math.max(1, Math.round(num(p.overshoot, 5)));
      var users = Math.max(1, Math.round(num(p.users, 1)));
      var total = q.effectiveAllowed + overshoot;
      var loops = Math.ceil(total / users);
      total = loops * users;
      var rpm = Math.max(1, num(p.rpm, 60));
      var tol = Math.max(0, num(p.tolerancePct, 1)) / 100;
      var fuzz = Math.ceil(q.effectiveAllowed * tol) + (users > 1 ? users : 0);
      out.groups.push({
        name: key + ' — ' + info.title,
        threads: users, loops: loops, rpm: rpm, mode: 'paced',
        wait: p.freshWindow ? quotaWait(num(p.graceSeconds, 5)) : null
      });
      spikeNote(rpm);
      out.requests = total;
      out.seconds = Math.ceil(total / rpm * 60) + (p.freshWindow ? q.windowSeconds : 0);
      out.expect = {
        rule: 'edge', passMin: Math.max(0, q.effectiveAllowed - fuzz), passMax: q.effectiveAllowed + fuzz,
        limitedMin: Math.max(1, total - (q.effectiveAllowed + fuzz)), signature: q.faultSignature
      };
      out.expectText = total + ' requests at ' + rpm + ' req/min: the first ' + q.effectiveAllowed +
        (fuzz ? ' (±' + fuzz + ')' : '') + ' pass, the remaining ' + (total - q.effectiveAllowed) + ' are refused.';
      if (q.windowSeconds / 3 * rpm / 60 < total) {
        out.notes.push('At ' + rpm + ' req/min this takes ' + fmtSeconds(total / rpm * 60) + ' — more than a third of the ' +
          fmtSeconds(q.windowSeconds) + ' window. Raise the rate or the window may reset mid-run.');
      }
    } else if (scn.kind === 'quota-reset' && q) {
      var n = Math.max(1, Math.round(num(p.requests, 3)));
      out.groups.push({ name: key + ' — ' + info.title, threads: 1, loops: n, mode: 'paced', rpm: probeRpm, wait: quotaWait(num(p.graceSeconds, 5)) });
      out.requests = n;
      out.seconds = q.windowSeconds + num(p.graceSeconds, 5) + n;
      out.expect = { rule: 'all-pass' };
      out.expectText = 'Waits ' + resetWaitText(q, num(p.graceSeconds, 5)) + ', then ' + n + ' requests that must all pass.';
    } else if (scn.kind === 'quota-isolation' && q) {
      var ni = Math.max(1, Math.round(num(p.requests, 3)));
      out.groups.push({ name: key + ' — ' + info.title, threads: 1, loops: ni, mode: 'paced', rpm: probeRpm, identity: 'other' });
      out.requests = ni;
      out.seconds = ni;
      out.expect = { rule: 'all-pass' };
      out.expectText = ni + ' requests as ' + limits.identifier.label.replace(/^the /, 'a different ') + ' right after the quota is used up: all must pass.';
    } else if ((scn.kind === 'quota-under' || scn.kind === 'quota-over') && q) {
      var factor = Math.max(0.01, num(p.factor, scn.kind === 'quota-under' ? 0.9 : 1.5));
      // A fixed window is only proven across a whole window: a fraction of one
      // would let the rate "over the quota" pass without ever hitting it.
      var windows = Math.max(1, num(p.windows, 1));
      var secs = Math.ceil(q.windowSeconds * windows);
      var rate = Math.max(1, Math.round(q.effectiveAllowed / q.windowSeconds * 60 * factor));
      var u = Math.max(1, Math.round(num(p.users, usersFor(rate))));
      out.groups.push({
        name: key + ' — ' + info.title, threads: u, duration: secs, rpm: rate, mode: 'paced',
        wait: p.freshWindow ? quotaWait(num(p.graceSeconds, 5)) : null
      });
      spikeNote(rate);
      out.requests = Math.round(rate * secs / 60);
      out.seconds = secs + (p.freshWindow ? q.windowSeconds : 0);
      if (scn.kind === 'quota-under') {
        out.expect = { rule: 'none-limited' };
        out.expectText = rate + ' req/min (' + Math.round(factor * 100) + '% of the quota) for ' + fmtSeconds(secs) + ': nothing may be refused.';
      } else {
        var expectPass = Math.ceil(q.effectiveAllowed * windows);
        var fz = Math.ceil(expectPass * (q.exact ? 0.02 : 0.1)) + u;
        out.expect = { rule: 'over', passMax: expectPass + fz, limitedMin: 1, signature: q.faultSignature };
        out.expectText = rate + ' req/min (' + Math.round(factor * 100) + '% of the quota) for ' + fmtSeconds(secs) +
          ': about ' + expectPass + ' pass, the rest are refused.';
      }
    } else if (scn.kind === 'spike-burst' && s) {
      var size = Math.max(2, Math.round(num(p.size, 20)));
      var bursts = Math.max(1, Math.round(num(p.bursts, 3)));
      var gap = Math.max(0, num(p.gapSeconds, 2));
      out.groups.push({ name: key + ' — ' + info.title, threads: size, loops: bursts, mode: 'burst', gapSeconds: gap });
      out.requests = size * bursts;
      out.seconds = bursts * (gap + 1);
      var allowance = s.bucket * s.copies;
      out.expect = {
        rule: 'burst', bursts: bursts, passMaxPerBurst: allowance + Math.max(1, Math.ceil(allowance * 0.5)),
        signature: s.faultSignature
      };
      out.expectText = bursts + ' bursts of ' + size + ' simultaneous requests, ' + gap + ' s apart: about ' + allowance +
        ' pass per burst' + (s.copies > 1 ? ' (' + s.bucket + ' per message processor)' : '') + ', the rest are refused.';
    } else if ((scn.kind === 'spike-paced' || scn.kind === 'spike-over') && s) {
      var f = Math.max(0.01, num(p.factor, scn.kind === 'spike-paced' ? 0.75 : 2));
      var sec = Math.max(5, Math.round(num(p.seconds, 30)));
      var rp = Math.max(1, round1(s.effectivePerSecond * 60 * f));
      var threads = s.gapMs / f >= 300 ? 1 : usersFor(rp);
      out.groups.push({ name: key + ' — ' + info.title, threads: threads, duration: sec, rpm: rp, mode: 'paced' });
      out.requests = Math.round(rp * sec / 60);
      out.seconds = sec;
      if (scn.kind === 'spike-paced') {
        var tp = Math.max(0, num(p.tolerancePct, 10));
        out.expect = { rule: 'mostly-pass', tolerancePct: tp };
        out.expectText = rp + ' req/min, evenly spaced, for ' + sec + ' s: at most ' + tp + '% refused.';
      } else {
        out.expect = { rule: 'ratio', limitedMinPct: 25, limitedMaxPct: 75, signature: s.faultSignature };
        out.expectText = rp + ' req/min (' + f + '× the rate) for ' + sec + ' s: roughly half refused.';
      }
    } else if (scn.kind === 'staircase') {
      var start = Math.max(1, num(p.startRpm, 60));
      var step = Math.max(0, num(p.stepRpm, 60));
      var steps = Math.max(1, Math.round(num(p.steps, 10)));
      var stepSecs = Math.max(5, Math.round(num(p.stepSeconds, 30)));
      var su = Math.max(1, Math.round(num(p.users, 10)));
      for (var i = 0; i < steps; i++) {
        var r = start + i * step;
        out.groups.push({ name: key + '.' + (i + 1) + ' — ' + r + ' req/min', step: i + 1, threads: su, duration: stepSecs, rpm: r, mode: 'paced' });
        out.requests += Math.round(r * stepSecs / 60);
      }
      out.seconds = steps * stepSecs;
      out.expect = { rule: 'staircase', steps: steps, rates: out.groups.map(function (g) { return g.rpm; }) };
      out.expectText = steps + ' steps of ' + stepSecs + ' s from ' + start + ' to ' + (start + (steps - 1) * step) +
        ' req/min. The verdict names the first step that was refused.';
    } else if (scn.kind === 'steady') {
      var srpm = Math.max(1, num(p.rpm, 600));
      var mins = Math.max(0.1, num(p.minutes, 5));
      var sus = Math.max(1, Math.round(num(p.users, 10)));
      out.groups.push({ name: key + ' — ' + srpm + ' req/min for ' + fmtSeconds(mins * 60), threads: sus, duration: Math.round(mins * 60), rpm: srpm, mode: 'paced', rampup: Math.max(1, Math.round(num(p.rampup, 1))) });
      out.requests = Math.round(srpm * mins);
      out.seconds = Math.round(mins * 60);
      out.expect = { rule: 'no-errors' };
      out.expectText = srpm + ' req/min held for ' + fmtSeconds(mins * 60) + ' by ' + sus + ' users: no errors other than rate limiting.';
    } else if (scn.kind === 'burst') {
      var bs = Math.max(1, Math.round(num(p.size, 50)));
      var bb = Math.max(1, Math.round(num(p.bursts, 3)));
      var bg = Math.max(0, num(p.gapSeconds, 30));
      out.groups.push({ name: key + ' — ' + bs + ' at once × ' + bb, threads: bs, loops: bb, mode: 'burst', gapSeconds: bg });
      out.requests = bs * bb;
      out.seconds = bb * (bg + 1);
      out.expect = { rule: 'no-errors' };
      out.expectText = bb + ' bursts of ' + bs + ' simultaneous requests: no errors other than rate limiting.';
    } else {
      return null;
    }
    return out;
  }

  /* How long to pause before a quota scenario so it starts in a fresh
     window. Calendar-type windows are aligned to a known instant, so the
     exact remaining time is computed at run time; the others are measured
     from the last request, so a full window is the safe wait. */
  function windowWaitExpr(q, graceSeconds) {
    // Whole seconds: this becomes the thread group's start-up delay, which
    // keeps the wait out of the group's own duration.
    var P = Math.round(q.windowSeconds);
    var G = Math.round(graceSeconds);
    var S = null;
    if (q.type === 'calendar' && q.startMs) S = Math.floor(q.startMs / 1000);
    else if (q.type === 'default' && /^(second|minute|hour|day)$/.test(q.unit)) S = 0;
    if (S === null) return String(P + G);
    // JEXL3 integer arithmetic on seconds; no commas (they would split the function arguments).
    return '${__jexl3(' + P + ' - ((${__time(/1000)} - ' + S + ') % ' + P + ') + ' + G + ')}';
  }

  function resetWaitText(q, grace) {
    if (q.type === 'calendar' && q.startMs) return 'until the next calendar boundary (+' + grace + ' s)';
    if (q.type === 'default' && /^(second|minute|hour|day)$/.test(q.unit)) return 'until the top of the next ' + q.unit + ' (+' + grace + ' s)';
    return 'a full window (' + fmtSeconds(q.windowSeconds) + ' + ' + grace + ' s)';
  }

  function fmtSeconds(s) {
    s = Math.round(s);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
    return Math.floor(s / 3600) + ' h' + (s % 3600 ? ' ' + Math.round((s % 3600) / 60) + ' min' : '');
  }

  /* ==================================================================
     4. Writing the .jmx
     ================================================================== */

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  /* A Java/BeanShell string literal. */
  function jstr(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
  }

  function base64(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    for (var j = 0; j < bytes.length; j += 3) {
      var n = (bytes[j] << 16) | ((bytes[j + 1] || 0) << 8) | (bytes[j + 2] || 0);
      out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (j + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (j + 2 < bytes.length ? A[n & 63] : '=');
    }
    return out;
  }

  function Jmx() { this.out = []; this.depth = 0; }
  Jmx.prototype.line = function (s) {
    var pad = '';
    for (var i = 0; i < this.depth; i++) pad += '  ';
    this.out.push(pad + s);
    return this;
  };
  Jmx.prototype.open = function (s) { this.line(s); this.depth++; return this; };
  Jmx.prototype.close = function (s) { this.depth--; return this.line(s); };
  Jmx.prototype.sp = function (n, v) { return this.line('<stringProp name="' + n + '">' + xmlEsc(v === undefined || v === null ? '' : v) + '</stringProp>'); };
  Jmx.prototype.bp = function (n, v) { return this.line('<boolProp name="' + n + '">' + (v ? 'true' : 'false') + '</boolProp>'); };
  Jmx.prototype.ip = function (n, v) { return this.line('<intProp name="' + n + '">' + v + '</intProp>'); };
  Jmx.prototype.lp = function (n, v) { return this.line('<longProp name="' + n + '">' + v + '</longProp>'); };
  Jmx.prototype.leaf = function () { return this.line('<hashTree/>'); };
  Jmx.prototype.text = function () { return this.out.join('\n') + '\n'; };

  function el(w, tag, gui, cls, name, enabled) {
    return w.open('<' + tag + ' guiclass="' + gui + '" testclass="' + cls + '" testname="' + xmlEsc(name) + '" enabled="' + (enabled === false ? 'false' : 'true') + '">');
  }

  function httpArgs(w, args, raw) {
    w.open('<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">');
    var list = raw !== null && raw !== undefined ? [{ name: '', value: raw }] : args;
    if (!list.length) {
      w.line('<collectionProp name="Arguments.arguments"/>');
    } else {
      w.open('<collectionProp name="Arguments.arguments">');
      list.forEach(function (a) {
        w.open('<elementProp name="' + xmlEsc(a.name || '') + '" elementType="HTTPArgument">');
        w.bp('HTTPArgument.always_encode', !!a.name);
        w.sp('Argument.value', a.value);
        w.sp('Argument.metadata', '=');
        w.bp('HTTPArgument.use_equals', true);
        if (a.name) w.sp('Argument.name', a.name);
        w.close('</elementProp>');
      });
      w.close('</collectionProp>');
    }
    w.close('</elementProp>');
  }

  function headerManager(w, headers, name) {
    if (!headers.length) return;
    el(w, 'HeaderManager', 'HeaderPanel', 'HeaderManager', name || 'HTTP Header Manager', true);
    w.open('<collectionProp name="HeaderManager.headers">');
    headers.forEach(function (h) {
      w.open('<elementProp name="' + xmlEsc(h.name) + '" elementType="Header">');
      w.sp('Header.name', h.name);
      w.sp('Header.value', h.value);
      w.close('</elementProp>');
    });
    w.close('</collectionProp>');
    w.close('</HeaderManager>');
    w.leaf();
  }

  function userVars(w, vars, name) {
    el(w, 'Arguments', 'ArgumentsPanel', 'Arguments', name || 'User Defined Variables', true);
    w.open('<collectionProp name="Arguments.arguments">');
    vars.forEach(function (v) {
      w.open('<elementProp name="' + xmlEsc(v.name) + '" elementType="Argument">');
      w.sp('Argument.name', v.name);
      w.sp('Argument.value', v.value);
      w.sp('Argument.metadata', '=');
      w.close('</elementProp>');
    });
    w.close('</collectionProp>');
    w.close('</Arguments>');
    w.leaf();
  }

  function formArgs(text) {
    var out = [];
    String(text).split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      try {
        out.push(eq === -1 ? { name: decodeURIComponent(pair), value: '' }
          : { name: decodeURIComponent(pair.slice(0, eq)), value: decodeURIComponent(pair.slice(eq + 1)) });
      } catch (e) { out.push({ name: pair, value: '' }); }
    });
    return out;
  }

  function loopController(w, loops) {
    w.open('<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">');
    w.bp('LoopController.continue_forever', false);
    w.sp('LoopController.loops', loops);
    w.close('</elementProp>');
  }

  function resolvedPath(req, basePath) {
    if (req.url) {
      var m = String(req.url).match(/^https?:\/\/[^/]+(\/[^?#]*)?/i);
      return m ? (m[1] || '/') : req.url;
    }
    var path = req.path.replace(/\{([^}]+)\}/g, function (match, name) {
      var hit = null;
      req.pathParams.forEach(function (p) { if (p.name === name) hit = p; });
      return hit ? encodeURIComponent(hit.value) : match;
    });
    return (basePath || '') + path;
  }

  function sampler(w, req, basePath, label, extraQuery, noKeepAlive) {
    el(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy', label, true);
    var path = resolvedPath(req, basePath);
    var headers = req.headers.slice();
    var raw = null;
    var args = req.query.concat(extraQuery || []);
    var multipart = false;
    if (req.body && req.body.text !== '') {
      if (/multipart/.test(req.body.contentType)) {
        multipart = true;
        args = args.concat(formArgs(asForm(req.body.text)));
      } else if (/x-www-form-urlencoded/.test(req.body.contentType)) {
        headers.push({ name: 'Content-Type', value: req.body.contentType });
        args = args.concat(formArgs(req.body.text));
      } else {
        headers.push({ name: 'Content-Type', value: req.body.contentType });
        raw = req.body.text;
        if (args.length) {
          path += '?' + args.map(function (q) { return encodeURIComponent(q.name) + '=' + encodeURIComponent(q.value); }).join('&');
          args = [];
        }
      }
    }
    if (raw !== null) w.bp('HTTPSampler.postBodyRaw', true);
    httpArgs(w, args, raw);
    var abs = req.url ? String(req.url).match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?/i) : null;
    w.sp('HTTPSampler.domain', abs ? abs[2] : '');
    w.sp('HTTPSampler.port', abs ? (abs[3] || '') : '');
    w.sp('HTTPSampler.protocol', abs ? abs[1].toLowerCase() : '');
    w.sp('HTTPSampler.contentEncoding', '');
    w.sp('HTTPSampler.path', path);
    w.sp('HTTPSampler.method', req.method);
    w.bp('HTTPSampler.follow_redirects', true);
    w.bp('HTTPSampler.auto_redirects', false);
    // A connection kept open across a long wait is often closed by the server
    // in the meantime; a slow probe does not need it.
    w.bp('HTTPSampler.use_keepalive', !noKeepAlive);
    w.bp('HTTPSampler.DO_MULTIPART_POST', multipart);
    w.sp('HTTPSampler.embedded_url_re', '');
    w.sp('HTTPSampler.connect_timeout', '');
    w.sp('HTTPSampler.response_timeout', '');
    if (req.summary) w.sp('TestPlan.comments', req.summary);
    w.close('</HTTPSamplerProxy>');
    if (headers.length) {
      w.open('<hashTree>');
      headerManager(w, headers, 'Headers for this request');
      w.close('</hashTree>');
    } else {
      w.leaf();
    }
  }

  function responseAssertion(w, passParts, limitParts) {
    var parts = passParts.concat(limitParts);
    el(w, 'ResponseAssertion', 'AssertionGui', 'ResponseAssertion', 'Pass on ' + parts.join(', ').replace(/\\d\\d/g, 'xx'), true);
    w.open('<collectionProp name="Asserion.test_strings">');
    w.sp('0', '^(' + parts.join('|') + ')$');
    w.close('</collectionProp>');
    w.sp('Assertion.custom_message', 'Neither a success nor a rate-limit answer');
    w.sp('Assertion.test_field', 'Assertion.response_code');
    w.bp('Assertion.assume_success', true);
    w.ip('Assertion.test_type', 1);
    w.close('</ResponseAssertion>');
    w.leaf();
  }

  function durationAssertion(w, ms) {
    el(w, 'DurationAssertion', 'DurationAssertionGui', 'DurationAssertion', 'Answer within ' + ms + ' ms', true);
    w.sp('DurationAssertion.duration', String(ms));
    w.close('</DurationAssertion>');
    w.leaf();
  }

  function beanShellPost(w, name, script) {
    el(w, 'BeanShellPostProcessor', 'TestBeanGUI', 'BeanShellPostProcessor', name, true);
    w.bp('resetInterpreter', false);
    w.sp('parameters', '');
    w.sp('filename', '');
    w.sp('script', script);
    w.close('</BeanShellPostProcessor>');
    w.leaf();
  }

  function beanShellSampler(w, name, script) {
    el(w, 'BeanShellSampler', 'BeanShellSamplerGui', 'BeanShellSampler', name, true);
    w.sp('BeanShellSampler.query', script);
    w.sp('BeanShellSampler.filename', '');
    w.sp('BeanShellSampler.parameters', '');
    w.bp('BeanShellSampler.resetInterpreter', false);
    w.close('</BeanShellSampler>');
    w.leaf();
  }

  function pause(w, name, durationExpr) {
    el(w, 'TestAction', 'TestActionGui', 'TestAction', name, true);
    w.ip('ActionProcessor.action', 1);
    w.ip('ActionProcessor.target', 0);
    w.sp('ActionProcessor.duration', durationExpr);
    w.close('</TestAction>');
    w.leaf();
  }

  function listener(w, gui, name, enabled) {
    el(w, 'ResultCollector', gui, 'ResultCollector', name, enabled);
    w.bp('ResultCollector.error_logging', false);
    w.open('<objProp>');
    w.line('<name>saveConfig</name>');
    w.open('<value class="SampleSaveConfiguration">');
    [['time', 1], ['latency', 1], ['timestamp', 1], ['success', 1], ['label', 1], ['code', 1],
     ['message', 1], ['threadName', 1], ['dataType', 1], ['encoding', 0], ['assertions', 1],
     ['subresults', 1], ['responseData', 0], ['samplerData', 0], ['xml', 0], ['fieldNames', 1],
     ['responseHeaders', 0], ['requestHeaders', 0], ['responseDataOnError', 0],
     ['saveAssertionResultsFailureMessage', 1], ['bytes', 1], ['sentBytes', 1], ['url', 1],
     ['threadCounts', 1], ['idleTime', 1], ['connectTime', 1]].forEach(function (f) {
      w.line('<' + f[0] + '>' + (f[1] ? 'true' : 'false') + '</' + f[0] + '>');
    });
    w.line('<assertionsResultsToSave>0</assertionsResultsToSave>');
    w.close('</value>');
    w.close('</objProp>');
    w.sp('filename', '');
    w.close('</ResultCollector>');
    w.leaf();
  }

  /* ----- the token ----- */

  function tokenUrl(login, target) {
    var url = login.url;
    return /^https?:\/\//i.test(url) ? url : (target.basePath || '') + (url.charAt(0) === '/' ? url : '/' + url);
  }

  /* The token call: extractor for the token (and expires_in when present)
     and the post-processor that hands both to every thread as properties.
     `slot` is '' for the main identity and '2' for the second one. */
  function tokenRequest(w, login, target, slot, ttlMinutes) {
    var url = tokenUrl(login, target);
    var prop = 'sduiToken' + slot;
    el(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy', 'TOKEN' + (slot ? ' #2' : '') + ' ' + login.method + ' ' + url, true);
    var form = /x-www-form-urlencoded/.test(login.contentType);
    var body = login.body || '';
    if (!form) w.bp('HTTPSampler.postBodyRaw', true);
    httpArgs(w, form ? formArgs(body) : [], form ? null : body);
    var abs = /^https?:\/\//i.test(url) ? url.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?([^#]*)/i) : null;
    w.sp('HTTPSampler.domain', abs ? abs[2] : '');
    w.sp('HTTPSampler.port', abs ? (abs[3] || '') : '');
    w.sp('HTTPSampler.protocol', abs ? abs[1].toLowerCase() : '');
    w.sp('HTTPSampler.contentEncoding', '');
    w.sp('HTTPSampler.path', abs ? (abs[4] || '/') : url);
    w.sp('HTTPSampler.method', login.method);
    w.bp('HTTPSampler.follow_redirects', true);
    w.bp('HTTPSampler.auto_redirects', false);
    w.bp('HTTPSampler.use_keepalive', true);
    w.bp('HTTPSampler.DO_MULTIPART_POST', false);
    w.sp('HTTPSampler.embedded_url_re', '');
    w.close('</HTTPSamplerProxy>');
    w.open('<hashTree>');
    var headers = [{ name: 'Accept', value: 'application/json' }];
    if (body) headers.push({ name: 'Content-Type', value: login.contentType });
    if (login.basic && login.basic.on) {
      headers.push({ name: 'Authorization', value: 'Basic ' + base64((login.basic.id || '') + ':' + (login.basic.secret || '')) });
    }
    (login.headers || []).forEach(function (h) { if (h.name) headers.push(h); });
    headerManager(w, headers, 'Token request headers');

    el(w, 'JSONPostProcessor', 'JSONPostProcessorGui', 'JSONPostProcessor', 'Read the token (and expires_in) out of the response', true);
    w.sp('JSONPostProcessor.referenceNames', prop + ';' + prop + 'Expires');
    w.sp('JSONPostProcessor.jsonPathExprs', (login.jsonPath || '$.access_token') + ';' + (login.expiresPath || '$.expires_in'));
    w.sp('JSONPostProcessor.match_numbers', '1;1');
    w.sp('JSONPostProcessor.defaultValues', 'TOKEN_NOT_FOUND;NONE');
    w.close('</JSONPostProcessor>');
    w.leaf();

    beanShellPost(w, 'Share the token with every thread',
      '// A variable belongs to one thread; a property is what all of them read.\n' +
      'String t = vars.get(' + jstr(prop) + ');\n' +
      'props.put(' + jstr(prop) + ', t);\n' +
      'props.put(' + jstr(prop + 'At') + ', String.valueOf(System.currentTimeMillis()));\n' +
      'String exp = vars.get(' + jstr(prop + 'Expires') + ');\n' +
      'long ttl = ' + Math.round(Math.max(1, ttlMinutes || 30) * 60000) + 'L;\n' +
      'if (exp != null && !exp.equals("NONE") && exp.trim().length() > 0) { try { ttl = Long.parseLong(exp.trim()) * 900L; } catch (Exception e) {} }\n' +
      'props.put(' + jstr(prop + 'Ttl') + ', String.valueOf(ttl));\n' +
      'if (t == null || t.equals("TOKEN_NOT_FOUND")) {\n' +
      '  log.error("TOKEN' + (slot ? ' #2' : '') + ': no token in the response — check the JSON path and the credentials. Status " + prev.getResponseCode());\n' +
      '  System.out.println("TOKEN' + (slot ? ' #2' : '') + ' FAILED: " + prev.getResponseCode() + " " + prev.getResponseDataAsString());\n' +
      '} else {\n' +
      '  log.info("TOKEN' + (slot ? ' #2' : '') + ' acquired, valid for about " + (ttl / 60000) + " min");\n' +
      '  System.out.println("TOKEN' + (slot ? ' #2' : '') + ' acquired (" + t.length() + " chars), valid for about " + (ttl / 60000) + " min");\n' +
      '}');
    w.close('</hashTree>');
  }

  function setupTokenGroup(w, cfg, target, withSecond) {
    el(w, 'SetupThreadGroup', 'SetupThreadGroupGui', 'SetupThreadGroup', 'setUp — fetch the token once, before any load', true);
    w.sp('ThreadGroup.on_sample_error', 'stoptest');
    loopController(w, '1');
    w.sp('ThreadGroup.num_threads', '1');
    w.sp('ThreadGroup.ramp_time', '1');
    w.bp('ThreadGroup.scheduler', false);
    w.sp('ThreadGroup.duration', '');
    w.sp('ThreadGroup.delay', '');
    w.close('</SetupThreadGroup>');
    w.open('<hashTree>');
    tokenRequest(w, cfg.auth.login, target, '', cfg.auth.ttlMinutes);
    if (withSecond) tokenRequest(w, cfg.auth.login2, target, '2', cfg.auth.ttlMinutes);
    w.close('</hashTree>');
  }

  function refreshBlock(w, cfg, target) {
    el(w, 'CriticalSectionController', 'CriticalSectionControllerGui', 'CriticalSectionController', 'Only one thread refreshes the token', true);
    w.sp('CriticalSectionController.lockName', 'sdui_token');
    w.close('</CriticalSectionController>');
    w.open('<hashTree>');
    el(w, 'IfController', 'IfControllerPanel', 'IfController', 'Token expired?', true);
    w.sp('IfController.condition',
      '${__jexl3(props.get("sduiTokenAt") == null || ${__time()} - props.get("sduiTokenAt") > ${__P(sduiTokenTtl,' + Math.round(cfg.auth.ttlMinutes * 60000) + ')})}');
    w.bp('IfController.evaluateAll', false);
    w.bp('IfController.useExpression', true);
    w.close('</IfController>');
    w.open('<hashTree>');
    tokenRequest(w, cfg.auth.login, target, '', cfg.auth.ttlMinutes);
    w.close('</hashTree>');
    w.close('</hashTree>');
  }

  /* ----- counting ----- */

  /* Every sample of a scenario is sorted into pass / limited / other and
     counted in AtomicLongs kept in JMeter properties (shared by all threads,
     surviving the thread group). For Apigee, the fault body says which
     policy answered. */
  function classifierScript(key, passParts, limitParts, signatures) {
    return [
      'import java.util.concurrent.atomic.AtomicLong;',
      'String label = prev.getSampleLabel();',
      'if (label != null && !label.startsWith("TOKEN")) {',
      '  String base = ' + jstr('sdui.' + key + '.') + ';',
      '  String code = String.valueOf(prev.getResponseCode());',
      '  String cls = code.matches(' + jstr('^(' + passParts.join('|') + ')$') + ') ? "pass"',
      '    : (code.matches(' + jstr('^(' + limitParts.join('|') + ')$') + ') ? "limited" : "other");',
      '  props.putIfAbsent(base + "total", new AtomicLong(0));',
      '  props.putIfAbsent(base + cls, new AtomicLong(0));',
      '  long n = ((AtomicLong) props.get(base + "total")).incrementAndGet();',
      '  ((AtomicLong) props.get(base + cls)).incrementAndGet();',
      '  props.putIfAbsent(base + "firstAt", String.valueOf(prev.getStartTime()));',
      '  props.put(base + "lastAt", String.valueOf(prev.getEndTime()));',
      '  if (cls.equals("pass")) props.put(base + "lastPass", String.valueOf(n));',
      '  if (cls.equals("limited")) {',
      '    props.putIfAbsent(base + "firstLimited", String.valueOf(n));',
      signatures.map(function (sig) {
        return '    if (prev.getResponseDataAsString().indexOf(' + jstr(sig) + ') >= 0) { props.putIfAbsent(base + "sig." + ' + jstr(sig) + ', new AtomicLong(0)); ((AtomicLong) props.get(base + "sig." + ' + jstr(sig) + ')).incrementAndGet(); }';
      }).join('\n'),
      '  } else if (cls.equals("other")) {',
      '    props.putIfAbsent(base + "firstOther", code + " " + prev.getResponseMessage());',
      '  }',
      '}'
    ].join('\n');
  }

  /* The verdict for one scenario: reads the counters and decides. */
  function verdictScript(scn, limits) {
    var e = scn.expect;
    var keys = scn.kind === 'staircase' ? scn.groups.map(function (g) { return scn.key + '.' + g.step; }) : [scn.key];
    var lines = [
      'import java.util.concurrent.atomic.AtomicLong;',
      'long g(String k) { Object o = props.get(k); return o == null ? 0L : ((AtomicLong) o).get(); }',
      'String s(String k) { Object o = props.get(k); return o == null ? "-" : String.valueOf(o); }',
      'StringBuilder d = new StringBuilder();',
      'boolean ok = true;',
      'String summary = "";'
    ];
    if (scn.kind === 'staircase') {
      lines.push('int firstStep = 0; String firstRate = ""; long totalAll = 0;');
      lines.push('String[] rates = ' + '{' + scn.groups.map(function (g) { return jstr(String(g.rpm)); }).join(', ') + '};');
      keys.forEach(function (k, i) {
        lines.push('{ String b = ' + jstr('sdui.' + k + '.') + '; long p = g(b + "pass"), l = g(b + "limited"), o = g(b + "other"), t = g(b + "total"); totalAll += t;');
        lines.push('  d.append("step ' + (i + 1) + ' @ " + rates[' + i + '] + " req/min: " + t + " sent, " + p + " pass, " + l + " limited, " + o + " other\\n");');
        lines.push('  if (l > 0 && firstStep == 0) { firstStep = ' + (i + 1) + '; firstRate = rates[' + i + ']; } }');
      });
      lines.push('if (totalAll == 0) { ok = false; summary = "nothing was sent"; }');
      lines.push('else if (firstStep == 0) summary = "no step was refused — the limit is above " + rates[rates.length - 1] + " req/min";');
      lines.push('else summary = "first refusals at step " + firstStep + " (" + firstRate + " req/min)";');
    } else {
      lines.push('String b = ' + jstr('sdui.' + scn.key + '.') + ';');
      lines.push('long pass = g(b + "pass"), lim = g(b + "limited"), other = g(b + "other"), total = g(b + "total");');
      lines.push('d.append(total + " sent: " + pass + " pass, " + lim + " limited, " + other + " other\\n");');
      lines.push('if (lim > 0) d.append("first limited answer was request #" + s(b + "firstLimited") + ", last pass was #" + s(b + "lastPass") + "\\n");');
      lines.push('if (other > 0) d.append("first unexpected answer: " + s(b + "firstOther") + "\\n");');
      if (e.signature) {
        lines.push('long sig = g(b + "sig." + ' + jstr(e.signature) + ');');
        lines.push('if (lim > 0) d.append(sig + " of the limited answers carry " + ' + jstr(e.signature) + ' + "\\n");');
      }
      (limits.policies || []).forEach(function (p) {
        if (p.faultSignature && p.faultSignature !== e.signature) {
          lines.push('{ long x = g(b + "sig." + ' + jstr(p.faultSignature) + '); if (x > 0) d.append(x + " limited answers came from " + ' + jstr(p.policy.displayName + ' (' + p.faultSignature + ')') + ' + " instead\\n"); }');
        }
      });
      lines.push('if (total == 0) { ok = false; summary = "nothing was sent"; }');
      var cond, text;
      if (e.rule === 'edge') {
        cond = 'pass >= ' + e.passMin + ' && pass <= ' + e.passMax + ' && lim >= ' + e.limitedMin + ' && other == 0';
        text = '"expected " + ' + jstr(e.passMin === e.passMax ? String(e.passMin) : e.passMin + '-' + e.passMax) + ' + " to pass and at least ' + e.limitedMin + ' to be limited; got " + pass + " pass / " + lim + " limited / " + other + " other"';
      } else if (e.rule === 'all-pass') {
        cond = 'pass == total';
        text = '"expected every request to pass; got " + pass + " of " + total + " (" + lim + " limited, " + other + " other)"';
      } else if (e.rule === 'none-limited') {
        cond = 'lim == 0 && other == 0';
        text = '"expected no refusals; got " + lim + " limited and " + other + " other out of " + total';
      } else if (e.rule === 'over') {
        cond = 'pass <= ' + e.passMax + ' && lim >= ' + e.limitedMin + ' && other == 0';
        text = '"expected at most ' + e.passMax + ' to pass and the rest limited; got " + pass + " pass / " + lim + " limited / " + other + " other"';
      } else if (e.rule === 'burst') {
        cond = 'pass >= 1 && pass <= ' + (e.passMaxPerBurst * e.bursts) + ' && lim >= 1 && other == 0';
        text = '"expected 1-' + (e.passMaxPerBurst * e.bursts) + ' to pass over ' + e.bursts + ' bursts and the rest limited; got " + pass + " pass / " + lim + " limited / " + other + " other"';
      } else if (e.rule === 'mostly-pass') {
        cond = 'lim * 100 <= total * ' + e.tolerancePct + ' && other == 0';
        text = '"expected at most ' + e.tolerancePct + '% refused; got " + lim + " limited out of " + total + " (" + other + " other)"';
      } else if (e.rule === 'ratio') {
        cond = 'lim * 100 >= total * ' + e.limitedMinPct + ' && lim * 100 <= total * ' + e.limitedMaxPct + ' && other == 0';
        text = '"expected ' + e.limitedMinPct + '-' + e.limitedMaxPct + '% refused; got " + lim + " of " + total + " (" + other + " other)"';
      } else {
        cond = 'other == 0';
        text = '"expected no errors other than rate limiting; got " + other + " other, " + lim + " limited, " + pass + " pass of " + total';
      }
      if (e.signature) {
        cond = '(' + cond + ') && (lim == 0 || sig > 0)';
      }
      lines.push('if (total > 0) { ok = ' + cond + '; summary = ' + text + '; }');
      if (e.signature) {
        lines.push('if (total > 0 && lim > 0 && sig == 0) summary = summary + " - none of the limited answers mention ' + e.signature + ', so another limiter answered";');
      }
    }
    lines.push('String line = "VERDICT " + ' + jstr(scn.key + ' ') + ' + (ok ? "PASS" : "FAIL") + " - " + ' + jstr(scn.title.replace(/\s+—\s+/g, ' - ')) + ' + ": " + summary;');
    lines.push('System.out.println(line);');
    lines.push('System.out.println(d.toString());');
    lines.push('log.info(line);');
    // The BeanShell sampler copies these three script variables into the result.
    lines.push('IsSuccess = ok;');
    lines.push('ResponseCode = ok ? "PASS" : "FAIL";');
    lines.push('ResponseMessage = summary;');
    lines.push('return line + "\\n" + d.toString();');
    return lines.join('\n');
  }

  /* ----- groups ----- */

  function threadGroupHead(w, tag, gui, name, spec) {
    el(w, tag, gui, tag, name, true);
    w.sp('ThreadGroup.on_sample_error', 'continue');
    loopController(w, spec.loops);
    w.sp('ThreadGroup.num_threads', spec.threads);
    w.sp('ThreadGroup.ramp_time', spec.ramp);
    w.bp('ThreadGroup.scheduler', spec.scheduler);
    w.sp('ThreadGroup.duration', spec.duration);
    w.sp('ThreadGroup.delay', spec.delay);
    w.bp('ThreadGroup.same_user_on_next_iteration', true);
    w.close('</' + tag + '>');
  }

  function scenarioGroup(w, ctx, scn, g) {
    var cfg = ctx.cfg;
    // A wait for a fresh window is the group's start-up delay, so a timed
    // group still gets its full duration after the window turns over.
    // The scheduler refuses a zero duration, so a loop-counted group that
    // waits gets a generous ceiling: it still ends when its loops are done.
    var spec = {
      threads: String(g.threads),
      loops: g.duration ? '-1' : String(g.loops),
      ramp: String(g.rampup || 1),
      scheduler: !!g.duration || !!g.wait,
      duration: g.duration ? String(g.duration) : (g.wait ? '3600' : ''),
      delay: g.wait ? g.wait.expr : ''
    };
    threadGroupHead(w, 'ThreadGroup', 'ThreadGroupGui', g.name, spec);
    w.open('<hashTree>');

    // Headers for this scenario: Accept, the credential, the identifier.
    var headers = [{ name: 'Accept', value: 'application/json' }];
    var ident = ctx.limits.identifier;
    // "The other caller" is a second credential only when the counter is per
    // credential; otherwise it is the same credential with another identifier.
    var otherCred = g.identity === 'other' && ident.kind === 'credential';
    var auth = authHeader(cfg, otherCred);
    if (auth) headers.push(auth);
    var extraQuery = [];
    var idc = cfg.limiter.identifier || {};
    var identValue = g.identity === 'other' ? idc.other : idc.value;
    if (ident.kind === 'header' && ident.name && identValue) headers.push({ name: ident.name, value: identValue });
    if (ident.kind === 'query' && ident.name && identValue) extraQuery.push({ name: ident.name, value: identValue });
    if (cfg.auth.kind === 'static' && ctx.authOf.queryName) {
      extraQuery.push({ name: ctx.authOf.queryName, value: otherCred ? '${__P(token2,' + (cfg.auth.value2 || 'SECOND_KEY') + ')}' : '${__P(token,' + (cfg.auth.value || 'PASTE_YOUR_TOKEN') + ')}' });
    }
    headerManager(w, headers, 'Headers for ' + scn.key);

    if (g.mode === 'burst') {
      el(w, 'SyncTimer', 'TestBeanGUI', 'SyncTimer', 'Release all ' + g.threads + ' requests together', true);
      w.ip('groupSize', g.threads);
      w.lp('timeoutInMs', 60000);
      w.close('</SyncTimer>');
      w.leaf();
    } else if (g.mode === 'paced') {
      el(w, 'ConstantThroughputTimer', 'TestBeanGUI', 'ConstantThroughputTimer', 'Hold ' + g.rpm + ' requests per minute', true);
      // 4 = all active threads in this group, shared schedule: evenly spaced requests.
      w.ip('calcMode', 4);
      w.sp('throughput', String(g.rpm));
      w.close('</ConstantThroughputTimer>');
      w.leaf();
    }
    if (g.mode !== 'burst' && cfg.think && (cfg.think.delay || cfg.think.range)) {
      el(w, 'UniformRandomTimer', 'UniformRandomTimerGui', 'UniformRandomTimer', 'Think time ' + cfg.think.delay + '–' + (cfg.think.delay + cfg.think.range) + ' ms', true);
      w.sp('ConstantTimer.delay', String(cfg.think.delay));
      w.sp('RandomTimer.range', String(cfg.think.range));
      w.close('</UniformRandomTimer>');
      w.leaf();
    }

    responseAssertion(w, ctx.passParts, ctx.limits.limitCodes);
    if (cfg.checks.maxMs) durationAssertion(w, cfg.checks.maxMs);
    var countKey = g.step ? scn.key + '.' + g.step : scn.key;
    beanShellPost(w, 'Count pass / limited / other for ' + countKey,
      classifierScript(countKey, ctx.passParts, ctx.limits.limitCodes, ctx.signatures));
    if (cfg.checks.rateHeader) {
      el(w, 'RegexExtractor', 'RegexExtractorGui', 'RegexExtractor', 'Read ' + cfg.checks.rateHeader + ' from the response headers', true);
      w.sp('RegexExtractor.useHeaders', 'true');
      w.sp('RegexExtractor.refname', 'rateHeader');
      w.sp('RegexExtractor.regex', '(?i)' + cfg.checks.rateHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(\\S+)');
      w.sp('RegexExtractor.template', '$1$');
      w.sp('RegexExtractor.default', '');
      w.sp('RegexExtractor.match_number', '1');
      w.close('</RegexExtractor>');
      w.leaf();
    }

    if (cfg.auth.kind === 'login' && g.identity !== 'other') {
      if (cfg.auth.refresh === 'expiry') refreshBlock(w, cfg, ctx.target);
      else if (cfg.auth.refresh === 'iteration') tokenRequest(w, cfg.auth.login, ctx.target, '', cfg.auth.ttlMinutes);
    }

    var active = ctx.active;
    var percents = weightsOf(active);
    var slow = !!g.wait || (g.rpm && g.rpm <= 60);
    active.forEach(function (req, i) {
      var label = '[' + countKey + '] ' + req.label;
      if (cfg.mix === 'weighted' && active.length > 1) {
        el(w, 'ThroughputController', 'ThroughputControllerGui', 'ThroughputController', percents[i] + '% — ' + req.label, true);
        w.ip('ThroughputController.style', 1);
        w.bp('ThroughputController.perThread', false);
        w.ip('ThroughputController.maxThroughput', 1);
        w.sp('ThroughputController.percentThroughput', String(percents[i]));
        w.close('</ThroughputController>');
        w.open('<hashTree>');
        sampler(w, req, ctx.target.basePath, label, extraQuery, slow);
        w.close('</hashTree>');
      } else {
        sampler(w, req, ctx.target.basePath, label, extraQuery, slow);
      }
    });

    if (g.mode === 'burst' && g.loops > 1 && g.gapSeconds > 0) {
      pause(w, 'Wait ' + g.gapSeconds + ' s before the next burst', String(Math.round(g.gapSeconds * 1000)));
    }
    w.close('</hashTree>');
  }

  function weightsOf(active) {
    var total = 0;
    active.forEach(function (r) { total += Math.max(0, r.weight || 0); });
    if (!total) return active.map(function () { return Math.round(1000 / active.length) / 10; });
    return active.map(function (r) { return Math.round((Math.max(0, r.weight || 0) / total) * 1000) / 10; });
  }

  function authHeader(cfg, other) {
    var a = cfg.auth;
    if (a.kind === 'none') return null;
    if (a.kind === 'csv') return { name: a.header, value: a.prefix + '${' + a.csv.variable + '}' };
    if (a.kind === 'static') {
      if (cfg.authQueryName) return null;
      return other
        ? { name: a.header, value: a.prefix + '${__P(token2,' + (a.value2 || 'SECOND_KEY') + ')}' }
        : { name: a.header, value: a.prefix + '${__P(token,' + (a.value || 'PASTE_YOUR_TOKEN') + ')}' };
    }
    return { name: a.header, value: a.prefix + '${__P(sduiToken' + (other ? '2' : '') + ',NO_TOKEN)}' };
  }

  /* ==================================================================
     5. The plan
     ================================================================== */

  function activeRequests(cfg) { return (cfg.requests || []).filter(function (r) { return r.on; }); }

  /* Everything the review step shows: scenarios with their numbers, total
     time, warnings — without writing XML. */
  function estimate(cfg) {
    var limits = resolveLimits(cfg);
    var scns = [];
    var seconds = 0;
    var requests = 0;
    var problems = [];
    (cfg.scenarios || []).forEach(function (s) {
      if (!s.on) return;
      var p = planScenario(s, limits, scns.length, cfg.checks);
      if (!p) return;
      scns.push(p);
      seconds += p.seconds;
      requests += p.requests;
    });
    if (cfg.auth.kind === 'login') seconds += 2;
    var target = parseBase(cfg.target && cfg.target.url);
    if (!target) problems.push('Enter the base URL of the API under test.');
    if (!activeRequests(cfg).length) problems.push('Tick at least one request.');
    if (!scns.length) problems.push('Turn on at least one scenario.');
    if (cfg.auth.kind === 'login' && !(cfg.auth.login && cfg.auth.login.url)) problems.push('The token endpoint needs a URL.');
    if (cfg.auth.kind === 'csv' && !(cfg.auth.csv && cfg.auth.csv.file)) problems.push('Name the CSV file the credentials come from.');
    if (cfg.limiter.kind === 'apigee' && !limits.quota && !limits.spike) problems.push('Paste a Quota or SpikeArrest policy, and fill in the values it reads at run time.');
    var needsOther = scns.some(function (s) { return s.kind === 'quota-isolation'; });
    if (needsOther) {
      var ik = limits.identifier.kind;
      if ((ik === 'header' || ik === 'query') && !(cfg.limiter.identifier && cfg.limiter.identifier.other)) problems.push('The "another caller" scenario needs a second value for ' + limits.identifier.name + '.');
      if (ik === 'credential' && cfg.auth.kind === 'static' && !cfg.auth.value2) problems.push('The "another caller" scenario needs a second token / key.');
      if (ik === 'credential' && cfg.auth.kind === 'login') {
        var l2 = cfg.auth.login2 || {};
        var has2 = l2.basic && l2.basic.on ? !!l2.basic.id : !!l2.body;
        if (!has2) problems.push('The "another caller" scenario needs the credentials of a second app.');
      }
      if (ik === 'credential' && (cfg.auth.kind === 'csv' || cfg.auth.kind === 'none')) problems.push('The "another caller" scenario needs a single credential plus a second one — not a CSV, and not "none".');
    }
    return { limits: limits, scenarios: scns, seconds: seconds, requests: requests, problems: problems, warnings: limits.warnings };
  }

  function buildPlan(doc, cfg) {
    var est = estimate(cfg);
    if (est.problems.length) throw new Error(est.problems[0]);
    var limits = est.limits;
    var target = parseBase(cfg.target.url);
    var ctx = {
      cfg: cfg, limits: limits, target: target,
      active: activeRequests(cfg),
      passParts: passRegexParts(cfg.checks),
      signatures: limits.policies.map(function (p) { return p.faultSignature; }).filter(Boolean)
        .filter(function (s, i, a) { return a.indexOf(s) === i; }),
      authOf: authOf(doc)
    };
    cfg.authQueryName = cfg.auth.kind === 'static' && ctx.authOf.apiKeyIn === 'query' ? ctx.authOf.queryName : null;
    if (cfg.authQueryName) ctx.authOf.queryName = cfg.authQueryName; else ctx.authOf.queryName = null;

    var file = slug(doc) + '-' + (limits.kind === 'apigee' ? 'apigee' : limits.kind === 'known' ? 'quota' : limits.kind === 'unknown' ? 'find-limit' : 'load') + '.jmx';
    var needsSecondToken = cfg.auth.kind === 'login' && est.scenarios.some(function (s) { return s.kind === 'quota-isolation'; }) && limits.identifier.kind === 'credential';

    var knobs = ['-Jhost=' + target.host + ' -Jport=' + target.port + ' -Jprotocol=' + target.protocol];
    if (cfg.auth.kind === 'static') knobs.push('-Jtoken=…' + (cfg.auth.value2 ? ' -Jtoken2=…' : ''));
    if (cfg.checks.rateHeader) knobs.push('-Jsample_variables=rateHeader   (writes the ' + cfg.checks.rateHeader + ' header into the .jtl)');

    var comments = [planTitle(doc, limits), ''];
    if (limits.policies.length && root.SduiApigee) {
      limits.policies.forEach(function (p) { comments.push(root.SduiApigee.describe(p)); });
      comments.push('');
    } else if (limits.quota) {
      comments.push('Documented limit: ' + limits.quota.requestsAllowed + ' requests per ' + fmtSeconds(limits.quota.windowSeconds) + ' for ' + limits.quota.identifier.label + '.');
      comments.push('');
    }
    comments.push('Scenarios, run one after another:');
    est.scenarios.forEach(function (s) { comments.push('  ' + s.key + '  ' + s.title + ' — ' + s.expectText); });
    comments.push('', 'About ' + est.requests + ' requests, roughly ' + fmtSeconds(est.seconds) + ' in total.', '');
    comments.push(describeAuth(cfg, needsSecondToken));
    comments.push('', 'Run it:', '  jmeter -n -t ' + file + ' -l results.jtl -e -o report', '', 'The verdicts are printed on the console and written to results.jtl:', '  grep VERDICT results.jtl', '', 'Overrides that need no editing:');
    knobs.forEach(function (k) { comments.push('  ' + k); });
    comments.push('', 'A response with status ' + limits.limitCodes.join('/').replace(/\\d\\d/g, 'xx') + ' counts as "limited", 2xx' + (cfg.checks.allow3xx ? '/3xx' : '') + ' as "pass"; anything else is an error.');

    var w = new Jmx();
    w.line('<?xml version="1.0" encoding="UTF-8"?>');
    w.open('<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.4.3">');
    w.open('<hashTree>');

    el(w, 'TestPlan', 'TestPlanGui', 'TestPlan', planTitle(doc, limits), true);
    w.sp('TestPlan.comments', comments.join('\n'));
    w.bp('TestPlan.functional_mode', false);
    w.bp('TestPlan.tearDown_on_shutdown', true);
    // One scenario at a time: the verdicts only make sense when they do not overlap.
    w.bp('TestPlan.serialize_threadgroups', true);
    w.open('<elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">');
    w.line('<collectionProp name="Arguments.arguments"/>');
    w.close('</elementProp>');
    w.sp('TestPlan.user_define_classpath', '');
    w.close('</TestPlan>');
    w.open('<hashTree>');

    el(w, 'ConfigTestElement', 'HttpDefaultsGui', 'ConfigTestElement', 'Target — ' + target.host, true);
    httpArgs(w, [], null);
    w.sp('HTTPSampler.domain', '${__P(host,' + target.host + ')}');
    w.sp('HTTPSampler.port', '${__P(port,' + target.port + ')}');
    w.sp('HTTPSampler.protocol', '${__P(protocol,' + target.protocol + ')}');
    w.sp('HTTPSampler.contentEncoding', 'UTF-8');
    w.sp('HTTPSampler.path', '');
    w.sp('HTTPSampler.implementation', 'HttpClient4');
    w.sp('HTTPSampler.connect_timeout', String(cfg.checks.connectMs || 10000));
    w.sp('HTTPSampler.response_timeout', String(cfg.checks.timeoutMs || 30000));
    w.close('</ConfigTestElement>');
    w.leaf();

    if (cfg.cookies) {
      el(w, 'CookieManager', 'CookiePanel', 'CookieManager', 'HTTP Cookie Manager', true);
      w.line('<collectionProp name="CookieManager.cookies"/>');
      w.bp('CookieManager.clearEachIteration', false);
      w.bp('CookieManager.controlledByThreadGroup', false);
      w.sp('CookieManager.policy', 'standard');
      w.close('</CookieManager>');
      w.leaf();
    }

    if (cfg.auth.kind === 'csv') {
      el(w, 'CSVDataSet', 'TestBeanGUI', 'CSVDataSet', 'Credentials from ' + cfg.auth.csv.file, true);
      w.sp('filename', cfg.auth.csv.file);
      w.sp('fileEncoding', 'UTF-8');
      w.sp('variableNames', cfg.auth.csv.variable);
      w.bp('ignoreFirstLine', false);
      w.sp('delimiter', ',');
      w.bp('quotedData', false);
      w.bp('recycle', true);
      w.bp('stopThread', false);
      w.sp('shareMode', 'shareMode.all');
      w.close('</CSVDataSet>');
      w.leaf();
    }

    if (cfg.auth.kind === 'login' && cfg.auth.refresh !== 'iteration') setupTokenGroup(w, cfg, target, needsSecondToken);

    est.scenarios.forEach(function (scn) {
      scn.groups.forEach(function (g) { scenarioGroup(w, ctx, scn, g); });
    });

    threadGroupHead(w, 'PostThreadGroup', 'PostThreadGroupGui', 'tearDown — verdicts', {
      threads: '1', loops: '1', ramp: '1', scheduler: false, duration: '', delay: ''
    });
    w.open('<hashTree>');
    est.scenarios.forEach(function (scn) {
      beanShellSampler(w, 'VERDICT ' + scn.key + ' — ' + scn.title, verdictScript(scn, limits));
    });
    w.close('</hashTree>');

    listener(w, 'SummaryReport', 'Summary Report', true);
    listener(w, 'StatVisualizer', 'Aggregate Report', true);
    listener(w, 'ViewResultsFullVisualizer', 'View Results Tree', false);

    w.close('</hashTree>');
    w.close('</hashTree>');
    w.close('</jmeterTestPlan>');

    return {
      xml: w.text(),
      file: file,
      title: planTitle(doc, limits),
      estimate: est,
      commands: [
        'jmeter -n -t ' + file + ' -l results.jtl -e -o report',
        'grep VERDICT results.jtl'
      ],
      knobs: knobs
    };
  }

  function planTitle(doc, limits) {
    var name = (doc && doc.info && doc.info.title) || 'API';
    if (limits.kind === 'apigee') return name + ' — Apigee ' + [limits.quota && 'quota', limits.spike && 'spike arrest'].filter(Boolean).join(' + ') + ' test';
    if (limits.kind === 'known') return name + ' — rate limit test';
    if (limits.kind === 'unknown') return name + ' — find the rate limit';
    return name + ' — load test';
  }

  function describeAuth(cfg, second) {
    var a = cfg.auth;
    if (a.kind === 'none') return 'No credential is sent.';
    if (a.kind === 'csv') return 'Every iteration takes the next credential from ' + a.csv.file + ' (column ' + a.csv.variable + '); put the file next to the .jmx.';
    if (a.kind === 'static') return 'Each request carries the ' + a.header + ' header you supplied (override with -Jtoken).';
    var when = a.refresh === 'iteration' ? 'before every iteration'
      : a.refresh === 'expiry' ? 'once before the load and again when it is older than its lifetime (expires_in when the endpoint returns one, otherwise ' + a.ttlMinutes + ' min)'
        : 'once, in a setUp thread group, before any load';
    return 'A token is fetched from ' + a.login.method + ' ' + a.login.url + ' ' + when + ' and sent in the ' + a.header + ' header.' +
      (second ? ' A second token is fetched for the other app.' : '');
  }

  /* Default login settings for the token endpoint — from the OAuth 2 flow in
     the document, a token-looking operation, or a blank client-credentials
     call. */
  function loginDefaults(doc, authInfo, entry) {
    if (authInfo && authInfo.oauth) {
      var o = authInfo.oauth;
      var body = 'grant_type=' + (o.flow === 'password' ? 'password&username=&password=' : 'client_credentials');
      if (o.scopes.length && o.flow === 'clientCredentials') body += '&scope=' + encodeURIComponent(o.scopes.join(' '));
      return {
        source: 'oauth', url: o.tokenUrl, method: 'POST',
        contentType: 'application/x-www-form-urlencoded', body: body,
        jsonPath: '$.access_token', expiresPath: '$.expires_in',
        basic: { on: true, id: '', secret: '' }, headers: []
      };
    }
    var rb = entry ? bodyFor(doc, entry.op.requestBody) : null;
    return {
      source: entry ? entry.id : 'custom',
      url: entry ? entry.path : '/oauth/token',
      method: entry ? entry.method.toUpperCase() : 'POST',
      contentType: (rb && rb.contentType) || 'application/json',
      body: (rb && rb.text) || '{\n  "client_id": "",\n  "client_secret": "",\n  "grant_type": "client_credentials"\n}',
      jsonPath: '$.access_token', expiresPath: '$.expires_in',
      basic: { on: false, id: '', secret: '' }, headers: []
    };
  }

  var api = {
    build: buildPlan,
    estimate: estimate,
    suggestScenarios: suggestScenarios,
    resolveLimits: resolveLimits,
    kindInfo: kindInfo,
    fmtSeconds: fmtSeconds,
    asForm: asForm,
    asJson: asJson,
    read: {
      operations: operations, servers: serverUrls, parseBase: parseBase, auth: authOf,
      guessLogin: guessLogin, guessTarget: guessTarget, request: requestFor,
      custom: customRequest, body: bodyFor, loginDefaults: loginDefaults
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SduiJMeter = api;
})(typeof window !== 'undefined' ? window : this);

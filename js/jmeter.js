/* Swagger Dark UI — JMeter test-plan wizard.
   "Export → JMeter test plan" does not guess what the test should be: it asks.
   Which limiter is under test (a spike arrest that caps bursts, or a quota
   that caps a sustained rate), which endpoint to hit, where the bearer token
   comes from, and how many requests over how long. The answers become an
   Apache JMeter 5.4.3 plan that runs as it is downloaded — no editing in the
   JMeter GUI required. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  var TOKEN_HINT = /token|login|signin|sign-in|oauth|authenticate|authorize|session|connect/;

  /* The document helpers are shared with the other exporters. */
  function isObj(v) { return SduiExport.util.isObj(v); }
  function deref(doc, n) { return SduiExport.util.deref(doc, n); }
  function exampleFor(doc, s) { return SduiExport.util.exampleFor(doc, s); }
  function slug(doc) { return SduiExport.util.slug(doc); }

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
          summary: op.summary || op.operationId || '',
          tokenish: TOKEN_HINT.test(path + ' ' + (op.operationId || '') + ' ' + (op.summary || ''))
        });
      });
    });
    return out;
  }

  /* The operation that most likely hands out a token, and the one most likely
     worth hammering — offered as the pre-selected answers. */
  function guessLogin(ops) {
    var posts = ops.filter(function (o) { return o.tokenish && o.method === 'post'; });
    return posts[0] || ops.filter(function (o) { return o.tokenish; })[0] || null;
  }

  function guessTarget(ops, login) {
    var plain = ops.filter(function (o) { return o !== login && !o.tokenish; });
    var read = plain.filter(function (o) { return o.method === 'get'; });
    return read[0] || plain[0] || ops[0] || null;
  }

  function serverOf(doc) {
    var server = Array.isArray(doc.servers) && isObj(doc.servers[0]) ? doc.servers[0] : null;
    var url = (server && typeof server.url === 'string' && server.url) || 'http://localhost';
    if (server && isObj(server.variables)) {
      url = url.replace(/\{([^}]+)\}/g, function (match, key) {
        var v = deref(doc, server.variables[key]);
        return isObj(v) && v.default !== undefined ? String(v.default) : match;
      });
    }
    var m = url.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?([^?#]*)/i);
    if (!m) {
      return { protocol: 'http', host: 'localhost', port: '8080',
        basePath: (url.charAt(0) === '/' ? url : '').replace(/\/+$/, '') };
    }
    var protocol = m[1].toLowerCase();
    return {
      protocol: protocol,
      host: m[2],
      port: m[3] || (protocol === 'https' ? '443' : '80'),
      basePath: (m[4] || '').replace(/\/+$/, '')
    };
  }

  /* How the document says credentials travel — the header the plan will set. */
  function authOf(doc) {
    var schemes = doc.components && doc.components.securitySchemes;
    var req = Array.isArray(doc.security) && doc.security.length ? doc.security[0] : null;
    var scheme = null;
    if (req && isObj(schemes)) scheme = deref(doc, schemes[Object.keys(req)[0]]);
    if (!isObj(scheme) && isObj(schemes)) {
      var names = Object.keys(schemes);
      if (names.length) scheme = deref(doc, schemes[names[0]]);
    }
    if (!isObj(scheme)) return { header: 'Authorization', prefix: 'Bearer ' };
    if (scheme.type === 'apiKey' && scheme.in === 'header') {
      return { header: scheme.name || 'X-API-Key', prefix: '' };
    }
    if (scheme.type === 'http' && /^basic$/i.test(scheme.scheme || '')) {
      return { header: 'Authorization', prefix: 'Basic ' };
    }
    return { header: 'Authorization', prefix: 'Bearer ' };
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

  /* A request the wizard can show as editable fields and the builder can emit
     as a sampler: concrete values only, no JMeter variables to decode. */
  function requestFor(doc, entry) {
    var params = entry.shared.concat(Array.isArray(entry.op.parameters) ? entry.op.parameters : [])
      .map(function (p) { return deref(doc, p); })
      .filter(isObj);
    var req = {
      method: entry.method.toUpperCase(),
      path: entry.path,
      label: entry.method.toUpperCase() + ' ' + entry.path,
      summary: entry.summary,
      pathParams: [],
      query: [],
      headers: [],
      body: null
    };
    params.forEach(function (p) {
      var value = paramValue(doc, p);
      if (p.in === 'path') {
        req.pathParams.push({ name: p.name, value: value });
      } else if (p.in === 'query') {
        if (p.required === true || p.example !== undefined) req.query.push({ name: p.name, value: value });
      } else if (p.in === 'header' && !/^(authorization|content-type|accept)$/i.test(p.name)) {
        req.headers.push({ name: p.name, value: value });
      }
    });
    req.body = bodyFor(doc, entry.op.requestBody);
    return req;
  }

  /* A urlencoded body is shown and stored as "a=b&c=d" so what the wizard
     displays is what goes on the wire; switching the content type converts
     between the two shapes instead of leaving a mismatched body behind. */
  function asForm(text) {
    try {
      var o = JSON.parse(text);
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return Object.keys(o).map(function (k) {
          var v = o[k];
          return encodeURIComponent(k) + '=' +
            encodeURIComponent(v === null || typeof v === 'object' ? '' : v);
        }).join('&');
      }
    } catch (e) { /* not JSON — assume it is already form text */ }
    return text;
  }

  function asJson(text) {
    if (/^\s*[[{]/.test(text)) return text;
    var o = {};
    text.split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      o[decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq))] =
        eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
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
    return {
      contentType: mime,
      text: /x-www-form-urlencoded/.test(mime) ? asForm(text) : text
    };
  }

  /* ==================================================================
     2. Writing the .jmx
     ================================================================== */

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      // Control characters XML 1.0 cannot carry — JMeter's parser aborts on them.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
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
  Jmx.prototype.sp = function (n, v) {
    return this.line('<stringProp name="' + n + '">' +
      xmlEsc(v === undefined || v === null ? '' : v) + '</stringProp>');
  };
  Jmx.prototype.bp = function (n, v) { return this.line('<boolProp name="' + n + '">' + (v ? 'true' : 'false') + '</boolProp>'); };
  Jmx.prototype.ip = function (n, v) { return this.line('<intProp name="' + n + '">' + v + '</intProp>'); };
  Jmx.prototype.lp = function (n, v) { return this.line('<longProp name="' + n + '">' + v + '</longProp>'); };
  Jmx.prototype.leaf = function () { return this.line('<hashTree/>'); };
  Jmx.prototype.text = function () { return this.out.join('\n') + '\n'; };

  function el(w, tag, gui, cls, name, enabled) {
    return w.open('<' + tag + ' guiclass="' + gui + '" testclass="' + cls + '" testname="' +
      xmlEsc(name) + '" enabled="' + (enabled === false ? 'false' : 'true') + '">');
  }

  function httpArgs(w, args, raw) {
    w.open('<elementProp name="HTTPsampler.Arguments" elementType="Arguments" ' +
      'guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">');
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

  function formArgs(text) {
    var out = [];
    String(text).split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      out.push(eq === -1
        ? { name: decodeURIComponent(pair), value: '' }
        : { name: decodeURIComponent(pair.slice(0, eq)), value: decodeURIComponent(pair.slice(eq + 1)) });
    });
    return out;
  }

  function loopController(w, loops) {
    w.open('<elementProp name="ThreadGroup.main_controller" elementType="LoopController" ' +
      'guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">');
    w.bp('LoopController.continue_forever', false);
    w.sp('LoopController.loops', loops);
    w.close('</elementProp>');
  }

  /* Resolved path: the wizard's answers are substituted in, so the sampler
     reads like the URL it will actually call. */
  function resolvedPath(req, basePath) {
    var path = req.path.replace(/\{([^}]+)\}/g, function (match, name) {
      var hit = null;
      req.pathParams.forEach(function (p) { if (p.name === name) hit = p; });
      return hit ? encodeURIComponent(hit.value) : match;
    });
    return (basePath || '') + path;
  }

  function sampler(w, req, basePath, enabled) {
    el(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy', req.label, enabled);
    var path = resolvedPath(req, basePath);
    var headers = req.headers.slice();
    var raw = null;
    var args = req.query.slice();
    var multipart = false;
    if (req.body && req.body.text !== '') {
      if (/multipart/.test(req.body.contentType)) {
        // JMeter writes the multipart Content-Type itself — it carries the part
        // boundary — and each field of the body becomes one form part.
        multipart = true;
        args = args.concat(formArgs(asForm(req.body.text)));
      } else if (/x-www-form-urlencoded/.test(req.body.contentType)) {
        headers.push({ name: 'Content-Type', value: req.body.contentType });
        args = args.concat(formArgs(req.body.text));
      } else {
        headers.push({ name: 'Content-Type', value: req.body.contentType });
        raw = req.body.text;
        // A raw body takes the argument list over, so query values move into
        // the path.
        if (args.length) {
          path += '?' + args.map(function (q) {
            return encodeURIComponent(q.name) + '=' + encodeURIComponent(q.value);
          }).join('&');
          args = [];
        }
      }
    }
    if (raw !== null) w.bp('HTTPSampler.postBodyRaw', true);
    httpArgs(w, args, raw);
    w.sp('HTTPSampler.domain', '');
    w.sp('HTTPSampler.port', '');
    w.sp('HTTPSampler.protocol', '');
    w.sp('HTTPSampler.contentEncoding', '');
    w.sp('HTTPSampler.path', path);
    w.sp('HTTPSampler.method', req.method);
    w.bp('HTTPSampler.follow_redirects', true);
    w.bp('HTTPSampler.auto_redirects', false);
    w.bp('HTTPSampler.use_keepalive', true);
    w.bp('HTTPSampler.DO_MULTIPART_POST', multipart);
    w.sp('HTTPSampler.embedded_url_re', '');
    w.sp('HTTPSampler.connect_timeout', '');
    w.sp('HTTPSampler.response_timeout', '');
    if (req.summary) w.sp('TestPlan.comments', req.summary);
    w.close('</HTTPSamplerProxy>');
    if (headers.length) {
      w.open('<hashTree>');
      headerManager(w, headers);
      w.close('</hashTree>');
    } else {
      w.leaf();
    }
  }

  /* 429 means the limiter did its job, so the run must not count it as an
     error. JMeter marks every non-2xx sample failed on its own and a passing
     assertion cannot undo that, so "Ignore status" resets the result first:
     2xx and 429 pass, a 5xx still fails. */
  function rateLimitAssertion(w) {
    el(w, 'ResponseAssertion', 'AssertionGui', 'ResponseAssertion',
      'Pass on 2xx and 429 (429 = rate limited)', true);
    w.open('<collectionProp name="Asserion.test_strings">');
    w.sp('0', '^(2\\d\\d|429)$');
    w.close('</collectionProp>');
    w.sp('Assertion.custom_message', 'Unexpected response code — neither a success nor a rate limit');
    w.sp('Assertion.test_field', 'Assertion.response_code');
    w.bp('Assertion.assume_success', true);
    w.ip('Assertion.test_type', 1);
    w.close('</ResponseAssertion>');
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

  /* setUp thread group: one login call before the load starts, its token
     published as a JMeter property so every thread of the real test can read
     it with ${__P(token)}. */
  function tokenSetup(w, cfg) {
    var login = cfg.auth.login;
    el(w, 'SetupThreadGroup', 'SetupThreadGroupGui', 'SetupThreadGroup', 'setUp — fetch a token', true);
    w.sp('ThreadGroup.on_sample_error', 'stoptest');
    loopController(w, '1');
    w.sp('ThreadGroup.num_threads', '1');
    w.sp('ThreadGroup.ramp_time', '1');
    w.bp('ThreadGroup.scheduler', false);
    w.sp('ThreadGroup.duration', '');
    w.sp('ThreadGroup.delay', '');
    w.close('</SetupThreadGroup>');
    w.open('<hashTree>');

    el(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy',
      login.method + ' ' + login.url + ' (token)', true);
    var form = /x-www-form-urlencoded/.test(login.contentType);
    if (!form) w.bp('HTTPSampler.postBodyRaw', true);
    if (form) {
      httpArgs(w, formArgs(login.body), null);
    } else {
      httpArgs(w, [], login.body);
    }
    var abs = /^https?:\/\//i.test(login.url);
    var m = abs ? login.url.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?([^#]*)/i) : null;
    w.sp('HTTPSampler.domain', m ? m[2] : '');
    w.sp('HTTPSampler.port', m ? (m[3] || '') : '');
    w.sp('HTTPSampler.protocol', m ? m[1].toLowerCase() : '');
    w.sp('HTTPSampler.contentEncoding', '');
    w.sp('HTTPSampler.path', m ? (m[4] || '/') : login.url);
    w.sp('HTTPSampler.method', login.method);
    w.bp('HTTPSampler.follow_redirects', true);
    w.bp('HTTPSampler.auto_redirects', false);
    w.bp('HTTPSampler.use_keepalive', true);
    w.bp('HTTPSampler.DO_MULTIPART_POST', false);
    w.sp('HTTPSampler.embedded_url_re', '');
    w.close('</HTTPSamplerProxy>');
    w.open('<hashTree>');
    headerManager(w, [{ name: 'Content-Type', value: login.contentType },
      { name: 'Accept', value: 'application/json' }], 'Token request headers');

    el(w, 'JSONPostProcessor', 'JSONPostProcessorGui', 'JSONPostProcessor', 'Read the token out of the response', true);
    w.sp('JSONPostProcessor.referenceNames', 'sduiToken');
    w.sp('JSONPostProcessor.jsonPathExprs', login.jsonPath);
    w.sp('JSONPostProcessor.match_numbers', '1');
    w.sp('JSONPostProcessor.defaultValues', 'TOKEN_NOT_FOUND');
    w.close('</JSONPostProcessor>');
    w.leaf();

    el(w, 'JSR223PostProcessor', 'TestBeanGUI', 'JSR223PostProcessor', 'Share the token with every thread', true);
    w.sp('cacheKey', 'true');
    w.sp('filename', '');
    w.sp('parameters', '');
    w.sp('script',
      '// setUp variables are per-thread; a property is what the load threads read.\n' +
      'props.put("token", vars.get("sduiToken"))\n' +
      'log.info("token acquired: " + (vars.get("sduiToken") == "TOKEN_NOT_FOUND" ? "NO" : "yes"))');
    w.sp('scriptLanguage', 'groovy');
    w.close('</JSR223PostProcessor>');
    w.leaf();

    w.close('</hashTree>');
    w.close('</hashTree>');
  }

  /* ==================================================================
     3. The plan
     ================================================================== */

  function totalRequests(cfg) {
    if (cfg.mode === 'spike') return cfg.spike.burst * cfg.spike.bursts;
    if (cfg.mode === 'quota') return Math.round(cfg.quota.rpm * cfg.quota.minutes);
    return Math.round(cfg.load.rpm * cfg.load.minutes);
  }

  function forHowLong(minutes) {
    if (minutes < 1) return Math.round(minutes * 60) + ' seconds';
    return minutes + ' minute' + (minutes === 1 ? '' : 's');
  }

  function users(n) { return n + ' virtual user' + (n === 1 ? '' : 's'); }

  function summarize(cfg) {
    var where = cfg.mode === 'load'
      ? 'every operation in the document'
      : cfg.request.method + ' ' + cfg.request.path;
    var how;
    if (cfg.mode === 'spike') {
      how = cfg.spike.bursts === 1
        ? cfg.spike.burst + ' requests fired at the same instant'
        : cfg.spike.bursts + ' bursts of ' + cfg.spike.burst + ' simultaneous requests, ' +
          cfg.spike.gap + ' s apart (' + totalRequests(cfg) + ' requests in total)';
    } else if (cfg.mode === 'quota') {
      how = cfg.quota.rpm + ' requests per minute for ' + forHowLong(cfg.quota.minutes) +
        ' from ' + users(cfg.quota.users) + ' (' + totalRequests(cfg) + ' requests in total)';
    } else {
      how = cfg.load.rpm + ' requests per minute for ' + forHowLong(cfg.load.minutes) +
        ' from ' + users(cfg.load.users);
    }
    var auth = cfg.auth.kind === 'login'
      ? 'A token is fetched once from ' + cfg.auth.login.method + ' ' + cfg.auth.login.url +
        ' and sent as ' + cfg.auth.header + '.'
      : cfg.auth.kind === 'static'
        ? 'Each request carries the ' + cfg.auth.header + ' header you supplied.'
        : 'No authentication is sent.';
    return how + ' against ' + where + '. ' + auth;
  }

  function planTitle(doc, cfg) {
    var name = (doc.info && doc.info.title) || 'API';
    if (cfg.mode === 'spike') return name + ' — spike arrest test';
    if (cfg.mode === 'quota') return name + ' — quota / rate limit test';
    return name + ' — sustained load test';
  }

  function buildPlan(doc, cfg) {
    var srv = cfg.server;
    var requests = cfg.mode === 'load' ? cfg.requests : [cfg.request];
    if (!requests.length) throw new Error('no operation selected');

    var file = slug(doc) + '-' + cfg.mode + '.jmx';
    var comments = [
      planTitle(doc, cfg),
      '',
      summarize(cfg),
      '',
      'Run it:',
      '  jmeter -n -t ' + file + ' -l results.jtl',
      'Count the responses afterwards (429 = the limit answered):',
      '  awk -F, \'NR>1 {print $4}\' results.jtl | sort | uniq -c',
      '',
      cfg.limit ? 'Expected limit: ' + cfg.limit : '',
      'Override the target without editing the plan:',
      '  -Jhost=api.example.com -Jport=443 -Jprotocol=https' +
        (cfg.auth.kind === 'static' ? ' -Jtoken=YOUR_TOKEN' : ''),
      cfg.mode === 'quota' ? '  -Jrpm=' + cfg.quota.rpm + ' -Jduration=' + Math.round(cfg.quota.minutes * 60) + ' -Jusers=' + cfg.quota.users : '',
      cfg.mode === 'load' ? '  -Jrpm=' + cfg.load.rpm + ' -Jduration=' + Math.round(cfg.load.minutes * 60) + ' -Jusers=' + cfg.load.users : '',
      '',
      '2xx and 429 both count as a pass, so a throttled request is a result and',
      'not an error; anything else fails the assertion.'
    ].filter(function (l) { return l !== ''; }).join('\n');

    var w = new Jmx();
    w.line('<?xml version="1.0" encoding="UTF-8"?>');
    w.open('<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.4.3">');
    w.open('<hashTree>');

    el(w, 'TestPlan', 'TestPlanGui', 'TestPlan', planTitle(doc, cfg), true);
    w.sp('TestPlan.comments', comments);
    w.bp('TestPlan.functional_mode', false);
    w.bp('TestPlan.tearDown_on_shutdown', true);
    w.bp('TestPlan.serialize_threadgroups', false);
    w.open('<elementProp name="TestPlan.user_defined_variables" elementType="Arguments" ' +
      'guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">');
    w.line('<collectionProp name="Arguments.arguments"/>');
    w.close('</elementProp>');
    w.sp('TestPlan.user_define_classpath', '');
    w.close('</TestPlan>');
    w.open('<hashTree>');

    /* Where the requests go. Host/port/protocol stay overridable because the
       same plan is usually pointed at staging first. */
    el(w, 'ConfigTestElement', 'HttpDefaultsGui', 'ConfigTestElement', 'Target — ' + srv.host, true);
    httpArgs(w, [], null);
    w.sp('HTTPSampler.domain', '${__P(host,' + srv.host + ')}');
    w.sp('HTTPSampler.port', '${__P(port,' + srv.port + ')}');
    w.sp('HTTPSampler.protocol', '${__P(protocol,' + srv.protocol + ')}');
    w.sp('HTTPSampler.contentEncoding', 'UTF-8');
    w.sp('HTTPSampler.path', '');
    w.sp('HTTPSampler.implementation', 'HttpClient4');
    w.sp('HTTPSampler.connect_timeout', '10000');
    w.sp('HTTPSampler.response_timeout', '30000');
    w.close('</ConfigTestElement>');
    w.leaf();

    var planHeaders = [{ name: 'Accept', value: 'application/json' }];
    if (cfg.auth.kind === 'static') {
      planHeaders.push({ name: cfg.auth.header,
        value: cfg.auth.prefix + '${__P(token,' + (cfg.auth.value || 'PASTE_YOUR_TOKEN') + ')}' });
    } else if (cfg.auth.kind === 'login') {
      planHeaders.push({ name: cfg.auth.header, value: cfg.auth.prefix + '${__P(token,NO_TOKEN)}' });
    }
    headerManager(w, planHeaders, 'Headers sent with every request');

    if (cfg.auth.kind === 'login') tokenSetup(w, cfg);

    /* The thread group is what makes this a spike test or a quota test. */
    var tgName, loops, threads, ramp, scheduler, duration;
    if (cfg.mode === 'spike') {
      tgName = 'Spike — ' + cfg.spike.burst + ' at once x ' + cfg.spike.bursts;
      threads = String(cfg.spike.burst);
      loops = String(cfg.spike.bursts);
      ramp = '1';
      scheduler = false;
      duration = '';
    } else {
      var p = cfg.mode === 'quota' ? cfg.quota : cfg.load;
      tgName = (cfg.mode === 'quota' ? 'Quota — ' : 'Load — ') + p.rpm + ' req/min for ' + forHowLong(p.minutes);
      threads = '${__P(users,' + p.users + ')}';
      loops = '-1';
      ramp = String(Math.max(1, Math.min(30, Math.round(p.users / 2))));
      scheduler = true;
      duration = '${__P(duration,' + Math.round(p.minutes * 60) + ')}';
    }

    el(w, 'ThreadGroup', 'ThreadGroupGui', 'ThreadGroup', tgName, true);
    w.sp('ThreadGroup.on_sample_error', 'continue');
    loopController(w, loops);
    w.sp('ThreadGroup.num_threads', threads);
    w.sp('ThreadGroup.ramp_time', ramp);
    w.bp('ThreadGroup.scheduler', scheduler);
    w.sp('ThreadGroup.duration', duration);
    w.sp('ThreadGroup.delay', '0');
    w.bp('ThreadGroup.same_user_on_next_iteration', true);
    w.close('</ThreadGroup>');
    w.open('<hashTree>');

    if (cfg.mode === 'spike') {
      // Every thread waits at the timer and they are released together — that
      // is the burst a spike arrest is supposed to cut off.
      el(w, 'SyncTimer', 'TestBeanGUI', 'SyncTimer', 'Release all ' + cfg.spike.burst + ' requests together', true);
      w.ip('groupSize', cfg.spike.burst);
      w.lp('timeoutInMs', 60000);
      w.close('</SyncTimer>');
      w.leaf();
    } else {
      var rpm = cfg.mode === 'quota' ? cfg.quota.rpm : cfg.load.rpm;
      el(w, 'ConstantThroughputTimer', 'TestBeanGUI', 'ConstantThroughputTimer',
        'Hold the rate at ' + rpm + ' requests per minute', true);
      // 2 = the rate applies to all active threads in this thread group.
      w.ip('calcMode', 2);
      w.sp('throughput', '${__P(rpm,' + rpm + ')}');
      w.close('</ConstantThroughputTimer>');
      w.leaf();
    }

    rateLimitAssertion(w);

    requests.forEach(function (req) { sampler(w, req, srv.basePath, true); });

    if (cfg.mode === 'spike' && cfg.spike.bursts > 1 && cfg.spike.gap > 0) {
      el(w, 'TestAction', 'TestActionGui', 'TestAction',
        'Wait ' + cfg.spike.gap + ' s before the next burst', true);
      w.ip('ActionProcessor.action', 1);
      w.ip('ActionProcessor.target', 0);
      w.sp('ActionProcessor.duration', String(Math.round(cfg.spike.gap * 1000)));
      w.close('</TestAction>');
      w.leaf();
    }

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
      summary: summarize(cfg),
      command: 'jmeter -n -t ' + file + ' -l results.jtl',
      total: cfg.mode === 'load' ? null : totalRequests(cfg)
    };
  }

  /* ==================================================================
     4. The wizard — four questions, a live summary, one download
     ================================================================== */

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

  function textBox(value) {
    var i = document.createElement('input');
    i.type = 'text';
    i.spellcheck = false;
    i.value = value === undefined || value === null ? '' : String(value);
    return i;
  }

  function numberBox(value, min, step) {
    var i = document.createElement('input');
    i.type = 'number';
    i.min = min === undefined ? '1' : String(min);
    if (step) i.step = String(step);
    i.value = String(value);
    return i;
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

  function grid(parent) {
    var g = elem('div', 'sdui-wz-grid');
    parent.appendChild(g);
    return g;
  }

  function step(parent, num, title, hint) {
    var s = elem('section', 'sdui-wz-step');
    var prefix = typeof num === 'number' ? num + '. ' : num + ' ';
    s.appendChild(elem('h4', null, prefix + title));
    if (hint) s.appendChild(elem('p', 'sdui-wz-hint', hint));
    parent.appendChild(s);
    return s;
  }

  function choiceCards(parent, group, items, value, onPick) {
    var wrap = elem('div', 'sdui-wz-choices');
    items.forEach(function (it) {
      var card = elem('label', 'sdui-wz-choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = group;
      radio.checked = it.value === value;
      card.setAttribute('data-selected', String(radio.checked));
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

  function opChoices(ops) {
    return ops.map(function (o) {
      return { value: o.id, label: o.method.toUpperCase() + ' ' + o.path + (o.summary ? '  —  ' + o.summary : '') };
    });
  }

  function open(opts) {
    var doc = opts.doc;
    var ops = operations(doc);
    if (!ops.length) throw new Error('the document has no operations to test');

    var srv = serverOf(doc);
    var auth = authOf(doc);
    var login = guessLogin(ops);
    var target = guessTarget(ops, login);
    var secured = (Array.isArray(doc.security) && doc.security.length) ||
      (isObj(doc.components) && isObj(doc.components.securitySchemes));

    function loginDefaults(entry) {
      var body = entry ? bodyFor(doc, entry.op.requestBody) : null;
      return {
        source: entry ? entry.id : 'custom',
        url: entry ? srv.basePath + entry.path : 'https://' + srv.host + '/oauth/token',
        method: entry ? entry.method.toUpperCase() : 'POST',
        contentType: (body && body.contentType) || 'application/json',
        body: (body && body.text) ||
          '{\n  "client_id": "",\n  "client_secret": "",\n  "grant_type": "client_credentials"\n}',
        jsonPath: '$.access_token'
      };
    }

    var cfg = {
      mode: 'quota',
      server: srv,
      target: target ? target.id : ops[0].id,
      request: requestFor(doc, target || ops[0]),
      requests: ops.map(function (o) { return requestFor(doc, o); }),
      auth: {
        kind: login ? 'login' : (secured ? 'static' : 'none'),
        header: auth.header,
        prefix: auth.prefix,
        value: '',
        login: loginDefaults(login)
      },
      spike: { burst: 50, bursts: 3, gap: 30 },
      quota: { rpm: 600, minutes: 5, users: 10 },
      load: { rpm: 600, minutes: 5, users: 10 },
      limit: ''
    };

    /* ----- shell ----- */
    var overlay = elem('div', 'sdui-modal-overlay');
    var modal = elem('div', 'sdui-modal sdui-wizard');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'JMeter test plan');
    var head = elem('div', 'sdui-modal-head');
    head.appendChild(elem('span', null, 'JMeter test plan — ' + ((doc.info && doc.info.title) || 'API')));
    var closeBtn = elem('button', 'sdui-tool-btn', 'Close');
    closeBtn.type = 'button';
    head.appendChild(closeBtn);
    var body = elem('div', 'sdui-wizard-body');
    var foot = elem('div', 'sdui-wz-foot');
    var note = elem('div', 'sdui-wz-note', '');
    var actions = elem('div', 'sdui-wz-actions');
    var cancel = elem('button', 'sdui-tool-btn', 'Cancel');
    cancel.type = 'button';
    var generate = elem('button', 'sdui-tool-btn sdui-wz-primary', 'Download .jmx');
    generate.type = 'button';
    actions.appendChild(cancel);
    actions.appendChild(generate);
    foot.appendChild(note);
    foot.appendChild(actions);
    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function dismiss() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    closeBtn.addEventListener('click', dismiss);
    cancel.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);

    /* ----- live summary ----- */
    var summaryBox = null;
    function refreshSummary() {
      if (summaryBox) summaryBox.textContent = summarize(cfg);
    }

    function entryById(id) {
      var hit = null;
      ops.forEach(function (o) { if (o.id === id) hit = o; });
      return hit;
    }

    /* ----- the form ----- */
    function render() {
      body.innerHTML = '';

      var s1 = step(body, 1, 'What are you testing?',
        'The answer decides how the requests are shaped — a wall of traffic at one instant, or a steady rate held over time.');
      choiceCards(s1, 'sdui-wz-mode', [
        { value: 'spike', title: 'Spike arrest', desc: 'A burst of simultaneous requests. Shows the per-second cap: how many of the burst get through before the limiter cuts in.' },
        { value: 'quota', title: 'Quota / rate limit', desc: 'A steady rate held for a set time. Shows where the per-minute or per-hour quota runs out.' },
        { value: 'load', title: 'Plain load test', desc: 'No limiter in mind: a steady rate across every operation in the document.' }
      ], cfg.mode, function (v) { cfg.mode = v; render(); });

      if (cfg.mode !== 'load') {
        var s2 = step(body, 2, 'Which endpoint gets hit?',
          'One endpoint per plan — a rate limit belongs to a route, and mixing routes hides which one answered.');
        var sel = dropdown(opChoices(ops), cfg.target);
        field(s2, 'Endpoint', sel);
        sel.addEventListener('change', function () {
          cfg.target = sel.value;
          cfg.request = requestFor(doc, entryById(cfg.target));
          render();
        });

        var req = cfg.request;
        if (req.pathParams.length || req.query.length) {
          var g = grid(s2);
          req.pathParams.forEach(function (p) {
            var box = field(g, 'Path parameter · ' + p.name, textBox(p.value));
            box.addEventListener('input', function () { p.value = box.value; refreshSummary(); });
          });
          req.query.forEach(function (q) {
            var box = field(g, 'Query · ' + q.name, textBox(q.value));
            box.addEventListener('input', function () { q.value = box.value; });
          });
        }
        if (req.body) {
          var ta = document.createElement('textarea');
          ta.rows = 5;
          ta.spellcheck = false;
          ta.value = req.body.text;
          field(s2, 'Request body (' + req.body.contentType + ')', ta,
            /multipart/.test(req.body.contentType)
              ? 'Each key becomes a form field; file uploads have to be added in JMeter.'
              : 'Sent as it is written here.');
          ta.addEventListener('input', function () { req.body.text = ta.value; });
        }
      }

      var s3 = step(body, cfg.mode === 'load' ? 2 : 3, 'Where does the token come from?',
        'Rate limits are usually counted per credential, so the plan has to carry a real one.');
      choiceCards(s3, 'sdui-wz-auth', [
        { value: 'login', title: 'Fetch it from an API', desc: 'One call before the test starts; the token is read out of the response and reused by every request.' },
        { value: 'static', title: 'I already have one', desc: 'Paste a token or API key. It is stored in the plan file and can be overridden with -Jtoken.' },
        { value: 'none', title: 'No authentication', desc: 'The endpoint is open, or the limiter counts by IP.' }
      ], cfg.auth.kind, function (v) { cfg.auth.kind = v; render(); });

      if (cfg.auth.kind === 'static') {
        var gs = grid(s3);
        var hName = field(gs, 'Header name', textBox(cfg.auth.header));
        var hPrefix = field(gs, 'Value prefix', textBox(cfg.auth.prefix), 'Left empty for a plain API key.');
        var hValue = field(gs, 'Token / key', textBox(cfg.auth.value), 'Override at run time with -Jtoken=…');
        hName.addEventListener('input', function () { cfg.auth.header = hName.value; refreshSummary(); });
        hPrefix.addEventListener('input', function () { cfg.auth.prefix = hPrefix.value; });
        hValue.addEventListener('input', function () { cfg.auth.value = hValue.value; });
      }

      if (cfg.auth.kind === 'login') {
        var lg = cfg.auth.login;
        var choices = opChoices(ops).concat([{ value: 'custom', label: 'Another URL — not in this document' }]);
        var lsel = dropdown(choices, lg.source);
        field(s3, 'Token endpoint', lsel);
        lsel.addEventListener('change', function () {
          var entry = lsel.value === 'custom' ? null : entryById(lsel.value);
          cfg.auth.login = loginDefaults(entry);
          cfg.auth.login.source = lsel.value;
          render();
        });
        var g3 = grid(s3);
        var uBox = field(g3, 'URL or path', textBox(lg.url),
          'A path uses the target host; a full https:// URL calls its own host.');
        var mBox = field(g3, 'Method', dropdown([
          { value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }, { value: 'PUT', label: 'PUT' }
        ], lg.method));
        var cBox = field(g3, 'Content type', dropdown([
          { value: 'application/json', label: 'application/json' },
          { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' }
        ], lg.contentType));
        var jBox = field(g3, 'Where is the token in the response?', textBox(lg.jsonPath),
          'JSON path, e.g. $.access_token or $.data.token');
        uBox.addEventListener('input', function () { lg.url = uBox.value; refreshSummary(); });
        mBox.addEventListener('change', function () { lg.method = mBox.value; refreshSummary(); });
        cBox.addEventListener('change', function () {
          lg.contentType = cBox.value;
          lg.body = /x-www-form-urlencoded/.test(lg.contentType) ? asForm(lg.body) : asJson(lg.body);
          render();
        });
        jBox.addEventListener('input', function () { lg.jsonPath = jBox.value; });
        var lta = document.createElement('textarea');
        lta.rows = 5;
        lta.spellcheck = false;
        lta.value = lg.body;
        field(s3, 'Credentials sent to that endpoint',
          lta, 'Fill in the real client id / secret — this is what gets rate limited.');
        lta.addEventListener('input', function () { lg.body = lta.value; });
        var gh = grid(s3);
        var hn = field(gh, 'Header the token is sent in', textBox(cfg.auth.header));
        var hp = field(gh, 'Value prefix', textBox(cfg.auth.prefix));
        hn.addEventListener('input', function () { cfg.auth.header = hn.value; refreshSummary(); });
        hp.addEventListener('input', function () { cfg.auth.prefix = hp.value; });
      }

      var s4 = step(body, cfg.mode === 'load' ? 3 : 4, 'How many requests, over how long?');
      var g4 = grid(s4);
      if (cfg.mode === 'spike') {
        var burst = field(g4, 'Requests per burst', numberBox(cfg.spike.burst, 1),
          'All of them leave at the same instant.');
        var bursts = field(g4, 'How many bursts', numberBox(cfg.spike.bursts, 1));
        var gap = field(g4, 'Seconds between bursts', numberBox(cfg.spike.gap, 0));
        burst.addEventListener('input', function () { cfg.spike.burst = num(burst.value, 1); refreshSummary(); });
        bursts.addEventListener('input', function () { cfg.spike.bursts = num(bursts.value, 1); refreshSummary(); });
        gap.addEventListener('input', function () { cfg.spike.gap = num(gap.value, 0); refreshSummary(); });
      } else {
        var p = cfg.mode === 'quota' ? cfg.quota : cfg.load;
        var rpm = field(g4, 'Requests per minute', numberBox(p.rpm, 1),
          'The whole test holds this rate, not each user.');
        var mins = field(g4, 'For how many minutes', numberBox(p.minutes, 1, 0.5));
        var users = field(g4, 'Virtual users', numberBox(p.users, 1),
          'Enough to carry the rate; one user cannot exceed its own round-trip time.');
        rpm.addEventListener('input', function () { p.rpm = num(rpm.value, 1); refreshSummary(); });
        mins.addEventListener('input', function () { p.minutes = num(mins.value, 0.5); refreshSummary(); });
        users.addEventListener('input', function () { p.users = num(users.value, 1); refreshSummary(); });
      }
      var limit = field(g4, 'Documented limit (optional)', textBox(cfg.limit),
        'Written into the plan, e.g. "100 req/min per key".');
      limit.addEventListener('input', function () { cfg.limit = limit.value; });

      var sum = elem('section', 'sdui-wz-step');
      sum.appendChild(elem('h4', null, 'What will run'));
      summaryBox = elem('div', 'sdui-wz-summary', '');
      sum.appendChild(summaryBox);
      body.appendChild(sum);
      refreshSummary();
    }

    function num(value, min) {
      var n = parseFloat(value);
      if (isNaN(n)) return min;
      return n < min ? min : n;
    }

    /* ----- result panel ----- */
    function showResult(plan) {
      body.innerHTML = '';
      var done = step(body, '✔', 'Downloaded — ' + plan.file);
      done.appendChild(elem('div', 'sdui-wz-summary', plan.summary));

      var runStep = step(body, 1, 'Run it');
      var cmd = elem('pre', 'sdui-wz-cmd', plan.command);
      runStep.appendChild(cmd);
      runStep.appendChild(elem('p', 'sdui-wz-hint',
        'Or open the file in the JMeter GUI and press Start — nothing in it needs editing first.'));

      var readStep = step(body, 2, 'Read the result');
      readStep.appendChild(elem('pre', 'sdui-wz-cmd',
        'awk -F, \'NR>1 {print $4}\' results.jtl | sort | uniq -c'));
      var list = elem('ul', 'sdui-wz-list');
      [
        '200 (or any 2xx) — the request was allowed through.',
        '429 — the limiter answered. Where the 429s start is the limit.',
        'Anything else fails the plan\'s assertion and is a real error, not throttling.',
        plan.total ? 'This run sends ' + plan.total + ' requests in total.' : ''
      ].filter(Boolean).forEach(function (t) { list.appendChild(elem('li', null, t)); });
      readStep.appendChild(list);

      note.textContent = '';
      actions.innerHTML = '';
      var copy = elem('button', 'sdui-tool-btn', 'Copy command');
      copy.type = 'button';
      copy.addEventListener('click', function () {
        var ok = function () { copy.textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plan.command).then(ok, function () {});
        }
      });
      var again = elem('button', 'sdui-tool-btn', 'Build another');
      again.type = 'button';
      again.addEventListener('click', function () {
        actions.innerHTML = '';
        actions.appendChild(cancel);
        actions.appendChild(generate);
        render();
      });
      var done2 = elem('button', 'sdui-tool-btn sdui-wz-primary', 'Done');
      done2.type = 'button';
      done2.addEventListener('click', dismiss);
      actions.appendChild(copy);
      actions.appendChild(again);
      actions.appendChild(done2);
    }

    generate.addEventListener('click', function () {
      try {
        var plan = buildPlan(doc, cfg);
        opts.download(plan.file, 'application/xml', plan.xml);
        opts.setStatus('ok', 'JMeter plan downloaded — ' + plan.file + ' · ' + plan.command);
        showResult(plan);
      } catch (err) {
        note.textContent = 'Could not build the plan: ' + (err.message || err);
      }
    });

    render();
  }

  window.SduiJMeter = {
    open: open,
    build: buildPlan,
    read: {
      operations: operations, server: serverOf, auth: authOf,
      guessLogin: guessLogin, guessTarget: guessTarget, request: requestFor, body: bodyFor
    }
  };
})();

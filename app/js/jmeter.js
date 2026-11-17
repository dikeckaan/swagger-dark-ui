/* Swagger Dark UI — JMeter scenario generator.
   "Export → JMeter test plan" does not guess what the test should be: it asks.
   Which limiter is under test (a spike arrest that caps bursts, a quota that
   caps a sustained rate, or a staircase that walks the rate up until the
   limiter answers), which requests take part and in what mix, where the token
   comes from and how long it stays valid, and what counts as a pass. The
   answers become an Apache JMeter 5.4.3 plan that runs as downloaded. */
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

  function guessLogin(ops) {
    var posts = ops.filter(function (o) { return o.tokenish && o.method === 'post'; });
    return posts[0] || ops.filter(function (o) { return o.tokenish; })[0] || null;
  }

  function guessTarget(ops, login) {
    var plain = ops.filter(function (o) { return o !== login && !o.tokenish; });
    var read = plain.filter(function (o) { return o.method === 'get'; });
    return read[0] || plain[0] || ops[0] || null;
  }

  /* Every server URL the document offers, with its variables resolved. An
     empty list means the document never says where the API lives — the wizard
     then has to ask, because "localhost" is not a target. */
  function serverUrls(doc) {
    if (!Array.isArray(doc.servers)) return [];
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
      // A relative server URL ("/v1") names a path, not a host: it cannot be
      // tested on its own, so it is not offered as a target.
      if (/^https?:\/\//i.test(url) && !/\{|\}/.test(url)) out.push(url.replace(/\/+$/, ''));
    });
    return out;
  }

  /* A base URL the plan can be pointed at. Returns null when the text is not
     usable, so the wizard can refuse to generate rather than write a plan
     aimed at example.com. */
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

  function authOf(doc) {
    var schemes = doc.components && doc.components.securitySchemes;
    var req = Array.isArray(doc.security) && doc.security.length ? doc.security[0] : null;
    var scheme = null;
    if (req && isObj(schemes)) scheme = deref(doc, schemes[Object.keys(req)[0]]);
    if (!isObj(scheme) && isObj(schemes)) {
      var names = Object.keys(schemes);
      if (names.length) scheme = deref(doc, schemes[names[0]]);
    }
    if (!isObj(scheme)) return { header: 'Authorization', prefix: 'Bearer ', secured: false };
    if (scheme.type === 'apiKey' && scheme.in === 'header') {
      return { header: scheme.name || 'X-API-Key', prefix: '', secured: true };
    }
    if (scheme.type === 'http' && /^basic$/i.test(scheme.scheme || '')) {
      return { header: 'Authorization', prefix: 'Basic ', secured: true };
    }
    return { header: 'Authorization', prefix: 'Bearer ', secured: true };
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

  /* A request the wizard shows as editable fields and the builder emits as a
     sampler: concrete values only, no JMeter variables to decode. */
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

  /* A request the document knows nothing about — another API in the same
     scenario, or a call the spec does not cover. */
  function customRequest(url) {
    return {
      id: 'custom-' + Math.random().toString(36).slice(2, 8),
      on: true,
      custom: true,
      weight: 1,
      method: 'GET',
      path: '',
      url: url || '',
      label: 'GET ' + (url || ''),
      summary: '',
      pathParams: [],
      query: [],
      headers: [],
      body: null
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

  /* The wizard's answers are substituted in, so the sampler reads like the URL
     it will actually call. */
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

  function sampler(w, req, basePath, name) {
    el(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy', name || req.label, true);
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
    // An absolute URL names its own host, which is how one plan can drive two
    // different APIs at once; everything else inherits the HTTP defaults.
    var abs = req.url ? String(req.url).match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?/i) : null;
    w.sp('HTTPSampler.domain', abs ? abs[2] : '');
    w.sp('HTTPSampler.port', abs ? (abs[3] || '') : '');
    w.sp('HTTPSampler.protocol', abs ? abs[1].toLowerCase() : '');
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
      headerManager(w, headers, 'Headers for this request');
      w.close('</hashTree>');
    } else {
      w.leaf();
    }
  }

  /* Which response codes count as a pass. JMeter marks every non-2xx sample
     failed on its own and a passing assertion cannot undo that, so "Ignore
     status" resets the result first and the pattern alone decides. */
  function codePattern(checks) {
    var parts = ['2\\d\\d'];
    if (checks.allow3xx) parts.push('3\\d\\d');
    if (checks.allow429) parts.push('429');
    String(checks.extraCodes || '').split(/[\s,]+/).forEach(function (c) {
      if (/^\d{3}$/.test(c) && parts.indexOf(c) === -1) parts.push(c);
    });
    return '^(' + parts.join('|') + ')$';
  }

  function responseAssertion(w, checks) {
    var names = ['2xx'];
    if (checks.allow3xx) names.push('3xx');
    if (checks.allow429) names.push('429 = rate limited');
    if (checks.extraCodes) names.push(checks.extraCodes);
    el(w, 'ResponseAssertion', 'AssertionGui', 'ResponseAssertion',
      'Pass on ' + names.join(', '), true);
    w.open('<collectionProp name="Asserion.test_strings">');
    w.sp('0', codePattern(checks));
    w.close('</collectionProp>');
    w.sp('Assertion.custom_message', 'Unexpected response code — not a success and not a rate limit');
    w.sp('Assertion.test_field', 'Assertion.response_code');
    w.bp('Assertion.assume_success', true);
    w.ip('Assertion.test_type', 1);
    w.close('</ResponseAssertion>');
    w.leaf();
  }

  function durationAssertion(w, ms) {
    el(w, 'DurationAssertion', 'DurationAssertionGui', 'DurationAssertion',
      'Answer within ' + ms + ' ms', true);
    w.sp('DurationAssertion.duration', String(ms));
    w.close('</DurationAssertion>');
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

  /* The token call, its extractor and the post-processor that shares the value
     with every thread. Used on its own in a setUp group, or inside the load
     loop when the token has to be refreshed. */
  function tokenUrl(cfg) {
    var url = cfg.auth.login.url;
    // A path is relative to the base URL, exactly like the other requests; a
    // full URL calls its own host (token services often live elsewhere).
    return /^https?:\/\//i.test(url) ? url : (cfg.target.basePath || '') + url;
  }

  function tokenRequest(w, cfg) {
    var login = cfg.auth.login;
    var url = tokenUrl(cfg);
    el(w, 'HTTPSamplerProxy', 'HttpTestSampleGui', 'HTTPSamplerProxy',
      'TOKEN ' + login.method + ' ' + url, true);
    var form = /x-www-form-urlencoded/.test(login.contentType);
    if (!form) w.bp('HTTPSampler.postBodyRaw', true);
    httpArgs(w, form ? formArgs(login.body) : [], form ? null : login.body);
    var abs = /^https?:\/\//i.test(url)
      ? url.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?([^#]*)/i) : null;
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
    headerManager(w, [{ name: 'Content-Type', value: login.contentType },
      { name: 'Accept', value: 'application/json' }], 'Token request headers');

    el(w, 'JSONPostProcessor', 'JSONPostProcessorGui', 'JSONPostProcessor',
      'Read the token out of the response', true);
    w.sp('JSONPostProcessor.referenceNames', 'sduiToken');
    w.sp('JSONPostProcessor.jsonPathExprs', login.jsonPath);
    w.sp('JSONPostProcessor.match_numbers', '1');
    w.sp('JSONPostProcessor.defaultValues', 'TOKEN_NOT_FOUND');
    w.close('</JSONPostProcessor>');
    w.leaf();

    // BeanShell rather than JSR223/Groovy on purpose: the Groovy bundled with
    // JMeter 5.4.3 cannot compile under Java 17+, while BeanShell interprets
    // and runs on every JDK the tool supports.
    el(w, 'BeanShellPostProcessor', 'TestBeanGUI', 'BeanShellPostProcessor',
      'Share the token with every thread', true);
    w.bp('resetInterpreter', false);
    w.sp('parameters', '');
    w.sp('filename', '');
    w.sp('script',
      '// A variable belongs to one thread; a property is what all of them read.\n' +
      'props.put("sduiToken", vars.get("sduiToken"));\n' +
      'props.put("sduiTokenAt", String.valueOf(System.currentTimeMillis()));\n' +
      'log.info("token acquired: " + vars.get("sduiToken"));');
    w.close('</BeanShellPostProcessor>');
    w.leaf();
    w.close('</hashTree>');
  }

  function setupTokenGroup(w, cfg) {
    el(w, 'SetupThreadGroup', 'SetupThreadGroupGui', 'SetupThreadGroup',
      'setUp — fetch a token before the load starts', true);
    w.sp('ThreadGroup.on_sample_error', 'stoptest');
    loopController(w, '1');
    w.sp('ThreadGroup.num_threads', '1');
    w.sp('ThreadGroup.ramp_time', '1');
    w.bp('ThreadGroup.scheduler', false);
    w.sp('ThreadGroup.duration', '');
    w.sp('ThreadGroup.delay', '');
    w.close('</SetupThreadGroup>');
    w.open('<hashTree>');
    tokenRequest(w, cfg);
    w.close('</hashTree>');
  }

  /* Refresh inside the loop. One thread at a time enters the critical section,
     and the If Controller keeps the call from happening when the token is
     still young — so a 30-minute token is fetched twice in an hour, not once
     per iteration. */
  function refreshBlock(w, cfg) {
    var ttlMs = Math.max(1, Math.round(cfg.auth.ttlMinutes * 60000));
    el(w, 'CriticalSectionController', 'CriticalSectionControllerGui', 'CriticalSectionController',
      'Only one thread refreshes the token', true);
    w.sp('CriticalSectionController.lockName', 'sdui_token');
    w.close('</CriticalSectionController>');
    w.open('<hashTree>');
    el(w, 'IfController', 'IfControllerPanel', 'IfController',
      'Token older than ' + cfg.auth.ttlMinutes + ' min?', true);
    // JEXL3 reads the property and coerces it for the comparison; no commas,
    // they would split the function's argument list. __time() is the clock.
    w.sp('IfController.condition',
      '${__jexl3(props.get("sduiTokenAt") == null || ' +
      '${__time()} - props.get("sduiTokenAt") > ' + ttlMs + ')}');
    w.bp('IfController.evaluateAll', false);
    w.bp('IfController.useExpression', true);
    w.close('</IfController>');
    w.open('<hashTree>');
    tokenRequest(w, cfg);
    w.close('</hashTree>');
    w.close('</hashTree>');
  }

  /* ==================================================================
     3. The plan
     ================================================================== */

  function activeRequests(cfg) {
    return cfg.requests.filter(function (r) { return r.on; });
  }

  function weightsOf(cfg) {
    var active = activeRequests(cfg);
    var total = 0;
    active.forEach(function (r) { total += Math.max(0, r.weight || 0); });
    if (!total) return active.map(function () { return Math.round(1000 / active.length) / 10; });
    return active.map(function (r) {
      return Math.round((Math.max(0, r.weight || 0) / total) * 1000) / 10;
    });
  }

  function rampSteps(cfg) {
    var steps = [];
    for (var i = 0; i < cfg.ramp.steps; i++) {
      steps.push({
        index: i + 1,
        rpm: cfg.ramp.startRpm + i * cfg.ramp.stepRpm,
        seconds: cfg.ramp.stepSeconds,
        delay: i * cfg.ramp.stepSeconds
      });
    }
    return steps;
  }

  function totalRequests(cfg) {
    if (cfg.mode === 'spike') return cfg.spike.burst * cfg.spike.bursts;
    if (cfg.mode === 'quota') return Math.round(cfg.quota.rpm * cfg.quota.minutes);
    var sum = 0;
    rampSteps(cfg).forEach(function (s) { sum += s.rpm * s.seconds / 60; });
    return Math.round(sum);
  }

  function forHowLong(minutes) {
    if (minutes < 1) return Math.round(minutes * 60) + ' seconds';
    if (minutes >= 60 && minutes % 60 === 0) {
      return (minutes / 60) + ' hour' + (minutes === 60 ? '' : 's');
    }
    return minutes + ' minute' + (minutes === 1 ? '' : 's');
  }

  function userCount(n) { return n + ' virtual user' + (n === 1 ? '' : 's'); }

  function describeRequests(cfg) {
    var active = activeRequests(cfg);
    if (!active.length) return 'nothing (no request is selected)';
    if (active.length === 1) return active[0].label;
    var pct = weightsOf(cfg);
    if (cfg.mix === 'weighted') {
      return active.length + ' requests mixed by share (' + active.map(function (r, i) {
        return pct[i] + '% ' + r.label;
      }).join(', ') + ')';
    }
    return active.length + ' requests in order (' + active.map(function (r) { return r.label; }).join(' → ') + ')';
  }

  function describeAuth(cfg) {
    var a = cfg.auth;
    if (a.kind === 'none') return 'No credential is sent.';
    if (a.kind === 'csv') {
      return 'Every iteration takes the next credential from ' + a.csv.file +
        ', so a per-key limit is spread over the whole file.';
    }
    if (a.kind === 'static') return 'Each request carries the ' + a.header + ' header you supplied.';
    var when = a.refresh === 'iteration'
      ? 'before every iteration, so the token endpoint carries the same load as the API'
      : a.refresh === 'expiry'
        ? 'once at the start and again whenever it is older than ' + a.ttlMinutes + ' minute' +
          (a.ttlMinutes === 1 ? '' : 's') + ', one thread at a time'
        : 'once before the load starts';
    return 'A token is fetched from ' + a.login.method + ' ' + a.login.url +
      ' ' + when + '. It travels in the ' + a.header + ' header.';
  }

  function describeLoad(cfg) {
    if (cfg.mode === 'spike') {
      return cfg.spike.bursts === 1
        ? cfg.spike.burst + ' requests fired at the same instant'
        : cfg.spike.bursts + ' bursts of ' + cfg.spike.burst + ' simultaneous requests, ' +
          cfg.spike.gap + ' s apart (' + totalRequests(cfg) + ' requests in total)';
    }
    if (cfg.mode === 'quota') {
      return cfg.quota.rpm + ' requests per minute held for ' + forHowLong(cfg.quota.minutes) +
        ' by ' + userCount(cfg.quota.users) + ' (' + totalRequests(cfg) + ' requests in total)';
    }
    var steps = rampSteps(cfg);
    var last = steps[steps.length - 1];
    return steps.length + ' steps of ' + cfg.ramp.stepSeconds + ' s, climbing from ' +
      cfg.ramp.startRpm + ' to ' + (last ? last.rpm : cfg.ramp.startRpm) + ' requests per minute (' +
      totalRequests(cfg) + ' requests in total)';
  }

  function summarize(cfg) {
    var parts = [describeLoad(cfg) + ' against ' + describeRequests(cfg) + '.'];
    parts.push(describeAuth(cfg));
    if (cfg.think.delay || cfg.think.range) {
      parts.push('Each thread waits ' + cfg.think.delay +
        (cfg.think.range ? '–' + (cfg.think.delay + cfg.think.range) : '') + ' ms between requests.');
    }
    if (cfg.checks.maxMs) parts.push('A response slower than ' + cfg.checks.maxMs + ' ms fails.');
    return parts.join(' ');
  }

  function planTitle(doc, cfg) {
    var name = (doc.info && doc.info.title) || 'API';
    if (cfg.mode === 'spike') return name + ' — spike arrest test';
    if (cfg.mode === 'quota') return name + ' — quota / rate limit test';
    return name + ' — ramp until the limit answers';
  }

  function csvDataSet(w, cfg) {
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

  function authHeader(cfg) {
    var a = cfg.auth;
    if (a.kind === 'none') return null;
    if (a.kind === 'csv') return { name: a.header, value: a.prefix + '${' + a.csv.variable + '}' };
    if (a.kind === 'static') {
      return { name: a.header, value: a.prefix + '${__P(token,' + (a.value || 'PASTE_YOUR_TOKEN') + ')}' };
    }
    return { name: a.header, value: a.prefix + '${__P(sduiToken,NO_TOKEN)}' };
  }

  function throughputController(w, req, percent, basePath) {
    el(w, 'ThroughputController', 'ThroughputControllerGui', 'ThroughputController',
      percent + '% — ' + req.label, true);
    // style 1 = percent of executions, shared across all threads.
    w.ip('ThroughputController.style', 1);
    w.bp('ThroughputController.perThread', false);
    w.ip('ThroughputController.maxThroughput', 1);
    w.sp('ThroughputController.percentThroughput', String(percent));
    w.close('</ThroughputController>');
    w.open('<hashTree>');
    sampler(w, req, basePath);
    w.close('</hashTree>');
  }

  /* Everything that hangs under a thread group. Identical for every step of a
     ramp, so the steps differ only in their rate and start delay. */
  function loadBody(w, cfg, rpm) {
    if (cfg.mode === 'spike') {
      // Every thread waits at the timer and they are released together — that
      // is the burst a spike arrest is meant to cut off.
      el(w, 'SyncTimer', 'TestBeanGUI', 'SyncTimer',
        'Release all ' + cfg.spike.burst + ' requests together', true);
      w.ip('groupSize', cfg.spike.burst);
      w.lp('timeoutInMs', 60000);
      w.close('</SyncTimer>');
      w.leaf();
    } else {
      el(w, 'ConstantThroughputTimer', 'TestBeanGUI', 'ConstantThroughputTimer',
        'Hold the rate at ' + rpm + ' requests per minute', true);
      // 2 = the rate applies to all active threads in this thread group.
      w.ip('calcMode', 2);
      w.sp('throughput', cfg.mode === 'quota' ? '${__P(rpm,' + rpm + ')}' : String(rpm));
      w.close('</ConstantThroughputTimer>');
      w.leaf();
    }

    if (cfg.think.delay || cfg.think.range) {
      el(w, 'UniformRandomTimer', 'UniformRandomTimerGui', 'UniformRandomTimer',
        'Think time ' + cfg.think.delay + '–' + (cfg.think.delay + cfg.think.range) + ' ms', true);
      w.sp('ConstantTimer.delay', String(cfg.think.delay));
      w.sp('RandomTimer.range', String(cfg.think.range));
      w.close('</UniformRandomTimer>');
      w.leaf();
    }

    responseAssertion(w, cfg.checks);
    if (cfg.checks.maxMs) durationAssertion(w, cfg.checks.maxMs);

    if (cfg.auth.kind === 'login') {
      if (cfg.auth.refresh === 'expiry') refreshBlock(w, cfg);
      else if (cfg.auth.refresh === 'iteration') tokenRequest(w, cfg);
    }

    var active = activeRequests(cfg);
    var percents = weightsOf(cfg);
    active.forEach(function (req, i) {
      if (cfg.mix === 'weighted' && active.length > 1) {
        throughputController(w, req, percents[i], cfg.target.basePath);
      } else {
        sampler(w, req, cfg.target.basePath);
      }
    });

    if (cfg.mode === 'spike' && cfg.spike.bursts > 1 && cfg.spike.gap > 0) {
      el(w, 'TestAction', 'TestActionGui', 'TestAction',
        'Wait ' + cfg.spike.gap + ' s before the next burst', true);
      w.ip('ActionProcessor.action', 1);
      w.ip('ActionProcessor.target', 0);
      w.sp('ActionProcessor.duration', String(Math.round(cfg.spike.gap * 1000)));
      w.close('</TestAction>');
      w.leaf();
    }
  }

  function threadGroup(w, cfg, spec) {
    el(w, 'ThreadGroup', 'ThreadGroupGui', 'ThreadGroup', spec.name, true);
    w.sp('ThreadGroup.on_sample_error', 'continue');
    loopController(w, spec.loops);
    w.sp('ThreadGroup.num_threads', spec.threads);
    w.sp('ThreadGroup.ramp_time', spec.ramp);
    w.bp('ThreadGroup.scheduler', spec.scheduler);
    w.sp('ThreadGroup.duration', spec.duration);
    w.sp('ThreadGroup.delay', spec.delay);
    w.bp('ThreadGroup.same_user_on_next_iteration', true);
    w.close('</ThreadGroup>');
    w.open('<hashTree>');
    loadBody(w, cfg, spec.rpm);
    w.close('</hashTree>');
  }

  function buildPlan(doc, cfg) {
    if (!cfg.target || !cfg.target.host) throw new Error('no target host — enter the base URL first');
    if (!activeRequests(cfg).length) throw new Error('pick at least one request to send');
    if (cfg.auth.kind === 'login' && !(cfg.auth.login && cfg.auth.login.url)) {
      throw new Error('the token endpoint needs a URL');
    }

    var srv = cfg.target;
    var file = slug(doc) + '-' + cfg.mode + '.jmx';
    var knobs = ['  -Jhost=' + srv.host + ' -Jport=' + srv.port + ' -Jprotocol=' + srv.protocol];
    if (cfg.mode === 'quota') {
      knobs.push('  -Jrpm=' + cfg.quota.rpm + ' -Jduration=' + Math.round(cfg.quota.minutes * 60) +
        ' -Jusers=' + cfg.quota.users);
    }
    if (cfg.auth.kind === 'static') knobs.push('  -Jtoken=YOUR_TOKEN');

    var comments = [
      planTitle(doc, cfg),
      '',
      summarize(cfg),
      cfg.limit ? '' : null,
      cfg.limit ? 'Documented limit: ' + cfg.limit : null,
      '',
      'Run it:',
      '  jmeter -n -t ' + file + ' -l results.jtl',
      'Then count what came back — the code column tells the story:',
      '  awk -F, \'NR>1 {print $3 " " $4}\' results.jtl | sort | uniq -c',
      '',
      'Overrides that need no editing:',
      knobs.join('\n'),
      '',
      '2xx' + (cfg.checks.allow429 ? ' and 429' : '') + ' count as a pass, so a throttled request is a',
      'result rather than an error; anything else fails the assertion.'
    ].filter(function (l) { return l !== null && l !== undefined; }).join('\n');

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

    el(w, 'ConfigTestElement', 'HttpDefaultsGui', 'ConfigTestElement', 'Target — ' + srv.host, true);
    httpArgs(w, [], null);
    w.sp('HTTPSampler.domain', '${__P(host,' + srv.host + ')}');
    w.sp('HTTPSampler.port', '${__P(port,' + srv.port + ')}');
    w.sp('HTTPSampler.protocol', '${__P(protocol,' + srv.protocol + ')}');
    w.sp('HTTPSampler.contentEncoding', 'UTF-8');
    w.sp('HTTPSampler.path', '');
    w.sp('HTTPSampler.implementation', 'HttpClient4');
    w.sp('HTTPSampler.connect_timeout', String(cfg.checks.connectMs || 10000));
    w.sp('HTTPSampler.response_timeout', String(cfg.checks.timeoutMs || 30000));
    w.close('</ConfigTestElement>');
    w.leaf();

    var planHeaders = [{ name: 'Accept', value: 'application/json' }];
    var ah = authHeader(cfg);
    if (ah) planHeaders.push(ah);
    headerManager(w, planHeaders, 'Headers sent with every request');

    if (cfg.cookies) {
      el(w, 'CookieManager', 'CookiePanel', 'CookieManager', 'HTTP Cookie Manager', true);
      w.line('<collectionProp name="CookieManager.cookies"/>');
      w.bp('CookieManager.clearEachIteration', false);
      w.bp('CookieManager.controlledByThreadGroup', false);
      w.sp('CookieManager.policy', 'standard');
      w.close('</CookieManager>');
      w.leaf();
    }

    if (cfg.auth.kind === 'csv') csvDataSet(w, cfg);
    if (cfg.auth.kind === 'login' && cfg.auth.refresh !== 'iteration') setupTokenGroup(w, cfg);

    if (cfg.mode === 'spike') {
      threadGroup(w, cfg, {
        name: 'Spike — ' + cfg.spike.burst + ' at once x ' + cfg.spike.bursts,
        threads: String(cfg.spike.burst), loops: String(cfg.spike.bursts),
        ramp: '1', scheduler: false, duration: '', delay: '0', rpm: 0
      });
    } else if (cfg.mode === 'quota') {
      threadGroup(w, cfg, {
        name: 'Quota — ' + cfg.quota.rpm + ' req/min for ' + forHowLong(cfg.quota.minutes),
        threads: '${__P(users,' + cfg.quota.users + ')}', loops: '-1',
        ramp: String(Math.max(1, cfg.quota.rampup)), scheduler: true,
        duration: '${__P(duration,' + Math.round(cfg.quota.minutes * 60) + ')}',
        delay: '0', rpm: cfg.quota.rpm
      });
    } else {
      // One thread group per step, each starting where the previous one ends:
      // a staircase without any plugin.
      rampSteps(cfg).forEach(function (s) {
        threadGroup(w, cfg, {
          name: 'Step ' + s.index + ' — ' + s.rpm + ' req/min',
          threads: String(cfg.ramp.users), loops: '-1',
          ramp: '1', scheduler: true, duration: String(s.seconds),
          delay: String(s.delay), rpm: s.rpm
        });
      });
    }

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
      total: totalRequests(cfg),
      steps: cfg.mode === 'ramp' ? rampSteps(cfg) : null
    };
  }

  /* ==================================================================
     4. The wizard
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

  function grid(parent) {
    var g = elem('div', 'sdui-wz-grid');
    parent.appendChild(g);
    return g;
  }

  function step(parent, num, title, hint) {
    var s = elem('section', 'sdui-wz-step');
    s.appendChild(elem('h4', null, (typeof num === 'number' ? num + '. ' : num + ' ') + title));
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

  function num(value, min) {
    var n = parseFloat(value);
    if (isNaN(n)) return min;
    return n < min ? min : n;
  }

  function open(opts) {
    var doc = opts.doc;
    var ops = operations(doc);
    if (!ops.length) throw new Error('the document has no operations to test');

    var servers = serverUrls(doc);
    var auth = authOf(doc);
    var login = guessLogin(ops);
    var target = guessTarget(ops, login);

    function loginDefaults(entry) {
      var body = entry ? bodyFor(doc, entry.op.requestBody) : null;
      return {
        source: entry ? entry.id : 'custom',
        url: entry ? entry.path : '/oauth/token',
        method: entry ? entry.method.toUpperCase() : 'POST',
        contentType: (body && body.contentType) || 'application/json',
        body: (body && body.text) ||
          '{\n  "client_id": "",\n  "client_secret": "",\n  "grant_type": "client_credentials"\n}',
        jsonPath: '$.access_token'
      };
    }

    var cfg = {
      mode: 'quota',
      targetUrl: servers[0] || '',
      target: parseBase(servers[0] || ''),
      mix: 'sequence',
      requests: ops.map(function (o) {
        var req = requestFor(doc, o);
        req.on = !!(target && o.id === target.id);
        return req;
      }),
      think: { delay: 0, range: 0 },
      spike: { burst: 50, bursts: 3, gap: 30 },
      quota: { rpm: 600, minutes: 5, users: 10, rampup: 5 },
      ramp: { startRpm: 60, stepRpm: 60, steps: 10, stepSeconds: 30, users: 10 },
      auth: {
        kind: login ? 'login' : (auth.secured ? 'static' : 'none'),
        header: auth.header,
        prefix: auth.prefix,
        value: '',
        refresh: 'once',
        ttlMinutes: 30,
        csv: { file: 'credentials.csv', variable: 'apiKey' },
        login: loginDefaults(login)
      },
      checks: { allow429: true, allow3xx: false, extraCodes: '', maxMs: 0, connectMs: 10000, timeoutMs: 30000 },
      cookies: false,
      limit: ''
    };

    /* ----- shell ----- */
    var overlay = elem('div', 'sdui-modal-overlay');
    var modal = elem('div', 'sdui-modal sdui-wizard');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'JMeter test plan');
    var head = elem('div', 'sdui-modal-head');
    head.appendChild(elem('span', null, 'JMeter scenario — ' + ((doc.info && doc.info.title) || 'API')));
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

    var summaryBox = null;
    function refreshSummary() {
      if (!summaryBox) return;
      summaryBox.textContent = summarize(cfg);
      note.textContent = problem() || '';
    }

    /* What still stands between these answers and a plan that runs. */
    function problem() {
      if (!cfg.target) return 'Enter the base URL of the API you want to test.';
      if (!activeRequests(cfg).length) return 'Tick at least one request.';
      if (cfg.auth.kind === 'login' && !cfg.auth.login.url) return 'The token endpoint needs a URL.';
      if (cfg.auth.kind === 'csv' && !cfg.auth.csv.file) return 'Name the CSV file the credentials come from.';
      return '';
    }

    function entryById(id) {
      var hit = null;
      ops.forEach(function (o) { if (o.id === id) hit = o; });
      return hit;
    }

    /* ----- request list ----- */
    function renderRequests(host) {
      host.innerHTML = '';
      cfg.requests.forEach(function (req) {
        var row = elem('div', 'sdui-wz-req');
        var rowHead = elem('div', 'sdui-wz-req-head');
        var label = elem('label', 'sdui-wz-req-label');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = req.on;
        label.appendChild(box);
        var name = elem('span', 'sdui-wz-req-name', req.label);
        label.appendChild(name);
        if (req.summary) label.appendChild(elem('span', 'sdui-wz-req-sum', req.summary));
        rowHead.appendChild(label);
        box.addEventListener('change', function () { req.on = box.checked; refreshSummary(); });

        if (cfg.mix === 'weighted') {
          var weight = numberBox(req.weight, 0);
          weight.className = 'sdui-wz-weight';
          weight.title = 'Share of the traffic';
          weight.addEventListener('input', function () {
            req.weight = num(weight.value, 0);
            refreshSummary();
          });
          rowHead.appendChild(weight);
        }

        var detail = elem('div', 'sdui-wz-req-body');
        detail.hidden = true;
        var toggle = elem('button', 'sdui-wz-link', 'values');
        toggle.type = 'button';
        toggle.addEventListener('click', function () { detail.hidden = !detail.hidden; });
        rowHead.appendChild(toggle);
        if (req.custom) {
          var drop = elem('button', 'sdui-wz-link', 'remove');
          drop.type = 'button';
          drop.addEventListener('click', function () {
            cfg.requests = cfg.requests.filter(function (r) { return r !== req; });
            renderRequests(host);
            refreshSummary();
          });
          rowHead.appendChild(drop);
        }
        row.appendChild(rowHead);

        if (req.custom) {
          var cg = grid(detail);
          var mSel = field(cg, 'Method', dropdown(
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(function (m) { return { value: m, label: m }; }),
            req.method));
          var uBox = field(cg, 'Full URL', textBox(req.url),
            'https://another-api.example.com/v2/things');
          mSel.addEventListener('change', function () {
            req.method = mSel.value;
            req.label = req.method + ' ' + req.url;
            name.textContent = req.label;
            refreshSummary();
          });
          uBox.addEventListener('input', function () {
            req.url = uBox.value.trim();
            req.label = req.method + ' ' + req.url;
            name.textContent = req.label;
            refreshSummary();
          });
          var cta = document.createElement('textarea');
          cta.rows = 3;
          cta.spellcheck = false;
          cta.value = req.body ? req.body.text : '';
          field(detail, 'Body (JSON, leave empty for none)', cta);
          cta.addEventListener('input', function () {
            req.body = cta.value ? { contentType: 'application/json', text: cta.value } : null;
          });
        } else {
          if (req.pathParams.length || req.query.length) {
            var vg = grid(detail);
            req.pathParams.forEach(function (p) {
              var pb = field(vg, 'Path · ' + p.name, textBox(p.value));
              pb.addEventListener('input', function () { p.value = pb.value; });
            });
            req.query.forEach(function (q) {
              var qb = field(vg, 'Query · ' + q.name, textBox(q.value));
              qb.addEventListener('input', function () { q.value = qb.value; });
            });
          }
          if (req.body) {
            var ta = document.createElement('textarea');
            ta.rows = 4;
            ta.spellcheck = false;
            ta.value = req.body.text;
            field(detail, 'Body (' + req.body.contentType + ')', ta,
              /multipart/.test(req.body.contentType)
                ? 'Each key becomes a form field; file uploads have to be added in JMeter.'
                : 'Sent exactly as written.');
            ta.addEventListener('input', function () { req.body.text = ta.value; });
          }
          if (!req.pathParams.length && !req.query.length && !req.body) {
            detail.appendChild(elem('p', 'sdui-wz-hint', 'This request takes no values.'));
          }
        }
        row.appendChild(detail);
        host.appendChild(row);
      });
    }

    /* ----- the form ----- */
    function render() {
      body.innerHTML = '';

      /* 1 — where */
      var s1 = step(body, 1, 'Which host is under test?',
        servers.length
          ? 'Taken from the document; change it to point the same scenario at staging or production.'
          : 'This document does not say where the API lives, so nothing can be assumed — type the base URL you want to hit.');
      if (servers.length > 1) {
        var ssel = dropdown(servers.map(function (u) { return { value: u, label: u }; })
          .concat([{ value: '', label: 'Another URL…' }]), cfg.targetUrl);
        field(s1, 'Server from the document', ssel);
        ssel.addEventListener('change', function () {
          cfg.targetUrl = ssel.value;
          cfg.target = parseBase(cfg.targetUrl);
          render();
        });
      }
      var urlBox = field(s1, 'Base URL', textBox(cfg.targetUrl),
        'Scheme, host, optional port and the common path prefix — https://api.acme.com/v1');
      urlBox.addEventListener('input', function () {
        cfg.targetUrl = urlBox.value.trim();
        cfg.target = parseBase(cfg.targetUrl);
        urlBox.className = cfg.target || !cfg.targetUrl ? '' : 'sdui-wz-bad';
        refreshSummary();
      });
      if (!cfg.target && !cfg.targetUrl) urlBox.placeholder = 'https://api.example.com/v1';

      /* 2 — what shape */
      var s2 = step(body, 2, 'What kind of run?',
        'This decides the shape of the traffic — a wall at one instant, a held rate, or a climb.');
      choiceCards(s2, 'sdui-wz-mode', [
        { value: 'spike', title: 'Spike arrest', desc: 'A burst released at the same instant, repeated as often as you like. Shows the per-second cap.' },
        { value: 'quota', title: 'Quota / rate limit', desc: 'A steady rate held for a set time. Shows where a per-minute or per-hour quota runs out.' },
        { value: 'ramp', title: 'Ramp until it breaks', desc: 'Steps the rate up until the 429s start. The step where they begin is the limit.' }
      ], cfg.mode, function (v) { cfg.mode = v; render(); });

      var g2 = grid(s2);
      if (cfg.mode === 'spike') {
        var burst = field(g2, 'Requests per burst', numberBox(cfg.spike.burst, 1),
          'All of them leave at the same instant.');
        var bursts = field(g2, 'How many bursts', numberBox(cfg.spike.bursts, 1));
        var gap = field(g2, 'Seconds between bursts', numberBox(cfg.spike.gap, 0),
          'Long enough for the window to reset, if you want each burst judged on its own.');
        burst.addEventListener('input', function () { cfg.spike.burst = num(burst.value, 1); refreshSummary(); });
        bursts.addEventListener('input', function () { cfg.spike.bursts = num(bursts.value, 1); refreshSummary(); });
        gap.addEventListener('input', function () { cfg.spike.gap = num(gap.value, 0); refreshSummary(); });
      } else if (cfg.mode === 'quota') {
        var rpm = field(g2, 'Requests per minute', numberBox(cfg.quota.rpm, 1),
          'The whole run holds this rate, not each user.');
        var mins = field(g2, 'For how many minutes', numberBox(cfg.quota.minutes, 0.5, 0.5),
          'A quota window is only proven once you run past it — 60 for an hourly limit.');
        var vu = field(g2, 'Virtual users', numberBox(cfg.quota.users, 1),
          'One user cannot beat its own round-trip time; add users until they can carry the rate.');
        var ramp = field(g2, 'Ramp-up seconds', numberBox(cfg.quota.rampup, 1),
          'Users join over this many seconds instead of all at once.');
        rpm.addEventListener('input', function () { cfg.quota.rpm = num(rpm.value, 1); refreshSummary(); });
        mins.addEventListener('input', function () { cfg.quota.minutes = num(mins.value, 0.1); refreshSummary(); });
        vu.addEventListener('input', function () { cfg.quota.users = num(vu.value, 1); refreshSummary(); });
        ramp.addEventListener('input', function () { cfg.quota.rampup = num(ramp.value, 1); });
      } else {
        var start = field(g2, 'Start at (req/min)', numberBox(cfg.ramp.startRpm, 1));
        var stepBy = field(g2, 'Add per step (req/min)', numberBox(cfg.ramp.stepRpm, 1));
        var steps = field(g2, 'How many steps', numberBox(cfg.ramp.steps, 1),
          'Each step is its own thread group, so the report shows them apart.');
        var secs = field(g2, 'Seconds per step', numberBox(cfg.ramp.stepSeconds, 5));
        var ru = field(g2, 'Virtual users per step', numberBox(cfg.ramp.users, 1),
          'Has to be enough to carry the highest step.');
        start.addEventListener('input', function () { cfg.ramp.startRpm = num(start.value, 1); refreshSummary(); });
        stepBy.addEventListener('input', function () { cfg.ramp.stepRpm = num(stepBy.value, 0); refreshSummary(); });
        steps.addEventListener('input', function () { cfg.ramp.steps = Math.round(num(steps.value, 1)); refreshSummary(); });
        secs.addEventListener('input', function () { cfg.ramp.stepSeconds = Math.round(num(secs.value, 5)); refreshSummary(); });
        ru.addEventListener('input', function () { cfg.ramp.users = num(ru.value, 1); refreshSummary(); });
      }
      if (cfg.mode !== 'spike') {
        var g2b = grid(s2);
        var think = field(g2b, 'Think time between requests (ms)', numberBox(cfg.think.delay, 0),
          'Zero keeps the rate purely in the pacing timer.');
        var jitter = field(g2b, 'Random extra (ms)', numberBox(cfg.think.range, 0),
          'Added at random on top, so threads do not march in lockstep.');
        think.addEventListener('input', function () { cfg.think.delay = Math.round(num(think.value, 0)); refreshSummary(); });
        jitter.addEventListener('input', function () { cfg.think.range = Math.round(num(jitter.value, 0)); refreshSummary(); });
      }

      /* 3 — what traffic */
      var s3 = step(body, 3, 'Which requests take part?',
        'Tick everything the scenario should send. Several endpoints — or a request from a completely different API — can run in the same plan.');
      choiceCards(s3, 'sdui-wz-mix', [
        { value: 'sequence', title: 'In order', desc: 'Every iteration walks the ticked requests top to bottom — a user journey.' },
        { value: 'weighted', title: 'By share', desc: 'Each request gets a share of the traffic, so the mix matches production.' }
      ], cfg.mix, function (v) { cfg.mix = v; render(); });

      var tools = elem('div', 'sdui-wz-reqtools');
      var all = elem('button', 'sdui-wz-link', 'select all');
      all.type = 'button';
      var none = elem('button', 'sdui-wz-link', 'select none');
      none.type = 'button';
      var add = elem('button', 'sdui-wz-link', '+ request from another API');
      add.type = 'button';
      tools.appendChild(all);
      tools.appendChild(none);
      tools.appendChild(add);
      s3.appendChild(tools);
      var reqHost = elem('div', 'sdui-wz-reqs');
      s3.appendChild(reqHost);
      renderRequests(reqHost);
      all.addEventListener('click', function () {
        cfg.requests.forEach(function (r) { r.on = true; });
        renderRequests(reqHost);
        refreshSummary();
      });
      none.addEventListener('click', function () {
        cfg.requests.forEach(function (r) { r.on = false; });
        renderRequests(reqHost);
        refreshSummary();
      });
      add.addEventListener('click', function () {
        cfg.requests.push(customRequest(''));
        renderRequests(reqHost);
        refreshSummary();
      });

      /* 4 — credentials */
      var s4 = step(body, 4, 'What credential do the requests carry?',
        'Rate limits are counted per credential, so this is what decides whose limit you are measuring.');
      choiceCards(s4, 'sdui-wz-auth', [
        { value: 'login', title: 'Fetch a token', desc: 'Call the token endpoint and reuse what it returns.' },
        { value: 'static', title: 'I have one', desc: 'Paste a token or API key; -Jtoken overrides it at run time.' },
        { value: 'csv', title: 'Many keys from a CSV', desc: 'Each iteration takes the next line — the way to prove a per-key limit.' },
        { value: 'none', title: 'None', desc: 'Open endpoint, or the limiter counts by IP.' }
      ], cfg.auth.kind, function (v) { cfg.auth.kind = v; render(); });

      if (cfg.auth.kind !== 'none') {
        var gh = grid(s4);
        var hn = field(gh, 'Header', textBox(cfg.auth.header));
        var hp = field(gh, 'Value prefix', textBox(cfg.auth.prefix), 'Empty for a bare API key.');
        hn.addEventListener('input', function () { cfg.auth.header = hn.value; refreshSummary(); });
        hp.addEventListener('input', function () { cfg.auth.prefix = hp.value; });
      }

      if (cfg.auth.kind === 'static') {
        var sv = field(s4, 'Token / key', textBox(cfg.auth.value), 'Override at run time with -Jtoken=…');
        sv.addEventListener('input', function () { cfg.auth.value = sv.value; });
      }

      if (cfg.auth.kind === 'csv') {
        var gc = grid(s4);
        var cf = field(gc, 'CSV file next to the .jmx', textBox(cfg.auth.csv.file),
          'One credential per line; the file is shared by all threads and recycled.');
        var cv = field(gc, 'Column name', textBox(cfg.auth.csv.variable));
        cf.addEventListener('input', function () { cfg.auth.csv.file = cf.value.trim(); refreshSummary(); });
        cv.addEventListener('input', function () { cfg.auth.csv.variable = cv.value.trim() || 'apiKey'; });
      }

      if (cfg.auth.kind === 'login') {
        var lg = cfg.auth.login;
        var lsel = dropdown(ops.map(function (o) {
          return { value: o.id, label: o.method.toUpperCase() + ' ' + o.path + (o.summary ? '  —  ' + o.summary : '') };
        }).concat([{ value: 'custom', label: 'Another URL — not in this document' }]), lg.source);
        field(s4, 'Token endpoint', lsel);
        lsel.addEventListener('change', function () {
          var entry = lsel.value === 'custom' ? null : entryById(lsel.value);
          cfg.auth.login = loginDefaults(entry);
          cfg.auth.login.source = lsel.value;
          render();
        });
        var gl = grid(s4);
        var lu = field(gl, 'URL or path', textBox(lg.url),
          'A path uses the host above; a full https:// URL calls its own host.');
        var lm = field(gl, 'Method', dropdown(
          ['POST', 'GET', 'PUT'].map(function (m) { return { value: m, label: m }; }), lg.method));
        var lc = field(gl, 'Content type', dropdown([
          { value: 'application/json', label: 'application/json' },
          { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' }
        ], lg.contentType));
        var lj = field(gl, 'Token field in the response', textBox(lg.jsonPath),
          'JSON path — $.access_token, $.data.token …');
        lu.addEventListener('input', function () { lg.url = lu.value.trim(); refreshSummary(); });
        lm.addEventListener('change', function () { lg.method = lm.value; refreshSummary(); });
        lc.addEventListener('change', function () {
          lg.contentType = lc.value;
          lg.body = /x-www-form-urlencoded/.test(lg.contentType) ? asForm(lg.body) : asJson(lg.body);
          render();
        });
        lj.addEventListener('input', function () { lg.jsonPath = lj.value.trim(); });
        var lta = document.createElement('textarea');
        lta.rows = 4;
        lta.spellcheck = false;
        lta.value = lg.body;
        field(s4, 'Credentials sent to that endpoint', lta,
          'The real client id / secret — this is the identity being rate limited.');
        lta.addEventListener('input', function () { lg.body = lta.value; });

        var gt = grid(s4);
        var ttl = field(gt, 'Token valid for (minutes)', numberBox(cfg.auth.ttlMinutes, 1),
          'From expires_in ÷ 60 if the endpoint returns one.');
        ttl.addEventListener('input', function () { cfg.auth.ttlMinutes = num(ttl.value, 1); refreshSummary(); });
        var rsel = field(gt, 'When is it fetched?', dropdown([
          { value: 'once', label: 'Once, before the run' },
          { value: 'expiry', label: 'Again when it expires' },
          { value: 'iteration', label: 'Before every iteration' }
        ], cfg.auth.refresh), refreshHint(cfg.auth.refresh, cfg));
        rsel.addEventListener('change', function () { cfg.auth.refresh = rsel.value; render(); });
      }

      /* 5 — what counts as a pass */
      var s5 = step(body, 5, 'What counts as a pass?',
        'JMeter fails every non-2xx sample on its own; this is where you say which codes are a result rather than a fault.');
      checkbox(s5, 'A 429 is a result, not an error', cfg.checks.allow429, function (v) {
        cfg.checks.allow429 = v;
        refreshSummary();
      }, 'Keep this on for any rate-limit test — otherwise the run drowns in false failures.');
      checkbox(s5, 'Redirects (3xx) pass too', cfg.checks.allow3xx, function (v) { cfg.checks.allow3xx = v; });
      checkbox(s5, 'Send and keep cookies', cfg.cookies, function (v) { cfg.cookies = v; },
        'Needed when the API hands out a session or sits behind a sticky load balancer.');
      var g5 = grid(s5);
      var extra = field(g5, 'Other codes that pass', textBox(cfg.checks.extraCodes), 'e.g. 404 403');
      var slow = field(g5, 'Fail slower than (ms, 0 = off)', numberBox(cfg.checks.maxMs, 0));
      var ct = field(g5, 'Connect timeout (ms)', numberBox(cfg.checks.connectMs, 100));
      var rt = field(g5, 'Response timeout (ms)', numberBox(cfg.checks.timeoutMs, 100));
      var lim = field(g5, 'Documented limit (optional)', textBox(cfg.limit),
        'Written into the plan — "100 req/min per key".');
      extra.addEventListener('input', function () { cfg.checks.extraCodes = extra.value; });
      slow.addEventListener('input', function () { cfg.checks.maxMs = Math.round(num(slow.value, 0)); refreshSummary(); });
      ct.addEventListener('input', function () { cfg.checks.connectMs = Math.round(num(ct.value, 100)); });
      rt.addEventListener('input', function () { cfg.checks.timeoutMs = Math.round(num(rt.value, 100)); });
      lim.addEventListener('input', function () { cfg.limit = lim.value; });

      var sum = elem('section', 'sdui-wz-step');
      sum.appendChild(elem('h4', null, 'What will run'));
      summaryBox = elem('div', 'sdui-wz-summary', '');
      sum.appendChild(summaryBox);
      body.appendChild(sum);
      refreshSummary();
    }

    function refreshHint(mode, conf) {
      if (mode === 'iteration') return 'The token endpoint then carries the same load as the API — that is a test of its own limit.';
      if (mode === 'expiry') return 'One thread refreshes at a time; the others keep using the current token.';
      return 'Fine while the run is shorter than the token\'s life (' + conf.auth.ttlMinutes + ' min).';
    }

    /* ----- result panel ----- */
    function showResult(plan) {
      body.innerHTML = '';
      var done = step(body, '✔', 'Downloaded — ' + plan.file);
      done.appendChild(elem('div', 'sdui-wz-summary', plan.summary));

      var runStep = step(body, 1, 'Run it');
      runStep.appendChild(elem('pre', 'sdui-wz-cmd', plan.command));
      runStep.appendChild(elem('p', 'sdui-wz-hint',
        'Or open it in the JMeter GUI and press Start — nothing needs editing first.' +
        (cfg.auth.kind === 'csv' ? ' Put ' + cfg.auth.csv.file + ' next to the .jmx before you start.' : '')));

      var readStep = step(body, 2, 'Read the result');
      readStep.appendChild(elem('pre', 'sdui-wz-cmd',
        'awk -F, \'NR>1 {print $3 " " $4}\' results.jtl | sort | uniq -c'));
      var list = elem('ul', 'sdui-wz-list');
      [
        '2xx — the request was allowed through.',
        '429 — the limiter answered. Where the 429s start is the limit.',
        'Anything else fails the assertion and is a real error, not throttling.',
        plan.steps
          ? 'The steps climb ' + plan.steps.map(function (s) { return s.rpm; }).join(' → ') +
            ' req/min; compare the 429 count per step.'
          : 'This run sends about ' + plan.total + ' requests in total.'
      ].forEach(function (t) { list.appendChild(elem('li', null, t)); });
      readStep.appendChild(list);

      note.textContent = '';
      actions.innerHTML = '';
      var copy = elem('button', 'sdui-tool-btn', 'Copy command');
      copy.type = 'button';
      copy.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plan.command).then(function () { copy.textContent = 'Copied'; }, function () {});
        }
      });
      var again = elem('button', 'sdui-tool-btn', 'Change and rebuild');
      again.type = 'button';
      again.addEventListener('click', function () {
        actions.innerHTML = '';
        actions.appendChild(cancel);
        actions.appendChild(generate);
        render();
      });
      var ok = elem('button', 'sdui-tool-btn sdui-wz-primary', 'Done');
      ok.type = 'button';
      ok.addEventListener('click', dismiss);
      actions.appendChild(copy);
      actions.appendChild(again);
      actions.appendChild(ok);
    }

    generate.addEventListener('click', function () {
      var blocker = problem();
      if (blocker) { note.textContent = blocker; return; }
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
      operations: operations, servers: serverUrls, parseBase: parseBase, auth: authOf,
      guessLogin: guessLogin, guessTarget: guessTarget, request: requestFor,
      custom: customRequest, body: bodyFor
    }
  };
})();

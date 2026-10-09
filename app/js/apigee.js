/* OASForge — Apigee Edge policy reader.
   Paste the XML of a Quota or SpikeArrest policy (one, several, or a whole
   proxy bundle) and this turns it into numbers the JMeter generator can plan
   around: how many requests the window allows, how long the window is and
   when it resets, whether the counter is per client or for the whole proxy,
   how exact the counter is, and what the fault looks like when the limit is
   hit. API-product quota JSON ({"quota":"1000","quotaInterval":"1",
   "quotaTimeUnit":"month"}) is accepted too, because that is where the
   numbers live when the policy says UseQuotaConfigInAPIProduct.

   No DOM dependency: the tiny XML reader below runs in the browser and in
   Node alike, so the parser can be unit-tested without a browser. */
(function (root) {
  'use strict';

  var UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 };

  /* ==================================================================
     1. A small XML reader — elements, attributes, text; comments, CDATA
        and processing instructions are skipped.
     ================================================================== */

  function parseXml(text) {
    var src = String(text || '');
    var pos = 0;
    var rootNode = { name: '#root', attrs: {}, children: [], text: '' };
    var stack = [rootNode];
    var errors = [];

    function cur() { return stack[stack.length - 1]; }
    function addText(t) { if (t) cur().text += t; }

    while (pos < src.length) {
      var lt = src.indexOf('<', pos);
      if (lt === -1) { addText(src.slice(pos)); break; }
      addText(src.slice(pos, lt));
      if (src.startsWith('<!--', lt)) {
        var ce = src.indexOf('-->', lt + 4);
        pos = ce === -1 ? src.length : ce + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', lt)) {
        var cd = src.indexOf(']]>', lt + 9);
        addText(src.slice(lt + 9, cd === -1 ? src.length : cd));
        pos = cd === -1 ? src.length : cd + 3;
        continue;
      }
      if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
        var pe = src.indexOf('>', lt);
        pos = pe === -1 ? src.length : pe + 1;
        continue;
      }
      var gt = findTagEnd(src, lt);
      if (gt === -1) { errors.push('unterminated tag near "' + src.slice(lt, lt + 30) + '"'); break; }
      var tag = src.slice(lt + 1, gt);
      pos = gt + 1;
      if (tag.charAt(0) === '/') {
        var closing = tag.slice(1).trim();
        if (stack.length > 1 && cur().name === closing) stack.pop();
        else errors.push('unexpected closing tag </' + closing + '>');
        continue;
      }
      var selfClosing = /\/\s*$/.test(tag);
      if (selfClosing) tag = tag.replace(/\/\s*$/, '');
      var m = tag.match(/^\s*([^\s/>]+)([\s\S]*)$/);
      if (!m) { errors.push('malformed tag <' + tag + '>'); continue; }
      var node = { name: m[1], attrs: parseAttrs(m[2]), children: [], text: '' };
      cur().children.push(node);
      if (!selfClosing) stack.push(node);
    }
    if (stack.length > 1) errors.push('unclosed element <' + cur().name + '>');
    return { root: rootNode, errors: errors };
  }

  /* The ">" that ends a tag, skipping any ">" inside a quoted attribute. */
  function findTagEnd(src, from) {
    var quote = null;
    for (var i = from + 1; i < src.length; i++) {
      var c = src.charAt(i);
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') return i;
    }
    return -1;
  }

  function parseAttrs(s) {
    var attrs = {};
    var re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
    var m;
    while ((m = re.exec(s))) {
      attrs[m[1]] = unescapeXml(m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]));
    }
    return attrs;
  }

  function unescapeXml(s) {
    return String(s).replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, function (all, ent) {
      if (ent === 'lt') return '<';
      if (ent === 'gt') return '>';
      if (ent === 'amp') return '&';
      if (ent === 'quot') return '"';
      if (ent === 'apos') return "'";
      if (ent.charAt(0) === '#') {
        var code = ent.charAt(1).toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return isNaN(code) ? all : String.fromCharCode(code);
      }
      return all;
    });
  }

  function walk(node, fn) {
    node.children.forEach(function (c) { fn(c); walk(c, fn); });
  }

  function child(node, name) {
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].name.toLowerCase() === name.toLowerCase()) return node.children[i];
    }
    return null;
  }

  function textOf(node) { return node ? unescapeXml(node.text).trim() : ''; }
  function attr(node, name) {
    if (!node) return undefined;
    var keys = Object.keys(node.attrs);
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name.toLowerCase()) return node.attrs[keys[i]];
    return undefined;
  }
  function bool(s, dflt) {
    if (s === undefined || s === null || s === '') return dflt;
    return /^(true|yes|1)$/i.test(String(s).trim());
  }
  function int(s) {
    var n = parseInt(String(s === undefined || s === null ? '' : s).trim(), 10);
    return isNaN(n) ? null : n;
  }

  /* ==================================================================
     2. The policies
     ================================================================== */

  function readQuota(node) {
    var allow = child(node, 'Allow');
    var interval = child(node, 'Interval');
    var unit = child(node, 'TimeUnit');
    var ident = child(node, 'Identifier');
    var weight = child(node, 'MessageWeight');
    var asyncCfg = child(node, 'AsynchronousConfiguration');
    var typeAttr = (attr(node, 'type') || '').trim().toLowerCase();
    var classes = [];
    var classRef = null;
    if (allow) {
      var cls = child(allow, 'Class');
      if (cls) {
        classRef = attr(cls, 'ref') || null;
        cls.children.forEach(function (c) {
          if (c.name.toLowerCase() === 'allow') {
            classes.push({ name: attr(c, 'class') || '', count: int(attr(c, 'count')) });
          }
        });
      }
    }
    var startText = textOf(child(node, 'StartTime')) || null;
    return {
      kind: 'quota',
      name: attr(node, 'name') || 'Quota',
      displayName: textOf(child(node, 'DisplayName')) || attr(node, 'name') || 'Quota',
      enabled: bool(attr(node, 'enabled'), true),
      continueOnError: bool(attr(node, 'continueOnError'), false),
      type: /^(calendar|rollingwindow|flexi)$/.test(typeAttr) ? typeAttr : 'default',
      allow: { count: allow ? int(attr(allow, 'count')) : null, ref: allow ? (attr(allow, 'countRef') || null) : null },
      classRef: classRef,
      classes: classes,
      interval: { value: int(textOf(interval)), ref: interval ? (attr(interval, 'ref') || null) : null },
      timeUnit: { value: textOf(unit).toLowerCase() || null, ref: unit ? (attr(unit, 'ref') || null) : null },
      startTime: startText,
      startMs: parseStartTime(startText),
      distributed: bool(textOf(child(node, 'Distributed')), false),
      synchronous: bool(textOf(child(node, 'Synchronous')), false),
      syncIntervalSeconds: asyncCfg ? int(textOf(child(asyncCfg, 'SyncIntervalInSeconds'))) : null,
      syncMessageCount: asyncCfg ? int(textOf(child(asyncCfg, 'SyncMessageCount'))) : null,
      identifier: ident ? { ref: attr(ident, 'ref') || null } : null,
      messageWeight: weight ? { ref: attr(weight, 'ref') || null } : null,
      useProductConfig: !!child(node, 'UseQuotaConfigInAPIProduct'),
      productStep: child(node, 'UseQuotaConfigInAPIProduct')
        ? (attr(child(node, 'UseQuotaConfigInAPIProduct'), 'stepName') || '') : ''
    };
  }

  function parseStartTime(s) {
    if (!s) return null;
    var m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  function readSpike(node) {
    var rate = child(node, 'Rate');
    var text = textOf(rate);
    var m = text.match(/^(\d+)\s*(ps|pm)$/i);
    var ident = child(node, 'Identifier');
    var weight = child(node, 'MessageWeight');
    return {
      kind: 'spike',
      name: attr(node, 'name') || 'SpikeArrest',
      displayName: textOf(child(node, 'DisplayName')) || attr(node, 'name') || 'Spike Arrest',
      enabled: bool(attr(node, 'enabled'), true),
      continueOnError: bool(attr(node, 'continueOnError'), false),
      rate: {
        count: m ? parseInt(m[1], 10) : null,
        per: m ? m[2].toLowerCase().charAt(1) : null, // 's' or 'm'
        text: text || null,
        ref: rate ? (attr(rate, 'ref') || null) : null
      },
      identifier: ident ? { ref: attr(ident, 'ref') || null } : null,
      messageWeight: weight ? { ref: attr(weight, 'ref') || null } : null,
      useEffectiveCount: bool(textOf(child(node, 'UseEffectiveCount')), false)
    };
  }

  function readConcurrent(node) {
    return {
      kind: 'concurrent',
      name: attr(node, 'name') || 'ConcurrentRatelimit',
      displayName: textOf(child(node, 'DisplayName')) || attr(node, 'name') || 'Concurrent Rate Limit',
      enabled: bool(attr(node, 'enabled'), true),
      allow: int(attr(child(node, 'AllowConnections'), 'count'))
    };
  }

  /* An API product's quota, as the management API / UI export it. */
  function readProductJson(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    var p = o.apiProduct || o;
    if (p.quota === undefined && p.quotaInterval === undefined) return null;
    return {
      kind: 'quota',
      source: 'product',
      name: p.name || 'API product quota',
      displayName: p.displayName || p.name || 'API product quota',
      enabled: true,
      continueOnError: false,
      type: 'default',
      allow: { count: int(p.quota), ref: null },
      classRef: null,
      classes: [],
      interval: { value: int(p.quotaInterval), ref: null },
      timeUnit: { value: String(p.quotaTimeUnit || '').toLowerCase() || null, ref: null },
      startTime: null,
      startMs: null,
      distributed: true,
      synchronous: false,
      syncIntervalSeconds: null,
      syncMessageCount: null,
      // A product quota is counted per app (its consumer key).
      identifier: { ref: 'client_id' },
      messageWeight: null,
      useProductConfig: false,
      productStep: ''
    };
  }

  function parse(text) {
    var out = { policies: [], errors: [], warnings: [] };
    var trimmed = String(text || '').trim();
    if (!trimmed) return out;

    var product = readProductJson(trimmed);
    if (product) { out.policies.push(product); return out; }

    var xml = parseXml(trimmed);
    out.errors = xml.errors.slice();
    walk(xml.root, function (node) {
      var n = node.name.toLowerCase();
      if (n === 'quota') out.policies.push(readQuota(node));
      else if (n === 'spikearrest') out.policies.push(readSpike(node));
      else if (n === 'concurrentratelimit') out.policies.push(readConcurrent(node));
    });
    if (!out.policies.length && !out.errors.length) {
      out.errors.push('no <Quota>, <SpikeArrest> or <ConcurrentRatelimit> element found');
    }
    out.policies.forEach(function (p) {
      if (p.enabled === false) out.warnings.push(p.displayName + ' is disabled (enabled="false") — it will not fire.');
      if (p.continueOnError) out.warnings.push(p.displayName + ' has continueOnError="true": a violation sets a flow variable but does not reject the request on its own.');
      if (p.kind === 'quota' && p.timeUnit.value === 'second' && p.distributed) {
        out.warnings.push(p.displayName + ': a "second" time unit is only valid when Distributed is false.');
      }
      if (p.kind === 'quota' && p.type === 'calendar' && !p.startMs) {
        out.warnings.push(p.displayName + ' is type="calendar" without a valid StartTime (yyyy-MM-dd HH:mm:ss).');
      }
      if (p.kind === 'concurrent') {
        out.warnings.push(p.displayName + ' (ConcurrentRatelimit) is deprecated and caps open connections, not a rate; no scenario is generated for it.');
      }
    });
    return out;
  }

  /* ==================================================================
     3. What the numbers mean
     ================================================================== */

  /* Values the policy reads from flow variables at run time. The wizard has
     to ask for those — the XML alone does not know them. */
  function unresolved(p) {
    var out = [];
    if (p.kind === 'quota') {
      if (p.useProductConfig) {
        out.push({ key: 'allow', label: 'Quota from the API product', hint: 'UseQuotaConfigInAPIProduct — the count, interval and unit come from the product, not from this XML. Paste the product JSON instead, or type them here.', type: 'number' });
        out.push({ key: 'interval', label: 'Interval (from the product)', type: 'number' });
        out.push({ key: 'unit', label: 'Time unit (from the product)', type: 'unit' });
      }
      if (p.allow.ref && p.allow.count === null) out.push({ key: 'allow', label: 'Allow count (' + p.allow.ref + ')', hint: 'countRef — the limit is read from a flow variable at run time.', type: 'number' });
      else if (p.allow.ref) out.push({ key: 'allow', label: 'Allow count (' + p.allow.ref + ', falls back to ' + p.allow.count + ')', hint: 'countRef takes priority when the variable is set.', type: 'number', optional: true, fallback: p.allow.count });
      if (p.classRef) out.push({ key: 'allow', label: 'Allow count for the class under test (' + p.classRef + ')', hint: 'One counter per class — the scenario tests one class.', type: 'number', optional: true, choices: p.classes });
      if (p.interval.ref && p.interval.value === null) out.push({ key: 'interval', label: 'Interval (' + p.interval.ref + ')', type: 'number' });
      if (p.timeUnit.ref && !p.timeUnit.value) out.push({ key: 'unit', label: 'Time unit (' + p.timeUnit.ref + ')', type: 'unit' });
      if (p.messageWeight && p.messageWeight.ref) out.push({ key: 'weight', label: 'Message weight (' + p.messageWeight.ref + ')', hint: 'Each request counts this many times. 1 unless the test sends the variable.', type: 'number', optional: true, fallback: 1 });
    } else if (p.kind === 'spike') {
      if (p.rate.ref && p.rate.count === null) out.push({ key: 'rate', label: 'Rate (' + p.rate.ref + ')', hint: 'e.g. 30ps or 12pm', type: 'rate' });
      else if (p.rate.ref) out.push({ key: 'rate', label: 'Rate (' + p.rate.ref + ', falls back to ' + p.rate.text + ')', type: 'rate', optional: true, fallback: p.rate.text });
      if (p.messageWeight && p.messageWeight.ref) out.push({ key: 'weight', label: 'Message weight (' + p.messageWeight.ref + ')', type: 'number', optional: true, fallback: 1 });
    }
    return out;
  }

  /* The policy with the run-time values filled in. `values` is what the
     wizard collected for unresolved()'s keys; `env` carries what only the
     deployment knows (message processors). */
  function resolve(p, values, env) {
    values = values || {};
    env = env || {};
    var mps = Math.max(1, int(env.mps) || 1);
    if (p.kind === 'quota') {
      var allow = int(values.allow);
      if (allow === null) allow = p.allow.count;
      if (allow === null && p.classes.length) allow = p.classes[0].count;
      var interval = int(values.interval);
      if (interval === null) interval = p.interval.value;
      var unit = (values.unit || p.timeUnit.value || '').toLowerCase();
      var weight = Math.max(1, int(values.weight) || 1);
      var windowSeconds = interval && UNIT_SECONDS[unit] ? interval * UNIT_SECONDS[unit] : null;
      var perRequest = allow !== null ? Math.floor(allow / weight) : null;
      var copies = p.distributed ? 1 : mps;
      return {
        kind: 'quota',
        policy: p,
        complete: allow !== null && !!windowSeconds,
        allow: allow,
        requestsAllowed: perRequest,                 // per counter copy
        effectiveAllowed: perRequest !== null ? perRequest * copies : null, // what the whole deployment lets through
        copies: copies,
        interval: interval,
        unit: unit,
        windowSeconds: windowSeconds,
        type: p.type,
        startMs: p.startMs,
        exact: p.distributed ? p.synchronous : (mps === 1),
        identifier: identifierSource(p.identifier ? p.identifier.ref : null, !!p.identifier),
        faultSignature: 'QuotaViolation',
        mps: mps
      };
    }
    if (p.kind === 'spike') {
      var rateText = values.rate || p.rate.text;
      var m = String(rateText || '').trim().match(/^(\d+)\s*(ps|pm)$/i);
      var count = m ? parseInt(m[1], 10) : p.rate.count;
      var per = m ? m[2].toLowerCase().charAt(1) : p.rate.per;
      var w = Math.max(1, int(values.weight) || 1);
      var perSecond = count ? (per === 's' ? count : count / 60) / w : null;
      var perMp = p.useEffectiveCount ? 1 : mps;
      return {
        kind: 'spike',
        policy: p,
        complete: !!perSecond,
        count: count,
        per: per,
        text: count ? count + 'p' + per : null,
        perSecond: perSecond,                       // one counter's rate
        effectivePerSecond: perSecond !== null ? perSecond * perMp : null,
        gapMs: perSecond ? 1000 / perSecond : null, // minimum spacing one counter accepts
        bucket: count ? Math.max(1, Math.floor(count / w * 0.1)) : 1, // tokens available at once
        copies: perMp,
        identifier: identifierSource(p.identifier ? p.identifier.ref : null, !!p.identifier),
        faultSignature: 'SpikeArrestViolation',
        mps: mps
      };
    }
    return { kind: p.kind, policy: p, complete: false };
  }

  /* Where a per-client counter takes its key from — which decides how a test
     proves that another client is not affected. */
  function identifierSource(ref, present) {
    if (!present || !ref) return { kind: 'proxy', ref: ref || null, name: null, label: 'the whole proxy (every caller shares one counter)' };
    var m;
    if ((m = ref.match(/^request\.header\.(.+)$/i))) return { kind: 'header', ref: ref, name: m[1], label: 'the ' + m[1] + ' request header' };
    if ((m = ref.match(/^request\.queryparam\.(.+)$/i))) return { kind: 'query', ref: ref, name: m[1], label: 'the ' + m[1] + ' query parameter' };
    if ((m = ref.match(/^request\.formparam\.(.+)$/i))) return { kind: 'form', ref: ref, name: m[1], label: 'the ' + m[1] + ' form field' };
    if (/client_id|clientid|consumer|apikey|api_key|access_token|developer\.app|app\.name/i.test(ref)) {
      return { kind: 'credential', ref: ref, name: null, label: 'the calling app (' + ref + ')' };
    }
    if (/client\.ip|proxy\.client\.ip|x-forwarded-for/i.test(ref)) return { kind: 'ip', ref: ref, name: null, label: 'the client IP (' + ref + ')' };
    return { kind: 'other', ref: ref, name: null, label: 'the flow variable ' + ref };
  }

  function unitName(unit, n) { return unit + (n === 1 ? '' : 's'); }

  function describe(r) {
    if (r.kind === 'quota') {
      if (!r.complete) return r.policy.displayName + ': the count or the window is not known yet.';
      var s = r.policy.displayName + ' allows ' + r.requestsAllowed + ' requests per ' +
        (r.interval === 1 ? r.unit : r.interval + ' ' + unitName(r.unit, r.interval)) + ' for ' + r.identifier.label + '.';
      if (r.type === 'calendar') s += ' The window is fixed on the calendar' + (r.policy.startTime ? ' from ' + r.policy.startTime + ' GMT' : '') + '.';
      else if (r.type === 'rollingwindow') s += ' The window rolls: every request looks back ' + windowText(r.windowSeconds) + '.';
      else if (r.type === 'flexi') s += ' The window starts at the first request and resets ' + windowText(r.windowSeconds) + ' later.';
      else s += ' The window resets at the top of the ' + r.unit + ' (GMT).';
      if (!r.policy.distributed) {
        s += ' Distributed is false, so each message processor keeps its own count — with ' + r.mps +
          ' of them the deployment lets about ' + r.effectiveAllowed + ' through.';
      } else if (!r.policy.synchronous) {
        s += ' The counter is distributed but synced ' + (r.policy.syncMessageCount
          ? 'every ' + r.policy.syncMessageCount + ' messages'
          : 'every ' + (r.policy.syncIntervalSeconds || 10) + ' s') + ', so a few requests over the limit can slip through.';
      } else {
        s += ' Distributed and synchronous: the count is exact.';
      }
      return s;
    }
    if (r.kind === 'spike') {
      if (!r.complete) return r.policy.displayName + ': the rate is not known yet.';
      var t = r.policy.displayName + ' smooths traffic to ' + r.text + ' — one request every ' +
        Math.round(r.gapMs) + ' ms' + (r.bucket > 1 ? ', with a burst allowance of about ' + r.bucket : '') +
        ' — for ' + r.identifier.label + '.';
      if (r.copies > 1) {
        t += ' UseEffectiveCount is off, so each of the ' + r.mps + ' message processors enforces that on its own: about ' +
          Math.round(r.effectivePerSecond * 10) / 10 + ' per second in total.';
      } else if (r.mps > 1) {
        t += ' UseEffectiveCount is on: the rate is shared across the ' + r.mps + ' message processors.';
      }
      return t;
    }
    return r.policy.displayName + ' (' + r.kind + ') — not supported.';
  }

  function windowText(seconds) {
    if (seconds === null || seconds === undefined) return '?';
    if (seconds % 86400 === 0 && seconds >= 86400) return (seconds / 86400) + ' day' + (seconds === 86400 ? '' : 's');
    if (seconds % 3600 === 0 && seconds >= 3600) return (seconds / 3600) + ' hour' + (seconds === 3600 ? '' : 's');
    if (seconds % 60 === 0 && seconds >= 60) return (seconds / 60) + ' minute' + (seconds === 60 ? '' : 's');
    return seconds + ' second' + (seconds === 1 ? '' : 's');
  }

  var api = {
    parse: parse,
    parseXml: parseXml,
    unresolved: unresolved,
    resolve: resolve,
    describe: describe,
    identifierSource: identifierSource,
    windowText: windowText,
    UNIT_SECONDS: UNIT_SECONDS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SduiApigee = api;
})(typeof window !== 'undefined' ? window : this);

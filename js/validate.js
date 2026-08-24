/* Swagger Dark UI — lightweight OpenAPI linter for the YAML editor.
   Catches the common structural mistakes (unknown/misplaced properties,
   wrong value types, bad status codes) and semantic ones (security
   requirements without a matching scheme, unresolved local $refs,
   duplicate operationIds) that Swagger UI silently renders around.
   Not a full JSON-Schema validation of the spec — rules err on the side
   of no false positives, so a clean report is "no known issues", not a
   certification. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  /* Allowed fixed fields per object, straight from the OAS tables.
     "x-*" extensions are always allowed and filtered out before matching. */
  var KEYS = {
    root3: ['openapi', 'info', 'servers', 'paths', 'components', 'security', 'tags', 'externalDocs'],
    root31: ['jsonSchemaDialect', 'webhooks'],
    root2: ['swagger', 'info', 'host', 'basePath', 'schemes', 'consumes', 'produces', 'paths',
      'definitions', 'parameters', 'responses', 'securityDefinitions', 'security', 'tags', 'externalDocs'],
    info: ['title', 'description', 'termsOfService', 'contact', 'license', 'version'],
    info31: ['summary'],
    contact: ['name', 'url', 'email'],
    license: ['name', 'url'],
    license31: ['identifier'],
    pathItem: ['$ref', 'summary', 'description', 'servers', 'parameters'].concat(METHODS),
    pathItem2: ['$ref', 'parameters'].concat(METHODS),
    operation3: ['tags', 'summary', 'description', 'externalDocs', 'operationId', 'parameters',
      'requestBody', 'responses', 'callbacks', 'deprecated', 'security', 'servers'],
    operation2: ['tags', 'summary', 'description', 'externalDocs', 'operationId', 'consumes',
      'produces', 'parameters', 'responses', 'schemes', 'deprecated', 'security'],
    parameter3: ['name', 'in', 'description', 'required', 'deprecated', 'allowEmptyValue',
      'style', 'explode', 'allowReserved', 'schema', 'example', 'examples', 'content'],
    parameter2: ['name', 'in', 'description', 'required', 'schema', 'type', 'format',
      'allowEmptyValue', 'items', 'collectionFormat', 'default', 'maximum', 'exclusiveMaximum',
      'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems',
      'uniqueItems', 'enum', 'multipleOf'],
    header3: ['description', 'required', 'deprecated', 'allowEmptyValue', 'style', 'explode',
      'allowReserved', 'schema', 'example', 'examples', 'content'],
    requestBody: ['description', 'content', 'required'],
    response3: ['description', 'headers', 'content', 'links'],
    response2: ['description', 'schema', 'headers', 'examples'],
    mediaType: ['schema', 'example', 'examples', 'encoding'],
    exampleObj: ['summary', 'description', 'value', 'externalValue'],
    link: ['operationRef', 'operationId', 'parameters', 'requestBody', 'description', 'server'],
    components: ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers',
      'securitySchemes', 'links', 'callbacks'],
    components31: ['pathItems'],
    securityScheme: ['type', 'description', 'name', 'in', 'scheme', 'bearerFormat', 'flows',
      'openIdConnectUrl', 'flow', 'authorizationUrl', 'tokenUrl', 'scopes']
  };

  var PARAM_IN_3 = ['query', 'header', 'path', 'cookie'];
  var PARAM_IN_2 = ['query', 'header', 'path', 'formData', 'body'];
  var TYPES_30 = ['array', 'boolean', 'integer', 'number', 'object', 'string'];
  var TYPES_31 = TYPES_30.concat(['null']);
  var TYPES_20 = TYPES_30.concat(['file']);
  var SCHEME_TYPES_3 = ['apiKey', 'http', 'oauth2', 'openIdConnect', 'mutualTLS'];
  var SCHEME_TYPES_2 = ['basic', 'apiKey', 'oauth2'];
  var STATUS_RE = /^([1-5](\d\d|XX)|default)$/;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isExt(k) { return k.slice(0, 2) === 'x-'; }
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  function validate(doc) {
    var issues = [];
    if (!isObj(doc)) return issues;

    var verRaw = has(doc, 'openapi') ? doc.openapi : doc.swagger;
    // Unquoted versions ("swagger: 2.0", "openapi: 3.0") arrive as numbers —
    // still use them to pick the rule set (the wrong type is flagged below),
    // so the document isn't flooded with rules from the wrong spec version.
    var ver = typeof verRaw === 'string' ? verRaw
      : (typeof verRaw === 'number' ? String(verRaw) : '');
    var v = { is31: /^3\.1(\.|$)/.test(ver), is30: /^3\.0(\.|$)/.test(ver), is2: /^2(\.|$)/.test(ver) };
    v.is3 = v.is30 || v.is31;
    // Unknown 3.x minor versions (and the bare number 3) get the 3.1 rule
    // set — the most permissive one.
    if (!v.is3 && !v.is2 && /^3(\.|$)/.test(ver)) { v.is31 = true; v.is3 = true; }

    /* `code` and `data` are machine-readable handles for quick fixes. */
    function err(path, message, code, data) {
      issues.push({ path: path, message: message, severity: 'error', code: code, data: data });
    }
    function warn(path, message, code, data) {
      issues.push({ path: path, message: message, severity: 'warning', code: code, data: data });
    }

    function checkKeys(obj, path, allowed, what) {
      Object.keys(obj).forEach(function (k) {
        if (!isExt(k) && allowed.indexOf(k) === -1) {
          err(path.concat(k), 'should NOT have additional property "' + k + '" (not allowed in ' + what + ')',
            'additional-prop', { key: k });
        }
      });
    }

    /* An object was expected. Returns true when it is safe to recurse. */
    function expectObj(value, path, what, code) {
      if (isObj(value)) return true;
      err(path, what + ' should be an object' +
        (value === null ? ' — it is empty (did you forget to indent its contents?)' : ''), code);
      return false;
    }

    /* ----- version field ----- */

    if (has(doc, 'openapi')) {
      if (typeof doc.openapi !== 'string') {
        err(['openapi'], 'should be a string (quote it, e.g. "3.0.0" — unquoted 3.0 is parsed as a number)', 'quote-value');
      } else if (!/^3\.\d+(\.\d+)?/.test(doc.openapi)) {
        err(['openapi'], '"' + doc.openapi + '" is not a valid OpenAPI 3 version');
      }
    } else if (has(doc, 'swagger') && doc.swagger !== '2.0') {
      err(['swagger'], 'should be the string "2.0"' +
        (typeof doc.swagger === 'number' ? ' (quote it — unquoted 2.0 is parsed as a number)' : ''),
        typeof doc.swagger === 'number' ? 'quote-value' : undefined);
    }

    /* ----- root ----- */

    var rootAllowed = v.is2 ? KEYS.root2 : KEYS.root3.concat(v.is31 ? KEYS.root31 : []);
    checkKeys(doc, [], rootAllowed, 'an OpenAPI document');

    if (!has(doc, 'info')) {
      err([], '"info" is required', 'missing-info');
    } else if (expectObj(doc.info, ['info'], '"info"')) {
      checkKeys(doc.info, ['info'], KEYS.info.concat(v.is31 ? KEYS.info31 : []), 'the Info Object');
      if (!has(doc.info, 'title')) err(['info'], '"info.title" is required', 'missing-title');
      else if (typeof doc.info.title !== 'string') err(['info', 'title'], 'should be a string');
      if (!has(doc.info, 'version')) {
        err(['info'], '"info.version" is required', 'missing-version');
      } else if (typeof doc.info.version !== 'string') {
        err(['info', 'version'], 'should be a string (quote it, e.g. "1.0" — unquoted it is parsed as a number)', 'quote-value');
      }
      if (isObj(doc.info.contact)) checkKeys(doc.info.contact, ['info', 'contact'], KEYS.contact, 'the Contact Object');
      if (isObj(doc.info.license)) {
        checkKeys(doc.info.license, ['info', 'license'],
          KEYS.license.concat(v.is31 ? KEYS.license31 : []), 'the License Object');
      }
    }

    if (v.is31) {
      if (!has(doc, 'paths') && !has(doc, 'webhooks') && !has(doc, 'components')) {
        err([], 'an OpenAPI 3.1 document needs at least one of "paths", "webhooks" or "components"');
      }
    } else if (!has(doc, 'paths')) {
      err([], '"paths" is required');
    }

    /* ----- security scheme names, for requirement matching ----- */

    var schemeNames = [];
    var schemesSource = v.is2 ? doc.securityDefinitions
      : (isObj(doc.components) ? doc.components.securitySchemes : null);
    if (isObj(schemesSource)) schemeNames = Object.keys(schemesSource);

    function checkSecurity(security, path) {
      if (security === undefined) return;
      if (!Array.isArray(security)) { err(path, '"security" should be an array'); return; }
      security.forEach(function (req, i) {
        if (!expectObj(req, path.concat(i), 'a security requirement')) return;
        Object.keys(req).forEach(function (name) {
          if (schemeNames.indexOf(name) === -1) {
            err(path.concat(i), 'security requirement "' + name + '" must match a security scheme declared in ' +
              (v.is2 ? '"securityDefinitions"' : '"components.securitySchemes"'), 'security-undefined', { name: name });
          }
          if (!Array.isArray(req[name])) {
            err(path.concat(i, name), 'the scopes of a security requirement should be an array (use [] for none)');
          }
        });
      });
    }

    /* ----- schemas (recursive, cycle-safe) ----- */

    var seenSchemas = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

    function checkSchema(schema, path) {
      if (schema === undefined) return;
      if (typeof schema === 'boolean' && v.is31) return; // 3.1: true/false are valid schemas
      if (!expectObj(schema, path, 'a schema')) return;
      if (seenSchemas) {
        if (seenSchemas.has(schema)) return;
        seenSchemas.add(schema);
      }
      if (typeof schema.$ref === 'string' && !v.is31) return; // 3.0/2.0: siblings of $ref are ignored

      var types = v.is31 ? TYPES_31 : (v.is2 ? TYPES_20 : TYPES_30);
      var declared = Array.isArray(schema.type) ? schema.type : (schema.type !== undefined ? [schema.type] : []);
      if (Array.isArray(schema.type) && !v.is31) {
        err(path.concat('type'), 'an array of types needs OpenAPI 3.1 — in ' +
          (v.is2 ? '2.0' : '3.0') + ' "type" must be a single string');
      }
      declared.forEach(function (t) {
        if (typeof t !== 'string' || types.indexOf(t) === -1) {
          warn(path.concat('type'), '"' + t + '" is not a valid schema type (' + types.join(', ') + ')');
        }
      });

      if (isObj(schema.properties)) {
        Object.keys(schema.properties).forEach(function (p) {
          checkSchema(schema.properties[p], path.concat('properties', p));
        });
      }
      if (isObj(schema.patternProperties)) {
        Object.keys(schema.patternProperties).forEach(function (p) {
          checkSchema(schema.patternProperties[p], path.concat('patternProperties', p));
        });
      }
      ['items', 'not', 'if', 'then', 'else', 'contains', 'propertyNames'].forEach(function (k) {
        if (schema[k] !== undefined && typeof schema[k] !== 'boolean') checkSchema(schema[k], path.concat(k));
      });
      if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
        checkSchema(schema.additionalProperties, path.concat('additionalProperties'));
      }
      ['allOf', 'anyOf', 'oneOf', 'prefixItems'].forEach(function (k) {
        if (Array.isArray(schema[k])) {
          schema[k].forEach(function (sub, i) { checkSchema(sub, path.concat(k, i)); });
        }
      });
      ['$defs', 'definitions', 'dependentSchemas'].forEach(function (k) {
        if (isObj(schema[k])) {
          Object.keys(schema[k]).forEach(function (n) { checkSchema(schema[k][n], path.concat(k, n)); });
        }
      });
    }

    /* ----- shared parameter / header / media-type pieces ----- */

    function checkExampleExclusivity(obj, path, what) {
      if (has(obj, 'example') && has(obj, 'examples')) {
        err(path, what + ' should not have both "example" and "examples" — they are mutually exclusive', 'example-conflict');
      }
    }

    function checkExamplesMap(examples, path) {
      if (!isObj(examples)) return;
      Object.keys(examples).forEach(function (name) {
        var ex = examples[name];
        if (typeof ex === 'object' && ex !== null && typeof ex.$ref !== 'string' && isObj(ex)) {
          checkKeys(ex, path.concat(name), KEYS.exampleObj, 'an Example Object');
          if (has(ex, 'value') && has(ex, 'externalValue')) {
            err(path.concat(name), 'an example should not have both "value" and "externalValue"');
          }
        }
      });
    }

    function checkMediaTypes(content, path) {
      if (!expectObj(content, path, '"content"')) return;
      Object.keys(content).forEach(function (mime) {
        var mt = content[mime];
        var mtPath = path.concat(mime);
        if (!expectObj(mt, mtPath, 'the "' + mime + '" media type', 'empty-media-type')) return;
        checkKeys(mt, mtPath, KEYS.mediaType, 'a Media Type Object');
        checkExampleExclusivity(mt, mtPath, 'a media type');
        checkSchema(mt.schema, mtPath.concat('schema'));
        checkExamplesMap(mt.examples, mtPath.concat('examples'));
      });
    }

    function checkParameter(param, path) {
      if (!expectObj(param, path, 'a parameter')) return null;
      if (typeof param.$ref === 'string') return null;
      var allowed = v.is2 ? KEYS.parameter2 : KEYS.parameter3;
      checkKeys(param, path, allowed, 'a Parameter Object');
      if (typeof param.name !== 'string') err(path, 'a parameter requires a "name" string');
      var ins = v.is2 ? PARAM_IN_2 : PARAM_IN_3;
      if (typeof param.in !== 'string' || ins.indexOf(param.in) === -1) {
        err(path, 'a parameter requires "in" set to one of: ' + ins.join(', '));
      } else if (param.in === 'path' && param.required !== true) {
        err(path, 'path parameters must set "required: true"', 'path-param-required');
      }
      if (!v.is2) {
        checkExampleExclusivity(param, path, 'a parameter');
        if (has(param, 'schema') && has(param, 'content')) {
          err(path, 'a parameter should have either "schema" or "content", not both');
        }
        checkSchema(param.schema, path.concat('schema'));
        if (has(param, 'content')) checkMediaTypes(param.content, path.concat('content'));
        checkExamplesMap(param.examples, path.concat('examples'));
      } else if (param.in === 'body') {
        checkSchema(param.schema, path.concat('schema'));
      }
      return typeof param.name === 'string' && typeof param.in === 'string'
        ? { name: param.name, loc: param.in } : null;
    }

    function checkHeader(header, path) {
      if (!isObj(header) || typeof header.$ref === 'string') return;
      if (!v.is2) {
        checkKeys(header, path, KEYS.header3, 'a Header Object');
        checkExampleExclusivity(header, path, 'a header');
        checkSchema(header.schema, path.concat('schema'));
      }
    }

    function checkResponse(res, path) {
      if (!expectObj(res, path, 'a response')) return;
      if (typeof res.$ref === 'string') return;
      checkKeys(res, path, v.is2 ? KEYS.response2 : KEYS.response3, 'a Response Object');
      if (!has(res, 'description')) err(path, 'a response requires a "description"', 'missing-description');
      else if (typeof res.description !== 'string') err(path.concat('description'), 'should be a string');
      if (isObj(res.headers)) {
        Object.keys(res.headers).forEach(function (h) {
          checkHeader(res.headers[h], path.concat('headers', h));
        });
      }
      if (!v.is2 && has(res, 'content')) checkMediaTypes(res.content, path.concat('content'));
      if (v.is2) checkSchema(res.schema, path.concat('schema'));
      if (!v.is2 && isObj(res.links)) {
        Object.keys(res.links).forEach(function (l) {
          var link = res.links[l];
          if (isObj(link) && typeof link.$ref !== 'string') {
            checkKeys(link, path.concat('links', l), KEYS.link, 'a Link Object');
          }
        });
      }
    }

    function checkResponses(responses, path) {
      if (!expectObj(responses, path, '"responses"')) return;
      var codes = Object.keys(responses).filter(function (k) { return !isExt(k); });
      if (!codes.length) err(path, 'at least one response is required');
      codes.forEach(function (code) {
        if (!STATUS_RE.test(code)) {
          err(path.concat(code), '"' + code + '" is not a valid response key — use a status code ' +
            '(e.g. \'200\'), a range like \'2XX\', or \'default\'');
        }
        checkResponse(responses[code], path.concat(code));
      });
    }

    var operationIds = {};

    function checkOperation(op, path, pathTemplate, inheritedParams) {
      if (!expectObj(op, path, 'an operation')) return;
      checkKeys(op, path, v.is2 ? KEYS.operation2 : KEYS.operation3, 'an Operation Object');

      var declared = inheritedParams.slice();
      var hasRefParam = false;
      if (has(op, 'parameters')) {
        if (!Array.isArray(op.parameters)) {
          err(path.concat('parameters'), '"parameters" should be an array (each entry starts with "- ")');
        } else {
          var seen = {};
          op.parameters.forEach(function (p, i) {
            if (isObj(p) && typeof p.$ref === 'string') { hasRefParam = true; return; }
            var id = checkParameter(p, path.concat('parameters', i));
            if (id) {
              var key = id.loc + ':' + id.name;
              if (seen[key]) warn(path.concat('parameters', i), 'duplicate parameter "' + id.name + '" in ' + id.loc);
              seen[key] = true;
              declared.push(id);
            }
          });
        }
      }

      // Every {placeholder} in the path template needs a declared path parameter.
      if (!hasRefParam && !inheritedParams.ref) {
        var m = String(pathTemplate).match(/\{([^}]+)\}/g) || [];
        m.forEach(function (braced) {
          var name = braced.slice(1, -1);
          var ok = declared.some(function (p) { return p.loc === 'path' && p.name === name; });
          if (!ok) {
            warn(path, 'path parameter "' + name + '" appears in the path template but is not declared ' +
              '(add it to "parameters" with "in: path")');
          }
        });
      }

      if (!v.is2 && has(op, 'requestBody')) {
        var rb = op.requestBody;
        var rbPath = path.concat('requestBody');
        if (expectObj(rb, rbPath, '"requestBody"') && typeof rb.$ref !== 'string') {
          checkKeys(rb, rbPath, KEYS.requestBody, 'a Request Body Object');
          if (!has(rb, 'content')) err(rbPath, 'a request body requires "content"');
          else checkMediaTypes(rb.content, rbPath.concat('content'));
        }
      }

      if (has(op, 'responses')) checkResponses(op.responses, path.concat('responses'));
      else if (!v.is31) err(path, 'an operation requires "responses"', 'missing-responses');

      checkSecurity(op.security, path.concat('security'));

      if (typeof op.operationId === 'string') {
        if (operationIds[op.operationId]) {
          warn(path.concat('operationId'), 'duplicate operationId "' + op.operationId + '" ' +
            '(also used by ' + operationIds[op.operationId] + ')');
        } else {
          operationIds[op.operationId] = path.join('.') || 'another operation';
        }
      }

      if (!v.is2 && isObj(op.callbacks)) {
        Object.keys(op.callbacks).forEach(function (cb) {
          var callback = op.callbacks[cb];
          if (isObj(callback) && typeof callback.$ref !== 'string') {
            Object.keys(callback).forEach(function (expr) {
              if (isExt(expr)) return;
              // Callback keys are runtime expressions, not path templates —
              // pass '' so their {placeholders} are not parameter-checked.
              checkPathItem(callback[expr], path.concat('callbacks', cb, expr), '');
            });
          }
        });
      }
    }

    function checkPathItem(item, path, pathTemplate) {
      if (!expectObj(item, path, 'a path item')) return;
      checkKeys(item, path, v.is2 ? KEYS.pathItem2 : KEYS.pathItem, 'a Path Item Object');

      var shared = [];
      shared.ref = false;
      if (has(item, 'parameters')) {
        if (!Array.isArray(item.parameters)) {
          err(path.concat('parameters'), '"parameters" should be an array (each entry starts with "- ")');
        } else {
          item.parameters.forEach(function (p, i) {
            if (isObj(p) && typeof p.$ref === 'string') { shared.ref = true; return; }
            var id = checkParameter(p, path.concat('parameters', i));
            if (id) shared.push(id);
          });
        }
      }
      METHODS.forEach(function (method) {
        if (has(item, method)) checkOperation(item[method], path.concat(method), pathTemplate, shared);
      });
    }

    /* ----- paths / webhooks ----- */

    if (has(doc, 'paths') && expectObj(doc.paths, ['paths'], '"paths"')) {
      Object.keys(doc.paths).forEach(function (p) {
        if (isExt(p)) return;
        if (p.charAt(0) !== '/') {
          err(['paths', p], 'path "' + p + '" should start with a slash', 'path-no-slash');
        }
        checkPathItem(doc.paths[p], ['paths', p], p);
      });
    }

    if (v.is31 && isObj(doc.webhooks)) {
      Object.keys(doc.webhooks).forEach(function (name) {
        var wh = doc.webhooks[name];
        if (isObj(wh) && typeof wh.$ref === 'string') return;
        checkPathItem(wh, ['webhooks', name], '');
      });
    }

    checkSecurity(doc.security, ['security']);

    /* ----- components / definitions ----- */

    if (!v.is2 && has(doc, 'components') && expectObj(doc.components, ['components'], '"components"')) {
      var c = doc.components;
      checkKeys(c, ['components'], KEYS.components.concat(v.is31 ? KEYS.components31 : []), 'the Components Object');
      function eachIn(section, fn) {
        if (!isObj(c[section])) return;
        Object.keys(c[section]).forEach(function (name) {
          fn(c[section][name], ['components', section, name]);
        });
      }
      eachIn('schemas', checkSchema);
      eachIn('responses', checkResponse);
      eachIn('parameters', checkParameter);
      eachIn('headers', checkHeader);
      eachIn('requestBodies', function (rb, path) {
        if (!isObj(rb) || typeof rb.$ref === 'string') return;
        checkKeys(rb, path, KEYS.requestBody, 'a Request Body Object');
        if (!has(rb, 'content')) err(path, 'a request body requires "content"');
        else checkMediaTypes(rb.content, path.concat('content'));
      });
      if (isObj(c.examples)) checkExamplesMap(c.examples, ['components', 'examples']);
      eachIn('securitySchemes', function (scheme, path) {
        if (!expectObj(scheme, path, 'a security scheme')) return;
        if (typeof scheme.$ref === 'string') return;
        checkKeys(scheme, path, KEYS.securityScheme, 'a Security Scheme Object');
        var types = v.is31 ? SCHEME_TYPES_3 : SCHEME_TYPES_3.slice(0, 4);
        if (typeof scheme.type !== 'string' || types.indexOf(scheme.type) === -1) {
          err(path, 'a security scheme requires "type" set to one of: ' + types.join(', '));
        }
      });
      if (v.is31) {
        eachIn('pathItems', function (pi, path) { checkPathItem(pi, path, ''); });
      }
    }
    if (v.is2) {
      if (isObj(doc.definitions)) {
        Object.keys(doc.definitions).forEach(function (name) {
          checkSchema(doc.definitions[name], ['definitions', name]);
        });
      }
      if (isObj(doc.securityDefinitions)) {
        Object.keys(doc.securityDefinitions).forEach(function (name) {
          var scheme = doc.securityDefinitions[name];
          var path = ['securityDefinitions', name];
          if (!expectObj(scheme, path, 'a security scheme')) return;
          if (typeof scheme.type !== 'string' || SCHEME_TYPES_2.indexOf(scheme.type) === -1) {
            err(path, 'a security scheme requires "type" set to one of: ' + SCHEME_TYPES_2.join(', '));
          }
        });
      }
    }

    /* ----- local $ref resolution (whole document walk) ----- */

    function resolvePointer(pointer) {
      var parts = pointer.slice(2).split('/').map(function (part) {
        return decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
      });
      var node = doc;
      for (var i = 0; i < parts.length; i++) {
        if (Array.isArray(node) && /^\d+$/.test(parts[i])) node = node[parts[i]];
        else if (isObj(node) && has(node, parts[i])) node = node[parts[i]];
        else return false;
      }
      return true;
    }

    var seenRefs = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    function walkRefs(node, path) {
      if (Array.isArray(node)) {
        node.forEach(function (item, i) { walkRefs(item, path.concat(i)); });
        return;
      }
      if (!isObj(node)) return;
      if (seenRefs) {
        if (seenRefs.has(node)) return;
        seenRefs.add(node);
      }
      if (has(node, '$ref')) {
        if (typeof node.$ref !== 'string') {
          err(path.concat('$ref'), '$ref should be a string');
        } else if (node.$ref.slice(0, 2) === '#/' && !resolvePointer(node.$ref)) {
          err(path.concat('$ref'), '$ref "' + node.$ref + '" does not resolve — is the target defined?');
        }
      }
      Object.keys(node).forEach(function (k) { walkRefs(node[k], path.concat(k)); });
    }
    walkRefs(doc, []);

    // Errors first, then warnings, each group in document order.
    var rank = { error: 0, warning: 1 };
    issues.forEach(function (issue, i) { issue._i = i; });
    issues.sort(function (a, b) { return (rank[a.severity] - rank[b.severity]) || (a._i - b._i); });
    issues.forEach(function (issue) { delete issue._i; });
    return issues;
  }

  /* ----- best-effort YAML path -> line resolution -----
     Walks the raw editor text by indentation to find the line a JSON-path
     points at. Heuristic (block-style YAML only), used for "jump to line". */

  function indentOf(line) { return (line.match(/^ */) || [''])[0].length; }
  function isBlank(line) { var t = line.trim(); return !t || t.charAt(0) === '#'; }

  function keyRegex(key) {
    var esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^(?:- +)?["\']?' + esc + '["\']?\\s*:');
  }

  function blockEnd(lines, start, parentIndent) {
    for (var i = start; i < lines.length; i++) {
      if (!isBlank(lines[i]) && indentOf(lines[i]) <= parentIndent) return i;
    }
    return lines.length;
  }

  function locate(text, path) {
    var lines = text.split('\n');
    var start = 0;
    var end = lines.length;
    var parentIndent = -1;
    var best = -1;
    for (var s = 0; s < path.length; s++) {
      var seg = path[s];
      var found = -1;
      var i, line, ind;
      if (typeof seg === 'number') {
        var arrayIndent = -1;
        var count = -1;
        for (i = start; i < end; i++) {
          line = lines[i];
          if (isBlank(line)) continue;
          ind = indentOf(line);
          if (ind <= parentIndent) break;
          if (line.charAt(ind) === '-' && (arrayIndent === -1 || ind === arrayIndent)) {
            arrayIndent = ind;
            count++;
            if (count === seg) { found = i; break; }
          }
        }
        if (found === -1) break;
        // Bound the search to this item: it ends at the next dash at the
        // same indent, or where the array's block ends.
        var itemEnd = blockEnd(lines, found + 1, arrayIndent - 1);
        for (i = found + 1; i < itemEnd; i++) {
          if (!isBlank(lines[i]) && indentOf(lines[i]) === arrayIndent && lines[i].charAt(arrayIndent) === '-') {
            itemEnd = i;
            break;
          }
        }
        best = found;
        start = found;
        end = itemEnd;
        parentIndent = arrayIndent; // keys on the dash line match via the "- " prefix
      } else {
        var re = keyRegex(seg);
        for (i = start; i < end; i++) {
          line = lines[i];
          if (isBlank(line)) continue;
          ind = indentOf(line);
          if (ind <= parentIndent && !(i === start && line.charAt(ind) === '-')) break;
          if (re.test(line.slice(ind))) { found = i; break; }
        }
        if (found === -1) break;
        best = found;
        var prefix = (lines[found].match(/^( *(?:- +)?)/) || ['', ''])[1].length;
        parentIndent = prefix > indentOf(lines[found]) ? prefix - 1 : indentOf(lines[found]);
        start = found + 1;
        end = blockEnd(lines, found + 1, indentOf(lines[found]));
      }
    }
    return best;
  }

  window.SduiValidate = { validate: validate, locate: locate };
})();

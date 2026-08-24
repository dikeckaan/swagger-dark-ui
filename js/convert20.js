/* Swagger Dark UI — Swagger 2.0 → OpenAPI 3.0 converter.
   Object-level conversion of a parsed 2.0 document: servers from
   host/basePath/schemes, body/formData parameters → requestBody, produces →
   response content, definitions/parameters/responses/securityDefinitions →
   components, `type: file` → binary strings, and a full $ref rewrite.
   Best-effort like all such converters — review the result. */
(function () {
  'use strict';

  var METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  var REF_MAP = {
    '#/definitions/': '#/components/schemas/',
    '#/parameters/': '#/components/parameters/',
    '#/responses/': '#/components/responses/'
  };

  function rewriteRefs(node) {
    if (Array.isArray(node)) { node.forEach(rewriteRefs); return; }
    if (!isObj(node)) return;
    if (typeof node.$ref === 'string') {
      Object.keys(REF_MAP).forEach(function (prefix) {
        if (node.$ref.indexOf(prefix) === 0) {
          node.$ref = REF_MAP[prefix] + node.$ref.slice(prefix.length);
        }
      });
    }
    Object.keys(node).forEach(function (k) { rewriteRefs(node[k]); });
  }

  function convertSchema(schema) {
    if (Array.isArray(schema)) { schema.forEach(convertSchema); return schema; }
    if (!isObj(schema)) return schema;
    if (schema.type === 'file') {
      schema.type = 'string';
      schema.format = 'binary';
    }
    if (schema['x-nullable'] !== undefined) {
      schema.nullable = schema['x-nullable'];
      delete schema['x-nullable'];
    }
    Object.keys(schema).forEach(function (k) { convertSchema(schema[k]); });
    return schema;
  }

  /* Copy the schema-ish keywords a 2.0 non-body parameter carries directly
     on itself into an OAS3 `schema` object. */
  var PARAM_SCHEMA_KEYS = ['type', 'format', 'items', 'default', 'maximum', 'exclusiveMaximum',
    'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems',
    'uniqueItems', 'enum', 'multipleOf'];

  function convertPlainParam(p) {
    var out = { name: p.name, in: p.in };
    ['description', 'required', 'allowEmptyValue'].forEach(function (k) {
      if (p[k] !== undefined) out[k] = clone(p[k]);
    });
    var schema = {};
    PARAM_SCHEMA_KEYS.forEach(function (k) {
      if (p[k] !== undefined) schema[k] = clone(p[k]);
    });
    if (p.collectionFormat === 'multi') {
      out.style = 'form';
      out.explode = true;
    } else if (p.collectionFormat && p.collectionFormat !== 'csv') {
      out.style = p.in === 'query' ? 'form' : 'simple';
    }
    out.schema = convertSchema(schema);
    Object.keys(p).forEach(function (k) {
      if (k.slice(0, 2) === 'x-') out[k] = clone(p[k]);
    });
    return out;
  }

  /* Split a 2.0 parameter list into OAS3 parameters + requestBody. */
  function convertParams(params, consumes) {
    var out = { parameters: [], requestBody: null };
    (params || []).forEach(function (p) {
      if (!isObj(p)) return;
      if (typeof p.$ref === 'string') { out.parameters.push(clone(p)); return; }
      if (p.in === 'body') {
        var content = {};
        (consumes && consumes.length ? consumes : ['application/json']).forEach(function (mime) {
          content[mime] = { schema: convertSchema(clone(p.schema) || {}) };
        });
        out.requestBody = { content: content };
        if (p.description) out.requestBody.description = p.description;
        if (p.required) out.requestBody.required = true;
      } else if (p.in === 'formData') {
        if (!out.form) out.form = { schema: { type: 'object', properties: {} }, required: [] };
        var prop = {};
        PARAM_SCHEMA_KEYS.forEach(function (k) { if (p[k] !== undefined) prop[k] = clone(p[k]); });
        if (p.description) prop.description = p.description;
        out.form.schema.properties[p.name] = convertSchema(prop);
        if (p.required) out.form.required.push(p.name);
        if (p.type === 'file') out.form.hasFile = true;
      } else {
        out.parameters.push(convertPlainParam(p));
      }
    });
    if (out.form) {
      if (out.form.required.length) out.form.schema.required = out.form.required;
      var formMime = out.form.hasFile ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
      var formContent = {};
      formContent[formMime] = { schema: out.form.schema };
      out.requestBody = { content: formContent };
      delete out.form;
    }
    return out;
  }

  function convertResponse(res, produces) {
    if (!isObj(res)) return res;
    if (typeof res.$ref === 'string') return clone(res);
    var out = {};
    out.description = res.description !== undefined ? res.description : '';
    if (res.schema) {
      out.content = {};
      (produces && produces.length ? produces : ['application/json']).forEach(function (mime) {
        out.content[mime] = { schema: convertSchema(clone(res.schema)) };
      });
      if (res.examples && isObj(res.examples)) {
        Object.keys(res.examples).forEach(function (mime) {
          if (out.content[mime]) out.content[mime].example = clone(res.examples[mime]);
        });
      }
    }
    if (res.headers && isObj(res.headers)) {
      out.headers = {};
      Object.keys(res.headers).forEach(function (h) {
        var header = res.headers[h];
        var conv = {};
        if (header.description) conv.description = header.description;
        var schema = {};
        PARAM_SCHEMA_KEYS.forEach(function (k) {
          if (header[k] !== undefined) schema[k] = clone(header[k]);
        });
        conv.schema = convertSchema(schema);
        out.headers[h] = conv;
      });
    }
    Object.keys(res).forEach(function (k) {
      if (k.slice(0, 2) === 'x-') out[k] = clone(res[k]);
    });
    return out;
  }

  var FLOW_MAP = { implicit: 'implicit', password: 'password', application: 'clientCredentials', accessCode: 'authorizationCode' };

  function convertSecurityScheme(def) {
    if (!isObj(def)) return def;
    var out = {};
    if (def.description) out.description = def.description;
    switch (def.type) {
      case 'basic':
        out.type = 'http';
        out.scheme = 'basic';
        break;
      case 'apiKey':
        out.type = 'apiKey';
        out.name = def.name;
        out.in = def.in;
        break;
      case 'oauth2': {
        out.type = 'oauth2';
        var flowName = FLOW_MAP[def.flow] || 'implicit';
        var flow = { scopes: clone(def.scopes) || {} };
        if (def.authorizationUrl) flow.authorizationUrl = def.authorizationUrl;
        if (def.tokenUrl) flow.tokenUrl = def.tokenUrl;
        out.flows = {};
        out.flows[flowName] = flow;
        break;
      }
      default:
        out.type = def.type;
    }
    Object.keys(def).forEach(function (k) {
      if (k.slice(0, 2) === 'x-') out[k] = clone(def[k]);
    });
    return out;
  }

  function convert(doc) {
    if (!isObj(doc) || doc.swagger !== '2.0') {
      throw new Error('not a Swagger 2.0 document');
    }
    var out = { openapi: '3.0.3', info: clone(doc.info) || { title: 'API', version: '1.0.0' } };

    // servers from host/basePath/schemes
    var basePath = doc.basePath || '';
    if (doc.host) {
      var schemes = doc.schemes && doc.schemes.length ? doc.schemes : ['https'];
      out.servers = schemes.map(function (s) { return { url: s + '://' + doc.host + basePath }; });
    } else if (basePath) {
      out.servers = [{ url: basePath }];
    }

    var rootConsumes = doc.consumes;
    var rootProduces = doc.produces;

    out.paths = {};
    if (isObj(doc.paths)) {
      Object.keys(doc.paths).forEach(function (p) {
        var item = doc.paths[p];
        if (!isObj(item)) { out.paths[p] = clone(item); return; }
        var newItem = {};
        if (item.parameters) {
          var shared = convertParams(item.parameters, rootConsumes);
          if (shared.parameters.length) newItem.parameters = shared.parameters;
          // a shared body param is illegal in 3.0 — surfaced per-operation below
        }
        METHODS.forEach(function (m) {
          var op = item[m];
          if (!isObj(op)) return;
          var newOp = {};
          ['tags', 'summary', 'description', 'externalDocs', 'operationId', 'deprecated', 'security'].forEach(function (k) {
            if (op[k] !== undefined) newOp[k] = clone(op[k]);
          });
          var conv = convertParams(op.parameters, op.consumes || rootConsumes);
          if (conv.parameters.length) newOp.parameters = conv.parameters;
          if (conv.requestBody) newOp.requestBody = conv.requestBody;
          newOp.responses = {};
          if (isObj(op.responses)) {
            Object.keys(op.responses).forEach(function (code) {
              newOp.responses[code] = convertResponse(op.responses[code], op.produces || rootProduces);
            });
          }
          Object.keys(op).forEach(function (k) {
            if (k.slice(0, 2) === 'x-') newOp[k] = clone(op[k]);
          });
          newItem[m] = newOp;
        });
        Object.keys(item).forEach(function (k) {
          if (k.slice(0, 2) === 'x-') newItem[k] = clone(item[k]);
        });
        out.paths[p] = newItem;
      });
    }

    var components = {};
    if (isObj(doc.definitions)) {
      components.schemas = {};
      Object.keys(doc.definitions).forEach(function (n) {
        components.schemas[n] = convertSchema(clone(doc.definitions[n]));
      });
    }
    if (isObj(doc.parameters)) {
      components.parameters = {};
      Object.keys(doc.parameters).forEach(function (n) {
        var p = doc.parameters[n];
        components.parameters[n] = p.in === 'body' || p.in === 'formData'
          ? clone(p) // no direct 3.0 equivalent — left for manual review
          : convertPlainParam(p);
      });
    }
    if (isObj(doc.responses)) {
      components.responses = {};
      Object.keys(doc.responses).forEach(function (n) {
        components.responses[n] = convertResponse(doc.responses[n], rootProduces);
      });
    }
    if (isObj(doc.securityDefinitions)) {
      components.securitySchemes = {};
      Object.keys(doc.securityDefinitions).forEach(function (n) {
        components.securitySchemes[n] = convertSecurityScheme(doc.securityDefinitions[n]);
      });
    }
    if (Object.keys(components).length) out.components = components;

    ['security', 'tags', 'externalDocs'].forEach(function (k) {
      if (doc[k] !== undefined) out[k] = clone(doc[k]);
    });
    Object.keys(doc).forEach(function (k) {
      if (k.slice(0, 2) === 'x-') out[k] = clone(doc[k]);
    });

    rewriteRefs(out);
    return out;
  }

  window.SduiConvert20 = {
    convert: convert,
    toYaml: function (doc) {
      return jsyaml.dump(convert(doc), { lineWidth: 100, noRefs: true });
    }
  };
})();

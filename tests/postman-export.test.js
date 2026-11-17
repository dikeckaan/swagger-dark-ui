/* Run with: node --test tests/postman-export.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/export.js'), 'utf8'), { window });
const api = window.SduiExport;
const doc = {
  info: { title: 'Accounts API' },
  servers: [{ url: 'https://example.com/api' }],
  security: [{ BearerAuth: [] }],
  components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/auth/login': { post: { summary: 'Login', responses: {
      '200': { content: { 'application/json': { example: { data: { accessToken: 'sample' } } } } }
    } } },
    '/users/{id}': { get: { summary: 'User' } }
  }
};

const capture = {
  captureToken: true, captureRequest: 'POST /auth/login',
  responsePath: 'data.accessToken', variableName: 'bearerToken'
};

test('collection scope stores variables and test script in collection', () => {
  const collection = api.toPostman(doc, { ...capture, environmentSource: 'collection' });
  assert.equal(collection.variable.find(v => v.key === 'baseUrl').value, 'https://example.com/api');
  assert.ok(collection.variable.some(v => v.key === 'bearerToken'));
  const script = collection.item[0].event[0].script.exec.join('\n');
  assert.match(script, /pm\.collectionVariables\.set\("bearerToken"/);
  assert.match(script, /body\["data"\]\["accessToken"\]/);
});

test('external scope supplies separate environment and uses pm.environment', () => {
  const collection = api.toPostman(doc, { ...capture, environmentSource: 'external' });
  assert.deepEqual(Array.from(collection.variable), []);
  const script = collection.item[0].event[0].script.exec.join('\n');
  assert.match(script, /pm\.environment\.set\("bearerToken"/);
  const environment = api.toPostmanEnvironment(doc, capture);
  assert.equal(environment.values[0].key, 'baseUrl');
  assert.ok(environment.values.some(v => v.key === 'bearerToken' && v.type === 'secret'));
});

test('capture disabled does not add response scripts', () => {
  const collection = api.toPostman(doc, { environmentSource: 'collection' });
  assert.equal(collection.item[0].event, undefined);
});

test('invalid paths and absent operations are rejected', () => {
  assert.throws(() => api.parseResponsePath('data;alert(1)'));
  assert.throws(() => api.toPostman(doc, { ...capture, captureRequest: 'POST /missing' }));
});

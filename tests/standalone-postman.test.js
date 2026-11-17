/* Run with: node --test tests/standalone-postman.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('standalone HTML contains the Postman environment wizard', () => {
  const repo = path.resolve(__dirname, '..');
  const output = path.join(os.tmpdir(), 'sdui-standalone-' + process.pid + '.html');
  try {
    execFileSync(process.execPath, [path.join(repo, 'build-standalone.js'),
      '--root', repo, '--out', output], { stdio: 'pipe' });
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /Postman export settings/);
    assert.match(html, /No environment — direct URLs/);
    assert.match(html, /Use variables from collection/);
    assert.match(html, /Separate Postman environment/);
    assert.match(html, /pm\\.environment/);
    assert.match(html, /pm\\.collectionVariables/);
    assert.doesNotMatch(html, /<script src="js\\/export\\.js"/);
  } finally {
    fs.rmSync(output, { force: true });
  }
});

// Guards the dashboard's output-escaping helpers against regressions (stored XSS).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'dashboard.js'), 'utf8');
const extract = name => {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`));
  assert.ok(match, `${name} is defined in dashboard.js`);
  return match[0];
};
const sandbox = { URL };
vm.runInNewContext(['escapeHtml', 'safeUrl', 'cssToken'].map(extract).join('\n'), sandbox);
const { escapeHtml, safeUrl, cssToken } = sandbox;

test('escapeHtml escapes markup and both quote styles', () => {
  assert.equal(escapeHtml(`"><img src=x onerror='alert(1)'>&`), '&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;');
});

test('escapeHtml keeps zero and empties null-like values', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('safeUrl allows https and inline image or PDF data only', () => {
  assert.equal(safeUrl('https://example.supabase.co/storage/v1/object/sign/doc.png?token=a'), 'https://example.supabase.co/storage/v1/object/sign/doc.png?token=a');
  assert.equal(safeUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeUrl('data:application/pdf;base64,JVBERi0='), 'data:application/pdf;base64,JVBERi0=');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'http://example.com/x.png', 'vbscript:x', '', null]) {
    assert.equal(safeUrl(bad), '', `rejects ${bad}`);
  }
});

test('cssToken strips anything that could leave a class attribute', () => {
  assert.equal(cssToken('in-progress'), 'in-progress');
  assert.equal(cssToken('URGENT'), 'urgent');
  assert.equal(cssToken('high"><img src=x onerror=alert(1)>'), 'highimgsrcxonerroralert1');
});

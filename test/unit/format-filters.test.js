import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, extOf, fmtSize } from '../../src/format.js';
import { dirSkipReason, DEFAULT_CFG, SKIP } from '../../src/filters.js';
import { QUARANTINE_DIR } from '../../src/quarantine.js';

test('esc neutraliza todo lo que permite salir de texto o de un atributo', () => {
  const evil = `x" onmouseover="alert(1)' <img src=x onerror=alert(2)> &amp;`;
  const out = esc(evil);
  assert.doesNotMatch(out, /["'<>]/);
  assert.equal(out, 'x&quot; onmouseover=&quot;alert(1)&#39; &lt;img src=x onerror=alert(2)&gt; &amp;amp;');
});

test('extOf', () => {
  assert.equal(extOf('a.JPG'), 'jpg');
  assert.equal(extOf('a.tar.gz'), 'gz');
  assert.equal(extOf('LEEME'), '');
  assert.equal(extOf('.bashrc'), '');
});

test('fmtSize', () => {
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(2048), '2.0 KB');
  assert.equal(fmtSize(5 * 1048576), '5.00 MB');
});

test('la carpeta de cuarentena nunca se escanea, sea cual sea la configuración', () => {
  assert.equal(dirSkipReason(QUARANTINE_DIR, 1, null, { ...DEFAULT_CFG, ignoreDev: false, ignoreHidden: false }), SKIP.QUARANTINE);
  assert.equal(dirSkipReason(QUARANTINE_DIR, 5, null, DEFAULT_CFG), SKIP.QUARANTINE);
});

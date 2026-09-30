import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('styles.css: los @import van antes que cualquier otra regla (si no, el navegador los ignora)', async () => {
  const css  = (await readFile(new URL('../../styles.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const last = css.lastIndexOf('@import');
  if (last < 0) return;
  assert.doesNotMatch(css.slice(0, last), /[{}]/);
});

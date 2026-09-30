import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { FILES as VENDORED } from '../../scripts/vendor.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = p => readFile(new URL(p, ROOT), 'utf8');

test('todos los iconos que usa la app existen en el Font Awesome copiado', async () => {
  const faCss = await read('vendor/fontawesome/css/fontawesome.min.css');
  const src   = [await read('index.html'), ...await Promise.all(
    (await readdir(new URL('src/', ROOT))).map(f => read('src/' + f)))].join('\n');
  const used  = new Set([...src.matchAll(/\bfa-([a-z0-9-]+)/g)].map(m => m[1]));
  for (const name of used) assert.ok(faCss.includes(`.fa-${name}{`) || faCss.includes(`.fa-${name},`), `icono fa-${name} no existe`);
});

test('todas las url() de los CSS apuntan a archivos que existen', async () => {
  for (const css of ['styles.css', 'vendor/fontawesome/css/solid.min.css', 'vendor/fontawesome/css/fontawesome.min.css']) {
    const base = new URL(css, ROOT);
    for (const [, u] of (await read(css)).matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
      if (u.startsWith('data:')) continue;
      await access(new URL(u, base)); // lanza si no existe
    }
  }
});

test('la página no carga nada de otros orígenes', async () => {
  const html = await read('index.html');
  const css  = await read('styles.css');
  assert.doesNotMatch(html, /(src|href)="https?:/);
  assert.doesNotMatch(css, /url\(['"]?https?:/);
  assert.doesNotMatch(css, /@import/);
});

test('vendor/ es una copia exacta de las versiones instaladas', async () => {
  for (const [from, to] of VENDORED) {
    const a = await readFile(new URL(from, ROOT));
    const b = await readFile(new URL(to, ROOT));
    assert.ok(a.equals(b), `${to} no coincide; ejecuta: node scripts/vendor.mjs`);
  }
});

test('la CSP no permite scripts ni estilos inline', async () => {
  const html = await read('index.html');
  const csp  = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/);
  assert.doesNotMatch(html, /\son[a-z]+="/);           // sin manejadores inline
  assert.doesNotMatch(html, /\sstyle="/);               // sin estilos inline
  assert.doesNotMatch(html, /<script>(?!<\/script>)/);  // sin scripts inline
});

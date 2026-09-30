import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { hashTimeoutMs } from '../../src/hasher.js';

const ROOT = new URL('../../', import.meta.url);
const read = p => readFile(new URL(p, ROOT), 'utf8');

async function precacheList() {
  const sw = await read('sw.js');
  const m  = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

test('todo lo que precachea el service worker existe', async () => {
  for (const p of await precacheList()) {
    if (p === './') continue;
    await access(new URL(p, ROOT)); // lanza si no existe
  }
});

test('el service worker precachea todos los módulos y recursos de la app', async () => {
  const list = new Set(await precacheList());
  const src  = (await readdir(new URL('src/', ROOT))).filter(f => f.endsWith('.js')).map(f => 'src/' + f);
  const icons = (await readdir(new URL('icons/', ROOT))).map(f => 'icons/' + f);
  for (const p of ['index.html', 'styles.css', 'manifest.webmanifest', ...src, ...icons])
    assert.ok(list.has(p), `falta ${p} en PRECACHE de sw.js`);
});

test('manifest válido con iconos PNG de 192 y 512 que existen', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url);
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) await access(new URL(i.src, ROOT));
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
});

test('el tiempo límite de un hash crece con el tamaño y tiene un mínimo', () => {
  assert.equal(hashTimeoutMs(0), 60_000);
  assert.ok(hashTimeoutMs(1024 ** 3) > hashTimeoutMs(1024 ** 2));
  assert.ok(hashTimeoutMs(1024 ** 3) >= 1024 * 1000); // ≥ 1 s por MB
});

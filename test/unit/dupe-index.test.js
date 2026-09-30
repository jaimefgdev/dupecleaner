import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DupeIndex } from '../../src/dupe-index.js';

const add = (ix, name, size) => ix.addFile({ path: 'r/' + name, name, dir: 'r', relDir: [], size, lastModified: 1, canDelete: true, handle: {} });

test('solo los archivos del mismo tamaño son candidatos', () => {
  const ix = new DupeIndex();
  add(ix, 'a', 10); add(ix, 'b', 10); add(ix, 'c', 11);
  const c = ix.sizeCandidates();
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].map(r => r.name), ['a', 'b']);
});

test('el grupo incluye el tamaño en la clave: mismo hash y distinto tamaño no se agrupan', () => {
  const ix = new DupeIndex();
  const a = add(ix, 'a', 30), b = add(ix, 'b', 40);
  ix.addHash(a, 'h', true); ix.addHash(b, 'h', true);
  assert.equal(ix.dupGroups().length, 0);
});

test('grupos, original, bytes recuperables y marca de muestreo', () => {
  const ix = new DupeIndex();
  const [a, b, c] = ['a', 'b', 'c'].map(n => add(ix, n, 100));
  ix.addHash(a, 'h'); ix.addHash(b, 'h'); const g = ix.addHash(c, 'h', true);
  assert.equal(ix.keeperOf(g), a);
  assert.equal(g.sampled, true);
  assert.equal(ix.recoverableBytes(), 200);
});

test('removeFile disuelve el grupo cuando queda un solo archivo', () => {
  const ix = new DupeIndex();
  const [a, b, c] = ['a', 'b', 'c'].map(n => add(ix, n, 5));
  for (const r of [a, b, c]) ix.addHash(r, 'h');
  assert.equal(ix.removeFile(c.id).dissolved, false);
  const res = ix.removeFile(b.id);
  assert.equal(res.dissolved, true);
  assert.equal(ix.dupGroups().length, 0);
  assert.equal(ix.files.has(b.id), false);
});

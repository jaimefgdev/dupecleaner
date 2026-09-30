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

test('contadores incrementales coinciden con el cálculo completo', () => {
  const ix = new DupeIndex();
  const recs = [];
  for (let i = 0; i < 40; i++) recs.push(add(ix, 'f' + i, 10 + (i % 3)));
  const check = () => {
    const gs = ix.dupGroups();
    assert.equal(ix.dupGroupCount, gs.length);
    assert.equal(ix.recoverableBytes(), gs.reduce((s, g) => s + g.size * (g.files.length - 1), 0));
  };
  for (const r of recs) { ix.addHash(r, 'h' + (r.id % 4)); check(); }
  for (const r of recs.filter((_, i) => i % 3 === 0)) { ix.removeFile(r.id); check(); }
});

test('el original es siempre el primero en orden de escaneo, aunque los hashes lleguen desordenados', () => {
  const ix = new DupeIndex();
  const [a, b, c] = ['a', 'b', 'c'].map(n => add(ix, n, 7));
  ix.addHash(c, 'h'); ix.addHash(a, 'h'); const g = ix.addHash(b, 'h');
  assert.deepEqual(g.files.map(r => r.name), ['a', 'b', 'c']);
  assert.equal(ix.keeperOf(g), a);
});

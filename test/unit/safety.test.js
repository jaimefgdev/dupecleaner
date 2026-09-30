import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DupeIndex } from '../../src/dupe-index.js';
import { planRemoval, verifyBeforeRemoval, REFUSE } from '../../src/safety.js';
import { hashBlob } from '../../src/sha256.js';

const fullHash = f => hashBlob(f, 'full');

function setup(contents, { canDelete = true } = {}) {
  const ix = new DupeIndex();
  const disk = new Map(); // id → { data, mtime }
  const recs = contents.map((c, i) => {
    const r = ix.addFile({ path: 'r/f' + i, name: 'f' + i, dir: 'r', relDir: [], size: c.length, lastModified: 1000 + i, canDelete, handle: { id: i } });
    disk.set(r.id, { data: c, mtime: 1000 + i });
    return r;
  });
  for (const r of recs) ix.addHash(r, 'h');
  const readFile = async r => {
    const d = disk.get(r.id);
    if (!d) throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
    return new File([d.data], r.name, { lastModified: d.mtime });
  };
  return { ix, recs, disk, readFile };
}

test('planRemoval nunca incluye el original, aunque esté seleccionado', () => {
  const { ix, recs } = setup(['x', 'x', 'x']);
  const { actions, refused } = planRemoval(ix, recs.map(r => r.id));
  assert.deepEqual(actions.map(a => a.rec.id), [recs[1].id, recs[2].id]);
  assert.deepEqual(refused, [{ id: recs[0].id, rec: recs[0], reason: REFUSE.KEEPER }]);
  for (const a of actions) assert.equal(a.keeper, recs[0]);
});

test('planRemoval rechaza ids desconocidos y archivos de solo lectura', () => {
  const { ix, recs } = setup(['x', 'x'], { canDelete: false });
  const { actions, refused } = planRemoval(ix, [recs[1].id, 999]);
  assert.equal(actions.length, 0);
  assert.deepEqual(refused.map(r => r.reason).sort(), [REFUSE.MISSING, REFUSE.READ_ONLY].sort());
});

test('verifyBeforeRemoval acepta copias idénticas y devuelve el hash completo', async () => {
  const { recs, readFile } = setup(['hola', 'hola']);
  const v = await verifyBeforeRemoval({ keeper: recs[0], target: recs[1], readFile, fullHash });
  assert.equal(v.ok, true);
  assert.equal(v.hash, await fullHash(new Blob(['hola'])));
});

test('verifyBeforeRemoval rechaza si el contenido completo difiere (falso positivo del muestreo)', async () => {
  const { recs, readFile } = setup(['hola', 'holb']);
  const v = await verifyBeforeRemoval({ keeper: recs[0], target: recs[1], readFile, fullHash });
  assert.deepEqual(v, { ok: false, reason: REFUSE.CONTENT_DIFFERS });
});

test('verifyBeforeRemoval rechaza si el original cambió o desapareció tras el escaneo', async () => {
  const { recs, disk, readFile } = setup(['hola', 'hola']);
  disk.get(recs[0].id).mtime = 5;
  assert.equal((await verifyBeforeRemoval({ keeper: recs[0], target: recs[1], readFile, fullHash })).reason, REFUSE.KEEPER_CHANGED);
  disk.delete(recs[0].id);
  assert.equal((await verifyBeforeRemoval({ keeper: recs[0], target: recs[1], readFile, fullHash })).reason, REFUSE.KEEPER_CHANGED);
});

test('verifyBeforeRemoval rechaza si la copia cambió tras el escaneo', async () => {
  const { recs, disk, readFile } = setup(['hola', 'hola']);
  disk.get(recs[1].id).data = 'hola!';
  assert.equal((await verifyBeforeRemoval({ keeper: recs[0], target: recs[1], readFile, fullHash })).reason, REFUSE.TARGET_CHANGED);
});

test('verifyBeforeRemoval rechaza si original y copia son el mismo archivo', async () => {
  const { recs, readFile } = setup(['hola', 'hola']);
  const same = { isSameEntry: async () => true };
  const v = await verifyBeforeRemoval({ keeper: { ...recs[0], handle: same }, target: { ...recs[1], handle: same }, readFile, fullHash });
  assert.equal(v.reason, REFUSE.SAME_FILE);
});

test('verifyBeforeRemoval trata un fallo de lectura/hash como "no tocar"', async () => {
  const { recs, readFile } = setup(['hola', 'hola']);
  const boom = async () => { throw new Error('io'); };
  const v = await verifyBeforeRemoval({ keeper: recs[0], target: recs[1], readFile, fullHash: boom });
  assert.equal(v.ok, false);
});

test('el hash del original se calcula una sola vez con cache', async () => {
  const { recs, readFile } = setup(['hola', 'hola', 'hola']);
  let calls = 0;
  const counting = async f => { calls++; return fullHash(f); };
  const cache = new Map();
  for (const target of recs.slice(1)) {
    assert.equal((await verifyBeforeRemoval({ keeper: recs[0], target, readFile, fullHash: counting, cache })).ok, true);
  }
  assert.equal(calls, 3); // 1 original + 2 copias
});

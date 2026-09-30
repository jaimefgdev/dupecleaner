import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDir } from '../helpers/fake-fs.js';
import { moveToQuarantine, removeFile, uniqueName, QUARANTINE_DIR } from '../../src/quarantine.js';
import { hashBlob } from '../../src/sha256.js';

const fullHash = f => hashBlob(f, 'full');
const target = (root, path) => {
  const parts = path.split('/');
  return { root, relDir: parts.slice(0, -1), parent: root.at(parts.slice(0, -1).join('/')) || root, handle: root.at(path), name: parts.at(-1) };
};

test('mueve a la cuarentena conservando la ruta relativa', async () => {
  const root = FakeDir.tree({ 'fotos/2024/a.jpg': 'AAA', 'b.jpg': 'AAA' });
  const dest = await moveToQuarantine(target(root, 'fotos/2024/a.jpg'));
  assert.equal(dest, `${QUARANTINE_DIR}/fotos/2024/a.jpg`);
  const d = root.dump();
  assert.equal(d[`${QUARANTINE_DIR}/fotos/2024/a.jpg`], 'AAA');
  assert.equal(d['fotos/2024/a.jpg'], undefined);
  assert.equal(d['b.jpg'], 'AAA');
});

test('no sobrescribe nada en la cuarentena: añade " (1)", " (2)"…', async () => {
  const root = FakeDir.tree({ 'x.txt': 'nuevo', [`${QUARANTINE_DIR}/x.txt`]: 'viejo', [`${QUARANTINE_DIR}/x (1).txt`]: 'viejo1' });
  const dest = await moveToQuarantine(target(root, 'x.txt'));
  assert.equal(dest, `${QUARANTINE_DIR}/x (2).txt`);
  const d = root.dump();
  assert.equal(d[`${QUARANTINE_DIR}/x.txt`], 'viejo');
  assert.equal(d[`${QUARANTINE_DIR}/x (1).txt`], 'viejo1');
  assert.equal(d[`${QUARANTINE_DIR}/x (2).txt`], 'nuevo');
});

test('uniqueName con archivos sin extensión', async () => {
  const root = FakeDir.tree({ 'LEEME': '1' });
  assert.equal(await uniqueName(root, 'LEEME'), 'LEEME (1)');
  assert.equal(await uniqueName(root, 'otro'), 'otro');
});

test('sin move(): copia, comprueba el hash de la copia y solo entonces borra el original', async () => {
  const root = FakeDir.tree({ 'd/a.bin': 'contenido' }, { withMove: false });
  const expectedHash = await fullHash(new Blob(['contenido']));
  const dest = await moveToQuarantine({ ...target(root, 'd/a.bin'), fullHash, expectedHash });
  const d = root.dump();
  assert.equal(d[dest], 'contenido');
  assert.equal(d['d/a.bin'], undefined);
});

test('sin move(): si la copia no cuadra, se borra la copia y el original se queda', async () => {
  const root = FakeDir.tree({ 'd/a.bin': 'contenido' }, { withMove: false });
  await assert.rejects(moveToQuarantine({ ...target(root, 'd/a.bin'), fullHash, expectedHash: 'otro-hash' }));
  const d = root.dump();
  assert.equal(d['d/a.bin'], 'contenido');
  assert.equal(d[`${QUARANTINE_DIR}/d/a.bin`], undefined);
});

test('removeFile borra definitivamente', async () => {
  const root = FakeDir.tree({ 'a.txt': '1', 'b.txt': '2' });
  await removeFile(target(root, 'a.txt'));
  assert.deepEqual(root.dump(), { 'b.txt': '2' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { SHA256, hashBlob, isSampled, SAMPLE_THRESHOLD, SAMPLE_CHUNK } from '../../src/sha256.js';

const nodeSha = buf => createHash('sha256').update(buf).digest('hex');

test('SHA256 coincide con el de Node en tamaños límite y leyendo por trozos', () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 65537]) {
    const buf = randomBytes(n);
    for (const chunk of [1, 7, 64, 777, Math.max(1, n)]) {
      const s = new SHA256();
      for (let i = 0; i < n; i += chunk) s.update(buf.subarray(i, i + chunk));
      assert.equal(s.final(), nodeSha(buf), `n=${n} chunk=${chunk}`);
    }
  }
});

test('vector conocido: "abc"', () => {
  const s = new SHA256();
  s.update(new TextEncoder().encode('abc'));
  assert.equal(s.final(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('hashBlob en modo full es el SHA-256 real del contenido', async () => {
  const buf = randomBytes(300_000);
  assert.equal(await hashBlob(new Blob([buf]), 'full'), nodeSha(buf));
});

test('isSampled solo aplica en modo muestras y por encima del umbral', () => {
  assert.equal(isSampled(SAMPLE_THRESHOLD, 'sample'), false);
  assert.equal(isSampled(SAMPLE_THRESHOLD + 1, 'sample'), true);
  assert.equal(isSampled(SAMPLE_THRESHOLD + 1, 'full'), false);
});

test('el modo muestras NO distingue archivos que solo difieren fuera de las muestras (por eso hay que verificar)', async () => {
  const size = SAMPLE_THRESHOLD + 1024 * 1024;
  const a = new Uint8Array(size);
  const b = new Uint8Array(size);
  b[SAMPLE_CHUNK + 100] = 1; // fuera de inicio, centro y final
  assert.equal(await hashBlob(new Blob([a]), 'sample'), await hashBlob(new Blob([b]), 'sample'));
  assert.notEqual(await hashBlob(new Blob([a]), 'full'), await hashBlob(new Blob([b]), 'full'));
});

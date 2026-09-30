import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { SHA256, hashBlob, isSampled, needsPrefix, SAMPLE_THRESHOLD, SAMPLE_CHUNK, PREFIX_BYTES } from '../../src/sha256.js';

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

test('motor WebAssembly (hash-wasm) y motor JS dan el mismo resultado en todas las estrategias', async () => {
  const { createSHA256 } = await import('../../src/wasm-sha256.js');
  const wasm = await createSHA256();
  for (const n of [0, 1, 64, 65_536, 200_000, SAMPLE_THRESHOLD + 12_345]) {
    const blob = new Blob([randomBytes(n)]);
    for (const strategy of ['full', 'sample', 'prefix']) {
      assert.equal(await hashBlob(blob, strategy, wasm), await hashBlob(blob, strategy), `n=${n} ${strategy}`);
    }
  }
});

test('el prefiltro solo mira los primeros 64 KB', async () => {
  const a = randomBytes(PREFIX_BYTES * 3);
  const b = Buffer.from(a); b[PREFIX_BYTES + 1] ^= 1;
  assert.equal(await hashBlob(new Blob([a]), 'prefix'), await hashBlob(new Blob([b]), 'prefix'));
  assert.equal(await hashBlob(new Blob([a]), 'prefix'), nodeSha(a.subarray(0, PREFIX_BYTES)));
  assert.equal(needsPrefix(PREFIX_BYTES * 2), false);
  assert.equal(needsPrefix(PREFIX_BYTES * 2 + 1), true);
});

test('hash-wasm es mucho más rápido que el SHA-256 en JS', async () => {
  const { createSHA256 } = await import('../../src/wasm-sha256.js');
  const wasm = await createSHA256();
  const blob = new Blob([randomBytes(32 * 1024 * 1024)]);
  let t = performance.now(); await hashBlob(blob, 'full');       const js = performance.now() - t;
  t = performance.now();     await hashBlob(blob, 'full', wasm); const wa = performance.now() - t;
  console.log(`SHA-256 32 MB: JS ${js.toFixed(0)} ms · WASM ${wa.toFixed(0)} ms (${(js / wa).toFixed(1)}×)`);
  assert.ok(js / wa > 4, `solo ${(js / wa).toFixed(1)}×`);
});

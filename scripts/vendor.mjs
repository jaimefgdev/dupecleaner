// Copia las dependencias de navegador desde node_modules a vendor/.
// La app no tiene paso de build: se sirven tal cual. Uso: node scripts/vendor.mjs
import { copyFile, mkdir } from 'node:fs/promises';

const FILES = [
  ['node_modules/hash-wasm/dist/sha256.umd.min.js', 'vendor/hash-wasm/sha256.umd.min.js'],
  ['node_modules/hash-wasm/LICENSE',                'vendor/hash-wasm/LICENSE'],
];

await mkdir('vendor/hash-wasm', { recursive: true });
for (const [from, to] of FILES) { await copyFile(from, to); console.log(to); }

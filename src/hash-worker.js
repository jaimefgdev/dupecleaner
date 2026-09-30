// Worker de hashing (módulo). Recibe un File y devuelve su hash sin bloquear la interfaz.
// Usa SHA-256 en WebAssembly (hash-wasm); si no está disponible, JavaScript puro.
import { hashBlob, jsEngine } from './sha256.js';

let enginePromise = null;
function getEngine(kind) {
  if (kind === 'js') return Promise.resolve(jsEngine());
  enginePromise ??= import('./wasm-sha256.js')
    .then(m => m.createSHA256())
    .catch(err => { console.warn('[hash-worker] WebAssembly SHA-256 unavailable, using JS:', err); return jsEngine(); });
  return enginePromise;
}

// Un trabajo cada vez: el motor WebAssembly guarda estado y no se puede intercalar
let queue = Promise.resolve();

self.onmessage = ({ data: { id, file, strategy, engine } }) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({ id, hash: await hashBlob(file, strategy, await getEngine(engine)) });
    } catch (err) {
      self.postMessage({ id, hash: null, error: String(err?.message || err) });
    }
  });
};

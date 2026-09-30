// Worker de hashing (módulo). Recibe un File y devuelve su hash sin bloquear la interfaz.
import { hashBlob } from './sha256.js';

self.onmessage = async ({ data: { id, file, strategy } }) => {
  try {
    self.postMessage({ id, hash: await hashBlob(file, strategy) });
  } catch (err) {
    self.postMessage({ id, hash: null, error: String(err?.message || err) });
  }
};

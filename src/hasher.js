// Cliente del worker de hashing en el hilo principal.

export function createHasher() {
  const worker  = new Worker(new URL('./hash-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;

  worker.onmessage = ({ data: { id, hash, error } }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (hash) p.resolve(hash);
    else      p.reject(new Error(error || 'hash failed'));
  };
  worker.onerror = ev => {
    const err = new Error(ev.message || 'hash worker error');
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  return {
    /** Promesa con el hash hex; se rechaza si el archivo no se puede leer */
    hash(file, strategy) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, file, strategy });
      });
    },
  };
}

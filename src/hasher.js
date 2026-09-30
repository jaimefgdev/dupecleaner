// Cliente del worker de hashing en el hilo principal.
//
// - hash(file, strategy, { signal }) devuelve una promesa con el hash hex.
// - Si `signal` se aborta, el worker se termina (aunque esté a mitad de un
//   archivo de muchos GB) y se crea otro nuevo.
// - Cada hash tiene un tiempo límite proporcional al tamaño: si el worker se
//   cuelga, la promesa se rechaza en vez de dejar el escaneo parado.

const MB = 1024 * 1024;

/** Tiempo límite de un hash: 60 s de margen + 1 s por MB (≈1 MB/s, muy por debajo de lo normal) */
export const hashTimeoutMs = size => 60_000 + Math.ceil(size / MB) * 1000;

const abortError   = () => new DOMException('Hash cancelled', 'AbortError');
const timeoutError = () => new DOMException('Hash timed out', 'TimeoutError');

export function createHasher({ timeoutMs = hashTimeoutMs } = {}) {
  const pending = new Map(); // id → { resolve, reject, timer, cleanup }
  let seq = 0;
  let worker;

  function settle(id, fn, value) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.cleanup();
    p[fn](value);
  }

  function spawn() {
    worker = new Worker(new URL('./hash-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: { id, hash, error } }) => {
      if (hash) settle(id, 'resolve', hash);
      else      settle(id, 'reject', new Error(error || 'hash failed'));
    };
    worker.onerror = ev => {
      ev.preventDefault?.();
      restart(() => new Error(ev.message || 'hash worker error'));
    };
  }

  /** Termina el worker actual, rechaza todo lo pendiente y crea otro */
  function restart(makeError = abortError) {
    worker.terminate();
    for (const id of [...pending.keys()]) settle(id, 'reject', makeError());
    spawn();
  }

  spawn();

  return {
    hash(file, strategy, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const onAbort = () => restart();
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => {
          settle(id, 'reject', timeoutError());
          restart(); // el worker podría estar colgado: empezar de cero
        }, timeoutMs(file.size));
        pending.set(id, { resolve, reject, timer, cleanup: () => signal?.removeEventListener('abort', onAbort) });
        worker.postMessage({ id, file, strategy });
      });
    },
    /** Cancela todos los hashes en curso */
    cancel() { if (pending.size) restart(); },
  };
}

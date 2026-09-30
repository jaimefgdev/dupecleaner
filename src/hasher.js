// Pool de workers de hashing en el hilo principal.
//
// - hash(file, strategy, { signal }) devuelve una promesa con el hash hex.
//   Los trabajos se reparten entre `size` workers; cada worker hace uno cada vez.
// - Si `signal` se aborta, se terminan los workers (aunque estén a mitad de un
//   archivo de muchos GB) y se crean otros nuevos.
// - Cada hash tiene un tiempo límite proporcional al tamaño: si un worker se
//   cuelga, la promesa se rechaza en vez de dejar el escaneo parado.

const MB = 1024 * 1024;

/** Tiempo límite de un hash: 60 s de margen + 1 s por MB (≈1 MB/s, muy por debajo de lo normal) */
export const hashTimeoutMs = size => 60_000 + Math.ceil(size / MB) * 1000;

/** Tamaño de pool razonable: deja un núcleo libre y no pasa de 4 (el disco es el límite) */
export const defaultPoolSize = (cores = 2) => Math.max(1, Math.min(4, cores - 1));

const abortError   = () => new DOMException('Hash cancelled', 'AbortError');
const timeoutError = () => new DOMException('Hash timed out', 'TimeoutError');

export function createHasher({
  size      = defaultPoolSize(globalThis.navigator?.hardwareConcurrency),
  engine    = 'wasm',
  timeoutMs = hashTimeoutMs,
} = {}) {
  const queue   = [];        // trabajos esperando un worker libre
  const running = new Map(); // id → trabajo en curso
  let workers   = [];
  let seq       = 0;

  const newWorker = () => {
    const w = new Worker(new URL('./hash-worker.js', import.meta.url), { type: 'module' });
    w.busy = null;
    w.onmessage = ({ data: { id, hash, error } }) => {
      w.busy = null;
      if (hash) settle(id, 'resolve', hash);
      else      settle(id, 'reject', new Error(error || 'hash failed'));
      pump();
    };
    w.onerror = ev => {
      ev.preventDefault?.();
      restart(() => new Error(ev.message || 'hash worker error'));
    };
    return w;
  };

  function settle(id, fn, value) {
    const job = running.get(id) || queue.find(j => j.id === id);
    if (!job) return;
    running.delete(id);
    const qi = queue.indexOf(job);
    if (qi >= 0) queue.splice(qi, 1);
    clearTimeout(job.timer);
    job.cleanup();
    job[fn](value);
  }

  function pump() {
    for (const w of workers) {
      if (w.busy || !queue.length) continue;
      const job = queue.shift();
      w.busy = job.id;
      running.set(job.id, job);
      job.timer = setTimeout(() => {
        settle(job.id, 'reject', timeoutError());
        restart(); // el worker podría estar colgado: empezar de cero
      }, timeoutMs(job.file.size));
      w.postMessage({ id: job.id, file: job.file, strategy: job.strategy, engine });
    }
  }

  /** Termina todos los workers, rechaza todo lo pendiente y crea otros */
  function restart(makeError = abortError) {
    for (const w of workers) w.terminate();
    for (const id of [...running.keys(), ...queue.map(j => j.id)]) settle(id, 'reject', makeError());
    workers = Array.from({ length: size }, newWorker);
  }

  workers = Array.from({ length: size }, newWorker);

  return {
    size,
    hash(file, strategy, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const onAbort = () => restart();
        signal?.addEventListener('abort', onAbort, { once: true });
        queue.push({ id, file, strategy, resolve, reject, timer: null,
                     cleanup: () => signal?.removeEventListener('abort', onAbort) });
        pump();
      });
    },
    /** Cancela todos los hashes en curso */
    cancel() { if (running.size || queue.length) restart(); },
  };
}

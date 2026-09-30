// SHA-256 en WebAssembly (hash-wasm, MIT), servido desde vendor/.
// El bundle UMD se registra en globalThis.hashwasm al importarlo.
import '../vendor/hash-wasm/sha256.umd.min.js';

export const createSHA256 = (...args) => globalThis.hashwasm.createSHA256(...args);

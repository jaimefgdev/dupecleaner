// SHA-256 incremental en JavaScript puro.
// Se usa en el worker de hashing y en las pruebas unitarias (Node también tiene Blob).

/* ── SHA-256 round constants (cube roots of first 64 primes) ── */
const _K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);

const _ror = (n, s) => (n >>> s) | (n << (32 - s));

export class SHA256 {
  constructor() {
    this._h = new Uint32Array([
      0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
    ]);
    this._buf    = new Uint8Array(64);
    this._bufLen = 0;
    this._total  = 0; /* bytes fed so far */
  }

  update(data) {
    if (!(data instanceof Uint8Array))
      data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let i = 0;
    const len = data.length;
    this._total += len;

    if (this._bufLen > 0) {
      const take = Math.min(64 - this._bufLen, len);
      this._buf.set(data.subarray(0, take), this._bufLen);
      this._bufLen += take;
      i = take;
      if (this._bufLen === 64) { this._compress(this._buf); this._bufLen = 0; }
    }
    while (i + 64 <= len) { this._compress(data.subarray(i, i + 64)); i += 64; }
    if (i < len) { this._buf.set(data.subarray(i), 0); this._bufLen = len - i; }
  }

  final() {
    const padLen = this._bufLen < 56 ? 64 : 128;
    const pad    = new Uint8Array(padLen);
    pad.set(this._buf.subarray(0, this._bufLen));
    pad[this._bufLen] = 0x80;

    const bits = this._total * 8;
    const dv   = new DataView(pad.buffer, padLen - 8);
    dv.setUint32(0, Math.floor(bits / 0x100000000) >>> 0);
    dv.setUint32(4, bits >>> 0);

    this._compress(pad.subarray(0, 64));
    if (padLen === 128) this._compress(pad.subarray(64));

    const out = new Uint8Array(32);
    const ov  = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, this._h[i]);
    return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  _compress(blk) {
    const w  = new Uint32Array(64);
    const dv = new DataView(blk.buffer, blk.byteOffset, 64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = _ror(w[i-15], 7) ^ _ror(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = _ror(w[i-2], 17) ^ _ror(w[i-2], 19)  ^ (w[i-2]  >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = this._h;
    for (let i = 0; i < 64; i++) {
      const S1   = _ror(e, 6) ^ _ror(e, 11) ^ _ror(e, 25);
      const ch   = (e & f) ^ (~e & g);
      const tmp1 = (h + S1 + ch + _K[i] + w[i]) >>> 0;
      const S0   = _ror(a, 2) ^ _ror(a, 13) ^ _ror(a, 22);
      const maj  = (a & b) ^ (a & c) ^ (b & c);
      const tmp2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+tmp1)>>>0; d=c; c=b; b=a; a=(tmp1+tmp2)>>>0;
    }
    this._h[0]=(this._h[0]+a)>>>0; this._h[1]=(this._h[1]+b)>>>0;
    this._h[2]=(this._h[2]+c)>>>0; this._h[3]=(this._h[3]+d)>>>0;
    this._h[4]=(this._h[4]+e)>>>0; this._h[5]=(this._h[5]+f)>>>0;
    this._h[6]=(this._h[6]+g)>>>0; this._h[7]=(this._h[7]+h)>>>0;
  }
}

/* Archivos mayores que este umbral se comparan por muestras en modo rápido */
export const SAMPLE_THRESHOLD = 20 * 1024 * 1024;
export const SAMPLE_CHUNK     =  2 * 1024 * 1024;

/** true si un archivo de este tamaño se compara solo por muestras con esta estrategia */
export const isSampled = (size, strategy) => strategy !== 'full' && size > SAMPLE_THRESHOLD;

/* ── Stream a Blob chunk-by-chunk into the SHA256 state ── */
export async function pipeBlob(sha, blob) {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sha.update(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Hash de un Blob/File.
 * strategy 'full'   → SHA-256 de todo el contenido.
 * strategy 'sample' → para archivos > SAMPLE_THRESHOLD, SHA-256 de tres trozos
 *                     (inicio, centro, final). NO prueba que dos archivos sean
 *                     idénticos: solo sirve para detectar candidatos.
 */
export async function hashBlob(blob, strategy = 'full') {
  const sha = new SHA256();
  if (!isSampled(blob.size, strategy)) {
    await pipeBlob(sha, blob);
  } else {
    const mid = Math.max(0, Math.floor(blob.size / 2) - SAMPLE_CHUNK / 2);
    await pipeBlob(sha, blob.slice(0,   SAMPLE_CHUNK));
    await pipeBlob(sha, blob.slice(mid, mid + SAMPLE_CHUNK));
    await pipeBlob(sha, blob.slice(Math.max(0, blob.size - SAMPLE_CHUNK)));
  }
  return sha.final();
}

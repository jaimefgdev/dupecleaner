// Servidor estático mínimo, sin dependencias, para desarrollo y pruebas.
// Uso: node scripts/serve.mjs [puerto]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ttf':  'font/ttf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  try {
    const url  = new URL(req.url, 'http://localhost');
    let path   = normalize(decodeURIComponent(url.pathname));
    if (path.endsWith(sep) || path.endsWith('/')) path = join(path, 'index.html');
    const file = resolve(join(ROOT, path));
    // Nunca servir nada fuera del proyecto
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`DupeCleaner en http://localhost:${PORT}/`);
});

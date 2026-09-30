// Copia a _site/ solo lo que se publica (sin tests, node_modules, etc.).
// Lo usa el workflow de GitHub Pages. Uso: node scripts/build-site.mjs
import { cp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const SITE_ENTRIES = [
  'index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'LICENSE',
  'icons', 'src', 'vendor',
];

/** Lista plana de archivos publicados (rutas relativas con /) */
export async function siteFiles(root = '.') {
  const out = [];
  for (const e of SITE_ENTRIES) {
    try {
      for (const d of await readdir(join(root, e), { recursive: true, withFileTypes: true }))
        if (d.isFile()) out.push(relative(root, join(d.parentPath, d.name)).split(sep).join('/'));
    } catch (err) {
      if (err.code !== 'ENOTDIR') throw err;
      out.push(e);
    }
  }
  return out.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await rm('_site', { recursive: true, force: true });
  await mkdir('_site');
  for (const e of SITE_ENTRIES) await cp(e, `_site/${e}`, { recursive: true });
  await writeFile('_site/.nojekyll', ''); // servir tal cual, sin Jekyll
  console.log((await siteFiles('_site')).length + ' archivos en _site/');
}

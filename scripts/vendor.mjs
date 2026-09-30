// Copia las dependencias de navegador desde node_modules a vendor/.
// La app no tiene paso de build ni usa CDN: todo se sirve desde el propio
// sitio. Uso: node scripts/vendor.mjs (tras npm ci o al actualizar versiones)
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const FA = 'node_modules/@fortawesome/fontawesome-free';
const FS = 'node_modules/@fontsource';

export const FILES = [
  // SHA-256 en WebAssembly (MIT)
  ['node_modules/hash-wasm/dist/sha256.umd.min.js', 'vendor/hash-wasm/sha256.umd.min.js'],
  ['node_modules/hash-wasm/LICENSE',                'vendor/hash-wasm/LICENSE'],
  // Font Awesome Free, solo el estilo "solid" (iconos CC BY 4.0, fuente OFL 1.1, CSS MIT)
  [`${FA}/css/fontawesome.min.css`,     'vendor/fontawesome/css/fontawesome.min.css'],
  [`${FA}/css/solid.min.css`,           'vendor/fontawesome/css/solid.min.css'],
  [`${FA}/webfonts/fa-solid-900.woff2`, 'vendor/fontawesome/webfonts/fa-solid-900.woff2'],
  [`${FA}/webfonts/fa-solid-900.ttf`,   'vendor/fontawesome/webfonts/fa-solid-900.ttf'],
  [`${FA}/LICENSE.txt`,                 'vendor/fontawesome/LICENSE.txt'],
  // Inter y Fira Code (SIL OFL 1.1), subconjunto latino
  [`${FS}/inter/files/inter-latin-400-normal.woff2`,         'vendor/fonts/inter-latin-400.woff2'],
  [`${FS}/inter/files/inter-latin-700-normal.woff2`,         'vendor/fonts/inter-latin-700.woff2'],
  [`${FS}/inter/LICENSE`,                                    'vendor/fonts/LICENSE-Inter.txt'],
  [`${FS}/fira-code/files/fira-code-latin-400-normal.woff2`, 'vendor/fonts/fira-code-latin-400.woff2'],
  [`${FS}/fira-code/files/fira-code-latin-700-normal.woff2`, 'vendor/fonts/fira-code-latin-700.woff2'],
  [`${FS}/fira-code/LICENSE`,                                'vendor/fonts/LICENSE-FiraCode.txt'],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [from, to] of FILES) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    console.log(to);
  }
}

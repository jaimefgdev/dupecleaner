// Utilidades de las pruebas end-to-end.
//
// REGLA: las pruebas solo trabajan sobre OPFS (Origin Private File System),
// un almacenamiento privado del navegador que Playwright crea vacío en cada
// contexto y descarta al terminar. Nunca se abre un selector de carpetas real:
// window.showDirectoryPicker se sustituye para que devuelva una carpeta de OPFS.
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    // Pruebas herméticas: nada de red externa (CDN de iconos/fuentes)
    await page.route(url => !['localhost', '127.0.0.1'].includes(new URL(url).hostname), r => r.abort());
    await page.addInitScript(() => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory(); // OPFS, nunca el disco real
        return root.getDirectoryHandle(window.__pickDir);
      };
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e));
    await page.goto('/');
    await use(page);
    expect(errors, 'errores de JavaScript en la página').toEqual([]);
  },
});
export { expect };

/**
 * Crea en OPFS la carpeta `dir` con los archivos de `spec`:
 *   { 'a/b.txt': 'texto', 'big.bin': { size: 21 * MB, patches: [[offset, byte], ...] } }
 */
export async function writeTree(page, dir, spec) {
  await page.evaluate(async ({ dir, spec }) => {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(dir, { create: true });
    for (const [path, content] of Object.entries(spec)) {
      const parts = path.split('/');
      let d = base;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      if (typeof content === 'string') {
        await w.write(content);
      } else {
        const CH = 1024 * 1024;
        for (let off = 0; off < content.size; off += CH) await w.write(new Uint8Array(Math.min(CH, content.size - off)));
        for (const [position, byte] of content.patches || [])
          await w.write({ type: 'write', position, data: new Uint8Array([byte]) });
      }
      await w.close();
    }
  }, { dir, spec });
}

/** Devuelve { ruta: contenido } (contenido = texto, o `<N bytes>` si es grande) */
export async function readTree(page, dir) {
  return page.evaluate(async dir => {
    const out  = {};
    const walk = async (d, prefix) => {
      for await (const [name, h] of d.entries()) {
        const p = prefix ? prefix + '/' + name : name;
        if (h.kind === 'directory') await walk(h, p);
        else {
          const f = await h.getFile();
          out[p] = f.size > 4096 ? `<${f.size} bytes>` : await f.text();
        }
      }
    };
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle(dir), '');
    return out;
  }, dir);
}

/** Sobrescribe un archivo existente en OPFS */
export async function overwrite(page, dir, path, text) {
  await writeTree(page, dir, { [path]: text });
}

/** Elige la carpeta OPFS `dir` y lanza el escaneo; espera a que termine */
export async function scanFolder(page, dir) {
  await page.evaluate(d => { window.__pickDir = d; }, dir);
  await page.click('#home [data-action="pick-folder"]');
  await page.click('[data-action="begin-scan"]');
  await expect(page.locator('#scan-lbl')).toHaveText(/completado/);
}

/** Selecciona todas las copias, abre el diálogo de quitar */
export async function selectAllAndOpen(page) {
  await page.click('[data-action="select-all"]');
  await page.click('#btn-del');
  await expect(page.locator('#modal-ov')).toHaveClass(/on/);
}

/** Espera a que acabe una operación de quitar y devuelve el texto del registro */
export async function waitRemovalDone(page) {
  await expect(page.locator('#feed .fl-ok').last()).toHaveText(/movidos a cuarentena|eliminados/);
  return page.locator('#feed').innerText();
}

/** Ruta relativa (sin la carpeta raíz) del archivo marcado como original */
export async function keeperPath(page) {
  const rows = page.locator('.df.orig');
  const dir  = await rows.first().locator('.df-path').innerText();
  const name = (await rows.first().locator('.df-name').innerText()).replace(/original$/, '').trim();
  return (dir.split('/').slice(1).concat(name)).join('/');
}

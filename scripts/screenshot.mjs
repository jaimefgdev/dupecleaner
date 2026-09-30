// Genera las capturas del README (docs/screenshot.png y docs/screenshot-quarantine.png).
//
//   node scripts/screenshot.mjs   (arranca su propio servidor local)
//
// Usa solo datos inventados en OPFS (el almacenamiento privado del navegador, que
// Playwright crea vacío y descarta al cerrar). Nunca abre un selector de carpetas
// real: window.showDirectoryPicker devuelve la carpeta de OPFS «Descargas».
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4174;
const URL_ = `http://localhost:${PORT}/`;
const KB = 1024;

// Carpeta de ejemplo: 11 archivos, 4 conjuntos de duplicados.
const FILES = {
  'presupuesto.xlsx':                    { size: 90 * KB, seed: 1 },
  'Trabajo/presupuesto (final).xlsx':    { size: 90 * KB, seed: 1 },
  'notas-viaje.md':                      '# Notas de viaje\n\n- Billetes: reservados\n- Hotel: confirmado\n- Cámara: cargar baterías\n',
  'Documentos/notas-viaje (1).md':       '# Notas de viaje\n\n- Billetes: reservados\n- Hotel: confirmado\n- Cámara: cargar baterías\n',
  'Copia/notas-viaje.md':                '# Notas de viaje\n\n- Billetes: reservados\n- Hotel: confirmado\n- Cámara: cargar baterías\n',
  'factura-marzo.pdf':                   { size: 120 * KB, seed: 2 },
  'Documentos/Facturas/factura-marzo.pdf': { size: 120 * KB, seed: 2 },
  'Musica/cancion.mp3':                  { size: 300 * KB, seed: 3 },
  'cancion.mp3':                         { size: 300 * KB, seed: 3 },
  'Fotos/playa.jpg':                     { size: 210 * KB, seed: 4 },
  'Fotos/montaña.jpg':                   { size: 180 * KB, seed: 5 },
};

async function waitForServer(url, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* aún arrancando */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('el servidor local no arrancó');
}

const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
try {
  await waitForServer(URL_);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

  await page.addInitScript(() => {
    localStorage.setItem('dc-theme', 'dark');
    localStorage.setItem('dc-lang', 'es');
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('Descargas');
  });
  await page.goto(URL_);

  // Crea los archivos en OPFS. Los binarios usan un patrón determinista por «seed».
  await page.evaluate(async files => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Descargas', { create: true });
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split('/');
      let d = root;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      if (typeof content === 'string') await w.write(content);
      else {
        const buf = new Uint8Array(content.size);
        for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + content.seed * 97) & 0xff;
        await w.write(buf);
      }
      await w.close();
    }
  }, FILES);

  await page.click('#home [data-action="pick-folder"]');
  await page.click('[data-action="begin-scan"]');
  await page.locator('#scan-lbl').filter({ hasText: /completado/ }).waitFor();
  await page.click('[data-action="select-all"]');
  await page.locator('.df', { hasText: 'notas-viaje (1).md' }).locator('[data-action="preview"]').click();
  await page.locator('#pv-content, .pv-pre').first().waitFor();
  // La lista vuelve arriba para que se vean los grupos completos.
  await page.evaluate(() => { document.getElementById('dupes-scroll').scrollTop = 0; document.getAnimations().forEach(a => a.finish()); });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'docs/screenshot.png' });

  await page.click('#btn-del');
  await page.locator('#modal-ov.on').waitFor();
  await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
  await page.screenshot({ path: 'docs/screenshot-quarantine.png' });

  await browser.close();
  console.log('Capturas generadas en docs/');
} finally {
  server.kill();
}

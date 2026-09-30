// Genera docs/screenshot.png con datos de ejemplo en OPFS (nunca archivos reales).
// Uso: npm run serve  (en otra terminal)  y después  node scripts/screenshot.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await page.addInitScript(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Descargas');
});
await page.goto(BASE);
await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle('Descargas', { create: true });
  const put  = async (path, data) => {
    const parts = path.split('/');
    let d = base;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(data); await w.close();
  };
  const notes = '# Notas de viaje\n\n- Billetes: reservados\n- Hotel: confirmado\n- Cámara: cargar baterías\n';
  const files = {
    'notas-viaje.md': notes, 'Documentos/notas-viaje (1).md': notes, 'Copia/notas-viaje.md': notes,
    'factura-marzo.pdf': 'PDF'.repeat(40000), 'Documentos/Facturas/factura-marzo.pdf': 'PDF'.repeat(40000),
    'presupuesto.xlsx': 'X'.repeat(90000), 'Trabajo/presupuesto (final).xlsx': 'X'.repeat(90000),
    'cancion.mp3': 'M'.repeat(300000), 'Musica/cancion.mp3': 'M'.repeat(300000),
    'otro.txt': 'único', 'Fotos/playa.jpg': 'J'.repeat(50000),
  };
  for (const [p, c] of Object.entries(files)) await put(p, c);
});
await page.click('[data-action="toggle-theme"]');
await page.click('#home [data-action="pick-folder"]');
await page.click('[data-action="begin-scan"]');
await page.waitForFunction(() => /completado/.test(document.getElementById('scan-lbl').textContent));
await page.click('[data-action="select-all"]');
await page.locator('.df', { hasText: 'notas-viaje (1).md' }).locator('.btn-eye').click();
await page.evaluate(() => { document.getElementById('dupes-scroll').scrollTop = 0; document.activeElement.blur(); });
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/screenshot.png' });
await browser.close();
console.log('docs/screenshot.png');

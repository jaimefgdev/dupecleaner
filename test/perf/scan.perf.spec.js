// Prueba de rendimiento: mismo conjunto de datos generado en OPFS, escaneado
// con el motor anterior (?perf=legacy: SHA-256 en JS, 1 worker, sin prefiltro,
// un fotograma por carpeta) y con el actual. Deben dar el mismo resultado y
// el actual debe ser claramente más rápido.
import { test, expect, writeTree, setOptions } from '../e2e/fixtures.js';

const MB = 1024 * 1024;

async function timedScan(page, dir) {
  await page.evaluate(d => { window.__pickDir = d; }, dir);
  await page.click('#home [data-action="pick-folder"]');
  const t0 = Date.now();
  await page.click('[data-action="begin-scan"]');
  await expect(page.locator('#scan-lbl')).toHaveText(/completado/, { timeout: 240_000 });
  const ms = Date.now() - t0;
  return {
    ms,
    files:  await page.locator('#st-files').innerText(),
    groups: await page.locator('#dupe-badge').innerText(),
    size:   await page.locator('#st-size').innerText(),
  };
}

test('el escaneo actual es mucho más rápido que el anterior con los mismos datos', async ({ page }) => {
  // 1 200 archivos pequeños en 240 carpetas (1 de cada 10 duplicado)
  const spec = {};
  for (let d = 0; d < 240; d++) {
    for (let f = 0; f < 5; f++) {
      const n = d * 5 + f;
      spec[`fotos/c${d}/img${f}.txt`] = String(n % 10 === 1 ? n - 1 : n).padStart(32, '0');
    }
  }
  // 12 archivos de 24 MB del mismo tamaño: 10 distintos desde el primer byte y 2 idénticos
  for (let i = 0; i < 12; i++) spec[`videos/v${i}.bin`] = { size: 24 * MB, patches: [[0, i < 10 ? i + 1 : 99], [20 * MB, 5]] };
  await writeTree(page, 'datos', spec);

  const run = async url => {
    await page.goto(url);
    await setOptions(page, { strategy: 'full' }); // lectura completa: el peor caso
    return timedScan(page, 'datos');
  };

  const before = await run('/?perf=legacy');
  const after  = await run('/');

  console.log(`Antes: ${before.ms} ms · Ahora: ${after.ms} ms · ${(before.ms / after.ms).toFixed(1)}× más rápido`);
  test.info().annotations.push({ type: 'perf', description: `antes ${before.ms} ms, ahora ${after.ms} ms (${(before.ms / after.ms).toFixed(1)}×)` });

  // Mismo resultado
  expect(after.files).toBe('1212');
  expect({ ...after, ms: 0 }).toEqual({ ...before, ms: 0 });
  expect(Number(after.groups)).toBe(1 + 120); // 1 grupo de vídeos + 120 parejas de archivos pequeños

  // Mejora clara (el margen real es bastante mayor; 3× deja sitio al ruido de CI)
  expect(before.ms / after.ms).toBeGreaterThan(3);
});

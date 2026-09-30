// Modo sin File System Access API (Firefox/Safari): solo escaneo.
// Usa una carpeta temporal creada por la propia prueba y la borra al final.
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';

test('sin File System Access API: encuentra duplicados pero no permite quitarlos', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'dupecleaner-test-'));
  try {
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'a.txt'), 'igual');
    await writeFile(join(dir, 'sub', 'b.txt'), 'igual');

    await page.evaluate(() => { delete window.showDirectoryPicker; });
    await page.locator('#mobile-input').setInputFiles(dir);
    await page.click('[data-action="begin-scan"]');
    await expect(page.locator('#scan-lbl')).toHaveText(/completado/);

    await expect(page.locator('.dg')).toHaveCount(1);
    for (const cb of await page.locator('.df input[type=checkbox]').all()) await expect(cb).toBeDisabled();
    await page.click('[data-action="select-all"]');
    await expect(page.locator('#btn-del')).toBeHidden();
    expect((await readdir(dir)).sort()).toEqual(['a.txt', 'sub']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

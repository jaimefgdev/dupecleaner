// Pruebas de seguridad del borrado. Todo ocurre en OPFS (ver fixtures.js).
import { test, expect, writeTree, readTree, overwrite, scanFolder, selectAllAndOpen, waitRemovalDone, keeperPath } from './fixtures.js';

const MB = 1024 * 1024;
const Q  = '_dupecleaner_cuarentena';

test('por defecto mueve las copias a cuarentena y conserva el original', async ({ page }) => {
  await writeTree(page, 't', { 'a/foto.txt': 'misma foto', 'b/foto.txt': 'misma foto', 'c/foto.txt': 'misma foto', 'otro.txt': 'diferente' });
  await scanFolder(page, 't');
  await expect(page.locator('.dg')).toHaveCount(1);
  const keeper = await keeperPath(page);

  await selectAllAndOpen(page);
  await expect(page.locator('input[name="del-mode"][value="quarantine"]')).toBeChecked();
  await expect(page.locator('#btn-confirm')).toBeEnabled(); // cuarentena no exige escribir CONFIRMAR
  await page.click('#btn-confirm');
  await waitRemovalDone(page);

  const tree = await readTree(page, 't');
  expect(tree[keeper]).toBe('misma foto');
  expect(tree['otro.txt']).toBe('diferente');
  const originals = ['a/foto.txt', 'b/foto.txt', 'c/foto.txt'];
  expect(originals.filter(p => p in tree)).toEqual([keeper]);
  for (const p of originals.filter(p => p !== keeper)) expect(tree[`${Q}/${p}`]).toBe('misma foto');
  await expect(page.locator('#ok-screen')).toBeVisible();
});

test('un nuevo escaneo ignora la carpeta de cuarentena', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'x', [`${Q}/a.txt`]: 'x' });
  await scanFolder(page, 't');
  await expect(page.locator('#st-files')).toHaveText('1');
  await expect(page.locator('.dg')).toHaveCount(0);
});

test('modo rápido: un falso positivo por muestras se marca como probable y NO se toca', async ({ page }) => {
  const size = 21 * MB;
  // Mismo tamaño, mismo inicio/centro/final; difieren en un byte fuera de las muestras
  await writeTree(page, 't', { 'a/video.mp4': { size }, 'b/video.mp4': { size, patches: [[4 * MB, 7]] } });
  await scanFolder(page, 't');
  await expect(page.locator('.dg')).toHaveCount(1);
  await expect(page.locator('.dg .probable-tag')).toBeVisible();

  for (const mode of ['quarantine', 'delete']) {
    await selectAllAndOpen(page);
    await page.check(`input[name="del-mode"][value="${mode}"]`);
    if (mode === 'delete') await page.fill('#modal-input', 'CONFIRMAR');
    await page.click('#btn-confirm');
    await expect(page.locator('#feed')).toContainText('NO es idéntico');
    await expect(page.locator('#scan-lbl')).toHaveText(/completado/);
  }

  const tree = await readTree(page, 't');
  expect(Object.keys(tree).sort()).toEqual(['a/video.mp4', 'b/video.mp4']);
});

test('modo rápido: copias grandes realmente idénticas sí se verifican y se mueven', async ({ page }) => {
  const size = 21 * MB;
  await writeTree(page, 't', { 'a/big.bin': { size, patches: [[9 * MB, 1]] }, 'b/big.bin': { size, patches: [[9 * MB, 1]] } });
  await scanFolder(page, 't');
  await expect(page.locator('.dg .probable-tag')).toBeVisible();
  await selectAllAndOpen(page);
  await page.click('#btn-confirm');
  const feed = await waitRemovalDone(page);
  expect(feed).toContain('1 movidos a cuarentena');
  const tree = await readTree(page, 't');
  expect(Object.keys(tree).filter(p => p.startsWith(Q))).toHaveLength(1);
});

test('si el original cambia después del escaneo, no se toca la copia', async ({ page }) => {
  await writeTree(page, 't', { 'a/doc.txt': 'versión 1', 'b/doc.txt': 'versión 1' });
  await scanFolder(page, 't');
  const keeper = await keeperPath(page);
  const copy   = keeper === 'a/doc.txt' ? 'b/doc.txt' : 'a/doc.txt';
  await overwrite(page, 't', keeper, 'versión 2');

  await selectAllAndOpen(page);
  await page.click('#btn-confirm');
  await expect(page.locator('#feed')).toContainText('el original ha cambiado');
  const tree = await readTree(page, 't');
  expect(tree).toEqual({ [keeper]: 'versión 2', [copy]: 'versión 1' });
});

test('si la copia cambia después del escaneo, no se toca', async ({ page }) => {
  await writeTree(page, 't', { 'a/doc.txt': 'igual', 'b/doc.txt': 'igual' });
  await scanFolder(page, 't');
  const keeper = await keeperPath(page);
  const copy   = keeper === 'a/doc.txt' ? 'b/doc.txt' : 'a/doc.txt';
  await overwrite(page, 't', copy, 'IGUAL');

  await selectAllAndOpen(page);
  await page.click('#btn-confirm');
  await expect(page.locator('#feed')).toContainText('el archivo ha cambiado');
  expect(await readTree(page, 't')).toEqual({ [keeper]: 'igual', [copy]: 'IGUAL' });
});

test('el borrado definitivo es opcional y exige escribir CONFIRMAR', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'dup', 'b.txt': 'dup' });
  await scanFolder(page, 't');
  const keeper = await keeperPath(page);
  await selectAllAndOpen(page);
  await page.check('input[name="del-mode"][value="delete"]');
  await expect(page.locator('#btn-confirm')).toBeDisabled();
  await page.fill('#modal-input', 'confirmar');
  await expect(page.locator('#btn-confirm')).toBeDisabled();
  await page.fill('#modal-input', 'CONFIRMAR');
  await expect(page.locator('#btn-confirm')).toBeEnabled();
  await page.click('#btn-confirm');
  await waitRemovalDone(page);
  expect(await readTree(page, 't')).toEqual({ [keeper]: 'dup' }); // sin cuarentena
});

test('el original no se puede seleccionar ni forzando la casilla', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'dup', 'b.txt': 'dup', 'c.txt': 'dup' });
  await scanFolder(page, 't');
  const origBox = page.locator('.df.orig input[type=checkbox]');
  await expect(origBox).toBeDisabled();

  await page.click('[data-action="select-all"]');
  await expect(page.locator('#sel-cnt')).toHaveText('2');

  // Forzar: quitar el disabled y marcarla a mano
  await origBox.evaluate(el => { el.disabled = false; el.click(); });
  await expect(page.locator('#sel-cnt')).toHaveText('2');
  await expect(origBox).not.toBeChecked();
});

test('los nombres de archivo maliciosos se muestran como texto y no ejecutan código', async ({ page }) => {
  const names = [
    'x" onmouseover="window.__pwned=1" y.txt',
    "z' onclick='window.__pwned=2' .txt",
    '<img src=x onerror="window.__pwned=3">.txt',
  ];
  const spec = {};
  for (const n of names) { spec['a/' + n] = 'mismo'; spec['b/' + n] = 'mismo'; }
  await writeTree(page, 't', spec);
  await scanFolder(page, 't');
  await expect(page.locator('.dg')).toHaveCount(1);

  for (const row of await page.locator('.df').all()) {
    await row.hover();
    await row.locator('.df-name').click();
    await row.locator('.btn-eye').click();
  }
  await page.click('[data-action="select-all"]');
  await page.click('[data-action="deselect-all"]');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('.dg img').count()).toBe(0);
  const shown = await page.locator('.df-name').allInnerTexts();
  for (const n of names) expect(shown.some(s => s.startsWith(n))).toBe(true);
});

test('detener y empezar otro escaneo enseguida no mezcla resultados', async ({ page }) => {
  // Carpeta A: archivos de 20 MB (hash completo, ~1 s cada uno) para que el
  // escaneo antiguo siga esperando un hash mientras empieza el nuevo.
  const MB20 = 20 * MB;
  await writeTree(page, 'A', { 'grande1.bin': { size: MB20 }, 'grande2.bin': { size: MB20 }, 'grande3.bin': { size: MB20 }, 'grande4.bin': { size: MB20 } });
  await writeTree(page, 'B', { 'uno.txt': 'B', 'dos.txt': 'B' });

  await page.evaluate(() => { window.__pickDir = 'A'; });
  await page.click('#home [data-action="pick-folder"]');
  await page.click('[data-action="begin-scan"]');
  await expect(page.locator('#feed')).toContainText(/⚡ grande\d\.bin/);

  // Parar, reiniciar, elegir B y empezar mientras A sigue esperando un hash
  await page.evaluate(async () => {
    document.getElementById('btn-stop').click();
    document.getElementById('btn-reset').click();
    window.__pickDir = 'B';
    document.querySelector('#home [data-action="pick-folder"]').click();
    await new Promise(r => setTimeout(r, 30));
    document.querySelector('[data-action="begin-scan"]').click();
  });
  await expect(page.locator('#scan-lbl')).toHaveText(/completado/);
  await page.waitForTimeout(6000); // lo que tardaría A en terminar sus hashes

  await expect(page.locator('#nav-folder-name')).toHaveText('B');
  await expect(page.locator('#st-files')).toHaveText('2');
  await expect(page.locator('#dupe-badge')).toHaveText('1');
  await expect(page.locator('.dg')).toHaveCount(1);
  for (const p of await page.locator('.df-path').allInnerTexts()) expect(p).toBe('B');
  expect(await page.locator('#feed').innerText()).not.toContain('grande');
});

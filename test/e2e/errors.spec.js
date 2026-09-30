// Fallos y manejo de errores. Todo ocurre en OPFS o en carpetas temporales propias.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, writeTree, scanFolder, setOptions } from './fixtures.js';

const MB = 1024 * 1024;

test('carpetas llamadas lib, bin, system o Library dentro de una carpeta normal se escanean', async ({ page }) => {
  await writeTree(page, 't', { 'lib/a.txt': 'x', 'bin/b.txt': 'x', 'system/c.txt': 'y', 'Library/d.txt': 'y', 'run/e.txt': 'z' });
  await scanFolder(page, 't');
  await expect(page.locator('#st-files')).toHaveText('5');
  await expect(page.locator('.dg')).toHaveCount(2);
  await expect(page.locator('#feed')).not.toContainText('omitida');
});

test('una carpeta raíz llamada "lib" se escanea entera', async ({ page }) => {
  await writeTree(page, 'lib', { 'a.txt': 'x', 'sub/b.txt': 'x' });
  await scanFolder(page, 'lib');
  await expect(page.locator('#st-files')).toHaveText('2');
  await expect(page.locator('.dg')).toHaveCount(1);
});

test('en una raíz de sistema se omiten sus carpetas del SO y se dice por qué', async ({ page }) => {
  await writeTree(page, 'C', {
    'Windows/System32/a.dll': 'x', 'Program Files/app/a.dll': 'x',
    'Users/yo/Fotos/a.jpg': 'foto', 'Users/yo/Copia/a.jpg': 'foto', 'Users/yo/Proyectos/Windows/b.txt': 'b',
  });
  await scanFolder(page, 'C');
  await expect(page.locator('#st-files')).toHaveText('3');
  await expect(page.locator('#feed')).toContainText('C/Windows  [omitida: sistema]');
  await expect(page.locator('#feed')).toContainText('C/Program Files  [omitida: sistema]');
  await expect(page.locator('#feed')).toContainText('Parece la raíz de un sistema');
});

test('papeleras del sistema se omiten a cualquier profundidad', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'x', 'disco/$RECYCLE.BIN/a.txt': 'x' });
  await scanFolder(page, 't');
  await expect(page.locator('#st-files')).toHaveText('1');
  await expect(page.locator('#feed')).toContainText('$RECYCLE.BIN  [omitida: sistema]');
});

test('modo sin File System Access API: "ocultas" solo afecta a carpetas, y cuenta carpetas', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'dupecleaner-test-'));
  try {
    await mkdir(join(dir, '.oculta'));
    await writeFile(join(dir, '.perfil'), 'igual');
    await writeFile(join(dir, 'perfil'), 'igual');
    await writeFile(join(dir, '.oculta', 'a.txt'), 'igual');
    await writeFile(join(dir, '.oculta', 'b.txt'), 'igual');

    await setOptions(page, { hidden: true });
    await page.evaluate(() => { delete window.showDirectoryPicker; });
    await page.locator('#mobile-input').setInputFiles(dir);
    await page.click('[data-action="begin-scan"]');
    await expect(page.locator('#scan-lbl')).toHaveText(/completado/);

    await expect(page.locator('#st-files')).toHaveText('2'); // .perfil y perfil
    await expect(page.locator('#feed')).toContainText('1 carpetas omitidas');
    await expect(page.locator('#feed')).toContainText('.oculta  [omitida: oculta]');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('un archivo ilegible y una carpeta ilegible se registran y el escaneo termina', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'x', 'roto.txt': 'x', 'b.txt': 'x', 'prohibida/c.txt': 'x' });
  await page.evaluate(() => {
    // roto.txt: se puede leer al listarlo pero falla al calcular el hash
    const seen = new WeakSet();
    const getFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = function () {
      if (this.name === 'roto.txt') {
        if (seen.has(this)) return Promise.reject(new DOMException('disco desconectado', 'NotReadableError'));
        seen.add(this);
      }
      return getFile.call(this);
    };
    // prohibida/: no se puede listar
    const entries = FileSystemDirectoryHandle.prototype.entries;
    FileSystemDirectoryHandle.prototype.entries = function () {
      if (this.name === 'prohibida') return (async function* () { throw new DOMException('sin permiso', 'NotAllowedError'); })();
      return entries.call(this);
    };
  });
  await scanFolder(page, 't');
  const feed = page.locator('#feed');
  await expect(feed).toContainText('t/roto.txt — disco desconectado');
  await expect(feed).toContainText('t/prohibida — no se puede leer la carpeta: sin permiso');
  await expect(feed).toContainText('2 errores de lectura');
  await expect(page.locator('.dg')).toHaveCount(1); // a.txt y b.txt siguen agrupados
  await expect(page.locator('#btn-reset')).toBeVisible();
});

test('detener corta al momento un hash largo y el siguiente escaneo funciona', async ({ page }) => {
  // Motor lento a propósito (SHA-256 en JS, 1 worker) para que haya un hash en curso que cortar
  await page.goto('/?perf=legacy');
  const size = 150 * MB; // ~7 s con el SHA-256 en JS
  await writeTree(page, 'grande', { 'a.bin': { size }, 'b.bin': { size } });
  await writeTree(page, 'peq', { 'a.txt': 'x', 'b.txt': 'x' });
  await setOptions(page, { strategy: 'full' });

  await page.evaluate(() => { window.__pickDir = 'grande'; });
  await page.click('#home [data-action="pick-folder"]');
  await page.click('[data-action="begin-scan"]');
  await expect(page.locator('#feed')).toContainText('⚡ a.bin');
  await page.waitForTimeout(300);

  const t0 = Date.now();
  await page.click('#btn-stop');
  await expect(page.locator('#scan-lbl')).toHaveText(/detenido/, { timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect(page.locator('#feed')).not.toContainText('Hash cancelled');

  await page.click('#btn-reset');
  await scanFolder(page, 'peq');
  await expect(page.locator('.dg')).toHaveCount(1);
});

test('al cambiar de idioma las tarjetas se traducen', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'x', 'b.txt': 'x' });
  await scanFolder(page, 't');
  await expect(page.locator('.dg-hdr')).toContainText('copias idénticas');
  await page.click('[data-action="toggle-lang"]');
  await expect(page.locator('.dg-hdr')).toContainText('identical copies');
  await expect(page.locator('.df.orig .orig-tag')).toHaveText('original');
});

test('PWA: el service worker se registra y la app carga sin conexión', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL)).toMatch(/\/sw\.js$/);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  expect(manifest.name).toBe('DupeCleaner');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#home h2')).toHaveText('DupeCleaner');
  await expect(page.locator('#compat-note')).not.toBeEmpty(); // los módulos JS también vienen de la caché
  await context.setOffline(false);
});

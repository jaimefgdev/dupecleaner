// Accesibilidad y preferencias. Todo en OPFS.
import AxeBuilder from '@axe-core/playwright';
import { test, expect, writeTree, scanFolder, selectAllAndOpen, setOptions } from './fixtures.js';

const axe = page => new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .disableRules(['color-contrast']) // el contraste de la paleta se revisa aparte
  .analyze();

const serious = r => r.violations
  .filter(v => ['critical', 'serious'].includes(v.impact))
  .map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);

test('sin problemas de accesibilidad graves: inicio, resultados y diálogos', async ({ page }) => {
  expect(serious(await axe(page))).toEqual([]);

  await writeTree(page, 't', { 'a.txt': 'x', 'b.txt': 'x' });
  await scanFolder(page, 't');
  expect(serious(await axe(page))).toEqual([]);

  await selectAllAndOpen(page);
  expect(serious(await axe(page))).toEqual([]);
  await page.keyboard.press('Escape');

  await page.click('[data-action="open-settings"]');
  expect(serious(await axe(page))).toEqual([]);
});

test('diálogo de quitar: foco dentro, Tab no se escapa, Esc cierra y devuelve el foco', async ({ page }) => {
  await writeTree(page, 't', { 'a.txt': 'x', 'b.txt': 'x' });
  await scanFolder(page, 't');
  await page.click('[data-action="select-all"]');
  await page.focus('#btn-del');
  await page.keyboard.press('Enter');
  await expect(page.locator('#modal-ov')).toHaveClass(/on/);
  await expect(page.locator('input[name="del-mode"][value="quarantine"]')).toBeFocused();

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#modal-ov'))).toBe(true);
  }
  expect(await page.evaluate(() => document.querySelector('.app-body').inert)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-ov')).not.toHaveClass(/on/);
  await expect(page.locator('#btn-del')).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('.app-body').inert)).toBe(false);
});

test('los separadores de paneles se mueven con las flechas', async ({ page }) => {
  const left = page.locator('#panel-left');
  const w0 = (await left.boundingBox()).width;
  await page.focus('#div-1');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await left.boundingBox()).width).toBeGreaterThan(w0 + 40);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await left.boundingBox()).width).toBeLessThan(w0 + 45);
});

test('idioma, tema y opciones de escaneo se recuerdan al recargar', async ({ page }) => {
  await page.click('[data-action="toggle-lang"]');
  await page.click('[data-action="toggle-theme"]');
  await setOptions(page, { hidden: true, dev: false, strategy: 'full' });
  await page.reload();

  await expect(page.locator('body')).toHaveClass(/\ben\b/);
  await expect(page.locator('body')).toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('#cfg-hidden')).toBeChecked();
  await expect(page.locator('#cfg-dev')).not.toBeChecked();
  await expect(page.locator('#radio-full')).toBeChecked();
});

// Genera los PNG de icons/ a partir de los SVG usando el Chromium de Playwright.
// Uso: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const OUT = [
  ['icons/icon.svg',          'icons/icon-192.png',          192],
  ['icons/icon.svg',          'icons/icon-512.png',          512],
  ['icons/icon-maskable.svg', 'icons/icon-maskable-512.png', 512],
  ['icons/icon-maskable.svg', 'icons/apple-touch-icon.png',  180],
];

const browser = await chromium.launch();
for (const [src, dest, size] of OUT) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg  = await readFile(src, 'utf8');
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: dest, omitBackground: true });
  await page.close();
  console.log(dest);
}
await browser.close();

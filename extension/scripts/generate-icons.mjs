/**
 * Renders assets/logo.svg to public/icons/icon-{16,32,48,128}.png with Playwright's Chromium.
 * Usage (from the repo root): node extension/scripts/generate-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(here, '..', 'assets', 'logo.svg'), 'utf8');
const outDir = path.join(here, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: path.join(outDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Icons written to ${outDir}`);

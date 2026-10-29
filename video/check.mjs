// Проверка одного кадра видео-режима: node video/check.mjs frame <N> [out.png|-] [prev...] | interactive
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const [mode, n, out, ...prev] = process.argv.slice(2);
if (mode === 'interactive') {
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.poolRoom, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const t0 = await page.evaluate(() => window.poolRoom.day.t);
  await page.waitForTimeout(2000);
  const t1 = await page.evaluate(() => window.poolRoom.day.t);
  console.log('interactive ok', t1 > t0, 'no video api', await page.evaluate(() => !window.poolRoomVideo));
} else {
  await page.goto('http://localhost:8123/?video=1');
  await page.waitForFunction(() => window.poolRoomVideo, null, { timeout: 120000 });
  const t = Date.now();
  const url = await page.evaluate(({ n, prev }) => {
    for (const p of prev) window.poolRoomVideo.renderFrame(p);
    window.poolRoomVideo.renderFrame(n);
    window.__lost = window.poolRoom.renderer.getContext().isContextLost(); return window.poolRoomVideo.output().toDataURL('image/png');
  }, { n: Number(n), prev: prev.map(Number) });
  console.log('lost', await page.evaluate(() => window.__lost), 'frame', n, 'hash', createHash('sha256').update(url).digest('hex').slice(0, 16), (Date.now() - t) + 'ms');
  if (out && out !== '-') writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
}
console.log('errors', errors);
await browser.close();

// Рендер ролика «Пролёт» покадрово через видео-режим сцены (?video=1).
//
//   node video/render.mjs              — все кадры → renders/frames/flythrough/, затем renders/flythrough_scene.mp4
//   node video/render.mjs --preview    — каждый 10-й кадр 960×540 → renders/flythrough_preview.jpg (лист 10×15)
//   node video/render.mjs --from N --to M
//
// Нужен сервер превью (setup/serve.ps1) на http://localhost:8123. Готовые кадры пропускаются —
// прерванный рендер продолжается с места остановки.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURATION, FPS } from './shot.js';
import { parseArgs, framesToRender, frameName } from './frames.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOTAL = Math.round(DURATION * FPS);
const opts = parseArgs(process.argv.slice(2), TOTAL);
const dir = join(ROOT, 'renders', 'frames', opts.preview ? 'flythrough_preview' : 'flythrough');
mkdirSync(dir, { recursive: true });

const done = new Set(
  readdirSync(dir)
    .map((f) => /^f_(\d{4})\.png$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
);
const todo = framesToRender({ ...opts, done });
console.log(`frames: ${todo.length} to render, ${done.size} already done`);

if (todo.length) {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:8123/?video=1');
  await page.waitForFunction(() => window.poolRoomVideo, null, { timeout: 120000 });
  await page.evaluate(() => window.poolRoomVideo.ready);

  const t0 = Date.now();
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    const url = await page.evaluate(
      ({ i, preview }) => {
        window.poolRoomVideo.renderFrame(i);
        const src = document.getElementById('scene');
        if (window.poolRoom.renderer.getContext().isContextLost()) throw new Error('WebGL context lost');
        if (!preview) return src.toDataURL('image/png');
        // Превью — в половинном размере, чтобы лист из 150 кадров был обозримым.
        const c = document.createElement('canvas');
        c.width = 960;
        c.height = 540;
        c.getContext('2d').drawImage(src, 0, 0, 960, 540);
        return c.toDataURL('image/png');
      },
      { i, preview: opts.preview }
    );
    writeFileSync(join(dir, frameName(i)), Buffer.from(url.split(',')[1], 'base64'));
    if (errors.length) throw new Error(`page errors at frame ${i}: ${errors.join('; ')}`);
    const per = (Date.now() - t0) / (k + 1);
    const eta = Math.round((per * (todo.length - k - 1)) / 1000);
    process.stdout.write(`\rframe ${i} (${k + 1}/${todo.length}) ${Math.round(per)} ms/frame, ETA ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}   `);
  }
  process.stdout.write('\n');
  await browser.close();
}

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

if (opts.preview) {
  // Контактный лист: 150 кадров превью, 10 в ряд.
  // Номера кадров идут с шагом 10 — ffmpeg получает их списком (concat), а не шаблоном имён.
  const out = join(ROOT, 'renders', 'flythrough_preview.jpg');
  const list = join(dir, 'list.txt');
  const files = readdirSync(dir).filter((f) => /^f_\d{4}\.png$/.test(f)).sort();
  writeFileSync(list, files.map((f) => `file '${join(dir, f).replace(/\\/g, '/')}'`).join('\n'));
  ffmpeg('-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=384:216,tile=10x15', '-frames:v', '1', '-q:v', '3', out);
  console.log('preview sheet:', out);
} else if (framesToRender({ from: 0, to: TOTAL - 1, preview: false, done: new Set(readdirSync(dir).map((f) => Number(/^f_(\d{4})\.png$/.exec(f)?.[1]))) }).length === 0) {
  const out = join(ROOT, 'renders', 'flythrough_scene.mp4');
  ffmpeg('-framerate', String(FPS), '-i', join(dir, 'f_%04d.png'), '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', out);
  console.log('video:', out, existsSync(out));
}

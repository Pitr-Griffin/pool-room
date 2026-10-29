import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, framesToRender, frameName } from './frames.js';

test('аргументы: по умолчанию весь ролик, без превью', () => {
  assert.deepEqual(parseArgs([], 1500), { preview: false, audio: false, from: 0, to: 1499 });
});

test('аргументы: --preview, --from, --to', () => {
  assert.deepEqual(parseArgs(['--preview', '--from', '100', '--to', '200'], 1500), { preview: true, audio: false, from: 100, to: 200 });
  assert.equal(parseArgs(['--to', '99999'], 1500).to, 1499, 'to обрезается по длине ролика');
});

test('превью — каждый 10-й кадр', () => {
  const list = framesToRender({ from: 0, to: 1499, preview: true, done: new Set() });
  assert.equal(list.length, 150);
  assert.deepEqual(list.slice(0, 3), [0, 10, 20]);
});

test('уже готовые кадры пропускаются, порядок возрастающий', () => {
  const list = framesToRender({ from: 0, to: 9, preview: false, done: new Set([0, 1, 2, 5]) });
  assert.deepEqual(list, [3, 4, 6, 7, 8, 9]);
});

test('имя файла кадра — f_0042.png', () => {
  assert.equal(frameName(42), 'f_0042.png');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundCues } from './cues.js';
import { CRACK_AT, FADE, EVENTS } from './shot.js';

const cues = soundCues();
const at = (kind) => cues.filter((c) => c.kind === kind).map((c) => c.t);

test('плеск на всплытии — ровно в момент события breach', () => {
  const breach = EVENTS.find((e) => e.kind === 'breach').t;
  assert.deepEqual(at('splash').filter((t) => Math.abs(t - breach) < 0.01), [breach]);
});

test('удар, хруст и глушение — в CRACK_AT, глушение до конца затемнения', () => {
  assert.deepEqual(at('impact'), [CRACK_AT]);
  assert.deepEqual(at('crack'), [CRACK_AT]);
  const m = cues.find((c) => c.kind === 'muffle');
  assert.equal(m.t, CRACK_AT);
  assert.equal(m.end, FADE.end);
});

test('тихие всплески воды, пока камера низко над коридором (17–26 с)', () => {
  const lap = at('lap');
  assert.ok(lap.length >= 8, `lap count ${lap.length}`);
  assert.ok(lap.every((t) => t >= 17 && t <= 26));
});

test('после удара ничего нового не звучит, расписание по возрастанию', () => {
  assert.ok(cues.every((c) => c.t <= CRACK_AT));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].t >= cues[i - 1].t);
});

test('расписание одинаковое при каждом вызове', () => {
  assert.deepEqual(soundCues(), cues);
});

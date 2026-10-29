import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundCues } from './cues.js';
import { CRACK_AT, FADE, EVENTS, DRIPS, FALL } from './shot.js';

const cues = soundCues();
const at = (kind) => cues.filter((c) => c.kind === kind).map((c) => c.t);

test('под водой — с начала до всплытия; плеск ровно в момент breach', () => {
  const breach = EVENTS.find((e) => e.kind === 'breach').t;
  const uw = cues.find((c) => c.kind === 'underwater');
  assert.equal(uw.t, 0);
  assert.ok(uw.end <= breach && uw.end > breach - 0.1);
  assert.deepEqual(at('breach'), [breach]);
});

test('капли звучат там же, где падают на воду в кадре', () => {
  assert.deepEqual(at('drip'), DRIPS.map((d) => d.t).sort((a, b) => a - b));
  assert.ok(DRIPS.length >= 10, `drips ${DRIPS.length}`);
});

test('падение: шорох выскальзывания, свист, затем удар, хруст и глушение в CRACK_AT', () => {
  assert.deepEqual(at('slip'), [FALL.slip]);
  assert.deepEqual(at('whoosh'), [FALL.start]);
  assert.deepEqual(at('impact'), [CRACK_AT]);
  assert.deepEqual(at('crack'), [CRACK_AT]);
  assert.equal(cues.find((c) => c.kind === 'muffle').end, FADE.end);
});

test('игровых звуков (птицы, аккорд, плеск шагов) в расписании нет', () => {
  const kinds = new Set(cues.map((c) => c.kind));
  for (const k of ['bird', 'chirp', 'pad', 'lap', 'splash']) assert.ok(!kinds.has(k), k);
});

test('расписание по возрастанию и одинаковое при каждом вызове', () => {
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].t >= cues[i - 1].t);
  assert.deepEqual(soundCues(), cues);
});

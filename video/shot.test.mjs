import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DURATION, FPS, hoursAt, dayT, cameraAt, EVENTS } from './shot.js';
import { ROOM, POOL, CORRIDOR, ROOM2 } from '../src/layout.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('таймлапс: 05:50 в начале, полдень к 40 с и до конца', () => {
  near(hoursAt(0), 5 + 50 / 60, 0.01, 'start');
  near(hoursAt(40), 12, 0.01, '40 s');
  near(hoursAt(DURATION), 12, 0.01, 'end');
});

test('таймлапс монотонный и не переливается за полдень', () => {
  const dt = 1 / FPS;
  for (let t = 0; t < DURATION; t += dt) {
    assert.ok(hoursAt(t + dt) >= hoursAt(t) - 1e-9, `non-monotonic at ${t}`);
    assert.ok(hoursAt(t) <= 12.0001, `overshoot at ${t}: ${hoursAt(t)}`);
  }
});

test('солнце встаёт, пока камера смотрит в окно коридора', () => {
  assert.ok(hoursAt(20) < 6, `20 s: ${hoursAt(20)}`);
  assert.ok(hoursAt(24) > 6, `24 s: ${hoursAt(24)}`);
});

test('dayT переводит часы в фазу DayCycle (06:00 = 0)', () => {
  near(dayT(0), (5 + 50 / 60 - 6) / 24 + 1, 1e-6, 'pre-dawn wraps');
  near(dayT(40), 0.25, 1e-3, 'noon');
});

test('камера стартует под водой и всплывает к 5 с', () => {
  assert.ok(cameraAt(0).pos[1] < POOL.water, 'underwater at 0');
  assert.ok(cameraAt(5).pos[1] > POOL.water, 'above water at 5');
});

// Пространство, где камере можно быть: комнаты, коридор, толща бассейна. Отступ от стен и потолка.
const M = 0.15;
function inside([x, y, z]) {
  const box = (b, y0, y1) => x > b.x0 + M && x < b.x1 - M && z > b.z0 + M && z < b.z1 - M && y > y0 && y < y1;
  const pool = box(POOL, POOL.bottom + M, ROOM.height);
  const room1 = box(ROOM, 0.05, ROOM.height - M);
  // Проёмы коридора: камера проходит сквозь стену комнаты только в его пределах по z.
  const corridor = x > CORRIDOR.x0 - 1 && x < CORRIDOR.x1 + 1 && z > CORRIDOR.z0 + M && z < CORRIDOR.z1 - M && y > -0.05 && y < CORRIDOR.height - M;
  const room2 = box(ROOM2, -0.05, ROOM2.height - M);
  return pool || room1 || corridor || room2;
}

test('камера не выходит за стены, потолок и дно до падения', () => {
  for (let t = 0; t <= 44; t += 0.05) {
    const { pos } = cameraAt(t);
    assert.ok(inside(pos), `outside at ${t.toFixed(2)} s: ${pos.map((v) => v.toFixed(2))}`);
  }
});

test('в конце камера лежит на полу набок', () => {
  const end = cameraAt(DURATION);
  assert.ok(end.pos[1] < 0.15, `height ${end.pos[1]}`);
  near(Math.abs(end.roll), Math.PI / 2, 0.2, 'roll');
});

test('события: всплытие на 3,5 с и удар на 45,7 с', () => {
  const kinds = Object.fromEntries(EVENTS.map((e) => [e.kind, e.t]));
  near(kinds.breach, 3.5, 1e-9, 'breach');
  near(kinds.impact, 45.7, 1e-9, 'impact');
});

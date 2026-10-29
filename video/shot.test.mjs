import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DURATION, FPS, CRACK_AT, hoursAt, dayT, cameraAt, EVENTS } from './shot.js';
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

// Ориентация камеры как вектор взгляда + крен — чтобы мерить, как быстро она вращается.
const look = (c) => {
  const d = c.target.map((v, i) => v - c.pos[i]);
  const l = Math.hypot(...d);
  return d.map((v) => v / l);
};
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

test('падение: вращение правдоподобное — не быстрее ~10 рад/с, крен меньше полуоборота', () => {
  const dt = 1 / FPS;
  for (let t = 44; t < CRACK_AT; t += dt) {
    const a = cameraAt(t);
    const b = cameraAt(t + dt);
    const w = (angle(look(a), look(b)) + Math.abs(b.roll - a.roll)) / dt;
    assert.ok(w < 10, `spin ${w.toFixed(1)} rad/s at ${t.toFixed(2)}`);
  }
});

test('падение: перед ударом камера выскальзывает — чуть проседает до начала свободного падения', () => {
  const hold = cameraAt(44).pos[1];
  const fallStart = CRACK_AT - Math.sqrt((2 * (hold - EVENTS[1].at[1])) / 9.81);
  assert.ok(cameraAt(fallStart - 0.05).pos[1] < hold - 0.01, 'slips before the drop');
});

test('удар: камера отскакивает и снова ложится', () => {
  const floor = EVENTS[1].at[1];
  const hop = Math.max(...[0.05, 0.1, 0.15].map((d) => cameraAt(CRACK_AT + d).pos[1]));
  assert.ok(hop > floor + 0.015, `no bounce: ${hop}`);
  near(cameraAt(CRACK_AT + 1.2).pos[1], cameraAt(DURATION).pos[1], 0.003, 'settled');
});

test('после того как улеглась — неподвижна (без дрожи)', () => {
  const a = cameraAt(47.5);
  const b = cameraAt(DURATION);
  near(a.pos[1], b.pos[1], 1e-3, 'height');
  near(a.roll, b.roll, 0.01, 'roll');
});

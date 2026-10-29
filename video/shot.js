// Сценарий пролёта: всё, что меняется со временем ролика, — функции от t (секунды).
// Им пользуются и рендер кадров (видео-режим сцены), и офлайн-звук — тайминги одни на всех.

export const DURATION = 50;
export const FPS = 30;

export const TITLE = { in: 5, out: 9 };
export const CRACK_AT = 45.7;
export const FADE = { start: 47, end: 49.5 };

export const EVENTS = [
  { t: 3.5, kind: 'breach', at: [1.2, -0.12, 0.2] },
  { t: CRACK_AT, kind: 'impact', at: [11.62, 0.05, 0.2] },
];

// Монотонный кубический сплайн (Fritsch–Carlson): не даёт выбросов между точками.
function monotone(points) {
  const n = points.length;
  const x = points.map((p) => p[0]);
  const y = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (t > x[i + 1]) i++;
    const h = x[i + 1] - x[i];
    const u = (t - x[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// Время суток: медленно до восхода, восход у окна коридора, потом разгон до полудня.
const hours = monotone([
  [0, 5 + 50 / 60],
  [16, 5.95],
  [21.5, 6.02],
  [26, 6.3],
  [33, 8.5],
  [40, 12],
  [DURATION, 12],
]);

export const hoursAt = (t) => hours(t);
export const dayT = (t) => ((hoursAt(t) - 6) / 24 + 1) % 1;

// Ключи траектории: [t, позиция камеры, точка, куда смотрит].
const KEYS = [
  [0, [1.2, -0.7, 0.2], [-0.8, 0.05, 0.3]],
  [3.5, [1.2, -0.1, 0.2], [1.0, 1.5, -0.3]],
  [6, [1.0, 1.4, 0.6], [-1.0, 0.8, -2.5]],
  [11, [-2.5, 1.5, 1.5], [0.0, 0.5, -2.5]],
  [15, [2.5, 1.3, 1.8], [6.0, 0.8, 1.8]],
  [19, [5.0, 0.55, 1.8], [6.0, 0.6, 1.6]],
  [21, [5.6, 0.6, 1.9], [5.0, 1.1, -5.0]],
  [25, [5.9, 0.6, 1.9], [5.6, 1.0, -5.0]],
  [28, [8.5, 1.2, 1.0], [12.0, 0.5, -1.0]],
  [33, [12.0, 1.6, 1.5], [9.0, 0.3, -2.0]],
  [37, [10.5, 1.5, -0.5], [12.2, 0.3, -1.2]],
  [40, [11.5, 1.3, 0.3], [12.2, 3.5, -1.2]],
  [44, [11.5, 1.32, 0.3], [12.2, 3.5, -1.2]],
];

// Эрмитов сплайн по времени: касательные — разности соседних ключей, на концах ноль.
// Скорость непрерывна, близкие ключи дают замедление (остановки у окна и под столбом).
function hermite(times, values) {
  const n = times.length;
  const tan = values.map((v, i) => {
    if (i === 0 || i === n - 1) return v.map(() => 0);
    const dt = times[i + 1] - times[i - 1];
    return v.map((_, k) => (values[i + 1][k] - values[i - 1][k]) / dt);
  });
  return (t) => {
    if (t <= times[0]) return values[0].slice();
    if (t >= times[n - 1]) return values[n - 1].slice();
    let i = 0;
    while (t > times[i + 1]) i++;
    const h = times[i + 1] - times[i];
    const u = (t - times[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return values[i].map((p, k) => h00 * p + h10 * h * tan[i][k] + h01 * values[i + 1][k] + h11 * h * tan[i + 1][k]);
  };
}

const times = KEYS.map((k) => k[0]);
const posAt = hermite(times, KEYS.map((k) => k[1]));
const targetAt = hermite(times, KEYS.map((k) => k[2]));

// Падение: камеру отпускают так, чтобы она коснулась кромки мелкого бассейна ровно в CRACK_AT.
const FALL_FROM = KEYS[KEYS.length - 1][1];
const FALL_TO = EVENTS[1].at;
const FALL_T = Math.sqrt((2 * (FALL_FROM[1] - FALL_TO[1])) / 9.81);
const FALL_START = CRACK_AT - FALL_T;
const FALL_TURNS = 1.25;
// Лёжа набок камера смотрит вдоль кромки: слева вода, справа трава.
const REST_DIR = [0, -0.12, -1];

const sub = (a, b) => a.map((v, i) => v - b[i]);
const lerp = (a, b, f) => a + (b - a) * f;

function yawPitch(d) {
  return [Math.atan2(d[0], -d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
}

function fromYawPitch(pos, yaw, pitch) {
  const c = Math.cos(pitch);
  return [pos[0] + Math.sin(yaw) * c, pos[1] + Math.sin(pitch), pos[2] - Math.cos(yaw) * c];
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function cameraAt(t) {
  const fov = 60;
  const lastT = times[times.length - 1];
  if (t < FALL_START) {
    const hold = t > lastT;
    return { pos: hold ? FALL_FROM.slice() : posAt(t), target: targetAt(Math.min(t, lastT)), roll: 0, fov };
  }
  const [yaw0, pitch0] = yawPitch(sub(KEYS[KEYS.length - 1][2], FALL_FROM));
  const [yaw1, pitch1] = yawPitch(REST_DIR);
  const f = Math.min((t - FALL_START) / FALL_T, 1);
  // Свободное падение по высоте, по горизонтали — равномерный снос к кромке.
  const pos = [lerp(FALL_FROM[0], FALL_TO[0], f), lerp(FALL_FROM[1], FALL_TO[1], f * f), lerp(FALL_FROM[2], FALL_TO[2], f)];
  const e = f * f;
  const yaw = yaw0 + wrap(yaw1 - yaw0) * e;
  const pitch = lerp(pitch0, pitch1, e);
  const roll = wrap((FALL_TURNS * 2 * Math.PI) * e);
  return { pos, target: fromYawPitch(pos, yaw, pitch), roll, fov };
}

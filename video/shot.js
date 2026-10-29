// Сценарий пролёта: всё, что меняется со временем ролика, — функции от t (секунды).
// Им пользуются и рендер кадров (видео-режим сцены), и офлайн-звук — тайминги одни на всех.

export const DURATION = 50;
export const FPS = 30;

export const TITLE = { in: 5, out: 9 };
export const CRACK_AT = 45.7;
export const FADE = { start: 47, end: 49.5 };

export const EVENTS = [
  { t: 3.5, kind: 'breach', at: [1.2, -0.12, 0.2] },
  { t: CRACK_AT, kind: 'impact', at: [11.62, 0.05, 1.4] },
];

// Капли с потолка в воду коридора и мелкого бассейна: редкие, неравномерные — по воде
// расходятся круги, и в тишине слышно, как капает. Повторяемые (свой генератор).
export const DRIPS = (() => {
  let a = 91;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const list = [];
  for (let t = 13 + rand() * 1.5; t < 44; t += 1.4 + rand() * 2.2) {
    const corridor = t < 27;
    const at = corridor ? [4.4 + rand() * 2.3, -0.02, 1.3 + rand() * 1.0] : [7.4 + rand() * 3.8, -0.02, 0.1 + rand() * 2.6];
    list.push({ t, kind: 'drip', at });
  }
  return list;
})();

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
  // Коридор: камера низко скользит над водой, окно сбоку; рассветный луч ложится на воду.
  [19, [4.7, 0.6, 1.85], [6.5, 0.5, 1.6]],
  [22, [5.4, 0.55, 2.05], [6.8, 0.4, 1.25]],
  [25, [6.2, 0.6, 1.95], [7.8, 0.45, 1.3]],
  [28, [8.5, 1.2, 1.0], [12.0, 0.5, -1.0]],
  [33, [12.0, 1.6, 1.5], [9.0, 0.3, -2.0]],
  // Финал: камера встаёт сбоку от столба света из колодца — видно весь луч от потолка до пятна на полу.
  [37, [10.3, 1.5, 1.2], [12.2, 0.6, -0.6]],
  [40, [11.4, 1.35, 1.6], [12.3, 1.2, -0.3]],
  [44, [11.4, 1.37, 1.6], [12.3, 1.3, -0.35]],
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

// Падение — как у выскользнувшей из рук камеры:
// 1) выскальзывает (SLIP с): проседает на пару сантиметров и клюёт вперёд;
// 2) свободное падение: высота по g, горизонтальный снос равномерный, вращение с постоянной
//    угловой скоростью — четверть оборота вбок и наклон к полу, без «киношной» раскрутки;
// 3) удар о кромку мелкого бассейна в CRACK_AT: отскок на несколько сантиметров, затухающее
//    покачивание вокруг позы покоя и короткая встряска;
// 4) лежит набок неподвижно.
const FALL_FROM = KEYS[KEYS.length - 1][1];
const FALL_TO = EVENTS[1].at;
const SLIP = 0.4;
const SLIP_DROP = 0.035;
// Высота свободного падения — от просевшей после выскальзывания позиции до кромки.
const FALL_T = Math.sqrt((2 * (FALL_FROM[1] - SLIP_DROP - FALL_TO[1])) / 9.81);
const FALL_START = CRACK_AT - FALL_T;
// Для звука: когда камера выскальзывает и сколько длится свободное падение.
export const FALL = { slip: FALL_START - SLIP, start: FALL_START, duration: FALL_T };
const SLIP_PITCH = -0.16;
// Лёжа набок камера смотрит вдоль кромки в тень, к дальней стене: по одну сторону вода, по другую трава.
const REST_DIR = [0.15, -0.1, 1];
const REST_ROLL = Math.PI / 2;
const BOUNCE = { height: 0.045, time: 0.19 };
const SETTLE = 0.9;

const sub = (a, b) => a.map((v, i) => v - b[i]);
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = (f) => f * f * (3 - 2 * f);

function yawPitch(d) {
  return [Math.atan2(d[0], -d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
}

function fromYawPitch(pos, yaw, pitch) {
  const c = Math.cos(pitch);
  return [pos[0] + Math.sin(yaw) * c, pos[1] + Math.sin(pitch), pos[2] - Math.cos(yaw) * c];
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Затухающее колебание: отклонение от позы покоя после удара (s — секунды после удара).
const ring = (s, amp, freq, decay) => amp * Math.exp(-s * decay) * Math.sin(s * freq * 2 * Math.PI);

export function cameraAt(t) {
  const fov = 60;
  const lastT = times[times.length - 1];
  const [yaw0, pitch0] = yawPitch(sub(KEYS[KEYS.length - 1][2], FALL_FROM));
  const [yaw1, pitch1] = yawPitch(REST_DIR);
  if (t < FALL_START - SLIP) {
    const hold = t > lastT;
    return { pos: hold ? FALL_FROM.slice() : posAt(t), target: targetAt(Math.min(t, lastT)), roll: 0, fov };
  }
  if (t < FALL_START) {
    // Выскальзывает: проседает и клюёт вперёд, с мелкой дрожью рук.
    const f = smooth((t - (FALL_START - SLIP)) / SLIP);
    const pos = [FALL_FROM[0], FALL_FROM[1] - SLIP_DROP * f, FALL_FROM[2]];
    const jitter = 0.012 * f * Math.sin(t * 37);
    return { pos, target: fromYawPitch(pos, yaw0 + jitter, pitch0 + SLIP_PITCH * f), roll: 0.06 * f, fov };
  }
  const from = [FALL_FROM[0], FALL_FROM[1] - SLIP_DROP, FALL_FROM[2]];
  if (t < CRACK_AT) {
    const s = t - FALL_START;
    const f = s / FALL_T;
    const pos = [lerp(from[0], FALL_TO[0], f), from[1] - 4.905 * s * s, lerp(from[2], FALL_TO[2], f)];
    // Ровное вращение; к удару камера уже почти в позе покоя, остаток доберёт отскок.
    const yaw = yaw0 + wrap(yaw1 - yaw0) * f * 0.85;
    const pitch = lerp(pitch0 + SLIP_PITCH, pitch1, f * 0.85);
    const roll = lerp(0.06, REST_ROLL, f * 0.85);
    return { pos, target: fromYawPitch(pos, yaw, pitch), roll, fov };
  }
  // После удара: отскок по параболе, затем лежит; поворот доходит до покоя с затухающим покачиванием.
  const s = t - CRACK_AT;
  const hop = s < BOUNCE.time ? 4 * BOUNCE.height * (s / BOUNCE.time) * (1 - s / BOUNCE.time) : 0;
  const pos = [FALL_TO[0], FALL_TO[1] + hop, FALL_TO[2]];
  const left = s < SETTLE ? 1 - smooth(Math.min(s / 0.35, 1)) : 0;
  const k = s < SETTLE ? 1 : 0;
  const yaw = yaw1 - wrap(yaw1 - yaw0) * 0.15 * left + k * ring(s, 0.05, 3.1, 5.5);
  const pitch = lerp(pitch1, pitch0 + SLIP_PITCH, 0.15 * left) + k * ring(s, 0.07, 2.6, 5);
  const roll = REST_ROLL - (REST_ROLL - 0.06) * 0.15 * left + k * ring(s, 0.12, 2.2, 5);
  return { pos, target: fromYawPitch(pos, yaw, pitch), roll, fov };
}

// Скорость камеры: насколько сильно кадр меняется за время одного кадра (для размытия движения).
export function cameraSpeed(t) {
  const a = cameraAt(t);
  const b = cameraAt(t + 1 / FPS);
  const da = sub(b.target, b.pos);
  const db = sub(a.target, a.pos);
  const la = Math.hypot(...da);
  const lb = Math.hypot(...db);
  const turn = Math.acos(Math.max(-1, Math.min(1, da.reduce((acc, v, i) => acc + v * db[i], 0) / (la * lb))));
  return turn + Math.abs(b.roll - a.roll) + Math.hypot(...sub(b.pos, a.pos)) * 2;
}

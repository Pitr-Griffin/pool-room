// Размеры комнат и всего, что в них стоит. Метры, ось Y вверх,
// окна на длинной стене z = ROOM.z0, солнце и луна светят с этой стороны.
//
// Две комнаты стоят в ряд вдоль x: первая — с глубоким бассейном, вторая — луговая,
// с бассейном по щиколотку. Между ними — короткий коридор, залитый водой.

export const ROOM = { x0: -4, x1: 4, z0: -3, z1: 3, height: 3.5, wall: 0.25, base: -1.15 };
export const POOL = { x0: -1, x1: 3, z0: -1.2, z1: 1.3, bottom: -0.95, water: -0.12 };
export const WINDOW = { x0: -3.2, x1: 3.0, y0: 0.7, y1: 2.8, panes: 6 };
export const MEADOW = { x0: -3.45, x1: 3.25, z0: -3, z1: -1.9 };
export const EYE_HEIGHT = 1.65;

// Вторая комната — та же коробка, сдвинутая на DX.
export const ROOM2_DX = 11;
export const ROOM2 = { ...ROOM, x0: ROOM.x0 + ROOM2_DX, x1: ROOM.x1 + ROOM2_DX };
export const WINDOW2 = { ...WINDOW, x0: WINDOW.x0 + ROOM2_DX, x1: WINDOW.x1 + ROOM2_DX };
export const WINDOWS = [WINDOW, WINDOW2];

// Коридор между комнатами: проёмы в стенах, пол утоплен, всё залито водой по щиколотку.
export const CORRIDOR = { x0: ROOM.x1, x1: ROOM2.x0, z0: 1.0, z1: 2.6, height: 2.4 };
// Окно во всю длину коридора — на стене, обращённой к солнцу (z = CORRIDOR.z0).
// От пола до потолка и во всю длину стены между комнатами.
export const CWINDOW = { x0: ROOM.x1 + ROOM.wall, x1: ROOM2.x0 - ROOM.wall, y0: -0.12, y1: CORRIDOR.height, panes: 3 };
// Мелкий бассейн второй комнаты начинается прямо от выхода из коридора.
export const SHALLOW = { x0: ROOM2.x0, x1: ROOM2.x0 + 4.6, z0: -0.4, z1: ROOM2.z1, floor: -0.12, water: -0.02 };
// Общая гладь коридора и мелкого бассейна (прямоугольник, из которого вырезан угол у стены).
export const SHALLOW_WATER = { x0: CORRIDOR.x0, x1: SHALLOW.x1, z0: SHALLOW.z0, z1: SHALLOW.z1 };

// Световые колодцы в потолке: проём x0..x1, z0..z1 и шахта высотой well над потолком.
const SKYLIGHTS1 = [
  { x0: -2.9, x1: -1.9, z0: -0.6, z1: 0.4 },
  { x0: 0.6, x1: 1.8, z0: -1.7, z1: -0.7 },
];
export const SKYLIGHTS = [
  ...SKYLIGHTS1,
  ...SKYLIGHTS1.map((s) => ({ ...s, x0: s.x0 + ROOM2_DX, x1: s.x1 + ROOM2_DX })),
];
export const WELL = 0.45;

// Ступени из кафеля вдоль западного края бассейна: спускаются от пола к дну.
export const STEPS = { count: 4, tread: 0.32 };
export const STEP_RISE = -POOL.bottom / (STEPS.count + 1);

export function inPool(x, z, margin = 0) {
  return x > POOL.x0 + margin && x < POOL.x1 - margin && z > POOL.z0 + margin && z < POOL.z1 - margin;
}

export function inCorridor(x, z) {
  return x > CORRIDOR.x0 && x < CORRIDOR.x1 && z > CORRIDOR.z0 && z < CORRIDOR.z1;
}

// Вода по щиколотку: коридор и мелкий бассейн второй комнаты.
export function inShallow(x, z, margin = 0) {
  const pool2 = x > SHALLOW.x0 + margin && x < SHALLOW.x1 - margin && z > SHALLOW.z0 + margin && z < SHALLOW.z1 - margin;
  return pool2 || inCorridor(x, z);
}

// Высота дна бассейна с учётом ступеней.
export function poolFloorAt(x) {
  const i = Math.floor((x - POOL.x0) / STEPS.tread);
  return i < STEPS.count ? -(Math.max(i, 0) + 1) * STEP_RISE : POOL.bottom;
}

export function groundAt(x, z) {
  if (inPool(x, z)) return poolFloorAt(x);
  return inShallow(x, z) ? SHALLOW.floor : 0;
}

// Куда можно ходить: две комнаты и коридор (с заходом в проёмы).
const WALKABLE = [
  ROOM,
  ROOM2,
  { x0: CORRIDOR.x0 - 1, x1: CORRIDOR.x1 + 1, z0: CORRIDOR.z0, z1: CORRIDOR.z1 },
];

// Ближайшая точка, где игрок с радиусом m не задевает стены.
export function clampWalkable(p, m) {
  let best = null;
  let bestD = Infinity;
  for (const r of WALKABLE) {
    const x = Math.min(Math.max(p.x, r.x0 + m), r.x1 - m);
    const z = Math.min(Math.max(p.z, r.z0 + m), r.z1 - m);
    const d = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  p.x = best[0];
  p.z = best[1];
}

// Неровный передний край луговой полосы первой комнаты.
export function meadowEdge(x) {
  return MEADOW.z1 + 0.1 * Math.sin(x * 3.1 + 0.7) + 0.05 * Math.sin(x * 7.7 + 2.1);
}

// Во второй комнате луг — весь пол, кроме мелкого бассейна.
export function inMeadow2(x, z, margin = 0.12) {
  const inRoom = x > ROOM2.x0 && x < ROOM2.x1 && z > ROOM2.z0 && z < ROOM2.z1;
  const nearPool = x > SHALLOW.x0 - margin && x < SHALLOW.x1 + margin && z > SHALLOW.z0 - margin && z < SHALLOW.z1 + margin;
  return inRoom && !nearPool;
}

export function inMeadow(x, z) {
  return (x > MEADOW.x0 && x < MEADOW.x1 && z < meadowEdge(x)) || inMeadow2(x, z);
}

// 1, если луч от точки p к источнику света проходит сквозь колодец целиком (вход и выход шахты).
function skylightFactor(p, dir) {
  if (dir.y <= 0.02 || p.y >= ROOM.height || (p.x > CORRIDOR.x0 && p.x < CORRIDOR.x1)) return 0;
  for (const s of SKYLIGHTS) {
    const ok = [ROOM.height, ROOM.height + WELL].every((h) => {
      const t = (h - p.y) / dir.y;
      const x = p.x + dir.x * t;
      const z = p.z + dir.z * t;
      return x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1;
    });
    if (ok) return 1;
  }
  return 0;
}

// 1, если луч от точки p к источнику света (dir) проходит через окно своей комнаты или колодец.
export function beamFactor(p, dir) {
  if (skylightFactor(p, dir)) return 1;
  if (dir.z > -0.02 || dir.y <= 0 || (p.x > ROOM.x1 && p.x < ROOM2.x0)) return 0;
  const w = p.x > (ROOM.x1 + ROOM2.x0) / 2 ? WINDOW2 : WINDOW;
  const t = (ROOM.z0 - p.z) / dir.z;
  const x = p.x + dir.x * t;
  const y = p.y + dir.y * t;
  return x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1 ? 1 : 0;
}

const f = (v) => v.toFixed(3);

// Те же константы и проверка луча для шейдеров.
export const LAYOUT_GLSL = /* glsl */ `
#define ROOM_Z0 ${f(ROOM.z0)}
#define WIN_X0 ${f(WINDOW.x0)}
#define WIN_X1 ${f(WINDOW.x1)}
#define WIN_Y0 ${f(WINDOW.y0)}
#define WIN_Y1 ${f(WINDOW.y1)}
#define WIN_PANES ${f(WINDOW.panes)}
#define ROOM2_DX ${f(ROOM2_DX)}
#define POOL_C vec2(${f((POOL.x0 + POOL.x1) / 2)}, ${f((POOL.z0 + POOL.z1) / 2)})
#define POOL_H vec2(${f((POOL.x1 - POOL.x0) / 2)}, ${f((POOL.z1 - POOL.z0) / 2)})
#define POOL_WATER ${f(POOL.water)}

#define ROOM_H ${f(ROOM.height)}
#define WELL_H ${f(WELL)}

float inRect(vec2 h, vec4 r, float e) {
  return smoothstep(r.x, r.x + e, h.x) * (1.0 - smoothstep(r.y - e, r.y, h.x))
       * smoothstep(r.z, r.z + e, h.y) * (1.0 - smoothstep(r.w - e, r.w, h.y));
}

// Луч к солнцу проходит сквозь световой колодец: и через проём в потолке, и через верх шахты.
float inSkylight(vec3 p, vec3 ld) {
  if (ld.y <= 0.02 || p.y >= ROOM_H || (p.x > ${f(CORRIDOR.x0)} && p.x < ${f(CORRIDOR.x1)})) return 0.0;
  vec2 a = p.xz + ld.xz * ((ROOM_H - p.y) / ld.y);
  vec2 b = p.xz + ld.xz * ((ROOM_H + WELL_H - p.y) / ld.y);
  float s = 0.0;
${SKYLIGHTS.map((s) => `  s = max(s, inRect(a, vec4(${f(s.x0)}, ${f(s.x1)}, ${f(s.z0)}, ${f(s.z1)}), 0.04) * inRect(b, vec4(${f(s.x0)}, ${f(s.x1)}, ${f(s.z0)}, ${f(s.z1)}), 0.04));`).join("\n")}
  return s;
}

#define COR_X0 ${f(CORRIDOR.x0)}
#define COR_X1 ${f(CORRIDOR.x1)}
#define COR_Z0 ${f(CORRIDOR.z0)}

// Тень переплёта: вертикальные перекладины через равные доли и одна горизонтальная.
float mullions(vec2 h, vec4 w, float panes) {
  float pane = (w.y - w.x) / panes;
  float u = (h.x - w.x) / pane;
  float mv = smoothstep(0.012, 0.03, abs(fract(u + 0.5) - 0.5) * pane);
  float mh = smoothstep(0.012, 0.03, abs(h.y - (w.z + (w.w - w.z) * 0.62)));
  return mv * mh;
}

// Окно своей комнаты: точка в коридоре его не видит, точка во второй комнате — только своё.
// Возвращает освещённость, в h — куда на окне пришёл луч (x приведён к первой комнате).
float roomWindow(vec3 p, vec3 ld, out vec2 h) {
  h = vec2(0.0);
  if (ld.z > -0.02 || ld.y <= 0.0 || (p.x > COR_X0 && p.x < COR_X1)) return 0.0;
  h = p.xy + ld.xy * ((ROOM_Z0 - p.z) / ld.z);
  if (p.x > (COR_X0 + COR_X1) * 0.5) h.x -= ROOM2_DX;
  return inRect(h, vec4(WIN_X0, WIN_X1, WIN_Y0, WIN_Y1), 0.05);
}

// Окно коридора — только для точек внутри коридора.
float corridorWindow(vec3 p, vec3 ld, out vec2 h) {
  h = vec2(0.0);
  if (ld.z > -0.02 || ld.y <= 0.0 || p.x < COR_X0 || p.x > COR_X1 || p.z < COR_Z0) return 0.0;
  h = p.xy + ld.xy * ((COR_Z0 - p.z) / ld.z);
  return inRect(h, vec4(${f(CWINDOW.x0)}, ${f(CWINDOW.x1)}, ${f(CWINDOW.y0)}, ${f(CWINDOW.y1)}), 0.04);
}

float inWindow(vec3 p, vec3 ld) {
  vec2 h;
  return max(roomWindow(p, ld, h), corridorWindow(p, ld, h));
}

float inBeam(vec3 p, vec3 ld) {
  return max(inWindow(p, ld), inSkylight(p, ld));
}

// То же, но с тенью от переплёта окна.
float inBeamFramed(vec3 p, vec3 ld) {
  vec2 h;
  float b = roomWindow(p, ld, h);
  if (b > 0.0) b *= mullions(h, vec4(WIN_X0, WIN_X1, WIN_Y0, WIN_Y1), WIN_PANES);
  float c = corridorWindow(p, ld, h);
  if (c > 0.0) c *= mullions(h, vec4(${f(CWINDOW.x0)}, ${f(CWINDOW.x1)}, ${f(CWINDOW.y0)}, ${f(CWINDOW.y1)}), ${f(CWINDOW.panes)});
  return max(max(b, c), inSkylight(p, ld));
}

// Бегущий узор отблесков воды.
float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318530718, 6.28318530718) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}
`;

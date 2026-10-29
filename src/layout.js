// Размеры комнаты и всего, что в ней стоит. Метры, ось Y вверх,
// окно на длинной стене z = ROOM.z0, солнце и луна светят с этой стороны.

export const ROOM = { x0: -4, x1: 4, z0: -3, z1: 3, height: 3.5, wall: 0.25, base: -1.15 };
export const POOL = { x0: -1, x1: 3, z0: -1.2, z1: 1.3, bottom: -0.95, water: -0.12 };
export const WINDOW = { x0: -3.2, x1: 3.0, y0: 0.7, y1: 2.8, panes: 6 };
export const MEADOW = { x0: -3.45, x1: 3.25, z0: -3, z1: -1.9 };
export const EYE_HEIGHT = 1.65;

// Световые колодцы в потолке: проём x0..x1, z0..z1 и шахта высотой well над потолком.
export const SKYLIGHTS = [
  { x0: -2.9, x1: -1.9, z0: -0.6, z1: 0.4 },
  { x0: 0.6, x1: 1.8, z0: -1.7, z1: -0.7 },
];
export const WELL = 0.45;

// Ступени из кафеля вдоль западного края бассейна: спускаются от пола к дну.
export const STEPS = { count: 4, tread: 0.32 };
export const STEP_RISE = -POOL.bottom / (STEPS.count + 1);

export function inPool(x, z, margin = 0) {
  return x > POOL.x0 + margin && x < POOL.x1 - margin && z > POOL.z0 + margin && z < POOL.z1 - margin;
}

// Высота дна бассейна с учётом ступеней.
export function poolFloorAt(x) {
  const i = Math.floor((x - POOL.x0) / STEPS.tread);
  return i < STEPS.count ? -(Math.max(i, 0) + 1) * STEP_RISE : POOL.bottom;
}

export function groundAt(x, z) {
  return inPool(x, z) ? poolFloorAt(x) : 0;
}

// Неровный передний край луговой полосы.
export function meadowEdge(x) {
  return MEADOW.z1 + 0.1 * Math.sin(x * 3.1 + 0.7) + 0.05 * Math.sin(x * 7.7 + 2.1);
}

export function inMeadow(x, z) {
  return x > MEADOW.x0 && x < MEADOW.x1 && z < meadowEdge(x);
}

// 1, если луч от точки p к источнику света проходит сквозь колодец целиком (вход и выход шахты).
function skylightFactor(p, dir) {
  if (dir.y <= 0.02 || p.y >= ROOM.height) return 0;
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

// 1, если луч от точки p к источнику света (dir) проходит через окно или колодец.
export function beamFactor(p, dir) {
  if (skylightFactor(p, dir)) return 1;
  if (dir.z > -0.02 || dir.y <= 0) return 0;
  const t = (ROOM.z0 - p.z) / dir.z;
  const x = p.x + dir.x * t;
  const y = p.y + dir.y * t;
  return x > WINDOW.x0 && x < WINDOW.x1 && y > WINDOW.y0 && y < WINDOW.y1 ? 1 : 0;
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
  if (ld.y <= 0.02 || p.y >= ROOM_H) return 0.0;
  vec2 a = p.xz + ld.xz * ((ROOM_H - p.y) / ld.y);
  vec2 b = p.xz + ld.xz * ((ROOM_H + WELL_H - p.y) / ld.y);
  float s = 0.0;
${SKYLIGHTS.map((s) => `  s = max(s, inRect(a, vec4(${f(s.x0)}, ${f(s.x1)}, ${f(s.z0)}, ${f(s.z1)}), 0.04) * inRect(b, vec4(${f(s.x0)}, ${f(s.x1)}, ${f(s.z0)}, ${f(s.z1)}), 0.04));`).join("\n")}
  return s;
}

float inWindow(vec3 p, vec3 ld) {
  if (ld.z > -0.02 || ld.y <= 0.0) return 0.0;
  float t = (ROOM_Z0 - p.z) / ld.z;
  return inRect(p.xy + ld.xy * t, vec4(WIN_X0, WIN_X1, WIN_Y0, WIN_Y1), 0.05);
}

float inBeam(vec3 p, vec3 ld) {
  return max(inWindow(p, ld), inSkylight(p, ld));
}

// То же, но с тенью от переплёта окна (вертикальные перекладины и одна горизонтальная).
float inBeamFramed(vec3 p, vec3 ld) {
  float sky = inSkylight(p, ld);
  float b = inWindow(p, ld);
  if (b <= 0.0) return sky;
  float t = (ROOM_Z0 - p.z) / ld.z;
  vec2 h = p.xy + ld.xy * t;
  float pane = (WIN_X1 - WIN_X0) / WIN_PANES;
  float u = (h.x - WIN_X0) / pane;
  float mv = smoothstep(0.012, 0.03, abs(fract(u + 0.5) - 0.5) * pane);
  float mh = smoothstep(0.012, 0.03, abs(h.y - (WIN_Y0 + (WIN_Y1 - WIN_Y0) * 0.62)));
  return max(b * mv * mh, sky);
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

// Размеры комнаты и всего, что в ней стоит. Метры, ось Y вверх,
// окно на длинной стене z = ROOM.z0, солнце и луна светят с этой стороны.

export const ROOM = { x0: -4, x1: 4, z0: -3, z1: 3, height: 3.5, wall: 0.25, base: -1.15 };
export const POOL = { x0: -1, x1: 3, z0: -1.2, z1: 1.3, bottom: -0.95, water: -0.12 };
export const WINDOW = { x0: -3.2, x1: 0, y0: 0.7, y1: 2.8 };
export const MEADOW = { x0: -3.45, x1: 0.25, z0: -3, z1: -1.9 };
export const EYE_HEIGHT = 1.65;

export function inPool(x, z, margin = 0) {
  return x > POOL.x0 + margin && x < POOL.x1 - margin && z > POOL.z0 + margin && z < POOL.z1 - margin;
}

// Неровный передний край луговой полосы.
export function meadowEdge(x) {
  return MEADOW.z1 + 0.1 * Math.sin(x * 3.1 + 0.7) + 0.05 * Math.sin(x * 7.7 + 2.1);
}

export function inMeadow(x, z) {
  return x > MEADOW.x0 && x < MEADOW.x1 && z < meadowEdge(x);
}

// 1, если луч от точки p к источнику света (dir) проходит через окно.
export function beamFactor(p, dir) {
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
#define POOL_C vec2(${f((POOL.x0 + POOL.x1) / 2)}, ${f((POOL.z0 + POOL.z1) / 2)})
#define POOL_H vec2(${f((POOL.x1 - POOL.x0) / 2)}, ${f((POOL.z1 - POOL.z0) / 2)})
#define POOL_WATER ${f(POOL.water)}

float inBeam(vec3 p, vec3 ld) {
  if (ld.z > -0.02 || ld.y <= 0.0) return 0.0;
  float t = (ROOM_Z0 - p.z) / ld.z;
  vec2 h = p.xy + ld.xy * t;
  float e = 0.05;
  return smoothstep(WIN_X0, WIN_X0 + e, h.x) * (1.0 - smoothstep(WIN_X1 - e, WIN_X1, h.x))
       * smoothstep(WIN_Y0, WIN_Y0 + e, h.y) * (1.0 - smoothstep(WIN_Y1 - e, WIN_Y1, h.y));
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

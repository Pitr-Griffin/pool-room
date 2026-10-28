import * as THREE from 'three';
import { ROOM, POOL, WINDOW, STEPS, STEP_RISE, LAYOUT_GLSL } from './layout.js';

// Кафель целиком процедурный: плитка 15 см со скруглёнными краями, утопленные швы,
// глянцевая глазурь, лёгкая неравномерность цвета и грязь в швах.
// Плюс бегущие отблески воды на потолке, стенах и дне бассейна.
// cove = true: изогнутая галтель, плитка раскладывается по её развёртке (uv в метрах).
export function makeTileMaterial(color, shared, cove = false) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.15,
    metalness: 0,
    side: cove ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (cove) m.defines = { TILE_COVE: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTileWP;\nvarying vec3 vTileN;\nvarying vec2 vCoveUv;'
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vTileWP = (modelMatrix * vec4(position, 1.0)).xyz;
        vTileN = normalize(mat3(modelMatrix) * normal);
        vCoveUv = uv;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTileWP;
        varying vec3 vTileN;
        varying vec2 vCoveUv;
        uniform float uCTime;
        uniform vec3 uLightDir;
        uniform vec3 uLightCol;
        uniform vec3 uSkyCol;
        uniform float uWaterLit;
        ${LAYOUT_GLSL}
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
                     mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 tWP = vTileWP;
        vec3 tAn = abs(normalize(vTileN));
        vec2 tc;
        vec3 tU;
        vec3 tV;
        if (tAn.y >= tAn.x && tAn.y >= tAn.z) { tc = tWP.xz; tU = vec3(1.0, 0.0, 0.0); tV = vec3(0.0, 0.0, 1.0); }
        else if (tAn.x >= tAn.z) { tc = tWP.zy; tU = vec3(0.0, 0.0, 1.0); tV = vec3(0.0, 1.0, 0.0); }
        else { tc = tWP.xy; tU = vec3(1.0, 0.0, 0.0); tV = vec3(0.0, 1.0, 0.0); }
        #ifdef TILE_COVE
          tc = vCoveUv;
          tU = vec3(0.0);
          tV = vec3(0.0);
        #endif
        vec2 tg = tc / 0.15;
        vec2 tf = fract(tg) - 0.5;
        vec2 td = 0.5 - abs(tf);
        float tAA = max(fwidth(tg.x) + fwidth(tg.y), 0.002);
        float tGrout = 1.0 - smoothstep(0.022, 0.022 + tAA, min(td.x, td.y));
        vec2 tSlope = sign(tf) * (1.0 - smoothstep(0.022, 0.09, td)) * (1.0 - tGrout);
        float tVar = tHash(floor(tg));
        vec3 tileCol = vec3(0.955, 0.972, 0.978) * (0.97 + 0.045 * tVar);
        bool tVertical = tAn.y < 0.5;
        if (tVertical && tWP.y > 1.05 && tWP.y < 1.2) tileCol = vec3(0.66, 0.84, 0.86) * (0.97 + 0.05 * tVar);
        if (tVertical && tWP.y < -0.005 && tWP.y > -0.155) tileCol = vec3(0.2, 0.42, 0.56) * (0.95 + 0.08 * tVar);
        float tGrime = tNoise(tc * 1.3) * 0.6 + tNoise(tc * 7.0) * 0.4;
        vec3 groutCol = vec3(0.74, 0.76, 0.75) * (0.88 + 0.2 * tGrime);
        diffuseColor.rgb *= mix(tileCol * (1.0 - tGrime * 0.03), groutCol, tGrout);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.08 + tGrime * 0.08, 0.85, tGrout);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal + mat3(viewMatrix) * (tU * tSlope.x + tV * tSlope.y) * 0.45);`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 add = vec3(0.0);
          if (tWP.y < -0.03) {
            float pat = caustic(tc * 0.45, uCTime * 0.35);
            add = pat * (uLightCol * inBeam(tWP, uLightDir) * 0.5 + uSkyCol * 0.12);
          } else if (normalize(vTileN).y < 0.5) {
            vec2 q = abs(tWP.xz - POOL_C) - POOL_H;
            float m = exp(-length(max(q, 0.0)) * 1.1);
            if (tVertical) m *= smoothstep(0.2, 2.8, tWP.y) * 0.8;
            add = caustic(tc * 0.3, uCTime * 0.25) * m * (uLightCol * uWaterLit * 0.14 + uSkyCol * 0.04);
          }
          outgoingLight += diffuseColor.rgb * add * (1.0 - tGrout);
        }
        #include <opaque_fragment>`
      );
  };
  m.customProgramCacheKey = () => (cove ? 'pool-tile-cove' : 'pool-tile');
  return m;
}

function box(x0, x1, y0, y1, z0, z1, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Вогнутый скруглённый угол (галтель) — как в настоящих бассейнах, где стена
// плавно переходит в пол и в потолок.
function cove(origin, eu, ev, ew, len, r, material, segments = 10) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const along = origin.dot(ew);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 0.5;
    n.copy(eu).multiplyScalar(Math.cos(a)).addScaledVector(ev, Math.sin(a));
    for (let j = 0; j <= 1; j++) {
      p.copy(origin).addScaledVector(n, r).addScaledVector(ew, j * len);
      pos.push(p.x, p.y, p.z);
      nor.push(-n.x, -n.y, -n.z);
      uv.push(along + j * len, a * r);
    }
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Скруглённая кромка (бортик) вдоль ребра.
function nosing(x0, x1, y, z0, z1, r, material) {
  const alongX = x1 - x0 > z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16, 1), material);
  if (alongX) mesh.rotation.z = Math.PI / 2;
  else mesh.rotation.x = Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoom(scene, shared) {
  const tile = makeTileMaterial(new THREE.Color('#ffffff'), shared);
  const coveTile = makeTileMaterial(new THREE.Color('#ffffff'), shared, true);
  const poolTile = makeTileMaterial(new THREE.Color('#d3f1f2'), shared);
  const group = new THREE.Group();

  const { x0, x1, z0, z1, height: H, wall: T, base: B } = ROOM;

  // Пол — четыре плиты вокруг чаши бассейна.
  group.add(box(x0 - T, x1 + T, B, 0, z0 - T, POOL.z0, tile));
  group.add(box(x0 - T, x1 + T, B, 0, POOL.z1, z1 + T, tile));
  group.add(box(x0 - T, POOL.x0, B, 0, POOL.z0, POOL.z1, tile));
  group.add(box(POOL.x1, x1 + T, B, 0, POOL.z0, POOL.z1, tile));
  // Дно и стенки чаши.
  group.add(box(POOL.x0, POOL.x1, B, POOL.bottom, POOL.z0, POOL.z1, poolTile));
  const lining = 0.01;
  group.add(box(POOL.x0, POOL.x0 + lining, POOL.bottom, 0, POOL.z0, POOL.z1, poolTile));
  group.add(box(POOL.x1 - lining, POOL.x1, POOL.bottom, 0, POOL.z0, POOL.z1, poolTile));
  group.add(box(POOL.x0, POOL.x1, POOL.bottom, 0, POOL.z0, POOL.z0 + lining, poolTile));
  group.add(box(POOL.x0, POOL.x1, POOL.bottom, 0, POOL.z1 - lining, POOL.z1, poolTile));

  // Ступени во всю ширину бассейна, со скруглёнными кромками.
  const r = 0.025;
  for (let i = 0; i < STEPS.count; i++) {
    const top = -(i + 1) * STEP_RISE;
    const sx1 = POOL.x0 + (i + 1) * STEPS.tread;
    group.add(box(POOL.x0, sx1, POOL.bottom, top, POOL.z0 + lining, POOL.z1 - lining, poolTile));
    group.add(nosing(sx1 - r, sx1 - r, top - r, POOL.z0 + lining, POOL.z1 - lining, r, poolTile));
  }
  // Бортик бассейна.
  group.add(nosing(POOL.x0, POOL.x1, -r, POOL.z0, POOL.z0, r, tile));
  group.add(nosing(POOL.x0, POOL.x1, -r, POOL.z1, POOL.z1, r, tile));
  group.add(nosing(POOL.x0, POOL.x0, -r, POOL.z0, POOL.z1, r, tile));
  group.add(nosing(POOL.x1, POOL.x1, -r, POOL.z0, POOL.z1, r, tile));

  // Потолок и стены.
  group.add(box(x0 - T, x1 + T, H, H + T, z0 - T, z1 + T, tile));
  group.add(box(x0 - T, x1 + T, 0, H, z1, z1 + T, tile));
  group.add(box(x0 - T, x0, 0, H, z0, z1, tile));
  group.add(box(x1, x1 + T, 0, H, z0, z1, tile));
  group.add(box(x0 - T, x1 + T, 0, WINDOW.y0, z0 - T, z0, tile));
  group.add(box(x0 - T, x1 + T, WINDOW.y1, H, z0 - T, z0, tile));
  group.add(box(x0 - T, WINDOW.x0, WINDOW.y0, WINDOW.y1, z0 - T, z0, tile));
  group.add(box(WINDOW.x1, x1 + T, WINDOW.y0, WINDOW.y1, z0 - T, z0, tile));

  // Галтели: пол–стена, потолок–стена и вертикальные углы.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cr = 0.14;
  const W = x1 - x0;
  const D = z1 - z0;
  for (const [y, dy] of [[cr, -1], [H - cr, 1]]) {
    group.add(cove(V(x0, y, z0 + cr), V(0, 0, -1), V(0, dy, 0), V(1, 0, 0), W, cr, coveTile));
    group.add(cove(V(x0, y, z1 - cr), V(0, 0, 1), V(0, dy, 0), V(1, 0, 0), W, cr, coveTile));
    group.add(cove(V(x0 + cr, y, z0), V(-1, 0, 0), V(0, dy, 0), V(0, 0, 1), D, cr, coveTile));
    group.add(cove(V(x1 - cr, y, z0), V(1, 0, 0), V(0, dy, 0), V(0, 0, 1), D, cr, coveTile));
  }
  for (const [x, sx] of [[x0 + cr, -1], [x1 - cr, 1]]) {
    for (const [z, sz] of [[z0 + cr, -1], [z1 - cr, 1]]) {
      group.add(cove(V(x, 0, z), V(sx, 0, 0), V(0, 0, sz), V(0, 1, 0), H, cr, coveTile));
    }
  }

  // Рама и переплёт окна.
  const frame = new THREE.MeshStandardMaterial({ color: '#f3f3ee', roughness: 0.4 });
  const fz0 = z0 - T / 2 - 0.04;
  const fz1 = z0 - T / 2 + 0.04;
  const fw = 0.06;
  const mw = 0.035;
  group.add(box(WINDOW.x0, WINDOW.x1, WINDOW.y0, WINDOW.y0 + fw, fz0, fz1, frame));
  group.add(box(WINDOW.x0, WINDOW.x1, WINDOW.y1 - fw, WINDOW.y1, fz0, fz1, frame));
  group.add(box(WINDOW.x0, WINDOW.x0 + fw, WINDOW.y0, WINDOW.y1, fz0, fz1, frame));
  group.add(box(WINDOW.x1 - fw, WINDOW.x1, WINDOW.y0, WINDOW.y1, fz0, fz1, frame));
  const ww = WINDOW.x1 - WINDOW.x0;
  for (let i = 1; i < WINDOW.panes; i++) {
    const x = WINDOW.x0 + (ww * i) / WINDOW.panes;
    group.add(box(x - mw / 2, x + mw / 2, WINDOW.y0, WINDOW.y1, fz0, fz1, frame));
  }
  const ym = WINDOW.y0 + (WINDOW.y1 - WINDOW.y0) * 0.62;
  group.add(box(WINDOW.x0, WINDOW.x1, ym - mw / 2, ym + mw / 2, fz0, fz1, frame));

  scene.add(group);
  return { tile, coveTile, poolTile, frame };
}

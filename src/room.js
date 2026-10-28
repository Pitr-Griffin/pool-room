import * as THREE from 'three';
import { ROOM, POOL, WINDOW, LAYOUT_GLSL } from './layout.js';

const TILE_REPEAT = 0.6; // текстура — 4×4 плитки по 15 см

function makeTileTexture() {
  const size = 512;
  const n = 4;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#c3cacc';
  g.fillRect(0, 0, size, size);
  const s = size / n;
  const gap = 6;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 238 + Math.random() * 12;
      const x = i * s + gap / 2;
      const y = j * s + gap / 2;
      const grad = g.createLinearGradient(x, y, x + s, y + s);
      grad.addColorStop(0, `rgb(${Math.min(255, v + 4)},${Math.min(255, v + 6)},${Math.min(255, v + 7)})`);
      grad.addColorStop(1, `rgb(${v - 8},${v - 5},${v - 3})`);
      g.fillStyle = grad;
      g.fillRect(x, y, s - gap, s - gap);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Кафель с UV в мировых координатах (плитка непрерывна на стыках)
// и отблесками воды на потолке, стенах и дне бассейна.
export function makeTileMaterial(tex, color, shared) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.3, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTileWP;\nvarying vec3 vTileN;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vec4 tWP = modelMatrix * vec4(position, 1.0);
        vec3 tN = normalize(mat3(modelMatrix) * normal);
        vTileWP = tWP.xyz;
        vTileN = tN;
        vec2 tc = abs(tN.y) > 0.5 ? tWP.xz : (abs(tN.x) > 0.5 ? tWP.zy : tWP.xy);
        vMapUv = tc / ${TILE_REPEAT.toFixed(3)};`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTileWP;
        varying vec3 vTileN;
        uniform float uCTime;
        uniform vec3 uLightDir;
        uniform vec3 uLightCol;
        uniform vec3 uSkyCol;
        uniform float uWaterLit;
        ${LAYOUT_GLSL}`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 wp = vTileWP;
          vec3 tn = normalize(vTileN);
          vec2 cc = abs(tn.y) > 0.5 ? wp.xz : (abs(tn.x) > 0.5 ? wp.zy : wp.xy);
          vec3 add = vec3(0.0);
          if (wp.y < -0.03) {
            float pat = caustic(cc * 0.45, uCTime * 0.35);
            float lit = inBeam(wp, uLightDir);
            add = pat * (uLightCol * lit * 0.5 + uSkyCol * 0.2);
          } else if (tn.y < 0.5) {
            vec2 q = abs(wp.xz - POOL_C) - POOL_H;
            float m = exp(-length(max(q, 0.0)) * 1.1);
            if (tn.y > -0.5) m *= smoothstep(0.2, 2.8, wp.y) * 0.8;
            float pat = caustic(cc * 0.3, uCTime * 0.25);
            add = pat * m * (uLightCol * uWaterLit * 0.14 + uSkyCol * 0.06);
          }
          outgoingLight += diffuseColor.rgb * add;
        }
        #include <opaque_fragment>`
      );
  };
  m.customProgramCacheKey = () => 'pool-tile';
  return m;
}

function box(x0, x1, y0, y1, z0, z1, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoom(scene, shared) {
  const tex = makeTileTexture();
  const tile = makeTileMaterial(tex, new THREE.Color('#ffffff'), shared);
  const poolTile = makeTileMaterial(tex, new THREE.Color('#c4ecef'), shared);
  const group = new THREE.Group();

  const { x0, x1, z0, z1, height: H, wall: T, base: B } = ROOM;

  // Пол — четыре плиты вокруг чаши бассейна.
  group.add(box(x0 - T, x1 + T, B, 0, z0 - T, POOL.z0, tile));
  group.add(box(x0 - T, x1 + T, B, 0, POOL.z1, z1 + T, tile));
  group.add(box(x0 - T, POOL.x0, B, 0, POOL.z0, POOL.z1, tile));
  group.add(box(POOL.x1, x1 + T, B, 0, POOL.z0, POOL.z1, tile));
  // Дно бассейна.
  group.add(box(POOL.x0, POOL.x1, B, POOL.bottom, POOL.z0, POOL.z1, poolTile));
  // Стенки чаши — тонкие облицовки внутри, чтобы они были голубыми.
  const lining = 0.01;
  group.add(box(POOL.x0, POOL.x0 + lining, POOL.bottom, 0, POOL.z0, POOL.z1, poolTile));
  group.add(box(POOL.x1 - lining, POOL.x1, POOL.bottom, 0, POOL.z0, POOL.z1, poolTile));
  group.add(box(POOL.x0, POOL.x1, POOL.bottom, 0, POOL.z0, POOL.z0 + lining, poolTile));
  group.add(box(POOL.x0, POOL.x1, POOL.bottom, 0, POOL.z1 - lining, POOL.z1, poolTile));

  // Потолок.
  group.add(box(x0 - T, x1 + T, H, H + T, z0 - T, z1 + T, tile));
  // Глухие стены.
  group.add(box(x0 - T, x1 + T, 0, H, z1, z1 + T, tile));
  group.add(box(x0 - T, x0, 0, H, z0, z1, tile));
  group.add(box(x1, x1 + T, 0, H, z0, z1, tile));
  // Стена с окном.
  group.add(box(x0 - T, x1 + T, 0, WINDOW.y0, z0 - T, z0, tile));
  group.add(box(x0 - T, x1 + T, WINDOW.y1, H, z0 - T, z0, tile));
  group.add(box(x0 - T, WINDOW.x0, WINDOW.y0, WINDOW.y1, z0 - T, z0, tile));
  group.add(box(WINDOW.x1, x1 + T, WINDOW.y0, WINDOW.y1, z0 - T, z0, tile));

  // Рама и переплёт окна.
  const frame = new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.55 });
  const fz0 = z0 - T / 2 - 0.04;
  const fz1 = z0 - T / 2 + 0.04;
  const fw = 0.06;
  const mw = 0.035;
  group.add(box(WINDOW.x0, WINDOW.x1, WINDOW.y0, WINDOW.y0 + fw, fz0, fz1, frame));
  group.add(box(WINDOW.x0, WINDOW.x1, WINDOW.y1 - fw, WINDOW.y1, fz0, fz1, frame));
  group.add(box(WINDOW.x0, WINDOW.x0 + fw, WINDOW.y0, WINDOW.y1, fz0, fz1, frame));
  group.add(box(WINDOW.x1 - fw, WINDOW.x1, WINDOW.y0, WINDOW.y1, fz0, fz1, frame));
  const ww = WINDOW.x1 - WINDOW.x0;
  for (const k of [1 / 3, 2 / 3]) {
    const x = WINDOW.x0 + ww * k;
    group.add(box(x - mw / 2, x + mw / 2, WINDOW.y0, WINDOW.y1, fz0, fz1, frame));
  }
  const ym = WINDOW.y0 + (WINDOW.y1 - WINDOW.y0) * 0.62;
  group.add(box(WINDOW.x0, WINDOW.x1, ym - mw / 2, ym + mw / 2, fz0, fz1, frame));

  // Лесенка в бассейн.
  const metal = new THREE.MeshStandardMaterial({ color: '#e3e7ea', metalness: 1, roughness: 0.22 });
  for (const z of [-0.25, 0.25]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.38, 0, z),
      new THREE.Vector3(-1.38, 0.78, z),
      new THREE.Vector3(-1.27, 0.95, z),
      new THREE.Vector3(-1.07, 0.96, z),
      new THREE.Vector3(-0.93, 0.78, z),
      new THREE.Vector3(-0.91, 0.0, z),
      new THREE.Vector3(-0.91, -0.9, z),
    ]);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.022, 10), metal);
    rail.castShadow = true;
    group.add(rail);
  }
  for (const y of [-0.3, -0.62]) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.5), metal);
    step.position.set(-0.9, y, 0);
    step.castShadow = true;
    group.add(step);
  }

  scene.add(group);
  return { tile, poolTile, frame, metal };
}

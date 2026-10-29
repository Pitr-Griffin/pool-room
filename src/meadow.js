import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MEADOW, ROOM2, SHALLOW, meadowEdge, inMeadow2 } from './layout.js';

// Рядом с травой — на лугу первой комнаты или на полу второй (с запасом на радиус ног).
function nearGrass(x, z) {
  const strip = x > MEADOW.x0 - 0.3 && x < MEADOW.x1 + 0.3 && z < meadowEdge(x) + 0.3;
  return strip || inMeadow2(x, z, -0.3);
}

const PRESS = 64;

// Колыхание травы: чем выше точка над полом, тем сильнее её сносит.
// Следы: там, где прошёл игрок, трава приминается к земле и за несколько секунд
// медленно распрямляется; прямо под ногами — расходится в стороны.
function addSway(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSwayTime;
        uniform vec4 uPress[${PRESS}];`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        vec4 swp = modelMatrix * mvPosition;
        float sh = max(swp.y, 0.0);
        float w = sin(uSwayTime * 1.6 + root.x * 2.3 + root.z * 1.1) * 0.6
                + sin(uSwayTime * 2.7 + root.x * 4.1 - root.z * 2.0) * 0.3;
        swp.x += w * sh * sh * 0.7;
        swp.z += w * sh * sh * 0.3;

        // След: xy — где, z — когда наступили, w — когда ушли дальше.
        // Трава пригибается за ~0.2 с, а после ухода медленно распрямляется;
        // соседние следы складываются мягко, без скачков от одного к другому.
        float keep = 1.0;
        vec2 away = vec2(0.0);
        for (int i = 0; i < ${PRESS}; i++) {
          vec4 f = uPress[i];
          if (f.z < -50.0) continue;
          vec2 d = root.xz - f.xy;
          float dist = length(d);
          float spatial = 1.0 - smoothstep(0.05, 0.42, dist);
          if (spatial <= 0.0) continue;
          float onset = smoothstep(0.0, 0.22, uSwayTime - f.z);
          float lift = exp(-max(uSwayTime - f.w, 0.0) / 3.0);
          float k = spatial * onset * lift;
          keep *= 1.0 - k * 0.92;
          away += d / max(dist, 0.03) * k;
        }
        float press = 1.0 - keep;
        // Пригибаем травинку: верх опускается и уходит от следа, длина сохраняется.
        float bend = press * 1.35;
        float al = length(away);
        vec2 dirA = al > 1e-4 ? away / al : vec2(0.0);
        float hRel = swp.y - root.y;
        vec2 horiz = swp.xz - root.xz;
        float c = cos(bend), s = sin(bend);
        swp.y = root.y + hRel * c;
        swp.xz = root.xz + horiz + dirA * hRel * s;

        mvPosition = viewMatrix * swp;
        gl_Position = projectionMatrix * mvPosition;`
      );
  };
  material.customProgramCacheKey = () => 'meadow-sway-press';
}

function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function stem(h, color = '#4a8030') {
  return colorize(new THREE.CylinderGeometry(0.0018, 0.0024, h, 4).translate(0, h / 2, 0), color);
}

function disc(r, segments, color, inner = 1) {
  const g = new THREE.CircleGeometry(r, segments);
  const pos = g.attributes.position;
  if (inner !== 1) {
    for (let i = 1; i < pos.count; i++) {
      if (i % 2 === 0) pos.setXY(i, pos.getX(i) * inner, pos.getY(i) * inner);
    }
  }
  g.rotateX(-Math.PI / 2);
  return colorize(g, color);
}

function bladeGeometry() {
  const h = 0.18;
  const g = new THREE.PlaneGeometry(0.018, h, 1, 4);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const bottom = new THREE.Color('#2c5a1c');
  const top = new THREE.Color('#9cc552');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) + h / 2) / h;
    pos.setX(i, pos.getX(i) * (1 - k * 0.92));
    pos.setY(i, k * h);
    pos.setZ(i, k * k * 0.035);
    c.copy(bottom).lerp(top, k);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const FLOWERS = {
  // Ромашка
  daisy: () => mergeGeometries([
    stem(0.2),
    disc(0.022, 20, '#f8f8f2', 0.5).translate(0, 0.2, 0),
    colorize(new THREE.SphereGeometry(0.0065, 8, 6).scale(1, 0.5, 1).translate(0, 0.202, 0), '#f2c021'),
  ]),
  // Лютик
  buttercup: () => mergeGeometries([
    stem(0.16),
    colorize(new THREE.SphereGeometry(0.011, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, 0.17, 0), '#f6c614'),
  ]),
  // Незабудка
  forgetMeNot: () => mergeGeometries([
    stem(0.12),
    ...[[0, 0], [0.011, 0.004], [-0.008, 0.009], [0.004, -0.011], [-0.01, -0.006]].map(([x, z], i) =>
      disc(0.0055, 5, '#86aef0').translate(x, 0.12 + i * 0.003, z)
    ),
  ]),
  // Клевер
  clover: () => mergeGeometries([
    stem(0.075),
    colorize(new THREE.SphereGeometry(0.011, 8, 6).scale(1, 1.15, 1).translate(0, 0.08, 0), '#efd6e2'),
    ...[0, 2.1, 4.2].map((a) =>
      disc(0.01, 8, '#4f8c34').translate(Math.cos(a) * 0.012, 0.03, Math.sin(a) * 0.012)
    ),
  ]),
  // Колокольчик
  bluebell: () => mergeGeometries([
    stem(0.17),
    colorize(new THREE.ConeGeometry(0.008, 0.018, 6, 1, true).rotateZ(Math.PI).translate(0.004, 0.16, 0), '#7d79d6'),
  ]),
};

// Луг второй комнаты: весь пол, кроме мелкого бассейна; к воде трава редеет.
function scatter2(count, rand, accept) {
  // Отступ от стен: там скруглённая галтель, трава в неё не врастает.
  const wm = 0.16;
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 40) {
    const x = ROOM2.x0 + wm + rand() * (ROOM2.x1 - ROOM2.x0 - 2 * wm);
    const z = ROOM2.z0 + wm + rand() * (ROOM2.z1 - ROOM2.z0 - 2 * wm);
    const ox = Math.max(SHALLOW.x0 - x, x - SHALLOW.x1, 0);
    const oz = Math.max(SHALLOW.z0 - z, z - SHALLOW.z1, 0);
    const gap = Math.hypot(ox, oz);
    if (gap < 0.13) continue;
    // У кафельного бортика и у стен трава реже.
    const wall = Math.min(x - ROOM2.x0, ROOM2.x1 - x, z - ROOM2.z0, ROOM2.z1 - z) - wm;
    if (rand() > Math.min(1, (gap - 0.13) / 0.35 + 0.25) * Math.min(1, wall / 0.25 + 0.4) * accept) continue;
    pts.push([x, z]);
  }
  return pts;
}

function scatter(count, rand, accept, region = 1) {
  if (region === 2) return scatter2(count, rand, accept);
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 40) {
    const x = MEADOW.x0 + rand() * (MEADOW.x1 - MEADOW.x0);
    const z = MEADOW.z0 + 0.03 + rand() * (MEADOW.z1 + 0.2 - MEADOW.z0);
    const edge = meadowEdge(x);
    if (z > edge) continue;
    const side = Math.min(x - MEADOW.x0, MEADOW.x1 - x);
    const density = Math.min(1, side / 0.3) * Math.min(1, (edge - z) / 0.25 + 0.15);
    if (rand() > density * accept) continue;
    pts.push([x, z]);
  }
  return pts;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Трава и цветы — куски по CHUNK метров: каждый кусок отсекается по камере отдельно,
// и в отражениях, преломлении и проходах глубины рисуется только то, что в кадре.
const CHUNK = 2;
// Запас сферы под колыхание и пригибание травы, чтобы край куска не пропадал раньше времени.
const SWAY_MARGIN = 0.3;

function addChunked(group, geometry, material, items) {
  const cells = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(it);
  }
  for (const list of cells.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += SWAY_MARGIN;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

// Осколки одной комнаты — одним мешем: десятки мелких коробок не плодят отдельных вызовов отрисовки.
function mergeShards(shards, material) {
  const geos = shards.map((sh) => {
    sh.updateMatrix();
    return sh.geometry.applyMatrix4(sh.matrix);
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), material);
  geos.forEach((g) => g.dispose());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function buildMeadow(scene) {
  const rand = mulberry32(7);
  const time = { value: 0 };
  const prints = Array.from({ length: PRESS }, () => new THREE.Vector4(0, 0, -100, -100));
  const swayUniforms = { uSwayTime: time, uPress: { value: prints } };
  let nextPrint = 0;
  const lastPrint = new THREE.Vector2(1e9, 1e9);
  const group = new THREE.Group();

  // Земля под травой — там, где кафель разошёлся.
  const shape = new THREE.Shape();
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const x = MEADOW.x0 + ((MEADOW.x1 - MEADOW.x0) * i) / steps;
    const z = meadowEdge(x) + 0.05;
    if (i === 0) shape.moveTo(x, -MEADOW.z0);
    shape.lineTo(x, -z);
  }
  shape.lineTo(MEADOW.x1, -MEADOW.z0);
  const soil = new THREE.Mesh(
    new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#4b3c2b', roughness: 1 })
  );
  soil.position.y = 0.003;
  soil.receiveShadow = true;
  group.add(soil);

  // Отколотые плитки по краю.
  const shardMat = new THREE.MeshStandardMaterial({ color: '#eef1f1', roughness: 0.35 });
  const shards1 = [];
  for (let i = 0; i < 16; i++) {
    const x = MEADOW.x0 + 0.2 + rand() * (MEADOW.x1 - MEADOW.x0 - 0.4);
    const shard = new THREE.Mesh(new THREE.BoxGeometry(0.06 + rand() * 0.08, 0.012, 0.05 + rand() * 0.08), shardMat);
    shard.position.set(x, 0.008, meadowEdge(x) + 0.02 + rand() * 0.05);
    shard.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI, (rand() - 0.5) * 0.25);
    shards1.push(shard);
  }
  group.add(mergeShards(shards1, shardMat));

  // Во второй комнате пол когда-то был плиточным: в траве лежат целые плитки и обломки, кое-где кучками.
  const shards2 = [];
  for (const [cx, cz] of scatter2(28, rand, 1)) {
    const n = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const whole = rand() < 0.3;
      const w = whole ? 0.147 : 0.04 + rand() * 0.1;
      const d = whole ? 0.147 : 0.03 + rand() * 0.1;
      const shard = new THREE.Mesh(new THREE.BoxGeometry(w, 0.011, d), shardMat);
      shard.position.set(cx + (rand() - 0.5) * 0.35, 0.006 + rand() * 0.004, cz + (rand() - 0.5) * 0.35);
      shard.rotation.set((rand() - 0.5) * 0.35, rand() * Math.PI, (rand() - 0.5) * 0.35);
      shards2.push(shard);
    }
  }
  group.add(mergeShards(shards2, shardMat));

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();

  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  addSway(grassMat, swayUniforms);
  const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
  addSway(flowerMat, swayUniforms);
  const blade = bladeGeometry();
  const flowerGeo = Object.fromEntries(Object.keys(FLOWERS).map((k) => [k, FLOWERS[k]()]));

  // Полоса у окна первой комнаты и луг на весь пол второй (в ~5 раз больше по площади).
  for (const [region, scale] of [[1, 1], [2, 5]]) {
    const blades = scatter(8500 * scale, rand, 0.9, region).map(([x, z]) => {
      e.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
      q.setFromEuler(e);
      const k = 0.45 + rand() * 0.8;
      s.set(1 + rand() * 0.6, k, 1);
      const matrix = new THREE.Matrix4().compose(p.set(x, 0, z), q, s);
      tint.setHSL(0.15 + rand() * 0.12, 0.3, 0.4 + rand() * 0.2);
      return { x, z, matrix, color: tint.clone().multiplyScalar(2.0) };
    });
    addChunked(group, blade, grassMat, blades);

    const counts = { daisy: 140, buttercup: 110, forgetMeNot: 100, clover: 100, bluebell: 55 };
    for (const [kind, count] of Object.entries(counts)) {
      const pts = scatter(count * scale, rand, 0.9, region).map(([x, z]) => {
        e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
        q.setFromEuler(e);
        const k = 1.1 + rand() * 0.5;
        return { x, z, matrix: new THREE.Matrix4().compose(p.set(x, 0, z), q, s.set(k, k, k)) };
      });
      addChunked(group, flowerGeo[kind], flowerMat, pts);
    }
  }

  scene.add(group);
  return {
    // playerPos — где стоит игрок; на траве оставляем следы через каждые ~12 см.
    update(t, playerPos) {
      time.value = t;
      if (!playerPos) return;
      const cur = prints[(nextPrint + PRESS - 1) % PRESS];
      if (!nearGrass(playerPos.x, playerPos.z)) {
        // Ушли с луга — последний след начинает распрямляться.
        if (cur.w > t) cur.w = t;
        lastPrint.set(1e9, 1e9);
        return;
      }
      // Пока стоим — последний след держит траву прижатой; шагнули — он отпускает, ставим новый.
      if (lastPrint.distanceTo(new THREE.Vector2(playerPos.x, playerPos.z)) > 0.14) {
        if (cur.w > t) cur.w = t;
        prints[nextPrint].set(playerPos.x, playerPos.z, t, 1e6);
        nextPrint = (nextPrint + 1) % PRESS;
        lastPrint.set(playerPos.x, playerPos.z);
      }
    },
  };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MEADOW, meadowEdge } from './layout.js';

// Колыхание травы: чем выше точка над полом, тем сильнее её сносит.
function addSway(material, time) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayTime;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 swp = modelMatrix * mvPosition;
        float sh = max(swp.y, 0.0);
        float w = sin(uSwayTime * 1.6 + swp.x * 2.3 + swp.z * 1.1) * 0.6
                + sin(uSwayTime * 2.7 + swp.x * 4.1 - swp.z * 2.0) * 0.3;
        swp.x += w * sh * sh * 0.7;
        swp.z += w * sh * sh * 0.3;
        mvPosition = viewMatrix * swp;
        gl_Position = projectionMatrix * mvPosition;`
      );
  };
  material.customProgramCacheKey = () => 'meadow-sway';
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

function scatter(count, rand, accept) {
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

export function buildMeadow(scene) {
  const rand = mulberry32(7);
  const time = { value: 0 };
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
  for (let i = 0; i < 16; i++) {
    const x = MEADOW.x0 + 0.2 + rand() * (MEADOW.x1 - MEADOW.x0 - 0.4);
    const shard = new THREE.Mesh(new THREE.BoxGeometry(0.06 + rand() * 0.08, 0.012, 0.05 + rand() * 0.08), shardMat);
    shard.position.set(x, 0.008, meadowEdge(x) + 0.02 + rand() * 0.05);
    shard.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI, (rand() - 0.5) * 0.25);
    shard.castShadow = shard.receiveShadow = true;
    group.add(shard);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();

  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  addSway(grassMat, time);
  const blades = scatter(8500, rand, 0.9);
  const grass = new THREE.InstancedMesh(bladeGeometry(), grassMat, blades.length);
  blades.forEach(([x, z], i) => {
    e.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
    q.setFromEuler(e);
    const k = 0.45 + rand() * 0.8;
    s.set(1 + rand() * 0.6, k, 1);
    m.compose(p.set(x, 0, z), q, s);
    grass.setMatrixAt(i, m);
    tint.setHSL(0.15 + rand() * 0.12, 0.3, 0.4 + rand() * 0.2);
    grass.setColorAt(i, tint.multiplyScalar(2.0));
  });
  grass.receiveShadow = true;
  group.add(grass);

  const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
  addSway(flowerMat, time);
  const counts = { daisy: 140, buttercup: 110, forgetMeNot: 100, clover: 100, bluebell: 55 };
  for (const [kind, count] of Object.entries(counts)) {
    const pts = scatter(count, rand, 0.9);
    const mesh = new THREE.InstancedMesh(FLOWERS[kind](), flowerMat, pts.length);
    pts.forEach(([x, z], i) => {
      e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
      q.setFromEuler(e);
      const k = 1.1 + rand() * 0.5;
      m.compose(p.set(x, 0, z), q, s.set(k, k, k));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  scene.add(group);
  return {
    update(t) {
      time.value = t;
    },
  };
}

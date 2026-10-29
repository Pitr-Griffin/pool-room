import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { ROOM, WINDOW, WINDOW2, CWINDOW, CORRIDOR, LAYOUT_GLSL } from './layout.js';

// Геометрия комнаты и отражённый свет запечены в Blender (blender/bake_web.py):
// assets/room.glb и по карте освещения на каждое время суток.
export const WET_PRINTS = 16;

export const LIGHTMAP_KEYS = [
  { t: 0.06, name: 'morning', gain: 1.0 },
  { t: 0.25, name: 'day', gain: 1.0 },
  { t: 0.46, name: 'evening', gain: 0.9 },
  { t: 0.75, name: 'night', gain: 0.3 },
];

// Кафель целиком процедурный: плитка 15 см со скруглёнными краями, утопленные швы,
// глянцевая глазурь, лёгкая неравномерность цвета и грязь в швах; плюс бегущие
// отблески воды. Раскладка плитки — по UV из Blender (в метрах, непрерывна на стыках).
// Рассеянный свет берётся из двух карт освещения, смешанных по времени суток.
//
// body — водоём этой комнаты: прямоугольник (для мокрой полосы, каустики и отблесков) и его карта каустики.
export function makeTileMaterial(color, shared, lightmaps, body) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0 });
  m.lightMap = lightmaps.a.value;
  m.lightMapIntensity = 1.0;
  const f = (v) => v.toFixed(3);
  m.defines = {
    BODY_C: `vec2(${f((body.x0 + body.x1) / 2)}, ${f((body.z0 + body.z1) / 2)})`,
    BODY_H: `vec2(${f((body.x1 - body.x0) / 2)}, ${f((body.z1 - body.z0) / 2)})`,
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uLightMapB: lightmaps.b, uLmMix: lightmaps.mix, uCaustics: body.caustics });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTileWP;\nvarying vec3 vTileN;\nvarying vec2 vTileUv;'
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vTileWP = (modelMatrix * vec4(position, 1.0)).xyz;
        vTileN = normalize(mat3(modelMatrix) * normal);
        vTileUv = vec2(uv.x, 1.0 - uv.y);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTileWP;
        varying vec3 vTileN;
        varying vec2 vTileUv;
        uniform float uCTime;
        uniform vec3 uLightDir;
        uniform vec3 uLightCol;
        uniform vec3 uSkyCol;
        uniform float uWaterLit;
        uniform sampler2D uLightMapB;
        uniform float uLmMix;
        uniform sampler2D uCaustics;
        uniform vec4 uWet[${WET_PRINTS}];
        ${LAYOUT_GLSL}
        // Мокрые следы босых ног: вытянутое пятно с пальцами, сохнет ~20 с.
        float wetPrints(vec3 p) {
          float w = 0.0;
          for (int i = 0; i < ${WET_PRINTS}; i++) {
            vec4 f = uWet[i];
            if (f.w <= 0.0) continue;
            float age = uCTime - f.z;
            if (age < 0.0 || age > 22.0) continue;
            float ang = f.w - 10.0;
            vec2 d = p.xz - f.xy;
            vec2 r = vec2(cos(ang) * d.x + sin(ang) * d.y, -sin(ang) * d.x + cos(ang) * d.y);
            float sole = 1.0 - smoothstep(0.7, 1.0, length(r / vec2(0.045, 0.11)));
            float toes = 1.0 - smoothstep(0.6, 1.0, length((r - vec2(0.0, 0.12)) / vec2(0.05, 0.025)));
            w = max(w, max(sole, toes * 0.8) * (1.0 - smoothstep(6.0, 22.0, age)));
          }
          return w;
        }
        vec2 poolUv(vec3 p) {
          return vec2((p.x - (BODY_C.x - BODY_H.x)) / (2.0 * BODY_H.x), (p.z - (BODY_C.y - BODY_H.y)) / (2.0 * BODY_H.y));
        }
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
        vec2 tc = vTileUv;
        vec3 tU;
        vec3 tV;
        // Оси развёртки Blender в координатах three.js (Y вверх, z = -y Blender).
        if (tAn.y >= tAn.x && tAn.y >= tAn.z) { tU = vec3(1.0, 0.0, 0.0); tV = vec3(0.0, 0.0, -1.0); }
        else if (tAn.z >= tAn.x) { tU = vec3(1.0, 0.0, 0.0); tV = vec3(0.0, 1.0, 0.0); }
        else { tU = vec3(0.0, 0.0, -1.0); tV = vec3(0.0, 1.0, 0.0); }
        vec2 tg = tc / 0.15;
        vec2 tf = fract(tg) - 0.5;
        vec2 td = 0.5 - abs(tf);
        float tAA = max(fwidth(tg.x) + fwidth(tg.y), 0.002);
        float tGrout = 1.0 - smoothstep(0.022, 0.022 + tAA, min(td.x, td.y));
        vec2 tSlope = sign(tf) * (1.0 - smoothstep(0.022, 0.09, td)) * (1.0 - tGrout);
        float tVar = tHash(floor(tg));
        // Плитки уложены руками: каждая чуть наклонена, глазурь слегка волнистая —
        // отражения на кафеле ломаются, как на настоящей кладке.
        tSlope += (vec2(tVar, tHash(floor(tg) + 17.3)) - 0.5) * 0.05 * (1.0 - tGrout);
        tSlope += (vec2(tNoise(tc * 23.0), tNoise(tc * 23.0 + 5.1)) - 0.5) * 0.02;
        // Мокрый пол: полоса у бассейна (брызги) и следы.
        float tWet = 0.0;
        if (tAn.y > 0.5 && tWP.y > -0.01) {
          vec2 q = abs(tWP.xz - BODY_C) - BODY_H;
          float dPool = length(max(q, 0.0));
          tWet = (1.0 - smoothstep(0.05, 0.55, dPool)) * smoothstep(0.35, 0.65, tNoise(tc * 2.5));
          tWet = max(tWet, wetPrints(tWP));
        }
        vec3 tileCol = vec3(0.955, 0.972, 0.978) * (0.97 + 0.045 * tVar);
        bool tVertical = tAn.y < 0.5;
        if (tVertical && tWP.y > 1.05 && tWP.y < 1.2) tileCol = vec3(0.66, 0.84, 0.86) * (0.97 + 0.05 * tVar);
        if (tVertical && tWP.y < -0.005 && tWP.y > -0.155) tileCol = vec3(0.2, 0.42, 0.56) * (0.95 + 0.08 * tVar);
        float tGrime = tNoise(tc * 1.3) * 0.6 + tNoise(tc * 7.0) * 0.4;
        vec3 groutCol = vec3(0.74, 0.76, 0.75) * (0.88 + 0.2 * tGrime);
        diffuseColor.rgb *= mix(tileCol * (1.0 - tGrime * 0.03), groutCol, tGrout);
        diffuseColor.rgb *= 1.0 - tWet * mix(0.06, 0.35, tGrout);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.08 + tGrime * 0.08, 0.85, tGrout);
        roughnessFactor = mix(roughnessFactor, 0.03, tWet);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal + mat3(viewMatrix) * (tU * tSlope.x + tV * tSlope.y) * 0.45);`
      )
      // Рассеянный свет — только из запечённых карт (смесь двух времён суток),
      // окружение даёт лишь блики.
      .replace(
        'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',
        'vec4 lightMapTexel = mix( texture2D( lightMap, vLightMapUv ), texture2D( uLightMapB, vLightMapUv ), uLmMix );'
      )
      .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 add = vec3(0.0);
          if (tWP.y < -0.03) {
            // Каустика от смоделированных волн: свет, сфокусированный поверхностью воды.
            vec4 cs = texture2D(uCaustics, poolUv(tWP));
            float c = clamp(cs.r - cs.g, -0.85, 5.0);
            add = uLightCol * c * 0.32 + uSkyCol * 0.08 * caustic(tc * 0.45, uCTime * 0.35);
          } else if (normalize(vTileN).y < 0.5) {
            // Отблески от воды на потолке и стенах повторяют узор настоящих волн.
            vec2 q = abs(tWP.xz - BODY_C) - BODY_H;
            float m = exp(-length(max(q, 0.0)) * 1.1);
            if (tVertical) m *= smoothstep(0.2, 2.8, tWP.y) * 0.8;
            vec2 puv = clamp(poolUv(tWP) * 0.9 + 0.05, 0.0, 1.0);
            vec4 cs = texture2D(uCaustics, puv);
            float c = clamp(cs.r - cs.g, 0.0, 4.0);
            add = m * (uLightCol * uWaterLit * c * 0.06 + uSkyCol * 0.04 * caustic(tc * 0.3, uCTime * 0.25));
          }
          outgoingLight += diffuseColor.rgb * add * (1.0 - tGrout);
        }
        #include <opaque_fragment>`
      );
  };
  m.customProgramCacheKey = () => `pool-tile-baked-${m.defines.BODY_C}`;
  return m;
}

function box(x0, x1, y0, y1, z0, z1, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Рама с переплётом; zc — середина толщины стены, в которой стоит окно.
function buildWindowFrame(group, frame, W, zc) {
  const fz0 = zc - 0.04;
  const fz1 = zc + 0.04;
  const fw = 0.07;
  const mw = 0.04;
  group.add(box(W.x0, W.x1, W.y0, W.y0 + fw, fz0, fz1, frame));
  group.add(box(W.x0, W.x1, W.y1 - fw, W.y1, fz0, fz1, frame));
  group.add(box(W.x0, W.x0 + fw, W.y0, W.y1, fz0, fz1, frame));
  group.add(box(W.x1 - fw, W.x1, W.y0, W.y1, fz0, fz1, frame));
  const ww = W.x1 - W.x0;
  for (let i = 1; i < W.panes; i++) {
    const x = W.x0 + (ww * i) / W.panes;
    group.add(box(x - mw / 2, x + mw / 2, W.y0, W.y1, fz0, fz1, frame));
  }
  const ym = W.y0 + (W.y1 - W.y0) * 0.62;
  group.add(box(W.x0, W.x1, ym - mw / 2, ym + mw / 2, fz0, fz1, frame));
}

async function loadLightmaps(exr, prefix, onEach) {
  const maps = {};
  await Promise.all(
    LIGHTMAP_KEYS.map(async ({ name }) => {
      const tex = await exr.loadAsync(`./assets/lightmap_${prefix}${name}.exr`);
      tex.channel = 1;
      tex.flipY = false;
      // glTF переворачивает V, а EXR из Blender лежит снизу вверх.
      tex.repeat.set(1, -1);
      tex.offset.set(0, 1);
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      maps[name] = tex;
      onEach();
    })
  );
  return maps;
}

// bodies — водоёмы первой и второй комнаты: { room1, room2 }, у каждого прямоугольник и
// uniform-ссылка caustics (текстуру подставит вода, когда будет создана).
export async function buildRoom(scene, shared, bodies, onProgress = () => {}) {
  const exr = new EXRLoader();
  let loaded = 0;
  const total = LIGHTMAP_KEYS.length * 2 + 1;
  const tick = () => onProgress(++loaded / total);
  const [maps1, maps2, gltf] = await Promise.all([
    loadLightmaps(exr, '', tick),
    loadLightmaps(exr, '2_', tick),
    new GLTFLoader().loadAsync('./assets/room.glb'),
  ]);
  onProgress(1);

  // Первая комната и коридор со второй комнатой запечены в разные карты.
  const rooms = [
    { maps: maps1, body: bodies.room1 },
    { maps: maps2, body: bodies.room2 },
  ];
  for (const r of rooms) {
    r.lightmaps = { a: { value: r.maps.day }, b: { value: r.maps.day }, mix: { value: 0 } };
    r.mats = {
      Tile: makeTileMaterial(new THREE.Color('#ffffff'), shared, r.lightmaps, r.body),
      PoolTile: makeTileMaterial(new THREE.Color('#d3f1f2'), shared, r.lightmaps, r.body),
    };
  }
  // Земля под лугом второй комнаты — такая же, как под полосой цветов в первой.
  const soil = new THREE.MeshStandardMaterial({ color: '#4b3c2b', roughness: 1 });

  const group = new THREE.Group();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    // Объект второй комнаты (с коридором) целиком лежит восточнее первой.
    o.geometry.computeBoundingBox();
    const r = o.geometry.boundingBox.max.x > ROOM.x1 + ROOM.wall + 0.5 ? rooms[1] : rooms[0];
    o.material = o.material.name === 'Soil' ? soil : r.mats[o.material.name] ?? r.mats.Tile;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  group.add(gltf.scene);

  const frame = new THREE.MeshStandardMaterial({ color: '#f3f3ee', roughness: 0.4 });
  const roomZ = ROOM.z0 - ROOM.wall / 2;
  buildWindowFrame(group, frame, WINDOW, roomZ);
  buildWindowFrame(group, frame, WINDOW2, roomZ);
  buildWindowFrame(group, frame, CWINDOW, CORRIDOR.z0 - ROOM.wall / 2);
  scene.add(group);

  const all = rooms.flatMap((r) => Object.values(r.mats));

  // t — время суток 0..1; выбирает две ближайшие карты освещения и долю смешивания.
  function setTime(t) {
    const keys = LIGHTMAP_KEYS;
    let i = keys.length - 1;
    for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) i = k;
    const a = keys[i];
    const b = keys[(i + 1) % keys.length];
    const span = (b.t - a.t + 1) % 1 || 1;
    let f = ((t - a.t + 1) % 1) / span;
    f = f * f * (3 - 2 * f);
    for (const r of rooms) {
      for (const m of Object.values(r.mats)) {
        m.lightMap = r.maps[a.name];
        m.lightMapIntensity = a.gain + (b.gain - a.gain) * f;
      }
      r.lightmaps.b.value = r.maps[b.name];
      r.lightmaps.mix.value = f;
    }
  }

  return { room1: rooms[0].mats, room2: rooms[1].mats, soil, all, frame, setTime };
}

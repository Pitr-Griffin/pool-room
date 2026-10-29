import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

import { POOL, WINDOW, WINDOW2, CWINDOW, CORRIDOR, ROOM, ROOM2, inPool, inShallow, beamFactor } from './layout.js';
import { DayCycle } from './daycycle.js';
import { createSky } from './sky.js';
import { buildRoom, WET_PRINTS } from './room.js';
import { Water, POOL_BODY, SHALLOW_BODY } from './water.js';
import { buildMeadow } from './meadow.js';
import { Ball } from './ball.js';
import { Player } from './player.js';
import { SoundScape } from './audio.js';
import { createDust, createFireflies, createSplash, GradeShader, UnderwaterShader, VolumetricShader, updateVolumetric } from './effects.js';
import { useSeed, seeded } from './random.js';
import { DURATION, FPS, dayT, cameraAt, cameraSpeed, EVENTS, DRIPS } from '../video/shot.js';

// Видео-режим (?video=1): кадры рендерятся по одному по команде снаружи (video/render.mjs),
// время и камера берутся из сценария пролёта, интерфейса и звука нет.
const VIDEO = new URLSearchParams(location.search).has('video');
// Шум GTAO и прочие случайности внутри three.js тоже берутся из Math.random — подменяем целиком.
if (VIDEO) {
  useSeed(1);
  Math.random = seeded(2);
}

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: VIDEO });
const pixelRatio = VIDEO ? 1 : Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);

RectAreaLightUniformsLib.init();

// Общие для кафеля и воды параметры света.
const shared = {
  uCTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightCol: { value: new THREE.Color() },
  uSkyCol: { value: new THREE.Color() },
  uWaterLit: { value: 0 },
  uWet: { value: Array.from({ length: WET_PRINTS }, () => new THREE.Vector4(0, 0, -100, 0)) },
};
// Мокрые следы после выхода из бассейна.
let wetFeet = 0;
let wetNext = 0;
let wetSide = 1;
function addWetPrint(pos, vel, t) {
  const sp = Math.hypot(vel.x, vel.z);
  if (sp < 0.05) return;
  const dx = vel.x / sp;
  const dz = vel.z / sp;
  wetSide = -wetSide;
  const x = pos.x - dz * 0.1 * wetSide;
  const z = pos.z + dx * 0.1 * wetSide;
  shared.uWet.value[wetNext].set(x, z, t, Math.atan2(-dx, dz) + 10);
  wetNext = (wetNext + 1) % WET_PRINTS;
}

const day = new DayCycle(120);
const sky = createSky(camera, { video: VIDEO });
scene.add(sky.mesh);
// Окно коридора смотрит прямо в небо — внешние стены комнат за ним не видны.
const corridorSky = sky.portal(CWINDOW.x1 - CWINDOW.x0, CWINDOW.y1 - CWINDOW.y0);
corridorSky.position.set((CWINDOW.x0 + CWINDOW.x1) / 2, (CWINDOW.y0 + CWINDOW.y1) / 2, CORRIDOR.z0 - ROOM.wall / 2 - 0.045);
scene.add(corridorSky);
const enterBtn = document.getElementById('enter');
enterBtn.disabled = true;
// Водоёмы: глубокий бассейн первой комнаты и вода по щиколотку в коридоре и второй комнате.
const bodies = {
  room1: { ...POOL_BODY, caustics: { value: null } },
  room2: { ...SHALLOW_BODY, caustics: { value: null } },
};
const mats = await buildRoom(scene, shared, bodies, (p) => {
  enterBtn.textContent = p < 1 ? `Загрузка ${Math.round(p * 100)}%` : 'Войти';
});
enterBtn.disabled = false;
// Кадр сцены без воды — общий для преломления в обоих водоёмах.
const refractTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
function resizeRefraction() {
  const pr = renderer.getPixelRatio();
  refractTarget.setSize(Math.floor(innerWidth * pr * 0.6), Math.floor(innerHeight * pr * 0.6));
}
resizeRefraction();
const water = new Water(renderer, shared, POOL_BODY, refractTarget);
const shallowWater = new Water(renderer, shared, SHALLOW_BODY, refractTarget);
const waters = [water, shallowWater];
bodies.room1.caustics.value = water.causticsTexture;
bodies.room2.caustics.value = shallowWater.causticsTexture;
for (const w of waters) scene.add(w.mesh);
// Вода под ногами: глубокий бассейн, мелкая вода или null.
function waterAt(x, z) {
  if (inPool(x, z)) return water;
  return inShallow(x, z) ? shallowWater : null;
}
function renderRefraction() {
  for (const w of waters) w.mesh.visible = false;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(refractTarget);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(prev);
  for (const w of waters) w.mesh.visible = true;
}
const splash = createSplash();
scene.add(splash.points);
const meadow = buildMeadow(scene);
const ball = new Ball();
scene.add(ball.mesh);
const dust = createDust();
scene.add(dust.points);
const fireflies = createFireflies();
scene.add(fireflies.points);
const player = new Player(camera, canvas);
const sound = new SoundScape();

// Отражения и отражённый свет берутся из самой комнаты: кубическая карта
// периодически снимается из её центра. Так белый кафель подсвечивает сам себя,
// а солнечное пятно на полу подсвечивает потолок — дешёвое подобие GI.
// У каждой комнаты своя карта — снимается из её центра.
const envProbes = [
  // Трава — тоже: без отражённого света на рассвете и в тени она становится чёрным силуэтом.
  { at: [0.2, 1.4, 0], mats: [mats.room1.Tile, mats.room1.PoolTile, mats.frame, ball.mesh.material, ...meadow.materials] },
  { at: [ROOM2.x0 + 4.2, 1.4, 0], mats: [mats.room2.Tile, mats.room2.PoolTile] },
].map(({ at, mats: list }) => {
  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.05, 100, target);
  cam.position.set(...at);
  scene.add(cam);
  for (const m of list) {
    m.envMap = target.texture;
    m.envMapIntensity = m === ball.mesh.material ? 0.7 : 0.6;
  }
  return { cam, target, mats: list };
});
// В видео кафель подсвечивает сам себя за фиксированное число отскоков с нуля в каждом кадре,
// а не копит свет от кадра к кадру: иначе кадр зависел бы от того, что рисовалось до него.
const VIDEO_BOUNCES = 3;
const cubeTarget = envProbes[0].target;
splash.mesh.material.envMap = cubeTarget.texture;
let cubeFrame = 0;
let probeNext = 0;
function captureEnvironment() {
  for (const w of waters) w.capturing = true;
  // В видео вода в карты не попадает: её отражение и преломление остались бы от прошлого кадра,
  // и кадр зависел бы от всей истории отрисовки, а не только от своего номера.
  if (VIDEO) for (const w of waters) w.mesh.visible = false;
  dust.points.visible = false;
  fireflies.points.visible = false;
  splash.points.visible = false;
  // Карты комнат обновляются по очереди — вдвое меньше работы за кадр.
  // В видео — обе сразу: кадр не должен зависеть от того, сколько кадров было отрисовано до него.
  const probes = VIDEO ? envProbes : [envProbes[probeNext]];
  probeNext = (probeNext + 1) % envProbes.length;
  const bounces = VIDEO ? VIDEO_BOUNCES : 1;
  for (let b = 0; b < bounces; b++) {
    // Первый отскок в видео — без отражений вовсе.
    const saved = VIDEO && b === 0 ? probes.flatMap((p) => p.mats.map((m) => [m, m.envMapIntensity])) : [];
    for (const [m] of saved) m.envMapIntensity = 0;
    for (const probe of probes) {
      probe.cam.update(renderer, scene);
      probe.target.texture.needsPMREMUpdate = true;
    }
    for (const [m, v] of saved) m.envMapIntensity = v;
  }
  for (const w of waters) {
    w.capturing = false;
    w.mesh.visible = true;
  }
  dust.points.visible = true;
  fireflies.points.visible = true;
  splash.points.visible = true;
}

// Свет: солнце/луна через окно и мягкий свет неба из окна.
// Тени накрывают обе комнаты и коридор: центр между ними, охват ±12 м.
const sunTarget = new THREE.Object3D();
sunTarget.position.set((ROOM.x0 + ROOM2.x1) / 2, 0, 0);
scene.add(sunTarget);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.target = sunTarget;
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.015;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
scene.add(hemi);

// Мягкий свет неба из окон: обеих комнат и коридора.
const windowLights = [
  [WINDOW, ROOM.z0],
  [WINDOW2, ROOM.z0],
  [CWINDOW, CORRIDOR.z0],
].map(([W, z]) => {
  const c = new THREE.Vector3((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, z);
  const light = new THREE.RectAreaLight(0xffffff, 1, W.x1 - W.x0, W.y1 - W.y0);
  light.position.copy(c).setZ(z + 0.01);
  light.lookAt(c.x, c.y, z + 5);
  scene.add(light);
  return light;
});

// Постобработка: MSAA → затенение в углах (GTAO) → свечение → тонмаппинг → «плёнка».
const rt = new THREE.WebGLRenderTarget(innerWidth * pixelRatio, innerHeight * pixelRatio, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 16 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
const volumetric = new ShaderPass(VolumetricShader);
volumetric.uniforms.tDepth.value = gtao.depthTexture;
composer.addPass(volumetric);
const underwater = new ShaderPass(UnderwaterShader);
underwater.uniforms.tDepth.value = gtao.depthTexture;
composer.addPass(underwater);
// Порог выше белого кафеля: светятся только окно, солнечные пятна и блики, без молочной пелены.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.45, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass(GradeShader);
grade.uniforms.uRes.value.set(innerWidth, innerHeight);
composer.addPass(grade);

// Насколько вода сейчас в солнечном пятне — от этого зависят отблески на потолке.
const waterSamples = [];
for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 4; j++) {
    waterSamples.push(new THREE.Vector3(
      POOL.x0 + ((i + 0.5) / 5) * (POOL.x1 - POOL.x0),
      POOL.water,
      POOL.z0 + ((j + 0.5) / 4) * (POOL.z1 - POOL.z0)
    ));
  }
}
let waterLit = 0;

const white = new THREE.Color(1, 1, 1);
const ambient = new THREE.Color();

function applyLighting(time) {
  const s = day.s;
  sun.color.copy(s.light);
  sun.intensity = s.lightInt * 2;
  sun.position.copy(sunTarget.position).addScaledVector(s.lightDir, 20);

  hemi.color.copy(s.hor).lerp(s.amb, 0.5);
  hemi.groundColor.copy(s.amb).multiplyScalar(0.8);
  hemi.intensity = s.ai * 0.1;
  mats.setTime(day.t);

  for (const light of windowLights) {
    light.color.copy(s.hor).lerp(white, 0.35);
    light.intensity = s.ai * 1.6;
  }

  const ld = s.lightDir;
  let lit = 0;
  for (const p of waterSamples) lit += beamFactor(p, ld);
  waterLit += (lit / waterSamples.length - waterLit) * 0.05;

  shared.uLightDir.value.copy(ld);
  shared.uLightCol.value.copy(s.light).multiplyScalar(s.lightInt);
  shared.uSkyCol.value.copy(s.amb).multiplyScalar(s.ai);
  shared.uWaterLit.value = waterLit;

  dust.update(ld, s.light, s.lightInt, time);
  fireflies.update(s.night, time);
  return ambient.copy(s.amb).multiplyScalar(s.ai);
}

// --- Интерфейс ---
const intro = document.getElementById('intro');
const resume = document.getElementById('resume');
const panel = document.getElementById('panel');
const playBtn = document.getElementById('play');
const slider = document.getElementById('time');
const phaseEl = document.getElementById('phase');
const clockEl = document.getElementById('clock');
const soundBtn = document.getElementById('sound');
let entered = false;
let dragging = false;

function enter() {
  entered = true;
  intro.classList.add('hidden');
  sound.start();
  player.controls.lock();
}
enterBtn.addEventListener('click', enter);

canvas.addEventListener('mousedown', () => {
  if (!entered) return;
  if (!player.locked) {
    player.controls.lock();
    return;
  }
  // Пинок по клику: только если смотрим на мяч и он рядом.
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = ray.intersectObject(ball.mesh)[0];
  if (hit && hit.distance < 3.2) {
    ball.kick(ray.ray.direction);
    sound.thump(1);
  }
});

player.controls.addEventListener('lock', () => {
  resume.classList.add('hidden');
  document.body.classList.add('locked');
});
player.controls.addEventListener('unlock', () => {
  if (entered) resume.classList.remove('hidden');
  document.body.classList.remove('locked');
});

function setPaused(p) {
  day.paused = p;
  playBtn.textContent = p ? '▶  Запустить время' : '❚❚  Остановить время';
  playBtn.classList.toggle('stopped', p);
}
playBtn.addEventListener('click', () => setPaused(!day.paused));
slider.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
slider.addEventListener('input', () => {
  day.t = slider.value / 1000;
  cubeFrame = 0;
});
soundBtn.addEventListener('click', () => {
  soundBtn.textContent = sound.toggleMute() ? 'Звук выкл.' : 'Звук вкл.';
});

// Качество: на слабых машинах отключаем затенение углов и объёмный свет.
const qualityBtn = document.getElementById('quality');
let highQuality = true;
function setQuality(high) {
  highQuality = high;
  gtao.enabled = high;
  volumetric.enabled = high;
  const pr = high ? pixelRatio : 1;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  resizeRefraction();
  qualityBtn.textContent = high ? 'Высокое' : 'Быстрое';
}
qualityBtn.addEventListener('click', () => setQuality(!highQuality));

addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') panel.classList.toggle('hidden');
  if (e.code === 'KeyQ') setQuality(!highQuality);
  if (e.code === 'KeyP') setPaused(!day.paused);
  if (e.code === 'KeyM') soundBtn.click();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  gtao.setSize(innerWidth, innerHeight);
  resizeRefraction();
  grade.uniforms.uRes.value.set(innerWidth, innerHeight);
});

// --- Цикл ---
const clock = new THREE.Clock();
let time = 0;
const fx = {
  time: 0,
  thump: (s) => sound.thump(s),
  splash: (s) => sound.splash(s),
  ripple: (x, z, a) => {
    water.ripple(x, z, a, 0.2);
    if (a > 1) splash.burst(x, POOL.water, z, Math.round(a * 40), 1.6);
  },
};
const res = new THREE.Vector2();
let idleRipple = 0;

// Шаг мира: свет, вода, трава, мяч. Игрок и звук — только в интерактиве.
function step(dt) {
  time += dt;
  fx.time = time;

  day.update(dt);
  const amb = applyLighting(time);
  sky.update(day.s, time);
  shared.uCTime.value = time;

  if (VIDEO) {
    res.set(renderer.domElement.width, renderer.domElement.height);
    for (const w of waters) w.update(time, amb, day.s.lightDir, res);
    meadow.update(time, null);
    splash.update(dt, (x, z, r) => waterAt(x, z)?.ripple(x, z, r * 50, 0.05), camera.position);
    ball.update(dt, player, fx);
    return;
  }

  const prevPos = player.pos.clone();
  const events = player.update(dt);
  const { x: px, z: pz } = player.pos;
  // Вода, в которую вошли (или из которой вышли — по прошлой позиции).
  const here = waterAt(px, pz) ?? waterAt(prevPos.x, prevPos.z);
  const deep = here === water;
  for (const ev of events) {
    if (!here && (ev === 'enter' || ev === 'exit' || ev === 'water')) continue;
    if (ev === 'enter') {
      sound.splash(deep ? 0.8 : 0.45);
      here.ripple(px, pz, deep ? 3 : 1.6, 0.35);
      splash.burst(px, here.body.level, pz, deep ? 180 : 80, deep ? 2.4 : 1.5);
    } else if (ev === 'exit') {
      wetFeet = 12;
      here.ripple(px, pz, 0.8, 0.25);
      splash.burst(px, here.body.level, pz, 30, 1.1);
    } else if (ev === 'water') {
      sound.step('water');
      here.ripple(px, pz, deep ? 1.1 : 0.9, 0.22);
      splash.burst(px, here.body.level, pz, deep ? 30 : 24, deep ? 1.3 : 1.05);
    } else if (ev === 'tile' || ev === 'grass') {
      sound.step(ev);
      if (ev === 'tile' && wetFeet > 0) addWetPrint(player.pos, player.vel, time);
    }
  }
  wetFeet -= dt;
  // Волна от ног, пока идёшь по воде, и лёгкое покачивание, когда стоишь.
  const under = waterAt(px, pz);
  if (under) {
    const sp = Math.hypot(player.vel.x, player.vel.z);
    if (sp > 0.1) under.ripple(px, pz, sp * 0.04, 0.24);
    idleRipple -= dt;
    if (idleRipple < 0) {
      under.ripple(px, pz, 0.25, 0.25);
      idleRipple = 1.4;
    }
  }
  res.set(renderer.domElement.width, renderer.domElement.height);
  for (const w of waters) w.update(time, amb, day.s.lightDir, res);
  meadow.update(time, player.pos);
  // Упавшая капля оставляет на воде маленький круг.
  splash.update(dt, (x, z, r) => waterAt(x, z)?.ripple(x, z, r * 50, 0.05), camera.position);
  ball.update(dt, player, fx);
  sound.update(dt, day.s.day, day.s.night);

  if (!dragging) slider.value = Math.round(day.t * 1000);
  phaseEl.textContent = day.phase;
  clockEl.textContent = day.clock;
}

// Камера под гладью бассейна: включаем толщу воды. Переход — за пару сантиметров высоты
// (на всплытии это 1–2 кадра), и пока камера у самой глади, ближняя плоскость
// придвинута, чтобы поверхность не резала кадр пополам.
function updateUnderwater() {
  const c = camera.position;
  const inside = inPool(c.x, c.z);
  const below = inside ? THREE.MathUtils.smoothstep(POOL.water - c.y, -0.004, 0.02) : 0;
  const near = inside && Math.abs(c.y - POOL.water) < 0.12 ? 0.01 : 0.05;
  if (camera.near !== near) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  const u = underwater.uniforms;
  u.uUnder.value = below;
  u.uTime.value = time;
  u.uInvProj.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamY.value = c.y;
  u.uLevel.value = POOL.water;
  u.uWater.value.copy(day.s.amb).multiplyScalar(day.s.ai * 0.6 + 0.35).multiply(UNDERWATER_TINT);
}
const UNDERWATER_TINT = new THREE.Color(0.12, 0.42, 0.45);

function draw() {
  if (cubeFrame-- <= 0) {
    captureEnvironment();
    cubeFrame = VIDEO ? 0 : 15;
  }
  grade.uniforms.uTime.value = time;
  camera.updateMatrixWorld();
  updateVolumetric(volumetric, camera, day.s.lightDir, day.s.light, day.s.lightInt, time);
  updateUnderwater();

  renderRefraction();
  composer.render();
}

function frame() {
  step(Math.min(clock.getDelta(), 0.05));
  draw();
  requestAnimationFrame(frame);
}

// --- Видео-режим ---
// Кадр i — мир после i шагов по 1/FPS. Камера и время суток ставятся из сценария перед каждым шагом,
// события сценария (всплытие) срабатывают в шаге, на который приходятся.
let simulated = -1;
function placeCamera(t) {
  const c = cameraAt(t);
  camera.position.set(...c.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(...c.target);
  camera.rotateZ(c.roll);
  if (camera.fov !== c.fov) {
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
  }
}
function videoStep(k) {
  const t0 = (k - 1) / FPS;
  const t1 = k / FPS;
  for (const ev of [...EVENTS, ...DRIPS]) {
    if (ev.t < t0 || ev.t >= t1) continue;
    const [x, , z] = ev.at;
    if (ev.kind === 'breach') {
      water.ripple(x, z, 3, 0.35);
      splash.burst(x, POOL.water, z, 110, 2.4);
    } else if (ev.kind === 'drip') {
      // Капля с потолка: маленькая корона и круги по воде.
      shallowWater.ripple(x, z, 1.4, 0.04);
      splash.burst(x, SHALLOW_BODY.level, z, 7, 0.55);
    } else if (ev.kind === 'impact') {
      // Камера бьётся о кромку у самой воды — плеск в мелкий бассейн.
      shallowWater.ripple(x - 0.12, z, 2.2, 0.22);
      splash.burst(x - 0.12, SHALLOW_BODY.level, z, 45, 1.25);
    }
  }
  day.t = dayT(t1);
  placeCamera(t1);
  step(k === 0 ? 0 : 1 / FPS);
}
// Размытие движения: когда камера быстро движется или вертится (падение), кадр — среднее
// нескольких подкадров внутри «выдержки» в полкадра. Мир в подкадрах не меняется, только камера.
const blurCanvas = document.createElement('canvas');
let output = canvas;
function subframes(t) {
  const speed = cameraSpeed(t);
  return speed < 0.03 ? 1 : Math.min(16, Math.ceil(speed / 0.012));
}
function renderFrame(i) {
  // Вода, брызги и трава зависят от истории: кадры идут только вперёд, пропущенные досчитываются.
  // Чтобы начать заново или с более раннего кадра — перезагрузить страницу.
  if (i <= simulated) throw new Error(`renderFrame(${i}): already at frame ${simulated}, reload the page`);
  while (simulated < i) videoStep(++simulated);
  const t = i / FPS;
  const n = subframes(t);
  cubeFrame = 0;
  if (n === 1) {
    draw();
    output = canvas;
    return;
  }
  blurCanvas.width = canvas.width;
  blurCanvas.height = canvas.height;
  const ctx2d = blurCanvas.getContext('2d');
  for (let s = 0; s < n; s++) {
    placeCamera(t + (s / n) * (0.5 / FPS));
    // Карты отражений не зависят от камеры — снимаются один раз на кадр.
    if (s > 0) cubeFrame = 1;
    draw();
    ctx2d.globalAlpha = 1 / (s + 1);
    ctx2d.drawImage(canvas, 0, 0);
  }
  placeCamera(t);
  output = blurCanvas;
}

if (VIDEO) {
  day.paused = true;
  for (const id of ['intro', 'panel', 'crosshair', 'resume']) document.getElementById(id).style.display = 'none';
  window.poolRoomVideo = { ready: Promise.resolve(), renderFrame, frameCount: Math.round(DURATION * FPS), output: () => output };
} else {
  requestAnimationFrame(frame);
}

// Для отладки из консоли.
window.poolRoom = { day, player, ball, camera, renderer, composer, gtao, bloom, scene, cubeTarget, water, shallowWater, splash };

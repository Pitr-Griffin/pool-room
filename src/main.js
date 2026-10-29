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
import { createDust, createFireflies, createSplash, GradeShader, VolumetricShader, updateVolumetric } from './effects.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(devicePixelRatio, 1.5);
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
const sky = createSky();
scene.add(sky.mesh);
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
  { at: [0.2, 1.4, 0], mats: [mats.room1.Tile, mats.room1.PoolTile, mats.room1.Soil, mats.frame, ball.mesh.material] },
  { at: [ROOM2.x0 + 4.2, 1.4, 0], mats: [mats.room2.Tile, mats.room2.PoolTile, mats.room2.Soil] },
].map(({ at, mats: list }) => {
  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.05, 100, target);
  cam.position.set(...at);
  scene.add(cam);
  for (const m of list) {
    m.envMap = target.texture;
    m.envMapIntensity = m === ball.mesh.material ? 0.7 : 0.6;
  }
  return { cam, target };
});
const cubeTarget = envProbes[0].target;
let cubeFrame = 0;
let probeNext = 0;
function captureEnvironment() {
  for (const w of waters) w.capturing = true;
  dust.points.visible = false;
  fireflies.points.visible = false;
  splash.points.visible = false;
  // Карты комнат обновляются по очереди — вдвое меньше работы за кадр.
  const probe = envProbes[probeNext];
  probeNext = (probeNext + 1) % envProbes.length;
  probe.cam.update(renderer, scene);
  probe.target.texture.needsPMREMUpdate = true;
  for (const w of waters) w.capturing = false;
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
    if (a > 1) splash.burst(x, POOL.water, z, Math.round(a * 14), 1.6);
  },
};
const res = new THREE.Vector2();
let idleRipple = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  fx.time = time;

  day.update(dt);
  const amb = applyLighting(time);
  sky.update(day.s, time);
  shared.uCTime.value = time;

  const prevPos = player.pos.clone();
  const events = player.update(dt);
  const { x: px, z: pz } = player.pos;
  // Вода, в которую вошли (или из которой вышли — по прошлой позиции).
  const here = waterAt(px, pz) ?? waterAt(prevPos.x, prevPos.z);
  const deep = here === water;
  for (const ev of events) {
    if (ev === 'enter') {
      sound.splash(deep ? 0.8 : 0.45);
      here.ripple(px, pz, deep ? 3 : 1.6, 0.35);
      splash.burst(px, here.body.level, pz, deep ? 70 : 30, deep ? 2.4 : 1.5);
    } else if (ev === 'exit') {
      wetFeet = 12;
      here.ripple(px, pz, 0.8, 0.25);
      splash.burst(px, here.body.level, pz, 15, 1.2);
    } else if (ev === 'water') {
      sound.step('water');
      here.ripple(px, pz, deep ? 1.1 : 0.9, 0.22);
      splash.burst(px, here.body.level, pz, deep ? 10 : 8, deep ? 1.4 : 1.1);
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
    if (sp > 0.1) under.ripple(px, pz, sp * 0.09, 0.2);
    idleRipple -= dt;
    if (idleRipple < 0) {
      under.ripple(px, pz, 0.25, 0.25);
      idleRipple = 1.4;
    }
  }
  res.set(renderer.domElement.width, renderer.domElement.height);
  for (const w of waters) w.update(time, amb, day.s.lightDir, res);
  meadow.update(time, player.pos);
  splash.update(dt);
  ball.update(dt, player, fx);
  sound.update(dt, day.s.day, day.s.night);

  if (cubeFrame-- <= 0) {
    captureEnvironment();
    cubeFrame = 15;
  }

  if (!dragging) slider.value = Math.round(day.t * 1000);
  phaseEl.textContent = day.phase;
  clockEl.textContent = day.clock;
  grade.uniforms.uTime.value = time;
  camera.updateMatrixWorld();
  updateVolumetric(volumetric, camera, day.s.lightDir, day.s.light, day.s.lightInt, time);

  renderRefraction();
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Для отладки из консоли.
window.poolRoom = { day, player, ball, camera, renderer, composer, gtao, bloom, scene, cubeTarget, water, shallowWater, splash };

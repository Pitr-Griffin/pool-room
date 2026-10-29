import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

import { POOL, WINDOW, ROOM, beamFactor } from './layout.js';
import { DayCycle } from './daycycle.js';
import { createSky } from './sky.js';
import { buildRoom, WET_PRINTS } from './room.js';
import { Water } from './water.js';
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
  uCaustics: { value: null },
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
const mats = await buildRoom(scene, shared, (p) => {
  enterBtn.textContent = p < 1 ? `Загрузка ${Math.round(p * 100)}%` : 'Войти';
});
enterBtn.disabled = false;
const water = new Water(renderer, shared);
shared.uCaustics.value = water.causticsTexture;
scene.add(water.mesh);
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
const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
const cubeCamera = new THREE.CubeCamera(0.05, 100, cubeTarget);
cubeCamera.position.set(0.2, 1.4, 0);
scene.add(cubeCamera);
const envMats = [
  [mats.tile, 0.6],
  [mats.poolTile, 0.6],
  [mats.frame, 0.6],
  [ball.mesh.material, 0.7],
];
for (const [m, k] of envMats) {
  m.envMap = cubeTarget.texture;
  m.envMapIntensity = k;
}
let cubeFrame = 0;
function captureEnvironment() {
  water.capturing = true;
  dust.points.visible = false;
  fireflies.points.visible = false;
  splash.points.visible = false;
  cubeCamera.update(renderer, scene);
  cubeTarget.texture.needsPMREMUpdate = true;
  water.capturing = false;
  dust.points.visible = true;
  fireflies.points.visible = true;
  splash.points.visible = true;
}

// Свет: солнце/луна через окно и мягкий свет неба из окна.
const sunTarget = new THREE.Object3D();
sunTarget.position.set(0, 0, -1);
scene.add(sunTarget);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.target = sunTarget;
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 45 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.015;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
scene.add(hemi);

const winW = WINDOW.x1 - WINDOW.x0;
const winH = WINDOW.y1 - WINDOW.y0;
const winCenter = new THREE.Vector3((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, ROOM.z0);
const windowLight = new THREE.RectAreaLight(0xffffff, 1, winW, winH);
windowLight.position.copy(winCenter).setZ(ROOM.z0 + 0.01);
windowLight.lookAt(winCenter.x, winCenter.y, 0);
scene.add(windowLight);

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

  windowLight.color.copy(s.hor).lerp(white, 0.35);
  windowLight.intensity = s.ai * 1.6;

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
  water.resize();
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
  water.resize();
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
let idleRipple = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  fx.time = time;

  day.update(dt);
  const amb = applyLighting(time);
  sky.update(day.s, time);
  shared.uCTime.value = time;

  const events = player.update(dt);
  for (const ev of events) {
    if (ev === 'enter') {
      sound.splash(0.8);
      water.ripple(player.pos.x, player.pos.z, 3, 0.35);
      splash.burst(player.pos.x, POOL.water, player.pos.z, 70, 2.4);
    } else if (ev === 'exit') {
      wetFeet = 12;
      water.ripple(player.pos.x, player.pos.z, 0.8, 0.25);
      splash.burst(player.pos.x, POOL.water, player.pos.z, 15, 1.2);
    } else if (ev === 'water') {
      sound.step('water');
      water.ripple(player.pos.x, player.pos.z, 1.1, 0.22);
      splash.burst(player.pos.x, POOL.water, player.pos.z, 10, 1.4);
    } else if (ev === 'tile' || ev === 'grass') {
      sound.step(ev);
      if (ev === 'tile' && wetFeet > 0) addWetPrint(player.pos, player.vel, time);
    }
  }
  wetFeet -= dt;
  // Волна от ног, пока идёшь по воде, и лёгкое покачивание, когда стоишь.
  if (player.wasInPool) {
    const sp = Math.hypot(player.vel.x, player.vel.z);
    if (sp > 0.1) water.ripple(player.pos.x, player.pos.z, sp * 0.09, 0.2);
    idleRipple -= dt;
    if (idleRipple < 0) {
      water.ripple(player.pos.x, player.pos.z, 0.25, 0.25);
      idleRipple = 1.4;
    }
  }
  water.update(time, amb, day.s.lightDir);
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

  water.renderRefraction(scene, camera);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Для отладки из консоли.
window.poolRoom = { day, player, ball, camera, renderer, composer, gtao, bloom, scene, cubeTarget, water, splash };

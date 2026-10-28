import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { POOL, WINDOW, ROOM, beamFactor } from './layout.js';
import { DayCycle } from './daycycle.js';
import { createSky } from './sky.js';
import { buildRoom } from './room.js';
import { Water } from './water.js';
import { buildMeadow } from './meadow.js';
import { Ball } from './ball.js';
import { Player } from './player.js';
import { SoundScape } from './audio.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const pixelRatio = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);

RectAreaLightUniformsLib.init();
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// Общие для кафеля и воды параметры света.
const shared = {
  uCTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightCol: { value: new THREE.Color() },
  uSkyCol: { value: new THREE.Color() },
  uWaterLit: { value: 0 },
};

const day = new DayCycle(90);
const sky = createSky();
scene.add(sky.mesh);
const mats = buildRoom(scene, shared);
const water = new Water(shared);
scene.add(water.mesh);
const meadow = buildMeadow(scene);
const ball = new Ball();
scene.add(ball.mesh);
const player = new Player(camera, canvas);
const sound = new SoundScape();

// Отражения: кафель лишь чуть глянцевый, металл и мяч — сильнее.
const envMats = [
  [mats.tile, 0.25],
  [mats.poolTile, 0.25],
  [mats.frame, 0.3],
  [mats.metal, 1.0],
  [ball.mesh.material, 0.6],
];
for (const [m] of envMats) m.envMap = envMap;

// Свет: солнце/луна через окно, мягкий свет неба из окна и общий рассеянный.
const sunTarget = new THREE.Object3D();
sunTarget.position.set(-1.2, 0, -1);
scene.add(sunTarget);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.target = sunTarget;
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 45 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
scene.add(hemi);

const winW = WINDOW.x1 - WINDOW.x0;
const winH = WINDOW.y1 - WINDOW.y0;
const windowLight = new THREE.RectAreaLight(0xffffff, 1, winW, winH);
windowLight.position.set((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, ROOM.z0 + 0.01);
windowLight.lookAt(windowLight.position.x, windowLight.position.y, 0);
scene.add(windowLight);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

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
const tmpColor = new THREE.Color();

function applyLighting() {
  const s = day.s;
  sun.color.copy(s.light);
  sun.intensity = s.lightInt;
  sun.position.copy(sunTarget.position).addScaledVector(s.lightDir, 20);

  hemi.color.copy(s.hor).lerp(s.amb, 0.5);
  hemi.groundColor.copy(s.amb).multiplyScalar(0.7);
  hemi.intensity = s.ai * 0.9;

  windowLight.color.copy(s.hor).lerp(white, 0.35);
  windowLight.intensity = s.ai * 4;

  let lit = 0;
  for (const p of waterSamples) lit += beamFactor(p, s.lightDir);
  waterLit += (lit / waterSamples.length - waterLit) * 0.05;

  shared.uLightDir.value.copy(s.lightDir);
  shared.uLightCol.value.copy(s.light).multiplyScalar(s.lightInt);
  shared.uSkyCol.value.copy(s.amb).multiplyScalar(s.ai);
  shared.uWaterLit.value = waterLit;

  for (const [m, k] of envMats) m.envMapIntensity = k * s.ai;
  tmpColor.copy(s.amb).multiplyScalar(s.ai);
  return tmpColor;
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
document.getElementById('enter').addEventListener('click', enter);

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
  playBtn.textContent = p ? '▶' : '❚❚';
  playBtn.setAttribute('aria-label', p ? 'Продолжить' : 'Пауза');
}
playBtn.addEventListener('click', () => setPaused(!day.paused));
slider.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
slider.addEventListener('input', () => {
  day.t = slider.value / 1000;
});
soundBtn.addEventListener('click', () => {
  soundBtn.textContent = sound.toggleMute() ? 'Звук выкл.' : 'Звук вкл.';
});

addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') panel.classList.toggle('hidden');
  if (e.code === 'KeyP') setPaused(!day.paused);
  if (e.code === 'KeyM') soundBtn.click();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// --- Цикл ---
const clock = new THREE.Clock();
let time = 0;
const fx = {
  time: 0,
  thump: (s) => sound.thump(s),
  splash: (s) => sound.splash(s),
  ripple: (x, z, a) => water.ripple(x, z, a),
};
let idleRipple = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  fx.time = time;

  day.update(dt);
  const ambient = applyLighting();
  sky.update(day.s, time);
  shared.uCTime.value = time;
  water.update(time, ambient);
  meadow.update(time);

  for (const ev of player.update(dt)) {
    if (ev === 'enter') {
      sound.splash(1);
      water.ripple(player.pos.x, player.pos.z, 1.8);
    } else if (ev === 'water') {
      sound.step('water');
      water.ripple(player.pos.x, player.pos.z, 1);
    } else if (ev === 'tile' || ev === 'grass') {
      sound.step(ev);
    }
  }
  if (player.wasInPool) {
    idleRipple -= dt;
    if (idleRipple < 0) {
      water.ripple(player.pos.x, player.pos.z, 0.35);
      idleRipple = 1.6;
    }
  }
  ball.update(dt, player, fx);
  sound.update(dt, day.s.day, day.s.night);

  if (!dragging) slider.value = Math.round(day.t * 1000);
  phaseEl.textContent = day.phase;
  clockEl.textContent = day.clock;

  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Для отладки из консоли.
window.poolRoom = { day, player, ball, camera };

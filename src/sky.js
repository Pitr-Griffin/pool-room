import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uCloud;
uniform float uStars;
uniform float uTime;
uniform float uGain;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
uniform float uLightI;
uniform float uHQ;

// --- Объёмные облака -------------------------------------------------------
// Слой кучевых облаков на высоте 1–2.1 км (и такой же слой внизу — земли нет).
// Луч из глаза проходит сквозь слой шагами, в каждой точке — плотность из трёхмерного
// шума, который медленно плывёт по ветру и меняется во времени; свет солнца (луны)
// ослабляется по пути через само облако — отсюда освещённые макушки и тёмные днища.

float h31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    v += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}

const float CL0 = 1.0;
const float CL1 = 2.1;
const float CL_FAR = 22.0;

float cloudDensity(vec3 p, int oct) {
  float hn = (abs(p.y) - CL0) / (CL1 - CL0);
  if (hn < 0.0 || hn > 1.0) return 0.0;
  // Нижний слой — другой узор, а не отражение верхнего.
  vec3 q = p * 0.6 + vec3(uTime * 0.014, uTime * 0.002, uTime * 0.005) + step(p.y, 0.0) * vec3(31.7, 0.0, -12.3);
  float n = fbm3(q, oct);
  // Кучевая форма: плоское днище, округлый верх; между облаками — чистое небо.
  float shape = smoothstep(0.0, 0.1, hn) * smoothstep(1.0, 0.3, hn);
  return smoothstep(0.56, 0.7, n * (0.72 + 0.4 * shape)) * shape;
}

float hg(float c, float g) {
  return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5) * 0.25;
}

// rgb — свет, рассеянный облаками; a — сколько неба просвечивает сквозь них.
vec4 clouds(vec3 d) {
  float ay = max(abs(d.y), 0.02);
  float t0 = CL0 / ay;
  if (t0 > CL_FAR) return vec4(0.0, 0.0, 0.0, 1.0);
  float t1 = min(CL1 / ay, CL_FAR);
  int steps = uHQ > 0.5 ? 40 : 14;
  float dt = (t1 - t0) / float(steps);
  float t = t0 + dt * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 L = uSunDir.y > 0.0 ? uSunDir : uMoonDir;
  float cosT = dot(d, L);
  float phase = mix(hg(cosT, 0.65), hg(cosT, -0.15), 0.35);
  vec3 lightCol = uSunColor * uLightI;
  vec3 scat = vec3(0.0);
  float T = 1.0;
  const float SIGMA = 9.0;
  for (int i = 0; i < 40; i++) {
    if (i >= steps || T < 0.02) break;
    vec3 p = d * t;
    float dens = cloudDensity(p, uHQ > 0.5 ? 5 : 3);
    if (dens > 0.002) {
      // Сколько облака между точкой и солнцем.
      float od = 0.0;
      for (int j = 1; j <= 4; j++) od += cloudDensity(p + L * 0.11 * float(j), 3);
      float Tl = exp(-od * 0.11 * SIGMA);
      float powder = 1.0 - exp(-dens * 3.0);
      float hn = (abs(p.y) - CL0) / (CL1 - CL0);
      vec3 S = lightCol * Tl * phase * powder * 10.0 + uCloud * (0.18 + 0.5 * hn);
      float a = exp(-dens * dt * SIGMA);
      scat += T * (1.0 - a) * S;
      T *= a;
    }
    t += dt;
  }
  // Далёкие облака тают в дымке у горизонта.
  float fade = exp(-t0 * 0.09);
  return vec4(scat * fade, mix(1.0, T, fade));
}
void main() {
  vec3 d = normalize(vDir);
  // Земли нет: комната висит в небе, и ниже горизонта — то же небо с облаками.
  float h = abs(d.y);
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.45, h), 0.7));

  float sd = max(dot(d, uSunDir), 0.0);
  float sunVis = smoothstep(-0.08, 0.02, uSunDir.y);
  col += uSunColor * (pow(sd, 1400.0) * 40.0 + pow(sd, 10.0) * 0.4) * sunVis;

  float md = max(dot(d, uMoonDir), 0.0);
  float moonVis = smoothstep(-0.05, 0.05, uMoonDir.y) * uStars;
  col += vec3(0.88, 0.92, 1.0) * (smoothstep(0.99955, 0.9997, md) * 4.0 + pow(md, 80.0) * 0.12) * moonVis;

  vec3 sp = d * 220.0;
  vec3 cell = floor(sp);
  float s = hash3(cell);
  float star = smoothstep(0.9965, 1.0, s);
  float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 100.0);
  float core = smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
  col += vec3(star * core * tw * 3.0) * uStars * smoothstep(0.0, 0.15, h);

  vec4 cl = clouds(d);
  col = col * cl.a + cl.rgb;

  gl_FragColor = vec4(col * uGain, 1.0);
}
`;

// mainCamera — облака в полном качестве только для основного кадра; в отражениях,
// кубических картах и т. п. — упрощённые (меньше шагов).
export function createSky(mainCamera) {
  const uniforms = {
    uLightI: { value: 1 },
    uHQ: { value: 1 },
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uCloud: { value: new THREE.Color() },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uGain: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), material);
  mesh.renderOrder = -1;
  const pickQuality = (renderer, scene, camera) => {
    uniforms.uHQ.value = camera === mainCamera ? 1 : 0;
  };
  mesh.onBeforeRender = pickQuality;

  // «Окно в небо»: плоскость, которая рисует небо по направлению взгляда и закрывает собой
  // всё, что за ней. Ставится в стекло окна коридора — снаружи не видно стен соседних комнат,
  // будто их нет, хотя войти в них можно.
  const portalMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader,
    side: THREE.DoubleSide,
  });
  function portal(width, height) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), portalMaterial);
    m.onBeforeRender = pickQuality;
    return m;
  }

  const white = new THREE.Color(1, 1, 1);
  const night = new THREE.Color('#1b2344');

  function update(s, time) {
    uniforms.uTop.value.copy(s.top);
    uniforms.uHorizon.value.copy(s.hor);
    uniforms.uSunDir.value.copy(s.sunDir);
    uniforms.uSunColor.value.copy(s.light);
    uniforms.uMoonDir.value.copy(s.moonDir);
    uniforms.uStars.value = s.stars;
    // Сила света, которым подсвечены облака (днём солнце, ночью тусклая луна).
    uniforms.uLightI.value = s.lightInt / 4.2;
    uniforms.uTime.value = time;
    // Снаружи заметно ярче, чем в комнате, — как на настоящем фото против окна.
    uniforms.uGain.value = 1 + s.ai * 0.8;
    uniforms.uCloud.value.copy(s.hor).lerp(white, 0.55).multiplyScalar(0.35 + s.ai * 0.75).lerp(night, s.stars * 0.85);
  }

  return { mesh, portal, update };
}

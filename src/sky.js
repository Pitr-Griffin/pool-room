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
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  // Земли нет: комната висит в небе, и ниже горизонта — то же небо с облаками.
  float below = step(d.y, 0.0);
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

  // Плывущие кучевые облака: два слоя с разной скоростью, подсвеченные со стороны солнца.
  if (h > 0.0) {
    // Нижние облака — отдельный узор, а не зеркало верхних.
    vec2 base = d.xz / (h + 0.12) + below * vec2(13.7, -5.2);
    float fadeH = smoothstep(0.0, 0.18, h);
    for (int layer = 0; layer < 2; layer++) {
      float fl = float(layer);
      vec2 wind = vec2(0.045, 0.012) * (1.0 + fl * 0.6);
      vec2 cp = base * (0.9 + fl * 0.5) + uTime * wind + fl * 7.3;
      vec2 warp = vec2(fbm(cp * 0.7 + 3.1), fbm(cp * 0.7 - 1.7));
      float dens = fbm(cp + warp * 0.8);
      float c = smoothstep(0.48 + fl * 0.06, 0.78, dens);
      // Освещённость: смотрим, насколько облако плотнее в сторону солнца.
      float toward = fbm(cp + warp * 0.8 + normalize(uSunDir.xz + 1e-4) * 0.08);
      float lit = clamp(0.65 + (dens - toward) * 4.0, 0.25, 1.3);
      vec3 cc = uCloud * lit + uSunColor * 0.12 * max(lit - 0.8, 0.0) * smoothstep(-0.05, 0.1, uSunDir.y);
      col = mix(col, cc, c * (0.85 - fl * 0.25) * fadeH);
    }
  }

  gl_FragColor = vec4(col * uGain, 1.0);
}
`;

export function createSky() {
  const uniforms = {
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
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), portalMaterial);
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
    uniforms.uTime.value = time;
    // Снаружи заметно ярче, чем в комнате, — как на настоящем фото против окна.
    uniforms.uGain.value = 1 + s.ai * 0.8;
    uniforms.uCloud.value.copy(s.hor).lerp(white, 0.55).multiplyScalar(0.35 + s.ai * 0.75).lerp(night, s.stars * 0.85);
  }

  return { mesh, portal, update };
}

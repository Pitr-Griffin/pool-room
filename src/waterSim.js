import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { POOL, STEPS, STEP_RISE, LAYOUT_GLSL } from './layout.js';

// Физика воды на видеокарте: высоты поверхности на сетке 256×160 (≈1.6 см),
// волновое уравнение, отражение волн от стенок бассейна.
// Текстура: r — высота, g — скорость, b/a — нормаль (x, z).
// Плюс каустика: свет преломляется через смоделированную поверхность и
// фокусируется на дне — карта яркости в координатах бассейна.

export const SIM_W = 256;
export const SIM_H = 160;
const POOL_W = POOL.x1 - POOL.x0;
const POOL_L = POOL.z1 - POOL.z0;

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const dropShader = /* glsl */ `
  uniform sampler2D tSim;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec4 info = texture2D(tSim, vUv);
    vec2 d = (vUv - uCenter) * vec2(${POOL_W.toFixed(3)}, ${POOL_L.toFixed(3)});
    float drop = max(0.0, 1.0 - length(d) / uRadius);
    drop = 0.5 - cos(drop * 3.14159265) * 0.5;
    info.r += drop * uStrength;
    gl_FragColor = info;
  }
`;

const updateShader = /* glsl */ `
  uniform sampler2D tSim;
  uniform vec2 uDelta;
  varying vec2 vUv;
  void main() {
    vec4 info = texture2D(tSim, vUv);
    vec2 dx = vec2(uDelta.x, 0.0);
    vec2 dy = vec2(0.0, uDelta.y);
    float average = (
      texture2D(tSim, vUv - dx).r + texture2D(tSim, vUv + dx).r +
      texture2D(tSim, vUv - dy).r + texture2D(tSim, vUv + dy).r
    ) * 0.25;
    info.g += (average - info.r) * 2.0;
    info.g *= 0.994;
    info.r += info.g;
    info.r *= 0.9995;
    gl_FragColor = info;
  }
`;

const normalShader = /* glsl */ `
  uniform sampler2D tSim;
  uniform vec2 uDelta;
  uniform float uScale;
  varying vec2 vUv;
  void main() {
    vec4 info = texture2D(tSim, vUv);
    float hx = texture2D(tSim, vUv + vec2(uDelta.x, 0.0)).r;
    float hz = texture2D(tSim, vUv + vec2(0.0, uDelta.y)).r;
    vec3 ddx = vec3(uDelta.x * ${POOL_W.toFixed(3)}, (hx - info.r) * uScale, 0.0);
    vec3 ddz = vec3(0.0, (hz - info.r) * uScale, uDelta.y * ${POOL_L.toFixed(3)});
    info.ba = normalize(cross(ddz, ddx)).xz;
    gl_FragColor = info;
  }
`;

// Каустика: сетка поверхности воды; каждый узел — луч солнца, преломлённый
// поверхностью и упавший на дно. Яркость = сжатие площади треугольника.
const causticsVertex = /* glsl */ `
  uniform sampler2D tSim;
  uniform vec3 uLightDir;
  uniform float uScale;
  varying vec3 vOld;
  varying vec3 vNew;
  varying float vLit;
  ${LAYOUT_GLSL}

  float floorAt(float x) {
    float i = floor((x - ${POOL.x0.toFixed(3)}) / ${STEPS.tread.toFixed(3)});
    return i < ${STEPS.count.toFixed(1)} ? -(max(i, 0.0) + 1.0) * ${STEP_RISE.toFixed(3)} : ${POOL.bottom.toFixed(3)};
  }

  vec3 project(vec3 origin, vec3 ray, float floorY) {
    float t = (floorY - origin.y) / ray.y;
    return origin + ray * t;
  }

  void main() {
    vec2 uv = position.xy * 0.5 + 0.5;
    vec4 info = texture2D(tSim, uv);
    vec3 n = vec3(info.b, sqrt(max(1.0 - dot(info.ba, info.ba), 0.0)), info.a);
    vec3 p = vec3(
      ${POOL.x0.toFixed(3)} + uv.x * ${POOL_W.toFixed(3)},
      POOL_WATER + info.r * uScale,
      ${POOL.z0.toFixed(3)} + uv.y * ${POOL_L.toFixed(3)}
    );
    vec3 L = -uLightDir;
    float floorY = floorAt(p.x);
    vec3 flatRay = refract(L, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
    vec3 ray = refract(L, n, 1.0 / 1.333);
    vOld = project(vec3(p.x, POOL_WATER, p.z), flatRay, floorY);
    vNew = project(p, ray, floorY);
    vLit = inBeamFramed(p, uLightDir);
    vec2 clip = vec2(
      (vNew.x - ${POOL.x0.toFixed(3)}) / ${POOL_W.toFixed(3)},
      (vNew.z - ${POOL.z0.toFixed(3)}) / ${POOL_L.toFixed(3)}
    ) * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const causticsFragment = /* glsl */ `
  varying vec3 vOld;
  varying vec3 vNew;
  varying float vLit;
  void main() {
    float oldArea = length(dFdx(vOld)) * length(dFdy(vOld));
    float newArea = length(dFdx(vNew)) * length(dFdy(vNew));
    float ratio = oldArea / max(newArea, 1e-9);
    gl_FragColor = vec4(ratio * vLit, vLit, 0.0, 1.0);
  }
`;

export class WaterSim {
  constructor(renderer) {
    this.renderer = renderer;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    };
    this.a = new THREE.WebGLRenderTarget(SIM_W, SIM_H, opts);
    this.b = this.a.clone();
    this.scale = 0.06; // единица высоты симуляции → метры
    const delta = new THREE.Vector2(1 / SIM_W, 1 / SIM_H);

    const mat = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms: { tSim: { value: null }, ...uniforms } });
    this.drop = mat(dropShader, {
      uCenter: { value: new THREE.Vector2() },
      uRadius: { value: 0.1 },
      uStrength: { value: 0.1 },
    });
    this.update = mat(updateShader, { uDelta: { value: delta } });
    this.normal = mat(normalShader, { uDelta: { value: delta }, uScale: { value: this.scale } });
    this.quad = new FullScreenQuad(null);

    // Каустика — в текстуре по площади бассейна.
    this.caustics = new THREE.WebGLRenderTarget(512, 320, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    const grid = new THREE.PlaneGeometry(2, 2, 255, 159);
    this.causticsMat = new THREE.ShaderMaterial({
      vertexShader: causticsVertex,
      fragmentShader: causticsFragment,
      uniforms: {
        tSim: { value: null },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uScale: { value: this.scale },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      extensions: { derivatives: true },
    });
    this.causticsScene = new THREE.Scene();
    const mesh = new THREE.Mesh(grid, this.causticsMat);
    mesh.frustumCulled = false;
    this.causticsScene.add(mesh);
    this.causticsCam = new THREE.Camera();

    this.pending = [];
    this.clear();
  }

  get texture() {
    return this.a.texture;
  }

  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    for (const t of [this.a, this.b]) {
      r.setRenderTarget(t);
      r.setClearColor(0x000000, 0);
      r.clear();
    }
    r.setRenderTarget(prev);
  }

  // Капля / возмущение в мировых координатах (x, z), радиус в метрах.
  addDrop(x, z, radius, strength) {
    const u = (x - POOL.x0) / POOL_W;
    const v = (z - POOL.z0) / POOL_L;
    if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return;
    this.pending.push([u, v, radius, strength]);
  }

  pass(material) {
    material.uniforms.tSim.value = this.a.texture;
    this.quad.material = material;
    this.renderer.setRenderTarget(this.b);
    this.quad.render(this.renderer);
    [this.a, this.b] = [this.b, this.a];
  }

  step(lightDir, steps = 2) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    for (const [u, v, radius, strength] of this.pending.splice(0)) {
      this.drop.uniforms.uCenter.value.set(u, v);
      this.drop.uniforms.uRadius.value = radius;
      this.drop.uniforms.uStrength.value = strength;
      this.pass(this.drop);
    }
    for (let i = 0; i < steps; i++) this.pass(this.update);
    this.pass(this.normal);

    this.causticsMat.uniforms.tSim.value = this.a.texture;
    this.causticsMat.uniforms.uLightDir.value.copy(lightDir);
    r.setRenderTarget(this.caustics);
    r.setClearColor(0x000000, 0);
    r.clear();
    if (lightDir.y > 0.02) r.render(this.causticsScene, this.causticsCam);

    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
  }
}

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { POOL, STEPS, STEP_RISE, LAYOUT_GLSL } from './layout.js';
import { WaterSim } from './waterSim.js';

// Вода бассейна:
// - поверхность смещается по физической симуляции волн (waterSim.js);
// - отражение — зеркальный рендер комнаты (Reflector), искажённый нормалями волн;
// - преломление — кадр комнаты без воды, сдвинутый по нормалям и глубине;
// - поглощение света толщей воды, френель, блик солнца только там, где падает луч.

const W = POOL.x1 - POOL.x0;
const L = POOL.z1 - POOL.z0;

const WaterShader = {
  name: 'PoolWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tSim: { value: null },
    tRefract: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uScale: { value: 0.06 },
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3() },
    uLightCol: { value: new THREE.Color() },
    uAmb: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    uniform sampler2D tSim;
    uniform float uScale;
    varying vec4 vUvR;
    varying vec3 vWP;
    varying vec2 vSimUv;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vSimUv = vec2((wp.x - ${POOL.x0.toFixed(3)}) / ${W.toFixed(3)}, (wp.z - ${POOL.z0.toFixed(3)}) / ${L.toFixed(3)});
      float h = texture2D(tSim, vSimUv).r * uScale;
      vUvR = textureMatrix * vec4(position, 1.0);
      wp.y += h;
      vWP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tSim;
    uniform sampler2D tRefract;
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec3 uLightDir;
    uniform vec3 uLightCol;
    uniform vec3 uAmb;
    varying vec4 vUvR;
    varying vec3 vWP;
    varying vec2 vSimUv;
    ${LAYOUT_GLSL}

    // Мелкая постоянная рябь поверх симуляции — вода никогда не стоит идеально.
    vec2 microSlope(vec2 p) {
      vec2 s = vec2(0.0);
      s += vec2(cos(p.x * 9.0 + uTime * 1.7), cos(p.y * 7.0 - uTime * 1.3)) * 0.012;
      s += vec2(cos((p.x + p.y) * 17.0 + uTime * 2.3), cos((p.x - p.y) * 15.0 - uTime * 2.1)) * 0.007;
      s += vec2(cos(p.x * 31.0 - p.y * 11.0 + uTime * 3.1), cos(p.y * 29.0 + p.x * 7.0 + uTime * 2.7)) * 0.004;
      return s;
    }

    void main() {
      vec4 info = texture2D(tSim, vSimUv);
      vec2 slope = info.ba + microSlope(vWP.xz);
      vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
      vec3 v = normalize(cameraPosition - vWP);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

      vec3 refl = texture2D(tDiffuse, vUvR.xy / vUvR.w + n.xz * 0.08).rgb;

      // Глубина под точкой (ступени мельче).
      float stepI = floor((vWP.x - ${POOL.x0.toFixed(3)}) / ${STEPS.tread.toFixed(3)});
      float floorY = stepI < ${STEPS.count.toFixed(1)} ? -(stepI + 1.0) * ${STEP_RISE.toFixed(3)} : ${POOL.bottom.toFixed(3)};
      float depth = max(vWP.y - floorY, 0.02);
      float path = depth / max(v.y, 0.12);

      vec2 suv = gl_FragCoord.xy / uRes;
      vec2 off = n.xz * clamp(depth, 0.05, 0.9) * 0.09;
      vec3 refr = texture2D(tRefract, suv - off).rgb;
      vec3 trans = exp(-path * vec3(0.42, 0.11, 0.09));
      vec3 scatter = vec3(0.18, 0.5, 0.55) * uAmb * 0.25 * (1.0 - trans);
      vec3 body = refr * trans + scatter;

      vec3 rv = reflect(-v, n);
      float beam = inBeam(vWP, uLightDir);
      float spec = pow(max(dot(rv, uLightDir), 0.0), 600.0) * 40.0 + pow(max(dot(rv, uLightDir), 0.0), 60.0) * 0.6;
      vec3 col = mix(body, refl, fres) + uLightCol * spec * beam;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Water {
  constructor(renderer, shared) {
    this.renderer = renderer;
    this.sim = new WaterSim(renderer);
    const pr = renderer.getPixelRatio();
    this.mesh = new Reflector(new THREE.PlaneGeometry(W - 0.004, L - 0.004, 200, 125), {
      shader: WaterShader,
      textureWidth: Math.floor(innerWidth * pr * 0.75),
      textureHeight: Math.floor(innerHeight * pr * 0.75),
      clipBias: 0.003,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((POOL.x0 + POOL.x1) / 2, POOL.water, (POOL.z0 + POOL.z1) / 2);

    // Кадр без воды для преломления.
    this.refractTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.resize();

    const u = this.mesh.material.uniforms;
    u.tSim.value = this.sim.texture;
    u.tRefract.value = this.refractTarget.texture;
    u.uScale.value = this.sim.scale;
    u.uLightDir = shared.uLightDir;
    u.uLightCol = shared.uLightCol;
    this.uniforms = u;

    const render = this.mesh.onBeforeRender;
    this.capturing = false;
    this.mesh.onBeforeRender = (r, scene, camera) => {
      if (scene.overrideMaterial || this.capturing) return;
      render(r, scene, camera);
    };
  }

  get causticsTexture() {
    return this.sim.caustics.texture;
  }

  resize() {
    const pr = this.renderer.getPixelRatio();
    this.refractTarget.setSize(Math.floor(innerWidth * pr * 0.6), Math.floor(innerHeight * pr * 0.6));
  }

  ripple(x, z, amp = 1, radius = 0.12) {
    this.sim.addDrop(x, z, radius, amp * 0.22);
  }

  update(time, ambient, lightDir) {
    this.uniforms.uTime.value = time;
    this.uniforms.uAmb.value.copy(ambient);
    this.sim.step(lightDir);
    this.uniforms.tSim.value = this.sim.texture;
  }

  // Перед основным кадром: снять комнату без воды для преломления.
  renderRefraction(scene, camera) {
    const r = this.renderer;
    this.mesh.visible = false;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.refractTarget);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(prev);
    this.mesh.visible = true;
    this.uniforms.uRes.value.set(r.domElement.width, r.domElement.height);
  }
}

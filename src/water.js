import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { POOL, STEPS, STEP_RISE, SHALLOW, SHALLOW_WATER, CORRIDOR, LAYOUT_GLSL } from './layout.js';
import { WaterSim, bodyGLSL } from './waterSim.js';

// Вода:
// - поверхность смещается по физической симуляции волн (waterSim.js);
// - отражение — зеркальный рендер комнаты (Reflector), искажённый нормалями волн;
// - преломление — кадр комнаты без воды, сдвинутый по нормалям и глубине;
// - поглощение света толщей воды, френель, блик солнца только там, где падает луч.

const f = (v) => v.toFixed(3);

// Глубокий бассейн первой комнаты: дно со ступенями.
export const POOL_BODY = {
  ...POOL,
  level: POOL.water,
  simW: 256,
  simH: 160,
  floorGLSL: /* glsl */ `
  float floorAt(vec2 p) {
    float i = floor((p.x - ${f(POOL.x0)}) / ${f(STEPS.tread)});
    return i < ${f(STEPS.count)} ? -(max(i, 0.0) + 1.0) * ${f(STEP_RISE)} : ${f(POOL.bottom)};
  }`,
  maskGLSL: 'float waterMask(vec2 p) { return 1.0; }',
};

// Вода по щиколотку: коридор и мелкий бассейн — прямоугольник без угла у стены второй комнаты.
export const SHALLOW_BODY = {
  ...SHALLOW_WATER,
  level: SHALLOW.water,
  simW: 400,
  simH: 140,
  // Мелкая вода успокаивается быстрее глубокой; волны низкие, наклон слегка усилен, чтобы круги читались.
  damping: 0.99,
  scale: 0.04,
  slopeGain: 1.5,
  floorGLSL: `float floorAt(vec2 p) { return ${f(SHALLOW.floor)}; }`,
  maskGLSL: /* glsl */ `
  float waterMask(vec2 p) {
    return (p.x < ${f(CORRIDOR.x1)} && (p.y < ${f(CORRIDOR.z0)} || p.y > ${f(CORRIDOR.z1)})) ? 0.0 : 1.0;
  }`,
};

function waterShader(body) {
  return {
    name: 'Water',
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
      ${bodyGLSL(body)}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vSimUv = bodyUv(wp.xz);
        // У бортиков поверхность прижата: край воды не дрожит зубцами.
        vec2 e = min(vSimUv, 1.0 - vSimUv) * vec2(BODY_W, BODY_L);
        float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
        float h = texture2D(tSim, vSimUv).r * uScale * edge;
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
      ${bodyGLSL(body)}

      // Мелкая постоянная рябь поверх симуляции — вода никогда не стоит идеально.
      vec2 microSlope(vec2 p) {
        vec2 s = vec2(0.0);
        s += vec2(cos(p.x * 9.0 + uTime * 1.1), cos(p.y * 7.0 - uTime * 0.9)) * 0.006;
        s += vec2(cos((p.x + p.y) * 17.0 + uTime * 1.5), cos((p.x - p.y) * 15.0 - uTime * 1.4)) * 0.0035;
        s += vec2(cos(p.x * 31.0 - p.y * 11.0 + uTime * 2.0), cos(p.y * 29.0 + p.x * 7.0 + uTime * 1.8)) * 0.0015;
        return s;
      }

      void main() {
        if (waterMask(vWP.xz) < 0.5) discard;
        vec4 info = texture2D(tSim, vSimUv);
        // В мелкой воде волны ниже, поэтому их наклон усилен — иначе круги от шагов не видны.
        vec2 slope = info.ba * ${f(body.slopeGain ?? 1)} + microSlope(vWP.xz);
        vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
        vec3 v = normalize(cameraPosition - vWP);
        vec2 suv = gl_FragCoord.xy / uRes;

        // Взгляд снизу, из-под воды: в «окне Снеллиуса» — комната над водой, сжатая и
        // дрожащая на волнах; за критическим углом (48,6° от вертикали) гладь — зеркало,
        // в котором отражается сама толща воды.
        if (cameraPosition.y < vWP.y) {
          vec3 up = -v;
          float cosW = dot(up, n);
          vec3 above = texture2D(tRefract, suv - n.xz * 0.12).rgb;
          float window = smoothstep(0.62, 0.7, cosW);
          vec3 deep = vec3(0.05, 0.19, 0.21) * (0.35 + uAmb * 0.6);
          // У края окна — радужная кромка и яркое кольцо полного отражения.
          float rim = smoothstep(0.55, 0.66, cosW) * (1.0 - window);
          vec3 col = mix(deep, above * vec3(0.82, 0.95, 0.97), window) + rim * deep * 1.8;
          float spec = pow(max(dot(refract(up, -n, 1.333), uLightDir), 0.0), 200.0) * 6.0;
          gl_FragColor = vec4(col + uLightCol * spec * inBeam(vWP, uLightDir) * window, 1.0);
          return;
        }

        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

        vec3 refl = texture2D(tDiffuse, vUvR.xy / vUvR.w + n.xz * 0.08).rgb;

        float depth = max(vWP.y - floorAt(vWP.xz), 0.02);
        float path = depth / max(v.y, 0.12);

        // Сдвиг преломления растёт с глубиной; в мелкой воде — небольшой, но не нулевой.
        vec2 off = n.xz * clamp(depth, 0.15, 0.9) * 0.065;
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
}

export class Water {
  static reflecting = false;

  // refractTarget — общий для всех водоёмов кадр сцены без воды (снимает main.js).
  constructor(renderer, shared, body, refractTarget) {
    this.renderer = renderer;
    this.body = body;
    this.sim = new WaterSim(renderer, body);
    const W = body.x1 - body.x0;
    const L = body.z1 - body.z0;
    const pr = renderer.getPixelRatio();
    this.mesh = new Reflector(new THREE.PlaneGeometry(W - 0.004, L - 0.004, Math.round(W * 50), Math.round(L * 50)), {
      shader: waterShader(body),
      textureWidth: Math.floor(innerWidth * pr * 0.75),
      textureHeight: Math.floor(innerHeight * pr * 0.75),
      clipBias: 0.003,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((body.x0 + body.x1) / 2, body.level, (body.z0 + body.z1) / 2);
    // Гладь видна и снизу — для кадров из-под воды.
    this.mesh.material.side = THREE.DoubleSide;

    const u = this.mesh.material.uniforms;
    u.tSim.value = this.sim.texture;
    u.tRefract.value = refractTarget.texture;
    u.uScale.value = this.sim.scale;
    u.uLightDir = shared.uLightDir;
    u.uLightCol = shared.uLightCol;
    this.uniforms = u;

    const render = this.mesh.onBeforeRender;
    this.capturing = false;
    this.mesh.onBeforeRender = (r, scene, camera) => {
      // Внутри отражения одного водоёма другой своё отражение не пересчитывает.
      if (scene.overrideMaterial || this.capturing || Water.reflecting) return;
      Water.reflecting = true;
      render(r, scene, camera);
      Water.reflecting = false;
    };
  }

  get causticsTexture() {
    return this.sim.caustics.texture;
  }

  ripple(x, z, amp = 1, radius = 0.12) {
    this.sim.addDrop(x, z, radius, amp * 0.12);
  }

  update(time, ambient, lightDir, res) {
    this.uniforms.uTime.value = time;
    this.uniforms.uAmb.value.copy(ambient);
    this.uniforms.uRes.value.copy(res);
    this.sim.step(lightDir);
    this.uniforms.tSim.value = this.sim.texture;
  }
}

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { POOL, STEPS, STEP_RISE, LAYOUT_GLSL } from './layout.js';

const RIPPLES = 12;

// Вода — настоящее зеркальное отражение комнаты (Reflector), искажённое рябью,
// плюс френель, блик солнца и лёгкий бирюзовый оттенок, зависящий от толщины воды.
const WaterShader = {
  name: 'PoolWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uRipples: { value: [] },
    uLightDir: { value: new THREE.Vector3() },
    uLightCol: { value: new THREE.Color() },
    uAmb: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvR;
    varying vec3 vWP;
    void main() {
      vUvR = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec4 uRipples[${RIPPLES}];
    uniform vec3 uLightDir;
    uniform vec3 uLightCol;
    uniform vec3 uAmb;
    varying vec4 vUvR;
    varying vec3 vWP;
    ${LAYOUT_GLSL}

    float height(vec2 p) {
      float h = sin(p.x * 3.1 + uTime * 1.3) * 0.0025 + sin(p.y * 2.7 - uTime * 1.1) * 0.0025;
      h += sin((p.x + p.y) * 6.3 + uTime * 2.1) * 0.0012 + sin((p.x * 1.7 - p.y) * 9.1 - uTime * 2.6) * 0.0007;
      for (int i = 0; i < ${RIPPLES}; i++) {
        vec4 r = uRipples[i];
        float age = uTime - r.z;
        if (age < 0.0 || age > 5.0 || r.w <= 0.0) continue;
        float d = distance(p, r.xy);
        float front = age * 0.5;
        float env = exp(-pow((d - front) * 3.0, 2.0)) * exp(-age * 0.8) * r.w;
        h += sin((d - front) * 30.0) * env * 0.01;
      }
      return h;
    }

    void main() {
      vec2 p = vWP.xz;
      float e = 0.012;
      float h0 = height(p);
      vec3 n = normalize(vec3(-(height(p + vec2(e, 0.0)) - h0) / e, 1.0, -(height(p + vec2(0.0, e)) - h0) / e));
      vec3 v = normalize(cameraPosition - vWP);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

      vec2 ruv = vUvR.xy / vUvR.w + n.xz * 0.06;
      vec3 refl = texture2D(tDiffuse, ruv).rgb;

      vec3 rv = reflect(-v, n);
      float beam = inBeam(vWP, uLightDir);
      float spec = pow(max(dot(rv, uLightDir), 0.0), 400.0) * beam;

      // Толщина воды вдоль луча зрения до дна.
      float stepI = floor((vWP.x - ${POOL.x0.toFixed(3)}) / ${STEPS.tread.toFixed(3)});
      float floorY = stepI < ${STEPS.count.toFixed(1)} ? -(stepI + 1.0) * ${STEP_RISE.toFixed(3)} : ${POOL.bottom.toFixed(3)};
      float path = (vWP.y - floorY) / max(v.y, 0.15);
      vec3 trans = exp(-path * vec3(0.55, 0.16, 0.13));
      float tMean = dot(trans, vec3(0.333));
      vec3 scatter = vec3(0.25, 0.62, 0.66) * uAmb * 0.35;

      float alpha = clamp(1.0 - (1.0 - fres) * tMean, 0.0, 1.0);
      vec3 col = refl * fres + scatter * (1.0 - fres) * (1.0 - tMean) + uLightCol * spec * 3.0;
      gl_FragColor = vec4(col / max(alpha, 0.001), alpha);
      gl_FragColor.a = clamp(alpha + spec, 0.0, 1.0);
    }
  `,
};

export class Water {
  constructor(shared) {
    this.ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
    this.next = 0;
    const w = POOL.x1 - POOL.x0;
    const l = POOL.z1 - POOL.z0;
    const pr = Math.min(devicePixelRatio, 1.5);
    this.mesh = new Reflector(new THREE.PlaneGeometry(w, l), {
      shader: WaterShader,
      textureWidth: Math.floor(innerWidth * pr * 0.6),
      textureHeight: Math.floor(innerHeight * pr * 0.6),
      clipBias: 0.002,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((POOL.x0 + POOL.x1) / 2, POOL.water, (POOL.z0 + POOL.z1) / 2);

    const mat = this.mesh.material;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.uniforms.uRipples.value = this.ripples;
    mat.uniforms.uLightDir = shared.uLightDir;
    mat.uniforms.uLightCol = shared.uLightCol;
    this.uniforms = mat.uniforms;

    // Не перерисовывать отражение во вспомогательных проходах (AO, кубическая карта).
    const render = this.mesh.onBeforeRender;
    this.capturing = false;
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      if (scene.overrideMaterial || this.capturing) return;
      render(renderer, scene, camera);
    };
  }

  ripple(x, z, amp = 1) {
    this.ripples[this.next].set(x, z, this.uniforms.uTime.value, amp);
    this.next = (this.next + 1) % RIPPLES;
  }

  update(time, ambient) {
    this.uniforms.uTime.value = time;
    this.uniforms.uAmb.value.copy(ambient);
  }
}

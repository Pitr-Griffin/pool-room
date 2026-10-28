import * as THREE from 'three';
import { POOL, LAYOUT_GLSL } from './layout.js';

const RIPPLES = 12;

const vertexShader = /* glsl */ `
varying vec3 vWP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vWP;
uniform float uTime;
uniform vec4 uRipples[${RIPPLES}];
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uAmb;
${LAYOUT_GLSL}

float height(vec2 p) {
  float h = sin(p.x * 3.1 + uTime * 1.3) * 0.003 + sin(p.y * 2.7 - uTime * 1.1) * 0.003;
  h += sin((p.x + p.y) * 5.3 + uTime * 2.1) * 0.0015;
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
  float e = 0.015;
  float h0 = height(p);
  float hx = height(p + vec2(e, 0.0));
  float hz = height(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
  vec3 v = normalize(cameraPosition - vWP);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 refl = uAmb * (0.85 + 0.3 * r.y);
  float beam = inBeam(vWP, uLightDir);
  float spec = pow(max(dot(r, uLightDir), 0.0), 260.0) * beam;
  vec3 base = vec3(0.45, 0.8, 0.85) * uAmb * 0.2;
  vec3 col = mix(base, refl, fres) + uLightCol * (spec * 2.0 + beam * 0.03);
  float alpha = clamp(0.12 + fres * 0.8 + spec, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

export class Water {
  constructor(shared) {
    this.ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
    this.next = 0;
    this.uniforms = {
      uTime: { value: 0 },
      uRipples: { value: this.ripples },
      uLightDir: shared.uLightDir,
      uLightCol: shared.uLightCol,
      uAmb: { value: new THREE.Color() },
    };
    const w = POOL.x1 - POOL.x0;
    const l = POOL.z1 - POOL.z0;
    const geo = new THREE.PlaneGeometry(w, l)
      .rotateX(-Math.PI / 2)
      .translate((POOL.x0 + POOL.x1) / 2, POOL.water, (POOL.z0 + POOL.z1) / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, material);
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

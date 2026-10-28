import * as THREE from 'three';
import { ROOM, LAYOUT_GLSL } from './layout.js';

// Объёмный свет: для каждого пикселя луч от камеры проходит через комнату,
// и в каждой точке проверяется, освещена ли она солнцем через окно (с тенью переплёта).
export const VolumetricShader = {
  uniforms: {
    tDiffuse: { value: null },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uLightDir: { value: new THREE.Vector3() },
    uLightCol: { value: new THREE.Color() },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform vec3 uLightDir;
    uniform vec3 uLightCol;
    uniform float uTime;
    varying vec2 vUv;
    ${LAYOUT_GLSL}

    float vHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (dot(uLightCol, vec3(1.0)) < 0.001) { gl_FragColor = base; return; }

      vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec4 vp = uInvProj * ndc;
      vec3 rd = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
      vec3 ro = uCamPos;

      // Выход луча из комнаты.
      vec3 lo = vec3(${ROOM.x0.toFixed(2)}, POOL_WATER, ${ROOM.z0.toFixed(2)});
      vec3 hi = vec3(${ROOM.x1.toFixed(2)}, ${ROOM.height.toFixed(2)}, ${ROOM.z1.toFixed(2)});
      vec3 inv = 1.0 / rd;
      vec3 t1 = (lo - ro) * inv;
      vec3 t2 = (hi - ro) * inv;
      vec3 tmx = max(t1, t2);
      float tExit = min(min(tmx.x, tmx.y), tmx.z);

      const int STEPS = 40;
      float dt = tExit / float(STEPS);
      float jitter = vHash(gl_FragCoord.xy + fract(uTime) * 17.0);
      float acc = 0.0;
      for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * (float(i) + jitter) * dt;
        float lit = inBeamFramed(p, uLightDir);
        if (lit > 0.0) {
          float n = 0.7 + 0.3 * sin(p.x * 2.1 + uTime * 0.15) * sin(p.y * 2.7 - uTime * 0.11 + p.z * 1.3);
          acc += lit * n;
        }
      }
      acc *= dt;
      float phase = 0.6 + 2.4 * pow(max(dot(rd, uLightDir), 0.0), 6.0);
      gl_FragColor = vec4(base.rgb + uLightCol * acc * phase * 0.005, base.a);
    }
  `,
};

export function updateVolumetric(pass, camera, lightDir, lightCol, intensity, time) {
  const u = pass.uniforms;
  u.uInvProj.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  u.uLightDir.value.copy(lightDir);
  u.uLightCol.value.copy(lightCol).multiplyScalar(lightDir.z < -0.02 ? intensity : 0);
  u.uTime.value = time;
}

// Пылинки, которые видны только в солнечном луче.
export function createDust(count = 700) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = ROOM.x0 + 0.2 + Math.random() * (ROOM.x1 - ROOM.x0 - 0.4);
    pos[i * 3 + 1] = 0.1 + Math.random() * (ROOM.height - 0.2);
    pos[i * 3 + 2] = ROOM.z0 + 0.1 + Math.random() * (ROOM.z1 - ROOM.z0) * 0.75;
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3() },
    uCol: { value: new THREE.Color() },
    uScale: { value: innerHeight },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uScale;
      uniform vec3 uLightDir;
      varying float vLit;
      ${LAYOUT_GLSL}
      void main() {
        vec3 p = position;
        float t = uTime * 0.05;
        p += vec3(sin(t + seed) * 0.35, sin(t * 0.7 + seed * 1.3) * 0.25, cos(t * 0.8 + seed * 0.7) * 0.35);
        vLit = inBeamFramed(p, uLightDir) * (0.5 + 0.5 * sin(uTime * 0.8 + seed * 7.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.006 + fract(seed) * 0.006) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      varying float vLit;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uCol * a * vLit, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  function update(lightDir, lightCol, intensity, time) {
    uniforms.uTime.value = time;
    uniforms.uLightDir.value.copy(lightDir);
    uniforms.uCol.value.copy(lightCol).multiplyScalar(intensity * 0.35);
    uniforms.uScale.value = innerHeight;
  }
  return { points, update };
}

// Финальная обработка: лёгкая хроматическая аберрация, виньетка и зерно — как у фото.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= mix(1.0, 0.78, smoothstep(0.08, 0.5, r2));
      col = clamp((col - 0.5) * 1.08 + 0.5, 0.0, 1.0);
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += g * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

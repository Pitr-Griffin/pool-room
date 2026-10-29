import * as THREE from 'three';
import { ROOM, ROOM2, MEADOW, meadowEdge, inMeadow2, LAYOUT_GLSL } from './layout.js';

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
    tDepth: { value: null },
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
    uniform sampler2D tDepth;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform vec3 uLightDir;
    uniform vec3 uLightCol;
    uniform float uTime;
    varying vec2 vUv;
    ${LAYOUT_GLSL}

    float vHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    // Плотность взвеси: медленно плывущие клубы, чтобы луч не был ровной заливкой.
    float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float noise3(vec3 p) {
      vec3 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float haze(vec3 p) {
      vec3 w = vec3(uTime * 0.03, uTime * 0.012, -uTime * 0.02);
      return 0.45 + 0.75 * noise3(p * 1.3 + w) + 0.35 * noise3(p * 3.1 - w * 1.7);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (dot(uLightCol, vec3(1.0)) < 0.001) { gl_FragColor = base; return; }

      vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec4 vp = uInvProj * ndc;
      vec3 rd = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
      vec3 ro = uCamPos;

      // Выход луча из комнаты.
      vec3 lo = vec3(${ROOM.x0.toFixed(2)}, POOL_WATER, ${ROOM.z0.toFixed(2)});
      vec3 hi = vec3(${ROOM2.x1.toFixed(2)}, ${ROOM.height.toFixed(2)}, ${ROOM.z1.toFixed(2)});
      vec3 inv = 1.0 / rd;
      vec3 t1 = (lo - ro) * inv;
      vec3 t2 = (hi - ro) * inv;
      vec3 tmx = max(t1, t2);
      float tExit = min(min(tmx.x, tmx.y), tmx.z);

      // Луч останавливается на первой поверхности: столб света не просвечивает сквозь стены, мяч и воду.
      float z = texture2D(tDepth, vUv).x;
      vec4 sp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      float tEnd = min(tExit, length(sp.xyz / sp.w));

      const int STEPS = 72;
      float dt = tEnd / float(STEPS);
      float jitter = vHash(gl_FragCoord.xy + fract(uTime) * 17.0);
      float acc = 0.0;
      for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * (float(i) + jitter) * dt;
        float lit = inBeamFramed(p, uLightDir);
        if (lit > 0.0) {
          // Колодцы узкие, поэтому их столбы плотнее — иначе они теряются на фоне окна.
          acc += (lit + inSkylight(p, uLightDir) * 40.0) * haze(p);
        }
      }
      acc *= dt;
      float phase = 0.6 + 2.4 * pow(max(dot(rd, uLightDir), 0.0), 6.0);
      gl_FragColor = vec4(base.rgb + uLightCol * acc * phase * 0.0026, base.a);
    }
  `,
};

export function updateVolumetric(pass, camera, lightDir, lightCol, intensity, time) {
  const u = pass.uniforms;
  u.uInvProj.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  u.uLightDir.value.copy(lightDir);
  u.uLightCol.value.copy(lightCol).multiplyScalar(lightDir.y > 0.02 ? intensity : 0);
  u.uTime.value = time;
}

const GREY = new THREE.Color(0.8, 0.78, 0.74);

// Пылинки, которые видны только в солнечном луче: медленно дрейфуют и кружатся, матовые.
export function createDust(count = 90000) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Обе комнаты и коридор между ними.
    pos[i * 3] = ROOM.x0 + 0.2 + Math.random() * (ROOM2.x1 - ROOM.x0 - 0.4);
    pos[i * 3 + 1] = 0.05 + Math.random() * (ROOM.height + 0.9);
    pos[i * 3 + 2] = ROOM.z0 + 0.1 + Math.random() * (ROOM.z1 - ROOM.z0 - 0.2);
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
        float t = uTime * 0.06;
        // Медленный дрейф по кругу плюс мелкое дрожание, и общий слабый подъём тёплого воздуха.
        p += vec3(sin(t + seed) * 0.45, sin(t * 0.7 + seed * 1.3) * 0.3, cos(t * 0.8 + seed * 0.7) * 0.45);
        p += 0.02 * vec3(sin(uTime * 1.3 + seed * 5.1), sin(uTime * 1.1 + seed * 3.7), sin(uTime * 0.9 + seed * 4.3));
        p.y = mod(p.y + uTime * 0.008, ${(ROOM.height + 0.9).toFixed(2)}) + 0.05;
        // Пыль матовая: рассеивает свет ровно, без вспышек — только разная яркость у разных пылинок.
        vLit = p.y < ${ROOM.height.toFixed(2)} ? inBeamFramed(p, uLightDir) * (0.45 + 0.55 * fract(seed * 7.3)) : 0.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Микрочастицы: доли миллиметра, на экране — пиксель-два, крупнее только у самой камеры.
        float px = (0.0012 + fract(seed) * 0.0018) * uScale / -mv.z;
        gl_PointSize = vLit > 0.0 ? clamp(px, 1.5, 3.5) : 0.0;
        // Пылинка мельче пикселя не исчезает, а становится тусклее.
        vLit *= min(px, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      varying float vLit;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        // Мягкое пятнышко без яркого центра — как пушинка в луче, а не искра.
        float a = exp(-d * d * 14.0);
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
    // Чуть сероватый тон и умеренная яркость: пылинки не должны дотягивать до порога свечения (блума).
    uniforms.uCol.value.copy(lightCol).lerp(GREY, 0.3).multiplyScalar(Math.min(intensity * 0.55, 1.1));
    uniforms.uScale.value = innerHeight * devicePixelRatio;
  }
  return { points, update };
}

// Светлячки: ночью несколько штук медленно кружат над цветами и мерцают.
export function createFireflies(count = 34) {
  const home = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x;
    let z;
    if (i < 14) {
      // Над полосой цветов у окна первой комнаты.
      x = MEADOW.x0 + 0.3 + Math.random() * (MEADOW.x1 - MEADOW.x0 - 0.6);
      z = MEADOW.z0 + 0.25 + Math.random() * (meadowEdge(x) - MEADOW.z0 - 0.35);
    } else {
      // Над лугом второй комнаты.
      do {
        x = ROOM2.x0 + 0.5 + Math.random() * (ROOM2.x1 - ROOM2.x0 - 1);
        z = ROOM2.z0 + 0.5 + Math.random() * (ROOM2.z1 - ROOM2.z0 - 1);
      } while (!inMeadow2(x, z, 0.4));
    }
    home[i * 3] = x;
    home[i * 3 + 1] = 0.3 + Math.random() * 0.45;
    home[i * 3 + 2] = z;
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(home, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uScale: { value: innerHeight },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uNight;
      uniform float uScale;
      varying float vGlow;
      void main() {
        vec3 p = position;
        float t = uTime * (0.18 + fract(seed * 1.7) * 0.12);
        // Петли вокруг своего цветка: две частоты, чтобы путь не повторялся.
        p += vec3(sin(t + seed) * 0.35 + sin(t * 2.3 + seed * 2.0) * 0.08,
                  sin(t * 1.4 + seed * 3.0) * 0.12,
                  cos(t * 0.9 + seed) * 0.25 + cos(t * 2.1 + seed * 1.3) * 0.06);
        // Вспыхивает на секунду-две, потом гаснет.
        float blink = smoothstep(0.35, 1.0, sin(uTime * (0.7 + fract(seed * 3.3) * 0.6) + seed * 5.0));
        vGlow = uNight * (0.08 + blink);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uNight > 0.01 ? 0.07 * uScale / -mv.z : 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        // Яркое ядро и мягкий ореол вокруг.
        float core = smoothstep(0.08, 0.0, d);
        float halo = smoothstep(0.5, 0.0, d);
        vec3 col = vec3(0.75, 1.0, 0.35);
        gl_FragColor = vec4(col * (core * 6.0 + halo * halo * 0.35) * vGlow, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  function update(night, time) {
    uniforms.uTime.value = time;
    uniforms.uNight.value = night;
    uniforms.uScale.value = innerHeight * devicePixelRatio;
  }
  return { points, update };
}

// Брызги: настоящие объёмные капли. Каждая — маленькая сфера с глянцевой поверхностью воды
// (блики солнца, отражение комнаты), в полёте вытягивается вдоль скорости, как на фото
// с короткой выдержкой. Крупных капель мало, мелких много; упав обратно, капля
// оставляет на воде маленький круг (onLand).
export function createSplash(max = 900) {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const radius = new Float32Array(max);
  const surface = new Float32Array(max);
  const material = new THREE.MeshStandardMaterial({
    // Вода почти прозрачна: видны в основном блики и отражение комнаты на поверхности капли.
    color: new THREE.Color(0.5, 0.6, 0.62),
    roughness: 0.02,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    envMapIntensity: 2.6,
  });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let k = 0; k < max; k++) mesh.setMatrixAt(k, hidden);
  let next = 0;

  // Всплеск в точке (x, y, z): y — уровень воды; power — сила (шаг ≈1, прыжок в воду ≈2.4).
  function burst(x, y, z, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const k = next;
      next = (next + 1) % max;
      const a = Math.random() * Math.PI * 2;
      const ring = 0.06 + Math.random() * 0.16;
      pos.set([x + Math.cos(a) * ring, y + 0.01, z + Math.sin(a) * ring], k * 3);
      // Корона: капли уходят наружу и вверх; чем мельче, тем быстрее.
      const small = Math.random() ** 2.5;
      const r = 0.0015 + (1 - small) * 0.0065 * Math.min(power, 1.6);
      const out = (0.35 + Math.random() * 0.8) * power * (1.2 - r * 60);
      vel.set([Math.cos(a) * out * 0.55, (0.9 + Math.random() * 1.5) * power * (1.15 - r * 40), Math.sin(a) * out * 0.55], k * 3);
      life[k] = 0.5 + Math.random() * 0.9;
      radius[k] = r;
      surface[k] = y;
    }
  }

  function update(dt, onLand) {
    for (let k = 0; k < max; k++) {
      if (life[k] <= 0) continue;
      vel[k * 3 + 1] -= 9.8 * dt;
      // Лёгкое сопротивление воздуха.
      const drag = Math.exp(-0.6 * dt);
      vel[k * 3] *= drag;
      vel[k * 3 + 2] *= drag;
      pos[k * 3] += vel[k * 3] * dt;
      pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
      pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      life[k] -= dt;
      if (pos[k * 3 + 1] < surface[k] && vel[k * 3 + 1] < 0) {
        if (onLand && radius[k] > 0.004) onLand(pos[k * 3], pos[k * 3 + 2], radius[k]);
        life[k] = 0;
      }
      if (life[k] <= 0) {
        mesh.setMatrixAt(k, hidden);
        continue;
      }
      // Вытягиваем каплю вдоль скорости (размытие движения за ~1/90 с).
      v.set(vel[k * 3], vel[k * 3 + 1], vel[k * 3 + 2]);
      const speed = v.length();
      q.setFromUnitVectors(up, speed > 1e-4 ? v.multiplyScalar(1 / speed) : up);
      const r = radius[k] * Math.min(1, life[k] * 6);
      s.set(r, r + speed * 0.007, r);
      m.compose(p.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]), q, s);
      mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, points: mesh, burst, update };
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
      // Настроение «отсюда не выбраться»: цвет чуть выцветший и стерильный — холодный, с
      // зеленоватыми тенями, как под лампами, — и края кадра темнее, будто взгляд сужается.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 0.8);
      col *= mix(vec3(0.94, 1.0, 0.98), vec3(1.0, 1.0, 1.02), smoothstep(0.0, 0.6, luma));
      col *= mix(1.0, 0.68, smoothstep(0.06, 0.5, r2));
      col = clamp((col - 0.5) * 1.1 + 0.5, 0.0, 1.0);
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += g * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

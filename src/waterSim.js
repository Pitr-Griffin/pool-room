import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LAYOUT_GLSL } from './layout.js';

// Физика воды на видеокарте: высоты поверхности на сетке (≈1.6–2 см на клетку),
// волновое уравнение, отражение волн от стенок водоёма.
// Текстура: r — высота, g — скорость, b/a — нормаль (x, z).
// Плюс каустика: свет преломляется через смоделированную поверхность и
// фокусируется на дне — карта яркости в координатах водоёма.
//
// Водоём (body) описывает прямоугольник x0..x1, z0..z1, уровень воды level и два куска GLSL:
// floorAt(vec2 xz) — высота дна, waterMask(vec2 xz) — 1 там, где вода есть (для фигур сложнее прямоугольника).

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Общий для шейдеров водоёма код: размеры, дно, маска.
export function bodyGLSL(body) {
  const f = (v) => v.toFixed(3);
  return /* glsl */ `
  #define BODY_X0 ${f(body.x0)}
  #define BODY_Z0 ${f(body.z0)}
  #define BODY_W ${f(body.x1 - body.x0)}
  #define BODY_L ${f(body.z1 - body.z0)}
  #define BODY_LEVEL ${f(body.level)}
  vec2 bodyWorld(vec2 uv) { return vec2(BODY_X0, BODY_Z0) + uv * vec2(BODY_W, BODY_L); }
  vec2 bodyUv(vec2 xz) { return (xz - vec2(BODY_X0, BODY_Z0)) / vec2(BODY_W, BODY_L); }
  ${body.floorGLSL}
  ${body.maskGLSL}
  `;
}

export class WaterSim {
  constructor(renderer, body) {
    this.renderer = renderer;
    this.body = body;
    const W = body.x1 - body.x0;
    const L = body.z1 - body.z0;
    const simW = body.simW;
    const simH = body.simH;
    const common = bodyGLSL(body);
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    };
    this.a = new THREE.WebGLRenderTarget(simW, simH, opts);
    this.b = this.a.clone();
    this.scale = body.scale ?? 0.06; // единица высоты симуляции → метры
    const delta = new THREE.Vector2(1 / simW, 1 / simH);

    const mat = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms: { tSim: { value: null }, ...uniforms } });

    this.drop = mat(
      /* glsl */ `
      uniform sampler2D tSim;
      uniform vec2 uCenter;
      uniform float uRadius;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec4 info = texture2D(tSim, vUv);
        vec2 d = (vUv - uCenter) * vec2(${W.toFixed(3)}, ${L.toFixed(3)});
        float drop = max(0.0, 1.0 - length(d) / uRadius);
        drop = 0.5 - cos(drop * 3.14159265) * 0.5;
        info.r += drop * uStrength;
        gl_FragColor = info;
      }`,
      {
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 0.1 },
        uStrength: { value: 0.1 },
      }
    );
    // Там, где воды нет (угол у стены), поверхность прибита к нулю — волна отражается, как от бортика.
    this.update = mat(
      /* glsl */ `
      uniform sampler2D tSim;
      uniform vec2 uDelta;
      varying vec2 vUv;
      ${common}
      void main() {
        vec4 info = texture2D(tSim, vUv);
        vec2 dx = vec2(uDelta.x, 0.0);
        vec2 dy = vec2(0.0, uDelta.y);
        float average = (
          texture2D(tSim, vUv - dx).r + texture2D(tSim, vUv + dx).r +
          texture2D(tSim, vUv - dy).r + texture2D(tSim, vUv + dy).r
        ) * 0.25;
        info.g += (average - info.r) * 2.0;
        info.g *= ${(body.damping ?? 0.994).toFixed(4)};
        info.r += info.g;
        info.r *= 0.9995;
        if (waterMask(bodyWorld(vUv)) < 0.5) info.rg = vec2(0.0);
        gl_FragColor = info;
      }`,
      { uDelta: { value: delta } }
    );
    this.normal = mat(
      /* glsl */ `
      uniform sampler2D tSim;
      uniform vec2 uDelta;
      uniform float uScale;
      varying vec2 vUv;
      void main() {
        vec4 info = texture2D(tSim, vUv);
        float hx = texture2D(tSim, vUv + vec2(uDelta.x, 0.0)).r;
        float hz = texture2D(tSim, vUv + vec2(0.0, uDelta.y)).r;
        vec3 ddx = vec3(uDelta.x * ${W.toFixed(3)}, (hx - info.r) * uScale, 0.0);
        vec3 ddz = vec3(0.0, (hz - info.r) * uScale, uDelta.y * ${L.toFixed(3)});
        info.ba = normalize(cross(ddz, ddx)).xz;
        gl_FragColor = info;
      }`,
      { uDelta: { value: delta }, uScale: { value: this.scale } }
    );
    this.quad = new FullScreenQuad(null);

    // Каустика: сетка поверхности воды; каждый узел — луч солнца, преломлённый
    // поверхностью и упавший на дно. Яркость = сжатие площади треугольника.
    const cw = Math.min(simW * 2, 768);
    const chh = Math.round((cw * L) / W);
    this.caustics = new THREE.WebGLRenderTarget(cw, chh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    const grid = new THREE.PlaneGeometry(2, 2, simW - 1, simH - 1);
    this.causticsMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        uniform sampler2D tSim;
        uniform vec3 uLightDir;
        uniform float uScale;
        varying vec3 vOld;
        varying vec3 vNew;
        varying float vLit;
        ${LAYOUT_GLSL}
        ${common}

        vec3 project(vec3 origin, vec3 ray, float floorY) {
          float t = (floorY - origin.y) / ray.y;
          return origin + ray * t;
        }

        void main() {
          vec2 uv = position.xy * 0.5 + 0.5;
          vec4 info = texture2D(tSim, uv);
          vec3 n = vec3(info.b, sqrt(max(1.0 - dot(info.ba, info.ba), 0.0)), info.a);
          vec2 xz = bodyWorld(uv);
          vec3 p = vec3(xz.x, BODY_LEVEL + info.r * uScale, xz.y);
          vec3 L = -uLightDir;
          float floorY = floorAt(xz);
          vec3 flatRay = refract(L, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
          vec3 ray = refract(L, n, 1.0 / 1.333);
          vOld = project(vec3(p.x, BODY_LEVEL, p.z), flatRay, floorY);
          vNew = project(p, ray, floorY);
          vLit = inBeamFramed(p, uLightDir) * waterMask(xz);
          gl_Position = vec4(bodyUv(vNew.xz) * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vOld;
        varying vec3 vNew;
        varying float vLit;
        void main() {
          float oldArea = length(dFdx(vOld)) * length(dFdy(vOld));
          float newArea = length(dFdx(vNew)) * length(dFdy(vNew));
          float ratio = oldArea / max(newArea, 1e-9);
          gl_FragColor = vec4(ratio * vLit, vLit, 0.0, 1.0);
        }`,
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
    const { x0, x1, z0, z1 } = this.body;
    const u = (x - x0) / (x1 - x0);
    const v = (z - z0) / (z1 - z0);
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

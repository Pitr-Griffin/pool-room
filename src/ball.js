import * as THREE from 'three';
import { ROOM, POOL, inPool } from './layout.js';

const G = 9.8;

function makeBallTexture() {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const colors = ['#e8463f', '#f6c22e', '#2f7fd6', '#f4f1ea', '#3dae5b', '#f08a2c'];
  colors.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i * w) / colors.length, 0, w / colors.length + 1, h);
  });
  // Белые «шапочки» на полюсах.
  g.fillStyle = '#f7f5ef';
  g.fillRect(0, 0, w, h * 0.07);
  g.fillRect(0, h * 0.93, w, h * 0.07);
  // Швы.
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < colors.length; i++) g.fillRect((i * w) / colors.length - 1, h * 0.07, 2, h * 0.86);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Ball {
  constructor() {
    this.r = 0.32;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.r, 48, 32),
      new THREE.MeshPhysicalMaterial({ map: makeBallTexture(), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 })
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.rotation.set(0.3, 0.8, 0.15);
    this.pos = new THREE.Vector3(0.75, this.r, -2.35);
    this.vel = new THREE.Vector3();
    this.wet = false;
    this.rippleT = 0;
    this.mesh.position.copy(this.pos);
  }

  kick(dir) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.vel.addScaledVector(flat, 4.2);
    this.vel.y += 2.4 + Math.max(dir.y, 0) * 3;
  }

  update(dt, player, fx) {
    const { pos, vel, r } = this;

    // Игрок толкает мяч телом.
    const dx = pos.x - player.pos.x;
    const dz = pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    const min = r + 0.3;
    if (d < min && d > 1e-4 && pos.y - r < player.ground + 1.2) {
      const nx = dx / d;
      const nz = dz / d;
      pos.x += nx * (min - d);
      pos.z += nz * (min - d);
      const rel = player.vel.x * nx + player.vel.z * nz - (vel.x * nx + vel.z * nz);
      if (rel > 0) {
        vel.x += nx * rel * 1.3;
        vel.z += nz * rel * 1.3;
        if (rel > 0.7) fx.thump(rel * 0.4);
      }
    }

    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < n; i++) this.step(dt / n, fx);

    // Качение.
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 1e-4) {
      const axis = new THREE.Vector3(vel.z, 0, -vel.x).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (sp * dt) / r);
      this.mesh.quaternion.premultiply(q);
    }
    this.mesh.position.copy(pos);
    if (this.wet) this.mesh.position.y += Math.sin(fx.time * 1.7) * 0.012;

    this.rippleT -= dt;
    if (this.wet && sp > 0.15 && this.rippleT < 0) {
      fx.ripple(pos.x, pos.z, 0.6);
      this.rippleT = 0.3;
    }
  }

  step(h, fx) {
    const { pos, vel, r } = this;
    vel.y -= G * h;

    const over = inPool(pos.x, pos.z);
    const sunk = pos.y - r < -0.04;

    // Вода: мяч лёгкий и всплывает.
    const s = over ? Math.min(Math.max((POOL.water - (pos.y - r)) / (2 * r), 0), 1) : 0;
    if (s > 0) {
      if (!this.wet && vel.y < -0.8) {
        fx.splash(Math.min(-vel.y * 0.4, 1.2));
        fx.ripple(pos.x, pos.z, 1.6);
      }
      vel.y += G * 6 * s * h;
      vel.y *= Math.exp(-3.5 * s * h);
      vel.x *= Math.exp(-0.7 * h);
      vel.z *= Math.exp(-0.7 * h);
    }
    this.wet = s > 0;

    pos.addScaledVector(vel, h);

    // Пол или дно.
    const floor = over ? POOL.bottom : 0;
    if (pos.y - r < floor) {
      pos.y = floor + r;
      if (vel.y < 0) {
        if (vel.y < -1) fx.thump(-vel.y * 0.3);
        vel.y = vel.y < -0.6 ? -vel.y * 0.55 : 0;
      }
      if (!this.wet) {
        vel.x *= Math.exp(-0.9 * h);
        vel.z *= Math.exp(-0.9 * h);
      }
    }

    // Стенки бассейна.
    if (sunk && over) {
      const k = Math.min(1, h * 14);
      if (pos.x < POOL.x0 + r) { pos.x += (POOL.x0 + r - pos.x) * k; vel.x = Math.abs(vel.x) * 0.5; }
      if (pos.x > POOL.x1 - r) { pos.x -= (pos.x - POOL.x1 + r) * k; vel.x = -Math.abs(vel.x) * 0.5; }
      if (pos.z < POOL.z0 + r) { pos.z += (POOL.z0 + r - pos.z) * k; vel.z = Math.abs(vel.z) * 0.5; }
      if (pos.z > POOL.z1 - r) { pos.z -= (pos.z - POOL.z1 + r) * k; vel.z = -Math.abs(vel.z) * 0.5; }
    }

    // Стены и потолок комнаты.
    const bounce = (axis, lo, hi) => {
      if (pos[axis] < lo) {
        pos[axis] = lo;
        if (vel[axis] < -0.6) fx.thump(-vel[axis] * 0.3);
        vel[axis] = Math.abs(vel[axis]) * 0.6;
      } else if (pos[axis] > hi) {
        pos[axis] = hi;
        if (vel[axis] > 0.6) fx.thump(vel[axis] * 0.3);
        vel[axis] = -Math.abs(vel[axis]) * 0.6;
      }
    };
    bounce('x', ROOM.x0 + r, ROOM.x1 - r);
    bounce('z', ROOM.z0 + r, ROOM.z1 - r);
    bounce('y', -10, ROOM.height - r);
  }
}

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EYE_HEIGHT, inPool, inShallow, inMeadow, groundAt, clampWalkable } from './layout.js';

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new PointerLockControls(camera, dom);
    this.pos = new THREE.Vector3(-3.1, 0, 2.3);
    this.vel = new THREE.Vector3();
    this.ground = 0;
    this.keys = {};
    this.stride = 0;
    this.bob = 0;
    this.wasInPool = false;
    camera.position.set(this.pos.x, EYE_HEIGHT, this.pos.z);
    camera.lookAt(0.4, 1.0, -1.8);

    addEventListener('keydown', (e) => (this.keys[e.code] = true));
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    addEventListener('blur', () => (this.keys = {}));
  }

  get locked() {
    return this.controls.isLocked;
  }

  // Возвращает события шагов: 'tile' | 'grass' | 'water' | 'enter' | 'exit'.
  update(dt) {
    const events = [];
    const k = this.keys;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    const wish = new THREE.Vector3();
    if (this.locked) {
      if (k.KeyW || k.ArrowUp) wish.add(fwd);
      if (k.KeyS || k.ArrowDown) wish.sub(fwd);
      if (k.KeyD || k.ArrowRight) wish.add(right);
      if (k.KeyA || k.ArrowLeft) wish.sub(right);
    }
    if (wish.lengthSq() > 0) wish.normalize();

    // В глубоком бассейне идти тяжело, по щиколотку — чуть медленнее обычного.
    const deep = inPool(this.pos.x, this.pos.z);
    const shallow = inShallow(this.pos.x, this.pos.z);
    const run = k.ShiftLeft || k.ShiftRight;
    const speed = deep ? 1.1 : shallow ? (run ? 2.6 : 1.65) : run ? 3.2 : 1.9;
    this.vel.lerp(wish.multiplyScalar(speed), 1 - Math.exp(-(deep ? 4 : shallow ? 7 : 9) * dt));
    this.pos.addScaledVector(this.vel, dt);

    clampWalkable(this.pos, 0.3);

    const nowPool = inPool(this.pos.x, this.pos.z) || inShallow(this.pos.x, this.pos.z);
    const target = groundAt(this.pos.x, this.pos.z);
    this.ground += (target - this.ground) * (1 - Math.exp(-(target < this.ground ? 9 : 7) * dt));
    if (nowPool && !this.wasInPool) events.push('enter');
    if (!nowPool && this.wasInPool) events.push('exit');
    this.wasInPool = nowPool;

    const sp = Math.hypot(this.vel.x, this.vel.z);
    const strideLen = nowPool ? 0.85 : 0.72;
    this.stride += sp * dt;
    if (this.stride > strideLen) {
      this.stride = 0;
      events.push(nowPool ? 'water' : inMeadow(this.pos.x, this.pos.z) ? 'grass' : 'tile');
    }
    this.bob += (sp * dt * Math.PI) / strideLen;
    const bobY = -Math.abs(Math.sin(this.bob)) * 0.03 * Math.min(sp / 1.9, 1);

    this.camera.position.set(this.pos.x, this.ground + EYE_HEIGHT + bobY, this.pos.z);
    return events;
  }
}

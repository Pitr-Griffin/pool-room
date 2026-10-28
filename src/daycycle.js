import * as THREE from 'three';

// Ключевые моменты цикла суток. t: 0 — рассвет (06:00), 0.25 — полдень, 0.5 — закат, 0.75 — полночь.
const K = (t, top, hor, light, li, amb, ai, stars) => ({
  t,
  top: new THREE.Color(top),
  hor: new THREE.Color(hor),
  light: new THREE.Color(light),
  li,
  amb: new THREE.Color(amb),
  ai,
  stars,
});

const KEYS = [
  K(0.0, '#7c93c9', '#f7c2a4', '#ffb27a', 1.6, '#d6d3e2', 0.55, 0.05),
  K(0.06, '#7fb0e8', '#f6dcc8', '#ffe0bd', 3.2, '#e4e9f2', 0.85, 0.0),
  K(0.25, '#4f9fec', '#b9daf7', '#fff7ea', 4.2, '#eef4ff', 1.0, 0.0),
  K(0.42, '#6aa3dc', '#ffe4c0', '#ffd9a6', 3.4, '#f3e9dc', 0.9, 0.0),
  K(0.48, '#5a6aa8', '#ffa264', '#ff8f4f', 2.6, '#ead0bb', 0.6, 0.0),
  K(0.54, '#2a3268', '#b07890', '#a8bcff', 0.2, '#9a92b4', 0.32, 0.35),
  K(0.62, '#070c22', '#182446', '#a8bcff', 0.7, '#4a5888', 0.17, 1.0),
  K(0.9, '#081028', '#1c2a4e', '#a8bcff', 0.6, '#4a5888', 0.17, 1.0),
  K(0.96, '#2c3a6c', '#a08aa8', '#a8bcff', 0.15, '#9a98b8', 0.33, 0.35),
];

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export class DayCycle {
  constructor(duration = 120) {
    this.duration = duration;
    this.t = 0.015;
    this.paused = false;
    this.s = {
      top: new THREE.Color(),
      hor: new THREE.Color(),
      light: new THREE.Color(),
      amb: new THREE.Color(),
      li: 0,
      ai: 0,
      stars: 0,
      sunDir: new THREE.Vector3(),
      moonDir: new THREE.Vector3(),
      lightDir: new THREE.Vector3(),
      lightInt: 0,
      day: 0,
      night: 0,
    };
    this.compute();
  }

  update(dt) {
    if (!this.paused) this.t = (this.t + dt / this.duration) % 1;
    this.compute();
  }

  compute() {
    const { t, s } = this;
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i];
    const b = KEYS[(i + 1) % KEYS.length];
    const bt = b.t <= a.t ? b.t + 1 : b.t;
    let f = (t - a.t) / (bt - a.t);
    f = f * f * (3 - 2 * f);

    s.top.copy(a.top).lerp(b.top, f);
    s.hor.copy(a.hor).lerp(b.hor, f);
    s.light.copy(a.light).lerp(b.light, f);
    s.amb.copy(a.amb).lerp(b.amb, f);
    s.li = a.li + (b.li - a.li) * f;
    s.ai = a.ai + (b.ai - a.ai) * f;
    s.stars = a.stars + (b.stars - a.stars) * f;

    // Солнце и луна ходят по дуге на той стороне неба, что видна из окна.
    const sa = t * Math.PI * 2;
    s.sunDir.set(-Math.cos(sa) * 0.75, Math.sin(sa) * 0.85, -0.55).normalize();
    const ma = sa - Math.PI;
    s.moonDir.set(-Math.cos(ma) * 0.6, Math.sin(ma) * 0.75, -0.65).normalize();

    s.lightDir.copy(s.sunDir.y > 0 ? s.sunDir : s.moonDir);
    s.lightInt = s.li * smooth(0.0, 0.1, s.lightDir.y);
    s.day = smooth(0.0, 0.25, s.sunDir.y);
    s.night = s.stars;
  }

  get hours() {
    return (6 + this.t * 24) % 24;
  }

  get phase() {
    const h = this.hours;
    if (h >= 5 && h < 11) return 'Утро';
    if (h >= 11 && h < 17) return 'День';
    if (h >= 17 && h < 21) return 'Вечер';
    return 'Ночь';
  }

  get clock() {
    const h = this.hours;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}

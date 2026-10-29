// Звуковые события ролика по сценарию (video/shot.js): когда и что звучит.
// Сам звук синтезирует video/soundtrack.js.
import { CRACK_AT, FADE, EVENTS, DRIPS, FALL } from './shot.js';

// Детерминированный генератор: одинаковое расписание и звук при каждом рендере.
export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function soundCues() {
  const rand = mulberry32(17);
  const breach = EVENTS.find((e) => e.kind === 'breach').t;
  const cues = [
    // До всплытия звук идёт как из-под воды; распахивается чуть раньше плеска.
    { t: 0, kind: 'underwater', end: breach - 0.02 },
    { t: breach, kind: 'breach' },
    ...DRIPS.map((d) => ({ t: d.t, kind: 'drip', amount: 0.7 + rand() * 0.3 })),
    { t: FALL.slip, kind: 'slip' },
    { t: FALL.start, kind: 'whoosh', dur: FALL.duration },
    { t: CRACK_AT, kind: 'impact' },
    { t: CRACK_AT, kind: 'crack' },
    { t: CRACK_AT, kind: 'muffle', end: FADE.end },
  ];
  return cues.sort((a, b) => a.t - b.t);
}

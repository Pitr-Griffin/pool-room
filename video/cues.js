// Звуковые события ролика по сценарию (video/shot.js): когда и что звучит.
// Эмбиент и птицы идут своим ходом в SoundScape; здесь — только привязанные к картинке звуки.
import { CRACK_AT, FADE, EVENTS } from './shot.js';

// Детерминированный генератор: одинаковое расписание при каждом рендере звука.
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
  const cues = [];
  const breach = EVENTS.find((e) => e.kind === 'breach').t;
  cues.push({ t: breach, kind: 'splash', amount: 1.4 });
  // Камера скользит низко над водой коридора — вода тихо плещется у стен.
  for (let t = 17.3; t < 26; t += 0.55 + rand() * 0.6) cues.push({ t, kind: 'lap', amount: 0.18 + rand() * 0.14 });
  cues.push({ t: CRACK_AT, kind: 'impact' });
  cues.push({ t: CRACK_AT, kind: 'crack' });
  cues.push({ t: CRACK_AT, kind: 'muffle', end: FADE.end });
  return cues.sort((a, b) => a.t - b.t);
}

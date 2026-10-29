// Какие кадры рендерить: чистая логика для video/render.mjs (без браузера и файлов).

// --preview — каждый 10-й кадр в половинном размере; --from/--to — диапазон кадров включительно;
// --audio — вместо кадров отрендерить звук.
export function parseArgs(argv, total) {
  const o = { preview: false, audio: false, from: 0, to: total - 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preview') o.preview = true;
    else if (a === '--audio') o.audio = true;
    else if (a === '--from') o.from = Number(argv[++i]);
    else if (a === '--to') o.to = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  o.from = Math.max(0, o.from);
  o.to = Math.min(total - 1, o.to);
  return o;
}

// Кадры по возрастанию (сцена умеет идти только вперёд), без уже готовых — так рендер
// продолжается после прерывания с того места, где остановился.
export function framesToRender({ from, to, preview, done }) {
  const step = preview ? 10 : 1;
  const list = [];
  for (let i = Math.ceil(from / step) * step; i <= to; i += step) if (!done.has(i)) list.push(i);
  return list;
}

export const frameName = (i) => `f_${String(i).padStart(4, '0')}.png`;

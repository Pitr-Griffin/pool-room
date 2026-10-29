// Звук ролика «Пролёт» — отдельно от игрового (там светлый аккорд и птицы, здесь они не к месту).
// Пустой кафельный зал: низкий гул, длинное эхо, редкие капли; начало — под водой.
// Всё синтезом, в OfflineAudioContext; случайности — из переданного генератора (повторяемо).

export function renderSoundtrack(ctx, cues, rand, duration) {
  const rate = ctx.sampleRate;

  // Шум и импульс эха (большой кафельный зал, ~3.5 с).
  const noise = ctx.createBuffer(1, rate * 3, rate);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = rand() * 2 - 1));
  const ir = ctx.createBuffer(2, Math.floor(rate * 3.6), rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const k = i / d.length;
      // Ранние отражения от кафеля погуще, хвост мягко тает.
      d[i] = (rand() * 2 - 1) * Math.pow(1 - k, 2.6) * (i < rate * 0.04 ? 1.6 : 1);
    }
  }

  // Мастер: общий фильтр (под водой и в конце закрыт), громкость, эхо.
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 18000;
  tone.connect(out);
  const dry = ctx.createGain();
  dry.connect(tone);
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  verb.connect(wet);
  wet.connect(tone);
  const send = (node, amount) => {
    node.connect(dry);
    if (amount > 0) {
      const g = ctx.createGain();
      g.gain.value = amount;
      node.connect(g);
      g.connect(verb);
    }
  };

  function noiseBurst({ t, type = 'bandpass', freq, freqEnd, q = 1, attack = 0.004, decay, peak, verbAmt = 0.4, pan = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f);
    f.connect(g);
    let node = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    send(node, verbAmt);
    src.start(t, rand() * 2, attack + decay + 0.05);
  }

  function sine({ t, freq, freqEnd, attack = 0.002, decay, peak, verbAmt = 0.4, pan = 0, type = 'sine' }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    let node = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    send(node, verbAmt);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // --- Фон: гул пустого зала и медленный низкий тон с биениями (тревожно, но тихо) ---
  const room = ctx.createBufferSource();
  room.buffer = noise;
  room.loop = true;
  const roomLp = ctx.createBiquadFilter();
  roomLp.type = 'lowpass';
  roomLp.frequency.value = 220;
  const roomG = ctx.createGain();
  roomG.gain.value = 0.05;
  room.connect(roomLp);
  roomLp.connect(roomG);
  send(roomG, 0.3);
  room.start(0);

  const drone = ctx.createGain();
  drone.gain.setValueAtTime(0.0001, 0);
  drone.gain.exponentialRampToValueAtTime(0.022, 8);
  send(drone, 0.6);
  for (const [f, type] of [[55, 'sine'], [57.3, 'sine'], [110.6, 'triangle']]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = type === 'triangle' ? 0.25 : 0.5;
    o.connect(g);
    g.connect(drone);
    o.start(0);
  }

  for (const c of cues) {
    const t = c.t;
    if (c.kind === 'underwater') {
      // Под водой: всё глухо, низкое гудение толщи и редкие пузырьки.
      tone.frequency.setValueAtTime(320, 0);
      const rumble = ctx.createBufferSource();
      rumble.buffer = noise;
      rumble.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, 0);
      g.gain.setValueAtTime(0.35, c.end - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, c.end + 0.25);
      rumble.connect(lp);
      lp.connect(g);
      g.connect(out);
      rumble.start(0);
      rumble.stop(c.end + 0.4);
      for (let b = 0.4; b < c.end - 0.2; b += 0.25 + rand() * 0.5) {
        sine({ t: b, freq: 380 + rand() * 500, freqEnd: 900 + rand() * 600, attack: 0.004, decay: 0.05, peak: 0.05, verbAmt: 0, pan: (rand() - 0.5) * 0.8 });
      }
      // Прорыв: звук распахивается за 0.12 с.
      tone.frequency.setValueAtTime(320, c.end);
      tone.frequency.exponentialRampToValueAtTime(18000, c.end + 0.12);
    } else if (c.kind === 'breach') {
      // Выныривание: плотный плеск и вода, стекающая с камеры.
      noiseBurst({ t, freq: 1400, freqEnd: 320, q: 0.7, attack: 0.01, decay: 0.55, peak: 0.42, verbAmt: 0.5 });
      noiseBurst({ t: t + 0.03, type: 'highpass', freq: 2600, attack: 0.008, decay: 0.3, peak: 0.12, verbAmt: 0.4 });
      for (let k = 0; k < 14; k++) {
        const tt = t + 0.15 + rand() * 1.4;
        sine({ t: tt, freq: 700 + rand() * 900, freqEnd: 1500 + rand() * 1200, attack: 0.002, decay: 0.04, peak: 0.025 + rand() * 0.03, verbAmt: 0.6, pan: (rand() - 0.5) * 1.2 });
      }
    } else if (c.kind === 'drip') {
      // Капля с потолка: короткий «плинк» с падающей высотой и тихий шлепок, длинное эхо.
      const f = 1050 + rand() * 650;
      const pan = (rand() - 0.5) * 1.1;
      sine({ t, freq: f * 1.35, freqEnd: f, attack: 0.001, decay: 0.09, peak: 0.09 * c.amount, verbAmt: 1.2, pan });
      noiseBurst({ t, freq: 2400, q: 2, attack: 0.001, decay: 0.03, peak: 0.04 * c.amount, verbAmt: 1, pan });
    } else if (c.kind === 'slip') {
      // Камера выскальзывает: скрип пластика о ладонь.
      noiseBurst({ t, freq: 1800, freqEnd: 900, q: 3, attack: 0.01, decay: 0.12, peak: 0.08, verbAmt: 0.3 });
      noiseBurst({ t: t + 0.18, freq: 2600, q: 4, attack: 0.005, decay: 0.06, peak: 0.05, verbAmt: 0.3 });
    } else if (c.kind === 'whoosh') {
      // Свист воздуха в падении.
      noiseBurst({ t, freq: 500, freqEnd: 2600, q: 1.2, attack: c.dur * 0.8, decay: c.dur * 0.2, peak: 0.07, verbAmt: 0.2 });
    } else if (c.kind === 'impact') {
      // Глухой удар корпуса о кафель, звон плитки и всплеск у кромки.
      noiseBurst({ t, type: 'lowpass', freq: 220, freqEnd: 70, q: 0.7, attack: 0.002, decay: 0.3, peak: 0.7, verbAmt: 0.5 });
      sine({ t, freq: 140, freqEnd: 48, attack: 0.002, decay: 0.32, peak: 0.45, verbAmt: 0.4 });
      noiseBurst({ t: t + 0.003, freq: 1900, q: 7, attack: 0.001, decay: 0.16, peak: 0.13, verbAmt: 0.9 });
      noiseBurst({ t: t + 0.01, freq: 1200, freqEnd: 360, q: 0.8, attack: 0.008, decay: 0.4, peak: 0.22, verbAmt: 0.6 });
      // Отскок — второй удар потише.
      noiseBurst({ t: t + 0.19, type: 'lowpass', freq: 260, q: 0.7, attack: 0.002, decay: 0.12, peak: 0.25, verbAmt: 0.5 });
    } else if (c.kind === 'crack') {
      // Трескается стекло объектива: серия высоких щелчков в первые 120 мс и тихий дребезг.
      for (let k = 0; k < 9; k++) {
        noiseBurst({ t: t + rand() * 0.12, type: 'highpass', freq: 3000 + rand() * 5000, q: 0.9, attack: 0.0008, decay: 0.012 + rand() * 0.02, peak: 0.1 + rand() * 0.08, verbAmt: 0.3 });
      }
      for (let k = 0; k < 5; k++) {
        sine({ t: t + 0.1 + rand() * 0.35, freq: 5200 + rand() * 2500, attack: 0.001, decay: 0.08 + rand() * 0.12, peak: 0.012, verbAmt: 0.5 });
      }
    } else if (c.kind === 'muffle') {
      // Звук глохнет, будто уши заложило; звон в ушах; к концу — тишина.
      tone.frequency.setValueAtTime(18000, t + 0.35);
      tone.frequency.exponentialRampToValueAtTime(380, t + 0.9);
      out.gain.setValueAtTime(0.9, t + 0.35);
      out.gain.linearRampToValueAtTime(0.45, t + 0.9);
      out.gain.linearRampToValueAtTime(0, c.end);
      const ring = ctx.createOscillator();
      ring.frequency.value = 3150;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t + 0.3);
      rg.gain.exponentialRampToValueAtTime(0.018, t + 1.0);
      rg.gain.linearRampToValueAtTime(0, c.end);
      ring.connect(rg);
      rg.connect(ctx.destination);
      ring.start(t + 0.3);
      ring.stop(c.end + 0.05);
    }
  }
  return ctx.startRendering();
}

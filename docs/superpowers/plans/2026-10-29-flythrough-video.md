# Пролёт — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ролик ~50 с (1920×1080, 30 fps): камера всплывает из бассейна, пролетает обе комнаты и коридор при таймлапсе 05:50 → 12:00, смотрит на столб света и падает, разбиваясь; в начале — стеклянный титр.

**Architecture:** Сценарий (`video/shot.js`) — чистые функции времени ролика: камера, время суток, события. Сцена в режиме `?video=1` рендерит ровно один детерминированный кадр по номеру; Playwright собирает кадры, звук рендерится через `OfflineAudioContext` по тем же событиям, HyperFrames накладывает титр, трещину и затемнение.

**Tech Stack:** three.js 0.160 (как в проекте), Node 26 (`node --test`), Playwright (Chromium), FFmpeg 9, HyperFrames 0.8 CLI.

**Spec:** `docs/superpowers/specs/2026-10-29-flythrough-video-design.md`

## Global Constraints

- Формат: 1920×1080, 30 fps, H.264 MP4; длительность ~50 с (`DURATION = 50`, 1500 кадров).
- Таймлапс 05:50 → 12:00, неравномерный: восход (солнце над горизонтом) в момент, когда камера смотрит в окно коридора (~21–25 с); 12:00 к 40 с. Облака дрейфуют в своём обычном времени, не ускоряются.
- Титр: «Pool Room» / «Две комнаты, коридор и вода. Выхода нет.», матовое стекло как `.glass` в `index.html`, появляется на 5 с, держится ~4 с.
- Звук только синтезом в Web Audio; никаких сторонних SFX без «да» пользователя. Музыку (pad) не менять.
- Интерактив без `?video=1` ведёт себя точно как раньше.
- Без стоковых картинок, глитчей, «вжухов»; трещина процедурная.
- Каждое изменение — коммит и пуш в `main`, сообщения на английском, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Оси веба: Y вверх, окна на z = −3 (комнаты) и z = 1.0 (коридор, `CORRIDOR.z0`); солнце встаёт со стороны −x/−z.

## Review Focus

- Кадр N, отрендеренный дважды (или после перезапуска рендера с середины), совпадает побайтно — иначе продолжение рендера даст скачки. Тест — Task 2, Step 4.
- Таймлапс монотонен и не «переливается» через 12:00 (монотонная интерполяция, не Catmull-Rom). Тест — Task 1.
- Камера не проходит сквозь стены, потолок и стекло: каждая ключевая точка и промежуточные позиции внутри `ROOM`/`CORRIDOR`/`ROOM2` или под водой бассейна. Тест — Task 1.
- Переход камеры через гладь воды (y = `POOL.water`) — без кадра, где ближняя плоскость режет поверхность пополам. Проверка по превью — Task 4.
- Звук совпадает с картинкой: плеск на 3,5 с, удар на 45,7 с ±1 кадр. Проверка — Task 7, Step 4.

---

### Task 1: Сценарий `video/shot.js`

**Files:**
- Create: `video/shot.js`, `video/shot.test.mjs`, `video/package.json`

**Interfaces:**
- Consumes: `ROOM`, `POOL`, `CORRIDOR`, `ROOM2`, `SHALLOW` из `../src/layout.js` (модуль без импортов, грузится и в Node, и в браузере). Тест строит боксы из этих же констант.
- Produces:
  - `export const DURATION = 50; export const FPS = 30;`
  - `export function hoursAt(t: number): number` — часы суток (05:50 = 5.8333).
  - `export function dayT(t: number): number` — значение для `DayCycle.t`: `((hoursAt(t) - 6) / 24 + 1) % 1`.
  - `export function cameraAt(t: number): { pos: [x,y,z], target: [x,y,z], roll: number, fov: number }`.
  - `export const EVENTS: Array<{ t: number, kind: 'breach' | 'impact', at: [x,y,z] }>` — `breach` на 3.5 с в `[1.2, -0.12, 0.2]`, `impact` на 45.7 с.
  - `export const TITLE = { in: 5, out: 9 }`, `export const CRACK_AT = 45.7`, `export const FADE = { start: 47, end: 49.5 }`.

- [ ] **Step 1: `video/package.json`** — `{ "type": "module", "private": true, "scripts": { "test": "node --test" }, "devDependencies": { "playwright": "^1" } }`; `npm install` в `video/`; `video/node_modules` в `.gitignore`.

- [ ] **Step 2: Тесты `video/shot.test.mjs`** (`node:test`, `node:assert`):
  - `hoursAt(0) ≈ 5.8333`, `hoursAt(40) ≈ 12`, `hoursAt(50) ≈ 12` (±0.01).
  - монотонность: для t от 0 до 50 шагом 1/30 `hoursAt(t+dt) >= hoursAt(t)`, и `hoursAt(t) <= 12.0001`.
  - восход в окне: `hoursAt(20) < 6.0` и `hoursAt(24) > 6.0`.
  - `cameraAt(0).pos[1] < -0.12` (под водой), `cameraAt(5).pos[1] > -0.12`.
  - внутри стен: для t шагом 0.1 до 44 с `pos` лежит в одном из боксов (с отступом 0.15 м от стен и потолка): комната 1 `x∈[-4,4], z∈[-3,3], y∈[-0.95,3.5]`, коридор `x∈[4,7], z∈[1.0,2.6], y∈[-0.12,2.4]`, комната 2 `x∈[7,15], z∈[-3,3], y∈[-0.12,3.5]`; ниже `y=-0.12` — только внутри бассейна `x∈[-1,3], z∈[-1.2,1.3]`.
  - финал: `cameraAt(50).pos[1] < 0.15` (лежит на полу), `|cameraAt(50).roll| ≈ π/2` (±0.2).
  - Run `cd video && npm test` → FAIL (модуля нет).

- [ ] **Step 3: Реализовать `video/shot.js`.**
  - Таймлапс — монотонный кубический сплайн (Fritsch–Carlson) по точкам `[t, часы]`: `[0, 5.8333] [16, 5.95] [21.5, 6.02] [26, 6.3] [33, 8.5] [40, 12] [50, 12]`.
  - Камера — центростремительный Catmull-Rom по `pos` и по `target`, время между ключами сглажено smoothstep-ом (ease in/out на остановках). Начальные ключи (`[t, pos, target]`), уточняются по превью в Task 5:
    ```
    [0,    [1.2,-0.70, 0.2], [1.2, 1.0, 0.15]]
    [3.5,  [1.2,-0.10, 0.2], [1.0, 1.5,-0.30]]
    [6,    [1.0, 1.40, 0.6], [-1.0,0.8,-2.5]]
    [11,   [-2.5,1.50, 1.5], [0.0, 0.5,-2.5]]
    [15,   [2.5, 1.30, 1.8], [6.0, 0.8, 1.8]]
    [19,   [5.0, 0.55, 1.8], [6.0, 0.6, 1.6]]
    [21,   [5.6, 0.60, 1.9], [5.0, 1.1,-5.0]]
    [25,   [5.9, 0.60, 1.9], [5.6, 1.0,-5.0]]
    [28,   [8.5, 1.20, 1.0], [12.0,0.5,-1.0]]
    [33,   [12.0,1.60, 1.5], [9.0, 0.3,-2.0]]
    [37,   [10.5,1.50,-0.5], [12.2,0.3,-1.2]]
    [40,   [11.5,1.30, 0.3], [12.2,3.5,-1.2]]
    [44,   [11.5,1.32, 0.3], [12.2,3.5,-1.2]]
    ```
  - Падение 44 → 45.7 с: свободное падение `y = y0 - 4.9·τ²` от `[11.5,1.32,0.3]` с небольшим горизонтальным сносом к кромке мелкого бассейна `[11.62, 0.05, 0.2]`; одновременно `target` вращается (кувырок ~1,25 оборота по тангажу), `roll` → `π/2`. После 45.7 с камера неподвижна в конечной позе.
  - `fov`: 60 везде.

- [ ] **Step 4:** `cd video && npm test` → все PASS.

- [ ] **Step 5: Commit** — `git add video/ .gitignore && git commit -m "Video: shot timeline — camera path, dawn-to-noon timelapse, events"` + push.

---

### Task 2: Видео-режим сцены (`?video=1`)

**Files:**
- Modify: `src/main.js` (цикл кадров, интерфейс, размер), `src/effects.js:106-200` (случайность пыли/светлячков), `src/audio.js` не трогать здесь.
- Create: `src/random.js`

**Interfaces:**
- Consumes: `DURATION`, `FPS`, `dayT`, `cameraAt`, `EVENTS` из `video/shot.js` (импорт `../video/shot.js` — сервер отдаёт весь репозиторий).
- Produces: `window.poolRoomVideo = { ready: Promise<void>, renderFrame(i: number): void, frameCount: number }`. После `renderFrame(i)` холст содержит кадр i (`preserveDrawingBuffer: true` в видео-режиме).

- [ ] **Step 1: `src/random.js`** — `export function seeded(seed: number): () => number` (mulberry32, как в `meadow.js`) и `export let rand = Math.random; export function useSeed(seed)` — переключает `rand` на seeded. В `effects.js` заменить `Math.random` на `rand()` (пыль, светлячки, брызги). `useSeed(1)` вызывается до создания эффектов, если `?video=1`.

- [ ] **Step 2: Видео-режим в `main.js`.** `const VIDEO = new URLSearchParams(location.search).has('video');` При `VIDEO`:
  - размер холста фиксированный 1920×1080 (переопределить `innerWidth/innerHeight` в коде через `W/H`), `pixelRatio = 1`, `preserveDrawingBuffer: true`; интерфейс (`#intro`, `#panel`, `#crosshair`) скрыт; звук не стартует.
  - `requestAnimationFrame`-цикл не запускается; `frame(dt)` принимает шаг извне.
  - `renderFrame(i)`: если `i` не равен последнему отрендеренному + 1 — пересобрать состояние, прогнав симуляцию (`frame` без рендера) с нуля до `i` (вода, брызги, трава зависят от истории); затем `day.paused = true; day.t = dayT(i / FPS)`, камера из `cameraAt(i / FPS)` (`position`, `lookAt(target)`, затем поворот вокруг своей оси Z на `roll`, `fov`), события из `EVENTS` с `t` в `[(i-1)/FPS, i/FPS)` → `breach`: `water.ripple(x,z,3,0.35)` + `splash.burst(x, POOL.water, z, 180, 2.4)`; `frame(1/FPS)` с рендером. Кубические карты обновлять каждый кадр.
  - `poolRoomVideo.ready` резолвится после загрузки `room.glb` и lightmaps.

- [ ] **Step 3:** Без `?video=1` открыть превью `pool-room`, убедиться: интерфейс, ходьба и время работают как раньше, ошибок в консоли нет.

- [ ] **Step 4: Детерминизм.** В браузере на `?video=1`: `renderFrame(120)`, хеш `canvas.toDataURL()` (SHA-256 через `crypto.subtle`); перезагрузка; снова `renderFrame(120)` — хеши равны. Затем `renderFrame(119); renderFrame(120)` в одной сессии — тот же хеш.

- [ ] **Step 5: Commit** — `"Video mode: deterministic frame-by-frame rendering driven by the shot timeline"` + push.

---

### Task 3: Видео-пресет облаков

**Files:**
- Modify: `src/sky.js` (шейдер облаков и `createSky`), `src/main.js` (включение в видео-режиме)

**Interfaces:**
- Produces: `createSky(mainCamera, { video = false } = {})`. В видео-режиме: шагов raymarching для основной камеры ×3 к текущему HQ, масштаб шума кучевых ×1.6 (крупнее), плотность ×1.3, скорость дрейфа ×2.5. В отражениях и кубических картах — текущий HQ (а не упрощённый).

- [ ] **Step 1:** Прочитать шейдер облаков в `src/sky.js`, вынести количество шагов, масштаб, плотность и скорость в uniforms (`uSteps`, `uCloudScale`, `uDensity`, `uDrift`) со значениями, дающими ровно текущую картинку по умолчанию.
- [ ] **Step 2:** Интерактив без `?video=1`: скриншот окна до и после правки на одинаковом `day.t` (пауза) — визуально одинаковы.
- [ ] **Step 3:** Видео-режим: `renderFrame(690)` (23 с, камера у окна коридора) — облака крупные, объёмные, освещены низким солнцем; показать кадр пользователю.
- [ ] **Step 4: Commit** — `"Sky: video quality preset — more raymarch steps, bigger denser cumulus"` + push.

---

### Task 4: Подводный вид

**Files:**
- Modify: `src/water.js` (поверхность снизу), `src/effects.js` (`GradeShader` или новый `UnderwaterShader`), `src/main.js` (включение, когда камера под водой бассейна)

**Interfaces:**
- Produces: `uUnder` (0/1) в шейдере воды и в постобработке; включается, когда `camera.position.y < POOL.water` и камера внутри бассейна.

- [ ] **Step 1:** Гладь видна снизу: материал воды `side: DoubleSide`; для нижней стороны — преломлённый вид вверх (тот же `tRefract`, сдвиг по нормалям волн), полное внутреннее отражение за критическим углом (~48,6°) — дно/стены бассейна вместо неба.
- [ ] **Step 2:** Постобработка под водой: поглощение с расстоянием (по `tDepth`) в голубовато-зелёный, лёгкая дрожь UV по синусам, лёгкое падение контраста; плавное выключение за 2 кадра на прорыве.
- [ ] **Step 3:** Превью кадров 0, 60, 100, 105, 110, 130 — под водой читаются ступени и гладь, на прорыве нет кадра с разрезанной пополам поверхностью (при необходимости ближняя плоскость камеры 0.01 в этот момент). Показать пользователю.
- [ ] **Step 4: Commit** — `"Water: underwater view for the flythrough opening"` + push.

---

### Task 5: Захват кадров `video/render.mjs`

**Files:**
- Create: `video/render.mjs`

**Interfaces:**
- Consumes: `window.poolRoomVideo` (Task 2), сервер `setup/serve.ps1` на порту 8123.
- Produces: CLI `node video/render.mjs [--preview] [--from N] [--to M]` → `renders/frames/flythrough/f_####.png` (полный) или `renders/frames/flythrough_preview/` (`--preview`: каждый 10-й кадр, 960×540 через масштаб скриншота). После полного рендера: `renders/flythrough_scene.mp4` через `ffmpeg -framerate 30 -i f_%04d.png -c:v libx264 -crf 14 -pix_fmt yuv420p`.

- [ ] **Step 1:** Chromium через Playwright с `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`, viewport 1920×1080; открыть `http://localhost:8123/?video=1`, дождаться `ready`; для каждого i вызвать `renderFrame(i)`, снять кадр `canvas.toDataURL('image/png')` → файл. Уже существующие кадры пропускать (продолжение после прерывания). Печатать прогресс и ETA.
- [ ] **Step 2:** `node video/render.mjs --preview` → 150 кадров; собрать контактный лист `ffmpeg ... tile=10x15` в `renders/flythrough_preview.jpg`, показать пользователю.
- [ ] **Step 3:** По превью подправить ключи `cameraAt`/таймлапса в `video/shot.js` (тесты Task 1 должны оставаться зелёными), повторить Step 2 до согласия пользователя.
- [ ] **Step 4: Commit** — `"Video: frame capture script with resumable rendering and preview sheet"` + push.

---

### Task 6: Звук

**Files:**
- Modify: `src/audio.js` (контекст и время извне, новые звуки)
- Create: `video/audio.html` (страница для офлайн-рендера), логику запуска добавить в `video/render.mjs --audio`

**Interfaces:**
- Consumes: `EVENTS`, `DURATION`, `CRACK_AT`, `FADE` из `video/shot.js`.
- Produces: `new SoundScape({ ctx?: BaseAudioContext })`; методы событий принимают `at?: number` (секунды контекста) вместо `currentTime`; новые `impact(at)` (глухой удар пластика о кафель: низкий шумовой импульс 80–200 Гц + короткий резонанс кафеля ~1,8 кГц) и `crack(at)` (хруст стекла: 6–10 коротких ВЧ-щелчков 3–8 кГц в первые 120 мс + тихий дребезг); `muffle(at, seconds)` — lowpass мастера с 20 кГц до 400 Гц и вниз громкость, затем обрыв в ноль к `FADE.end`. `→ renders/flythrough.wav` (48 кГц, стерео).

- [ ] **Step 1:** `SoundScape` принимает внешний контекст; без аргумента — поведение интерактива не меняется (проверить в превью: звук есть, шаги и плеск работают).
- [ ] **Step 2:** `video/audio.html`: `OfflineAudioContext(2, 48000·DURATION, 48000)`, Math.random → seeded; эмбиент и вода как в игре, птицы по `day` из таймлапса; `splash(0.9)` на `breach`; лёгкие всплески воды, пока камера низко над коридором (t 17–26 с); `impact` + `crack` на `CRACK_AT`; `muffle(CRACK_AT, …)`. Результат кодируется в WAV и отдаётся в Playwright → файл.
- [ ] **Step 3:** Прослушать (отдать файл пользователю). Если удар/хруст звучат дёшево — спросить пользователя про CC0-сэмпл, ничего не ставить без «да».
- [ ] **Step 4:** `hyperframes audio` или ffmpeg `silencedetect`/`astats` — пик удара в 45,7 с ±33 мс, плеска в 3,5 с ±33 мс, тишина после 49,5 с.
- [ ] **Step 5: Commit** — `"Audio: offline soundtrack for the flythrough — breach splash, impact, glass crack, muffle"` + push.

---

### Task 7: Монтаж в HyperFrames и финальный рендер

**Files:**
- Create: `video/composition/` (проект `hyperframes init`), `video/composition/index.html`

**Interfaces:**
- Consumes: `renders/flythrough_scene.mp4`, `renders/flythrough.wav`, `TITLE`, `CRACK_AT`, `FADE` (значения переносятся в композицию константами).
- Produces: `renders/pool_room_flythrough.mp4`.

- [ ] **Step 1:** Перед работой загрузить скилл `hyperframes:hyperframes` и `hyperframes:hyperframes-cli`; `hyperframes init` в `video/composition`.
- [ ] **Step 2:** Композиция: фоновое видео на весь кадр; титр — карточка со стеклом как `.glass` из `index.html` (blur, полупрозрачный фон, тонкая рамка), «Pool Room» крупно и строка описания, въезд снизу с затуханием на 5 с, уход на 9 с; трещина — процедурный SVG (лучи из точки удара в нижней трети + кольцевые трещины, лёгкая рефракция через `backdrop-filter`/смещение), появляется на `CRACK_AT` за 2 кадра; затемнение в чёрное `FADE.start → FADE.end`; звук `flythrough.wav`.
- [ ] **Step 3:** `hyperframes check` без ошибок; `hyperframes snapshot` на 6 с, 23 с, 42 с, 46 с, 49 с — показать пользователю.
- [ ] **Step 4:** Полный рендер кадров (`node video/render.mjs`, в фоне, ~20–40 мин), склейка, затем `hyperframes render` → `renders/pool_room_flythrough.mp4`. `ffprobe`: 1920×1080, 30 fps, 50 с ±0,1, есть аудиодорожка.
- [ ] **Step 5:** Отдать ролик пользователю; обновить `docs/HISTORY.md` и `CLAUDE.md` (как перерендерить пролёт); commit `"Flythrough video: title card, lens crack, fade, final render"` + push. Ролик в репозиторий — только если весит меньше 50 МБ (иначе спросить).

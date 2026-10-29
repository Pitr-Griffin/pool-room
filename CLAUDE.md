# Pool Room — контекст для Claude Code

Этот файл Claude Code читает автоматически в любой сессии и на любом компьютере. Полная история работы — в [docs/HISTORY.md](docs/HISTORY.md), словарь терминов — в [GLOSSARY.md](GLOSSARY.md).

## Что это

Лиминальная комната в стиле «pool rooms»: неглубокий бассейн с прозрачной водой (максимум по пояс, ступени из кафеля), широкое окно, под ним полоска луга с мелкими полевыми цветами, большой разноцветный надувной мяч. Две версии:

- **Веб-версия** (`index.html`, `src/`, three.js 0.160 через importmap) — по комнате можно ходить. Опубликована на https://pitr-griffin.github.io/pool-room/.
- **Blender-версия** (`blender/pool_room.py`) — фотореалистичные кадры и видео в Cycles. Готовые кадры в `renders/`.

## Договорённости с пользователем

- Общаться по-русски, коротко и по делу.
- Каждое изменение сразу коммитить и пушить на GitHub (`Pitr-Griffin/pool-room`, ветка `main`). Коммиты заканчивать строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Графику делать максимально сильной: компьютер мощный (RTX 4060), полигонов и сэмплов можно не жалеть. Референсы — дримкор pool rooms со столбами света и глянцевым кафелем, «понять настроение, а не копировать».
- Никакого «нейрослопа»: всё должно выглядеть как сделанное человеком. Сторонние плагины и скиллы — только с большим числом звёзд на GitHub и только после «да» пользователя.
- Пароли, ключи и платёжные данные пользователь вводит сам.

## Как работать

- **Превью веб-версии:** конфигурация `pool-room` в `.claude/launch.json` (PowerShell-сервер `setup/serve.ps1`, порт 8123). Отладочный объект в консоли: `window.poolRoom` (day, player, camera, composer, scene, water…).
- **Blender 5.2** запускать напрямую: `blender --background --factory-startup --python blender/pool_room.py -- --time noon --camera CameraHero --samples 1024 --res 2560x1440`. Все кадры сразу — `blender/render_all.ps1`. Видео — `--video`, склейка — `blender/encode_video.py`.
- **Запечённый свет для веба:** `blender --background --factory-startup --python blender/bake_web.py -- --size 2048 --samples 512` (≈5 минут) — пересобирает `assets/room.glb` и `assets/lightmap_*.exr`. Нужно после любых изменений геометрии комнаты.
- Геометрия общая для обеих версий: размеры в `src/layout.js` и константы в `blender/pool_room.py` (окно, бассейн, луг, световые колодцы `SKYLIGHTS`, глубина шахт `WELL = 0.45`, коридор `CORRIDOR`/`CWINDOW`, вторая комната `ROOM2_DX = 11`, мелкий бассейн `SHALLOW`) должны совпадать. Оси: в Blender Z вверх и окно на y=+3, в вебе Y вверх и окно на z=−3 (y Blender = −z веба).
- Две комнаты: первая (кафель, глубокий бассейн) запечена в `assets/lightmap_<время>.exr`, коридор со второй (луговой) — в `assets/lightmap_2_<время>.exr`. Вода — два водоёма (`POOL_BODY`, `SHALLOW_BODY` в `src/water.js`) с общим кадром преломления.
- Настроение сцены — тихая тревога «отсюда не выбраться», без хоррора; музыку не трогать.
- **MCP for Blender** (сервер `blender` в Claude Code) — для правок вживую в открытом Blender: N → вкладка «MCP for Blender» → Start MCP Server.

## Новый компьютер

Запустить `setup/setup.ps1` (см. [setup/README.md](setup/README.md)) — он ставит Blender, Node.js, FFmpeg, Python, uv, Claude Code, все плагины и скиллы, видеоинструменты и переносит заметки памяти.

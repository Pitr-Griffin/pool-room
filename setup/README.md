# Перенос на другой компьютер

1. Скачать проект:

   ```bash
   git clone https://github.com/Pitr-Griffin/pool-room.git
   ```

2. В папке проекта запустить установку (PowerShell, один раз; Windows попросит права администратора для некоторых программ):

   ```bash
   powershell -ExecutionPolicy Bypass -File setup\setup.ps1
   ```

   Ставит: Git, GitHub CLI, **Blender 5.2.3**, Node.js, FFmpeg, Python 3.12, uv, yt-dlp, Claude Code, плагины (HyperFrames, GSAP, taste-skill, визуальные скиллы Anthropic), скиллы (three.js, Remotion, product-launch-motion, motion-design, Diffusion Studio, video-use), OpenMontage, Diffusion Studio, MCP for Blender — и копирует заметки памяти Claude из `setup/memory`.

   Только Blender и веб-версия, без видеоинструментов: добавить `-SkipVideo`.

3. Вручную:
   - `gh auth login` — войти в GitHub, чтобы пушить изменения;
   - Diffusion Studio — пройти первую настройку, выбрать Claude Code;
   - ключ ElevenLabs для video-use — только если нужен монтаж по речи.

4. Открыть папку проекта в Claude Code и написать, что делаем дальше. Контекст проекта Claude прочитает из `CLAUDE.md`, историю — из `docs/HISTORY.md`.

## Работа на двух компьютерах

Перед началом работы — `git pull`, после — изменения уходят на GitHub (Claude пушит сам). Заметки памяти живут на каждом компьютере отдельно; если на одном из них появилось что-то важное, попроси Claude обновить `setup/memory` и `CLAUDE.md` в репозитории.

## Почему плагины не лежат в репозитории

Скрипт скачивает их с GitHub при установке: так всегда ставятся свежие версии, у каждого инструмента своя лицензия (у OpenMontage — AGPL), а сами плагины весят сотни мегабайт.

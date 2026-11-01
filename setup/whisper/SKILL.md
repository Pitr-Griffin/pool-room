---
name: whisper
description: Local speech and song transcription with faster-whisper large-v3 on the GPU (already installed). Use whenever the user asks to transcribe, hear, or get lyrics, words, subtitles or timestamps from any audio or video file, or when you need to know what is sung or said in a track.
---

# Whisper (локально, на видеокарте)

Установлено в `C:\Users\hah17\tools\whisper` (своё окружение `.venv`, faster-whisper + CUDA-библиотеки; модель large-v3 лежит в кэше HuggingFace). Интернет не нужен.

```bash
"C:/Users/hah17/tools/whisper/.venv/Scripts/python.exe" "C:/Users/hah17/tools/whisper/transcribe.py" ФАЙЛ --lang ru
```

Опции:
- `--lang ru` — язык (без него определяется сам);
- `--words` — таймкоды по словам;
- `--out file.srt|.json|.txt` — сохранить (формат по расширению);
- `--vad` — вырезать тишину: только для длинной речи с паузами. **На песнях не включать** — Whisper начинает галлюцинировать («Редактор субтитров…»);
- `--model small|medium|large-v3`, `--cpu`.

Читает всё, что читает ffmpeg (wav, mp3, mp4, mkv…). Скорость: ~30 с песни за ~15–20 с вместе с загрузкой модели.
Длинные файлы запускать в фоне (`run_in_background`). Видеокарту делит с Blender — если идёт рендер, будет медленнее.

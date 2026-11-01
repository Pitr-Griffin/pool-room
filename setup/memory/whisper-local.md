---
name: whisper-local
description: "Local Whisper (faster-whisper large-v3, GPU) installed for transcribing songs/speech — use it in every chat; global skill \"whisper\""
metadata:
  node_type: memory
  type: reference
  originSessionId: b4a7e8ca-53fd-46a7-87e4-72a32c5250d5
  modified: 2026-11-01T12:35:55.758Z
---

User asked (2026-11-01) to have Whisper available in this and all future chats. Installed at `C:\Users\hah17\tools\whisper` (.venv with faster-whisper 1.2.1 + nvidia cublas/cudnn wheels), script `transcribe.py`; global skill `~/.claude/skills/whisper/SKILL.md` documents usage.

Gotchas: fresh PyAV breaks faster-whisper (`metadata_errors` kwarg) — script decodes audio via ffmpeg instead. VAD filter on songs makes Whisper hallucinate, so it's off by default (`--vad` only for speech). Second PC: not installed yet — repeat with `uv venv` + `uv pip install faster-whisper nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"` and copy the script/skill.

Related: [[rassvety-clip-project]] (older "ears" = Qwen2-Audio).

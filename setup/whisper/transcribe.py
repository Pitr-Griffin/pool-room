"""Расшифровка речи и песен локально: faster-whisper large-v3 на видеокарте (модель уже в кэше HuggingFace).

    C:/Users/hah17/tools/whisper/.venv/Scripts/python.exe C:/Users/hah17/tools/whisper/transcribe.py ФАЙЛ [опции]

Опции:
  --lang ru          язык (по умолчанию определяется сам)
  --words            таймкоды по словам
  --out ПУТЬ         куда сохранить; расширение задаёт формат: .txt, .srt, .json (по умолчанию — только в консоль)
  --model large-v3   другая модель (small, medium, large-v3...)
  --cpu              без видеокарты
  --vad              вырезать тишину (для длинной речи с паузами; на песнях НЕ включать — будут галлюцинации)

Работает с любым аудио и видео, которое читает ffmpeg (wav, mp3, mp4, mkv...).
"""
import argparse, json, os, pathlib, subprocess, sys
import numpy as np

# DLL cuBLAS/cuDNN из pip-пакетов nvidia-* — подключаем, чтобы ctranslate2 нашёл их на Windows
venv = pathlib.Path(sys.executable).resolve().parent.parent
for sub in ("cublas", "cudnn"):
    d = venv / "Lib/site-packages/nvidia" / sub / "bin"
    if d.is_dir():
        os.add_dll_directory(str(d))
        os.environ["PATH"] = str(d) + os.pathsep + os.environ["PATH"]

from faster_whisper import WhisperModel


def ts(s, sep=","):
    h, m = int(s // 3600), int(s % 3600 // 60)
    return f"{h:02d}:{m:02d}:{s % 60:06.3f}".replace(".", sep)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--lang")
    ap.add_argument("--words", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--vad", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    dev, ct = ("cpu", "int8") if a.cpu else ("cuda", "float16")
    model = WhisperModel(a.model, device=dev, compute_type=ct)
    # звук декодирует ffmpeg (свежая PyAV несовместима с faster-whisper): 16 кГц, моно, float32
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", a.file, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, np.float32)
    # фильтр тишины на песнях вырезает вокал вместе с музыкой → галлюцинации («Редактор субтитров…»), поэтому выключен
    segs, info = model.transcribe(audio, language=a.lang, word_timestamps=a.words, vad_filter=a.vad, beam_size=5,
                                  condition_on_previous_text=False)
    print(f"# язык: {info.language} ({info.language_probability:.2f}), длина {info.duration:.1f} с", file=sys.stderr)
    rows = []
    for s in segs:
        row = {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        if a.words:
            row["words"] = [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()} for w in s.words]
        rows.append(row)
        print(f"[{ts(s.start, '.')} → {ts(s.end, '.')}] {row['text']}", flush=True)
    if a.out:
        out = pathlib.Path(a.out)
        if out.suffix == ".json":
            out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        elif out.suffix == ".srt":
            out.write_text("\n".join(f"{i}\n{ts(r['start'])} --> {ts(r['end'])}\n{r['text']}\n" for i, r in enumerate(rows, 1)), encoding="utf-8")
        else:
            out.write_text("\n".join(r["text"] for r in rows) + "\n", encoding="utf-8")
        print(f"# сохранено: {out}", file=sys.stderr)


if __name__ == "__main__":
    main()

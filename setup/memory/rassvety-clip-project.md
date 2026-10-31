---
name: rassvety-clip-project
description: "Music video for the song «Где встречают рассветы» — private repo, prototypes, how the song was \"heard\""
metadata:
  node_type: memory
  type: project
  originSessionId: b4a7e8ca-53fd-46a7-87e4-72a32c5250d5
  modified: 2026-10-31T23:24:53.665Z
---

Repo `Pitr-Griffin/rassvety-clip` (private), local `C:\Users\hah17\rassvety-clip`. Song is Russian pop-rock, B minor; about a path with no way back and finding strength inside — NOT about dawns (user was angry when I took the title literally).

State 2026-10-30 night: best prototype is `prototypes/kino` (lit 3D paper in three.js: tunnel → contour rings → tile road → petal mandala → paper lotus; DOF, bloom, grain, light-leak transitions, 120fps→30 motion blur). Videos in GitHub release `prototypes-2026-10-30`. User rejected: dawn/lake, hero figure, forest, flowers, crystals, website-like editorial layouts, Blender geode. Wants expensive-looking motion graphics, mostly graphics (no real footage), male hero if any. Open items in tasks/todo.md.

"Ears": Diffusion Studio sign-in is broken on this PC (deep link never returns); local Qwen2-Audio-7B in `C:\Users\hah17\tools\ears` works (HF downloads stall with Xet — set `HF_HUB_DISABLE_XET=1`). CLAP gave flat output (likely bad weights), don't trust it.

Related: [[wait-for-go]], [[pool-room-project]].

- 2026-10-30: Blender procedural "Трасса" rejected as cheap mobile-game look. Switched to FLUX.1-schnell stills (GGUF, user logged in to HF) + animation. User allows a *slight* AI look — quality over purity; still filter obvious slop (broken cars, garbled text).
- 2026-11-01: direction is now variant A — winter 90s, one cherry LADA 2107 (Sketchfab), Blender Cycles. Whole clip drafted: `prototypes/clip/sections.py` (9 parts) + `prototypes/zima/scene.py` (3rd chorus), assembled by `tools/assemble.py` (`--fx` = motion-graphics version via `tools/fx.py`). Draft videos in GitHub release `draft-2026-11-01`. Done per user: no camera shake at all, tinted windows, Sketchfab props (pumps, KAMAZ plough, oncoming GAZ-24/VAZ-2104/Moskvich, CC-BY-NC moose → clip non-commercial). Next: user feedback on fx v2, then 1080p final overnight (only on user's OK). Models in `assets/sketchfab/*.glb` are gitignored — re-download on the other PC (links in CREDITS.md).
- Slop markers per user: car big & centered, HDR/oversharp glossy look (e.g. Kontext Volga). Less slop: car small/far in fog, muted single tone. Always run tools/filmify.py (soften, lift blacks, desaturate, grain, teal-fog grade). Same car across shots via FLUX Kontext from a reference; short single edits work, long ones get ignored.

---
name: pool-room-project
description: "Pool Room liminal scene: state of the web (three.js) and Blender versions, what was done, what's next"
metadata:
  node_type: memory
  type: project
  originSessionId: b460bb95-f4f2-4056-84fc-2390b82ea13b
  modified: 2026-10-29T09:46:56.293Z
---

Project in C:\Users\hah17\clod, repo github.com/Pitr-Griffin/pool-room, live on GitHub Pages (https://pitr-griffin.github.io/pool-room/). The user wants every change committed and pushed automatically. Talk to the user in Russian.

State as of 2026-10-29:
- **Web version** (src/, three.js r160): walkable room with a GPU-simulated pool, caustics, reflections, splashes, grass that flattens underfoot, wet footprints, ball, 2-minute day cycle with a pause button. Indirect light is baked in Blender (assets/room.glb + lightmap_{morning,day,evening,night}.exr, via blender/bake_web.py). Recent additions: two ceiling skylight wells (SKYLIGHTS/WELL=0.45 in src/layout.js and blender/pool_room.py), depth-aware volumetric shafts, 40k micro dust motes visible only in light beams, fireflies over the meadow at night, bloom threshold 1.6 (lower values gave a milky veil).
- **Blender version** (blender/pool_room.py): photoreal Cycles scene with tile micro-displacement, skylights, haze. Final 2560×1440 renders are in renders/ (noon_camerahero, noon_cameralow, glint_camerapool, evening_camerahero, night_cameralow, day_camera) and pool_room_glint.mp4. The renders were made with WELL=1.1; the .blend and scripts now use 0.45.
- Second room added 2026-10-29: corridor (flooded ankle-deep, floor-to-ceiling window along the sun side) leads to a meadow-floored twin room with an ankle-deep pool that reaches the south wall. Outside the windows is sky only (clouds below the horizon too, no ground).
- **Flythrough video** done 2026-10-29: renders/pool_room_flythrough.mp4 (50 s, not in git), pipeline in video/ (shot.js, render.mjs, cues.js, audio.html, composition/). How to re-render: CLAUDE.md.
- **Mood:** the user wants quiet unease, "you can't get out, no way back", not relaxation and not horror. Keep the room ordinary; get the feeling from atmosphere (grading, emptiness, endless sky). Don't touch the music.
- Dust in beams must be **matte**: tiny, soft, steady, below the bloom threshold, no glints or twinkle (the user rejected both big "firefly-like" motes and sparkling ones).
- The user keeps pushing for "even better graphics"; reference mood is dreamcore pool rooms with light shafts and glossy tiles ("understand, don't copy").

**Why:** Long-running creative project; the user expects continuity between sessions.
**How to apply:** Read README.md and GLOSSARY.md first, check `git log` for recent work, preview the web version via `.claude/launch.json` ("pool-room"). Related: [[blender-direct-cli]], [[installed-video-tools]], [[skill-install-policy]].

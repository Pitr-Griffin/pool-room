# SDD ledger — plan: docs/superpowers/plans/2026-10-29-flythrough-video.md
Setup: Ruling: work directly on main, no worktree — CLAUDE.md user agreement says commit and push every change to main — cost if wrong: history on main instead of a branch
Pre-flight: T2 consumes T1 shot.js (DURATION, FPS, dayT, cameraAt, EVENTS) — matches T1 Produces
Pre-flight: T5 consumes T2 window.poolRoomVideo {ready, renderFrame, frameCount} — matches
Pre-flight: T6 consumes T1 EVENTS, DURATION, CRACK_AT, FADE — matches
Pre-flight: T7 consumes T1 TITLE, CRACK_AT, FADE + T5 mp4 + T6 wav — matches
Task 1: complete (commits 5a6ebf9..85041c5, tests: bash -c 'cd video && npm test' → ℹ duration_ms 98.985)
Task 2: Ruling: no canvas-size override — Playwright viewport 1920x1080 @1x sets innerWidth/innerHeight — cost if wrong: frames at the wrong size when opened in a normal browser
Task 2: Ruling: Math.random replaced globally in video mode (GTAO noise etc.) — needed for repeatable frames — cost if wrong: none for interactive
Task 2: Ruling: env maps in video: both probes, no water, 3 bounces from zero per frame — the GI feedback made frames history-dependent (PSNR 28 dB) — cost if wrong: slightly different tile bounce light vs interactive
Task 2: Ruling: renderFrame going backwards throws (reload needed) instead of re-simulating — simpler, render script goes forward only — cost if wrong: resume must open a fresh page
Task 2: complete (commits 85041c5..f3371f3, tests: bash -c 'cd video && npm test' → ℹ duration_ms 105.7778)
Task 3: Ruling: video preset 80 steps / 6 light samples instead of 3x (120) — 120 steps returned black frames on the HD 630 — cost if wrong: slightly noisier clouds
Task 3: Ruling: no extra cloud density (plan said x1.3) and scale 1.35 not 1.6 — x1.3 density turned the sky into a flat overcast sheet — cost if wrong: clouds less "dense" than planned
Task 3: Note: at 23 s the sun is ~1.5 deg up and out of frame; sunrise timing and framing tuned in Task 5
Task 3: complete (commits f3371f3..d7659f2, tests: bash -c 'cd video && npm test' → ℹ duration_ms 100.0833)
Task 4: NOT STARTED (underwater view). Before it: cloud rework in src/sky.js (one cloud volume at all heights instead of two layers, per user complaint about empty middle band) — committed unreviewed, check frames 300 and 690 first.
Resume: next task is Task 4. Check a frame: `cd video && node check.mjs frame 690 out.png` (server: preview "pool-room", port 8123).
Task 4: Ruling: underwater fog uses analytic water path (ray exits at the surface) — GTAO depth has no water plane from below (single-sided override) — cost if wrong: none
Task 4: Ruling: opening camera tilted toward the steps (KEYS[0] target) — looking straight up everything sits inside Snell's window and doesn't read as underwater — cost if wrong: opening framing differs from spec text
Task 4: Ruling: splash drops within 0.5 m of the lens are hidden; breach burst 110 drops — near drops filled the frame as giant blurry bubbles — cost if wrong: breach looks a bit drier
Task 4: complete (frames 0/60/102/104/108/130 checked: no split surface, deterministic hash on repeat, interactive ok)

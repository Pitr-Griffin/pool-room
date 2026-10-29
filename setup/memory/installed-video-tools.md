---
name: installed-video-tools
description: "Video/motion/editing tools and skills installed on the user's PC on 2026-10-29, with where they live and what's left to configure"
metadata:
  node_type: memory
  type: reference
  originSessionId: b460bb95-f4f2-4056-84fc-2390b82ea13b
  modified: 2026-10-29T09:18:33.054Z
---

Installed on 2026-10-29 at the user's request (for future video, motion and editing work):
- Base: Node.js 26, FFmpeg 9, Python 3.12 (`py -3.12`), uv, yt-dlp, Playwright Chromium, and the `claude` CLI (npm global). A new PowerShell may need its PATH refreshed from the registry.
- Plugins: hyperframes@hyperframes (`/hyperframes:hyperframes`, plus the `hyperframes` npm CLI), gsap-skills, taste-skill, example-skills@anthropic-agent-skills (canvas-design, algorithmic-art, …).
- Added 2026-10-29: impeccable@impeccable (design skill `/impeccable …` + PostToolUse hook that scans edited UI files for AI-slop), rea@rea (reverse-engineering skill; its MCP server is registered separately as user-scope `rea` → global npm rea-agents 6.8.0, because the npm plugin ships no MCP manifest). awesome-design-md cloned to ~/.claude/design-md (84 brand DESIGN.md files — reference, not a skill).
- Skills in ~/.claude/skills: the remotion-* set, product-launch-motion, motion-design, editor and watch (Diffusion Studio), video-use (a junction to C:\Users\hah17\tools\video-use), and threejs-* (13 skills).
- Repos in C:\Users\hah17\tools: OpenMontage (with .venv and remotion-composer installed), video-use, claude-motion-design.
- Diffusion Studio desktop app in %LOCALAPPDATA%\DiffusionStudio.

Still to do by the user: complete Diffusion Studio's first-run setup and choose Claude Code, and put an ELEVENLABS_API_KEY into C:\Users\hah17\tools\video-use\.env (never enter it for them).

Related: [[skill-install-policy]].

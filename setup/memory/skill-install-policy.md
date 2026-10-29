---
name: skill-install-policy
description: "User's rules for picking third-party skills/plugins: prefer high-star repos, reject AI-slop generators"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b460bb95-f4f2-4056-84fc-2390b82ea13b
  modified: 2026-10-29T09:18:36.831Z
---

When suggesting GitHub skills, plugins or tools, rank them by stars and flag low-star repos as unvetted. The user approved repos with 3.8k–184k stars and rejected one with about 570 stars. Do not keep tools whose output looks AI-generated ("слоп"). They want results that look hand-made. Install only what the user named or approved; for anything I found myself, list it with stars and ask first.

**Why:** On 2026-10-29 the user said low-star repos may be unverified and that anything producing visible neural-net slop should be removed.
**How to apply:** Present a table of options with stars and a one-line verdict, then install only after a yes. Related: [[installed-video-tools]].

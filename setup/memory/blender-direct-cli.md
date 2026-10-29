---
name: blender-direct-cli
description: "How to drive Blender: direct CLI + bpy scripts by default; MCP for Blender is also installed for live GUI work"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b460bb95-f4f2-4056-84fc-2390b82ea13b
  modified: 2026-10-29T09:18:27.937Z
---

Default way to work with Blender: run it directly, `blender.exe --background --factory-startup --python script.py -- args` (Blender 5.2.3 in `C:\Program Files\Blender Foundation\Blender 5.2\`, Cycles on OptiX with an RTX 4060).

On 2026-10-29 the user also approved **MCP for Blender** (ahujasid/mcp-for-blender, 32.6k stars). It is registered in Claude Code as the user-scope MCP server `blender` (`uvx mcp-for-blender`, DISABLE_TELEMETRY=true), and the addon `blender_mcp` is enabled. To use it, the user opens Blender, presses N, goes to the "MCP for Blender" tab and clicks Start MCP Server.

**Why:** At first the user wanted "no bridges, just connect directly", and the CLI route works well for building and rendering. Later they agreed to the MCP bridge so edits can show up live in their open Blender window.
**How to apply:** Use the CLI for scripted builds and renders, and the MCP for interactive edits when the user has Blender open. Related: [[pool-room-project]].

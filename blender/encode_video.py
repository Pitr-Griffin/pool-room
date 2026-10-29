"""Склеивает кадры renders/frames/<имя>/f_####.png в MP4 через видеоредактор Blender.

    blender --background --factory-startup --python blender/encode_video.py -- glint 24
"""

import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

argv = sys.argv[sys.argv.index("--") + 1 :]
name = argv[0]
fps = int(argv[1]) if len(argv) > 1 else 24
frames_dir = os.path.join(ROOT, "renders", "frames", name)
files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))

scene = bpy.context.scene
scene.render.fps = fps
img = bpy.data.images.load(os.path.join(frames_dir, files[0]))
scene.render.resolution_x, scene.render.resolution_y = img.size
scene.render.resolution_percentage = 100

seq = scene.sequence_editor_create()
strips = seq.strips if hasattr(seq, "strips") else seq.sequences
strip = strips.new_image("frames", os.path.join(frames_dir, files[0]), channel=1, frame_start=1)
for f in files[1:]:
    strip.elements.append(f)
scene.frame_start = 1
scene.frame_end = len(files)

r = scene.render
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "HIGH"
r.ffmpeg.ffmpeg_preset = "GOOD"
r.filepath = os.path.join(ROOT, "renders", f"pool_room_{name}.mp4")
scene.view_settings.view_transform = "Standard"
bpy.ops.render.render(animation=True)
print("ENCODED", r.filepath)

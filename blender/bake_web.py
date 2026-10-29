"""Готовит комнату для интерактивной веб-версии.

Для каждого времени суток запекает в Cycles отражённый (непрямой) свет комнаты в карту
освещения, а геометрию комнаты (галтели, ступени, бортик) экспортирует в glTF.
Прямой солнечный свет и тени веб-версия считает сама, поэтому луч из окна двигается,
а мягкий отражённый свет берётся из этих карт и плавно смешивается между временами суток.

    blender --background --factory-startup --python blender/bake_web.py -- --size 2048 --samples 512
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pool_room  # noqa: E402

ROOT = pool_room.ROOT
OUT = os.path.join(ROOT, "assets")
TIMES = ["morning", "day", "evening", "night"]


def args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    o = dict(size="2048", samples="512", times=",".join(TIMES))
    for i in range(0, len(argv), 2):
        o[argv[i].lstrip("-")] = argv[i + 1]
    return o


def lightmap_uv(obj):
    """Вторая UV-развёртка без наложений — для карты освещения."""
    uv = obj.data.uv_layers.new(name="Lightmap")
    obj.data.uv_layers.active = uv
    obj.data.uv_layers["UVMap"].active_render = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004, area_weight=1.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(obj, name, size, samples):
    img = bpy.data.images.new(f"lm_{name}", size, size, float_buffer=True)
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    b = scene.render.bake
    b.use_pass_direct = False
    b.use_pass_indirect = True
    b.use_pass_color = False
    b.margin = 6
    b.target = "IMAGE_TEXTURES"
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE")
    img.filepath_raw = os.path.join(OUT, f"lightmap_{name}.exr")
    img.file_format = "OPEN_EXR"
    s = scene.render.image_settings
    s.file_format = "OPEN_EXR"
    s.color_depth = "16"
    s.exr_codec = "DWAA"
    img.save_render(img.filepath_raw, scene=scene)
    print("BAKED", img.filepath_raw)


def export_room(room):
    bpy.ops.object.select_all(action="DESELECT")
    room.select_set(True)
    path = os.path.join(OUT, "room.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_materials="PLACEHOLDER",
        export_texcoords=True,
        export_normals=True,
        export_apply=True,
        export_yup=True,
    )
    print("EXPORTED", path)


def main():
    o = args()
    os.makedirs(OUT, exist_ok=True)
    size, samples = int(o["size"]), int(o["samples"])
    pool_room.MICRO_DISPLACEMENT = False
    for i, t in enumerate(o["times"].split(",")):
        pool_room.build(t)
        pool_room.setup_render(samples, (512, 512), os.path.join(OUT, "tmp.png"))
        bpy.data.objects["Haze"].hide_render = True
        room = bpy.data.objects["Room"]
        lightmap_uv(room)
        if i == 0:
            export_room(room)
        bake(room, t, size, samples)


if __name__ == "__main__":
    main()

"""Pool Room в Blender (Cycles).

Собирает сцену с нуля и (по желанию) рендерит кадр:
    blender --background --factory-startup --python blender/pool_room.py -- --time day --samples 256

Оси Blender: Z вверх. Окно на стене y = +3.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# --- Размеры (метры) ------------------------------------------------------

ROOM = dict(x0=-4.0, x1=4.0, y0=-3.0, y1=3.0, h=3.5, t=0.25, base=-1.15)
POOL = dict(x0=-1.0, x1=3.0, y0=-1.3, y1=1.2, bottom=-0.95, water=-0.12)
STEPS = dict(count=4, tread=0.32)
STEP_RISE = -POOL["bottom"] / (STEPS["count"] + 1)
WINDOW = dict(x0=-3.2, x1=3.0, z0=0.7, z1=2.8, panes=6)
MEADOW = dict(x0=-3.45, x1=3.25, y_wall=3.0, y_edge=1.9)
# Световые колодцы в потолке (x0, x1, y0, y1) и их высота.
SKYLIGHTS = [(-2.9, -1.9, -0.4, 0.6), (0.6, 1.8, 0.7, 1.7)]
WELL = 0.45
# Вторая (луговая) комната — та же коробка, сдвинутая по x.
ROOM2_DX = 11.0
# Коридор между комнатами: проёмы в стенах, пол утоплен, залит водой по щиколотку.
# Окно — во всю длину стены, обращённой к солнцу (y = y1).
CORRIDOR = dict(x0=4.0, x1=7.0, y0=-2.6, y1=-1.0, h=2.4, floor=-0.12, water=-0.02)
CWINDOW = dict(x0=4.25, x1=6.75, z0=-0.12, z1=2.4, panes=3)  # от пола до потолка, во всю стену
# Мелкий бассейн второй комнаты — продолжение воды коридора.
SHALLOW = dict(x0=7.0, x1=11.6, y0=-3.0, y1=0.4, floor=-0.12, water=-0.02)  # до самой южной стены
MICRO_DISPLACEMENT = True  # bake_web.py отключает: для запекания рельеф не нужен
TILE = 0.15


def meadow_edge(x):
    return MEADOW["y_edge"] - 0.1 * math.sin(x * 3.1 + 0.7) - 0.05 * math.sin(x * 7.7 + 2.1)


# --- Сцена ----------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    return scene


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def new_object(name, bm, materials, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    return link(bpy.data.objects.new(name, mesh))


# --- Материалы ------------------------------------------------------------


class Nodes:
    """Короткая запись для построения шейдерных графов."""

    def __init__(self, tree):
        self.tree = tree
        self.n = tree.nodes
        self.l = tree.links
        self.x = 0

    def add(self, kind, **props):
        node = self.n.new(kind)
        node.location = (self.x, 0)
        self.x += 200
        for k, v in props.items():
            if k in node.inputs:
                node.inputs[k].default_value = v
            else:
                setattr(node, k, v)
        return node

    def link(self, a, b):
        self.l.new(a, b)

    def math(self, op, a, b=None, **kw):
        node = self.add("ShaderNodeMath", operation=op, **kw)
        self._feed(node.inputs[0], a)
        if b is not None:
            self._feed(node.inputs[1], b)
        return node.outputs[0]

    def _feed(self, socket, v):
        if isinstance(v, (int, float)):
            socket.default_value = v
        else:
            self.link(v, socket)


def material(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    return m, Nodes(nt)


def mix_rgb(N, fac, a, b, blend="MIX"):
    """Узел Mix в режиме цвета; a/b — сокет или RGBA-кортеж."""
    node = N.add("ShaderNodeMix", data_type="RGBA", blend_type=blend)
    ins = [s for s in node.inputs if s.type == "RGBA"]
    fac_in = next(s for s in node.inputs if s.name == "Factor" and s.type == "VALUE")
    N._feed(fac_in, fac)
    for sock, v in ((ins[0], a), (ins[1], b)):
        if isinstance(v, tuple):
            sock.default_value = v
        else:
            N.link(v, sock)
    return next(s for s in node.outputs if s.type == "RGBA")


def grid(bm, nx, ny, to_world):
    """Сетка nx×ny; to_world(u, v) переводит u, v ∈ [0, 1] в мировые координаты."""
    verts = bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=1.0)["verts"]
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    for v in verts:
        v.co = Vector(to_world((v.co.x - x0) / (x1 - x0), (v.co.y - y0) / (y1 - y0)))
    return verts


def tile_material(name, color1, color2):
    """Глазурованная плитка 15 см: скруглённые края, утопленный шов, полоса на стене и тёмный ряд у воды."""
    m, N = material(name)
    out = N.add("ShaderNodeOutputMaterial")
    bsdf = N.add("ShaderNodeBsdfPrincipled")
    uv = N.add("ShaderNodeTexCoord")
    brick = N.add(
        "ShaderNodeTexBrick",
        offset=0.0,
        squash=1.0,
        Scale=2.0 / TILE,
        **{"Brick Width": 1.0, "Row Height": 1.0, "Mortar Size": 0.022, "Mortar Smooth": 0.55, "Bias": 0.0},
    )
    brick.inputs["Color1"].default_value = (*color1, 1)
    brick.inputs["Color2"].default_value = (*color2, 1)
    brick.inputs["Mortar"].default_value = (0.5, 0.53, 0.55, 1)
    N.link(uv.outputs["UV"], brick.inputs["Vector"])

    # Грязь и неравномерность.
    noise = N.add("ShaderNodeTexNoise", Scale=3.0, Detail=6.0)
    N.link(uv.outputs["UV"], noise.inputs["Vector"])

    # Полосы: бирюзовая на стенах (1.05–1.2 м) и тёмно-синий ряд у воды.
    geo = N.add("ShaderNodeNewGeometry")
    sep_p = N.add("ShaderNodeSeparateXYZ")
    N.link(geo.outputs["Position"], sep_p.inputs[0])
    sep_n = N.add("ShaderNodeSeparateXYZ")
    N.link(geo.outputs["Normal"], sep_n.inputs[0])
    z = sep_p.outputs["Z"]
    vertical = N.math("LESS_THAN", N.math("ABSOLUTE", sep_n.outputs["Z"]), 0.5)
    band = N.math("MULTIPLY", N.math("GREATER_THAN", z, 1.05), N.math("LESS_THAN", z, 1.2))
    band = N.math("MULTIPLY", band, vertical)
    line = N.math("MULTIPLY", N.math("GREATER_THAN", z, -0.155), N.math("LESS_THAN", z, -0.005))
    line = N.math("MULTIPLY", line, vertical)

    c = mix_rgb(N, band, brick.outputs["Color"], (0.62, 0.86, 0.88, 1), "MULTIPLY")
    c = mix_rgb(N, line, c, (0.12, 0.3, 0.45, 1), "MULTIPLY")
    c = mix_rgb(N, 0.08, c, noise.outputs["Color"], "MULTIPLY")
    N.link(c, bsdf.inputs["Base Color"])

    # Глазурь: почти зеркальная, со слоем лака; шов матовый.
    rough = N.add("ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 1.0, "To Min": 0.015, "To Max": 0.8})
    N.link(brick.outputs["Fac"], rough.inputs["Value"])
    N.link(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.7
    coat = N.math("SUBTRACT", 1.0, brick.outputs["Fac"])
    N.link(N.math("MULTIPLY", coat, 0.5), bsdf.inputs["Coat Weight"])
    bsdf.inputs["Coat Roughness"].default_value = 0.02

    # Настоящий рельеф (микросмещение геометрии): шов утоплен на 3.5 мм, края плитки
    # скруглены, каждая плитка уложена с лёгким наклоном, глазурь чуть волнистая.
    rnd_brick = N.add(
        "ShaderNodeTexBrick",
        offset=0.0,
        squash=1.0,
        Scale=2.0 / TILE,
        **{"Brick Width": 1.0, "Row Height": 1.0, "Mortar Size": 0.0, "Bias": 0.0},
    )
    rnd_brick.inputs["Color1"].default_value = (0, 0, 0, 1)
    rnd_brick.inputs["Color2"].default_value = (1, 1, 1, 1)
    N.link(uv.outputs["UV"], rnd_brick.inputs["Vector"])
    rnd = N.add("ShaderNodeRGBToBW")
    N.link(rnd_brick.outputs["Color"], rnd.inputs[0])
    tx = N.math("SUBTRACT", rnd.outputs[0], 0.5)
    ty = N.math("SUBTRACT", N.math("FRACT", N.math("MULTIPLY", rnd.outputs[0], 7.31)), 0.5)
    sep_uv = N.add("ShaderNodeSeparateXYZ")
    N.link(uv.outputs["UV"], sep_uv.inputs[0])
    lu = N.math("SUBTRACT", N.math("FRACT", N.math("DIVIDE", sep_uv.outputs["X"], TILE)), 0.5)
    lv = N.math("SUBTRACT", N.math("FRACT", N.math("DIVIDE", sep_uv.outputs["Y"], TILE)), 0.5)
    tilt = N.math("ADD", N.math("MULTIPLY", tx, lu), N.math("MULTIPLY", ty, lv))
    tile_top = N.math("SUBTRACT", 1.0, brick.outputs["Fac"])
    wave = N.add("ShaderNodeTexNoise", Scale=60.0, Detail=3.0)
    N.link(uv.outputs["UV"], wave.inputs["Vector"])
    h = N.math("MULTIPLY", tile_top, 0.0035)
    h = N.math("ADD", h, N.math("MULTIPLY", N.math("MULTIPLY", tilt, tile_top), 0.0016))
    h = N.math("ADD", h, N.math("MULTIPLY", N.math("MULTIPLY", wave.outputs["Fac"], tile_top), 0.0004))
    disp = N.add("ShaderNodeDisplacement", Midlevel=0.0035, Scale=1.0)
    N.link(h, disp.inputs["Height"])
    N.link(disp.outputs["Displacement"], out.inputs["Displacement"])
    m.displacement_method = "BOTH"
    N.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def simple_material(name, color, roughness=0.5, **extra):
    m, N = material(name)
    out = N.add("ShaderNodeOutputMaterial")
    bsdf = N.add("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    for k, v in extra.items():
        bsdf.inputs[k].default_value = v
    N.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def glass_material():
    """Стекло, которое не отбрасывает тень (иначе солнечный луч через окно станет тёмным)."""
    m, N = material("WindowGlass")
    out = N.add("ShaderNodeOutputMaterial")
    glass = N.add("ShaderNodeBsdfPrincipled", Roughness=0.0, IOR=1.5)
    glass.inputs["Transmission Weight"].default_value = 1.0
    glass.inputs["Base Color"].default_value = (0.96, 0.99, 0.98, 1)
    transp = N.add("ShaderNodeBsdfTransparent")
    lp = N.add("ShaderNodeLightPath")
    mix = N.add("ShaderNodeMixShader")
    N.link(lp.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    N.link(glass.outputs["BSDF"], mix.inputs[1])
    N.link(transp.outputs["BSDF"], mix.inputs[2])
    N.link(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def water_material():
    """Вода. Для теневых лучей поверхность прозрачна, но пропускает свет узором
    ярких линий — так солнечный луч рисует на дне бассейна каустику.
    Узор живёт во времени через вход W (его анимирует видео)."""
    m, N = material("Water")
    out = N.add("ShaderNodeOutputMaterial")
    bsdf = N.add("ShaderNodeBsdfPrincipled", Roughness=0.01, IOR=1.333)
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)

    geo = N.add("ShaderNodeNewGeometry")
    pattern = None
    for scale, w_off in ((4.5, 0.0), (7.0, 3.7)):
        vor = N.add("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature="DISTANCE_TO_EDGE", Scale=scale)
        vor.name = f"Caustic{scale}"
        vor.inputs["W"].default_value = w_off
        N.link(geo.outputs["Position"], vor.inputs["Vector"])
        line = N.add("ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 0.14, "To Min": 1.0, "To Max": 0.0})
        N.link(vor.outputs["Distance"], line.inputs["Value"])
        sharp = N.math("POWER", line.outputs["Result"], 2.5)
        pattern = sharp if pattern is None else N.math("MAXIMUM", pattern, sharp)
    light = N.add("ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 1.0, "To Min": 0.22, "To Max": 1.0})
    N.link(pattern, light.inputs["Value"])
    tint = N.add("ShaderNodeCombineColor")
    N.link(light.outputs["Result"], tint.inputs[0])
    N.link(light.outputs["Result"], tint.inputs[1])
    N.link(light.outputs["Result"], tint.inputs[2])
    transp = N.add("ShaderNodeBsdfTransparent")
    N.link(tint.outputs[0], transp.inputs["Color"])

    lp = N.add("ShaderNodeLightPath")
    mix = N.add("ShaderNodeMixShader")
    N.link(lp.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    N.link(bsdf.outputs["BSDF"], mix.inputs[1])
    N.link(transp.outputs["BSDF"], mix.inputs[2])

    absorb = N.add("ShaderNodeVolumeAbsorption", Density=0.35)
    absorb.inputs["Color"].default_value = (0.55, 0.9, 0.88, 1)
    N.link(mix.outputs["Shader"], out.inputs["Surface"])
    N.link(absorb.outputs["Volume"], out.inputs["Volume"])
    return m


def ball_material():
    """Надувной мяч: шесть цветных долек и белые «шапочки» на полюсах."""
    m, N = material("BeachBall")
    out = N.add("ShaderNodeOutputMaterial")
    bsdf = N.add("ShaderNodeBsdfPrincipled", Roughness=0.28)
    bsdf.inputs["Coat Weight"].default_value = 0.6
    bsdf.inputs["Coat Roughness"].default_value = 0.15
    tc = N.add("ShaderNodeTexCoord")
    sep = N.add("ShaderNodeSeparateXYZ")
    N.link(tc.outputs["Object"], sep.inputs[0])
    ang = N.math("ARCTAN2", sep.outputs["Y"], sep.outputs["X"])
    u = N.math("MULTIPLY_ADD", ang, 1 / (2 * math.pi))
    u.node.inputs[2].default_value = 0.5
    ramp = N.add("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    colors = [(0.85, 0.12, 0.1), (0.95, 0.72, 0.08), (0.08, 0.32, 0.8), (0.93, 0.92, 0.88), (0.12, 0.6, 0.25), (0.95, 0.42, 0.08)]
    cr.elements[0].color = (*colors[0], 1)
    cr.elements[1].position = 1.0 / 6
    cr.elements[1].color = (*colors[1], 1)
    for i in range(2, 6):
        e = cr.elements.new(i / 6)
        e.color = (*colors[i], 1)
    N.link(u, ramp.inputs["Fac"])
    cap = N.math("GREATER_THAN", N.math("ABSOLUTE", sep.outputs["Z"]), 0.3)
    N.link(mix_rgb(N, cap, ramp.outputs["Color"], (0.95, 0.94, 0.9, 1)), bsdf.inputs["Base Color"])
    N.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def grass_material():
    m, N = material("Grass")
    out = N.add("ShaderNodeOutputMaterial")
    attr = N.add("ShaderNodeVertexColor", layer_name="Col")
    bsdf = N.add("ShaderNodeBsdfPrincipled", Roughness=0.45)
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    trans = N.add("ShaderNodeBsdfTranslucent")
    N.link(attr.outputs["Color"], bsdf.inputs["Base Color"])
    N.link(attr.outputs["Color"], trans.inputs["Color"])
    mix = N.add("ShaderNodeMixShader", Fac=0.35)
    N.link(bsdf.outputs["BSDF"], mix.inputs[1])
    N.link(trans.outputs["BSDF"], mix.inputs[2])
    N.link(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def petal_material(name, color, sss=0.2):
    m = simple_material(name, color, 0.45)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Subsurface Weight"].default_value = sss
    bsdf.inputs["Subsurface Radius"].default_value = (0.02, 0.02, 0.02)
    bsdf.inputs["Subsurface Scale"].default_value = 0.01
    return m


def soil_material():
    m, N = material("Soil")
    out = N.add("ShaderNodeOutputMaterial")
    bsdf = N.add("ShaderNodeBsdfPrincipled", Roughness=0.95)
    noise = N.add("ShaderNodeTexNoise", Scale=40.0, Detail=8.0)
    ramp = N.add("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.07, 0.05, 0.03, 1)
    ramp.color_ramp.elements[1].color = (0.2, 0.15, 0.1, 1)
    N.link(noise.outputs["Fac"], ramp.inputs["Fac"])
    N.link(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bump = N.add("ShaderNodeBump", Strength=0.6, Distance=0.01)
    N.link(noise.outputs["Fac"], bump.inputs["Height"])
    N.link(bump.outputs["Normal"], bsdf.inputs["Normal"])
    N.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def field_material(haze_color, haze_dist=120.0, base=((0.05, 0.12, 0.02), (0.22, 0.32, 0.06))):
    """Луг (или деревья) за окном, тающие в дымке с расстоянием."""
    m, N = material("Field")
    out = N.add("ShaderNodeOutputMaterial")
    bsdf = N.add("ShaderNodeBsdfPrincipled", Roughness=0.9)
    noise = N.add("ShaderNodeTexNoise", Scale=0.08, Detail=10.0)
    ramp = N.add("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*base[0], 1)
    ramp.color_ramp.elements[1].color = (*base[1], 1)
    N.link(noise.outputs["Fac"], ramp.inputs["Fac"])
    N.link(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    cam = N.add("ShaderNodeCameraData")
    fog = N.math("DIVIDE", cam.outputs["View Distance"], haze_dist)
    fog = N.math("MINIMUM", fog, 0.85)
    emit = N.add("ShaderNodeEmission", Strength=1.0)
    emit.inputs["Color"].default_value = (*haze_color, 1)
    mix = N.add("ShaderNodeMixShader")
    N.link(fog, mix.inputs["Fac"])
    N.link(bsdf.outputs["BSDF"], mix.inputs[1])
    N.link(emit.outputs["Emission"], mix.inputs[2])
    N.link(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def haze_material(density):
    m, N = material("Haze")
    out = N.add("ShaderNodeOutputMaterial")
    vol = N.add("ShaderNodeVolumePrincipled", Density=density, Anisotropy=0.55)
    N.link(vol.outputs["Volume"], out.inputs["Volume"])
    return m


# --- Геометрия ------------------------------------------------------------


def project_uv(face, uv_layer):
    """Плитка по мировым координатам — швы непрерывны на стыках поверхностей."""
    n = face.normal
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    for loop in face.loops:
        c = loop.vert.co
        if az >= ax and az >= ay:
            loop[uv_layer].uv = (c.x, c.y)
        elif ay >= ax:
            loop[uv_layer].uv = (c.x, c.z)
        else:
            loop[uv_layer].uv = (c.y, c.z)


def add_box(bm, uv_layer, x0, x1, y0, y1, z0, z1, mat=0):
    m = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal(
        (x1 - x0, y1 - y0, z1 - z0, 1)
    )
    verts = bmesh.ops.create_cube(bm, size=1.0, matrix=m)["verts"]
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = mat
        f.normal_update()
        project_uv(f, uv_layer)


def add_cove(bm, uv_layer, origin, eu, ev, ew, length, r, segments=12, mat=0):
    """Вогнутая галтель между двумя перпендикулярными поверхностями."""
    origin, eu, ev, ew = Vector(origin), Vector(eu), Vector(ev), Vector(ew)
    along0 = origin.dot(ew)
    rows = []
    for i in range(segments + 1):
        a = i / segments * math.pi / 2
        d = eu * math.cos(a) + ev * math.sin(a)
        rows.append([bm.verts.new(origin + d * r + ew * (j * length)) for j in (0, 1)] + [a * r, d])
    for i in range(segments):
        a0, a1 = rows[i], rows[i + 1]
        f = bm.faces.new((a0[0], a0[1], a1[1], a1[0]))
        f.normal_update()
        inward = -(a0[3] + a1[3])
        if f.normal.dot(inward) < 0:
            f.normal_flip()
        f.smooth = True
        f.material_index = mat
        for loop in f.loops:
            row = a0 if loop.vert in a0[:2] else a1
            j = 0 if loop.vert is row[0] else 1
            loop[uv_layer].uv = (along0 + j * length, row[2])


def add_nosing(bm, uv_layer, start, end, r, mat=0):
    """Скруглённая кромка вдоль отрезка."""
    start, end = Vector(start), Vector(end)
    axis = end - start
    up = "X" if abs(axis.normalized().y) > 0.9 else "Y"
    rot = axis.normalized().to_track_quat("Z", up).to_matrix().to_4x4()
    m = Matrix.Translation((start + end) / 2) @ rot
    verts = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=20, radius1=r, radius2=r, depth=axis.length, matrix=m
    )["verts"]
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = mat
        f.normal_update()
        f.smooth = len(f.verts) == 4
        project_uv(f, uv_layer)


def build_shell(bm, uv, dx, door_side):
    """Стены, потолок с колодцами и галтели одной комнаты, сдвинутой на dx.
    door_side: "x1" — проём в коридор в восточной стене, "x0" — в западной."""
    R, C = ROOM, CORRIDOR
    x0, x1, y0, y1, H, T = R["x0"] + dx, R["x1"] + dx, R["y0"], R["y1"], R["h"], R["t"]
    cy0, cy1, ch = C["y0"], C["y1"], C["h"]
    skylights = [(s[0] + dx, s[1] + dx, s[2], s[3]) for s in SKYLIGHTS]

    # Потолок с проёмами световых колодцев: режем на прямоугольники вокруг проёмов.
    xs = sorted({x0 - T, x1 + T, *[s[0] for s in skylights], *[s[1] for s in skylights]})
    ys = sorted({y0 - T, y1 + T, *[s[2] for s in skylights], *[s[3] for s in skylights]})
    # Нижняя поверхность — одна сетка с общими вершинами, иначе рельеф раздвигает стыки.
    grid_v = [[bm.verts.new((x, y, H)) for y in ys] for x in xs]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if any(s[0] < cx < s[1] and s[2] < cy < s[3] for s in skylights):
                continue
            f = bm.faces.new((grid_v[i][j], grid_v[i][j + 1], grid_v[i + 1][j + 1], grid_v[i + 1][j]))
            f.normal_update()
            if f.normal.z > 0:
                f.normal_flip()
            project_uv(f, uv)
            add_box(bm, uv, xs[i], xs[i + 1], ys[j], ys[j + 1], H + 0.02, H + T)
    # Стенки колодцев.
    for sx0, sx1, sy0, sy1 in skylights:
        top = H + WELL
        add_box(bm, uv, sx0 - T, sx0, sy0 - T, sy1 + T, H + T, top)
        add_box(bm, uv, sx1, sx1 + T, sy0 - T, sy1 + T, H + T, top)
        add_box(bm, uv, sx0, sx1, sy0 - T, sy0, H + T, top)
        add_box(bm, uv, sx0, sx1, sy1, sy1 + T, H + T, top)

    # Стены. Торцевая стена с проёмом в коридор — из трёх частей.
    add_box(bm, uv, x0 - T, x1 + T, y0 - T, y0, 0, H)
    for side, wx0, wx1 in (("x0", x0 - T, x0), ("x1", x1, x1 + T)):
        if side == door_side:
            add_box(bm, uv, wx0, wx1, y0, cy0, 0, H)
            add_box(bm, uv, wx0, wx1, cy1, y1, 0, H)
            add_box(bm, uv, wx0, wx1, cy0, cy1, ch, H)
        else:
            add_box(bm, uv, wx0, wx1, y0, y1, 0, H)
    W = WINDOW
    wx0, wx1 = W["x0"] + dx, W["x1"] + dx
    add_box(bm, uv, x0 - T, x1 + T, y1, y1 + T, 0, W["z0"])
    add_box(bm, uv, x0 - T, x1 + T, y1, y1 + T, W["z1"], H)
    add_box(bm, uv, x0 - T, wx0, y1, y1 + T, W["z0"], W["z1"])
    add_box(bm, uv, wx1, x1 + T, y1, y1 + T, W["z0"], W["z1"])

    # Галтели. У стены с проёмом нижняя галтель обрывается на проёме (и на мелком бассейне).
    cr = 0.14
    for z, dz in ((cr, -1), (H - cr, 1)):
        add_cove(bm, uv, (x0, y1 - cr, z), (0, 1, 0), (0, 0, dz), (1, 0, 0), x1 - x0, cr)
        # У южной стены луговой комнаты нижняя галтель начинается за мелким бассейном —
        # над водой она висела бы в воздухе.
        sa = SHALLOW["x1"] if door_side == "x0" and dz < 0 else x0
        add_cove(bm, uv, (sa, y0 + cr, z), (0, -1, 0), (0, 0, dz), (1, 0, 0), x1 - sa, cr)
        for side, xc, sx in (("x0", x0 + cr, -1), ("x1", x1 - cr, 1)):
            spans = [(y0, y1)]
            if side == door_side and dz < 0:
                gap0, gap1 = (cy0, cy1) if door_side == "x1" else (SHALLOW["y0"], SHALLOW["y1"])
                spans = [(y0, gap0), (gap1, y1)]
            for a, b in spans:
                if b - a > 0.01:
                    add_cove(bm, uv, (xc, a, z), (sx, 0, 0), (0, 0, dz), (0, 1, 0), b - a, cr)
    for x, sx in ((x0 + cr, -1), (x1 - cr, 1)):
        for y, sy in ((y0 + cr, -1), (y1 - cr, 1)):
            # Угол, куда заходит мелкий бассейн, скруглён до самого его дна.
            z0 = SHALLOW["floor"] if door_side == "x0" and sx < 0 and sy < 0 else 0
            add_cove(bm, uv, (x, y, z0), (sx, 0, 0), (0, sy, 0), (0, 0, 1), H - z0, cr)


def build_room(tile, pool_tile):
    """Первая комната: кафельный пол и глубокий бассейн со ступенями."""
    R, P = ROOM, POOL
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    x0, x1, y0, y1, T, B = R["x0"], R["x1"], R["y0"], R["y1"], R["t"], R["base"]
    cy0, cy1 = CORRIDOR["y0"], CORRIDOR["y1"]

    # Пол вокруг бассейна (под восточной стеной — отдельно, чтобы оставить проём в коридор).
    add_box(bm, uv, x0 - T, x1, y0 - T, P["y0"], B, 0)
    add_box(bm, uv, x0 - T, x1, P["y1"], y1 + T, B, 0)
    add_box(bm, uv, x0 - T, P["x0"], P["y0"], P["y1"], B, 0)
    add_box(bm, uv, P["x1"], x1, P["y0"], P["y1"], B, 0)
    add_box(bm, uv, x1, x1 + T, y0 - T, cy0, B, 0)
    add_box(bm, uv, x1, x1 + T, cy1, y1 + T, B, 0)
    # Чаша.
    L = 0.01
    add_box(bm, uv, P["x0"], P["x1"], P["y0"], P["y1"], B, P["bottom"], 1)
    add_box(bm, uv, P["x0"], P["x0"] + L, P["y0"], P["y1"], P["bottom"], 0, 1)
    add_box(bm, uv, P["x1"] - L, P["x1"], P["y0"], P["y1"], P["bottom"], 0, 1)
    add_box(bm, uv, P["x0"], P["x1"], P["y0"], P["y0"] + L, P["bottom"], 0, 1)
    add_box(bm, uv, P["x0"], P["x1"], P["y1"] - L, P["y1"], P["bottom"], 0, 1)
    # Ступени.
    r = 0.025
    for i in range(STEPS["count"]):
        top = -(i + 1) * STEP_RISE
        sx = P["x0"] + (i + 1) * STEPS["tread"]
        add_box(bm, uv, P["x0"], sx, P["y0"] + L, P["y1"] - L, P["bottom"], top, 1)
        add_nosing(bm, uv, (sx - r, P["y0"] + L, top - r), (sx - r, P["y1"] - L, top - r), r, 1)
    # Бортик.
    for a, b in [
        ((P["x0"], P["y0"], -r), (P["x1"], P["y0"], -r)),
        ((P["x0"], P["y1"], -r), (P["x1"], P["y1"], -r)),
        ((P["x0"], P["y0"], -r), (P["x0"], P["y1"], -r)),
        ((P["x1"], P["y0"], -r), (P["x1"], P["y1"], -r)),
    ]:
        add_nosing(bm, uv, a, b, r, 0)
    # Край пола у спуска в коридор.
    add_nosing(bm, uv, (x1 - r, cy0, -r), (x1 - r, cy1, -r), r, 0)

    build_shell(bm, uv, 0.0, "x1")
    return finish_room(new_object("Room", bm, [tile, pool_tile]))


def build_room2(tile, pool_tile, soil):
    """Коридор и вторая комната: пол — земля под лугом, у входа — бассейн по щиколотку."""
    R, C, S = ROOM, CORRIDOR, SHALLOW
    dx = ROOM2_DX
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    x0, x1, y0, y1, T, B = R["x0"] + dx, R["x1"] + dx, R["y0"], R["y1"], R["t"], R["base"]

    # Коридор: утопленный кафельный пол, стены, потолок и окно во всю стену со стороны солнца.
    ch, cf = C["h"], C["floor"]
    add_box(bm, uv, C["x0"], C["x1"], C["y0"], C["y1"], B, cf, 1)
    cx0, cx1 = C["x0"] + T, C["x1"] - T
    add_box(bm, uv, cx0, cx1, C["y0"] - T, C["y0"], cf, ch)
    add_box(bm, uv, cx0, cx1, C["y0"] - T, C["y1"] + T, ch, ch + T)
    # Стена со стороны солнца целиком стеклянная (окно — в build_window), под ним — порог под воду.
    add_box(bm, uv, cx0, cx1, C["y1"], C["y1"] + T, B, cf, 1)

    # Пол второй комнаты — земля (материал 2); под стенами — тоже, его не видно.
    # Под южной стеной — кафель: бассейн доходит до стены, и торец этой плиты виден под водой.
    add_box(bm, uv, x0, x1 + T, y0 - T, S["y0"], B, 0, 0)
    # Бассейн окантован кафельным бортиком (K), дальше — земля под лугом.
    K = 0.1
    add_box(bm, uv, x0, S["x1"] + K, S["y1"], S["y1"] + K, B, 0, 0)
    add_box(bm, uv, S["x1"], S["x1"] + K, S["y0"], S["y1"], B, 0, 0)
    add_box(bm, uv, x0, x1 + T, S["y1"] + K, y1 + T, B, 0, 2)
    add_box(bm, uv, S["x1"] + K, x1 + T, S["y0"], S["y1"] + K, B, 0, 2)
    # Основание западной стены — по обе стороны от проёма.
    add_box(bm, uv, x0 - T, x0, y0 - T, C["y0"], B, 0, 0)
    add_box(bm, uv, x0 - T, x0, C["y1"], y1 + T, B, 0, 0)
    # Мелкий бассейн: кафельное дно; борта — торцы бортика и оснований стен.
    add_box(bm, uv, S["x0"], S["x1"], S["y0"], S["y1"], B, S["floor"], 1)
    r = 0.025
    for a, b in [
        ((S["x0"], S["y1"], -r), (S["x1"], S["y1"], -r)),
        ((S["x1"], S["y0"], -r), (S["x1"], S["y1"], -r)),
    ]:
        add_nosing(bm, uv, a, b, r, 0)

    build_shell(bm, uv, dx, "x0")
    return finish_room(new_object("Room2", bm, [tile, pool_tile, soil]))


def finish_room(room):
    if MICRO_DISPLACEMENT:
        # Адаптивное подразбиение: геометрия дробится до ~пикселя там, где видна камере.
        sub = room.modifiers.new("Micro", "SUBSURF")
        sub.subdivision_type = "SIMPLE"
        sub.levels = 0
        sub.render_levels = 0
        sub.use_adaptive_subdivision = True
        sub.adaptive_pixel_size = 1.0
    return room


def build_window(frame_mat, glass_mat, W=WINDOW, yc=ROOM["y1"] + ROOM["t"] / 2, name="Window"):
    """Рама с переплётом и стекло; W — проём (x0, x1, z0, z1, panes), yc — середина толщины стены."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    fy0, fy1 = yc - 0.04, yc + 0.04
    fw, mw = 0.07, 0.04
    add_box(bm, uv, W["x0"], W["x1"], fy0, fy1, W["z0"], W["z0"] + fw)
    add_box(bm, uv, W["x0"], W["x1"], fy0, fy1, W["z1"] - fw, W["z1"])
    add_box(bm, uv, W["x0"], W["x0"] + fw, fy0, fy1, W["z0"], W["z1"])
    add_box(bm, uv, W["x1"] - fw, W["x1"], fy0, fy1, W["z0"], W["z1"])
    pane = (W["x1"] - W["x0"]) / W["panes"]
    for i in range(1, W["panes"]):
        x = W["x0"] + pane * i
        add_box(bm, uv, x - mw / 2, x + mw / 2, fy0, fy1, W["z0"], W["z1"])
    zm = W["z0"] + (W["z1"] - W["z0"]) * 0.62
    add_box(bm, uv, W["x0"], W["x1"], fy0, fy1, zm - mw / 2, zm + mw / 2)
    frame = new_object(name + "Frame", bm, [frame_mat])

    bm = bmesh.new()
    grid(bm, 1, 1, lambda u, v: (W["x0"] + u * (W["x1"] - W["x0"]), yc, W["z0"] + v * (W["z1"] - W["z0"])))
    glass = new_object(name + "Glass", bm, [glass_mat])
    return frame, glass


def build_water(mat, name="Water", x0=POOL["x0"], x1=POOL["x1"], y0=POOL["y0"], y1=POOL["y1"],
                level=POOL["water"], bottom=POOL["bottom"]):
    e = 0.002
    bm = bmesh.new()
    grid(
        bm,
        max(8, int((x1 - x0) * 60)),
        max(8, int((y1 - y0) * 60)),
        lambda u, v: (x0 + e + u * (x1 - x0 - 2 * e), y0 + e + v * (y1 - y0 - 2 * e), level),
    )
    obj = new_object(name, bm, [mat], smooth=True)

    tex = bpy.data.textures.new("Ripples", type="CLOUDS")
    tex.noise_scale = 0.22
    tex.noise_depth = 2
    disp = obj.modifiers.new("Ripples", "DISPLACE")
    disp.texture = tex
    disp.texture_coords = "GLOBAL"
    disp.strength = 0.0035
    disp.mid_level = 0.5

    tex2 = bpy.data.textures.new("Swell", type="CLOUDS")
    tex2.noise_scale = 0.45
    disp2 = obj.modifiers.new("Swell", "DISPLACE")
    disp2.texture = tex2
    disp2.texture_coords = "GLOBAL"
    disp2.strength = 0.006
    disp2.mid_level = 0.5

    solid = obj.modifiers.new("Depth", "SOLIDIFY")
    solid.thickness = level - bottom - 0.005
    solid.offset = -1.0
    return obj


def build_ball(mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=0.32)
    obj = new_object("BeachBall", bm, [mat], smooth=True)
    obj.location = (3.55, 2.2, 0.32)
    obj.rotation_euler = (0.35, 0.2, 0.9)
    return obj


# --- Луг ------------------------------------------------------------------


def meadow2_points(count, rng, accept=1.0):
    """Луг на весь пол второй комнаты, кроме мелкого бассейна; к воде трава редеет."""
    R, S, dx = ROOM, SHALLOW, ROOM2_DX
    # Отступ от стен: там скруглённая галтель, трава в неё не врастает.
    wm = 0.16
    pts = []
    guard = 0
    while len(pts) < count and guard < count * 40:
        guard += 1
        x = R["x0"] + dx + wm + rng.random() * (R["x1"] - R["x0"] - 2 * wm)
        y = R["y0"] + wm + rng.random() * (R["y1"] - R["y0"] - 2 * wm)
        ox = max(S["x0"] - x, x - S["x1"], 0)
        oy = max(S["y0"] - y, y - S["y1"], 0)
        gap = math.hypot(ox, oy)
        if gap < 0.13:
            continue
        # У бортика и у стен трава реже.
        wall = min(x - R["x0"] - dx, R["x1"] + dx - x, y - R["y0"], R["y1"] - y) - wm
        if rng.random() > min(1, (gap - 0.13) / 0.35 + 0.25) * min(1, wall / 0.25 + 0.4) * accept:
            continue
        pts.append((x, y))
    return pts


def meadow_points(count, rng, accept=1.0, region=1):
    if region == 2:
        return meadow2_points(count, rng, accept)
    pts = []
    guard = 0
    while len(pts) < count and guard < count * 40:
        guard += 1
        x = MEADOW["x0"] + rng.random() * (MEADOW["x1"] - MEADOW["x0"])
        y = MEADOW["y_edge"] - 0.2 + rng.random() * (MEADOW["y_wall"] - 0.02 - MEADOW["y_edge"] + 0.2)
        edge = meadow_edge(x)
        if y < edge:
            continue
        side = min(x - MEADOW["x0"], MEADOW["x1"] - x)
        density = min(1, side / 0.3) * min(1, (y - edge) / 0.25 + 0.15)
        if rng.random() > density * accept:
            continue
        pts.append((x, y))
    return pts


def build_grass(mat, rng, region=1, count=16000, name="Grass"):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    segs = 4
    for x, y in meadow_points(count, rng, 0.9, region):
        h = 0.07 + rng.random() * 0.16
        w = 0.005 + rng.random() * 0.004
        yaw = rng.random() * math.tau
        lean = (rng.random() - 0.3) * 0.5
        d = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-d.y, d.x, 0))
        hue = rng.random()
        base = Vector((0.05 + hue * 0.04, 0.12 + hue * 0.05, 0.02))
        tip = Vector((0.25 + hue * 0.15, 0.42 + hue * 0.1, 0.07 + hue * 0.04))
        if rng.random() < 0.12:
            tip = Vector((0.45, 0.42, 0.18))  # подсохшие травинки
        rows = []
        for i in range(segs + 1):
            k = i / segs
            c = Vector((x, y, 0)) + d * (lean * h * k * k) + Vector((0, 0, h * k))
            ww = w * (1 - k * 0.95)
            rows.append((bm.verts.new(c - side * ww), bm.verts.new(c + side * ww), base.lerp(tip, k)))
        for i in range(segs):
            a, b = rows[i], rows[i + 1]
            f = bm.faces.new((a[0], a[1], b[1], b[0]))
            f.smooth = True
            for loop in f.loops:
                c = a[2] if loop.vert in a[:2] else b[2]
                loop[col] = (*c, 1)
    return new_object(name, bm, [mat])


def add_stem(bm, base, h, lean_dir, lean, r=0.0016):
    """Тонкий изогнутый стебель; возвращает верхнюю точку."""
    segs = 4
    prev = None
    top = base
    for i in range(segs + 1):
        k = i / segs
        c = base + lean_dir * (lean * k * k) + Vector((0, 0, h * k))
        ring = [bm.verts.new(c + Vector((math.cos(a), math.sin(a), 0)) * r * (1 - 0.4 * k)) for a in (0, 2.09, 4.19)]
        if prev:
            for j in range(3):
                f = bm.faces.new((prev[j], prev[(j + 1) % 3], ring[(j + 1) % 3], ring[j]))
                f.material_index = 0
                f.smooth = True
        prev = ring
        top = c
    return top


def add_petals(bm, center, count, length, width, mat, cup=0.0, rng=None, phase=None):
    up = Vector((0, 0, 1))
    if phase is None:
        phase = rng.random() * math.tau if rng else 0
    for i in range(count):
        a = phase + i / count * math.tau
        d = Vector((math.cos(a), math.sin(a), 0))
        s = Vector((-d.y, d.x, 0))
        lift = up * (cup * length)
        p0 = center
        p1 = center + d * length * 0.5 + s * width + lift * 0.4
        p2 = center + d * length + lift
        p3 = center + d * length * 0.5 - s * width + lift * 0.4
        vs = [bm.verts.new(p) for p in (p0, p1, p2, p3)]
        f = bm.faces.new(vs)
        f.material_index = mat
        f.smooth = True


def add_blob(bm, center, r, mat, squash=1.0):
    m = Matrix.Translation(center) @ Matrix.Diagonal((1, 1, squash, 1))
    verts = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r, matrix=m)["verts"]
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mat
        f.smooth = True


def add_bell(bm, center, r, mat):
    m = Matrix.Translation(center) @ Matrix.Rotation(math.pi, 4, "X")
    verts = bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=r, radius2=r * 0.35, depth=r * 2.2, matrix=m)[
        "verts"
    ]
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mat
        f.smooth = True


def build_flowers(mats, rng, region=1, scale=1, name="Flowers"):
    """Материалы: 0 стебель, 1 белый, 2 жёлтый, 3 голубой, 4 розовато-белый, 5 сиреневый, 6 лист."""
    bm = bmesh.new()
    kinds = [("daisy", 140), ("buttercup", 110), ("forget", 100), ("clover", 100), ("bell", 55)]
    for kind, count in kinds:
        for x, y in meadow_points(int(count * scale), rng, 0.9, region):
            yaw = rng.random() * math.tau
            ld = Vector((math.cos(yaw), math.sin(yaw), 0))
            s = 0.85 + rng.random() * 0.45
            base = Vector((x, y, 0))
            if kind == "daisy":
                top = add_stem(bm, base, 0.2 * s, ld, 0.03)
                add_petals(bm, top, 14, 0.02 * s, 0.004 * s, 1, cup=0.12, rng=rng)
                add_blob(bm, top + Vector((0, 0, 0.002)), 0.0055 * s, 2, squash=0.5)
            elif kind == "buttercup":
                top = add_stem(bm, base, 0.17 * s, ld, 0.03)
                add_petals(bm, top, 5, 0.012 * s, 0.006 * s, 2, cup=0.7, rng=rng)
                add_blob(bm, top + Vector((0, 0, 0.002)), 0.003, 2)
            elif kind == "forget":
                top = add_stem(bm, base, 0.13 * s, ld, 0.02)
                for j in range(5):
                    a = j / 5 * math.tau + rng.random()
                    c = top + Vector((math.cos(a), math.sin(a), 0)) * 0.01 + Vector((0, 0, rng.random() * 0.006))
                    add_petals(bm, c, 5, 0.0045, 0.0028, 3, cup=0.1, rng=rng)
            elif kind == "clover":
                top = add_stem(bm, base, 0.08 * s, ld, 0.01)
                add_blob(bm, top + Vector((0, 0, 0.008)), 0.011 * s, 4, squash=1.15)
                add_petals(bm, base + Vector((0, 0, 0.03)), 3, 0.014, 0.008, 6, cup=0.1, phase=yaw)
            else:
                top = add_stem(bm, base, 0.18 * s, ld, 0.05)
                add_bell(bm, top + ld * 0.006 - Vector((0, 0, 0.008)), 0.007 * s, 5)
    obj = new_object(name, bm, mats)
    return obj


def build_soil(mat, shard_mat, rng):
    bm = bmesh.new()
    pts = []
    steps = 80
    for i in range(steps + 1):
        x = MEADOW["x0"] + (MEADOW["x1"] - MEADOW["x0"]) * i / steps
        pts.append(bm.verts.new((x, meadow_edge(x) - 0.05, 0.003)))
    pts.append(bm.verts.new((MEADOW["x1"], MEADOW["y_wall"], 0.003)))
    pts.append(bm.verts.new((MEADOW["x0"], MEADOW["y_wall"], 0.003)))
    f = bm.faces.new(pts)
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f])
    soil = new_object("Soil", bm, [mat])

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for _ in range(26):
        x = MEADOW["x0"] + 0.2 + rng.random() * (MEADOW["x1"] - MEADOW["x0"] - 0.4)
        y = meadow_edge(x) - 0.02 - rng.random() * 0.06
        w, d = 0.05 + rng.random() * 0.09, 0.04 + rng.random() * 0.09
        m = (
            Matrix.Translation((x, y, 0.006))
            @ Matrix.Rotation(rng.random() * math.pi, 4, "Z")
            @ Matrix.Rotation((rng.random() - 0.5) * 0.25, 4, "X")
            @ Matrix.Diagonal((w, d, 0.012, 1))
        )
        verts = bmesh.ops.create_cube(bm, size=1.0, matrix=m)["verts"]
        for f in {f for v in verts for f in v.link_faces}:
            f.normal_update()
            project_uv(f, uv)
    shards = new_object("TileShards", bm, [shard_mat])
    return soil, shards


def build_shards2(shard_mat, rng):
    """Куски кафеля, разбросанные в траве луговой комнаты: пол когда-то был плиточным.
    Где-то целые плитки, где-то обломки, часть лежит кучками."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    centers = meadow2_points(28, rng)
    for cx, cy in centers:
        for _ in range(1 + int(rng.random() * 4)):
            x = cx + (rng.random() - 0.5) * 0.35
            y = cy + (rng.random() - 0.5) * 0.35
            whole = rng.random() < 0.3
            w = TILE * 0.98 if whole else 0.04 + rng.random() * 0.1
            d = TILE * 0.98 if whole else 0.03 + rng.random() * 0.1
            m = (
                Matrix.Translation((x, y, 0.004 + rng.random() * 0.004))
                @ Matrix.Rotation(rng.random() * math.pi, 4, "Z")
                @ Matrix.Rotation((rng.random() - 0.5) * 0.35, 4, "X")
                @ Matrix.Rotation((rng.random() - 0.5) * 0.35, 4, "Y")
                @ Matrix.Diagonal((w, d, 0.011, 1))
            )
            verts = bmesh.ops.create_cube(bm, size=1.0, matrix=m)["verts"]
            for f in {f for v in verts for f in v.link_faces}:
                f.normal_update()
                project_uv(f, uv)
    return new_object("TileShards2", bm, [shard_mat])


# --- Свет, небо, камера ---------------------------------------------------

TIMES = {
    # направление на солнце (к солнцу), сила, цвет, сила неба
    "morning": dict(sun=(-0.75, 0.55, 0.25), power=5.0, color=(1.0, 0.8, 0.62), sky=0.6, haze=0.012),
    "day": dict(sun=(-0.35, 0.75, 0.6), power=6.0, color=(1.0, 0.97, 0.92), sky=1.0, haze=0.012),
    "evening": dict(sun=(0.8, 0.5, 0.18), power=5.5, color=(1.0, 0.62, 0.38), sky=0.45, haze=0.08, exposure=0.8),
    # Высокое солнце: столбы света из колодцев падают на пол и в воду, заливки мало — контрастно.
    "noon": dict(sun=(-0.2, 0.5, 0.85), power=10.0, color=(1.0, 0.96, 0.9), sky=0.5, haze=0.14, exposure=1.2),
    # Солнце пониже и прямо в окно — луч целиком ложится на воду (для видео с бликами).
    "glint": dict(sun=(0.15, 0.82, 0.5), power=6.5, color=(1.0, 0.94, 0.85), sky=0.9, haze=0.014),
    "night": dict(sun=(0.4, 0.6, 0.55), power=0.5, color=(0.62, 0.72, 1.0), sky=0.25, haze=0.05, moon=True, exposure=1.8),
}


def setup_lighting(time_name):
    cfg = TIMES[time_name]
    scene = bpy.context.scene
    s = Vector(cfg["sun"]).normalized()

    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = cfg["power"]
    sun_data.color = cfg["color"]
    sun_data.angle = math.radians(0.6 if not cfg.get("moon") else 0.5)
    try:
        sun_data.cycles.is_caustics_light = True
    except AttributeError:
        pass
    sun = link(bpy.data.objects.new("Sun", sun_data))
    sun.rotation_euler = (-s).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("Sky")
    scene.world = world
    try:
        world.use_nodes = True
    except AttributeError:
        pass
    nt = world.node_tree
    nt.nodes.clear()
    N = Nodes(nt)
    out = N.add("ShaderNodeOutputWorld")
    bg = N.add("ShaderNodeBackground", Strength=cfg["sky"] * 0.12)
    if cfg.get("moon"):
        # Ночное небо: градиент от светлого горизонта к тёмно-синему зениту и звёзды.
        tc = N.add("ShaderNodeTexCoord")
        sep = N.add("ShaderNodeSeparateXYZ")
        N.link(tc.outputs["Generated"], sep.inputs[0])
        # Земли нет: комната висит в небе, ниже горизонта — то же небо.
        az = N.math("ABSOLUTE", sep.outputs["Z"])
        ramp = N.add("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.9, 1.1, 1.8, 1)
        ramp.color_ramp.elements[1].position = 0.6
        ramp.color_ramp.elements[1].color = (0.12, 0.2, 0.6, 1)
        N.link(az, ramp.inputs["Fac"])
        stars = N.add("ShaderNodeTexVoronoi", Scale=180.0, Randomness=1.0)
        N.link(tc.outputs["Generated"], stars.inputs["Vector"])
        dot = N.add("ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 0.035, "To Min": 60.0, "To Max": 0.0})
        N.link(stars.outputs["Distance"], dot.inputs["Value"])
        bright = N.math("MULTIPLY", dot.outputs["Result"], N.math("GREATER_THAN", stars.outputs["Color"], 0.93))
        bright = N.math("MULTIPLY", bright, N.math("GREATER_THAN", az, 0.03))
        N.link(mix_rgb(N, bright, ramp.outputs["Color"], (1.0, 1.0, 1.0, 1), "ADD"), bg.inputs["Color"])
    else:
        sky = N.add("ShaderNodeTexSky", sky_type="MULTIPLE_SCATTERING", sun_disc=False)
        sky.sun_elevation = math.asin(max(s.z, 0.02))
        sky.sun_rotation = math.atan2(s.x, s.y)
        sky.air_density = 1.0
        sky.aerosol_density = 2.0
        tc = N.add("ShaderNodeTexCoord")
        sep = N.add("ShaderNodeSeparateXYZ")
        N.link(tc.outputs["Generated"], sep.inputs[0])
        # Земли нет: комната висит в небе — ниже горизонта то же небо, отражённое по высоте.
        az = N.math("ABSOLUTE", sep.outputs["Z"])
        updir = N.add("ShaderNodeCombineXYZ")
        N.link(sep.outputs["X"], updir.inputs["X"])
        N.link(sep.outputs["Y"], updir.inputs["Y"])
        N.link(az, updir.inputs["Z"])
        N.link(updir.outputs["Vector"], sky.inputs["Vector"])
        # Кучевые облака: шум, спроецированный на «потолок» неба; внизу — свой узор.
        below = N.math("MULTIPLY", N.math("LESS_THAN", sep.outputs["Z"], 0.0), 13.7)
        zc = N.math("ADD", az, 0.22)
        comb = N.add("ShaderNodeCombineXYZ")
        N.link(N.math("ADD", N.math("DIVIDE", sep.outputs["X"], zc), below), comb.inputs["X"])
        N.link(N.math("DIVIDE", sep.outputs["Y"], zc), comb.inputs["Y"])
        noise = N.add("ShaderNodeTexNoise", Scale=2.2, Detail=9.0, Roughness=0.6, Distortion=0.3)
        N.link(comb.outputs["Vector"], noise.inputs["Vector"])
        cover = N.add("ShaderNodeMapRange", **{"From Min": 0.48, "From Max": 0.66, "To Min": 0.0, "To Max": 1.0})
        N.link(noise.outputs["Fac"], cover.inputs["Value"])
        horizon = N.add("ShaderNodeMapRange", **{"From Min": 0.01, "From Max": 0.08, "To Min": 0.0, "To Max": 1.0})
        N.link(az, horizon.inputs["Value"])
        dens = N.math("MULTIPLY", cover.outputs["Result"], horizon.outputs["Result"])
        cloud_col = tuple(min(1.0, 0.55 + 0.45 * c) * 9.0 * cfg["sky"] for c in cfg["color"]) + (1,)
        N.link(mix_rgb(N, dens, sky.outputs["Color"], cloud_col), bg.inputs["Color"])
    # Небо в кадре (через окно) темнее, чем свет, который оно даёт комнате, — иначе оно белое.
    lp = N.add("ShaderNodeLightPath")
    seen = N.add("ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 1.0, "To Min": cfg["sky"] * 0.12, "To Max": cfg["sky"] * 0.06})
    N.link(lp.outputs["Is Camera Ray"], seen.inputs["Value"])
    N.link(seen.outputs["Result"], bg.inputs["Strength"])
    N.link(bg.outputs["Background"], out.inputs["Surface"])
    return cfg


def setup_camera(name, loc, target, lens=20):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.clip_start = 0.02
    cam = link(bpy.data.objects.new(name, cam_data))
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return cam


def setup_render(samples, res, out_path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            break
        except Exception:
            continue
    c = scene.cycles
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.01
    c.use_denoising = True
    try:
        c.denoiser = "OPTIX"
    except TypeError:
        pass
    c.max_bounces = 16
    c.diffuse_bounces = 6
    c.glossy_bounces = 8
    c.transmission_bounces = 12
    c.volume_bounces = 2
    c.transparent_max_bounces = 16
    c.caustics_reflective = True
    c.caustics_refractive = True
    c.blur_glossy = 0.6
    c.sample_clamp_indirect = 8.0
    c.volume_step_rate = 4.0
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = out_path
    vs = scene.view_settings
    for vt in ("AgX", "Filmic"):
        try:
            vs.view_transform = vt
            break
        except TypeError:
            continue
    for look in ("AgX - High Contrast", "AgX - Medium High Contrast"):
        try:
            vs.look = look
            break
        except TypeError:
            continue
    vs.exposure = scene.get("exposure", 0.0)
    # Баланс белого: убираем зеленоватый отсвет луга, белый кафель — холодно-белый.
    if hasattr(vs, "use_white_balance"):
        vs.use_white_balance = True
        vs.white_balance_temperature = 6200
        vs.white_balance_tint = 28


# --- Сборка ---------------------------------------------------------------


def build(time_name="day"):
    reset_scene()
    rng = random.Random(7)
    tile = tile_material("Tile", (0.9, 0.93, 0.96), (0.86, 0.9, 0.94))
    pool_tile = tile_material("PoolTile", (0.78, 0.93, 0.94), (0.72, 0.9, 0.91))
    soil = soil_material()
    room = build_room(tile, pool_tile)
    room2 = build_room2(tile, pool_tile, soil)
    paint, glass_mat = simple_material("WindowPaint", (0.92, 0.92, 0.89), 0.35), glass_material()
    build_window(paint, glass_mat)
    W2 = dict(WINDOW, x0=WINDOW["x0"] + ROOM2_DX, x1=WINDOW["x1"] + ROOM2_DX)
    build_window(paint, glass_mat, W2, name="Window2")
    build_window(paint, glass_mat, CWINDOW, CORRIDOR["y1"] + ROOM["t"] / 2, name="CorridorWindow")
    water_mat = water_material()
    water = build_water(water_mat)
    C, S = CORRIDOR, SHALLOW
    waters = [
        water,
        build_water(water_mat, "WaterCorridor", C["x0"], C["x1"], C["y0"], C["y1"], C["water"], C["floor"]),
        build_water(water_mat, "WaterShallow", S["x0"], S["x1"], S["y0"], S["y1"], S["water"], S["floor"]),
    ]
    ball = build_ball(ball_material())
    grass_mat = grass_material()
    build_grass(grass_mat, rng)
    build_grass(grass_mat, rng, region=2, count=80000, name="Grass2")
    flower_mats = [
        simple_material("Stem", (0.08, 0.2, 0.04), 0.5),
        petal_material("PetalWhite", (0.92, 0.92, 0.88)),
        petal_material("PetalYellow", (0.95, 0.7, 0.04), 0.1),
        petal_material("PetalBlue", (0.32, 0.5, 0.92)),
        petal_material("CloverHead", (0.9, 0.78, 0.84)),
        petal_material("PetalLilac", (0.38, 0.33, 0.8)),
        simple_material("Leaf", (0.06, 0.2, 0.04), 0.5),
    ]
    build_flowers(flower_mats, rng)
    build_flowers(flower_mats, rng, region=2, scale=5, name="Flowers2")
    shard_mat = simple_material("Shard", (0.92, 0.93, 0.93), 0.08)
    build_soil(soil, shard_mat, rng)
    build_shards2(shard_mat, rng)

    cfg = setup_lighting(time_name)

    # Лёгкая дымка в комнатах и коридоре — видимые лучи из окон.
    bm = bmesh.new()
    R = ROOM
    xa, xb = R["x0"] + 0.01, R["x1"] + ROOM2_DX - 0.01
    m = Matrix.Translation(((xa + xb) / 2, 0, R["h"] / 2)) @ Matrix.Diagonal((xb - xa, R["y1"] - R["y0"] - 0.02, R["h"] - 0.02, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    haze = new_object("Haze", bm, [haze_material(cfg["haze"])])
    haze.visible_shadow = False

    for obj, attr in [*((w, "is_caustics_caster") for w in waters), (room, "is_caustics_receiver"), (room2, "is_caustics_receiver")]:
        try:
            setattr(obj, attr, True)
        except AttributeError:
            pass

    cam = setup_camera("Camera", (-1.6, -2.55, 1.6), (0.3, 3.0, 1.1), lens=19)
    bpy.context.scene.camera = cam
    setup_camera("CameraPool", (3.6, -2.6, 1.55), (0.6, 0.6, -0.5), lens=22)
    setup_camera("CameraMeadow", (1.2, 0.8, 1.05), (-0.6, 2.9, 0.15), lens=28)
    setup_camera("CameraHero", (-3.45, -2.65, 1.35), (1.4, 1.6, 0.55), lens=16)
    setup_camera("CameraLow", (3.65, -2.7, 0.32), (-0.6, 1.4, 0.55), lens=18)
    # Вторая комната: луг и мелкий бассейн из дальнего угла; коридор — из первой комнаты.
    setup_camera("CameraMeadow2", (14.5, -2.6, 1.45), (8.2, 0.6, 0.25), lens=17)
    setup_camera("CameraCorridor", (2.4, -1.8, 1.45), (9.5, -1.8, 0.6), lens=20)
    return cfg


def setup_video(seconds, fps):
    """Анимация: рябь на воде бежит (текстуры смещения привязаны к движущимся пустышкам),
    камера медленно проплывает низко над бассейном."""
    scene = bpy.context.scene
    frames = int(seconds * fps)
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frames

    edit = bpy.context.preferences.edit
    edit.keyframe_new_interpolation_type = "LINEAR"
    water = bpy.data.objects["Water"]
    drift = {"Ripples": Vector((0.11, 0.07, 0.05)), "Swell": Vector((-0.05, 0.04, 0.03))}
    for mod in water.modifiers:
        if mod.type != "DISPLACE":
            continue
        empty = link(bpy.data.objects.new(f"{mod.name}Flow", None))
        mod.texture_coords = "OBJECT"
        mod.texture_coords_object = empty
        empty.location = (0, 0, 0)
        empty.keyframe_insert("location", frame=1)
        empty.location = drift[mod.name] * seconds
        empty.keyframe_insert("location", frame=frames)

    # Узор каустики на дне течёт вместе с рябью.
    for node in water.active_material.node_tree.nodes:
        if node.name.startswith("Caustic"):
            w = node.inputs["W"]
            start = w.default_value
            w.keyframe_insert("default_value", frame=1)
            w.default_value = start + 0.09 * seconds
            w.keyframe_insert("default_value", frame=frames)

    edit.keyframe_new_interpolation_type = "BEZIER"
    cam = setup_camera("CameraVideo", (2.75, -1.95, 0.62), (0.4, 1.6, -0.2), lens=26)
    cam.keyframe_insert("location", frame=1)
    cam.keyframe_insert("rotation_euler", frame=1)
    cam.location = (1.75, -2.2, 0.5)
    cam.rotation_euler = (Vector((-0.2, 1.7, -0.2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.keyframe_insert("location", frame=frames)
    cam.keyframe_insert("rotation_euler", frame=frames)
    scene.camera = cam
    return frames


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = dict(time="day", samples=256, res="1920x1080", camera="Camera", render=True, save=True)
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        if k in ("no-render",):
            opts["render"] = False
            i += 1
            continue
        opts[k] = argv[i + 1]
        i += 2
    return opts


def main():
    o = parse_args()
    cfg = build(o["time"])
    bpy.context.scene["exposure"] = cfg.get("exposure", 0.0)
    w, h = (int(v) for v in o["res"].split("x"))
    out_dir = os.path.join(ROOT, "renders")
    os.makedirs(out_dir, exist_ok=True)
    if "video" in o:
        frames_dir = os.path.join(out_dir, "frames", o["time"])
        os.makedirs(frames_dir, exist_ok=True)
        setup_render(int(o["samples"]), (w, h), os.path.join(frames_dir, "f_"))
        frames = setup_video(float(o["video"]), int(o.get("fps", 24)))
        scene = bpy.context.scene
        if "frames" in o:
            a, b = (int(v) for v in o["frames"].split("-"))
            scene.frame_start, scene.frame_end = a, min(b, frames)
        scene.render.use_overwrite = False
        scene.render.use_placeholder = True
        # Сцена не пересобирается между кадрами; дымка считается грубее — так в разы быстрее.
        scene.render.use_persistent_data = True
        scene.cycles.volume_step_rate = 10.0
        scene.cycles.volume_max_steps = 256
        if o["render"]:
            bpy.ops.render.render(animation=True)
            print("RENDERED VIDEO FRAMES", frames_dir)
        return
    name = f"{o['time']}_{o['camera'].lower()}"
    setup_render(int(o["samples"]), (w, h), os.path.join(out_dir, name + ".png"))
    bpy.context.scene.camera = bpy.data.objects[o["camera"]]
    if o["save"] and o["save"] != "0":
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "pool_room.blend"))
    if o["render"]:
        bpy.ops.render.render(write_still=True)
        print("RENDERED", bpy.context.scene.render.filepath)


if __name__ == "__main__":
    main()

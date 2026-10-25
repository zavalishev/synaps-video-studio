"""Пример: low-poly остров-диорама с группами материалов для scene-state.

    studio blender .claude/skills/scene-state/examples/island.py --out public/3d/island.glb -- --seed 3
    studio blender .claude/skills/scene-state/examples/island.py --out public/3d/island_night.png -- \
        --look assets/look.json --width 1080 --height 1920 --render

Без --render — только GLB (для @studio/scene-state/three). С --render — ещё и кадр EEVEE
с применённым Look (scene_state.apply). Материалы названы группами: ground, foliage_*, roof,
water, window, lamp, — поэтому день/ночь/зима — это перекраска, а не новая модель.
Это СТАРТОВАЯ ТОЧКА, а не обязательный ассет: директор строит свою сцену под ролик.
"""
import math
import os
import random
import sys

import bpy
import sx

sys.path.insert(0, os.path.join(os.path.dirname(sx.__file__), "..", "scene-state"))
import scene_state  # noqa: E402

a = sx.args(lambda p: (p.add_argument("--look"), p.add_argument("--render", action="store_true")))
sx.reset()
R = random.Random(a.seed)

M = {
    "ground": sx.material("ground", "#7cc45e", roughness=0.9),
    "cliff": sx.material("cliff", "#9a6b47", roughness=0.95),
    "cliff_dark": sx.material("cliff_dark", "#7a5238", roughness=0.95),
    "sand": sx.material("sand", "#e8d29a", roughness=0.95),
    "water": sx.material("water", "#2fa8c8", roughness=0.25),
    "wall": sx.material("wall", "#f3e9d6", roughness=0.85),
    "roof": sx.material("roof", "#d0533b", roughness=0.8),
    "window": sx.material("window", "#3a4a6a", roughness=0.4, emission="#ffb24d", emission_strength=0.0),
    "trunk": sx.material("trunk", "#7a5236", roughness=0.9),
    "foliage_pine": sx.material("foliage_pine", "#3f8f5a", roughness=0.9),
    "foliage_blob": sx.material("foliage_blob", "#5aa64f", roughness=0.9),
    "stripe_red": sx.material("stripe_red", "#d9452f", roughness=0.7),
    "lamp": sx.material("lamp", "#fff1c2", roughness=0.3, emission="#ffcc66", emission_strength=0.0),
    "rock": sx.material("rock", "#8d94a0", roughness=0.9),
    "wood": sx.material("wood", "#a87a4f", roughness=0.9),
}


def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def add(op, mat, name, **kw):
    op(**kw)
    o = bpy.context.active_object
    o.name = name
    sx.assign(o, M[mat])
    return flat(o)


def jitter_top(obj, amount, z_min):
    for v in obj.data.vertices:
        if v.co.z > z_min:
            v.co.z += R.uniform(-amount, amount)


# --- остров: обрыв (две ступени), трава сверху, песок у воды, вода
cl = add(bpy.ops.mesh.primitive_cylinder_add, "cliff", "cliff", vertices=11, radius=3.0, depth=1.4, location=(0, 0, -0.35))
for v in cl.data.vertices:
    k = 1 + R.uniform(-0.06, 0.06)
    v.co.x *= k
    v.co.y *= k
    if v.co.z < 0:
        v.co.x *= 0.82
        v.co.y *= 0.82
cl2 = add(bpy.ops.mesh.primitive_cylinder_add, "cliff_dark", "cliff_low", vertices=9, radius=2.3, depth=0.9, location=(0.1, -0.1, -1.2))
for v in cl2.data.vertices:
    if v.co.z < 0:
        v.co.x *= 0.45
        v.co.y *= 0.45
gr = add(bpy.ops.mesh.primitive_cylinder_add, "ground", "ground", vertices=11, radius=3.08, depth=0.16, location=(0, 0, 0.42))
sand = add(bpy.ops.mesh.primitive_cylinder_add, "sand", "sand", vertices=14, radius=3.45, depth=0.12, location=(0, 0, -0.42))
water = add(bpy.ops.mesh.primitive_cylinder_add, "water", "water", vertices=48, radius=14, depth=0.1, location=(0, 0, -0.5))

TOP = 0.5


def house(x, y, rot, w=0.8, d=0.65, h=0.55):
    b = add(bpy.ops.mesh.primitive_cube_add, "wall", "house", size=1, location=(x, y, TOP + h / 2))
    b.scale = (w, d, h)
    b.rotation_euler = (0, 0, rot)
    # крыша — треугольная призма вдоль длинной стороны: ось цилиндра → X, вершина вверх, затем поворот дома
    r = add(bpy.ops.mesh.primitive_cylinder_add, "roof", "roof", vertices=3, radius=d * 0.62, depth=w * 1.12, location=(x, y, TOP + h + d * 0.31))
    r.rotation_euler = (0, math.radians(-90), rot)
    r.scale = (1, 1.0, 1)
    # окна: два на фасаде
    for s in (-0.22, 0.22):
        wx = x + math.cos(rot) * s * w - math.sin(rot) * (-d / 2 - 0.01)
        wy = y + math.sin(rot) * s * w + math.cos(rot) * (-d / 2 - 0.01)
        win = add(bpy.ops.mesh.primitive_cube_add, "window", "window", size=1, location=(wx, wy, TOP + h * 0.55))
        win.scale = (0.16, 0.04, 0.18)
        win.rotation_euler = (0, 0, rot)
    return b


house(-0.9, -0.6, math.radians(-15))
house(0.6, -1.3, math.radians(12), w=0.9)
house(-1.6, 0.7, math.radians(30), w=0.7, d=0.6, h=0.5)
houses = [o for o in bpy.data.objects if o.name.startswith("house")]

# маяк: полосатая башня, фонарь, колпак
lx, ly = 1.7, 0.9
for i in range(5):
    r0 = 0.36 - i * 0.04
    seg = add(bpy.ops.mesh.primitive_cone_add, "stripe_red" if i % 2 == 0 else "wall", "tower", vertices=12, radius1=r0, radius2=r0 - 0.04, depth=0.42, location=(lx, ly, TOP + 0.21 + i * 0.42))
lamp = add(bpy.ops.mesh.primitive_cylinder_add, "lamp", "lamp", vertices=12, radius=0.2, depth=0.3, location=(lx, ly, TOP + 2.25))
cap = add(bpy.ops.mesh.primitive_cone_add, "stripe_red", "cap", vertices=12, radius1=0.27, radius2=0.0, depth=0.32, location=(lx, ly, TOP + 2.56))
gal = add(bpy.ops.mesh.primitive_cylinder_add, "wall", "gallery", vertices=12, radius=0.3, depth=0.06, location=(lx, ly, TOP + 2.1))

# деревья: ели и круглые
spots = []
for i in range(16):
    for _ in range(40):
        ang = R.uniform(0, math.tau)
        rad = R.uniform(0.6, 2.7)
        x, y = math.cos(ang) * rad, math.sin(ang) * rad
        if all((x - sx_) ** 2 + (y - sy_) ** 2 > 0.45 ** 2 for sx_, sy_ in spots) and (x - lx) ** 2 + (y - ly) ** 2 > 0.6 ** 2 \
                and all((x - h.location.x) ** 2 + (y - h.location.y) ** 2 > 0.75 ** 2 for h in houses):
            spots.append((x, y))
            break
for i, (x, y) in enumerate(spots):
    s = R.uniform(0.75, 1.15)
    add(bpy.ops.mesh.primitive_cylinder_add, "trunk", "trunk", vertices=6, radius=0.06 * s, depth=0.3 * s, location=(x, y, TOP + 0.15 * s))
    if i % 3 == 0:
        t = add(bpy.ops.mesh.primitive_ico_sphere_add, "foliage_blob", "tree", subdivisions=1, radius=0.36 * s, location=(x, y, TOP + 0.55 * s))
        for v in t.data.vertices:
            v.co *= 1 + R.uniform(-0.12, 0.12)
    else:
        add(bpy.ops.mesh.primitive_cone_add, "foliage_pine", "pine", vertices=7, radius1=0.32 * s, radius2=0, depth=0.75 * s, location=(x, y, TOP + 0.55 * s))
        add(bpy.ops.mesh.primitive_cone_add, "foliage_pine", "pine", vertices=7, radius1=0.24 * s, radius2=0, depth=0.55 * s, location=(x, y, TOP + 0.85 * s))

# камни у воды и причал
for i in range(6):
    ang = R.uniform(0, math.tau)
    r = add(bpy.ops.mesh.primitive_ico_sphere_add, "rock", "rock", subdivisions=1, radius=R.uniform(0.18, 0.35), location=(math.cos(ang) * 3.35, math.sin(ang) * 3.35, -0.4))
    r.scale = (1, 1, 0.6)
pier = add(bpy.ops.mesh.primitive_cube_add, "wood", "pier", size=1, location=(0.6, -3.6, -0.32))
pier.scale = (0.45, 1.6, 0.06)

for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

if a.render:
    look = scene_state.load(a.look) if a.look else None
    sx.camera(location=(0, -17.5, 8.5), target=(0, 0, 0.5), lens=58)
    if look:
        scene_state.apply(look, scale=8, fog=False)
    else:
        sx.sun()
    sx.setup_render(a)
    if look:
        scene_state.exposure(look)
    sx.render_still(a.out)
else:
    sx.export_glb(a.out)

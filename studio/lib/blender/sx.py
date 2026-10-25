"""Помощник для bpy-скриптов студии (Blender 5.2.3 LTS, запуск: studio blender script.py).

    import sx
    args = sx.args()                     # --out, --frames, --width, --height, --samples, --engine, --transparent, --seed + свои
    sx.reset()                           # пустая сцена (без куба/лампы/камеры по умолчанию)
    ... строим сцену ...
    cam = sx.camera(location=(6, -6, 4), target=(0, 0, 0.5), lens=50)
    sx.sun(rotation=(50, 0, 30), energy=3)
    sx.setup_render(args)                # движок, размер, сэмплы, прозрачный фон, цвет
    sx.render_still(args.out)            # PNG; или sx.render_frames(args.out_dir, 1, 120)
    sx.export_glb(path)                  # модель для three/@remotion/three

Детерминизм: random.seed(args.seed); никакого времени в сцене.
"""
import argparse
import math
import os
import random
import sys

import bpy  # noqa: E402


def args(extra=None):
    """Аргументы после «--». extra(parser) — добавить свои."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="out.png", help="PNG (кадр) или папка/префикс для секвенции")
    p.add_argument("--frames", default=None, help="a-b для секвенции")
    p.add_argument("--width", type=int, default=1080)
    p.add_argument("--height", type=int, default=1920)
    p.add_argument("--samples", type=int, default=32)
    p.add_argument("--engine", default="eevee", choices=["eevee", "cycles", "workbench"])
    p.add_argument("--transparent", action="store_true")
    p.add_argument("--seed", type=int, default=1)
    if extra:
        extra(p)
    a, _ = p.parse_known_args(argv)
    random.seed(a.seed)
    return a


def eevee_id():
    ids = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def setup_render(a, film_exposure=0.0):
    sc = bpy.context.scene
    if a.engine == "cycles":
        sc.render.engine = "CYCLES"
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            sc.cycles.device = "GPU"
        except Exception as e:  # нет Metal — считаем на CPU
            print("cycles: GPU недоступен:", e)
        sc.cycles.samples = a.samples
        sc.cycles.use_denoising = True
    elif a.engine == "workbench":
        sc.render.engine = "BLENDER_WORKBENCH"
    else:
        sc.render.engine = eevee_id()
        try:
            sc.eevee.taa_render_samples = a.samples
        except AttributeError:
            pass
    sc.render.resolution_x = a.width
    sc.render.resolution_y = a.height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = bool(a.transparent)
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if a.transparent else "RGB"
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    sc.view_settings.exposure = film_exposure
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    return sc


def world_color(rgb=(0.9, 0.88, 0.85), strength=1.0):
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    w = sc.world
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*rgb, 1)
        bg.inputs[1].default_value = strength


def hex_rgb(h):
    """'#RRGGBB' → линейный RGB для материалов Blender."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, color="#cccccc", roughness=0.8, metallic=0.0, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*hex_rgb(color), 1)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    if emission:
        b.inputs["Emission Color"].default_value = (*hex_rgb(emission), 1)
        b.inputs["Emission Strength"].default_value = emission_strength
    return m


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def look_at(obj, target):
    from mathutils import Vector
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def camera(location=(0, -8, 3), target=(0, 0, 0), lens=50, name="Camera"):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    look_at(cam, target)
    bpy.context.scene.camera = cam
    return cam


def sun(rotation=(50, 0, 30), energy=3.0, color=(1, 0.97, 0.92), angle_deg=5):
    d = bpy.data.lights.new("Sun", "SUN")
    d.energy = energy
    d.color = color
    d.angle = math.radians(angle_deg)
    o = bpy.data.objects.new("Sun", d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = tuple(math.radians(r) for r in rotation)
    return o


def area(location=(3, -3, 5), target=(0, 0, 0), energy=500, size=3, color=(1, 1, 1)):
    d = bpy.data.lights.new("Area", "AREA")
    d.energy = energy
    d.size = size
    d.color = color
    o = bpy.data.objects.new("Area", d)
    bpy.context.scene.collection.objects.link(o)
    o.location = location
    look_at(o, target)
    return o


def render_still(path):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("SX_OUT", path)
    return path


def render_frames(prefix, start, end):
    """Секвенция PNG: prefix0001.png … (prefix — путь с префиксом имени)."""
    prefix = os.path.abspath(prefix)
    os.makedirs(os.path.dirname(prefix), exist_ok=True)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = start, end
    sc.render.filepath = prefix
    bpy.ops.render.render(animation=True)
    print("SX_OUT", prefix)
    return prefix


def export_glb(path, selected=False):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, export_yup=True, use_selection=selected)
    print("SX_OUT", path)
    return path


def frames_range(a, default=(1, 1)):
    if not a.frames:
        return default
    s, e = a.frames.split("-")
    return int(s), int(e)

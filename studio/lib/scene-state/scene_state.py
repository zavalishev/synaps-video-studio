"""scene-state для Blender: применить Look (свет, небо, дымка, перекраска групп) к сцене bpy.

Look берётся из TS (одни пресеты на всё):
    npx tsx studio/lib/scene-state/look.ts --time evening --weather rain --season autumn --out assets/look.json

В bpy-скрипте (studio blender script.py -- --look assets/look.json):
    import sx, os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(sx.__file__), "..", "scene-state"))
    import scene_state
    a = sx.args(lambda p: p.add_argument("--look"))
    ... строим сцену, материалы называем группами: ground*, foliage*, roof*, water*, window*/glow*/lamp*, snow* ...
    scene_state.apply(scene_state.load(a.look))      # до setup_render или после — неважно
    sx.setup_render(a); scene_state.exposure(look)   # экспозиция ставится после setup_render

Имена групп те же, что у @studio/scene-state/three — одна модель одинаково реагирует на
состояние и в Blender, и в three.
"""
import json
import math

import bpy


def load(path):
    d = json.load(open(path))
    return d.get("look", d)


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _lerp3(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


SNOW = lin("#f2f5f9")


def sky(look, strength=1.0):
    """Мир: вертикальный градиент skyBottom → skyTop (виден в кадре и светит на сцену)."""
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    w = sc.world
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.02
    mr.inputs["From Max"].default_value = 0.45
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*lin(look["skyBottom"]), 1)
    ramp.color_ramp.elements[1].color = (*lin(look["skyTop"]), 1)
    ramp.color_ramp.interpolation = "EASE"
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength * max(0.15, look["hemiIntensity"])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return w


def fog_volume(look, scale=8.0):
    """Дымка: объёмное рассеяние в мире (EEVEE/Cycles). Дороже по времени — только если fog заметен."""
    w = bpy.context.scene.world
    nt = w.node_tree
    out = [n for n in nt.nodes if n.type == "OUTPUT_WORLD"][0]
    vs = nt.nodes.new("ShaderNodeVolumeScatter")
    vs.inputs["Color"].default_value = (*lin(look["fogColor"]), 1)
    vs.inputs["Density"].default_value = look["fog"] * 0.06 / max(1.0, scale / 8)
    nt.links.new(vs.outputs[0], out.inputs["Volume"])


def sun(look, energy_k=1.4, name="Sun"):
    """Солнце (или луна ночью): цвет, сила, направление из sunElevation/sunAzimuth."""
    o = bpy.data.objects.get(name)
    if o is None or o.type != "LIGHT":
        d = bpy.data.lights.new(name, "SUN")
        o = bpy.data.objects.new(name, d)
        bpy.context.scene.collection.objects.link(o)
    o.data.energy = look["sunIntensity"] * energy_k
    o.data.color = lin(look["sunColor"])
    o.data.angle = math.radians(3 if look["sunElevation"] > 10 else 8)
    el, az = math.radians(look["sunElevation"]), math.radians(look["sunAzimuth"])
    # three: Y вверх, азимут от +Z к +X. Blender: Z вверх, -Y «к зрителю» → x = sin(az), y = -cos(az).
    from mathutils import Vector
    to_sun = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))
    o.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    return o


def recolor(look, keep=0.25, glow=1.0):
    """Перекраска материалов по имени группы (как useLookOnModel в three)."""
    snow = look.get("snowCover", 0)
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        b = m.node_tree.nodes.get("Principled BSDF")
        if b is None:
            continue
        n = m.name.lower()
        if "ss_base" not in m:
            m["ss_base"] = list(b.inputs["Base Color"].default_value)[:3]
        base = tuple(m["ss_base"])
        c = None
        if n.startswith("foliage"):
            c = _lerp3(_lerp3(base, lin(look["foliage"]), 1 - keep), SNOW, snow * 0.55)
        elif n.startswith("ground"):
            c = _lerp3(_lerp3(base, lin(look["ground"]), 1 - keep), SNOW, snow * 0.9)
        elif n.startswith("roof"):
            c = _lerp3(base, SNOW, snow * 0.85)
        elif n.startswith("water"):
            c = lin(look["water"])
        elif n.startswith(("window", "glow", "lamp")):
            g = look["windowGlow"] * glow
            b.inputs["Emission Color"].default_value = (*lin("#ffb24d"), 1)
            b.inputs["Emission Strength"].default_value = 6.0 * g
            c = _lerp3(base, lin("#2a2f45"), (1 - g) * 0.5)
        if c is not None:
            b.inputs["Base Color"].default_value = (*c, 1)


def exposure(look):
    bpy.context.scene.view_settings.exposure = look.get("exposure", 0)


def apply(look, scale=8.0, fog=None, keep=0.25, glow=1.0):
    sky(look)
    sun(look)
    recolor(look, keep=keep, glow=glow)
    if fog if fog is not None else look["fog"] > 0.3:
        fog_volume(look, scale)
    return look

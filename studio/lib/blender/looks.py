"""Материалы-«виды» для bpy (скилл materials). Тот же набор есть в three: `look()` из
"@studio/three-d" — один токен стиля даёт одинаковый вид в Blender и в @remotion/three.

    import sx, looks
    m = looks.look("clay", "#e07a5f")            # материал; имя по умолчанию «clay_e07a5f»
    looks.apply(obj, "felt", "#7aa874")          # назначить объекту (+ flat/smooth по стилю)
    looks.look("emissive", "#ffd27a", strength=6)
    looks.look("glass", "#d8ecf2")               # дорого в EEVEE/Cycles — только крупный план

Стили (стартовые значения, не догма — kw перекрывают):
    clay      матовая лепка, чуть подповерхностного рассеяния, мягкий блик
    lowpoly   плоские цвета, плоское затенение (граней видно) — «POLY WEATHER»
    felt      войлок: roughness 1, sheen, мелкий шумовой бамп (ворс)
    paper     бумага: матовая, тонкий бамп волокон
    toon      2–4 ступени по N·L к ключевому свету (как MeshToonMaterial); light_dir= — свой свет
    plastic   глянцевый пластик с лаком (упаковка, игрушки)
    ceramic   керамика/глазурь: светлый блик, лак
    metal     металл (roughness 0.3)
    glass     стекло (transmission 1, ior 1.45)
    emissive  свечение (окна, лампы, неон); strength — сила (1–2: цвет как hex; выше — уходит в
              белый; «ореол» — bloom в three или размытый слой в Remotion, не сила)
    label     матовая этикетка с картинкой: look("label", "#ffffff", image="//public/img/label.png")

Детерминизм: шум бампа — процедурный, без времени; от кадра к кадру не «кипит».
"""
import math

import bpy

from sx import hex_rgb

STYLES = ("clay", "lowpoly", "felt", "paper", "toon", "plastic", "ceramic", "metal", "glass", "emissive", "label")
SMOOTH = {"clay": True, "lowpoly": False, "felt": True, "paper": True, "toon": True, "plastic": True,
          "ceramic": True, "metal": True, "glass": True, "emissive": False, "label": True}

_cache = {}


def _bsdf(m):
    return m.node_tree.nodes.get("Principled BSDF")


def _set(b, name, value):
    if name in b.inputs:
        b.inputs[name].default_value = value


def _bump(m, scale=60.0, strength=0.15, detail=4.0):
    nt = m.node_tree
    b = _bsdf(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])


TOON_LIGHT = (-0.454, -0.542, 0.707)   # направление НА ключевой свет studio_lights("soft"), мир


def _toon(m, color, steps=3, shadow=0.55, light_dir=None):
    """Ступенчатый свет как MeshToonMaterial в three: ступень по N·L к ключевому свету
    (не по яркости ламп — иначе пороги «плывут» от мощности света). Тени не принимает:
    это плоская заливка с 2–4 ступенями. light_dir — направление на свет (мир, Z вверх)."""
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L = light_dir or TOON_LIGHT
    ln = math.sqrt(sum(c * c for c in L)) or 1
    dot.inputs[1].default_value = tuple(c / ln for c in L)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1
    mr.inputs["From Max"].default_value = 1
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    lv = [shadow + (1 - shadow) * i / max(1, steps - 1) for i in range(steps)]
    th = [0.0] + [0.5 + 0.3 * (i - 1) / max(1, steps - 2) for i in range(1, steps)]   # 0.5 — терминатор
    els[0].position, els[0].color = th[0], (lv[0],) * 3 + (1,)
    els[1].position, els[1].color = th[1], (lv[1],) * 3 + (1,)
    for i in range(2, steps):
        e = els.new(th[i])
        e.color = (lv[i],) * 3 + (1,)
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    mul.inputs[7].default_value = (*hex_rgb(color), 1)  # B (RGBA)
    emi = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(geo.outputs["Normal"], dot.inputs[0])
    nt.links.new(dot.outputs["Value"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mul.inputs[6])     # A (RGBA)
    nt.links.new(mul.outputs[2], emi.inputs["Color"])       # Result (RGBA)
    nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])


def look(style, color="#cccccc", name=None, **kw):
    """Материал стиля style цвета color ('#RRGGBB'). kw перекрывают значения стиля:
    roughness, metallic, coat, sheen, subsurface, ior, strength (emissive), bump (сила),
    bump_scale, image (путь к PNG для label/любого стиля), steps/shadow (toon)."""
    if style not in STYLES:
        raise ValueError(f"looks: неизвестный стиль {style}; есть {', '.join(STYLES)}")
    key = name or f"{style}_{color.lstrip('#')}_{abs(hash(tuple(sorted(kw.items())))) % 10**6 if kw else ''}".rstrip("_")
    if key in _cache and _cache[key].name in bpy.data.materials:
        return _cache[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    b = _bsdf(m)
    rgb = (*hex_rgb(color), 1)
    _set(b, "Base Color", rgb)
    preset = {
        "clay": dict(roughness=0.85, subsurface=0.05),
        "lowpoly": dict(roughness=0.8),
        "felt": dict(roughness=1.0, sheen=0.8, bump=0.6, bump_scale=140.0),
        "paper": dict(roughness=1.0, bump=0.06, bump_scale=90.0),
        "toon": dict(),
        "plastic": dict(roughness=0.32, coat=0.6),
        "ceramic": dict(roughness=0.18, coat=0.4),
        "metal": dict(roughness=0.3, metallic=1.0),
        "glass": dict(roughness=0.03, ior=1.45, transmission=1.0),
        "emissive": dict(roughness=0.6, strength=1.5),
        "label": dict(roughness=0.55),
    }[style]
    p = {**preset, **kw}
    if style == "toon":
        _toon(m, color, p.get("steps", 3), p.get("shadow", 0.55), p.get("light_dir"))
        _cache[key] = m
        return m
    _set(b, "Roughness", p.get("roughness", 0.8))
    _set(b, "Metallic", p.get("metallic", 0.0))
    if p.get("subsurface"):
        _set(b, "Subsurface Weight", p["subsurface"])
        _set(b, "Subsurface Radius", (0.2, 0.1, 0.08))
    if p.get("sheen"):
        _set(b, "Sheen Weight", p["sheen"])
        _set(b, "Sheen Roughness", 0.8)
        _set(b, "Sheen Tint", tuple(0.5 + 0.5 * c for c in hex_rgb(color)) + (1,))
    if p.get("coat"):
        _set(b, "Coat Weight", p["coat"])
        _set(b, "Coat Roughness", 0.08)
    if p.get("transmission"):
        _set(b, "Transmission Weight", p["transmission"])
        _set(b, "IOR", p.get("ior", 1.45))
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "DITHERED"
        if hasattr(m, "use_screen_refraction"):
            m.use_screen_refraction = True
    if style == "emissive":
        _set(b, "Emission Color", rgb)
        _set(b, "Emission Strength", p.get("strength", 1.5))
    if p.get("image"):
        img = bpy.data.images.load(bpy.path.abspath(p["image"]), check_existing=True)
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Cubic"
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if p.get("bump"):
        _bump(m, p.get("bump_scale", 60.0), p["bump"])
    _cache[key] = m
    return m


def apply(obj, style, color="#cccccc", smooth=None, **kw):
    """Назначить вид объекту (все слоты) и затенение по стилю (lowpoly/paper — плоское)."""
    m = look(style, color, **kw)
    if obj.type == "MESH":
        obj.data.materials.clear()
        obj.data.materials.append(m)
        sm = SMOOTH[style] if smooth is None else smooth
        for poly in obj.data.polygons:
            poly.use_smooth = sm
    return m


def from_theme(theme_path, role, style=None):
    """Цвет и стиль из theme.json директора: {"palette": {role: "#hex"}, "material": "clay"}."""
    import json
    t = json.load(open(bpy.path.abspath(theme_path)))
    col = t.get("palette", {}).get(role) or t.get("colors", {}).get(role) or "#cccccc"
    st = style or t.get("material", "clay")
    return look(st if st in STYLES else "clay", col)

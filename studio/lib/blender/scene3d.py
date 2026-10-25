"""Сцена Blender для героя-кадров и диорам (скиллы object-scene-3d, blender-asset-factory).

    import sx, scene3d as s3
    s3.sky_gradient("#bfe3f2", "#f6efe4")             # небо-градиент (верх, горизонт)
    s3.studio_lights(target=(0, 0, 0.5), preset="soft", scale=1.0)
    s3.cyclorama("#efe6d6", width=8, depth=6, height=4) # «бесконечный» фон-изгиб
    cam = sx.camera(location=(0, -6, 3), target=(0, 0, 0.5), lens=60)
    s3.frame_objects(cam, objs, target=(0, 0, 0.5))    # отодвинуть камеру, чтобы всё влезло в безопасную зону
    s3.frame_check(cam, objs)                          # SX_WARN, если что-то вылезло (кадр/секвенция)
    sx.setup_render(args); s3.tone("neutral")          # размер кадра ДО кадрирования; цвета ≈ hex
    s3.render_sequence(prefix, 90, lambda i: …)        # секвенция без системы анимации (детерминированно)
    s3.turntable(obj, prefix, frames=120, degrees=60)  # поворотный стол → PNG-секвенция

Безопасная зона по умолчанию — как defaultMargins в studio/lib/layout.ts (вертикаль: верх 8 %,
низ 20 %, бока 5.5 %; горизонталь: 5/6/4 %) + свой запас margin.
"""
import math

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

import sx


# ---------------------------------------------------------------- мир и свет

def sky_gradient(top="#bfe3f2", horizon="#f6efe4", bottom=None, strength=1.0, light_strength=None, screen=False):
    """Мир: вертикальный градиент. top — зенит, horizon — горизонт, bottom — низ (по умолч. horizon).
    screen=True — градиент по экрану (верх кадра → низ кадра), а не по направлению взгляда:
    для камеры, смотрящей сверху вниз (диорама), иначе виден только «низ» неба.
    light_strength — сколько этот мир светит на сцену (по умолч. = strength); для «фон как
    на картинке, а свет от ламп» ставьте light_strength≈0.3.
    Тон-маппинг AgX темнит фон на ~15–20 %: нужен ТОЧНЫЙ цвет фона — рендерьте --transparent и
    рисуйте фон в Remotion (тот же цвет, что у 2D-сцен)."""
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    w = sc.world
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.45, (*sx.hex_rgb(bottom or horizon), 1)
    els[1].position, els[1].color = 0.85, (*sx.hex_rgb(top), 1)
    mid = els.new(0.52)
    mid.color = (*sx.hex_rgb(horizon), 1)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1
    mr.inputs["From Max"].default_value = 1
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    if screen:
        nt.links.new(tc.outputs["Window"], sep.inputs["Vector"])
        nt.links.new(sep.outputs["Y"], mr.inputs["Value"])
        mr.inputs["From Min"].default_value = -0.4   # Window.Y: 0 — низ кадра, 1 — верх
        mr.inputs["From Max"].default_value = 1.2
    else:
        nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
        nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    ls = strength if light_strength is None else light_strength
    if abs(ls - strength) < 1e-6:
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    else:
        # камера видит градиент с силой strength, сцена освещается с силой light_strength
        bg2 = nt.nodes.new("ShaderNodeBackground")
        bg2.inputs["Strength"].default_value = ls
        nt.links.new(ramp.outputs["Color"], bg2.inputs["Color"])
        lp = nt.nodes.new("ShaderNodeLightPath")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
        nt.links.new(bg2.outputs["Background"], mix.inputs[1])
        nt.links.new(bg.outputs["Background"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return w


LIGHT_PRESETS = {
    # ключ (азимут°, высота°, мощность, размер, цвет), заполняющий, контровой — стартовые точки
    "soft":    dict(key=(-40, 45, 420, 4.0, "#fff4e6"), fill=(50, 20, 110, 5.0, "#e6f0ff"), rim=(160, 35, 260, 2.0, "#ffffff")),
    "product": dict(key=(-35, 40, 520, 2.5, "#ffffff"), fill=(55, 15, 140, 4.0, "#f2f6ff"), rim=(170, 45, 520, 1.5, "#ffffff")),
    "golden":  dict(key=(-60, 18, 560, 2.0, "#ffb36b"), fill=(60, 25, 80, 5.0, "#9fb6ff"), rim=(150, 20, 420, 1.5, "#ffd2a1")),
    "night":   dict(key=(-30, 50, 100, 4.0, "#9fb6ff"), fill=(60, 20, 35, 5.0, "#6f7fb8"), rim=(170, 30, 180, 2.0, "#bcd0ff")),
}


def studio_lights(target=(0, 0, 0), preset="soft", scale=1.0, distance=None, intensity=1.0):
    """Трёхточечный свет площадными лампами вокруг target. scale — размер сцены (м): мощность
    растёт как scale². intensity — общий множитель (пересвет → 0.7). Возвращает {"key", "fill", "rim"}.
    Пресеты откалиброваны под tone("neutral") и светлый фон без сильного мира (strength ≤ 0.5)."""
    p = LIGHT_PRESETS[preset]
    d = distance or 4.5 * scale
    out = {}
    for role in ("key", "fill", "rim"):
        az, el, energy, size, col = p[role]
        a, e = math.radians(az), math.radians(el)
        loc = (target[0] + d * math.cos(e) * math.sin(a), target[1] - d * math.cos(e) * math.cos(a), target[2] + d * math.sin(e))
        out[role] = sx.area(location=loc, target=target, energy=energy * scale * scale * intensity, size=size * scale, color=sx.hex_rgb(col))
        out[role].name = f"light_{role}"
    return out


def cyclorama(color="#efe6d6", width=10, depth=8, height=5, radius=1.6, style="clay", name="cyclorama"):
    """Фон-циклорама: пол переходит в стену плавной дугой — нет линии горизонта. Пол z=0,
    стена в +Y (за объектом, камера смотрит из −Y)."""
    import looks
    prof = [(-depth, 0.0)]
    for i in range(13):
        a = math.pi / 2 * i / 12
        prof.append((radius * math.sin(a), radius * (1 - math.cos(a))))
    prof.append((radius, height))
    bm = bmesh.new()
    left = [bm.verts.new((-width / 2, y, z)) for y, z in prof]
    right = [bm.verts.new((width / 2, y, z)) for y, z in prof]
    for i in range(len(prof) - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for p in me.polygons:
        p.use_smooth = True
    for poly in me.polygons:  # нормали к камере (вверх/вперёд)
        if poly.normal.z < -0.1 or poly.normal.y > 0.1:
            me.flip_normals()
            break
    me.materials.append(looks.look(style, color, roughness=0.9))
    return o


def shadow_catcher(size=6, z=0.0, name="shadow_catcher"):
    """Пол, который в прозрачном PNG оставляет только тень (ТОЛЬКО Cycles: --engine cycles
    --transparent). Для EEVEE — рендерьте с полом цвета фона без прозрачности."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    o = bpy.context.active_object
    o.name = name
    o.is_shadow_catcher = True
    return o


TONES = {
    # режим: (view_transform, look)
    "neutral": ("Khronos PBR Neutral", "None"),  # по умолчанию: цвета материалов ≈ hex, блики мягкие
    "flat": ("Standard", "None"),                 # точные hex фона/эмиссии, пересвет режется жёстко
    "film": ("AgX", "AgX - Punchy"),               # фото-реализм, широкий свет; гасит насыщенность
}


def tone(mode="neutral", exposure=0.0):
    """Тон-маппинг. Звать ПОСЛЕ sx.setup_render (тот ставит AgX). Для стилизованного 3D
    (lowpoly/clay/toon), чтобы 3D совпало по цвету с 2D-палитрой theme.json, — "neutral"
    (проверено: AgX делает ту же диораму серой и блёклой)."""
    vt, lk = TONES[mode]
    vs = bpy.context.scene.view_settings
    vs.view_transform = vt
    vs.look = lk
    vs.exposure = exposure


def look_punchy(exposure=0.0):
    """Устаревшее имя: tone("film")."""
    tone("film", exposure)


def eevee_quality(soft_shadows=True, ao=True, rays=True):
    """Тени, AO и трассировка EEVEE (Blender 5): мягче контакт объектов с полом."""
    ee = bpy.context.scene.eevee
    for attr, val in (("use_shadows", True), ("use_raytracing", rays), ("shadow_ray_count", 2 if soft_shadows else 1),
                      ("shadow_step_count", 8), ("use_gtao", ao), ("gtao_distance", 0.6)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass


# ---------------------------------------------------------------- кадр: всё в безопасной зоне

def default_safe(width, height):
    if height / width > 1.3:
        return dict(top=0.08, bottom=0.20, left=0.055, right=0.055)
    return dict(top=0.05, bottom=0.06, left=0.04, right=0.04)


def _corners(objs):
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type not in {"MESH", "CURVE", "FONT"}:
            continue
        oe = o.evaluated_get(dg)
        pts += [oe.matrix_world @ Vector(c) for c in oe.bound_box]
    return pts


def projected_rect(cam, objs):
    """Прямоугольник объектов на кадре в долях (0..1, y — снизу): (x0, y0, x1, y1)."""
    sc = bpy.context.scene
    bpy.context.view_layer.update()
    ps = [world_to_camera_view(sc, cam, p) for p in _corners(objs)]
    return (min(p.x for p in ps), min(p.y for p in ps), max(p.x for p in ps), max(p.y for p in ps))


def overflow(cam, objs, safe=None, margin=0.0):
    """На сколько (доля кадра, худший край) объекты вылезают из безопасной зоны + margin. 0 — внутри."""
    sc = bpy.context.scene
    s = safe or default_safe(sc.render.resolution_x, sc.render.resolution_y)
    x0, y0, x1, y1 = projected_rect(cam, objs)
    return max(0.0, s["left"] + margin - x0, x1 - (1 - s["right"] - margin), s["bottom"] + margin - y0, y1 - (1 - s["top"] - margin))


def frame_objects(cam, objs, target=None, safe=None, margin=0.03, center=True):
    """Отодвинуть/придвинуть камеру вдоль её луча к target так, чтобы объекты заняли
    безопасную зону (с запасом margin), и сдвинуть объектив (shift), чтобы они встали по центру
    зоны. Направление и объектив камеры не меняются. Возвращает расстояние."""
    sc = bpy.context.scene
    s = safe or default_safe(sc.render.resolution_x, sc.render.resolution_y)
    if target is None:
        ps = _corners(objs)
        target = tuple(sum(p[i] for p in ps) / len(ps) for i in range(3))
    tg = Vector(target)
    dirv = (cam.location - tg).normalized()
    cam.data.shift_x = cam.data.shift_y = 0.0
    lo, hi = 0.05, 500.0
    for _ in range(40):
        mid = (lo + hi) / 2
        cam.location = tg + dirv * mid
        if overflow(cam, objs, s, margin) > 0:
            lo = mid
        else:
            hi = mid
    cam.location = tg + dirv * hi
    if center:
        x0, y0, x1, y1 = projected_rect(cam, objs)
        cx_safe = (s["left"] + 1 - s["right"]) / 2
        cy_safe = (s["bottom"] + 1 - s["top"]) / 2
        W, H = sc.render.resolution_x, sc.render.resolution_y
        k = max(W, H)  # shift в долях большей стороны
        cam.data.shift_x += -((x0 + x1) / 2 - cx_safe) * W / k
        cam.data.shift_y += -((y0 + y1) / 2 - cy_safe) * H / k
    return hi


def frame_check(cam, objs, safe=None, margin=0.0, label="scene"):
    """Печатает SX_WARN, если объекты вылезают из безопасной зоны (проверка кадра/кадров)."""
    ov = overflow(cam, objs, safe, margin)
    if ov > 0:
        print(f"SX_WARN {label}: вылезает из безопасной зоны на {ov * 100:.1f}% кадра")
    return ov


# ---------------------------------------------------------------- секвенции без системы анимации

def render_sequence(prefix, count, update, start=1, check=None):
    """Рендер PNG-секвенции prefix0001.png …: для i в 0..count-1 вызывается update(i, t)
    (t = i/(count-1)), затем кадр. Ключевые кадры Blender не нужны — всё детерминированно.
    check — список (cam, objs): проверка безопасной зоны на каждом кадре (SX_WARN)."""
    import os
    sc = bpy.context.scene
    prefix = os.path.abspath(prefix)
    os.makedirs(os.path.dirname(prefix), exist_ok=True)
    worst = 0.0
    for i in range(count):
        t = i / max(1, count - 1)
        update(i, t)
        bpy.context.view_layer.update()
        if check:
            worst = max(worst, overflow(check[0], check[1]))
        sc.render.filepath = f"{prefix}{i + start:04d}.png"
        bpy.ops.render.render(write_still=True)
    if worst > 0:
        print(f"SX_WARN секвенция: объект вылезает из безопасной зоны до {worst * 100:.1f}% кадра")
    print("SX_OUT", prefix)
    return prefix


def ease(t):
    """Та же плавность, что EASE в studio/lib/camera.ts (bezier .45,0,.2,1) — приближение smootherstep."""
    t = min(1.0, max(0.0, t))
    return t * t * t * (t * (6 * t - 15) + 10)


def turntable(obj, prefix, frames=120, degrees=60.0, fps=30, start_deg=0.0, eased=False, check=None):
    """Поворотный стол: obj поворачивается по Z на degrees за frames кадров → PNG-секвенция.
    Скорость ≤ 12°/с (MOTION_LIMITS.maxOrbitDegPerSec) — иначе предупреждение. Петля
    без шва: degrees=360 и eased=False."""
    dps = abs(degrees) / (frames / fps) * (1.875 if eased else 1.0)   # пик: у плавной ≈ 1.9× средней
    if dps > 12:
        print(f"SX_WARN turntable: пик {dps:.1f}°/с > 12°/с — будет «крутиться»: меньше градусов или больше кадров")
    base = obj.rotation_euler.z

    def upd(i, t):
        k = ease(t) if eased else (i / frames if degrees % 360 == 0 else t)
        obj.rotation_euler.z = base + math.radians(start_deg + degrees * k)

    return render_sequence(prefix, frames, upd, check=check)


# ---------------------------------------------------------------- GLB + паспорт для three

def export_glb(path, objs=None):
    """GLB (через sx.export_glb) + рядом <имя>.json: бокс и центр В КООРДИНАТАХ three (Y вверх:
    x, z, −y), размер, имена узлов. В Remotion: projectBox(meta.bbox, cam, W, H) и fitDistance —
    кадрирование и проверка до рендера."""
    import json
    import os
    objs = objs or [o for o in bpy.context.scene.objects if o.type in {"MESH", "CURVE", "FONT"}]
    pts = _corners(objs)
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    to3 = lambda v: [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]  # noqa: E731
    lo, hi = to3(mn), to3(mx)
    bb = {"min": [min(lo[i], hi[i]) for i in range(3)], "max": [max(lo[i], hi[i]) for i in range(3)]}
    size = [round(bb["max"][i] - bb["min"][i], 4) for i in range(3)]
    center = [round((bb["max"][i] + bb["min"][i]) / 2, 4) for i in range(3)]
    radius = round(0.5 * math.sqrt(sum(s * s for s in size)), 4)
    out = sx.export_glb(path)
    meta = {"glb": os.path.basename(path), "bbox": bb, "size": size, "center": center, "radius": radius,
            "nodes": sorted(o.name for o in bpy.context.scene.objects if o.type in {"MESH", "EMPTY"})}
    with open(os.path.splitext(os.path.abspath(path))[0] + ".json", "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f"SX_INFO glb bbox(three)={bb} radius={radius}")
    return out
